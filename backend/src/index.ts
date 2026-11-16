import express from 'express';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { initializeDatabase } from './init-db';
import { startAlertScheduler, checkAndCreateAlerts } from './alert-service';
import { alertEvents } from './alert-events';
import { computeExtensionStatusForEmployee, diffInDays, getTodayUtc, parseDateOnly } from './professional-extension-utils';

dotenv.config();

const LOG_LEVEL = process.env.LOG_LEVEL || 'quiet';
const SETTINGS_UPDATE_PASSWORD = process.env.SETTINGS_UPDATE_PASSWORD || 'darin123';
const log = (...args: any[]) => {
    if (LOG_LEVEL !== 'quiet') console.log(...args);
};

const app = express();

app.use(cors());
app.use(express.json({ limit: '75mb' }));

const wordUploadRawParser = express.raw({
    type: [
        'application/octet-stream',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ],
    limit: '250mb'
});

const licenseImportRawParser = express.raw({
    type: [
        'application/octet-stream',
        'application/json',
        'application/x-sqlite3',
        'application/vnd.sqlite3'
    ],
    limit: '250mb'
});

const DATA_DIR = process.env.DATA_DIR || process.cwd();
log(`[Server] Using DATA_DIR: ${DATA_DIR}`);
log(`[Server] Current working directory: ${process.cwd()}`);

// Ensure DATA_DIR exists
if (!fs.existsSync(DATA_DIR)) {
    log(`[Server] Creating directory: ${DATA_DIR}`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, 'database.sqlite');
log(`[Server] Database path: ${dbPath}`);

const lockPath = path.join(DATA_DIR, 'database.lock');
const LOCK_STALE_MS = Number(process.env.LOCK_STALE_MS || 2 * 60 * 1000);
let lockHeartbeat: NodeJS.Timeout | null = null;

type LockInfo = {
    pid: number;
    startedAt: string;
    lastSeen?: string;
    appInstance?: string;
    dataDir?: string;
    dbPath?: string;
};

const readLockInfo = (): LockInfo | null => {
    try {
        const raw = fs.readFileSync(lockPath, 'utf-8');
        return JSON.parse(raw) as LockInfo;
    } catch {
        return null;
    }
};

const isProcessAlive = (pid?: number | null) => {
    if (!pid || Number.isNaN(pid)) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error: any) {
        if (error?.code === 'ESRCH') return false;
        return true;
    }
};

const writeLockFile = () => {
    const now = new Date().toISOString();
    const info: LockInfo = {
        pid: process.pid,
        startedAt: now,
        lastSeen: now,
        appInstance: process.env.APP_INSTANCE || 'backend',
        dataDir: DATA_DIR,
        dbPath
    };
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, JSON.stringify(info));
    fs.closeSync(fd);
    return info;
};

const updateLockHeartbeat = () => {
    try {
        const existing = readLockInfo();
        if (!existing || existing.pid !== process.pid) return;
        const updated: LockInfo = {
            ...existing,
            lastSeen: new Date().toISOString(),
        };
        fs.writeFileSync(lockPath, JSON.stringify(updated));
    } catch (error) {
        log('[Lock] Failed to update heartbeat:', error);
    }
};

const startLockHeartbeat = () => {
    if (lockHeartbeat) return;
    updateLockHeartbeat();
    lockHeartbeat = setInterval(updateLockHeartbeat, 30_000);
    lockHeartbeat.unref?.();
};

const stopLockHeartbeat = () => {
    if (!lockHeartbeat) return;
    clearInterval(lockHeartbeat);
    lockHeartbeat = null;
};

const acquireDatabaseLock = () => {
    try {
        writeLockFile();
        log(`[Lock] Acquired database lock at ${lockPath}`);
        startLockHeartbeat();
        return true;
    } catch (error: any) {
        if (error?.code !== 'EEXIST') {
            console.error('[Lock] Failed to create lock:', error);
            return false;
        }

        const existing = readLockInfo();
        const lastSeen = existing?.lastSeen || existing?.startedAt;
        const lastSeenTime = lastSeen ? Date.parse(lastSeen) : NaN;
        const isStale = Number.isFinite(lastSeenTime) ? (Date.now() - lastSeenTime) > LOCK_STALE_MS : false;
        if (existing?.pid && isProcessAlive(existing.pid) && !isStale) {
            console.error(`[Lock] Database is already in use by ${existing.appInstance || 'another instance'} (pid: ${existing.pid}).`);
            console.error('[Lock] Close the other app before starting this one.');
            return false;
        }
        if (isStale) {
            console.warn(`[Lock] Detected stale lock (last seen ${lastSeen}). Cleaning up.`);
        }

        try {
            fs.unlinkSync(lockPath);
        } catch (removeError) {
            console.error('[Lock] Failed to remove stale lock:', removeError);
            return false;
        }

        try {
            writeLockFile();
            log(`[Lock] Acquired database lock at ${lockPath}`);
            startLockHeartbeat();
            return true;
        } catch (retryError) {
            console.error('[Lock] Failed to acquire lock after cleanup:', retryError);
            return false;
        }
    }
};

const releaseDatabaseLock = () => {
    try {
        if (!fs.existsSync(lockPath)) return;
        const existing = readLockInfo();
        if (!existing || existing.pid === process.pid) {
            fs.unlinkSync(lockPath);
            log('[Lock] Released database lock');
        }
        stopLockHeartbeat();
    } catch (error) {
        console.error('[Lock] Failed to release database lock:', error);
    }
};

process.on('exit', () => {
    releaseDatabaseLock();
});

type BackupResult =
    | { status: 'missing' }
    | { status: 'failed'; error: unknown }
    | { status: 'created'; backupFilename: string; backupPath: string; timestamp: string };

const buildBackupName = (now = new Date()) => {
    const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('Z', '');
    return `database_backup_${timestamp}.sqlite`;
};

const createDatabaseBackup = (): BackupResult => {
    if (!fs.existsSync(dbPath)) {
        return { status: 'missing' };
    }

    const backupsDir = path.join(DATA_DIR, 'backups');
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }

    const now = new Date();
    const backupFilename = buildBackupName(now);
    const backupPath = path.join(backupsDir, backupFilename);

    try {
        fs.copyFileSync(dbPath, backupPath);
        log(`[Backup] Created: ${backupFilename}`);
        return { status: 'created', backupFilename, backupPath, timestamp: now.toISOString() };
    } catch (error) {
        console.error('[Backup] Failed to create backup:', error);
        return { status: 'failed', error };
    }
};

// One-time migration: if database is missing in DATA_DIR, try to copy from legacy locations
try {
    if (!fs.existsSync(dbPath)) {
        const isWin = process.platform === 'win32';
        const localAppData = isWin ? process.env.LOCALAPPDATA : undefined;
        const legacyCandidates: string[] = [];

        // Old Electron app folder (based on previous app.getName())
        if (localAppData) {
            legacyCandidates.push(path.join(localAppData, 'vite-react-typescript-starter', 'database.sqlite'));
        }
        // Project-level legacy paths
        legacyCandidates.push(path.join(process.cwd(), 'backend', 'database.sqlite'));
        legacyCandidates.push(path.join(process.cwd(), 'database.sqlite'));

        const legacySource = legacyCandidates.find(p => fs.existsSync(p));
        if (legacySource) {
            log(`[Migration] Found legacy database at: ${legacySource}`);
            try {
                fs.copyFileSync(legacySource, dbPath);
                log(`[Migration] Copied legacy database to: ${dbPath}`);
            } catch (copyErr) {
                console.error(`[Migration] Failed to copy legacy database from ${legacySource} to ${dbPath}:`, copyErr);
            }
        } else {
            log('[Migration] No legacy database found. A new database will be initialized in DATA_DIR if needed.');
        }
    }
} catch (mErr) {
    console.error('[Migration] Unexpected error during migration check:', mErr);
}

log(`[Server] Database file exists: ${fs.existsSync(dbPath)}`);

async function getDb() {
    log(`[DB] Opening database connection to: ${dbPath}`);
    try {
        const db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });
        log('[DB] Database connection successful');
        return db;
    } catch (error) {
        console.error('[DB] Failed to open database:', error);
        throw error;
    }
}

const parseExtensionReminderDays = (rawValue: string | undefined, fallback: number[]): number[] => {
    if (!rawValue) return fallback;
    const parsed = rawValue
        .split(/[,\\s]+/)
        .map((val) => parseInt(val, 10))
        .filter((num) => Number.isFinite(num) && num > 0);
    const unique = Array.from(new Set(parsed));
    return unique.length ? unique.sort((a, b) => b - a) : fallback;
};

const OFFICER_RANKS = [
    'لواء',
    'عميد',
    'عقيد',
    'مقدم',
    'رائد',
    'نقيب',
    'ملازم أول',
    'ملازم',
];

const NCO_RANKS = [
    'و.أ.ضابط',
    'و.ضابط',
    'رقيب أول',
    'رقيب',
    'عريف',
    'و.عريف',
    'شرطي',
];

const normalizeRankName = (value: string) => value
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .replace(/[^\u0600-\u06FF0-9a-z\\s]/gi, ' ')
    .replace(/\\s+/g, ' ')
    .trim();

const buildRankMap = (ranks: string[]) => ranks.map((name, index) => {
    const normalized = normalizeRankName(name);
    return {
        normalized,
        compact: normalized.replace(/\\s+/g, ''),
        order: index + 1,
    };
});

const OFFICER_RANK_MAP = buildRankMap(OFFICER_RANKS);
const NCO_RANK_MAP = buildRankMap(NCO_RANKS);

const findRankOrder = (rankName: string, map: { normalized: string; compact: string; order: number }[]) => {
    const normalized = normalizeRankName(rankName);
    const compact = normalized.replace(/\\s+/g, '');
    for (const item of map) {
        if (!item.normalized) continue;
        if (normalized.includes(item.normalized) || compact.includes(item.compact)) {
            return item.order;
        }
    }
    return Number.MAX_SAFE_INTEGER;
};

const getRankOrder = (rankName: string, category: string) => {
    if (category === 'ضباط') {
        return findRankOrder(rankName, OFFICER_RANK_MAP);
    }
    if (category === 'ضباط صف') {
        return findRankOrder(rankName, NCO_RANK_MAP);
    }
    return Number.MAX_SAFE_INTEGER;
};

const CATEGORY_OPTIONS = ['ضباط', 'ضباط صف', 'مهنيين', 'مدنيين'];
const DEFAULT_CATEGORY = 'ضباط';
const PROFESSIONAL_GROUP_OPTIONS = ['طباع', 'سائق', 'فراش', 'أخرى'];

const normalizeText = (value: any) => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
};

const normalizeOptionalText = (value: any) => {
    const trimmed = normalizeText(value);
    return trimmed ? trimmed : null;
};

const buildFullEmployeeName = (parts: {
    firstName?: any;
    secondName?: any;
    thirdName?: any;
    fourthName?: any;
    familyName?: any;
}) => [
    normalizeText(parts.firstName),
    normalizeText(parts.secondName),
    normalizeText(parts.thirdName),
    normalizeText(parts.fourthName),
    normalizeText(parts.familyName)
].filter(Boolean).join(' ');

const splitEmployeeName = (value: any) => {
    const tokens = normalizeText(value).split(/\s+/).filter(Boolean);
    if (!tokens.length) {
        return { firstName: null, secondName: null, thirdName: null, fourthName: null, familyName: null };
    }

    return {
        firstName: normalizeOptionalText(tokens[0]),
        secondName: normalizeOptionalText(tokens[1]),
        thirdName: tokens.length > 3 ? normalizeOptionalText(tokens[2]) : null,
        fourthName: tokens.length > 4 ? normalizeOptionalText(tokens.slice(3, -1).join(' ')) : null,
        familyName: tokens.length > 1 ? normalizeOptionalText(tokens[tokens.length - 1]) : null
    };
};

const resolveEmployeeNameParts = (
    input: Record<string, any>,
    fallbackName?: any,
    existingParts?: Record<string, any>
) => {
    const hasAnyPart = ['firstName', 'secondName', 'thirdName', 'fourthName', 'familyName']
        .some((key) => input[key] !== undefined && normalizeText(input[key]));
    const fallbackParts = existingParts && (normalizeText(existingParts.firstName) || normalizeText(existingParts.familyName))
        ? {
            firstName: normalizeOptionalText(existingParts.firstName),
            secondName: normalizeOptionalText(existingParts.secondName),
            thirdName: normalizeOptionalText(existingParts.thirdName),
            fourthName: normalizeOptionalText(existingParts.fourthName),
            familyName: normalizeOptionalText(existingParts.familyName)
        }
        : splitEmployeeName(fallbackName);
    const parts = hasAnyPart
        ? {
            firstName: input.firstName !== undefined ? normalizeOptionalText(input.firstName) : (fallbackParts.firstName ?? null),
            secondName: input.secondName !== undefined ? normalizeOptionalText(input.secondName) : (fallbackParts.secondName ?? null),
            thirdName: input.thirdName !== undefined ? normalizeOptionalText(input.thirdName) : (fallbackParts.thirdName ?? null),
            fourthName: input.fourthName !== undefined ? normalizeOptionalText(input.fourthName) : (fallbackParts.fourthName ?? null),
            familyName: input.familyName !== undefined ? normalizeOptionalText(input.familyName) : (fallbackParts.familyName ?? null)
        }
        : splitEmployeeName(input.name !== undefined ? input.name : fallbackName);
    const fullName = buildFullEmployeeName(parts) || normalizeText(input.name) || normalizeText(fallbackName) || 'غير محدد';
    return { ...parts, fullName };
};

const ensureEmployeeManualOrderColumn = async (db: any) => {
    const employeeColumns = await db.all('PRAGMA table_info(Employees);');
    const hasManualOrder = employeeColumns.some((col: any) => col.name === 'manualOrder');
    if (!hasManualOrder) {
        await db.exec('ALTER TABLE Employees ADD COLUMN manualOrder INTEGER');
    }
};

const normalizeProfessionalText = (value: any) => {
    if (value === undefined || value === null) return '';
    return String(value)
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[إأآٱ]/g, 'ا')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/ء/g, '')
        .replace(/\s+/g, ' ')
        .trim();
};

const normalizeJobTitleForGroup = (value: any) =>
    normalizeProfessionalText(value).replace(/[^\u0600-\u06FF0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const inferProfessionalGroupFromJobTitle = (value: any) => {
    const title = normalizeJobTitleForGroup(value || '');
    if (!title) return null;
    const has = (token: string) => title.includes(normalizeJobTitleForGroup(token));
    if (['سائق', 'مندوب', 'مراسل'].some(has)) return 'سائق';
    if (['فراش', 'عامل'].some(has)) return 'فراش';
    if ([
        'طباع',
        'مدخل بيانات',
        'مدخل البيانات',
        'مسجل بيانات',
        'مسجل البيانات',
        'باحث',
        'اداري',
        'اجتماعي',
        'مصحح لغوي',
        'صائغ برامج'
    ].some(has)) {
        return 'طباع';
    }
    return 'أخرى';
};

const isGovernmentiNationality = (value: any) => {
    const trimmed = normalizeText(value);
    if (!trimmed) return false;
    const normalized = trimmed.replace(/\s+/g, '').toLowerCase();
    return normalized.includes('كويت') || normalized.includes('kuwait');
};

const normalizeOrgName = (value: any) => {
    const trimmed = normalizeText(value);
    if (!trimmed) return '';
    return trimmed
        .replace(/\s+/g, ' ')
        .replace(/^(?:ال)?(?:إدارة|ادارة|قسم)\s*[:：-]?\s*/u, '')
        .trim();
};

type DepartmentRestriction = {
    enabled: boolean;
    departmentName: string;
    departmentKey: string;
};

const loadDepartmentRestriction = async (db: any): Promise<DepartmentRestriction> => {
    const rows = await db.all(
        "SELECT key, value FROM Settings WHERE key IN ('restrict_to_department', 'restricted_department_name')"
    );
    const map: Record<string, string> = {};
    (rows || []).forEach((row: any) => {
        map[String(row.key)] = String(row.value ?? '');
    });
    const enabled = map.restrict_to_department === 'true';
    const departmentName = (map.restricted_department_name || '').trim();
    const departmentKey = normalizeOrgName(departmentName);
    return { enabled, departmentName, departmentKey };
};

const isDepartmentAllowed = (departmentValue: any, restriction: DepartmentRestriction) => {
    if (!restriction.enabled) return true;
    if (!restriction.departmentKey) return true;
    const currentKey = normalizeOrgName(departmentValue);
    return currentKey === restriction.departmentKey;
};

const normalizeCategory = (value: any) => {
    const trimmed = normalizeText(value);
    return CATEGORY_OPTIONS.includes(trimmed) ? trimmed : '';
};

const normalizeProfessionalGroup = (value: any) => {
    const trimmed = normalizeText(value);
    if (!trimmed) return null;
    if (trimmed === 'اخرى') return 'أخرى';
    if (trimmed === 'طباعين' || trimmed === 'الطباعين') return 'طباع';
    if (trimmed === 'سائقين' || trimmed === 'السائقين') return 'سائق';
    if (trimmed === 'فراشين' || trimmed === 'الفراشين') return 'فراش';
    return PROFESSIONAL_GROUP_OPTIONS.includes(trimmed) ? trimmed : null;
};

const getCategoryOrDefault = (value: any, fallback = DEFAULT_CATEGORY) => {
    const normalized = normalizeCategory(value);
    return normalized || fallback;
};

const getDefaultRankName = (category: string) => {
    if (category === 'ضباط') return 'ملازم';
    if (category === 'ضباط صف') return 'شرطي';
    if (category === 'مدنيين') return 'مدني';
    if (category === 'مهنيين') return 'مهني';
    return 'ملازم';
};

const ensureRank = async (db: any, name: string, category: string) => {
    const existing = await db.get('SELECT id FROM Ranks WHERE name = ? LIMIT 1', [name]);
    if (existing) return;
    const derivedOrder = getRankOrder(name, category);
    const orderValue = derivedOrder === Number.MAX_SAFE_INTEGER ? 999 : derivedOrder;
    const newId = `rank_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await db.run('INSERT INTO Ranks (id, name, category, "order") VALUES (?, ?, ?, ?)', [
        newId,
        name,
        category,
        orderValue
    ]);
};

const resolveRank = async (db: any, category: string, requestedRank: any) => {
    const trimmed = normalizeText(requestedRank);
    if (trimmed) {
        const existing = await db.get('SELECT name FROM Ranks WHERE name = ? LIMIT 1', [trimmed]);
        if (existing?.name) return existing.name;
        await ensureRank(db, trimmed, category);
        return trimmed;
    }

    const fallback = await db.get(
        'SELECT name FROM Ranks WHERE category = ? ORDER BY "order" ASC LIMIT 1',
        [category]
    );
    if (fallback?.name) return fallback.name;

    const defaultRank = getDefaultRankName(category);
    await ensureRank(db, defaultRank, category);
    return defaultRank;
};

const resolveDepartment = async (db: any, requestedDepartment: any) => {
    const trimmed = normalizeText(requestedDepartment);
    if (!trimmed) return '';

    const existing = await db.get('SELECT name FROM Departments WHERE name = ? LIMIT 1', [trimmed]);
    if (existing?.name) return existing.name;

    const normalized = normalizeOrgName(trimmed);
    if (normalized) {
        const allDepartments = await db.all('SELECT name FROM Departments');
        const matched = allDepartments.find((dep: { name: string }) => normalizeOrgName(dep.name) === normalized);
        if (matched?.name) return matched.name;
    }

    const newId = `dep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await db.run('INSERT INTO Departments (id, name) VALUES (?, ?)', [newId, trimmed]);
    return trimmed;
};

const normalizeDateOnly = (value: any) => {
    const trimmed = normalizeText(value);
    if (!trimmed) return null;
    const parsed = parseDateOnly(trimmed);
    if (parsed) return trimmed;
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
};

const formatAuditValue = (value: any, formatter?: (value: any) => string | null) => {
    if (formatter) return formatter(value);
    if (value === undefined || value === null || value === '') return null;
    return String(value);
};

const formatYesNo = (value: any) => {
    if (value === undefined || value === null || value === '') return null;
    const normalized = value === true || value === 1 || value === '1';
    return normalized ? 'نعم' : 'لا';
};

const formatStatusLabel = (value: any) => {
    const trimmed = normalizeText(value);
    if (!trimmed) return null;
    if (trimmed === 'active') return 'في الخدمة';
    if (trimmed === 'inactive') return 'خارج الخدمة';
    return trimmed;
};

const formatGenderLabel = (value: any) => {
    const trimmed = normalizeText(value);
    if (!trimmed) return null;
    if (trimmed === 'male') return 'ذكر';
    if (trimmed === 'female') return 'أنثى';
    return trimmed;
};

const mapLicenseCategory = (value: any) => {
    const trimmed = normalizeText(value);
    if (trimmed === 'ضباط') return 'ضابط';
    if (trimmed === 'ضباط صف') return 'ضابط صف';
    if (trimmed === 'مهنيين') return 'مهني';
    if (trimmed === 'مدنيين') return 'مدني';
    return trimmed;
};

const mapEmployeeCategoryFromLicense = (value: any) => {
    const trimmed = normalizeText(value);
    if (trimmed === 'ضابط') return 'ضباط';
    if (trimmed === 'ضابط صف') return 'ضباط صف';
    if (trimmed === 'مهني') return 'مهنيين';
    if (trimmed === 'مدني') return 'مدنيين';
    return trimmed;
};

const insertAuditLog = async (db: any, entry: {
    entityType: string;
    entityId: string;
    action: string;
    field?: string | null;
    oldValue?: string | null;
    newValue?: string | null;
    message?: string | null;
    metadata?: Record<string, any> | null;
}) => {
    const id = `audit_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await db.run(
        `INSERT INTO AuditLog (id, entityType, entityId, action, field, oldValue, newValue, message, metadata, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
        [
            id,
            entry.entityType,
            entry.entityId,
            entry.action,
            entry.field ?? null,
            entry.oldValue ?? null,
            entry.newValue ?? null,
            entry.message ?? null,
            entry.metadata ? JSON.stringify(entry.metadata) : null
        ]
    );
};

const safeInsertAuditLog = async (db: any, entry: {
    entityType: string;
    entityId: string;
    action: string;
    field?: string | null;
    oldValue?: string | null;
    newValue?: string | null;
    message?: string | null;
    metadata?: Record<string, any> | null;
}) => {
    try {
        await insertAuditLog(db, entry);
    } catch (error) {
        console.error('Error writing audit log:', error);
    }
};

const buildAuditChanges = (
    before: Record<string, any>,
    after: Record<string, any>,
    fields: { key: string; label: string; formatter?: (value: any) => string | null }[]
) => {
    return fields.reduce((changes, field) => {
        const previousValue = formatAuditValue(before[field.key], field.formatter);
        const nextValue = formatAuditValue(after[field.key], field.formatter);
        if (previousValue !== nextValue) {
            changes.push({
                field: field.key,
                label: field.label,
                oldValue: previousValue,
                newValue: nextValue
            });
        }
        return changes;
    }, [] as { field: string; label: string; oldValue: string | null; newValue: string | null }[]);
};

const EMPLOYEE_AUDIT_FIELDS = [
    { key: 'fileNumber', label: 'رقم الملف' },
    { key: 'name', label: 'الاسم' },
    { key: 'category', label: 'الفئة' },
    { key: 'rank', label: 'الرتبة' },
    { key: 'jobTitle', label: 'المسمى الوظيفي' },
    { key: 'jobGrade', label: 'الدرجة الوظيفية' },
    { key: 'professionalGroup', label: 'تصنيف المهنيين' },
    { key: 'department', label: 'الإدارة' },
    { key: 'section', label: 'القسم' },
    { key: 'status', label: 'الحالة', formatter: formatStatusLabel },
    { key: 'reasonIfInactive', label: 'سبب خارج الخدمة' },
    { key: 'inactiveDate', label: 'تاريخ خارج الخدمة' },
    { key: 'phone_number', label: 'رقم الهاتف' },
    { key: 'referenceNumber', label: 'رقم المرجع' },
    { key: 'civilId', label: 'الرقم المدني' },
    { key: 'birthDate', label: 'تاريخ الميلاد' },
    { key: 'nationality', label: 'الجنسية' },
    { key: 'nationalityArticleNumber', label: 'رقم مادة الجنسية' },
    { key: 'nationalityIssueDate', label: 'تاريخ إصدار الجنسية' },
    { key: 'maritalStatus', label: 'الحالة الاجتماعية' },
    { key: 'maritalStatusNote', label: 'ملاحظة الحالة الاجتماعية' },
    { key: 'appointmentDecisionNumber', label: 'رقم قرار التعيين' },
    { key: 'appointmentDecisionDate', label: 'تاريخ قرار التعيين' },
    { key: 'gender', label: 'الجنس', formatter: formatGenderLabel },
    { key: 'hasEducationCertificate', label: 'شهادة دراسية', formatter: formatYesNo },
    { key: 'educationCertificateType', label: 'نوع الشهادة' },
    { key: 'educationSpecialization', label: 'تخصص المؤهل الدراسي' },
    { key: 'militaryNumber', label: 'الرقم العسكري' },
    { key: 'hiringDate', label: 'تاريخ التعيين' },
    { key: 'seniorityNumber', label: 'رقم الأقدمية' },
    { key: 'hasWeapon', label: 'يحمل سلاح', formatter: formatYesNo },
    { key: 'weaponAttachments', label: 'ملحقات السلاح' },
    { key: 'hasParking', label: 'موقف سيارة', formatter: formatYesNo },
    { key: 'parkingLocation', label: 'موقع الموقف' },
    { key: 'parkingNumber', label: 'رقم الموقف' },
    { key: 'includeInShifts', label: 'مشارك في الخفارات', formatter: formatYesNo },
    { key: 'shiftNotes', label: 'ملاحظات الخفارات' },
    { key: 'excludeFromStatistics', label: 'مستثنى من الإحصائيات', formatter: formatYesNo },
    { key: 'secondmentLocation', label: 'منتدب من خارج الإدارة العامة' }
];

type ForceWordRow = {
    tableIndex: number;
    headers: string[];
    cells: string[];
    headerRowIndex?: number;
    rowIndex?: number;
};

type ForceSourceEmployee = {
    sourceId: string;
    category: string;
    name: string;
    rank?: string | null;
    fileNumber?: string | null;
    militaryNumber?: string | null;
    referenceNumber?: string | null;
    civilId?: string | null;
    birthDate?: string | null;
    nationality?: string | null;
    nationalityArticleNumber?: string | null;
    nationalityIssueDate?: string | null;
    maritalStatus?: string | null;
    maritalStatusNote?: string | null;
    appointmentDecisionNumber?: string | null;
    appointmentDecisionDate?: string | null;
    gender?: string | null;
    jobTitle?: string | null;
    jobGrade?: string | null;
    educationCertificateType?: string | null;
    educationSpecialization?: string | null;
    phone_number?: string | null;
    hiringDate?: string | null;
    seniorityNumber?: string | null;
    hasWeapon?: boolean | null;
    weaponAttachments?: string | null;
    hasParking?: boolean | null;
    parkingLocation?: string | null;
    parkingNumber?: string | null;
    includeInShifts?: boolean | null;
    shiftNotes?: string | null;
    excludeFromStatistics?: boolean | null;
    isSecondedOutsideGeneralAdministration?: boolean | null;
    secondmentLocation?: string | null;
    rawDepartmentText?: string | null;
    department?: string | null;
    section?: string | null;
    tableIndex: number;
    rowNumber: number;
};

type ForceSyncProposal = {
    id: string;
    action: 'create' | 'update';
    reason: 'missing_employee' | 'missing_field' | 'different_field';
    employeeId?: string;
    employeeName: string;
    category: string;
    matchedBy?: string | null;
    field?: string;
    label?: string;
    currentValue?: any;
    suggestedValue?: any;
    sourceValue?: any;
    sourceEmployee: ForceSourceEmployee;
    payload?: Record<string, any>;
    options?: Array<{ value: string; label: string; departmentId?: string }>;
    sectionOptions?: Array<{ value: string; label: string; departmentId?: string }>;
    warning?: string | null;
    confidence?: number;
    reviewRequired?: boolean;
    matchDetails?: string[];
    sourceRawValue?: any;
};

type ForceSyncWarning = {
    id: string;
    severity: 'warning' | 'error';
    employeeName: string;
    message: string;
};

const FORCE_FIELD_LABELS: Record<string, string> = {
    name: 'الاسم',
    category: 'الفئة',
    rank: 'الرتبة',
    fileNumber: 'رقم الملف',
    militaryNumber: 'الرقم العسكري',
    referenceNumber: 'رقم المرجع',
    civilId: 'الرقم المدني',
    birthDate: 'تاريخ الميلاد',
    nationality: 'الجنسية',
    nationalityArticleNumber: 'رقم مادة الجنسية',
    nationalityIssueDate: 'تاريخ إصدار الجنسية',
    maritalStatus: 'الحالة الاجتماعية',
    maritalStatusNote: 'ملاحظة الحالة الاجتماعية',
    appointmentDecisionNumber: 'رقم قرار التعيين',
    appointmentDecisionDate: 'تاريخ قرار التعيين',
    gender: 'النوع',
    jobTitle: 'المسمى الوظيفي',
    jobGrade: 'الدرجة الوظيفية',
    educationCertificateType: 'المؤهل العلمي',
    hasEducationCertificate: 'لديه شهادة دراسية',
    educationSpecialization: 'تخصص المؤهل الدراسي',
    hiringDate: 'تاريخ التعيين',
    seniorityNumber: 'رقم الأقدمية',
    department: 'الإدارة',
    section: 'القسم',
    phone_number: 'رقم الهاتف',
    hasWeapon: 'هل لديه سلاح',
    weaponAttachments: 'ملحقات السلاح',
    hasParking: 'هل لديه موقف سيارة',
    parkingLocation: 'موقع الموقف',
    parkingNumber: 'رقم الموقف',
    includeInShifts: 'يدرج في الخفارات',
    shiftNotes: 'ملاحظات الخفارات',
    excludeFromStatistics: 'مستثنى من الإحصائيات',
    isSecondedOutsideGeneralAdministration: 'منتدب من خارج الإدارة العامة',
    secondmentLocation: 'جهة الندب',
    manualOrder: 'ترتيب كشف Word'
};

const FORCE_JOB_GRADE_OPTIONS = ['الأولى أ', 'الأولى', 'الأولى ب', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'العقد الثاني'];
const FORCE_EDUCATION_OPTIONS = ['بدون شهادة', 'متوسط', 'ثانوية عامة', 'دبلوم', 'جامعي', 'ماجستير', 'دكتوراه'];
const FORCE_MARITAL_STATUS_OPTIONS = ['متزوج', 'أعزب', 'أخرى'];
const FORCE_GENDER_OPTIONS = ['ذكر', 'أنثى'];
const FORCE_NATIONALITY_ARTICLE_OPTIONS = ['أولى', 'ثانية', 'ثالثة', 'رابعة', 'خامسة', 'سادسة', 'سابعة', 'ثامنة', 'غير محدد'];

const normalizeForceMatchText = (value: any) => {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[إأآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/ـ/g, '')
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/[^0-9a-z\u0600-\u06FF]+/g, ' ')
        .replace(/\b(?:اداره|قسم)\b/g, '')
        .replace(/\b(?:رئيس|مدير|مساعد|عام|العامه|العام)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
};

const normalizeForceOrgText = (value: any) => {
    let normalized = normalizeForceMatchText(value)
        .replace(/شؤون/g, 'شئون')
        .replace(/لشئون/g, 'شئون')
        .replace(/الفنيه/g, 'الفنيه')
        .replace(/التوجية/g, 'التوجيه')
        .replace(/االاستقبال/g, 'الاستقبال')
        .replace(/مكتب المدير العام/g, 'المدير');
    normalized = normalized.replace(/\s+/g, ' ').trim();
    return normalized;
};

const normalizeForceDigits = (value: any) => normalizeText(value)
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

const forceTextValue = (value: any) => normalizeForceDigits(value).replace(/\s+/g, ' ').trim();

const forceDigitsOnly = (value: any) => forceTextValue(value).replace(/\D/g, '');

const birthDateFromCivilId = (value: any) => {
    const digits = forceDigitsOnly(value);
    if (!/^[23]\d{11}$/.test(digits)) return null;
    const century = digits[0] === '2' ? '19' : '20';
    const year = Number(`${century}${digits.slice(1, 3)}`);
    const month = Number(digits.slice(3, 5));
    const day = Number(digits.slice(5, 7));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const normalizeForceDateValue = (value: any) => {
    const text = forceTextValue(value);
    if (!isUsefulForceValue(text)) return null;
    const iso = text.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (iso) {
        const [, year, month, day] = iso;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    const local = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (local) {
        const [, day, month, year] = local;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return text;
};

const normalizeForceBooleanValue = (value: any): boolean | null => {
    const text = normalizeForceMatchText(value);
    if (!text) return null;
    if (['نعم', 'يوجد', 'موجود', 'صحيح', 'true', 'yes', '1'].includes(text)) return true;
    if (['لا', 'كلا', 'بدون', 'غير موجود', 'خطا', 'false', 'no', '0'].includes(text)) return false;
    return null;
};

const isUsefulForceValue = (value: any) => {
    const text = forceTextValue(value);
    return !!text && text !== '-' && text !== 'غير مسجل' && text !== 'لا يوجد';
};

const forceValuesEqual = (left: any, right: any) => {
    if (typeof left === 'boolean' || typeof right === 'boolean') {
        const leftBool = left === true || left === 1 || left === '1' || left === 'true';
        const rightBool = right === true || right === 1 || right === '1' || right === 'true';
        return leftBool === rightBool;
    }
    const leftText = forceTextValue(left);
    const rightText = forceTextValue(right);
    if (!leftText && !rightText) return true;
    if (/^\d+$/.test(leftText) || /^\d+$/.test(rightText)) return leftText === rightText;
    return normalizeForceMatchText(leftText) === normalizeForceMatchText(rightText);
};

const levenshteinDistance = (left: string, right: string) => {
    if (left === right) return 0;
    if (!left) return right.length;
    if (!right) return left.length;
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    const current = new Array(right.length + 1).fill(0);
    for (let i = 1; i <= left.length; i++) {
        current[0] = i;
        for (let j = 1; j <= right.length; j++) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            current[j] = Math.min(
                current[j - 1] + 1,
                previous[j] + 1,
                previous[j - 1] + cost
            );
        }
        for (let j = 0; j <= right.length; j++) previous[j] = current[j];
    }
    return previous[right.length];
};

const forceSimilarity = (leftRaw: any, rightRaw: any) => {
    const left = normalizeForceOrgText(leftRaw);
    const right = normalizeForceOrgText(rightRaw);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.includes(right) || right.includes(left)) return 0.92;
    const leftTokens = new Set(left.split(' ').filter(Boolean));
    const rightTokens = new Set(right.split(' ').filter(Boolean));
    const intersection = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
    const union = new Set([...Array.from(leftTokens), ...Array.from(rightTokens)]).size || 1;
    const tokenScore = intersection / union;
    const maxLength = Math.max(left.length, right.length) || 1;
    const distanceScore = 1 - (levenshteinDistance(left, right) / maxLength);
    return Math.max(tokenScore, distanceScore * 0.82);
};

const bestForceOption = <T extends { name: string }>(
    rawValue: any,
    options: T[],
    threshold = 0.58
): { item: T | null; score: number } => {
    let best: { item: T | null; score: number } = { item: null, score: 0 };
    for (const option of options) {
        const score = forceSimilarity(rawValue, option.name);
        if (score > best.score) best = { item: option, score };
    }
    return best.score >= threshold ? best : { item: null, score: best.score };
};

const forceOptions = (items: Array<{ name: string; id?: string; category?: string; departmentId?: string }>) =>
    items.map((item) => ({
        value: item.name,
        label: item.name,
        departmentId: item.departmentId
    }));

const resolveForceChoice = <T extends { name: string }>(
    rawValue: any,
    options: T[],
    threshold = 0.62
) => {
    if (!isUsefulForceValue(rawValue)) {
        return { value: null as string | null, score: 0 };
    }
    const match = bestForceOption(rawValue, options, threshold);
    return { value: match.item?.name || null, score: match.score };
};

const extractForceWordRows = (filePath: string): Promise<ForceWordRow[]> => {
    return new Promise((resolve, reject) => {
        const script = `
$ErrorActionPreference = 'Stop'
$word = $null
$doc = $null
try {
  $path = $env:FORCE_WORD_PATH
  if (-not (Test-Path -LiteralPath $path)) { throw "Word file not found: $path" }
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open($path, $false, $true, $false)
  $result = @()
  for ($t = 1; $t -le $doc.Tables.Count; $t++) {
    $table = $doc.Tables.Item($t)
    if ($table.Rows.Count -lt 2) { continue }
    $headerRowIndex = 1
    $bestHeaderScore = -1
    $maxHeaderScan = [Math]::Min(6, $table.Rows.Count)
    for ($hr = 1; $hr -le $maxHeaderScan; $hr++) {
      $candidate = @()
      for ($c = 1; $c -le $table.Rows.Item($hr).Cells.Count; $c++) {
        $text = $table.Cell($hr, $c).Range.Text -replace [char]7, ''
        $parts = $text -split '\\r|\\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
        $candidate += (($parts -join ' ').Trim())
      }
      $joined = ($candidate -join ' ')
      $score = 0
      foreach ($keyword in @('الاسم','الإسم','الاســــم','الرتبة','رقم الملف','الرقم المدني','رقم مدني','الإدارة','الادارة','المسمى','الدرجة','المؤهل','الهاتف')) {
        if ($joined -like "*$keyword*") { $score++ }
      }
      if ($score -gt $bestHeaderScore) {
        $bestHeaderScore = $score
        $headerRowIndex = $hr
      }
    }
    if ($bestHeaderScore -lt 1) { continue }
    $headers = @()
    for ($c = 1; $c -le $table.Rows.Item($headerRowIndex).Cells.Count; $c++) {
      $text = $table.Cell($headerRowIndex, $c).Range.Text -replace [char]7, ''
      $parts = $text -split '\\r|\\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
      $headers += (($parts -join [Environment]::NewLine).Trim())
    }
    for ($r = $headerRowIndex + 1; $r -le $table.Rows.Count; $r++) {
      $cells = @()
      for ($c = 1; $c -le $table.Rows.Item($r).Cells.Count; $c++) {
        $text = $table.Cell($r, $c).Range.Text -replace [char]7, ''
        $parts = $text -split '\\r|\\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
        $cells += (($parts -join [Environment]::NewLine).Trim())
      }
      $result += [pscustomobject]@{ tableIndex = $t; headers = $headers; cells = $cells; headerRowIndex = $headerRowIndex; rowIndex = $r }
    }
  }
  $result | ConvertTo-Json -Depth 8 -Compress
} finally {
  if ($doc -ne $null) { $doc.Close($false) | Out-Null }
  if ($word -ne $null) { $word.Quit() | Out-Null }
}
`;
        const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
            env: { ...process.env, FORCE_WORD_PATH: filePath },
            windowsHide: true
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(stderr || `Word extraction failed with code ${code}`));
                return;
            }
            try {
                const trimmed = stdout.trim();
                if (!trimmed) {
                    resolve([]);
                    return;
                }
                const parsed = JSON.parse(trimmed);
                resolve(Array.isArray(parsed) ? parsed : [parsed]);
            } catch (error) {
                reject(error);
            }
        });
    });
};

