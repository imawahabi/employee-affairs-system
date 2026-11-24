import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const LOG_LEVEL = process.env.LOG_LEVEL || 'quiet';
const log = (...args: any[]) => {
    if (LOG_LEVEL !== 'quiet') console.log(...args);
};

// Tables that must NEVER be replicated (internal sync machinery).
// Everything else in sqlite_master is treated as user data and synced.
const INTERNAL_TABLE_PREFIX = '_sync_';

export type SyncOp = 'upsert' | 'delete';

export interface SyncChange {
    seq: number;
    table: string;
    rowId: string;
    op: SyncOp;
    data: Record<string, any> | null;
}

interface OutboxRow {
    seq: number;
    tableName: string;
    rowId: string;
    op: SyncOp;
}

interface ConflictRow {
    id: string;
    tableName: string;
    rowId: string;
    localDevice: string | null;
    remoteDevice: string | null;
    localData: string | null;
    remoteData: string | null;
    status: string;
    createdAt: string;
    resolvedAt: string | null;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const safeIdent = (name: string) => {
    if (!IDENT_RE.test(name)) throw new Error(`Unsafe identifier: ${name}`);
    return `"${name}"`;
};

const getControlValue = async (db: Database, key: string): Promise<string | null> => {
    const row = await db.get('SELECT value FROM _sync_control WHERE key = ?', key);
    return row?.value ?? null;
};

const setControlValue = async (db: Database, key: string, value: string) => {
    await db.run(
        'INSERT INTO _sync_control(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key, value
    );
};

const getMetaValue = async (db: Database, key: string): Promise<string | null> => {
    const row = await db.get('SELECT value FROM _sync_meta WHERE key = ?', key);
    return row?.value ?? null;
};

const setMetaValue = async (db: Database, key: string, value: string) => {
    await db.run(
        'INSERT INTO _sync_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key, value
    );
};

// Highest seq of OUR outbox that the given peer has consumed.
const getPeerCursor = async (db: Database, peer: string): Promise<number> => {
    const row = await db.get('SELECT lastSeq FROM _sync_cursors WHERE peer = ?', peer);
    return row?.lastSeq ?? 0;
};

const setPeerCursor = async (db: Database, peer: string, seq: number) => {
    await db.run(
        'INSERT INTO _sync_cursors(peer, lastSeq) VALUES(?, ?) ON CONFLICT(peer) DO UPDATE SET lastSeq = MAX(lastSeq, excluded.lastSeq)',
        peer, seq
    );
};

const SUPPRESS_GUARD = `COALESCE((SELECT value FROM _sync_control WHERE key = 'suppress'), '0') != '1'`;

const listSyncedTables = async (db: Database): Promise<string[]> => {
    const rows = await db.all(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    return rows
        .map((r: any) => r.name as string)
        .filter((name) => !name.startsWith(INTERNAL_TABLE_PREFIX))
        .sort();
};

const tableHasIdColumn = async (db: Database, table: string): Promise<boolean> => {
    const cols = await db.all(`PRAGMA table_info(${safeIdent(table)})`);
    return cols.some((c: any) => c.name === 'id');
};

// Create internal tables + triggers on every user table + one-time backfill.
export const ensureSyncSchema = async (db: Database) => {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS _sync_control (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS _sync_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS _sync_cursors (
            peer TEXT PRIMARY KEY,
            lastSeq INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS _sync_outbox (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            tableName TEXT NOT NULL,
            rowId TEXT NOT NULL,
            op TEXT NOT NULL,
            synthetic INTEGER NOT NULL DEFAULT 0,
            changedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_sync_outbox_seq ON _sync_outbox(seq);
        CREATE INDEX IF NOT EXISTS idx_sync_outbox_row ON _sync_outbox(tableName, rowId, seq);
        CREATE TABLE IF NOT EXISTS SyncConflicts (
            id TEXT PRIMARY KEY,
            tableName TEXT NOT NULL,
            rowId TEXT NOT NULL,
            localDevice TEXT,
            remoteDevice TEXT,
            localData TEXT,
            remoteData TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            resolvedAt TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON SyncConflicts(status);
    `);

    // Migration for installs that already have _sync_outbox without `synthetic`.
    try {
        await db.run('ALTER TABLE _sync_outbox ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0');
    } catch {}

    await setControlValue(db, 'suppress', '0');

    const deviceId = process.env.DEVICE_ID || `device-${crypto.randomBytes(4).toString('hex')}`;
    await setControlValue(db, 'deviceId', deviceId);

    // (Re)create triggers for all user tables. Dropping first keeps this
    // idempotent even if migrations replaced tables since last boot.
    const tables = await listSyncedTables(db);
    for (const table of tables) {
        if (!(await tableHasIdColumn(db, table))) {
            log(`[Sync] Skipping table without id column: ${table}`);
            continue;
        }
        const safe = safeIdent(table);
        const tname = table.replace(/[^A-Za-z0-9_]/g, '_');
        for (const [suffix, event, rowRef, op] of [
            ['ai', 'INSERT', 'NEW.id', 'upsert'],
            ['au', 'UPDATE', 'NEW.id', 'upsert'],
            ['ad', 'DELETE', 'OLD.id', 'delete'],
        ] as const) {
            const triggerName = `sync_${tname}_${suffix}`;
            await db.run(`DROP TRIGGER IF EXISTS ${safeIdent(triggerName)}`);
            await db.run(`
                CREATE TRIGGER ${safeIdent(triggerName)}
                AFTER ${event} ON ${safe}
                WHEN ${SUPPRESS_GUARD}
                BEGIN
                    INSERT INTO _sync_outbox(tableName, rowId, op)
                    VALUES('${table.replace(/'/g, "''")}', ${rowRef === 'NEW.id' ? 'NEW.id' : 'OLD.id'}, '${op}');
                END
            `);
        }
    }
    log(`[Sync] Triggers ensured for ${tables.length} tables (device: ${deviceId})`);

    // One-time backfill: log every existing row so peers can bootstrap.
    const backfilled = await getMetaValue(db, 'backfilled');
    if (backfilled !== '1') {
        log('[Sync] Running initial outbox backfill...');
        await setControlValue(db, 'suppress', '1');
        try {
            for (const table of tables) {
                if (!(await tableHasIdColumn(db, table))) continue;
                await db.run(
                    `INSERT INTO _sync_outbox(tableName, rowId, op, synthetic)
                     SELECT '${table.replace(/'/g, "''")}', id, 'upsert', 1 FROM ${safeIdent(table)}`
                );
            }
        } finally {
            await setControlValue(db, 'suppress', '0');
        }
        await setMetaValue(db, 'backfilled', '1');
        log('[Sync] Backfill complete');
    }
};

