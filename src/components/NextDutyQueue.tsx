import { Fragment, useEffect, useMemo, useState } from 'react';
import { Employee, Shift, ShiftAssignment } from '../types';
import { fetchEmployees, fetchShifts, fetchShiftAssignments } from '../api';
import { AlertTriangle, Calendar, Search, Filter, X } from 'lucide-react';
import LoadingPage from './LoadingPage';
import { getRankOrder } from '../utils/rankOrder';
import { formatEmployeeDisplayName } from '../utils/employeeDisplay';
import { getSearchTokens, matchesArabicSearch } from '../utils/search';
import { formatDepartmentLabel, formatSectionLabel, normalizeOrganizationName } from '../utils/organization';

const EMPLOYEE_HISTORY_STORAGE_KEY = 'employeeShiftHistoryEmployeeId';

interface EmployeeSummary {
  employee: Employee;
  hasAnyAssignment: boolean;
  hasAnyAttendance: boolean;
  lastAttendedDate: string | null;
  lastAssignments: Array<{ date: string; note: string | null; status: 'attended' | 'absent' }>;
}

const dayInMilliseconds = 24 * 60 * 60 * 1000;

const countCalendarDaysBetween = (start: Date, end: Date) => {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (endDay.getTime() <= startDay.getTime()) return 0;
  return Math.floor((endDay.getTime() - startDay.getTime()) / dayInMilliseconds);
};

const getDaysSinceLastShift = (
  summary: EmployeeSummary,
  now = Date.now()
): number | null => {
  const lastDate = summary.lastAssignments[0]?.date;
  if (!lastDate) return null;
  const lastDateObj = new Date(lastDate);
  if (Number.isNaN(lastDateObj.getTime())) return null;
  const nowDate = new Date(now);
  const diffDays = countCalendarDaysBetween(lastDateObj, nowDate);
  return diffDays < 0 ? 0 : diffDays;
};

// تحديد أولوية الموظف للخفارة القادمة حسب الأبعد عن آخر خفارة.
function getEmployeePriority(
  s: EmployeeSummary,
  now = Date.now()
): { priority: number; reason: string; daysSinceLastShift: number | null } {
  if (!s.hasAnyAssignment) {
    return { priority: 1, reason: 'لم يُدرج مطلقاً', daysSinceLastShift: null };
  }

  const daysSinceLastShift = getDaysSinceLastShift(s, now);
  if (daysSinceLastShift !== null) {
    if (daysSinceLastShift > 10) {
      return { priority: 2, reason: `آخر خفارة منذ ${daysSinceLastShift} يوم`, daysSinceLastShift };
    }

    return { priority: 3, reason: `آخر خفارة منذ ${daysSinceLastShift} يوم`, daysSinceLastShift };
  }

  return { priority: 5, reason: 'غير محدد', daysSinceLastShift };
}

const formatDepartmentSectionLabel = (department?: string | null, section?: string | null) => {
  const deptLabel = formatDepartmentLabel(department);
  const sectionLabel = formatSectionLabel(section);
  if (!deptLabel && !sectionLabel) return 'غير مسجل';
  if (deptLabel && sectionLabel) return `${deptLabel} - ${sectionLabel}`;
  return deptLabel || sectionLabel;
};

const formatDepartmentOnlyLabel = (department?: string | null) =>
  formatDepartmentLabel(department) || 'غير مسجل';

const formatShortDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
};

const getPriorityBadge = (priority: number) => {
  switch (priority) {
    case 1:
      return { label: 'أولوية أولى', className: 'bg-red-100 text-red-700 border-red-200' };
    case 2:
      return { label: 'أولوية عالية', className: 'bg-blue-100 text-blue-700 border-blue-200' };
    case 3:
      return { label: 'أولوية متوسطة', className: 'bg-amber-100 text-amber-700 border-amber-200' };
    case 4:
      return { label: 'أولوية منخفضة', className: 'bg-orange-100 text-orange-700 border-orange-200' };
    default:
      return { label: 'غير محدد', className: 'bg-gray-100 text-gray-600 border-gray-200' };
  }
};