const getForceCell = (row: ForceWordRow, headerIncludes: string[]) => {
    const headerIndex = row.headers.findIndex((header) => {
        const normalized = normalizeForceMatchText(header);
        return headerIncludes.some((needle) => normalized.includes(normalizeForceMatchText(needle)));
    });
    if (headerIndex < 0) return '';
    return row.cells[headerIndex] || '';
};

const FORCE_SOURCE_FIELD_ALIASES: Record<string, string[]> = {
    name: ['الاسم', 'الإسم', 'الاســــم', 'اسم الموظف'],
    rank: ['الرتبة', 'الدرجة العسكرية'],
    fileNumber: ['رقم الملف', 'ملف'],
    militaryNumber: ['الرقم العسكري', 'رقم عسكري'],
    referenceNumber: ['رقم المرجع', 'المرجع'],
    civilId: ['رقم مدني', 'الرقم المدني', 'مدني'],
    birthDate: ['تاريخ الميلاد', 'الميلاد'],
    nationality: ['الجنسية'],
    nationalityArticleNumber: ['رقم مادة الجنسية', 'مادة الجنسية', 'المادة'],
    nationalityIssueDate: ['تاريخ إصدار الجنسية', 'تاريخ اصدار الجنسية', 'إصدار الجنسية'],
    maritalStatus: ['الحالة الاجتماعية', 'الحالة الإجتماعية', 'اجتماعية'],
    maritalStatusNote: ['ملاحظة الحالة الاجتماعية', 'ملاحظات الحالة الاجتماعية'],
    appointmentDecisionNumber: ['رقم قرار التعيين', 'قرار التعيين'],
    appointmentDecisionDate: ['تاريخ قرار التعيين'],
    gender: ['النوع', 'الجنس'],
    jobTitle: ['المسمى الوظيفي', 'المنصب', 'الوظيفة'],
    jobGrade: ['الدرجة الوظيفية', 'درجة وظيفية'],
    educationCertificateType: ['المؤهل العلمي', 'نوع الشهادة', 'الشهادة الدراسية', 'المؤهل الدراسي'],
    educationSpecialization: ['التخصص', 'اسم المؤهل', 'تخصص المؤهل'],
    phone_number: ['رقم الهاتف', 'الهاتف', 'النقال', 'الموبايل'],
    hiringDate: ['تاريخ التعيين', 'التعيين'],
    seniorityNumber: ['رقم الأقدمية', 'الاقدمية', 'الأقدمية'],
    hasWeapon: ['سلاح', 'يحمل سلاح'],
    weaponAttachments: ['ملحقات السلاح', 'مرفقات السلاح'],
    hasParking: ['موقف سيارة', 'لديه موقف', 'الموقف'],
    parkingLocation: ['موقع الموقف', 'مكان الموقف'],
    parkingNumber: ['رقم الموقف'],
    includeInShifts: ['يدرج في الخفارات', 'مشارك في الخفارات', 'الخفارات'],
    shiftNotes: ['ملاحظات الخفارات'],
    excludeFromStatistics: ['مستثنى من الإحصائيات', 'استبعاد من الإحصائيات'],
    isSecondedOutsideGeneralAdministration: ['منتدب من خارج الإدارة العامة', 'ندب خارجي'],
    secondmentLocation: ['جهة الندب', 'مكان الندب', 'موقع الندب'],
    department: ['الإدارة', 'الادارة', 'الإدارة القسم', 'الإدارة / القسم'],
    section: ['القسم']
};

const getForceSourceCell = (row: ForceWordRow, field: string) =>
    forceTextValue(getForceCell(row, FORCE_SOURCE_FIELD_ALIASES[field] || [field]));

const getForceSourceDateCell = (row: ForceWordRow, field: string) =>
    normalizeForceDateValue(getForceSourceCell(row, field));

const getForceSourceBooleanCell = (row: ForceWordRow, field: string) =>
    normalizeForceBooleanValue(getForceSourceCell(row, field));

const normalizeForceGender = (value: any) => {
    const normalized = normalizeForceMatchText(value);
    if (!normalized) return null;
    if (normalized.includes('انث') || normalized.includes('female')) return 'أنثى';
    if (normalized.includes('ذكر') || normalized.includes('male')) return 'ذكر';
    return forceTextValue(value);
};

const normalizeForceMaritalStatus = (value: any) => {
    const normalized = normalizeForceMatchText(value);
    if (!normalized) return null;
    if (normalized.includes('متزوج')) return 'متزوج';
    if (normalized.includes('اعزب') || normalized.includes('عازب')) return 'أعزب';
    return forceTextValue(value);
};

const inferForceCategoryFromRow = (row: ForceWordRow, tableIndex: number) => {
    const rowText = normalizeForceMatchText([...row.headers, ...row.cells].join(' '));
    if (rowText.includes('المدنيين') || rowText.includes('مدنيين') || rowText.includes('الدرجه الوظيفيه')) return 'مدنيين';
    if (rowText.includes('مهني')) return 'مهنيين';
    if (rowText.includes('ضباط الصف') || rowText.includes('افراد')) return 'ضباط صف';
    if (rowText.includes('ضباط')) return 'ضباط';
    return tableIndex === 1
        ? 'ضباط'
        : tableIndex === 2
            ? 'ضباط صف'
            : tableIndex === 3
                ? 'مهنيين'
                : tableIndex === 4
                    ? 'مدنيين'
                    : '';
};

const parseForceSourceEmployees = (rows: ForceWordRow[]) => {
    const parsed: ForceSourceEmployee[] = [];
    rows.forEach((row, index) => {
        const tableIndex = Number(row.tableIndex);
        const category = inferForceCategoryFromRow(row, tableIndex);
        if (!category) return;
        const name = getForceSourceCell(row, 'name');
        if (!isUsefulForceValue(name)) return;
        const rawDepartmentText = getForceSourceCell(row, 'department') || getForceSourceCell(row, 'section');
        const educationCertificateType = getForceSourceCell(row, 'educationCertificateType');
        const civilId = forceDigitsOnly(getForceSourceCell(row, 'civilId'));
        const explicitBirthDate = getForceSourceDateCell(row, 'birthDate');
        parsed.push({
            sourceId: `word_${tableIndex}_${row.rowIndex || index + 2}`,
            tableIndex,
            rowNumber: row.rowIndex || index + 2,
            category,
            name: forceTextValue(name),
            rank: category === 'مدنيين' ? 'مدني' : getForceSourceCell(row, 'rank'),
            fileNumber: category === 'مدنيين' ? null : forceDigitsOnly(getForceSourceCell(row, 'fileNumber')),
            militaryNumber: category === 'ضباط' || category === 'مدنيين'
                ? null
                : forceDigitsOnly(getForceSourceCell(row, 'militaryNumber')),
            referenceNumber: forceDigitsOnly(getForceSourceCell(row, 'referenceNumber')),
            civilId,
            birthDate: explicitBirthDate || birthDateFromCivilId(civilId),
            nationality: getForceSourceCell(row, 'nationality'),
            nationalityArticleNumber: getForceSourceCell(row, 'nationalityArticleNumber'),
            nationalityIssueDate: getForceSourceDateCell(row, 'nationalityIssueDate'),
            maritalStatus: normalizeForceMaritalStatus(getForceSourceCell(row, 'maritalStatus')),
            maritalStatusNote: getForceSourceCell(row, 'maritalStatusNote'),
            appointmentDecisionNumber: forceDigitsOnly(getForceSourceCell(row, 'appointmentDecisionNumber')) || getForceSourceCell(row, 'appointmentDecisionNumber'),
            appointmentDecisionDate: getForceSourceDateCell(row, 'appointmentDecisionDate'),
            gender: normalizeForceGender(getForceSourceCell(row, 'gender')),
            jobTitle: getForceSourceCell(row, 'jobTitle'),
            jobGrade: category === 'مدنيين' ? getForceSourceCell(row, 'jobGrade') : null,
            educationCertificateType: category === 'مدنيين' ? educationCertificateType : null,
            educationSpecialization: getForceSourceCell(row, 'educationSpecialization'),
            phone_number: forceDigitsOnly(getForceSourceCell(row, 'phone_number')),
            hiringDate: getForceSourceDateCell(row, 'hiringDate'),
            seniorityNumber: forceDigitsOnly(getForceSourceCell(row, 'seniorityNumber')) || getForceSourceCell(row, 'seniorityNumber'),
            hasWeapon: getForceSourceBooleanCell(row, 'hasWeapon'),
            weaponAttachments: getForceSourceCell(row, 'weaponAttachments'),
            hasParking: getForceSourceBooleanCell(row, 'hasParking'),
            parkingLocation: getForceSourceCell(row, 'parkingLocation'),
            parkingNumber: forceDigitsOnly(getForceSourceCell(row, 'parkingNumber')) || getForceSourceCell(row, 'parkingNumber'),
            includeInShifts: getForceSourceBooleanCell(row, 'includeInShifts'),
            shiftNotes: getForceSourceCell(row, 'shiftNotes'),
            excludeFromStatistics: getForceSourceBooleanCell(row, 'excludeFromStatistics'),
            isSecondedOutsideGeneralAdministration: getForceSourceBooleanCell(row, 'isSecondedOutsideGeneralAdministration'),
            secondmentLocation: getForceSourceCell(row, 'secondmentLocation'),
            rawDepartmentText: forceTextValue(rawDepartmentText)
        });
    });
    return parsed;
};

const parsePhoneSourceEmployees = (rows: ForceWordRow[]) => {
    const parsed: ForceSourceEmployee[] = [];
    rows.forEach((row, index) => {
        const name = getForceCell(row, ['الاسم', 'الإسم', 'الاســــم']);
        if (!isUsefulForceValue(name)) return;
        const nameKey = normalizeForceMatchText(name);
        if (nameKey.includes('الضباط') || nameKey.includes('ضباط الصف') || nameKey.includes('المهنيين')) return;
        parsed.push({
            sourceId: `phone_${row.tableIndex}_${row.rowIndex || index + 2}`,
            tableIndex: Number(row.tableIndex),
            rowNumber: row.rowIndex || index + 2,
            category: 'غير محدد',
            name: forceTextValue(name),
            rank: forceTextValue(getForceCell(row, ['الرتبة'])),
            fileNumber: forceTextValue(getForceCell(row, ['رقم الملف'])),
            civilId: null,
            jobTitle: forceTextValue(getForceCell(row, ['المسمى الوظيفي'])),
            rawDepartmentText: forceTextValue(getForceCell(row, ['الإدارة', 'الادارة'])),
            phone_number: forceTextValue(getForceCell(row, ['رقم الهاتف', 'الهاتف']))
        });
    });
    return parsed;
};

const resolveForceOrganization = (
    source: ForceSourceEmployee,
    departments: any[],
    sections: any[]
) => {
    const raw = source.rawDepartmentText || '';
    const departmentMatch = bestForceOption(raw, departments, 0.55);
    const department = departmentMatch.item?.name || null;
    const departmentId = departmentMatch.item?.id || null;
    const scopedSections = departmentId
        ? sections.filter((section) => section.departmentId === departmentId)
        : sections;
    const sectionCandidates = raw
        .split(/\n+/)
        .map(forceTextValue)
        .filter((part) => normalizeForceOrgText(part).includes('قسم') || forceTextValue(part).startsWith('قسم') || part.includes('قسم'));
    const sectionRaw = sectionCandidates.join(' ') || raw;
    const sectionMatch = bestForceOption(sectionRaw, scopedSections, 0.54);
    return {
        department,
        departmentScore: departmentMatch.score,
        section: sectionMatch.item?.name || null,
        sectionScore: sectionMatch.score
    };
};