// Coalesce outbox entries to the latest op per (table,rowId) after `since`.
const loadPendingChanges = async (db: Database, since: number): Promise<{ changes: SyncChange[]; maxSeq: number }> => {
    const rows = await db.all(
        'SELECT seq, tableName, rowId, op FROM _sync_outbox WHERE seq > ? ORDER BY seq',
        since
    ) as OutboxRow[];

    const maxRow = await db.get('SELECT COALESCE(MAX(seq), 0) AS m FROM _sync_outbox');
    const maxSeq = maxRow?.m ?? 0;

    const latest = new Map<string, OutboxRow>();
    for (const r of rows) {
        latest.set(`${r.tableName}::${r.rowId}`, r);
    }

    const changes: SyncChange[] = [];
    for (const entry of latest.values()) {
        let data: Record<string, any> | null = null;
        if (entry.op === 'upsert') {
            const row = await db.get(`SELECT * FROM ${safeIdent(entry.tableName)} WHERE id = ?`, entry.rowId);
            if (row) {
                const { id, ...rest } = row as any;
                data = { id, ...rest };
            } else {
                // Row vanished between ops; treat as delete.
                changes.push({ seq: entry.seq, table: entry.tableName, rowId: entry.rowId, op: 'delete', data: null });
                continue;
            }
        }
        changes.push({ seq: entry.seq, table: entry.tableName, rowId: entry.rowId, op: entry.op, data });
    }

    return { changes, maxSeq };
};

const getTableColumns = async (db: Database, table: string): Promise<Set<string>> => {
    const cols = await db.all(`PRAGMA table_info(${safeIdent(table)})`);
    return new Set(cols.map((c: any) => c.name as string));
};

