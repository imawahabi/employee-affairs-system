import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Users,
  ShieldCheck,
  CalendarCheck,
  Building,
  Shield,
  ExternalLink,
  Check,
  UserMinus,
  TrendingUp,
  Award,
  Briefcase,
} from 'lucide-react';
import { fetchEmployees, fetchShifts, fetchShiftAssignments, fetchRanks, fetchProfessionalExtensionStatus, fetchLicenses, fetchSettings, fetchShiftDayExceptions } from '../api';
import { Employee, Shift, ShiftAssignment, Rank, ProfessionalExtensionStatusResponse, ShiftDayException } from '../types.ts';
import { License } from '../licenses/types';
import LoadingPage from './LoadingPage';
import { formatDepartmentLabel } from '../utils/organization';
import { getStatisticsEmployeeBuckets, shouldIncludeEmployeeInStatistics } from '../utils/employeeStatistics';
import { useSystem } from '../contexts/SystemContext';
import { formatShiftEmployeeDisplayName } from '../utils/employeeDisplay';

interface DashboardProps {
  onPageChange?: (page: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onPageChange }) => {
  const { hideShifts, hideLicenses, hideProfessionalExtensions, excludeWeekendShifts } = useSystem();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftAssignments, setShiftAssignments] = useState<ShiftAssignment[]>([]);
  const [exceptionalDays, setExceptionalDays] = useState<ShiftDayException[]>([]);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [extensionStatus, setExtensionStatus] = useState<ProfessionalExtensionStatusResponse | null>(null);
  const [licenseRecords, setLicenseRecords] = useState<License[]>([]);
  const [alertOverdueDays, setAlertOverdueDays] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [employeesData, ranksData] = await Promise.all([
        fetchEmployees(),
        fetchRanks(),
      ]);

      let sortedShifts: Shift[] = [];
      let shiftAssignmentsData: ShiftAssignment[] = [];
      let exceptionDaysData: ShiftDayException[] = [];
      let extensionStatusData: ProfessionalExtensionStatusResponse | null = null;
      let licenseRecordsData: License[] = [];
      if (!hideShifts) {
        const [shiftsData, assignmentsData, exceptionsData] = await Promise.all([
          fetchShifts(),
          fetchShiftAssignments(),
          fetchShiftDayExceptions()
        ]);
        // Sort shifts by date
        sortedShifts = [...shiftsData].sort((a, b) =>
          new Date(b.shiftDate).getTime() - new Date(a.shiftDate).getTime()
        );
        shiftAssignmentsData = assignmentsData;
        exceptionDaysData = Array.isArray(exceptionsData) ? exceptionsData : [];
        try {
          const settingsData = await fetchSettings();
          const parsedOverdueDays = Number.parseInt(settingsData.alert_overdue_days?.value || '', 10);
          const safeOverdueDays = Number.isFinite(parsedOverdueDays) && parsedOverdueDays > 0 ? parsedOverdueDays : 1;
          setAlertOverdueDays(safeOverdueDays);
        } catch (settingsError) {
          console.error('Error loading alert overdue days:', settingsError);
          setAlertOverdueDays(1);
        }
      } else if (!hideProfessionalExtensions) {
        try {
          extensionStatusData = await fetchProfessionalExtensionStatus();
        } catch (extensionError) {
          console.error('Error loading extension status:', extensionError);
        }
      }

      if (!hideLicenses) {
        try {
          const licensesResponse = await fetchLicenses();
          if (Array.isArray(licensesResponse)) {
            licenseRecordsData = licensesResponse;
          } else if (Array.isArray(licensesResponse?.data)) {
            licenseRecordsData = licensesResponse.data;
          }
        } catch (licenseError) {
          console.error('Error loading licenses list:', licenseError);
        }
      }

      setEmployees(employeesData);
      setShifts(sortedShifts);
      if (!hideShifts) {
        localStorage.setItem('shifts', JSON.stringify(sortedShifts));
      }
      setShiftAssignments(shiftAssignmentsData);
      setExceptionalDays(exceptionDaysData);
      setRanks(ranksData || []);
      setExtensionStatus(extensionStatusData);
      setLicenseRecords(licenseRecordsData);

      // تم حذف منطق التنبيهات المحلية لتجنب التكرار مع API
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError('فشل في تحميل بيانات لوحة التحكم');
      // Set default empty arrays to prevent crashes
      setEmployees([]);
      setShifts([]);
      setShiftAssignments([]);
      setExtensionStatus(null);
      setLicenseRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [hideShifts, hideLicenses, hideProfessionalExtensions]);

  const statisticsEmployees = useMemo(
    () => getStatisticsEmployeeBuckets(employees),
    [employees]
  );

  const excludedFromStatisticsCount = statisticsEmployees.excluded.length;
  const activeEmployees = statisticsEmployees.included.filter(e => e.status === 'active');
  const inactiveEmployees = employees.filter(e => e.status === 'inactive');
  const activeCounts = {
    officers: activeEmployees.filter(e => e.category === 'قيادات').length,
    ncos: activeEmployees.filter(e => e.category === 'مشرفون').length,
    professionals: activeEmployees.filter(e => e.category === 'فنيون').length,
    civilians: activeEmployees.filter(e => e.category === 'إداريون').length,
  };
  const activeGeneralTotal = activeEmployees.length;
  const inactiveCount = inactiveEmployees.length;

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>();
    employees.forEach((emp) => map.set(String(emp.id), emp));
    return map;
  }, [employees]);

  const exceptionalDayMap = useMemo(() => {
    const map = new Map<string, ShiftDayException>();
    exceptionalDays.forEach((day) => {
      const key = String(day.date || '').match(/\d{4}-\d{2}-\d{2}/)?.[0];
      if (key) map.set(key, day);
    });
    return map;
  }, [exceptionalDays]);

  const exceptionalDateSet = useMemo(() => new Set(exceptionalDayMap.keys()), [exceptionalDayMap]);

  const licenseSummary = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const statisticsLicenseRecords = licenseRecords.filter((license) => {
      const employee = employeeById.get(String(license.employee_id));
      return shouldIncludeEmployeeInStatistics(employee);
    });
    const monthlyLicenses = statisticsLicenseRecords.filter(
      (license) => license.month === currentMonth && license.year === currentYear
    );

    const countByType = (list: License[], type: License['license_type']) =>
      list.filter((license) => license.license_type === type).length;

    return {
      monthly: {
        total: monthlyLicenses.length,
        fullDay: countByType(monthlyLicenses, 'يوم كامل'),
        short: countByType(monthlyLicenses, 'إستئذان قصير'),
        medical: countByType(monthlyLicenses, 'إستئذان طبي'),
      },
      total: {
        total: statisticsLicenseRecords.length,
        fullDay: countByType(statisticsLicenseRecords, 'يوم كامل'),
        short: countByType(statisticsLicenseRecords, 'إستئذان قصير'),
        medical: countByType(statisticsLicenseRecords, 'إستئذان طبي'),
      },
    };
  }, [licenseRecords, employeeById]);

  const latestLicenses = useMemo(() => {
    if (!licenseRecords.length) return [];
    return licenseRecords
      .filter((license) => shouldIncludeEmployeeInStatistics(employeeById.get(String(license.employee_id))))
      .slice()
      .sort((a, b) => {
        const dateA = new Date(a.created_at || a.license_date).getTime();
        const dateB = new Date(b.created_at || b.license_date).getTime();
        return dateB - dateA;
      })
      .slice(0, 3);
  }, [licenseRecords, employeeById]);

  const formatLicenseTypeLabel = (value?: string) => {
    if (!value) return 'غير محدد';
    if (value === 'يوم كامل' || value === 'رخصة يوم كامل') {
      return 'رخصة يوم كامل';
    }
    if (value === 'إستئذان طبي') {
      return 'إستئذان طبي';
    }
    if (value === 'إستئذان قصير') {
      return 'إستئذان قصير';
    }
    return value;
  };

  const getLicenseTypeBadge = (value?: string) => {
    if (value === 'يوم كامل' || value === 'رخصة يوم كامل') {
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    }
    if (value === 'إستئذان طبي') {
      return 'bg-purple-100 text-purple-700 border-purple-200';
    }
    return 'bg-orange-100 text-orange-700 border-orange-200';
  };

  const formatLicenseDate = (value?: string) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('ar-UK', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const getTimeSince = (value?: string) => {
    if (!value) return '—';
    const created = new Date(value);
    if (Number.isNaN(created.getTime())) return '—';

    const diffInMs = Date.now() - created.getTime();
    const minutes = Math.floor(diffInMs / (1000 * 60));
    const hours = Math.floor(diffInMs / (1000 * 60 * 60));
    const days = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'الآن';
    if (minutes < 60) return `منذ ${minutes} دقيقة`;
    if (hours < 24) return `منذ ${hours} ساعة`;
    return `منذ ${days} يوم`;
  };

  const currentMonthLabel = new Date().toLocaleDateString('ar-UK', {
    month: 'long',
    year: 'numeric',
  });
  const missingDepartmentCount = statisticsEmployees.included.filter(e => !e.department || !e.department.toString().trim()).length;
  const missingPhoneCount = statisticsEmployees.included.filter(e => !e.phone_number || !e.phone_number.toString().trim()).length;
  const missingFileCount = statisticsEmployees.included.filter(e => !e.fileNumber).length;

  if (loading) {
    return <LoadingPage variant="dashboard" />;
  }

  if (error) {
    return <div className="text-center py-8 text-red-500">Error: {error}</div>;
  }

  const departmentCounts = statisticsEmployees.included.reduce((acc, employee) => {
    const label = formatDepartmentLabel(employee.department) || '';
    if (!label) return acc;
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const topDepartments = Object.entries(departmentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const extensionCounts = extensionStatus
    ? {
      approaching: extensionStatus.approaching.length,
      notExtended: extensionStatus.notExtended.length,
      extended: extensionStatus.extended.length,
    }
    : null;

  // Category order: Officers, NCOs, Professionals, Civilians
  const categoryOrder: Record<Employee['category'], number> = {
    'قيادات': 0,
    'مشرفون': 1,
    'فنيون': 2,
    'إداريون': 3,
  };

  // Build rank order by category from ranks
  const rankOrderByCategory: Record<string, Record<string, number>> = {};
  (ranks || []).forEach((r) => {
    if (!rankOrderByCategory[r.category]) rankOrderByCategory[r.category] = {};
    rankOrderByCategory[r.category][r.name] = r.order;
  });

  // Calculate official metrics
  // Calculate overdue shifts (excluding today) and latest received shift
  const now = new Date();
  const toDateKey = (date: Date) => date.toISOString().split('T')[0];
  const normalizedOverdueDays = Math.max(1, Math.floor(Number.isFinite(alertOverdueDays) ? alertOverdueDays : 1));
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const overdueThreshold = new Date(todayStart);
  overdueThreshold.setDate(overdueThreshold.getDate() - normalizedOverdueDays);

  const overdueShifts = shifts.filter(shift => {
    const shiftDate = new Date(shift.shiftDate);
    shiftDate.setHours(0, 0, 0, 0);
    return !shift.paperCopyReceived && shiftDate <= overdueThreshold;
  }).sort((a, b) => new Date(a.shiftDate).getTime() - new Date(b.shiftDate).getTime()); // Sort by date ascending

  const overdueShiftsCount = overdueShifts.length;

  const receivedShifts = shifts.filter(shift => shift.paperCopyReceived);
  const latestReceivedShift = receivedShifts.sort((a, b) =>
    new Date(b.shiftDate).getTime() - new Date(a.shiftDate).getTime()
  )[0];

  // Get latest registered shift (for top card)
  const latestShift = shifts.sort((a, b) =>
    new Date(b.shiftDate).getTime() - new Date(a.shiftDate).getTime()
  )[0];

  // Get today's shift (for bottom detailed card)
  const today = new Date();
  const todayDateString = toDateKey(today); // YYYY-MM-DD format

  const todayShift = shifts.find(shift => {
    const shiftDate = new Date(shift.shiftDate);
    return toDateKey(shiftDate) === todayDateString;
  });
  const todayExceptional = exceptionalDayMap.get(todayDateString) || null;
  const latestShiftDateKey = latestShift ? toDateKey(new Date(latestShift.shiftDate)) : '';
  const latestExceptionalDateKey = exceptionalDateSet.size
    ? Array.from(exceptionalDateSet).sort().slice(-1)[0]
    : '';
  const latestPlannedDateKey = [latestShiftDateKey, latestExceptionalDateKey]
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || '';
  // لا توجد مناوبات بعد اليوم الحالي؟ (نفس منطق تحذير التأخير في السايدبار)
  const isShiftPlanMissing = !latestPlannedDateKey || latestPlannedDateKey < todayDateString;

  // For detailed card: show today's shift if exists, otherwise latest shift (skip if today is exceptional)
  const displayShift = todayExceptional ? null : (todayShift || latestShift);
  const displayShiftDate = todayExceptional
    ? new Date(todayDateString)
    : displayShift
      ? new Date(displayShift.shiftDate)
      : null;

  const shiftDateSet = new Set(shifts.map((shift) => toDateKey(new Date(shift.shiftDate))));
  const plannedDateSet = new Set([...shiftDateSet, ...exceptionalDateSet]);
  const missingShiftDates = (() => {
    if (!latestPlannedDateKey) return [];
    const missing: string[] = [];
    const start = new Date(latestPlannedDateKey);
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    cursor.setDate(cursor.getDate() + 1);
    while (cursor <= end) {
      const dayOfWeek = cursor.getDay();
      if (excludeWeekendShifts && (dayOfWeek === 5 || dayOfWeek === 6)) {
        cursor.setDate(cursor.getDate() + 1);
        continue;
      }
      const key = toDateKey(cursor);
      if (!plannedDateSet.has(key)) {
        missing.push(key);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return missing;
  })();

  const isShiftEmployee = (emp: Employee | undefined): emp is Employee => {
    if (!emp) return false;
    return emp.category !== 'إداريون';
  };

  const displayShiftEmployees = displayShift
    ? shiftAssignments
      .filter(a => a.shiftId === displayShift.id)
      .map(a => employees.find(e => e.id === a.employeeId))
      .filter(isShiftEmployee)
    : [];

  // Sort employees by category, then rank order (per category), then Arabic name
  const sortedDisplayShiftEmployees = (() => {
    // Using precomputed rankOrderByCategory
    const collator = new Intl.Collator('ar');
    return [...(displayShiftEmployees as Employee[])].sort((a, b) => {
      const catDiff = (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99);
      if (catDiff !== 0) return catDiff;
      const ra = rankOrderByCategory[a.category]?.[a.rank] ?? 9999;
      const rb = rankOrderByCategory[b.category]?.[b.rank] ?? 9999;
      if (ra !== rb) return ra - rb;
      return collator.compare(a.name, b.name);
    });
  })();

  // تم حذف منطق المناوبة القادمة

  const getSeniorEmployeeForShift = (shiftId: string): Employee | null => {
    const assignedEmployees = shiftAssignments
      .filter(a => a.shiftId === shiftId)
      .map(a => employees.find(e => e.id === a.employeeId))
      .filter(isShiftEmployee);
    if (assignedEmployees.length === 0) return null;
    const collator = new Intl.Collator('ar');
    const sorted = assignedEmployees.slice().sort((a, b) => {
      const catDiff = (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99);
      if (catDiff !== 0) return catDiff;
      const ra = rankOrderByCategory[a.category]?.[a.rank] ?? 9999;
      const rb = rankOrderByCategory[b.category]?.[b.rank] ?? 9999;
      if (ra !== rb) return ra - rb;
      return collator.compare(a.name, b.name);
    });
    return sorted[0] || null;
  };

  const handleOpenShift = (shiftDate: string) => {
    if (!onPageChange) return;
    try {
      const dateKey = toDateKey(new Date(shiftDate));
      localStorage.setItem('quickSearchDate', dateKey);
    } catch { }
    onPageChange('view-shifts');
  };
  const canOpenShift = Boolean(onPageChange);

  return (
    <div className="min-h-screen p-3 rounded-xl space-y-10">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl flex items-center justify-center shadow-sm">
            <ShieldCheck size={22} className="text-white" />
          </div>
          <div>
            <h2 className="text-xl font-black text-gray-900">إحصائيات النظام</h2>
            {excludedFromStatisticsCount > 0 && (
              <p className="text-xs text-gray-800">
                <span className="font-bold text-red-700">ملاحظة :</span> <span className="text-gray-700 font-black"> {excludedFromStatisticsCount} </span> <span className="font-semibold text-gray-700"> موظفين مستثنيين</span>
              </p>
            )}
          </div>
          <div className="flex-1 h-px bg-slate-200/80" aria-hidden="true" />
        </div>

        <div className="space-y-6">
          {/* Summary Stats Row - Premium Professional Design */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Total Active Personnel Card - Premium Blue */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 p-6 shadow-lg hover:shadow-2xl transition-all duration-500 group">
              {/* Animated Background Elements */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl -mr-32 -mt-32 group-hover:bg-blue-400/30 transition-all duration-700" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-cyan-400/10 rounded-full blur-2xl -ml-24 -mb-24 group-hover:bg-cyan-300/20 transition-all duration-700" />
              <div className="absolute top-1/2 left-1/2 w-32 h-32 bg-white/5 rounded-full blur-xl -translate-x-1/2 -translate-y-1/2" />

              <div className="relative z-10">
                <div className="flex items-start justify-between mb-6">
                  <div className="space-y-1">
                    <div className="text-blue-200 text-sm font-medium tracking-wide">إجمالي الموظفين</div>
                    <div className="text-6xl font-black text-white leading-none tracking-tight">{activeGeneralTotal + inactiveCount}</div>
                  </div>
                  <div className="relative">
                    <div className="w-16 h-16 rounded-2xl bg-white/10 border border-blue-400/50 backdrop-blur-sm flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-white/20 transition-all duration-300">
                      <Users size={30} className="text-white" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-blue-400 rounded-full flex items-center justify-center shadow">
                      <TrendingUp size={12} className="text-white" />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                  <span className="text-blue-100 text-sm">جميع فئات الموظفين</span>
                </div>
              </div>
            </div>

            {/* Active Military Personnel Card - Premium Green */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-green-700 to-teal-800 p-6 shadow-lg hover:shadow-2xl transition-all duration-500 group">
              {/* Animated Background Elements */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/20 rounded-full blur-3xl -mr-32 -mt-32 group-hover:bg-emerald-400/30 transition-all duration-700" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-green-400/10 rounded-full blur-2xl -ml-24 -mb-24 group-hover:bg-green-300/20 transition-all duration-700" />
              <div className="absolute top-1/2 left-1/2 w-32 h-32 bg-white/5 rounded-full blur-xl -translate-x-1/2 -translate-y-1/2" />

              <div className="relative z-10">
                <div className="flex items-start justify-between mb-6">
                  <div className="space-y-1">
                    <div className="text-emerald-200 text-sm font-medium tracking-wide">الموظفون النشطون</div>
                    <div className="text-6xl font-black text-white leading-none tracking-tight">{activeGeneralTotal}</div>
                  </div>
                  <div className="relative">
                    <div className="w-16 h-16 rounded-2xl border border-green-500/50 bg-white/10 backdrop-blur-sm flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-white/20 transition-all duration-300">
                      <Shield size={30} className="text-white" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-400 rounded-full flex items-center justify-center shadow">
                      <Award size={12} className="text-white" />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                  <span className="text-emerald-100 text-sm">قيادات ● مشرفون ● فنيون ● إداريون</span>
                </div>
              </div>
            </div>

            {/* Inactive Personnel Card - Premium Slate */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-600 via-gray-700 to-slate-800 p-6 shadow-lg hover:shadow-2xl transition-all duration-500 group">
              {/* Animated Background Elements */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-slate-500/20 rounded-full blur-3xl -mr-32 -mt-32 group-hover:bg-slate-400/30 transition-all duration-700" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-gray-500/10 rounded-full blur-2xl -ml-24 -mb-24 group-hover:bg-gray-400/20 transition-all duration-700" />
              <div className="absolute top-1/2 left-1/2 w-32 h-32 bg-white/5 rounded-full blur-xl -translate-x-1/2 -translate-y-1/2" />

              <div className="relative z-10">
                <div className="flex items-start justify-between mb-6">
                  <div className="space-y-1">
                    <div className="text-slate-300 text-sm font-medium tracking-wide">خارج الخدمة</div>
                    <div className="text-6xl font-black text-white leading-none tracking-tight">{inactiveCount}</div>
                  </div>
                  <div className="relative">
                    <div className="w-16 h-16 rounded-2xl border border-gray-400/50 bg-white/10 backdrop-blur-sm flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-white/20 transition-all duration-300">
                      <UserMinus size={30} className="text-white" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-slate-400 rounded-full flex items-center justify-center shadow">
                      <Briefcase size={12} className="text-white" />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse" />
                  <span className="text-slate-300 text-sm"> خارج الخدمة حالياً  <span className="font-normal text-xs text-red-300"> (  إستقالة • نقل • تقاعد .. إلخ )</span></span>
                </div>
              </div>
            </div>
          </div>

          {/* Unified Employee Distribution Cards - 4 in one row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Officers Card */}
            <div className="relative overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-white via-blue-50 to-blue-100/70 p-5 shadow-sm hover:shadow-lg transition-shadow duration-200 hover:shadow-blue-200">
              <div className="absolute -top-6 -left-6 h-20 w-20 rounded-full blur-2xl bg-blue-200/40" />
              <div className="flex items-center justify-between gap-4 relative">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Users size={24} className="text-blue-600" />
                </div>
                <div className="text-right flex-1">
                  <div className="text-5xl font-black text-blue-700 mb-1">{activeCounts.officers}</div>
                  <div className="text-md font-bold  leading-tight text-gray-900">
                    قيادات
                  </div>
                </div>
              </div>
            </div>

            {/* NCOs Card */}
            <div className="relative overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-white via-blue-50 to-blue-100/70 p-5 shadow-sm hover:shadow-lg transition-shadow duration-200 hover:shadow-blue-200">
              <div className="absolute -top-6 -left-6 h-20 w-20 rounded-full blur-2xl bg-blue-200/40" />
              <div className="flex items-center justify-between gap-4 relative">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Users size={24} className="text-blue-600" />
                </div>
                <div className="text-right flex-1">
                  <div className="text-5xl font-black text-blue-700 mb-1">{activeCounts.ncos}</div>
                  <div className="text-md font-bold leading-tight text-gray-900">
                    مشرفون
                  </div>
                </div>
              </div>
            </div>

            {/* Professionals Card */}
            <div className="relative overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-white via-blue-50 to-blue-100/70 p-5 shadow-sm hover:shadow-lg transition-shadow duration-200 hover:shadow-blue-200">
              <div className="absolute -top-6 -left-6 h-20 w-20 rounded-full blur-2xl bg-blue-200/40" />
              <div className="flex items-center justify-between gap-4 relative">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                  <ShieldCheck size={24} className="text-blue-600" />
                </div>
                <div className="text-right flex-1">
                  <div className="text-5xl font-black text-blue-700 mb-1">{activeCounts.professionals}</div>
                  <div className="text-md font-bold  leading-tight text-gray-900">
                    فنيون
                  </div>
                </div>
              </div>
            </div>

            {/* Civilians Card */}
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100/70 p-5 shadow-sm hover:shadow-lg transition-shadow duration-200 hover:shadow-slate-200">
              <div className="absolute -top-6 -left-6 h-20 w-20 rounded-full blur-2xl bg-slate-200/40" />
              <div className="flex items-center justify-between gap-4 relative">
                <div className="w-12 h-12 bg-slate-200 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Building size={24} className="text-slate-600" />
                </div>
                <div className="text-right flex-1">
                  <div className="text-5xl font-black text-slate-600 mb-1">{activeCounts.civilians}</div>
                  <div className="text-md font-bold  leading-tight text-gray-900">
                    إداريون
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {!hideShifts && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl flex items-center justify-center shadow-sm">
              <CalendarCheck size={22} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900">ملخص نظام المناوبات</h2>
              <p className="text-xs text-gray-600">متابعة الاستلام وآخر المناوبات المسجلة</p>
            </div>
            <div className="flex-1 h-px bg-slate-200/80" aria-hidden="true" />
          </div>

          <div className="space-y-6">
            {/* Shift System Overview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                {/* Latest Shift + Reception */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-4 ">
                  <div className="flex items-center justify-between mb-4 ">
                    <div className="flex items-center gap-3 ">
                      <div className="w-11 h-11 rounded-xl bg-gray-100 text-gray-700 flex items-center justify-center shadow-sm">
                        <Calendar size={20} className="text-gray-700" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-gray-900">آخر مناوبة ومتابعة الاستلام</h3>
                        <p className="text-xs text-gray-600">ملخص سريع لنظام المناوبات</p>
                      </div>
                    </div>
                    <div className={`px-2.5 py-1 rounded-full text-xs font-bold ${overdueShiftsCount > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {overdueShiftsCount > 0 ? 'تأخير الاستلام' : 'الاستلام منتظم'}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className={`min-h-48 relative overflow-hidden rounded-2xl border p-4 shadow-sm ${isShiftPlanMissing
                      ? 'border-red-200 bg-gradient-to-br from-white via-red-50 to-red-100/70 alert-pulse'
                      : 'border-blue-200 bg-gradient-to-br from-white via-blue-50 to-blue-100/70'
                      }`}>
                      <div className={`absolute -top-6 -left-6 h-20 w-20 rounded-full blur-2xl ${isShiftPlanMissing ? 'bg-red-200/40' : 'bg-blue-200/40'
                        }`} />
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-xl text-white flex items-center justify-center shadow ${isShiftPlanMissing ? 'bg-red-600' : 'bg-blue-600'
                            }`}>
                            <Calendar size={14} />
                          </div>
                          <div className="text-sm font-bold text-slate-800">آخر مناوبة مسجلة</div>
                        </div>
                        <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${isShiftPlanMissing ? 'text-red-700 bg-red-100' : 'text-blue-700 bg-blue-100'
                          }`}>
                          {isShiftPlanMissing ? 'تنبيه' : 'أحدث مناوبة'}
                        </span>
                      </div>
                      <div className="flex flex-col items-center gap-1 pt-5">
                        <div className={`text-sm font-semibold ${isShiftPlanMissing ? 'text-red-700' : 'text-blue-700'
                          }`}>
                          {latestShift ? new Date(latestShift.shiftDate).toLocaleDateString('ar-US', {
                            weekday: 'long'
                          }) : 'لم يتم تسجيل مناوبات'}
                        </div>
                        <div className="text-2xl font-black text-slate-900">
                          {latestShift ? new Date(latestShift.shiftDate).toLocaleDateString('ar-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                          }) : 'لا توجد'}
                        </div>
                        {isShiftPlanMissing && (
                          <div className="mt-2 inline-flex items-center text-center rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
                            لا توجد مناوبات أو أيام استثنائية بعد تاريخ اليوم الحالي
                          </div>
                        )}
                      </div>

                      {missingShiftDates.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {missingShiftDates.slice(0, 3).map((dateStr) => (
                            <span
                              key={dateStr}
                              className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700"
                            >
                              {new Date(dateStr).toLocaleDateString('ar-US', {
                                month: 'short',
                                day: 'numeric'
                              })}
                            </span>
                          ))}
                          {missingShiftDates.length > 3 && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">
                              +{missingShiftDates.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className={`rounded-xl border p-3 ${overdueShiftsCount > 0 ? 'border-red-200 bg-gradient-to-br from-red-50 via-red-50/70 to-red-100/50' : 'border-emerald-200 bg-emerald-50/60'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${overdueShiftsCount > 0 ? 'bg-red-100' : 'bg-emerald-100'}`}>
                          <CalendarCheck size={14} className={overdueShiftsCount > 0 ? 'text-red-600' : 'text-emerald-600'} />
                        </div>
                        <div className="text-sm font-bold text-gray-800">مراقبة الاستلام</div>
                      </div>
                      <div className="text-xl font-black text-gray-900 text-center mt-12">
                        {overdueShiftsCount > 0 ? `${overdueShiftsCount} مناوبات متأخرة` : 'لا توجد مناوبات متأخرة'}
                      </div>
                      <div className="text-xs text-gray-500 text-center mt-2">
                        {overdueShiftsCount > 0
                          ? 'يرجى متابعة ورقيات المناوبات'
                          : latestReceivedShift
                            ? `آخر استلام: ${new Date(latestReceivedShift.shiftDate).toLocaleDateString('ar-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric'
                            })}`
                            : 'لا يوجد استلام بعد'}
                      </div>
                    </div>
                  </div>
                </div>

              </div>

              {/* Shifts Snapshot Panel */}
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-gray-100 text-gray-700 flex items-center justify-center shadow-sm">
                      <CalendarCheck size={20} className="text-gray-700" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-gray-900">لوحة نظام المناوبات</h3>
                      <p className="text-xs text-gray-600">معلومات مركزة للمتابعة السريعة</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-700">
                    <div className="flex items-center gap-2">
                      <span>المناوبات غير المستلمة</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full ${overdueShiftsCount > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                      {overdueShiftsCount}
                    </span>
                  </div>
                  {overdueShiftsCount > 0 ? (
                    <div className="mt-2 space-y-2 max-h-36 overflow-y-auto pr-1">
                      {overdueShifts.map((shift) => {
                        const senior = getSeniorEmployeeForShift(shift.id);
                        return (
                          <button
                            key={shift.id}
                            type="button"
                            onClick={() => handleOpenShift(shift.shiftDate)}
                            disabled={!canOpenShift}
                            className={`w-full text-right flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition ${canOpenShift ? 'cursor-pointer hover:border-blue-200 hover:bg-blue-50' : 'cursor-default opacity-70'
                              }`}
                            title={canOpenShift ? 'فتح المناوبة' : undefined}
                          >
                            <div>
                              <div className="text-sm font-bold text-gray-900">
                                <p className="inline text-gray-500 text-xs font-normal">مناوبة يوم : </p>
                                {new Date(shift.shiftDate).toLocaleDateString('ar-US', {
                                  weekday: 'long',
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric'
                                })}
                              </div>
                              <div className="text-xs text-gray-600">
                                مسؤول المناوبة:{' '}
                                <span className="font-bold text-blue-600"> {senior ? `${senior.rank} / ${formatShiftEmployeeDisplayName(senior) || senior.name}` : 'غير محدد'}</span>  - {formatDepartmentLabel(senior?.department) || 'غير مسجل'}
                              </div>
                            </div>
                            {canOpenShift && (
                              <span className="text-xs font-bold text-blue-600"><ExternalLink className="w-5 h-5" /></span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex justify-center font-black mt-6 mb-6 text-center">
                      <span className="bg-green-100 p-2 rounded-xl mt-11"><Check size={16} className="text-green-800" /></span>&nbsp;
                      <span className="text-sm text-green-600 mt-12 mr-2">كافة المناوبات السابقة مستلمة</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Today's Shift or Latest Registered Shift - Professional Design */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="px-6 py-5 bg-gray-50 border-b border-gray-200 shadow-sm">
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] items-center gap-4">
                  <div className="flex items-center gap-4 lg:justify-self-start">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-md ${todayShift
                      ? 'bg-gradient-to-br from-blue-600 to-blue-700'
                      : 'bg-gradient-to-br from-blue-600 to-blue-700'
                      }`}>
                      <Calendar size={24} className="text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-gray-900">
                        {todayExceptional ? 'يوم استثنائي' : todayShift ? 'مناوبة اليوم الحالي' : 'آخر مناوبة مسجلة'}
                      </h3>
                    </div>
                  </div>

                  {displayShiftDate && (
                    <div className="justify-self-center">
                      <div className="inline-flex items-center gap-3 rounded-full border border-slate-200 bg-white/90 px-6 py-2 shadow-sm">
                        <div className="flex items-center gap-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50">
                            <Calendar size={16} className="text-slate-700" />
                          </span>
                          <span className="hidden sm:inline text-[11px] font-bold tracking-wide text-slate-500">
                            {todayExceptional ? 'يوم استثنائي' : todayShift ? 'مناوبة يوم' : 'تاريخ المناوبة'}
                          </span>
                        </div>
                        <span className="h-6 w-px bg-slate-200" />
                        <div className="flex items-center gap-2 sm:gap-3 whitespace-nowrap">
                          <span className="text-base sm:text-lg font-black text-blue-700">
                            {displayShiftDate.toLocaleDateString('ar-UK', {
                              weekday: 'long'
                            })}
                          </span>
                          <span className="text-slate-300">•</span>
                          <span className="text-sm sm:text-base font-bold text-blue-700">
                            {displayShiftDate.toLocaleDateString('ar-UK', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="hidden lg:block" aria-hidden="true" />
                </div>
              </div>
              <div className="pb-3">
                {displayShift ? (
                  <div className="space-y-6">
                    {/* Enhanced Shift Info Header */}
                    {/* Employees Table */}
                    {displayShiftEmployees.length > 0 && (
                      <div className="overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-100 font-bold">
                              <tr>
                                <th className="px-6 py-3 text-right text-xs uppercase tracking-wider">
                                  م
                                </th>
                                <th className="px-6 py-3 text-right text-xs uppercase tracking-wider">
                                  المسمى الوظيفي
                                </th>
                                <th className="px-6 py-3 text-right text-xs uppercase tracking-wider">
                                  الاسم
                                </th>
                                <th className="px-6 py-3 text-right text-xs uppercase tracking-wider">
                                  رقم الملف
                                </th>
                                <th className="px-6 py-3 text-right text-xs uppercase tracking-wider">
                                  رقم الهاتف
                                </th>
                                <th className="px-6 py-3 text-right text-xs uppercase tracking-wider">
                                  المسمى الوظيفي
                                </th>
                                <th className="px-6 py-3 text-right text-xs uppercase tracking-wider">
                                  الإدارة
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {sortedDisplayShiftEmployees.map((employee: Employee, index: number) => {
                                return (
                                  <tr key={employee.id} className="hover:bg-gray-100">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                                      {index + 1}
                                    </td>

                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                                      {employee.rank}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                      <div className="text-sm font-bold text-gray-900">
                                        {formatShiftEmployeeDisplayName(employee) || employee.name}
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                      {employee.fileNumber || 'غير محدد'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                      {employee.phone_number || 'غير محدد'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                      {employee.jobTitle || '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                      {formatDepartmentLabel(employee.department) || 'غير مسجل'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ) : todayExceptional ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-4">
                      <ShieldCheck size={28} />
                    </div>
                    <h3 className="text-lg font-bold text-amber-900 mb-2">يوم استثنائي</h3>
                    <p className="text-sm text-amber-700">لا يوجد مناوبة</p>
                    <p className="text-sm text-amber-700">القوة بالكامل متواجدة</p>
                    <p className="text-sm text-amber-700 mt-1">
                      السبب : <span className="font-semibold">{todayExceptional.reason || 'غير محدد'}</span>
                    </p>
                    {todayExceptional.note && (
                      <p className="text-sm text-amber-700 mt-1">
                        ملاحظات: <span className="font-semibold">{todayExceptional.note}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Calendar size={48} className="mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">لا توجد مناوبات مسجلة</h3>
                    <p className="text-gray-500">لم يتم تسجيل أي مناوبات في النظام بعد</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!hideLicenses && (
        <div className="space-y-6">
          <div className="flex items-center gap-3  mt-10">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl flex items-center justify-center shadow-sm">
              <CalendarCheck size={22} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900">ملخص الرخص والاستئذانات</h2>
              <p className="text-xs text-gray-600">متابعة رخص واستئذانات موظفي الإدارة العامة</p>
            </div>
            <div className="flex-1 h-px bg-slate-200/80" aria-hidden="true" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-3xl shadow-xl border border-slate-200/80 overflow-hidden">
              <div className="px-6 pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shadow-sm">
                      <CalendarCheck size={20} className="text-blue-600" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-gray-900">إحصائيات الرخص والاستئذانات</h3>
                      <p className="text-xs text-gray-500">ملخص للشهر الحالي والإجمالي</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-gray-500 bg-gray-100 border border-gray-200 px-2 py-1 rounded-lg">
                    {currentMonthLabel}
                  </span>
                </div>
              </div>

              <div className="px-6 pb-6 pt-4 bg-gradient-to-br from-white via-slate-50 to-white">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="relative overflow-hidden rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                    <div className="absolute -top-12 -left-12 h-32 w-32 rounded-full bg-slate-200/30 blur-2xl" />
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className="text-xs font-bold text-blue-600">الشهر الحالي</p>
                        <p className="text-3xl font-black text-blue-700">{licenseSummary.monthly.total}</p>
                      </div>
                      <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-1 rounded-lg">
                        {currentMonthLabel}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-blue-100 bg-blue-50/80 p-2 text-center">
                        <p className="text-[10px] font-semibold text-blue-600">يوم كامل</p>
                        <p className="text-lg font-black text-blue-700">{licenseSummary.monthly.fullDay}</p>
                      </div>
                      <div className="rounded-xl border border-blue-100 bg-blue-50/80 p-2 text-center">
                        <p className="text-[10px] font-semibold text-blue-600">قصير</p>
                        <p className="text-lg font-black text-blue-700">{licenseSummary.monthly.short}</p>
                      </div>
                      <div className="rounded-xl border border-blue-100 bg-blue-50/80 p-2 text-center">
                        <p className="text-[10px] font-semibold text-blue-600">طبي</p>
                        <p className="text-lg font-black text-blue-700">{licenseSummary.monthly.medical}</p>
                      </div>
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="absolute -top-12 -left-12 h-32 w-32 rounded-full bg-slate-200/30 blur-2xl" />
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className="text-xs font-bold text-slate-500">الإجمالي</p>
                        <p className="text-3xl font-black text-slate-900">{licenseSummary.total.total}</p>
                      </div>
                      <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg">
                        جميع السجلات
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-center">
                        <p className="text-[10px] font-semibold text-slate-600">يوم كامل</p>
                        <p className="text-lg font-black text-slate-700">{licenseSummary.total.fullDay}</p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-center">
                        <p className="text-[10px] font-semibold text-slate-600">قصير</p>
                        <p className="text-lg font-black text-slate-700">{licenseSummary.total.short}</p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-center">
                        <p className="text-[10px] font-semibold text-slate-600">طبي</p>
                        <p className="text-lg font-black text-slate-700">{licenseSummary.total.medical}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-xl border border-slate-200/80 overflow-hidden">
              <div className="px-6 pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-green-100 text-slate-700 flex items-center justify-center shadow-sm">
                      <Users size={18} className="text-green-700" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-gray-900">آخر الرخص والاستئذانات المسجلة</h3>
                      <p className="text-xs text-gray-500">عرض آخر التحديثات المضافة للنظام</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-gray-500 bg-gray-100 border border-gray-200 px-2 py-1 rounded-lg">
                    آخر {latestLicenses.length} سجلات
                  </span>
                </div>
              </div>

              <div className="px-6 pb-6 pt-4">
                {latestLicenses.length > 0 ? (
                  <div className="space-y-3">
                    {latestLicenses.map((license) => {
                      const licenseEmployee = license.employee;
                      const fallbackEmployee = employeeById.get(String(license.employee_id));
                      const rankLabel = licenseEmployee?.rank || fallbackEmployee?.rank || fallbackEmployee?.category || '—';
                      const nameLabel = licenseEmployee?.full_name || fallbackEmployee?.name || 'غير محدد';
                      const displayName = `${rankLabel} / ${nameLabel}`;
                      const typeLabel = formatLicenseTypeLabel(license.license_type);
                      const departmentLabel = formatDepartmentLabel(fallbackEmployee?.department) || 'غير محدد';

                      return (
                        <div key={license.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                              <CalendarCheck size={16} className="text-slate-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-900 truncate">{displayName}</p>
                              <p className="text-xs text-slate-500">
                                {formatLicenseDate(license.license_date)}
                                <span className="mx-1 text-slate-300">•</span>
                                {getTimeSince(license.created_at || license.license_date)}
                                <span className="mx-1 text-slate-300">•</span>
                                الإدارة: <span className="font-bold text-green-700">{departmentLabel}</span>
                              </p>
                            </div>
                          </div>
                          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${getLicenseTypeBadge(license.license_type)}`}>
                            {typeLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-sm text-gray-500 bg-gray-50 rounded-2xl border border-gray-200 px-4 py-6 text-center">
                    لا توجد رخص أو استئذانات مسجلة حالياً.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!hideProfessionalExtensions && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl flex items-center justify-center shadow-sm">
              <ShieldCheck size={22} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900">لوحة شؤون الموظفين</h2>
              <p className="text-xs text-gray-600">
                {hideProfessionalExtensions
                  ? 'مؤشرات الجودة والمتابعة للموظفين'
                  : 'مؤشرات الجودة والمتابعة للموظفين والتمديدات'}
              </p>
            </div>
            <div className="flex-1 h-px bg-slate-200/80" aria-hidden="true" />
          </div>

          <div className={`grid grid-cols-1 ${hideProfessionalExtensions ? 'lg:grid-cols-2' : 'lg:grid-cols-3'} gap-6`}>
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Users size={18} className="text-blue-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">جودة بيانات الموظفين</h3>
                  <p className="text-xs text-gray-600">حقول تحتاج استكمال</p>
                </div>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-gray-600">بدون إدارة</span>
                  <span className="text-sm font-bold text-slate-800">{missingDepartmentCount}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-gray-600">بدون رقم ملف</span>
                  <span className="text-sm font-bold text-slate-800">{missingFileCount}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-gray-600">بدون رقم تواصل</span>
                  <span className="text-sm font-bold text-slate-800">{missingPhoneCount}</span>
                </div>
              </div>
            </div>

            {!hideProfessionalExtensions && (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                    <CalendarCheck size={18} className="text-amber-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-gray-900">تمديدات الفنيين</h3>
                    <p className="text-xs text-gray-600">ملخص حالة التمديدات</p>
                  </div>
                </div>
                {extensionCounts ? (
                  <>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="rounded-xl border border-amber-200 bg-amber-50 py-3">
                        <div className="text-lg font-black text-amber-700">{extensionCounts.approaching}</div>
                        <div className="text-[11px] font-semibold text-amber-700">قريبة</div>
                      </div>
                      <div className="rounded-xl border border-red-200 bg-red-50 py-3">
                        <div className="text-lg font-black text-red-700">{extensionCounts.notExtended}</div>
                        <div className="text-[11px] font-semibold text-red-700">غير ممددة</div>
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 py-3">
                        <div className="text-lg font-black text-emerald-700">{extensionCounts.extended}</div>
                        <div className="text-[11px] font-semibold text-emerald-700">ممددة</div>
                      </div>
                    </div>
                    {extensionStatus?.reminderDays?.length ? (
                      <p className="mt-3 text-xs text-gray-500">
                        نافذة التذكير: {extensionStatus.reminderDays.join('، ')} يوم
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div className="text-xs text-gray-500">تعذر تحميل بيانات التمديدات حالياً.</div>
                )}
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                  <Building size={18} className="text-slate-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">أعلى الإدارات عدداً</h3>
                  <p className="text-xs text-gray-600">حسب إجمالي الموظفين</p>
                </div>
              </div>
              {topDepartments.length > 0 ? (
                <div className="space-y-2 text-sm">
                  {topDepartments.map(([department, count]) => (
                    <div key={department} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                      <span className="font-semibold text-slate-700">{department}</span>
                      <span className="text-xs font-bold text-slate-600">{count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-gray-500">لا توجد بيانات إدارات مكتملة بعد.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
