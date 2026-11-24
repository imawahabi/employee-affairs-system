import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Users, Calendar, CheckCircle, ChevronLeft, AlertTriangle, Search, X, UserPlus, FileText, Save, ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react';
import { LicenseService } from '../services/licenseService';
import { EmployeeService } from '../services/employeeService';
import { getSearchTokens, matchesArabicSearch } from '../../utils/search';
import { Employee, License } from '../types';
import { format } from 'date-fns';
import { arSA } from 'date-fns/locale';
import LoadingPage from '../../components/LoadingPage';

// Constants for monthly limits
const MONTHLY_LIMITS = {
  FULL_DAY_LICENSES: 3,
  SHORT_LICENSES: 4,
  MAX_HOURS_PER_MONTH: 12,
  MEDICAL_LICENSES: Infinity
};

const HOURLY_LICENSE_TYPES: Array<License['license_type']> = ['إستئذان قصير', 'إستئذان طبي'];

interface LicenseConfig {
  selectedEmployee: Employee | null;
  licenseType: 'يوم كامل' | 'إستئذان قصير' | 'إستئذان طبي';
  licenseDate: Date | null;
  hours?: number;
  permissionTime?: string;
  notes?: string;
  jobTitle?: string;
}

type Step = 'selection' | 'review';

type DuplicateValidation = {
  level: 'none' | 'warning' | 'error';
  title: string;
  description: string;
};

interface AddLicenseProps {
  onNavigate?: (page: string) => void;
}

