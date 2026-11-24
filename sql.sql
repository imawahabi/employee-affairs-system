-- إنشاء قاعدة البيانات
CREATE DATABASE IF NOT EXISTS `gov-hr-suite-bolt`;
USE `gov-hr-suite-bolt`;

-- جدول الأقسام (Departments)
CREATE TABLE IF NOT EXISTS `Departments` (
    `id` VARCHAR(255) PRIMARY KEY,
    `name` VARCHAR(255) NOT NULL UNIQUE
);

-- جدول الرتب (Ranks)
CREATE TABLE IF NOT EXISTS `Ranks` (
    `id` VARCHAR(255) PRIMARY KEY,
    `name` VARCHAR(255) NOT NULL UNIQUE,
    `category` VARCHAR(255) NOT NULL, -- officer, nco, professional
    `order` INT NOT NULL
);

-- جدول الموظفين (Employees)
CREATE TABLE IF NOT EXISTS `Employees` (
    `id` VARCHAR(255) PRIMARY KEY,
    `fileNumber` VARCHAR(255) NOT NULL UNIQUE,
    `name` VARCHAR(255) NOT NULL,
    `category` VARCHAR(255) NOT NULL, -- officer, nco, professional
    `rank` VARCHAR(255) NOT NULL,
    `jobTitle` VARCHAR(255) NULL,
    `department` VARCHAR(255) NOT NULL,
    `status` VARCHAR(255) NOT NULL, -- active, inactive
    `monthlyShiftCount` INT,
    `reasonIfInactive` TEXT,
    `phone_number` VARCHAR(20), -- إضافة عمود رقم الهاتف
    `referenceNumber` VARCHAR(255),
    `civilId` VARCHAR(255),
    `birthDate` DATE,
    `nationality` VARCHAR(255),
    `militaryNumber` VARCHAR(255),
    `hiringDate` DATE,
    `seniorityNumber` VARCHAR(255),
    `section` VARCHAR(255),
    `hasWeapon` BOOLEAN NOT NULL DEFAULT FALSE,
    `weaponAttachments` TEXT,
    `hasParking` BOOLEAN NOT NULL DEFAULT FALSE,
    `parkingLocation` VARCHAR(255),
    `parkingNumber` VARCHAR(255),
    `includeInShifts` BOOLEAN NOT NULL DEFAULT TRUE,
    `shiftNotes` TEXT,
    `excludeFromStatistics` BOOLEAN NOT NULL DEFAULT FALSE,
    `isSecondedOutsideGeneralAdministration` BOOLEAN NOT NULL DEFAULT FALSE,
    `secondmentLocation` VARCHAR(255),
    FOREIGN KEY (`rank`) REFERENCES `Ranks`(`name`),
    FOREIGN KEY (`department`) REFERENCES `Departments`(`name`)
);

-- جدول المناوبات (Shifts)
CREATE TABLE IF NOT EXISTS `Shifts` (
    `id` VARCHAR(255) PRIMARY KEY,
    `shiftDate` DATE NOT NULL UNIQUE,
    `title` VARCHAR(255) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME NOT NULL
);

-- جدول تعيينات المناوبات (ShiftAssignments)
CREATE TABLE IF NOT EXISTS `ShiftAssignments` (
    `id` VARCHAR(255) PRIMARY KEY,
    `shiftId` VARCHAR(255) NOT NULL,
    `employeeId` VARCHAR(255) NOT NULL,
    `status` VARCHAR(255) NOT NULL, -- attended, absent
    `counted` BOOLEAN NOT NULL,
    `note` TEXT,
    `addedAt` DATETIME NOT NULL,
    FOREIGN KEY (`shiftId`) REFERENCES `Shifts`(`id`),
    FOREIGN KEY (`employeeId`) REFERENCES `Employees`(`id`)
);

-- جدول أيام الاستثناء للمناوبات (ShiftDayExceptions)
CREATE TABLE IF NOT EXISTS `ShiftDayExceptions` (
    `id` VARCHAR(255) PRIMARY KEY,
    `date` DATE NOT NULL UNIQUE,
    `reason` VARCHAR(255) NOT NULL,
    `note` TEXT,
    `createdBy` VARCHAR(255),
    `createdAt` DATETIME NOT NULL,
    `updatedAt` DATETIME NOT NULL
);

-- جدول استثناءات المناوبات (ShiftExceptions)
CREATE TABLE IF NOT EXISTS `ShiftExceptions` (
    `id` VARCHAR(255) PRIMARY KEY,
    `employeeId` VARCHAR(255) NOT NULL,
    `date` DATE NOT NULL,
    `reason` VARCHAR(255) NOT NULL, -- medical, vacation, absence, other
    `note` TEXT,
    FOREIGN KEY (`employeeId`) REFERENCES `Employees`(`id`)
);