const uniqueForceNameRows = (values: any[]) => {
    const seen = new Set<string>();
    return values
        .map((value) => forceTextValue(value))
        .filter(Boolean)
        .filter((name) => {
            const key = normalizeForceMatchText(name);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map((name) => ({ name }));
};

const buildForceFieldWarning = (rawValue: any, resolvedValue: any, label: string) =>
    isUsefulForceValue(rawValue) && !isUsefulForceValue(resolvedValue)
        ? `${label} في الكشف (${forceTextValue(rawValue)}) لا يطابق الخيارات الموجودة.`
        : null;

const buildForceSyncAnalysis = async (filePath: string, extractedRows?: ForceWordRow[]) => {
    const rows = extractedRows || await extractForceWordRows(filePath);
    const db = await getDb();
    try {
        const [employees, departments, sections, ranks, jobTitles, nationalities] = await Promise.all([
            db.all('SELECT * FROM Employees'),
            db.all('SELECT id, name FROM Departments ORDER BY name'),
            db.all('SELECT id, name, departmentId FROM Sections ORDER BY name'),
            db.all('SELECT id, name, category FROM Ranks ORDER BY category, "order", name'),
            db.all('SELECT id, name, category FROM JobTitles ORDER BY category, name'),
            db.all('SELECT id, name FROM Nationalities ORDER BY name')
        ]);
        const jobGradeRows = uniqueForceNameRows([
            ...FORCE_JOB_GRADE_OPTIONS,
            ...employees.map((employee: any) => employee.jobGrade)
        ]);
        const educationOptions = FORCE_EDUCATION_OPTIONS.map((name) => ({ name }));
        const maritalStatusOptions = FORCE_MARITAL_STATUS_OPTIONS.map((name) => ({ name }));
        const genderOptions = FORCE_GENDER_OPTIONS.map((name) => ({ name }));
        const nationalityArticleOptions = FORCE_NATIONALITY_ARTICLE_OPTIONS.map((name) => ({ name }));
        const sourceEmployees = parseForceSourceEmployees(rows).map((source) => {
            const organization = resolveForceOrganization(source, departments, sections);
            const scopedRanks = ranks.filter((rank: any) => rank.category === source.category);
            const scopedJobTitles = jobTitles.filter((jobTitle: any) => jobTitle.category === source.category);
            const rankChoice = source.category === 'مدنيين'
                ? { value: 'مدني', score: 1 }
                : resolveForceChoice(source.rank, scopedRanks, 0.58);
            const jobTitleChoice = resolveForceChoice(source.jobTitle, scopedJobTitles, 0.5);
            const jobGradeChoice = source.category === 'مدنيين'
                ? resolveForceChoice(source.jobGrade, jobGradeRows, 0.5)
                : { value: null, score: 0 };
            const educationChoice = source.category === 'مدنيين'
                ? resolveForceChoice(source.educationCertificateType, educationOptions, 0.5)
                : { value: null, score: 0 };
            const nationalityChoice = resolveForceChoice(source.nationality, nationalities, 0.58);
            const nationalityArticleChoice = resolveForceChoice(source.nationalityArticleNumber, nationalityArticleOptions, 0.54);
            const maritalStatusChoice = resolveForceChoice(source.maritalStatus, maritalStatusOptions, 0.58);
            const genderChoice = resolveForceChoice(source.gender, genderOptions, 0.58);
            return {
                ...source,
                ...organization,
                rank: rankChoice.value,
                jobTitle: jobTitleChoice.value,
                jobGrade: jobGradeChoice.value,
                educationCertificateType: educationChoice.value,
                nationality: nationalityChoice.value,
                nationalityArticleNumber: nationalityArticleChoice.value,
                maritalStatus: maritalStatusChoice.value,
                gender: genderChoice.value,
                rawRank: source.rank,
                rawJobTitle: source.jobTitle,
                rawJobGrade: source.jobGrade,
                rawEducationCertificateType: source.educationCertificateType,
                rawNationality: source.nationality,
                rawNationalityArticleNumber: source.nationalityArticleNumber,
                rawMaritalStatus: source.maritalStatus,
                rawGender: source.gender,
                rankChoiceScore: rankChoice.score,
                jobTitleChoiceScore: jobTitleChoice.score,
                jobGradeChoiceScore: jobGradeChoice.score,
                educationChoiceScore: educationChoice.score,
                nationalityChoiceScore: nationalityChoice.score,
                nationalityArticleChoiceScore: nationalityArticleChoice.score,
                maritalStatusChoiceScore: maritalStatusChoice.score,
                genderChoiceScore: genderChoice.score
            } as ForceSourceEmployee & Record<string, any>;
        });

        const byFile = new Map<string, any>();
        const byCivil = new Map<string, any>();
        const byReference = new Map<string, any>();
        const byMilitary = new Map<string, any>();
        employees.forEach((employee: any) => {
            if (employee.fileNumber) byFile.set(forceDigitsOnly(employee.fileNumber) || forceTextValue(employee.fileNumber), employee);
            if (employee.civilId) byCivil.set(forceDigitsOnly(employee.civilId) || forceTextValue(employee.civilId), employee);
            if (employee.referenceNumber) byReference.set(forceDigitsOnly(employee.referenceNumber) || forceTextValue(employee.referenceNumber), employee);
            if (employee.militaryNumber) byMilitary.set(forceDigitsOnly(employee.militaryNumber) || forceTextValue(employee.militaryNumber), employee);
        });

        const scoreEmployeeCandidate = (source: ForceSourceEmployee, employee: any) => {
            const details: string[] = [];
            let score = 0;
            const nameScore = forceSimilarity(source.name, employee.name);
            score += nameScore * 0.62;
            if (nameScore >= 0.92) details.push('تشابه الاسم قوي');
            else if (nameScore >= 0.78) details.push('تشابه الاسم متوسط');

            if (source.category && employee.category === source.category) {
                score += 0.12;
                details.push('نفس الفئة');
            }
            const rankScore = forceSimilarity(source.rank, employee.rank);
            if (rankScore >= 0.82) {
                score += 0.07;
                details.push('الرتبة متقاربة');
            }
            const departmentScore = forceSimilarity(source.department || source.rawDepartmentText, employee.department);
            if (departmentScore >= 0.7) {
                score += 0.07;
                details.push('الإدارة متقاربة');
            }
            const sectionScore = forceSimilarity(source.section, employee.section);
            if (sectionScore >= 0.7) {
                score += 0.04;
                details.push('القسم متقارب');
            }
            const jobTitleScore = forceSimilarity(source.jobTitle, employee.jobTitle);
            if (jobTitleScore >= 0.72) {
                score += 0.05;
                details.push('المسمى متقارب');
            }
            return { employee, score: Math.min(score, 0.99), details };
        };

        const findForceEmployeeMatch = (source: ForceSourceEmployee) => {
            const exactFile = source.fileNumber ? byFile.get(forceDigitsOnly(source.fileNumber) || forceTextValue(source.fileNumber)) : null;
            if (exactFile) return { employee: exactFile, matchedBy: 'رقم الملف', confidence: 1, details: ['تطابق رقم الملف'], reviewRequired: false };
            const exactCivil = source.civilId ? byCivil.get(forceDigitsOnly(source.civilId) || forceTextValue(source.civilId)) : null;
            if (exactCivil) return { employee: exactCivil, matchedBy: 'الرقم المدني', confidence: 1, details: ['تطابق الرقم المدني'], reviewRequired: false };
            const exactReference = source.referenceNumber ? byReference.get(forceDigitsOnly(source.referenceNumber) || forceTextValue(source.referenceNumber)) : null;
            if (exactReference) return { employee: exactReference, matchedBy: 'رقم المرجع', confidence: 0.98, details: ['تطابق رقم المرجع'], reviewRequired: false };
            const exactMilitary = source.militaryNumber ? byMilitary.get(forceDigitsOnly(source.militaryNumber) || forceTextValue(source.militaryNumber)) : null;
            if (exactMilitary) return { employee: exactMilitary, matchedBy: 'الرقم العسكري', confidence: 0.96, details: ['تطابق الرقم العسكري'], reviewRequired: false };

            const candidates = employees
                .map((employee: any) => scoreEmployeeCandidate(source, employee))
                .sort((left: any, right: any) => right.score - left.score);
            const best = candidates[0];
            const second = candidates[1];
            if (best && best.score >= 0.78 && (!second || best.score - second.score >= 0.06)) {
                return {
                    employee: best.employee,
                    matchedBy: 'مطابقة ذكية',
                    confidence: Number(best.score.toFixed(2)),
                    details: best.details,
                    reviewRequired: best.score < 0.9
                };
            }
            return { employee: null, matchedBy: null, confidence: 0, details: [], reviewRequired: false };
        };

        const proposals: ForceSyncProposal[] = [];
        const warnings: ForceSyncWarning[] = [];
        const matchedEmployeeIds = new Set<string>();
        const departmentOptions = forceOptions(departments);
        const sectionOptions = sections.map((section: any) => {
            const department = departments.find((dep: any) => dep.id === section.departmentId);
            return {
                value: section.name,
                label: department ? `${department.name} / ${section.name}` : section.name,
                departmentId: section.departmentId
            };
        });

        const addUpdateProposal = (
            employee: any,
            source: ForceSourceEmployee,
            field: string,
            suggestedValue: any,
            matchedBy: string | null,
            config: {
                options?: Array<{ value: string; label: string; departmentId?: string }>;
                warning?: string | null;
                allowEmptySuggestion?: boolean;
                confidence?: number;
                reviewRequired?: boolean;
                matchDetails?: string[];
                sourceRawValue?: any;
            } = {}
        ) => {
            if (!config.allowEmptySuggestion && !isUsefulForceValue(suggestedValue) && typeof suggestedValue !== 'boolean') return;
            const currentValue = employee[field];
            if (forceValuesEqual(currentValue, suggestedValue)) return;
            const missing = !isUsefulForceValue(currentValue);
            const fieldWarning = config.warning || (field === 'department' && !suggestedValue
                ? 'لم يتم التعرف على الإدارة من الكشف. اختر الإدارة قبل التطبيق.'
                : field === 'section' && !suggestedValue && isUsefulForceValue(source.rawDepartmentText)
                    ? 'لم يتم التعرف على القسم من الكشف. يمكنك اختيار القسم يدويًا.'
                    : null);
            const reviewWarning = config.reviewRequired
                ? 'هذه مطابقة ذكية احتمالية. راجع الاسم والبيانات قبل التطبيق.'
                : null;
            proposals.push({
                id: `update_${employee.id}_${field}_${source.sourceId}`,
                action: 'update',
                reason: missing ? 'missing_field' : 'different_field',
                employeeId: employee.id,
                employeeName: employee.name || source.name,
                category: employee.category || source.category,
                matchedBy,
                field,
                label: FORCE_FIELD_LABELS[field] || field,
                currentValue,
                suggestedValue,
                sourceValue: suggestedValue,
                sourceEmployee: source,
                options: config.options || (field === 'department' ? departmentOptions : undefined),
                sectionOptions: field === 'section' ? sectionOptions : undefined,
                warning: [fieldWarning, reviewWarning].filter(Boolean).join(' ') || null,
                confidence: config.confidence,
                reviewRequired: config.reviewRequired,
                matchDetails: config.matchDetails,
                sourceRawValue: config.sourceRawValue
            });
        };

        sourceEmployees.forEach((source, sourceIndex) => {
            const sourceAny = source as ForceSourceEmployee & Record<string, any>;
            const rankOptions = forceOptions(ranks.filter((rank: any) => rank.category === source.category));
            const jobTitleOptions = forceOptions(jobTitles.filter((jobTitle: any) => jobTitle.category === source.category));
            const jobGradeOptions = forceOptions(jobGradeRows);
            const educationChoiceOptions = forceOptions(educationOptions);
            const nationalityOptions = forceOptions(nationalities);
            const nationalityArticleChoiceOptions = forceOptions(nationalityArticleOptions);
            const maritalStatusChoiceOptions = forceOptions(maritalStatusOptions);
            const genderChoiceOptions = forceOptions(genderOptions);
            const match = findForceEmployeeMatch(source);
            const employee = match.employee;
            const matchedBy = match.matchedBy;
            const proposalMeta = {
                confidence: match.confidence || undefined,
                reviewRequired: match.reviewRequired || undefined,
                matchDetails: match.details
            };
            const addMatchedUpdateProposal = (
                field: string,
                suggestedValue: any,
                config: {
                    options?: Array<{ value: string; label: string; departmentId?: string }>;
                    warning?: string | null;
                allowEmptySuggestion?: boolean;
                sourceRawValue?: any;
                simple?: boolean;
            } = {}
            ) => addUpdateProposal(employee, source, field, suggestedValue, matchedBy, {
                ...(config.simple ? {} : proposalMeta),
                ...config,
                reviewRequired: config.simple ? false : proposalMeta.reviewRequired
            });

            const addSimpleBirthDateProposal = () => {
                const derivedBirthDate = birthDateFromCivilId(source.civilId);
                const suggestedBirthDate = source.birthDate || derivedBirthDate;
                const hasStoredBirthDate = isUsefulForceValue(employee.birthDate);

                if (hasStoredBirthDate) {
                    if (suggestedBirthDate && !forceValuesEqual(employee.birthDate, suggestedBirthDate)) {
                        addMatchedUpdateProposal('birthDate', suggestedBirthDate, {
                            simple: true,
                            warning: `تاريخ الميلاد المسجل يختلف عن الرقم المدني. اترك المقترح بدون موافقة للإبقاء على التاريخ الحالي (${employee.birthDate})، أو وافق عليه للتحديث حسب الرقم المدني.`
                        });
                    }
                    return;
                }

                if (source.civilId && !derivedBirthDate && !source.birthDate) {
                    warnings.push({
                        id: `birthDate_invalid_civil_${employee.id}_${source.sourceId}`,
                        severity: 'error',
                        employeeName: employee.name || source.name,
                        message: `لا يمكن استخراج تاريخ الميلاد من الرقم المدني (${source.civilId}).`
                    });
                    return;
                }

                addMatchedUpdateProposal('birthDate', suggestedBirthDate, {
                    simple: true,
                    warning: derivedBirthDate ? 'تم استخراج تاريخ الميلاد من الرقم المدني.' : null
                });
            };

            if (!employee) {
                const hasEducationCertificate = isUsefulForceValue(source.educationCertificateType)
                    && !forceValuesEqual(source.educationCertificateType, 'بدون شهادة');
                const createPayload = {
                    name: source.name,
                    category: source.category,
                    rank: source.rank || (source.category === 'مدنيين' ? 'مدني' : (rankOptions[0]?.value || '')),
                    fileNumber: source.fileNumber || null,
                    militaryNumber: source.militaryNumber || null,
                    referenceNumber: source.referenceNumber || null,
                    civilId: source.civilId || null,
                    birthDate: source.birthDate || null,
                    nationality: source.nationality || null,
                    nationalityArticleNumber: source.nationalityArticleNumber || null,
                    nationalityIssueDate: source.nationalityIssueDate || null,
                    maritalStatus: source.maritalStatus || null,
                    maritalStatusNote: source.maritalStatusNote || null,
                    appointmentDecisionNumber: source.appointmentDecisionNumber || null,
                    appointmentDecisionDate: source.appointmentDecisionDate || null,
                    gender: source.gender || null,
                    jobTitle: source.jobTitle || null,
                    jobGrade: source.jobGrade || null,
                    hasEducationCertificate,
                    educationCertificateType: hasEducationCertificate
                        ? source.educationCertificateType
                        : 'بدون شهادة',
                    educationSpecialization: source.educationSpecialization || null,
                    hiringDate: source.hiringDate || null,
                    seniorityNumber: source.seniorityNumber || null,
                    department: source.department || '',
                    section: source.section || null,
                    hasWeapon: source.hasWeapon ?? false,
                    weaponAttachments: source.weaponAttachments || null,
                    hasParking: source.hasParking ?? false,
                    parkingLocation: source.parkingLocation || null,
                    parkingNumber: source.parkingNumber || null,
                    includeInShifts: source.category === 'مدنيين' ? false : (source.includeInShifts ?? true),
                    shiftNotes: source.shiftNotes || null,
                    excludeFromStatistics: source.excludeFromStatistics ?? false,
                    isSecondedOutsideGeneralAdministration: source.isSecondedOutsideGeneralAdministration ?? false,
                    secondmentLocation: source.secondmentLocation || null,
                    status: 'active'
                };
                const createWarnings = [
                    isUsefulForceValue(sourceAny.rawRank) && !source.rank ? `الرتبة في الكشف (${sourceAny.rawRank}) لا تطابق قائمة الرتب.` : '',
                    isUsefulForceValue(sourceAny.rawJobTitle) && !source.jobTitle ? `المسمى في الكشف (${sourceAny.rawJobTitle}) لا يطابق قائمة المسميات.` : '',
                    isUsefulForceValue(sourceAny.rawJobGrade) && !source.jobGrade ? `الدرجة في الكشف (${sourceAny.rawJobGrade}) لا تطابق الدرجات الموجودة.` : '',
                    isUsefulForceValue(sourceAny.rawEducationCertificateType) && !source.educationCertificateType ? `المؤهل في الكشف (${sourceAny.rawEducationCertificateType}) لا يطابق قائمة المؤهلات.` : '',
                    isUsefulForceValue(sourceAny.rawNationality) && !source.nationality ? `الجنسية في الكشف (${sourceAny.rawNationality}) لا تطابق قائمة الجنسيات.` : '',
                    isUsefulForceValue(sourceAny.rawMaritalStatus) && !source.maritalStatus ? `الحالة الاجتماعية في الكشف (${sourceAny.rawMaritalStatus}) لا تطابق الخيارات.` : '',
                    isUsefulForceValue(sourceAny.rawGender) && !source.gender ? `النوع في الكشف (${sourceAny.rawGender}) لا يطابق الخيارات.` : '',
                    !source.department ? 'لم يتم التعرف على الإدارة من الكشف. اختر الإدارة قبل الإضافة.' : ''
                ].filter(Boolean);
                proposals.push({
                    id: `create_${source.sourceId}`,
                    action: 'create',
                    reason: 'missing_employee',
                    employeeName: source.name,
                    category: source.category,
                    sourceEmployee: source,
                    payload: createPayload,
                    suggestedValue: createPayload,
                    options: departmentOptions,
                    sectionOptions,
                    warning: createWarnings.length ? createWarnings.join(' ') : null,
                    confidence: 0,
                    reviewRequired: true,
                    matchDetails: ['لم يتم العثور على موظف مطابق في قاعدة البيانات']
                });
                return;
            }

            matchedEmployeeIds.add(employee.id);
            addMatchedUpdateProposal('name', source.name);
            addMatchedUpdateProposal('manualOrder', sourceIndex + 1, {
                warning: 'سيتم ترتيب الموظف حسب موقعه في كشف Word المرفق.',
                simple: true
            });
            addMatchedUpdateProposal('referenceNumber', source.referenceNumber);
            addSimpleBirthDateProposal();
            addMatchedUpdateProposal('nationality', source.nationality, {
                options: nationalityOptions,
                warning: buildForceFieldWarning(sourceAny.rawNationality, source.nationality, 'الجنسية'),
                allowEmptySuggestion: isUsefulForceValue(sourceAny.rawNationality),
                sourceRawValue: sourceAny.rawNationality
            });
            addMatchedUpdateProposal('nationalityArticleNumber', source.nationalityArticleNumber, {
                options: nationalityArticleChoiceOptions,
                warning: buildForceFieldWarning(sourceAny.rawNationalityArticleNumber, source.nationalityArticleNumber, 'رقم مادة الجنسية'),
                allowEmptySuggestion: isUsefulForceValue(sourceAny.rawNationalityArticleNumber),
                sourceRawValue: sourceAny.rawNationalityArticleNumber
            });
            addMatchedUpdateProposal('nationalityIssueDate', source.nationalityIssueDate);
            addMatchedUpdateProposal('maritalStatus', source.maritalStatus, {
                options: maritalStatusChoiceOptions,
                warning: buildForceFieldWarning(sourceAny.rawMaritalStatus, source.maritalStatus, 'الحالة الاجتماعية'),
                allowEmptySuggestion: isUsefulForceValue(sourceAny.rawMaritalStatus),
                sourceRawValue: sourceAny.rawMaritalStatus
            });
            addMatchedUpdateProposal('maritalStatusNote', source.maritalStatusNote);
            addMatchedUpdateProposal('appointmentDecisionNumber', source.appointmentDecisionNumber);
            addMatchedUpdateProposal('appointmentDecisionDate', source.appointmentDecisionDate);
            addMatchedUpdateProposal('gender', source.gender, {
                options: genderChoiceOptions,
                warning: buildForceFieldWarning(sourceAny.rawGender, source.gender, 'النوع'),
                allowEmptySuggestion: isUsefulForceValue(sourceAny.rawGender),
                sourceRawValue: sourceAny.rawGender
            });
            addMatchedUpdateProposal('phone_number', source.phone_number);
            addMatchedUpdateProposal('educationSpecialization', source.educationSpecialization);
            addMatchedUpdateProposal('hiringDate', source.hiringDate);
            addMatchedUpdateProposal('seniorityNumber', source.seniorityNumber);
            addMatchedUpdateProposal('hasWeapon', source.hasWeapon);
            addMatchedUpdateProposal('weaponAttachments', source.weaponAttachments);
            addMatchedUpdateProposal('hasParking', source.hasParking);
            addMatchedUpdateProposal('parkingLocation', source.parkingLocation);
            addMatchedUpdateProposal('parkingNumber', source.parkingNumber);
            addMatchedUpdateProposal('shiftNotes', source.shiftNotes);
            addMatchedUpdateProposal('excludeFromStatistics', source.excludeFromStatistics);
            addMatchedUpdateProposal('isSecondedOutsideGeneralAdministration', source.isSecondedOutsideGeneralAdministration);
            addMatchedUpdateProposal('secondmentLocation', source.secondmentLocation);
            if (source.category === 'مدنيين') {
                addMatchedUpdateProposal('jobTitle', source.jobTitle, {
                    options: jobTitleOptions,
                    warning: isUsefulForceValue(sourceAny.rawJobTitle) && !source.jobTitle ? `المسمى في الكشف (${sourceAny.rawJobTitle}) لا يطابق قائمة المسميات.` : null,
                    allowEmptySuggestion: isUsefulForceValue(sourceAny.rawJobTitle),
                    sourceRawValue: sourceAny.rawJobTitle
                });
                addMatchedUpdateProposal('civilId', source.civilId);
                addMatchedUpdateProposal('jobGrade', source.jobGrade, {
                    options: jobGradeOptions,
                    warning: isUsefulForceValue(sourceAny.rawJobGrade) && !source.jobGrade ? `الدرجة في الكشف (${sourceAny.rawJobGrade}) لا تطابق الدرجات الموجودة.` : null,
                    allowEmptySuggestion: isUsefulForceValue(sourceAny.rawJobGrade),
                    sourceRawValue: sourceAny.rawJobGrade
                });
                addMatchedUpdateProposal('department', source.department, {
                    options: departmentOptions,
                    warning: isUsefulForceValue(source.rawDepartmentText) && !source.department ? `الإدارة في الكشف (${source.rawDepartmentText}) لا تطابق قائمة الإدارات.` : null,
                    allowEmptySuggestion: isUsefulForceValue(source.rawDepartmentText),
                    sourceRawValue: source.rawDepartmentText
                });
                addMatchedUpdateProposal('section', source.section, {
                    warning: isUsefulForceValue(source.rawDepartmentText) && !source.section ? `القسم في الكشف (${source.rawDepartmentText}) لا يطابق أقسام الإدارة.` : null,
                    allowEmptySuggestion: isUsefulForceValue(source.rawDepartmentText),
                    sourceRawValue: source.rawDepartmentText
                });
                const hasSourceEducation = isUsefulForceValue(source.educationCertificateType)
                    && !forceValuesEqual(source.educationCertificateType, 'بدون شهادة');
                if (hasSourceEducation) {
                    addMatchedUpdateProposal('hasEducationCertificate', true);
                    addMatchedUpdateProposal('educationCertificateType', source.educationCertificateType, {
                        options: educationChoiceOptions
                    });
                } else if (forceValuesEqual(source.educationCertificateType, 'بدون شهادة')) {
                    addMatchedUpdateProposal('hasEducationCertificate', false);
                    addMatchedUpdateProposal('educationCertificateType', 'بدون شهادة', {
                        options: educationChoiceOptions
                    });
                } else if (isUsefulForceValue(sourceAny.rawEducationCertificateType)) {
                    addMatchedUpdateProposal('educationCertificateType', null, {
                        options: educationChoiceOptions,
                        warning: `المؤهل في الكشف (${sourceAny.rawEducationCertificateType}) لا يطابق قائمة المؤهلات.`,
                        allowEmptySuggestion: true,
                        sourceRawValue: sourceAny.rawEducationCertificateType
                    });
                }
            } else {
                addMatchedUpdateProposal('rank', source.rank, {
                    options: rankOptions,
                    warning: isUsefulForceValue(sourceAny.rawRank) && !source.rank ? `الرتبة في الكشف (${sourceAny.rawRank}) لا تطابق قائمة الرتب.` : null,
                    allowEmptySuggestion: isUsefulForceValue(sourceAny.rawRank),
                    sourceRawValue: sourceAny.rawRank
                });
                addMatchedUpdateProposal('fileNumber', source.fileNumber);
                addMatchedUpdateProposal('militaryNumber', source.militaryNumber);
                addMatchedUpdateProposal('jobTitle', source.jobTitle, {
                    options: jobTitleOptions,
                    warning: isUsefulForceValue(sourceAny.rawJobTitle) && !source.jobTitle ? `المسمى في الكشف (${sourceAny.rawJobTitle}) لا يطابق قائمة المسميات.` : null,
                    allowEmptySuggestion: isUsefulForceValue(sourceAny.rawJobTitle),
                    sourceRawValue: sourceAny.rawJobTitle
                });
                addMatchedUpdateProposal('department', source.department, {
                    options: departmentOptions,
                    warning: isUsefulForceValue(source.rawDepartmentText) && !source.department ? `الإدارة في الكشف (${source.rawDepartmentText}) لا تطابق قائمة الإدارات.` : null,
                    allowEmptySuggestion: isUsefulForceValue(source.rawDepartmentText),
                    sourceRawValue: source.rawDepartmentText
                });
                addMatchedUpdateProposal('section', source.section, {
                    warning: isUsefulForceValue(source.rawDepartmentText) && !source.section ? `القسم في الكشف (${source.rawDepartmentText}) لا يطابق أقسام الإدارة.` : null,
                    allowEmptySuggestion: isUsefulForceValue(source.rawDepartmentText),
                    sourceRawValue: source.rawDepartmentText
                });
                addMatchedUpdateProposal('civilId', source.civilId);
                addMatchedUpdateProposal('includeInShifts', source.includeInShifts);
            }
        });

        const dbOnlyEmployees = employees
            .filter((employee: any) => !matchedEmployeeIds.has(employee.id) && employee.status !== 'inactive')
            .map((employee: any) => ({
                id: employee.id,
                name: employee.name,
                rank: employee.rank,
                category: employee.category,
                fileNumber: employee.fileNumber,
                civilId: employee.civilId,
                department: employee.department,
                section: employee.section
            }));

        return {
            sourceFile: filePath,
            databasePath: dbPath,
            parsedEmployees: sourceEmployees.length,
            proposals,
            warnings,
            dbOnlyEmployees,
            departments: departmentOptions,
            sections: sectionOptions
        };
    } finally {
        await db.close();
    }
};

const buildPhoneSyncAnalysis = async (filePath: string, extractedRows?: ForceWordRow[]) => {
    const rows = extractedRows || await extractForceWordRows(filePath);
    const db = await getDb();
    try {
        const employees = await db.all('SELECT * FROM Employees');
        const sourceEmployees = parsePhoneSourceEmployees(rows);
        const byFile = new Map<string, any>();
        const byName = new Map<string, any>();
        employees.forEach((employee: any) => {
            if (employee.fileNumber) byFile.set(forceTextValue(employee.fileNumber), employee);
            const nameKey = normalizeForceMatchText(employee.name);
            if (nameKey && !byName.has(nameKey)) byName.set(nameKey, employee);
        });

        const proposals: ForceSyncProposal[] = [];
        const unmatched: ForceSourceEmployee[] = [];

        sourceEmployees.forEach((source) => {
            let matchedBy: string | null = null;
            let employee: any = null;
            if (source.fileNumber && byFile.has(source.fileNumber)) {
                employee = byFile.get(source.fileNumber);
                matchedBy = 'رقم الملف';
            } else {
                const nameKey = normalizeForceMatchText(source.name);
                if (nameKey && byName.has(nameKey)) {
                    employee = byName.get(nameKey);
                    matchedBy = 'الاسم';
                }
            }

            if (!employee) {
                unmatched.push(source);
                return;
            }

            const currentPhone = forceTextValue(employee.phone_number);
            const nextPhone = forceTextValue(source.phone_number);
            if (currentPhone === nextPhone) return;
            const reason: ForceSyncProposal['reason'] = !currentPhone
                ? 'missing_field'
                : nextPhone
                    ? 'different_field'
                    : 'different_field';
            proposals.push({
                id: `phone_${employee.id}_${source.sourceId}`,
                action: 'update',
                reason,
                employeeId: employee.id,
                employeeName: employee.name || source.name,
                category: employee.category || source.category,
                matchedBy,
                field: 'phone_number',
                label: 'رقم الهاتف',
                currentValue: currentPhone || null,
                suggestedValue: nextPhone || null,
                sourceValue: nextPhone || null,
                sourceEmployee: source,
                warning: !nextPhone && currentPhone
                    ? 'رقم الهاتف فارغ في الكشف. الموافقة تعني حذف الرقم الحالي من قاعدة البيانات.'
                    : null
            });
        });

        return {
            sourceFile: filePath,
            databasePath: dbPath,
            parsedEmployees: sourceEmployees.length,
            proposals,
            dbOnlyEmployees: unmatched.map((source) => ({
                id: source.sourceId,
                name: source.name,
                rank: source.rank,
                category: source.category,
                fileNumber: source.fileNumber,
                department: source.rawDepartmentText
            })),
            departments: [],
            sections: []
        };
    } finally {
        await db.close();
    }
};

type WordAnalyzeKind = 'auto' | 'force' | 'phones';

type WordAnalyzeFileRef = {
    filePath: string;
    sourceLabel: string;
    cleanup?: () => void;
};

const WORD_SYNC_TEMP_DIR = path.join(DATA_DIR, 'word-sync-temp');

const createWordAnalyzeError = (status: number, message: string) => Object.assign(new Error(message), { status });

const getWordExtension = (value: any) => path.extname(forceTextValue(value)).toLowerCase();

const assertWordExtension = (extension: string) => {
    if (!['.doc', '.docx'].includes(extension)) {
        throw createWordAnalyzeError(400, 'الملف يجب أن يكون بصيغة Word .doc أو .docx');
    }
};

const decodeHeaderValue = (value: any) => {
    const raw = Array.isArray(value) ? value[0] : value;
    if (!raw) return '';
    try {
        return decodeURIComponent(String(raw));
    } catch {
        return String(raw);
    }
};

const getWordAnalyzeRequestKind = (req: any): WordAnalyzeKind => {
    const headerKind = normalizeText(req.header?.('x-analysis-kind'));
    if (headerKind) return headerKind as WordAnalyzeKind;
    return normalizeText(req.body?.kind) as WordAnalyzeKind;
};

const resolveWordAnalyzeFile = (req: any): WordAnalyzeFileRef => {
    const body = req?.body;
    if (Buffer.isBuffer(body)) {
        const fileName = decodeHeaderValue(req.header?.('x-file-name')) || `word-${Date.now()}.docx`;
        const extension = getWordExtension(fileName);
        assertWordExtension(extension);
        if (!body.length) {
            throw createWordAnalyzeError(400, 'ملف Word المرفوع فارغ');
        }
        fs.mkdirSync(WORD_SYNC_TEMP_DIR, { recursive: true });
        const safeName = fileName.replace(/[^\u0600-\u06FFa-zA-Z0-9._-]+/g, '_').slice(0, 80);
        const tempPath = path.join(WORD_SYNC_TEMP_DIR, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeName || `upload${extension}`}`);
        fs.writeFileSync(tempPath, body);
        return {
            filePath: tempPath,
            sourceLabel: fileName,
            cleanup: () => {
                try {
                    fs.unlinkSync(tempPath);
                } catch {
                    // best effort cleanup
                }
            }
        };
    }

    const rawPath = normalizeText(body?.filePath);
    if (rawPath) {
        const resolvedPath = path.resolve(rawPath);
        assertWordExtension(path.extname(resolvedPath).toLowerCase());
        if (!fs.existsSync(resolvedPath)) {
            throw createWordAnalyzeError(404, 'ملف Word غير موجود');
        }
        return { filePath: resolvedPath, sourceLabel: path.basename(resolvedPath) };
    }

    const fileName = forceTextValue(body?.fileName) || `word-${Date.now()}.docx`;
    const extension = getWordExtension(fileName);
    assertWordExtension(extension);
    const rawBase64 = normalizeText(body?.fileBase64).replace(/^data:[^;]+;base64,/, '');
    if (!rawBase64) {
        throw createWordAnalyzeError(400, 'يرجى اختيار ملف Word للمطابقة');
    }

    let buffer: Buffer;
    try {
        buffer = Buffer.from(rawBase64, 'base64');
    } catch {
        throw createWordAnalyzeError(400, 'تعذر قراءة ملف Word المرفوع');
    }
    if (!buffer.length) {
        throw createWordAnalyzeError(400, 'ملف Word المرفوع فارغ');
    }

    fs.mkdirSync(WORD_SYNC_TEMP_DIR, { recursive: true });
    const safeName = fileName.replace(/[^\u0600-\u06FFa-zA-Z0-9._-]+/g, '_').slice(0, 80);
    const tempPath = path.join(WORD_SYNC_TEMP_DIR, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeName || `upload${extension}`}`);
    fs.writeFileSync(tempPath, buffer);
    return {
        filePath: tempPath,
        sourceLabel: fileName,
        cleanup: () => {
            try {
                fs.unlinkSync(tempPath);
            } catch {
                // best effort cleanup
            }
        }
    };
};

const detectWordAnalyzeKind = (rows: ForceWordRow[], sourceLabel: string): { kind: 'force' | 'phones'; reason: string } => {
    const headerText = normalizeForceMatchText(rows.map((row) => row.headers.join(' ')).join(' '));
    const fileNameText = normalizeForceMatchText(sourceLabel);
    const hasPhoneHeader = ['رقم الهاتف', 'الهاتف', 'النقال', 'الموبايل', 'تلفون'].some((keyword) =>
        headerText.includes(normalizeForceMatchText(keyword))
    );
    const hasForceHeader = ['الرتبة', 'رقم الملف', 'الرقم المدني', 'الدرجة الوظيفية', 'المؤهل العلمي', 'الإدارة'].some((keyword) =>
        headerText.includes(normalizeForceMatchText(keyword))
    );
    const phoneFileHint = ['هاتف', 'هواتف', 'ارقام', 'أرقام', 'تليفون', 'تلفون'].some((keyword) =>
        fileNameText.includes(normalizeForceMatchText(keyword))
    );
    const forceFileHint = ['قوه', 'قوة', 'كشف القوة', 'الاداره العامه', 'الإدارة العامة'].some((keyword) =>
        fileNameText.includes(normalizeForceMatchText(keyword))
    );

    if ((phoneFileHint || hasPhoneHeader) && !forceFileHint) {
        return { kind: 'phones', reason: phoneFileHint ? 'اسم الملف يدل على كشف أرقام الهواتف' : 'أعمدة الملف تحتوي على رقم الهاتف' };
    }
    if (forceFileHint || hasForceHeader) {
        return { kind: 'force', reason: forceFileHint ? 'اسم الملف يدل على كشف القوة' : 'أعمدة الملف تطابق كشف القوة' };
    }
    return { kind: 'force', reason: 'لم تظهر إشارة كافية لكشف الهواتف، تم اعتباره كشف قوة' };
};

const analyzeWordFileByKind = async (
    filePath: string,
    rows: ForceWordRow[],
    kind: 'force' | 'phones',
    metadata: { detectedKind?: 'force' | 'phones'; detectedReason?: string } = {}
) => {
    const analysis = kind === 'phones'
        ? await buildPhoneSyncAnalysis(filePath, rows)
        : await buildForceSyncAnalysis(filePath, rows);
    return {
        ...analysis,
        analysisKind: kind,
        analysisLabel: kind === 'phones' ? 'كشف أرقام الهواتف' : 'كشف قوة الإدارة العامة',
        ...metadata
    };
};

const LICENSE_AUDIT_FIELDS = [
    { key: 'licenseType', label: 'نوع الرخصة' },
    { key: 'licenseDate', label: 'تاريخ الرخصة' },
    { key: 'hours', label: 'عدد الساعات' },
    { key: 'permissionTime', label: 'وقت الاستئذان' },
    { key: 'notes', label: 'الملاحظات' }
];

// Database migration function
const migrateDatabase = async () => {
    log('[Migration] Starting database migration...');
    const db = await getDb();

    try {
        // List all tables in the database
        const allTables = await db.all("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
        log(`[Migration] Found ${allTables.length} tables in database:`);
        allTables.forEach((t: any) => log(`  - ${t.name}: ${t.sql ? t.sql.substring(0, 100) + '...' : 'no SQL'}`));

        // Check if Shifts table exists
        const shiftsTable = allTables.find((t: any) => t.name === 'Shifts');
        log(`[Migration] Shifts table exists: ${!!shiftsTable}`);

        if (shiftsTable) {
            // Check for paperCopyReceived column in Shifts table
            log('[Migration] Checking for paperCopyReceived column in Shifts table...');
            const shiftColumns = await db.all("PRAGMA table_info(Shifts);");
            log(`[Migration] Shifts table columns:`, shiftColumns.map((c: any) => c.name));

            const hasPaperCopyColumn = shiftColumns.some((col: any) => col.name === 'paperCopyReceived');
            log(`[Migration] paperCopyReceived column exists: ${hasPaperCopyColumn}`);

            if (!hasPaperCopyColumn) {
                log('[Migration] Adding paperCopyReceived column to Shifts table...');
                try {
                    await db.exec('ALTER TABLE Shifts ADD COLUMN paperCopyReceived BOOLEAN NOT NULL DEFAULT 0');
                    log('[Migration] Successfully added paperCopyReceived column');
                } catch (error) {
                    console.error('[Migration] Failed to add paperCopyReceived column:', error);
                }
            }

            // Check for title and notes columns
            const hasTitleColumn = shiftColumns.some((col: any) => col.name === 'title');
            if (!hasTitleColumn) {
                log('[Migration] Adding title column to Shifts table...');
                await db.exec('ALTER TABLE Shifts ADD COLUMN title TEXT');
            }

            const hasNotesColumn = shiftColumns.some((col: any) => col.name === 'notes');
            if (!hasNotesColumn) {
                log('[Migration] Adding notes column to Shifts table...');
                await db.exec('ALTER TABLE Shifts ADD COLUMN notes TEXT');
            }

            // Migration: Remove UNIQUE constraint on shiftDate to allow multiple shifts per day
            log('[Migration] Checking for UNIQUE constraint on shiftDate...');
            try {
                const tableInfo = await db.all('PRAGMA table_info(Shifts)');
                const shiftDateIndex = await db.all('PRAGMA index_list(Shifts)');

                // Check if there's a unique constraint on shiftDate
                const hasUniqueConstraint = shiftDateIndex.some((idx: any) => {
                    return idx.unique === 1 && idx.name.includes('shiftDate');
                });

                if (hasUniqueConstraint) {
                    log('[Migration] Found UNIQUE constraint on shiftDate, removing it...');
                    try {
                        // Rename the old table
                        await db.exec('ALTER TABLE Shifts RENAME TO Shifts_old');
                        // Create new table without UNIQUE constraint
                        await db.exec(`
                            CREATE TABLE Shifts (
                                id TEXT PRIMARY KEY,
                                shiftDate TEXT NOT NULL,
                                createdBy TEXT NOT NULL,
                                note TEXT,
                                createdAt TEXT,
                                paperCopyReceived BOOLEAN DEFAULT 0,
                                title TEXT,
                                notes TEXT
                            )
                        `);
                        // Copy data from old table (handle missing updatedAt column gracefully)
                        try {
                            await db.exec('INSERT INTO Shifts SELECT id, shiftDate, createdBy, note, createdAt, paperCopyReceived, title, notes FROM Shifts_old');
                        } catch (e) {
                            // If updatedAt column doesn't exist, try without it
                            await db.exec('INSERT INTO Shifts (id, shiftDate, createdBy, note, createdAt, paperCopyReceived, title, notes) SELECT id, shiftDate, createdBy, note, createdAt, COALESCE(paperCopyReceived, 0), title, notes FROM Shifts_old');
                        }
                        // Drop old table
                        await db.exec('DROP TABLE Shifts_old');
                        log('[Migration] Successfully removed UNIQUE constraint from Shifts table');
                    } catch (migrationError) {
                        console.error('[Migration] Error removing UNIQUE constraint:', migrationError);
                    }
                }
            } catch (constraintCheckError) {
                console.warn('[Migration] Could not check for UNIQUE constraint:', constraintCheckError);
            }
        } else {
            log('[Migration] Shifts table does not exist, skipping column check');
        }

        // Ensure ShiftDayExceptions table exists
        await db.exec(`
            CREATE TABLE IF NOT EXISTS ShiftDayExceptions (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL UNIQUE,
                reason TEXT NOT NULL,
                note TEXT,
                createdBy TEXT,
                createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_day_exceptions_date
            ON ShiftDayExceptions(date);
        `);

        // Check for enhanced Alerts table structure
        const alertsTable = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='Alerts';");
        log(`[Migration] Alerts table exists: ${!!alertsTable}`);

        if (alertsTable) {
            log('[Migration] Checking Alerts table structure...');
            const alertColumns = await db.all("PRAGMA table_info(Alerts);");
            log(`[Migration] Alerts table columns:`, alertColumns.map((c: any) => c.name));

            const hasEnhancedAlerts = alertColumns.some((col: any) => col.name === 'severity');
            log(`[Migration] Enhanced Alerts structure exists: ${hasEnhancedAlerts}`);

            if (!hasEnhancedAlerts) {
                log('[Migration] Migrating Alerts table to enhanced structure...');

                // Check if backup exists
                const backupExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='Alerts_backup';");
                if (!backupExists) {
                    log('[Migration] Creating backup of Alerts table...');
                    await db.exec('CREATE TABLE Alerts_backup AS SELECT * FROM Alerts;');
                    log('[Migration] Backup created successfully');
                } else {
                    log('[Migration] Backup table already exists, skipping backup');
                }

                // Create new enhanced Alerts table
                log('[Migration] Creating new enhanced Alerts table...');
                await db.exec(`
                    CREATE TABLE Alerts_new (
                        id TEXT PRIMARY KEY,
                        employeeId TEXT,
                        type TEXT NOT NULL,
                        dateTriggered TEXT NOT NULL,
                        status TEXT NOT NULL,
                        message TEXT NOT NULL,
                        severity TEXT NOT NULL DEFAULT 'medium',
                        title TEXT NOT NULL,
                        category TEXT NOT NULL DEFAULT 'shift',
                        actionUrl TEXT,
                        metadata TEXT,
                        expiresAt TEXT,
                        createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                        updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                        FOREIGN KEY (employeeId) REFERENCES Employees(id)
                    );
                `);
                log('[Migration] New Alerts table created');

                // Migrate old data if exists
                log('[Migration] Migrating data from old Alerts table...');
                const oldAlerts = await db.all('SELECT * FROM Alerts_backup');
                log(`[Migration] Found ${oldAlerts.length} alerts to migrate`);

                for (const alert of oldAlerts) {
                    await db.run(`
                        INSERT INTO Alerts_new 
                        (id, employeeId, type, dateTriggered, status, message, title, createdAt, updatedAt)
                        VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')), COALESCE(?, datetime('now','localtime')))
                    `, [
                        alert.id,
                        alert.employeeId,
                        alert.type,
                        alert.dateTriggered,
                        alert.status || 'new',
                        alert.message,
                        alert.title || alert.message,
                        alert.createdAt,
                        alert.updatedAt || alert.createdAt
                    ]);
                }

                // Drop old table and rename new one
                log('[Migration] Replacing old Alerts table with new one...');
                await db.exec('DROP TABLE IF EXISTS Alerts;');
                await db.exec('ALTER TABLE Alerts_new RENAME TO Alerts;');
                log('[Migration] Alerts table migration completed successfully');
            }

            // This block was buggy and redundant. The backup table is already handled inside the `!hasEnhancedAlerts` block.
            // await db.exec('DROP TABLE IF EXISTS Alerts_backup;');
        }

        // Check for NotificationSettings table
        const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='NotificationSettings';");
        if (tables.length === 0) {
            log('Creating NotificationSettings table...');
            await db.exec(`
                CREATE TABLE NotificationSettings (
                    id TEXT PRIMARY KEY,
                    userId TEXT NOT NULL,
                    emailNotifications INTEGER NOT NULL DEFAULT 1,
                    pushNotifications INTEGER NOT NULL DEFAULT 1,
                    shiftReminders INTEGER NOT NULL DEFAULT 1,
                    overdueAlerts INTEGER NOT NULL DEFAULT 1,
                    systemAlerts INTEGER NOT NULL DEFAULT 1,
                    reminderDays INTEGER NOT NULL DEFAULT 3,
                    overdueDays INTEGER NOT NULL DEFAULT 1,
                    quietHoursEnabled INTEGER NOT NULL DEFAULT 0,
                    quietHoursStart TEXT DEFAULT '22:00',
                    quietHoursEnd TEXT DEFAULT '08:00',
                    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                    updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
                );
            `);

            // Insert default settings
            await db.run(`
                INSERT INTO NotificationSettings (id, userId) VALUES ('default_user_settings', 'default_user')
            `);
        }

        // Ensure master data tables exist
        await db.exec(`
            CREATE TABLE IF NOT EXISTS Nationalities (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE
            );
        `);
        await db.exec(`
            CREATE TABLE IF NOT EXISTS JobTitles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                UNIQUE(name, category)
            );
        `);
        await db.exec(`
            CREATE TABLE IF NOT EXISTS Sections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                departmentId TEXT NOT NULL,
                UNIQUE(name, departmentId),
                FOREIGN KEY (departmentId) REFERENCES Departments(id)
            );
        `);

        // Ensure ProfessionalExtensions table exists
        await db.exec(`
            CREATE TABLE IF NOT EXISTS ProfessionalExtensions (
                id TEXT PRIMARY KEY,
                employeeId TEXT NOT NULL,
                decisionNumber TEXT,
                letterNumber TEXT,
                decisionDate TEXT,
                extensionStartDate TEXT NOT NULL,
                extensionEndDate TEXT NOT NULL,
                createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (employeeId) REFERENCES Employees(id)
            );
            CREATE INDEX IF NOT EXISTS idx_professional_extensions_employee
            ON ProfessionalExtensions(employeeId);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_professional_extensions_period
            ON ProfessionalExtensions(employeeId, extensionStartDate, extensionEndDate);
        `);

        // Ensure Employees table has new HR fields
        log('[Migration] Checking Employees table for new HR fields...');
        const employeeColumns = await db.all("PRAGMA table_info(Employees);");
        const hasEmpColumn = (name: string) => employeeColumns.some((col: any) => col.name === name);

        if (!hasEmpColumn('referenceNumber')) {
            log('[Migration] Adding referenceNumber column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN referenceNumber TEXT');
        }
        for (const columnName of ['firstName', 'secondName', 'thirdName', 'fourthName', 'familyName']) {
            if (!hasEmpColumn(columnName)) {
                log(`[Migration] Adding ${columnName} column to Employees table...`);
                await db.exec(`ALTER TABLE Employees ADD COLUMN ${columnName} TEXT`);
            }
        }
        try {
            const rowsForNamePartBackfill = await db.all(
                "SELECT id, name, firstName, secondName, thirdName, fourthName, familyName FROM Employees WHERE name IS NOT NULL AND name <> ''"
            );
            for (const row of rowsForNamePartBackfill || []) {
                const tokens = normalizeText(row.name).split(/\s+/).filter(Boolean);
                const hasLegacyTripleDuplicate = tokens.length === 3
                    && normalizeText(row.thirdName)
                    && normalizeText(row.thirdName) === normalizeText(row.familyName);
                const hasExistingParts = Boolean(
                    normalizeText(row.firstName) ||
                    normalizeText(row.secondName) ||
                    normalizeText(row.thirdName) ||
                    normalizeText(row.fourthName) ||
                    normalizeText(row.familyName)
                );
                if (hasExistingParts && !hasLegacyTripleDuplicate) {
                    continue;
                }
                const parts = splitEmployeeName(row.name);
                await db.run(
                    'UPDATE Employees SET firstName = ?, secondName = ?, thirdName = ?, fourthName = ?, familyName = ? WHERE id = ?',
                    [parts.firstName, parts.secondName, parts.thirdName, parts.fourthName, parts.familyName, row.id]
                );
            }
        } catch (error) {
            console.warn('[Migration] Unable to backfill employee name parts:', error);
        }
        if (!hasEmpColumn('civilId')) {
            log('[Migration] Adding civilId column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN civilId TEXT');
        }
        if (!hasEmpColumn('birthDate')) {
            log('[Migration] Adding birthDate column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN birthDate TEXT');
        }
        if (!hasEmpColumn('nationality')) {
            log('[Migration] Adding nationality column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN nationality TEXT');
        }
        if (!hasEmpColumn('nationalityArticleNumber')) {
            log('[Migration] Adding nationalityArticleNumber column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN nationalityArticleNumber TEXT');
        }
        if (!hasEmpColumn('nationalityIssueDate')) {
            log('[Migration] Adding nationalityIssueDate column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN nationalityIssueDate TEXT');
        }
        if (!hasEmpColumn('maritalStatus')) {
            log('[Migration] Adding maritalStatus column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN maritalStatus TEXT');
        }
        if (!hasEmpColumn('maritalStatusNote')) {
            log('[Migration] Adding maritalStatusNote column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN maritalStatusNote TEXT');
        }
        if (!hasEmpColumn('appointmentDecisionNumber')) {
            log('[Migration] Adding appointmentDecisionNumber column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN appointmentDecisionNumber TEXT');
        }
        if (!hasEmpColumn('appointmentDecisionDate')) {
            log('[Migration] Adding appointmentDecisionDate column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN appointmentDecisionDate TEXT');
        }
        if (!hasEmpColumn('militaryNumber')) {
            log('[Migration] Adding militaryNumber column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN militaryNumber TEXT');
        }
        if (!hasEmpColumn('hiringDate')) {
            log('[Migration] Adding hiringDate column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN hiringDate TEXT');
        }
        if (!hasEmpColumn('seniorityNumber')) {
            log('[Migration] Adding seniorityNumber column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN seniorityNumber TEXT');
        }
        if (!hasEmpColumn('section')) {
            log('[Migration] Adding section column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN section TEXT');
        }
        if (!hasEmpColumn('hasWeapon')) {
            log('[Migration] Adding hasWeapon column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN hasWeapon INTEGER NOT NULL DEFAULT 0');
        }
        if (!hasEmpColumn('weaponAttachments')) {
            log('[Migration] Adding weaponAttachments column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN weaponAttachments TEXT');
        }
        if (!hasEmpColumn('hasParking')) {
            log('[Migration] Adding hasParking column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN hasParking INTEGER NOT NULL DEFAULT 0');
        }
        if (!hasEmpColumn('parkingLocation')) {
            log('[Migration] Adding parkingLocation column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN parkingLocation TEXT');
        }
        if (!hasEmpColumn('parkingNumber')) {
            log('[Migration] Adding parkingNumber column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN parkingNumber TEXT');
        }
        if (!hasEmpColumn('includeInShifts')) {
            log('[Migration] Adding includeInShifts column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN includeInShifts INTEGER NOT NULL DEFAULT 1');
        }
        if (!hasEmpColumn('shiftNotes')) {
            log('[Migration] Adding shiftNotes column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN shiftNotes TEXT');
        }
        if (!hasEmpColumn('excludeFromStatistics')) {
            log('[Migration] Adding excludeFromStatistics column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN excludeFromStatistics INTEGER NOT NULL DEFAULT 0');
        }
        if (!hasEmpColumn('isSecondedOutsideGeneralAdministration')) {
            log('[Migration] Adding isSecondedOutsideGeneralAdministration column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN isSecondedOutsideGeneralAdministration INTEGER NOT NULL DEFAULT 0');
        }
        if (!hasEmpColumn('secondmentLocation')) {
            log('[Migration] Adding secondmentLocation column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN secondmentLocation TEXT');
        }
        if (!hasEmpColumn('manualOrder')) {
            log('[Migration] Adding manualOrder column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN manualOrder INTEGER');
        }
        if (!hasEmpColumn('reasonIfInactive')) {
            log('[Migration] Adding reasonIfInactive column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN reasonIfInactive TEXT');
        }
        if (!hasEmpColumn('inactiveDate')) {
            log('[Migration] Adding inactiveDate column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN inactiveDate TEXT');
        }
        if (!hasEmpColumn('gender')) {
            log('[Migration] Adding gender column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN gender TEXT');
        }
        if (!hasEmpColumn('hasEducationCertificate')) {
            log('[Migration] Adding hasEducationCertificate column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN hasEducationCertificate INTEGER NOT NULL DEFAULT 0');
        }
        if (!hasEmpColumn('educationCertificateType')) {
            log('[Migration] Adding educationCertificateType column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN educationCertificateType TEXT');
        }
        if (!hasEmpColumn('educationSpecialization')) {
            log('[Migration] Adding educationSpecialization column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN educationSpecialization TEXT');
        }
        if (!hasEmpColumn('jobGrade')) {
            log('[Migration] Adding jobGrade column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN jobGrade TEXT');
        }
        if (!hasEmpColumn('professionalGroup')) {
            log('[Migration] Adding professionalGroup column to Employees table...');
            await db.exec('ALTER TABLE Employees ADD COLUMN professionalGroup TEXT');
        }
        try {
            const professionalRows = await db.all(
                "SELECT id, jobTitle, professionalGroup FROM Employees WHERE category = 'مهنيين' AND (professionalGroup IS NULL OR professionalGroup = '')"
            );
            for (const row of professionalRows || []) {
                const inferred = inferProfessionalGroupFromJobTitle(row.jobTitle) || 'أخرى';
                await db.run('UPDATE Employees SET professionalGroup = ? WHERE id = ?', [inferred, row.id]);
            }
            if ((professionalRows || []).length) {
                log(`[Migration] Updated professionalGroup for ${professionalRows.length} employees`);
            }
        } catch (error) {
            console.warn('[Migration] Unable to backfill professionalGroup:', error);
        }

        const fileNumberColumn = employeeColumns.find((col: any) => col.name === 'fileNumber');
        const fileNumberNotNull = fileNumberColumn?.notnull === 1;
        if (fileNumberNotNull) {
            log('[Migration] Rebuilding Employees table to allow nullable fileNumber...');
            await db.exec(`
                CREATE TABLE IF NOT EXISTS Employees_new (
                    id TEXT PRIMARY KEY,
                    fileNumber TEXT UNIQUE,
                    name TEXT NOT NULL,
                    firstName TEXT,
                    secondName TEXT,
                    thirdName TEXT,
                    fourthName TEXT,
                    familyName TEXT,
                    category TEXT NOT NULL,
                    rank TEXT NOT NULL,
                    jobTitle TEXT NULL,
                    jobGrade TEXT NULL,
                    professionalGroup TEXT NULL,
                    department TEXT NOT NULL,
                    status TEXT NOT NULL,
                    monthlyShiftCount INTEGER,
                    reasonIfInactive TEXT,
                    inactiveDate TEXT,
                    phone_number TEXT,
                    referenceNumber TEXT,
                    civilId TEXT,
                    birthDate TEXT,
                    nationality TEXT,
                    nationalityArticleNumber TEXT,
                    nationalityIssueDate TEXT,
                    maritalStatus TEXT,
                    maritalStatusNote TEXT,
                    appointmentDecisionNumber TEXT,
                    appointmentDecisionDate TEXT,
                    gender TEXT,
                    hasEducationCertificate INTEGER NOT NULL DEFAULT 0,
                    educationCertificateType TEXT,
                    educationSpecialization TEXT,
                    militaryNumber TEXT,
                    hiringDate TEXT,
                    seniorityNumber TEXT,
                    section TEXT,
                    hasWeapon INTEGER NOT NULL DEFAULT 0,
                    weaponAttachments TEXT,
                    hasParking INTEGER NOT NULL DEFAULT 0,
                    parkingLocation TEXT,
                    parkingNumber TEXT,
                    includeInShifts INTEGER NOT NULL DEFAULT 1,
                    shiftNotes TEXT,
                    excludeFromStatistics INTEGER NOT NULL DEFAULT 0,
                    isSecondedOutsideGeneralAdministration INTEGER NOT NULL DEFAULT 0,
                    secondmentLocation TEXT,
                    manualOrder INTEGER,
                    FOREIGN KEY (rank) REFERENCES Ranks(name),
                    FOREIGN KEY (department) REFERENCES Departments(name)
                );
            `);

            await db.exec(`
                INSERT INTO Employees_new (
                    id, fileNumber, name, firstName, secondName, thirdName, fourthName, familyName, category, rank, jobTitle, jobGrade, professionalGroup, department, status, monthlyShiftCount, reasonIfInactive, inactiveDate, phone_number, referenceNumber, civilId, birthDate, nationality, nationalityArticleNumber, nationalityIssueDate, maritalStatus, maritalStatusNote, appointmentDecisionNumber, appointmentDecisionDate, gender, hasEducationCertificate, educationCertificateType, educationSpecialization, militaryNumber, hiringDate, seniorityNumber, section, hasWeapon, weaponAttachments, hasParking, parkingLocation, parkingNumber, includeInShifts, shiftNotes, excludeFromStatistics, isSecondedOutsideGeneralAdministration, secondmentLocation, manualOrder
                )
                SELECT id, fileNumber, name, firstName, secondName, thirdName, fourthName, familyName, category, rank, jobTitle, jobGrade, professionalGroup, department, status, monthlyShiftCount, reasonIfInactive, inactiveDate, phone_number, referenceNumber, civilId, birthDate, nationality, nationalityArticleNumber, nationalityIssueDate, maritalStatus, maritalStatusNote, appointmentDecisionNumber, appointmentDecisionDate, gender, hasEducationCertificate, educationCertificateType, educationSpecialization, militaryNumber, hiringDate, seniorityNumber, section, hasWeapon, weaponAttachments, hasParking, parkingLocation, parkingNumber, includeInShifts, shiftNotes, excludeFromStatistics, isSecondedOutsideGeneralAdministration, secondmentLocation, manualOrder
                FROM Employees;
            `);

            await db.exec('DROP TABLE Employees;');
            await db.exec('ALTER TABLE Employees_new RENAME TO Employees;');
            log('[Migration] Employees table rebuilt successfully.');
        }

        try {
            await db.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_fileNumber_unique
                ON Employees(fileNumber)
                WHERE fileNumber IS NOT NULL AND fileNumber <> '';
                CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_civilId_unique
                ON Employees(civilId)
                WHERE civilId IS NOT NULL AND civilId <> '';
                CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_referenceNumber_unique
                ON Employees(referenceNumber)
                WHERE referenceNumber IS NOT NULL AND referenceNumber <> '';
            `);
        } catch (error) {
            console.warn('[Migration] Unable to create unique indexes on Employees:', error);
        }

        try {
            // Backfill any legacy/invalid status values (e.g. "0") to a valid default.
            await db.exec(`
                UPDATE Employees
                SET status = LOWER(TRIM(status))
                WHERE status IS NOT NULL
                  AND TRIM(status) <> ''
                  AND LOWER(TRIM(status)) IN ('active', 'inactive')
                  AND status <> LOWER(TRIM(status));

                UPDATE Employees
                SET status = 'active',
                    reasonIfInactive = NULL,
                    inactiveDate = NULL
                WHERE status IS NULL
                  OR TRIM(status) = ''
                  OR LOWER(TRIM(status)) NOT IN ('active', 'inactive');
            `);
        } catch (error) {
            console.warn('[Migration] Unable to normalize Employees.status values:', error);
        }

        const civilianRank = await db.get("SELECT id FROM Ranks WHERE category = 'مدنيين' OR name = 'مدني'");
        if (!civilianRank) {
            log('[Migration] Adding default civilian rank...');
            await db.run(
                'INSERT INTO Ranks (id, name, category, "order") VALUES (?, ?, ?, ?)',
                [`rank_civil_${Date.now()}`, 'مدني', 'مدنيين', 1]
            );
        }

        // Check for AlertLog table
        const alertLogTables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='AlertLog';");
        if (alertLogTables.length === 0) {
            log('Creating AlertLog table...');
            await db.exec(`
                CREATE TABLE AlertLog (
                    id TEXT PRIMARY KEY,
                    alertId TEXT NOT NULL,
                    action TEXT NOT NULL,
                    timestamp TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                    details TEXT,
                    FOREIGN KEY (alertId) REFERENCES Alerts(id)
                );
            `);
        }

        await db.exec(`
            CREATE TABLE IF NOT EXISTS Licenses (
                id TEXT PRIMARY KEY,
                employeeId TEXT NOT NULL,
                licenseType TEXT NOT NULL,
                licenseDate TEXT NOT NULL,
                hours REAL,
                permissionTime TEXT,
                notes TEXT,
                month INTEGER NOT NULL,
                year INTEGER NOT NULL,
                createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (employeeId) REFERENCES Employees(id)
            );
            CREATE INDEX IF NOT EXISTS idx_licenses_employee
            ON Licenses(employeeId);
            CREATE INDEX IF NOT EXISTS idx_licenses_date
            ON Licenses(licenseDate);
        `);

        const licenseColumns = await db.all("PRAGMA table_info(Licenses);");
        const hasLicenseColumn = (name: string) => licenseColumns.some((col: any) => col.name === name);
        if (!hasLicenseColumn('permissionTime')) {
            log('[Migration] Adding permissionTime column to Licenses table...');
            await db.exec('ALTER TABLE Licenses ADD COLUMN permissionTime TEXT');
        }

        await db.exec(`
            CREATE TABLE IF NOT EXISTS AuditLog (
                id TEXT PRIMARY KEY,
                entityType TEXT NOT NULL,
                entityId TEXT NOT NULL,
                action TEXT NOT NULL,
                field TEXT,
                oldValue TEXT,
                newValue TEXT,
                message TEXT,
                metadata TEXT,
                createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_auditlog_entity
            ON AuditLog(entityType, entityId);
            CREATE INDEX IF NOT EXISTS idx_auditlog_created
            ON AuditLog(createdAt);
        `);

        const hideShiftsSetting = await db.get("SELECT id FROM Settings WHERE `key` = 'hide_shifts'");
        if (!hideShiftsSetting) {
            await db.run(
                'INSERT INTO Settings (id, `key`, value, description) VALUES (?, ?, ?, ?)',
                [`setting_hide_shifts_${Date.now()}`, 'hide_shifts', 'false', 'إخفاء نظام الخفارات في الواجهة']
            );
        }
        const hideLicensesSetting = await db.get("SELECT id FROM Settings WHERE `key` = 'hide_licenses'");
        if (!hideLicensesSetting) {
            await db.run(
                'INSERT INTO Settings (id, `key`, value, description) VALUES (?, ?, ?, ?)',
                [`setting_hide_licenses_${Date.now()}`, 'hide_licenses', 'false', 'إخفاء نظام الرخص في الواجهة']
            );
        }
        const excludeWeekendSetting = await db.get("SELECT id FROM Settings WHERE `key` = 'exclude_weekend_shifts'");
        if (!excludeWeekendSetting) {
            await db.run(
                'INSERT INTO Settings (id, `key`, value, description) VALUES (?, ?, ?, ?)',
                [`setting_exclude_weekend_shifts_${Date.now()}`, 'exclude_weekend_shifts', 'true', 'استثناء الجمعة والسبت من الخفارات']
            );
        }

        log('Database migration completed successfully.');
    } catch (error) {
        console.error('Failed to migrate database:', error);
    } finally {
        await db.close();
    }
};

// Test DB connection
app.get('/api/test-db', async (req, res) => {
    try {
        const db = await getDb();
        await db.get('SELECT 1');
        await db.close();
        res.status(200).send('Database connection successful!');
    } catch (error) {
        console.error('Database connection failed:', error);
        res.status(500).send('Database connection failed.');
    }
});

// ==================== Employees CRUD ====================
// Fetch Employees with their last shift date
// Fetch Employees with their last shift date
app.get('/api/employees', async (req, res) => {
    const db = await getDb();
    try {
        await db.run('BEGIN');
        const restriction = await loadDepartmentRestriction(db);

        // First, get all employees
        const employees = await db.all('SELECT * FROM Employees');
        const departments = await db.all('SELECT id, name FROM Departments');
        const sections = await db.all('SELECT id, name, departmentId FROM Sections');
        const departmentNameMap = new Map<string, string>();
        for (const dep of departments) {
            const key = normalizeOrgName(dep.name || '');
            if (key) departmentNameMap.set(key, dep.name);
        }
        const sectionNameMap = new Map<string, { name: string; departmentKey: string }>();
        for (const section of sections) {
            const departmentName = departments.find((dep) => dep.id === section.departmentId)?.name || '';
            const departmentKey = normalizeOrgName(departmentName);
            const sectionKey = normalizeOrgName(section.name || '');
            if (!sectionKey) continue;
            const mapKey = departmentKey ? `${departmentKey}__${sectionKey}` : sectionKey;
            sectionNameMap.set(mapKey, { name: section.name, departmentKey });
            if (!sectionNameMap.has(sectionKey)) {
                sectionNameMap.set(sectionKey, { name: section.name, departmentKey });
            }
        }

        const filteredEmployees: any[] = [];

        // For each employee, get their last shift date
        for (const employee of employees) {
            const employeeDeptKey = normalizeOrgName(employee.department || '');
            const canonicalDepartment = employeeDeptKey ? departmentNameMap.get(employeeDeptKey) : '';
            if (canonicalDepartment) {
                employee.department = canonicalDepartment;
            }
            const employeeSectionKey = normalizeOrgName(employee.section || '');
            if (employeeSectionKey) {
                const deptKeyForSection = canonicalDepartment
                    ? normalizeOrgName(canonicalDepartment)
                    : employeeDeptKey;
                const sectionMapKey = deptKeyForSection ? `${deptKeyForSection}__${employeeSectionKey}` : employeeSectionKey;
                const sectionEntry = sectionNameMap.get(sectionMapKey) || sectionNameMap.get(employeeSectionKey);
                if (sectionEntry) {
                    employee.section = sectionEntry.name;
                }
            }

            if (!isDepartmentAllowed(employee.department, restriction)) {
                continue;
            }
            const lastShift = await db.get(`
                SELECT s.shiftDate 
                FROM ShiftAssignments sa
                JOIN Shifts s ON sa.shiftId = s.id
                WHERE sa.employeeId = ?
                ORDER BY s.shiftDate DESC
                LIMIT 1
            `, [employee.id]);

            // Add lastShiftDate to the employee object
            employee.lastShiftDate = lastShift?.shiftDate || null;

            // Also get monthly shift count
            const currentDate = new Date();
            // Calculate the first and last day of the current month (inclusive)
            const firstDayOfMonth = new Date(Date.UTC(currentDate.getFullYear(), currentDate.getMonth(), 1))
                .toISOString()
                .slice(0, 10);
            const firstDayNextMonth = new Date(Date.UTC(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
                .toISOString()
                .slice(0, 10);

            // Count only the shifts that fall within the CURRENT calendar month
            const monthlyShifts = await db.get(
                `SELECT COUNT(*) as count
                 FROM ShiftAssignments sa
                 JOIN Shifts s ON sa.shiftId = s.id
                 WHERE sa.employeeId = ?
                   AND s.shiftDate >= ?
                   AND s.shiftDate < ?`,
                [employee.id, firstDayOfMonth, firstDayNextMonth]
            );

            employee.monthlyShiftCount = monthlyShifts?.count || 0;
            const includeInShiftsRaw = employee.includeInShifts;
            const hasEducationCertificateRaw = employee.hasEducationCertificate;
            const excludeFromStatisticsRaw = employee.excludeFromStatistics;
            const isSecondedOutsideRaw = employee.isSecondedOutsideGeneralAdministration;
            employee.hasWeapon = employee.hasWeapon === 1 || employee.hasWeapon === true || employee.hasWeapon === '1';
            employee.hasParking = employee.hasParking === 1 || employee.hasParking === true || employee.hasParking === '1';
            employee.hasEducationCertificate = hasEducationCertificateRaw === 1 || hasEducationCertificateRaw === true || hasEducationCertificateRaw === '1';
            employee.includeInShifts = includeInShiftsRaw === 0 || includeInShiftsRaw === '0' ? false : true;
            employee.excludeFromStatistics = excludeFromStatisticsRaw === 1 || excludeFromStatisticsRaw === true || excludeFromStatisticsRaw === '1';
            employee.isSecondedOutsideGeneralAdministration = isSecondedOutsideRaw === 1 || isSecondedOutsideRaw === true || isSecondedOutsideRaw === '1';
            if (!employee.isSecondedOutsideGeneralAdministration) {
                employee.secondmentLocation = null;
            }
            filteredEmployees.push(employee);
        }

        // Ensure extension settings exist
        const extensionSettingsDefaults = [
            {
                id: 'setting_extension_reminder_days',
                key: 'extension_reminder_days',
                value: '30',
                description: 'أيام التنبيه لتمديد المهنيين قبل الانتهاء (مثال: 90,60,30)'
            },
            {
                id: 'setting_extension_critical_days',
                key: 'extension_critical_days',
                value: '30',
                description: 'عدد الأيام للتنبيه الخطير لتمديد المهنيين'
            }
        ];

        for (const setting of extensionSettingsDefaults) {
            const existing = await db.get('SELECT id FROM Settings WHERE key = ?', [setting.key]);
            if (!existing) {
                await db.run(
                    'INSERT INTO Settings (id, key, value, description) VALUES (?, ?, ?, ?)',
                    [setting.id, setting.key, setting.value, setting.description]
                );
            }
        }

        await db.run('COMMIT');
        res.json(filteredEmployees);
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('Error fetching employees:', error);
        res.status(500).send('Error fetching employees.');
    } finally {
        await db.close();
    }
});

app.post('/api/force-word-sync/analyze', wordUploadRawParser, async (req, res) => {
    let fileRef: WordAnalyzeFileRef | null = null;
    try {
        fileRef = resolveWordAnalyzeFile(req);
        const rows = await extractForceWordRows(fileRef.filePath);
        const analysis = await analyzeWordFileByKind(fileRef.filePath, rows, 'force', {
            detectedKind: 'force',
            detectedReason: 'تم اختيار تحليل كشف القوة يدويًا'
        });
        res.json(analysis);
    } catch (error: any) {
        console.error('Error analyzing force Word file:', error);
        res.status(error?.status || 500).json({
            error: error?.status
                ? error.message
                : 'تعذر تحليل ملف Word. تأكد من أن Microsoft Word مثبت وأن الملف غير مفتوح بنافذة تمنع القراءة.',
            detail: error?.message || String(error)
        });
    } finally {
        fileRef?.cleanup?.();
    }
});

app.post('/api/phone-word-sync/analyze', wordUploadRawParser, async (req, res) => {
    let fileRef: WordAnalyzeFileRef | null = null;
    try {
        fileRef = resolveWordAnalyzeFile(req);
        const rows = await extractForceWordRows(fileRef.filePath);
        const analysis = await analyzeWordFileByKind(fileRef.filePath, rows, 'phones', {
            detectedKind: 'phones',
            detectedReason: 'تم اختيار تحليل أرقام الهواتف يدويًا'
        });
        res.json(analysis);
    } catch (error: any) {
        console.error('Error analyzing phone Word file:', error);
        res.status(error?.status || 500).json({
            error: error?.status
                ? error.message
                : 'تعذر تحليل ملف أرقام الهواتف. تأكد من أن Microsoft Word مثبت وأن الملف غير مفتوح بنافذة تمنع القراءة.',
            detail: error?.message || String(error)
        });
    } finally {
        fileRef?.cleanup?.();
    }
});

app.post('/api/word-sync/analyze', wordUploadRawParser, async (req, res) => {
    let fileRef: WordAnalyzeFileRef | null = null;
    try {
        fileRef = resolveWordAnalyzeFile(req);
        const rows = await extractForceWordRows(fileRef.filePath);
        const requestedKind = getWordAnalyzeRequestKind(req);
        const detected = requestedKind === 'force' || requestedKind === 'phones'
            ? {
                kind: requestedKind,
                reason: requestedKind === 'phones'
                    ? 'تم اختيار تحليل أرقام الهواتف يدويًا'
                    : 'تم اختيار تحليل كشف القوة يدويًا'
            }
            : detectWordAnalyzeKind(rows, fileRef.sourceLabel);
        const analysis = await analyzeWordFileByKind(fileRef.filePath, rows, detected.kind, {
            detectedKind: detected.kind,
            detectedReason: detected.reason
        });
        res.json(analysis);
    } catch (error: any) {
        console.error('Error auto analyzing Word file:', error);
        res.status(error?.status || 500).json({
            error: error?.status
                ? error.message
                : 'تعذر تحليل ملف Word. تأكد من أن Microsoft Word مثبت وأن الملف غير مفتوح بنافذة تمنع القراءة.',
            detail: error?.message || String(error)
        });
    } finally {
        fileRef?.cleanup?.();
    }
});

// Create a new employee
app.post('/api/employees', async (req, res) => {
    const {
        fileNumber,
        name,
        firstName,
        secondName,
        thirdName,
        fourthName,
        familyName,
        category,
        rank,
        jobTitle,
        jobGrade,
        professionalGroup,
        department,
        status,
        reasonIfInactive,
        phone_number,
        referenceNumber,
        civilId,
        birthDate,
        nationality,
        nationalityArticleNumber,
        nationalityIssueDate,
        maritalStatus,
        maritalStatusNote,
        appointmentDecisionNumber,
        appointmentDecisionDate,
        gender,
        hasEducationCertificate,
        educationCertificateType,
        educationSpecialization,
        militaryNumber,
        hiringDate,
        seniorityNumber,
        section,
        hasWeapon,
        weaponAttachments,
        hasParking,
        parkingLocation,
        parkingNumber,
        includeInShifts,
        shiftNotes,
        excludeFromStatistics,
        isSecondedOutsideGeneralAdministration,
        secondmentLocation,
        manualOrder
    } = req.body;
    const db = await getDb();
    try {
        const newId = `emp_${Date.now()}`;
        const boolToInt = (value: any, defaultValue = 0) =>
            value === undefined || value === null ? defaultValue : (value === true || value === 1 || value === '1' ? 1 : 0);
        const resolvedName = resolveEmployeeNameParts({ name, firstName, secondName, thirdName, fourthName, familyName }, name);
        const nameToUse = resolvedName.fullName;
        const statusToUse = normalizeText(status) || 'active';
        const inactiveDateToUse = statusToUse === 'inactive'
            ? new Date().toISOString().slice(0, 10)
            : null;
        const reasonIfInactiveToUse = statusToUse === 'inactive'
            ? normalizeOptionalText(reasonIfInactive)
            : null;
        const genderToUse = normalizeOptionalText(gender);
        const hasEducationCertificateValue = boolToInt(hasEducationCertificate);
        const educationCertificateTypeToUse = hasEducationCertificateValue
            ? (normalizeText(educationCertificateType) || null)
            : 'بدون شهادة';
        const educationSpecializationToUse = hasEducationCertificateValue
            ? normalizeOptionalText(educationSpecialization)
            : null;
        const categoryToUse = getCategoryOrDefault(category, DEFAULT_CATEGORY);
        const rankToUse = await resolveRank(db, categoryToUse, rank);
        const departmentToUse = await resolveDepartment(db, department);
        const professionalGroupToUse = categoryToUse === 'مهنيين'
            ? (normalizeProfessionalGroup(professionalGroup) || inferProfessionalGroupFromJobTitle(jobTitle) || 'أخرى')
            : null;
        const includeInShiftsValue = categoryToUse === 'مدنيين' ? 0 : boolToInt(includeInShifts, 1);
        const isSecondedOutsideValue = boolToInt(isSecondedOutsideGeneralAdministration, 0);
        const excludeFromStatisticsValue = boolToInt(
            excludeFromStatistics,
            isSecondedOutsideValue === 1 ? 1 : 0
        );
        const secondmentLocationToUse = isSecondedOutsideValue === 1
            ? normalizeOptionalText(secondmentLocation)
            : null;
        const fileNumberToUse = normalizeOptionalText(fileNumber);
        const civilIdToUse = normalizeOptionalText(civilId);
        const birthDateToUse = normalizeOptionalText(birthDate) || birthDateFromCivilId(civilIdToUse);
        const referenceNumberToUse = normalizeOptionalText(referenceNumber);
        const nationalityToUse = normalizeOptionalText(nationality);
        const nationalityArticleNumberToUse = normalizeOptionalText(nationalityArticleNumber);
        const nationalityIssueDateToUse = normalizeOptionalText(nationalityIssueDate);
        const maritalStatusToUse = normalizeOptionalText(maritalStatus);
        const isOtherMaritalStatus = maritalStatusToUse === 'أخرى' || maritalStatusToUse === 'اخرى';
        const maritalStatusNoteToUse = isOtherMaritalStatus ? normalizeOptionalText(maritalStatusNote) : null;
        const appointmentDecisionNumberToUse = normalizeOptionalText(appointmentDecisionNumber);
        const appointmentDecisionDateToUse = normalizeOptionalText(appointmentDecisionDate);

        if (isOtherMaritalStatus && !maritalStatusNoteToUse) {
            return res.status(400).json({
                error: 'يرجى كتابة ملاحظة للحالة الاجتماعية (أخرى)'
            });
        }

        const duplicateFields: string[] = [];
        if (fileNumberToUse) {
            const existingFile = await db.get('SELECT id FROM Employees WHERE fileNumber = ? LIMIT 1', [fileNumberToUse]);
            if (existingFile) duplicateFields.push(`رقم الملف (${fileNumberToUse})`);
        }
        if (civilIdToUse) {
            const existingCivil = await db.get('SELECT id FROM Employees WHERE civilId = ? LIMIT 1', [civilIdToUse]);
            if (existingCivil) duplicateFields.push(`الرقم المدني (${civilIdToUse})`);
        }
        if (referenceNumberToUse) {
            const existingRef = await db.get('SELECT id FROM Employees WHERE referenceNumber = ? LIMIT 1', [referenceNumberToUse]);
            if (existingRef) duplicateFields.push(`رقم المرجع (${referenceNumberToUse})`);
        }
        if (duplicateFields.length) {
            return res.status(409).json({
                error: `لا يمكن حفظ الموظف، البيانات التالية مستخدمة بالفعل: ${duplicateFields.join('، ')}`
            });
        }

        await db.run(
            `INSERT INTO Employees (id, fileNumber, name, firstName, secondName, thirdName, fourthName, familyName, category, rank, jobTitle, jobGrade, professionalGroup, department, status, monthlyShiftCount, reasonIfInactive, inactiveDate, phone_number, referenceNumber, civilId, birthDate, nationality, nationalityArticleNumber, nationalityIssueDate, maritalStatus, maritalStatusNote, appointmentDecisionNumber, appointmentDecisionDate, gender, hasEducationCertificate, educationCertificateType, educationSpecialization, militaryNumber, hiringDate, seniorityNumber, section, hasWeapon, weaponAttachments, hasParking, parkingLocation, parkingNumber, includeInShifts, shiftNotes, excludeFromStatistics, isSecondedOutsideGeneralAdministration, secondmentLocation)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                newId,
                fileNumberToUse,
                nameToUse,
                resolvedName.firstName,
                resolvedName.secondName,
                resolvedName.thirdName,
                resolvedName.fourthName,
                resolvedName.familyName,
                categoryToUse,
                rankToUse,
                normalizeOptionalText(jobTitle),
                normalizeOptionalText(jobGrade),
                professionalGroupToUse,
                departmentToUse,
                statusToUse,
                reasonIfInactiveToUse,
                inactiveDateToUse,
                normalizeOptionalText(phone_number),
                referenceNumberToUse,
                civilIdToUse,
                birthDateToUse,
                nationalityToUse,
                nationalityArticleNumberToUse,
                nationalityIssueDateToUse,
                maritalStatusToUse,
                maritalStatusNoteToUse,
                appointmentDecisionNumberToUse,
                appointmentDecisionDateToUse,
                genderToUse,
                hasEducationCertificateValue,
                educationCertificateTypeToUse,
                educationSpecializationToUse,
                normalizeOptionalText(militaryNumber),
                normalizeOptionalText(hiringDate),
                normalizeOptionalText(seniorityNumber),
                normalizeOptionalText(section),
                boolToInt(hasWeapon),
                normalizeOptionalText(weaponAttachments),
                boolToInt(hasParking),
                normalizeOptionalText(parkingLocation),
                normalizeOptionalText(parkingNumber),
                includeInShiftsValue,
                normalizeOptionalText(shiftNotes),
                excludeFromStatisticsValue,
                isSecondedOutsideValue,
                secondmentLocationToUse
            ]
        );
        await safeInsertAuditLog(db, {
            entityType: 'employee',
            entityId: newId,
            action: 'create',
            message: `تم إضافة الموظف ${rankToUse} / ${nameToUse}`,
            metadata: {
                name: nameToUse,
                rank: rankToUse,
                category: categoryToUse,
                department: departmentToUse || null
            }
        });
        res.status(201).json({ id: newId });
    } catch (error) {
        console.error('Error creating employee:', error);
        res.status(500).json({ error: 'فشل إنشاء الموظف' });
    } finally {
        await db.close();
    }
});

// Update an employee
app.put('/api/employees/:id', async (req, res) => {
    const { id } = req.params;
    const {
        fileNumber,
        name,
        firstName,
        secondName,
        thirdName,
        fourthName,
        familyName,
        category,
        rank,
        jobTitle,
        jobGrade,
        professionalGroup,
        department,
        status,
        reasonIfInactive,
        phone_number,
        referenceNumber,
        civilId,
        birthDate,
        nationality,
        nationalityArticleNumber,
        nationalityIssueDate,
        maritalStatus,
        maritalStatusNote,
        appointmentDecisionNumber,
        appointmentDecisionDate,
        gender,
        hasEducationCertificate,
        educationCertificateType,
        educationSpecialization,
        militaryNumber,
        hiringDate,
        seniorityNumber,
        section,
        hasWeapon,
        weaponAttachments,
        hasParking,
        parkingLocation,
        parkingNumber,
        includeInShifts,
        shiftNotes,
        excludeFromStatistics,
        isSecondedOutsideGeneralAdministration,
        secondmentLocation,
        manualOrder
    } = req.body;
    const db = await getDb();
    try {
        await ensureEmployeeManualOrderColumn(db);
        const existing = await db.get('SELECT * FROM Employees WHERE id = ?', [id]);
        if (!existing) {
            return res.status(404).json({ error: 'الموظف غير موجود' });
        }

        const boolToInt = (value: any, defaultValue = 0) =>
            value === undefined || value === null ? defaultValue : (value === true || value === 1 || value === '1' ? 1 : 0);

        const resolvedName = resolveEmployeeNameParts(
            { name, firstName, secondName, thirdName, fourthName, familyName },
            existing.name,
            existing
        );
        const nameToUse = resolvedName.fullName;
        const categoryToUse = getCategoryOrDefault(
            category !== undefined ? category : existing.category,
            category !== undefined ? DEFAULT_CATEGORY : (existing.category || DEFAULT_CATEGORY)
        );
        const rankToUse = await resolveRank(db, categoryToUse, rank !== undefined ? rank : existing.rank);
        const departmentToUse = await resolveDepartment(
            db,
            department !== undefined ? department : existing.department
        );
        const civilIdToUse = civilId !== undefined
            ? normalizeOptionalText(civilId)
            : normalizeOptionalText(existing.civilId);
        const fileNumberToUse = fileNumber !== undefined
            ? normalizeOptionalText(fileNumber)
            : normalizeOptionalText(existing.fileNumber);
        const referenceNumberToUse = referenceNumber !== undefined
            ? normalizeOptionalText(referenceNumber)
            : normalizeOptionalText(existing.referenceNumber);
        const statusToUse = status !== undefined
            ? (normalizeText(status) || 'active')
            : (normalizeText(existing.status) || 'active');
        const nowDate = new Date().toISOString().slice(0, 10);
        let inactiveDateToUse = existing.inactiveDate || null;
        if (statusToUse === 'inactive') {
            if (existing.status !== 'inactive' || !existing.inactiveDate) {
                inactiveDateToUse = nowDate;
            }
        } else {
            inactiveDateToUse = null;
        }
        const reasonIfInactiveToUse = statusToUse === 'inactive'
            ? (reasonIfInactive !== undefined
                ? normalizeOptionalText(reasonIfInactive)
                : normalizeOptionalText(existing.reasonIfInactive))
            : null;
        const genderToUse = gender !== undefined
            ? normalizeOptionalText(gender)
            : normalizeOptionalText(existing.gender);
        const hasEducationCertificateToUse = boolToInt(
            hasEducationCertificate !== undefined ? hasEducationCertificate : existing.hasEducationCertificate,
            existing.hasEducationCertificate ?? 0
        );
        const rawEducationType = educationCertificateType !== undefined
            ? normalizeText(educationCertificateType)
            : normalizeText(existing.educationCertificateType);
        const educationCertificateTypeToUse = hasEducationCertificateToUse
            ? (rawEducationType || null)
            : 'بدون شهادة';
        const educationSpecializationToUse = hasEducationCertificateToUse
            ? (educationSpecialization !== undefined
                ? normalizeOptionalText(educationSpecialization)
                : normalizeOptionalText(existing.educationSpecialization))
            : null;
        const includeInShiftsValue = categoryToUse === 'مدنيين'
            ? 0
            : boolToInt(includeInShifts, existing.includeInShifts ?? 1);
        const wasSecondedOutside = boolToInt(existing.isSecondedOutsideGeneralAdministration, 0);
        const isSecondedOutsideValue = boolToInt(
            isSecondedOutsideGeneralAdministration !== undefined
                ? isSecondedOutsideGeneralAdministration
                : existing.isSecondedOutsideGeneralAdministration,
            existing.isSecondedOutsideGeneralAdministration ?? 0
        );
        const existingExcludeFromStatistics = boolToInt(existing.excludeFromStatistics, 0);
        const excludeFromStatisticsValue = excludeFromStatistics !== undefined
            ? boolToInt(excludeFromStatistics, existingExcludeFromStatistics)
            : (wasSecondedOutside === 0 && isSecondedOutsideValue === 1
                ? 1
                : existingExcludeFromStatistics);

        const duplicateFields: string[] = [];
        if (fileNumberToUse) {
            const existingFile = await db.get('SELECT id FROM Employees WHERE fileNumber = ? AND id != ? LIMIT 1', [fileNumberToUse, id]);
            if (existingFile) duplicateFields.push(`رقم الملف (${fileNumberToUse})`);
        }
        if (civilIdToUse) {
            const existingCivil = await db.get('SELECT id FROM Employees WHERE civilId = ? AND id != ? LIMIT 1', [civilIdToUse, id]);
            if (existingCivil) duplicateFields.push(`الرقم المدني (${civilIdToUse})`);
        }
        if (referenceNumberToUse) {
            const existingRef = await db.get('SELECT id FROM Employees WHERE referenceNumber = ? AND id != ? LIMIT 1', [referenceNumberToUse, id]);
            if (existingRef) duplicateFields.push(`رقم المرجع (${referenceNumberToUse})`);
        }
        if (duplicateFields.length) {
            return res.status(409).json({
                error: `لا يمكن حفظ الموظف، البيانات التالية مستخدمة بالفعل: ${duplicateFields.join('، ')}`
            });
        }

        const jobTitleToUse = jobTitle !== undefined ? normalizeOptionalText(jobTitle) : normalizeOptionalText(existing.jobTitle);
        const professionalGroupRaw = professionalGroup !== undefined
            ? normalizeProfessionalGroup(professionalGroup)
            : normalizeProfessionalGroup(existing.professionalGroup);
        const inferredGroupFromJobTitle = inferProfessionalGroupFromJobTitle(
            jobTitle !== undefined ? jobTitle : existing.jobTitle
        );
        const professionalGroupToUse = categoryToUse === 'مهنيين'
            ? (professionalGroupRaw || inferredGroupFromJobTitle || 'أخرى')
            : null;
        const jobGradeToUse = jobGrade !== undefined ? normalizeOptionalText(jobGrade) : normalizeOptionalText(existing.jobGrade);
        const phoneNumberToUse = phone_number !== undefined ? normalizeOptionalText(phone_number) : normalizeOptionalText(existing.phone_number);
        const birthDateToUse = birthDate !== undefined
            ? normalizeOptionalText(birthDate)
            : (civilId !== undefined
                ? (birthDateFromCivilId(civilIdToUse) || normalizeOptionalText(existing.birthDate))
                : normalizeOptionalText(existing.birthDate));
        const nationalityToUse = nationality !== undefined ? normalizeOptionalText(nationality) : normalizeOptionalText(existing.nationality);
        const nationalityArticleNumberToUse = nationalityArticleNumber !== undefined
            ? normalizeOptionalText(nationalityArticleNumber)
            : normalizeOptionalText(existing.nationalityArticleNumber);
        const nationalityIssueDateToUse = nationalityIssueDate !== undefined
            ? normalizeOptionalText(nationalityIssueDate)
            : normalizeOptionalText(existing.nationalityIssueDate);
        const maritalStatusToUse = maritalStatus !== undefined
            ? normalizeOptionalText(maritalStatus)
            : normalizeOptionalText(existing.maritalStatus);
        const isOtherMaritalStatus = maritalStatusToUse === 'أخرى' || maritalStatusToUse === 'اخرى';
        const maritalStatusNoteToUse = isOtherMaritalStatus
            ? (maritalStatusNote !== undefined
                ? normalizeOptionalText(maritalStatusNote)
                : normalizeOptionalText(existing.maritalStatusNote))
            : null;
        const appointmentDecisionNumberToUse = appointmentDecisionNumber !== undefined
            ? normalizeOptionalText(appointmentDecisionNumber)
            : normalizeOptionalText(existing.appointmentDecisionNumber);
        const appointmentDecisionDateToUse = appointmentDecisionDate !== undefined
            ? normalizeOptionalText(appointmentDecisionDate)
            : normalizeOptionalText(existing.appointmentDecisionDate);
        const militaryNumberToUse = militaryNumber !== undefined ? normalizeOptionalText(militaryNumber) : normalizeOptionalText(existing.militaryNumber);
        const hiringDateToUse = hiringDate !== undefined ? normalizeOptionalText(hiringDate) : normalizeOptionalText(existing.hiringDate);
        const seniorityNumberToUse = seniorityNumber !== undefined ? normalizeOptionalText(seniorityNumber) : normalizeOptionalText(existing.seniorityNumber);
        const sectionToUse = section !== undefined ? normalizeOptionalText(section) : normalizeOptionalText(existing.section);
        const hasWeaponToUse = boolToInt(hasWeapon, existing.hasWeapon ?? 0);
        const weaponAttachmentsToUse = weaponAttachments !== undefined ? normalizeOptionalText(weaponAttachments) : normalizeOptionalText(existing.weaponAttachments);
        const hasParkingToUse = boolToInt(hasParking, existing.hasParking ?? 0);
        const parkingLocationToUse = parkingLocation !== undefined ? normalizeOptionalText(parkingLocation) : normalizeOptionalText(existing.parkingLocation);
        const parkingNumberToUse = parkingNumber !== undefined ? normalizeOptionalText(parkingNumber) : normalizeOptionalText(existing.parkingNumber);
        const shiftNotesToUse = shiftNotes !== undefined ? normalizeOptionalText(shiftNotes) : normalizeOptionalText(existing.shiftNotes);
        const secondmentLocationRaw = secondmentLocation !== undefined
            ? normalizeOptionalText(secondmentLocation)
            : normalizeOptionalText(existing.secondmentLocation);
        const secondmentLocationToUse = isSecondedOutsideValue === 1 ? secondmentLocationRaw : null;
        const manualOrderToUse = manualOrder !== undefined && manualOrder !== null && manualOrder !== ''
            ? Number(manualOrder)
            : existing.manualOrder;

        if (isOtherMaritalStatus && !maritalStatusNoteToUse) {
            return res.status(400).json({
                error: 'يرجى كتابة ملاحظة للحالة الاجتماعية (أخرى)'
            });
        }

        const beforeValues = {
            fileNumber: existing.fileNumber,
            name: existing.name,
            firstName: existing.firstName,
            secondName: existing.secondName,
            thirdName: existing.thirdName,
            fourthName: existing.fourthName,
            familyName: existing.familyName,
            category: existing.category,
            rank: existing.rank,
            jobTitle: existing.jobTitle,
            jobGrade: existing.jobGrade,
            professionalGroup: existing.professionalGroup,
            department: existing.department,
            section: existing.section,
            status: existing.status,
            reasonIfInactive: existing.reasonIfInactive,
            inactiveDate: existing.inactiveDate,
            phone_number: existing.phone_number,
            referenceNumber: existing.referenceNumber,
            civilId: existing.civilId,
            birthDate: existing.birthDate,
            nationality: existing.nationality,
            nationalityArticleNumber: existing.nationalityArticleNumber,
            nationalityIssueDate: existing.nationalityIssueDate,
            maritalStatus: existing.maritalStatus,
            maritalStatusNote: existing.maritalStatusNote,
            appointmentDecisionNumber: existing.appointmentDecisionNumber,
            appointmentDecisionDate: existing.appointmentDecisionDate,
            gender: existing.gender,
            hasEducationCertificate: existing.hasEducationCertificate,
            educationCertificateType: existing.educationCertificateType,
            educationSpecialization: existing.educationSpecialization,
            militaryNumber: existing.militaryNumber,
            hiringDate: existing.hiringDate,
            seniorityNumber: existing.seniorityNumber,
            hasWeapon: existing.hasWeapon,
            weaponAttachments: existing.weaponAttachments,
            hasParking: existing.hasParking,
            parkingLocation: existing.parkingLocation,
            parkingNumber: existing.parkingNumber,
            includeInShifts: existing.includeInShifts,
            shiftNotes: existing.shiftNotes,
            excludeFromStatistics: existing.excludeFromStatistics,
            isSecondedOutsideGeneralAdministration: existing.isSecondedOutsideGeneralAdministration,
            secondmentLocation: existing.secondmentLocation,
            manualOrder: existing.manualOrder
        };

        const afterValues = {
            fileNumber: fileNumberToUse,
            name: nameToUse,
            firstName: resolvedName.firstName,
            secondName: resolvedName.secondName,
            thirdName: resolvedName.thirdName,
            fourthName: resolvedName.fourthName,
            familyName: resolvedName.familyName,
            category: categoryToUse,
            rank: rankToUse,
            jobTitle: jobTitleToUse,
            jobGrade: jobGradeToUse,
            professionalGroup: professionalGroupToUse,
            department: departmentToUse,
            section: sectionToUse,
            status: statusToUse,
            reasonIfInactive: reasonIfInactiveToUse,
            inactiveDate: inactiveDateToUse,
            phone_number: phoneNumberToUse,
            referenceNumber: referenceNumberToUse || null,
            civilId: civilIdToUse || null,
            birthDate: birthDateToUse,
            nationality: nationalityToUse,
            nationalityArticleNumber: nationalityArticleNumberToUse,
            nationalityIssueDate: nationalityIssueDateToUse,
            maritalStatus: maritalStatusToUse,
            maritalStatusNote: maritalStatusNoteToUse,
            appointmentDecisionNumber: appointmentDecisionNumberToUse,
            appointmentDecisionDate: appointmentDecisionDateToUse,
            gender: genderToUse,
            hasEducationCertificate: hasEducationCertificateToUse,
            educationCertificateType: educationCertificateTypeToUse,
            educationSpecialization: educationSpecializationToUse,
            militaryNumber: militaryNumberToUse,
            hiringDate: hiringDateToUse,
            seniorityNumber: seniorityNumberToUse,
            hasWeapon: hasWeaponToUse,
            weaponAttachments: weaponAttachmentsToUse,
            hasParking: hasParkingToUse,
            parkingLocation: parkingLocationToUse,
            parkingNumber: parkingNumberToUse,
            includeInShifts: includeInShiftsValue,
            shiftNotes: shiftNotesToUse,
            excludeFromStatistics: excludeFromStatisticsValue,
            isSecondedOutsideGeneralAdministration: isSecondedOutsideValue,
            secondmentLocation: secondmentLocationToUse,
            manualOrder: Number.isFinite(manualOrderToUse) ? manualOrderToUse : null
        };

        const changes = buildAuditChanges(beforeValues, afterValues, EMPLOYEE_AUDIT_FIELDS);

        const result = await db.run(
            `UPDATE Employees SET fileNumber = ?, name = ?, firstName = ?, secondName = ?, thirdName = ?, fourthName = ?, familyName = ?, category = ?, rank = ?, jobTitle = ?, jobGrade = ?, professionalGroup = ?, department = ?, status = ?, reasonIfInactive = ?, inactiveDate = ?, phone_number = ?, referenceNumber = ?, civilId = ?, birthDate = ?, nationality = ?, nationalityArticleNumber = ?, nationalityIssueDate = ?, maritalStatus = ?, maritalStatusNote = ?, appointmentDecisionNumber = ?, appointmentDecisionDate = ?, gender = ?, hasEducationCertificate = ?, educationCertificateType = ?, educationSpecialization = ?, militaryNumber = ?, hiringDate = ?, seniorityNumber = ?, section = ?, hasWeapon = ?, weaponAttachments = ?, hasParking = ?, parkingLocation = ?, parkingNumber = ?, includeInShifts = ?, shiftNotes = ?, excludeFromStatistics = ?, isSecondedOutsideGeneralAdministration = ?, secondmentLocation = ?, manualOrder = ? WHERE id = ?`,
            [
                afterValues.fileNumber,
                afterValues.name,
                afterValues.firstName,
                afterValues.secondName,
                afterValues.thirdName,
                afterValues.fourthName,
                afterValues.familyName,
                afterValues.category,
                afterValues.rank,
                afterValues.jobTitle,
                afterValues.jobGrade,
                afterValues.professionalGroup,
                afterValues.department,
                afterValues.status,
                afterValues.reasonIfInactive,
                afterValues.inactiveDate,
                afterValues.phone_number,
                afterValues.referenceNumber,
                afterValues.civilId,
                afterValues.birthDate,
                afterValues.nationality,
                afterValues.nationalityArticleNumber,
                afterValues.nationalityIssueDate,
                afterValues.maritalStatus,
                afterValues.maritalStatusNote,
                afterValues.appointmentDecisionNumber,
                afterValues.appointmentDecisionDate,
                afterValues.gender,
                afterValues.hasEducationCertificate,
                afterValues.educationCertificateType,
                afterValues.educationSpecialization,
                afterValues.militaryNumber,
                afterValues.hiringDate,
                afterValues.seniorityNumber,
                afterValues.section,
                afterValues.hasWeapon,
                afterValues.weaponAttachments,
                afterValues.hasParking,
                afterValues.parkingLocation,
                afterValues.parkingNumber,
                afterValues.includeInShifts,
                afterValues.shiftNotes,
                afterValues.excludeFromStatistics,
                afterValues.isSecondedOutsideGeneralAdministration,
                afterValues.secondmentLocation,
                afterValues.manualOrder,
                id
            ]
        );
        if (result.changes === 0) {
            // لم يتم تغيير أي صف، نعتبر العملية ناجحة
            return res.json({ success: true, updated: 0 });
        }
        if (changes.length) {
            for (const change of changes) {
                await safeInsertAuditLog(db, {
                    entityType: 'employee',
                    entityId: id,
                    action: 'update',
                    field: change.field,
                    oldValue: change.oldValue,
                    newValue: change.newValue,
                    message: `تم تعديل ${change.label} للموظف ${rankToUse} / ${nameToUse}`,
                    metadata: {
                        label: change.label,
                        name: nameToUse,
                        rank: rankToUse
                    }
                });
            }
        }
        res.json({ success: true });
    } catch (error) {
        console.error(`Error updating employee ${id}:`, error);
        res.status(500).json({ error: 'فشل تحديث بيانات الموظف' });
    } finally {
        await db.close();
    }
});

const updateEmployeesManualOrderHandler = async (req: express.Request, res: express.Response) => {
    const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : [];
    const cleanIds = orderedIds.map((id: any) => normalizeText(id)).filter(Boolean);
    if (!cleanIds.length) {
        return res.status(400).json({ error: 'لا توجد قائمة ترتيب صالحة' });
    }
    const db = await getDb();
    let transactionStarted = false;
    try {
        await ensureEmployeeManualOrderColumn(db);
        await db.run('BEGIN TRANSACTION');
        transactionStarted = true;
        for (let index = 0; index < cleanIds.length; index += 1) {
            await db.run('UPDATE Employees SET manualOrder = ? WHERE id = ?', [index + 1, cleanIds[index]]);
        }
        await safeInsertAuditLog(db, {
            entityType: 'employee',
            entityId: 'manual-order',
            action: 'update',
            field: 'manualOrder',
            message: `تم تحديث الترتيب اليدوي للموظفين (${cleanIds.length})`,
            metadata: { count: cleanIds.length }
        });
        await db.run('COMMIT');
        res.json({ success: true, updated: cleanIds.length });
    } catch (error) {
        if (transactionStarted) {
            await db.run('ROLLBACK');
        }
        console.error('Error updating employee manual order:', error);
        const details = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: `فشل حفظ ترتيب الموظفين: ${details}` });
    } finally {
        await db.close();
    }
};

