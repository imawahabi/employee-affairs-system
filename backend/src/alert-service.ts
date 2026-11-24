import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { alertEvents } from './alert-events';
import {
    computeExtensionStatusForEmployee,
    getTodayUtc,
    parseDateOnly,
    toDateOnlyString
} from './professional-extension-utils';

import fs from 'fs';
import path from 'path';

const LOG_LEVEL = process.env.LOG_LEVEL || 'quiet';
const log = (...args: any[]) => {
    if (LOG_LEVEL !== 'quiet') console.log(...args);
};

const toLocalDateString = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const DATA_DIR = process.env.DATA_DIR || process.cwd();
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
const dbPath = path.join(DATA_DIR, 'database.sqlite');

async function getDb() {
    return open({
        filename: dbPath,
        driver: sqlite3.Database
    });
}

interface Employee {
    id: string;
    name: string;
    lastShiftDate: string | null;
}

interface Alert {
    id: string;
    employeeId?: string;
    type: string;
    dateTriggered: string;
    status: string;
    message: string;
    severity: string;
    title: string;
    category: string;
    actionUrl?: string;
    metadata?: string;
    expiresAt?: string;
}

interface NotificationSettings {
    reminderDays: number;
    overdueDays: number;
    emailNotifications: boolean;
    shiftReminders: boolean;
    overdueAlerts: boolean;
    systemAlerts: boolean;
}

interface ExtensionAlertSettings {
    reminderDays: number[];
    criticalDays: number;
    enabled: boolean;
}

let excludeWeekendShifts = true;

const normalizeDateKey = (value: string) => {
    const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
};

// دالة للتحقق من أيام العطل (الجمعة والسبت)
function isWeekend(date: Date): boolean {
    const day = date.getDay(); // 0 = الأحد, 1 = الاثنين, ... 6 = السبت
    return excludeWeekendShifts && (day === 5 || day === 6); // الجمعة والسبت
}

// دالة لحساب التاريخ التالي مع تجاهل أيام العطل
function getNextWorkingDay(date: Date, daysToAdd: number): Date {
    const result = new Date(date);
    let addedDays = 0;

    while (addedDays < daysToAdd) {
        result.setDate(result.getDate() + 1);
        if (!isWeekend(result)) {
            addedDays++;
        }
    }

    return result;
}

// دالة لحساب عدد أيام العمل بين تاريخين
function getWorkingDaysBetween(startDate: Date, endDate: Date): number {
    let count = 0;
    const current = new Date(startDate);

    while (current <= endDate) {
        if (!isWeekend(current)) {
            count++;
        }
        current.setDate(current.getDate() + 1);
    }

    return count;
}

const loadExcludeWeekendShifts = async (db: any): Promise<boolean> => {
    try {
        const row = await db.get(`SELECT value FROM Settings WHERE key = 'exclude_weekend_shifts'`);
        if (!row || row.value === undefined || row.value === null) return true;
        return String(row.value).toLowerCase() !== 'false';
    } catch (error) {
        console.warn('Failed to load exclude_weekend_shifts setting:', error);
        return true;
    }
};