-- جدول الإعدادات (Settings)
CREATE TABLE IF NOT EXISTS `Settings` (
    `id` VARCHAR(255) PRIMARY KEY,
    `key` VARCHAR(255) NOT NULL UNIQUE,
    `value` TEXT NOT NULL,
    `description` TEXT,
    `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- إدخال الإعدادات الافتراضية
INSERT IGNORE INTO `Settings` (`id`, `key`, `value`, `description`) VALUES
('setting_alert_overdue_days', 'alert.overdue_days', '3', 'عدد الأيام قبل إرسال تنبيه عدم استلام المناوبة'),
('setting_alert_upcoming_days', 'alert.upcoming_days', '3', 'عدد الأيام للتنبيه عند عدم وجود مناوبات مجدولة'),
('setting_email_notifications', 'email.notifications', 'true', 'تفعيل إشعارات البريد الإلكتروني'),
('setting_auto_backup', 'backup.auto', 'true', 'تفعيل النسخ الاحتياطي التلقائي'),
('setting_company_name', 'company.name', 'الهيئة العامة للشؤون الإدارية والموارد البشرية', 'اسم المؤسسة'),
('setting_company_phone', 'company.phone', '+966-11-1234567', 'هاتف المؤسسة'),
('setting_company_email', 'company.email', 'admin@ministry.gov.sa', 'البريد الإلكتروني للمؤسسة'),
('setting_company_address', 'company.address', 'الرياض، المملكة العربية السعودية', 'عنوان المؤسسة');

-- جدول التنبيهات (Alerts)
CREATE TABLE IF NOT EXISTS `Alerts` (
    `id` VARCHAR(255) PRIMARY KEY,
    `employeeId` VARCHAR(255),
    `type` VARCHAR(255) NOT NULL, -- e.g., 'shift_not_received', 'no_upcoming_shift'
    `dateTriggered` DATETIME NOT NULL,
    `status` VARCHAR(255) NOT NULL, -- e.g., 'new', 'resolved'
    `message` TEXT NOT NULL,
    FOREIGN KEY (`employeeId`) REFERENCES `Employees`(`id`)
);


-- إدخال بيانات وهمية

-- بيانات الأقسام (Departments)
INSERT IGNORE INTO `Departments` (`id`, `name`) VALUES
('1', 'السجل العام'),
('2', 'التخطيط والتنظيم'),
('3', 'المالية والإدارية'),
('4', 'الخدمات المجتمعية'),
('5', 'المكتب الفني'),
('6', 'م.م.ع. شئون الفنية'),
('7', 'م.م.ع. شئون المكتب');

-- بيانات الرتب (Ranks)
INSERT IGNORE INTO `Ranks` (`id`, `name`, `category`, `order`) VALUES
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

-- بيانات الموظفين (Employees)
INSERT IGNORE INTO `Employees` (`id`, `fileNumber`, `name`, `category`, `rank`, `jobTitle`, `department`, `status`, `monthlyShiftCount`, `reasonIfInactive`, `phone_number`) VALUES
('emp_1000', '60076606', 'محمد ابراهيم الحميدي', 'قيادات', 'موظف أول حقوقي', 'رئيس قسم', 'السجل العام', 'active', 5, NULL, '0501234567'),
('emp_1001', '55224950', 'محمد منور الحربي', 'قيادات', 'موظف أول', 'رئيس قسم', 'المالية والإدارية', 'active', 6, NULL, '0502345678'),
('emp_1002', '98729111', 'حمود عبدالرحمن العميري', 'قيادات', 'مشرف حقوقي', 'رئيس قسم', 'التخطيط والتنظيم', 'active', 7, NULL, '0503456789'),
('emp_1003', '97243266', 'راشد خالد عبدالله الراشد', 'قيادات', 'مشرف', 'رئيس قسم', 'الخدمات المجتمعية', 'active', 5, NULL, '0504567890'),
('emp_1004', '56660238', 'محمد حمد سالم جوهر', 'قيادات', 'مشرف', 'رئيس قسم', 'التخطيط والتنظيم', 'active', 8, NULL, '0505678901'),
('emp_1005', '66914148', 'أحمد محمود أحمد بن ناصر', 'قيادات', 'مشرف', 'رئيس قسم', 'التخطيط والتنظيم', 'active', 6, NULL, '0506789012'),
('emp_1006', '90003218', 'خالد طارق بن شعبان', 'قيادات', 'موظف أول', 'رئيس قسم', 'السجل العام', 'active', 7, NULL, '0507890123'),
('emp_1007', '95588078', 'طيبه خالد الفارس', 'قيادات', 'موظف أول', 'رئيس قسم', 'السجل العام', 'active', 5, NULL, '0508901234'),
('emp_1008', '55055706', 'فهد مساعد القحطاني', 'مشرفون', 'مشرف', NULL, 'المالية والإدارية', 'active', 6, NULL, '0509012345'),
('emp_1009', '55225338', 'عمر جمال الجاسم', 'مشرفون', 'مشرف', NULL, 'الخدمات المجتمعية', 'active', 7, NULL, '0500123456'),
('emp_1010', '97798685', 'ابراهيم عبدالرزاق الدريعي', 'مشرفون', 'مشرف', NULL, 'الخدمات المجتمعية', 'active', 5, NULL, '0501122334'),
('emp_1011', '98558885', 'عقاب ميسر العياف', 'مشرفون', 'مشرف', NULL, 'السجل العام', 'active', 8, NULL, '0502233445'),
('emp_1012', '55337331', 'محمد مناحي القحطاني', 'مشرفون', 'مشرف', NULL, 'السجل العام', 'active', 6, NULL, '0503344556'),
('emp_1013', '66666256', 'عمر صبحي الهندي', 'مشرفون', 'مشرف', NULL, 'السجل العام', 'active', 7, NULL, '0504455667'),
('emp_1014', '55567371', 'محمد جمال السيد سالم', 'فنيون', 'فني', 'طباع', 'م.م.ع. شئون الفنية', 'active', 5, NULL, '0505566778'),
('emp_1015', '90955054', 'احمد محمد حسين الشبراوي', 'فنيون', 'فني', 'مدخل بيانات', 'التخطيط والتنظيم', 'active', 6, NULL, '0506677889'),
('emp_1016', '50255026', 'صلاح عبدالعليم شبانه', 'فنيون', 'فني', 'طباع', 'م.م.ع. شئون الفنية', 'active', 7, NULL, '0507788990'),
('emp_1017', '97569936', 'خالد السيد سالم ذكري', 'فنيون', 'فني', 'فني تصوير', 'المكتب الفني', 'active', 5, NULL, '0508899001'),
('emp_1018', '99593387', 'صلاح عبدالرحمن سيد', 'فنيون', 'فني', 'طباع', 'التخطيط والتنظيم', 'active', 8, NULL, '0509900112'),
('emp_1019', '55782121', 'احمد علي احمد', 'فنيون', 'فني', 'طباع', 'التخطيط والتنظيم', 'active', 6, NULL, '0500011223'),
('emp_1020', '99371064', 'ثائر اذنن رفيق صالح', 'فنيون', 'فني', 'طباع', 'التخطيط والتنظيم', 'active', 7, NULL, '0501122334'),
('emp_1021', '99296578', 'محمد فتحي الصغير', 'فنيون', 'فني', 'طباع', 'التخطيط والتنظيم', 'active', 5, NULL, '0502233445'),
('emp_1022', '96950761', 'محمد سعيد صقر راشد', 'فنيون', 'فني', 'طباع', 'التخطيط والتنظيم', 'active', 8, NULL, '0503344556'),
('emp_1023', '96652553', 'خالد محمود عبدالصود حسن', 'فنيون', 'فني', 'طباع', 'الخدمات المجتمعية', 'active', 6, NULL, '0504455667'),
('emp_1024', '50705259', 'محمود عبدالتاب عبدالله', 'فنيون', 'فني', 'طباع', 'الخدمات المجتمعية', 'active', 7, NULL, '0505566778'),
('emp_1025', '67045480', 'محمود ابراهيم احمد هلال', 'فنيون', 'فني', 'طباع', 'المكتب الفني', 'active', 5, NULL, '0506677889'),
('emp_1026', '97914155', 'جليل رابحي حسين جليل', 'فنيون', 'فني', 'فراش', 'م.م.ع. شئون الفنية', 'active', 6, NULL, '0507788990'),
('emp_1027', '55067408', 'تاسين سيد علي', 'فنيون', 'فني', 'فراش', 'م.م.ع. شئون الفنية', 'active', 7, NULL, '0508899001'),
('emp_1028', '99569288', 'محمد عبدالعاطي محمد', 'فنيون', 'فني', 'فراش', 'التخطيط والتنظيم', 'active', 5, NULL, '0509900112'),
('emp_1029', '67035745', 'ريتشموند الفاريس رولدان', 'فنيون', 'فني', 'فراش', 'التخطيط والتنظيم', 'active', 8, NULL, '0500011223'),
('emp_1030', '60074353', 'اروين المازان اسومين', 'فنيون', 'فني', 'فراش', 'التخطيط والتنظيم', 'active', 6, NULL, '0501122334'),
('emp_1031', '51436668', 'ايفان المازان اسومين', 'فنيون', 'فني', 'فراش', 'الخدمات المجتمعية', 'active', 7, NULL, '0502233445'),
('emp_1032', '66630749', 'مانيك حسين ديلوار حسين', 'فنيون', 'فني', 'سائق', 'الخدمات المجتمعية', 'active', 5, NULL, '0503344556'),
('emp_1033', '97975689', 'طارق محمود محمد اشرف', 'فنيون', 'فني', 'سائق', 'الخدمات المجتمعية', 'active', 8, NULL, '0504455667'),
('emp_1034', '97505747', 'جراح حمود مخلف', 'فنيون', 'فني', 'مندوب', 'الخدمات المجتمعية', 'active', 6, NULL, '0505566778'),
('emp_1035', '50524538', 'رضا عبدالرازق عبداللطيف', 'فنيون', 'فني', 'مندوب', 'السجل العام', 'active', 7, NULL, '0506677889'),
('emp_1036', '97931864', 'بوديتي راجيندرار بواساد', 'فنيون', 'فني', 'سائق', 'السجل العام', 'active', 5, NULL, '0507788990'),
('emp_1037', '55619515', 'كاتي ياراما ريدي', 'فنيون', 'فني', 'سائق', 'السجل العام', 'active', 8, NULL, '0508899001'),
('emp_1038', '66362683', 'سالم حنيفي فرج الله', 'فنيون', 'فني', 'سائق', 'السجل العام', 'active', 6, NULL, '0509900112'),
('emp_1039', '55199221', 'محمد محمود عبدالله رضوان', 'فنيون', 'فني', 'سائق', 'المكتب الفني', 'active', 7, NULL, '0500011223'),
('emp_1040', '97400433', 'عبدالله عبدالقاسم زيد الفضيلة', 'فنيون', 'فني', 'سائق', 'السجل العام', 'active', 5, NULL, '0501122334');

-- بيانات المناوبات (Shifts) - مثال لبعض المناوبات
INSERT IGNORE INTO `Shifts` (`id`, `shiftDate`, `createdBy`, `note`, `createdAt`) VALUES
('shift_2024-07-01', '2024-07-01', 'النظام', 'مناوبة عادية', '2024-06-30 00:00:00'),
('shift_2024-07-02', '2024-07-02', 'النظام', NULL, '2024-07-01 00:00:00'),
('shift_2024-07-03', '2024-07-03', 'النظام', 'مناوبة عادية', '2024-07-02 00:00:00');

-- بيانات تعيينات المناوبات (ShiftAssignments) - مثال لبعض التعيينات
INSERT IGNORE INTO `ShiftAssignments` (`id`, `shiftId`, `employeeId`, `status`, `counted`, `note`, `addedAt`) VALUES
('assign_shift_2024-07-01_emp_1000', 'shift_2024-07-01', 'emp_1000', 'attended', TRUE, NULL, '2024-06-30 00:00:00'),
('assign_shift_2024-07-01_emp_1002', 'shift_2024-07-01', 'emp_1002', 'attended', TRUE, 'أداء ممتاز', '2024-06-30 00:00:00'),
('assign_shift_2024-07-02_emp_1001', 'shift_2024-07-02', 'emp_1001', 'absent', FALSE, NULL, '2024-07-01 00:00:00');

-- بيانات استثناءات المناوبات (ShiftExceptions) - مثال لبعض الاستثناءات
INSERT IGNORE INTO `ShiftExceptions` (`id`, `employeeId`, `date`, `reason`, `note`) VALUES
('exc_emp_1000_2024-07-15', 'emp_1000', '2024-07-15', 'medical', 'تم الموافقة من الإدارة'),
('exc_emp_1003_2024-07-20', 'emp_1003', '2024-07-20', 'vacation', 'تم الموافقة من الإدارة');

-- بيانات التنبيهات (Alerts)
INSERT IGNORE INTO `Alerts` (`id`, `employeeId`, `type`, `dateTriggered`, `status`, `message`) VALUES
('alert_1', 'emp_1000', 'shift_not_received', '2024-07-04 10:00:00', 'new', 'لم يتم استلام مناوبة emp_1000 بتاريخ 2024-07-01 بعد مرور 3 أيام.'),
('alert_2', 'emp_1001', 'no_upcoming_shift', '2024-07-05 09:00:00', 'new', 'لا توجد مناوبة مجدولة لـ emp_1001 خلال 3 أيام قادمة.');