app.patch('/api/employees/manual-order', updateEmployeesManualOrderHandler);
app.put('/api/employees/manual-order', updateEmployeesManualOrderHandler);
app.post('/api/employees/manual-order', updateEmployeesManualOrderHandler);

// Delete an employee
app.delete('/api/employees/:id', async (req, res) => {
    const { id } = req.params;
    const db = await getDb();
    try {
        const existing = await db.get('SELECT id, name, rank, category, department FROM Employees WHERE id = ?', [id]);
        await db.run('DELETE FROM Licenses WHERE employeeId = ?', [id]);
        const result = await db.run('DELETE FROM Employees WHERE id = ?', [id]);
        if (result.changes === 0) {
            // لم يتم تغيير أي صف، نعتبر العملية ناجحة
            return res.json({ success: true, updated: 0 });
        }
        await safeInsertAuditLog(db, {
            entityType: 'employee',
            entityId: id,
            action: 'delete',
            message: existing
                ? `تم حذف الموظف ${existing.rank || ''} / ${existing.name || ''}`.trim()
                : 'تم حذف الموظف',
            metadata: existing ? {
                name: existing.name,
                rank: existing.rank,
                category: existing.category,
                department: existing.department
            } : null
        });
        res.json({ success: true });
    } catch (error) {
        console.error(`Error deleting employee ${id}:`, error);
        res.status(500).json({ error: 'Failed to delete employee' });
    } finally {
        await db.close();
    }
});

