import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, FileText, Info, Search, UserRound, X, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { arSA } from 'date-fns/locale';

import { fetchEmployees, fetchShiftAssignments, fetchShifts } from '../api';
import type { Employee, Shift, ShiftAssignment } from '../types';
import LoadingPage from './LoadingPage';
import { formatShiftEmployeeDisplayName } from '../utils/employeeDisplay';
import { formatDepartmentLabel, formatSectionLabel } from '../utils/organization';
import { getCategoryOrder, getRankOrder } from '../utils/rankOrder';

const EMPLOYEE_HISTORY_STORAGE_KEY = 'employeeShiftHistoryEmployeeId';

type EmployeeShiftRecord = {
  shift: Shift;
  assignment: ShiftAssignment;
};

type MonthGroup = {
  month: number;
  monthKey: string;
  monthLabel: string;
  records: EmployeeShiftRecord[];
};

type YearGroup = {
  year: number;
  months: MonthGroup[];
};

const compareEmployeesByPriority = (left: Employee, right: Employee) => {
  const categoryDiff = getCategoryOrder(left.category) - getCategoryOrder(right.category);
  if (categoryDiff !== 0) return categoryDiff;

  const isOfficerCategory = left.category === 'ضباط' || left.category === 'ضباط صف';
  if (isOfficerCategory) {
    const rankDiff = getRankOrder(left.rank, left.category) - getRankOrder(right.rank, right.category);
    if (rankDiff !== 0) return rankDiff;
  }

  const leftSeniority = left.seniorityNumber ? Number(left.seniorityNumber) : Number.POSITIVE_INFINITY;
  const rightSeniority = right.seniorityNumber ? Number(right.seniorityNumber) : Number.POSITIVE_INFINITY;
  if (leftSeniority !== rightSeniority) return leftSeniority - rightSeniority;

  return (left.name || '').localeCompare(right.name || '', 'ar', { sensitivity: 'base' });
};

