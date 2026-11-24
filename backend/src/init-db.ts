import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
const LOG_LEVEL = process.env.LOG_LEVEL || 'quiet';
const log = (...args: any[]) => {
    if (LOG_LEVEL !== 'quiet') console.log(...args);
};
const DATA_DIR = process.env.DATA_DIR || process.cwd();
log(`[DB] Using DATA_DIR: ${DATA_DIR}`);
if (!fs.existsSync(DATA_DIR)) {
    log(`[DB] Creating directory: ${DATA_DIR}`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
const dbPath = path.join(DATA_DIR, 'database.sqlite');
log(`[DB] Database path: ${dbPath}`);
log(`[DB] Directory exists: ${fs.existsSync(DATA_DIR)}`);
log(`[DB] Database file exists: ${fs.existsSync(dbPath)}`);

const SQL_SCHEMA = `
-- جدول الأقسام (Departments)
CREATE TABLE IF NOT EXISTS Departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- جدول الرتب (Ranks)
CREATE TABLE IF NOT EXISTS Ranks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL, -- officer, nco, professional, civilians
    "order" INTEGER NOT NULL
);

-- جدول الموظفين (Employees)
CREATE TABLE IF NOT EXISTS Employees (
    id TEXT PRIMARY KEY,
    fileNumber TEXT UNIQUE,
    name TEXT NOT NULL,
    firstName TEXT,
    secondName TEXT,
    thirdName TEXT,
    fourthName TEXT,
    familyName TEXT,
    category TEXT NOT NULL, -- officer, nco, professional, civilians
    rank TEXT NOT NULL,
    jobTitle TEXT NULL,
    jobGrade TEXT NULL,
    professionalGroup TEXT NULL,
    department TEXT NOT NULL,
    status TEXT NOT NULL, -- active, inactive
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_fileNumber_unique
ON Employees(fileNumber)
WHERE fileNumber IS NOT NULL AND fileNumber <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_civilId_unique
ON Employees(civilId)
WHERE civilId IS NOT NULL AND civilId <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_referenceNumber_unique
ON Employees(referenceNumber)
WHERE referenceNumber IS NOT NULL AND referenceNumber <> '';

-- جدول المناوبات (Shifts)
CREATE TABLE IF NOT EXISTS Shifts (
    id TEXT PRIMARY KEY,
    shiftDate TEXT NOT NULL,
    createdBy TEXT NOT NULL,
    note TEXT,
    createdAt TEXT NOT NULL
);

-- جدول تعيينات المناوبات (ShiftAssignments)
CREATE TABLE IF NOT EXISTS ShiftAssignments (
    id TEXT PRIMARY KEY,
    shiftId TEXT NOT NULL,
    employeeId TEXT NOT NULL,
    status TEXT NOT NULL, -- attended, absent
    counted INTEGER NOT NULL, -- 0 or 1
    note TEXT,
    addedAt TEXT NOT NULL,
    FOREIGN KEY (shiftId) REFERENCES Shifts(id),
    FOREIGN KEY (employeeId) REFERENCES Employees(id)
);

-- جدول أيام الاستثناء للمناوبات (ShiftDayExceptions)
CREATE TABLE IF NOT EXISTS ShiftDayExceptions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL,
    note TEXT,
    createdBy TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- جدول استثناءات المناوبات (ShiftExceptions)
CREATE TABLE IF NOT EXISTS ShiftExceptions (
    id TEXT PRIMARY KEY,
    employeeId TEXT NOT NULL,
    date TEXT NOT NULL,
    reason TEXT NOT NULL, -- medical, vacation, absence, other
    note TEXT,
    FOREIGN KEY (employeeId) REFERENCES Employees(id)
);

-- جدول الإعدادات (Settings)
CREATE TABLE IF NOT EXISTS Settings (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    description TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- جدول التنبيهات المحسن (Alerts)
CREATE TABLE IF NOT EXISTS Alerts (
    id TEXT PRIMARY KEY,
    employeeId TEXT,
    type TEXT NOT NULL, -- 'shift_not_received', 'no_upcoming_shift', 'overdue_shift', 'system', 'validation', 'reminder'
    dateTriggered TEXT NOT NULL,
    status TEXT NOT NULL, -- 'new', 'read', 'resolved', 'dismissed'
    message TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium', -- 'high', 'medium', 'low'
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'shift', -- 'shift', 'employee', 'system', 'reminder'
    actionUrl TEXT,
    metadata TEXT, -- JSON string for additional data
    expiresAt TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (employeeId) REFERENCES Employees(id)
);

-- جدول تمديدات الفنيون
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

-- جدول الرخص
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

-- جدول سجل التغييرات
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

-- جدول إعدادات الإشعارات (NotificationSettings)
CREATE TABLE IF NOT EXISTS NotificationSettings (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    emailNotifications INTEGER NOT NULL DEFAULT 1, -- 0 or 1 (boolean)
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

-- جدول سجل التنبيهات (AlertLog) لتتبع التنبيهات المرسلة
CREATE TABLE IF NOT EXISTS AlertLog (
    id TEXT PRIMARY KEY,
    alertId TEXT NOT NULL,
    action TEXT NOT NULL, -- 'created', 'sent', 'read', 'resolved', 'dismissed'
    timestamp TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    details TEXT, -- JSON string for additional details
    FOREIGN KEY (alertId) REFERENCES Alerts(id)
);

-- جدول الجنسيات
CREATE TABLE IF NOT EXISTS Nationalities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- جدول المسميات الوظيفية / المناصب
CREATE TABLE IF NOT EXISTS JobTitles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    UNIQUE(name, category)
);

-- جدول الأقسام الفرعية المرتبطة بالإدارات
CREATE TABLE IF NOT EXISTS Sections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    departmentId TEXT NOT NULL,
    UNIQUE(name, departmentId),
    FOREIGN KEY (departmentId) REFERENCES Departments(id)
);
`;

const SQL_DATA = `
-- بيانات الأقسام (Departments)
INSERT OR IGNORE INTO Departments (id, name) VALUES
('1', 'السجل العام'),
('2', 'التخطيط والتنظيم'),
('3', 'المالية والإدارية'),
('4', 'الخدمات المجتمعية'),
('5', 'المكتب الفني'),
('6', 'م.م.ع. شئون الفنية'),
('7', 'م.م.ع. شئون المكتب');

-- بيانات الرتب (Ranks)
INSERT OR IGNORE INTO Ranks (id, name, category, "order") VALUES
('1', 'رئيس قسم', 'قيادات', 1),
('2', 'مقدم حقوقي', 'قيادات', 2),
('3', 'مشرف أول', 'قيادات', 3),
('4', 'مشرف أول حقوقي', 'قيادات', 4),
('5', 'مشرف', 'قيادات', 5),
('6', 'مشرف حقوقي', 'قيادات', 6),
('7', 'موظف أول', 'قيادات', 7),
('8', 'موظف أول حقوقي', 'قيادات', 8),
('9', 'موظف', 'قيادات', 9),
('10', 'موظف حقوقي', 'قيادات', 10),
('11', 'مشرف', 'مشرفون', 1),
('12', 'مشرف مساعد', 'مشرفون', 2),
('13', 'موظف أول', 'مشرفون', 3),
('14', 'موظف', 'مشرفون', 4),
('15', 'موظف', 'مشرفون', 5),
('16', 'وكيل موظف', 'مشرفون', 6),
('17', 'موظف خدمات', 'مشرفون', 7),
('18', 'فني', 'فنيون', 1),
('19', 'إداري', 'إداريون', 1);

-- بيانات الإعدادات الافتراضية (Settings)
INSERT OR IGNORE INTO Settings (id, key, value, description) VALUES
('setting_system_name', 'system_name', 'نظام إدارة المناوبات', 'اسم النظام'),
('setting_company_name', 'company_name', 'الهيئة العامة للشؤون الإدارية والموارد البشرية', 'اسم المؤسسة'),
('setting_company_phone', 'company_phone', '+966-11-1234567', 'هاتف المؤسسة'),
('setting_company_email', 'company_email', 'admin@ministry.gov.sa', 'البريد الإلكتروني للمؤسسة'),
('setting_company_address', 'company_address', 'الرياض، المملكة العربية السعودية', 'عنوان المؤسسة'),
('setting_alert_overdue_days', 'alert_overdue_days', '3', 'عدد الأيام قبل إرسال تنبيه عدم استلام المناوبة'),
('setting_alert_upcoming_days', 'alert_upcoming_days', '3', 'عدد الأيام للتنبيه عند عدم وجود مناوبات مجدولة'),
('setting_email_notifications', 'email_notifications', 'true', 'تفعيل إشعارات البريد الإلكتروني'),
('setting_hide_shifts', 'hide_shifts', 'false', 'إخفاء نظام المناوبات في الواجهة'),
('setting_hide_licenses', 'hide_licenses', 'false', 'إخفاء نظام الرخص في الواجهة'),
('setting_auto_backup', 'auto_backup', 'false', 'تفعيل النسخ الاحتياطي التلقائي'),
('setting_backup_frequency', 'backup_frequency', 'daily', 'تكرار النسخ الاحتياطي (daily, weekly, monthly)'),
('setting_notification_check_days', 'notification_check_days', '3', 'عدد الأيام للتحقق من المناوبات القادمة'),
('setting_weekend_days', 'weekend_days', '5,6', 'أيام العطل الأسبوعية (0=الأحد, 1=الاثنين, ... 6=السبت)'),
('setting_exclude_weekend_shifts', 'exclude_weekend_shifts', 'true', 'استثناء الجمعة والسبت من المناوبات'),
('setting_notification_enabled', 'notification_enabled', 'true', 'تفعيل نظام التنبيهات'),
('setting_notification_frequency', 'notification_frequency', 'daily', 'تكرار فحص التنبيهات (hourly, daily)'),
('setting_extension_reminder_days', 'extension_reminder_days', '30', 'أيام التنبيه لتمديد الفنيون قبل الانتهاء (مثال: 90,60,30)'),
('setting_extension_critical_days', 'extension_critical_days', '30', 'عدد الأيام للتنبيه الخطير لتمديد الفنيون');

-- إعدادات الإشعارات الافتراضية للمستخدم الافتراضي
INSERT OR IGNORE INTO NotificationSettings (id, userId) VALUES
('default_user_settings', 'default_user');

-- بيانات الجنسيات
INSERT OR IGNORE INTO Nationalities (id, name) VALUES
('nat_sa', 'سعودي'),
('nat_eg', 'مصري'),
('nat_jo', 'أردني');

-- بيانات المسميات الوظيفية / المناصب
INSERT OR IGNORE INTO JobTitles (id, name, category) VALUES
('job_officer_cmd', 'قائد وحدة', 'قيادات'),
('job_pro_worker', 'عامل', 'فنيون'),
('job_civil', 'موظف مدني', 'إداريون');

-- بيانات الأقسام الفرعية
INSERT OR IGNORE INTO Sections (id, name, departmentId) VALUES
('sec_1', 'القسم أ', '1'),
('sec_2', 'القسم ب', '2'),
('sec_3', 'القسم ج', '3');


`;

export async function initializeDatabase() {
    log(`[DB] Initializing database at: ${dbPath}`);

    // Check if database file exists before trying to open it
    const dbExists = fs.existsSync(dbPath);
    log(`[DB] Database file exists before initialization: ${dbExists}`);

    try {
        const db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        try {
            // Verify we can access the database
            log('[DB] Database opened successfully');

            // Check if tables exist before creating them
            const tables = await db.all(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            );
            log(`[DB] Existing tables:`, tables);

            log('[DB] Creating database schema...');
            await db.exec(SQL_SCHEMA);
            log('[DB] Schema created successfully');

            // Check tables again after schema creation
            const tablesAfterSchema = await db.all(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            );
            log(`[DB] Tables after schema creation:`, tablesAfterSchema);

            log('[DB] Inserting initial data...');
            try {
                await db.exec(SQL_DATA);
                log('[DB] Data inserted successfully');
            } catch (seedErr) {
                console.error('[DB] Data seed encountered an issue, continuing with migrations:', seedErr);
            }

            // Verify data was inserted
            const employeeCount = await db.get("SELECT COUNT(*) as count FROM Employees");
            const departmentCount = await db.get("SELECT COUNT(*) as count FROM Departments");
            const rankCount = await db.get("SELECT COUNT(*) as count FROM Ranks");

            log(`[DB] Data verification:`);
            log(`[DB]   - Employees: ${employeeCount?.count || 0}`);
            log(`[DB]   - Departments: ${departmentCount?.count || 0}`);
            log(`[DB]   - Ranks: ${rankCount?.count || 0}`);

            log('[DB] Database initialization complete');
        } catch (error) {
            console.error('[DB] Error during database initialization:', error);
            throw error;
        } finally {
            await db.close();
            log('[DB] Database connection closed');
        }
    } catch (error) {
        console.error('[DB] Failed to open database:', error);
        throw error;
    }
}