// ==================== Professional Extensions ====================
app.get('/api/professional-extensions/status', async (_req, res) => {
    const db = await getDb();
    try {
        const settingsRows = await db.all(`
            SELECT key, value FROM Settings
            WHERE key IN ('extension_reminder_days', 'extension_critical_days')
        `);
        const settingsMap: { [key: string]: string } = {};
        settingsRows.forEach((row: any) => {
            settingsMap[row.key] = row.value;
        });

        const reminderDays = parseExtensionReminderDays(settingsMap.extension_reminder_days, [30]);
        const criticalDays = parseInt(settingsMap.extension_critical_days || '30', 10);
        const reminderWindow = reminderDays.length ? Math.max(...reminderDays) : 30;

        const restriction = await loadDepartmentRestriction(db);
        const employeesRaw = await db.all(`
            SELECT * FROM Employees
            WHERE category = 'مهنيين'
            AND birthDate IS NOT NULL
        `);
        const employees = (employeesRaw || []).filter((emp: any) => isDepartmentAllowed(emp.department, restriction));

        if (!employees.length) {
            return res.json({
                reminderDays,
                criticalDays: Number.isFinite(criticalDays) ? criticalDays : 30,
                approaching: [],
                extended: [],
                notExtended: [],
                archive: []
            });
        }

        const employeeIds = employees.map((emp: any) => emp.id);
        const placeholders = employeeIds.map(() => '?').join(',');
        const extensions = await db.all(
            `SELECT * FROM ProfessionalExtensions WHERE employeeId IN (${placeholders})`,
            employeeIds
        );

        const extensionMap = new Map<string, any[]>();
        extensions.forEach((ext: any) => {
            const list = extensionMap.get(ext.employeeId) || [];
            list.push(ext);
            extensionMap.set(ext.employeeId, list);
        });

        const today = getTodayUtc();
        const approaching: any[] = [];
        const extended: any[] = [];
        const notExtended: any[] = [];
        const archive: any[] = [];

        const buildExtensionItem = (employee: any, extension: any) => {
            const endDate = parseDateOnly(extension.extensionEndDate);
            const daysRemaining = endDate ? diffInDays(today, endDate) : 0;
            return {
                employee,
                status: 'extended',
                stage: 'renewal',
                periodStart: extension.extensionStartDate,
                periodEnd: extension.extensionEndDate,
                dueDate: extension.extensionEndDate,
                daysRemaining,
                extension,
                suggestedStartDate: extension.extensionStartDate,
                suggestedEndDate: extension.extensionEndDate
            };
        };

        for (const employee of employees) {
            const employeeExtensions = extensionMap.get(employee.id) || [];
            const status = computeExtensionStatusForEmployee(employee, employeeExtensions, today);
            const hasExtensions = employeeExtensions.length > 0;

            if (employee.status === 'inactive') {
                if (hasExtensions) {
                    employeeExtensions.forEach((ext) => {
                        archive.push(buildExtensionItem(employee, ext));
                    });
                }
                continue;
            }

            if (hasExtensions) {
                employeeExtensions.forEach((ext) => {
                    extended.push(buildExtensionItem(employee, ext));
                });
            }

            if (!status) {
                continue;
            }

            const item = { employee, ...status };

            if (status.status === 'not_extended') {
                notExtended.push(item);
            }

            if (status.daysRemaining >= 0 && status.daysRemaining <= reminderWindow) {
                approaching.push(item);
            }
        }

        res.json({
            reminderDays,
            criticalDays: Number.isFinite(criticalDays) ? criticalDays : 30,
            approaching,
            extended,
            notExtended,
            archive
        });
    } catch (error) {
        console.error('Error fetching professional extension status:', error);
        res.status(500).json({ error: 'Failed to fetch professional extension status' });
    } finally {
        await db.close();
    }
});

app.post('/api/professional-extensions', async (req, res) => {
    const {
        employeeId,
        decisionNumber,
        letterNumber,
        decisionDate,
        extensionStartDate,
        extensionEndDate
    } = req.body;

    if (!employeeId || !extensionStartDate || !extensionEndDate) {
        return res.status(400).json({ error: 'employeeId, extensionStartDate, and extensionEndDate are required' });
    }

    const startDate = parseDateOnly(extensionStartDate);
    const endDate = parseDateOnly(extensionEndDate);
    if (!startDate || !endDate || startDate > endDate) {
        return res.status(400).json({ error: 'Invalid extension dates' });
    }

    const db = await getDb();
    try {
        const employee = await db.get('SELECT id, category FROM Employees WHERE id = ?', [employeeId]);
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        if (employee.category !== 'مهنيين') {
            return res.status(400).json({ error: 'Employee is not in professional category' });
        }

        const id = `ext_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        await db.run(
            `INSERT INTO ProfessionalExtensions (
                id, employeeId, decisionNumber, letterNumber, decisionDate,
                extensionStartDate, extensionEndDate, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
            [
                id,
                employeeId,
                decisionNumber || null,
                letterNumber || null,
                decisionDate || null,
                extensionStartDate,
                extensionEndDate
            ]
        );

        res.status(201).json({
            id,
            employeeId,
            decisionNumber: decisionNumber || null,
            letterNumber: letterNumber || null,
            decisionDate: decisionDate || null,
            extensionStartDate,
            extensionEndDate
        });
    } catch (error) {
        console.error('Error creating professional extension:', error);
        res.status(500).json({ error: 'Failed to create professional extension' });
    } finally {
        await db.close();
    }
});

app.put('/api/professional-extensions/:id', async (req, res) => {
    const { id } = req.params;
    const {
        decisionNumber,
        letterNumber,
        decisionDate,
        extensionStartDate,
        extensionEndDate
    } = req.body;

    const db = await getDb();
    try {
        const existing = await db.get('SELECT * FROM ProfessionalExtensions WHERE id = ?', [id]);
        if (!existing) {
            return res.status(404).json({ error: 'Extension not found' });
        }

        const startDateValue = extensionStartDate || existing.extensionStartDate;
        const endDateValue = extensionEndDate || existing.extensionEndDate;
        const startDate = parseDateOnly(startDateValue);
        const endDate = parseDateOnly(endDateValue);
        if (!startDate || !endDate || startDate > endDate) {
            return res.status(400).json({ error: 'Invalid extension dates' });
        }

        const updates: string[] = [];
        const params: any[] = [];

        if (decisionNumber !== undefined) {
            updates.push('decisionNumber = ?');
            params.push(decisionNumber || null);
        }
        if (letterNumber !== undefined) {
            updates.push('letterNumber = ?');
            params.push(letterNumber || null);
        }
        if (decisionDate !== undefined) {
            updates.push('decisionDate = ?');
            params.push(decisionDate || null);
        }
        if (extensionStartDate !== undefined) {
            updates.push('extensionStartDate = ?');
            params.push(extensionStartDate);
        }
        if (extensionEndDate !== undefined) {
            updates.push('extensionEndDate = ?');
            params.push(extensionEndDate);
        }

        if (!updates.length) {
            return res.json({ success: true, updated: 0 });
        }

        updates.push('updatedAt = datetime("now","localtime")');
        params.push(id);

        await db.run(
            `UPDATE ProfessionalExtensions SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        res.json({ success: true });
    } catch (error) {
        console.error(`Error updating professional extension ${id}:`, error);
        res.status(500).json({ error: 'Failed to update professional extension' });
    } finally {
        await db.close();
    }
});

app.delete('/api/professional-extensions/:id', async (req, res) => {
    const { id } = req.params;
    const db = await getDb();
    try {
        const result = await db.run('DELETE FROM ProfessionalExtensions WHERE id = ?', [id]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Extension not found' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error(`Error deleting professional extension ${id}:`, error);
        res.status(500).json({ error: 'Failed to delete professional extension' });
    } finally {
        await db.close();
    }
});


// Fetch Departments
app.get('/api/departments', async (req, res) => {
    try {
        const db = await getDb();
        const rows = await db.all('SELECT * FROM Departments');
        await db.close();
        res.json(rows);
    } catch (error) {
        console.error('Error fetching departments:', error);
        res.status(500).send('Error fetching departments.');
    }
});

// Create a new department
app.post('/api/departments', async (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Department name is required' });
    }

    const db = await getDb();
    try {
        const newId = `dep_${Date.now()}`;
        await db.run('INSERT INTO Departments (id, name) VALUES (?, ?)', [newId, name]);
        res.status(201).json({ id: newId, name });
    } catch (error) {
        console.error('Error creating department:', error);
        res.status(500).json({ error: 'Failed to create department' });
    } finally {
        await db.close();
    }
});

// Update a department
app.put('/api/departments/:id', async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;

    const nameToUse = normalizeText(name);
    if (!nameToUse) {
        return res.status(400).json({ error: 'Department name is required' });
    }

    const db = await getDb();
    try {
        const existing = await db.get('SELECT name FROM Departments WHERE id = ?', [id]);
        if (!existing) {
            return res.status(404).json({ error: 'Department not found' });
        }
        const oldName = existing.name;
        if (oldName === nameToUse) {
            return res.json({ id, name: oldName });
        }
        const allDepartments = await db.all('SELECT id, name FROM Departments');
        const normalizedName = normalizeOrgName(nameToUse);
        const conflict = allDepartments.find((dep: { id: string; name: string }) =>
            dep.id !== id && normalizeOrgName(dep.name) === normalizedName
        );
        if (conflict) {
            return res.status(409).json({ error: 'اسم الإدارة موجود مسبقاً، يرجى اختيار اسم مختلف.' });
        }

        const result = await db.run('UPDATE Departments SET name = ? WHERE id = ?', [nameToUse, id]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Department not found' });
        }
        const oldKey = normalizeOrgName(oldName);
        if (oldKey) {
            const employeesToUpdate = await db.all('SELECT id, department FROM Employees WHERE department IS NOT NULL AND department <> ""');
            for (const emp of employeesToUpdate) {
                const currentKey = normalizeOrgName(emp.department || '');
                if (currentKey === oldKey) {
                    await db.run('UPDATE Employees SET department = ? WHERE id = ?', [nameToUse, emp.id]);
                }
            }
        }
        res.json({ id, name: nameToUse });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error updating department ${id}:`, error);
        if (message.includes('UNIQUE constraint failed: Departments.name')) {
            return res.status(409).json({ error: 'اسم الإدارة موجود مسبقاً، يرجى اختيار اسم مختلف.' });
        }
        res.status(500).json({ error: 'Failed to update department' });
    } finally {
        await db.close();
    }
});

// Delete a department
app.delete('/api/departments/:id', async (req, res) => {
    const { id } = req.params;
    const db = await getDb();
    try {
        // Check if any employee is associated with this department
        const department = await db.get('SELECT name FROM Departments WHERE id = ?', [id]);
        if (!department) {
            return res.status(404).json({ error: 'Department not found' });
        }

        const employee = await db.get('SELECT id FROM Employees WHERE department = ?', [department.name]);
        if (employee) {
            return res.status(400).json({ error: 'لا يمكن حذف الإدارة لوجود موظفين مرتبطين بها. يرجى نقلهم أولاً.' });
        }

        const result = await db.run('DELETE FROM Departments WHERE id = ?', [id]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Department not found' });
        }
        res.json({ success: true, message: 'Department deleted successfully' });
    } catch (error) {
        console.error(`Error deleting department ${id}:`, error);
        res.status(500).json({ error: 'فشل في حذف الإدارة' });
    } finally {
        await db.close();
    }
});

// ==================== Sections (department sub-sections) ====================
app.get('/api/sections', async (_req, res) => {
    try {
        const db = await getDb();
        const rows = await db.all('SELECT * FROM Sections');
        await db.close();
        res.json(rows);
    } catch (error) {
        console.error('Error fetching sections:', error);
        res.status(500).send('Error fetching sections.');
    }
});

app.post('/api/sections', async (req, res) => {
    const { name, departmentId } = req.body;
    if (!name || !departmentId) return res.status(400).json({ error: 'Section name and department are required' });
    const db = await getDb();
    try {
        const newId = `sec_${Date.now()}`;
        await db.run('INSERT INTO Sections (id, name, departmentId) VALUES (?, ?, ?)', [newId, name, departmentId]);
        res.status(201).json({ id: newId, name, departmentId });
    } catch (error) {
        console.error('Error creating section:', error);
        res.status(500).json({ error: 'Failed to create section' });
    } finally {
        await db.close();
    }
});

