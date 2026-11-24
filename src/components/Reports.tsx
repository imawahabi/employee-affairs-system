import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Download,
  Calendar,
  Filter,
  Printer as Print,
  CalendarDays,
  Users,
  BarChart3,
  Settings,
  RefreshCw,
  Eye,
  EyeOff,
  Check,
  X,
  Building,
  Search,
  Shield,
  ShieldCheck,
  Briefcase
} from 'lucide-react';
import { fetchEmployees, fetchShifts, fetchShiftAssignments, fetchDepartments } from '../api';
import { Employee, Shift, ShiftAssignment, Department } from '../types';
import LoadingPage from './LoadingPage';
import PageHeader from './UI/PageHeader';
import { format, subMonths, parseISO, differenceInCalendarMonths } from 'date-fns';
import { buildDepartmentNameMap, formatDepartmentLabel, normalizeOrganizationName } from '../utils/organization';
import { getCategoryOrder, getRankOrder } from '../utils/rankOrder';

interface ReportData {
  employee: Employee;
  shifts: string[];
  totalShifts: number;
  monthlyBreakdown: { [month: string]: { date: string; note?: string; isAbsent?: boolean }[] };
}

interface ExemptReportData {
  employee: Employee;
  totalShifts: number;
  monthlyBreakdown: { [month: string]: { date: string; note?: string; isAbsent?: boolean }[] };
  exemptionReason: string;
}

type VisibleColumnsState = {
  serialNumber: boolean;
  rank: boolean;
  name: boolean;
  department: boolean;
  shifts: boolean;
  totalShifts: boolean;
};

const defaultVisibleColumns: VisibleColumnsState = {
  serialNumber: true,
  rank: true,
  name: true,
  department: false,
  shifts: true,
  totalShifts: false,
};

const columnDisplayOptions: Array<{
  key: keyof VisibleColumnsState;
  label: string;
  hint: string;
  code: string;
}> = [
  { key: 'serialNumber', label: 'الترقيم', hint: 'رقم تسلسلي لكل موظف', code: 'م' },
  { key: 'rank', label: 'المسمى الوظيفي', hint: 'المسمى الوظيفي أو المسمى المختصر', code: 'R' },
  { key: 'name', label: 'الاسم', hint: 'اسم الموظف المعروض', code: 'N' },
  { key: 'department', label: 'الإدارة', hint: 'القسم أو الإدارة الحالية', code: 'D' },
  { key: 'shifts', label: 'المناوبات', hint: 'تواريخ المناوبات والملاحظات', code: 'S' },
  { key: 'totalShifts', label: 'الإجمالي', hint: 'إجمالي عدد المناوبات', code: 'T' },
];