// Serialize transactional work on the shared sync connection — concurrent
// BEGIN IMMEDIATE blocks would otherwise fail with SQLITE errors.
let applyMutex: Promise<unknown> = Promise.resolve();
const withApplyLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = applyMutex.then(fn, fn);
    applyMutex = run.then(() => undefined, () => undefined);
    return run;
};

// Apply a batch of remote changes inside one transaction with triggers suppressed.
// Returns list of conflicts that were recorded instead of applied.
const applyRemoteChanges = (db: Database, entries: SyncChange[], localDevice: string, remoteDevice: string) =>
    withApplyLock(() => applyRemoteChangesInner(db, entries, localDevice, remoteDevice));

const applyRemoteChangesInner = async (
    db: Database,
    entries: SyncChange[],
    localDevice: string,
    remoteDevice: string
): Promise<{ applied: number; conflicts: number }> => {
    const validTables = new Set(await listSyncedTables(db));
    const columnCache = new Map<string, Set<string>>();

    await db.run('BEGIN IMMEDIATE');
    try {
        await setControlValue(db, 'suppress', '1');

        let applied = 0;
        let conflicts = 0;
        const conflictInserts: Array<{ tableName: string; rowId: string; localData: any; remoteData: any }> = [];

        for (const entry of entries) {
            if (!validTables.has(entry.table) || !IDENT_RE.test(entry.table)) continue;
            const peerCursor = await getPeerCursor(db, remoteDevice);

            if (entry.op === 'upsert') {
                // Conflict: we have local changes for this row the peer hasn't consumed yet.
                const pending = await db.get(
                    'SELECT seq FROM _sync_outbox WHERE tableName = ? AND rowId = ? AND seq > ? AND synthetic = 0 LIMIT 1',
                    entry.table, entry.rowId, peerCursor
                );
                if (pending) {
                    const localRow = await db.get(`SELECT * FROM ${safeIdent(entry.table)} WHERE id = ?`, entry.rowId);
                    conflictInserts.push({
                        tableName: entry.table,
                        rowId: entry.rowId,
                        localData: localRow ?? null,
                        remoteData: entry.data,
                    });
                    conflicts++;
                    continue;
                }

                if (entry.data && typeof entry.data === 'object') {
                    if (!columnCache.has(entry.table)) {
                        columnCache.set(entry.table, await getTableColumns(db, entry.table));
                    }
                    const cols = columnCache.get(entry.table)!;
                    const data = entry.data as Record<string, any>;
                    const keys = Object.keys(data).filter((k) => cols.has(k));
                    if (!keys.includes('id')) keys.unshift('id');
                    const placeholders = keys.map(() => '?').join(', ');
                    const colList = keys.map((k) => safeIdent(k)).join(', ');
                    const values = keys.map((k) => data[k] ?? null);
                    await db.run(
                        `INSERT OR REPLACE INTO ${safeIdent(entry.table)} (${colList}) VALUES (${placeholders})`,
                        ...values
                    );
                    applied++;
                }
            } else {
                // delete
                const pending = await db.get(
                    'SELECT seq FROM _sync_outbox WHERE tableName = ? AND rowId = ? AND seq > ? AND synthetic = 0 LIMIT 1',
                    entry.table, entry.rowId, peerCursor
                );
                if (pending) {
                    const localRow = await db.get(`SELECT * FROM ${safeIdent(entry.table)} WHERE id = ?`, entry.rowId);
                    conflictInserts.push({
                        tableName: entry.table,
                        rowId: entry.rowId,
                        localData: localRow ?? null,
                        remoteData: null,
                    });
                    conflicts++;
                    continue;
                }
                await db.run(`DELETE FROM ${safeIdent(entry.table)} WHERE id = ?`, entry.rowId);
                applied++;
            }
        }

        // Record conflicts with triggers ENABLED so they replicate to the peer.
        await setControlValue(db, 'suppress', '0');
        for (const c of conflictInserts) {
            // Dedup: skip if a pending conflict already exists for this row.
            const existing = await db.get(
                "SELECT id FROM SyncConflicts WHERE tableName = ? AND rowId = ? AND status = 'pending' LIMIT 1",
                c.tableName, c.rowId
            );
            if (existing) continue;
            const id = `conf_${crypto.randomUUID()}`;
            await db.run(
                `INSERT INTO SyncConflicts(id, tableName, rowId, localDevice, remoteDevice, localData, remoteData, status)
                 VALUES(?, ?, ?, ?, ?, ?, ?, 'pending')`,
                id, c.tableName, c.rowId, localDevice, remoteDevice,
                c.localData ? JSON.stringify(c.localData) : null,
                c.remoteData ? JSON.stringify(c.remoteData) : null
            );
        }

        await db.run('COMMIT');
        return { applied, conflicts };
    } catch (err) {
        try { await db.run('ROLLBACK'); } catch {}
        throw err;
    } finally {
        try { await setControlValue(db, 'suppress', '0'); } catch {}
    }
};

