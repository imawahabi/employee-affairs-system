import React, { useState, useEffect, useMemo } from 'react';
// TEMP: For CSV bulk upload
import Papa from 'papaparse';
import { Search, Edit, Trash2, Plus, Users, Phone, Calendar, User, Building, FileText, Shield, Car, ClipboardList, Hash, Globe, X, Ribbon, Filter, Briefcase, ListOrdered } from 'lucide-react';
import { fetchEmployees, fetchDepartments, fetchRanks, fetchNationalities, deleteEmployee, fetchSections, updateEmployeeManualOrder } from '../api';
import { getCategoryOrder, getRankOrder } from '../utils/rankOrder';
import { formatEmployeeDisplayName } from '../utils/employeeDisplay';
import { getSearchTokens, matchesArabicSearch, normalizeArabicSearch } from '../utils/search';
import { getStatisticsEmployeeBuckets } from '../utils/employeeStatistics';
import {
  isSameOrganizationName,
  buildDepartmentNameMap,
  buildSectionNameMap,
  resolveDepartmentName,
  resolveSectionName
} from '../utils/organization';
import { Employee, Department, Rank, Nationality, Section } from '../types';
import EmployeeModal from './EmployeeModal';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import LoadingPage from './LoadingPage';
import ScrollToTop from './UI/ScrollToTop';
import PageHeader from './UI/PageHeader';
import ForceWordSyncModal from './ForceWordSyncModal';
import { format } from 'date-fns';
import { arSA } from 'date-fns/locale';
import { toast } from 'react-hot-toast';
import { useSystem } from '../contexts/SystemContext';

const normalizeArabicText = normalizeArabicSearch;

const wrapLabel = (value: string, maxLength = 25) => {
  if (value.length <= maxLength) return value;
  const words = value.split(' ').filter(Boolean);
  const lines: string[] = [];
  let currentLine = '';
  words.forEach((word) => {
    const next = currentLine ? `${currentLine} ${word}` : word;
    if (next.length > maxLength && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = next;
    }
  });
  if (currentLine) lines.push(currentLine);
  return lines.join('\n');
};

const getNationalitySearchTerms = (value: string) => {
  const normalized = normalizeArabicText(value);
  if (!normalized) return [];
  const variants = new Set<string>([normalized]);
  const withoutAl = normalized.replace(/^ال/, '');
  if (withoutAl) {
    variants.add(withoutAl);
    variants.add(`ال${withoutAl}`);
  }
  const base = withoutAl || normalized;
  if (base.endsWith('ه')) {
    variants.add(`${base.slice(0, -1)}ي`);
  } else if (!base.endsWith('ي')) {
    variants.add(`${base}ي`);
  }
  if (normalized.endsWith('ي')) {
    const baseNoY = normalized.slice(0, -1);
    if (baseNoY) {
      variants.add(baseNoY);
      variants.add(`ال${baseNoY}`);
    }
  }
  return Array.from(variants);
};

type BulkEmployeeRow = {
  fileNumber: string;
  name: string;
  category: string;
  rank: string;
  jobTitle: string;
  department: string;
  status: 'active' | 'inactive';
  reasonIfInactive: string;
  phone_number: string;
};

const normalizeBulkCategory = (value: string): Employee['category'] => {
  const trimmed = value.trim();
  if (trimmed === 'قيادات' || trimmed === 'قيادات') return 'قيادات';
  if (trimmed === 'مشرفون' || trimmed === 'مشرفون') return 'مشرفون';
  if (trimmed === 'فنيون' || trimmed === 'فني') return 'فنيون';
  if (trimmed === 'إداريون' || trimmed === 'إداري') return 'إداريون';
  return 'إداريون';
};

