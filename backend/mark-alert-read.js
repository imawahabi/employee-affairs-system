const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// فتح قاعدة البيانات
const DATA_DIR = process.env.DATA_DIR || process.cwd();
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
const db = new sqlite3.Database(path.join(DATA_DIR, 'database.sqlite'));

console.log('📖 تحديث حالة التنبيه إلى مقروء...');

db.serialize(() => {
    // تحديث التنبيه الثاني إلى مقروء
    db.run(`
        UPDATE Alerts 
        SET status = 'read' 
        WHERE type = 'no_upcoming_shift'
        AND status = 'new'
    `, (err) => {
        if (err) {
            console.error('خطأ في تحديث التنبيه:', err);
            return;
        }
        
        console.log('✅ تم تحديث التنبيه إلى مقروء');
        
        // عرض التنبيهات بعد التحديث
        db.all('SELECT * FROM Alerts ORDER BY dateTriggered DESC', (err, alerts) => {
            if (err) {
                console.error('خطأ:', err);
                return;
            }
            
            console.log(`📋 التنبيهات بعد التحديث (${alerts.length}):`);
            alerts.forEach((alert, index) => {
                console.log(`${index + 1}. ${alert.type} - ${alert.title} - ${alert.status} - ${alert.dateTriggered}`);
            });
            
            // إحصائيات
            const newAlerts = alerts.filter(a => a.status === 'new');
            const readAlerts = alerts.filter(a => a.status === 'read');
            
            console.log(`\n📊 الإحصائيات:`);
            console.log(`   - تنبيهات جديدة: ${newAlerts.length}`);
            console.log(`   - تنبيهات مقروءة: ${readAlerts.length}`);
            
            db.close();
        });
    });
});
