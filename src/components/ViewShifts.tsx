import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Select from 'react-select';
import { UserX, ChevronDown, Calendar, Search, AlertCircle, UserCog, Trash2, X, FileText, Pencil, Plus, Edit3, Save, CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { fetchShifts, fetchShiftAssignments, fetchEmployees, updateShiftReceptionStatus, deleteShift, recordAbsence, updateShiftAssignmentEmployee, addShiftAssignment, removeShiftAssignment, updateShiftDetails, fetchShiftDayExceptions, deleteShiftDayException } from '../api';
import { Shift, ShiftAssignment, Employee, ShiftDayException } from '../types';
import { getCategoryOrder, getRankOrder } from '../utils/rankOrder';
import LoadingPage from './LoadingPage';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';
import { arSA } from 'date-fns/locale';
import { exportShiftsToWord } from '../utils/exportWord';
import { formatDepartmentLabel, normalizeOrganizationName } from '../utils/organization';
import { toDateKey } from '../utils/shiftCalendar';
import { formatEmployeeNameByParts, formatShiftEmployeeDisplayName } from '../utils/employeeDisplay';
import ScrollToTop from './UI/ScrollToTop';
import ScrollToBottom from './UI/ScrollToBottom';
import PageHeader from './UI/PageHeader';

type FullShiftInfo = Shift & { assignments: (ShiftAssignment & { employee: Employee })[] };
type FullShiftAssignmentInfo = ShiftAssignment & { employee: Employee };
const EMPLOYEE_HISTORY_STORAGE_KEY = 'employeeShiftHistoryEmployeeId';

const ViewShifts: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [exceptionalDays, setExceptionalDays] = useState<ShiftDayException[]>([]);
  const [exceptionalBusyId, setExceptionalBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [quickSearchActive, setQuickSearchActive] = useState(false);
  const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
  const datePickerContainerRef = useRef<HTMLDivElement>(null);
  const datePickerDropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // State for Shift Details Modal
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [shiftToEditDetails, setShiftToEditDetails] = useState<Shift | null>(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedNotes, setEditedNotes] = useState('');
    const [isSavingDetails, setIsSavingDetails] = useState(false);

  const openDetailsModal = (shift: Shift) => {
    setShiftToEditDetails(shift);
    setEditedTitle(shift.title || '');
    setEditedNotes(shift.notes || '');
    setIsDetailsModalOpen(true);
  };

  const closeDetailsModal = () => {
    setIsDetailsModalOpen(false);
    setShiftToEditDetails(null);
    setEditedTitle('');
    setEditedNotes('');
  };

  const handleSaveDetails = async () => {
    if (!shiftToEditDetails) return;

    setIsSavingDetails(true);
    try {
      const updatedShift = await updateShiftDetails(shiftToEditDetails.id, editedTitle, editedNotes);
      // Update local state
      setShifts(prevShifts => 
        prevShifts.map(s => s.id === updatedShift.id ? updatedShift : s)
      );
      toast.success('تم حفظ تفاصيل الخفارة بنجاح');
      closeDetailsModal();
    } catch (error) {
      console.error('Failed to save shift details:', error);
      toast.error('فشل في حفظ التفاصيل. الرجاء المحاولة مرة أخرى.');
    } finally {
      setIsSavingDetails(false);
    }
  };

  // State for Edit Assignment Modal
  const [isEditAssignmentModalOpen, setIsEditAssignmentModalOpen] = useState(false);
  const [assignmentToEdit, setAssignmentToEdit] = useState<FullShiftAssignmentInfo | null>(null);
  const [newEmployeeId, setNewEmployeeId] = useState<string | null>(null);
  const [isUpdatingAssignment, setIsUpdatingAssignment] = useState(false);

  // Add Employee to Shift modal state
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);
  const [selectedShiftForAdd, setSelectedShiftForAdd] = useState<Shift | null>(null);
  const [isProcessingAssignment, setIsProcessingAssignment] = useState(false);

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
    setSelectedDate(newDate);
  };

  // إغلاق التقويم عند النقر خارجه (يدعم كل من الحاوية والقائمة المنبثقة)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const inContainer = !!datePickerContainerRef.current && datePickerContainerRef.current.contains(target);
      const inDropdown = !!datePickerDropdownRef.current && datePickerDropdownRef.current.contains(target);
      if (!inContainer && !inDropdown) {
        setShowDatePicker(false);
      }
    };

    if (showDatePicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDatePicker]);

  // إضافة CSS لضمان ظهور التقويم
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .datepicker-container {
        position: relative;
        z-index: 40;
      }

      .datepicker-dropdown {
        /* لا تغيّر position/top/left هنا حتى لا تتعارض مع تموضع inline في الـ portal */
        z-index: 9999;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        border: 1px solid #d1d5db;
        background: white;
        border-radius: 0.5rem;
        overflow: visible;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Delete shift modal states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [shiftToDelete, setShiftToDelete] = useState<Shift | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Remove assignment confirmation modal states
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [assignmentToRemove, setAssignmentToRemove] = useState<FullShiftAssignmentInfo | null>(null);

  const buildNormalizedIndexMap = (value: string) => {
    const indexMap: number[] = [];
    let normalized = '';
    for (let i = 0; i < value.length; i += 1) {
      const normalizedChar = normalizeArabic(value[i]);
      if (!normalizedChar) continue;
      for (let j = 0; j < normalizedChar.length; j += 1) {
        normalized += normalizedChar[j];
        indexMap.push(i);
      }
    }
    return { normalized, indexMap };
  };

  // دالة لتسليط الضوء على نص البحث
  const highlightSearchTerm = (text: string, searchTerm: string) => {
    const rawText = text || '';
    const rawSearch = searchTerm.trim();
    if (!rawSearch) return rawText;

    const normalizedSearch = normalizeArabic(rawSearch);
    if (!normalizedSearch) return rawText;

    const { normalized: normalizedText, indexMap } = buildNormalizedIndexMap(rawText);
    const matchIndex = normalizedText.indexOf(normalizedSearch);

    if (matchIndex === -1) return rawText;

    const startOriginal = indexMap[matchIndex];
    const endOriginal = indexMap[matchIndex + normalizedSearch.length - 1] + 1;

    return (
      <>
        {rawText.slice(0, startOriginal)}
        <span className="bg-yellow-200 font-semibold px-1 rounded">
          {rawText.slice(startOriginal, endOriginal)}
        </span>
        {rawText.slice(endOriginal)}
      </>
    );
  };

  const renderAddAssignmentModal = () => {
    if (!showAddEmployeeModal || !selectedShiftForAdd) return null;

    return createPortal(
      <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[9999] p-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md transform transition-all duration-300 scale-95 hover:scale-100">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-xl font-bold text-gray-800">إضافة موظف إلى الخفارة</h3>
            <button onClick={closeAddEmployeeModal} className="text-gray-400 hover:text-gray-600 transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label htmlFor="add-employee-select" className="block text-sm font-medium text-gray-600 mb-1">اختر الموظف</label>
              <Select
                id="add-employee-select"
                options={employees.map(emp => ({ value: emp.id, label: `${formatShiftEmployeeDisplayName(emp) || emp.name} - ${emp.rank}` }))}
                onChange={(selectedOption) => setNewEmployeeId(selectedOption?.value || null)}
                placeholder="ابحث عن موظف أو اختر من القائمة..."
                isClearable
                isRtl
                noOptionsMessage={() => 'لم يتم العثور على موظفين'}
                styles={{
                  control: (base) => ({ ...base, padding: '0.3rem', borderRadius: '0.5rem' }),
                  menu: (base) => ({ ...base, zIndex: 50 }),
                }}
              />
            </div>
          </div>
          <div className="px-6 py-4 bg-gray-50 rounded-b-2xl flex justify-end space-x-3 space-x-reverse">
            <button
              onClick={closeAddEmployeeModal}
              disabled={isProcessingAssignment}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              إلغاء
            </button>
            <button
              onClick={handleAddAssignmentSubmit}
              disabled={isProcessingAssignment}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold shadow-md flex items-center justify-center disabled:bg-green-400 disabled:cursor-not-allowed"
            >
              إضافة
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };
  const [absenceModalData, setAbsenceModalData] = useState<{
    assignment: ShiftAssignment & { employee: Employee };
    isOpen: boolean;
    isEditing: boolean;
  } | null>(null);
  const [absenceType, setAbsenceType] = useState('غياب');
  const [otherAbsenceReason, setOtherAbsenceReason] = useState('');
  const absenceOptions = ['طبية', 'غياب','رخصة', 'إجازة', 'دورة ترقية', 'مأمورية', 'مهمة', 'أخرى'];
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const dayRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // مفتاح تاريخ معلق للتمرير إليه بعد اكتمال التحميل/التصيير
  const pendingScrollTarget = useRef<string | null>(null);

  const normalizeArabic = (value: string) => {
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


  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [shiftsData, assignmentsData, employeesData, exceptionData] = await Promise.all([
        fetchShifts(),
        fetchShiftAssignments(),
        fetchEmployees(),
        fetchShiftDayExceptions(),
      ]);
      
      setShifts(shiftsData);
      setAssignments(assignmentsData);
      setEmployees(employeesData.filter((e: Employee) => e.category !== 'مدنيين'));
      setExceptionalDays(Array.isArray(exceptionData) ? exceptionData : []);
    } catch (err) {
      setError('فشل في تحميل البيانات');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // التحقق من البحث السريع عند تحميل الصفحة
  useEffect(() => {
    const quickSearchDate = localStorage.getItem('quickSearchDate');
    if (quickSearchDate) {
      const searchDate = new Date(quickSearchDate);
      setSelectedDate(searchDate);
      setMonthCursor(new Date(searchDate.getFullYear(), searchDate.getMonth(), 1));
      localStorage.removeItem('quickSearchDate');
      // جدولة التمرير بعد اكتمال التحميل والتصيير
      pendingScrollTarget.current = format(searchDate, 'yyyy-MM-dd');
    }
  }, []);

  // استمع للأحداث السريعة حتى لو كنا بالفعل في صفحة الخفارات
  useEffect(() => {
    const onQuickSearchDate = (e: Event) => {
      const ce = e as CustomEvent;
      const target = (ce?.detail?.date as string) || localStorage.getItem('quickSearchDate');
      if (target) {
        const searchDate = new Date(target);
        setSelectedDate(searchDate);
        setMonthCursor(new Date(searchDate.getFullYear(), searchDate.getMonth(), 1));
        try { localStorage.removeItem('quickSearchDate'); } catch {}
        pendingScrollTarget.current = format(searchDate, 'yyyy-MM-dd');
      }
    };

    window.addEventListener('quick-search-date', onQuickSearchDate as EventListener);
    return () => window.removeEventListener('quick-search-date', onQuickSearchDate as EventListener);
  }, []);

  

  // Global search term: read on mount and listen to global-search events
  useEffect(() => {
    // Initialize from localStorage
    try {
      const term = localStorage.getItem('globalSearchTerm');
      if (term && term.trim()) {
        setSearchTerm(term);
        setShowSearchResults(true);
        // ensure top is visible
        scrollToTop();
        // consume the term so it doesn't persist on future visits
        try {
          localStorage.removeItem('globalSearchTerm');
          localStorage.removeItem('globalSearchAt');
        } catch {}
      }
    } catch {}

    // Listen for custom event from header
    const onGlobalSearch = (e: Event) => {
      // CustomEvent may include detail.term
      const ce = e as CustomEvent;
      const term = (ce?.detail?.term as string) || '';
      if (term.trim()) {
        setSearchTerm(term);
        setShowSearchResults(true);
        scrollToTop();
        // also clear any persisted value just in case
        try {
          localStorage.removeItem('globalSearchTerm');
          localStorage.removeItem('globalSearchAt');
        } catch {}
      }
    };
    window.addEventListener('global-search', onGlobalSearch as EventListener);

    return () => {
      window.removeEventListener('global-search', onGlobalSearch as EventListener);
    };
  }, []);

  // Sorting helpers for assignments: by category, then rank order (for officers/NCOs), then seniority, then Arabic name
  const compareAssignments = useCallback(
    (a: ShiftAssignment & { employee: Employee }, b: ShiftAssignment & { employee: Employee }) => {
      const catDiff = getCategoryOrder(a.employee.category) - getCategoryOrder(b.employee.category);
      if (catDiff !== 0) return catDiff;

      const isOfficerCategory = a.employee.category === 'ضباط' || a.employee.category === 'ضباط صف';
      if (isOfficerCategory) {
        const rankDiff = getRankOrder(a.employee.rank, a.employee.category) - getRankOrder(b.employee.rank, b.employee.category);
        if (rankDiff !== 0) return rankDiff;

        const aSeniority = a.employee.seniorityNumber ? Number(a.employee.seniorityNumber) : Number.POSITIVE_INFINITY;
        const bSeniority = b.employee.seniorityNumber ? Number(b.employee.seniorityNumber) : Number.POSITIVE_INFINITY;
        if (aSeniority !== bSeniority) return aSeniority - bSeniority;
      } else {
        const aSeniority = a.employee.seniorityNumber ? Number(a.employee.seniorityNumber) : Number.POSITIVE_INFINITY;
        const bSeniority = b.employee.seniorityNumber ? Number(b.employee.seniorityNumber) : Number.POSITIVE_INFINITY;
        if (aSeniority !== bSeniority) return aSeniority - bSeniority;
      }

      return a.employee.name.localeCompare(b.employee.name, 'ar', { sensitivity: 'base' });
    },
    []
  );

  const processedShifts = useMemo<FullShiftInfo[]>(() => {
    // Filtering is now done on the backend. We just process the shifts we receive.
    console.log('Processing shifts received from backend:', shifts);
    const employeeMap = new Map(employees.map(e => [e.id, e]));

    return shifts.map(shift => {
      const shiftAssignments = assignments
        .filter(a => a.shiftId === shift.id)
        .map(a => {
          const employee = employeeMap.get(a.employeeId);
          return employee ? { ...a, employee } : null;
        })
        .filter((a): a is ShiftAssignment & { employee: Employee } => a !== null)
        .sort(compareAssignments);

      return { ...shift, assignments: shiftAssignments };
    })
      .sort((a, b) => new Date(b.shiftDate).getTime() - new Date(a.shiftDate).getTime());
  }, [shifts, assignments, employees, compareAssignments]);

  const handleToggleReception = async (shiftId: string, currentStatus: boolean) => {
    try {
      await updateShiftReceptionStatus(shiftId, !currentStatus);
      
      // Refresh data
      const [shiftsData, assignmentsData] = await Promise.all([
        fetchShifts(),
        fetchShiftAssignments()
      ]);
      
      setShifts(shiftsData);
      setAssignments(assignmentsData);
      
      toast.success(currentStatus ? 'تم إلغاء تأكيد الاستلام' : 'تم تأكيد الاستلام بنجاح');
    } catch (error) {
      console.error('Error updating reception status:', error);
      toast.error('فشل في تحديث حالة الاستلام');
    }
  };

  const openAddEmployeeModal = (shift: Shift) => {
    setSelectedShiftForAdd(shift);
    setNewEmployeeId(null);
    setShowAddEmployeeModal(true);
  };

  const closeAddEmployeeModal = () => {
    setShowAddEmployeeModal(false);
    setSelectedShiftForAdd(null);
  };

  const handleAddAssignmentSubmit = async () => {
    if (!selectedShiftForAdd || !newEmployeeId) {
      toast.error('الرجاء اختيار موظف.');
      return;
    }
    setIsProcessingAssignment(true);
    try {
      const created = await addShiftAssignment(selectedShiftForAdd.id, newEmployeeId);
      // Optimistic local insert
      setAssignments(prev => [...prev, created]);
      toast.success('تم إضافة الموظف إلى الخفارة');
      closeAddEmployeeModal();
      // Light refresh of assignments to ensure consistency
      try {
        const updatedAssignments = await fetchShiftAssignments();
        setAssignments(updatedAssignments);
      } catch {}
    } catch (error) {
      console.error('Failed to add assignment:', error);
      toast.error('فشل في إضافة الموظف');
    } finally {
      setIsProcessingAssignment(false);
    }
  };

  const handleRemoveAssignment = async (assignmentId: string) => {
    setIsProcessingAssignment(true);
    try {
      await removeShiftAssignment(assignmentId);
      toast.success('تم إزالة الموظف من الخفارة');
      await fetchData();
    } catch (error) {
      console.error('Failed to remove assignment:', error);
      toast.error('فشل في إزالة الموظف');
    } finally {
      setIsProcessingAssignment(false);
    }
  };

  const handleDeleteShift = async () => {
    if (!shiftToDelete) return;

    setIsDeleting(true);
    try {
      await deleteShift(shiftToDelete.id);

      // Refresh data
      const [shiftsData, assignmentsData] = await Promise.all([
        fetchShifts(),
        fetchShiftAssignments()
      ]);

      setShifts(shiftsData);
      setAssignments(assignmentsData);

      toast.success('تم حذف الخفارة بنجاح');
      setShowDeleteModal(false);
      setShiftToDelete(null);
    } catch (error) {
      console.error('Error deleting shift:', error);
      toast.error('فشل في حذف الخفارة');
    } finally {
      setIsDeleting(false);
    }
  };

  const openDeleteModal = (shift: Shift) => {
    setShiftToDelete(shift);
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    setShowDeleteModal(false);
    setShiftToDelete(null);
  };

  const handleDeleteExceptionalDay = async (exception: ShiftDayException) => {
    const confirmed = window.confirm('هل تريد حذف استثناء هذا اليوم؟');
    if (!confirmed) return;
    setExceptionalBusyId(exception.id);
    try {
      await deleteShiftDayException(exception.id);
      setExceptionalDays((prev) => prev.filter((day) => day.id !== exception.id));
      toast.success('تم حذف اليوم الاستثنائي بنجاح');
    } catch (error) {
      console.error('Error deleting exceptional day:', error);
      toast.error('فشل في حذف اليوم الاستثنائي');
    } finally {
      setExceptionalBusyId(null);
    }
  };
  
  // Open/close remove assignment modal
  const openRemoveModal = (assignment: FullShiftAssignmentInfo) => {
    setAssignmentToRemove(assignment);
    setShowRemoveModal(true);
  };
  
  const closeRemoveModal = () => {
    setShowRemoveModal(false);
    setAssignmentToRemove(null);
  };
  
  const handleConfirmRemoveAssignment = async () => {
    if (!assignmentToRemove) return;
    await handleRemoveAssignment(assignmentToRemove.id);
    setShowRemoveModal(false);
    setAssignmentToRemove(null);
  };

  const openEditAssignmentModal = (assignment: FullShiftAssignmentInfo) => {
    setAssignmentToEdit(assignment);
    setIsEditAssignmentModalOpen(true);
    setNewEmployeeId(null); // Reset previous selection
  };

  const closeEditAssignmentModal = () => {
    setIsEditAssignmentModalOpen(false);
    setAssignmentToEdit(null);
    setNewEmployeeId(null);
  };

  const handleEditAssignmentSubmit = async () => {
    if (!assignmentToEdit || !newEmployeeId) {
      toast.error('الرجاء اختيار موظف جديد.');
      return;
    }

    setIsUpdatingAssignment(true);
    try {
      await updateShiftAssignmentEmployee(assignmentToEdit.id, newEmployeeId);
      toast.success('تم تعديل الموظف بنجاح!');
      closeEditAssignmentModal();
      await fetchData(); // Refresh data to show the change
    } catch (error) {
      console.error('Failed to update assignment:', error);
      toast.error('فشل في تعديل الموظف. الرجاء المحاولة مرة أخرى.');
    } finally {
      setIsUpdatingAssignment(false);
    }
  };

  const openAbsenceModal = (assignment: ShiftAssignment & { employee: Employee }, isEditing = false) => {
    setAbsenceModalData({ assignment, isOpen: true, isEditing });
    if (isEditing && assignment.note) {
      const note = assignment.note;
      if (absenceOptions.filter(o => o !== 'أخرى').includes(note)) {
        setAbsenceType(note);
        setOtherAbsenceReason('');
      } else {
        setAbsenceType('أخرى');
        setOtherAbsenceReason(note || '');
      }
    } else {
      setAbsenceType('غياب');
      setOtherAbsenceReason('');
    }
  };

  const closeAbsenceModal = () => {
    setAbsenceModalData(null);
    setAbsenceType('غياب');
    setOtherAbsenceReason('');
  };

  const deleteAbsenceReason = async (assignmentId: string) => {
    try {
      // Call the API to set the note to null
      await recordAbsence(assignmentId, null);
      toast.success('تم حذف سبب الغياب بنجاح');
      // Refetch all data to ensure the UI is up-to-date
      await fetchData();
    } catch (error) {
      console.error('Error deleting absence reason:', error);
      toast.error('حدث خطأ أثناء حذف سبب الغياب');
    }
  };

  const handleAbsenceSubmit = async () => {
    if (!absenceModalData?.assignment) return;
    
    const finalReason = absenceType === 'أخرى' ? otherAbsenceReason.trim() : absenceType;

    if (!finalReason) {
      toast.error('الرجاء تحديد أو إدخال سبب الغياب.');
      return;
    }

    try {
      await recordAbsence(absenceModalData.assignment.id, finalReason);
      toast.success(absenceModalData.isEditing ? 'تم تحديث سبب الغياب' : 'تم تسجيل سبب الغياب');
      closeAbsenceModal();
      await fetchData();
    } catch (error) {
      console.error('Error recording absence:', error);
      toast.error('حدث خطأ أثناء تسجيل الغياب');
    }
  };

  const shiftsGroupedByDay = useMemo(() => {
    return processedShifts.reduce<Record<string, FullShiftInfo[]>>((acc, shift) => {
      const day = format(new Date(shift.shiftDate), 'yyyy-MM-dd');
      if (!acc[day]) {
        acc[day] = [];
      }
      acc[day].push(shift);
      return acc;
    }, {});
  }, [processedShifts]);



  // فلترة البيانات
  const filteredShifts = useMemo(() => {
    if (!searchTerm.trim()) {
      return Object.entries(shiftsGroupedByDay);
    }

    const searchLower = normalizeArabic(searchTerm.trim());
    return Object.entries(shiftsGroupedByDay).filter(([_, dayShifts]) => {
      return dayShifts.some(shift => {
        // Check if any assignment matches the search criteria
        const hasMatchingAssignment = shift.assignments.some(a => {
          const employee = a.employee;
          if (!employee) return false;
          
          return (
            normalizeArabic(employee.name || '').includes(searchLower) ||
            normalizeArabic(employee.rank || '').includes(searchLower) ||
            normalizeArabic(employee.fileNumber || '').includes(searchLower)
          );
        });
        
        return hasMatchingAssignment;
      });
    });
  }, [shiftsGroupedByDay, searchTerm]);

  const availableMonthKeys = useMemo(() => {
    const keys = new Set<string>();
    shifts.forEach(shift => {
      keys.add(format(new Date(shift.shiftDate), 'yyyy-MM'));
    });
    exceptionalDays.forEach((day) => {
      const key = toDateKey(day.date).slice(0, 7);
      if (key) keys.add(key);
    });
    return keys;
  }, [shifts, exceptionalDays]);

  const monthKey = useMemo(() => format(monthCursor, 'yyyy-MM'), [monthCursor]);

  const exceptionalDayMap = useMemo(() => {
    const map = new Map<string, ShiftDayException>();
    exceptionalDays.forEach((day) => {
      const key = toDateKey(day.date);
      if (key) map.set(key, day);
    });
    return map;
  }, [exceptionalDays]);

  const exceptionalDaysForMonth = useMemo(() => {
    return exceptionalDays
      .map((day) => ({ ...day, dateKey: toDateKey(day.date) }))
      .filter((day) => day.dateKey && day.dateKey.startsWith(monthKey))
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [exceptionalDays, monthKey]);

  const monthFilteredShifts = useMemo(() => {
    if (searchTerm.trim()) {
      return filteredShifts;
    }
    return filteredShifts.filter(([day]) => day.startsWith(monthKey));
  }, [filteredShifts, monthKey, searchTerm]);

  const displayDays = useMemo(() => {
    if (searchTerm.trim()) {
      return monthFilteredShifts.map(([day, dayShifts]) => ({
        day,
        dayShifts,
        exceptional: exceptionalDayMap.get(day) || null
      }));
    }

    const map = new Map<
      string,
      { day: string; dayShifts: FullShiftInfo[]; exceptional: ShiftDayException | null }
    >();

    monthFilteredShifts.forEach(([day, dayShifts]) => {
      map.set(day, { day, dayShifts, exceptional: exceptionalDayMap.get(day) || null });
    });

    exceptionalDaysForMonth.forEach((day) => {
      const dayKey = day.dateKey;
      if (!dayKey) return;
      if (!map.has(dayKey)) {
        map.set(dayKey, { day: dayKey, dayShifts: [], exceptional: day });
      }
    });

    return Array.from(map.values()).sort((a, b) => b.day.localeCompare(a.day));
  }, [monthFilteredShifts, exceptionalDayMap, exceptionalDaysForMonth, searchTerm]);

  const selectedDateKey = useMemo(() => format(selectedDate, 'yyyy-MM-dd'), [selectedDate]);
  const selectedExceptionalDay = useMemo(
    () => exceptionalDayMap.get(selectedDateKey) || null,
    [exceptionalDayMap, selectedDateKey]
  );
  const hasSelectedDayShifts = useMemo(
    () => filteredShifts.some(([day]) => day === selectedDateKey),
    [filteredShifts, selectedDateKey]
  );

  const prevMonth = useMemo(
    () => new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1),
    [monthCursor]
  );
  const nextMonth = useMemo(
    () => new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1),
    [monthCursor]
  );
  const hasPrevMonth = useMemo(
    () => availableMonthKeys.has(format(prevMonth, 'yyyy-MM')),
    [availableMonthKeys, prevMonth]
  );
  const hasNextMonth = useMemo(
    () => availableMonthKeys.has(format(nextMonth, 'yyyy-MM')),
    [availableMonthKeys, nextMonth]
  );

  const getLastShiftDateForMonth = (targetMonthKey: string) => {
    const monthShifts = shifts.filter(shift => {
      return format(new Date(shift.shiftDate), 'yyyy-MM') === targetMonthKey;
    });
    if (monthShifts.length === 0) return null;
    const latestShift = monthShifts.reduce((latest, current) => {
      return new Date(current.shiftDate).getTime() > new Date(latest.shiftDate).getTime()
        ? current
        : latest;
    });
    return new Date(latestShift.shiftDate);
  };

  const moveMonth = (direction: 'prev' | 'next') => {
    const target = direction === 'prev' ? prevMonth : nextMonth;
    const targetMonthKey = format(target, 'yyyy-MM');
    const lastShiftDate = getLastShiftDateForMonth(targetMonthKey);
    setMonthCursor(target);
    setSelectedDate(lastShiftDate ?? target);
    pendingScrollTarget.current = format(lastShiftDate ?? target, 'yyyy-MM-dd');
  };

  const quickSearchSummary = useMemo(() => {
    const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
    const selectedDayShifts = filteredShifts.find(([day]) => day === selectedDateStr);
    if (!selectedDayShifts) {
      return { totalEmployees: 0, presentEmployees: 0, absentEmployees: 0 };
    }
    const [, dayShifts] = selectedDayShifts;
    const totalEmployees = dayShifts.reduce((sum, shift) => sum + shift.assignments.length, 0);
    const absentEmployees = dayShifts.reduce((sum, shift) => sum + shift.assignments.filter(a => !!a.note).length, 0);
    const presentEmployees = totalEmployees - absentEmployees;
    return { totalEmployees, presentEmployees, absentEmployees };
  }, [filteredShifts, selectedDate]);

  // RAF-based pending scroll to a specific day once DOM is ready
  useEffect(() => {
    if (!pendingScrollTarget.current) return;
    if (loading) return;

    let attempts = 0;
    let rafId = 0 as number | undefined;
    const tick = () => {
      const key = pendingScrollTarget.current;
      if (!key) return;
      const el = dayRefs.current[key];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setExpandedCards(prev => {
          const s = new Set(prev);
          s.delete(key);
          return s;
        });
        pendingScrollTarget.current = null;
        return;
      }
      if (attempts++ < 20) {
        rafId = requestAnimationFrame(tick) as unknown as number;
      } else {
        scrollToTop();
        pendingScrollTarget.current = null;
      }
    };
    rafId = requestAnimationFrame(tick) as unknown as number;
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [loading, displayDays, selectedDate]);

  const toggleCard = (day: string) => {
    setExpandedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(day)) {
        newSet.delete(day);
      } else {
        newSet.add(day);
      }
      return newSet;
    });
  };

  const scrollToToday = () => {
    const today = new Date();
    setSelectedDate(today);
    setMonthCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    pendingScrollTarget.current = format(today, 'yyyy-MM-dd');
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



  // دالة العودة لأعلى الصفحة
  const scrollToTop = () => {
    try {
      // أولاً: جرب استخدام الـ ref إذا كان متاحاً
      if (topRef.current) {
        topRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      // ثانياً: البحث عن العنصر الأزرق في الأعلى (Header Section)
      const headerElement = document.querySelector('.bg-gradient-to-r.from-blue-500.to-blue-700');
      if (headerElement) {
        headerElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      // ثالثاً: البحث عن أي header
      const anyHeader = document.querySelector('h1') ||
                       document.querySelector('[class*="header"]') ||
                       document.querySelector('.space-y-6');

      if (anyHeader) {
        anyHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      // رابعاً: استخدم الطرق التقليدية
      window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (error) {
      console.error('Error scrolling:', error);
    }
  };

  // تحديث نتائج البحث عند تغيير البحث - يبحث في جميع الخفارات
  useEffect(() => {
    if (searchTerm.trim()) {
      const searchLower = normalizeArabic(searchTerm.trim());
      
      // Group all shifts by date first
      const allShiftsByDate = shifts.reduce((acc, shift) => {
        const dateKey = format(new Date(shift.shiftDate), 'yyyy-MM-dd');
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(shift);
        return acc;
      }, {} as Record<string, Shift[]>);

      // Find dates that contain the searched name
      const matchingDays = Object.entries(allShiftsByDate)
        .filter(([_, dayShifts]) => {
          return dayShifts.some(shift => {
            const shiftAssignments = assignments.filter(a => a.shiftId === shift.id);
            return shiftAssignments.some(assignment => {
              const employee = employees.find(e => e.id === assignment.employeeId);
              if (!employee) return false;
              
              return (
                normalizeArabic(employee.name || '').includes(searchLower) ||
                normalizeArabic(employee.rank || '').includes(searchLower) ||
                normalizeArabic(employee.fileNumber || '').includes(searchLower)
              );
            });
          });
        })
        .map(([date]) => date)
        .sort(); // Sort dates chronologically
      
      console.log('Search term:', searchTerm);
      console.log('Total shifts available for search:', shifts.length);
      console.log('Matching days found:', matchingDays);
      
      setSearchResults(matchingDays);
      setShowSearchResults(true);
    } else {
      setSearchResults([]);
      setShowSearchResults(false);
    }
  }, [searchTerm, shifts, assignments, employees]);

  const renderAbsenceModal = () => {
    if (!absenceModalData?.isOpen) return null;

    const { assignment, isEditing } = absenceModalData;
    const shift = processedShifts.find(s => s.assignments.some(a => a.id === assignment.id));

    return createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" dir="rtl">
        <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-gray-100">
          <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  {isEditing ? 'تعديل سبب الغياب' : 'تسجيل سبب الغياب'}
                </h3>
                <p className="text-xs text-gray-500">سجّل السبب المناسب للغياب قبل الحفظ</p>
              </div>
            </div>
            <button
              onClick={closeAbsenceModal}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-5 px-6 py-5">
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-center">
              <p className="text-base font-bold text-gray-900">{assignment.employee.rank} / {formatShiftEmployeeDisplayName(assignment.employee) || assignment.employee.name}</p>
              {shift && (
                <p className="mt-1 text-xs text-gray-500">
                  خفارة يوم {format(new Date(shift.shiftDate), 'eeee', { locale: arSA })} الموافق {format(new Date(shift.shiftDate), 'yyyy/MM/dd')}
                </p>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="absence-type" className="block text-sm font-semibold text-gray-700 mb-2">
                  سبب الغياب
                </label>
                <select
                  id="absence-type"
                  value={absenceType}
                  onChange={(e) => setAbsenceType(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                >
                  {absenceOptions.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>

              {absenceType === 'أخرى' && (
                <div>
                  <label htmlFor="other-reason" className="block text-sm font-semibold text-gray-700 mb-2">
                    الرجاء التحديد
                  </label>
                  <input
                    id="other-reason"
                    type="text"
                    value={otherAbsenceReason}
                    onChange={(e) => setOtherAbsenceReason(e.target.value)}
                    placeholder="أدخل السبب هنا..."
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={handleAbsenceSubmit}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                {isEditing ? 'تحديث السبب' : 'تسجيل السبب'}
              </button>
              {isEditing && assignment.note && (
                <button
                  onClick={() => {
                    deleteAbsenceReason(assignment.id);
                    closeAbsenceModal();
                  }}
                  className="flex-1 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 transition-colors"
                >
                  حذف السبب
                </button>
              )}
              <button
                onClick={closeAbsenceModal}
                className="flex-1 rounded-xl border border-gray-200 bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  const renderRemoveAssignmentModal = () => {
    if (!showRemoveModal || !assignmentToRemove) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <UserX className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">تأكيد إزالة الموظف</h3>
            <p className="text-gray-600 mb-2">
              هل أنت متأكد من إزالة الموظف
              {" "}
              <strong>{assignmentToRemove.employee.rank} - {formatShiftEmployeeDisplayName(assignmentToRemove.employee) || assignmentToRemove.employee.name}</strong>
              {" "}
              من هذه الخفارة؟
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6">
              <p className="text-red-800 text-sm font-medium">
                ⚠️ تحذير: هذا الإجراء نهائي ولا يمكن التراجع عنه
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleConfirmRemoveAssignment}
              disabled={isProcessingAssignment}
              className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isProcessingAssignment ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  جاري الإزالة...
                </>
              ) : (
                <>
                  <UserX size={16} />
                  إزالة
                </>
              )}
            </button>
            <button
              onClick={closeRemoveModal}
              disabled={isProcessingAssignment}
              className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors disabled:opacity-50"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderEditAssignmentModal = () => {
    if (!isEditAssignmentModalOpen || !assignmentToEdit) return null;

    return createPortal(
      <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[9999] p-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md transform transition-all duration-300 scale-95 hover:scale-100">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-xl font-bold text-gray-800">تعديل الموظف في الخفارة</h3>
            <button onClick={closeEditAssignmentModal} className="text-gray-400 hover:text-gray-600 transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">الموظف الحالي</label>
              <p className="bg-gray-100 p-3 rounded-lg text-gray-800 font-semibold">{formatShiftEmployeeDisplayName(assignmentToEdit.employee) || assignmentToEdit.employee.name}</p>
            </div>
            <div>
              <label htmlFor="new-employee-select" className="block text-sm font-medium text-gray-600 mb-1">اختر الموظف الجديد</label>
              <Select
                id="employee-select"
                options={employees.map(emp => ({ value: emp.id, label: `${emp.rank} / ${formatShiftEmployeeDisplayName(emp) || emp.name}` }))}
                onChange={(selectedOption) => setNewEmployeeId(selectedOption?.value || null)}
                placeholder="ابحث عن موظف أو اختر من القائمة..."
                isClearable
                isRtl
                noOptionsMessage={() => 'لم يتم العثور على موظفين'}
                styles={{
                  control: (base) => ({ ...base, padding: '0.3rem', borderRadius: '0.5rem' }),
                  menu: (base) => ({ ...base, zIndex: 50 }),
                }}
              />
            </div>
          </div>
          <div className="px-6 py-4 bg-gray-50 rounded-b-2xl flex justify-end space-x-3 space-x-reverse">
            <button
              onClick={closeEditAssignmentModal}
              disabled={isUpdatingAssignment}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              إلغاء
            </button>
            <button
              onClick={handleEditAssignmentSubmit}
              disabled={isUpdatingAssignment}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold shadow-md flex items-center justify-center disabled:bg-green-400 disabled:cursor-not-allowed"
            >
              حفظ التعديل
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  const renderDeleteModal = () => {
    if (!showDeleteModal || !shiftToDelete) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">تأكيد حذف الخفارة</h3>
            <p className="text-gray-600 mb-2">
              هل أنت متأكد من حذف خفارة تاريخ <strong>{format(new Date(shiftToDelete.shiftDate), 'yyyy/MM/dd', { locale: arSA })}</strong>؟
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6">
              <p className="text-red-800 text-sm font-medium">
                ⚠️ تحذير: هذا الإجراء نهائي ولا يمكن التراجع عنه
              </p>
              <p className="text-red-700 text-sm mt-1">
                سيتم حذف الخفارة وجميع التعيينات المرتبطة بها نهائياً
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleDeleteShift}
              disabled={isDeleting}
              className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isDeleting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  جاري الحذف...
                </>
              ) : (
                <>
                  <Trash2 size={16} />
                  حذف نهائي
                </>
              )}
            </button>
            <button
              onClick={closeDeleteModal}
              disabled={isDeleting}
              className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors disabled:opacity-50"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderDetailsModal = () => {
    if (!isDetailsModalOpen || !shiftToEditDetails) return null;

    return createPortal(
      <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[9999] p-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg transform transition-all duration-300 scale-95 hover:scale-100">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-xl font-bold text-gray-800">تعديل تفاصيل الخفارة</h3>
            <button onClick={closeDetailsModal} className="text-gray-400 hover:text-gray-600 transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label htmlFor="editShiftTitle" className="block text-sm font-medium text-gray-700 text-right mb-1">
                عنوان الخفارة
              </label>
              <input
                type="text"
                id="editShiftTitle"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="w-full pr-4 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                placeholder="مثلاً: عيد الأضحى"
              />
            </div>
            <div>
              <label htmlFor="editShiftNotes" className="block text-sm font-medium text-gray-700 text-right mb-1">
                ملاحظات
              </label>
              <textarea
                id="editShiftNotes"
                value={editedNotes}
                onChange={(e) => setEditedNotes(e.target.value)}
                rows={4}
                className="w-full pr-4 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                placeholder="أضف أي ملاحظات إضافية هنا"
              />
            </div>
          </div>
          <div className="px-6 py-4 bg-gray-50 rounded-b-2xl flex justify-end space-x-3 space-x-reverse">
            <button
              onClick={closeDetailsModal}
              disabled={isSavingDetails}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              onClick={handleSaveDetails}
              disabled={isSavingDetails}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-md flex items-center justify-center disabled:bg-blue-400"
            >
              {isSavingDetails ? 'جارٍ الحفظ...' : <><Save size={18} className="ml-2" /> حفظ التعديلات</>}
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  return (
    <div className="min-h-screen p-4 space-y-8" dir="rtl" ref={topRef}>
      {renderAbsenceModal()}
      {renderDeleteModal()}
      {renderRemoveAssignmentModal()}
      {renderEditAssignmentModal()}
      {renderAddAssignmentModal()}
      {renderDetailsModal()}

      <PageHeader
        icon={<FileText size={36} />}
        title="كشوفات الخفارات"
        description="عرض وإدارة جميع الخفارات المسجلة في النظام"
      />

      {/* Smart Controls Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Smart Search and Navigation */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200/70 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 via-blue-500 to-blue-700 px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <Search className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">البحث والتنقل</h3>
                  <p className="text-xs text-blue-100">تنقّل سريع بين الخفارات</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="p-6">
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="relative">
                  <Search className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  {searchTerm.trim() && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      aria-label="مسح البحث"
                      title="مسح البحث"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  <input
                    type="text"
                    placeholder="ابحث بالاسم أو الرتبة أو رقم الملف..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pr-12 pl-12 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm"
                  />
                </div>
                
                {showSearchResults && searchResults.length > 0 && (
                  <div className="mt-3 rounded-xl border border-blue-200/70 bg-white p-3 shadow-sm">
                    <div className="text-sm font-semibold text-blue-800 mb-2">
                      الأيام التي تحتوي على نتائج ({searchResults.length} يوم)
                    </div>
                    <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                      {searchResults.map(date => {
                        const dateObj = new Date(date);
                        const isCurrentMonth = dateObj.getMonth() === selectedDate.getMonth() && dateObj.getFullYear() === selectedDate.getFullYear();
                        const monthLabel = format(dateObj, 'MM/yyyy', { locale: arSA });
                        
                        return (
                          <button
                            key={date}
                            onClick={() => {
                              const targetDate = new Date(date);
                              setSelectedDate(targetDate);
                              setMonthCursor(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1));
                              // Use unified RAF-based pending scroll
                              pendingScrollTarget.current = format(targetDate, 'yyyy-MM-dd');
                            }}
                            className={`px-2 py-1 text-xs rounded-md transition-colors ${isCurrentMonth ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'}`}
                            title={`تاريخ: ${format(dateObj, 'yyyy/MM/dd', { locale: arSA })}${!isCurrentMonth ? ` - شهر: ${monthLabel}` : ''}`}
                          >
                            {format(dateObj, 'dd/MM', { locale: arSA })}
                            {!isCurrentMonth && (
                              <span className="ml-1 text-xs">({monthLabel})</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                
                {showSearchResults && searchResults.length === 0 && searchTerm.trim() && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
                    لا توجد نتائج مطابقة
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="relative datepicker-container" ref={datePickerContainerRef}>
                    <button
                      ref={buttonRef}
                      onClick={() => {
                        if (buttonRef.current) {
                          setButtonRect(buttonRef.current.getBoundingClientRect());
                        }
                        setShowDatePicker(!showDatePicker);
                      }}
                      className="w-full pr-3 pl-4 py-3 z-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-right bg-white shadow-sm hover:border-gray-400 transition-colors flex items-center justify-normal"
                    >
                      <Calendar className="w-5 h-5 text-gray-400" />                     
                      <span className="text-gray-900 pr-3">
                        {format(selectedDate, 'EEEE، dd MMMM yyyy', { locale: arSA })}
                      </span>
                    </button>

                    {showDatePicker && buttonRect && createPortal(
                      <div
                        className="fixed bg-white border border-gray-300 rounded-lg shadow-xl p-4 min-w-[300px] datepicker-dropdown"
                        style={{
                          top: buttonRect.bottom + 4,
                          left: buttonRect.left,
                          zIndex:9999
                        }}
                        ref={datePickerDropdownRef}
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
                          {generateCalendarDays(selectedDate).map((day, index) => (
                            <button
                              key={index}
                              onClick={() => {
                                if (day) {
                                  setSelectedDate(day);
                                  setMonthCursor(new Date(day.getFullYear(), day.getMonth(), 1));
                                  setShowDatePicker(false);
                                  // Use unified RAF-based pending scroll
                                  pendingScrollTarget.current = format(day, 'yyyy-MM-dd');
                                }
                              }}
                              disabled={!day}
                              className={`
                                h-8 text-sm rounded transition-colors
                                ${!day ? 'invisible' : ''}
                                ${day && format(day, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd')
                                  ? 'bg-blue-600 text-white'
                                  : 'hover:bg-gray-100 text-gray-900'
                                }
                                ${day && format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
                                  ? 'ring-2 ring-blue-300'
                                  : ''
                                }
                              `}
                            >
                              {day ? day.getDate() : ''}
                            </button>
                          ))}
                        </div>

                        {/* زر إغلاق */}
                        <div className="mt-4 flex justify-end">
                          <button
                            onClick={() => setShowDatePicker(false)}
                            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
                          >
                            إغلاق
                          </button>
                        </div>
                      </div>, document.body
                    )}
                  </div>
                </div>
                
                <div>
                  <button
                    onClick={scrollToToday}
                    className="w-full px-4 py-3.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors text-sm font-semibold shadow-sm"
                  >
                    الذهاب لتاريخ اليوم الحالي
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Smart Date Summary */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200/70 overflow-hidden">
          <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">الخفارات غير المستلمة</h3>
                  <p className="text-xs text-amber-100">متابعة الخفارات المتأخرة</p>
                </div>
              </div>
              <span className="hidden md:inline-flex items-center rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white">
                {shifts.filter(s => {
                  const shiftDate = new Date(s.shiftDate);
                  const today = new Date();
                  shiftDate.setHours(0, 0, 0, 0);
                  today.setHours(0, 0, 0, 0);
                  return !s.paperCopyReceived && shiftDate < today;
                }).length} خفارة متأخرة
              </span>
            </div>
          </div>
          
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <span className="w-2.5 h-2.5 bg-red-500 rounded-full"></span>
                خفارات متأخرة في التسليم
              </div>
              <span className="text-xs font-semibold bg-red-100 text-red-700 px-3 py-1 rounded-full">
                {shifts.filter(s => {
                  const shiftDate = new Date(s.shiftDate);
                  const today = new Date();
                  shiftDate.setHours(0, 0, 0, 0);
                  today.setHours(0, 0, 0, 0);
                  return !s.paperCopyReceived && shiftDate < today;
                }).length} خفارة
              </span>
            </div>
            
            {shifts.filter(s => {
              const shiftDate = new Date(s.shiftDate);
              const today = new Date();
              shiftDate.setHours(0, 0, 0, 0);
              today.setHours(0, 0, 0, 0);
              return !s.paperCopyReceived && shiftDate < today;
            }).length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 max-h-40 overflow-y-auto">
                {shifts
                  .filter(s => {
                    const shiftDate = new Date(s.shiftDate);
                    const today = new Date();
                    shiftDate.setHours(0, 0, 0, 0);
                    today.setHours(0, 0, 0, 0);
                    return !s.paperCopyReceived && shiftDate < today;
                  })
                  .sort((a, b) => new Date(a.shiftDate).getTime() - new Date(b.shiftDate).getTime())
                  .map(shift => (
                    <div 
                      key={shift.id} 
                      className="text-xs font-bold text-red-700 bg-white border border-red-200 px-2 py-1 rounded-lg text-center cursor-pointer hover:bg-red-50 transition-colors"
                      onClick={() => {
                        const targetDate = new Date(shift.shiftDate);
                        setSelectedDate(targetDate);
                        setMonthCursor(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1));
                        // Use unified RAF-based pending scroll
                        pendingScrollTarget.current = format(targetDate, 'yyyy-MM-dd');
                      }}
                    >
                      {format(new Date(shift.shiftDate), 'dd/MM')}
                    </div>
                  ))
                }
              </div>
            ) : (
              <div className="text-center py-4 text-slate-500 text-sm">
                جميع الخفارات مستلمة
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/70 px-6 py-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <button
            type="button"
            onClick={() => moveMonth('next')}
            disabled={!hasNextMonth}
            className="order-3 inline-flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-6 py-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="flex flex-col text-right leading-tight">
              <span className="font-black">الشهر التالي</span>
              <span className="text-md font-bold text-green-600">
                {format(nextMonth, 'MMMM', { locale: arSA })}
              </span>
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm">
              <ChevronDown className="h-4 w-4 rotate-90" />
            </span>
          </button>
          <div className="order-2 flex items-center gap-3 text-right">
            <Calendar className="h-5 w-5 text-slate-500" />
            <span className="text-xs font-semibold text-slate-500">الشهر الحالي</span>
            <span className="h-4 w-px bg-slate-200" />
            <span className="text-2xl font-black text-green-600">
              {format(monthCursor, 'MMMM', { locale: arSA })}
            </span>
            <span className="h-4 w-px bg-slate-200" />
            <span className="text-sm font-semibold text-slate-500">
              {format(monthCursor, 'yyyy', { locale: arSA })}
            </span>
          </div>
          <button
            type="button"
            onClick={() => moveMonth('prev')}
            disabled={!hasPrevMonth}
            className="order-1 inline-flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-6 py-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm">
              <ChevronDown className="h-4 w-4 -rotate-90" />
            </span>
            <span className="flex flex-col text-right leading-tight">
              <span className="font-black">الشهر السابق</span>
              <span className="text-md font-bold text-green-600">
                {format(prevMonth, 'MMMM', { locale: arSA })}
              </span>
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Quick Search Result */}
      {quickSearchActive && !loading && (
        hasSelectedDayShifts ? (
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-blue-900">جدول خفارة {format(selectedDate, 'yyyy/MM/dd', { locale: arSA })}</h3>
                <p className="text-blue-700 text-sm">عرض تفاصيل الموظفين والحضور</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const currentShift = filteredShifts[0];
                    if (currentShift && currentShift[1].length > 0) {
                      const firstShift = currentShift[1][0];
                      handleExportWord(firstShift, currentShift[1].map(s => ({ shiftDate: s.shiftDate, assignments: s.assignments })), employees);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  تصدير
                </button>
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  طباعة
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white/80 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                ملخص جدول الخفارة
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
                  الإجمالي: {quickSearchSummary.totalEmployees}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                  حضور: {quickSearchSummary.presentEmployees}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-700">
                  غياب: {quickSearchSummary.absentEmployees}
                </span>
              </div>
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200/70 bg-white">
              <table className="w-full">
              <thead className="bg-gradient-to-r from-green-50 to-green-100">
                <tr>
                  <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">م</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">الرتبة</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">الاسم</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">رقم الملف</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">رقم الهاتف</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">المسمى الوظيفي</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">الادارة</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">ملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {(() => {
                  // الحصول على خفارة التاريخ المحدد فقط
                  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
                  const selectedDayShifts = filteredShifts.find(([day]) => day === selectedDateStr);

                  if (!selectedDayShifts) return null;

                  const [, dayShifts] = selectedDayShifts;
                  let employeeIndex = 0;

                  return dayShifts.map(shift =>
                    shift.assignments.map((assignment) => {
                      employeeIndex++;
                      return (
                        <tr key={assignment.id} className={`hover:bg-blue-50 transition-colors ${assignment.note ? 'bg-red-50' : ''}`}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{employeeIndex}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">{assignment.employee.rank}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            <button
                              type="button"
                              onClick={() => goToEmployeeShiftHistory(assignment.employee)}
                              className="flex items-center font-bold gap-2 text-blue-700 hover:text-blue-800 hover:underline underline-offset-2 transition-colors"
                              title="عرض سجل خفارات الموظف"
                            >
                              {highlightSearchTerm(formatShiftEmployeeDisplayName(assignment.employee) || assignment.employee.name, searchTerm)}
                              {assignment.note && (
                                <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full" title={assignment.note}>
                                  <AlertCircle className="w-3 h-3 inline" />
                                </span>
                              )}
                            </button>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {highlightSearchTerm(assignment.employee.fileNumber || '-', searchTerm)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{assignment.employee.phone_number || '-'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{assignment.employee.jobTitle || "-"}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatDepartmentLabel(assignment.employee.department) || 'غير مسجل'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{assignment.note || '-'}</td>
                        </tr>
                      );
                    })
                  );
                })()}
              </tbody>
            </table>
            </div>
          </div>

          {/* Summary Footer */}
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
            <div className="flex justify-between items-center text-sm">
              <div className="flex gap-6">
                {(() => {
                  // حساب الإحصائيات للتاريخ المحدد فقط
                  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
                  const selectedDayShifts = filteredShifts.find(([day]) => day === selectedDateStr);

                  if (!selectedDayShifts) {
                    return (
                      <>
                        <span className="text-gray-600">إجمالي الموظفين: <span className="font-bold text-gray-900">0</span></span>
                      </>
                    );
                  }

                  const [, dayShifts] = selectedDayShifts;
                  const totalEmployees = dayShifts.reduce((sum, shift) => sum + shift.assignments.length, 0);
                  const absentEmployees = dayShifts.reduce((sum, shift) => sum + shift.assignments.filter(a => !!a.note).length, 0);
                  const presentEmployees = totalEmployees - absentEmployees;

                  return (
                    <>
                      <span className="text-gray-600">
                        إجمالي الموظفين: <span className="font-bold text-gray-900">{totalEmployees}</span>
                      </span>
                      <span className="text-green-600">
                        حضور: <span className="font-bold">{presentEmployees}</span>
                      </span>
                      <span className="text-red-600">
                        غياب: <span className="font-bold">{absentEmployees}</span>
                      </span>
                    </>
                  );
                })()}
              </div>
              <div className="text-gray-500">
                تاريخ الخفارة: {format(selectedDate, 'EEEE، dd MMMM yyyy', { locale: arSA })}
              </div>
            </div>
          </div>
        </div>
        ) : selectedExceptionalDay ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-6 text-right shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                <ShieldCheck size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-amber-900">
                  يوم استثنائي بتاريخ {format(selectedDate, 'yyyy/MM/dd', { locale: arSA })}
                </h3>
                <p className="text-sm text-amber-700">لا يوجد خفارة</p>
                <p className="text-sm text-amber-700">القوة بالكامل متواجدة</p>
              </div>
            </div>
            <div className="text-sm text-amber-800">
              السبب : <span className="font-semibold">{selectedExceptionalDay.reason || 'غير محدد'}</span>
            </div>
            {selectedExceptionalDay.note && (
              <div className="text-sm text-amber-700 mt-1">
                ملاحظات: <span className="font-semibold">{selectedExceptionalDay.note}</span>
              </div>
            )}
            <button
              onClick={() => {
                setQuickSearchActive(false);
                const now = new Date();
                setSelectedDate(now);
                setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
              }}
              className="mt-4 px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-medium transition-all"
            >
              العودة للعرض العادي
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-12 text-center">
            <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">لا توجد خفارة في هذا التاريخ</h3>
            <p className="text-gray-600 mb-4">
              لم يتم العثور على خفارة مسجلة في تاريخ {format(selectedDate, 'yyyy/MM/dd', { locale: arSA })}
            </p>
            <button
              onClick={() => {
                setQuickSearchActive(false);
                const now = new Date();
                setSelectedDate(now);
                setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
              }}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-all"
            >
              العودة للعرض العادي
            </button>
          </div>
        )
      )}

      {loading ? (
        <LoadingPage variant="shifts" />
      ) : displayDays.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center shadow-lg border border-gray-100">
          <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-gray-400 mb-4" />
          </div>  
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchTerm.trim() ? 'لا توجد خفارات تطابق البحث' : 'لا توجد خفارات لهذا الشهر'}
          </h3>
          <p className="text-gray-500">
            {searchTerm.trim()
              ? 'لا توجد خفارات مطابقة لكلمة البحث المدخلة.'
              : `لا توجد خفارات مسجلة خلال شهر ${format(monthCursor, 'MMMM yyyy', { locale: arSA })}.`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayDays.map(({ day, dayShifts, exceptional }) => {
            const isExpanded = !expandedCards.has(day);
            const shift = dayShifts[0];
            const isExceptionalDay = !!exceptional && !shift;
            if (!shift && !isExceptionalDay) {
              return null;
            }
            const totalAssignments = shift?.assignments?.length || 0;
            const absentAssignments = shift?.assignments?.filter(a => !!a.note).length || 0;
            const presentAssignments = totalAssignments - absentAssignments;
            const shiftDate = new Date(shift ? shift.shiftDate : day);
            const today = new Date();
            shiftDate.setHours(0, 0, 0, 0);
            today.setHours(0, 0, 0, 0);
            const isPastShift = shiftDate < today;
            const isReceived = !!shift?.paperCopyReceived;
            const headerTone = isExceptionalDay
              ? 'border-amber-200/70 bg-gradient-to-br from-amber-100 via-amber-50 to-amber-100'
              : isReceived
                ? 'border-emerald-200/70 bg-gradient-to-br from-emerald-100 via-emerald-50 to-emerald-100'
                : 'border-slate-200/70 bg-gradient-to-br from-white via-slate-50 to-slate-100';
            const dateAccent = isExceptionalDay ? 'text-amber-700' : isReceived ? 'text-green-700' : 'text-blue-700';


            return (
              <div
                key={day}
                ref={el => (dayRefs.current[day] = el)}
                className={`border rounded-3xl transition-all duration-300 ${
                  isExceptionalDay
                    ? 'bg-amber-50 border-amber-200'
                    : isReceived
                      ? 'bg-green-50 border-green-200'
                      : 'bg-white border-gray-200'
                } ${
                  isExpanded ? 'shadow-md' : ''
                }`}
              >
                <div className="p-4">
                  <div className={`rounded-2xl border ${headerTone} p-4 shadow-sm`}>
                    <div className="flex flex-col gap-4">
                      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] items-start">
                        <div className="hidden lg:block" aria-hidden="true" />
                        <div className="flex flex-col items-center text-center gap-2">
                          <div className="flex flex-wrap items-center justify-center gap-3 text-sm font-semibold text-slate-700">
                            <div className="inline-flex items-center gap-2">
                              <span className={`flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm ${
                                isExceptionalDay
                                  ? 'border-amber-200/70 bg-amber-100 text-amber-600'
                                  : isReceived
                                    ? 'border-emerald-200/70 bg-emerald-100 text-emerald-600'
                                    : 'border-slate-200 bg-white text-blue-500'
                              }`}>
                                <Calendar className={`w-4 h-4 ${dateAccent}`} />
                              </span>
                              <span className="text-slate-500 mt-0.5 mr-2">تاريخ الخفارة</span>
                            </div>
                            <span className="hidden md:inline-block h-4 w-px bg-slate-200"></span>
                            <div className="flex flex-wrap items-center justify-center gap-2 font-black text-slate-800">
                              <span className="text-slate-500 font-medium">يوم</span>
                              <p className={`${dateAccent} text-xl`}>
                                {format(new Date(day), 'EEEE', { locale: arSA })}
                              </p>
                              <span className="text-slate-500 font-medium">الموافق</span>
                              <p className={`${dateAccent} text-xl`}>
                                {format(new Date(day), 'yyyy/MM/dd')}
                              </p>
                            </div>
                          </div>
                          {(shift?.title || shift?.notes) && (
                            <div className="flex flex-wrap items-center justify-center gap-2">
                              {shift?.title && (
                                <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
                                  {shift.title}
                                </span>
                              )}
                              {shift?.notes && (
                                <span className="text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full">
                                  {shift.notes}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 justify-center lg:justify-end">
                          {isExceptionalDay ? (
                            <span className="text-xs font-bold shadow-sm text-amber-800 bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-full inline-flex items-center gap-2">
                              <ShieldCheck className="w-4 h-4" />
                              يوم استثنائي
                            </span>
                          ) : isReceived ? (
                            <span className="text-xs shadow-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full inline-flex items-center gap-2">
                              <CheckCircle className="w-4 h-4" />
                              تم الاستلام
                            </span>
                          ) : isPastShift ? (
                            <span className="text-xs font-bold shadow-sm text-red-700 bg-red-50 border border-red-300 px-3 py-1.5 rounded-full inline-flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4" />
                              تأخير في الإستلام
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleCard(day);
                            }}
                            className="text-xs font-semibold text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-full inline-flex items-center gap-2 transition-colors hover:bg-slate-50"
                          >
                            {isExpanded ? 'إخفاء الجدول' : 'عرض الجدول'}
                            <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
                          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1">
                            الإجمالي: {totalAssignments}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                            حضور: {presentAssignments}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-700">
                            غياب: {absentAssignments}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {!isExceptionalDay && isPastShift && shift && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleReception(shift.id, shift.paperCopyReceived);
                              }}
                              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors shadow-sm ${
                                shift.paperCopyReceived
                                  ? 'bg-red-600 text-white hover:bg-red-700'
                                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
                              }`}
                            >
                              {shift.paperCopyReceived ? (
                                <X className="w-4 h-4" />
                              ) : (
                                <CheckCircle className="w-4 h-4" />
                              )}
                              {shift.paperCopyReceived ? 'إلغاء الاستلام' : 'تأكيد الاستلام'}
                            </button>
                          )}
                          {!isExceptionalDay && shift?.title && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openDetailsModal(shift);
                              }}
                              className="p-2.5 rounded-full transition-colors bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                              title="تعديل تفاصيل الخفارة"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {!isExceptionalDay && shift && (
                            <>
                              <button
                                onClick={() => handleExportWord(shift, dayShifts, employees)}
                                className="p-2.5 rounded-full transition-colors bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
                                title="تصدير إلى Word"
                              >
                                <FileText className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); openAddEmployeeModal(shift); }}
                                disabled={isProcessingAssignment}
                                className="p-2.5 rounded-full transition-colors bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="إضافة موظف للخفارة"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDeleteModal(shift);
                                }}
                                className="p-2.5 rounded-full transition-colors bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                                title="حذف الخفارة نهائياً"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {isExceptionalDay && exceptional && (
                            <button
                              onClick={() => handleDeleteExceptionalDay(exceptional)}
                              className="p-2.5 rounded-full transition-colors bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-200"
                              title="حذف الاستثناء"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {isExpanded && (
                  <div className="border-t border-gray-100">
                    {isExceptionalDay ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center text-amber-900">
                        <div className="text-xl font-black">يوم استثنائي</div>
                        <div className="text-sm font-semibold mt-2">لا يوجد خفارة</div>
                        <div className="text-sm font-semibold">القوة بالكامل متواجدة</div>
                        <div className="text-sm font-semibold mt-1">
                          السبب : {exceptional?.reason || 'غير محدد'}
                        </div>
                      </div>
                    ) : (
                      <div className="w-full overflow-x-auto pb-4">
                        <table className="min-w-full w-full divide-y divide-gray-200">
                        <thead className={`bg-gradient-to-t from-${isReceived ? 'green-100' : 'gray-50'} to-${isReceived ? 'green-50' : 'gray-50'}`}>
                          <tr>
                            <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">م</th>
                            <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">الرتبة</th>
                            <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">الاسم</th>
                            <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">رقم الملف</th>
                            <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">رقم الهاتف</th>
                            <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">المسمى الوظيفي</th>
                            <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">الادارة</th>
                            <th className="px-6 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">ملاحظات</th>
                            <th className="px-6 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">إجراء</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {shift?.assignments?.map((assignment, index) => (
                            <tr
                              key={assignment.id}
                              className={`transition-colors ${isReceived ? 'hover:bg-green-100' : 'hover:bg-gray-100'}`}
                            >
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{index + 1}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                                {highlightSearchTerm(assignment.employee.rank, searchTerm)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                <button
                                  type="button"
                                  onClick={() => goToEmployeeShiftHistory(assignment.employee)}
                                  className="flex items-center font-bold gap-2 hover:text-blue-700 transition-colors"
                                  title="عرض سجل خفارات الموظف"
                                >
                                  {highlightSearchTerm(formatShiftEmployeeDisplayName(assignment.employee) || assignment.employee.name, searchTerm)}
                                  {assignment.note && (
                                    <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full" title={assignment.note}>
                                      <AlertCircle className="w-3 h-3 inline" />
                                    </span>
                                  )}
                                </button>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                {highlightSearchTerm(assignment.employee.fileNumber || '-', searchTerm)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{assignment.employee.phone_number || '-'}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{assignment.employee.jobTitle || '-'}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {formatDepartmentLabel(assignment.employee.department) || 'غير مسجل'}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{assignment.note || '-'}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-center">
                                <div className="flex items-center justify-center gap-2">
                                  {(() => {
                                    // Show controls only for selected date, previous day, or next day
                                    const shiftDate = new Date(shift.shiftDate);
                                    const sd = new Date(selectedDate);
                                    shiftDate.setHours(0, 0, 0, 0);
                                    sd.setHours(0, 0, 0, 0);
                                    const withinRange = Math.abs((+shiftDate - +sd) / 86400000) <= 1;

                                    // For not-received shifts: always show Add (regardless of date)
                                    if (!isReceived) {
                                      // Not received: show only Add (use existing note to prefill if present)
                                      return (
                                        <button
                                          onClick={() => openAbsenceModal(assignment, Boolean(assignment.note))}
                                          className="p-1.5 text-blue-600 hover:text-blue-800 transition-colors"
                                          title={assignment.note ? 'تعديل/إضافة سبب الغياب' : 'إضافة سبب الغياب'}
                                        >
                                          <UserX className="w-4 h-4" />
                                        </button>
                                      );
                                    }

                                    // For received shifts: only show when within selected date ±1 day
                                    if (!withinRange) return null;

                                    // Received: show Edit only when a note exists; no separate Delete button
                                    return assignment.note ? (
                                      <button
                                        onClick={() => openAbsenceModal(assignment, true)}
                                        className="p-1.5 text-amber-600 hover:text-amber-800 transition-colors"
                                        title="تعديل سبب الغياب"
                                      >
                                        <Edit3 className="w-4 h-4" />
                                      </button>
                                    ) : null;
                                  })()}
                                  {/* Edit and remove are always available regardless of date */}
                                  <button
                                    onClick={() => openEditAssignmentModal(assignment)}
                                    className="p-1.5 text-green-600 hover:text-green-800 transition-colors"
                                    title="تعديل الموظف"
                                  >
                                    <UserCog className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => openRemoveModal(assignment)}
                                    disabled={isProcessingAssignment}
                                    className="p-1.5 text-red-600 hover:text-red-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="إزالة من الخفارة"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ScrollToTop className="bottom-20" />
      <ScrollToBottom ariaLabel="العودة لنهاية الصفحة" title="العودة لنهاية الصفحة" />


    </div>
  );
};

// تصدير الخفارة الحالية إلى Word
async function handleExportWord(shift: Shift, dayShifts: { shiftDate: string; assignments: ShiftAssignment[] }[], employees: Employee[]) {
  // تجهيز بيانات الجدول
  const rows = dayShifts[0].assignments.map((assignment: ShiftAssignment, idx: number) => {
    const employee = employees.find(e => e.id === assignment.employeeId);
    return {
      index: idx + 1,
      rank: employee?.rank || '',
      name: employee ? formatEmployeeNameByParts(employee, 3) || employee.name || '' : '',
      fileNumber: employee?.fileNumber || '',
      nationalId: employee?.phone_number || '-', // This should be 'النقال' (phone_number)
      jobTitle: employee?.jobTitle || '-',
      department: normalizeOrganizationName(employee?.department || ''),
      attendance: '', // يمكن إضافة منطق الحضور لاحقًا
      leave: '',      // يمكن إضافة منطق الانصراف لاحقًا
      notes: assignment.note || '',
    };
  });

  // تجهيز التاريخ (العنوان)
  const dateStr = `يوم ${format(new Date(shift.shiftDate), 'EEEE', { locale: arSA })} الموافق ${format(new Date(shift.shiftDate), 'd/M/yyyy')}`;

  // تجهيز الملاحظات (مطابقة للصورة)
  const notes = [
    'ملاحظات:',
    '1- الخفارة تبدأ من الساعة 7:00 مساءً إلى الساعة 12:00 صباحاً.',
    '2- على السادة ضباط الخفارات التأكد على المناوبين قبل مواعيد خفاراتهم وتدوين أية ملاحظات بدفتر الأحوال.',
    '3- على الضباط وضباط الصف والأفراد المناوبين أن يكونوا على علم بأن يوم الخفارة كاملاً تحت مسؤوليتهم وأن يكونوا على أتم الاستعداد عند طلبهم عن طريق الهاتف في أي وقت.',
    '4- على السادة ضباط الخفارات إبلاغ المدير العام في حال حضور أو مغادرة المدير العام.',
    '5- عبر جهة الالتزام بما جاء بالقرار الوزاري رقم (2020/696) بشأن حظر التدخين بالجهة.',
    '6- على ضابط الخفارة التأكد من صيانة ونظافة دورية وسيارة الجهة التابعة لمندوب الخفارة بناءً على التعميم الداخلي رقم (2024/2) وتدوين أي ملاحظات في دفتر الأحوال.',
  ];

  // توقيع المدير
  const manager = 'مدير عام\nالإدارة العامة\nالمدير العام';

  // تصدير
  await exportShiftsToWord({
    date: dateStr,
    rows,
    notes,
    manager,
  });
}


export default ViewShifts;