const sortByPriorityAndDepartment = (list: EmployeeSummary[]) => {
  const now = Date.now();
  return [...list].sort((a, b) => {
    const priorityA = getEmployeePriority(a, now);
    const priorityB = getEmployeePriority(b, now);
    if (priorityA.priority !== priorityB.priority) return priorityA.priority - priorityB.priority;

    const daysA = priorityA.daysSinceLastShift;
    const daysB = priorityB.daysSinceLastShift;
    if (daysA === null && daysB !== null) return -1;
    if (daysA !== null && daysB === null) return 1;
    if (daysA !== null && daysB !== null && daysA !== daysB) return daysB - daysA;

    const deptA = normalizeOrganizationName(a.employee.department);
    const deptB = normalizeOrganizationName(b.employee.department);
    const deptDiff = deptA.localeCompare(deptB, 'ar');
    if (deptDiff !== 0) return deptDiff;

    const rankDiff = getRankOrder(a.employee.rank, a.employee.category) - getRankOrder(b.employee.rank, b.employee.category);
    if (rankDiff !== 0) return rankDiff;
    return a.employee.name.localeCompare(b.employee.name, 'ar');
  });
};

function buildEmployeeSummaries(
  employees: Employee[],
  shifts: Shift[],
  assignments: ShiftAssignment[],
  excludedDepartments: Set<string> = new Set()
): EmployeeSummary[] {
  const activeEmployees = employees.filter(e => {
    if (e.status !== 'active' || e.includeInShifts === false) {
      return false;
    }

    // Filter professionals based on excluded departments
    if (e.category === 'مهنيين' && excludedDepartments.has(e.department)) {
      return false;
    }

    return true;
  });
  const shiftById = new Map(shifts.map(s => [s.id, s]));
  const assignmentsByEmployee = new Map<string, Array<{ date: string; note: string | null; status: 'attended' | 'absent' }>>();

  for (const a of assignments) {
    const shift = shiftById.get(a.shiftId);
    if (!shift) continue;
    const arr = assignmentsByEmployee.get(a.employeeId) || [];
    arr.push({ date: shift.shiftDate, note: a.note, status: a.status });
    assignmentsByEmployee.set(a.employeeId, arr);
  }

  const summaries: EmployeeSummary[] = activeEmployees.map(emp => {
    const hist = (assignmentsByEmployee.get(emp.id) || []).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // آخر حضور فعلي: بدون ملاحظة وstatus ليست 'absent'
    const lastAttended = hist.find(h => !h.note && h.status !== 'absent');
    const hasAnyAssignment = hist.length > 0;
    const hasAnyAttendance = !!lastAttended;

    return {
      employee: emp,
      hasAnyAssignment,
      hasAnyAttendance,
      lastAttendedDate: lastAttended ? lastAttended.date : null,
      lastAssignments: hist.slice(0, 3), // نعرض آخر 3 تعيينات
    };
  });

  return summaries;
}