const normalizeArabic = (input: string) => {
  if (!input) return '';
  return input
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[ٱإأآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
    .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

const getShiftRelationKey = (shiftDateValue: string): 'past' | 'today' | 'future' | 'unknown' => {
  const shiftDate = new Date(shiftDateValue);
  if (Number.isNaN(shiftDate.getTime())) return 'unknown';

  const shiftOnlyDate = new Date(shiftDate.getFullYear(), shiftDate.getMonth(), shiftDate.getDate());
  const now = new Date();
  const todayOnlyDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (shiftOnlyDate.getTime() === todayOnlyDate.getTime()) return 'today';
  if (shiftOnlyDate.getTime() < todayOnlyDate.getTime()) return 'past';
  return 'future';
};

const EmployeeShiftHistory: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [employeesData, shiftsData, assignmentsData] = await Promise.all([
          fetchEmployees(),
          fetchShifts(),
          fetchShiftAssignments(),
        ]);
        setEmployees(employeesData);
        setShifts(shiftsData);
        setAssignments(assignmentsData);
      } catch (loadError) {
        console.error('Failed to load employee shift history data:', loadError);
        setError('تعذر تحميل سجل الخفارات حالياً');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  useEffect(() => {
    try {
      const fromStorage = localStorage.getItem(EMPLOYEE_HISTORY_STORAGE_KEY) || '';
      if (fromStorage) {
        setSelectedEmployeeId(fromStorage);
      }
    } catch (storageError) {
      console.error('Failed to read employee shift history key:', storageError);
    }

    const onOpenHistory = (event: Event) => {
      const customEvent = event as CustomEvent;
      const employeeId = String(customEvent?.detail?.employeeId || '').trim();
      if (!employeeId) return;

      setSelectedEmployeeId(employeeId);
      try {
        localStorage.setItem(EMPLOYEE_HISTORY_STORAGE_KEY, employeeId);
      } catch {}
    };

    window.addEventListener('employee-shift-history-open', onOpenHistory as EventListener);
    return () => window.removeEventListener('employee-shift-history-open', onOpenHistory as EventListener);
  }, []);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const eligibleEmployeeIds = useMemo(() => {
    const validShiftIds = new Set(shifts.map((shift) => shift.id));
    const ids = new Set<string>();

    assignments.forEach((assignment) => {
      if (validShiftIds.has(assignment.shiftId)) {
        ids.add(assignment.employeeId);
      }
    });

    return ids;
  }, [assignments, shifts]);

  const eligibleEmployees = useMemo(
    () => employees.filter((employee) => eligibleEmployeeIds.has(employee.id)),
    [employees, eligibleEmployeeIds]
  );

  useEffect(() => {
    if (loading || !selectedEmployeeId) return;
    if (employees.some((employee) => employee.id === selectedEmployeeId)) return;

    setSelectedEmployeeId('');
    try {
      localStorage.removeItem(EMPLOYEE_HISTORY_STORAGE_KEY);
    } catch {}
  }, [employees, loading, selectedEmployeeId]);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId]
  );

  const employeeSearchResults = useMemo(() => {
    const query = normalizeArabic(employeeSearchTerm);
    if (!query) return [];

    const tokens = query.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];

    return eligibleEmployees
      .filter((employee) => {
        const haystack = normalizeArabic(
          `${employee.name || ''} ${employee.rank || ''} ${employee.fileNumber || ''}`
        );
        return tokens.every((token) => haystack.includes(token));
      })
      .sort(compareEmployeesByPriority)
      .slice(0, 15);
  }, [employeeSearchTerm, eligibleEmployees]);

  const employeeRecords = useMemo<EmployeeShiftRecord[]>(() => {
    if (!selectedEmployeeId) return [];
    const shiftMap = new Map(shifts.map((shift) => [shift.id, shift] as const));

    return assignments
      .filter((assignment) => assignment.employeeId === selectedEmployeeId)
      .map((assignment) => {
        const shift = shiftMap.get(assignment.shiftId);
        if (!shift) return null;
        return { assignment, shift };
      })
      .filter((record): record is EmployeeShiftRecord => Boolean(record))
      .sort(
        (left, right) =>
          new Date(right.shift.shiftDate).getTime() - new Date(left.shift.shiftDate).getTime()
      );
  }, [assignments, selectedEmployeeId, shifts]);

  const historicalRecords = useMemo(
    () =>
      employeeRecords.filter((record) => {
        const relation = getShiftRelationKey(record.shift.shiftDate);
        return relation === 'past';
      }),
    [employeeRecords]
  );

  const upcomingRecords = useMemo(
    () =>
      employeeRecords
        .filter((record) => {
          const relation = getShiftRelationKey(record.shift.shiftDate);
          return relation === 'today' || relation === 'future';
        })
        .sort(
          (left, right) =>
            new Date(left.shift.shiftDate).getTime() - new Date(right.shift.shiftDate).getTime()
        ),
    [employeeRecords]
  );

  const shiftLeadByShiftId = useMemo(() => {
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee] as const));
    const leadMap = new Map<string, Employee>();

    assignments.forEach((assignment) => {
      const employee = employeeMap.get(assignment.employeeId);
      if (!employee) return;

      const currentLead = leadMap.get(assignment.shiftId);
      if (!currentLead || compareEmployeesByPriority(employee, currentLead) < 0) {
        leadMap.set(assignment.shiftId, employee);
      }
    });

    return leadMap;
  }, [assignments, employees]);

  const summary = useMemo(() => {
    const total = historicalRecords.length;
    const absent = historicalRecords.filter(
      (record) => record.assignment.status === 'absent' || Boolean(record.assignment.note?.trim())
    ).length;
    const attended = Math.max(total - absent, 0);
    const monthKeys = new Set(
      historicalRecords.map((record) => {
        const date = new Date(record.shift.shiftDate);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      })
    );
    const activeMonths = monthKeys.size;
    const monthlyAverage = activeMonths ? total / activeMonths : 0;
    const attendanceRate = total ? (attended / total) * 100 : 0;
    const absenceRate = total ? (absent / total) * 100 : 0;

    return {
      total,
      attended,
      absent,
      activeMonths,
      monthlyAverage,
      attendanceRate,
      absenceRate,
    };
  }, [historicalRecords]);

  const groupedRecords = useMemo<YearGroup[]>(() => {
    const groups = new Map<number, Map<number, EmployeeShiftRecord[]>>();

    historicalRecords.forEach((record) => {
      const date = new Date(record.shift.shiftDate);
      if (Number.isNaN(date.getTime())) return;

      const year = date.getFullYear();
      const month = date.getMonth() + 1;

      if (!groups.has(year)) {
        groups.set(year, new Map<number, EmployeeShiftRecord[]>());
      }
      const yearMap = groups.get(year)!;

      if (!yearMap.has(month)) {
        yearMap.set(month, []);
      }
      yearMap.get(month)!.push(record);
    });

    return Array.from(groups.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([year, monthsMap]) => ({
        year,
        months: Array.from(monthsMap.entries())
          .sort((a, b) => b[0] - a[0])
          .map(([month, records]) => ({
            month,
            monthKey: `${year}-${String(month).padStart(2, '0')}`,
            monthLabel: format(new Date(year, month - 1, 1), 'MMMM', { locale: arSA }),
            records,
          })),
      }));
  }, [historicalRecords]);

  const formatRate = (value: number) => `${value.toFixed(1)}%`;

  const getShiftRelativeStatus = (shiftDateValue: string) => {
    const relationKey = getShiftRelationKey(shiftDateValue);

    if (relationKey === 'unknown') {
      return { key: 'unknown' as const, label: 'غير محدد', className: 'bg-slate-50 text-slate-700 border-slate-200' };
    }
    if (relationKey === 'today') {
      return { key: 'today' as const, label: 'خفارة اليوم', className: 'bg-blue-50 text-blue-700 border-blue-200' };
    }
    if (relationKey === 'past') {
      return { key: 'past' as const, label: 'خفارة سابقة', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    }
    return { key: 'future' as const, label: 'خفارة قادمة', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  };

  const goToShiftDay = (shiftDate: string) => {
    const dateKey = shiftDate.split('T')[0] || shiftDate;
    try {
      localStorage.setItem('quickSearchDate', dateKey);
    } catch {}
    window.location.hash = '#view-shifts';
    try {
      window.dispatchEvent(new CustomEvent('quick-search-date', { detail: { date: dateKey } }));
    } catch {}
  };

  if (loading) {
    return <LoadingPage variant="shifts" title="جاري تحميل سجل خفارات الموظف" />;
  }

  const handleSelectEmployee = (employee: Employee) => {
    setSelectedEmployeeId(employee.id);
    setEmployeeSearchTerm('');
    setIsSearchOpen(false);
    try {
      localStorage.setItem(EMPLOYEE_HISTORY_STORAGE_KEY, employee.id);
    } catch {}
  };

  const isSelectedEmployeeExcludedFromShifts = selectedEmployee?.includeInShifts === false;

  return (
    <div className="min-h-screen p-4 space-y-6" dir="rtl">
      <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <Search className="w-4 h-4 text-blue-600" />
          <h3 className="text-base font-black text-slate-800">البحث</h3>
        </div>

        <div ref={searchContainerRef} className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={employeeSearchTerm}
            onChange={(event) => {
              setEmployeeSearchTerm(event.target.value);
              setIsSearchOpen(true);
            }}
            onFocus={() => setIsSearchOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && employeeSearchResults.length > 0) {
                event.preventDefault();
                handleSelectEmployee(employeeSearchResults[0]);
              }
            }}
            placeholder="أدخل الإسم أو الرتبة أو رقم الملف..."
            className="w-full rounded-xl border border-slate-300 bg-white pr-10 pl-10 py-3 text-sm text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          {employeeSearchTerm && (
            <button
              type="button"
              onClick={() => {
                setEmployeeSearchTerm('');
                setIsSearchOpen(false);
              }}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              title="مسح البحث"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {isSearchOpen && (
            <div className="absolute z-40 mt-2 w-full rounded-xl border border-slate-200 bg-white shadow-xl max-h-72 overflow-auto">
              {!employeeSearchTerm.trim() ? (
                <div className="p-4 text-sm text-slate-500">ابدأ بكتابة الاسم أو الرتبة أو رقم الملف...</div>
              ) : employeeSearchResults.length === 0 ? (
                <div className="p-4 text-sm text-slate-500">لا توجد نتائج مطابقة.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {employeeSearchResults.map((employee) => (
                    <button
                      key={employee.id}
                      type="button"
                      onClick={() => handleSelectEmployee(employee)}
                      className="w-full text-right px-4 py-3 hover:bg-slate-50 transition-colors"
                    >
                      <div className="text-sm font-black text-slate-800">
                        {employee.rank ? `${employee.rank} / ${formatShiftEmployeeDisplayName(employee) || employee.name}` : (formatShiftEmployeeDisplayName(employee) || employee.name)}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        رقم الملف: {employee.fileNumber || 'غير متوفر'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {error}
        </div>
      )}

      {!selectedEmployee && (
        <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-10 text-center">
          <UserRound className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-xl font-bold text-slate-800">لم يتم تحديد موظف للسجل</h3>
          <p className="text-sm text-slate-500 mt-2">
            افتح سجل الخفارات من البحث في الهيدر أو من كشف الخفارات عبر الضغط على اسم الموظف.
          </p>
        </div>
      )}

      {selectedEmployee && isSelectedEmployeeExcludedFromShifts && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-10 text-center">
          <Info className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h3 className="text-xl font-bold text-slate-800">هذا الموظف غير مدرج بالخفارات</h3>
          <p className="text-sm text-slate-600 mt-2">
            الموظف المحدد حالياً لا يتم إدراجه ضمن الخفارات، لذلك تم إخفاء جميع أقسام السجل.
          </p>
        </div>
      )}

      {selectedEmployee && !isSelectedEmployeeExcludedFromShifts && (
        <>
          <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-r from-blue-50 via-white to-blue-50 shadow-sm p-5">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <UserRound className="w-6 h-6" />
              </div>
              <div>
                <p className="text-md font-bold text-blue-700">سجل خفارات</p>
                <h2 className="text-3xl font-black text-slate-900 mt-3 mb-5">
                 {selectedEmployee.rank
                    ? `${selectedEmployee.rank} / ${formatShiftEmployeeDisplayName(selectedEmployee) || selectedEmployee.name}`
                    : formatShiftEmployeeDisplayName(selectedEmployee) || selectedEmployee.name}
                </h2>
                <p className="text-sm text-slate-600 mt-1">هذه الصفحة تعرض سجل خفارات هذا الموظف فقط.</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-bold text-slate-500">الإدارة / القسم</p>
                <p className="text-base font-black text-slate-800 mt-1">
                  {formatDepartmentLabel(selectedEmployee.department) || 'غير محدد'} - <span className="text-md text-green-600 font-bold">{formatSectionLabel(selectedEmployee.section) || 'غير محدد'}</span>
                </p>
                <p className="text-xs font-semibold text-slate-600 mt-1">
                  
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-bold text-slate-500">المسمى الوظيفي</p>
                <p className="text-base font-black text-slate-800 mt-1">
                  {selectedEmployee.jobTitle?.trim() || 'غير محدد'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-bold text-slate-500">رقم الملف</p>
                <p className="text-base font-black text-slate-800 mt-1">
                  {selectedEmployee.fileNumber || 'غير متوفر'}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-blue-200 bg-blue-50 shadow-sm p-4">
              <p className="text-xs text-blue-700 font-semibold">معدل الخفارات الشهري</p>
              <p className="text-3xl font-black text-blue-900 mt-2">{summary.monthlyAverage.toFixed(2)}</p>
              <p className="text-xs text-blue-700 mt-1">على {summary.activeMonths} شهر مسجل</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 shadow-sm p-4">
              <p className="text-xs text-emerald-700 font-semibold">نسبة الحضور</p>
              <p className="text-3xl font-black text-emerald-900 mt-2">{formatRate(summary.attendanceRate)}</p>
              <p className="text-xs text-emerald-700 mt-1">{summary.attended} من {summary.total}</p>
            </div>
            <div className="rounded-2xl border border-red-200 bg-red-50 shadow-sm p-4">
              <p className="text-xs text-red-700 font-semibold">نسبة عدم الحضور / الملاحظات</p>
              <p className="text-3xl font-black text-red-900 mt-2">{formatRate(summary.absenceRate)}</p>
              <p className="text-xs text-red-700 mt-1">{summary.absent} من {summary.total}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 shadow-sm p-4">
              <p className="text-xs text-slate-700 font-semibold">إجمالي الخفارات</p>
              <p className="text-3xl font-black text-slate-900 mt-2">{summary.total}</p>
              <p className="text-xs text-slate-600 mt-1">ضمن {summary.activeMonths} شهر</p>
            </div>
          </div>

          {upcomingRecords.length > 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-white shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-emerald-200 bg-emerald-50/70 flex items-center justify-between">
                <h3 className="text-lg font-black text-emerald-900">الخفارات القادمة</h3>
                <span className="text-xs font-bold text-emerald-700 bg-white border border-emerald-200 px-3 py-1 rounded-full">
                  {upcomingRecords.length} خفارة
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-[760px] w-full">
                  <thead className="bg-emerald-50 border-b border-emerald-100">
                    <tr>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-700">م</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-700">اليوم</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-700">التاريخ</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-700">عنوان الخفارة</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-700">مسؤول الخفارة</th>
                      <th className="px-4 py-3 text-center text-xs font-bold text-slate-700">إجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {upcomingRecords.map((record, index) => {
                      const shiftDate = new Date(record.shift.shiftDate);
                      const rawShiftTitle = record.shift.title?.trim() || '';
                      const shiftTitle = rawShiftTitle || '-';
                      const hasShiftTitle = Boolean(rawShiftTitle);
                      const shiftLead = shiftLeadByShiftId.get(record.shift.id);
                      const shiftLeadLabel = shiftLead
                        ? `${shiftLead.rank || 'بدون رتبة'} / ${formatShiftEmployeeDisplayName(shiftLead) || shiftLead.name}`
                        : 'غير محدد';

                      return (
                        <tr key={record.assignment.id} className="hover:bg-emerald-50/40 transition-colors">
                          <td className="px-4 py-3 text-sm font-bold text-slate-900">{index + 1}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-slate-700">
                            {format(shiftDate, 'EEEE', { locale: arSA })}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-slate-700">
                            {format(shiftDate, 'yyyy/MM/dd')}
                          </td>
                          <td className={`px-4 py-3 text-sm ${hasShiftTitle ? 'font-bold text-blue-700' : 'font-semibold text-slate-500'}`}>
                            {shiftTitle}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700 font-semibold">{shiftLeadLabel}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => goToShiftDay(record.shift.shiftDate)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 transition-colors"
                            >
                              <ArrowUpRight className="w-3.5 h-3.5" />
                              عرض الخفارة
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}


          <div className="space-y-4">
            {groupedRecords.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-10 text-center">
                <Info className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                <h4 className="text-lg font-bold text-slate-800">لا توجد خفارات سابقة لهذا الموظف</h4>
                <p className="text-sm text-slate-500 mt-2">لم يتم العثور على أي سجل خفارة قبل اليوم.</p>
              </div>
            )}

            {groupedRecords.map((yearGroup) => {
              const yearTotalCount = yearGroup.months
                .flatMap((month) => month.records)
                .length;
              const yearAttendedCount = yearGroup.months
                .flatMap((month) => month.records)
                .filter((record) => {
                  const noteText = record.assignment.note?.trim() || '';
                  return record.assignment.status !== 'absent' && !noteText;
                })
                .length;

              return (
                <div key={yearGroup.year} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-100 to-slate-50">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-black text-slate-800">سنة {yearGroup.year}</h3>
                      <span className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
                        داوم {yearAttendedCount} من أصل {yearTotalCount} خفارة
                      </span>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-[980px] w-full">
                      <thead className="bg-gradient-to-r from-slate-100 to-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3 text-right text-xs font-bold text-slate-700">م</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-slate-700">اليوم</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-slate-700">التاريخ</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-slate-700">الحالة</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-slate-700">الملاحظة</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-slate-700">عنوان الخفارة</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-slate-700">مسؤول الخفارة</th>
                          <th className="px-4 py-3 text-center text-xs font-bold text-slate-700">إجراء</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {yearGroup.months.map((monthGroup) => (
                          <React.Fragment key={monthGroup.monthKey}>
                            <tr className="bg-slate-50/70">
                              <td colSpan={8} className="px-4 py-3 border-y border-slate-200">
                                <div className="flex items-center justify-between">
                                  <h4 className="text-sm font-black text-blue-800">
                                    {monthGroup.monthLabel} {yearGroup.year}
                                  </h4>
                                  <span className="text-xs font-bold text-slate-600 bg-white border border-slate-200 px-3 py-1 rounded-full">
                                    {monthGroup.records.length} خفارة
                                  </span>
                                </div>
                              </td>
                            </tr>
                            {monthGroup.records.map((record, index) => {
                              const shiftDate = new Date(record.shift.shiftDate);
                              const noteText = record.assignment.note?.trim() || '';
                              const hasNote = Boolean(noteText);
                              const isAbsent = record.assignment.status === 'absent' || hasNote;
                              const rawShiftTitle = record.shift.title?.trim() || '';
                              const shiftTitle = rawShiftTitle || '-';
                              const hasShiftTitle = Boolean(rawShiftTitle);
                              const shiftLead = shiftLeadByShiftId.get(record.shift.id);
                              const shiftLeadLabel = shiftLead
                                ? `${shiftLead.rank || 'بدون رتبة'} / ${formatShiftEmployeeDisplayName(shiftLead) || shiftLead.name}`
                                : 'غير محدد';
                              const shiftRelativeStatus = getShiftRelativeStatus(record.shift.shiftDate);
                              const statusLabel = isAbsent
                                ? 'يوجد ملاحظة'
                                : shiftRelativeStatus.key === 'past'
                                  ? 'داوم'
                                  : shiftRelativeStatus.key === 'today'
                                    ? 'اليوم'
                                    : shiftRelativeStatus.key === 'future'
                                      ? 'قادمة'
                                      : 'غير محدد';
                              const statusClassName = isAbsent
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : shiftRelativeStatus.key === 'past'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : shiftRelativeStatus.key === 'today'
                                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                                    : 'bg-slate-50 text-slate-700 border-slate-200';

                              return (
                                <tr key={record.assignment.id} className="hover:bg-slate-50/70 transition-colors">
                                  <td className="px-4 py-3 text-sm font-bold text-slate-900">{index + 1}</td>
                                  <td className="px-4 py-3 text-sm font-semibold text-slate-700">
                                    {format(shiftDate, 'EEEE', { locale: arSA })}
                                  </td>
                                  <td className="px-4 py-3 text-sm font-semibold text-slate-700">
                                    {format(shiftDate, 'yyyy/MM/dd')}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${statusClassName}`}>
                                      {isAbsent ? <XCircle className="w-3.5 h-3.5" /> : shiftRelativeStatus.key === 'past' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Info className="w-3.5 h-3.5" />}
                                      {statusLabel}
                                    </span>
                                  </td>
                                  <td className={`px-4 py-3 text-sm ${hasNote ? 'font-bold text-red-700' : 'font-semibold text-slate-500'}`}>
                                    {hasNote ? noteText : '-'}
                                  </td>
                                  <td className={`px-4 py-3 text-sm ${hasShiftTitle ? 'font-bold text-blue-700' : 'font-semibold text-slate-500'}`}>
                                    {shiftTitle}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-slate-700 font-semibold">{shiftLeadLabel}</td>
                                  <td className="px-4 py-3 text-center">
                                    <button
                                      onClick={() => goToShiftDay(record.shift.shiftDate)}
                                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 transition-colors"
                                    >
                                      <ArrowUpRight className="w-3.5 h-3.5" />
                                      عرض الخفارة
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default EmployeeShiftHistory;