export interface SyncRuntime {
    db: Database;
    deviceId: string;
    peerUrl: string | null;
    peerName: string;
}

export const createSyncRuntime = async (dbPath: string): Promise<SyncRuntime> => {
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    await ensureSyncSchema(db);
    const deviceId = (await getControlValue(db, 'deviceId')) || 'unknown';
    return {
        db,
        deviceId,
        peerUrl: process.env.SYNC_PEER_URL || null,
        peerName: process.env.SYNC_PEER_NAME || 'peer',
    };
};

// ---------- HTTP handlers ----------

// GET /api/sync/changes?device=X&since=N  — serve our outbox to a peer.
export const handleGetChanges = async (runtime: SyncRuntime, device: string, since: number) => {
    const { changes, maxSeq } = await loadPendingChanges(runtime.db, since);
    return {
        device: runtime.deviceId,
        maxSeq,
        changes,
    };
};

// POST /api/sync/incoming — receive a peer's pushed changes.
export const handleIncoming = async (
    runtime: SyncRuntime,
    remoteDevice: string,
    entries: SyncChange[]
) => {
    const result = await applyRemoteChanges(runtime.db, entries, runtime.deviceId, remoteDevice);
    const maxSeq = entries.reduce((m, e) => Math.max(m, e.seq || 0), 0);
    // The peer's entries are now consumed by us — advance OUR cursor for that peer
    // only for OUR outbox consumption tracking is not needed here; instead the
    // sender tracks its own push cursor. Nothing else to store.
    return { ok: true, ...result, receivedSeq: maxSeq };
};

// POST /api/sync/ack — peer tells us it consumed our outbox up to seq.
export const handleAck = async (runtime: SyncRuntime, peer: string, seq: number) => {
    await setPeerCursor(runtime.db, peer, seq);
    return { ok: true };
};

// GET /api/sync/conflicts
export const handleListConflicts = async (runtime: SyncRuntime) => {
    const rows = await runtime.db.all(
        "SELECT * FROM SyncConflicts WHERE status = 'pending' ORDER BY createdAt DESC"
    );
    return rows.map((r: any) => ({
        ...r,
        localData: r.localData ? JSON.parse(r.localData) : null,
        remoteData: r.remoteData ? JSON.parse(r.remoteData) : null,
    }));
};

// POST /api/sync/conflicts/:id/resolve { keep: 'local' | 'remote' }
export const handleResolveConflict = (runtime: SyncRuntime, id: string, keep: 'local' | 'remote') =>
    withApplyLock(() => handleResolveConflictInner(runtime, id, keep));

