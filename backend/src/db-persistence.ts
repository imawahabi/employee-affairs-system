import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Persists the SQLite database file to durable free storage so the backend
// can run on hosts with ephemeral disks (Render free tier, etc.).
//
// Primary provider: Supabase Storage
//   SUPABASE_URL          e.g. https://xxx.supabase.co
//   SUPABASE_SERVICE_KEY  service_role key (server-side only!)
//   SUPABASE_BUCKET       default "db-backups" (auto-created)
//   DB_BACKUP_OBJECT      default "database.sqlite"
//
// Fallback provider: private GitHub repo
//   DB_PERSIST_GITHUB_REPO / DB_PERSIST_GITHUB_TOKEN / DB_PERSIST_GITHUB_PATH
//
//   DB_BACKUP_INTERVAL_MS default 300000 (5 min)

const LOG_LEVEL = process.env.LOG_LEVEL || 'quiet';
const log = (...args: any[]) => {
    if (LOG_LEVEL !== 'quiet') console.log(...args);
};

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'db-backups';
const SUPABASE_OBJECT = process.env.DB_BACKUP_OBJECT || 'database.sqlite';

const GH_REPO = process.env.DB_PERSIST_GITHUB_REPO || '';
const GH_TOKEN = process.env.DB_PERSIST_GITHUB_TOKEN || '';
const GH_BRANCH = process.env.DB_PERSIST_GITHUB_BRANCH || 'main';
const GH_PATH = process.env.DB_PERSIST_GITHUB_PATH || 'database.sqlite';

const INTERVAL_MS = Number(process.env.DB_BACKUP_INTERVAL_MS || 5 * 60 * 1000);

const useSupabase = () => !!(SUPABASE_URL && SUPABASE_KEY);
export const isPersistenceEnabled = () => useSupabase() || !!(GH_REPO && GH_TOKEN);

const supabaseHeaders = () => ({
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
});

let bucketReady = false;
const ensureBucket = async () => {
    if (bucketReady) return;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'POST',
        headers: { ...supabaseHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: SUPABASE_BUCKET, name: SUPABASE_BUCKET, public: false }),
    });
    // 400/409 = already exists — fine.
    if (res.ok || res.status === 400 || res.status === 409) {
        bucketReady = true;
        return;
    }
    const text = await res.text().catch(() => '');
    throw new Error(`bucket create failed: HTTP ${res.status} ${text.slice(0, 160)}`);
};

// ---------- Supabase provider ----------

const sbRestore = async (dbPath: string): Promise<boolean> => {
    const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURIComponent(SUPABASE_OBJECT)}`,
        { headers: supabaseHeaders() }
    );
    if (res.status === 404 || res.status === 400) {
        log('[DBPersist] No remote backup found — starting fresh');
        return false;
    }
    if (!res.ok) {
        log(`[DBPersist] Supabase restore failed: HTTP ${res.status}`);
        return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) {
        log('[DBPersist] Remote backup suspiciously small — skipping');
        return false;
    }
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const tmp = `${dbPath}.restore.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dbPath);
    log(`[DBPersist] Restored database (${buf.length} bytes) from Supabase Storage`);
    return true;
};

const sbUpload = async (filePath: string): Promise<boolean> => {
    await ensureBucket();
    const buf = fs.readFileSync(filePath);
    if (buf.length < 100) return false;
    const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURIComponent(SUPABASE_OBJECT)}`,
        {
            method: 'POST',
            headers: { ...supabaseHeaders(), 'x-upsert': 'true', 'Content-Type': 'application/octet-stream' },
            body: buf,
        }
    );
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`supabase upload failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return true;
};

// ---------- GitHub provider (fallback) ----------