app.put('/api/sections/:id', async (req, res) => {
    const { id } = req.params;
    const { name, departmentId } = req.body;
    if (!name || !departmentId) return res.status(400).json({ error: 'Section name and department are required' });
    const db = await getDb();
    try {
        const existing = await db.get('SELECT name, departmentId FROM Sections WHERE id = ?', [id]);
        if (!existing) return res.status(404).json({ error: 'Section not found' });
        const previousDepartment = await db.get('SELECT name FROM Departments WHERE id = ?', [existing.departmentId]);
        const previousDepartmentName = previousDepartment?.name || '';

        const result = await db.run('UPDATE Sections SET name = ?, departmentId = ? WHERE id = ?', [name, departmentId, id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Section not found' });

        const oldSectionKey = normalizeOrgName(existing.name);
        const oldDepartmentKey = normalizeOrgName(previousDepartmentName);
        const newDepartment = await db.get('SELECT name FROM Departments WHERE id = ?', [departmentId]);
        const newDepartmentName = newDepartment?.name || '';

        if (oldSectionKey) {
            const employeesToUpdate = await db.all('SELECT id, department, section FROM Employees WHERE section IS NOT NULL AND section <> ""');
            for (const emp of employeesToUpdate) {
                const sectionKey = normalizeOrgName(emp.section || '');
                const departmentKey = normalizeOrgName(emp.department || '');
                if (sectionKey === oldSectionKey && (!oldDepartmentKey || departmentKey === oldDepartmentKey)) {
                    await db.run('UPDATE Employees SET section = ?, department = ? WHERE id = ?', [
                        name,
                        newDepartmentName || emp.department,
                        emp.id
                    ]);
                }
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error(`Error updating section ${id}:`, error);
        res.status(500).json({ error: 'Failed to update section' });
    } finally {
        await db.close();
    }
});

app.delete('/api/sections/:id', async (req, res) => {
    const { id } = req.params;
    const db = await getDb();
    try {
        const result = await db.run('DELETE FROM Sections WHERE id = ?', [id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Section not found' });
        res.json({ success: true });
    } catch (error) {
        console.error(`Error deleting section ${id}:`, error);
        res.status(500).json({ error: 'Failed to delete section' });
    } finally {
        await db.close();
    }
});

// ==================== Nationalities ====================
app.get('/api/nationalities', async (_req, res) => {
    try {
        const db = await getDb();
        const rows = await db.all('SELECT * FROM Nationalities');
        await db.close();
        res.json(rows);
    } catch (error) {
        console.error('Error fetching nationalities:', error);
        res.status(500).send('Error fetching nationalities.');
    }
});

app.post('/api/nationalities', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Nationality name is required' });
    const db = await getDb();
    try {
        const newId = `nat_${Date.now()}`;
        await db.run('INSERT INTO Nationalities (id, name) VALUES (?, ?)', [newId, name]);
        res.status(201).json({ id: newId, name });
    } catch (error) {
        console.error('Error creating nationality:', error);
        res.status(500).json({ error: 'Failed to create nationality' });
    } finally {
        await db.close();
    }
});

app.put('/api/nationalities/:id', async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Nationality name is required' });
    const db = await getDb();
    try {
        const result = await db.run('UPDATE Nationalities SET name = ? WHERE id = ?', [name, id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Nationality not found' });
        res.json({ success: true });
    } catch (error) {
        console.error(`Error updating nationality ${id}:`, error);
        res.status(500).json({ error: 'Failed to update nationality' });
    } finally {
        await db.close();
    }
});

app.delete('/api/nationalities/:id', async (req, res) => {
    const { id } = req.params;
    const db = await getDb();
    try {
        const result = await db.run('DELETE FROM Nationalities WHERE id = ?', [id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Nationality not found' });
        res.json({ success: true });
    } catch (error) {
        console.error(`Error deleting nationality ${id}:`, error);
        res.status(500).json({ error: 'Failed to delete nationality' });
    } finally {
        await db.close();
    }
});

// ==================== Job Titles / Positions ====================
app.get('/api/job-titles', async (_req, res) => {
    try {
        const db = await getDb();
        const rows = await db.all('SELECT * FROM JobTitles');
        await db.close();
        res.json(rows);
    } catch (error) {
        console.error('Error fetching job titles:', error);
        res.status(500).send('Error fetching job titles.');
    }
});

app.post('/api/job-titles', async (req, res) => {
    const { name, category } = req.body;
    if (!name || !category) return res.status(400).json({ error: 'Job title and category are required' });
    const db = await getDb();
    try {
        const newId = `job_${Date.now()}`;
        await db.run('INSERT INTO JobTitles (id, name, category) VALUES (?, ?, ?)', [newId, name, category]);
        res.status(201).json({ id: newId, name, category });
    } catch (error) {
        console.error('Error creating job title:', error);
        res.status(500).json({ error: 'Failed to create job title' });
    } finally {
        await db.close();
    }
});

app.put('/api/job-titles/:id', async (req, res) => {
    const { id } = req.params;
    const { name, category } = req.body;
    if (!name || !category) return res.status(400).json({ error: 'Job title and category are required' });
    const db = await getDb();
    try {
        const result = await db.run('UPDATE JobTitles SET name = ?, category = ? WHERE id = ?', [name, category, id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Job title not found' });
        res.json({ success: true });
    } catch (error) {
        console.error(`Error updating job title ${id}:`, error);
        res.status(500).json({ error: 'Failed to update job title' });
    } finally {
        await db.close();
    }
});

app.delete('/api/job-titles/:id', async (req, res) => {
    const { id } = req.params;
    const db = await getDb();
    try {
        const result = await db.run('DELETE FROM JobTitles WHERE id = ?', [id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Job title not found' });
        res.json({ success: true });
    } catch (error) {
        console.error(`Error deleting job title ${id}:`, error);
        res.status(500).json({ error: 'Failed to delete job title' });
    } finally {
        await db.close();
    }
});
// Fetch Ranks
app.get('/api/ranks', async (req, res) => {
    try {
        const db = await getDb();
        const rows = await db.all('SELECT * FROM Ranks');
        await db.close();
        const categoryOrder: Record<string, number> = { 'ضباط': 1, 'ضباط صف': 2, 'مهنيين': 3, 'مدنيين': 4 };
        const sorted = rows
            .map((row: any) => {
                const derivedOrder = getRankOrder(row.name, row.category);
                const orderValue = derivedOrder === Number.MAX_SAFE_INTEGER ? 999 : derivedOrder;
                return { ...row, order: orderValue };
            })
            .sort((a: any, b: any) => {
                const catDiff = (categoryOrder[a.category] || Number.MAX_SAFE_INTEGER)
                    - (categoryOrder[b.category] || Number.MAX_SAFE_INTEGER);
                if (catDiff !== 0) return catDiff;
                const orderDiff = (a.order || 999) - (b.order || 999);
                if (orderDiff !== 0) return orderDiff;
                return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
            });
        res.json(sorted);
    } catch (error) {
        console.error('Error fetching ranks:', error);
        res.status(500).send('Error fetching ranks.');
    }
});

// Create a new rank
app.post('/api/ranks', async (req, res) => {
    const { name, category } = req.body;
    if (!name || !category) {
        return res.status(400).json({ error: 'Rank name and category are required' });
    }
    const db = await getDb();
    try {
        const newId = `rank_${Date.now()}`;
        const derivedOrder = getRankOrder(name.trim(), category);
        const orderValue = derivedOrder === Number.MAX_SAFE_INTEGER ? 999 : derivedOrder;
        await db.run('INSERT INTO Ranks (id, name, category, "order") VALUES (?, ?, ?, ?)', [
            newId,
            name.trim(),
            category,
            orderValue
        ]);
        res.status(201).json({ id: newId, name: name.trim(), category, order: orderValue });
    } catch (error) {
        console.error('Error creating rank:', error);
        res.status(500).json({ error: 'Failed to create rank' });
    } finally {
        await db.close();
    }
});

// Update a rank
app.put('/api/ranks/:id', async (req, res) => {
    const { id } = req.params;
    const { name, category } = req.body;
    if (!name || !category) {
        return res.status(400).json({ error: 'Rank name and category are required' });
    }
    const db = await getDb();
    try {
        const derivedOrder = getRankOrder(name.trim(), category);
        const orderValue = derivedOrder === Number.MAX_SAFE_INTEGER ? 999 : derivedOrder;
        const result = await db.run(
            'UPDATE Ranks SET name = ?, category = ?, "order" = ? WHERE id = ?',
            [name.trim(), category, orderValue, id]
        );
        if (result.changes === 0) return res.status(404).json({ error: 'Rank not found' });
        res.json({ id, name: name.trim(), category, order: orderValue });
    } catch (error) {
        console.error('Error updating rank:', error);
        res.status(500).json({ error: 'Failed to update rank' });
    } finally {
        await db.close();
    }
});

// Delete a rank
app.delete('/api/ranks/:id', async (req, res) => {
    const { id } = req.params;
    const db = await getDb();
    try {
        // Prevent deleting rank that is used by employees
        const rankRow = await db.get('SELECT name FROM Ranks WHERE id = ?', [id]);
        if (!rankRow) {
            return res.status(404).json({ error: 'Rank not found' });
        }
        const employeeUsing = await db.get('SELECT id FROM Employees WHERE rank = ? LIMIT 1', [rankRow.name]);
        if (employeeUsing) {
            return res.status(400).json({ error: 'Cannot delete rank while it is assigned to employees' });
        }
        const result = await db.run('DELETE FROM Ranks WHERE id = ?', [id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Rank not found' });
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting rank:', error);
        res.status(500).json({ error: 'Failed to delete rank' });
    } finally {
        await db.close();
    }
});

// Fetch Shifts
// Fetch Shifts by Month
app.get('/api/shifts/month', async (req, res) => {
    const { year, month } = req.query;

    if (!year || !month) {
        return res.status(400).json({ error: 'Year and month query parameters are required' });
    }

    const yearNum = parseInt(year as string, 10);
    // The frontend's getMonth() is 0-indexed, so we expect a 0-11 value.
    const monthNum = parseInt(month as string, 10);

    // Create ISO date strings for the start and end of the month in UTC
    const startDate = new Date(Date.UTC(yearNum, monthNum, 1));
    const endDate = new Date(Date.UTC(yearNum, monthNum + 1, 1));

    const startDateString = startDate.toISOString().slice(0, 10);
    const endDateString = endDate.toISOString().slice(0, 10);

    const db = await getDb();
    try {
        const rows = await db.all(
            'SELECT * FROM Shifts WHERE shiftDate >= ? AND shiftDate < ? ORDER BY shiftDate DESC',
            [startDateString, endDateString]
        );
        res.json(rows);
    } catch (error) {
        console.error('Error fetching shifts by month:', error);
        res.status(500).json({ error: 'Failed to fetch shifts for the selected month' });
    } finally {
        await db.close();
    }
});

// Check if a shift exists for a given date
app.get('/api/shifts/exists', async (req, res) => {
    const { date } = req.query;

    if (!date || typeof date !== 'string') {
        return res.status(400).json({ error: 'Date query parameter is required and must be a string.' });
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format.' });
    }

    const normalizedDate = normalizeDateOnly(date);
    if (!normalizedDate) {
        return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format.' });
    }

    const db = await getDb();
    try {
        const result = await db.get('SELECT COUNT(*) as count FROM Shifts WHERE shiftDate = ?', [normalizedDate]);
        const count = result?.count || 0;
        const exceptionalDay = await db.get('SELECT * FROM ShiftDayExceptions WHERE date = ?', [normalizedDate]);
        res.json({
            exists: count > 0,
            count,
            exceptional: !!exceptionalDay,
            exceptionalDay: exceptionalDay || null
        });
    } catch (error) {
        console.error('Error checking for existing shift:', error);
        res.status(500).json({ error: 'Failed to check for existing shift' });
    } finally {
        await db.close();
    }
});

// Fetch shift day exceptions (optional date range)
app.get('/api/shift-day-exceptions', async (req, res) => {
    const { date, from, to } = req.query as { date?: string; from?: string; to?: string };
    const db = await getDb();
    try {
        if (date) {
            const normalizedDate = normalizeDateOnly(date);
            if (!normalizedDate) {
                return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format.' });
            }
            const row = await db.get('SELECT * FROM ShiftDayExceptions WHERE date = ?', [normalizedDate]);
            return res.json(row || null);
        }

        const conditions: string[] = [];
        const params: any[] = [];
        if (from) {
            const normalizedFrom = normalizeDateOnly(from);
            if (!normalizedFrom) {
                return res.status(400).json({ error: 'From date must be in YYYY-MM-DD format.' });
            }
            conditions.push('date >= ?');
            params.push(normalizedFrom);
        }
        if (to) {
            const normalizedTo = normalizeDateOnly(to);
            if (!normalizedTo) {
                return res.status(400).json({ error: 'To date must be in YYYY-MM-DD format.' });
            }
            conditions.push('date <= ?');
            params.push(normalizedTo);
        }
        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = await db.all(
            `SELECT * FROM ShiftDayExceptions ${whereClause} ORDER BY date DESC`,
            params
        );
        res.json(rows);
    } catch (error) {
        console.error('Error fetching shift day exceptions:', error);
        res.status(500).json({ error: 'Failed to fetch shift day exceptions' });
    } finally {
        await db.close();
    }
});

// Create a new shift day exception
app.post('/api/shift-day-exceptions', async (req, res) => {
    const { date, reason, note, createdBy } = req.body || {};
    if (!date || !reason) {
        return res.status(400).json({ error: 'date and reason are required' });
    }

    const normalizedDate = normalizeDateOnly(date);
    if (!normalizedDate) {
        return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format.' });
    }

    const db = await getDb();
    try {
        const existingShift = await db.get('SELECT id FROM Shifts WHERE shiftDate = ? LIMIT 1', [normalizedDate]);
        if (existingShift) {
            return res.status(409).json({ error: 'يوجد خفارة مسجلة في هذا التاريخ. احذف الخفارة أولاً أو اختر تاريخًا آخر.' });
        }

        const existingException = await db.get('SELECT id FROM ShiftDayExceptions WHERE date = ? LIMIT 1', [normalizedDate]);
        if (existingException) {
            return res.status(409).json({ error: 'هذا اليوم مسجل بالفعل كاستثناء.' });
        }

        const id = `shift_day_exception_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const reasonValue = normalizeOptionalText(reason);
        if (!reasonValue) {
            return res.status(400).json({ error: 'reason is required' });
        }
        const noteValue = normalizeOptionalText(note);
        const createdByValue = normalizeOptionalText(createdBy) || 'النظام';

        await db.run(
            `INSERT INTO ShiftDayExceptions (id, date, reason, note, createdBy, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
            [id, normalizedDate, reasonValue, noteValue, createdByValue]
        );

        const created = await db.get('SELECT * FROM ShiftDayExceptions WHERE id = ?', [id]);
        await safeInsertAuditLog(db, {
            entityType: 'shift_day_exception',
            entityId: id,
            action: 'create',
            message: `تم تسجيل يوم استثنائي بتاريخ ${normalizedDate}`,
            metadata: {
                date: normalizedDate,
                reason: reasonValue,
                createdBy: createdByValue
            }
        });

        res.status(201).json(created);
    } catch (error) {
        console.error('Error creating shift day exception:', error);
        res.status(500).json({ error: 'Failed to create shift day exception' });
    } finally {
        await db.close();
    }
});

// Update a shift day exception
app.put('/api/shift-day-exceptions/:id', async (req, res) => {
    const { id } = req.params;
    const { reason, note } = req.body || {};

    if (!id) {
        return res.status(400).json({ error: 'Exception ID is required' });
    }

    const db = await getDb();
    try {
        const existing = await db.get('SELECT * FROM ShiftDayExceptions WHERE id = ?', [id]);
        if (!existing) {
            return res.status(404).json({ error: 'Exception day not found' });
        }

        const reasonValue = reason !== undefined ? normalizeOptionalText(reason) : existing.reason;
        const noteValue = note !== undefined ? normalizeOptionalText(note) : existing.note;
        if (!reasonValue) {
            return res.status(400).json({ error: 'reason is required' });
        }

        await db.run(
            `UPDATE ShiftDayExceptions
             SET reason = ?, note = ?, updatedAt = datetime('now','localtime')
             WHERE id = ?`,
            [reasonValue, noteValue, id]
        );

        const updated = await db.get('SELECT * FROM ShiftDayExceptions WHERE id = ?', [id]);
        const changes = buildAuditChanges(
            { reason: existing.reason, note: existing.note },
            { reason: updated.reason, note: updated.note },
            [
                { key: 'reason', label: 'سبب الاستثناء' },
                { key: 'note', label: 'ملاحظات الاستثناء' }
            ]
        );

        for (const change of changes) {
            await safeInsertAuditLog(db, {
                entityType: 'shift_day_exception',
                entityId: id,
                action: 'update',
                field: change.field,
                oldValue: change.oldValue,
                newValue: change.newValue,
                message: `تم تحديث ${change.label} ليوم استثنائي بتاريخ ${existing.date}`,
                metadata: {
                    date: existing.date,
                    label: change.label
                }
            });
        }

        res.json(updated);
    } catch (error) {
        console.error('Error updating shift day exception:', error);
        res.status(500).json({ error: 'Failed to update shift day exception' });
    } finally {
        await db.close();
    }
});

// Delete a shift day exception
app.delete('/api/shift-day-exceptions/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ error: 'Exception ID is required' });
    }

    const db = await getDb();
    try {
        const existing = await db.get('SELECT * FROM ShiftDayExceptions WHERE id = ?', [id]);
        if (!existing) {
            return res.status(404).json({ error: 'Exception day not found' });
        }

        await db.run('DELETE FROM ShiftDayExceptions WHERE id = ?', [id]);
        await safeInsertAuditLog(db, {
            entityType: 'shift_day_exception',
            entityId: id,
            action: 'delete',
            message: `تم حذف يوم استثنائي بتاريخ ${existing.date}`,
            metadata: {
                date: existing.date,
                reason: existing.reason
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting shift day exception:', error);
        res.status(500).json({ error: 'Failed to delete shift day exception' });
    } finally {
        await db.close();
    }
});

app.get('/api/shifts', async (req, res) => {
    try {
        const db = await getDb();
        const rows = await db.all('SELECT * FROM Shifts ORDER BY shiftDate DESC');
        await db.close();
        res.json(rows);
    } catch (error) {
        console.error('Error fetching shifts:', error);
        res.status(500).send('Error fetching shifts');
    }
});

// Delete a shift
app.delete('/api/shifts/:id', async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: 'Shift ID is required' });
    }

    const db = await getDb();
    try {
        // First check if shift exists
        const shift = await db.get('SELECT id, shiftDate, createdBy, title FROM Shifts WHERE id = ?', [id]);
        if (!shift) {
            return res.status(404).json({ error: 'Shift not found' });
        }

        // Delete shift assignments first (foreign key constraint)
        await db.run('DELETE FROM ShiftAssignments WHERE shiftId = ?', [id]);

        // Delete the shift
        await db.run('DELETE FROM Shifts WHERE id = ?', [id]);

        await safeInsertAuditLog(db, {
            entityType: 'shift',
            entityId: id,
            action: 'delete',
            message: `تم حذف خفارة بتاريخ ${shift.shiftDate}`,
            metadata: {
                shiftDate: shift.shiftDate,
                createdBy: shift.createdBy,
                title: shift.title || null
            }
        });

        res.json({ message: 'Shift deleted successfully' });
    } catch (error) {
        console.error('Error deleting shift:', error);
        res.status(500).json({ error: 'Failed to delete shift' });
    } finally {
        await db.close();
    }
});

// Update shift title and notes
app.put('/api/shifts/:id/details', async (req, res) => {
    const { id } = req.params;
    const { title, notes } = req.body;

    // We allow sending null to clear the fields
    if (title === undefined && notes === undefined) {
        return res.status(400).json({ error: 'Either title or notes must be provided' });
    }

    const db = await getDb();
    try {
        // Fetch the current shift to update only provided fields
        const currentShift = await db.get('SELECT title, notes, shiftDate FROM Shifts WHERE id = ?', [id]);
        if (!currentShift) {
            return res.status(404).json({ error: 'Shift not found' });
        }

        const newTitle = title !== undefined ? title : currentShift.title;
        const newNotes = notes !== undefined ? notes : currentShift.notes;

        const result = await db.run(
            'UPDATE Shifts SET title = ?, notes = ? WHERE id = ?',
            [newTitle, newNotes, id]
        );

        if (result.changes === 0) {
            // This might happen if the submitted data is the same as the existing data
            // We can still return success
            const sameShift = await db.get('SELECT * FROM Shifts WHERE id = ?', id);
            return res.json(sameShift);
        }

        const updatedShift = await db.get('SELECT * FROM Shifts WHERE id = ?', id);
        const changeFields = buildAuditChanges(
            { title: currentShift.title, notes: currentShift.notes },
            { title: updatedShift.title, notes: updatedShift.notes },
            [
                { key: 'title', label: 'عنوان الخفارة' },
                { key: 'notes', label: 'ملاحظات الخفارة' }
            ]
        );
        if (changeFields.length) {
            for (const change of changeFields) {
                await safeInsertAuditLog(db, {
                    entityType: 'shift',
                    entityId: id,
                    action: 'update',
                    field: change.field,
                    oldValue: change.oldValue,
                    newValue: change.newValue,
                    message: `تم تعديل ${change.label} (تاريخ ${currentShift.shiftDate})`,
                    metadata: {
                        label: change.label,
                        shiftDate: currentShift.shiftDate
                    }
                });
            }
        }
        res.json(updatedShift);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error updating shift details:', errorMessage);
        res.status(500).json({ error: `Failed to update shift details: ${errorMessage}` });
    } finally {
        await db.close();
    }
});

app.put('/api/shifts/:id/reception', async (req, res) => {
    const { id } = req.params;
    const { paperCopyReceived } = req.body;

    if (!id) {
        return res.status(400).json({ error: 'Shift ID is required' });
    }

    if (typeof paperCopyReceived !== 'boolean') {
        return res.status(400).json({ error: 'paperCopyReceived must be a boolean' });
    }

    const db = await getDb();
    try {
        const existingShift = await db.get('SELECT id FROM Shifts WHERE id = ?', [id]);
        if (!existingShift) {
            return res.status(404).json({ error: 'Shift not found' });
        }

        await db.run('UPDATE Shifts SET paperCopyReceived = ? WHERE id = ?', [paperCopyReceived ? 1 : 0, id]);
        const updatedShift = await db.get('SELECT * FROM Shifts WHERE id = ?', [id]);
        return res.json(updatedShift);
    } catch (error) {
        console.error('Error updating shift reception status:', error);
        return res.status(500).json({ error: 'Failed to update shift reception status' });
    } finally {
        await db.close();
    }
});

// Create a new shift with assignments
app.post('/api/shifts', async (req, res) => {
    const { shiftDate, createdBy, title, notes, assignments } = req.body;

    if (!shiftDate || !createdBy) {
        return res.status(400).json({ error: 'Shift date and createdBy are required' });
    }

    const normalizedShiftDate = normalizeDateOnly(shiftDate);
    if (!normalizedShiftDate) {
        return res.status(400).json({ error: 'Shift date must be in YYYY-MM-DD format.' });
    }

    const db = await getDb();
    try {
        await db.run('BEGIN');
        const existingExceptionDay = await db.get(
            'SELECT id, reason FROM ShiftDayExceptions WHERE date = ?',
            [normalizedShiftDate]
        );
        if (existingExceptionDay) {
            await db.run('ROLLBACK');
            return res.status(409).json({
                error: 'لا يمكن تسجيل خفارة في يوم استثنائي. يرجى إزالة الاستثناء أو اختيار تاريخ آخر.'
            });
        }

        const restriction = await loadDepartmentRestriction(db);
        if (restriction.enabled && restriction.departmentKey && Array.isArray(assignments)) {
            for (const assignment of assignments) {
                const row = await db.get('SELECT department FROM Employees WHERE id = ? LIMIT 1', [assignment.employeeId]);
                if (!row || !isDepartmentAllowed(row.department, restriction)) {
                    await db.run('ROLLBACK');
                    return res.status(403).json({ error: 'غير مسموح بتسجيل خفارة لموظفين خارج الإدارة المحددة' });
                }
            }
        }

        // Create the shift
        const shiftId = `shift_${Date.now()}`;
        await db.run(
            'INSERT INTO Shifts (id, shiftDate, createdBy, title, notes, createdAt) VALUES (?, ?, ?, ?, ?, datetime(\'now\',\'localtime\'))',
            [shiftId, normalizedShiftDate, createdBy, title || null, notes || null]
        );

        // Add shift assignments
        if (Array.isArray(assignments)) {
            for (const assignment of assignments) {
                await db.run(
                    'INSERT INTO ShiftAssignments (id, shiftId, employeeId, status, counted, note, addedAt) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\',\'localtime\'))',
                    [
                        `assign_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                        shiftId,
                        assignment.employeeId,
                        assignment.status || 'attended',
                        assignment.counted ? 1 : 0,
                        assignment.note || null
                    ]
                );
            }
        }

        await db.run('COMMIT');
        await safeInsertAuditLog(db, {
            entityType: 'shift',
            entityId: shiftId,
            action: 'create',
            message: `تم إضافة خفارة بتاريخ ${normalizedShiftDate}`,
            metadata: {
                shiftDate: normalizedShiftDate,
                createdBy,
                title: title || null,
                assignmentsCount: Array.isArray(assignments) ? assignments.length : 0
            }
        });
        res.status(201).json({ success: true, shiftId });
    } catch (error) {
        try {
            await db.run('ROLLBACK');
        } catch (rollbackError) {
            console.error('Error during rollback:', rollbackError);
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error creating shift:', errorMessage);

        // Check for specific SQLite errors
        if (errorMessage.includes('UNIQUE constraint failed')) {
            res.status(409).json({ error: 'خفارة موجودة بالفعل في هذا التاريخ. يرجى اختيار تاريخ آخر.' });
        } else if (errorMessage.includes('FOREIGN KEY constraint failed')) {
            res.status(400).json({ error: 'موظف أو بيانات غير صحيحة. يرجى التحقق من البيانات المدخلة.' });
        } else {
            res.status(500).json({ error: 'Failed to create shift', details: errorMessage });
        }
    } finally {
        await db.close();
    }
});

// List all shift assignments
app.get('/api/shiftassignments', async (req, res) => {
    try {
        const db = await getDb();
        const restriction = await loadDepartmentRestriction(db);
        const rows = await db.all(`
            SELECT sa.*, e.department as employeeDepartment
            FROM ShiftAssignments sa
            LEFT JOIN Employees e ON e.id = sa.employeeId
        `);
        const filtered = (rows || []).filter((row: any) => isDepartmentAllowed(row.employeeDepartment, restriction));
        const cleaned = filtered.map(({ employeeDepartment, ...rest }: any) => rest);
        await db.close();
        res.json(cleaned);
    } catch (error) {
        console.error('Error fetching shift assignments:', error);
        res.status(500).send('Error fetching shift assignments.');
    }
});

// Create a new assignment for an existing shift (add employee to shift)
app.post('/api/shiftassignments', async (req, res) => {
    const { shiftId, employeeId, status, counted, note } = req.body as {
        shiftId?: string;
        employeeId?: string;
        status?: string;
        counted?: boolean;
        note?: string;
    };

    if (!shiftId || !employeeId) {
        return res.status(400).json({ error: 'shiftId and employeeId are required' });
    }

    const db = await getDb();
    try {
        // Ensure shift exists
        const shift = await db.get('SELECT id, shiftDate FROM Shifts WHERE id = ?', [shiftId]);
        if (!shift) {
            return res.status(404).json({ error: 'Shift not found' });
        }

        // Ensure employee exists
        const employee = await db.get('SELECT id, name, rank FROM Employees WHERE id = ?', [employeeId]);
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        // Prevent duplicate assignment
        const duplicate = await db.get(
            'SELECT id FROM ShiftAssignments WHERE shiftId = ? AND employeeId = ? LIMIT 1',
            [shiftId, employeeId]
        );
        if (duplicate) {
            return res.status(400).json({ error: 'Employee is already assigned to this shift' });
        }

        const assignmentId = `assign_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        await db.run(
            'INSERT INTO ShiftAssignments (id, shiftId, employeeId, status, counted, note, addedAt) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\',\'localtime\'))',
            [
                assignmentId,
                shiftId,
                employeeId,
                status || 'attended',
                counted ? 1 : 0,
                note || null
            ]
        );

        const created = await db.get('SELECT * FROM ShiftAssignments WHERE id = ?', [assignmentId]);
        await safeInsertAuditLog(db, {
            entityType: 'shift',
            entityId: shiftId,
            action: 'assign',
            message: `تم إضافة ${employee.rank || ''} / ${employee.name || ''} إلى خفارة بتاريخ ${shift.shiftDate}`.trim(),
            metadata: {
                shiftDate: shift.shiftDate,
                employeeId,
                assignmentId
            }
        });
        res.status(201).json(created);
    } catch (error) {
        console.error('Error creating shift assignment:', error);
        res.status(500).json({ error: 'Failed to create shift assignment' });
    } finally {
        await db.close();
    }
});

// Delete an assignment from a shift (remove employee from shift)
app.delete('/api/shiftassignments/:id', async (req, res) => {
    const { id } = req.params;

    const db = await getDb();
    try {
        const assignment = await db.get(`
            SELECT sa.shiftId, sa.employeeId, s.shiftDate, e.name as employeeName, e.rank as employeeRank
            FROM ShiftAssignments sa
            LEFT JOIN Shifts s ON s.id = sa.shiftId
            LEFT JOIN Employees e ON e.id = sa.employeeId
            WHERE sa.id = ?
        `, [id]);
        const result = await db.run('DELETE FROM ShiftAssignments WHERE id = ?', [id]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Shift assignment not found' });
        }
        if (assignment) {
            await safeInsertAuditLog(db, {
                entityType: 'shift',
                entityId: assignment.shiftId,
                action: 'unassign',
                message: `تم إزالة ${assignment.employeeRank || ''} / ${assignment.employeeName || ''} من خفارة بتاريخ ${assignment.shiftDate || ''}`.trim(),
                metadata: {
                    shiftDate: assignment.shiftDate,
                    employeeId: assignment.employeeId,
                    assignmentId: id
                }
            });
        }
        res.json({ success: true });
    } catch (error) {
        console.error(`Error deleting shift assignment ${id}:`, error);
        res.status(500).json({ error: 'Failed to delete shift assignment' });
    } finally {
        await db.close();
    }
});

// Update shift assignment employee (change which employee is assigned)
app.patch('/api/shiftassignments/:id/employee', async (req, res) => {
    const { id } = req.params;
    const { newEmployeeId } = req.body;

    if (!newEmployeeId) {
        return res.status(400).json({ error: 'newEmployeeId is required' });
    }

    const db = await getDb();
    try {
        // Get the current assignment
        const assignment = await db.get(`
            SELECT sa.shiftId, sa.employeeId, s.shiftDate, e.name as oldEmployeeName, e.rank as oldEmployeeRank
            FROM ShiftAssignments sa
            LEFT JOIN Shifts s ON s.id = sa.shiftId
            LEFT JOIN Employees e ON e.id = sa.employeeId
            WHERE sa.id = ?
        `, [id]);

        if (!assignment) {
            return res.status(404).json({ error: 'Shift assignment not found' });
        }

        // Ensure new employee exists
        const newEmployee = await db.get('SELECT id, name, rank FROM Employees WHERE id = ?', [newEmployeeId]);
        if (!newEmployee) {
            return res.status(404).json({ error: 'New employee not found' });
        }

        // Prevent duplicate assignment (same employee to same shift)
        const duplicate = await db.get(
            'SELECT id FROM ShiftAssignments WHERE shiftId = ? AND employeeId = ? AND id != ? LIMIT 1',
            [assignment.shiftId, newEmployeeId, id]
        );
        if (duplicate) {
            return res.status(400).json({ error: 'This employee is already assigned to this shift' });
        }

        // Update the assignment
        await db.run('UPDATE ShiftAssignments SET employeeId = ? WHERE id = ?', [newEmployeeId, id]);

        // Log the change
        await safeInsertAuditLog(db, {
            entityType: 'shift',
            entityId: assignment.shiftId,
            action: 'reassign',
            message: `تم تغيير الموظف من ${assignment.oldEmployeeRank || ''} / ${assignment.oldEmployeeName || ''} إلى ${newEmployee.rank || ''} / ${newEmployee.name || ''} في خفارة بتاريخ ${assignment.shiftDate || ''}`.trim(),
            metadata: {
                shiftDate: assignment.shiftDate,
                oldEmployeeId: assignment.employeeId,
                newEmployeeId,
                assignmentId: id
            }
        });

        const updated = await db.get('SELECT * FROM ShiftAssignments WHERE id = ?', [id]);
        res.json(updated);
    } catch (error) {
        console.error('Error updating shift assignment employee:', error);
        res.status(500).json({ error: 'Failed to update shift assignment employee' });
    } finally {
        await db.close();
    }
});

// Update absence/note for a shift assignment
app.put('/api/shiftassignments/:id/absence', async (req, res) => {
    const { id } = req.params;
    const { note } = req.body;

    const db = await getDb();
    try {
        // Get the assignment to verify it exists
        const assignment = await db.get(`
            SELECT sa.id, sa.shiftId, sa.employeeId, s.shiftDate, e.name, e.rank
            FROM ShiftAssignments sa
            LEFT JOIN Shifts s ON s.id = sa.shiftId
            LEFT JOIN Employees e ON e.id = sa.employeeId
            WHERE sa.id = ?
        `, [id]);

        if (!assignment) {
            return res.status(404).json({ error: 'Shift assignment not found' });
        }

        // Update the note field with the absence reason
        await db.run('UPDATE ShiftAssignments SET note = ? WHERE id = ?', [note || null, id]);

        // Log the action
        await safeInsertAuditLog(db, {
            entityType: 'shift',
            entityId: assignment.shiftId,
            action: 'absence',
            message: note
                ? `تم تسجيل غياب ${assignment.rank || ''} / ${assignment.name || ''} - السبب: ${note}`
                : `تم حذف سبب غياب ${assignment.rank || ''} / ${assignment.name || ''}`,
            metadata: {
                shiftDate: assignment.shiftDate,
                employeeId: assignment.employeeId,
                assignmentId: id,
                absenceNote: note || null
            }
        });

        const updated = await db.get('SELECT * FROM ShiftAssignments WHERE id = ?', [id]);
        res.json(updated);
    } catch (error) {
        console.error('Error recording absence:', error);
        res.status(500).json({ error: 'Failed to record absence' });
    } finally {
        await db.close();
    }
});

// ==================== Licenses ====================
const mapLicenseRow = (row: any) => ({
    id: row.id,
    employee_id: row.employeeId,
    license_type: row.licenseType,
    license_date: row.licenseDate,
    hours: row.hours ?? null,
    permission_time: row.permissionTime ?? '',
    notes: row.notes ?? '',
    month: row.month,
    year: row.year,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    full_name: row.employeeName || '',
    rank: row.employeeRank || '',
    file_number: row.employeeFileNumber || '',
    civil_id: row.employeeCivilId || '',
    department: row.employeeDepartment || '',
    section: row.employeeSection || '',
    category: mapLicenseCategory(row.employeeCategory || ''),
    status: row.employeeStatus === 'inactive' ? 'inactive' : 'active'
});

const LICENSE_TYPES = ['يوم كامل', 'إستئذان قصير', 'إستئذان طبي'];
const PERMISSION_TIME_OPTIONS = ['بداية الدوام', 'أثناء الدوام', 'نهاية الدوام'];

type LicenseImportSourceEmployee = {
    id: string;
    fileNumber: string;
    civilId: string;
    name?: string;
};

type LicenseImportSourceLicense = {
    id: string;
    employeeId: string;
    fileNumber: string;
    civilId: string;
    licenseType: string;
    licenseDate: string | null;
    hours: number | null;
    permissionTime: string | null;
    notes: string;
    createdAt: string;
    updatedAt: string;
};

type PreparedLicenseImportRow = {
    id: string;
    employeeId: string;
    licenseType: string;
    licenseDate: string;
    hours: number | null;
    permissionTime: string | null;
    notes: string;
    month: number;
    year: number;
    createdAt: string;
    updatedAt: string;
    employeeName: string;
    employeeRank: string;
    fileNumber: string;
    civilId: string;
};

type ReassignableLicenseImportRow = PreparedLicenseImportRow & {
    existingLicenseId: string;
    oldEmployeeId: string;
    oldEmployeeName: string;
    oldEmployeeRank: string;
};

type LicenseImportAnalysis = {
    sourceFile: string;
    sourceType: 'json' | 'sqlite';
    sourceLicenses: number;
    sourceEmployees: number;
    matched: number;
    insertable: number;
    reassignable: number;
    existing: number;
    missingEmployees: string[];
    invalidRows: number;
    duplicatesInSource: number;
    samples: {
        insertable: PreparedLicenseImportRow[];
        reassignable: ReassignableLicenseImportRow[];
        missing: string[];
        existing: PreparedLicenseImportRow[];
    };
    applied?: boolean;
    inserted?: number;
    reassigned?: number;
};

const normalizeIdentifier = (value: any) => {
    if (value === null || value === undefined) return '';
    return String(value)
        .trim()
        .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit).toString())
        .replace(/[\s\-_]/g, '');
};

const normalizeLicenseImportType = (value: any) => {
    const raw = normalizeText(value);
    if (!raw) return '';
    const compact = raw.replace(/\s+/g, '').replace(/[إأآٱ]/g, 'ا');
    if (compact.includes('طبي')) return 'إستئذان طبي';
    if (compact.includes('يوم') || compact.includes('كامل') || compact.includes('رخصه') || compact.includes('رخصة')) {
        return 'يوم كامل';
    }
    if (compact.includes('استئذان') || compact.includes('اذن') || compact.includes('استاذان')) {
        return 'إستئذان قصير';
    }
    return LICENSE_TYPES.includes(raw) ? raw : '';
};

const getFirstValue = (row: Record<string, any>, keys: string[]) => {
    for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null && normalizeText(row[key]) !== '') {
            return row[key];
        }
    }
    return '';
};

const getFirstIdentifier = (row: Record<string, any>, keys: string[]) => normalizeIdentifier(getFirstValue(row, keys));

const normalizeLicenseImportDate = (value: any) => normalizeDateOnly(value);

const normalizeLicenseImportHours = (value: any, licenseType: string) => {
    if (licenseType === 'يوم كامل') return null;
    const raw = normalizeText(value);
    if (!raw) return null;
    const numeric = Number(raw.replace(/[^\d.]/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
};

const normalizeLicenseImportPermissionTime = (value: any, licenseType: string) => {
    if (licenseType === 'يوم كامل') return null;
    const raw = normalizeText(value);
    return PERMISSION_TIME_OPTIONS.includes(raw) ? raw : null;
};

const mapLicenseImportSourceEmployee = (row: Record<string, any>): LicenseImportSourceEmployee => ({
    id: normalizeText(getFirstValue(row, ['id', 'employee_id', 'employeeId'])),
    fileNumber: getFirstIdentifier(row, ['file_number', 'fileNumber', 'fileNo', 'file_no', 'employee_file_number', 'employeeFileNumber']),
    civilId: getFirstIdentifier(row, ['civil_id', 'civilId', 'civil_number', 'civilNumber', 'employee_civil_id', 'employeeCivilId']),
    name: normalizeText(getFirstValue(row, ['full_name', 'fullName', 'name', 'employee_name', 'employeeName']))
});

const mapLicenseImportSourceLicense = (row: Record<string, any>): LicenseImportSourceLicense => {
    const licenseType = normalizeLicenseImportType(getFirstValue(row, ['license_type', 'licenseType', 'type', 'نوع الرخصة', 'نوع الاستئذان']));
    const licenseDate = normalizeLicenseImportDate(getFirstValue(row, ['license_date', 'licenseDate', 'date', 'created_at', 'createdAt', 'تاريخ الرخصة', 'تاريخ الاستئذان']));
    const createdAt = normalizeText(getFirstValue(row, ['created_at', 'createdAt'])) || licenseDate || new Date().toISOString();
    const updatedAt = normalizeText(getFirstValue(row, ['updated_at', 'updatedAt'])) || createdAt;
    return {
        id: normalizeText(getFirstValue(row, ['id', 'license_id', 'licenseId'])) || `lic_import_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        employeeId: normalizeText(getFirstValue(row, ['employee_id', 'employeeId'])),
        fileNumber: getFirstIdentifier(row, ['file_number', 'fileNumber', 'fileNo', 'file_no', 'employee_file_number', 'employeeFileNumber']),
        civilId: getFirstIdentifier(row, ['civil_id', 'civilId', 'civil_number', 'civilNumber', 'employee_civil_id', 'employeeCivilId']),
        licenseType,
        licenseDate,
        hours: normalizeLicenseImportHours(getFirstValue(row, ['hours', 'hour_count', 'عدد الساعات', 'الساعات']), licenseType),
        permissionTime: normalizeLicenseImportPermissionTime(getFirstValue(row, ['permission_time', 'permissionTime', 'وقت الاستئذان']), licenseType),
        notes: normalizeText(getFirstValue(row, ['notes', 'note', 'ملاحظات', 'الملاحظات'])),
        createdAt,
        updatedAt
    };
};

const readRowsFromSourceSqlite = async (filePath: string) => {
    const sourceDb = await open({ filename: filePath, driver: sqlite3.Database });
    try {
        const tables = await sourceDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        const tableNames = (tables || []).map((table: any) => String(table.name));
        const findTable = (candidates: string[]) => tableNames.find((tableName) =>
            candidates.some((candidate) => tableName.toLowerCase() === candidate.toLowerCase())
        );
        const licensesTable = findTable(['licenses', 'Licenses']);
        if (!licensesTable) {
            throw Object.assign(new Error('لم يتم العثور على جدول الرخص داخل قاعدة البيانات المرفوعة'), { status: 400 });
        }
        const employeesTable = findTable(['employees', 'Employees']);
        const licenses = await sourceDb.all(`SELECT * FROM "${licensesTable.replace(/"/g, '""')}"`);
        const employees = employeesTable
            ? await sourceDb.all(`SELECT * FROM "${employeesTable.replace(/"/g, '""')}"`)
            : [];
        return { licenses, employees };
    } finally {
        await sourceDb.close();
    }
};

const readLicenseImportSource = async (req: any) => {
    const fileName = decodeHeaderValue(req.header?.('x-file-name')) || `licenses-import-${Date.now()}.json`;
    const extension = path.extname(fileName).toLowerCase();
    const body = req?.body;
    if (!Buffer.isBuffer(body) || !body.length) {
        throw Object.assign(new Error('يرجى اختيار ملف قاعدة الرخص أولاً'), { status: 400 });
    }

    if (extension === '.json') {
        let data: any;
        try {
            data = JSON.parse(body.toString('utf-8'));
        } catch {
            throw Object.assign(new Error('تعذر قراءة ملف JSON المرفوع'), { status: 400 });
        }
        const licenses = Array.isArray(data?.licenses) ? data.licenses : Array.isArray(data) ? data : [];
        const employees = Array.isArray(data?.employees) ? data.employees : [];
        return { fileName, sourceType: 'json' as const, licenses, employees, cleanup: null as null | (() => void) };
    }

    if (!['.sqlite', '.db', '.sqlite3'].includes(extension)) {
        throw Object.assign(new Error('الملف يجب أن يكون JSON أو SQLite (.sqlite/.db)'), { status: 400 });
    }

    const tempDir = path.join(DATA_DIR, 'license-import-temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const safeName = fileName.replace(/[^\u0600-\u06FFa-zA-Z0-9._-]+/g, '_').slice(0, 80);
    const tempPath = path.join(tempDir, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeName}`);
    fs.writeFileSync(tempPath, body);
    const rows = await readRowsFromSourceSqlite(tempPath);
    return {
        fileName,
        sourceType: 'sqlite' as const,
        licenses: rows.licenses,
        employees: rows.employees,
        cleanup: () => {
            try {
                fs.unlinkSync(tempPath);
            } catch {}
        }
    };
};

const buildLicenseImportAnalysis = async (db: any, source: Awaited<ReturnType<typeof readLicenseImportSource>>) => {
    const sourceEmployees = (source.employees || []).map(mapLicenseImportSourceEmployee);
    const employeeByLegacyId = new Map<string, LicenseImportSourceEmployee>();
    sourceEmployees.forEach((employee: LicenseImportSourceEmployee) => {
        if (employee.id) employeeByLegacyId.set(employee.id, employee);
    });

    const employees = await db.all('SELECT id, name, rank, fileNumber, civilId, status FROM Employees');
    const employeeById = new Map<string, any>();
    const employeeByFile = new Map<string, any>();
    const employeeByCivil = new Map<string, any>();
    const employeeByName = new Map<string, any>();

    const normalizeNameKey = (name: string) => normalizeText(name)
        .replace(/[إأآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/\s+/g, '')
        .toLowerCase();

    (employees || []).forEach((employee: any) => {
        if (employee.status === 'inactive') return;
        const id = normalizeIdentifier(employee.id);
        const fileNumber = normalizeIdentifier(employee.fileNumber);
        const civilId = normalizeIdentifier(employee.civilId);
        const nameKey = employee.name ? normalizeNameKey(employee.name) : '';

        if (id) employeeById.set(id, employee);
        if (fileNumber) employeeByFile.set(fileNumber, employee);
        if (civilId) employeeByCivil.set(civilId, employee);
        if (nameKey && !employeeByName.has(nameKey)) employeeByName.set(nameKey, employee);
    });

    const existingRows = await db.all(`
        SELECT l.id, l.employeeId, l.licenseType, l.licenseDate, l.hours, l.permissionTime, l.notes,
               e.status as employeeStatus, e.name as employeeName, e.rank as employeeRank
        FROM Licenses l
        LEFT JOIN Employees e ON e.id = l.employeeId
    `);
    const licenseIdentity = (row: {
        employeeId: any;
        licenseType: any;
        licenseDate: any;
        hours: any;
        permissionTime: any;
        notes: any;
    }) => [
        row.employeeId,
        row.licenseType,
        row.licenseDate,
        row.hours === null || row.hours === undefined ? '' : String(row.hours),
        row.permissionTime || '',
        row.notes || ''
    ].join('|');
    const licenseSignature = (row: {
        licenseType: any;
        licenseDate: any;
        hours: any;
        permissionTime: any;
        notes: any;
    }) => [
        row.licenseType,
        row.licenseDate,
        row.hours === null || row.hours === undefined ? '' : String(row.hours),
        row.permissionTime || '',
        row.notes || ''
    ].join('|');
    const existingById = new Map<string, any>();
    const existingIdentity = new Map<string, any>();
    const inactiveExistingBySignature = new Map<string, any>();
    (existingRows || []).forEach((row: any) => {
        const id = normalizeText(row.id);
        if (id) existingById.set(id, row);
        existingIdentity.set(licenseIdentity(row), row);
        if (row.employeeStatus === 'inactive') {
            const signature = licenseSignature(row);
            if (signature && !inactiveExistingBySignature.has(signature)) {
                inactiveExistingBySignature.set(signature, row);
            }
        }
    });

    const prepared: PreparedLicenseImportRow[] = [];
    const missingEmployees = new Set<string>();
    let invalidRows = 0;
    let duplicatesInSource = 0;
    const sourceIds = new Set<string>();
    const sourceIdentity = new Set<string>();

    for (const rawLicense of source.licenses || []) {
        const sourceLicense = mapLicenseImportSourceLicense(rawLicense || {});
        if (!sourceLicense.licenseType || !sourceLicense.licenseDate) {
            invalidRows += 1;
            continue;
        }
        if (sourceIds.has(sourceLicense.id)) {
            duplicatesInSource += 1;
        }
        sourceIds.add(sourceLicense.id);

        const sourceEmployee = employeeByLegacyId.get(sourceLicense.employeeId);

        // Collect all possible raw identifiers from license & source employee record
        const candidateRawValues: string[] = [
            sourceLicense.civilId,
            sourceLicense.fileNumber,
            sourceLicense.employeeId,
            sourceEmployee?.civilId || '',
            sourceEmployee?.fileNumber || '',
            sourceEmployee?.id || ''
        ].filter(Boolean);

        let employee: any = null;

        // 1. Search by Civil ID across all candidates (Supports Civilians & Military by Civil ID)
        for (const rawVal of candidateRawValues) {
            const norm = normalizeIdentifier(rawVal);
            if (norm && employeeByCivil.has(norm)) {
                employee = employeeByCivil.get(norm);
                break;
            }
        }

        // 2. Search by File Number across all candidates (Supports Military by File Number)
        if (!employee) {
            for (const rawVal of candidateRawValues) {
                const norm = normalizeIdentifier(rawVal);
                if (norm && employeeByFile.has(norm)) {
                    employee = employeeByFile.get(norm);
                    break;
                }
            }
        }

        // 3. Search by System Employee ID across all candidates
        if (!employee) {
            for (const rawVal of candidateRawValues) {
                const norm = normalizeIdentifier(rawVal);
                if (norm && employeeById.has(norm)) {
                    employee = employeeById.get(norm);
                    break;
                }
            }
        }

        // 4. Fallback search by Name
        if (!employee) {
            const rawName = (rawLicense as any)?.name || (rawLicense as any)?.full_name || (rawLicense as any)?.employee_name || sourceEmployee?.name;
            if (rawName) {
                const nameKey = normalizeNameKey(rawName);
                if (nameKey && employeeByName.has(nameKey)) {
                    employee = employeeByName.get(nameKey);
                }
            }
        }

        if (!employee) {
            const fileNumberDisplay = sourceLicense.fileNumber || sourceEmployee?.fileNumber || '';
            const civilIdDisplay = sourceLicense.civilId || sourceEmployee?.civilId || '';
            const displayIdentifier = civilIdDisplay || fileNumberDisplay || sourceLicense.employeeId || '(بدون رقم)';
            missingEmployees.add(displayIdentifier);
            continue;
        }

        const month = parseInt(sourceLicense.licenseDate.slice(5, 7), 10);
        const year = parseInt(sourceLicense.licenseDate.slice(0, 4), 10);
        const row: PreparedLicenseImportRow = {
            id: sourceLicense.id,
            employeeId: employee.id,
            licenseType: sourceLicense.licenseType,
            licenseDate: sourceLicense.licenseDate,
            hours: sourceLicense.hours,
            permissionTime: sourceLicense.permissionTime,
            notes: sourceLicense.notes,
            month,
            year,
            createdAt: sourceLicense.createdAt,
            updatedAt: sourceLicense.updatedAt,
            employeeName: employee.name || '',
            employeeRank: employee.rank || '',
            fileNumber: employee.fileNumber || '',
            civilId: employee.civilId || ''
        };
        const identity = [
            row.employeeId,
            row.licenseType,
            row.licenseDate,
            row.hours === null || row.hours === undefined ? '' : String(row.hours),
            row.permissionTime || '',
            row.notes || ''
        ].join('|');
        if (sourceIdentity.has(identity)) {
            duplicatesInSource += 1;
            continue;
        }
        sourceIdentity.add(identity);
        prepared.push(row);
    }

    const reassignable: ReassignableLicenseImportRow[] = [];
    const insertable = prepared.filter((row) => {
        const identity = licenseIdentity(row);
        if (existingIdentity.has(identity)) return false;

        const existingBySameId = existingById.get(normalizeText(row.id));
        const existingInactive = existingBySameId?.employeeStatus === 'inactive'
            ? existingBySameId
            : inactiveExistingBySignature.get(licenseSignature(row));

        if (existingInactive && existingInactive.employeeId !== row.employeeId) {
            reassignable.push({
                ...row,
                existingLicenseId: existingInactive.id,
                oldEmployeeId: existingInactive.employeeId,
                oldEmployeeName: existingInactive.employeeName || '',
                oldEmployeeRank: existingInactive.employeeRank || ''
            });
            return false;
        }

        return !existingBySameId;
    });
    const reassignableIds = new Set(reassignable.map((row) => `${row.existingLicenseId}|${row.employeeId}`));
    const existing = prepared.filter((row) => {
        if (insertable.includes(row)) return false;
        const existingBySameId = existingById.get(normalizeText(row.id));
        const existingInactive = existingBySameId?.employeeStatus === 'inactive'
            ? existingBySameId
            : inactiveExistingBySignature.get(licenseSignature(row));
        if (existingInactive && reassignableIds.has(`${existingInactive.id}|${row.employeeId}`)) return false;
        return true;
    });

    const analysis: LicenseImportAnalysis = {
        sourceFile: source.fileName,
        sourceType: source.sourceType,
        sourceLicenses: (source.licenses || []).length,
        sourceEmployees: sourceEmployees.length,
        matched: prepared.length,
        insertable: insertable.length,
        reassignable: reassignable.length,
        existing: existing.length,
        missingEmployees: Array.from(missingEmployees).sort(),
        invalidRows,
        duplicatesInSource,
        samples: {
            insertable: insertable.slice(0, 8),
            reassignable: reassignable.slice(0, 8),
            missing: Array.from(missingEmployees).sort().slice(0, 12),
            existing: existing.slice(0, 8)
        }
    };
    return { analysis, insertable, reassignable };
};

const insertImportedLicenses = async (db: any, rows: PreparedLicenseImportRow[]) => {
    let inserted = 0;
    for (const row of rows) {
        await db.run(
            `INSERT INTO Licenses (id, employeeId, licenseType, licenseDate, hours, permissionTime, notes, month, year, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')), COALESCE(?, datetime('now','localtime')))` ,
            [
                row.id,
                row.employeeId,
                row.licenseType,
                row.licenseDate,
                row.hours,
                row.permissionTime,
                row.notes,
                row.month,
                row.year,
                row.createdAt,
                row.updatedAt
            ]
        );
        inserted += 1;
        await safeInsertAuditLog(db, {
            entityType: 'license',
            entityId: row.id,
            action: 'import',
            message: `تم استيراد رخصة لـ ${row.employeeRank || ''} / ${row.employeeName || ''}`.trim(),
            metadata: {
                employeeId: row.employeeId,
                employeeName: row.employeeName,
                employeeRank: row.employeeRank,
                fileNumber: row.fileNumber,
                civilId: row.civilId,
                licenseType: row.licenseType,
                licenseDate: row.licenseDate
            }
        });
    }
    return inserted;
};

const reassignImportedLicenses = async (db: any, rows: ReassignableLicenseImportRow[]) => {
    let reassigned = 0;
    for (const row of rows) {
        const result = await db.run(
            `UPDATE Licenses
             SET employeeId = ?, month = ?, year = ?, updatedAt = datetime('now','localtime')
             WHERE id = ?`,
            [row.employeeId, row.month, row.year, row.existingLicenseId]
        );
        if (result.changes === 0) continue;
        reassigned += 1;
        await safeInsertAuditLog(db, {
            entityType: 'license',
            entityId: row.existingLicenseId,
            action: 'reassign',
            field: 'employeeId',
            oldValue: `${row.oldEmployeeRank || ''} / ${row.oldEmployeeName || ''}`.trim(),
            newValue: `${row.employeeRank || ''} / ${row.employeeName || ''}`.trim(),
            message: `تم نقل رخصة من موظف خارج الخدمة إلى الموظف النشط`,
            metadata: {
                oldEmployeeId: row.oldEmployeeId,
                oldEmployeeName: row.oldEmployeeName,
                oldEmployeeRank: row.oldEmployeeRank,
                newEmployeeId: row.employeeId,
                newEmployeeName: row.employeeName,
                newEmployeeRank: row.employeeRank,
                fileNumber: row.fileNumber,
                civilId: row.civilId,
                licenseType: row.licenseType,
                licenseDate: row.licenseDate
            }
        });
    }
    return reassigned;
};

app.post('/api/licenses/import/analyze', licenseImportRawParser, async (req, res) => {
    let source: Awaited<ReturnType<typeof readLicenseImportSource>> | null = null;
    const db = await getDb();
    try {
        source = await readLicenseImportSource(req);
        const { analysis } = await buildLicenseImportAnalysis(db, source);
        res.json(analysis);
    } catch (error: any) {
        console.error('Error analyzing license import:', error);
        res.status(error?.status || 500).json({ error: error?.message || 'فشل تحليل ملف الرخص' });
    } finally {
        source?.cleanup?.();
        await db.close();
    }
});

app.post('/api/licenses/import/apply', licenseImportRawParser, async (req, res) => {
    let source: Awaited<ReturnType<typeof readLicenseImportSource>> | null = null;
    const db = await getDb();
    try {
        source = await readLicenseImportSource(req);
        const { analysis, insertable, reassignable } = await buildLicenseImportAnalysis(db, source);
        await db.run('BEGIN');
        const inserted = await insertImportedLicenses(db, insertable);
        const reassigned = await reassignImportedLicenses(db, reassignable);
        await db.run('COMMIT');
        res.json({
            ...analysis,
            applied: true,
            inserted,
            reassigned,
            insertable: inserted,
            reassignable: reassigned
        });
    } catch (error: any) {
        try {
            await db.run('ROLLBACK');
        } catch {}
        console.error('Error applying license import:', error);
        res.status(error?.status || 500).json({ error: error?.message || 'فشل تنفيذ استيراد الرخص' });
    } finally {
        source?.cleanup?.();
        await db.close();
    }
});

app.get('/api/licenses', async (_req, res) => {
    const db = await getDb();
    try {
        const restriction = await loadDepartmentRestriction(db);
        const rows = await db.all(`
            SELECT l.*, e.name as employeeName, e.rank as employeeRank, e.fileNumber as employeeFileNumber, e.civilId as employeeCivilId, e.department as employeeDepartment, e.section as employeeSection, e.category as employeeCategory, e.status as employeeStatus
            FROM Licenses l
            INNER JOIN Employees e ON e.id = l.employeeId AND e.status <> 'inactive'
            ORDER BY l.licenseDate DESC, datetime(l.createdAt) DESC
        `);
        const filtered = (rows || []).filter((row: any) => isDepartmentAllowed(row.employeeDepartment, restriction));
        res.json(filtered.map(mapLicenseRow));
    } catch (error) {
        console.error('Error fetching licenses:', error);
        res.status(500).json({ error: 'فشل في جلب الرخص' });
    } finally {
        await db.close();
    }
});

app.get('/api/licenses/employee/:employeeId', async (req, res) => {
    const { employeeId } = req.params;
    const db = await getDb();
    try {
        const restriction = await loadDepartmentRestriction(db);
        const rows = await db.all(`
            SELECT l.*, e.name as employeeName, e.rank as employeeRank, e.fileNumber as employeeFileNumber, e.civilId as employeeCivilId, e.department as employeeDepartment, e.section as employeeSection, e.category as employeeCategory, e.status as employeeStatus
            FROM Licenses l
            INNER JOIN Employees e ON e.id = l.employeeId AND e.status <> 'inactive'
            WHERE l.employeeId = ?
            ORDER BY datetime(l.createdAt) DESC, l.licenseDate DESC
        `, [employeeId]);
        const filtered = (rows || []).filter((row: any) => isDepartmentAllowed(row.employeeDepartment, restriction));
        res.json(filtered.map(mapLicenseRow));
    } catch (error) {
        console.error('Error fetching employee licenses:', error);
        res.status(500).json({ error: 'فشل في جلب رخص الموظف' });
    } finally {
        await db.close();
    }
});

app.get('/api/licenses/check-duplicate/:employeeId/:date', async (req, res) => {
    const { employeeId, date } = req.params;
    const normalizedDate = normalizeDateOnly(date);
    if (!normalizedDate) {
        return res.status(400).json({ error: 'تاريخ غير صحيح' });
    }
    const db = await getDb();
    try {
        const restriction = await loadDepartmentRestriction(db);
        const rows = await db.all(`
            SELECT l.*, e.name as employeeName, e.rank as employeeRank, e.fileNumber as employeeFileNumber, e.civilId as employeeCivilId, e.department as employeeDepartment, e.section as employeeSection, e.category as employeeCategory, e.status as employeeStatus
            FROM Licenses l
            INNER JOIN Employees e ON e.id = l.employeeId AND e.status <> 'inactive'
            WHERE l.employeeId = ? AND l.licenseDate = ?
        `, [employeeId, normalizedDate]);
        const filtered = (rows || []).filter((row: any) => isDepartmentAllowed(row.employeeDepartment, restriction));
        res.json(filtered.map(mapLicenseRow));
    } catch (error) {
        console.error('Error checking license duplicates:', error);
        res.status(500).json({ error: 'فشل في التحقق من التكرار' });
    } finally {
        await db.close();
    }
});

app.get('/api/licenses/:id', async (req, res) => {
    const { id } = req.params;
    const db = await getDb();
    try {
        const row = await db.get(`
            SELECT l.*, e.name as employeeName, e.rank as employeeRank, e.fileNumber as employeeFileNumber, e.civilId as employeeCivilId, e.department as employeeDepartment, e.section as employeeSection, e.category as employeeCategory, e.status as employeeStatus
            FROM Licenses l
            INNER JOIN Employees e ON e.id = l.employeeId AND e.status <> 'inactive'
            WHERE l.id = ?
        `, [id]);
        if (!row) {
            return res.status(404).json({ error: 'الرخصة غير موجودة' });
        }
        const restriction = await loadDepartmentRestriction(db);
        if (!isDepartmentAllowed(row.employeeDepartment, restriction)) {
            return res.status(404).json({ error: 'الرخصة غير موجودة' });
        }
        res.json(mapLicenseRow(row));
    } catch (error) {
        console.error('Error fetching license:', error);
        res.status(500).json({ error: 'فشل في جلب الرخصة' });
    } finally {
        await db.close();
    }
});

app.post('/api/licenses', async (req, res) => {
    const { employee_id, license_type, license_date, hours, notes, permission_time, permissionTime } = req.body || {};

    if (!employee_id || !license_type || !license_date) {
        return res.status(400).json({ error: 'البيانات المطلوبة مفقودة' });
    }

    if (!LICENSE_TYPES.includes(license_type)) {
        return res.status(400).json({ error: 'نوع الرخصة غير صحيح' });
    }

    const normalizedDate = normalizeDateOnly(license_date);
    if (!normalizedDate) {
        return res.status(400).json({ error: 'تاريخ غير صحيح' });
    }

    const db = await getDb();
    try {
        const restriction = await loadDepartmentRestriction(db);
        const employee = await db.get('SELECT id, name, rank, fileNumber, civilId, department, section, category, status FROM Employees WHERE id = ?', [employee_id]);
        if (!employee) {
            return res.status(404).json({ error: 'الموظف غير موجود' });
        }
        if (employee.status === 'inactive') {
            return res.status(400).json({ error: 'لا يمكن تسجيل رخص أو استئذانات لموظف خارج الخدمة' });
        }
        if (!isDepartmentAllowed(employee.department, restriction)) {
            return res.status(403).json({ error: 'غير مسموح بتسجيل رخص لموظف خارج الإدارة المحددة' });
        }

        const month = parseInt(normalizedDate.slice(5, 7), 10);
        const year = parseInt(normalizedDate.slice(0, 4), 10);
        const hoursValue = license_type === 'يوم كامل'
            ? null
            : (Number.isFinite(Number(hours)) ? Number(hours) : null);
        const permissionTimeInput = permission_time !== undefined ? permission_time : permissionTime;
        const permissionTimeRaw = normalizeText(permissionTimeInput);
        const permissionTimeValue = license_type === 'يوم كامل'
            ? null
            : (permissionTimeRaw ? permissionTimeRaw : null);
        if (permissionTimeValue && !PERMISSION_TIME_OPTIONS.includes(permissionTimeValue)) {
            return res.status(400).json({ error: 'وقت الاستئذان غير صحيح' });
        }
        const notesValue = notes !== undefined && notes !== null ? String(notes) : '';
        const newId = `lic_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        await db.run(
            `INSERT INTO Licenses (id, employeeId, licenseType, licenseDate, hours, permissionTime, notes, month, year, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
            [newId, employee_id, license_type, normalizedDate, hoursValue, permissionTimeValue, notesValue, month, year]
        );

        await safeInsertAuditLog(db, {
            entityType: 'license',
            entityId: newId,
            action: 'create',
            message: `تم تسجيل رخصة لـ ${employee.rank || ''} / ${employee.name || ''}`.trim(),
            metadata: {
                employeeId: employee_id,
                employeeName: employee.name,
                employeeRank: employee.rank,
                licenseType: license_type,
                licenseDate: normalizedDate
            }
        });

        const response = mapLicenseRow({
            id: newId,
            employeeId: employee_id,
            licenseType: license_type,
            licenseDate: normalizedDate,
            hours: hoursValue,
            permissionTime: permissionTimeValue,
            notes: notesValue,
            month,
            year,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            employeeName: employee.name,
            employeeRank: employee.rank,
            employeeFileNumber: employee.fileNumber,
            employeeCivilId: employee.civilId,
            employeeDepartment: employee.department,
            employeeSection: employee.section,
            employeeCategory: employee.category,
            employeeStatus: employee.status
        });

        res.status(201).json(response);
    } catch (error) {
        console.error('Error creating license:', error);
        res.status(500).json({ error: 'فشل في إضافة الرخصة' });
    } finally {
        await db.close();
    }
});

app.put('/api/licenses/:id', async (req, res) => {
    const { id } = req.params;
    const { employee_id, license_type, license_date, hours, notes, permission_time, permissionTime } = req.body || {};

    const db = await getDb();
    try {
        const restriction = await loadDepartmentRestriction(db);
        const existing = await db.get(`
            SELECT l.*, e.name as employeeName, e.rank as employeeRank
            FROM Licenses l
            INNER JOIN Employees e ON e.id = l.employeeId AND e.status <> 'inactive'
            WHERE l.id = ?
        `, [id]);
        if (!existing) {
            return res.status(404).json({ error: 'الرخصة غير موجودة' });
        }

        const employeeIdToUse = employee_id || existing.employeeId;
        const employee = await db.get('SELECT id, name, rank, fileNumber, civilId, department, section, category, status FROM Employees WHERE id = ?', [employeeIdToUse]);
        if (!employee) {
            return res.status(404).json({ error: 'الموظف غير موجود' });
        }
        if (employee.status === 'inactive') {
            return res.status(400).json({ error: 'لا يمكن تسجيل أو تعديل رخص لموظف خارج الخدمة' });
        }
        if (!isDepartmentAllowed(employee.department, restriction)) {
            return res.status(403).json({ error: 'غير مسموح بتعديل رخصة لموظف خارج الإدارة المحددة' });
        }

        const licenseTypeToUse = license_type !== undefined ? license_type : existing.licenseType;
        if (!LICENSE_TYPES.includes(licenseTypeToUse)) {
            return res.status(400).json({ error: 'نوع الرخصة غير صحيح' });
        }

        const normalizedDate = license_date !== undefined ? normalizeDateOnly(license_date) : existing.licenseDate;
        if (!normalizedDate) {
            return res.status(400).json({ error: 'تاريخ غير صحيح' });
        }

        const month = parseInt(normalizedDate.slice(5, 7), 10);
        const year = parseInt(normalizedDate.slice(0, 4), 10);
        const hoursValue = licenseTypeToUse === 'يوم كامل'
            ? null
            : (hours !== undefined ? (Number.isFinite(Number(hours)) ? Number(hours) : null) : existing.hours);
        const permissionTimeInput = permission_time !== undefined ? permission_time : permissionTime;
        const permissionTimeRaw = permissionTimeInput !== undefined
            ? normalizeText(permissionTimeInput)
            : normalizeText(existing.permissionTime);
        const permissionTimeValue = licenseTypeToUse === 'يوم كامل'
            ? null
            : (permissionTimeRaw ? permissionTimeRaw : null);
        if (permissionTimeValue && !PERMISSION_TIME_OPTIONS.includes(permissionTimeValue)) {
            return res.status(400).json({ error: 'وقت الاستئذان غير صحيح' });
        }
        const notesValue = notes !== undefined && notes !== null ? String(notes) : (existing.notes ?? '');

        const beforeValues = {
            employeeId: existing.employeeId,
            licenseType: existing.licenseType,
            licenseDate: existing.licenseDate,
            hours: existing.hours,
            permissionTime: existing.permissionTime ?? null,
            notes: existing.notes ?? ''
        };

        const afterValues = {
            employeeId: employeeIdToUse,
            licenseType: licenseTypeToUse,
            licenseDate: normalizedDate,
            hours: hoursValue,
            permissionTime: permissionTimeValue,
            notes: notesValue
        };

        const changes = buildAuditChanges(beforeValues, afterValues, LICENSE_AUDIT_FIELDS);

        await db.run(
            `UPDATE Licenses SET employeeId = ?, licenseType = ?, licenseDate = ?, hours = ?, permissionTime = ?, notes = ?, month = ?, year = ?, updatedAt = datetime('now','localtime') WHERE id = ?`,
            [employeeIdToUse, licenseTypeToUse, normalizedDate, hoursValue, permissionTimeValue, notesValue, month, year, id]
        );

        if (beforeValues.employeeId !== afterValues.employeeId) {
            await safeInsertAuditLog(db, {
                entityType: 'license',
                entityId: id,
                action: 'update',
                field: 'employeeId',
                oldValue: existing.employeeName || '',
                newValue: employee.name || '',
                message: `تم تعديل الموظف على الرخصة`,
                metadata: {
                    label: 'الموظف',
                    oldEmployeeId: beforeValues.employeeId,
                    newEmployeeId: afterValues.employeeId
                }
            });
        }

        if (changes.length) {
            for (const change of changes) {
                await safeInsertAuditLog(db, {
                    entityType: 'license',
                    entityId: id,
                    action: 'update',
                    field: change.field,
                    oldValue: change.oldValue,
                    newValue: change.newValue,
                    message: `تم تعديل ${change.label}`,
                    metadata: {
                        label: change.label,
                        employeeId: employeeIdToUse
                    }
                });
            }
        }

        const response = mapLicenseRow({
            id,
            employeeId: employeeIdToUse,
            licenseType: licenseTypeToUse,
            licenseDate: normalizedDate,
            hours: hoursValue,
            permissionTime: permissionTimeValue,
            notes: notesValue,
            month,
            year,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString(),
            employeeName: employee.name,
            employeeRank: employee.rank,
            employeeFileNumber: employee.fileNumber,
            employeeCivilId: employee.civilId,
            employeeDepartment: employee.department,
            employeeSection: employee.section,
            employeeCategory: employee.category,
            employeeStatus: employee.status
        });

        res.json(response);
    } catch (error) {
        console.error('Error updating license:', error);
        res.status(500).json({ error: 'فشل في تحديث الرخصة' });
    } finally {
        await db.close();
    }
});

app.delete('/api/licenses/:id', async (req, res) => {
    const { id } = req.params;
    const db = await getDb();
    try {
        const restriction = await loadDepartmentRestriction(db);
        const existing = await db.get(`
            SELECT l.*, e.name as employeeName, e.rank as employeeRank, e.department as employeeDepartment, e.status as employeeStatus
            FROM Licenses l
            INNER JOIN Employees e ON e.id = l.employeeId AND e.status <> 'inactive'
            WHERE l.id = ?
        `, [id]);
        if (!existing) {
            return res.status(404).json({ error: 'الرخصة غير موجودة' });
        }
        if (!isDepartmentAllowed(existing.employeeDepartment, restriction)) {
            return res.status(404).json({ error: 'الرخصة غير موجودة' });
        }

        const result = await db.run('DELETE FROM Licenses WHERE id = ?', [id]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'الرخصة غير موجودة' });
        }

        await safeInsertAuditLog(db, {
            entityType: 'license',
            entityId: id,
            action: 'delete',
            message: `تم حذف رخصة لـ ${existing.employeeRank || ''} / ${existing.employeeName || ''}`.trim(),
            metadata: {
                employeeId: existing.employeeId,
                licenseType: existing.licenseType,
                licenseDate: existing.licenseDate
            }
        });

        res.json({ message: 'تم حذف الرخصة بنجاح' });
    } catch (error) {
        console.error('Error deleting license:', error);
        res.status(500).json({ error: 'فشل في حذف الرخصة' });
    } finally {
        await db.close();
    }
});

app.get('/api/stats', async (_req, res) => {
    const db = await getDb();
    try {
        const restriction = await loadDepartmentRestriction(db);
        const licensesRaw = await db.all(`
            SELECT l.*, e.department as employeeDepartment, e.excludeFromStatistics as employeeExcludeFromStatistics, e.status as employeeStatus
            FROM Licenses l
            INNER JOIN Employees e ON e.id = l.employeeId AND e.status <> 'inactive'
        `);
        const licenses = (licensesRaw || []).filter((row: any) => {
            const employeeExcluded = row.employeeExcludeFromStatistics === 1
                || row.employeeExcludeFromStatistics === true
                || row.employeeExcludeFromStatistics === '1';
            return isDepartmentAllowed(row.employeeDepartment, restriction) && !employeeExcluded;
        });
        const totalLicenses = licenses.length;
        const fullDayLicenses = licenses.filter((l: any) => l.licenseType === 'يوم كامل').length;
        const hoursLicenses = licenses.filter((l: any) => l.licenseType === 'إستئذان قصير').length;
        const medicalLicenses = licenses.filter((l: any) => l.licenseType === 'إستئذان طبي').length;
        const totalHours = licenses.reduce((sum: number, l: any) => sum + (Number(l.hours) || 0), 0);

        const monthCounts: Record<string, number> = {};
        licenses.forEach((l: any) => {
            const key = `${l.month}/${l.year}`;
            monthCounts[key] = (monthCounts[key] || 0) + 1;
        });
        const mostActiveMonth = Object.keys(monthCounts).reduce((a, b) =>
            monthCounts[a] > monthCounts[b] ? a : b, '') || '';

        const employeeCounts: Record<string, number> = {};
        licenses.forEach((l: any) => {
            employeeCounts[l.employeeId] = (employeeCounts[l.employeeId] || 0) + 1;
        });
        const mostActiveEmployeeId = Object.keys(employeeCounts).reduce((a, b) =>
            employeeCounts[a] > employeeCounts[b] ? a : b, '');
        let mostActiveEmployee = '';
        if (mostActiveEmployeeId) {
            const employee = await db.get('SELECT name FROM Employees WHERE id = ?', [mostActiveEmployeeId]);
            mostActiveEmployee = employee?.name || '';
        }

        res.json({
            total_licenses: totalLicenses,
            full_day_licenses: fullDayLicenses,
            hours_licenses: hoursLicenses,
            medical_licenses: medicalLicenses,
            total_hours: totalHours,
            most_active_month: mostActiveMonth,
            most_active_employee: mostActiveEmployee
        });
    } catch (error) {
        console.error('Error fetching license stats:', error);
        res.status(500).json({ error: 'فشل في جلب الإحصائيات' });
    } finally {
        await db.close();
    }
});

// ==================== Audit Log ====================
app.get('/api/audit-log', async (req, res) => {
    const {
        entityType,
        entityTypes,
        excludeEntityTypes,
        entityId,
        action,
        from,
        to,
        limit = '200',
        offset = '0'
    } = req.query;

    const db = await getDb();
    try {
        const filters: string[] = [];
        const params: any[] = [];

        const typeList = typeof entityTypes === 'string'
            ? entityTypes.split(',').map((value) => value.trim()).filter(Boolean)
            : [];
        if (typeList.length) {
            filters.push(`entityType IN (${typeList.map(() => '?').join(',')})`);
            params.push(...typeList);
        } else if (entityType) {
            filters.push('entityType = ?');
            params.push(entityType);
        }

        const excludeList = typeof excludeEntityTypes === 'string'
            ? excludeEntityTypes.split(',').map((value) => value.trim()).filter(Boolean)
            : [];
        if (excludeList.length) {
            filters.push(`entityType NOT IN (${excludeList.map(() => '?').join(',')})`);
            params.push(...excludeList);
        }

        if (entityId) {
            filters.push('entityId = ?');
            params.push(entityId);
        }

        if (action) {
            filters.push('action = ?');
            params.push(action);
        }

        if (from) {
            filters.push('createdAt >= ?');
            params.push(from);
        }

        if (to) {
            filters.push('createdAt <= ?');
            params.push(to);
        }

        const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
        const limitValue = Math.min(parseInt(limit as string, 10) || 200, 500);
        const offsetValue = parseInt(offset as string, 10) || 0;

        const rows = await db.all(
            `SELECT * FROM AuditLog ${whereClause} ORDER BY datetime(createdAt) DESC LIMIT ? OFFSET ?`,
            [...params, limitValue, offsetValue]
        );

        const countRow = await db.get(
            `SELECT COUNT(*) as total FROM AuditLog ${whereClause}`,
            params
        );

        res.json({
            data: rows.map((row: any) => ({
                ...row,
                metadata: row.metadata ? JSON.parse(row.metadata) : null
            })),
            total: countRow?.total || 0,
            limit: limitValue,
            offset: offsetValue
        });
    } catch (error) {
        console.error('Error fetching audit log:', error);
        res.status(500).json({ error: 'فشل في جلب سجل التغييرات' });
    } finally {
        await db.close();
    }
});

// ==================== Enhanced Alerts APIs ====================

// Server-Sent Events (SSE) stream for alerts
app.get('/api/alerts/stream', async (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    // Flush headers when possible
    // @ts-ignore
    if (typeof (res as any).flushHeaders === 'function') {
        // @ts-ignore
        (res as any).flushHeaders();
    }
    res.write('retry: 10000\n\n');

    // Send initial unread count
    try {
        const db = await getDb();
        const { count } = await db.get('SELECT COUNT(*) as count FROM Alerts WHERE status = "new"');
        await db.close();
        res.write(`event: alerts_unread_count\n`);
        res.write(`data: ${JSON.stringify({ count })}\n\n`);
    } catch (e) {
        console.error('Failed to load initial unread count for SSE:', e);
    }

    const onCreated = (payload: any) => {
        res.write(`event: alert_created\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const onUpdated = (payload: any) => {
        res.write(`event: alert_updated\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const onDeleted = (payload: any) => {
        res.write(`event: alert_deleted\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const onUnread = (payload: any) => {
        res.write(`event: alerts_unread_count\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    alertEvents.on('alert_created', onCreated);
    alertEvents.on('alert_updated', onUpdated);
    alertEvents.on('alert_deleted', onDeleted);
    alertEvents.on('alerts_unread_count', onUnread);

    const keepAlive = setInterval(() => {
        res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
        clearInterval(keepAlive);
        alertEvents.off('alert_created', onCreated);
        alertEvents.off('alert_updated', onUpdated);
        alertEvents.off('alert_deleted', onDeleted);
        alertEvents.off('alerts_unread_count', onUnread);
        res.end();
    });
});

// Fetch Alerts with filtering and pagination
app.get('/api/alerts', async (req, res) => {
    const { status, type, severity, limit = '50', offset = '0' } = req.query;

    try {
        const db = await getDb();

        let query = 'SELECT * FROM Alerts WHERE 1=1';
        const params: any[] = [];

        if (status && status !== 'all') {
            query += ' AND status = ?';
            params.push(status);
        }

        if (type && type !== 'all') {
            query += ' AND type = ?';
            params.push(type);
        }

        if (severity && severity !== 'all') {
            query += ' AND severity = ?';
            params.push(severity);
        }

        query += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit as string), parseInt(offset as string));

        const alerts = await db.all(query, params);

        // Get total count for pagination
        let countQuery = 'SELECT COUNT(*) as total FROM Alerts WHERE 1=1';
        const countParams: any[] = [];

        if (status && status !== 'all') {
            countQuery += ' AND status = ?';
            countParams.push(status);
        }

        if (type && type !== 'all') {
            countQuery += ' AND type = ?';
            countParams.push(type);
        }

        if (severity && severity !== 'all') {
            countQuery += ' AND severity = ?';
            countParams.push(severity);
        }

        const countResult = await db.get(countQuery, countParams);

        await db.close();

        res.json({
            data: alerts,
            total: countResult.total,
            limit: parseInt(limit as string),
            offset: parseInt(offset as string)
        });
    } catch (error) {
        console.error('Error fetching alerts:', error);
        res.status(500).json({ error: 'Error fetching alerts.' });
    }
});

// Get unread alerts count
app.get('/api/alerts/unread-count', async (req, res) => {
    const db = await getDb();
    try {
        const result = await db.get('SELECT COUNT(*) as count FROM Alerts WHERE status = "new"');
        res.json({ count: result.count });
    } catch (error) {
        console.error('Error fetching unread alerts count:', error);
        res.status(500).json({ error: 'Error fetching unread alerts count.' });
    } finally {
        await db.close();
    }
});

// Server-Sent Events (SSE) endpoint for alerts stream
app.get('/api/alerts/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial unread count
    try {
        const db = await getDb();
        const { count } = await db.get('SELECT COUNT(*) as count FROM Alerts WHERE status = "new"');
        await db.close();
        res.write(`event: alerts_unread_count\n`);
        res.write(`data: ${JSON.stringify({ count })}\n\n`);
    } catch (e) {
        console.error('SSE initial unread count error:', e);
    }

    const send = (event: string, data: any) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const onCreated = (payload: any) => send('alert_created', payload);
    const onUpdated = (payload: any) => send('alert_updated', payload);
    const onDeleted = (payload: any) => send('alert_deleted', payload);
    const onUnread = (payload: any) => send('alerts_unread_count', payload);

    alertEvents.on('alert_created', onCreated);
    alertEvents.on('alert_updated', onUpdated);
    alertEvents.on('alert_deleted', onDeleted);
    alertEvents.on('alerts_unread_count', onUnread);

    const keepAlive = setInterval(() => {
        res.write(': keep-alive\n\n');
    }, 15000);

    req.on('close', () => {
        clearInterval(keepAlive);
        alertEvents.off('alert_created', onCreated);
        alertEvents.off('alert_updated', onUpdated);
        alertEvents.off('alert_deleted', onDeleted);
        alertEvents.off('alerts_unread_count', onUnread);
    });
});

// Mark alert as read
app.patch('/api/alerts/:id/read', async (req, res) => {
    const { id } = req.params;
    const db = await getDb();

    try {
        await db.run('BEGIN');

        const result = await db.run(
            'UPDATE Alerts SET status = "read", updatedAt = datetime("now","localtime") WHERE id = ?',
            [id]
        );

        if (result.changes === 0) {
            await db.run('ROLLBACK');
            return res.status(404).json({ error: 'Alert not found' });
        }

        // Log the action
        await db.run(`
            INSERT INTO AlertLog (id, alertId, action, timestamp, details)
            VALUES (?, ?, 'read', datetime('now','localtime'), ?)
        `, [
            `log_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            id,
            JSON.stringify({ action: 'marked_as_read' })
        ]);

        await db.run('COMMIT');
        // Broadcast update and new unread count
        try {
            const db2 = await getDb();
            const { count } = await db2.get('SELECT COUNT(*) as count FROM Alerts WHERE status = "new"');
            await db2.close();
            alertEvents.emit('alert_updated', { id, status: 'read', unreadCount: count });
            alertEvents.emit('alerts_unread_count', { count });
        } catch (e) {
            console.error('Failed to emit alert_updated event:', e);
        }
        res.json({ success: true });
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('Error marking alert as read:', error);
        res.status(500).json({ error: 'Error marking alert as read.' });
    } finally {
        await db.close();
    }
});

// Mark alert as resolved
app.patch('/api/alerts/:id/resolve', async (req, res) => {
    const { id } = req.params;
    const db = await getDb();

    try {
        await db.run('BEGIN');

        const result = await db.run(
            'UPDATE Alerts SET status = "resolved", updatedAt = datetime("now","localtime") WHERE id = ?',
            [id]
        );

        if (result.changes === 0) {
            await db.run('ROLLBACK');
            return res.status(404).json({ error: 'Alert not found' });
        }

        // Log the action
        await db.run(`
            INSERT INTO AlertLog (id, alertId, action, timestamp, details)
            VALUES (?, ?, 'resolved', datetime('now','localtime'), ?)
        `, [
            `log_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            id,
            JSON.stringify({ action: 'resolved' })
        ]);

        await db.run('COMMIT');
        try {
            const db2 = await getDb();
            const { count } = await db2.get('SELECT COUNT(*) as count FROM Alerts WHERE status = "new"');
            await db2.close();
            alertEvents.emit('alert_updated', { id, status: 'resolved', unreadCount: count });
            alertEvents.emit('alerts_unread_count', { count });
        } catch (e) {
            console.error('Failed to emit alert_updated (resolved):', e);
        }
        res.json({ success: true });
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('Error resolving alert:', error);
        res.status(500).json({ error: 'Error resolving alert.' });
    } finally {
        await db.close();
    }
});

// Dismiss alert
app.patch('/api/alerts/:id/dismiss', async (req, res) => {
    const { id } = req.params;
    const db = await getDb();

    try {
        await db.run('BEGIN');

        const result = await db.run(
            'UPDATE Alerts SET status = "dismissed", updatedAt = datetime("now","localtime") WHERE id = ?',
            [id]
        );

        if (result.changes === 0) {
            await db.run('ROLLBACK');
            return res.status(404).json({ error: 'Alert not found' });
        }

        // Log the action
        await db.run(`
            INSERT INTO AlertLog (id, alertId, action, timestamp, details)
            VALUES (?, ?, 'dismissed', datetime('now','localtime'), ?)
        `, [
            `log_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            id,
            JSON.stringify({ action: 'dismissed' })
        ]);

        await db.run('COMMIT');
        try {
            const db2 = await getDb();
            const { count } = await db2.get('SELECT COUNT(*) as count FROM Alerts WHERE status = "new"');
            await db2.close();
            alertEvents.emit('alert_updated', { id, status: 'dismissed', unreadCount: count });
            alertEvents.emit('alerts_unread_count', { count });
        } catch (e) {
            console.error('Failed to emit alert_updated (dismissed):', e);
        }
        res.json({ success: true });
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('Error dismissing alert:', error);
        res.status(500).json({ error: 'Error dismissing alert.' });
    } finally {
        await db.close();
    }
});

app.delete('/api/alerts/:id', async (req, res) => {
    const { id } = req.params;
    const db = await getDb();

    try {
        await db.run('BEGIN');

        // Delete related logs first
        await db.run('DELETE FROM AlertLog WHERE alertId = ?', [id]);

        // Delete the alert
        const result = await db.run('DELETE FROM Alerts WHERE id = ?', [id]);

        if (result.changes === 0) {
            await db.run('ROLLBACK');
            return res.status(404).json({ error: 'Alert not found' });
        }

        await db.run('COMMIT');
        try {
            const db2 = await getDb();
            const { count } = await db2.get('SELECT COUNT(*) as count FROM Alerts WHERE status = "new"');
            await db2.close();
            alertEvents.emit('alert_deleted', { id, unreadCount: count });
            alertEvents.emit('alerts_unread_count', { count });
        } catch (e) {
            console.error('Failed to emit alert_deleted:', e);
        }
        res.json({ success: true });
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('Error deleting alert:', error);
        res.status(500).json({ error: 'Error deleting alert.' });
    } finally {
        await db.close();
    }
});

// Create new alert
app.post('/api/alerts', async (req, res) => {
    const { employeeId, type, message, severity = 'medium', title, category = 'shift', actionUrl, metadata, expiresAt } = req.body;

    if (!type || !message || !title) {
        return res.status(400).json({ error: 'Type, message, and title are required' });
    }

    const db = await getDb();
    try {
        await db.run('BEGIN');

        const alertId = `alert_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const now = new Date().toISOString();

        await db.run(`
            INSERT INTO Alerts (
                id, employeeId, type, dateTriggered, status, message,
                severity, title, category, actionUrl, metadata, expiresAt,
                createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            alertId,
            employeeId || null,
            type,
            now,
            message,
            severity,
            title,
            category,
            actionUrl || null,
            metadata ? JSON.stringify(metadata) : null,
            expiresAt || null,
            now,
            now
        ]);

        // Log the creation
        await db.run(`
            INSERT INTO AlertLog (id, alertId, action, timestamp, details)
            VALUES (?, ?, 'created', ?, ?)
        `, [
            `log_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            alertId,
            now,
            JSON.stringify({ type, severity, category })
        ]);

        await db.run('COMMIT');
        try {
            const db2 = await getDb();
            const alert = await db2.get('SELECT * FROM Alerts WHERE id = ?', [alertId]);
            const { count } = await db2.get('SELECT COUNT(*) as count FROM Alerts WHERE status = "new"');
            await db2.close();
            alertEvents.emit('alert_created', { alert, unreadCount: count });
            alertEvents.emit('alerts_unread_count', { count });
        } catch (e) {
            console.error('Failed to emit alert_created event:', e);
        }
        res.status(201).json({ success: true, alertId });
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('Error creating alert:', error);
        res.status(500).json({ error: 'Error creating alert.' });
    } finally {
        await db.close();
    }
});

// ==================== Notification Settings APIs ====================

// Get notification settings for a user
app.get('/api/notification-settings/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const db = await getDb();
        let settings = await db.get('SELECT * FROM NotificationSettings WHERE userId = ?', [userId]);

        if (!settings) {
            // Create default settings for the user
            const defaultId = `settings_${Date.now()}`;
            await db.run(`
                INSERT INTO NotificationSettings (id, userId) VALUES (?, ?)
            `, [defaultId, userId]);

            settings = await db.get('SELECT * FROM NotificationSettings WHERE userId = ?', [userId]);
        }

        await db.close();

        // Convert to the expected format
        const response = {
            id: settings.id,
            userId: settings.userId,
            emailNotifications: settings.emailNotifications === 1,
            pushNotifications: settings.pushNotifications === 1,
            shiftReminders: settings.shiftReminders === 1,
            overdueAlerts: settings.overdueAlerts === 1,
            systemAlerts: settings.systemAlerts === 1,
            reminderDays: settings.reminderDays,
            overdueDays: settings.overdueDays,
            quietHours: {
                enabled: settings.quietHoursEnabled === 1,
                start: settings.quietHoursStart,
                end: settings.quietHoursEnd
            },
            createdAt: settings.createdAt,
            updatedAt: settings.updatedAt
        };

        res.json(response);
    } catch (error) {
        console.error('Error fetching notification settings:', error);
        res.status(500).json({ error: 'Error fetching notification settings.' });
    }
});

// Update notification settings for a user
app.patch('/api/notification-settings/:userId', async (req, res) => {
    const { userId } = req.params;
    const {
        emailNotifications,
        pushNotifications,
        shiftReminders,
        overdueAlerts,
        systemAlerts,
        reminderDays,
        overdueDays,
        quietHours
    } = req.body;

    const db = await getDb();
    try {
        await db.run('BEGIN');

        // Check if settings exist
        const existing = await db.get('SELECT id FROM NotificationSettings WHERE userId = ?', [userId]);

        if (!existing) {
            // Create new settings
            const settingsId = `settings_${Date.now()}`;
            await db.run(`
                INSERT INTO NotificationSettings (
                    id, userId, emailNotifications, pushNotifications, shiftReminders,
                    overdueAlerts, systemAlerts, reminderDays, overdueDays,
                    quietHoursEnabled, quietHoursStart, quietHoursEnd, updatedAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
            `, [
                settingsId,
                userId,
                emailNotifications ? 1 : 0,
                pushNotifications ? 1 : 0,
                shiftReminders ? 1 : 0,
                overdueAlerts ? 1 : 0,
                systemAlerts ? 1 : 0,
                reminderDays || 3,
                overdueDays || 1,
                quietHours?.enabled ? 1 : 0,
                quietHours?.start || '22:00',
                quietHours?.end || '08:00'
            ]);
        } else {
            // Update existing settings
            const updates: string[] = [];
            const params: any[] = [];

            if (emailNotifications !== undefined) {
                updates.push('emailNotifications = ?');
                params.push(emailNotifications ? 1 : 0);
            }

            if (pushNotifications !== undefined) {
                updates.push('pushNotifications = ?');
                params.push(pushNotifications ? 1 : 0);
            }

            if (shiftReminders !== undefined) {
                updates.push('shiftReminders = ?');
                params.push(shiftReminders ? 1 : 0);
            }

            if (overdueAlerts !== undefined) {
                updates.push('overdueAlerts = ?');
                params.push(overdueAlerts ? 1 : 0);
            }

            if (systemAlerts !== undefined) {
                updates.push('systemAlerts = ?');
                params.push(systemAlerts ? 1 : 0);
            }

            if (reminderDays !== undefined) {
                updates.push('reminderDays = ?');
                params.push(reminderDays);
            }

            if (overdueDays !== undefined) {
                updates.push('overdueDays = ?');
                params.push(overdueDays);
            }

            if (quietHours?.enabled !== undefined) {
                updates.push('quietHoursEnabled = ?');
                params.push(quietHours.enabled ? 1 : 0);
            }

            if (quietHours?.start !== undefined) {
                updates.push('quietHoursStart = ?');
                params.push(quietHours.start);
            }

            if (quietHours?.end !== undefined) {
                updates.push('quietHoursEnd = ?');
                params.push(quietHours.end);
            }

            if (updates.length > 0) {
                updates.push('updatedAt = datetime("now","localtime")');
                params.push(userId);

                await db.run(`
                    UPDATE NotificationSettings SET ${updates.join(', ')} WHERE userId = ?
                `, params);
            }
        }

        await db.run('COMMIT');
        res.json({ success: true });
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('Error updating notification settings:', error);
        res.status(500).json({ error: 'Error updating notification settings.' });
    } finally {
        await db.close();
    }
});

// Trigger manual alert check
app.post('/api/alerts/check', async (req, res) => {
    try {
        log('🔄 Manual alert check triggered');
        await checkAndCreateAlerts();
        res.json({ success: true, message: 'Alert check completed' });
    } catch (error) {
        console.error('Error in manual alert check:', error);
        res.status(500).json({ error: 'Error checking alerts.' });
    }
});

// Clear all alerts (for testing)
app.delete('/api/alerts/clear-all', async (req, res) => {
    const db = await getDb();
    try {
        await db.run('BEGIN');

        // Delete all alert logs first
        await db.run('DELETE FROM AlertLog');

        // Delete all alerts
        const result = await db.run('DELETE FROM Alerts');

        await db.run('COMMIT');

        log(`🗑️ Cleared ${result.changes || 0} alerts`);
        res.json({ success: true, deletedCount: result.changes || 0 });
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('Error clearing alerts:', error);
        res.status(500).json({ error: 'Error clearing alerts.' });
    } finally {
        await db.close();
    }
});

// Define types for settings
interface SettingRow {
    key: string;
    value: string;
    description: string;
}

interface Settings {
    [key: string]: {
        value: string;
        description: string;
    };
}

// Get all settings
app.get('/api/settings', async (req, res) => {
    let db;
    try {
        db = await getDb();
        const rows = await db.all('SELECT `key`, value, description FROM Settings');

        // Convert array of settings to object format
        const settings: Settings = {};
        (rows as SettingRow[]).forEach(setting => {
            settings[setting.key] = {
                value: setting.value,
                description: setting.description
            };
        });

        res.json(settings);
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).send('Error fetching settings.');
    } finally {
        if (db) {
            await db.close();
        }
    }
});

// حذف جميع الموظفين
app.post('/api/employees/delete-all', async (req, res) => {
    const db = await getDb();
    try {
        await db.run('BEGIN');
        const result = await db.run('DELETE FROM Employees');
        await db.run('COMMIT');
        res.json({ success: true, deleted: result.changes });
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('Error deleting all employees:', error);
        res.status(500).json({ success: false, message: 'Error deleting all employees', error: error instanceof Error ? error.message : String(error) });
    } finally {
        await db.close();
    }
});

// حذف التكرارات حسب رقم الملف (يبقى الأحدث)
app.post('/api/employees/remove-duplicates', async (req, res) => {
    const db = await getDb();
    try {
        await db.run('BEGIN');
        // الحصول على جميع أرقام الملفات وعددها
        const duplicates = await db.all(`
            SELECT fileNumber
            FROM Employees
            GROUP BY fileNumber
            HAVING COUNT(*) > 1
        `);
        let deleted = 0;
        for (const row of duplicates) {
            // لكل رقم ملف مكرر، احصل على الموظفين المرتبطين به، الأحدث أولاً
            const employees = await db.all(
                `SELECT id FROM Employees WHERE fileNumber = ? ORDER BY id DESC`,
                [row.fileNumber]
            );
            // حذف جميع الأقدم (من الثاني فصاعداً)
            for (let i = 1; i < employees.length; i++) {
                await db.run('DELETE FROM Employees WHERE id = ?', [employees[i].id]);
                deleted++;
            }
        }
        await db.run('COMMIT');
        res.json({ success: true, deleted });
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('Error removing duplicates:', error);
        res.status(500).json({ success: false, message: 'Error removing duplicates', error: error instanceof Error ? error.message : String(error) });
    } finally {
        await db.close();
    }
});

// Update settings
app.put('/api/settings', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : null;
    const headerPassword = req.header('x-settings-password');
    let password = typeof headerPassword === 'string' ? headerPassword : '';
    let rawSettingsSource: any = body;

    // Accept both payload styles:
    // 1) { settings: {...}, password: '...' }
    // 2) {...settings, password: '...' }
    // and safely unwrap accidental nested "settings" wrappers.
    for (let depth = 0; depth < 5; depth++) {
        if (!rawSettingsSource || typeof rawSettingsSource !== 'object' || Array.isArray(rawSettingsSource)) {
            break;
        }
        if (!password && typeof rawSettingsSource.password === 'string') {
            password = rawSettingsSource.password;
        }
        if (rawSettingsSource.settings && typeof rawSettingsSource.settings === 'object' && !Array.isArray(rawSettingsSource.settings)) {
            rawSettingsSource = rawSettingsSource.settings;
            continue;
        }
        break;
    }

    let settings: Record<string, any> = rawSettingsSource && typeof rawSettingsSource === 'object' && !Array.isArray(rawSettingsSource)
        ? { ...rawSettingsSource }
        : {};

    for (let depth = 0; depth < 5; depth++) {
        if (!password && typeof settings.password === 'string') {
            password = settings.password;
        }
        delete settings.password;

        if (settings.settings && typeof settings.settings === 'object' && !Array.isArray(settings.settings)) {
            settings = { ...settings.settings };
            continue;
        }
        delete settings.settings;
        break;
    }

    if (password !== SETTINGS_UPDATE_PASSWORD) {
        return res.status(403).json({
            success: false,
            message: 'كلمة المرور غير صحيحة. لا توجد صلاحيات كافية لحفظ الإعدادات.'
        });
    }

    if (!settings || typeof settings !== 'object' || Object.keys(settings).length === 0) {
        return res.status(400).json({
            success: false,
            message: 'بيانات الإعدادات غير صالحة'
        });
    }

    let db;
    try {
        db = await getDb();
        await db.run('BEGIN');

        // Update each setting in the transaction
        for (const [key, value] of Object.entries(settings)) {
            if (typeof value === 'object' && value !== null) {
                throw new Error(`قيمة إعداد غير صالحة للحقل "${key}". يجب أن تكون قيمة نصية/رقمية/منطقية فقط.`);
            }

            const existing = await db.get('SELECT id FROM Settings WHERE `key` = ?', [key]);
            if (existing) {
                await db.run(
                    'UPDATE Settings SET value = ?, updatedAt = datetime(\'now\',\'localtime\') WHERE `key` = ?',
                    [String(value), key]
                );
            } else {
                const settingId = `setting_${key}_${Date.now()}`;
                await db.run(
                    'INSERT INTO Settings (id, `key`, value, description) VALUES (?, ?, ?, ?)',
                    [settingId, key, String(value), 'إعداد مضاف تلقائياً من الإعدادات']
                );
            }
        }

        const alertUpcomingRaw = settings.alert_upcoming_days;
        const alertOverdueRaw = settings.alert_overdue_days;
        if (alertUpcomingRaw !== undefined || alertOverdueRaw !== undefined) {
            const reminderDays = Number.parseInt(String(alertUpcomingRaw ?? ''), 10);
            const overdueDays = Number.parseInt(String(alertOverdueRaw ?? ''), 10);
            const updates: string[] = [];
            const params: any[] = [];

            if (Number.isFinite(reminderDays)) {
                updates.push('reminderDays = ?');
                params.push(reminderDays);
            }
            if (Number.isFinite(overdueDays)) {
                updates.push('overdueDays = ?');
                params.push(overdueDays);
            }

            if (updates.length > 0) {
                const existing = await db.get('SELECT id FROM NotificationSettings WHERE userId = ?', ['default_user']);
                if (existing) {
                    updates.push('updatedAt = datetime("now","localtime")');
                    params.push('default_user');
                    await db.run(
                        `UPDATE NotificationSettings SET ${updates.join(', ')} WHERE userId = ?`,
                        params
                    );
                } else {
                    await db.run(
                        `INSERT INTO NotificationSettings (id, userId, reminderDays, overdueDays)
                         VALUES (?, ?, ?, ?)`,
                        [
                            `settings_${Date.now()}`,
                            'default_user',
                            Number.isFinite(reminderDays) ? reminderDays : 3,
                            Number.isFinite(overdueDays) ? overdueDays : 1
                        ]
                    );
                }
            }
        }

        await db.run('COMMIT');

        res.json({ success: true, message: 'Settings updated successfully' });
    } catch (error) {
        console.error('Error updating settings:', error);
        const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
        if (db) {
            await db.run('ROLLBACK');
        }
        res.status(500).json({
            success: false,
            message: errorMessage,
            error: errorMessage
        });
    } finally {
        if (db) {
            await db.close();
        }
    }
});

// Main function to start the server
// Create backup endpoint
app.post('/api/backup', async (req, res) => {
    try {
        const result = createDatabaseBackup();
        if (result.status === 'missing') {
            return res.status(404).json({ error: 'Database file not found' });
        }
        if (result.status === 'failed') {
            const details = result.error instanceof Error ? result.error.message : 'Unknown error';
            return res.status(500).json({
                error: 'فشل في إنشاء النسخة الاحتياطية',
                details
            });
        }

        return res.json({
            success: true,
            message: 'تم إنشاء النسخة الاحتياطية بنجاح',
            filename: result.backupFilename,
            path: result.backupPath,
            timestamp: result.timestamp
        });
    } catch (error) {
        console.error('Backup creation failed:', error);
        res.status(500).json({
            error: 'فشل في إنشاء النسخة الاحتياطية',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

const main = async () => {
    log('🚀 Starting GOV Shifts Server...');
    log(`[Main] Environment: ${process.env.NODE_ENV || 'development'}`);
    log(`[Main] Process ID: ${process.pid}`);
    log(`[Main] Node version: ${process.version}`);
    log(`[Main] Platform: ${process.platform} (${process.arch})`);

    // Log environment variables (safely)
    log('[Main] Environment variables:');
    log(`- PORT: ${process.env.PORT || 'not set (will use dynamic port)'}`);
    log(`- NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    log(`- DATA_DIR: ${process.env.DATA_DIR || 'not set (using CWD)'}`);

    try {
        // Check if we can write to DATA_DIR
        try {
            const testFile = path.join(process.env.DATA_DIR || process.cwd(), 'test-write.tmp');
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            log('[Main] ✅ Write access to DATA_DIR confirmed');
        } catch (error) {
            console.error('[Main] ❌ Cannot write to DATA_DIR:', error);
            throw error;
        }

        const lockAcquired = acquireDatabaseLock();
        if (!lockAcquired) {
            process.exit(1);
        }

        const startupBackup = createDatabaseBackup();

        // Initialize database
        log('[Main] Initializing database...');
        await initializeDatabase();
        log('[Main] ✅ Database initialized');

        // Run migrations
        log('[Main] Running database migrations...');
        await migrateDatabase();
        log('[Main] ✅ Database migrations completed');

        if (startupBackup.status === 'missing') {
            createDatabaseBackup();
        }

        // Get port from environment or use dynamic port (0)
        const requestedPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;
        const host = '127.0.0.1';

        log(`[Main] Starting HTTP server on ${host}:${requestedPort}...`);
        const server = app.listen(requestedPort, host, () => {
            const addr = server.address();
            const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;
            log(`[Main] ✅ Server is running on http://${host}:${actualPort}`);
            log(`[Main] Database location: ${path.join(process.env.DATA_DIR || process.cwd(), 'database.sqlite')}`);

            // Special, machine-readable log to be caught by Electron main process
            log(`BACKEND_PORT_IS::${actualPort}`);

            // Verify database is accessible
            getDb().then(db => {
                log('[Main] Verifying database connection...');
                return db.all("SELECT name FROM sqlite_master WHERE type='table'");
            }).then(tables => {
                log(`[Main] ✅ Database connection verified`);
                log(`[Main] Found ${tables.length} tables in database`);
                if (tables.length > 0) {
                    log('[Main] Tables:', tables.map((t: any) => t.name).join(', '));
                }

                // Start alert scheduler after database is verified
                log('[Main] Starting alert scheduler...');
                startAlertScheduler();
                log('🔔 Alert scheduler started');
            }).catch(err => {
                console.error('[Main] ❌ Failed to verify database:', err);
            });
        });

        // Handle server errors
        server.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`[Main] ❌ Port ${requestedPort} is already in use`);
            } else {
                console.error('[Main] ❌ Server error:', error);
            }
            process.exit(1);
        });

        // Handle process termination
        process.on('SIGINT', () => {
            log('\n[Main] Received SIGINT. Shutting down gracefully...');
            server.close(() => {
                log('[Main] Server closed');
                process.exit(0);
            });
        });

        process.on('uncaughtException', (error) => {
            console.error('[Main] ❌ Uncaught exception:', error);
            server.close(() => process.exit(1));
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('[Main] ❌ Unhandled rejection at:', promise, 'reason:', reason);
        });

    } catch (error) {
        console.error('[Main] ❌ Failed to start server:', error);
        process.exit(1);
    }
};

main();