const handleResolveConflictInner = async (runtime: SyncRuntime, id: string, keep: 'local' | 'remote') => {
    const conflict = await runtime.db.get('SELECT * FROM SyncConflicts WHERE id = ?', id) as ConflictRow | undefined;
    if (!conflict) return { ok: false, error: 'not_found' };
    if (conflict.status !== 'pending') return { ok: true, alreadyResolved: true };

    // The "other" device relative to whoever resolves this conflict.
    const otherDevice = conflict.localDevice === runtime.deviceId
        ? conflict.remoteDevice
        : (conflict.remoteDevice === runtime.deviceId ? conflict.localDevice : null);
    const peerCursor = Math.max(
        await getPeerCursor(runtime.db, runtime.peerName),
        otherDevice ? await getPeerCursor(runtime.db, otherDevice) : 0
    );

    if (keep === 'remote') {
        // remoteData === null (SQL NULL) means the remote side deleted the row.
        const remote = conflict.remoteData !== null ? JSON.parse(conflict.remoteData) : null;
        // Apply the remote snapshot as a fresh LOCAL write (triggers ENABLED)
        // so the winning version propagates to the peer like any other change.
        await runtime.db.run('BEGIN IMMEDIATE');
        try {
            // Purge our pending outbox entries for this row first so stale
            // local changes cannot clobber the chosen version.
            await runtime.db.run(
                'DELETE FROM _sync_outbox WHERE tableName = ? AND rowId = ? AND seq > ?',
                conflict.tableName, conflict.rowId, peerCursor
            );
            if (remote === null) {
                await runtime.db.run(`DELETE FROM ${safeIdent(conflict.tableName)} WHERE id = ?`, conflict.rowId);
            } else {
                const cols = await getTableColumns(runtime.db, conflict.tableName);
                const keys = Object.keys(remote).filter((k) => cols.has(k));
                if (keys.length) {
                    const colList = keys.map((k) => safeIdent(k)).join(', ');
                    const placeholders = keys.map(() => '?').join(', ');
                    await runtime.db.run(
                        `INSERT OR REPLACE INTO ${safeIdent(conflict.tableName)} (${colList}) VALUES (${placeholders})`,
                        ...keys.map((k) => remote[k] ?? null)
                    );
                }
            }
            await runtime.db.run(
                "UPDATE SyncConflicts SET status = 'resolved_remote', resolvedAt = datetime('now','localtime') WHERE id = ?",
                id
            );
            await runtime.db.run('COMMIT');
        } catch (err) {
            try { await runtime.db.run('ROLLBACK'); } catch {}
            throw err;
        }
        return { ok: true };
    }

    // keep === 'local' (or remoteData null treated as local win): the local
    // version is already live; just mark resolved. Pending outbox entries
    // propagate it naturally.
    await runtime.db.run(
        "UPDATE SyncConflicts SET status = 'resolved_local', resolvedAt = datetime('now','localtime') WHERE id = ?",
        id
    );
    return { ok: true };
};

// GET /api/sync/status
export const handleSyncStatus = async (runtime: SyncRuntime) => {
    const pending = await runtime.db.get(
        `SELECT COUNT(*) AS c FROM _sync_outbox
         WHERE seq > COALESCE((SELECT MAX(lastSeq) FROM _sync_cursors), 0)`
    );
    const conflicts = await runtime.db.get(
        "SELECT COUNT(*) AS c FROM SyncConflicts WHERE status = 'pending'"
    );
    const meta: Record<string, string | null> = {};
    for (const k of ['lastSyncAt', 'lastSyncError', 'lastPushSeq', 'lastPullSeq']) {
        meta[k] = await getMetaValue(runtime.db, k);
    }
    const cursors = await runtime.db.all('SELECT peer, lastSeq FROM _sync_cursors');
    return {
        deviceId: runtime.deviceId,
        peerUrl: runtime.peerUrl,
        peerName: runtime.peerName,
        pendingChanges: pending?.c ?? 0,
        pendingConflicts: conflicts?.c ?? 0,
        meta,
        cursors,
    };
};

// ---------- Sync worker (runs only where SYNC_PEER_URL is set) ----------

const httpJson = async (url: string, options: RequestInit & { timeoutMs?: number } = {}) => {
    const { timeoutMs = 15000, ...rest } = options;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...rest, signal: controller.signal });
        const text = await res.text();
        let body: any = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = text; }
        return { ok: res.ok, status: res.status, body };
    } finally {
        clearTimeout(t);
    }
};

