const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// فتح قاعدة البيانات
const DATA_DIR = process.env.DATA_DIR || process.cwd();
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
const db = new sqlite3.Database(path.join(DATA_DIR, 'database.sqlite'));

console.log('📖 تحديث تنبيه واحد إلى مقروء...');

db.serialize(() => {
    // تحديث التنبيه التجريبي إلى مقروء
    db.run(`
        UPDATE Alerts 
        SET status = 'read' 
        WHERE type = 'test_alert'
        AND status = 'new'
    `, (err) => {
        if (err) {
            console.error('خطأ في تحديث التنبيه:', err);
            return;
        }
        
        console.log('✅ تم تحديث التنبيه التجريبي إلى مقروء');
        
        // عرض التنبيهات الجديدة المتبقية
        db.all("SELECT * FROM Alerts WHERE status = 'new' ORDER BY dateTriggered DESC", (err, newAlerts) => {
            if (err) {
                console.error('خطأ:', err);
                return;
            }
            
            console.log(`📋 التنبيهات الجديدة المتبقية (${newAlerts.length}):`);
            newAlerts.forEach((alert, index) => {
                console.log(`${index + 1}. ${alert.type} - ${alert.title} - ${alert.severity}`);
            });
            
            // عرض جميع التنبيهات
            db.all('SELECT * FROM Alerts ORDER BY dateTriggered DESC', (err, allAlerts) => {
                if (err) {
                    console.error('خطأ:', err);
                    return;
                }
                
                const newCount = allAlerts.filter(a => a.status === 'new').length;
                const readCount = allAlerts.filter(a => a.status === 'read').length;
                
                console.log(`\n📊 الإحصائيات النهائية:`);
                console.log(`   - تنبيهات جديدة: ${newCount}`);
                console.log(`   - تنبيهات مقروءة: ${readCount}`);
                console.log(`   - المجموع: ${allAlerts.length}`);
                
                db.close();
            });
        });
    });
});