const EmployeeManagement: React.FC = () => {
  const { hideShifts } = useSystem();
  // TEMP: Bulk upload state
  const [bulkUploadError, setBulkUploadError] = useState<string | null>(null);
  const [bulkPreviewEmployees, setBulkPreviewEmployees] = useState<BulkEmployeeRow[]>([]); // بيانات preview
  const [bulkUploadResults, setBulkUploadResults] = useState<any[]>([]); // نتائج الإضافة
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkDuplicates, setBulkDuplicates] = useState<BulkEmployeeRow[]>([]); // التكرارات
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const tableTopRef = React.useRef<HTMLDivElement | null>(null);
  const inactiveTableRef = React.useRef<HTMLDivElement | null>(null);
  const hasPagedRef = React.useRef(false);

  const handleBulkFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setBulkUploadError(null);
    setBulkPreviewEmployees([]);
    setBulkUploadResults([]);
    setBulkDuplicates([]);
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results: any) => {
        if (results.errors && results.errors.length > 0) {
          setBulkUploadError('خطأ في قراءة الملف. تأكد من أن الملف بصيغة CSV صحيحة.');
          return;
        }
        // بناء الحقول حسب Employee
        const newEmployees: BulkEmployeeRow[] = results.data.map((row: any) => ({
          fileNumber: row.fileNumber || row['رقم الملف'] || '',
          name: row.name || row['الاسم'] || '',
          category: row.category || row['الفئة'] || '',
          rank: row.rank || row['المسمى الوظيفي'] || '',
          jobTitle: row.jobTitle || row['المسمى الوظيفي'] || '',
          department: row.department || row['القسم'] || '',
          status: (() => {
            const raw = String(row.status || row['الحالة'] || 'active').toLowerCase();
            const isInactive = raw.includes('inactive') || raw.includes('غير نشط') || raw.includes('خارج الخدمة') || raw.includes('خارج');
            return isInactive ? 'inactive' : 'active';
          })(),
          reasonIfInactive: row.reasonIfInactive || row['سبب التعطيل'] || '',
          phone_number: row.phone_number || row['رقم الهاتف'] || '',
        }));
        // كشف التكرارات داخل الملف
        const fileNumberCount: Record<string, number> = {};
        newEmployees.forEach((emp) => {
          if (emp.fileNumber) fileNumberCount[emp.fileNumber] = (fileNumberCount[emp.fileNumber] || 0) + 1;
        });
        const inFileDuplicates = newEmployees.filter((emp) => emp.fileNumber && fileNumberCount[emp.fileNumber] > 1);
        // كشف التكرارات مع قاعدة البيانات
        let dbDuplicates: any[] = [];
        try {
          const existing = await fetchEmployees();
          const existingFileNumbers = new Set(existing.map((e: any) => e.fileNumber));
          dbDuplicates = newEmployees.filter((emp) => emp.fileNumber && existingFileNumbers.has(emp.fileNumber));
        } catch (err) {
          setBulkUploadError('تعذر التحقق من التكرارات في قاعدة البيانات');
        }
        // دمج التكرارات (مع حذف التكرار)
        const allDuplicates = [...new Map([...inFileDuplicates, ...dbDuplicates].map(item => [item.fileNumber, item])).values()];
        setBulkDuplicates(allDuplicates);
        setBulkPreviewEmployees(newEmployees);
      },
      error: () => setBulkUploadError('تعذر قراءة الملف. حاول مرة أخرى.'),
    });
  };

  // زر تأكيد الإضافة
  const handleBulkConfirm = async () => {
    setBulkUploading(true);
    setBulkUploadResults([]);
    const results: any[] = [];
    for (let i = 0; i < bulkPreviewEmployees.length; i++) {
      const emp = bulkPreviewEmployees[i];
      try {
        // بناء payload حسب createEmployee
        const payload = {
          fileNumber: emp.fileNumber,
          name: emp.name,
          category: normalizeBulkCategory(emp.category),
          rank: emp.rank,
          jobTitle: emp.jobTitle,
          department: emp.department,
          status: emp.status,
          reasonIfInactive: emp.reasonIfInactive,
          phone_number: emp.phone_number,
        };
        await import('../api').then(api => api.createEmployee(payload));
        results.push({ success: true, name: emp.name });
      } catch (err) {
        results.push({ success: false, name: emp.name, error: (err as Error).message });
      }
    }
    setBulkUploadResults(results);
    setBulkUploading(false);
    // تحديث القائمة بعد النجاح
    if (results.every(r => r.success)) reloadEmployees();
  };

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [nationalities, setNationalities] = useState<Nationality[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [inactiveSearchTerm, setInactiveSearchTerm] = useState('');
  const [highlightEmployeeId, setHighlightEmployeeId] = useState<string | null>(null);
  const [filterDepartment, setFilterDepartment] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSection, setFilterSection] = useState('all');
  const [filterRank, setFilterRank] = useState('all');
  const [filterJobTitle, setFilterJobTitle] = useState('all');
  const [filterNationality, setFilterNationality] = useState('all');
  const [filterWeapon, setFilterWeapon] = useState('all');
  const [filterParking, setFilterParking] = useState('all');
  const [filterShifts, setFilterShifts] = useState('all');
  const [filterSecondment, setFilterSecondment] = useState('all');
  const [filterStatsExclusion, setFilterStatsExclusion] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [showInactiveEmployees, setShowInactiveEmployees] = useState<boolean>(false);
  const [showCivilians, setShowCivilians] = useState<boolean>(true);
  const [showExcludedStatisticsDetails, setShowExcludedStatisticsDetails] = useState(false);

  // إعادة تعيين الصفحة عند تغيير الفلاتر
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterDepartment, filterCategory, filterStatus, filterSection, filterRank, filterJobTitle, filterNationality, filterWeapon, filterParking, filterShifts, filterSecondment, filterStatsExclusion, showCivilians]);

  // Reset all filters and search to defaults
  const clearFilters = () => {
    setSearchTerm('');
    setFilterCategory('all');
    setFilterDepartment('all');
    setFilterStatus('all');
    setFilterSection('all');
    setFilterRank('all');
    setFilterJobTitle('all');
    setFilterNationality('all');
    setFilterWeapon('all');
    setFilterParking('all');
    setFilterShifts('all');
    setFilterSecondment('all');
    setFilterStatsExclusion('all');
    setCurrentPage(1);
    setShowInactiveEmployees(false);
    setShowCivilians(true);
  };


  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'view' | 'edit'>('create');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [forceSyncOpen, setForceSyncOpen] = useState(false);
  const [manualOrderMode, setManualOrderMode] = useState(false);
  const [draggedEmployeeId, setDraggedEmployeeId] = useState<string | null>(null);
  const [dragOverEmployeeId, setDragOverEmployeeId] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<'before' | 'after'>('before');
  const [savingManualOrder, setSavingManualOrder] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; employee: Employee | null }>({
    isOpen: false,
    employee: null
  });
  const deleteEmployeeName = deleteModal.employee
    ? (formatEmployeeDisplayName(deleteModal.employee) || deleteModal.employee.name || '')
    : '';

  useEffect(() => {
    const loadData = async () => {
      try {
        const [employeesData, departmentsData, ranksData, nationalitiesData, sectionsData] = await Promise.all([
          fetchEmployees(),
          fetchDepartments(),
          fetchRanks(),
          fetchNationalities().catch(() => []),
          fetchSections().catch(() => []),
        ]);
        setEmployees(employeesData);
        setDepartments(departmentsData);
        setRanks(ranksData);
        setNationalities(nationalitiesData);
        setSections(sectionsData);
      } catch (err) {
        setError('فشل في تحميل البيانات');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    try {
      const term = localStorage.getItem('employeeSearchTerm');
      const highlightId = localStorage.getItem('employeeHighlightId');
      const clearSearch = localStorage.getItem('employeeHighlightClearSearch');
      const showCiviliansFlag = localStorage.getItem('employeeHighlightShowCivilians');
      if (term && term.trim()) {
        setSearchTerm(term);
        try {
          localStorage.removeItem('employeeSearchTerm');
          localStorage.removeItem('employeeSearchAt');
        } catch { }
      }
      if (clearSearch === 'true') {
        setSearchTerm('');
        try {
          localStorage.removeItem('employeeHighlightClearSearch');
        } catch { }
      }
      if (showCiviliansFlag === 'true') {
        setShowCivilians(true);
        try {
          localStorage.removeItem('employeeHighlightShowCivilians');
        } catch { }
      }
      if (highlightId) {
        setHighlightEmployeeId(highlightId);
        try {
          localStorage.removeItem('employeeHighlightId');
          localStorage.removeItem('employeeHighlightAt');
        } catch { }
      }
    } catch { }

    const onEmployeeSearch = (e: Event) => {
      const ce = e as CustomEvent;
      const term = (ce?.detail?.term as string) || '';
      const highlightId = (ce?.detail?.highlightId as string) || '';
      const clearSearch = (ce?.detail?.clearSearch as boolean) || false;
      const showCiviliansFlag = (ce?.detail?.showCivilians as boolean) || false;
      if (term.trim()) {
        setSearchTerm(term);
        try {
          localStorage.removeItem('employeeSearchTerm');
          localStorage.removeItem('employeeSearchAt');
        } catch { }
      }
      if (clearSearch) {
        setSearchTerm('');
        try {
          localStorage.removeItem('employeeHighlightClearSearch');
        } catch { }
      }
      if (showCiviliansFlag) {
        setShowCivilians(true);
        try {
          localStorage.removeItem('employeeHighlightShowCivilians');
        } catch { }
      }
      if (highlightId) {
        setHighlightEmployeeId(highlightId);
        try {
          localStorage.removeItem('employeeHighlightId');
          localStorage.removeItem('employeeHighlightAt');
        } catch { }
      }
    };
    window.addEventListener('employee-search', onEmployeeSearch as EventListener);

    return () => {
      window.removeEventListener('employee-search', onEmployeeSearch as EventListener);
    };
  }, []);

  // helper to refresh list after create/edit/delete
  const reloadEmployees = async () => {
    const data = await fetchEmployees();
    setEmployees(data);
  };

  const openCreateModal = () => {
    setModalMode('create');
    setSelectedEmployee(null);
    setModalOpen(true);
  };
  const openViewModal = (emp: Employee) => {
    setModalMode('view');
    setSelectedEmployee(emp);
    setModalOpen(true);
  };
  const openEditModal = (emp: Employee) => {
    setModalMode('edit');
    setSelectedEmployee(emp);
    setModalOpen(true);
  };
  const openDeleteModal = (emp: Employee) => {
    setDeleteModal({ isOpen: true, employee: emp });
  };
  const closeDeleteModal = () => {
    setDeleteModal({ isOpen: false, employee: null });
  };
  const handleDeleteConfirm = async () => {
    if (!deleteModal.employee) return;
    try {
      await deleteEmployee(deleteModal.employee.id);
      closeDeleteModal();
      reloadEmployees();
    } catch (err) {
      alert('فشل الحذف');
      console.error(err);
    }
  };

  const searchTokens = useMemo(() => getSearchTokens(searchTerm), [searchTerm]);
  const inactiveSearchTokens = useMemo(() => getSearchTokens(inactiveSearchTerm), [inactiveSearchTerm]);

  const departmentNameMap = useMemo(
    () => buildDepartmentNameMap(departments),
    [departments]
  );

  const sectionNameMap = useMemo(
    () => buildSectionNameMap(sections, departments),
    [sections, departments]
  );

  const quickFilterOptions = useMemo(() => {
    const unique = (values: Array<string | null | undefined>) =>
      Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'));

    return {
      ranks: unique(employees.map((employee) => employee.rank)),
      jobTitles: unique(employees.map((employee) => employee.jobTitle)),
      nationalities: unique(employees.map((employee) => employee.nationality)),
      sections: unique(employees.map((employee) => resolveSectionName(employee.department, employee.section, sectionNameMap) || employee.section)),
    };
  }, [employees, sectionNameMap]);

  const filteredEmployees = useMemo(() => {
    if (!employees.length) return [];
    return employees.filter(employee => {
      if (employee.status !== 'active') return false;
      const nationalityVariants = employee.nationality
        ? getNationalitySearchTerms(employee.nationality)
        : [];
      const matchesSearch = matchesArabicSearch(
        [
          formatEmployeeDisplayName(employee) || employee.name,
          employee.name,
          employee.firstName,
          employee.secondName,
          employee.thirdName,
          employee.fourthName,
          employee.familyName,
          employee.rank,
          employee.fileNumber,
          employee.militaryNumber,
          employee.civilId,
          resolveDepartmentName(employee.department, departmentNameMap),
          resolveSectionName(employee.department, employee.section, sectionNameMap),
          employee.jobTitle,
          employee.phone_number,
          ...nationalityVariants,
        ],
        searchTokens
      );
      const matchesDepartment = filterDepartment === 'all' || isSameOrganizationName(employee.department, filterDepartment);
      const matchesCategory = filterCategory === 'all' || employee.category === filterCategory;
      const matchesStatus = filterStatus === 'all' || employee.status === filterStatus;
      const sectionLabel = resolveSectionName(employee.department, employee.section, sectionNameMap) || employee.section || '';
      const matchesSection = filterSection === 'all' || isSameOrganizationName(sectionLabel, filterSection);
      const matchesRank = filterRank === 'all' || employee.rank === filterRank;
      const matchesJobTitle = filterJobTitle === 'all' || employee.jobTitle === filterJobTitle;
      const matchesNationality = filterNationality === 'all' || employee.nationality === filterNationality;
      const matchesWeapon = filterWeapon === 'all' || (filterWeapon === 'yes' ? employee.hasWeapon === true : employee.hasWeapon !== true);
      const matchesParking = filterParking === 'all' || (filterParking === 'yes' ? employee.hasParking === true : employee.hasParking !== true);
      const matchesShifts = filterShifts === 'all' || (filterShifts === 'yes' ? employee.includeInShifts !== false : employee.includeInShifts === false);
      const matchesSecondment = filterSecondment === 'all' || (filterSecondment === 'yes' ? employee.isSecondedOutsideGeneralAdministration === true : employee.isSecondedOutsideGeneralAdministration !== true);
      const matchesStatsExclusion = filterStatsExclusion === 'all' || (filterStatsExclusion === 'yes' ? employee.excludeFromStatistics === true : employee.excludeFromStatistics !== true);
      const matchesCivilians = showCivilians || employee.category !== 'إداريون';
      return matchesSearch && matchesDepartment && matchesCategory && matchesStatus && matchesSection && matchesRank && matchesJobTitle && matchesNationality && matchesWeapon && matchesParking && matchesShifts && matchesSecondment && matchesStatsExclusion && matchesCivilians;
    });
  }, [
    employees,
    searchTokens,
    filterDepartment,
    filterCategory,
    filterStatus,
    filterSection,
    filterRank,
    filterJobTitle,
    filterNationality,
    filterWeapon,
    filterParking,
    filterShifts,
    filterSecondment,
    filterStatsExclusion,
    showCivilians,
    departmentNameMap,
    sectionNameMap,
  ]);

  const statisticsEmployees = useMemo(
    () => getStatisticsEmployeeBuckets(employees),
    [employees]
  );

  const excludedFromStatisticsCount = statisticsEmployees.excluded.length;

  const excludedStatisticsEmployees = useMemo(
    () =>
      [...statisticsEmployees.excluded].sort((a, b) => {
        const categoryDiff = getCategoryOrder(a.category) - getCategoryOrder(b.category);
        if (categoryDiff !== 0) return categoryDiff;
        return (formatEmployeeDisplayName(a) || a.name || '').localeCompare(
          formatEmployeeDisplayName(b) || b.name || '',
          'ar'
        );
      }),
    [statisticsEmployees]
  );

  const activeEmployees = useMemo(
    () => statisticsEmployees.included.filter(employee => employee.status === 'active'),
    [statisticsEmployees]
  );

  const inactiveEmployees = useMemo(
    () =>
      statisticsEmployees.inactive
        .filter((employee) => matchesArabicSearch([
          formatEmployeeDisplayName(employee) || employee.name,
          employee.name,
          employee.firstName,
          employee.secondName,
          employee.thirdName,
          employee.fourthName,
          employee.familyName,
          employee.rank,
          employee.fileNumber,
          employee.militaryNumber,
          employee.civilId,
          employee.department,
          employee.section,
          employee.jobTitle,
          employee.phone_number,
          employee.reasonIfInactive,
        ], inactiveSearchTokens))
        .sort((a, b) => {
          const categoryDiff = getCategoryOrder(a.category) - getCategoryOrder(b.category);
          if (categoryDiff !== 0) return categoryDiff;
          const rankDiff = getRankOrder(a.rank, a.category) - getRankOrder(b.rank, b.category);
          if (rankDiff !== 0) return rankDiff;
          return (formatEmployeeDisplayName(a) || a.name || '').localeCompare(
            formatEmployeeDisplayName(b) || b.name || '',
            'ar'
          );
        }),
    [statisticsEmployees, inactiveSearchTokens]
  );

  const activeCounts = useMemo(() => {
    return activeEmployees.reduce(
      (acc, employee) => {
        if (employee.category === 'قيادات') acc.officers += 1;
        if (employee.category === 'مشرفون') acc.ncos += 1;
        if (employee.category === 'فنيون') acc.professionals += 1;
        if (employee.category === 'إداريون') acc.civilians += 1;
        return acc;
      },
      { officers: 0, ncos: 0, professionals: 0, civilians: 0 }
    );
  }, [activeEmployees]);

  const inactiveTotalCount = statisticsEmployees.inactive.length;
  const inactiveCount = inactiveTotalCount;

  const activeMilitaryTotal = activeCounts.officers + activeCounts.ncos + activeCounts.professionals;
  const activeGeneralTotal = activeMilitaryTotal + activeCounts.civilians;

  const getManualOrderScopeKey = (employee: Employee) => {
    const rankOrder = getRankOrder(employee.rank, employee.category);
    const rankKey = Number.isFinite(rankOrder) && rankOrder !== Number.MAX_SAFE_INTEGER
      ? `rank-order:${rankOrder}`
      : `rank:${normalizeArabicText(employee.rank || employee.jobTitle || '')}`;
    return `${employee.category || 'غير محدد'}|${rankKey}`;
  };

  const canReorderTogether = (left?: Employee, right?: Employee) =>
    !!left && !!right && getManualOrderScopeKey(left) === getManualOrderScopeKey(right);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterDepartment, filterCategory, filterStatus, showCivilians]);

  const sortedEmployees = useMemo(() => {
    return [...filteredEmployees].sort((a, b) => {
      // First sort by category
      const categoryDiff = getCategoryOrder(a.category) - getCategoryOrder(b.category);
      if (categoryDiff !== 0) return categoryDiff;

      const isOfficerCategory = a.category === 'قيادات' || a.category === 'مشرفون';
      if (isOfficerCategory) {
        // Then sort by base rank order within officers/NCOs
        const rankDiff = getRankOrder(a.rank, a.category) - getRankOrder(b.rank, b.category);
        if (rankDiff !== 0) return rankDiff;
      }

      if (canReorderTogether(a, b)) {
        const aManualOrder = a.manualOrder ?? undefined;
        const bManualOrder = b.manualOrder ?? undefined;
        if (aManualOrder !== undefined || bManualOrder !== undefined) {
          return (aManualOrder ?? Number.POSITIVE_INFINITY) - (bManualOrder ?? Number.POSITIVE_INFINITY);
        }
      }

      if (isOfficerCategory) {
        // Then by seniority number if present (lower is higher priority)
        const aSeniority = a.seniorityNumber ? Number(a.seniorityNumber) : Number.POSITIVE_INFINITY;
        const bSeniority = b.seniorityNumber ? Number(b.seniorityNumber) : Number.POSITIVE_INFINITY;
        if (aSeniority !== bSeniority) return aSeniority - bSeniority;
      } else {
        // Professionals/Civilians: order by seniority number
        const aSeniority = a.seniorityNumber ? Number(a.seniorityNumber) : Number.POSITIVE_INFINITY;
        const bSeniority = b.seniorityNumber ? Number(b.seniorityNumber) : Number.POSITIVE_INFINITY;
        if (aSeniority !== bSeniority) return aSeniority - bSeniority;
      }

      // Finally sort by name
      return a.name.localeCompare(b.name, 'ar');
    });
  }, [filteredEmployees]);

  const saveManualOrder = async (orderedVisibleIds: string[]) => {
    const visibleSet = new Set(orderedVisibleIds);
    const remainingIds = employees
      .filter((employee) => !visibleSet.has(employee.id))
      .slice()
      .sort((a, b) => (a.manualOrder ?? Number.POSITIVE_INFINITY) - (b.manualOrder ?? Number.POSITIVE_INFINITY))
      .map((employee) => employee.id);
    const orderedIds = [...orderedVisibleIds, ...remainingIds];
    setSavingManualOrder(true);
    try {
      await updateEmployeeManualOrder(orderedIds);
      setEmployees((current) => {
        const orderMap = new Map(orderedIds.map((id, index) => [id, index + 1]));
        return current.map((employee) => ({
          ...employee,
          manualOrder: orderMap.get(employee.id) ?? employee.manualOrder ?? null
        }));
      });
      toast.success('تم حفظ ترتيب الموظفين');
    } catch (err) {
      toast.error((err as Error).message || 'فشل حفظ الترتيب');
    } finally {
      setSavingManualOrder(false);
    }
  };

  const handleManualOrderDragOver = (event: React.DragEvent<HTMLTableRowElement>, targetEmployeeId: string) => {
    if (!manualOrderMode || !draggedEmployeeId || draggedEmployeeId === targetEmployeeId) return;
    const draggedEmployee = sortedEmployees.find((employee) => employee.id === draggedEmployeeId);
    const targetEmployee = sortedEmployees.find((employee) => employee.id === targetEmployeeId);
    if (!canReorderTogether(draggedEmployee, targetEmployee)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY - rect.top > rect.height / 2 ? 'after' : 'before';
    setDragOverEmployeeId(targetEmployeeId);
    setDragOverPosition(position);
  };

  const moveEmployeeByDrop = (targetEmployeeId: string, position: 'before' | 'after') => {
    if (!draggedEmployeeId || draggedEmployeeId === targetEmployeeId) return;
    const draggedEmployee = sortedEmployees.find((employee) => employee.id === draggedEmployeeId);
    const targetEmployee = sortedEmployees.find((employee) => employee.id === targetEmployeeId);
    if (!canReorderTogether(draggedEmployee, targetEmployee)) {
      setDraggedEmployeeId(null);
      setDragOverEmployeeId(null);
      toast.error('الترتيب اليدوي مسموح داخل نفس المسمى الوظيفي فقط');
      return;
    }
    const ids = sortedEmployees.map((employee) => employee.id);
    if (!ids.includes(draggedEmployeeId) || !ids.includes(targetEmployeeId)) return;
    const nextIds = ids.filter((id) => id !== draggedEmployeeId);
    const targetIndex = nextIds.indexOf(targetEmployeeId);
    if (targetIndex < 0) return;
    nextIds.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, draggedEmployeeId);
    setDraggedEmployeeId(null);
    setDragOverEmployeeId(null);
    void saveManualOrder(nextIds);
  };

  const employeeCategoryIndexMap = useMemo(() => {
    const counters: Record<string, number> = {};
    const map = new Map<string, number>();
    sortedEmployees.forEach((employee) => {
      const nextIndex = (counters[employee.category] || 0) + 1;
      counters[employee.category] = nextIndex;
      map.set(employee.id, nextIndex);
    });
    return map;
  }, [sortedEmployees]);

  const totalPages = Math.ceil(sortedEmployees.length / itemsPerPage);

  const paginatedEmployees = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return sortedEmployees.slice(startIndex, endIndex);
  }, [sortedEmployees, currentPage, itemsPerPage]);

  const paginatedEmployeesByCategory = useMemo(() => {
    const grouped: Record<string, Employee[]> = {};
    paginatedEmployees.forEach(employee => {
      if (!grouped[employee.category]) {
        grouped[employee.category] = [];
      }
      grouped[employee.category].push(employee);
    });
    return grouped;
  }, [paginatedEmployees]);

  const categoryPageRanges = useMemo(() => {
    const ranges = new Map<string, { start: number; end: number; count: number }>();
    if (!sortedEmployees.length) return ranges;
    const totals = sortedEmployees.reduce((acc, employee) => {
      acc[employee.category] = (acc[employee.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    for (let page = 1; page <= totalPages; page += 1) {
      const startIndex = (page - 1) * itemsPerPage;
      const endIndex = startIndex + itemsPerPage;
      const slice = sortedEmployees.slice(startIndex, endIndex);
      const categories = new Set(slice.map(employee => employee.category));
      categories.forEach((category) => {
        const existing = ranges.get(category);
        if (!existing) {
          ranges.set(category, { start: page, end: page, count: totals[category] || 0 });
        } else {
          existing.start = Math.min(existing.start, page);
          existing.end = Math.max(existing.end, page);
        }
      });
    }
    return new Map(
      Array.from(ranges.entries()).sort((a, b) => getCategoryOrder(a[0]) - getCategoryOrder(b[0]))
    );
  }, [sortedEmployees, itemsPerPage, totalPages]);

  useEffect(() => {
    if (!hasPagedRef.current) {
      hasPagedRef.current = true;
      return;
    }
    if (highlightEmployeeId) return;
    tableTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [currentPage]);

  useEffect(() => {
    if (!showInactiveEmployees) return;
    const timer = window.setTimeout(() => {
      inactiveTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [showInactiveEmployees]);

  useEffect(() => {
    if (!highlightEmployeeId) return;
    const targetIndex = sortedEmployees.findIndex((employee) => employee.id === highlightEmployeeId);
    if (targetIndex < 0) return;
    const targetPage = Math.floor(targetIndex / itemsPerPage) + 1;
    if (targetPage !== currentPage) {
      setCurrentPage(targetPage);
      return;
    }
    const scrollTimer = window.setTimeout(() => {
      const target = document.getElementById(`employee-row-${highlightEmployeeId}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);
    const clearTimer = window.setTimeout(() => {
      setHighlightEmployeeId(null);
    }, 5000);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [highlightEmployeeId, sortedEmployees, itemsPerPage, currentPage, viewMode]);

  const formatDate = (value?: string | null) => {
    if (!value) return '';
    try {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return '';
      return format(parsed, 'dd/MM/yyyy', { locale: arSA });
    } catch {
      return '';
    }
  };

  const formatYear = (value?: string | null) => {
    if (!value) return '';
    try {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return '';
      return format(parsed, 'yyyy', { locale: arSA });
    } catch {
      return '';
    }
  };

  const handleCopyValue = async (value: string, label: string) => {
    const text = (value || '').toString().trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`تم نسخ ${label}`);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        toast.success(`تم نسخ ${label}`);
      } catch {
        toast.error('فشل نسخ الرقم');
      }
    }
  };

  const getServiceInfo = (value?: string | null) => {
    if (!value) return null;
    const start = new Date(value);
    if (Number.isNaN(start.getTime())) return null;
    const now = new Date();
    let years = now.getFullYear() - start.getFullYear();
    let months = now.getMonth() - start.getMonth();
    let days = now.getDate() - start.getDate();
    if (days < 0) {
      months -= 1;
      const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      days += prevMonth.getDate();
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    years = Math.max(0, years);
    months = Math.max(0, months);
    return {
      years,
      months,
      durationText: [years ? `${years} سنة` : '', months ? `${months} شهر` : ''].filter(Boolean).join(' ')
    };
  };

  const getAgeInfo = (value?: string | null) => {
    if (!value) return null;
    const birth = new Date(value);
    if (Number.isNaN(birth.getTime())) return null;
    const now = new Date();
    let years = now.getFullYear() - birth.getFullYear();
    let months = now.getMonth() - birth.getMonth();
    let days = now.getDate() - birth.getDate();
    if (days < 0) {
      months -= 1;
      const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      days += prevMonth.getDate();
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    years = Math.max(0, years);
    months = Math.max(0, months);
    return { years, months };
  };

  const formatYearsMonths = (years: number, months: number) => `${years} سنة ${months} شهر`;
  const formatAgeYears = (years: number) => `${years}`;

  const IconTooltip = ({ content, children }: { content?: string; children: React.ReactNode }) => (
    <div className="relative group inline-flex items-center justify-center">
      {children}
      {content ? (
        <div className="pointer-events-none absolute -top-2 left-1/2 z-[9999] flex -translate-x-1/2 -translate-y-full flex-col items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <div className="max-w-[520px] rounded-lg bg-slate-900/95 px-4 py-2.5 text-xs font-medium text-white shadow-xl whitespace-nowrap text-right leading-relaxed" dir="rtl">
            {content}
          </div>
          <div className="-mt-0.5 h-0 w-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-slate-900/95"></div>
        </div>
      ) : null}
    </div>
  );

  const normalizeNationality = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const getCountryCode = (value: string) => {
    const matches = value.match(/[a-zA-Z]{2}/g);
    return matches && matches.length ? matches[matches.length - 1].toUpperCase() : '';
  };
  const codeToFlag = (code: string) => {
    if (!/^[A-Z]{2}$/.test(code)) return '';
    return String.fromCodePoint(
      127397 + code.charCodeAt(0),
      127397 + code.charCodeAt(1)
    );
  };
  const flagEmojiToCode = (flag: string) => {
    const chars = Array.from(flag);
    if (chars.length !== 2) return '';
    const code = chars
      .map(ch => String.fromCharCode(ch.codePointAt(0)! - 127397))
      .join('');
    return /^[A-Z]{2}$/.test(code) ? code : '';
  };
  const codeToTwemoji = (code: string) => {
    if (!/^[A-Z]{2}$/.test(code)) return '';
    return code
      .split('')
      .map(ch => (0x1f1e6 + (ch.charCodeAt(0) - 65)).toString(16))
      .join('-');
  };
  const getFlagImageUrl = (code: string) => {
    const twemoji = codeToTwemoji(code);
    return twemoji
      ? `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${twemoji}.svg`
      : '';
  };
  const nationalityNameByCode: Record<string, string> = {
    EG: 'مصر',
    SA: 'السعودية',
    KW: 'المحلية',
    AE: 'الإمارات',
    QA: 'قطر',
    BH: 'البحرين',
    OM: 'عُمان',
    JO: 'الأردن',
    LB: 'لبنان',
    SY: 'سوريا',
    IQ: 'العراق',
    PS: 'فلسطين',
    TN: 'تونس',
    DZ: 'الجزائر',
    MA: 'المغرب',
    SD: 'السودان',
    YE: 'اليمن',
    LY: 'ليبيا',
    IR: 'إيران',
    TR: 'تركيا',
    IN: 'الهند',
    PK: 'باكستان',
    BD: 'بنغلاديش',
    PH: 'الفلبين'
  };

  const getNationalityLabel = (value?: string | null) => {
    if (!value) return '';
    const trimmed = value.trim();
    let candidate = trimmed
      .replace(/\(\s*[a-zA-Z]{2}\s*\)\s*$/, '')
      .replace(/(?:\s+|[-/|]\s*)[a-zA-Z]{2}$/, '')
      .trim();
    candidate = candidate.replace(/^[a-zA-Z]{2}\s+/, '').trim() || candidate;
    if (/^[a-zA-Z]{2}$/.test(candidate)) {
      const code = candidate.toUpperCase();
      return nationalityNameByCode[code] || candidate;
    }
    return candidate || trimmed;
  };

  const nationalityFlagMap: Record<string, string> = {
    'المحلية': '',
    'كويتي': '🇰🇼',
    'كويتية': '🇰🇼',
    'الدولة': '',
    'السعودية': '🇸🇦',
    'سعودي': '🇸🇦',
    'سعودية': '🇸🇦',
    'المملكة العربية السعودية': '🇸🇦',
    'الامارات': '🇦🇪',
    'الإمارات': '🇦🇪',
    'اماراتي': '🇦🇪',
    'إماراتي': '🇦🇪',
    'اماراتية': '🇦🇪',
    'إماراتية': '🇦🇪',
    'الامارات العربية المتحدة': '🇦🇪',
    'الإمارات العربية المتحدة': '🇦🇪',
    'قطر': '🇶🇦',
    'قطري': '🇶🇦',
    'قطرية': '🇶🇦',
    'البحرين': '🇧🇭',
    'بحريني': '🇧🇭',
    'بحرينية': '🇧🇭',
    'عمان': '🇴🇲',
    'عُمان': '🇴🇲',
    'عماني': '🇴🇲',
    'عمانية': '🇴🇲',
    'سلطنة عمان': '🇴🇲',
    'مصر': '🇪🇬',
    'مصري': '🇪🇬',
    'مصرية': '🇪🇬',
    'الاردن': '🇯🇴',
    'الأردن': '🇯🇴',
    'أردني': '🇯🇴',
    'أردنية': '🇯🇴',
    'اردني': '🇯🇴',
    'اردنية': '🇯🇴',
    'لبنان': '🇱🇧',
    'لبناني': '🇱🇧',
    'لبنانية': '🇱🇧',
    'سوريا': '🇸🇾',
    'سورية': '🇸🇾',
    'سوري': '🇸🇾',
    'العراق': '🇮🇶',
    'عراقي': '🇮🇶',
    'عراقية': '🇮🇶',
    'فلسطين': '🇵🇸',
    'فلسطيني': '🇵🇸',
    'فلسطينية': '🇵🇸',
    'تونس': '🇹🇳',
    'تونسي': '🇹🇳',
    'تونسية': '🇹🇳',
    'الجزائر': '🇩🇿',
    'جزائري': '🇩🇿',
    'جزائرية': '🇩🇿',
    'المغرب': '🇲🇦',
    'مغربي': '🇲🇦',
    'مغربية': '🇲🇦',
    'السودان': '🇸🇩',
    'سوداني': '🇸🇩',
    'سودانية': '🇸🇩',
    'اليمن': '🇾🇪',
    'يمني': '🇾🇪',
    'يمنية': '🇾🇪',
    'ليبيا': '🇱🇾',
    'ليبي': '🇱🇾',
    'ليبية': '🇱🇾',
    'ايران': '🇮🇷',
    'إيران': '🇮🇷',
    'ايراني': '🇮🇷',
    'إيراني': '🇮🇷',
    'ايرانية': '🇮🇷',
    'إيرانية': '🇮🇷',
    'تركيا': '🇹🇷',
    'تركي': '🇹🇷',
    'تركية': '🇹🇷',
    'الهند': '🇮🇳',
    'هندي': '🇮🇳',
    'هندية': '🇮🇳',
    'باكستان': '🇵🇰',
    'باكستاني': '🇵🇰',
    'باكستانية': '🇵🇰',
    'بنغلاديش': '🇧🇩',
    'بنغلاديشي': '🇧🇩',
    'بنغلاديشية': '🇧🇩',
    'الفلبين': '🇵🇭'
  };
  const nationalityFlagMapEnglish: Record<string, string> = {
    'egypt': '🇪🇬',
    'saudi arabia': '🇸🇦',
    'saudi': '🇸🇦',
    'kuwait': '🇰🇼',
    'uae': '🇦🇪',
    'united arab emirates': '🇦🇪',
    'qatar': '🇶🇦',
    'bahrain': '🇧🇭',
    'oman': '🇴🇲',
    'jordan': '🇯🇴',
    'lebanon': '🇱🇧',
    'syria': '🇸🇾',
    'iraq': '🇮🇶',
    'palestine': '🇵🇸',
    'tunisia': '🇹🇳',
    'algeria': '🇩🇿',
    'morocco': '🇲🇦',
    'sudan': '🇸🇩',
    'yemen': '🇾🇪',
    'libya': '🇱🇾',
    'iran': '🇮🇷',
    'iranian': '🇮🇷',
    'turkey': '🇹🇷',
    'india': '🇮🇳',
    'pakistan': '🇵🇰',
    'bangladesh': '🇧🇩',
    'philippines': '🇵🇭'
  };

  const getNationalityFlag = (nationality?: string | null) => {
    if (!nationality) return '';
    const labelNormalized = normalizeNationality(getNationalityLabel(nationality));
    if (nationalityFlagMap[labelNormalized]) {
      return nationalityFlagMap[labelNormalized];
    }
    const normalized = normalizeNationality(nationality);
    if (nationalityFlagMap[normalized]) {
      return nationalityFlagMap[normalized];
    }
    if (nationalityFlagMapEnglish[normalized]) {
      return nationalityFlagMapEnglish[normalized];
    }
    const parts = normalized.split(/[\s/|-]+/).filter(Boolean);
    for (const part of parts) {
      if (nationalityFlagMap[part]) return nationalityFlagMap[part];
      if (nationalityFlagMapEnglish[part]) return nationalityFlagMapEnglish[part];
    }
    const code = getCountryCode(nationality);
    return code ? codeToFlag(code) : '';
  };

  const nationalityNameSet = useMemo(
    () => new Set(nationalities.map((nat) => (nat.name || '').trim()).filter(Boolean)),
    [nationalities]
  );
  const nationalityNameByFlag = useMemo(() => {
    const map = new Map<string, string>();
    nationalities.forEach((nat) => {
      const name = (nat.name || '').trim();
      if (!name) return;
      const flag = getNationalityFlag(name);
      if (flag && !map.has(flag)) map.set(flag, name);
    });
    return map;
  }, [nationalities]);
  const getNationalityDisplayName = (nationality?: string | null, flag?: string) => {
    const raw = (nationality || '').trim();
    if (!raw) return '';
    if (nationalityNameSet.has(raw)) return raw;
    const mapped = flag ? nationalityNameByFlag.get(flag) : undefined;
    return mapped || raw;
  };

  if (loading) {
    return <LoadingPage variant="employees" />;
  }

  if (error) {
    return <div className="text-center py-8 text-red-500">Error: {error}</div>;
  }

  return (
    <div className="min-h-screen p-3">
      <div className="mx-auto space-y-6">
        <PageHeader
          icon={<Users size={36} />}
          title="إدارة ومتابعة الموظفين"
          description="إدارة بيانات الموظفين والبحث والتصفية."
          actions={(
            <button
              type="button"
              onClick={openCreateModal}
              className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:from-blue-700 hover:to-blue-800 hover:shadow-xl"
            >
              <Plus size={20} />
              <span>إضافة موظف جديد</span>
            </button>
          )}
        >
          {manualOrderMode && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
              اسحب صف الموظف داخل نفس المسمى الوظيفي فقط. لا يمكن نقل مسمى وظيفي أعلى أسفل مسمى وظيفي أدنى، ويتم حفظ الترتيب داخل نطاق المسمى الوظيفي في قاعدة البيانات.
            </div>
          )}
        </PageHeader>

        {/* Compact Statistics Section - Similar to Dashboard Design */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Officers Card */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-blue-600 rounded-2xl blur opacity-25 group-hover:opacity-40 transition-opacity"></div>
            <div className="relative bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 rounded-2xl p-5 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex items-center justify-between mb-3">
                <div className="w-12 h-12 bg-white bg-opacity-20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                  <Users size={24} className="text-white" />
                </div>
                <div className="text-right">
                  <div className="text-5xl font-black mb-1">{activeCounts.officers}</div>
                  <div className="text-blue-100 text-xs font-medium">قيادات</div>
                </div>
              </div>
              <div className="border-t border-white border-opacity-20 pt-3">
                <h4 className="text-lg font-bold">القيادات</h4>
              </div>
              <div className="absolute top-3 right-3 w-6 h-6 bg-white bg-opacity-10 rounded-full"></div>
              <div className="absolute bottom-3 left-3 w-8 h-8 bg-white bg-opacity-5 rounded-full"></div>
            </div>
          </div>

          {/* NCOs Card */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-blue-600 rounded-2xl blur opacity-25 group-hover:opacity-40 transition-opacity"></div>
            <div className="relative bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 rounded-2xl p-5 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex items-center justify-between mb-3">
                <div className="w-12 h-12 bg-white bg-opacity-20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                  <Users size={24} className="text-white" />
                </div>
                <div className="text-right">
                  <div className="text-5xl font-black mb-1">{activeCounts.ncos}</div>
                  <div className="text-green-100 text-xs font-medium">إشرافي</div>
                </div>
              </div>
              <div className="border-t border-white border-opacity-20 pt-3">
                <h4 className="text-lg font-bold">المشرفون</h4>
              </div>
              <div className="absolute top-3 right-3 w-6 h-6 bg-white bg-opacity-10 rounded-full"></div>
              <div className="absolute bottom-3 left-3 w-8 h-8 bg-white bg-opacity-5 rounded-full"></div>
            </div>
          </div>

          {/* Professionals Card */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-blue-600 rounded-2xl blur opacity-25 group-hover:opacity-40 transition-opacity"></div>
            <div className="relative bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 rounded-2xl p-5 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex items-center justify-between mb-3">
                <div className="w-12 h-12 bg-white bg-opacity-20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                  <Users size={24} className="text-white" />
                </div>
                <div className="text-right">
                  <div className="text-5xl font-black mb-1">{activeCounts.professionals}</div>
                  <div className="text-yellow-100 text-xs font-medium">فني</div>
                </div>
              </div>
              <div className="border-t border-white border-opacity-20 pt-3">
                <h4 className="text-lg font-bold">الفنيون</h4>
              </div>
              <div className="absolute top-3 right-3 w-6 h-6 bg-white bg-opacity-10 rounded-full"></div>
              <div className="absolute bottom-3 left-3 w-8 h-8 bg-white bg-opacity-5 rounded-full"></div>
            </div>
          </div>

          {/* Civilians Card */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-slate-200 to-slate-400 rounded-2xl blur opacity-40 group-hover:opacity-60 transition-opacity"></div>
            <div className="relative bg-gradient-to-br from-slate-500 via-slate-600 to-slate-800 rounded-2xl p-5 text-gray-800 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex items-center justify-between mb-3">
                <div className="w-12 h-12 bg-white bg-opacity-20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                  <Building size={24} className="text-white" />
                </div>
                <div className="text-right">
                  <div className="text-5xl font-black mb-1 text-white">{activeCounts.civilians}</div>
                  <div className="text-white text-xs font-medium">إداري</div>
                </div>
              </div>
              <div className="border-t border-slate-200 border-opacity-20 pt-3">
                <h4 className="text-lg font-bold text-white">الإداريون</h4>
              </div>
              <div className="absolute top-3 right-3 w-6 h-6 bg-white/10 rounded-full"></div>
              <div className="absolute bottom-3 left-3 w-8 h-8 bg-white/10 rounded-full"></div>
            </div>
          </div>
        </div>


        {/* Summary Stats Row - Refined Professional Design */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Total Active - Refined Design with Colors */}
          <div className="bg-gradient-to-t from-gray-100/50 to-white rounded-2xl shadow-lg border border-gray-200 p-4 hover:shadow-xl transition-shadow shadow-gray-100 hover:shadow-gray-200 duration-200">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100/50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Users size={22} className="text-blue-600" />
              </div>
              <div className="text-right flex-1">
                <div className="text-5xl font-black  text-blue-600 mb-1">{activeGeneralTotal + inactiveCount}</div>
                <div className="text-xs font-bold leading-tight">
                  إجمالي الموظفين
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  جميع فئات الموظفين
                </div>
              </div>
            </div>
          </div>

          {/* Active Military - Refined Design with Colors */}
          <div className="bg-gradient-to-t from-gray-100/50 to-white  rounded-2xl shadow-lg border border-gray-200 p-4 hover:shadow-xl transition-shadow  hover:shadow-gray-200 shadow-gray-100 duration-200">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100/50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Shield size={22} className="text-blue-600" />
              </div>
              <div className="text-right flex-1">
                <div className="text-5xl font-black text-blue-600  mb-1">{activeGeneralTotal}</div>
                <div className="text-xs font-bold leading-tight">
                  الموظفون النشطون
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  جميع الفئات
                </div>
              </div>
            </div>
          </div>

          {/* Inactive - Refined Design with Colors */}
          <div className="bg-gradient-to-t from-red-100/50 to-white rounded-2xl shadow-lg hover:shadow-red-200 border border-red-200 p-4 hover:shadow-xl transition-shadow  shadow-red-100 duration-200">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
              <div className="text-right flex-1">
                <div className="text-5xl font-black  text-red-600 mb-1">{inactiveCount}</div>
                <div className="text-xs  text-red-600 font-bold leading-tight">
                  خارج الخدمة
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  نقل، إنهاء خدمات، إستقالة، تقاعد ..إلخ
                </div>
              </div>
            </div>
          </div>
        </div>

        {excludedFromStatisticsCount > 0 && (
          <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="font-semibold">
                ملاحظة: تم استثناء {excludedFromStatisticsCount} موظف من إحصائيات الصفحة.
              </p>
              <button
                type="button"
                onClick={() => setShowExcludedStatisticsDetails((prev) => !prev)}
                className="inline-flex w-full items-center justify-center rounded-md border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-800 transition-colors hover:bg-amber-100 md:w-auto"
              >
                {showExcludedStatisticsDetails ? 'إخفاء تفاصيل المستثنين' : 'عرض تفاصيل المستثنين'}
              </button>
            </div>

            {showExcludedStatisticsDetails && (
              <div className="mt-2 rounded-lg border border-amber-100 bg-white p-2">
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-right text-xs text-slate-700">
                    <thead>
                      <tr className="border-b border-amber-100 bg-amber-50/70 text-amber-900">
                        <th className="px-2 py-2 font-bold">المسمى الوظيفي</th>
                        <th className="px-2 py-2 font-bold">الاسم</th>
                        <th className="px-2 py-2 font-bold">سبب الاستبعاد</th>
                      </tr>
                    </thead>
                    <tbody>
                      {excludedStatisticsEmployees.map((employee) => {
                        const secondmentLocation = (employee.secondmentLocation || '').trim();
                        const exclusionReason = employee.isSecondedOutsideGeneralAdministration
                          ? `منتدب خارج الإدارة${secondmentLocation ? ` - ${secondmentLocation}` : ''}`
                          : 'مستثنى من الإحصائيات';

                        return (
                          <tr key={employee.id} className="border-b border-amber-100 last:border-b-0">
                            <td className="px-2 py-2 font-semibold text-slate-700">
                              {employee.category === 'فنيون' ? (employee.jobTitle || employee.rank || '-') : (employee.rank || '-')}
                            </td>
                            <td className="px-2 py-2 font-semibold text-slate-900">
                              {formatEmployeeDisplayName(employee) || employee.name}
                            </td>
                            <td className="px-2 py-2 text-amber-800">{exclusionReason}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}


        {/* Smart Search & Controls */}
        <div className=" backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          <div className="px-6 pt-6 pb-4 border-b border-gray-100">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-3">
                  <Search className="w-5 h-5 text-blue-600" />
                  البحث السريع والتصفية
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  بحث شامل بالاسم والمسمى الوظيفي والمسمى والأرقام والإدارة
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowInactiveEmployees((current) => !current)}
                  className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold shadow-sm transition-all ${showInactiveEmployees
                    ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
                    : 'border-red-100 bg-white text-red-700 hover:bg-red-50'
                    }`}
                >
                  <Users className="h-4 w-4" />
                  <span>{showInactiveEmployees ? 'إخفاء كشف خارج الخدمة' : 'عرض كشف خارج الخدمة'}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${showInactiveEmployees ? 'bg-white/20 text-white' : 'bg-red-50 text-red-700'}`}>
                    {inactiveEmployees.length}
                  </span>
                </button>

                <button
                  onClick={() => setForceSyncOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-4 py-3 text-sm font-bold text-blue-700 shadow-sm transition-all hover:bg-blue-50"
                >
                  <FileText className="h-4 w-4" />
                  <span>مطابقة Word</span>
                </button>
                <button
                  onClick={() => {
                    setManualOrderMode((value) => !value);
                    setViewMode('list');
                  }}
                  className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold shadow-sm transition-all ${manualOrderMode
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-emerald-100 bg-white text-emerald-700 hover:bg-emerald-50'
                    }`}
                >
                  <ListOrdered className="h-4 w-4" />
                  <span>{savingManualOrder ? 'جاري حفظ الترتيب...' : 'ترتيب يدوي'}</span>
                </button>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all duration-200 ${showFilters
                    ? 'bg-blue-100 text-blue-700 shadow-sm border border-blue-200 hover:bg-blue-200'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                    }`}
                >
                  <Filter className="w-4 h-4" />
                  <span>الفلاتر</span>
                </button>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-6 items-center">
              <div className="relative">
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-600 bg-blue-50 p-2 rounded-lg">
                  <Search className="w-5 h-5" />
                </div>
                <input
                  type="text"
                  placeholder="ابحث بالاسم، المسمى الوظيفي، المسمى، الإدارة، أو الأرقام..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pr-16 pl-24 py-4 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all duration-200 text-md placeholder-gray-400"
                />
                {searchTerm && (
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="w-9 h-9 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 flex items-center justify-center transition-colors"
                      title="مسح البحث"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <div className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded-full text-sm font-semibold">
                      {sortedEmployees.length} نتيجة
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Enhanced Filters */}
          {showFilters && (
            <div className="pt-4 border-t border-slate-200/70 animate-slide-up">
              <div className="p-6 md:p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center">
                      <Filter className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-800">خيارات الفلترة</h3>
                      <p className="text-xs text-gray-500">اختر الفئة والإدارة والقسم والخصائص التفصيلية</p>
                    </div>
                  </div>
                  <button
                    onClick={clearFilters}
                    className="px-3 py-2 rounded-xl bg-red-50 text-red-700 border border-red-100 hover:bg-red-100 transition-all text-xs font-semibold"
                  >
                    مسح جميع الفلاتر
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600">الفئة</label>
                    <select
                      value={filterCategory}
                      onChange={(e) => setFilterCategory(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                    >
                      <option value="all">جميع الفئات</option>
                      <option value="قيادات">قيادات</option>
                      <option value="مشرفون">مشرفون</option>
                      <option value="فنيون">فنيون</option>
                      <option value="إداريون">إداريون</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600">الإدارة</label>
                    <select
                      value={filterDepartment}
                      onChange={(e) => setFilterDepartment(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                    >
                      <option value="all">جميع الإدارات</option>
                      {departments.map(dept => (
                        <option key={dept.id} value={dept.name}>
                          {dept.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600">القسم</label>
                    <select
                      value={filterSection}
                      onChange={(e) => setFilterSection(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                    >
                      <option value="all">جميع الأقسام</option>
                      {quickFilterOptions.sections.map(section => (
                        <option key={section} value={section}>
                          {section}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600">الحالة</label>
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                    >
                      <option value="all">جميع الحالات</option>
                      <option value="active">في الخدمة</option>
                      <option value="inactive">خارج الخدمة</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600">المسمى الوظيفي</label>
                    <select
                      value={filterRank}
                      onChange={(e) => setFilterRank(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                    >
                      <option value="all">جميع المسميات الوظيفية</option>
                      {quickFilterOptions.ranks.map(rank => (
                        <option key={rank} value={rank}>
                          {rank}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600">المسمى الوظيفي</label>
                    <select
                      value={filterJobTitle}
                      onChange={(e) => setFilterJobTitle(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                    >
                      <option value="all">جميع المسميات</option>
                      {quickFilterOptions.jobTitles.map(jobTitle => (
                        <option key={jobTitle} value={jobTitle}>
                          {jobTitle}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600">الجنسية</label>
                    <select
                      value={filterNationality}
                      onChange={(e) => setFilterNationality(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                    >
                      <option value="all">جميع الجنسيات</option>
                      {quickFilterOptions.nationalities.map(nationality => (
                        <option key={nationality} value={nationality}>
                          {nationality}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600">جهاز الاتصال</label>
                    <select
                      value={filterWeapon}
                      onChange={(e) => setFilterWeapon(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                    >
                      <option value="all">الكل</option>
                      <option value="yes">لديه جهاز اتصال</option>
                      <option value="no">بدون جهاز اتصال</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600">الموقف</label>
                    <select
                      value={filterParking}
                      onChange={(e) => setFilterParking(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                    >
                      <option value="all">الكل</option>
                      <option value="yes">لديه موقف</option>
                      <option value="no">بدون موقف</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600">المناوبات</label>
                    <select
                      value={filterShifts}
                      onChange={(e) => setFilterShifts(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                    >
                      <option value="all">الكل</option>
                      <option value="yes">مدرج في المناوبات</option>
                      <option value="no">غير مدرج في المناوبات</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600">الانتداب</label>
                    <select
                      value={filterSecondment}
                      onChange={(e) => setFilterSecondment(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                    >
                      <option value="all">الكل</option>
                      <option value="yes">منتدب من خارج الإدارة</option>
                      <option value="no">غير منتدب</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600">الإحصائيات</label>
                    <select
                      value={filterStatsExclusion}
                      onChange={(e) => setFilterStatsExclusion(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                    >
                      <option value="all">الكل</option>
                      <option value="yes">مستثنى من الإحصائيات</option>
                      <option value="no">داخل الإحصائيات</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>



        {/* Enhanced Employees Display */}
        <div ref={tableTopRef} className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 overflow-hidden">
          {viewMode === 'list' ? (
            <div className="overflow-x-auto">
              {Object.entries(paginatedEmployeesByCategory).map(([category, categoryEmployees]) => (
                <div key={category} className="mb-2">
                  {/* Enhanced Category Header */}
                  <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-5 pl-10 text-white">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                          <Users className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="text-2xl font-bold">{category}</h3>
                          <p className="text-blue-100">عدد ال{category}: {categoryEmployees.length}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Organized Employee Table */}
                  <div className="bg-white rounded-b-2xl">
                    <div className="overflow-x-auto overflow-y-visible rounded-b-2xl pb-1 pr-1">
                      <table className="min-w-full text-sm text-right ">
                        <thead className="bg-gray-50 text-gray-700">
                          <tr>
                            <th className="px-4 py-3 text-center align-middle font-bold ">م</th>
                            <th className="px-4 py-3 text-center align-middle font-bold whitespace-nowrap">
                              <div className="flex items-center justify-start gap-1">
                                <User className="w-4 h-4" />
                                <span>الإسم بالكامل</span>
                              </div>
                            </th>
                            <th className="px-4 py-3 text-right align-middle font-bold">
                              <div className="flex items-center justify-start gap-1">
                                <span>
                                  {category === 'قيادات'
                                    ? 'المنصــب'
                                    : category === 'إداريون'
                                      ? 'المسمى/المنصب'
                                      : 'المسمى الوظيفي'}
                                </span>
                              </div>
                            </th>
                            <th className="px-4 py-3 text-right align-middle font-bold">
                              <div className="flex items-center justify-start gap-1">
                                <Building className="w-4 h-4" />
                                <span>الإدارة والقسم</span>
                              </div>
                            </th>
                            <th className="px-4 py-3 text-right align-middle font-bold">
                              <div className="flex items-center justify-start gap-1">
                                <Hash className="w-4 h-4" />
                                <span>الأرقام والهوية</span>
                              </div>
                            </th>
                            <th className="px-4 py-3 text-right align-middle font-bold">
                              <div className="flex items-center justify-start gap-1">
                                <Globe className="w-4 h-4" />
                                <span>الجنسية</span>
                              </div>
                            </th>
                            <th className="px-4 py-3 text-right align-middle font-bold">
                              <div className="flex items-center justify-start gap-1">
                                <Calendar className="w-4 h-4" />
                                <span>التواريخ</span>
                              </div>
                            </th>
                            <th className="px-4 py-3 text-right align-middle font-bold">
                              <div className="flex items-center justify-start gap-1">
                                <span>{hideShifts ? 'التجهيزات والمرافق' : 'التجهيزات / المناوبات'}</span>
                              </div>
                            </th>
                            <th className="px-4 py-3 text-right align-middle font-bold">
                              <div className="flex items-center justify-start gap-1">
                                <span>الإجراءات</span>
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {categoryEmployees.map((employee, index) => {
                            const isInactive = employee.status === 'inactive';
                            const isFemale = employee.gender === 'أنثى';
                            const isExcludedFromStats = employee.excludeFromStatistics === true;
                            const isHighlighted = employee.id === highlightEmployeeId;
                            const categoryIndex = employeeCategoryIndexMap.get(employee.id) ?? index + 1;
                            const serviceInfo = isInactive ? null : getServiceInfo(employee.hiringDate);
                            const showWeaponIcon = employee.category === 'قيادات' || employee.category === 'مشرفون';
                            const showShiftIcon = !hideShifts && employee.category !== 'إداريون';
                            const weaponTooltip = employee.hasWeapon
                              ? (employee.weaponAttachments ? `المرفقات: ${employee.weaponAttachments}` : 'جهاز اتصال بدون ملاحظات')
                              : 'لا يوجد جهاز اتصال';
                            const parkingTooltip = employee.hasParking
                              ? (() => {
                                const parts = [];
                                if (employee.parkingLocation) parts.push(employee.parkingLocation);
                                if (employee.parkingNumber) parts.push(`رقم ${employee.parkingNumber}`);
                                return parts.length ? `موقف: ${parts.join(' - ')}` : 'موقف بدون تفاصيل';
                              })()
                              : 'لا يوجد موقف';
                            const shiftTooltip = showShiftIcon
                              ? (employee.includeInShifts === false
                                ? (employee.shiftNotes ? `ملاحظات : ${employee.shiftNotes}` : 'غير مدرج في المناوبات')
                                : 'مدرج في المناوبات')
                              : '';
                            const ageInfo = getAgeInfo(employee.birthDate);
                            const nationalityFlag = getNationalityFlag(employee.nationality);
                            const nationalityLabel = getNationalityDisplayName(employee.nationality, nationalityFlag);
                            const nationalityCode = nationalityFlag
                              ? flagEmojiToCode(nationalityFlag)
                              : getCountryCode(employee.nationality || '');
                            const nationalityFlagUrl = nationalityCode ? getFlagImageUrl(nationalityCode) : '';
                            const displayName = formatEmployeeDisplayName(employee) || employee.name || '—';
                            const secondmentLocation = (employee.secondmentLocation || '').trim();
                            const secondmentText = employee.isSecondedOutsideGeneralAdministration
                              ? `منتدب${secondmentLocation ? ` - ${secondmentLocation}` : ' - جهة الانتداب غير محددة'}`
                              : '';
                            const departmentName = resolveDepartmentName(employee.department, departmentNameMap);
                            const sectionName = resolveSectionName(employee.department, employee.section, sectionNameMap);
                            const departmentLabel = departmentName
                              ? `${departmentName}${sectionName ? ` - ${sectionName}` : ''}`
                              : 'غير مسجل';
                            const departmentDisplay = departmentName ? wrapLabel(departmentName, 25) : '';
                            const sectionDisplay = sectionName ? wrapLabel(sectionName, 25) : '';
                            const jobGradeLabel = employee.category === 'إداريون' ? (employee.jobGrade || '') : '';
                            const isManualDropTarget = manualOrderMode && dragOverEmployeeId === employee.id && draggedEmployeeId !== employee.id;

                            return (
                              <tr
                                key={employee.id}
                                id={`employee-row-${employee.id}`}
                                draggable={manualOrderMode}
                                onDragStart={() => {
                                  if (!manualOrderMode) return;
                                  setDraggedEmployeeId(employee.id);
                                  setDragOverEmployeeId(null);
                                }}
                                onDragOver={(event) => {
                                  handleManualOrderDragOver(event, employee.id);
                                }}
                                onDragLeave={() => {
                                  if (dragOverEmployeeId === employee.id) setDragOverEmployeeId(null);
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  if (manualOrderMode) moveEmployeeByDrop(employee.id, dragOverPosition);
                                }}
                                onDragEnd={() => {
                                  setDraggedEmployeeId(null);
                                  setDragOverEmployeeId(null);
                                }}
                                className={`transition-all ${manualOrderMode ? 'cursor-grab' : ''} ${draggedEmployeeId === employee.id ? 'opacity-50' : ''} ${isInactive ? 'bg-red-50/70 hover:bg-red-100/70' : 'hover:bg-blue-50/40'
                                  } ${isHighlighted ? 'bg-yellow-200 ' : ''} ${isManualDropTarget ? 'bg-blue-100/90 ring-4 ring-blue-500 ring-inset' : ''} ${isManualDropTarget && dragOverPosition === 'before' ? 'border-t-4 border-blue-700 shadow-[inset_0_5px_0_#1d4ed8]' : ''} ${isManualDropTarget && dragOverPosition === 'after' ? 'border-b-4 border-blue-700 shadow-[inset_0_-5px_0_#1d4ed8]' : ''}`}
                                style={{ contentVisibility: 'auto', containIntrinsicSize: '1px 140px' }}
                              >
                                <td className="px-3 py-3 align-middle">
                                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold ${isExcludedFromStats
                                    ? 'border border-amber-200 bg-amber-50 text-amber-700'
                                    : (employee.status === 'active' ? 'bg-green-500 text-white' : 'bg-red-500 text-white')
                                    }`}>
                                    {categoryIndex}
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-middle">
                                  <div className="space-y-1">

                                    {employee.rank && (
                                      <span
                                        className={`flex-inline items-center mb-2 px-2.5 py-0.5 rounded-full text-xs font-bold border shadow-sm ${isInactive
                                          ? 'bg-red-50 text-red-700 border-red-200'
                                          : 'bg-blue-50 text-blue-700 border-blue-200'
                                          }`}
                                      >
                                        {employee.rank}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => openViewModal(employee)}
                                      className="text-sm font-bold text-gray-900 hover:text-blue-700 transition-colors whitespace-nowrap"
                                      title="عرض بيانات الموظف"
                                    >
                                      &nbsp;&nbsp;{displayName}
                                    </button>
                                    {isFemale ? (
                                      <span
                                        className=" mb-2 px-1 pl-1 mr-2"
                                        title="أنثى"
                                      >
                                        <Ribbon className="w-3.5 h-3.5 text-pink-700 inline mb-1 middle" />
                                      </span>
                                    ) : null}
                                    {secondmentText && (
                                      <div className="mt-1.5 pt-1.5 flex items-center gap-1.5 text-xs font-black text-red-700">
                                        <Briefcase className="w-3.5 h-3.5" />
                                        <span>{secondmentText}</span>
                                      </div>
                                    )}
                                  </div>
                                  {employee.reasonIfInactive && (
                                    <div className="w-60 text-right mt-2 text-xs font-semibold text-red-700 bg-red-50 rounded-full px-3 py-1 border border-red-100">
                                      <span className="text-red-500">ملاحظات : </span>
                                      <span className="text-red-700 text-md font-bold">{employee.reasonIfInactive}</span>
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-4 align-middle text-gray-700">
                                  {employee.jobTitle ? (
                                    <div>{employee.jobTitle}</div>
                                  ) : (
                                    <div className="text-gray-300">لا يوجد</div>
                                  )}
                                  {employee.category === 'إداريون' && (
                                    <div className={`text-xs mt-1 ${jobGradeLabel ? 'text-gray-500' : 'text-gray-300'}`}>
                                      {jobGradeLabel || 'لا يوجد'}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-4 align-middle">
                                  <div className="text-sm text-gray-800 space-y-1">
                                    {departmentName && (
                                      <div className="flex items-start gap-2">
                                        <Building className="w-4 h-4 text-blue-500" />
                                        <span className="whitespace-pre-line break-words leading-snug" title={departmentLabel}>
                                          {departmentDisplay}
                                        </span>
                                      </div>
                                    )}
                                    {sectionName && (
                                      <div className="text-xs text-gray-500 mr-6 whitespace-pre-line break-words leading-snug" title={sectionName}>
                                        {sectionDisplay}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-middle">
                                  <div className="grid grid-cols-1 md:grid-cols-1 gap-x-3 gap-y-1 text-xs text-gray-700">
                                    {(employee.fileNumber || employee.militaryNumber) && (
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="inline-flex items-center gap-1 text-gray-500">
                                          <Hash className="w-3.5 h-3.5 text-blue-500" />
                                          رقم الملف
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => handleCopyValue(
                                            employee.fileNumber || employee.militaryNumber || '',
                                            employee.fileNumber ? 'رقم الملف' : 'الرقم الوظيفي'
                                          )}
                                          className="inline-flex items-center text-[13px] font-bold text-blue-700 hover:text-blue-900 transition cursor-pointer"
                                          title="اضغط للنسخ"
                                        >
                                          {employee.fileNumber && employee.militaryNumber ? (
                                            <>
                                              <span>{employee.fileNumber}</span>
                                            </>
                                          ) : employee.fileNumber ? (
                                            <span>{employee.fileNumber}</span>
                                          ) : (
                                            <span>{employee.militaryNumber}</span>
                                          )}
                                        </button>
                                      </div>
                                    )}

                                    {employee.phone_number && (
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="inline-flex items-center gap-1 text-gray-500">
                                          <Phone className="w-3.5 h-3.5 text-blue-600" />
                                          رقم التواصل
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => handleCopyValue(employee.phone_number || '', 'رقم التواصل')}
                                          className="inline-flex text-[13px] font-bold items-center text-green-600 tracking-wide hover:text-green-800 transition cursor-pointer"
                                          title="اضغط للنسخ"
                                        >
                                          {employee.phone_number}
                                        </button>
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="inline-flex items-center gap-1 text-gray-500">
                                        <User className="w-3.5 h-3.5 text-blue-500" />
                                        الرقم المدني
                                      </span>
                                      {employee.civilId ? (
                                        <button
                                          type="button"
                                          onClick={() => handleCopyValue(employee.civilId || '', 'الرقم المدني')}
                                          className="inline-flex items-center text-[13px] font-bold text-gray-600 hover:text-gray-900 transition cursor-pointer"
                                          title="اضغط للنسخ"
                                        >
                                          {employee.civilId}
                                        </button>
                                      ) : (
                                        <span className="font-bold text-gray-300">غير مسجل</span>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-middle">
                                  {employee.nationality ? (
                                    <div className="flex items-center justify-center gap-2">
                                      <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-0.5 text-blue-700 font-bold text-[12px]">
                                        {nationalityFlagUrl ? (
                                          <img
                                            src={nationalityFlagUrl}
                                            alt={nationalityCode || ''}
                                            className="h-4 w-4"
                                            loading="lazy"
                                          />
                                        ) : nationalityFlag ? (
                                          <span
                                            className="text-base leading-none"
                                            style={{ fontFamily: 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji' }}
                                          >
                                            {nationalityFlag}
                                          </span>
                                        ) : null}
                                        {nationalityLabel && <span>{nationalityLabel}</span>}
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="text-center text-gray-300 text-xs font-semibold">لا يوجد</div>
                                  )}
                                </td>
                                <td className="px-4 py-4 align-middle">
                                  <div className="space-y-2 text-xs text-gray-700">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-500">التعيين</span>
                                        {employee.hiringDate ? (
                                          <span className="font-black text-[13px] text-blue-600">{formatYear(employee.hiringDate)}<span className="font-black text-red-600 text-[11px]"> <span className="text-gray-400 font-semibold">(</span>{serviceInfo ? formatAgeYears(serviceInfo.years) : '-'}<span className="text-gray-400 font-semibold">)</span></span></span>
                                        ) : (
                                          <span className="font-semibold text-gray-300">لا يوجد</span>
                                        )}
                                      </div>
                                      {employee.hiringDate && (
                                        <IconTooltip
                                          content={`تاريخ التعيين: ${formatDate(employee.hiringDate)}${serviceInfo ? ` • مدة الخدمة: ${formatYearsMonths(serviceInfo.years, serviceInfo.months)}` : ''
                                            }`}
                                        >
                                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white text-blue-700 text-xs font-bold border border-blue-200 shadow-sm">
                                            i
                                          </span>
                                        </IconTooltip>
                                      )}
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-500">الميلاد</span>
                                        {employee.birthDate ? (
                                          <span className="font-black text-[13px] text-blue-600">{formatYear(employee.birthDate)}<span className="font-black text-red-600 text-[11px]"><span className="text-gray-400 font-semibold"> (</span>{ageInfo ? formatAgeYears(ageInfo.years) : '-'}<span className="text-gray-400 font-semibold">)</span></span></span>
                                        ) : (
                                          <span className="font-semibold text-gray-300">لا يوجد</span>
                                        )}
                                      </div>
                                      {ageInfo && employee.birthDate && (
                                        <IconTooltip content={`تاريخ الميلاد: ${formatDate(employee.birthDate)} • العمر: ${formatYearsMonths(ageInfo.years, ageInfo.months)}`}>
                                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white text-blue-700 text-xs font-bold border border-blue-200 shadow-sm">
                                            i
                                          </span>
                                        </IconTooltip>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-middle">
                                  {isInactive ? (
                                    <div className="flex justify-center">
                                      <span className="inline-flex items-center rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                                        الموظف خارج الخدمة
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="space-y-2 text-xs text-gray-700">
                                      {showWeaponIcon && employee.hasWeapon && (
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="flex items-center gap-2">
                                            <Shield className={`w-4 h-4 ${employee.hasWeapon ? 'text-blue-600' : 'text-gray-400'}`} />
                                            <span className={`${employee.hasWeapon ? 'text-blue-600 font-bold' : 'text-gray-600'}`}>جهاز اتصال</span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <span className={`${employee.hasWeapon ? 'text-blue-600 font-bold' : 'text-red-600'}`}>
                                              {employee.hasWeapon ? 'يوجد' : 'لا يوجد'}
                                            </span>
                                            <IconTooltip content={weaponTooltip}>
                                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white text-blue-700 text-[10px] font-bold border border-blue-200 shadow-sm">
                                                i
                                              </span>
                                            </IconTooltip>
                                          </div>
                                        </div>
                                      )}
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                          <Car className={`w-4 h-4 ${employee.hasParking ? 'text-emerald-600' : 'text-gray-300'}`} />
                                          <span className={`${employee.hasParking ? 'text-emerald-600 font-bold' : 'text-gray-300'}`}>موقف</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className={`${employee.hasParking ? 'text-emerald-600  font-bold' : 'text-gray-300'}`}>
                                            {employee.hasParking ? 'يوجد' : 'لا يوجد'}
                                          </span>
                                          <IconTooltip content={parkingTooltip}>
                                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white text-blue-700 text-[10px] font-bold border border-blue-200 shadow-sm">
                                              i
                                            </span>
                                          </IconTooltip>
                                        </div>
                                      </div>
                                      {showShiftIcon && (
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="flex items-center gap-2">
                                            <ClipboardList className={`w-4 h-4 ${employee.includeInShifts === false ? 'text-gray-400' : 'text-emerald-600'}`} />
                                            <span className={`${employee.includeInShifts ? 'text-emerald-600 font-bold' : 'text-gray-300'}`}>المناوبات</span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <span className={`${employee.includeInShifts === false ? 'text-red-600' : 'text-emerald-600'}`}>
                                              {employee.includeInShifts === false ? 'لا يدرج' : 'يدرج'}
                                            </span>
                                            <IconTooltip content={shiftTooltip}>
                                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white text-blue-700 text-[10px] font-bold border border-blue-200 shadow-sm">
                                                i
                                              </span>
                                            </IconTooltip>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-4 align-middle">
                                  <div className="flex items-center justify-start gap-2">
                                    {manualOrderMode && (
                                      <span
                                        className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-xs font-black text-emerald-700"
                                        title="اسحب الصف لتغيير الترتيب"
                                      >
                                        سحب
                                      </span>
                                    )}
                                    <button
                                      onClick={() => openEditModal(employee)}
                                      className="p-2 text-yellow-600 hover:bg-yellow-100 rounded-lg transition-all duration-200 hover:scale-110"
                                      title="تعديل"
                                    >
                                      <Edit size={18} />
                                    </button>
                                    <button
                                      onClick={() => openDeleteModal(employee)}
                                      className="p-2 text-red-600 hover:bg-red-100 rounded-lg transition-all duration-200 hover:scale-110"
                                      title="حذف"
                                    >
                                      <Trash2 size={18} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // Grid View
            <div className="p-6">
              {Object.entries(paginatedEmployeesByCategory).map(([category, categoryEmployees]) => (
                <div key={category} className="mb-8">
                  <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-4 rounded-t-2xl text-white">
                    <h3 className="text-xl font-bold text-center">{category}</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 p-6 bg-gray-50 rounded-b-2xl">
                    {categoryEmployees.map((employee) => {
                      const nationalityFlag = getNationalityFlag(employee.nationality);
                      const nationalityLabel = getNationalityDisplayName(employee.nationality, nationalityFlag);
                      const departmentName = resolveDepartmentName(employee.department, departmentNameMap);
                      const sectionName = resolveSectionName(employee.department, employee.section, sectionNameMap);
                      const departmentLabel = departmentName
                        ? `${departmentName}${sectionName ? ` - ${sectionName}` : ''}`
                        : 'غير مسجل';
                      const departmentDisplay = departmentName ? wrapLabel(departmentName, 25) : '';
                      const sectionDisplay = sectionName ? wrapLabel(sectionName, 25) : '';
                      const departmentDisplayLabel = departmentDisplay
                        ? `${departmentDisplay}${sectionDisplay ? `\n${sectionDisplay}` : ''}`
                        : sectionDisplay || 'غير مسجل';
                      const fileNumberValue = employee.fileNumber || employee.militaryNumber || '';
                      const phoneValue = employee.phone_number || '';
                      const civilIdValue = employee.civilId || '';
                      const hiringYear = employee.hiringDate ? formatYear(employee.hiringDate) : '';
                      const birthYear = employee.birthDate ? formatYear(employee.birthDate) : '';
                      const jobTitleLabel = employee.jobTitle || 'لا يوجد';
                      const jobGradeLabel = employee.category === 'إداريون' ? (employee.jobGrade || '') : '';
                      const isHighlighted = employee.id === highlightEmployeeId;
                      const isFemale = employee.gender === 'أنثى';
                      const displayName = formatEmployeeDisplayName(employee) || employee.name || '—';
                      const secondmentLocation = (employee.secondmentLocation || '').trim();
                      const secondmentText = employee.isSecondedOutsideGeneralAdministration
                        ? `منتدب${secondmentLocation ? ` - ${secondmentLocation}` : ' - جهة الانتداب غير محددة'}`
                        : '';

                      return (
                        <div
                          key={employee.id}
                          id={`employee-row-${employee.id}`}
                          className={`rounded-2xl shadow-lg border border-gray-200 p-5 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 ${employee.status === 'inactive' ? 'bg-red-50' : 'bg-white'
                            } ${isHighlighted ? 'ring-2 ring-amber-300 bg-amber-50/60' : ''}`}
                        >
                          <div className="flex items-center justify-between mb-3 text-xs">
                            <div className="flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${employee.status === 'active' ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                              <span className={`font-semibold ${employee.status === 'active' ? 'text-emerald-600' : 'text-red-600'}`}>
                                {employee.status === 'active' ? 'في الخدمة' : 'خارج الخدمة'}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 text-right">
                            <div className="w-11 h-11 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                              {isFemale ? (
                                <Ribbon className="w-6 h-6 text-white" />
                              ) : (
                                <User className="w-6 h-6 text-white" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => openViewModal(employee)}
                                  className="font-bold text-gray-900 text-base hover:text-blue-700 transition-colors text-right leading-snug whitespace-normal break-words"
                                  title="عرض بيانات الموظف"
                                >
                                  {displayName}
                                </button>
                                {employee.rank && (
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${employee.status === 'inactive'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-blue-100 text-blue-700'
                                      }`}
                                  >
                                    {employee.rank}
                                  </span>
                                )}
                              </div>
                              {secondmentText && (
                                <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                                  <Briefcase className="w-3.5 h-3.5" />
                                  <span>{secondmentText}</span>
                                </div>
                              )}
                              <div
                                className={`mt-1 text-xs font-semibold leading-snug whitespace-normal break-words ${employee.jobTitle ? 'text-gray-700' : 'text-gray-200'}`}
                                title={jobTitleLabel}
                              >
                                {jobTitleLabel}
                              </div>
                              {employee.category === 'إداريون' && (
                                <div className={`mt-1 text-[11px] ${jobGradeLabel ? 'text-gray-500' : 'text-gray-300'}`}>
                                  {jobGradeLabel || 'لا يوجد'}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mt-3 space-y-2 text-[12px] text-gray-700">
                            <div className="grid grid-cols-[18px_1fr] items-start gap-2">
                              <Building className="w-3.5 h-3.5 text-blue-500 mt-0.5" />
                              <div className="min-w-0">
                                <div className="text-[11px] text-gray-500">الإدارة</div>
                                <div className={`font-semibold leading-snug whitespace-pre-line break-words ${departmentName ? 'text-gray-700' : 'text-gray-300'}`} title={departmentLabel}>
                                  {departmentDisplayLabel}
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-[18px_1fr] items-start gap-2">
                              <Globe className="w-3.5 h-3.5 text-blue-500 mt-0.5" />
                              <div className="min-w-0">
                                <div className="text-[11px] text-gray-500">الجنسية</div>
                                <div className={`font-semibold leading-snug whitespace-normal break-words ${nationalityLabel ? 'text-gray-700' : 'text-gray-300'}`} title={nationalityLabel || 'لا يوجد'}>
                                  {nationalityLabel || 'لا يوجد'}
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-[18px_1fr] items-start gap-2">
                              <FileText className="w-3.5 h-3.5 text-blue-500 mt-0.5" />
                              <div className="min-w-0">
                                <div className="text-[11px] text-gray-500">رقم الملف</div>
                                <div className={`font-semibold leading-snug whitespace-normal break-words ${fileNumberValue ? 'text-gray-700' : 'text-gray-300'}`} title={fileNumberValue || 'لا يوجد'}>
                                  {fileNumberValue || 'لا يوجد'}
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-[18px_1fr] items-start gap-2">
                              <Phone className="w-3.5 h-3.5 text-blue-500 mt-0.5" />
                              <div className="min-w-0">
                                <div className="text-[11px] text-gray-500">التواصل</div>
                                <div className={`font-semibold leading-snug whitespace-normal break-words ${phoneValue ? 'text-gray-700' : 'text-gray-300'}`} title={phoneValue || 'لا يوجد'}>
                                  {phoneValue || 'لا يوجد'}
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-[18px_1fr] items-start gap-2">
                              <User className="w-3.5 h-3.5 text-blue-500 mt-0.5" />
                              <div className="min-w-0">
                                <div className="text-[11px] text-gray-500">الرقم المدني</div>
                                <div className={`font-semibold leading-snug whitespace-normal break-words ${civilIdValue ? 'text-gray-700' : 'text-gray-300'}`} title={civilIdValue || 'لا يوجد'}>
                                  {civilIdValue || 'لا يوجد'}
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="grid grid-cols-[18px_1fr] items-start gap-2">
                                <Calendar className="w-3.5 h-3.5 text-blue-500 mt-0.5" />
                                <div className="min-w-0">
                                  <div className="text-[11px] text-gray-500">سنة التعيين</div>
                                  <div className={`font-semibold leading-snug whitespace-normal break-words ${hiringYear ? 'text-gray-700' : 'text-gray-300'}`} title={hiringYear || 'لا يوجد'}>
                                    {hiringYear || 'لا يوجد'}
                                  </div>
                                </div>
                              </div>
                              <div className="grid grid-cols-[18px_1fr] items-start gap-2">
                                <Calendar className="w-3.5 h-3.5 text-blue-500 mt-0.5" />
                                <div className="min-w-0">
                                  <div className="text-[11px] text-gray-500">سنة الميلاد</div>
                                  <div className={`font-semibold leading-snug whitespace-normal break-words ${birthYear ? 'text-gray-700' : 'text-gray-300'}`} title={birthYear || 'لا يوجد'}>
                                    {birthYear || 'لا يوجد'}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-center gap-2 pt-3 mt-3 border-t border-gray-100">
                            <button
                              onClick={() => openEditModal(employee)}
                              className="flex-1 py-2 text-yellow-600 hover:bg-yellow-50 rounded-lg transition-all text-sm font-medium"
                            >
                              تعديل
                            </button>
                            <button
                              onClick={() => openDeleteModal(employee)}
                              className="flex-1 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-all text-sm font-medium"
                            >
                              حذف
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* TEMP: Bulk CSV Upload Button */}
        <div className="mb-6 flex flex-col gap-4">
          <div className="flex justify-start">
            {/* <button
            onClick={handleBulkUploadClick}
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded shadow"
          >
            رفع موظفين دفعة واحدة (CSV)
          </button> */}
            <input
              type="file"
              accept=".csv"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleBulkFileChange}
            />
          </div>
          {bulkUploadError && (
            <div className="mb-4 text-red-600 font-bold text-center">{bulkUploadError}</div>
          )}

          {/* Preview Table */}
          {bulkPreviewEmployees.length > 0 && (
            <div className="bg-white rounded shadow p-4 border border-gray-200 overflow-x-auto">
              <div className="font-bold text-lg mb-2 text-center">معاينة الموظفين قبل الإضافة</div>
              <table className="min-w-full text-sm rtl text-right">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="px-2 py-1">رقم الملف</th>
                    <th className="px-2 py-1">الاسم</th>
                    <th className="px-2 py-1">الفئة</th>
                    <th className="px-2 py-1">المسمى الوظيفي</th>
                    <th className="px-2 py-1">المسمى الوظيفي</th>
                    <th className="px-2 py-1">القسم</th>
                    <th className="px-2 py-1">الحالة</th>
                    <th className="px-2 py-1">سبب التعطيل</th>
                    <th className="px-2 py-1">الجوال</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkPreviewEmployees.map((emp, idx) => (
                    <tr key={idx} className="border-b">
                      <td className="px-2 py-1">{emp.fileNumber}</td>
                      <td className="px-2 py-1">{emp.name}</td>
                      <td className="px-2 py-1">{emp.category}</td>
                      <td className="px-2 py-1">{emp.rank}</td>
                      <td className="px-2 py-1">{emp.jobTitle}</td>
                      <td className="px-2 py-1">{emp.department}</td>
                      <td className="px-2 py-1">{emp.status}</td>
                      <td className="px-2 py-1">{emp.reasonIfInactive}</td>
                      <td className="px-2 py-1">{emp.phone_number}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* جدول التكرارات */}
              {bulkDuplicates.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-400 rounded shadow p-4 mb-4 overflow-x-auto">
                  <div className="font-bold text-lg mb-2 text-yellow-900 text-center">تكرار رقم الملف</div>
                  <div className="text-sm text-yellow-800 mb-2 text-center">يوجد موظفون برقم ملف مكرر في الملف أو قاعدة البيانات. يرجى تصحيح الملف وإعادة الرفع.</div>
                  <table className="min-w-full text-sm rtl text-right">
                    <thead>
                      <tr className="bg-yellow-100">
                        <th className="px-2 py-1">رقم الملف</th>
                        <th className="px-2 py-1">الاسم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkDuplicates.map((emp, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="px-2 py-1 font-bold">{emp.fileNumber}</td>
                          <td className="px-2 py-1">{emp.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-center mt-4">
                <button
                  className="bg-blue-700 hover:bg-blue-800 text-white font-bold px-6 py-2 rounded-lg shadow"
                  onClick={handleBulkConfirm}
                  disabled={bulkUploading || bulkDuplicates.length > 0}
                >
                  {bulkUploading ? 'جاري الإضافة...' : 'تأكيد الإضافة إلى قاعدة البيانات'}
                </button>
              </div>
            </div>
          )}
          {/* Results Table */}
          {bulkUploadResults.length > 0 && (
            <div className="bg-white rounded shadow p-4 border border-gray-200 overflow-x-auto mt-2">
              <div className="font-bold text-lg mb-2 text-center">نتائج الإضافة</div>
              <table className="min-w-full text-sm rtl text-right">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="px-2 py-1">الاسم</th>
                    <th className="px-2 py-1">النتيجة</th>
                    <th className="px-2 py-1">الخطأ (إن وجد)</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkUploadResults.map((res, idx) => (
                    <tr key={idx} className="border-b">
                      <td className="px-2 py-1">{res.name}</td>
                      <td className="px-2 py-1">
                        {res.success ? (
                          <span className="text-green-700 font-bold">نجح</span>
                        ) : (
                          <span className="text-red-700 font-bold">فشل</span>
                        )}
                      </td>
                      <td className="px-2 py-1">{res.error || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {/* Enhanced Pagination and Controls */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6 mt-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            {/* Results Summary and Status */}
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="text-lg font-bold text-gray-900">
                عرض {((currentPage - 1) * itemsPerPage) + 1} إلى {Math.min(currentPage * itemsPerPage, sortedEmployees.length)} من أصل {sortedEmployees.length} موظف
              </div>
            </div>

            {/* View Controls */}
            <div className="flex items-center gap-4">
              {/* View Mode Toggle */}
              <div className="flex items-center bg-gray-100 rounded-xl p-1">
                <button
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${viewMode === 'list'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  <span className="text-sm font-medium">قائمة</span>
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${viewMode === 'grid'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                  <span className="text-sm font-medium">شبكة</span>
                </button>
              </div>

              {/* Items per page */}
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1); // إعادة تعيين الصفحة إلى الأولى
                }}
                className="px-4 py-2 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all text-sm"
              >
                <option value={20}>20 لكل صفحة</option>
                <option value={40}>40 لكل صفحة</option>
                <option value={50}>50 لكل صفحة</option>
                <option value={100}>100 لكل صفحة</option>
              </select>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center mt-6 pt-6 border-t border-gray-200">
              <div className="flex flex-col items-center gap-4 w-full">
                {categoryPageRanges.size > 1 && (
                  <div className="w-full">
                    <div className="text-xs font-semibold text-gray-500 text-center mb-2">
                      تنقل سريع حسب الفئة
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {Array.from(categoryPageRanges.entries()).map(([category, range]) => {
                        const isActive = currentPage >= range.start && currentPage <= range.end;
                        const rangeLabel = range.start === range.end
                          ? `ص ${range.start}`
                          : `ص ${range.start}-${range.end}`;
                        return (
                          <button
                            key={category}
                            onClick={() => setCurrentPage(range.start)}
                            className={`flex flex-col items-center gap-1 px-4 py-2 rounded-xl border text-sm transition-all ${isActive
                              ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:bg-blue-50/40'
                              }`}
                          >
                            <span className="font-semibold">{category}</span>
                            <span className={`text-[11px] ${isActive ? 'text-blue-600' : 'text-gray-500'}`}>
                              {rangeLabel} • {range.count} موظف
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="flex items-center gap-2 px-4 py-2 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    السابق
                  </button>

                  <div className="flex items-center gap-1 mx-4">
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      let page;
                      if (totalPages <= 7) {
                        page = i + 1;
                      } else if (currentPage <= 4) {
                        page = i + 1;
                      } else if (currentPage >= totalPages - 3) {
                        page = totalPages - 6 + i;
                      } else {
                        page = currentPage - 3 + i;
                      }

                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`w-10 h-10 rounded-xl text-sm font-bold transition-all ${currentPage === page
                            ? 'bg-blue-600 text-white shadow-lg'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                          {page}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="flex items-center gap-2 px-4 py-2 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    التالي
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {showInactiveEmployees && (
          <div ref={inactiveTableRef} className="mt-6 overflow-hidden rounded-2xl border border-red-200 bg-white shadow-lg">
            <div className="bg-gradient-to-r from-red-700 to-red-600 px-6 py-4 text-white">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black">كشف خارج الخدمة</h3>
                    <p className="text-sm font-semibold text-red-100">كشف مستقل</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowInactiveEmployees((current) => !current)}
                  className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold shadow-sm transition-all ${showInactiveEmployees
                    ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
                    : 'border-red-100 bg-white text-red-700 hover:bg-red-50'
                    }`}
                >
                  <Users className="h-4 w-4" />
                  <span className={`rounded-full px-2 py-0.5 text-xs ${showInactiveEmployees ? 'bg-white/20 text-white' : 'bg-red-50 text-red-700'}`}>
                    {inactiveEmployees.length} موظف
                  </span>
                  <X className="h-4 w-4" /> <span className="text-xs">إخفاء</span>

                </button>
              </div>
            </div>

            {inactiveTotalCount > 0 ? (
              <div>
                <div className="border-b border-red-100 bg-red-50/60 px-6 py-4">
                  <div className="relative max-w-xl">
                    <Search className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-red-500" />
                    <input
                      type="text"
                      value={inactiveSearchTerm}
                      onChange={(event) => setInactiveSearchTerm(event.target.value)}
                      placeholder="بحث سريع في كشف خارج الخدمة..."
                      className="w-full rounded-xl border-2 border-red-100 bg-white py-3 pl-12 pr-11 text-sm font-semibold text-slate-800 placeholder:text-slate-400 focus:border-red-400 focus:outline-none focus:ring-4 focus:ring-red-100"
                    />
                    {inactiveSearchTerm && (
                      <button
                        type="button"
                        onClick={() => setInactiveSearchTerm('')}
                        className="absolute left-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-red-50 text-red-500 hover:bg-red-100"
                        title="مسح البحث"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-right text-sm">
                    <thead className="bg-red-50 text-red-900">
                      <tr>
                        <th className="px-4 py-3 text-center font-black">م</th>
                        <th className="px-4 py-3 font-black">الموظف</th>
                        <th className="px-4 py-3 font-black">الإدارة والقسم</th>
                        <th className="px-4 py-3 font-black">الأرقام</th>
                        <th className="px-4 py-3 font-black">بيانات الخروج</th>
                        <th className="px-4 py-3 font-black">الإجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-red-100">
                      {inactiveEmployees.map((employee, index) => {
                        const departmentName = resolveDepartmentName(employee.department, departmentNameMap);
                        const sectionName = resolveSectionName(employee.department, employee.section, sectionNameMap);
                        const displayName = formatEmployeeDisplayName(employee) || employee.name || '—';
                        const fileNumberValue = employee.fileNumber || employee.militaryNumber || '';

                        return (
                          <tr key={employee.id} className="bg-red-50/35 hover:bg-red-50">
                            <td className="px-4 py-3 text-center">
                              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-xs font-black text-white">
                                {index + 1}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                {employee.rank && (
                                  <span className="inline-flex rounded-full border border-red-100 bg-white px-2.5 py-0.5 text-xs font-black text-red-700">
                                    {employee.rank}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openViewModal(employee)}
                                  className="font-black text-slate-950 hover:text-red-700"
                                  title="عرض بيانات الموظف"
                                >
                                  {displayName}
                                </button>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                                {employee.jobTitle && <span>{employee.jobTitle}</span>}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm font-semibold text-slate-700">
                              <div>{departmentName || 'غير مسجل'}</div>
                              {sectionName && <div className="mt-1 text-xs text-slate-500">{sectionName}</div>}
                            </td>
                            <td className="px-4 py-3">
                              <div className="space-y-1 text-xs font-bold text-slate-700">
                                <div className="flex items-center gap-2">
                                  <Hash className="h-3.5 w-3.5 text-red-500" />
                                  {fileNumberValue ? (
                                    <button type="button" onClick={() => handleCopyValue(fileNumberValue, 'رقم الملف')} className="text-blue-700 hover:text-blue-900">
                                      {fileNumberValue}
                                    </button>
                                  ) : (
                                    <span className="text-slate-300">لا يوجد</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Phone className="h-3.5 w-3.5 text-red-500" />
                                  {employee.phone_number ? (
                                    <button type="button" onClick={() => handleCopyValue(employee.phone_number || '', 'رقم التواصل')} className="text-emerald-700 hover:text-emerald-900">
                                      {employee.phone_number}
                                    </button>
                                  ) : (
                                    <span className="text-slate-300">لا يوجد</span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-xs font-bold text-slate-700">
                                <div>{employee.inactiveDate ? formatDate(employee.inactiveDate) : 'تاريخ غير مسجل'}</div>
                                <div className="mt-1 max-w-[260px] whitespace-normal break-words text-red-700">
                                  {employee.reasonIfInactive || 'سبب غير مسجل'}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => openEditModal(employee)}
                                  className="rounded-lg p-2 text-yellow-600 transition hover:bg-yellow-100"
                                  title="تعديل"
                                >
                                  <Edit size={18} />
                                </button>
                                <button
                                  onClick={() => openDeleteModal(employee)}
                                  className="rounded-lg p-2 text-red-700 transition hover:bg-red-100"
                                  title="حذف"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {inactiveEmployees.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                            لا توجد نتائج مطابقة للبحث الحالي
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="px-6 py-8 text-center text-sm font-bold text-slate-500">
                لا يوجد موظفون خارج الخدمة.
              </div>
            )}
          </div>
        )}

        {/* Employee Modal */}
        <EmployeeModal
          mode={modalMode}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          employee={selectedEmployee}
          departments={departments}
          ranks={ranks}
          onSave={reloadEmployees}
          showNavigateToManagement={false}
        />

        <ConfirmDeleteModal
          isOpen={deleteModal.isOpen}
          onClose={closeDeleteModal}
          onConfirm={handleDeleteConfirm}
          title="تنبيه قبل الحذف"
          description={`سيتم حذف بيانات ${deleteModal.employee?.rank ? ` ${deleteModal.employee.rank}` : ''} / ${deleteEmployeeName ? ` ${deleteEmployeeName}` : ''}, نهائياً ولا يمكن التراجع عن ذلك.`}
          confirmLabel="حذف نهائي"
        />

        <ForceWordSyncModal
          isOpen={forceSyncOpen}
          onClose={() => setForceSyncOpen(false)}
          onApplied={reloadEmployees}
        />

        <ScrollToTop />
      </div>
    </div>
  );
};

export default EmployeeManagement;
