const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

console.log('🔍 اختبار المنطق الجديد للتنبيهات...');

const DATA_DIR = process.env.DATA_DIR || process.cwd();
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
const db = new sqlite3.Database(path.join(DATA_DIR, 'database.sqlite'));

db.serialize(() => {
    // حذف جميع التنبيهات الموجودة
    db.run('DELETE FROM AlertLog', (err) => {
        if (err) console.error('خطأ في حذف سجل التنبيهات:', err);
    });
    
    db.run('DELETE FROM Alerts', function(err) {
        if (err) {
            console.error('خطأ في حذف التنبيهات:', err);
            return;
        }
        console.log(`✅ تم حذف ${this.changes} تنبيه موجود`);
        
        // اختبار المنطق الجديد
        testNewLogic();
    });
    
    function testNewLogic() {
        const today = new Date();
        const todayString = today.toISOString().slice(0, 10);
        const reminderDays = 3; // من الإعدادات
        const overdueDays = 1;  // من الإعدادات
        
        console.log(`📅 اليوم: ${todayString}`);
        console.log(`🔢 أيام التذكير: ${reminderDays}`);
        console.log(`🔢 أيام التأخير: ${overdueDays}`);
        
        // المنطق الأول: التحقق من عدم وجود خفارة بعد X يوم من اليوم الحالي
        const targetDate = new Date(today);
        targetDate.setDate(targetDate.getDate() + reminderDays);
        const targetDateString = targetDate.toISOString().slice(0, 10);
        
        console.log(`\n🎯 المنطق الأول: فحص وجود خفارة بعد ${reminderDays} أيام (${targetDateString})`);
        
        db.get(`
            SELECT s.id, s.shiftDate
            FROM Shifts s
            WHERE s.shiftDate >= ?
            ORDER BY s.shiftDate ASC
            LIMIT 1
        `, [targetDateString], (err, upcomingShift) => {
            if (err) {
                console.error('خطأ في فحص الخفارات القادمة:', err);
                return;
            }
            
            if (!upcomingShift) {
                // لا توجد خفارة بعد X يوم من اليوم الحالي
                const targetDateFormatted = targetDate.toLocaleDateString('ar-US');
                const message = `لا توجد خفارة مجدولة بعد ${reminderDays} أيام من اليوم (${targetDateFormatted}). يجب إنشاء خفارة جديدة في أقرب وقت.`;
                
                const alertId = `alert_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                const now = new Date().toISOString();
                
                db.run(`
                    INSERT INTO Alerts (
                        id, type, dateTriggered, status, message, 
                        severity, title, category, actionUrl, metadata, 
                        expiresAt, createdAt, updatedAt
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    alertId,
                    'no_upcoming_shift',
                    todayString,
                    'new',
                    message,
                    'high',
                    'لا توجد خفارة قادمة',
                    'shift',
                    '/shift-registration',
                    JSON.stringify({
                        targetDate: targetDateString,
                        targetDateFormatted,
                        reminderDays,
                        alertType: 'no_upcoming_shift'
                    }),
                    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                    now,
                    now
                ], function(err) {
                    if (err) {
                        console.error('خطأ في إنشاء تنبيه عدم وجود خفارة:', err);
                    } else {
                        console.log(`🚨 تم إنشاء تنبيه: لا توجد خفارة بعد ${reminderDays} أيام (${targetDateFormatted})`);
                    }
                    
                    // الانتقال للمنطق الثاني
                    checkOverdueShifts();
                });
            } else {
                console.log(`✅ توجد خفارة في ${upcomingShift.shiftDate} - لا حاجة لتنبيه`);
                // الانتقال للمنطق الثاني
                checkOverdueShifts();
            }
        });
        
        function checkOverdueShifts() {
            console.log(`\n📋 المنطق الثاني: فحص الخفارات غير المستلمة بعد ${overdueDays} أيام من تاريخ الخفارة`);
            
            // البحث عن الخفارات التي:
            // 1. تاريخها في المستقبل (أكبر من اليوم الحالي)
            // 2. مر عليها X أيام ولم يتم استلامها
            db.all(`
                SELECT s.id, s.shiftDate, s.paperCopyReceived
                FROM Shifts s
                WHERE s.shiftDate > ?
                AND s.paperCopyReceived = 0
                AND date('now', 'localtime') >= date(s.shiftDate, '+${overdueDays} days')
            `, [todayString], (err, overdueShifts) => {
                if (err) {
                    console.error('خطأ في فحص الخفارات غير المستلمة:', err);
                    return;
                }
                
                console.log(`📊 عدد الخفارات غير المستلمة: ${overdueShifts.length}`);
                
                if (overdueShifts.length === 0) {
                    console.log('✅ لا توجد خفارات غير مستلمة');
                    db.close();
                    return;
                }
                
                let processedCount = 0;
                
                overdueShifts.forEach((shift) => {
                    const shiftDateFormatted = new Date(shift.shiftDate).toLocaleDateString('ar-US');
                    const daysPassed = Math.floor((today.getTime() - new Date(shift.shiftDate).getTime()) / (1000 * 60 * 60 * 24));
                    
                    const message = `خفارة يوم ${shiftDateFormatted} لم يتم استلامها بعد ${daysPassed} يوم من تاريخها.`;
                    
                    const alertId = `alert_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                    const now = new Date().toISOString();
                    
                    db.run(`
                        INSERT INTO Alerts (
                            id, type, dateTriggered, status, message, 
                            severity, title, category, actionUrl, metadata, 
                            expiresAt, createdAt, updatedAt
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        alertId,
                        'shift_not_received',
                        todayString,
                        'new',
                        message,
                        'medium',
                        'خفارة غير مستلمة',
                        'shift',
                        '/shifts',
                        JSON.stringify({
                            shiftId: shift.id,
                            shiftDate: shift.shiftDate,
                            shiftDateFormatted,
                            daysPassed,
                            overdueDays,
                            alertType: 'shift_not_received'
                        }),
                        new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                        now,
                        now
                    ], function(err) {
                        if (err) {
                            console.error('خطأ في إنشاء تنبيه خفارة غير مستلمة:', err);
                        } else {
                            console.log(`⚠️ تم إنشاء تنبيه: خفارة ${shiftDateFormatted} غير مستلمة بعد ${daysPassed} يوم`);
                        }
                        
                        processedCount++;
                        if (processedCount === overdueShifts.length) {
                            console.log('\n✅ انتهى اختبار المنطق الجديد');
                            db.close();
                        }
                    });
                });
            });
        }
    }
});