export default function NextDutyQueue() {

  // =================================================================================
  // Render Functions
  // =================================================================================

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [excludeFemales, setExcludeFemales] = useState(true);
  const [excludeRecentShifts, setExcludeRecentShifts] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [selectedProfessionalGroup, setSelectedProfessionalGroup] = useState('all');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  // Local department filter for professionals
  const [excludedDepartments, setExcludedDepartments] = useState<Set<string>>(new Set());
  const [showDepartmentFilter, setShowDepartmentFilter] = useState(false);


  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [empData, shiftData, assignData] = await Promise.all([
        fetchEmployees(),
        fetchShifts(),
        fetchShiftAssignments()
      ]);
      setEmployees(empData.filter((e: Employee) => e.category !== 'مدنيين'));
      setShifts(shiftData);
      setAssignments(assignData);
    } catch (err) {
      console.error('Error loading data:', err);
      setError('فشل في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const summaries = useMemo(() => {
    if (!employees.length || !shifts.length || !assignments.length) return [];
    return buildEmployeeSummaries(employees, shifts, assignments, excludedDepartments);
  }, [employees, shifts, assignments, excludedDepartments]);

  const departmentOptions = useMemo(() => {
    return Array.from(new Set(
      summaries
        .map((summary) => formatDepartmentOnlyLabel(summary.employee.department))
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [summaries]);

  const professionalGroupOptions = useMemo(() => {
    return Array.from(new Set(
      summaries
        .filter((summary) => summary.employee.category === 'مهنيين')
        .map((summary) => summary.employee.professionalGroup || 'أخرى')
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [summaries]);

  const filteredSummaries = useMemo(() => {
    let list = summaries;
    if (selectedDepartment !== 'all') {
      list = list.filter((summary) => formatDepartmentOnlyLabel(summary.employee.department) === selectedDepartment);
    }
    if (selectedProfessionalGroup !== 'all') {
      list = list.filter((summary) =>
        summary.employee.category !== 'مهنيين' ||
        (summary.employee.professionalGroup || 'أخرى') === selectedProfessionalGroup
      );
    }
    if (excludeFemales) {
      list = list.filter((summary) => summary.employee.gender !== 'أنثى');
    }
    if (excludeRecentShifts) {
      const now = Date.now();
      list = list.filter((summary) => {
        const days = getDaysSinceLastShift(summary, now);
        return days === null || days > 10;
      });
    }
    const searchTokens = getSearchTokens(searchTerm);
    if (searchTokens.length) {
      list = list.filter((summary) => {
        const name = formatEmployeeDisplayName(summary.employee) || summary.employee.name || '';
        const fileNumber = summary.employee.fileNumber || summary.employee.militaryNumber || '';
        const departmentLabel = formatDepartmentSectionLabel(summary.employee.department, summary.employee.section);
        const rawDepartment = `${summary.employee.department || ''} ${summary.employee.section || ''}`;
        return matchesArabicSearch([
          name,
          summary.employee.name,
          summary.employee.firstName,
          summary.employee.secondName,
          summary.employee.thirdName,
          summary.employee.fourthName,
          summary.employee.familyName,
          fileNumber,
          departmentLabel,
          rawDepartment,
        ], searchTokens);
      });
    }
    return list;
  }, [summaries, selectedDepartment, selectedProfessionalGroup, excludeFemales, excludeRecentShifts, searchTerm]);

  // تجميع البيانات حسب الفئة
  const employeesByCategory = useMemo(() => {
    const officers = filteredSummaries.filter(s => s.employee.category === 'ضباط');
    const ncos = filteredSummaries.filter(s => s.employee.category === 'ضباط صف');
    const professionals = filteredSummaries.filter(s => s.employee.category === 'مهنيين');
    
    return { officers, ncos, professionals };
  }, [filteredSummaries]);

  const visibleScopeLabel = useMemo(() => {
    const departmentLabel = selectedDepartment === 'all' ? 'كل الإدارات' : selectedDepartment;
    const professionalGroupLabel = selectedProfessionalGroup === 'all' ? 'كل فئات المهنيين' : selectedProfessionalGroup;
    return `${departmentLabel} / ${professionalGroupLabel}`;
  }, [selectedDepartment, selectedProfessionalGroup]);

  const toggleCategory = (key: string) => {
    setExpandedCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleDepartmentExclusion = (department: string) => {
    setExcludedDepartments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(department)) {
        newSet.delete(department);
      } else {
        newSet.add(department);
      }
      return newSet;
    });
  };

  const goToEmployeeShiftHistory = (employee: Employee) => {
    const employeeId = String(employee?.id || '').trim();
    if (!employeeId) return;

    try {
      localStorage.setItem(EMPLOYEE_HISTORY_STORAGE_KEY, employeeId);
    } catch {}

    try {
      window.dispatchEvent(
        new CustomEvent('employee-shift-history-open', {
          detail: { employeeId, at: Date.now() },
        })
      );
    } catch {}

    window.location.hash = '#employee-shift-history';
  };

  const renderCategoryTable = (
    key: 'officers' | 'ncos' | 'professionals',
    title: string,
    description: string
  ) => {
    const list = employeesByCategory[key];
    if (!list.length) return null;

    const sorted = sortByPriorityAndDepartment(list);
    const isExpanded = expandedCategories[key] === true;
    const visible = isExpanded ? sorted : sorted.slice(0, 6);
    const remaining = sorted.length - visible.length;

    // Get unique departments for this category (without useMemo)
    const categoryDepartments = Array.from(new Set(list.map(s => s.employee.department))).sort((a, b) => a.localeCompare(b, 'ar'));

    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-slate-50 to-slate-100">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            <p className="text-xs text-gray-500 mt-1">{description}</p>
          </div>
          <div className="flex items-center gap-3">
            {key === 'professionals' && (
              <>
                <button
                  onClick={() => setShowDepartmentFilter(!showDepartmentFilter)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-all"
                >
                  <Filter size={18} />
                  فلترة الإدارات
                  {excludedDepartments.size > 0 && (
                    <span className="rounded-full bg-slate-500 px-2 py-0.5 text-xs font-bold text-white">
                      {excludedDepartments.size}
                    </span>
                  )}
                </button>
                {excludedDepartments.size > 0 && (
                  <button
                    onClick={() => setExcludedDepartments(new Set())}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 transition-all"
                  >
                    <X size={18} />
                    مسح الفلتر
                  </button>
                )}
              </>
            )}
            <div className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold">
              {sorted.length} مرشح
            </div>
          </div>
        </div>

        {key === 'professionals' && showDepartmentFilter && (
          <div className="border-b border-gray-100 bg-slate-50 p-4">
            <div className="flex flex-wrap gap-2">
              {categoryDepartments.map(dept => {
                const deptLabel = formatDepartmentOnlyLabel(dept);
                const isExcluded = excludedDepartments.has(dept);
                return (
                  <button
                    key={dept}
                    onClick={() => toggleDepartmentExclusion(dept)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${
                      isExcluded
                        ? 'bg-red-50 border-red-200 text-red-700'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {deptLabel}
                    {isExcluded && <X size={14} className="inline mr-1" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-right">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 font-bold">م</th>
                <th className="px-4 py-3 font-bold">الرتبة</th>
                <th className="px-4 py-3 font-bold">الاسم</th>
                <th className="px-4 py-3 font-bold">الإدارة</th>
                <th className="px-4 py-3 font-bold">الأولوية</th>
                <th className="px-4 py-3 font-bold">سبب الترشيح</th>
                <th className="px-4 py-3 font-bold">آخر خفارة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((summary, index) => {
                const priority = getEmployeePriority(summary, Date.now());
                const priorityBadge = getPriorityBadge(priority.priority);
                const departmentLabel = formatDepartmentOnlyLabel(summary.employee.department);
                const groupLabel = departmentLabel;
                const previous = index > 0 ? visible[index - 1] : null;
                const previousGroupLabel = previous ? formatDepartmentOnlyLabel(previous.employee.department) : '';
                const showGroupHeader = key !== 'professionals' && groupLabel !== previousGroupLabel;
                const lastShiftDate = summary.lastAssignments[0]?.date || null;
                const displayName = formatEmployeeDisplayName(summary.employee) || summary.employee.name || '—';

                return (
                  <Fragment key={summary.employee.id}>
                    {showGroupHeader && (
                      <tr key={`group-${summary.employee.id}`} className="bg-blue-50/70">
                        <td colSpan={7} className="px-4 py-2 text-right text-xs font-black text-blue-800">
                          {groupLabel}
                        </td>
                      </tr>
                    )}
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-semibold text-gray-700">{index + 1}</td>
                      <td className="px-4 py-3 text-gray-700">{summary.employee.rank || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <button
                            type="button"
                            onClick={() => goToEmployeeShiftHistory(summary.employee)}
                            className="w-fit text-right font-bold hover:text-blue-700 transition-colors"
                            title="عرض سجل خفارات الموظف"
                          >
                            {displayName}
                          </button>
                          {summary.employee.category === 'مهنيين' && summary.employee.jobTitle && (
                            <span className="text-xs text-blue-600 mt-1">{summary.employee.jobTitle}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{departmentLabel}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-[11px] font-bold border ${priorityBadge.className}`}>
                          {priorityBadge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{priority.reason}</td>
                      <td className="px-4 py-3 text-gray-700">
                        {lastShiftDate ? formatShortDate(lastShiftDate) : 'لم يسبق إدراجه'}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {sorted.length > 6 && (
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-center">
            <button
              type="button"
              onClick={() => toggleCategory(key)}
              className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-100 transition"
            >
              {isExpanded ? 'إخفاء' : `إظهار المزيد${remaining > 0 ? ` (${remaining})` : ''}`}
            </button>
          </div>
        )}
      </div>
    );
  };


  // =================================================================================
  // Render Logic
  // =================================================================================

  if (loading) {
    return <LoadingPage variant="shifts" />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 max-w-md w-full mx-4">
          <div className="flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 text-center mb-2">خطأ في التحميل</h2>
          <p className="text-gray-600 text-center mb-6">{error}</p>
          <button 
            onClick={load}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8">
      <div className="w-full px-2 sm:px-4 lg:px-6">
        {/* العنوان والمعايير */}
        <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-blue-800 rounded-2xl p-6 mb-6 text-white shadow-lg relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-300/20 to-blue-500/20 animate-pulse"></div>
          <div className="relative flex flex-col gap-4">
            <div className="flex items-center gap-6">
              <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-sm">
                <Calendar className="w-6 h-6 text-white drop-shadow-lg" />
              </div>
              <div>
                <h1 className="text-2xl font-bold drop-shadow-lg">قائمة ترشيحات الخفارة القادمة</h1>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-white/20 bg-white/10 backdrop-blur-sm cursor-pointer">
                  <span className="text-sm font-semibold text-white">استبعاد الإناث</span>
                  <span className="relative inline-flex items-center">
                    <input
                      type="checkbox"
                      checked={excludeFemales}
                      onChange={(e) => setExcludeFemales(e.target.checked)}
                      className="sr-only peer"
                    />
                    <span className="relative w-12 h-6 bg-white/30 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-white/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[5px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></span>
                  </span>
                </label>

                <label className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-white/20 bg-white/10 backdrop-blur-sm cursor-pointer">
                  <span className="text-sm font-semibold text-white">استبعاد خفارة آخر 10 أيام</span>
                  <span className="relative inline-flex items-center">
                    <input
                      type="checkbox"
                      checked={excludeRecentShifts}
                      onChange={(e) => setExcludeRecentShifts(e.target.checked)}
                      className="sr-only peer"
                    />
                    <span className="relative w-12 h-6 bg-white/30 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-white/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[5px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></span>
                  </span>
                </label>
              </div>

              <div className="relative w-full lg:w-80">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70" size={18} />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="ابحث بالاسم أو رقم الملف أو الإدارة..."
                  className="w-full pr-9 pl-4 py-2.5 rounded-xl border border-white/20 bg-white/10 text-white placeholder-white/60 focus:outline-none focus:ring-4 focus:ring-white/20"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto] lg:items-end">
              <label className="space-y-2">
                <span className="block text-xs font-bold text-blue-100">الإدارة المطلوبة</span>
                <select
                  value={selectedDepartment}
                  onChange={(event) => setSelectedDepartment(event.target.value)}
                  className="h-11 w-full rounded-xl border border-white/20 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:ring-4 focus:ring-white/25"
                >
                  <option value="all">كل الإدارات</option>
                  {departmentOptions.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="block text-xs font-bold text-blue-100">فئة المهنيين</span>
                <select
                  value={selectedProfessionalGroup}
                  onChange={(event) => setSelectedProfessionalGroup(event.target.value)}
                  className="h-11 w-full rounded-xl border border-white/20 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:ring-4 focus:ring-white/25"
                >
                  <option value="all">كل فئات المهنيين</option>
                  {professionalGroupOptions.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => {
                  setSelectedDepartment('all');
                  setSelectedProfessionalGroup('all');
                  setSearchTerm('');
                }}
                className="h-11 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/20"
              >
                عرض الكل
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-blue-50">
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">
                نطاق العرض: {visibleScopeLabel}
              </span>
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">
                النتائج: {filteredSummaries.length}
              </span>
            </div>
          </div>
        </div>
        
        {/* قوائم عرض الموظفين */}
        <div className="space-y-8">
          {filteredSummaries.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
              <div className="text-lg font-black text-slate-800">لا توجد نتائج مطابقة</div>
              <div className="mt-2 text-sm font-semibold text-slate-500">
                غيّر الإدارة أو فئة المهنيين أو ألغِ فلاتر الاستبعاد لعرض الوضع الحالي.
              </div>
            </div>
          )}
          {renderCategoryTable('officers', 'الضباط', 'مرشحون من فئة الضباط حسب الترتيب الوظيفي')}
          {renderCategoryTable('ncos', 'ضباط الصف', 'مرشحون من فئة ضباط الصف حسب الترتيب الوظيفي')}
          {renderCategoryTable('professionals', 'المهنيين', 'مرشحون من فئة المهنيين حسب الأبعد عن آخر خفارة')}
        </div>
      </div>
    </div>
  );
}