const Reports: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftAssignments, setShiftAssignments] = useState<ShiftAssignment[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // إضافة CSS للطباعة
  React.useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .employee-name,
      .employee-rank {
        font-family: 'Cairo', sans-serif;
        font-weight: normal;
      }

      .employee-name {
        font-size: 17px;
      }

      @media print {
        body * {
          visibility: hidden;
        }

        .print-area, .print-area * {
          visibility: visible;
        }

        .print-area {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          background: white !important;
          border: none !important;
          border-radius: 0 !important;
          box-shadow: none !important;
        }

        .report-table {
          border: none !important;
          border-radius: 0 !important;
        }

        .print-hide {
          display: none !important;
        }

        .print-show {
          display: block !important;
          visibility: visible !important;
        }

        .print-title {
          font-size: 30px !important;
          font-weight: bold !important;
          text-align: center !important;
          margin-bottom: 15px !important;
          color: black !important;
          border-bottom: 2px solid #000 !important;
          padding-bottom: 10px !important;
          font-family: 'Cairo', sans-serif !important;
        }

        .print-subtitle {
          font-size: 28px !important;
          font-weight: normal !important;
          text-align: center !important;
          margin-bottom: 10px !important;
          color: #dc2626 !important;
          font-family: 'Cairo', sans-serif !important;
        }

        .print-date-info {
          font-size: 15px !important;
          text-align: center !important;
          margin-bottom: 5px !important;
          color: #1f2937 !important;
          background: #ffffff !important;
          padding: 10px 12px !important;
          display: flex !important;
          flex-wrap: wrap !important;
          justify-content: center !important;
          gap: 3px !important;
          font-family: 'Cairo', sans-serif !important;
        }

        .print-date-item {
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
          background: #f8fafc !important;
          border: 1px solid #e5e7eb !important;
          padding: 10px 20px !important;
          border-radius: 50px !important;
        }

        .print-date-label {
          font-size: 16px !important;
          color: #6b7280 !important;
          font-weight: 700 !important;
        }

        table {
          width: 100% !important;
          border-collapse: collapse !important;
          font-size: 12px !important;
          margin-top: 20px !important;
        }

        th, td {
          border: 1px solid #000 !important;
          padding: 8px 4px !important;
          text-align: center !important;
          color: black !important;
          background: white !important;
          font-family: 'Cairo', sans-serif !important;
        }

        th {
          background: #f3f4f6 !important;
          font-weight: bold !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          font-family: 'Cairo', sans-serif !important;
          font-size: 17px !important;
        }

        thead tr {
          background: #f1f5f9 !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        thead {
          display: table-header-group;
          break-inside: avoid;
          page-break-inside: avoid;
        }

        tr, td, th {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .employee-name {
          font-family: 'Cairo', sans-serif !important;
          font-weight: normal !important;
          font-size: 14px !important;
        }

        .employee-rank {
          font-family: 'Cairo', sans-serif !important;
          font-weight: normal !important;
          font-size: 13px !important;
        }

        .serial-column,
        .total-column {
          font-family: 'Cairo', sans-serif !important;
          font-weight: 700 !important;
          font-size: 13px !important;
        }

        .shift-date {
          font-family: 'Cairo', sans-serif !important;
          font-size: 14px !important;
        }

        .shift-note {
          font-family: 'Cairo', sans-serif !important;
          font-size: 10px !important;
        }

        .shifts-column {
          width: 40% !important;
          max-width: 40% !important;
        }

        .shifts-list {
          justify-content: flex-start !important;
        }

        .name-column {
          width: 15% !important;
        }

        .rank-column {
          width: 10% !important;
        }

        .department-column {
          width: 15% !important;
        }

        .serial-column {
          width: 5% !important;
        }

        .total-column {
          width: 8% !important;
        }

        .print-stats {
          margin-top: 20px !important;
          display: flex !important;
          justify-content: space-around !important;
          font-size: 14px !important;
        }

        .print-stats > div {
          text-align: center !important;
          color: black !important;
        }

        .category-row {
          background: #e0e7ff !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          font-family: 'Cairo', sans-serif !important;
          font-size: 14px !important;
          break-after: avoid;
          page-break-after: avoid;
        }

        .category-row td {
          background: #e0e7ff !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          font-family: 'Cairo', sans-serif !important;
          font-size: 16px !important;
        }

        .department-row {
          background: #dbeafe !important;
          color: #dc2626 !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          font-family: 'Cairo', sans-serif !important;
          font-size: 14px !important;
          break-after: avoid;
          page-break-after: avoid;
        }

        .department-row td {
          background: #dbeafe !important;
          color: #dc2626 !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          font-family: 'Cairo', sans-serif !important;
          font-size: 16px !important;
        }

        .subcategory-row {
          background: #1e40af !important;
          color: #ffffff !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          font-family: 'Cairo', sans-serif !important;
          font-size: 14px !important;
          break-after: avoid;
          page-break-after: avoid;
        }

        .subcategory-page-break {
          break-before: page;
          page-break-before: always;
        }

        .subcategory-row td {
          background: #1e40af !important;
          color: #ffffff !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          font-family: 'Cairo', sans-serif !important;
          font-size: 16px !important;
        }

        .category-page-break {
          break-before: page;
          page-break-before: always;
        }

        .print-date-info strong {
          font-family: 'Cairo', sans-serif !important;
          font-weight: 700 !important;
        }

        .print-category-badges {
          display: flex !important;
          flex-wrap: wrap !important;
          justify-content: center !important;
          gap: 6px !important;
          margin-top: 6px !important;
          margin-bottom: 10px !important;
        }

        .print-category-badge {
          padding: 5px 14px !important;
          border-radius: 999px !important;
          font-size: 14px !important;
          font-weight: 400 !important;
          color: #ffffff !important;
          border: 1px solid rgba(0, 0, 0, 0.15) !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        .print-category-badge.officers {
          background: #1d4ed8 !important;
        }

        .print-category-badge.ncos {
          background: #059669 !important;
        }

        .print-category-badge.professionals {
          background: #d97706 !important;
        }

        .print-category-badge.default {
          background: #475569 !important;
        }

        .print-date-highlight {
          background: #fff200 !important;
          color: #000 !important;
          padding: 0 6px !important;
          border-radius: 4px !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          box-decoration-break: clone;
        }

        @page {
          margin: 0.5cm;
          size: A4 portrait;
        }
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // فلاتر التقرير
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['قيادات', 'مشرفون', 'فنيون']);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // إعدادات العرض
  const [visibleColumns, setVisibleColumns] = useState<VisibleColumnsState>(defaultVisibleColumns);
  
  // حالة التقرير
  const [reportGenerated, setReportGenerated] = useState(false);
  const [includeExemptPage, setIncludeExemptPage] = useState(false);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const visibleColumnsCount = useMemo(
    () => Object.values(visibleColumns).filter(Boolean).length,
    [visibleColumns]
  );
  const departmentNameMap = useMemo(() => buildDepartmentNameMap(departments), [departments]);
  const selectedDepartmentKeys = useMemo(
    () => new Set(selectedDepartments.map((dept) => normalizeOrganizationName(dept))),
    [selectedDepartments]
  );

  const normalizeRankText = (value: string) => value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/اول/g, 'أول')
    .replace(/أوّل/g, 'أول');

  const excludedExemptRanks = useMemo(
    () => new Set([
      'مدير عام',
      'مدير إدارة',
      'مدير إدارة',
      'مساعد مدير إدارة',
      'مساعد مدير إدارة',
      'فريق',
      'فريق أول',
    ].map(normalizeRankText)),
    []
  );

  const arabicDigitMap: Record<string, string> = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9',
  };

  const normalizeArabicDigits = (value: string) =>
    value.replace(/[٠-٩]/g, (digit) => arabicDigitMap[digit] ?? digit);

  const normalizeArabicText = (value: string) =>
    normalizeArabicDigits(value)
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[إأآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ـ/g, '')
      .replace(/[^0-9a-z\u0600-\u06FF]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const formatRankShort = (rawRank: string) => {
    return (rawRank || '').trim();
  };

  const normalizeProfessionalText = (value: string) => {
    return (value || '')
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

  const resolveProfessionalGroupLabel = (employee: Employee) => {
    const groupValue = normalizeProfessionalText(employee.professionalGroup || '');
    const tabaaToken = normalizeProfessionalText('طباع');
    const driverToken = normalizeProfessionalText('سائق');
    const cleanerToken = normalizeProfessionalText('فراش');
    const otherToken = normalizeProfessionalText('أخرى');

    if (groupValue.includes(tabaaToken)) return 'طباع';
    if (groupValue.includes(driverToken)) return 'سائق';
    if (groupValue.includes(cleanerToken)) return 'فراش';
    if (groupValue.includes(otherToken)) return 'أخرى';
    return 'أخرى';
  };

  // تحميل البيانات
  useEffect(() => {
    const loadData = async () => {
      try {
        const [employeesData, shiftsData, shiftAssignmentsData, departmentsData] = await Promise.all([
          fetchEmployees(),
          fetchShifts(),
          fetchShiftAssignments(),
          fetchDepartments(),
        ]);
        setEmployees(employeesData.filter((emp: Employee) => emp.category !== 'إداريون' && emp.status !== 'inactive'));
        setShifts(shiftsData);
        setShiftAssignments(shiftAssignmentsData);
        setDepartments(departmentsData);
        
        // تعيين الأقسام المختارة افتراضياً
        setSelectedDepartments(departmentsData.map((department: Department) => department.name));
      } catch (err) {
        setError('فشل في تحميل البيانات');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const latestShiftDateValue = useMemo(() => {
    if (shifts.length === 0) return null;
    const latestShift = shifts.reduce((latest, current) =>
      new Date(current.shiftDate) > new Date(latest.shiftDate) ? current : latest
    );
    return latestShift.shiftDate;
  }, [shifts]);

  const latestShiftDateObject = useMemo(() => {
    return latestShiftDateValue ? parseISO(latestShiftDateValue) : null;
  }, [latestShiftDateValue]);

  // تعيين الفترة الافتراضية بناءً على آخر مناوبة (مرة واحدة ما لم يتم التعديل يدويًا)
  useEffect(() => {
    if (!latestShiftDateObject) return;
    if (startDate || endDate) return;
    const start = subMonths(latestShiftDateObject, 6);
    setStartDate(format(start, 'yyyy-MM-dd'));
    setEndDate(format(latestShiftDateObject, 'yyyy-MM-dd'));
  }, [latestShiftDateObject, startDate, endDate]);

  // دوال الفترات السريعة
  const setQuickPeriod = (months: number) => {
    const baseDate = latestShiftDateObject || new Date();
    const start = subMonths(baseDate, months);
    setStartDate(format(start, 'yyyy-MM-dd'));
    setEndDate(format(baseDate, 'yyyy-MM-dd'));
  };

  // معالجة تغيير الفئات
  const handleCategoryChange = (category: string) => {
    setSelectedCategories(prev => 
      prev.includes(category) 
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  // معالجة تغيير الأقسام
  const handleDepartmentChange = (department: string) => {
    setSelectedDepartments(prev => 
      prev.includes(department) 
        ? prev.filter(d => d !== department)
        : [...prev, department]
    );
  };

  // اختيار/إلغاء اختيار الكل
  const handleSelectAllDepartments = () => {
    if (selectedDepartments.length === departments.length) {
      setSelectedDepartments([]);
    } else {
      setSelectedDepartments(departments.map(d => d.name));
    }
  };

  // إنشاء التقرير
  const generateReport = () => {
    if (!startDate || !endDate) {
      alert('يرجى اختيار الفترة الزمنية');
      return;
    }
    if (selectedCategories.length === 0) {
      alert('يرجى اختيار فئة واحدة على الأقل');
      return;
    }
    setReportGenerated(true);
  };

  // إعادة تعيين الفلاتر
  const resetFilters = () => {
    setStartDate('');
    setEndDate('');
    setSelectedCategories(['قيادات', 'مشرفون', 'فنيون']);
    setSelectedDepartments(departments.map(d => d.name));
    setSearchTerm('');
    setIncludeExemptPage(false);
    setReportGenerated(false);
  };

  // بيانات التقرير المفلترة
  const reportData = useMemo((): ReportData[] => {
    if (!reportGenerated || !startDate || !endDate) return [];

    const normalizedSearch = normalizeArabicText(searchTerm.trim());
    const filteredEmployees = employees.filter(emp => {
      if (emp.status === 'inactive') return false;
      if (!selectedCategories.includes(emp.category)) return false;
      if (!selectedDepartmentKeys.has(normalizeOrganizationName(emp.department))) return false;
      if (!normalizedSearch) return true;

      const departmentLabel = formatDepartmentLabel(emp.department, departmentNameMap) || emp.department || '';
      const haystack = [
        emp.name || '',
        emp.fileNumber || '',
        emp.jobTitle || '',
        departmentLabel,
      ];
      return haystack.some((value) => normalizeArabicText(value).includes(normalizedSearch));
    });

    const filteredShifts = shifts.filter(shift => {
      const shiftDate = new Date(shift.shiftDate);
      const start = new Date(startDate);
      const end = new Date(endDate);
      return shiftDate >= start && shiftDate <= end;
    });

    return filteredEmployees.map(employee => {
      const employeeAssignments = shiftAssignments.filter(assignment => 
        assignment.employeeId === employee.id &&
        filteredShifts.some(shift => shift.id === assignment.shiftId)
      );

      // تجميع المناوبات حسب الشهر مع سبب الغياب
      const monthlyBreakdown: { [month: string]: { date: string; note?: string; isAbsent?: boolean }[] } = {};
      
      employeeAssignments.forEach(assignment => {
        const shift = filteredShifts.find(s => s.id === assignment.shiftId);
        if (shift) {
          const shiftDate = shift.shiftDate;
          const month = format(parseISO(shiftDate), 'yyyy-MM');
          if (!monthlyBreakdown[month]) {
            monthlyBreakdown[month] = [];
          }
          
          const rawNote = assignment.note?.trim() || '';
          const isAbsent = assignment.status === 'absent';
          const note = rawNote ? rawNote : (isAbsent ? 'غياب' : undefined);
          
          monthlyBreakdown[month].push({
            date: format(parseISO(shiftDate), 'd'),
            note,
            isAbsent
          });
        }
      });

      const employeeShifts = employeeAssignments.map(assignment => {
        const shift = filteredShifts.find(s => s.id === assignment.shiftId);
        return shift ? shift.shiftDate : '';
      }).filter(date => date);

      return {
        employee,
        shifts: employeeShifts,
        totalShifts: employeeShifts.length,
        monthlyBreakdown
      };
    }).filter(data => data.totalShifts > 0);
  }, [
    reportGenerated,
    startDate,
    endDate,
    selectedCategories,
    selectedDepartmentKeys,
    searchTerm,
    employees,
    shifts,
    shiftAssignments,
    departmentNameMap,
  ]);

  const exemptReportData = useMemo((): ExemptReportData[] => {
    if (!reportGenerated || !includeExemptPage) return [];

    const filteredExemptEmployees = employees.filter((emp) => {
      if (emp.status === 'inactive') return false;
      if (emp.includeInShifts !== false) return false;
      if (excludedExemptRanks.has(normalizeRankText(emp.rank || ''))) return false;
      return true;
    });
    const filteredShifts = shifts;

    return filteredExemptEmployees
      .map((employee) => {
        const employeeAssignments = shiftAssignments.filter((assignment) =>
          assignment.employeeId === employee.id &&
          filteredShifts.some((shift) => shift.id === assignment.shiftId)
        );

        const monthlyBreakdown: { [month: string]: { date: string; note?: string; isAbsent?: boolean }[] } = {};

        employeeAssignments.forEach((assignment) => {
          const shift = filteredShifts.find((s) => s.id === assignment.shiftId);
          if (!shift) return;

          const shiftDate = shift.shiftDate;
          const month = format(parseISO(shiftDate), 'yyyy-MM');
          if (!monthlyBreakdown[month]) {
            monthlyBreakdown[month] = [];
          }

          const rawNote = assignment.note?.trim() || '';
          const isAbsent = assignment.status === 'absent';
          const note = rawNote ? rawNote : (isAbsent ? 'غياب' : undefined);

          monthlyBreakdown[month].push({
            date: format(parseISO(shiftDate), 'd'),
            note,
            isAbsent
          });
        });

        return {
          employee,
          totalShifts: employeeAssignments.length,
          monthlyBreakdown,
          exemptionReason: (employee.shiftNotes || '').trim() || 'معفى من المناوبات',
        };
      })
      .sort((a, b) => {
        const categoryDiff =
          getCategoryOrder(a.employee.category) - getCategoryOrder(b.employee.category);
        if (categoryDiff !== 0) return categoryDiff;

        const rankDiff =
          getRankOrder(a.employee.rank, a.employee.category) -
          getRankOrder(b.employee.rank, b.employee.category);
        if (rankDiff !== 0) return rankDiff;

        return a.employee.name.localeCompare(b.employee.name, 'ar');
      });
  }, [
    reportGenerated,
    includeExemptPage,
    employees,
    shifts,
    shiftAssignments,
    excludedExemptRanks,
    departmentNameMap,
  ]);

  // ألوان الشهور (حسب طلب صفحة التقارير والإحصائيات)
  const getMonthColor = (monthNumber: number) => {
    const monthColors: Record<number, string> = {
      12: 'text-red-700',      // ديسمبر: أحمر
      11: 'text-green-700',    // نوفمبر: أخضر
      10: 'text-blue-700',     // أكتوبر: أزرق
      9: 'text-orange-700',    // سبتمبر: برتقالي
      8: 'text-violet-700',    // أغسطس: بنفسجي
      7: 'text-teal-700',      // يوليو: تيفاني غامق
      6: 'text-pink-700',      // يونيو: وردي غامق
      5: 'text-slate-700',     // مايو: رمادي غامق
      4: 'text-emerald-700',   // أبريل: أخضر مختلف عن نوفمبر
      3: 'text-rose-700',      // مارس: أحمر مختلف عن ديسمبر
      2: 'text-black',         // فبراير: أسود
      1: 'text-green-700',      // يناير: أخضر
    };

    return monthColors[monthNumber] || 'text-slate-700';
  };

  // تجميع البيانات حسب الفئات والإدارات (ومجموعات الفنيون الداخلية)
  const groupedData = useMemo(() => {
    const groups: Record<string, any> = {};

    reportData.forEach(data => {
      const category = data.employee.category;
      const department = formatDepartmentLabel(data.employee.department, departmentNameMap) || 'غير مسجل';

      if (!groups[category]) {
        groups[category] = {};
      }

      if (category === 'فنيون') {
        const professionalGroup = resolveProfessionalGroupLabel(data.employee);
        if (!groups[category][professionalGroup]) {
          groups[category][professionalGroup] = {};
        }
        if (!groups[category][professionalGroup][department]) {
          groups[category][professionalGroup][department] = [];
        }
        groups[category][professionalGroup][department].push(data);
        return;
      }

      if (!groups[category][department]) {
        groups[category][department] = [];
      }
      groups[category][department].push(data);
    });

    return groups;
  }, [reportData, departmentNameMap]);

  // حساب عدد الأشهر المعروضة
  const monthsCount = useMemo(() => {
    if (!startDate || !endDate) return 0;

    const start = parseISO(startDate);
    const end = parseISO(endDate);

    if (end < start) return 0;

    const diff = differenceInCalendarMonths(end, start);
    return Math.max(1, diff);
  }, [startDate, endDate]);

  const latestShiftDate = useMemo(() => {
    if (!latestShiftDateValue) return 'لا توجد مناوبات';
    return format(parseISO(latestShiftDateValue), 'd/M/yyyy');
  }, [latestShiftDateValue]);

  const totalReportShifts = useMemo(() => {
    return reportData.reduce((sum, data) => sum + data.totalShifts, 0);
  }, [reportData]);

  const categoryDisplayOrder = ['قيادات', 'مشرفون', 'فنيون'];
  const orderedSelectedCategories = useMemo(() => {
    const selectedSet = new Set(selectedCategories);
    return categoryDisplayOrder.filter((category) => selectedSet.has(category));
  }, [selectedCategories]);
  const professionalGroupOrder = ['طباع', 'سائق', 'فراش', 'أخرى'];
  const showCategoryRows = selectedCategories.length > 1;
  const hideRankForProfessionalsOnly =
    selectedCategories.length === 1 && selectedCategories[0] === 'فنيون';
  const showRankColumn = visibleColumns.rank && !hideRankForProfessionalsOnly;
  const visibleTableColumnCount = useMemo(() => {
    return Object.entries(visibleColumns).reduce((count, [key, isVisible]) => {
      if (!isVisible) return count;
      if (key === 'rank' && !showRankColumn) return count;
      return count + 1;
    }, 0);
  }, [visibleColumns, showRankColumn]);

  const formatProfessionalGroupLabel = (group: string) => {
    switch (group) {
      case 'سائق':
        return 'السائقين';
      case 'طباع':
        return 'الطباعين';
      case 'فراش':
        return 'الفراشين';
      default:
        return group;
    }
  };

  const getCategoryBadgeClass = (category: string) => {
    switch (category) {
      case 'قيادات':
        return 'bg-blue-600 text-white border-blue-600';
      case 'مشرفون':
        return 'bg-emerald-600 text-white border-emerald-600';
      case 'فنيون':
        return 'bg-amber-500 text-white border-amber-500';
      default:
        return 'bg-slate-600 text-white border-slate-600';
    }
  };

  const getCategorySlug = (category: string) => {
    switch (category) {
      case 'قيادات':
        return 'officers';
      case 'مشرفون':
        return 'ncos';
      case 'فنيون':
        return 'professionals';
      default:
        return 'default';
    }
  };

  const handleSavePdf = () => {
    window.print();
  };

  const handleColumnVisibilityChange = (key: keyof VisibleColumnsState, isVisible: boolean) => {
    setVisibleColumns((prev) => ({ ...prev, [key]: isVisible }));
  };

  const handleShowAllColumns = () => {
    setVisibleColumns({
      serialNumber: true,
      rank: true,
      name: true,
      department: true,
      shifts: true,
      totalShifts: true,
    });
  };

  const handleResetColumnsToDefault = () => {
    setVisibleColumns(defaultVisibleColumns);
  };

  if (loading) {
    return <LoadingPage variant="dashboard" title="جاري تحميل التقارير" subtitle="يرجى الانتظار بينما نحضر بيانات التقارير..." />;
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className=" mx-auto px-4 py-4 space-y-8">
        <PageHeader
          icon={<BarChart3 className="h-7 w-7" />}
          title="التقارير والإحصائيات"
          description="استعراض وتحليل مناوبات الموظفين بحسب الفئات والإدارات"
          actions={(
            <>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                الموظفون: {employees.length}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                المناوبات: {shifts.length}
              </span>
              <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                آخر مناوبة: {latestShiftDate}
              </span>
              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 text-white px-5 py-3 text-sm font-semibold shadow-sm hover:bg-red-700 transition-all"
              >
                <RefreshCw className="h-4 w-4" />
                إعادة تعيين
              </button>
            </>
          )}
        />

        {/* فلاتر التقرير */}
        <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-lg shadow-slate-200/50 p-6 print-hide">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center shadow-md">
                <Filter className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">الفلاتر والبحث</h2>
                <p className="text-xs text-slate-500">تصفية دقيقة للوصول إلى النتائج بسرعة</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                الفئات: {selectedCategories.length}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                الأقسام: {selectedDepartments.length === departments.length ? 'الكل' : selectedDepartments.length}
              </span>
              {reportGenerated && searchTerm.trim() && (
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                  بحث مفعل
                </span>
              )}
              <button
                onClick={() => setShowAdvancedFilters((prev) => !prev)}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-all"
              >
                {showAdvancedFilters ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showAdvancedFilters ? 'إخفاء الأقسام' : 'إظهار الأقسام'}
              </button>
            </div>
          </div>

          {/* شريط البحث */}
          {reportGenerated && (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-gradient-to-l from-slate-50 to-white p-4">
              <div className="grid grid-cols-1 gap-3 xl:items-center">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="ابحث بالاسم أو رقم الملف أو المسمى أو الإدارة"
                    className="w-full text-right pr-10 pl-10 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-100 focus:border-slate-400 transition-all bg-white"
                  />
                  {searchTerm.trim() && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute left-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 transition-all"
                      aria-label="مسح البحث"
                      title="مسح البحث"
                    >
                      <X className="h-4 w-4 mx-auto" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 xl:grid-cols-[1.25fr_1fr] gap-4">
            {/* الفترة */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                    <Calendar className="h-4 w-4" />
                  </div>
                  <h3 className="font-bold text-base text-slate-900">الفترة الزمنية</h3>
                </div>
                <span className="text-xs text-slate-500">
                  {startDate && endDate ? `${startDate} ← ${endDate}` : 'اختر فترة'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                {[3, 6, 9, 12].map((months) => {
                  const isActive = startDate && endDate &&
                    Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 30)) === months;
                  return (
                    <button
                      key={months}
                      onClick={() => setQuickPeriod(months)}
                      className={`px-3 py-2 rounded-xl text-sm font-semibold transition-all ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      آخر {months} {months === 12 ? 'شهر' : 'شهور'}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-2">من</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full text-right px-3 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-2">إلى</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full text-right px-3 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 transition-all"
                  />
                </div>
              </div>
            </div>

            {/* الفئات */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <Users className="h-4 w-4" />
                  </div>
                  <h3 className="font-bold text-base text-slate-900">الفئات</h3>
                </div>
                <span className="text-xs text-slate-500">{selectedCategories.length}/3</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3 gap-3 h-32">
                {[
                  {
                    value: 'قيادات',
                    icon: Shield,
                    activeCard: 'border-blue-500 bg-blue-50 ring-2 ring-blue-100 hover:border-blue-500 hover:bg-blue-50',
                    inactiveHover: 'hover:border-slate-300 hover:bg-slate-100',
                    text: 'text-blue-700',
                    badge: 'border-blue-600 bg-blue-600',
                    soft: 'bg-blue-100 text-blue-700',
                  },
                  {
                    value: 'مشرفون',
                    icon: ShieldCheck,
                    activeCard: 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100 hover:border-emerald-500 hover:bg-emerald-50',
                    inactiveHover: 'hover:border-slate-300 hover:bg-slate-100',
                    text: 'text-emerald-700',
                    badge: 'border-emerald-600 bg-emerald-600',
                    soft: 'bg-emerald-100 text-emerald-700',
                  },
                  {
                    value: 'فنيون',
                    icon: Briefcase,
                    activeCard: 'border-amber-500 bg-amber-50 ring-2 ring-amber-100 hover:border-amber-500 hover:bg-amber-50',
                    inactiveHover: 'hover:border-slate-300 hover:bg-slate-100',
                    text: 'text-amber-700',
                    badge: 'border-amber-600 bg-amber-600',
                    soft: 'bg-amber-100 text-amber-700',
                  },
                ].map(option => {
                  const isActive = selectedCategories.includes(option.value);
                  return (
                    <label key={option.value} className="block">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={() => handleCategoryChange(option.value)}
                        className="sr-only"
                      />
                      <div
                        className={`relative flex h-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border px-3 py-4 text-center shadow-sm transition-all ${
                          isActive
                            ? option.activeCard
                            : `border-slate-300 bg-slate-50 ${option.inactiveHover}`
                        }`}
                      >
                        <div className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${isActive ? option.soft : 'bg-slate-200 text-slate-500'}`}>
                          <option.icon className="h-4 w-4" />
                        </div>
                        <span className={`text-sm font-bold ${isActive ? option.text : 'text-slate-500'}`}>{option.value}</span>
                        <div
                          className={`absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full border text-white transition-all ${
                            isActive
                              ? `${option.badge} opacity-100 scale-100`
                              : 'border-slate-400 bg-slate-300 opacity-0 scale-90'
                          }`}
                        >
                          <Check className="h-4 w-4" />
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* الأقسام (ثانوي) */}
          {showAdvancedFilters && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                    <Building className="h-4 w-4" />
                  </div>
                  <h3 className="font-semibold text-sm text-slate-900">فلترة الأقسام</h3>
                  <span className="text-xs text-slate-500">
                    {selectedDepartments.length === departments.length ? 'الكل' : `${selectedDepartments.length} محدد`}
                  </span>
                </div>
                <button
                  onClick={handleSelectAllDepartments}
                  className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-3 py-2 rounded-full border border-blue-100 hover:bg-blue-100 transition-all"
                >
                  {selectedDepartments.length === departments.length ? 'إلغاء الكل' : 'اختيار الكل'}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto border border-slate-200 rounded-xl p-3 bg-slate-50">
                {departments.map(department => (
                  <label key={department.id} className="flex items-center gap-3 p-2 bg-white rounded-lg border border-slate-200 hover:border-blue-200 hover:bg-blue-50/40 transition-all cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedDepartments.includes(department.name)}
                      onChange={() => handleDepartmentChange(department.name)}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-4 focus:ring-blue-200"
                    />
                    <span className="text-sm font-semibold text-slate-700">{department.name}</span>
                    {selectedDepartments.includes(department.name) && (
                      <div className="mr-auto bg-blue-500 text-white rounded-full p-1">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* زر إنشاء التقرير */}
        <div className="flex flex-col items-center gap-3 print-hide">
          <div className="w-full max-w-3xl flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <button
              onClick={generateReport}
              disabled={!startDate || !endDate || selectedCategories.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 text-white px-16 py-4 text-md font-bold shadow-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:text-white/80 disabled:shadow-none transition-all"
            >
              <BarChart3 className="h-5 w-5"  />
              إنشاء التقرير
            </button>
            <button
              type="button"
              onClick={() => setIncludeExemptPage((prev) => !prev)}
              className={`inline-flex items-center justify-between gap-3 rounded-xl border px-5 py-4 text-sm font-bold transition-all ${
                includeExemptPage
                  ? 'border-red-300 bg-red-50 text-red-700 shadow-sm shadow-red-100'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-red-200 hover:bg-red-50/50'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <FileText className="h-4 w-4" />
                صفحة المعفيين
              </span>
              <span
                className={`inline-flex h-6 w-11 items-center rounded-full p-1 transition-all ${
                  includeExemptPage ? 'bg-red-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`h-4 w-4 rounded-full bg-white transition-all ${
                    includeExemptPage ? 'ltr:translate-x-5 rtl:-translate-x-5' : 'translate-x-0'
                  }`}
                />
              </span>
            </button>
          </div>
          {includeExemptPage && (
            <p className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-4 py-1.5">
              سيتم إنشاء صفحة منفصلة بعنوان: معفيين من المناوبات
            </p>
          )}
        </div>

        {/* إعدادات الأعمدة */}
        {showColumnSettings && (
          <div className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-5 print-hide">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-4">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-slate-500" />
                <div>
                  <h3 className="font-semibold text-slate-800">إعدادات عرض الأعمدة</h3>
                  <p className="text-xs text-slate-500 mt-1">تحكم في الأعمدة الظاهرة داخل التقرير</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  المفعّل: {visibleColumnsCount}/{columnDisplayOptions.length}
                </span>
                <button
                  onClick={handleShowAllColumns}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-all"
                >
                  إظهار الكل
                </button>
                <button
                  onClick={handleResetColumnsToDefault}
                  className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-all"
                >
                  افتراضي
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {columnDisplayOptions.map((option) => {
                const isVisible = visibleColumns[option.key];
                return (
                  <label key={option.key} className="block cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={(e) => handleColumnVisibilityChange(option.key, e.target.checked)}
                      className="sr-only"
                    />
                    <div
                      className={`rounded-xl border p-3 shadow-sm transition-all ${
                        isVisible
                          ? 'border-blue-300 bg-blue-50/80'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className={`text-sm font-bold ${isVisible ? 'text-blue-800' : 'text-slate-700'}`}>
                            {option.label}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">{option.hint}</div>
                        </div>
                        <div
                          className={`min-w-8 h-8 inline-flex items-center justify-center rounded-lg border text-xs font-bold ${
                            isVisible
                              ? 'border-blue-300 bg-white text-blue-700'
                              : 'border-slate-200 bg-slate-50 text-slate-500'
                          }`}
                        >
                          {option.code}
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <span className={`text-xs font-semibold ${isVisible ? 'text-emerald-700' : 'text-slate-400'}`}>
                          {isVisible ? 'ظاهر' : 'مخفي'}
                        </span>
                        <span
                          className={`inline-flex h-6 w-11 items-center rounded-full p-1 transition-all ${
                            isVisible ? 'bg-blue-600' : 'bg-slate-300'
                          }`}
                        >
                          <span
                            className={`h-4 w-4 rounded-full bg-white transition-all ${
                              isVisible ? 'ltr:translate-x-5 rtl:-translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </span>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* التقرير */}
        {reportGenerated && (reportData.length > 0 || includeExemptPage) && (
          <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-xl shadow-slate-200/60 p-6 print-area">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-6 print-hide">
              <div className="flex items-start gap-3">
                <div className="h-11 w-11 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">تقرير المناوبات</h2>
                  <p className="text-sm text-slate-600 mt-1">
                    إحصائية مناوبات الحجز لـ <span className="text-blue-700 font-semibold">{orderedSelectedCategories.join(' و ')}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                      الفترة: {startDate} ← {endDate}
                    </span>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700 font-semibold">
                      آخر مناوبة: {latestShiftDate}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                      تاريخ الطباعة: {new Date().getDate()}/{new Date().getMonth() + 1}/{new Date().getFullYear()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 print-hide">
                <button
                  onClick={() => setShowColumnSettings(!showColumnSettings)}
                  className="inline-flex items-center gap-2 rounded-full bg-blue-600 text-white px-4 py-2 text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  <Settings className="h-4 w-4" />
                  تخصيص الأعمدة
                </button>
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-600 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-700 transition-colors"
                >
                  <Print className="h-4 w-4" />
                  طباعة
                </button>
                <button
                  onClick={handleSavePdf}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  حفظ PDF
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 mb-6 print-hide">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                      <Users className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs text-blue-700 font-semibold">إجمالي الموظفين</div>
                      <div className="text-2xl font-black text-slate-900">{reportData.length}</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                      <CalendarDays className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs text-emerald-700 font-semibold">إجمالي المناوبات</div>
                      <div className="text-2xl font-black text-slate-900">{totalReportShifts}</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-amber-500 text-white flex items-center justify-center">
                      <Calendar className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs text-amber-700 font-semibold">مدة التقرير</div>
                      <div className="text-2xl font-black text-slate-900">{monthsCount}
                      <p className="text-xs text-slate-500 mt-1 inline mr-3">
                        {monthsCount === 1 ? 'شهر' : monthsCount === 2 ? 'شهرين' : 'أشهر'}
                      </p>
                      </div>

                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 mb-6 print-hide">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold text-slate-800">توزيع الفئات</div>
                <div className="text-xs text-slate-500">حسب النتائج الحالية</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {orderedSelectedCategories.map(category => {
                  const categoryData = reportData.filter(data => data.employee.category === category);
                  const percent = reportData.length > 0
                    ? Math.round((categoryData.length / reportData.length) * 100)
                    : 0;
                  const palette = category === 'قيادات'
                    ? { bar: 'bg-blue-600', text: 'text-blue-700', border: 'border-blue-200', bg: 'bg-blue-50' }
                    : category === 'مشرفون'
                      ? { bar: 'bg-emerald-600', text: 'text-emerald-700', border: 'border-emerald-200', bg: 'bg-emerald-50' }
                      : { bar: 'bg-amber-500', text: 'text-amber-700', border: 'border-amber-200', bg: 'bg-amber-50' };

                  return (
                    <div key={category} className={`rounded-xl border ${palette.border} ${palette.bg} px-3 py-2`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${palette.text}`}>{category}</span>
                          <span className="text-lg font-black text-slate-900">{categoryData.length}</span>
                        </div>
                        <span className="text-[11px] text-slate-500">{percent}%</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-white/70 overflow-hidden">
                        <div className={`h-1.5 rounded-full ${palette.bar}`} style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* عنوان الطباعة فوق الجدول */}
            <div style={{ display: 'none' }} className="print-show">
              <h2 className="print-subtitle">
                {orderedSelectedCategories.length > 0
                  ? `إحصائية مناوبات الحجز لـ ${orderedSelectedCategories.join(' و ')}`
                  : 'إحصائية مناوبات الحجز'}
              </h2>
              <div className="print-date-info">
                <div className="print-date-item">
                  <span className="print-date-label">تاريخ الطباعة</span>
                  <strong className="print-date-highlight">{format(new Date(), 'yyyy/M/d')}</strong>
                </div>
                <div className="print-date-item">
                  <span className="print-date-label">تاريخ أخر مناوبة</span>
                  <strong className="print-date-highlight">{shifts.length > 0
                    ? format(parseISO(shifts.reduce((latest, current) =>
                        new Date(current.shiftDate) > new Date(latest.shiftDate) ? current : latest
                      ).shiftDate), 'yyyy/M/d')
                    : 'لا توجد مناوبات'
                  }</strong>
                </div>
              </div>
            </div>

            {/* الجدول */}
            <div className="report-table rounded-2xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gradient-to-r from-slate-50 to-blue-50">
                      {visibleColumns.serialNumber && (
                        <th className="border border-slate-200 px-4 py-3 text-center font-semibold text-slate-700 serial-column">م</th>
                      )}
                      {showRankColumn && (
                        <th className="border border-slate-200 px-4 py-3 text-center font-semibold text-slate-700 rank-column">المسمى الوظيفي</th>
                      )}
                      {visibleColumns.name && (
                        <th className="border border-slate-200 px-4 py-3 text-center font-semibold text-slate-700 name-column">الاسم</th>
                      )}
                      {visibleColumns.department && (
                        <th className="border border-slate-200 px-4 py-3 text-center font-semibold text-slate-700 department-column">الإدارة</th>
                      )}
                      {visibleColumns.shifts && (
                        <th className="border border-slate-200 px-4 py-3 text-center font-semibold text-slate-700 shifts-column">المناوبات</th>
                      )}
                      {visibleColumns.totalShifts && (
                        <th className="border border-slate-200 px-4 py-3 text-center font-semibold text-slate-700 total-column">الإجمالي</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let globalIndex = 0;
                      const renderEmployeeRows = (employeesData: ReportData[]) => (
                        employeesData.map((data) => {
                          globalIndex++;
                          return (
                            <tr key={data.employee.id} className="hover:bg-slate-50 transition-colors">
                              {visibleColumns.serialNumber && (
                                <td className="border border-slate-200 px-4 py-3 text-center font-medium serial-column">{globalIndex}</td>
                              )}
                              {showRankColumn && (
                                <td className="border border-slate-200 px-4 py-3 text-center rank-column employee-rank">
                                  {data.employee.category === 'فنيون'
                                    ? (data.employee.jobTitle || 'بدون مسمى')
                                    : formatRankShort(data.employee.rank)}
                                </td>
                              )}
                              {visibleColumns.name && (
                                <td className="border border-slate-200 px-4 py-3 text-center name-column employee-name">
                                  {(() => {
                                    const nameParts = data.employee.name.split(' ').filter(part => part.trim() !== '');
                                    if (nameParts.length >= 3) {
                                      return `${nameParts[0]} ${nameParts[nameParts.length - 2]} ${nameParts[nameParts.length - 1]}`;
                                    } else {
                                      return data.employee.name;
                                    }
                                  })()}
                                </td>
                              )}
                              {visibleColumns.department && (
                                <td className="border border-slate-200 px-4 py-3 text-center department-column">
                                  {formatDepartmentLabel(data.employee.department, departmentNameMap) || 'غير مسجل'}
                                </td>
                              )}
                              {visibleColumns.shifts && (
                                <td className="border border-slate-200 px-4 py-3 shifts-column">
                                  <div className="flex flex-wrap gap-1 justify-center shifts-list">
                                    {(() => {
                                      const allEntries = Object.entries(data.monthlyBreakdown)
                                        .sort(([monthA], [monthB]) => monthA.localeCompare(monthB))
                                        .flatMap(([month, entries]) =>
                                          entries.map(entry => ({ ...entry, month }))
                                        );
                                      return allEntries.map((entry, index) => {
                                        const monthNum = parseInt(format(parseISO(`${entry.month}-01`), 'M'));
                                        return (
                                          <span key={`${entry.month}-${entry.date}`} className="text-sm">
                                            <span className={`${getMonthColor(monthNum)} font-bold shift-date text-[16px]`}>
                                              {format(parseISO(`${entry.month}-01`), 'M')}/{entry.date}
                                              {entry.note && (
                                                <span className={`shift-note ${entry.isAbsent ? 'text-red-600 font-normal' : 'text-amber-700 font-normal'}`}>
                                                  {' '}
                                                  ({entry.note})
                                                </span>
                                              )}
                                            </span>
                                            {index < allEntries.length - 1 && <span className="text-gray-400 mx-1">-</span>}
                                          </span>
                                        );
                                      });
                                    })()}
                                  </div>
                                </td>
                              )}
                              {visibleColumns.totalShifts && (
                                <td className="border border-slate-200 px-4 py-3 text-center total-column">
                                  {data.totalShifts}
                                </td>
                              )}
                            </tr>
                          );
                        })
                      );
                    return Object.entries(groupedData)
                      .sort(([categoryA], [categoryB]) => {
                        const indexA = categoryDisplayOrder.indexOf(categoryA);
                        const indexB = categoryDisplayOrder.indexOf(categoryB);
                        const safeA = indexA === -1 ? categoryDisplayOrder.length : indexA;
                        const safeB = indexB === -1 ? categoryDisplayOrder.length : indexB;
                        if (safeA !== safeB) return safeA - safeB;
                        return categoryA.localeCompare(categoryB, 'ar');
                      })
                      .map(([category, departments], categoryIndex) => (
                        <React.Fragment key={category}>
                          {/* صف الفئة */}
                          {showCategoryRows && (
                            <tr className={`bg-gradient-to-r from-blue-50 to-indigo-50 category-row ${categoryIndex > 0 ? 'category-page-break' : ''}`}>
                              <td
                                colSpan={visibleTableColumnCount}
                                className="border border-slate-200 px-4 py-3 text-center font-bold text-blue-800"
                              >
                                {category}
                              </td>
                            </tr>
                          )}

                          {/* صفوف الإدارات والموظفين */}
                          {category === 'فنيون'
                            ? Object.entries(departments as Record<string, Record<string, ReportData[]>>)
                              .sort(([groupA], [groupB]) => {
                                const indexA = professionalGroupOrder.indexOf(groupA);
                                const indexB = professionalGroupOrder.indexOf(groupB);
                                const safeA = indexA === -1 ? professionalGroupOrder.length : indexA;
                                const safeB = indexB === -1 ? professionalGroupOrder.length : indexB;
                                return safeA - safeB;
                              })
                              .map(([professionalGroup, groupDepartments], groupIndex) => (
                                <React.Fragment key={`${category}-${professionalGroup}`}>
                                  {/* صف فئة الفنيين */}
                                  <tr
                                    className={`bg-blue-800 text-white subcategory-row ${
                                      groupIndex > 0 ? 'subcategory-page-break' : ''
                                    }`}
                                  >
                                    <td
                                      colSpan={visibleTableColumnCount}
                                      className="border border-slate-200 px-4 py-2 text-center font-semibold text-white"
                                    >
                                      {formatProfessionalGroupLabel(professionalGroup)}
                                    </td>
                                  </tr>

                                  {Object.entries(groupDepartments).map(([department, employeesData]) => (
                                    <React.Fragment key={`${category}-${professionalGroup}-${department}`}>
                                      {/* صف الإدارة */}
                                      <tr className="bg-blue-50 text-red-700 department-row">
                                        <td
                                          colSpan={visibleTableColumnCount}
                                          className="border border-slate-200 px-4 py-2 text-center font-semibold text-red-700"
                                        >
                                          {department}
                                        </td>
                                      </tr>

                                      {/* صفوف الموظفين */}
                                      {renderEmployeeRows(employeesData)}
                                    </React.Fragment>
                                  ))}
                                </React.Fragment>
                              ))
                            : Object.entries(departments as Record<string, ReportData[]>).map(([department, employeesData]) => (
                              <React.Fragment key={`${category}-${department}`}>
                                {/* صف الإدارة */}
                                <tr className="bg-blue-50 text-red-700 department-row">
                                  <td
                                    colSpan={visibleTableColumnCount}
                                    className="border border-slate-200 px-4 py-2 text-center font-semibold text-red-700"
                                  >
                                    {department}
                                  </td>
                                </tr>

                                {/* صفوف الموظفين */}
                                {renderEmployeeRows(employeesData)}
                              </React.Fragment>
                            ))}
                        </React.Fragment>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

          {/* إحصائيات للطباعة */}
          <div style={{ display: 'none', marginTop: '20px', textAlign: 'center' }} className="print-show">
            <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginBottom: '15px' }}>
              {orderedSelectedCategories.map(category => {
                const categoryData = reportData.filter(data => data.employee.category === category);

                return (
                  <div key={category} style={{
                    padding: '10px 15px',
                    backgroundColor: '#f8f9fa'
                  }}>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#2563eb' }}>
                      {categoryData.length}
                    </div>
                    <div style={{ fontSize: '12px', color: '#374151' }}>
                      {category}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ملاحظة عدد الأشهر للطباعة */}
            <div style={{ fontSize: '12px', color: '#666', fontStyle: 'italic' }}>
              إحصائية آخر {monthsCount} {monthsCount === 1 ? 'شهر' : monthsCount === 2 ? 'شهرين' : 'أشهر'}
            </div>
          </div>

            {includeExemptPage && (
              <div className={`mt-8 rounded-2xl border border-red-200 bg-white overflow-hidden ${reportData.length > 0 ? 'category-page-break' : ''}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 py-4 border-b border-red-200 bg-red-50">
                  <h3 className="text-lg font-extrabold text-red-800">معفيين من المناوبات</h3>
                  <span className="inline-flex items-center rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-700">
                    الإجمالي: {exemptReportData.length}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-red-50">
                        <th className="border border-slate-200 px-4 py-3 text-center font-semibold text-slate-700 serial-column w-[6%]">م</th>
                        <th className="border border-slate-200 px-3 py-3 text-center font-semibold text-slate-700 w-[12%] whitespace-nowrap">المسمى الوظيفي</th>
                        <th className="border border-slate-200 px-4 py-3 text-center font-semibold text-slate-700 w-[24%] whitespace-nowrap">الاسم</th>
                        <th className="border border-slate-200 px-4 py-3 text-center font-semibold text-slate-700 w-[18%]">الإدارة</th>
                        <th className="border border-slate-200 px-2 py-3 text-center font-semibold text-slate-700 w-[14%]">المناوبات</th>
                        <th className="border border-slate-200 px-4 py-3 text-center font-semibold text-slate-700 w-[26%]">سبب الإعفاء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exemptReportData.length > 0 ? (
                        exemptReportData.map((data, index) => {
                          const allEntries = Object.entries(data.monthlyBreakdown)
                            .sort(([monthA], [monthB]) => monthA.localeCompare(monthB))
                            .flatMap(([month, entries]) => entries.map(entry => ({ ...entry, month })));

                          return (
                            <tr key={data.employee.id} className="hover:bg-slate-50 transition-colors">
                              <td className="border border-slate-200 px-4 py-3 text-center font-medium serial-column">{index + 1}</td>
                              <td className="border border-slate-200 px-3 py-3 text-center employee-rank whitespace-nowrap">
                                {data.employee.category === 'فنيون'
                                  ? (data.employee.jobTitle || 'بدون مسمى')
                                  : formatRankShort(data.employee.rank)}
                              </td>
                              <td className="border border-slate-200 px-4 py-3 text-center employee-name whitespace-nowrap">{data.employee.name}</td>
                              <td className="border border-slate-200 px-4 py-3 text-center">
                                {formatDepartmentLabel(data.employee.department, departmentNameMap) || 'غير مسجل'}
                              </td>
                              <td className="border border-slate-200 px-2 py-3 text-center">
                                {allEntries.length > 0 ? (
                                  <div className="flex flex-wrap gap-1 justify-center">
                                    {allEntries.map((entry, entryIndex) => {
                                      const monthNum = parseInt(format(parseISO(`${entry.month}-01`), 'M'));
                                      return (
                                        <span key={`${data.employee.id}-${entry.month}-${entry.date}`} className="text-xs">
                                          <span className={`${getMonthColor(monthNum)} font-bold shift-date text-[14px]`}>
                                            {format(parseISO(`${entry.month}-01`), 'M')}/{entry.date}
                                            {entry.note && (
                                              <span className={`shift-note ${entry.isAbsent ? 'text-red-600 font-normal' : 'text-amber-700 font-normal'}`}>
                                                {' '}
                                                ({entry.note})
                                              </span>
                                            )}
                                          </span>
                                          {entryIndex < allEntries.length - 1 && <span className="text-gray-400 mx-1">-</span>}
                                        </span>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <span className="text-slate-400 text-sm">لا يوجد</span>
                                )}
                              </td>
                              <td className="border border-slate-200 px-4 py-3 text-center text-red-700 font-medium">
                                {data.exemptionReason}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={6} className="border border-slate-200 px-4 py-6 text-center text-slate-500">
                            لا يوجد موظفون غير مدرجين بالمناوبات
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
        </div>
      )}

        {reportGenerated && reportData.length === 0 && !includeExemptPage && (
          <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-8 text-center">
            <CalendarDays className="h-12 w-12 mx-auto mb-4 text-amber-500" />
            <h3 className="text-lg font-bold text-amber-800 mb-2">لا توجد بيانات</h3>
            <p className="text-sm text-amber-700">
              لم يتم العثور على مناوبات في الفترة المحددة للفئات والأقسام المختارة
            </p>
            <button
              onClick={resetFilters}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-amber-600 text-white px-5 py-2 text-sm font-semibold hover:bg-amber-700 transition-all"
            >
              <RefreshCw className="h-4 w-4" />
              إعادة تعيين الفلاتر
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Reports;
