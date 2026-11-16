import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Users, AlertTriangle, CheckCircle, Search, X, Save, FileText, UserCheck, ArrowLeft, ArrowRight, ChevronDown, ShieldCheck, Trash2 } from 'lucide-react';
import { createShift, fetchEmployees, checkShiftExists, fetchShifts, fetchShiftAssignments, fetchShiftDayExceptions, createShiftDayException, deleteShiftDayException } from '../api';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';
import { arSA } from 'date-fns/locale';

import { Employee, Shift, ShiftAssignment, ShiftDayException } from '../types';
import NewShiftLoadingPage from './NewShiftLoadingPage';
import { formatDepartmentLabel } from '../utils/organization';
import { getRankOrder, getCategoryOrder } from '../utils/rankOrder';
import { useSystem } from '../contexts/SystemContext';
import { countEffectiveDaysBetween, isWeekendDay as isWeekendDayUtil, toDateKey } from '../utils/shiftCalendar';
import { formatShiftEmployeeDisplayName } from '../utils/employeeDisplay';

type Step = 'date' | 'selection' | 'review';
type RecentShiftWarningState = {
  employeeName: string;
  previousShiftDate: Date;
  newShiftDate: Date;
  daysDiff: number;
} | null;
const RECENT_SHIFT_WINDOW_DAYS = 10;
const parseShiftDate = (value: string) => {
  const dateOnlyMatch = (value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]) - 1;
    const day = Number(dateOnlyMatch[3]);
    return new Date(year, month, day);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const ShiftRegistration: React.FC = () => {
  const { excludeWeekendShifts } = useSystem();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [existingShifts, setExistingShifts] = useState<Shift[]>([]);
  const [existingAssignments, setExistingAssignments] = useState<ShiftAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Step management
  const [currentStep, setCurrentStep] = useState<Step>('date');
  
  // Date and employee selection
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<Employee['category'] | 'all'>('all');
  const [showExcludedFromShifts, setShowExcludedFromShifts] = useState(false);
  const [shiftCheckFailed, setShiftCheckFailed] = useState(false);
  const [bulkAddEnabled, setBulkAddEnabled] = useState(false);
  const [bulkFileNumbers, setBulkFileNumbers] = useState('');
  const [bulkAddSummary, setBulkAddSummary] = useState<{
    totalTokens: number;
    addedCount: number;
    alreadySelectedCount: number;
    missing: string[];
    duplicateInput: string[];
    duplicateMatches: string[];
    excludedCount: number;
    skippedRecentShiftCount: number;
  } | null>(null);

  // Shift details
  const [shiftTitle, setShiftTitle] = useState('');
  const [shiftNotes, setShiftNotes] = useState('');
  const [showDetails, setShowDetails] = useState(false);

  // Exceptional day (full force) states
  const [exceptionalDays, setExceptionalDays] = useState<ShiftDayException[]>([]);
  const [selectedExceptionalDay, setSelectedExceptionalDay] = useState<ShiftDayException | null>(null);
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionNote, setExceptionNote] = useState('');
  const [exceptionSubmitting, setExceptionSubmitting] = useState(false);
  const [showExceptionForm, setShowExceptionForm] = useState(false);

  // UI states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
  const [recentShiftWarning, setRecentShiftWarning] = useState<RecentShiftWarningState>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const recentShiftConfirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const hasManualDateChangeRef = useRef(false);

  // Format date helper
  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatShortDate = (date: Date) => format(date, 'dd/MM/yyyy', { locale: arSA });

  const exceptionalDateSet = useMemo(() => {
    return new Set(exceptionalDays.map((day) => toDateKey(day.date)));
  }, [exceptionalDays]);

  const hasExceptionalDay = !!selectedExceptionalDay;

  useEffect(() => {
    if (hasExceptionalDay) {
      setShowExceptionForm(false);
    }
  }, [hasExceptionalDay]);

  const normalizeArabicText = (value: string) => {
    return (value || '')
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[إأآٱ]/g, 'ا')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ء/g, '');
  };

  const normalizeFileNumber = (value: string) => {
    const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
    const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
    return (value || '')
      .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
      .trim();
  };

  const parseBulkFileNumbers = (value: string) => {
    const rawTokens = value
      .replace(/[,\u060C]+/g, ' ')
      .split(/\s+/)
      .map(token => normalizeFileNumber(token))
      .filter(Boolean);

    const uniqueTokens: string[] = [];
    const duplicates: string[] = [];
    const seen = new Set<string>();

    rawTokens.forEach(token => {
      if (seen.has(token)) {
        duplicates.push(token);
      } else {
        seen.add(token);
        uniqueTokens.push(token);
      }
    });

    return { rawTokens, uniqueTokens, duplicates };
  };

  const formatTokenList = (tokens: string[], limit = 6) => {
    const unique = Array.from(new Set(tokens));
    if (unique.length === 0) return '';
    const visible = unique.slice(0, limit).join('، ');
    return unique.length > limit ? `${visible} ... +${unique.length - limit}` : visible;
  };

  const isWeekendDay = (date: Date) => {
    return isWeekendDayUtil(date);
  };

  const getNextWorkingDay = (
    baseDate: Date,
    options?: { exceptionalDates?: Set<string> }
  ) => {
    const exceptionalDates = options?.exceptionalDates ?? exceptionalDateSet;
    const next = new Date(baseDate);
    do {
      next.setDate(next.getDate() + 1);
    } while (
      (excludeWeekendShifts && isWeekendDay(next)) ||
      exceptionalDates.has(toDateKey(next))
    );
    return next;
  };

  const getLatestRecordedDate = (shifts: Shift[], exceptions: ShiftDayException[]) => {
    let latest: Date | null = null;

    const consider = (candidate: Date | null) => {
      if (!candidate) return;
      if (!latest || candidate.getTime() > latest.getTime()) {
        latest = candidate;
      }
    };

    shifts.forEach((shift) => consider(parseShiftDate(shift.shiftDate)));
    exceptions.forEach((day) => consider(parseShiftDate(day.date)));

    return latest;
  };

  const getSuggestedShiftDate = (shifts: Shift[], exceptions: ShiftDayException[]) => {
    const exceptionDateSet = new Set(
      exceptions
        .map((day) => toDateKey(day.date))
        .filter(Boolean)
    );
    const lastRecordedDate = getLatestRecordedDate(shifts, exceptions);
    return getNextWorkingDay(lastRecordedDate || new Date(), {
      exceptionalDates: exceptionDateSet
    });
  };

  // دالة لإنشاء أيام الشهر
  const generateCalendarDays = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];

    // إضافة الأيام الفارغة في بداية الشهر
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    // إضافة أيام الشهر
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }

    return days;
  };

  // دالة للتنقل بين الشهور
  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(selectedDate);
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    hasManualDateChangeRef.current = true;
    setSelectedDate(newDate);
  };

      useEffect(() => {
    const checkForExistingShift = async () => {
      if (!selectedDate) return;
      setShiftCheckFailed(false); // Reset failure state
      try {
        const formattedDate = formatDate(selectedDate);
        const { exists, count, exceptional, exceptionalDay } = await checkShiftExists(formattedDate);
        if (exceptional && exceptionalDay) {
          setSelectedExceptionalDay(exceptionalDay);
          setExceptionReason(exceptionalDay.reason || '');
          setExceptionNote(exceptionalDay.note || '');
        } else {
          setSelectedExceptionalDay(null);
          setExceptionReason('');
          setExceptionNote('');
        }
        // Now we allow multiple shifts per day, so we just show an informational message, not an error
        if (exists && count && count > 0) {
          // Only show as warning, not blocking
          console.info(`Found ${count} existing shift(s) for this date`);
        }
      } catch (error) {
        console.error('Failed to check for existing shift:', error);
        setShiftCheckFailed(true); // Mark check as failed
        setSelectedExceptionalDay(null);
        setExceptionReason('');
        setExceptionNote('');
      }
    };

    checkForExistingShift();
  }, [selectedDate]);

  // إغلاق التقويم عند النقر خارجه
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setIsCalendarOpen(false);
      }
    };

    if (isCalendarOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isCalendarOpen]);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [employeesData, shiftsData, assignmentsData, exceptionData] = await Promise.all([
          fetchEmployees(),
          fetchShifts(),
          fetchShiftAssignments(),
          fetchShiftDayExceptions()
        ]);

        setEmployees(
          employeesData.filter(
            (e: Employee) => e.category !== 'مدنيين' && e.status !== 'inactive'
          )
        );

        const safeShifts = Array.isArray(shiftsData) ? shiftsData : [];
        const safeAssignments = Array.isArray(assignmentsData) ? assignmentsData : [];
        setExistingShifts(safeShifts);
        setExistingAssignments(safeAssignments);
        const safeExceptionDays = Array.isArray(exceptionData) ? exceptionData : [];
        setExceptionalDays(safeExceptionDays);
      } catch {
        setError('Failed to load employees.');
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, []);

  useEffect(() => {
    if (loading) return;
    if (hasManualDateChangeRef.current) return;
    setSelectedDate(getSuggestedShiftDate(existingShifts, exceptionalDays));
  }, [loading, existingShifts, exceptionalDays, excludeWeekendShifts]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setIsCalendarOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!excludeWeekendShifts) return;
    if (selectedDate && isWeekendDay(selectedDate)) {
      setSelectedDate(getNextWorkingDay(selectedDate));
    }
  }, [excludeWeekendShifts]);

  useEffect(() => {
    if (!recentShiftWarning) return;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (recentShiftConfirmResolverRef.current) {
          recentShiftConfirmResolverRef.current(false);
          recentShiftConfirmResolverRef.current = null;
        }
        setRecentShiftWarning(null);
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [recentShiftWarning]);

  useEffect(() => {
    return () => {
      if (recentShiftConfirmResolverRef.current) {
        recentShiftConfirmResolverRef.current(false);
        recentShiftConfirmResolverRef.current = null;
      }
    };
  }, []);

  const filteredEmployees = useMemo(() => {
    let filtered = employees.filter((e) => e.status !== 'inactive');
    if (!showExcludedFromShifts) {
      filtered = filtered.filter((e) => e.includeInShifts !== false);
    }
    if (activeFilter !== 'all') {
      filtered = filtered.filter(e => e.category === activeFilter);
    }
    const term = normalizeArabicText(searchTerm.trim());
    if (term) {
      filtered = filtered.filter(employee =>
        normalizeArabicText(employee.name || '').includes(term) ||
        normalizeArabicText(employee.fileNumber || '').includes(term) ||
        normalizeArabicText(employee.militaryNumber || '').includes(term) ||
        normalizeArabicText(employee.department || '').includes(term) ||
        normalizeArabicText(employee.section || '').includes(term) ||
        normalizeArabicText(formatDepartmentLabel(employee.department) || '').includes(term) ||
        normalizeArabicText(employee.rank || '').includes(term) ||
        normalizeArabicText(employee.jobTitle || '').includes(term)
      );
    }
    return filtered;
  }, [employees, searchTerm, activeFilter, showExcludedFromShifts]);

  const employeesByFileNumber = useMemo(() => {
    const map = new Map<string, Employee[]>();
    employees.forEach(employee => {
      const fileNumber = normalizeFileNumber(employee.fileNumber || '');
      if (!fileNumber) return;
      const existing = map.get(fileNumber) || [];
      existing.push(employee);
      map.set(fileNumber, existing);
    });
    return map;
  }, [employees]);

  const shiftDateById = useMemo(() => {
    const map = new Map<string, Date>();
    existingShifts.forEach((shift) => {
      const parsedDate = parseShiftDate(shift.shiftDate);
      if (parsedDate) {
        map.set(shift.id, parsedDate);
      }
    });
    return map;
  }, [existingShifts]);

  const employeeShiftDatesMap = useMemo(() => {
    const map = new Map<string, Date[]>();

    existingAssignments.forEach((assignment) => {
      const shiftDate = shiftDateById.get(assignment.shiftId);
      if (!shiftDate) return;
      const currentDates = map.get(assignment.employeeId) || [];
      currentDates.push(shiftDate);
      map.set(assignment.employeeId, currentDates);
    });

    map.forEach((dates) => {
      dates.sort((a, b) => b.getTime() - a.getTime());
    });

    return map;
  }, [existingAssignments, shiftDateById]);

  const getRecentShiftConflict = (employeeId: string, targetDate: Date) => {
    const shiftDates = employeeShiftDatesMap.get(employeeId);
    if (!shiftDates || shiftDates.length === 0) return null;

    const targetDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

    for (const shiftDate of shiftDates) {
      const daysDiff = countEffectiveDaysBetween(shiftDate, targetDay, {
        excludedDates: exceptionalDateSet,
        excludeWeekend: excludeWeekendShifts
      });
      if (daysDiff >= 1 && daysDiff <= RECENT_SHIFT_WINDOW_DAYS) {
        return { shiftDate, daysDiff };
      }
    }

    return null;
  };

  const resolveRecentShiftModal = (confirmed: boolean) => {
    if (recentShiftConfirmResolverRef.current) {
      recentShiftConfirmResolverRef.current(confirmed);
      recentShiftConfirmResolverRef.current = null;
    }
    setRecentShiftWarning(null);
  };

  const requestRecentShiftConfirmation = (employee: Employee, conflict: { shiftDate: Date; daysDiff: number }) => {
    if (recentShiftConfirmResolverRef.current) {
      recentShiftConfirmResolverRef.current(false);
      recentShiftConfirmResolverRef.current = null;
    }

    return new Promise<boolean>((resolve) => {
      recentShiftConfirmResolverRef.current = resolve;
      setRecentShiftWarning({
        employeeName: formatShiftEmployeeDisplayName(employee) || employee.name,
        previousShiftDate: conflict.shiftDate,
        newShiftDate: selectedDate,
        daysDiff: conflict.daysDiff
      });
    });
  };

  const confirmEmployeeRecentShift = async (employee: Employee) => {
    const conflict = getRecentShiftConflict(employee.id, selectedDate);
    if (!conflict) return true;
    return requestRecentShiftConfirmation(employee, conflict);
  };

  const bulkInputStats = useMemo(() => parseBulkFileNumbers(bulkFileNumbers), [bulkFileNumbers]);

  const selectedEmployeeDetails = useMemo(() => {
    return employees
      .filter(e => selectedEmployees.includes(e.id) && e.status !== 'inactive')
      .sort((a, b) => {
        // First sort by category: الضباط -> ضباط الصف -> المهنيين
        const categoryOrderA = getCategoryOrder(a.category);
        const categoryOrderB = getCategoryOrder(b.category);
        if (categoryOrderA !== categoryOrderB) {
          return categoryOrderA - categoryOrderB;
        }
        // Then sort by rank within each category
        const rankOrderA = getRankOrder(a.rank, a.category);
        const rankOrderB = getRankOrder(b.rank, b.category);
        return rankOrderA - rankOrderB;
      });
  }, [selectedEmployees, employees]);

  const validation = useMemo(() => {
    const normalizeProfessionalGroup = (value: string | null | undefined) => {
      const t = (value || '').trim();
      if (t === 'طباعين' || t === 'الطباعين') return 'طباع';
      if (t === 'سائقين' || t === 'السائقين') return 'سائق';
      if (t === 'فراشين' || t === 'الفراشين') return 'فراش';
      return t;
    };

    // Required professional groups
    const jobGroups = [
      { name: 'طباع', key: 'طباع' },
      { name: 'فراش', key: 'فراش' },
      { name: 'سائق', key: 'سائق' },
    ];

    // Build a set of normalized titles for selected professionals
    const normalizedSelected = new Set(
      selectedEmployeeDetails
        .filter(e => e.category === 'مهنيين')
        .map(e => normalizeProfessionalGroup(e.professionalGroup) || '')
    );

    // Check which groups are satisfied
    const groupStatus = jobGroups.map(group => ({
      name: group.name,
      isSatisfied: normalizedSelected.has(group.key)
    }));

    const stats = {
      officers: selectedEmployeeDetails.filter(e => e.category === 'ضباط').length,
      ncos: selectedEmployeeDetails.filter(e => e.category === 'ضباط صف').length,
      professionals: selectedEmployeeDetails.filter(e => e.category === 'مهنيين').length,
      total: selectedEmployeeDetails.length,
    };

    const requiredOfficerCount = 1;
    const requiredNcoCount = 1;

    const isValid = 
      stats.officers >= requiredOfficerCount && 
      stats.ncos >= requiredNcoCount && 
      groupStatus.every(group => group.isSatisfied);

    const summaryStats = {
      officers: { count: stats.officers, required: requiredOfficerCount },
      ncos: { count: stats.ncos, required: requiredNcoCount },
      professionals: {
        required: jobGroups.length,
        count: groupStatus.filter(g => g.isSatisfied).length,
        jobGroupsStatus: groupStatus
      },
      total: stats.total
    };

    return {
      isValid,
      stats: summaryStats
    };
  }, [selectedEmployeeDetails]);

  const toggleEmployee = async (employeeId: string) => {
    const isAlreadySelected = selectedEmployees.includes(employeeId);
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return;

    if (!isAlreadySelected) {
      const shouldContinue = await confirmEmployeeRecentShift(employee);
      if (!shouldContinue) return;

      if (employee.includeInShifts === false) {
        toast('تنبيه: الموظف لا يدرج بالخفارات وتمت إضافته', { icon: '⚠️', id: `excluded-${employeeId}` });
      }
    }

    setSelectedEmployees(currentSelected => (
      isAlreadySelected
        ? currentSelected.filter(id => id !== employeeId)
        : [...currentSelected, employeeId]
    ));
  };

  const handleBulkAddByFileNumbers = async () => {
    const { uniqueTokens, duplicates } = parseBulkFileNumbers(bulkFileNumbers);
    if (uniqueTokens.length === 0) {
      toast.error('أدخل أرقام ملفات أولاً');
      return;
    }

    const missing: string[] = [];
    const alreadySelected: string[] = [];
    const duplicateMatches: string[] = [];
    const excluded: string[] = [];
    const skippedRecentShift: string[] = [];
    const idsToAdd: string[] = [];

    for (const token of uniqueTokens) {
      const matches = employeesByFileNumber.get(token);
      if (!matches || matches.length === 0) {
        missing.push(token);
        continue;
      }
      if (matches.length > 1) {
        duplicateMatches.push(token);
      }

      for (const employee of matches) {
        if (selectedEmployees.includes(employee.id)) {
          alreadySelected.push(token);
          continue;
        }

        if (!(await confirmEmployeeRecentShift(employee))) {
          skippedRecentShift.push(formatShiftEmployeeDisplayName(employee) || employee.name || token);
          continue;
        }

        idsToAdd.push(employee.id);
        if (employee.includeInShifts === false) {
          excluded.push(token);
        }
      }
    }

    if (idsToAdd.length > 0) {
      setSelectedEmployees(prev => {
        const next = new Set(prev);
        idsToAdd.forEach(id => next.add(id));
        return Array.from(next);
      });
    }

    setBulkAddSummary({
      totalTokens: uniqueTokens.length,
      addedCount: idsToAdd.length,
      alreadySelectedCount: alreadySelected.length,
      missing,
      duplicateInput: duplicates,
      duplicateMatches,
      excludedCount: excluded.length,
      skippedRecentShiftCount: skippedRecentShift.length
    });

    if (idsToAdd.length > 0) {
      toast.success(`تمت إضافة ${idsToAdd.length} موظف`);
    }
    if (missing.length > 0) {
      toast.error(`لم يتم العثور على ${missing.length} رقم ملف`);
    }
    if (duplicateMatches.length > 0) {
      toast('تنبيه: يوجد رقم ملف مكرر في البيانات', { icon: '⚠️' });
    }
    if (excluded.length > 0) {
      toast('تنبيه: تمت إضافة موظفين غير مدرجين بالخفارات', { icon: '⚠️' });
    }
    if (skippedRecentShift.length > 0) {
      toast(`تم تخطي ${skippedRecentShift.length} موظف بسبب وجود خفارة خلال آخر ${RECENT_SHIFT_WINDOW_DAYS} أيام`, { icon: '⚠️' });
    }
    if (idsToAdd.length === 0 && missing.length === 0 && skippedRecentShift.length === 0) {
      toast('كل الأرقام كانت مضافة مسبقًا', { icon: 'ℹ️' });
    }
  };

  const handleBulkClear = () => {
    setBulkFileNumbers('');
    setBulkAddSummary(null);
  };

  const getCategoryLabel = (category: Employee['category'] | 'all') => {
    switch (category) {
      case 'ضباط':
        return 'الضباط';
      case 'ضباط صف':
        return 'ضباط الصف';
      case 'مهنيين':
        return 'المهنيين';
      case 'مدنيين':
        return 'المدنيين';
      case 'all':
      default:
        return 'الكل';
    }
  };

  const getCategoryColor = (category: Employee['category']) => {
    const colors = {
      ضباط: { bg: 'bg-blue-100', text: 'text-blue-800' },
      'ضباط صف': { bg: 'bg-green-100', text: 'text-green-800' },
      مهنيين: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
      مدنيين: { bg: 'bg-orange-100', text: 'text-orange-800' },
    };
    return colors[category] || { bg: 'bg-gray-100', text: 'text-gray-800' };
  };

  // Step management functions
  const steps = [
    { id: 'date', title: 'اختيار التاريخ', icon: Calendar, description: 'حدد تاريخ الخفارة' },
    { id: 'selection', title: 'اختيار الموظفين', icon: Users, description: 'ابحث واختر الموظفين' },
    { id: 'review', title: 'المراجعة والحفظ', icon: Save, description: 'تأكيد وحفظ الخفارة' }
  ];

  const getCurrentStepIndex = () => steps.findIndex(step => step.id === currentStep);
  
  const canProceedToNextStep = () => {
    switch (currentStep) {
      case 'date': return selectedDate !== null && !shiftCheckFailed && !hasExceptionalDay;
      case 'selection': return selectedEmployees.length > 0;
      case 'review': return true;
      default: return false;
    }
  };

  const nextStep = () => {
    const currentIndex = getCurrentStepIndex();
    if (currentIndex < steps.length - 1 && canProceedToNextStep()) {
      setCurrentStep(steps[currentIndex + 1].id as Step);
    }
  };

  const prevStep = () => {
    const currentIndex = getCurrentStepIndex();
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1].id as Step);
    }
  };

  const handleSubmit = async () => {
    if (selectedEmployees.length === 0) {
      toast.error('يجب اختيار موظف واحد على الأقل');
      return;
    }

    setIsSubmitting(true);
    try {
      // Helper to format date as YYYY-MM-DD
      const formatDate = (date: Date) => {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const shiftData = {
        shiftDate: formatDate(selectedDate),
        createdBy: 'المستخدم الحالي',
        title: shiftTitle,
        notes: shiftNotes,
        assignments: selectedEmployees.map(empId => ({
          employeeId: empId,
          status: 'attended',
          counted: true,
          note: ''
        }))
      };

      await createShift(shiftData);

      try {
        const [latestShifts, latestAssignments] = await Promise.all([
          fetchShifts(),
          fetchShiftAssignments()
        ]);
        setExistingShifts(Array.isArray(latestShifts) ? latestShifts : []);
        setExistingAssignments(Array.isArray(latestAssignments) ? latestAssignments : []);
      } catch (refreshError) {
        console.error('Failed to refresh shift history cache:', refreshError);
      }

      toast.success('تم حفظ الخفارة بنجاح');
      
      // Reset form
      hasManualDateChangeRef.current = false;
      setSelectedEmployees([]);
      setShiftTitle('');
      setShiftNotes('');
      setShowDetails(false);
      setSearchTerm('');
      setActiveFilter('all');
      setShowExcludedFromShifts(false);
      setShiftCheckFailed(false);
      setCurrentStep('date');
    } catch (error) {
      console.error('Error saving shift:', error);
      const message = error instanceof Error ? error.message : 'حدث خطأ أثناء حفظ الخفارة';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateExceptionalDay = async () => {
    if (!selectedDate) return;
    const reason = exceptionReason.trim();
    if (!reason) {
      toast.error('يرجى إدخال سبب الاستثناء');
      return;
    }

    setExceptionSubmitting(true);
    const dateKey = formatDate(selectedDate);
    try {
      const created = await createShiftDayException({
        date: dateKey,
        reason,
        note: exceptionNote.trim() ? exceptionNote.trim() : undefined,
        createdBy: 'المستخدم الحالي'
      });
      setExceptionalDays((prev) => [created, ...prev.filter((day) => toDateKey(day.date) !== dateKey)]);
      setSelectedExceptionalDay(created);
      toast.success('تم تسجيل اليوم كاستثناء');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'فشل تسجيل اليوم الاستثنائي';
      toast.error(message);
    } finally {
      setExceptionSubmitting(false);
    }
  };

  const handleDeleteExceptionalDay = async () => {
    if (!selectedExceptionalDay) return;
    const confirmed = window.confirm('هل تريد حذف استثناء هذا اليوم؟');
    if (!confirmed) return;
    setExceptionSubmitting(true);
    try {
      await deleteShiftDayException(selectedExceptionalDay.id);
      setExceptionalDays((prev) => prev.filter((day) => day.id !== selectedExceptionalDay.id));
      setSelectedExceptionalDay(null);
      setExceptionReason('');
      setExceptionNote('');
      toast.success('تم حذف الاستثناء بنجاح');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'فشل حذف الاستثناء';
      toast.error(message);
    } finally {
      setExceptionSubmitting(false);
    }
  };

  if (loading) return <NewShiftLoadingPage />;
  
  if (error) return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center">
      <div className="text-center bg-white p-6 rounded-lg shadow-lg">
        <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <p className="text-red-600 text-base font-medium">خطأ: {error}</p>
      </div>
    </div>
  );

  const renderStepContent = () => {
    switch (currentStep) {
      case 'date':
        return (
          <div className="text-center py-8">
            <div className="relative rounded-2xl p-8 max-w-2xl mx-auto ">
              <button
                type="button"
                onClick={() => setShowExceptionForm((prev) => !prev)}
                className="group absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-amber-200/80 bg-amber-50/70 text-amber-700 shadow-sm opacity-70 transition hover:bg-amber-50 hover:border-amber-300 hover:opacity-100 focus-visible:opacity-100"
                title="حالة خاصة - يوم استثنائي"
                aria-label="حالة خاصة - يوم استثنائي"
              >
                <ShieldCheck size={16} />
                {hasExceptionalDay && (
                  <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-500 ring-2 ring-white" />
                )}
                <span className="pointer-events-none absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-amber-200/80 bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-amber-700 opacity-0 shadow-sm transition group-hover:opacity-100 group-focus-visible:opacity-100">
                  حالة خاصة
                </span>
                <span className="sr-only">يوم استثنائي</span>
              </button>
              <div className="bg-gradient-to-br from-blue-50 to-indigo-100 border-2 border-blue-200 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-6 shadow-lg">
                <Calendar className="h-8 w-8 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-3">اختر تاريخ الخفارة</h2>
              <p className="text-gray-600 mb-8 text-lg">حدد التاريخ المطلوب لتسجيل الخفارة</p>
              
              <div className="max-w-lg mx-auto">
                <div className="relative" ref={calendarRef}>
                  <button
                    ref={buttonRef}
                    onClick={() => {
                      if (buttonRef.current) {
                        setButtonRect(buttonRef.current.getBoundingClientRect());
                      }
                      setIsCalendarOpen(!isCalendarOpen);
                    }}
                    className="w-full bg-white pr-5 pl-14 py-4 border-2 border-blue-200 rounded-xl focus:ring-4 focus:ring-blue-100 focus:border-blue-400 text-lg flex items-center justify-center hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 shadow-md hover:shadow-lg group"
                  >
                    <Calendar size={28} className="absolute right-6 top-8 transform -translate-y-1/2 text-blue-500 group-hover:text-blue-600 transition-colors" />
                    <span className="font-semibold text-gray-800">{format(selectedDate, 'EEEE، dd MMMM yyyy', { locale: arSA })}</span>
                  </button>
                  {isCalendarOpen && buttonRect && createPortal(
                    <div
                      className="fixed bg-white border border-gray-300 rounded-lg shadow-xl p-4 min-w-[300px] z-[9999]"
                      style={{
                        top: buttonRect.top + window.scrollY - 380, // فوق الحقل
                        left: buttonRect.left + window.scrollX + (buttonRect.width / 2) - 150, // في المنتصف
                      }}
                      ref={calendarRef}
                    >
                      {/* رأس التقويم */}
                      <div className="flex items-center justify-between mb-4">
                        <button
                          onClick={() => navigateMonth('prev')}
                          className="p-1 hover:bg-gray-100 rounded"
                        >
                          <ChevronDown className="w-4 h-4 transform -rotate-90" />
                        </button>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {format(selectedDate, 'MMMM yyyy', { locale: arSA })}
                        </h3>
                        <button
                          onClick={() => navigateMonth('next')}
                          className="p-1 hover:bg-gray-100 rounded"
                        >
                          <ChevronDown className="w-4 h-4 transform rotate-90" />
                        </button>
                      </div>

                      {/* أيام الأسبوع */}
                      <div className="grid grid-cols-7 gap-1 mb-2">
                        {['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'].map(day => (
                          <div key={day} className="text-center text-xs font-medium text-gray-500 py-2">
                            {day}
                          </div>
                        ))}
                      </div>

                      {/* أيام الشهر */}
                      <div className="grid grid-cols-7 gap-1">
                        {generateCalendarDays(selectedDate).map((day, index) => {
                          const isWeekendDisabled = !!day && excludeWeekendShifts && isWeekendDay(day);
                          const isExceptional = !!day && exceptionalDateSet.has(toDateKey(day));
                          const isDisabled = !day || isWeekendDisabled;
                          const isSelected = !!day && !isDisabled
                            && format(day, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
                          const isToday = !!day && format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

                          return (
                            <button
                              key={index}
                              onClick={() => {
                                if (day && !isWeekendDisabled) {
                                  hasManualDateChangeRef.current = true;
                                  setSelectedDate(day);
                                  setIsCalendarOpen(false);
                                }
                              }}
                              disabled={isDisabled}
                              className={`
                                h-8 text-sm rounded transition-colors
                                ${!day ? 'invisible' : ''}
                                ${isWeekendDisabled ? 'text-gray-300 cursor-not-allowed line-through' : ''}
                                ${isSelected
                                  ? 'bg-blue-600 text-white'
                                  : isExceptional
                                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                    : !isWeekendDisabled
                                      ? 'hover:bg-gray-100 text-gray-900'
                                      : ''
                                }
                                ${isToday && !isWeekendDisabled
                                  ? 'ring-2 ring-blue-300'
                                  : ''
                                }
                              `}
                            >
                              {day ? day.getDate() : ''}
                            </button>
                          );
                        })}
                      </div>

                      {/* زر إغلاق */}
                      <div className="mt-4 flex justify-end">
                        <button
                          onClick={() => setIsCalendarOpen(false)}
                          className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
                        >
                          إغلاق
                        </button>
                      </div>
                    </div>, document.body
                  )}
                </div>

                {showExceptionForm && (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-right">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-bold text-amber-900">يوم استثنائي</div>
                      <button
                        type="button"
                        onClick={() => setShowExceptionForm(false)}
                        className="text-amber-700 hover:text-amber-900"
                        aria-label="إغلاق"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    {hasExceptionalDay ? (
                      <div className="mt-3 space-y-2">
                        <div className="text-xs text-amber-800">لا يوجد خفارة</div>
                        <div className="text-xs text-amber-800">القوة بالكامل متواجدة</div>
                        <div className="text-xs text-amber-800">
                          السبب : <span className="font-bold">{selectedExceptionalDay?.reason || 'غير محدد'}</span>
                        </div>
                        {selectedExceptionalDay?.note && (
                          <div className="text-xs text-amber-800">
                            ملاحظات: <span className="font-semibold">{selectedExceptionalDay.note}</span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={handleDeleteExceptionalDay}
                          disabled={exceptionSubmitting}
                          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                        >
                          <Trash2 size={14} />
                          حذف الاستثناء
                        </button>
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        <input
                          type="text"
                          value={exceptionReason}
                          onChange={(e) => setExceptionReason(e.target.value)}
                          className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm text-gray-800 placeholder-gray-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
                          placeholder="سبب الاستثناء (مثال: حالة حرب)"
                        />
                        <textarea
                          value={exceptionNote}
                          onChange={(e) => setExceptionNote(e.target.value)}
                          className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm text-gray-800 placeholder-gray-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
                          placeholder="ملاحظات إضافية (اختياري)"
                          rows={2}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={handleCreateExceptionalDay}
                            disabled={exceptionSubmitting}
                            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-60"
                          >
                            <ShieldCheck size={14} />
                            حفظ الاستثناء
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowExceptionForm(false)}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-8">
                  <div className="border-t border-gray-100 pt-6">
                    <button
                      onClick={() => setShowDetails(!showDetails)}
                      className="group w-full text-center py-3 px-4 text-gray-500 hover:text-gray-700 text-sm font-medium transition-all duration-200 rounded-xl hover:bg-gray-50/70 border border-transparent hover:border-gray-200"
                    >
                      <div className="flex items-center justify-center space-x-2 space-x-reverse">
                        <FileText size={16} className="text-gray-400 group-hover:text-gray-600 transition-colors" />
                        <span className="select-none">
                          {showDetails ? 'إخفاء التفاصيل الإضافية' : 'إضافة عنوان وملاحظات'}
                        </span>
                        {!showDetails && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                            اختياري
                          </span>
                        )}
                      </div>
                    </button>
                  </div>

                  {showDetails && (
                    <div className="mt-6 space-y-5 animate-fade-in-down">
                      <div className="bg-gray-50/50 rounded-xl p-5 border border-gray-100">
                        <div className="space-y-4">
                          <div>
                            <label htmlFor="shiftTitle" className="block text-sm font-medium text-gray-600 text-right mb-2">
                              عنوان الخفارة
                            </label>
                            <input
                              type="text"
                              id="shiftTitle"
                              value={shiftTitle}
                              onChange={(e) => setShiftTitle(e.target.value)}
                              className="w-full pr-4 pl-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-all bg-white/80 text-gray-800 placeholder-gray-400"
                              placeholder="مثال: خفارة عيد الأضحى المبارك"
                            />
                          </div>
                          <div>
                            <label htmlFor="shiftNotes" className="block text-sm font-medium text-gray-600 text-right mb-2">
                              ملاحظات إضافية
                            </label>
                            <textarea
                              id="shiftNotes"
                              value={shiftNotes}
                              onChange={(e) => setShiftNotes(e.target.value)}
                              rows={3}
                              className="w-full pr-4 pl-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-all bg-white/80 text-gray-800 placeholder-gray-400 resize-none"
                              placeholder="أضف أي تفاصيل أو تعليمات خاصة بهذه الخفارة..."
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );

      case 'selection':
        return (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-black text-slate-900">اختيار الموظفين</h2>
                  <p className="text-sm text-slate-500">اختر الموظفين المطلوبين للخفارة الحالية</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                    <UserCheck size={14} />
                    المختار: {selectedEmployees.length}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                    النتائج: {filteredEmployees.length}
                  </span>
                  {showExcludedFromShifts && (
                    <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">
                      عرض غير المدرجين
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="space-y-4">
                  <div className="relative">
                    <Search size={20} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    {searchTerm.trim() && (
                      <button
                        type="button"
                        onClick={() => setSearchTerm('')}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        title="مسح البحث"
                      >
                        <X size={16} />
                      </button>
                    )}
                    <input
                      type="text"
                      placeholder="ابحث بالاسم، رقم الملف، أو الإدارة..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pr-12 pl-10 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      {(['all', 'ضباط', 'ضباط صف', 'مهنيين'] as const).map(cat => (
                        <button
                          key={cat}
                          onClick={() => setActiveFilter(cat)}
                          className={`px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${
                            activeFilter === cat
                              ? 'bg-blue-600 text-white shadow-md'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {getCategoryLabel(cat)}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
                      <span className="text-sm font-semibold text-slate-700">إظهار غير المدرجين</span>
                      <span className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showExcludedFromShifts}
                          onChange={(e) => setShowExcludedFromShifts(e.target.checked)}
                          className="sr-only peer"
                        />
                        <span className="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">إضافة متعددة بأرقام الملفات</h3>
                    <p className="text-xs text-slate-500">افصل الأرقام بمسافة أو سطر</p>
                  </div>
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
                    <span className="text-sm font-semibold text-slate-700">تفعيل</span>
                    <span className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bulkAddEnabled}
                        onChange={(e) => {
                          setBulkAddEnabled(e.target.checked);
                          if (!e.target.checked) {
                            setBulkAddSummary(null);
                          }
                        }}
                        className="sr-only peer"
                      />
                      <span className="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></span>
                    </span>
                  </label>
                </div>

                {bulkAddEnabled && (
                  <div className="mt-4 space-y-3">
                    <textarea
                      rows={4}
                      value={bulkFileNumbers}
                      onChange={(e) => {
                        setBulkFileNumbers(e.target.value);
                        setBulkAddSummary(null);
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                      placeholder={`مثال:\n902875 744735 897029\n903325 869243 889223\n869629 874127`}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        الأرقام المدخلة: {bulkInputStats.uniqueTokens.length}
                        {bulkInputStats.duplicates.length > 0 && (
                          <span className="text-amber-600"> • مكررة: {bulkInputStats.duplicates.length}</span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleBulkClear}
                          className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                        >
                          مسح
                        </button>
                        <button
                          type="button"
                          onClick={handleBulkAddByFileNumbers}
                          className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 shadow-sm"
                        >
                          إضافة دفعة
                        </button>
                      </div>
                    </div>

                    {bulkAddSummary && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                        <div>تمت إضافة: {bulkAddSummary.addedCount}</div>
                        {bulkAddSummary.alreadySelectedCount > 0 && (
                          <div>كانت مضافة مسبقًا: {bulkAddSummary.alreadySelectedCount}</div>
                        )}
                        {bulkAddSummary.missing.length > 0 && (
                          <div>غير موجودة: {formatTokenList(bulkAddSummary.missing)}</div>
                        )}
                        {bulkAddSummary.duplicateInput.length > 0 && (
                          <div>مكررة في الإدخال: {formatTokenList(bulkAddSummary.duplicateInput)}</div>
                        )}
                        {bulkAddSummary.duplicateMatches.length > 0 && (
                          <div>مكررة في البيانات: {formatTokenList(bulkAddSummary.duplicateMatches)}</div>
                        )}
                        {bulkAddSummary.excludedCount > 0 && (
                          <div>غير مدرجين بالخفارات: {bulkAddSummary.excludedCount}</div>
                        )}
                        {bulkAddSummary.skippedRecentShiftCount > 0 && (
                          <div>تم التخطي بسبب تكرار خلال آخر 10 أيام: {bulkAddSummary.skippedRecentShiftCount}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-white via-blue-50/60 to-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 bg-blue-50/80 border-b border-blue-100">
                  <div className="text-sm font-extrabold text-blue-900">نتائج الموظفين</div>
                  <span className="text-xs font-semibold text-blue-700">
                    {filteredEmployees.length} نتيجة
                  </span>
                </div>
                {(searchTerm || filteredEmployees.length > 0) && (
                  <div className="max-h-[16rem] overflow-y-auto divide-y divide-slate-100">
                    {filteredEmployees.length > 0 ? (
                      filteredEmployees.slice(0, 20).map(employee => {
                        const isSelected = selectedEmployees.includes(employee.id);
                        const isExcludedFromShifts = employee.includeInShifts === false;
                        return (
                          <div
                            key={employee.id}
                            className={`p-4 transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-blue-50/80 border-l-4 border-blue-400'
                                : isExcludedFromShifts
                                  ? 'bg-red-50/60 hover:bg-red-50'
                                  : 'hover:bg-slate-50'
                            }`}
                            onClick={() => toggleEmployee(employee.id)}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`px-2 py-1 text-xs font-semibold rounded-md ${
                                    getCategoryColor(employee.category).bg
                                  } ${getCategoryColor(employee.category).text}`}>
                                    {employee.rank}
                                  </span>
                                  <h3 className="font-bold text-slate-900">{formatShiftEmployeeDisplayName(employee) || employee.name}</h3>
                                  <span className="text-xs text-slate-500">({getCategoryLabel(employee.category)})</span>
                                  {isExcludedFromShifts && (
                                    <span className="px-2 py-0.5 text-xs rounded border border-red-200 bg-red-50 text-red-700">
                                      لا يدرج بالخفارات
                                    </span>
                                  )}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1">ملف: {employee.fileNumber || '-'}</span>
                                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1">هاتف: {employee.phone_number || '-'}</span>
                                  {employee.jobTitle && (
                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
                                      {employee.jobTitle}
                                    </span>
                                  )}
                                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                                    {formatDepartmentLabel(employee.department) || 'غير مسجل'}
                                  </span>
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                {isExcludedFromShifts && (
                                  <div className="flex items-center text-red-600 text-xs">
                                    <AlertTriangle size={14} className="ml-1" />
                                    غير مدرج
                                  </div>
                                )}
                                <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center ${
                                  isSelected
                                    ? 'bg-blue-600 border-blue-600'
                                    : 'border-slate-300'
                                }`}>
                                  {isSelected && <CheckCircle size={16} className="text-white" />}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center text-slate-500 py-6">
                        لا توجد نتائج مطابقة.
                      </div>
                    )}
                  </div>
                )}

                {filteredEmployees.length > 20 && (
                  <div className="text-center px-5 py-3 text-sm text-slate-500 bg-slate-50">
                    يتم عرض أول 20 نتيجة. استخدم البحث لتضييق النتائج.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-white via-emerald-50/60 to-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 bg-emerald-50/80 border-b border-emerald-100">
                  <div className="text-sm font-extrabold text-emerald-900">الموظفين المختارين</div>
                  <span className="text-xs font-semibold text-emerald-700">{selectedEmployees.length} موظف</span>
                </div>
                {selectedEmployees.length > 0 ? (
                  <div className="max-h-[24rem] overflow-auto">
                    <table className="min-w-[900px] w-full text-sm text-right">
                      <thead className="sticky top-0 z-10 bg-slate-50">
                        <tr className="text-xs font-semibold text-slate-500">
                          <th className="px-4 py-3">م</th>
                          <th className="px-4 py-3">الرتبة</th>
                          <th className="px-4 py-3">الموظف</th>
                          <th className="px-4 py-3">رقم الملف</th>
                          <th className="px-4 py-3">الهاتف</th>
                          <th className="px-4 py-3">الإدارة</th>
                          <th className="px-4 py-3">المسمى</th>
                          <th className="px-4 py-3">إزالة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedEmployeeDetails.map((emp, index) => (
                          <tr key={emp.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 text-slate-500">{index + 1}</td>
                            <td className="px-4 py-3 font-semibold text-slate-900">{emp.rank || '-'}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-900">{formatShiftEmployeeDisplayName(emp) || emp.name || '-'}</span>
                                {emp.includeInShifts === false && (
                                  <span className="text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                                    لا يدرج بالخفارات
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{emp.fileNumber || '-'}</td>
                            <td className="px-4 py-3 text-slate-700">{emp.phone_number || '-'}</td>
                            <td className="px-4 py-3 text-slate-700">
                              <span className="block max-w-[180px] truncate">
                                {formatDepartmentLabel(emp.department) || '-'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              <span className="block max-w-[160px] truncate">{emp.jobTitle || '-'}</span>
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => toggleEmployee(emp.id)}
                                className="text-red-500 hover:text-red-700 transition-colors p-1 rounded hover:bg-red-50"
                                title="إزالة من القائمة"
                              >
                                <X size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center text-slate-500 py-8">
                    لم يتم اختيار موظفين بعد.
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'review': {
        const officersReady = validation.stats.officers.count >= validation.stats.officers.required;
        const ncosReady = validation.stats.ncos.count >= validation.stats.ncos.required;
        const professionalsReady = validation.stats.professionals.count >= validation.stats.professionals.required;

        return (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">مراجعة نهائية وحفظ الخفارة</h2>
                    <p className="text-sm text-slate-500">تأكد من صحة البيانات قبل الحفظ</p>
                  </div>
                </div>
                <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                  validation.isValid
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}>
                  {validation.isValid ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                  {validation.isValid ? 'جاهز للحفظ' : 'يحتاج استكمال المتطلبات'}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                  <div className="flex items-center gap-2 text-blue-700 text-sm font-semibold">
                    <Calendar className="h-4 w-4" />
                    تاريخ الخفارة
                  </div>
                  <p className="mt-2 text-base font-bold text-blue-700">
                    {format(selectedDate, 'EEEE، dd MMMM yyyy', { locale: arSA })}
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2 text-emerald-700 text-sm font-semibold">
                    <Users className="h-4 w-4" />
                    إجمالي الموظفين
                  </div>
                  <p className="mt-2 text-2xl font-bold text-emerald-700">{selectedEmployees.length}</p>
                </div>
                <div className={`rounded-xl border p-4 ${officersReady ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                  <div className="text-sm font-semibold text-slate-700">الضباط</div>
                  <div className={`mt-2 text-lg font-bold ${officersReady ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {validation.stats.officers.count} / {validation.stats.officers.required}
                  </div>
                  <div className="text-xs text-slate-500">الحد الأدنى المطلوب</div>
                </div>
                <div className={`rounded-xl border p-4 ${ncosReady ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                  <div className="text-sm font-semibold text-slate-700">ضباط الصف</div>
                  <div className={`mt-2 text-lg font-bold ${ncosReady ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {validation.stats.ncos.count} / {validation.stats.ncos.required}
                  </div>
                  <div className="text-xs text-slate-500">الحد الأدنى المطلوب</div>
                </div>
                <div className={`rounded-xl border p-4 ${professionalsReady ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                  <div className="text-sm font-semibold text-slate-700">المهنيين</div>
                  <div className={`mt-2 text-lg font-bold ${professionalsReady ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {validation.stats.professionals.count} / {validation.stats.professionals.required}
                  </div>
                  <div className="text-xs text-slate-500">الحد الأدنى المطلوب</div>
                </div>
              </div>

              {selectedEmployeeDetails.some(e => e.includeInShifts === false) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div>
                    <p className="text-amber-800 font-semibold">تنبيه: يوجد موظفون غير مدرجين في الخفارات ضمن القائمة.</p>
                    <p className="text-amber-700 text-sm mt-1">
                      {selectedEmployeeDetails.filter(e => e.includeInShifts === false).map(e => formatShiftEmployeeDisplayName(e) || e.name).join('، ')}
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {['ضباط', 'ضباط صف', 'مهنيين'].map(category => {
                  const catEmployees = selectedEmployeeDetails.filter(e => e.category === category);
                  if (catEmployees.length === 0) return null;
                  return (
                    <div key={category} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className={`text-sm font-bold px-3 py-1 rounded-full ${
                          getCategoryColor(category as Employee['category']).bg
                        } ${getCategoryColor(category as Employee['category']).text}`}>
                          {getCategoryLabel(category as Employee['category'])}
                        </h3>
                        <span className="text-xs text-slate-500">عدد: {catEmployees.length}</span>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {catEmployees.map(emp => (
                          <div key={emp.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                            <UserCheck className="h-4 w-4 text-emerald-500" />
                            <span className="font-semibold text-slate-800">{emp.rank}</span>
                            <span className="text-slate-900">{formatShiftEmployeeDisplayName(emp) || emp.name}</span>
                            {category === 'مهنيين' && emp.jobTitle && (
                              <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                                {emp.jobTitle}
                              </span>
                            )}
                            <span className="text-xs text-slate-500">
                              ({formatDepartmentLabel(emp.department) || 'غير مسجل'})
                            </span>
                            {emp.includeInShifts === false && (
                              <span className="text-[11px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
                                غير مدرج
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-amber-800">ملاحظات التحقق</h3>
                    <span className="text-xs text-amber-700">
                      {validation.isValid ? 'مكتملة' : 'غير مكتملة'}
                    </span>
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-medium text-slate-700 mb-2">متطلبات الفئات</h4>
                      <div className="space-y-2">
                        <div className={`flex items-center justify-between p-2 rounded text-sm ${
                          officersReady ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}>
                          <span>الضباط</span>
                          <span>{validation.stats.officers.count} / {validation.stats.officers.required}</span>
                        </div>
                        <div className={`flex items-center justify-between p-2 rounded text-sm ${
                          ncosReady ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}>
                          <span>ضباط الصف</span>
                          <span>{validation.stats.ncos.count} / {validation.stats.ncos.required}</span>
                        </div>
                        <div className={`flex items-center justify-between p-2 rounded text-sm ${
                          professionalsReady ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}>
                          <span>المهنيين</span>
                          <span>{validation.stats.professionals.count} / {validation.stats.professionals.required}</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium text-slate-700 mb-2">الوظائف المهنية</h4>
                      <div className="space-y-1">
                        {validation.stats.professionals.jobGroupsStatus.map(group => (
                          <div key={group.name} className={`flex items-center justify-between p-2 rounded text-sm ${
                            group.isSatisfied ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            <span>{group.name}</span>
                            {group.isSatisfied ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  const progressPercent = ((getCurrentStepIndex() + 1) / steps.length) * 100;

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-xl shadow-slate-200/60 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-lg">
                <Calendar className="h-7 w-7 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-black text-slate-900">تسجيل خفارة جديدة</h1>
                <p className="text-slate-600 mt-1">تنظيم التاريخ، اختيار الموظفين، ثم المراجعة والحفظ</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
                الخطوة {getCurrentStepIndex() + 1} من {steps.length}
              </div>
              {currentStep !== 'date' && (
                <div className="rounded-full border border-blue-200 bg-blue-50 px-7 py-2 text-sm font-semibold text-gray-500">
                  تاريخ الخفارة: <p className="font-black inline text-blue-700">{format(selectedDate, 'EEEE، dd MMMM yyyy', { locale: arSA })}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-lg shadow-slate-200/50 p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {steps.map((step, index) => {
              const isActive = step.id === currentStep;
              const isCompleted = getCurrentStepIndex() > index;
              const Icon = step.icon;

              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                    isActive
                      ? 'border-blue-200 bg-blue-50'
                      : isCompleted
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-slate-200 bg-white'
                  }`}
                >
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl border shadow-sm ${
                    isActive
                      ? 'border-blue-200 bg-blue-100 text-blue-600'
                      : isCompleted
                        ? 'border-emerald-200 bg-emerald-100 text-emerald-600'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}>
                    <Icon size={20} />
                  </span>
                  <div className="text-right">
                    <div className="text-xs font-semibold text-slate-500">خطوة {index + 1}</div>
                    <div className="text-sm font-bold text-slate-900">{step.title}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-6 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-500 transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Step Content */}
        <div className="bg-white/90 rounded-3xl shadow-lg shadow-slate-200/50 p-6 border border-slate-200">
          {renderStepContent()}
        </div>

        {/* Navigation Buttons */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <button
            onClick={prevStep}
            disabled={getCurrentStepIndex() === 0}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-all ${
              getCurrentStepIndex() === 0
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-slate-700 text-white hover:bg-slate-800 shadow-lg'
            }`}
          >
            <ArrowRight className="h-4 w-4" />
            السابق
          </button>

          {currentStep === 'review' ? (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || selectedEmployees.length === 0}
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-8 py-3 text-sm font-semibold transition-all ${
                isSubmitting || selectedEmployees.length === 0
                  ? 'bg-slate-300 text-white cursor-not-allowed'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg'
              }`}
            >
              <Save className="h-4 w-4" />
              {isSubmitting ? 'جاري الحفظ...' : 'تأكيد وحفظ الخفارة'}
            </button>
          ) : (
            <button
              onClick={nextStep}
              disabled={!canProceedToNextStep()}
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-8 py-3 text-sm font-semibold transition-all ${
                !canProceedToNextStep()
                  ? 'bg-slate-300 text-white cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg'
              }`}
            >
              التالي
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {recentShiftWarning && createPortal(
        <div
          className="fixed inset-0 z-[10000] bg-slate-900/45 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => resolveRecentShiftModal(false)}
          dir="rtl"
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-amber-200 bg-white shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-6 py-5 bg-amber-50 border-b border-amber-100">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center border border-amber-200">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-slate-900">تنبيه تكرار خفارة</h3>
                  <p className="text-sm text-slate-600">الموظف لديه خفارة قريبة خلال آخر 10 أيام</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">الموظف</span>
                  <span className="font-bold text-slate-900">{recentShiftWarning.employeeName}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">تاريخ آخر خفارة</span>
                  <span className="font-semibold text-slate-800">{formatShortDate(recentShiftWarning.previousShiftDate)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">تاريخ الخفارة الجديدة</span>
                  <span className="font-semibold text-slate-800">{formatShortDate(recentShiftWarning.newShiftDate)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">فرق الأيام</span>
                  <span className="font-bold text-red-600">{recentShiftWarning.daysDiff} يوم</span>
                </div>
              </div>

              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 font-bold">
                هل تريد الاستمرار في إضافة الموظف رغم وجود خفارة حديثة له؟
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => resolveRecentShiftModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm  bg-white text-slate-700 font-semibold hover:bg-slate-100 transition-colors"
              >
                إلغاء الإضافة
              </button>
              <button
                type="button"
                onClick={() => resolveRecentShiftModal(true)}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors shadow-sm"
              >
                استمرار الإضافة
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ShiftRegistration;
