import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MagnifyingGlassIcon,
  ClockIcon,
  XMarkIcon,
  Bars3Icon,
  CalendarIcon,
  ClipboardDocumentListIcon,
  DocumentTextIcon,
  EyeIcon,
  PhoneIcon,
  BuildingOffice2Icon,
  BriefcaseIcon,
  NoSymbolIcon,
} from '@heroicons/react/24/solid';
import { fetchEmployees, fetchShiftAssignments, fetchShifts, fetchLicenses } from '../api';
import type { Employee, Shift, ShiftAssignment } from '../types';
import { getCategoryOrder, getRankOrder } from '../utils/rankOrder';
import { formatEmployeeDisplayName } from '../utils/employeeDisplay';
import { formatDepartmentLabel, formatSectionLabel } from '../utils/organization';
import { useSystem } from '../contexts/SystemContext';
import NotificationDropdown from './NotificationDropdown';
import EmployeeModal from './EmployeeModal';
import { APP_SOFT_REFRESH_EVENT } from '../constants/events';

interface HeaderProps {
  onPageChange: (page: string) => void;
  onToggleSidebar: () => void;
}

const EMPLOYEE_HISTORY_STORAGE_KEY = 'employeeShiftHistoryEmployeeId';
const AUTO_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
type HeaderLicenseInfo = { id?: string; type: string; date: string; hours?: number | null; permissionTime?: string | null };