const authHeaders = (): Record<string, string> => {
    const token = process.env.SYNC_API_TOKEN || process.env.API_TOKEN;
    return token ? { 'x-api-token': token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
};

const cycleRunning = new WeakSet<SyncRuntime>();

export const runSyncCycle = async (runtime: SyncRuntime): Promise<{ pushed: number; pulled: number; conflicts: number; error?: string }> => {
    if (!runtime.peerUrl) return { pushed: 0, pulled: 0, conflicts: 0 };
    if (cycleRunning.has(runtime)) return { pushed: 0, pulled: 0, conflicts: 0, error: 'sync already running' };
    cycleRunning.add(runtime);
    const base = runtime.peerUrl.replace(/\/+$/, '');
    const result = { pushed: 0, pulled: 0, conflicts: 0, error: undefined as string | undefined };

    try {
        // 1) PUSH our pending outbox changes to the peer.
        const lastPushSeq = Number(await getMetaValue(runtime.db, 'lastPushSeq') || '0');
        const { changes: pushChanges, maxSeq: pushMax } = await loadPendingChanges(runtime.db, lastPushSeq);
        if (pushChanges.length > 0) {
            // Chunk large batches — the initial bootstrap can be tens of MB.
            const CHUNK = 150;
            for (let i = 0; i < pushChanges.length; i += CHUNK) {
                const chunk = pushChanges.slice(i, i + CHUNK);
                const res = await httpJson(`${base}/api/sync/incoming`, {
                    method: 'POST',
                    headers: authHeaders(),
                    timeoutMs: 180000,
                    body: JSON.stringify({ device: runtime.deviceId, entries: chunk }),
                });
                if (!res.ok) throw new Error(`push failed: HTTP ${res.status}`);
            }
            await setMetaValue(runtime.db, 'lastPushSeq', String(pushMax));
            await setPeerCursor(runtime.db, runtime.peerName, pushMax);
            result.pushed = pushChanges.length;
        } else {
            await setMetaValue(runtime.db, 'lastPushSeq', String(pushMax));
            if (pushMax > lastPushSeq) await setPeerCursor(runtime.db, runtime.peerName, pushMax);
        }

        // 2) PULL peer's changes since our last cursor.
        const pullCursor = await getMetaValue(runtime.db, 'lastPullSeq') || '0';
        const res = await httpJson(`${base}/api/sync/changes?device=${encodeURIComponent(runtime.deviceId)}&since=${pullCursor}`, {
            method: 'GET',
            headers: authHeaders(),
            timeoutMs: 120000,
        });
        if (!res.ok) throw new Error(`pull failed: HTTP ${res.status}`);
        const body = res.body;
        const remoteChanges: SyncChange[] = Array.isArray(body?.changes) ? body.changes : [];
        const remoteMax = Number(body?.maxSeq || 0);

        if (remoteChanges.length > 0) {
            // Apply with conflict detection against OUR unconsumed local changes.
            const applied = await applyPulledChanges(runtime, remoteChanges);
            result.pulled = applied.applied;
            result.conflicts = applied.conflicts;
        }
        if (remoteMax > Number(pullCursor)) {
            await setMetaValue(runtime.db, 'lastPullSeq', String(remoteMax));
            // Ack to peer so it knows we consumed its outbox up to remoteMax.
            await httpJson(`${base}/api/sync/ack`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ device: runtime.deviceId, seq: remoteMax }),
            }).catch(() => {});
        }

        await setMetaValue(runtime.db, 'lastSyncAt', new Date().toISOString());
        await setMetaValue(runtime.db, 'lastSyncError', '');
        return result;
    } catch (err: any) {
        result.error = err?.message || String(err);
        await setMetaValue(runtime.db, 'lastSyncError', result.error || 'unknown').catch(() => {});
        await setMetaValue(runtime.db, 'lastSyncAt', new Date().toISOString()).catch(() => {});
        return result;
    } finally {
        cycleRunning.delete(runtime);
    }
};

// Apply pulled changes locally with conflict detection (mirror of applyRemoteChanges
// but conflicts recorded against OUR pending outbox).
const applyPulledChanges = async (runtime: SyncRuntime, entries: SyncChange[]) => {
    // Conflict detection inside applyRemoteChanges compares our outbox entries
    // against the peer's consumed cursor (_sync_cursors[peerName]).
    return applyRemoteChanges(runtime.db, entries, runtime.deviceId, runtime.peerName);
};

export const startSyncWorker = (runtime: SyncRuntime, intervalMs = 15000) => {
    if (!runtime.peerUrl) {
        log('[Sync] SYNC_PEER_URL not set — sync worker disabled');
        return;
    }
    log(`[Sync] Worker started → ${runtime.peerUrl} (every ${intervalMs}ms)`);
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const r = await runSyncCycle(runtime);
            if (r.pushed || r.pulled || r.conflicts || r.error) {
                log(`[Sync] cycle: pushed=${r.pushed} pulled=${r.pulled} conflicts=${r.conflicts}${r.error ? ` error=${r.error}` : ''}`);
            }
        } catch (e) {
            log('[Sync] cycle error:', e);
        } finally {
            running = false;
        }
    };
    void tick();
    const timer = setInterval(tick, intervalMs);
    timer.unref?.();
    return timer;
};