const AddLicense: React.FC<AddLicenseProps> = ({ onNavigate }) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState<Step>('selection');
  const [searchQuery, setSearchQuery] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<License[] | null>(null);
  const [monthlyLimitWarning, setMonthlyLimitWarning] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning', text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const [licenseConfig, setLicenseConfig] = useState<LicenseConfig>({
    selectedEmployee: null,
    licenseType: 'يوم كامل',
    licenseDate: new Date(),
    hours: undefined,
    permissionTime: '',
    notes: ''
  });

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const generateCalendarDays = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    const days = [];

    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    return days;
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(licenseConfig.licenseDate || new Date());
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setLicenseConfig(prev => ({ ...prev, licenseDate: newDate }));
  };

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
    const loadData = async () => {
      try {
        setLoading(true);
        const [employeesData, licensesData] = await Promise.all([
          EmployeeService.getAll(),
          LicenseService.getAll()
        ]);
        setEmployees(employeesData.filter(employee => employee.status !== 'inactive'));
        setLicenses(licensesData);
      } catch (error) {
        console.error('Error loading data:', error);
        setMessage({ type: 'error', text: 'فشل في تحميل البيانات' });
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const getEmployeeIdentifier = (employee: Employee | null) => {
    if (!employee) return null;
    const isCivilian = employee.category === 'إداري';
    const value = isCivilian
      ? (employee.civil_id || employee.file_number)
      : (employee.file_number || employee.civil_id);
    if (!value) return null;
    return {
      label: isCivilian ? 'الرقم المدني' : 'رقم الملف',
      shortLabel: isCivilian ? 'الرقم المدني' : 'رقم الملف',
      value
    };
  };

  const filteredEmployees = useMemo(() => {
    if (!searchQuery) return employees;
    const tokens = getSearchTokens(searchQuery);
    return employees.filter(emp => matchesArabicSearch([
      emp.full_name,
      emp.rank,
      emp.file_number,
      emp.civil_id,
      emp.category,
    ], tokens));
  }, [employees, searchQuery]);

  const calculateEmployeeMonthlyStats = useMemo(() => {
    if (!licenseConfig.selectedEmployee || !licenseConfig.licenseDate) {
      return null;
    }

    const currentDate = licenseConfig.licenseDate;
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    const employeeLicenses = licenses.filter(license => {
      if (!license.employee || license.employee.id !== licenseConfig.selectedEmployee!.id) return false;
      const licenseDate = new Date(license.license_date);
      return licenseDate.getFullYear() === currentYear &&
             licenseDate.getMonth() + 1 === currentMonth;
    });

    let fullDayLicenses = 0;
    let shortLicenses = 0;
    let medicalLicenses = 0;
    let totalHours = 0;

    employeeLicenses.forEach(license => {
      if (license.license_type === 'يوم كامل') {
        fullDayLicenses++;
      } else if (license.license_type === 'إستئذان قصير') {
        shortLicenses++;
        totalHours += license.hours || 0;
      } else if (license.license_type === 'إستئذان طبي') {
        medicalLicenses++;
      }
    });

    return {
      fullDayLicenses,
      shortLicenses,
      medicalLicenses,
      totalHours,
      remainingFullDays: Math.max(0, MONTHLY_LIMITS.FULL_DAY_LICENSES - fullDayLicenses),
      remainingShortLicenses: Math.max(0, MONTHLY_LIMITS.SHORT_LICENSES - shortLicenses),
      remainingMedicalLicenses: Math.max(0, MONTHLY_LIMITS.MEDICAL_LICENSES - medicalLicenses),
      remainingHours: Math.max(0, MONTHLY_LIMITS.MAX_HOURS_PER_MONTH - totalHours)
    };
  }, [licenseConfig.selectedEmployee, licenseConfig.licenseDate, licenses]);

  useEffect(() => {
    const checkDuplicates = async () => {
      if (!licenseConfig.selectedEmployee || !licenseConfig.licenseDate) {
        setDuplicateWarning(null);
        return;
      }
      try {
        const dateString = formatDate(licenseConfig.licenseDate);
        const duplicates = await LicenseService.checkDuplicateDate(licenseConfig.selectedEmployee.id.toString(), dateString);
        setDuplicateWarning(duplicates.length > 0 ? duplicates : null);
      } catch (error) {
        console.error('Error checking duplicates:', error);
      }
    };
    checkDuplicates();
  }, [licenseConfig.selectedEmployee, licenseConfig.licenseDate]);

  const duplicateValidation = useMemo<DuplicateValidation>(() => {
    if (!duplicateWarning || duplicateWarning.length === 0) {
      return { level: 'none', title: '', description: '' };
    }

    const fullDayDuplicatesCount = duplicateWarning.filter(license => license.license_type === 'يوم كامل').length;
    const shortDuplicatesCount = duplicateWarning.filter(license => license.license_type === 'إستئذان قصير').length;
    const medicalDuplicatesCount = duplicateWarning.filter(license => license.license_type === 'إستئذان طبي').length;
    const hourlyDuplicatesCount = duplicateWarning.filter(license => HOURLY_LICENSE_TYPES.includes(license.license_type)).length;

    if (licenseConfig.licenseType === 'يوم كامل') {
      if (shortDuplicatesCount > 0 || medicalDuplicatesCount > 0) {
        return {
          level: 'error',
          title: 'لا يمكن تسجيل رخصة يوم كامل',
          description: 'يوجد استئذان قصير أو طبي مسجل مسبقاً في هذا التاريخ.'
        };
      }

      if (fullDayDuplicatesCount > 0) {
        return {
          level: 'error',
          title: 'لا يمكن تسجيل رخصة مكررة',
          description: 'يوجد رخصة يوم كامل مسجلة مسبقاً في نفس التاريخ.'
        };
      }

      return { level: 'none', title: '', description: '' };
    }

    if (fullDayDuplicatesCount > 0) {
      return {
        level: 'error',
        title: 'لا يمكن تسجيل استئذان ساعات',
        description: 'يوجد رخصة يوم كامل مسجلة في هذا التاريخ.'
      };
    }

    if (licenseConfig.licenseType === 'إستئذان قصير' && medicalDuplicatesCount > 0 && shortDuplicatesCount >= 1) {
      return {
        level: 'error',
        title: 'تم بلوغ الحد المسموح مع الاستئذان الطبي',
        description: 'عند وجود استئذان طبي يمكن تسجيل استئذان قصير واحد فقط في نفس اليوم.'
      };
    }

    if (hourlyDuplicatesCount >= 2) {
      return {
        level: 'error',
        title: 'تم بلوغ الحد اليومي للاستئذانات',
        description: 'يمكن تسجيل استئذانين فقط في نفس اليوم.'
      };
    }

    if (licenseConfig.licenseType === 'إستئذان قصير' && medicalDuplicatesCount > 0 && shortDuplicatesCount === 0) {
      return {
        level: 'warning',
        title: 'تنبيه: يوجد استئذان طبي في نفس اليوم',
        description: 'مسموح تسجيل استئذان قصير واحد فقط مع الاستئذان الطبي في نفس اليوم.'
      };
    }

    if (hourlyDuplicatesCount === 1) {
      return {
        level: 'warning',
        title: 'تنبيه: يوجد استئذان سابق في نفس اليوم',
        description: 'سيتم تسجيل الاستئذان الثاني. الحد الأقصى استئذانان في نفس اليوم.'
      };
    }

    return { level: 'none', title: '', description: '' };
  }, [duplicateWarning, licenseConfig.licenseType]);

  const hasBlockingDuplicate = duplicateValidation.level === 'error';
  const hasDuplicateWarning = duplicateValidation.level === 'warning';
  const hasAnyDuplicateNotice = duplicateValidation.level !== 'none';

  useEffect(() => {
    if (!calculateEmployeeMonthlyStats) {
      setMonthlyLimitWarning(null);
      return;
    }

    const stats = calculateEmployeeMonthlyStats;
    const warnings: string[] = [];

    if (licenseConfig.licenseType === 'يوم كامل') {
      if (stats.fullDayLicenses >= MONTHLY_LIMITS.FULL_DAY_LICENSES) {
        warnings.push(`وصل للحد الأقصى للاستئذانات الطويلة (${MONTHLY_LIMITS.FULL_DAY_LICENSES} استئذانات).`);
      } else if (stats.remainingFullDays === 1) {
        warnings.push(`تحذير: متبقي استئذان طويل واحد فقط.`);
      }
    } else if (licenseConfig.licenseType === 'إستئذان قصير' && licenseConfig.hours) {
      const newTotalHours = stats.totalHours + (licenseConfig.hours || 0);
      if (stats.shortLicenses >= MONTHLY_LIMITS.SHORT_LICENSES) {
        warnings.push(`تم الوصول للحد الأقصى للاستئذانات القصيرة (${MONTHLY_LIMITS.SHORT_LICENSES}).`);
      }
      if (newTotalHours > MONTHLY_LIMITS.MAX_HOURS_PER_MONTH) {
        warnings.push(`سيتم تجاوز الحد الأقصى للساعات (${MONTHLY_LIMITS.MAX_HOURS_PER_MONTH}).`);
      }
      if (stats.shortLicenses === MONTHLY_LIMITS.SHORT_LICENSES - 1) {
        warnings.push('تحذير: سيتم استخدام آخر استئذان قصير متاح.');
      }
      if (newTotalHours === MONTHLY_LIMITS.MAX_HOURS_PER_MONTH) {
        warnings.push(`تحذير: سيتم الوصول إلى الحد الأقصى للساعات (${MONTHLY_LIMITS.MAX_HOURS_PER_MONTH}).`);
      }
    }

    setMonthlyLimitWarning(warnings.length > 0 ? warnings.join('\n') : null);
  }, [calculateEmployeeMonthlyStats, licenseConfig.licenseType, licenseConfig.hours]);

  const hasCriticalLimitViolation = useMemo(() => {
    if (!calculateEmployeeMonthlyStats) return false;
    const stats = calculateEmployeeMonthlyStats;

    if (licenseConfig.licenseType === 'يوم كامل') {
      return stats.fullDayLicenses >= MONTHLY_LIMITS.FULL_DAY_LICENSES;
    }

    if (licenseConfig.licenseType === 'إستئذان طبي') {
      return false;
    }

    if (licenseConfig.licenseType === 'إستئذان قصير' && licenseConfig.hours) {
      if (stats.shortLicenses >= MONTHLY_LIMITS.SHORT_LICENSES) return true;
      if (stats.totalHours + licenseConfig.hours > MONTHLY_LIMITS.MAX_HOURS_PER_MONTH) return true;
    }

    return false;
  }, [calculateEmployeeMonthlyStats, licenseConfig.licenseType, licenseConfig.hours]);

  const steps = [
    { id: 'selection', title: 'اختيار الموظف وتفاصيل الرخصة/الإستئذان', icon: Users, description: 'حدد الموظف والتاريخ ونوع الرخصة' },
    { id: 'review', title: 'المراجعة والحفظ', icon: Save, description: 'تأكيد وحفظ الرخصة/الاستئذان' }
  ];

  const getCurrentStepIndex = () => steps.findIndex(step => step.id === currentStep);

  const canProceedToNextStep = () => {
    if (currentStep === 'selection') {
      return !!(licenseConfig.selectedEmployee && licenseConfig.licenseDate && (
        licenseConfig.licenseType === 'يوم كامل' || 
        (licenseConfig.licenseType === 'إستئذان قصير' && licenseConfig.hours && licenseConfig.hours > 0) || 
        (licenseConfig.licenseType === 'إستئذان طبي' && licenseConfig.hours && licenseConfig.hours > 0)
      )) && !hasBlockingDuplicate && !hasCriticalLimitViolation;
    }
    return true;
  };

  const nextStep = () => {
    if (hasBlockingDuplicate) {
      setMessage({ type: 'error', text: `لا يمكن المتابعة. ${duplicateValidation.description}` });
      return;
    }

    if (calculateEmployeeMonthlyStats) {
      const stats = calculateEmployeeMonthlyStats;

      if (licenseConfig.licenseType === 'يوم كامل' && stats.remainingFullDays <= 0) {
        setMessage({ type: 'error', text: 'لا يمكن المتابعة. تم استنفاد الحد الأقصى للاستئذانات الطويلة هذا الشهر.' });
        return;
      }

      if (licenseConfig.licenseType === 'إستئذان قصير' && licenseConfig.hours) {
        if (stats.shortLicenses >= MONTHLY_LIMITS.SHORT_LICENSES) {
          setMessage({ type: 'error', text: 'لا يمكن المتابعة. تم استنفاد الحد الأقصى للاستئذانات القصيرة هذا الشهر.' });
          return;
        }
        const newTotalHours = stats.totalHours + licenseConfig.hours;
        if (newTotalHours > MONTHLY_LIMITS.MAX_HOURS_PER_MONTH) {
          setMessage({ type: 'error', text: `لا يمكن المتابعة. سيتم تجاوز الحد الأقصى للساعات الشهرية (${MONTHLY_LIMITS.MAX_HOURS_PER_MONTH} ساعة).` });
          return;
        }
      }
    }

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

  const handleEmployeeSelect = (employee: Employee) => {
    setLicenseConfig(prev => ({
      ...prev,
      selectedEmployee: prev.selectedEmployee?.id === employee.id ? null : employee
    }));
  };

  const handleRemoveEmployee = () => {
    setLicenseConfig(prev => ({
      ...prev,
      selectedEmployee: null
    }));
  };

  const handleSubmit = async () => {
    if (!licenseConfig.selectedEmployee || !licenseConfig.licenseDate) {
      setMessage({ type: 'error', text: 'يرجى اختيار موظف وتحديد التاريخ' });
      return;
    }

    if ((licenseConfig.licenseType === 'إستئذان قصير' || licenseConfig.licenseType === 'إستئذان طبي') && (!licenseConfig.hours || licenseConfig.hours <= 0)) {
      setMessage({ type: 'error', text: 'يرجى إدخال عدد الساعات' });
      return;
    }

    if (hasBlockingDuplicate) {
      setMessage({ type: 'error', text: `لا يمكن إضافة رخصة للموظف المحدد. ${duplicateValidation.description}` });
      return;
    }

    if (calculateEmployeeMonthlyStats) {
      const stats = calculateEmployeeMonthlyStats;

      if (licenseConfig.licenseType === 'يوم كامل' && stats.remainingFullDays <= 0) {
        setMessage({ type: 'error', text: 'لا يمكن حفظ الرخصة. تم استنفاد الحد الأقصى للاستئذانات الطويلة هذا الشهر.' });
        return;
      }

      if (licenseConfig.licenseType === 'إستئذان قصير' && licenseConfig.hours) {
        if (stats.shortLicenses >= MONTHLY_LIMITS.SHORT_LICENSES) {
          setMessage({ type: 'error', text: 'لا يمكن حفظ الرخصة. تم استنفاد الحد الأقصى للاستئذانات القصيرة هذا الشهر.' });
          return;
        }
        const newTotalHours = stats.totalHours + licenseConfig.hours;
        if (newTotalHours > MONTHLY_LIMITS.MAX_HOURS_PER_MONTH) {
          setMessage({ type: 'error', text: `لا يمكن حفظ الرخصة. سيتم تجاوز الحد الأقصى للساعات الشهرية (${MONTHLY_LIMITS.MAX_HOURS_PER_MONTH} ساعة).` });
          return;
        }
      }
    }

    setIsSubmitting(true);
    try {
      const newLicense = {
        employee_id: licenseConfig.selectedEmployee.id,
        license_type: licenseConfig.licenseType,
        license_date: formatDate(licenseConfig.licenseDate),
        hours: (licenseConfig.licenseType === 'إستئذان قصير' || licenseConfig.licenseType === 'إستئذان طبي') ? licenseConfig.hours : undefined,
        permission_time: (licenseConfig.licenseType === 'إستئذان قصير' || licenseConfig.licenseType === 'إستئذان طبي')
          ? (licenseConfig.permissionTime || '')
          : undefined,
        notes: licenseConfig.notes || '',
        month: licenseConfig.licenseDate.getMonth() + 1,
        year: licenseConfig.licenseDate.getFullYear(),
        reason: '',
        approved: true
      };

      await LicenseService.create(newLicense);

      setMessage({ type: 'success', text: `تم تسجيل رخصة ${licenseConfig.selectedEmployee.full_name} بنجاح` });

      // Navigate to license records page after successful submission
      if (onNavigate) {
        setTimeout(() => {
          onNavigate('licenses-list');
        }, 1500);
      } else {
        setLicenseConfig({
          selectedEmployee: null,
          licenseType: 'يوم كامل',
          licenseDate: new Date(),
          hours: undefined,
          permissionTime: '',
          notes: ''
        });
        setCurrentStep('selection');
        setSearchQuery('');
      }
    } catch (error) {
      console.error('Error submitting license:', error);
      setMessage({ type: 'error', text: 'حدث خطأ أثناء حفظ الرخصة' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      'قيادات': { bg: 'bg-blue-100', text: 'text-blue-800' },
      'مشرفون': { bg: 'bg-green-100', text: 'text-green-800' },
      'فني': { bg: 'bg-yellow-100', text: 'text-yellow-800' },
      'إداري': { bg: 'bg-orange-100', text: 'text-orange-800' },
    };
    return colors[category] || { bg: 'bg-gray-100', text: 'text-gray-800' };
  };

  if (loading && employees.length === 0) {
    return <LoadingPage variant="dashboard" title="جاري تحضير إضافة استئذان" subtitle="يرجى الانتظار بينما نحضر الموظفين وسجلات الاستئذانات..." />;
  }

  const progressPercent = ((getCurrentStepIndex() + 1) / steps.length) * 100;

  const renderStepContent = () => {
    switch (currentStep) {
      case 'selection':
        return (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">اختيار الموظف</h2>
                  <p className="text-sm text-slate-500">اختر الموظف لتسجيل الرخصة/الاستئذان</p>
                </div>
                {licenseConfig.selectedEmployee && (
                  <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle size={14} />
                    موظف محدد
                  </span>
                )}
              </div>
            </div>

            {!licenseConfig.selectedEmployee && (
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="relative">
                  <Search size={20} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  {searchQuery.trim() && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      title="مسح البحث"
                    >
                      <X size={16} />
                    </button>
                  )}
                  <input
                    type="text"
                    placeholder="ابحث بالاسم، المسمى الوظيفي، رقم الملف، الرقم المدني، أو الفئة..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pr-12 pl-10 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm"
                  />
                </div>
              </div>
            )}

            {licenseConfig.selectedEmployee && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                  <h3 className="font-bold text-emerald-800">تسجيل رخصة لـ</h3>
                  <button
                    onClick={handleRemoveEmployee}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white hover:from-red-600 hover:to-red-700 rounded-xl transition-all duration-200 shadow-md hover:shadow-lg border border-red-300 font-medium text-sm"
                  >
                    <X size={16} />
                    اختيار موظف آخر
                  </button>
                </div>
                <div className="flex items-center gap-4 bg-white px-4 py-3 rounded-lg border border-emerald-200">
                  <div className="w-10 h-10 bg-emerald-600 rounded-full flex items-center justify-center">
                    <CheckCircle className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 text-right">
                    <div className="font-bold text-gray-600 text-md leading-relaxed">
                      {licenseConfig.selectedEmployee.rank} / <span className="font-black text-lg text-gray-800 ">{licenseConfig.selectedEmployee.full_name}</span>
                      {licenseConfig.selectedEmployee.jobTitle && (
                        <span className="font-bold whitespace-nowrap bg-green-100 px-3 py-1 rounded-full text-xs text-green-700 border border-green-300 mr-2 inline-block">
                          {licenseConfig.selectedEmployee.jobTitle}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 mt-1 inline-block leading-relaxed overflow-visible">
                      {licenseConfig.selectedEmployee.department && (
                        <span className="ml-3">الإدارة: <span className="font-bold text-slate-700 inline-block leading-relaxed overflow-visible">{licenseConfig.selectedEmployee.department}</span></span>
                      )}
                      {getEmployeeIdentifier(licenseConfig.selectedEmployee) && (
                        <span className="ml-3 whitespace-nowrap inline-block leading-relaxed overflow-visible">
                          {getEmployeeIdentifier(licenseConfig.selectedEmployee)?.label}:{' '}
                          <span className="font-bold text-slate-700">
                            {getEmployeeIdentifier(licenseConfig.selectedEmployee)?.value}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!licenseConfig.selectedEmployee && (
              <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-white via-blue-50/60 to-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 bg-blue-50/80 border-b border-blue-100">
                  <div className="text-sm font-extrabold text-blue-900">نتائج الموظفين</div>
                  <span className="text-xs font-semibold text-blue-700">{filteredEmployees.length} نتيجة</span>
                </div>
                {(searchQuery || filteredEmployees.length > 0) && (
                  <div className="max-h-[16rem] overflow-y-auto divide-y divide-slate-100">
                    {filteredEmployees.length > 0 ? (
                      filteredEmployees.slice(0, 20).map(employee => {
                        const isSelected = licenseConfig.selectedEmployee?.id === employee.id;
                        return (
                          <div
                            key={employee.id}
                            onClick={() => handleEmployeeSelect(employee)}
                            className={`p-4 transition-all cursor-pointer ${
                              isSelected ? 'bg-emerald-50/80 border-l-4 border-emerald-400' : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`px-2 py-1 text-xs font-semibold rounded-md ${getCategoryColor(employee.category).bg} ${getCategoryColor(employee.category).text}`}>
                                    {employee.category}
                                  </span>
                                  <h3 className="font-bold text-slate-900">{employee.rank} / {employee.full_name}</h3>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                                  {getEmployeeIdentifier(employee) ? (
                                    <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                                      {getEmployeeIdentifier(employee)?.shortLabel}: {getEmployeeIdentifier(employee)?.value}
                                    </span>
                                  ) : (
                                    <span className="rounded-full border border-slate-200 bg-white px-2 py-1">لا يوجد رقم</span>
                                  )}
                                </div>
                              </div>
                              <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center ${
                                isSelected ? 'bg-emerald-600 border-emerald-600' : 'border-slate-300'
                              }`}>
                                {isSelected && <CheckCircle size={16} className="text-white" />}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center text-slate-500 py-6">لا توجد نتائج مطابقة.</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {licenseConfig.selectedEmployee && (
              <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm space-y-6">
                <h2 className="text-xl font-black text-slate-900">تفاصيل الرخصة</h2>

                <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-5">
                  <h3 className="text-sm font-semibold text-blue-700 mb-3">تاريخ الرخصة/الاستئذان</h3>
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
                      <span className="font-semibold text-gray-800">
                        {licenseConfig.licenseDate ? format(licenseConfig.licenseDate, 'EEEE، dd MMMM yyyy', { locale: arSA }) : 'اختر التاريخ'}
                      </span>
                    </button>
                    {isCalendarOpen && buttonRect && createPortal(
                      <div
                        className="fixed bg-white border border-gray-300 rounded-lg shadow-xl p-4 min-w-[300px] z-[9999]"
                        style={{ top: buttonRect.top + window.scrollY - 340, left: buttonRect.left + window.scrollX + (buttonRect.width / 2) - 150 }}
                        ref={calendarRef}
                      >
                        <div className="flex items-center justify-between mb-4">
                          <button onClick={() => navigateMonth('prev')} className="p-1 hover:bg-gray-100 rounded">
                            <ChevronDown className="w-4 h-4 transform -rotate-90" />
                          </button>
                          <h3 className="text-lg font-semibold text-gray-900">
                            {licenseConfig.licenseDate ? format(licenseConfig.licenseDate, 'MMMM yyyy', { locale: arSA }) : ''}
                          </h3>
                          <button onClick={() => navigateMonth('next')} className="p-1 hover:bg-gray-100 rounded">
                            <ChevronDown className="w-4 h-4 transform rotate-90" />
                          </button>
                        </div>
                        <div className="grid grid-cols-7 gap-1 mb-2">
                          {['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'].map(day => (
                            <div key={day} className="text-center text-xs font-medium text-gray-500 py-2">{day}</div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {generateCalendarDays(licenseConfig.licenseDate || new Date()).map((day, index) => (
                            <button
                              key={index}
                              onClick={() => {
                                if (day) {
                                  setLicenseConfig(prev => ({ ...prev, licenseDate: day }));
                                  setIsCalendarOpen(false);
                                }
                              }}
                              disabled={!day}
                              className={`h-8 text-sm rounded transition-colors ${!day ? 'invisible' : ''} ${
                                day && licenseConfig.licenseDate && format(day, 'yyyy-MM-dd') === format(licenseConfig.licenseDate, 'yyyy-MM-dd')
                                  ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-900'
                              } ${day && format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') ? 'ring-2 ring-blue-300' : ''}`}
                            >
                              {day ? day.getDate() : ''}
                            </button>
                          ))}
                        </div>
                        <div className="mt-4 flex justify-end">
                          <button onClick={() => setIsCalendarOpen(false)} className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800">إغلاق</button>
                        </div>
                      </div>, document.body
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-slate-700">نوع الرخصة/الاستئذان *</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div
                      onClick={() => setLicenseConfig(prev => ({ ...prev, licenseType: 'يوم كامل', hours: undefined, permissionTime: '' }))}
                      className={`p-4 border-2 rounded-xl cursor-pointer transition-all duration-200 ${
                        licenseConfig.licenseType === 'يوم كامل' ? 'border-blue-500 bg-blue-50 shadow-md' : 'border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      <div className="text-center">
                        <div className={`w-10 h-10 rounded-lg mx-auto mb-2 flex items-center justify-center ${
                          licenseConfig.licenseType === 'يوم كامل' ? 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg' : 'bg-gray-200'
                        }`}>
                          <Calendar className="w-5 h-5 text-white" />
                        </div>
                        <div className={`font-bold ${licenseConfig.licenseType === 'يوم كامل' ? 'text-blue-800' : 'text-gray-800'}`}>رخصة يوم كامل</div>
                        <div className={`text-xs mt-1 ${licenseConfig.licenseType === 'يوم كامل' ? 'text-blue-600' : 'text-gray-500'}`}>يوم كامل</div>
                      </div>
                    </div>
                    <div
                      onClick={() => setLicenseConfig(prev => ({ ...prev, licenseType: 'إستئذان قصير' }))}
                      className={`p-4 border-2 rounded-xl cursor-pointer transition-all duration-200 ${
                        licenseConfig.licenseType === 'إستئذان قصير' ? 'border-blue-500 bg-blue-50 shadow-md' : 'border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      <div className="text-center">
                        <div className={`w-10 h-10 rounded-lg mx-auto mb-2 flex items-center justify-center ${
                          licenseConfig.licenseType === 'إستئذان قصير' ? 'bg-gradient-to-br from-blue-500 to-blue-500 shadow-lg' : 'bg-gray-200'
                        }`}>
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div className={`font-bold ${licenseConfig.licenseType === 'إستئذان قصير' ? 'text-blue-800' : 'text-gray-800'}`}>إستئذان قصير</div>
                        <div className={`text-xs mt-1 ${licenseConfig.licenseType === 'إستئذان قصير' ? 'text-blue-600' : 'text-gray-500'}`}>ساعات محددة</div>
                      </div>
                    </div>
                    <div
                      onClick={() => setLicenseConfig(prev => ({ ...prev, licenseType: 'إستئذان طبي' }))}
                      className={`p-4 border-2 rounded-xl cursor-pointer transition-all duration-200 ${
                        licenseConfig.licenseType === 'إستئذان طبي' ? 'border-green-500 bg-green-50 shadow-md ring-2 ring-green-100' : 'border-gray-200 hover:border-green-300'
                      }`}
                    >
                      <div className="text-center">
                        <div className={`w-10 h-10 rounded-lg mx-auto mb-2 flex items-center justify-center ${
                          licenseConfig.licenseType === 'إستئذان طبي' ? 'bg-gradient-to-br from-green-500 to-green-600 shadow-lg' : 'bg-gray-200'
                        }`}>
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <div className={`font-bold ${licenseConfig.licenseType === 'إستئذان طبي' ? 'text-green-800' : 'text-gray-800'}`}>إستئذان طبي</div>
                        <div className={`text-xs mt-1 ${licenseConfig.licenseType === 'إستئذان طبي' ? 'text-green-600' : 'text-gray-500'}`}>ساعات طبية محددة</div>
                      </div>
                    </div>
                  </div>
                </div>

                {(licenseConfig.licenseType === 'إستئذان قصير' || licenseConfig.licenseType === 'إستئذان طبي') && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className={`space-y-3 p-4 rounded-xl lg:col-span-2 ${
                      licenseConfig.licenseType === 'إستئذان طبي' ? 'bg-green-50 border border-green-100' : 'bg-blue-50 border border-blue-100'
                    }`}>
                      <label className="block text-sm font-semibold flex items-center">
                        {licenseConfig.licenseType === 'إستئذان طبي' ? 'عدد الساعات الطبية *' : 'عدد ساعات الإستئذان *'}
                      </label>
                      <div className="flex items-center space-x-4 rtl:space-x-reverse">
                        <span className={`text-sm font-bold w-10 text-center ${licenseConfig.licenseType === 'إستئذان طبي' ? 'text-green-600' : 'text-blue-600'}`}>0.5</span>
                        <div className="relative flex-1">
                          <input 
                            type="range" min="0.5" max="8" step="0.5" 
                            value={licenseConfig.hours || 0.5}
                            onChange={(e) => setLicenseConfig(prev => ({ ...prev, hours: parseFloat(e.target.value) }))}
                            className={`w-full h-2 rounded-full appearance-none cursor-pointer ${licenseConfig.licenseType === 'إستئذان طبي' ? 'bg-green-200' : 'bg-blue-200'}`}
                          />
                          <div className="absolute -top-6 left-0 right-0 flex justify-center">
                            <span className={`px-2 py-1 text-xs font-bold text-white rounded-md shadow-md transform translate-x-1/2 ${
                              licenseConfig.licenseType === 'إستئذان طبي' ? 'bg-green-600' : 'bg-blue-600'
                            }`} style={{ right: `${((licenseConfig.hours || 0.5) - 0.5) / 7.5 * 100}%` }}>
                              {licenseConfig.hours || 0.5} ساعة 
                            </span>
                          </div>
                        </div>
                        <span className={`text-sm font-bold w-10 text-center ${licenseConfig.licenseType === 'إستئذان طبي' ? 'text-green-600' : 'text-blue-600'}`}>8</span>
                      </div>
                      <div className="flex items-center space-x-2 rtl:space-x-reverse">
                        <div className="relative">
                          <input
                            type="number" min="0.5" max="8" step="0.5"
                            value={licenseConfig.hours || ''}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value);
                              if (!isNaN(value) && value >= 0.5 && value <= 8) {
                                setLicenseConfig(prev => ({ ...prev, hours: value }));
                              } else if (e.target.value === '') {
                                setLicenseConfig(prev => ({ ...prev, hours: undefined }));
                              }
                            }}
                            className={`w-32 px-5 font-bold py-3 border-2 rounded-lg focus:outline-none focus:ring-2 transition-all duration-200 text-right ${
                              licenseConfig.licenseType === 'إستئذان طبي' ? 'border-green-200 bg-white focus:border-green-500 focus:ring-green-200' : 'border-blue-200 bg-white focus:border-blue-500 focus:ring-blue-200'
                            }`}
                            placeholder="ساعات"
                          />
                          <span className={`absolute left-4 top-1/2 transform -translate-y-1/2 font-bold text-xs ${licenseConfig.licenseType === 'إستئذان طبي' ? 'text-green-500' : 'text-blue-500'}`}>ساعة</span>
                        </div>
                      </div>
                    </div>
                    <div className={`space-y-3 p-4 rounded-xl ${licenseConfig.licenseType === 'إستئذان طبي' ? 'bg-green-50 border border-green-100' : 'bg-blue-50 border border-blue-100'}`}>
                      <label className="block text-sm font-semibold">وقت الاستئذان (اختياري)</label>
                      <select
                        value={licenseConfig.permissionTime || ''}
                        onChange={(e) => setLicenseConfig(prev => ({ ...prev, permissionTime: e.target.value }))}
                        className={`w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 transition-all duration-200 text-right ${
                          licenseConfig.licenseType === 'إستئذان طبي' ? 'border-green-200 bg-white focus:border-green-500 focus:ring-green-200' : 'border-blue-200 bg-white focus:border-blue-500 focus:ring-blue-200'
                        }`}
                      >
                        <option value="">بدون تحديد</option>
                        <option value="بداية الدوام">بداية الدوام</option>
                        <option value="أثناء الدوام">أثناء الدوام</option>
                        <option value="نهاية الدوام">نهاية الدوام</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className={`space-y-3 p-4 rounded-xl ${licenseConfig.licenseType === 'إستئذان طبي' ? 'bg-green-50 border border-green-100' : 'bg-gray-50 border border-gray-100'}`}>
                  <label className="block text-sm font-semibold flex items-center">ملاحظات (اختياري)</label>
                  <textarea
                    value={licenseConfig.notes || ''}
                    onChange={(e) => setLicenseConfig(prev => ({ ...prev, notes: e.target.value }))}
                    className={`w-full px-4 py-3 rounded-xl focus:outline-none focus:ring-2 transition-all duration-200 min-h-[80px] ${
                      licenseConfig.licenseType === 'إستئذان طبي' ? 'border-2 border-green-200 focus:border-green-500 focus:ring-green-200 bg-white' : 'border-2 border-gray-200 focus:border-blue-500 focus:ring-blue-200'
                    }`}
                    placeholder="أدخل أي ملاحظات إضافية..."
                  />
                </div>

                {hasAnyDuplicateNotice && (
                  <div className={`border-2 rounded-xl p-6 shadow-lg ${
                    hasDuplicateWarning ? 'bg-yellow-50 border-yellow-300' : 'bg-red-50 border-red-300'
                  }`}>
                    <div className={`flex items-center gap-3 mb-4 ${hasDuplicateWarning ? 'text-yellow-800' : 'text-red-800'}`}>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${hasDuplicateWarning ? 'bg-yellow-600' : 'bg-red-600'}`}>
                        <AlertTriangle className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h4 className="font-bold text-lg">{duplicateValidation.title}</h4>
                        <p className="text-sm"><span className="font-bold">{licenseConfig.selectedEmployee?.rank} / {licenseConfig.selectedEmployee?.full_name}</span> - {duplicateValidation.description}</p>
                      </div>
                    </div>
                  </div>
                )}

                {monthlyLimitWarning && (
                  <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-6 shadow-lg">
                    <div className="flex items-center gap-3 text-yellow-800 mb-4">
                      <div className="w-10 h-10 bg-yellow-600 rounded-full flex items-center justify-center">
                        <AlertTriangle className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold">تحذير الحدود الشهرية</h3>
                        <p className="text-sm">يرجى مراجعة الحدود المسموحة للموظف</p>
                      </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-yellow-200">
                      <div className="space-y-2">
                        {monthlyLimitWarning.split('\n').map((warning, index) => (
                          <div key={index} className="flex items-center gap-2 text-yellow-800">
                            <div className="w-2 h-2 bg-yellow-600 rounded-full"></div>
                            <span className="text-sm font-medium">{warning}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case 'review':
        const isMedical = licenseConfig.licenseType === 'إستئذان طبي';
        const isShort = licenseConfig.licenseType === 'إستئذان قصير';
        const isFullDay = licenseConfig.licenseType === 'يوم كامل';
        
        return (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">مراجعة نهائية وحفظ الرخصة/الاستئذان</h2>
                    <p className="text-sm text-slate-500">تأكد من صحة البيانات قبل الحفظ</p>
                  </div>
                </div>
                <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                  !hasBlockingDuplicate && !hasCriticalLimitViolation 
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700' 
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}>
                  {!hasBlockingDuplicate && !hasCriticalLimitViolation ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                  {!hasBlockingDuplicate && !hasCriticalLimitViolation
                    ? hasDuplicateWarning
                      ? 'جاهز للحفظ مع تنبيه'
                      : 'جاهز للحفظ'
                    : 'يحتاج مراجعة'}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-6">
              {/* الموظف Section */}
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-blue-700">الموظف</h3>
                    <p className="text-lg font-bold text-blue-700">
                      {licenseConfig.selectedEmployee?.rank} / {licenseConfig.selectedEmployee?.full_name}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-sm text-blue-600">
                  {getEmployeeIdentifier(licenseConfig.selectedEmployee) && (
                    <span className="rounded-full border border-blue-200 bg-white px-3 py-1">
                      {getEmployeeIdentifier(licenseConfig.selectedEmployee)?.label}: {getEmployeeIdentifier(licenseConfig.selectedEmployee)?.value}
                    </span>
                  )}
                  <span className="rounded-full border border-blue-200 bg-white px-3 py-1">
                    {licenseConfig.selectedEmployee?.jobTitle || licenseConfig.selectedEmployee?.rank || '-'}
                  </span>
                  {licenseConfig.selectedEmployee?.category === 'فني' && licenseConfig.selectedEmployee?.jobTitle ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700 font-semibold">
                      المسمى الوظيفي: {licenseConfig.selectedEmployee?.jobTitle}
                    </span>
                  ) : licenseConfig.selectedEmployee?.jobTitle ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                      المسمى الوظيفي: {licenseConfig.selectedEmployee?.jobTitle}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Details Grid */}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2 text-emerald-700 text-sm font-semibold">
                    <Calendar className="h-4 w-4" />
                    تاريخ الرخصة
                  </div>
                  <p className="mt-2 text-base font-bold text-emerald-700">
                    {licenseConfig.licenseDate ? format(licenseConfig.licenseDate, 'EEEE، dd MMMM yyyy', { locale: arSA }) : '-'}
                  </p>
                </div>
                <div className={`rounded-xl border p-4 ${
                  isFullDay ? 'border-blue-200 bg-blue-50' : 
                  isMedical ? 'border-green-200 bg-green-50' : 
                  'border-purple-200 bg-purple-50'
                }`}>
                  <div className={`flex items-center gap-2 text-sm font-semibold ${
                    isFullDay ? 'text-blue-700' : 
                    isMedical ? 'text-green-700' : 
                    'text-purple-700'
                  }`}>
                    <FileText className="h-4 w-4" />
                    نوع الرخصة
                  </div>
                  <p className={`mt-2 text-base font-bold ${
                    isFullDay ? 'text-blue-700' : 
                    isMedical ? 'text-green-700' : 
                    'text-purple-700'
                  }`}>
                    {isFullDay ? 'رخصة يوم كامل' : isMedical ? 'إستئذان طبي' : 'إستئذان قصير'}
                  </p>
                </div>
                {(isShort || isMedical) && (
                  <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                    <div className="flex items-center gap-2 text-amber-700 text-sm font-semibold">
                      <Calendar className="h-4 w-4" />
                      {isMedical ? 'عدد الساعات الطبية' : 'عدد ساعات الاستئذان'}
                    </div>
                    <p className="mt-2 text-base font-bold text-amber-700">{licenseConfig.hours || 0} ساعة</p>
                  </div>
                )}
                {licenseConfig.permissionTime && (
                  <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-4">
                    <div className="flex items-center gap-2 text-cyan-700 text-sm font-semibold">
                      <Calendar className="h-4 w-4" />
                      وقت الاستئذان
                    </div>
                    <p className="mt-2 text-base font-bold text-cyan-700">{licenseConfig.permissionTime}</p>
                  </div>
                )}
              </div>

              {/* الملاحظات Section */}
              {licenseConfig.notes && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center gap-2 text-gray-700 text-sm font-semibold">
                    <FileText className="h-4 w-4" />
                    ملاحظات
                  </div>
                  <p className="mt-2 text-base text-gray-700">{licenseConfig.notes}</p>
                </div>
              )}

              {/* Monthly Stats */}
              {calculateEmployeeMonthlyStats && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">إحصائيات الشهر الحالي</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="text-center p-3 bg-white rounded-lg border border-slate-200">
                      <div className="font-bold text-xl text-gray-800">{calculateEmployeeMonthlyStats.fullDayLicenses}</div>
                      <div className="text-xs text-gray-600">رخصة يوم كامل</div>
                    </div>
                    <div className="text-center p-3 bg-white rounded-lg border border-slate-200">
                      <div className="font-bold text-xl text-gray-800">{calculateEmployeeMonthlyStats.shortLicenses}</div>
                      <div className="text-xs text-gray-600">استئذانات قصيرة</div>
                    </div>
                    <div className="text-center p-3 bg-white rounded-lg border border-slate-200">
                      <div className="font-bold text-xl text-gray-800">{calculateEmployeeMonthlyStats.totalHours.toFixed(1)}</div>
                      <div className="text-xs text-gray-600">إجمالي الساعات</div>
                    </div>
                    <div className="text-center p-3 bg-green-50 rounded-lg border border-green-200">
                      <div className="font-bold text-xl text-green-800">{calculateEmployeeMonthlyStats.medicalLicenses}</div>
                      <div className="text-xs text-green-600">إستئذان طبي</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Warnings */}
              {hasAnyDuplicateNotice && (
                <div className={`rounded-xl border p-4 ${hasDuplicateWarning ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`}>
                  <div className={`flex items-center gap-2 ${hasDuplicateWarning ? 'text-amber-700' : 'text-red-700'}`}>
                    <AlertTriangle className="h-5 w-5" />
                    <span className="font-semibold">{duplicateValidation.title}</span>
                  </div>
                  <p className={`mt-2 text-sm ${hasDuplicateWarning ? 'text-amber-700' : 'text-red-700'}`}>{duplicateValidation.description}</p>
                </div>
              )}

              {monthlyLimitWarning && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-amber-700">
                    <AlertTriangle className="h-5 w-5" />
                    <span className="font-semibold">تحذير الحدود الشهرية</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {monthlyLimitWarning.split('\n').map((warning, index) => (
                      <p key={index} className="text-sm text-amber-700">• {warning}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Header Card */}
        <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-xl shadow-slate-200/60 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-lg shadow-blue-200">
                <Plus className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-black text-slate-900">تسجيل رخصة/استئذان جديد</h1>
                <p className="text-slate-600 mt-1">اختر الموظف وحدد تفاصيل الرخصة، ثم المراجعة والحفظ</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm">
                الخطوة {getCurrentStepIndex() + 1} من {steps.length}
              </div>
              {currentStep !== 'selection' && licenseConfig.licenseDate && (
                <div className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-gray-500 shadow-sm">
                  التاريخ: <span className="font-black inline text-blue-700">{format(licenseConfig.licenseDate, 'EEEE، dd MMMM yyyy', { locale: arSA })}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Step Indicators */}
        <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-lg shadow-slate-200/50 p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {steps.map((step, index) => {
              const isActive = step.id === currentStep;
              const isCompleted = getCurrentStepIndex() > index;
              const Icon = step.icon;
              
              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-4 rounded-2xl border-2 px-5 py-4 transition-all duration-300 ${
                    isActive 
                      ? 'border-blue-400 shadow-lg shadow-blue-100' 
                      : isCompleted 
                        ? 'border-emerald-300 shadow-lg shadow-emerald-100' 
                        : 'border-slate-200 bg-slate-50/50'
                  }`}
                >
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl border-2 shadow-sm transition-all duration-300 ${
                    isActive 
                      ? 'border-blue-400 bg-blue-100 text-blue-600' 
                      : isCompleted 
                        ? 'border-emerald-400 bg-emerald-100 text-emerald-600' 
                        : 'border-slate-300 bg-white text-slate-400'
                  }`}>
                    {isCompleted ? (
                      <CheckCircle className="h-6 w-6" />
                    ) : (
                      <Icon className="h-6 w-6" />
                    )}
                  </div>
                  <div className="flex-1 text-right">
                    <div className={`text-xs font-bold uppercase tracking-wide ${
                      isActive ? 'text-blue-600' : isCompleted ? 'text-emerald-600' : 'text-slate-400'
                    }`}>خطوة {index + 1}</div>
                    <div className={`text-md font-bold ${
                      isActive ? 'text-slate-900' : isCompleted ? 'text-slate-900' : 'text-slate-400'
                    }`}>{step.title}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-6 h-3 rounded-full bg-slate-100 overflow-hidden shadow-inner">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 via-blue-600 to-blue-500 transition-all duration-500 shadow-md" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        {message && (
          <div className={`p-4 rounded-xl border ${
            message.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
            message.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
            'bg-yellow-50 border-yellow-200 text-yellow-800'
          }`}>
            <div className="flex items-center gap-2">
              {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : message.type === 'error' ? <X className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
              <span className="font-bold">{message.text}</span>
            </div>
          </div>
        )}

        <div className="bg-white/90 rounded-3xl shadow-lg shadow-slate-200/50 p-6 border border-slate-200">
          {renderStepContent()}
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <button
            onClick={prevStep}
            disabled={getCurrentStepIndex() === 0}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-all ${
              getCurrentStepIndex() === 0 ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-slate-700 text-white hover:bg-slate-800 shadow-lg'
            }`}
          >
            <ArrowRight className="h-4 w-4" />السابق
          </button>

          {currentStep === 'review' ? (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || hasBlockingDuplicate}
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-8 py-3 text-sm font-semibold transition-all ${
                isSubmitting || hasBlockingDuplicate ? 'bg-slate-300 text-white cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg'
              }`}
            >
              <Save className="h-4 w-4" />
              {isSubmitting ? 'جاري الحفظ...' : 'تأكيد وحفظ الرخصة'}
            </button>
          ) : (
            <button
              onClick={nextStep}
              disabled={!canProceedToNextStep()}
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-8 py-3 text-sm font-semibold transition-all ${
                !canProceedToNextStep() ? 'bg-slate-300 text-white cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg'
              }`}
            >
              التالي<ArrowLeft className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddLicense;