export default function Header({ onPageChange, onToggleSidebar }: HeaderProps) {
  const { hideShifts, hideLicenses } = useSystem();
  const [currentDateTime, setCurrentDateTime] = useState(new Date());
  const searchInputRef = useRef<HTMLInputElement>(null);

  // States
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [quickSearchDate, setQuickSearchDate] = useState('');
  const [isQuickSearchOpen, setIsQuickSearchOpen] = useState(false);
  const [lastShiftDate, setLastShiftDate] = useState<string>('');
  const debounceTimerRef = useRef<number | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Live search data
  const [allEmployees, setAllEmployees] = useState<Employee[] | null>(null);
  const [allAssignments, setAllAssignments] = useState<ShiftAssignment[] | null>(null);
  const [allShifts, setAllShifts] = useState<Shift[] | null>(null);
  const [licenseByEmployee, setLicenseByEmployee] = useState<Record<string, HeaderLicenseInfo>>({});
  const [isResultsOpen, setIsResultsOpen] = useState(false);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [results, setResults] = useState<Array<{
    employee: Employee;
    upcoming: Shift[];
    past: Shift[];
    licenseInfo?: HeaderLicenseInfo | null;
  }>>([]);
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Close quick search when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const el = event.target as Element;
      if (isQuickSearchOpen && !el.closest('.quick-search-container')) {
        setIsQuickSearchOpen(false);
      }
      if (isResultsOpen && searchContainerRef.current && !searchContainerRef.current.contains(el)) {
        setSearchQuery('');
        setResults([]);
        setIsResultsOpen(false);
        setIsSearchFocused(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isQuickSearchOpen, isResultsOpen]);

  const formatDateForInput = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  const getLatestShiftDate = useCallback((shifts: Array<{ shiftDate: string }>) => {
    const sorted = shifts
      .filter((shift) => !Number.isNaN(new Date(shift.shiftDate).getTime()))
      .sort((a, b) => new Date(b.shiftDate).getTime() - new Date(a.shiftDate).getTime());
    const latestShift = sorted[0];
    if (!latestShift) return '';
    return formatDateForInput(new Date(latestShift.shiftDate));
  }, []);

  const refreshLastShiftDate = useCallback(async () => {
    if (hideShifts) {
      setLastShiftDate('');
      return;
    }
    try {
      const shiftsData = await fetchShifts();
      if (Array.isArray(shiftsData) && shiftsData.length > 0) {
        const latestDate = getLatestShiftDate(shiftsData);
        setLastShiftDate(latestDate);
        localStorage.setItem('shifts', JSON.stringify(shiftsData));
        return;
      }
      setLastShiftDate('');
    } catch (error) {
      console.error('Error fetching last shift date:', error);
      try {
        const storedShifts = localStorage.getItem('shifts');
        if (storedShifts) {
          const shifts: Array<{ shiftDate: string }> = JSON.parse(storedShifts);
          const latestDate = getLatestShiftDate(shifts);
          if (latestDate) {
            setLastShiftDate(latestDate);
            return;
          }
        }
      } catch (storageError) {
        console.error('Error reading local shifts cache:', storageError);
      }
      setLastShiftDate('');
    }
  }, [getLatestShiftDate, hideShifts]);

  const dispatchSoftRefresh = useCallback((source: 'manual' | 'auto' | 'focus') => {
    try {
      window.dispatchEvent(
        new CustomEvent(APP_SOFT_REFRESH_EVENT, {
          detail: { source, at: Date.now() },
        })
      );
    } catch { }
  }, []);

  const clearHeaderSearchCaches = useCallback(() => {
    setAllEmployees(null);
    setAllAssignments(null);
    setAllShifts(null);
    setLicenseByEmployee({});
  }, []);

  const runSoftRefresh = useCallback(
    async (source: 'manual' | 'auto' | 'focus') => {
      await refreshLastShiftDate();
      clearHeaderSearchCaches();
      dispatchSoftRefresh(source);
    },
    [clearHeaderSearchCaches, dispatchSoftRefresh, refreshLastShiftDate]
  );

  useEffect(() => {
    void refreshLastShiftDate();

    const handleStorageChange = () => {
      void refreshLastShiftDate();
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [refreshLastShiftDate]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void runSoftRefresh('auto');
    }, AUTO_REFRESH_INTERVAL_MS);

    const handleFocus = () => {
      void runSoftRefresh('focus');
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [runSoftRefresh]);

  // Time parts for custom Arabic period label (صباحاً/مساءً) and hh:mm format
  const getTimeParts = (date: Date) => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const period = hours < 12 ? 'صباحاً' : 'مساءً';
    const h12 = hours % 12 || 12;
    const time = `${String(h12).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    return { time, period };
  };

  // Normalize Arabic text for robust search comparisons
  const normalizeArabic = (input: string): string => {
    if (!input) return '';
    return input
      // Remove diacritics (tashkeel)
      .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
      // Remove tatweel
      .replace(/\u0640/g, '')
      // Normalize Alef forms to bare Alef
      .replace(/[ٱإأآا]/g, 'ا')
      // Normalize Ta Marbuta to Ha
      .replace(/ة/g, 'ه')
      // Normalize Ya variants
      .replace(/ى/g, 'ي')
      // Normalize Hamza-on-carrier letters
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      // Normalize Arabic-Indic digits to Latin
      .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
      .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48))
      // Collapse spaces and lowercase
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };

  const resetHeaderSearch = () => {
    setSearchQuery('');
    setResults([]);
    setIsResultsOpen(false);
    setIsSearchFocused(false);
  };

  const triggerEmployeeSearch = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    try {
      localStorage.setItem('employeeSearchTerm', trimmed);
      localStorage.setItem('employeeSearchAt', String(Date.now()));
    } catch (err) {
      // ignore storage errors
    }
    try {
      const evt = new CustomEvent('employee-search', { detail: { term: trimmed, at: Date.now() } });
      window.dispatchEvent(evt);
    } catch { }
    resetHeaderSearch();
    onPageChange('employees');
    searchInputRef.current?.blur();
  };

  const getEmployeePrimaryIdentifier = (employee: Employee) => {
    const isCivilian = String(employee.category || '').includes('إداري') || employee.rank === 'إداري';
    const value = isCivilian
      ? (employee.civilId || employee.fileNumber || employee.militaryNumber || '')
      : (employee.fileNumber || employee.militaryNumber || employee.civilId || '');
    return {
      label: isCivilian ? 'الرقم المدني' : 'رقم الملف',
      value: value || 'لا يوجد',
    };
  };

  const jumpToEmployee = (employee: Employee) => {
    if (employee.status === 'inactive') {
      resetHeaderSearch();
      openEmployeeModal(employee);
      searchInputRef.current?.blur();
      return;
    }
    const categoryLabel = String(employee.category || '');
    const showCivilians = categoryLabel.includes('إداري');
    try {
      localStorage.setItem('employeeHighlightId', employee.id);
      localStorage.setItem('employeeHighlightAt', String(Date.now()));
      localStorage.setItem('employeeHighlightClearSearch', 'true');
      if (showCivilians) {
        localStorage.setItem('employeeHighlightShowCivilians', 'true');
      } else {
        localStorage.removeItem('employeeHighlightShowCivilians');
      }
    } catch { }
    try {
      const evt = new CustomEvent('employee-search', {
        detail: { highlightId: employee.id, clearSearch: true, showCivilians, at: Date.now() }
      });
      window.dispatchEvent(evt);
    } catch { }
    resetHeaderSearch();
    onPageChange('employees');
    searchInputRef.current?.blur();
  };

  const jumpToLicense = (licenseInfo: { id?: string; type?: string; date?: string } | null, employee: Employee) => {
    if (!licenseInfo || !employee) return;
    const licenseId = licenseInfo.id ? String(licenseInfo.id) : '';
    const licenseDate = licenseInfo.date || '';
    try {
      if (licenseId) {
        localStorage.setItem('licenseHighlightId', licenseId);
      }
      localStorage.setItem('licenseHighlightEmployeeId', String(employee.id));
      if (licenseDate) {
        localStorage.setItem('licenseHighlightDate', licenseDate);
      }
      localStorage.setItem('licenseHighlightAt', String(Date.now()));
      localStorage.setItem('licenseHighlightClearSearch', 'true');
      localStorage.setItem('licenseHighlightClearFilters', 'true');
    } catch { }
    try {
      const evt = new CustomEvent('license-highlight', {
        detail: {
          id: licenseId,
          employeeId: String(employee.id),
          date: licenseDate,
          clearSearch: true,
          clearFilters: true,
          at: Date.now(),
        }
      });
      window.dispatchEvent(evt);
    } catch { }
    resetHeaderSearch();
    onPageChange('licenses-list');
    searchInputRef.current?.blur();
  };

  const openEmployeeModal = (employee: Employee) => {
    setSelectedEmployee(employee);
    setEmployeeModalOpen(true);
  };

  const closeEmployeeModal = () => {
    setEmployeeModalOpen(false);
    setSelectedEmployee(null);
  };

  const openEmployeeShiftHistory = (employee: Employee) => {
    const employeeId = String(employee?.id || '').trim();
    if (!employeeId) return;

    try {
      localStorage.setItem(EMPLOYEE_HISTORY_STORAGE_KEY, employeeId);
    } catch { }

    try {
      window.dispatchEvent(
        new CustomEvent('employee-shift-history-open', {
          detail: { employeeId, at: Date.now() },
        })
      );
    } catch { }

    resetHeaderSearch();
    onPageChange('employee-shift-history');
    searchInputRef.current?.blur();
  };

  // Debounce typing to avoid thrashing
  useEffect(() => {
    if (!isSearchFocused) return;
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(() => {
      const q = searchQuery.trim();
      if (q.length >= 2) {
        // Load data if needed and compute results
        (async () => {
          setIsLoadingResults(true);
          try {
            let effectiveLicenseByEmployee = licenseByEmployee;
            if (!hideLicenses && Object.keys(effectiveLicenseByEmployee).length === 0) {
              try {
                const licensesData = await fetchLicenses();
                if (Array.isArray(licensesData)) {
                  effectiveLicenseByEmployee = buildLatestLicenseMap(licensesData);
                } else if (Array.isArray(licensesData?.data)) {
                  effectiveLicenseByEmployee = buildLatestLicenseMap(licensesData.data);
                }
              } catch (licenseError) {
                console.error('Failed to load licenses for search:', licenseError);
              }
            }
            if (!allEmployees || (!hideShifts && (!allAssignments || !allShifts))) {
              const [emps, assigns, shifts] = hideShifts
                ? [await fetchEmployees(), [], []]
                : await Promise.all([
                  fetchEmployees(),
                  fetchShiftAssignments(),
                  fetchShifts(),
                ]);
              setAllEmployees(emps);
              setAllAssignments(assigns);
              setAllShifts(shifts);
              computeResults(q, emps, assigns, shifts, effectiveLicenseByEmployee);
            } else {
              computeResults(q, allEmployees, allAssignments || [], allShifts || [], effectiveLicenseByEmployee);
            }
            setIsResultsOpen(true);
          } catch (e) {
            console.error('Live search failed:', e);
          } finally {
            setIsLoadingResults(false);
          }
        })();
      } else {
        setResults([]);
        setIsResultsOpen(false);
      }
    }, 300);
    return () => {
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    };
  }, [searchQuery, isSearchFocused, allEmployees, allAssignments, allShifts, hideShifts, hideLicenses, licenseByEmployee]);

  const computeResults = (
    term: string,
    emps: Employee[],
    assigns: ShiftAssignment[],
    shifts: Shift[],
    licensesByEmployee: Record<string, HeaderLicenseInfo> = licenseByEmployee,
  ) => {
    const tokens = normalizeArabic(term).split(/\s+/).filter(Boolean);
    const now = new Date();
    const shiftById = new Map(shifts.map(s => [s.id, s] as const));
    const matches = emps.filter(e => {
      const file = (e.fileNumber || '').toString();
      const fileNorm = normalizeArabic(file);
      const phone = (e.phone_number || '').toString();
      const phoneNorm = normalizeArabic(phone);
      const civilId = (e.civilId || '').toString();
      const civilIdNorm = normalizeArabic(civilId);
      const full = normalizeArabic([
        e.name,
        e.firstName,
        e.secondName,
        e.thirdName,
        e.fourthName,
        e.familyName,
        e.rank,
      ].filter(Boolean).join(' '));
      const nameRankMatch = tokens.length > 0 && tokens.every(tok => full.includes(tok));
      const fileMatch = file && tokens.some(tok => fileNorm.includes(tok));
      const phoneMatch = phone && tokens.some(tok => phoneNorm.includes(tok));
      const civilIdMatch = civilId && tokens.some(tok => civilIdNorm.includes(tok));
      return nameRankMatch || fileMatch || phoneMatch || civilIdMatch;
    });
    const sortedMatches = matches
      .slice()
      .sort((a, b) => {
        const catDiff = getCategoryOrder(a.category) - getCategoryOrder(b.category);
        if (catDiff !== 0) return catDiff;
        const isOfficerCategory = a.category === 'قيادات' || a.category === 'مشرفون';
        if (isOfficerCategory) {
          const rankDiff = getRankOrder(a.rank, a.category) - getRankOrder(b.rank, b.category);
          if (rankDiff !== 0) return rankDiff;
          const aSeniority = a.seniorityNumber ? Number(a.seniorityNumber) : Number.POSITIVE_INFINITY;
          const bSeniority = b.seniorityNumber ? Number(b.seniorityNumber) : Number.POSITIVE_INFINITY;
          if (aSeniority !== bSeniority) return aSeniority - bSeniority;
        } else {
          const aSeniority = a.seniorityNumber ? Number(a.seniorityNumber) : Number.POSITIVE_INFINITY;
          const bSeniority = b.seniorityNumber ? Number(b.seniorityNumber) : Number.POSITIVE_INFINITY;
          if (aSeniority !== bSeniority) return aSeniority - bSeniority;
        }
        return a.name.localeCompare(b.name, 'ar');
      });

    const res: Array<{ employee: Employee; upcoming: Shift[]; past: Shift[]; licenseInfo?: HeaderLicenseInfo | null }> = sortedMatches.slice(0, 10).map(e => {
      const esAssigns = assigns.filter(a => a.employeeId === e.id);
      const theirShifts = esAssigns
        .map(a => shiftById.get(a.shiftId))
        .filter((s): s is Shift => Boolean(s))
        .sort((a, b) => new Date(a.shiftDate).getTime() - new Date(b.shiftDate).getTime());
      const upcoming: Shift[] = [];
      const past: Shift[] = [];
      for (const s of theirShifts) {
        const isUpcoming = new Date(s.shiftDate).getTime() >= new Date(now.toDateString()).getTime();
        (isUpcoming ? upcoming : past).push(s);
      }
      return { employee: e, upcoming, past: past.slice(-2).reverse(), licenseInfo: hideLicenses ? null : licensesByEmployee[String(e.id)] || null }; // last 2 past shifts, newest first
    });
    setResults(res);
  };

  const goToShiftDate = (dateString?: string) => {
    const targetDate = dateString || quickSearchDate;
    if (targetDate) {
      // حفظ التاريخ في localStorage للوصول إليه من صفحة كشوفات المناوبات
      localStorage.setItem('quickSearchDate', targetDate);

      // تحويل إلى صفحة كشوفات المناوبات
      onPageChange('view-shifts');

      // Dispatch a global event so the view-shifts page can react even if it's already active
      try { window.dispatchEvent(new CustomEvent('quick-search-date', { detail: { date: targetDate } })); } catch { }

      // إغلاق القائمة وإعادة تعيين القيم
      setIsQuickSearchOpen(false);
      setQuickSearchDate('');

      // إظهار رسالة نجاح (مخزن لتوسعات مستقبلية)
      setTimeout(() => { }, 100);
    }
  };

  const handleQuickShiftSearch = () => {
    goToShiftDate();
  };

  const formatCompactDate = (value?: string) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const options: Intl.DateTimeFormatOptions = date.getFullYear() === new Date().getFullYear()
      ? { month: '2-digit', day: '2-digit' }
      : { year: 'numeric', month: '2-digit', day: '2-digit' };
    return date.toLocaleDateString('ar-UK', {
      ...options
    });
  };

  const formatLicenseDetailLabel = (licenseInfo?: { type?: string; hours?: number | null; permissionTime?: string | null } | null) => {
    if (!licenseInfo) return '';
    if (licenseInfo.type === 'يوم كامل' || licenseInfo.type === 'رخصة يوم كامل') {
      return 'يوم كامل';
    }
    const hours = Number(licenseInfo.hours);
    const parts: string[] = [];
    if (Number.isFinite(hours) && hours > 0) {
      parts.push(`${hours} ${hours === 1 ? 'ساعة' : 'ساعات'}`);
    }
    const permissionTime = String(licenseInfo.permissionTime || '').trim();
    if (permissionTime) parts.push(permissionTime);
    return parts.join(' - ');
  };

  const buildLatestLicenseMap = (licenses: Array<Record<string, any>>) => {
    const map: Record<string, { id?: string; type: string; date: string; hours?: number | null; permissionTime?: string | null; stamp: number }> = {};

    const resolveLicenseId = (license: Record<string, any>) => {
      const rawId = license.id ?? license.license_id ?? license.licenseId;
      return rawId != null ? String(rawId) : '';
    };

    const toStamp = (value?: string) => {
      if (!value) return 0;
      const time = new Date(value).getTime();
      return Number.isNaN(time) ? 0 : time;
    };

    licenses.forEach((license) => {
      const employeeId = String(license.employee_id ?? license.employeeId ?? '');
      if (!employeeId) return;
      const licenseDate = license.license_date ?? license.licenseDate ?? license.created_at ?? license.createdAt ?? '';
      const licenseId = resolveLicenseId(license);
      const createdAt = license.created_at ?? license.createdAt ?? '';
      const stamp = toStamp(licenseDate) || toStamp(createdAt);
      if (!stamp) return;

      const existing = map[employeeId];
      if (!existing || stamp > existing.stamp) {
        map[employeeId] = {
          id: licenseId || undefined,
          type: license.license_type ?? license.licenseType ?? 'غير محدد',
          date: licenseDate || createdAt,
          hours: license.hours ?? null,
          permissionTime: license.permission_time ?? license.permissionTime ?? null,
          stamp
        };
      }
    });

    const result: Record<string, HeaderLicenseInfo> = {};
    Object.entries(map).forEach(([key, value]) => {
      result[key] = { id: value.id, type: value.type, date: value.date, hours: value.hours, permissionTime: value.permissionTime };
    });
    setLicenseByEmployee(result);
    return result;
  };

  const timeParts = getTimeParts(currentDateTime);

  return (
    <>
      <header className="bg-gradient-to-r from-white/60 via-blue-50/30 to-blue-50/30 backdrop-blur-lg backdrop-saturate-150 border-b border-white/30 shadow-lg sticky top-0 z-30">
        <div className="flex h-18 items-center justify-between px-6 lg:px-8">
          {/* Left Section - Mobile Toggle + Search */}
          <div className="flex items-center gap-6 relative" ref={searchContainerRef}>
            <button
              onClick={onToggleSidebar}
              className="lg:hidden p-2 rounded-xl bg-white/80 text-gray-600 hover:text-gray-900 hover:bg-white shadow-sm transition-all duration-200"
            >
              <Bars3Icon className="h-6 w-6" />
            </button>

            {/* Enhanced Global Search */}
            <div className="relative">
              <form
                className="hidden md:flex items-center gap-3 rounded-xl bg-gradient-to-r from-white to-gray-50/80 border border-gray-300/80 px-4 py-3.5 shadow-lg hover:shadow-xl focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-300 transition-all duration-300"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (searchQuery.trim()) triggerEmployeeSearch(searchQuery);
                }}
              >
                <div className="flex items-center gap-2">
                  <MagnifyingGlassIcon className="h-5 w-5 text-blue-500" />
                  <div className="h-5 w-px bg-gray-300"></div>
                </div>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => setIsSearchFocused(false)}
                  placeholder="البحث عن موظف بالاسم أو رقم الملف..."
                  className="w-64 md:w-80 bg-transparent outline-none text-sm text-right placeholder-gray-500 font-medium"
                  dir="rtl"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setResults([]);
                      setIsResultsOpen(false);
                    }}
                    className="p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors"
                    title="مسح البحث"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                )}
              </form>
            </div>

            {/* Quick Shift Search Icon - next to search (sibling) */}
            {!hideShifts && (
              <div className="flex items-center gap-3">
                <div className="relative quick-search-container hidden md:block">
                  <button
                    onClick={() => {
                      setIsQuickSearchOpen(!isQuickSearchOpen);
                      // تحديث آخر مناوبة عند فتح القائمة
                      if (!isQuickSearchOpen && lastShiftDate) {
                        setQuickSearchDate(lastShiftDate);
                      }
                    }}
                    className="relative rounded-xl bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700 p-3 text-white hover:from-blue-600 hover:via-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-400/50 transition-all duration-300 shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/50 transform hover:scale-105 group"
                    title="الوصول السريع لمناوبة"
                  >
                    <span className="sr-only">الوصول السريع لمناوبة</span>
                    <div className="absolute rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 blur-md opacity-30 group-hover:opacity-50 transition-all duration-300"></div>
                    <div className="flex items-center justify-center gap-2 px-4 py-1 rounded-lg transition-all duration-300">
                      <CalendarIcon className="h-5 w-5 drop-shadow-sm" aria-hidden="true" />
                      <span className="text-[13px] text-white font-bold leading-none">المناوبات</span>
                    </div>
                  </button>

                  {/* Quick Search Dropdown */}
                  {isQuickSearchOpen && (
                    <div className="absolute top-full right-0 mt-3 w-80 bg-white rounded-2xl shadow-2xl border border-blue-200/60 z-50 backdrop-blur-sm overflow-hidden">
                      {/* Enhanced Header */}
                      <div className="px-6 py-4 border-b border-blue-100 bg-gradient-to-r from-blue-50 via-blue-50 to-blue-50 rounded-t-2xl">
                        <div className="flex items-center gap-3">
                          <div>
                            <h3 className="text-lg font-bold text-gray-900">الوصول السريع للمناوبات</h3>
                            <p className="text-xs text-gray-600">البحث والانتقال إلى مناوبة محددة</p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setIsQuickSearchOpen(false);
                            setQuickSearchDate('');
                          }}
                          className="absolute left-3 top-3 p-1.5 rounded-full bg-white/70 hover:bg-white/90 text-gray-600 hover:text-gray-800 shadow-sm transition-colors"
                          title="إغلاق"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="p-6 space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            تاريخ المناوبة المطلوب
                          </label>
                          <input
                            type="date"
                            value={quickSearchDate}
                            onChange={(e) => setQuickSearchDate(e.target.value)}
                            max={lastShiftDate || formatDateForInput(new Date())}
                            className="w-full px-4 py-3 text-right border-2 border-blue-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-gradient-to-r from-blue-50/50 to-blue-80/50"
                          />
                          {lastShiftDate && (
                            <p className="text-xs text-gray-500 mt-1">
                              آخر مناوبة مسجلة: {new Date(lastShiftDate).toLocaleDateString('en-GB')}
                            </p>
                          )}
                        </div>

                        <div className="flex gap-3">
                          <button
                            onClick={handleQuickShiftSearch}
                            disabled={!quickSearchDate}
                            className="flex-1 bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 disabled:bg-gray-300 text-white px-4 py-3 rounded-xl font-medium transition-all disabled:cursor-not-allowed shadow-md hover:shadow-lg transform hover:scale-105"
                          >
                            عرض المناوبة
                          </button>
                        </div>

                        {/* Quick Date Buttons */}
                        <div className="border-t pt-2">
                          <p className="text-xs text-gray-500 mb-3">وصول سريع:</p>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => {
                                const yesterday = new Date();
                                yesterday.setDate(yesterday.getDate() - 1);
                                goToShiftDate(formatDateForInput(yesterday));
                              }}
                              className="px-4 py-3 rounded-lg bg-gray-50 text-slate-700 ring-1 ring-gray-200 hover:ring-gray-300 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:scale-[1.01] transition-all duration-200 flex items-center justify-center gap-2 w-full font-bold text-sm"
                            >
                              <CalendarIcon className="h-4 w-4" />
                              أمس
                            </button>
                            <button
                              onClick={() => {
                                const tomorrow = new Date();
                                tomorrow.setDate(tomorrow.getDate() + 1);
                                goToShiftDate(formatDateForInput(tomorrow));
                              }}
                              className="px-4 py-3 rounded-lg bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700 text-white ring-1 ring-blue-500/30 hover:ring-blue-500/50 shadow-md hover:shadow-lg hover:-translate-y-0.5 hover:scale-[1.01] transition-all duration-200 flex items-center justify-center gap-2 w-full font-bold text-sm"
                            >
                              <CalendarIcon className="h-4 w-4" />
                              غداً
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            )}

            {/* Enhanced Live Results Dropdown */}
            {isResultsOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 w-full max-w-3xl bg-white border border-gray-200/80 rounded-2xl shadow-2xl z-50 overflow-hidden backdrop-blur-sm" dir="rtl">
                {/* Results Header */}
                <div className="px-6 py-4 bg-gradient-to-r from-blue-500 to-blue-700 text-white">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <MagnifyingGlassIcon className="h-5 w-5" />
                      <div>
                        <h3 className="text-sm font-bold">نتائج بحث الموظفين</h3>
                        <p className="text-xs text-blue-100 mt-0.5">
                          {isLoadingResults ? 'جارِ البحث...' : `تم العثور على ${results.length} موظف`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setIsResultsOpen(false)}
                      className="p-1.5 rounded-full bg-white/20 hover:bg-white/50 transition-colors"
                      title="إغلاق"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Results Content */}
                <div className="max-h-[70vh] overflow-auto">
                  {results.length === 0 && !isLoadingResults ? (
                    <div className="p-8 text-center">
                      <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                        <MagnifyingGlassIcon className="h-8 w-8 text-gray-400" />
                      </div>
                      <p className="text-gray-500 font-medium">لم يتم العثور على نتائج</p>
                      <p className="text-xs text-gray-400 mt-1">جرب البحث بكلمات مختلفة</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200/60">
                      {results.map(({ employee, upcoming, past, licenseInfo }, index) => {
                        const combinedShifts = [...upcoming, ...past];
                        const primaryIdentifier = getEmployeePrimaryIdentifier(employee);
                        const phoneLabel = employee.phone_number || 'لا يوجد';
                        const departmentLabel = formatDepartmentLabel(employee.department);
                        const sectionLabel = formatSectionLabel(employee.section);
                        const jobTitleLabel = employee.jobTitle || '';
                        const displayName = formatEmployeeDisplayName(employee) || employee.name || '—';
                        const displayLabel = employee.rank ? `${employee.rank} / ${displayName}` : displayName;
                        const isExcludedFromShifts = employee.includeInShifts === false;
                        const isCivilian = String(employee.category || '').includes('إداري') || employee.rank === 'إداري';
                        const isInactive = employee.status === 'inactive';
                        const inactiveReasonLabel = (employee.reasonIfInactive || '').trim() || 'سبب غير مسجل';
                        const showPastShiftInfo = !hideShifts && !isCivilian && past.length > 0;
                        const showLicenseInfo = !hideLicenses && Boolean(licenseInfo);

                        return (
                          <div key={employee.id} className={`p-3 md:p-4 transition-colors ${isInactive ? 'bg-red-50/70 hover:bg-red-100/70' : 'hover:bg-slate-50/60'}`}>
                            <div className="flex items-start justify-between gap-4">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[9px] font-bold text-white ${isInactive ? 'bg-red-600' : 'bg-blue-600'}`}>
                                    {index + 1}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => jumpToEmployee(employee)}
                                    className={`text-sm font-black transition-colors ${isInactive ? 'text-red-700 hover:text-red-800' : 'text-slate-800 hover:text-blue-700'}`}
                                    title={isInactive ? 'الموظف خارج الخدمة - عرض البيانات' : 'الانتقال إلى إدارة الموظفين'}
                                  >
                                    {displayLabel}
                                  </button>
                                  {isInactive && (
                                    <span
                                      className="inline-flex max-w-[360px] items-center gap-1.5 rounded-full border border-red-200 bg-red-100 px-2.5 py-1 text-[11px] font-black text-red-800"
                                      title={`خارج الخدمة - ${inactiveReasonLabel}`}
                                    >
                                      <span className="shrink-0">خارج الخدمة</span>
                                      <span className="h-3 w-px shrink-0 bg-red-300" />
                                      <span className="truncate font-bold">{inactiveReasonLabel}</span>
                                    </span>
                                  )}
                                  {employee.jobTitle && (
                                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${isInactive ? 'border-red-200 bg-white text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                                      <BriefcaseIcon className="h-3.5 w-3.5" />
                                      {jobTitleLabel}
                                    </span>
                                  )}
                                  {!isInactive && isExcludedFromShifts && !isCivilian && (
                                    <span
                                      className="inline-flex items-center justify-center rounded-full border border-red-200 bg-red-50 p-1 text-red-700"
                                      title="لا يدرج بالمناوبات"
                                      aria-label="لا يدرج بالمناوبات"
                                    >
                                      <NoSymbolIcon className="h-3 w-3" />
                                    </span>
                                  )}

                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                  <div className="flex items-center gap-2 text-slate-600">
                                    <DocumentTextIcon className={`h-4 w-4 ${isInactive ? 'text-red-500' : 'text-blue-500'}`} />
                                    <span className="text-slate-500">{primaryIdentifier.label}</span>
                                    <span className={`font-bold ${primaryIdentifier.value !== 'لا يوجد' ? 'text-slate-700' : 'text-gray-300'}`}>
                                      {primaryIdentifier.value}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 text-slate-600">
                                    <PhoneIcon className={`h-4 w-4 ${isInactive ? 'text-red-500' : 'text-emerald-600'}`} />
                                    <span className="text-slate-500">رقم التواصل</span>
                                    <span className={`font-bold ${employee.phone_number ? 'text-green-700' : 'text-gray-300'}`}>
                                      {phoneLabel}
                                    </span>
                                  </div>
                                  <div className="flex items-start gap-2 text-slate-600 sm:col-span-2">
                                    <BuildingOffice2Icon className={`h-4 w-4 ${isInactive ? 'text-red-500' : 'text-blue-500'}`} />
                                    <div className="flex flex-wrap items-center gap-2 text-[12px] font-bold">
                                      <span className={departmentLabel ? 'text-slate-800' : 'text-gray-300'}>
                                        {departmentLabel || 'لا يوجد'}
                                      </span>
                                      {sectionLabel && (
                                        <>
                                          <span className="text-slate-300">•</span>
                                          <span className="text-slate-600">{sectionLabel}</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <button
                                className={`inline-flex items-center justify-center rounded-lg p-2 text-white shadow-sm transition-colors ${isInactive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                                onClick={() => {
                                  setIsResultsOpen(false);
                                  openEmployeeModal(employee);
                                }}
                                title="عرض بيانات الموظف"
                              >
                                <EyeIcon className="h-4 w-4" />
                              </button>
                            </div>

                            {!isInactive && (showPastShiftInfo || showLicenseInfo) && (
                              <div className="mt-3 flex max-w-full flex-nowrap items-center gap-2 overflow-hidden text-xs">
                                {showPastShiftInfo && (
                                  <button
                                    type="button"
                                    onClick={() => openEmployeeShiftHistory(employee)}
                                    className="flex min-w-0 max-w-[80%] shrink-0 items-center gap-1.5 rounded-xl border border-blue-100 bg-blue-50 px-2 py-1.5 text-right hover:bg-blue-100"
                                    title="فتح سجل مناوبات الموظف"
                                  >
                                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-black text-blue-700">
                                      <ClipboardDocumentListIcon className="h-3.5 w-3.5" />
                                      المناوبات
                                    </span>
                                    {combinedShifts.slice(0, 2).map((shift) => (
                                      <span key={shift.id} className="shrink-0 rounded-lg bg-white px-2 py-1 font-black text-slate-800">
                                        {formatCompactDate(shift.shiftDate)}
                                      </span>
                                    ))}
                                  </button>
                                )}

                                {showLicenseInfo && licenseInfo && (
                                  <button
                                    type="button"
                                    onClick={() => jumpToLicense(licenseInfo, employee)}
                                    className="flex min-w-0 flex-nowrap items-center gap-1.5 rounded-xl border border-amber-100 bg-amber-50 px-2 py-1.5 text-right text-[11px] hover:bg-amber-100"
                                    title="عرض سجل الرخص والاستئذانات"
                                  >
                                    <span className="inline-flex shrink-0 items-center gap-1 font-black text-amber-700">
                                      <DocumentTextIcon className="h-3.5 w-3.5" />
                                      {licenseInfo.type == "إستئذان قصير" ? "آخر إستئذان" : "آخر رخصة"}
                                    </span>
                                    <span className="shrink-0 rounded-lg bg-white px-2 py-1 font-black text-slate-800">
                                      {formatCompactDate(licenseInfo.date)}
                                    </span>
                                    {formatLicenseDetailLabel(licenseInfo) && (
                                      <span className="truncate rounded-lg bg-white px-2 py-1 font-bold text-slate-600">
                                        {formatLicenseDetailLabel(licenseInfo)}
                                      </span>
                                    )}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Results Footer */}
                {results.length > 0 && (
                  <div className="px-6 py-3 bg-gray-50/80 border-t border-gray-200/50">
                    <div className="flex items-center justify-between text-xs text-gray-600">
                      <span>اضغط الاسم للانتقال لإدارة الموظفين، وزر العين لعرض البيانات</span>
                      <span>عدد النتائج: {results.length}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Section */}
          <div className="flex items-center space-x-1 space-x-reverse">

            <NotificationDropdown
              isOpen={isNotificationOpen}
              onToggle={() => setIsNotificationOpen(!isNotificationOpen)}
              onClose={() => setIsNotificationOpen(false)}
            />


            <div className="hidden lg:flex items-center gap-2 px-2 py-2">
              {/* Date & Time Container - New Design from Licenses System */}
              <div className="flex items-stretch overflow-hidden rounded-xl bg-white mr-4 border border-gray-300/70 shadow-sm">
                {/* Date Section */}
                <div className="hidden sm:flex items-center gap-2 px-6 py-2 border-l border-gray-100">
                  <div className="text-center">
                    <div className="text-xs font-medium text-gray-500">
                      {currentDateTime.toLocaleDateString('ar-US', { weekday: 'long' })}
                    </div>
                    <div className="text-md font-black text-gray-700">
                      {currentDateTime.getDate()}
                    </div>
                  </div>
                  <div className="h-8 w-px bg-gray-200 mx-1"></div>
                  <div className="text-center">
                    <div className="text-xs font-medium text-gray-500">
                      {currentDateTime.toLocaleDateString('ar-US', { month: 'long' })}
                    </div>
                    <div className="text-md font-black text-gray-700">
                      {currentDateTime.getFullYear()}
                    </div>
                  </div>

                </div>

                {/* Time Section */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-50 to-white">
                  <ClockIcon className="w-4 h-4 text-blue-600" />
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-black text-blue-700 tabular-nums">
                      {timeParts.time}
                    </span>
                    <span className="text-xs font-bold text-blue-700">
                      {timeParts.period}
                    </span>
                  </div>
                  <div className="w-6 h-6 rounded-lg bg-blue-200 flex items-center justify-center ml-1">
                    <span className="text-xs font-bold text-blue-700">
                      {currentDateTime.getSeconds()}
                    </span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </header>
      <EmployeeModal
        mode="view"
        isOpen={employeeModalOpen}
        onClose={closeEmployeeModal}
        employee={selectedEmployee}
        departments={[]}
        ranks={[]}
        showNavigateToManagement={true}
      />
    </>
  );
}