const ghHeaders = () => ({
    Authorization: `Bearer ${GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'moi-employee-backend',
});
const ghApiBase = () => `https://api.github.com/repos/${GH_REPO}`;

const ghRestore = async (dbPath: string): Promise<boolean> => {
    const res = await fetch(`${ghApiBase()}/contents/${encodeURIComponent(GH_PATH)}?ref=${encodeURIComponent(GH_BRANCH)}`, {
        headers: { ...ghHeaders(), Accept: 'application/vnd.github.raw+json' },
    });
    if (res.status === 404) return false;
    if (!res.ok) {
        log(`[DBPersist] GH restore failed: HTTP ${res.status}`);
        return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return false;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const tmp = `${dbPath}.restore.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dbPath);
    log(`[DBPersist] Restored database (${buf.length} bytes) from GitHub`);
    return true;
};

const ghUpload = async (filePath: string): Promise<boolean> => {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 100) return false;
    const metaRes = await fetch(`${ghApiBase()}/contents/${encodeURIComponent(GH_PATH)}?ref=${encodeURIComponent(GH_BRANCH)}`, {
        headers: ghHeaders(),
    });
    let sha: string | null = null;
    if (metaRes.ok) {
        const meta = await metaRes.json();
        sha = meta?.sha || null;
    } else if (metaRes.status !== 404) {
        throw new Error(`sha lookup failed: HTTP ${metaRes.status}`);
    }
    const body: any = {
        message: `db backup ${new Date().toISOString()}`,
        content: buf.toString('base64'),
        branch: GH_BRANCH,
    };
    if (sha) body.sha = sha;
    const res = await fetch(`${ghApiBase()}/contents/${encodeURIComponent(GH_PATH)}`, {
        method: 'PUT',
        headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`GH upload failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return true;
};

// ---------- Shared ----------

// Download the remote DB into dbPath. Returns true if a DB was restored.
export const restoreDatabaseFromGitHub = async (dbPath: string): Promise<boolean> => {
    if (!isPersistenceEnabled()) return false;
    try {
        return useSupabase() ? await sbRestore(dbPath) : await ghRestore(dbPath);
    } catch (e: any) {
        log(`[DBPersist] Restore error: ${e?.message || e}`);
        return false;
    }
};

const uploadDatabase = async (dbPath: string): Promise<boolean> => {
    return useSupabase() ? await sbUpload(dbPath) : await ghUpload(dbPath);
};

// Copy a consistent snapshot of the live DB via SQLite's VACUUM INTO.
const snapshotDatabase = async (srcPath: string, destPath: string) => {
    const { open } = await import('sqlite');
    const sqlite3 = (await import('sqlite3')).default;
    const src = await open({ filename: srcPath, driver: sqlite3.Database });
    try {
        const safeDest = destPath.replace(/'/g, "''");
        await src.exec(`VACUUM INTO '${safeDest}'`);
    } finally {
        await src.close();
    }
};

let lastUploadedMtime = 0;
let lastUploadedHash = '';
let timer: NodeJS.Timeout | null = null;
let running = false;

const tick = async (dbPath: string) => {
    if (running) return;
    running = true;
    try {
        if (!fs.existsSync(dbPath)) return;
        const stat = fs.statSync(dbPath);
        if (stat.mtimeMs === lastUploadedMtime) return;

        const snapPath = `${dbPath}.snapshot`;
        await snapshotDatabase(dbPath, snapPath);
        const snapStat = fs.statSync(snapPath);
        const hash = crypto.createHash('sha1').update(fs.readFileSync(snapPath)).digest('hex');
        if (hash === lastUploadedHash) {
            fs.unlinkSync(snapPath);
            lastUploadedMtime = stat.mtimeMs;
            return;
        }
        const ok = await uploadDatabase(snapPath);
        fs.unlinkSync(snapPath);
        if (ok) {
            lastUploadedHash = hash;
            lastUploadedMtime = stat.mtimeMs;
            log(`[DBPersist] Backup uploaded (${snapStat.size} bytes)`);
        }
    } catch (e: any) {
        log(`[DBPersist] Backup error: ${e?.message || e}`);
    } finally {
        running = false;
    }
};

export const startDatabasePersistence = (dbPath: string) => {
    if (!isPersistenceEnabled()) {
        log('[DBPersist] Disabled (no SUPABASE_* or DB_PERSIST_GITHUB_* env vars)');
        return;
    }
    log(`[DBPersist] Enabled → ${useSupabase() ? `Supabase:${SUPABASE_BUCKET}/${SUPABASE_OBJECT}` : `GitHub:${GH_REPO}/${GH_PATH}`} every ${INTERVAL_MS}ms`);
    // Prime mtime/hash so we don't upload immediately on boot.
    try {
        if (fs.existsSync(dbPath)) {
            lastUploadedMtime = fs.statSync(dbPath).mtimeMs;
            lastUploadedHash = crypto.createHash('sha1').update(fs.readFileSync(dbPath)).digest('hex');
        }
    } catch {}
    timer = setInterval(() => void tick(dbPath), INTERVAL_MS);
    timer.unref?.();
    // Best-effort final backup on shutdown.
    const shutdown = () => {
        try {
            const snapPath = `${dbPath}.snapshot`;
            void snapshotDatabase(dbPath, snapPath)
                .then(() => uploadDatabase(snapPath))
                .then(() => { try { fs.unlinkSync(snapPath); } catch {} })
                .catch(() => {});
        } catch {}
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('beforeExit', shutdown);
};