// دالة لإنشاء تنبيه جديد
async function createAlert(alertData: Omit<Alert, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const db = await getDb();
    try {
        const alertId = `alert_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const now = new Date().toISOString();

        await db.run(`
            INSERT INTO Alerts (
                id, employeeId, type, dateTriggered, status, message, 
                severity, title, category, actionUrl, metadata, expiresAt, 
                createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            alertId,
            alertData.employeeId || null,
            alertData.type,
            alertData.dateTriggered,
            alertData.status,
            alertData.message,
            alertData.severity,
            alertData.title,
            alertData.category,
            alertData.actionUrl || null,
            alertData.metadata || null,
            alertData.expiresAt || null,
            now,
            now
        ]);

        // إضافة سجل في AlertLog
        await db.run(`
            INSERT INTO AlertLog (id, alertId, action, timestamp, details)
            VALUES (?, ?, 'created', ?, ?)
        `, [
            `log_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            alertId,
            now,
            JSON.stringify({ type: alertData.type, severity: alertData.severity })
        ]);

        // Emit SSE events so the frontend updates in real-time
        try {
            const alert = await db.get('SELECT * FROM Alerts WHERE id = ?', [alertId]);
            const { count } = await db.get('SELECT COUNT(*) as count FROM Alerts WHERE status = "new"');
            alertEvents.emit('alert_created', { alert, unreadCount: count });
            alertEvents.emit('alerts_unread_count', { count });
        } catch (e) {
            console.error('Failed to emit alert_created from scheduler:', e);
        }

        return alertId;
    } finally {
        await db.close();
    }
}

// دالة للحصول على إعدادات الإشعارات
async function getNotificationSettings(): Promise<NotificationSettings> {
    const db = await getDb();
    try {
        // الحصول على الإعدادات من جدول Settings
        const settings = await db.all(`
            SELECT key, value FROM Settings 
            WHERE key IN (
                'alert_upcoming_days', 'alert_overdue_days', 
                'email_notifications', 'notification_enabled'
            )
        `);

        const settingsMap: { [key: string]: string } = {};
        settings.forEach((setting: any) => {
            settingsMap[setting.key] = setting.value;
        });

        // الحصول من جدول NotificationSettings إذا وجد
        const userSettings = await db.get(`
            SELECT * FROM NotificationSettings WHERE userId = 'default_user'
        `);

        return {
            reminderDays: parseInt(
                settingsMap.alert_upcoming_days || String(userSettings?.reminderDays ?? 3),
                10
            ),
            overdueDays: parseInt(
                settingsMap.alert_overdue_days || String(userSettings?.overdueDays ?? 1),
                10
            ),
            emailNotifications: userSettings
                ? userSettings.emailNotifications === 1
                : settingsMap.email_notifications === 'true',
            shiftReminders: userSettings
                ? userSettings.shiftReminders === 1
                : true,
            overdueAlerts: userSettings
                ? userSettings.overdueAlerts === 1
                : true,
            systemAlerts: userSettings
                ? userSettings.systemAlerts === 1
                : true
        };
    } finally {
        await db.close();
    }
}

const parseReminderDays = (rawValue: string | undefined, fallback: number[]): number[] => {
    if (!rawValue) return fallback;
    const parsed = rawValue
        .split(/[,\\s]+/)
        .map((val) => parseInt(val, 10))
        .filter((num) => Number.isFinite(num) && num > 0);
    const unique = Array.from(new Set(parsed));
    return unique.length ? unique.sort((a, b) => b - a) : fallback;
};

const getExtensionAlertSettings = async (db: any): Promise<ExtensionAlertSettings> => {
    const rows = await db.all(`
        SELECT key, value FROM Settings
        WHERE key IN ('extension_reminder_days', 'extension_critical_days', 'notification_enabled')
    `);
    const settingsMap: { [key: string]: string } = {};
    rows.forEach((row: any) => {
        settingsMap[row.key] = row.value;
    });

    const reminderDays = parseReminderDays(settingsMap.extension_reminder_days, [30]);
    const criticalDays = parseInt(settingsMap.extension_critical_days || '30', 10);
    const enabled = settingsMap.notification_enabled !== 'false';

    return {
        reminderDays,
        criticalDays: Number.isFinite(criticalDays) && criticalDays > 0 ? criticalDays : 30,
        enabled
    };
};

// دالة للتحقق من التنبيهات المطلوبة
export async function checkAndCreateAlerts(): Promise<void> {
    log('🔍 بدء فحص التنبيهات...');

    const db = await getDb();
    try {
        const settings = await getNotificationSettings();
        const extensionSettings = await getExtensionAlertSettings(db);
        excludeWeekendShifts = await loadExcludeWeekendShifts(db);

        if (!settings.shiftReminders && !settings.overdueAlerts) {
            log('⚠️ التنبيهات معطلة في الإعدادات');
        }

        const today = new Date();
        const todayString = toLocalDateString(today);
        const todayUtc = getTodayUtc();

        log(`📅 اليوم: ${todayString}`);
        log(`🔢 أيام التذكير المسبق: ${settings.reminderDays}`);
        log(`🔢 أيام التأخير للتنبيه: ${settings.overdueDays}`);

        // المنطق الأول: فجوة في المناوبات (لا توجد مناوبات بعد X أيام من اليوم)
        if (settings.shiftReminders) {
            await checkShiftGap(db, today, todayString, settings.reminderDays);
        }

        // المنطق الثاني: مناوبات غير مستلمة (مر عليها X أيام ولم تُستلم)
        if (settings.overdueAlerts) {
            await checkUnreceivedShifts(db, today, todayString, settings.overdueDays);
        }

        // المنطق الثالث: تنبيهات تمديد الفنيون
        if (extensionSettings.enabled && extensionSettings.reminderDays.length > 0) {
            await checkProfessionalExtensionAlerts(db, todayUtc, extensionSettings);
        }

        log('✅ انتهى فحص التنبيهات');
    } catch (error) {
        console.error('❌ خطأ في فحص التنبيهات:', error);
    } finally {
        await db.close();
    }
}

async function checkProfessionalExtensionAlerts(
    db: any,
    today: Date,
    settings: ExtensionAlertSettings
): Promise<void> {
    log(`\n👥 فحص تنبيهات تمديد الفنيون (${settings.reminderDays.join(', ')})`);

    const employees = await db.all(`
        SELECT * FROM Employees
        WHERE category = 'فنيون'
        AND status = 'active'
        AND birthDate IS NOT NULL
    `);

    if (!employees.length) {
        log('ℹ️ لا توجد بيانات لفنيون بتاريخ ميلاد صالح');
        return;
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

    const dateFormatter = new Intl.DateTimeFormat('ar-US', {
        calendar: 'gregory',
        numberingSystem: 'latn',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    });

    for (const employee of employees) {
        const status = computeExtensionStatusForEmployee(employee, extensionMap.get(employee.id) || [], today);
        if (!status) {
            continue;
        }

        if (status.daysRemaining <= 0) {
            const overdueDays = Math.abs(status.daysRemaining);
            const existingOverdueAlert = await db.get(`
                SELECT id FROM Alerts
                WHERE type = 'professional_extension'
                AND employeeId = ?
                AND json_extract(metadata, '$.dueDate') = ?
                AND json_extract(metadata, '$.overdue') = 1
                LIMIT 1
            `, [employee.id, status.dueDate]);

            if (!existingOverdueAlert) {
                const dueDateObj = parseDateOnly(status.dueDate);
                const dueDateFormatted = dueDateObj ? dateFormatter.format(dueDateObj) : status.dueDate;
                const message = overdueDays === 0
                    ? `ينتهي تمديد فني /  ${employee.name} بتاريخ ${dueDateFormatted}. يلزم إصدار قرار التمديد اليوم.`
                    : `انتهى تمديد فني /  ${employee.name} بتاريخ ${dueDateFormatted} وتأخر ${overdueDays} يوم عن إصدار قرار التمديد.`;

                const expiresAt = dueDateObj
                    ? new Date(dueDateObj.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
                    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

                await createAlert({
                    employeeId: employee.id,
                    type: 'professional_extension',
                    dateTriggered: toDateOnlyString(today),
                    status: 'new',
                    message,
                    severity: 'high',
                    title: 'تأخر تمديد فني',
                    category: 'employee',
                    actionUrl: '/professional-extensions',
                    metadata: JSON.stringify({
                        employeeId: employee.id,
                        dueDate: status.dueDate,
                        overdueDays,
                        overdue: 1,
                        stage: status.stage,
                        periodStart: status.periodStart,
                        periodEnd: status.periodEnd
                    }),
                    expiresAt
                });
            }
            continue;
        }

        for (const reminderDays of settings.reminderDays) {
            if (status.daysRemaining !== reminderDays) continue;

            const existingAlert = await db.get(`
                SELECT id FROM Alerts
                WHERE type = 'professional_extension'
                AND employeeId = ?
                AND json_extract(metadata, '$.dueDate') = ?
                AND json_extract(metadata, '$.reminderDays') = ?
                LIMIT 1
            `, [employee.id, status.dueDate, reminderDays]);

            if (existingAlert) {
                continue;
            }

            const dueDateObj = parseDateOnly(status.dueDate);
            const dueDateFormatted = dueDateObj ? dateFormatter.format(dueDateObj) : status.dueDate;
            const severity = status.daysRemaining <= settings.criticalDays ? 'high' : (status.daysRemaining <= 60 ? 'medium' : 'low');
            const title = status.stage === 'pre_60' ? 'اقتراب سن التقاعد الفني' : 'اقتراب انتهاء تمديد فني';
            const message = status.stage === 'pre_60'
                ? `سيبلغ الموظف ${employee.name} سن 60 بتاريخ ${dueDateFormatted}. تبقى ${status.daysRemaining} يوم لإكمال إجراءات التمديد.`
                : `ينتهي تمديد الموظف ${employee.name} بتاريخ ${dueDateFormatted}. تبقى ${status.daysRemaining} يوم لإصدار قرار التمديد.`;

            const expiresAt = dueDateObj
                ? new Date(dueDateObj.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
                : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

            await createAlert({
                employeeId: employee.id,
                type: 'professional_extension',
                dateTriggered: toDateOnlyString(today),
                status: 'new',
                message,
                severity,
                title,
                category: 'employee',
                actionUrl: '/professional-extensions',
                metadata: JSON.stringify({
                    employeeId: employee.id,
                    dueDate: status.dueDate,
                    reminderDays,
                    stage: status.stage,
                    periodStart: status.periodStart,
                    periodEnd: status.periodEnd
                }),
                expiresAt
            });
        }
    }
}

// المنطق الأول: فجوة في المناوبات - التحقق من وجود فجوة أكثر من X أيام بين اليوم وآخر مناوبة
async function checkShiftGap(
    db: any,
    today: Date,
    todayString: string,
    reminderDays: number
): Promise<void> {
    log(`\n🎯 المنطق الأول: فحص فجوة المناوبات (${reminderDays} أيام)`);

    const dayMs = 24 * 60 * 60 * 1000;
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // حساب التاريخ المستهدف (اليوم + أيام التذكير المسبق)
    const targetDate = new Date(todayDate);
    targetDate.setDate(targetDate.getDate() + reminderDays);
    const targetDateString = toLocalDateString(targetDate);
    const gapDateFormatter = new Intl.DateTimeFormat('ar-US', {
        calendar: 'gregory',
        numberingSystem: 'latn',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    });
    const targetDateFormatted = gapDateFormatter.format(targetDate);

    log(`📅 التاريخ المستهدف: ${targetDateString} (${targetDateFormatted})`);

    // التحقق من وجود تنبيه مشابه في آخر 24 ساعة لتجنب التكرار
    const existingAlert = await db.get(`
        SELECT id FROM Alerts
        WHERE type = 'no_upcoming_shift'
        AND status IN ('new', 'read')
        AND date(dateTriggered) = date('now', 'localtime')
    `);

    if (existingAlert) {
        log('⚠️ تنبيه فجوة المناوبات موجود بالفعل لهذا اليوم');
        return;
    }

    // التحقق الإضافي من عدم وجود تنبيهات مشابهة بنفس المحتوى
    const duplicateAlert = await db.get(`
        SELECT id FROM Alerts
        WHERE type = 'no_upcoming_shift'
        AND title = 'لا توجد مناوبات مجدولة'
        AND status IN ('new', 'read')
        AND date(dateTriggered) >= date('now', 'localtime', '-1 day')
    `);

    if (duplicateAlert) {
        log('⚠️ تنبيه مشابه موجود بالفعل في آخر 24 ساعة');
        return;
    }

    // البحث عن أقرب مناوبة من اليوم فما بعد
    const nextShift = await db.get(`
        SELECT s.id, s.shiftDate
        FROM Shifts s
        WHERE date(s.shiftDate) >= date(?)
        ORDER BY s.shiftDate ASC
        LIMIT 1
    `, [todayString]);

    // البحث عن أقرب يوم استثنائي من اليوم فما بعد
    const nextException = await db.get(`
        SELECT id, date, reason
        FROM ShiftDayExceptions
        WHERE date(date) >= date(?)
        ORDER BY date ASC
        LIMIT 1
    `, [todayString]);

    const resolvePlanned = () => {
        const shiftKey = nextShift ? normalizeDateKey(nextShift.shiftDate) : '';
        const exceptionKey = nextException ? normalizeDateKey(nextException.date) : '';
        if (shiftKey && exceptionKey) {
            return shiftKey <= exceptionKey
                ? { type: 'shift' as const, dateKey: shiftKey, raw: nextShift.shiftDate }
                : { type: 'exception' as const, dateKey: exceptionKey, raw: nextException.date };
        }
        if (shiftKey) {
            return { type: 'shift' as const, dateKey: shiftKey, raw: nextShift.shiftDate };
        }
        if (exceptionKey) {
            return { type: 'exception' as const, dateKey: exceptionKey, raw: nextException.date };
        }
        return null;
    };

    const nextPlanned = resolvePlanned();
    if (!nextPlanned) {
        // لا توجد مناوبات أو أيام استثنائية قادمة - إنشاء تنبيه
        const message = `لا توجد مناوبات أو أيام استثنائية مجدولة خلال ${reminderDays} يوم القادمة.`;

        await createAlert({
            type: 'no_upcoming_shift',
            dateTriggered: todayString,
            status: 'new',
            message,
            severity: 'high',
            title: 'تأخر في المناوبات',
            category: 'shift',
            actionUrl: '/shift-registration',
            metadata: JSON.stringify({
                targetDate: targetDateString,
                targetDateFormatted,
                reminderDays,
                gapDays: reminderDays,
                nextShiftDate: null,
                nextPlannedType: null,
                alertType: 'shift_gap'
            }),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });

        log(`🚨 تم إنشاء تنبيه: فجوة في المناوبات أكثر من ${reminderDays} أيام`);
        return;
    }

    const [year, month, day] = nextPlanned.dateKey.split('-').map(Number);
    const nextPlannedDate = year && month && day
        ? new Date(year, month - 1, day)
        : new Date(nextPlanned.raw);
    const gapDays = Math.round((nextPlannedDate.getTime() - todayDate.getTime()) / dayMs);

    if (gapDays > reminderDays) {
        const nextPlannedFormatted = gapDateFormatter.format(nextPlannedDate);
        const message = nextPlanned.type === 'shift'
            ? `لا توجد مناوبات مجدولة خلال ${reminderDays} يوم القادمة. أقرب مناوبة بتاريخ ${nextPlannedFormatted}.`
            : `لا توجد مناوبات مجدولة خلال ${reminderDays} يوم القادمة. أقرب يوم استثنائي بتاريخ ${nextPlannedFormatted}.`;

        await createAlert({
            type: 'no_upcoming_shift',
            dateTriggered: todayString,
            status: 'new',
            message,
            severity: 'high',
            title: 'تأخر في المناوبات',
            category: 'shift',
            actionUrl: '/shift-registration',
            metadata: JSON.stringify({
                targetDate: targetDateString,
                targetDateFormatted,
                reminderDays,
                gapDays,
                nextShiftDate: nextPlanned.type === 'shift' ? nextPlanned.dateKey : null,
                nextPlannedType: nextPlanned.type,
                alertType: 'shift_gap'
            }),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });

        log(`🚨 تم إنشاء تنبيه: فجوة في المناوبات أكثر من ${reminderDays} أيام`);
    } else {
        if (nextPlanned.type === 'shift') {
            log(`✅ توجد مناوبة في ${nextPlanned.raw} - لا توجد فجوة`);
        } else {
            log(`✅ يوجد يوم استثنائي في ${nextPlanned.raw} - لا توجد فجوة`);
        }
    }
}

// المنطق الثاني: مناوبات غير مستلمة - التحقق من المناوبات التي مر عليها X أيام ولم تُستلم
async function checkUnreceivedShifts(
    db: any,
    today: Date,
    todayString: string,
    overdueDays: number
): Promise<void> {
    log(`\n📋 المنطق الثاني: فحص المناوبات غير المستلمة (${overdueDays} أيام)`);

    // حساب تاريخ العتبة: اليوم ناقص عدد أيام التأخير المطلوبة
    const thresholdDate = new Date(today);
    thresholdDate.setDate(thresholdDate.getDate() - overdueDays);
    const thresholdDateString = toLocalDateString(thresholdDate);
    const thresholdDateFormatted = thresholdDate.toLocaleDateString('ar-UK');
    log(`🔎 سيتم اعتبار المناوبات التي تاريخها في أو قبل: ${thresholdDateString} (${thresholdDateFormatted})`);

    // البحث عن المناوبات التي:
    // 1. تاريخها في أو قبل (اليوم - X أيام)
    // 2. لم يتم استلامها (paperCopyReceived = 0)
    // 3. لم يتم إنشاء تنبيه لها من قبل في آخر 24 ساعة
    const overdueShifts = await db.all(`
        SELECT s.id, s.shiftDate, s.paperCopyReceived
        FROM Shifts s
        WHERE s.paperCopyReceived = 0
        AND date(s.shiftDate) <= date(?)
        AND NOT EXISTS (
            SELECT 1 FROM Alerts a
            WHERE a.type = 'shift_not_received'
            AND (
                json_extract(a.metadata, '$.shiftId') = s.id
                OR (
                    a.message LIKE '%' || date(s.shiftDate) || '%'
                    AND date(a.dateTriggered) = date('now', 'localtime')
                )
            )
            AND a.status IN ('new', 'read')
        )
        ORDER BY s.shiftDate ASC
    `, [thresholdDateString]);

    log(`📊 عدد المناوبات غير المستلمة: ${overdueShifts.length}`);

    if (overdueShifts.length === 0) {
        log('✅ لا توجد مناوبات غير مستلمة');
        return;
    }

    // Use Arabic (US) locale with Gregorian calendar and Latin digits
    const dateFormatter = new Intl.DateTimeFormat('ar-US', {
        calendar: 'gregory',
        numberingSystem: 'latn',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    });

    for (const shift of overdueShifts) {
        const shiftDate = new Date(shift.shiftDate);
        const shiftDateFormatted = dateFormatter.format(shiftDate);
        const daysPassed = Math.floor((today.getTime() - shiftDate.getTime()) / (1000 * 60 * 60 * 24));

        log(`📋 مناوبة ${shiftDateFormatted}: مر عليها ${daysPassed} يوم`);

        // التحقق مرة أخرى من عدم وجود تنبيه مشابه قبل الإنشاء
        const existingAlert = await db.get(`
            SELECT id FROM Alerts
            WHERE type = 'shift_not_received'
            AND (
                json_extract(metadata, '$.shiftId') = ?
                OR message LIKE ?
            )
            AND status IN ('new', 'read')
            AND date(dateTriggered) = date('now', 'localtime')
        `, [shift.id, `%${shift.shiftDate}%`]);

        if (existingAlert) {
            log(`⚠️ تنبيه موجود بالفعل للمناوبة ${shiftDateFormatted}`);
            continue;
        }

        const message = `المناوبة المجدولة في ${shiftDateFormatted} لم يتم استلامها بعد ${daysPassed} يوم من تاريخها .`;

        await createAlert({
            type: 'shift_not_received',
            dateTriggered: todayString,
            status: 'new',
            message,
            severity: 'medium',
            title: 'مناوبة غير مستلمة',
            category: 'shift',
            actionUrl: '/shifts',
            metadata: JSON.stringify({
                shiftId: shift.id,
                shiftDate: shift.shiftDate,
                shiftDateFormatted,
                daysPassed,
                overdueDays,
                alertType: 'shift_not_received'
            }),
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        });

        log(`⚠️ تم إنشاء تنبيه: مناوبة ${shiftDateFormatted} غير مستلمة بعد ${daysPassed} يوم`);
    }
}

// دالة لتشغيل فحص التنبيهات بشكل دوري
export function startAlertScheduler(): void {
    log('🚀 بدء جدولة التنبيهات...');

    // فحص فوري عند البدء
    checkAndCreateAlerts();

    // فحص كل ساعة
    setInterval(() => {
        checkAndCreateAlerts();
    }, 60 * 60 * 1000); // كل ساعة

    log('⏰ تم تفعيل الفحص الدوري للتنبيهات (كل ساعة)');
}

// دالة لحذف التنبيهات المنتهية الصلاحية
export async function cleanupExpiredAlerts(): Promise<void> {
    const db = await getDb();
    try {
        const now = new Date().toISOString();
        const result = await db.run(`
            DELETE FROM Alerts 
            WHERE expiresAt IS NOT NULL 
            AND expiresAt < ?
        `, [now]);

        if (result.changes && result.changes > 0) {
            log(`🧹 تم حذف ${result.changes} تنبيه منتهي الصلاحية`);
        }
    } finally {
        await db.close();
    }
}

// تشغيل تنظيف التنبيهات المنتهية كل يوم
setInterval(cleanupExpiredAlerts, 24 * 60 * 60 * 1000); // كل 24 ساعة
