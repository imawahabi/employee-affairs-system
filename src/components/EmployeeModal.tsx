import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-hot-toast';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';
import { Employee, Department, Rank, Nationality, JobTitleEntity, Section } from '../types';
import { createEmployee, updateEmployee, fetchNationalities, fetchJobTitles, fetchSections } from '../api';
import { getRankOrder } from '../utils/rankOrder';
import { formatEmployeeDisplayName } from '../utils/employeeDisplay';
import { birthDateFromCivilId } from '../utils/civilId';
import {
  normalizeOrganizationName,
  buildDepartmentNameMap,
  buildSectionNameMap,
  formatDepartmentLabel,
  formatSectionLabel
} from '../utils/organization';
import { useSystem } from '../contexts/SystemContext';
import type { License } from '../licenses/types';
import { LicenseService } from '../licenses/services/licenseService';

interface Props {
  mode: 'create' | 'view' | 'edit';
  isOpen: boolean;
  onClose: () => void;
  employee?: Employee | null;
  departments: Department[];
  ranks: Rank[];
  onSave?: (employee?: Employee) => void;
  // When true, show the "عرض في إدارة الموظفين" button (used by Header search modal). Defaults to false.
  showNavigateToManagement?: boolean;
}

// Initial form state
const createInitialForm = (): Partial<Employee> => ({
  fileNumber: '',
  name: '',
  firstName: '',
  secondName: '',
  thirdName: '',
  fourthName: '',
  familyName: '',
  category: undefined,
  rank: '',
  jobTitle: '',
  jobGrade: '',
  professionalGroup: '',
  department: '',
  status: 'active',
  reasonIfInactive: '',
  phone_number: '',
  referenceNumber: '',
  civilId: '',
  birthDate: '',
  nationality: '',
  nationalityArticleNumber: '',
  nationalityIssueDate: '',
  maritalStatus: '',
  maritalStatusNote: '',
  appointmentDecisionNumber: '',
  appointmentDecisionDate: '',
  gender: '',
  hasEducationCertificate: false,
  educationCertificateType: 'بدون شهادة',
  educationSpecialization: '',
  militaryNumber: '',
  hiringDate: '',
  seniorityNumber: '',
  section: '',
  hasWeapon: false,
  weaponAttachments: '',
  hasParking: false,
  parkingLocation: '',
  parkingNumber: '',
  includeInShifts: true,
  shiftNotes: '',
  excludeFromStatistics: false,
  isSecondedOutsideGeneralAdministration: false,
  secondmentLocation: '',
});

const splitLegacyEmployeeName = (value?: string | null) => {
  const tokens = (value || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return ['', '', '', '', ''];
  return [
    tokens[0] || '',
    tokens[1] || '',
    tokens.length > 3 ? tokens[2] : '',
    tokens.length > 4 ? tokens.slice(3, -1).join(' ') : '',
    tokens.length > 1 ? tokens[tokens.length - 1] : '',
  ];
};

const buildFullNameFromParts = (source: Partial<Employee>) =>
  [
    source.firstName,
    source.secondName,
    source.thirdName,
    source.fourthName,
    source.familyName,
  ]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(' ');

// Validation warnings (non-blocking)
const getValidationWarnings = (form: Partial<Employee>): string[] => {
  const warnings: string[] = [];
  if (!form.firstName?.trim() && !form.name?.trim()) warnings.push('لم يتم إدخال الاسم الأول');
  if (!form.category) warnings.push('لم يتم اختيار الفئة');
  if (form.category !== 'مدنيين' && !form.rank?.trim()) warnings.push('لم يتم اختيار الرتبة');
  if (!form.department) warnings.push('لم يتم اختيار الإدارة');
  if (!form.civilId?.trim()) warnings.push('لم يتم إدخال الرقم المدني');
  if (form.civilId?.trim() && !/^\d{12}$/.test(form.civilId.trim())) {
    warnings.push('الرقم المدني يجب أن يكون 12 رقم');
  }
  if (form.referenceNumber?.trim() && !/^\d{9}$/.test(form.referenceNumber.trim())) {
    warnings.push('رقم المرجع يجب أن يكون 9 أرقام');
  }
  if ((form.maritalStatus === 'أخرى' || form.maritalStatus === 'اخرى') && !form.maritalStatusNote?.trim()) {
    warnings.push('ملاحظة الحالة الاجتماعية مطلوبة عند اختيار أخرى');
  }
  if (form.hasEducationCertificate && (!form.educationCertificateType || form.educationCertificateType === 'بدون شهادة')) {
    warnings.push('نوع الشهادة الدراسية غير محدد');
  }
  if (form.status === 'inactive' && !form.reasonIfInactive?.trim()) {
    warnings.push('لم يتم إدخال سبب خارج الخدمة');
  }
  return warnings;
};

// Professional Icon Components
const Icons = {
  user: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  id: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
    </svg>
  ),
  shield: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  settings: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  close: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  edit: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4H7a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-4" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  list: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  /* New icons to reduce repetition and better match field meaning */
  eye: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5s8.268 2.943 9.542 7C20.268 16.057 16.477 19 12 19S3.732 16.057 2.458 12z" />
    </svg>
  ),
  briefcase: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V6a4 4 0 014-4h0a4 4 0 014 4v1" />
      <rect x="3" y="7" width="18" height="13" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  ),
  building: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21V8a1 1 0 011-1h16a1 1 0 011 1v13" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 21V12h6v9" />
    </svg>
  ),
  globe: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2 12h20M12 2c3.2 3 3.2 17 0 20" />
    </svg>
  ),
  award: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8a4 4 0 100 8 4 4 0 000-8z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21l5-3 5 3-1-6 4-4-6-1L12 3 9 10 3 11l4 4-1 6z" />
    </svg>
  ),
  hash: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 9h18M3 15h18" />
    </svg>
  ),
  check: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  warning: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
    </svg>
  ),
  calendar: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  phone: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  ),
  car: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
    </svg>
  ),
  clipboard: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  ),
  calendarCheck: (props: any) => (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),

};

const digitFormatter = new Intl.NumberFormat('ar-UK', { useGrouping: false });
const formatDigits = (value: string) => value.replace(/[0-9]/g, (digit) => digitFormatter.format(Number(digit)));
const isGovernmentiNationality = (value?: string | null) => {
  if (!value) return false;
  const normalized = value.replace(/\s+/g, '').toLowerCase();
  return normalized.includes('كويت') || normalized.includes('kuwait');
};
const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
const formatPrintValue = (value: any, type: ViewFieldProps['type'] = 'text') => {
  if (value === undefined || value === null || value === '' || value === '-') return 'غير مسجل';
  let output = '';
  switch (type) {
    case 'status':
      output = typeof value === 'string' && value === 'active' ? 'في الخدمة' : 'خارج الخدمة';
      break;
    case 'boolean':
      output = value ? 'نعم' : 'لا';
      break;
    case 'date': {
      const parsed = new Date(value as string);
      output = Number.isNaN(parsed.getTime()) ? 'غير مسجل' : parsed.toLocaleDateString('ar-UK');
      break;
    }
    default:
      output = typeof value === 'number' ? digitFormatter.format(value) : String(value);
  }
  return formatDigits(output);
};

const getDateDiff = (startValue?: string | null, endValue = new Date()) => {
  if (!startValue) return null;
  const start = new Date(startValue);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(endValue);
  if (start > end) return { years: 0, months: 0, days: 0 };

  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  let days = end.getDate() - start.getDate();

  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(end.getFullYear(), end.getMonth(), 0);
    days += prevMonth.getDate();
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  return { years, months, days };
};

const formatDuration = (startValue?: string | null) => {
  const diff = getDateDiff(startValue);
  if (!diff) return '-';
  return `${diff.years} سنة ${diff.months} شهر ${diff.days} يوم`;
};

// Enhanced Form Field Component
interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}

const FormField: React.FC<FormFieldProps> = ({
  label,
  required = false,
  error,
  children,
  className = '',
  icon
}) => (
  <div className={`space-y-1.5 ${className}`}>
    <div className="flex items-center gap-2">
      {icon && (
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          {icon}
        </div>
      )}
      <label className="text-xs font-black text-slate-700">
        {label}
        {required && <span className="text-red-500 mr-1">*</span>}
      </label>
    </div>
    {children}
    {error && (
      <div className="flex items-center space-x-2 space-x-reverse text-red-600 text-sm mt-1">
        <Icons.warning className="w-4 h-4" />
        <span>{error}</span>
      </div>
    )}
  </div>
);

// Professional Section Card Component
interface SectionCardProps {
  title: string;
  description?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  gradient?: string;
  isInactive?: boolean;
}

const SectionCard: React.FC<SectionCardProps> = ({
  title,
  description,
  icon,
  children,
  className = '',
  isInactive = false
}) => (
  <div className={`${isInactive ? 'bg-red-50/55 border-red-100' : 'bg-white border-slate-200'} overflow-hidden rounded-xl border shadow-sm ${className}`}>
    <div className={`px-5 py-4 border-b ${isInactive ? 'border-red-100 bg-red-50' : 'border-slate-100 bg-slate-50/80'}`}>
      <div className="flex items-center gap-3">
        <div className={`${isInactive ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700'} flex h-10 w-10 items-center justify-center rounded-xl`}>
          {icon}
        </div>
        <div>
          <h3 className={`text-base font-black ${isInactive ? 'text-red-950' : 'text-slate-950'}`}>{title}</h3>
          {description && <p className={`text-xs font-semibold mt-0.5 ${isInactive ? 'text-red-700' : 'text-slate-500'}`}>{description}</p>}
        </div>
      </div>
    </div>
    <div className="p-5">
      {children}
    </div>
  </div>
);

// Professional Switch Component
interface SwitchFieldProps {
  name: string;
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  description?: string;
  compact?: boolean;
}

const SwitchField: React.FC<SwitchFieldProps> = ({
  name,
  checked,
  onChange,
  label,
  icon,
  disabled = false,
  description,
  compact = false
}) => {
  const handleToggle = () => {
    if (disabled) return;

    const event = {
      target: {
        name,
        checked: !checked
      }
    } as React.ChangeEvent<HTMLInputElement>;
    onChange(event);
  };

  return (
    <div className={`flex items-center justify-between ${compact ? 'p-3' : 'p-3.5'} rounded-xl border transition ${checked
      ? 'border-blue-200 bg-blue-50'
      : 'border-slate-200 bg-white hover:bg-slate-50'
      } ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          {icon && (
            <span className={`inline-flex items-center justify-center ${checked ? 'text-blue-600' : 'text-gray-500'
              }`}>
              {icon}
            </span>
          )}
          <label className={`${compact ? 'text-xs sm:text-sm' : 'text-sm'} font-black text-slate-800 cursor-pointer block`}>
            {label}
          </label>
        </div>
        {description && (
          <p className={`${compact ? 'text-[11px]' : 'text-xs'} font-semibold text-slate-500 mt-1`}>{description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-4 focus:ring-blue-100 ${checked ? 'bg-blue-600' : 'bg-slate-300 hover:bg-slate-400'
          } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? '-translate-x-1' : '-translate-x-6'
            }`}
        />
      </button>
    </div>
  );
};

// Professional View Field Component
interface ViewFieldProps {
  label: string;
  value: string | number | boolean | undefined;
  type?: 'text' | 'status' | 'boolean' | 'date';
  hide?: boolean;
  icon?: React.ReactNode;
}

// License Section Component
interface LicenseSectionProps {
  employeeId: string;
  isVisible: boolean;
}

const LicenseSection: React.FC<LicenseSectionProps> = ({ employeeId, isVisible }) => {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isVisible || !employeeId) return;

    const fetchLicenses = async () => {
      setLoading(true);
      setError(null);
      try {
        const employeeLicenses = await LicenseService.getByEmployee(employeeId);
        // ترتيب حسب تاريخ إنشاء السجل (الأحدث أولاً)
        const sortedLicenses = employeeLicenses.sort((a, b) =>
          new Date(b.created_at || b.license_date).getTime() -
          new Date(a.created_at || a.license_date).getTime()
        );
        setLicenses(sortedLicenses);
      } catch (err) {
        console.error('Failed to fetch licenses:', err);
        setError('فشل في تحميل بيانات الرخص');
      } finally {
        setLoading(false);
      }
    };

    fetchLicenses();
  }, [employeeId, isVisible]);

  if (!isVisible) return null;

  // حساب الإحصائيات
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;
  const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear;

  const getLicensesByPeriod = (year: number, month: number) => {
    return licenses.filter(license => license.year === year && license.month === month);
  };

  const currentMonthLicenses = getLicensesByPeriod(currentYear, currentMonth);
  const previousMonthLicenses = getLicensesByPeriod(previousYear, previousMonth);

  // إحصائيات مفصلة
  const getStats = (licenseList: License[]) => {
    const fullDay = licenseList.filter(l => l.license_type === 'يوم كامل').length;
    const short = licenseList.filter(l => l.license_type === 'إستئذان قصير').length;
    const medical = licenseList.filter(l => l.license_type === 'إستئذان طبي').length;
    const totalHours = licenseList.reduce((sum, l) => sum + (l.hours || 8), 0);
    return { fullDay, short, medical, totalHours, total: licenseList.length };
  };

  const currentStats = getStats(currentMonthLicenses);
  const previousStats = getStats(previousMonthLicenses);
  const totalStats = getStats(licenses);

  if (loading) {
    return (
      <ViewSection
        title="الرخص والاستئذانات"
        icon={<Icons.clipboard className="w-5 h-5" />}
      >
        <div className="col-span-2 flex justify-center items-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="mr-3 text-gray-600">جاري التحميل...</span>
        </div>
      </ViewSection>
    );
  }

  if (error) {
    return (
      <ViewSection
        title="الرخص والاستئذانات"
        icon={<Icons.clipboard className="w-5 h-5" />}
      >
        <div className="col-span-2 text-center py-8">
          <div className="text-red-600">{error}</div>
        </div>
      </ViewSection>
    );
  }

  if (licenses.length === 0) {
    return (
      <ViewSection
        title="الرخص والاستئذانات"
        icon={<Icons.clipboard className="w-5 h-5" />}
      >
        <div className="col-span-2 flex flex-col items-center justify-center gap-2 py-3 text-gray-500">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-400">
            <Icons.clipboard className="w-5 h-5" />
          </span>
          <span className="text-sm font-semibold">لا توجد رخص أو استئذانات مسجلة حتى تاريخه</span>
        </div>
      </ViewSection>
    );
  }

  return (
    <ViewSection
      title="الرخص والاستئذانات"
      icon={<Icons.clipboard className="w-5 h-5" />}
    >
      {/* الإحصائيات الأساسية */}
      <ViewField
        label="إجمالي الرخص (الشهر الحالي)"
        value={currentStats.total}
        icon={<Icons.clipboard className="w-4 h-4" />}
      />
      <ViewField
        label="إجمالي الرخص (الشهر السابق)"
        value={previousStats.total}
        icon={<Icons.calendar className="w-4 h-4" />}
      />
      <ViewField
        label="إجمالي الرخص (الكل)"
        value={totalStats.total}
        icon={<Icons.list className="w-4 h-4" />}
      />

      {/* تفاصيل الأنواع */}
      <ViewField
        label="رخص يوم كامل (الكل)"
        value={totalStats.fullDay}
        icon={<Icons.calendarCheck className="w-4 h-4" />}
      />
      <ViewField
        label="استئذانات قصيرة (الكل)"
        value={totalStats.short}
        icon={<Icons.settings className="w-4 h-4" />}
      />
      <ViewField
        label="استئذانات طبية (الكل)"
        value={totalStats.medical}
        icon={<Icons.shield className="w-4 h-4" />}
      />

      {/* الساعات */}
      <ViewField
        label="إجمالي الساعات المفقودة (الكل)"
        value={`${totalStats.totalHours} ساعة`}
        icon={<Icons.settings className="w-4 h-4" />}
      />
      <ViewField
        label="الساعات المفقودة (الشهر الحالي)"
        value={`${currentStats.totalHours} ساعة`}
        icon={<Icons.settings className="w-4 h-4" />}
      />

      {/* أحدث رخصة */}
      {licenses.length > 0 && (
        <ViewField
          label="أحدث رخصة/استئذان"
          value={`${licenses[0].license_type} - ${new Date(licenses[0].license_date).toLocaleDateString('ar-UK')}`}
          icon={<Icons.calendarCheck className="w-4 h-4" />}
        />
      )}
    </ViewSection>
  );
};

const ViewField: React.FC<ViewFieldProps> = ({
  label,
  value,
  type = 'text',
  hide = false,
  icon
}) => {
  if (hide) return null;

  const emptyLabel = 'غير مسجل';
  const labelIcon = icon ?? null;

  const formatValue = () => {
    if (value === undefined || value === null || value === '' || value === '-') return emptyLabel;
    let output = '';

    switch (type) {
      case 'status':
        output = typeof value === 'string' && value === 'active' ? 'في الخدمة' : 'خارج الخدمة';
        break;
      case 'boolean':
        output = value ? 'نعم' : 'لا';
        break;
      case 'date': {
        const parsed = new Date(value as string);
        output = Number.isNaN(parsed.getTime()) ? emptyLabel : parsed.toLocaleDateString('ar-UK');
        break;
      }
      default:
        output = typeof value === 'number' ? digitFormatter.format(value) : String(value);
    }

    return output === '-' ? emptyLabel : formatDigits(output);
  };

  const formattedValue = formatValue();
  const isEmpty = formattedValue === emptyLabel;
  const textValueClass = isEmpty ? 'text-slate-300 font-normal' : 'text-slate-900';

  const renderValue = () => {
    if (type === 'status') {
      const isActive = typeof value === 'string' && value === 'active';
      return (
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${isActive ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-red-50 text-red-700 ring-1 ring-red-100'
          }`}>
          {formattedValue}
        </span>
      );
    }
    if (type === 'boolean') {
      return (
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${value ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'
          }`}>
          {formattedValue}
        </span>
      );
    }
    return <span className={`min-w-0 text-sm font-black leading-6 ${textValueClass}`}>{formattedValue}</span>;
  };

  return (
    <div className="min-w-0 border-b border-slate-100 py-2.5 last:border-b-0">
      <div className="mb-1 flex min-w-0 items-center gap-2 text-xs font-black text-slate-500">
        {labelIcon && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">{labelIcon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className="min-w-0 break-words pr-8">{renderValue()}</div>
    </div>
  );
};

interface ViewSectionProps {
  title: string;
  icon?: React.ReactNode;
  isInactive?: boolean;
  children: React.ReactNode;
}

const ViewSection: React.FC<ViewSectionProps> = ({ title, icon, isInactive = false, children }) => (
  <section className={`overflow-hidden rounded-xl border ${isInactive ? 'border-red-200 bg-red-50/35' : 'border-slate-200 bg-white'}`}>
    <div className={`border-b px-4 py-2.5 ${isInactive ? 'border-red-100 bg-red-50' : 'border-slate-100 bg-slate-50/70'}`}>
      <div className="flex items-center gap-3">
        {icon && <div className={`${isInactive ? 'text-red-700' : 'text-slate-600'} flex h-7 w-7 items-center justify-center`}>{icon}</div>}
        <h3 className={`text-sm font-black ${isInactive ? 'text-red-950' : 'text-slate-950'}`}>{title}</h3>
      </div>
    </div>
    <div className="grid grid-cols-1 gap-x-6 px-4 py-2 md:grid-cols-2 xl:grid-cols-3">
      {children}
    </div>
  </section>
);

// Professional Modal Header
interface ModalHeaderProps {
  mode: 'create' | 'view' | 'edit';
  onClose: () => void;
  isInactive?: boolean;
}

const ModalHeader: React.FC<ModalHeaderProps> = ({ mode, onClose, isInactive = false }) => {
  const getTitle = () => {
    switch (mode) {
      case 'create': return 'إضافة موظف جديد';
      case 'view': return 'عرض بيانات الموظف';
      case 'edit': return 'تعديل بيانات الموظف';
    }
  };

  const getDescription = () => {
    switch (mode) {
      case 'create': return 'أدخل بيانات الموظف الجديد بإدخال جميع التفاصيل المطلوبة';
      case 'view': return 'عرض تفاصيل الموظف بالكامل وجميع المعلومات المسجلة';
      case 'edit': return 'قم بتحديث وتعديل بيانات الموظف الحالية';
    }
  };

  const getIcon = () => {
    switch (mode) {
      case 'create': return <Icons.user className="w-8 h-8 text-white" />;
      case 'view': return <Icons.eye className="w-8 h-8 text-white" />;
      case 'edit': return <Icons.settings className="w-8 h-8 text-white" />;
    }
  };

  const accentClass = isInactive && mode !== 'create'
    ? 'bg-red-600 text-white'
    : 'bg-blue-600 text-white';
  const badgeClass = isInactive && mode !== 'create'
    ? 'bg-red-50 text-red-700 border-red-100'
    : 'bg-blue-50 text-blue-700 border-blue-100';

  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl shadow-sm ${accentClass}`}>
              {getIcon()}
            </div>
            <div className="min-w-0">
              <div className={`mb-1 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black ${badgeClass}`}>
                {mode === 'create' ? 'سجل جديد' : mode === 'edit' ? 'تعديل' : 'عرض'}
              </div>
              <h2 className="text-xl font-black text-slate-950">{getTitle()}</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">{getDescription()}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            title="إغلاق"
          >
            <Icons.close className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

// Professional Modal Footer
interface ModalFooterProps {
  mode: 'create' | 'view' | 'edit';
  loading: boolean;
  onClose: () => void;
  onSubmit: () => void;
  error?: string | null;
  warnings?: string[];
  confirming?: boolean;
}

const ModalFooter: React.FC<ModalFooterProps> = ({
  mode,
  loading,
  onClose,
  onSubmit,
  error,
  warnings,
  confirming
}) => {
  if (mode === 'view') return null;
  const primaryLabel = mode === 'create' ? 'إضافة' : 'حفظ';
  const actionLabel = confirming ? 'تأكيد الحفظ' : primaryLabel;

  return (
    <div className="border-t border-slate-200 bg-white px-6 py-4">
      {warnings && warnings.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start gap-2 text-amber-900">
            <Icons.warning className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              {warnings.map((warning, index) => (
                <p className="text-sm font-bold" key={`${warning}-${index}`}>تنبيه قبل الحفظ: {warning}</p>
              ))}
            </span>
          </div>
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3">
          <div className="flex items-center gap-2 text-red-800">
            <Icons.warning className="h-5 w-5" />
            <span className="text-sm font-bold">{error}</span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50"
        >
          إلغاء
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading}
          className="rounded-xl bg-blue-600 px-7 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <div className="flex items-center space-x-2 space-x-reverse">
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>جاري الحفظ...</span>
            </div>
          ) : (
            <div className="flex items-center space-x-2 space-x-reverse">
              <Icons.check className="w-5 h-5" />
              <span>{actionLabel}</span>
            </div>
          )}
        </button>
      </div>
    </div>
  );
};

// Main Component
const EmployeeModal: React.FC<Props> = ({
  mode,
  isOpen,
  onClose,
  employee,
  departments,
  ranks,
  onSave,
  showNavigateToManagement = false
}) => {
  const { hideShifts, hideLicenses } = useSystem();
  const [form, setForm] = useState<Partial<Employee>>(createInitialForm());
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nationalities, setNationalities] = useState<Nationality[]>([]);
  const [jobTitles, setJobTitles] = useState<JobTitleEntity[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [localMode, setLocalMode] = useState<Props['mode']>(mode);
  const [printHideShifts, setPrintHideShifts] = useState(false);
  const [printHideLicenses, setPrintHideLicenses] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [professionalGroupTouched, setProfessionalGroupTouched] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const readOnly = localMode === 'view';
  const isEdit = localMode === 'edit';
  const isCreate = localMode === 'create';
  const isCreateCivilian = isCreate && form.category === 'مدنيين';
  const isInactiveView = localMode === 'view' && employee?.status === 'inactive';
  const isInactiveContext = localMode !== 'create' && (form.status === 'inactive' || employee?.status === 'inactive');
  const canHaveWeapon = form.category === 'ضباط' || form.category === 'ضباط صف';
  const showFileNumberField = form.category !== 'مدنيين';
  const showMilitaryNumberField = form.category === 'ضباط صف' || form.category === 'مهنيين';
  const includeInShiftsActive = form.category === 'مدنيين' ? false : form.includeInShifts !== false;
  const isSecondedOutside = form.isSecondedOutsideGeneralAdministration === true;
  const displayName = employee
    ? (formatEmployeeDisplayName(employee) || employee.name || 'الموظف')
    : 'الموظف';
  const jobTitleLabel = React.useMemo(() => {
    if (form.category === 'ضباط') return 'المنصب';
    if (form.category === 'مدنيين') return 'المسمى الوظيفي / المنصب';
    return 'المسمى الوظيفي';
  }, [form.category]);
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
  const normalizeJobTitle = (value: string) =>
    normalizeProfessionalText(value).replace(/[^\u0600-\u06FF0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const inferProfessionalGroupFromJobTitle = (value: string) => {
    const title = normalizeJobTitle(value || '');
    if (!title) return 'أخرى';
    const has = (token: string) => title.includes(normalizeJobTitle(token));
    if (['سائق', 'مندوب', 'مراسل'].some(has)) return 'سائق';
    if (['فراش', 'عامل'].some(has)) return 'فراش';
    if ([
      'طباع',
      'مدخل بيانات',
      'مدخل البيانات',
      'مسجل بيانات',
      'مسجل البيانات',
      'باحث',
      'اداري',
      'اجتماعي',
      'مصحح لغوي',
      'صائغ برامج'
    ].some(has)) {
      return 'طباع';
    }
    return 'أخرى';
  };
  const professionalGroupOptions = React.useMemo(
    () => [
      { value: 'طباع', label: 'طباع' },
      { value: 'سائق', label: 'سائق' },
      { value: 'فراش', label: 'فراش' },
      { value: 'أخرى', label: 'أخرى' }
    ],
    []
  );
  const categoryOptions = React.useMemo(
    () => [
      { value: 'ضباط', label: 'ضباط' },
      { value: 'ضباط صف', label: 'ضباط صف' },
      { value: 'مهنيين', label: 'مهنيين' },
      { value: 'مدنيين', label: 'مدنيين' }
    ],
    []
  );
  const departmentOptions = React.useMemo(
    () => departments.map((dep) => ({ value: dep.name, label: dep.name })),
    [departments]
  );
  const departmentNameMap = React.useMemo(
    () => buildDepartmentNameMap(departments),
    [departments]
  );
  const selectedDepartmentId = React.useMemo(
    () => departments.find((d) => normalizeOrganizationName(d.name) === normalizeOrganizationName(form.department))?.id,
    [departments, form.department]
  );
  const selectedDepartmentOption = React.useMemo(
    () => departmentOptions.find((opt) => normalizeOrganizationName(opt.value) === normalizeOrganizationName(form.department)),
    [departmentOptions, form.department]
  );
  const availableSections = React.useMemo(
    () => sections.filter((s) => s.departmentId === selectedDepartmentId),
    [sections, selectedDepartmentId]
  );
  const sectionOptions = React.useMemo(
    () => availableSections.map((section) => ({ value: section.name, label: section.name })),
    [availableSections]
  );
  const sectionNameMap = React.useMemo(
    () => buildSectionNameMap(sections, departments),
    [sections, departments]
  );
  const selectedSectionOption = React.useMemo(
    () => sectionOptions.find((opt) => normalizeOrganizationName(opt.value) === normalizeOrganizationName(form.section)),
    [sectionOptions, form.section]
  );
  const availableJobTitles = React.useMemo(
    () => jobTitles.filter((jt) => jt.category === form.category),
    [jobTitles, form.category]
  );
  const rankOptions = React.useMemo(
    () => ranks
      .filter((r) => r.category === form.category)
      .slice()
      .sort((a, b) => {
        const orderDiff = getRankOrder(a.name, a.category) - getRankOrder(b.name, b.category);
        if (orderDiff !== 0) return orderDiff;
        return a.name.localeCompare(b.name, 'ar');
      })
      .map((r) => ({ value: r.name, label: r.name })),
    [ranks, form.category]
  );
  const nationalityOptions = React.useMemo(
    () => nationalities.map((nat) => ({ value: nat.name, label: nat.name })),
    [nationalities]
  );
  const nationalityArticleOptions = React.useMemo(
    () => ['أولى', 'ثانية', 'ثالثة', 'رابعة', 'خامسة', 'سادسة', 'سابعة', 'ثامنة', 'غير محدد'],
    []
  );
  const jobTitleOptions = React.useMemo(
    () => availableJobTitles.map((jt) => ({ value: jt.name, label: jt.name })),
    [availableJobTitles]
  );
  const educationCertificateOptions = React.useMemo(
    () => ['بدون شهادة', 'متوسط', 'ثانوية عامة', 'دبلوم', 'جامعي', 'ماجستير', 'دكتوراه'],
    []
  );
  const jobGradeOptions = React.useMemo(
    () => ['الأولى أ', 'الأولى', 'الأولى ب', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'العقد الثاني'],
    []
  );
  const inactiveReasonOptions = React.useMemo(
    () => [
      'نقل',
      'إنهاء خدمات',
      'استقالة',
      'تقاعد',
      'وفاة',
      'إيقاف مؤقت'
    ].map((reason) => ({ value: reason, label: reason })),
    []
  );
  const selectStyles = React.useMemo(() => ({
    container: (base: any) => ({
      ...base,
      width: '100%'
    }),
    control: (base: any, state: any) => ({
      ...base,
      minHeight: '46px',
      borderRadius: '0.75rem',
      borderColor: state.isFocused ? '#2563eb' : '#e2e8f0',
      borderWidth: 1,
      backgroundColor: '#ffffff',
      boxShadow: state.isFocused ? '0 0 0 3px rgba(37, 99, 235, 0.12)' : 'none',
      '&:hover': {
        borderColor: '#94a3b8'
      }
    }),
    placeholder: (base: any) => ({
      ...base,
      color: '#9ca3af'
    }),
    menuPortal: (base: any) => ({
      ...base,
      zIndex: 60
    }),
    option: (base: any, state: any) => ({
      ...base,
      backgroundColor: state.isSelected ? '#dbeafe' : state.isFocused ? '#eff6ff' : '#ffffff',
      color: '#111827'
    })
  }), []);

  useEffect(() => {
    if (isOpen) {
      setLocalMode(mode);
    }
  }, [isOpen, mode]);

  // Reset form when modal opens/closes or mode changes
  useEffect(() => {
    if (!isOpen) return;

    setError(null);
    setWarnings([]);
    setConfirmSubmit(false);

    if (mode === 'create') {
      setForm(createInitialForm());
      setProfessionalGroupTouched(false);
    } else if (employee) {
      const hasEducationCertificate = !!employee.hasEducationCertificate;
      const educationCertificateType = employee.educationCertificateType
        || (hasEducationCertificate ? '' : 'بدون شهادة');
      const educationSpecialization = employee.educationSpecialization || '';
      const inferredGroup = employee.category === 'مهنيين'
        ? (employee.professionalGroup || inferProfessionalGroupFromJobTitle(employee.jobTitle || ''))
        : '';
      const hasStructuredName = Boolean(
        (employee.firstName && employee.firstName.trim()) ||
        (employee.secondName && employee.secondName.trim()) ||
        (employee.thirdName && employee.thirdName.trim()) ||
        (employee.fourthName && employee.fourthName.trim()) ||
        (employee.familyName && employee.familyName.trim())
      );
      const legacyNameParts = hasStructuredName ? ['', '', '', '', ''] : splitLegacyEmployeeName(employee.name);
      const namePartValues = {
        firstName: employee.firstName !== undefined && employee.firstName !== null ? employee.firstName : legacyNameParts[0],
        secondName: employee.secondName !== undefined && employee.secondName !== null ? employee.secondName : legacyNameParts[1],
        thirdName: employee.thirdName !== undefined && employee.thirdName !== null ? employee.thirdName : legacyNameParts[2],
        fourthName: employee.fourthName !== undefined && employee.fourthName !== null ? employee.fourthName : legacyNameParts[3],
        familyName: employee.familyName !== undefined && employee.familyName !== null ? employee.familyName : legacyNameParts[4],
      };

      setForm({
        ...employee,
        ...namePartValues,
        name: buildFullNameFromParts(namePartValues) || employee.name || '',
        gender: employee.gender || '',
        hasEducationCertificate,
        educationCertificateType,
        educationSpecialization,
        includeInShifts: employee.category === 'مدنيين' ? false : employee.includeInShifts,
        hasWeapon: employee.hasWeapon || false,
        hasParking: employee.hasParking || false,
        jobGrade: employee.jobGrade || '',
        professionalGroup: inferredGroup,
        excludeFromStatistics: employee.excludeFromStatistics === true,
        isSecondedOutsideGeneralAdministration: employee.isSecondedOutsideGeneralAdministration === true,
        secondmentLocation: employee.secondmentLocation || ''
      });
      setProfessionalGroupTouched(!!employee.professionalGroup);
    }
  }, [isOpen, mode, employee]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const loadLookups = async () => {
      try {
        const [natData, jobData, sectionData] = await Promise.all([
          fetchNationalities(),
          fetchJobTitles(),
          fetchSections()
        ]);
        setNationalities(natData);
        setJobTitles(jobData);
        setSections(sectionData);
      } catch (err) {
        console.error('Failed to load lookup data', err);
      }
    };
    loadLookups();
  }, [isOpen]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (confirmSubmit) setConfirmSubmit(false);
    if (warnings.length) setWarnings([]);
    setForm(prev => {
      const next: any = { ...prev, [name]: value };
      const namePartKeys = ['firstName', 'secondName', 'thirdName', 'fourthName', 'familyName'];
      if (name === 'name') {
        const [firstName, secondName, thirdName, fourthName, familyName] = splitLegacyEmployeeName(value);
        next.firstName = firstName;
        next.secondName = secondName;
        next.thirdName = thirdName;
        next.fourthName = fourthName;
        next.familyName = familyName;
      } else if (namePartKeys.includes(name)) {
        next.name = buildFullNameFromParts(next);
      }
      if (name === 'category') {
        next.rank = value === 'مدنيين' && !isEdit ? 'مدني' : '';
        next.jobTitle = '';
        next.jobGrade = value === 'مدنيين' ? prev.jobGrade : '';
        next.fileNumber = value === 'مدنيين' ? '' : prev.fileNumber;
        next.militaryNumber = value === 'ضباط صف' || value === 'مهنيين' ? prev.militaryNumber : '';
        next.includeInShifts = value === 'مدنيين' ? false : (prev.includeInShifts ?? true);
        next.shiftNotes = value === 'مدنيين' ? '' : prev.shiftNotes;
        next.professionalGroup = value === 'مهنيين'
          ? inferProfessionalGroupFromJobTitle(next.jobTitle || '')
          : '';
        setProfessionalGroupTouched(false);
        if (value !== 'ضباط' && value !== 'ضباط صف') {
          next.hasWeapon = false;
          next.weaponAttachments = '';
        }
      }
      if (name === 'department') {
        next.section = '';
      }
      if (name === 'status' && value === 'active') {
        next.reasonIfInactive = '';
      }
      if (name === 'maritalStatus' && value !== 'أخرى' && value !== 'اخرى') {
        next.maritalStatusNote = '';
      }
      if (name === 'civilId') {
        const derivedBirthDate = birthDateFromCivilId(value);
        if (derivedBirthDate && (!prev.birthDate || birthDateFromCivilId(prev.civilId) === prev.birthDate)) {
          next.birthDate = derivedBirthDate;
        }
      }
      return next;
    });
  };

  const handleSelectChange = (name: string, option: { value: string; label: string } | null) => {
    if (confirmSubmit) setConfirmSubmit(false);
    if (warnings.length) setWarnings([]);
    if (name === 'professionalGroup') {
      const cleared = !option?.value;
      setProfessionalGroupTouched(!cleared);
    }
    setForm(prev => {
      const next: any = { ...prev, [name]: option?.value || '' };
      if (name === 'professionalGroup' && !option?.value && prev.category === 'مهنيين') {
        next.professionalGroup = inferProfessionalGroupFromJobTitle(prev.jobTitle || '');
      }
      if (name === 'jobTitle' && prev.category === 'مهنيين' && !professionalGroupTouched) {
        next.professionalGroup = inferProfessionalGroupFromJobTitle(option?.value || '');
      }
      if (name === 'nationality' && !isGovernmentiNationality(option?.value || '')) {
        next.nationalityArticleNumber = '';
        next.nationalityIssueDate = '';
      }
      return next;
    });
  };

  const handleCategorySelect = (option: { value: string; label: string } | null) => {
    const value = option?.value || '';
    if (confirmSubmit) setConfirmSubmit(false);
    if (warnings.length) setWarnings([]);
    setForm(prev => {
      const next: any = { ...prev, category: value };
      next.rank = value === 'مدنيين' && !isEdit ? 'مدني' : '';
      next.jobTitle = '';
      next.jobGrade = value === 'مدنيين' ? prev.jobGrade : '';
      next.fileNumber = value === 'مدنيين' ? '' : prev.fileNumber;
      next.militaryNumber = value === 'ضباط صف' || value === 'مهنيين' ? prev.militaryNumber : '';
      next.includeInShifts = value === 'مدنيين' ? false : (prev.includeInShifts ?? true);
      next.shiftNotes = value === 'مدنيين' ? '' : prev.shiftNotes;
      next.professionalGroup = value === 'مهنيين'
        ? inferProfessionalGroupFromJobTitle(next.jobTitle || '')
        : '';
      setProfessionalGroupTouched(false);
      if (value !== 'ضباط' && value !== 'ضباط صف') {
        next.hasWeapon = false;
        next.weaponAttachments = '';
      }
      return next;
    });
  };

  const handleDepartmentSelect = (option: { value: string; label: string } | null) => {
    const value = option?.value || '';
    if (confirmSubmit) setConfirmSubmit(false);
    if (warnings.length) setWarnings([]);
    setForm(prev => ({ ...prev, department: value, section: '' }));
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    if (confirmSubmit) setConfirmSubmit(false);
    if (warnings.length) setWarnings([]);
    setForm(prev => {
      if (name === 'includeInShifts' && (prev.category === 'مدنيين')) {
        return { ...prev, includeInShifts: false, shiftNotes: '' };
      }
      const next: any = { ...prev, [name]: checked };

      if (name === 'hasEducationCertificate') {
        if (!checked) {
          next.educationCertificateType = 'بدون شهادة';
          next.educationSpecialization = '';
        } else if (!prev.educationCertificateType || prev.educationCertificateType === 'بدون شهادة') {
          next.educationCertificateType = '';
        }
      }
      if (name === 'hasWeapon' && !checked) {
        next.weaponAttachments = '';
      }
      if (name === 'hasParking' && !checked) {
        next.parkingLocation = '';
        next.parkingNumber = '';
      }
      if (name === 'includeInShifts' && !checked) {
        next.shiftNotes = '';
      }
      if (name === 'isSecondedOutsideGeneralAdministration') {
        if (checked && !prev.excludeFromStatistics) {
          next.excludeFromStatistics = true;
        }
        if (!checked) {
          next.secondmentLocation = '';
        }
      }

      return next;
    });
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      setError(null);
      setWarnings([]);

      const blockingErrors: string[] = [];
      if ((form.maritalStatus === 'أخرى' || form.maritalStatus === 'اخرى') && !form.maritalStatusNote?.trim()) {
        blockingErrors.push('يرجى كتابة ملاحظة للحالة الاجتماعية (أخرى)');
      }
      if (blockingErrors.length) {
        setError(blockingErrors.join('، '));
        setLoading(false);
        return;
      }

      const validationWarnings = getValidationWarnings(form);
      if (validationWarnings.length > 0 && !confirmSubmit) {
        setWarnings(validationWarnings);
        setConfirmSubmit(true);
        const summary = validationWarnings.length === 1
          ? `تنبيه: ${validationWarnings[0]}`
          : `تنبيه: توجد ${validationWarnings.length} ملاحظات على البيانات`;
        toast(summary, { icon: '*' });
        return;
      }

      if (validationWarnings.length > 0) {
        setWarnings(validationWarnings);
      }

      // Normalize parking location
      const parkingLocationAllowed = ['المواقف الداخلية', 'المواقف الخارجية'];
      const normalizedParkingLocation = parkingLocationAllowed.includes(form.parkingLocation || '')
        ? form.parkingLocation
        : (form.hasParking ? 'المواقف الداخلية' : '');

      const normalizedCategory = (form.category as Employee['category']) || '';
      const normalizedRank = normalizedCategory === 'مدنيين' ? 'مدني' : (form.rank || '');
      const includeInShiftsValue = normalizedCategory === 'مدنيين' ? false : form.includeInShifts !== false;
      const educationCertificateType = form.hasEducationCertificate
        ? (form.educationCertificateType || '')
        : 'بدون شهادة';
      const educationSpecialization = form.hasEducationCertificate
        ? (form.educationSpecialization || '')
        : '';
      const reasonIfInactive = form.status === 'inactive' ? (form.reasonIfInactive || '') : '';
      const maritalStatusNoteValue = (form.maritalStatus === 'أخرى' || form.maritalStatus === 'اخرى')
        ? (form.maritalStatusNote || '')
        : '';
      const fileNumberValue = normalizedCategory === 'مدنيين' ? null : (form.fileNumber?.trim() || null);
      const militaryNumberValue = normalizedCategory === 'ضباط صف' || normalizedCategory === 'مهنيين'
        ? (form.militaryNumber || '')
        : '';
      const normalizedDepartment = selectedDepartmentOption?.value || form.department || '';
      const normalizedSection = selectedSectionOption?.value || form.section || '';
      const nameParts = [
        form.firstName,
        form.secondName,
        form.thirdName,
        form.fourthName,
        form.familyName,
      ].map((part) => (part || '').trim());
      const fullNameValue = nameParts.filter(Boolean).join(' ') || form.name || '';
      const payload = {
        fileNumber: fileNumberValue,
        name: fullNameValue,
        firstName: nameParts[0] || '',
        secondName: nameParts[1] || '',
        thirdName: nameParts[2] || '',
        fourthName: nameParts[3] || '',
        familyName: nameParts[4] || '',
        category: normalizedCategory,
        rank: normalizedRank,
        jobTitle: form.jobTitle || null,
        jobGrade: normalizedCategory === 'مدنيين' ? (form.jobGrade || '') : '',
        professionalGroup: normalizedCategory === 'مهنيين'
          ? (form.professionalGroup || inferProfessionalGroupFromJobTitle(form.jobTitle || ''))
          : null,
        department: normalizedDepartment,
        status: form.status || 'active',
        reasonIfInactive,
        phone_number: form.phone_number || '',
        referenceNumber: form.referenceNumber || '',
        civilId: form.civilId || '',
        birthDate: form.birthDate || '',
        nationality: form.nationality || '',
        nationalityArticleNumber: form.nationalityArticleNumber || '',
        nationalityIssueDate: form.nationalityIssueDate || '',
        maritalStatus: form.maritalStatus || '',
        maritalStatusNote: maritalStatusNoteValue,
        appointmentDecisionNumber: form.appointmentDecisionNumber || '',
        appointmentDecisionDate: form.appointmentDecisionDate || '',
        gender: form.gender || '',
        hasEducationCertificate: !!form.hasEducationCertificate,
        educationCertificateType,
        educationSpecialization,
        militaryNumber: militaryNumberValue,
        hiringDate: form.hiringDate || '',
        seniorityNumber: form.seniorityNumber || '',
        section: normalizedSection,
        hasWeapon: !!form.hasWeapon,
        weaponAttachments: form.weaponAttachments || '',
        hasParking: !!form.hasParking,
        parkingLocation: form.hasParking ? (normalizedParkingLocation || '') : '',
        parkingNumber: form.hasParking ? (form.parkingNumber || '') : '',
        includeInShifts: includeInShiftsValue,
        shiftNotes: includeInShiftsValue ? '' : (form.shiftNotes || ''),
        excludeFromStatistics: !!form.excludeFromStatistics,
        isSecondedOutsideGeneralAdministration: !!form.isSecondedOutsideGeneralAdministration,
        secondmentLocation: form.isSecondedOutsideGeneralAdministration ? (form.secondmentLocation || '') : '',
      };

      if (isEdit && employee) {
        const updated = await updateEmployee(employee.id, payload as Omit<Employee, "id" | "monthlyShiftCount" | "lastShiftDate" | "lastShiftStatus">);
        onSave && onSave(updated as Employee);
      } else {
        const created = await createEmployee(payload as Omit<Employee, "id" | "monthlyShiftCount" | "lastShiftDate" | "lastShiftStatus">);
        onSave && onSave(created as Employee);
      }

      setConfirmSubmit(false);
      setWarnings([]);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'حدث خطأ أثناء الحفظ';
      setError(message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePrintDetails = async () => {
    if (!employee) return;
    setPrintLoading(true);
    const shouldHideShiftsInPrint = hideShifts || printHideShifts;
    const shouldHideLicensesInPrint = hideLicenses || printHideLicenses;
    const printableSections = viewSections.filter(
      (section) => !(shouldHideShiftsInPrint && section.title === 'نظام الخفارات')
    );

    let licenseSectionHtml = '';
    if (!shouldHideLicensesInPrint && employee.id) {
      try {
        const employeeLicenses = await LicenseService.getByEmployee(employee.id);
        const total = employeeLicenses.length;
        const fullDay = employeeLicenses.filter(l => l.license_type === 'يوم كامل').length;
        const short = employeeLicenses.filter(l => l.license_type === 'إستئذان قصير').length;
        const medical = employeeLicenses.filter(l => l.license_type === 'إستئذان طبي').length;
        const totalHours = employeeLicenses.reduce((sum, l) => sum + (l.hours || 0), 0);

        licenseSectionHtml = `
          <div class="section">
            <div class="section-header">
              <div class="section-title">الرخص والاستئذانات</div>
              <div class="section-desc">ملخص الرخص والاستئذانات المسجلة للموظف</div>
            </div>
            ${total === 0 ? '<div class="empty">لا توجد رخص أو استئذانات مسجلة حتى تاريخه</div>' : `
              <div class="grid">
                <div class="field">
                  <div class="label">الإجمالي</div>
                  <div class="value">${escapeHtml(formatPrintValue(total))}</div>
                </div>
                <div class="field">
                  <div class="label">رخصة يوم كامل</div>
                  <div class="value">${escapeHtml(formatPrintValue(fullDay))}</div>
                </div>
                <div class="field">
                  <div class="label">استئذانات قصيرة</div>
                  <div class="value">${escapeHtml(formatPrintValue(short))}</div>
                </div>
                <div class="field">
                  <div class="label">إستئذان طبي</div>
                  <div class="value">${escapeHtml(formatPrintValue(medical))}</div>
                </div>
                <div class="field">
                  <div class="label">ساعات الاستئذانات القصيرة</div>
                  <div class="value">${escapeHtml(formatPrintValue(totalHours))}</div>
                </div>
              </div>
            `}
          </div>
        `;
      } catch (err) {
        licenseSectionHtml = `
          <div class="section">
            <div class="section-header">
              <div class="section-title">الرخص والاستئذانات</div>
              <div class="section-desc">تعذر تحميل بيانات الرخص للطباعة</div>
            </div>
          </div>
        `;
      }
    }

    const printHeaderTitle = 'بطاقة البيانات';
    const printHeaderName = formatEmployeeDisplayName(employee) || employee.name || '';
    const printHeaderRank = employee.rank || '';
    const printHeaderBadge = employee.category || '';
    const printHeaderLine = [printHeaderRank, printHeaderName].filter(Boolean).join(' / ');
    const printDateRaw = new Intl.DateTimeFormat('ar-KW-u-nu-latn', {
      dateStyle: 'short',
      timeStyle: 'medium'
    }).format(new Date());
    const printDate = printDateRaw.replace('،', '').replace(/\s+/g, ' ').trim();
    const skipPrintFieldLabels = new Set(['الفئة', 'الرتبة', 'الاسم الكامل']);

    const sectionsHtml = printableSections.map((section) => {
      const printableFields = section.fields.filter((field) => !skipPrintFieldLabels.has(field.label));
      if (!printableFields.length) return '';
      const fieldsHtml = printableFields.map((field) => `
        <div class="field">
          <div class="label">${escapeHtml(field.label)}</div>
          <div class="value">${escapeHtml(formatPrintValue(field.value, field.type))}</div>
        </div>
      `).join('');

      return `
        <div class="section">
          <div class="section-header">
            <div class="section-title">${escapeHtml(section.title)}</div>
            <div class="section-desc">${escapeHtml(section.description)}</div>
          </div>
          <div class="grid">${fieldsHtml}</div>
        </div>
      `;
    }).filter(Boolean).join('');

    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
      setPrintLoading(false);
      return;
    }

    printWindow.document.documentElement.innerHTML = `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>تفاصيل الموظف</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@200;300;400;500;600;700;800;900&display=swap');
            * { box-sizing: border-box; margin: 0; padding: 0; }
            html, body { direction: rtl; }
            body {
              font-family: "Cairo", "Tahoma", sans-serif;
              background: #f8fafc;
              color: #111827;
              padding: 24px;
              text-align: right;
              line-height: 1.5;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .header {
              background: linear-gradient(135deg, #1d4ed8, #1e3a8a);
              color: #fff;
              padding: 20px 24px;
              border-radius: 16px;
              margin-bottom: 20px;
            }
            .header-title {
              font-size: 20px;
              font-weight: 800;
              margin-bottom: 6px;
            }
            .header-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
              margin-bottom: 6px;
            }
            .header-name {
              font-size: 15px;
              font-weight: 700;
            }
            .header-badge {
              font-size: 11px;
              font-weight: 700;
              padding: 2px 10px;
              border-radius: 999px;
              border: 1px solid rgba(255, 255, 255, 0.4);
              background: rgba(255, 255, 255, 0.18);
              color: #ffffff;
              white-space: nowrap;
            }
            .header-meta {
              font-size: 11px;
              opacity: 0.8;
            }
            .section {
              background: #fff;
              border: 1px solid #e2e8f0;
              border-radius: 16px;
              padding: 16px;
              margin-bottom: 14px;
              box-shadow: 0 10px 20px rgba(15, 23, 42, 0.05);
            }
            .section-header {
              margin-bottom: 10px;
            }
            .section-title {
              font-size: 15px;
              font-weight: 800;
              color: #1e3a8a;
            }
            .section-desc {
              font-size: 12px;
              color: #64748b;
              margin-top: 4px;
            }
            .grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 10px;
            }
            .field {
              padding: 8px 10px;
              border-radius: 12px;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
            }
            .label {
              font-size: 11px;
              color: #64748b;
              font-weight: 700;
              margin-bottom: 6px;
            }
            .value {
              font-size: 13px;
              color: #0f172a;
              font-weight: 700;
            }
            .empty {
              font-size: 12px;
              color: #64748b;
              text-align: center;
              padding: 12px 0;
            }
            @page {
              size: A4;
              margin: 12mm;
            }
            @media print {
              body { background: #fff; padding: 0; }
              .header { margin-bottom: 12px; padding: 14px 16px; border-radius: 12px; }
              .header-title { font-size: 18px; }
              .header-name { font-size: 21px; }
              .header-badge { font-size: 9px; padding: 1px 8px; }
              .section { box-shadow: none; margin-bottom: 10px; padding: 12px; page-break-inside: avoid; }
              .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
              .field { padding: 5px 6px; }
              .label { font-size: 9px; margin-bottom: 3px; }
              .value { font-size: 11px; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="header-title">${escapeHtml(printHeaderTitle)}</div>
            <div class="header-row">
              <div class="header-name">${escapeHtml(printHeaderLine || '-')}</div>
              ${printHeaderBadge ? `<div class="header-badge">${escapeHtml(printHeaderBadge)}</div>` : ''}
            </div>
            <div class="header-meta">تاريخ الطباعة : ${escapeHtml(printDate)}</div>
          </div>
          ${sectionsHtml}
          ${licenseSectionHtml}
        </body>
      </html>
    `;

    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
      setPrintLoading(false);
    }, 300);
  };

  const handleSwitchToEdit = () => {
    if (!employee) return;
    setError(null);
    setWarnings([]);
    setConfirmSubmit(false);
    setLocalMode('edit');
  };

  const handleNavigateToEmployee = () => {
    if (!employee) return;
    const term = employee.name || employee.fileNumber || employee.civilId || '';
    if (term.trim()) {
      try {
        localStorage.setItem('employeeSearchTerm', term);
        localStorage.setItem('employeeSearchAt', String(Date.now()));
      } catch { }
      try {
        const evt = new CustomEvent('employee-search', { detail: { term, at: Date.now() } });
        window.dispatchEvent(evt);
      } catch { }
    }
    window.location.hash = '#employees';
    onClose();
  };

  // Generate view sections for display mode
  const viewSections = React.useMemo(() => {
    const weaponAllowed = employee?.category === 'ضباط' || employee?.category === 'ضباط صف';
    const isInactive = employee?.status === 'inactive';
    const includeInShiftsView = employee?.category === 'مدنيين'
      ? false
      : employee?.includeInShifts !== false;
    const hideShiftsSection = hideShifts || employee?.category === 'مدنيين';
    const monthName = new Intl.DateTimeFormat('ar-UK', { month: 'long' }).format(new Date());
    const educationTypeLabel = employee?.educationCertificateType || 'بدون شهادة';
    const lastShiftStatusLabel = employee?.lastShiftStatus
      ? (employee.lastShiftStatus === 'attended' ? 'داوم' : 'لم يداوم')
      : '-';
    const monthlyShiftLabel = employee?.monthlyShiftCount != null
      ? `${employee.monthlyShiftCount} خفارة`
      : '-';

    const ageDurationLabel = formatDuration(employee?.birthDate);
    const serviceDurationLabel = formatDuration(employee?.hiringDate);
    const isGovernmenti = isGovernmentiNationality(employee?.nationality || '');
    const isOtherMaritalStatus = employee?.maritalStatus === 'أخرى' || employee?.maritalStatus === 'اخرى';
    const resolvedProfessionalGroup = employee?.category === 'مهنيين'
      ? (employee?.professionalGroup || 'أخرى')
      : '';

    type DetailField = {
      label: string;
      value: string | boolean;
      icon?: React.ReactNode;
      type?: 'boolean' | 'date' | 'status';
      hide?: boolean;
    };
    type DetailSection = {
      title: string;
      description: string;
      icon: React.ReactNode;
      gradient: string;
      fields: DetailField[];
    };

    const sections: DetailSection[] = [
      {
        title: 'البيانات الأساسية',
        description: 'البيانات الوظيفية الأساسية للموظف',
        icon: <Icons.user className="w-6 h-6" />,
        gradient: 'from-blue-50 to-blue-100',
        fields: [
          { label: 'الفئة', value: employee?.category || '-', icon: <Icons.user className="w-4 h-4" /> },
          { label: 'الرتبة', value: employee?.rank || '-', icon: <Icons.award className="w-4 h-4" /> },
          { label: 'الاسم الكامل', value: displayName || '-', icon: <Icons.user className="w-4 h-4" /> },
          { label: 'المسمى الوظيفي', value: employee?.jobTitle || '-', icon: <Icons.briefcase className="w-4 h-4" /> },
          { label: 'فئة المهنيين', value: resolvedProfessionalGroup || 'أخرى', hide: employee?.category !== 'مهنيين', icon: <Icons.list className="w-4 h-4" /> },
          { label: 'الدرجة الوظيفية', value: employee?.jobGrade || '-', hide: employee?.category !== 'مدنيين', icon: <Icons.award className="w-4 h-4" /> },
          {
            label: 'الإدارة',
            value: formatDepartmentLabel(employee?.department, departmentNameMap) || '-',
            icon: <Icons.building className="w-4 h-4" />
          },
          { label: 'القسم', value: formatSectionLabel(employee?.section, sectionNameMap, employee?.department) || '-', icon: <Icons.building className="w-4 h-4" /> },
          { label: 'الحالة', value: employee?.status || 'active', type: 'status' as const, icon: <Icons.check className="w-4 h-4" /> },
          {
            label: 'مستثنى من الإحصائيات',
            value: employee?.excludeFromStatistics || false,
            type: 'boolean' as const,
            hide: !employee?.excludeFromStatistics,
            icon: <Icons.list className="w-4 h-4" />
          },
          {
            label: 'منتدب من خارج الإدارة العامة',
            value: (employee?.secondmentLocation || '').trim() || '-',
            hide: !employee?.isSecondedOutsideGeneralAdministration,
            icon: <Icons.briefcase className="w-4 h-4" />
          },
          { label: 'سبب خارج الخدمة', value: employee?.reasonIfInactive || '-', hide: employee?.status !== 'inactive', icon: <Icons.warning className="w-4 h-4" /> },
          { label: 'تاريخ التحويل لخارج الخدمة', value: employee?.inactiveDate || '', type: 'date' as const, icon: <Icons.calendar className="w-4 h-4" />, hide: employee?.status !== 'inactive' }
        ]
      },
      {
        title: 'الهوية والأرقام',
        description: 'البيانات الشخصية وأرقام الهوية المختلفة',
        icon: <Icons.id className="w-6 h-6" />,
        gradient: 'from-emerald-50 to-emerald-100',
        fields: [
          { label: 'الرقم المدني', value: employee?.civilId || '-', icon: <Icons.id className="w-4 h-4" /> },
          { label: 'رقم الملف', value: employee?.fileNumber || '-', hide: employee?.category === 'مدنيين', icon: <Icons.hash className="w-4 h-4" /> },
          { label: 'رقم المرجع', value: employee?.referenceNumber || '-', icon: <Icons.clipboard className="w-4 h-4" /> },
          { label: 'الرقم العسكري', value: employee?.militaryNumber || '-', hide: employee?.category === 'مدنيين' || employee?.category === 'ضباط', icon: <Icons.shield className="w-4 h-4" /> },
          { label: 'رقم الأقدمية', value: employee?.seniorityNumber || '-', hide: employee?.category === 'مدنيين', icon: <Icons.award className="w-4 h-4" /> },
          { label: 'رقم الهاتف', value: employee?.phone_number || '-', icon: <Icons.phone className="w-4 h-4" /> },
          { label: 'الجنسية', value: employee?.nationality || '-', icon: <Icons.globe className="w-4 h-4" /> },
          { label: 'رقم مادة الجنسية', value: employee?.nationalityArticleNumber || '-', hide: !isGovernmenti && !employee?.nationalityArticleNumber, icon: <Icons.hash className="w-4 h-4" /> },
          { label: 'تاريخ إصدار الجنسية', value: employee?.nationalityIssueDate || '', type: 'date' as const, hide: !isGovernmenti && !employee?.nationalityIssueDate, icon: <Icons.calendar className="w-4 h-4" /> },
          { label: 'الحالة الاجتماعية', value: employee?.maritalStatus || '-', icon: <Icons.user className="w-4 h-4" /> },
          { label: 'ملاحظة الحالة الاجتماعية', value: employee?.maritalStatusNote || '-', hide: !isOtherMaritalStatus && !employee?.maritalStatusNote, icon: <Icons.clipboard className="w-4 h-4" /> },
          { label: 'النوع', value: employee?.gender || '-', icon: <Icons.user className="w-4 h-4" /> },
          { label: 'تاريخ الميلاد', value: employee?.birthDate || '', type: 'date' as const, icon: <Icons.calendar className="w-4 h-4" /> },
          { label: 'العمر', value: ageDurationLabel, icon: <Icons.calendar className="w-4 h-4" /> },
          { label: 'تاريخ التعيين', value: employee?.hiringDate || '', type: 'date' as const, icon: <Icons.calendar className="w-4 h-4" /> },
          { label: 'رقم قرار التعيين', value: employee?.appointmentDecisionNumber || '-', hide: !employee?.appointmentDecisionNumber, icon: <Icons.clipboard className="w-4 h-4" /> },
          { label: 'تاريخ قرار التعيين', value: employee?.appointmentDecisionDate || '', type: 'date' as const, hide: !employee?.appointmentDecisionDate, icon: <Icons.calendar className="w-4 h-4" /> },
          { label: 'مدة الخدمة', value: serviceDurationLabel, icon: <Icons.calendarCheck className="w-4 h-4" /> }
        ]
      },
      {
        title: 'المؤهل الدراسي',
        description: 'تفاصيل الشهادات الدراسية',
        icon: <Icons.check className="w-6 h-6" />,
        gradient: 'from-amber-50 to-amber-100',
        fields: [
          { label: 'هل لديه شهادة دراسية؟', value: employee?.hasEducationCertificate || false, type: 'boolean' as const, icon: <Icons.check className="w-4 h-4" /> },
          { label: 'نوع الشهادة الدراسية', value: educationTypeLabel, hide: !employee?.hasEducationCertificate },
          { label: 'تخصص المؤهل الدراسي', value: employee?.educationSpecialization || '-', hide: !employee?.hasEducationCertificate, icon: <Icons.briefcase className="w-4 h-4" /> }
        ]
      },
      {
        title: 'المعدات والمرافق',
        description: 'بيانات السلاح والمواقف',
        icon: <Icons.shield className="w-6 h-6" />,
        gradient: 'from-purple-50 to-purple-100',
        fields: [
          { label: 'هل لديه سلاح؟', value: employee?.hasWeapon || false, type: 'boolean' as const, hide: !weaponAllowed, icon: <Icons.shield className="w-4 h-4" /> },
          { label: 'مرفقات السلاح', value: employee?.weaponAttachments || '-', hide: !weaponAllowed || !employee?.hasWeapon, icon: <Icons.clipboard className="w-4 h-4" /> },
          { label: 'هل لديه موقف سيارات؟', value: employee?.hasParking || false, type: 'boolean' as const, icon: <Icons.car className="w-4 h-4" /> },
          { label: 'مكان موقف السيارات', value: employee?.parkingLocation || '-', hide: !employee?.hasParking, icon: <Icons.car className="w-4 h-4" /> },
          { label: 'رقم موقف السيارات', value: employee?.parkingNumber || '-', hide: !employee?.hasParking, icon: <Icons.hash className="w-4 h-4" /> }
        ]
      },
      {
        title: 'نظام الخفارات',
        description: 'تفاصيل المشاركة في الخفارات وأحدث البيانات',
        icon: <Icons.settings className="w-6 h-6" />,
        gradient: 'from-orange-50 to-orange-100',
        fields: [
          { label: 'إدراج في الخفارات', value: includeInShiftsView, type: 'boolean' as const, icon: <Icons.settings className="w-4 h-4" /> },
          { label: 'ملاحظات الخفارات', value: employee?.shiftNotes || '-', hide: includeInShiftsView, icon: <Icons.clipboard className="w-4 h-4" /> },
          { label: 'آخر خفارة', value: employee?.lastShiftDate || '', type: 'date' as const, icon: <Icons.calendar className="w-4 h-4" />, hide: !includeInShiftsView },
          { label: 'حالة آخر خفارة', value: lastShiftStatusLabel, hide: !includeInShiftsView, icon: <Icons.check className="w-4 h-4" /> },
          { label: `عدد الخفارات خلال شهر ${monthName}`, value: monthlyShiftLabel, hide: !includeInShiftsView, icon: <Icons.list className="w-4 h-4" /> }
        ]
      }
    ];

    const visibleSections = hideShiftsSection
      ? sections.filter((section) => section.title !== 'نظام الخفارات')
      : sections;

    const processedSections = visibleSections.map((section) => ({
      ...section,
      gradient: isInactive ? 'from-red-50 to-red-100' : section.gradient,
      fields: section.fields.filter((field) => !field.hide)
    }));

    // إضافة قسم الرخص إذا كان النظام مفعل والموظف محدد
    if (!hideLicenses && employee?.id) {
      // سيتم إضافة قسم الرخص كمكون منفصل
    }

    return processedSections;
  }, [employee, hideShifts]);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;
  const portalRoot = typeof document !== 'undefined' ? document.body : null;
  if (!portalRoot) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/55 px-3 py-5 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >

        <ModalHeader mode={localMode} onClose={onClose} isInactive={isInactiveContext} />

        <div className={`flex-1 overflow-y-auto p-5 sm:p-6 ${isInactiveContext ? 'bg-red-50/45' : 'bg-slate-50'}`}>
          {localMode === 'view' ? (
            // View Mode - Simplified Layout
            <div className="space-y-5">
              <div className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${isInactiveContext ? 'border-red-200' : 'border-slate-200'}`}>
                <div className={`px-5 py-5 ${isInactiveContext ? 'bg-red-50' : 'bg-white'}`}>
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${isInactiveContext ? 'bg-red-600 text-white' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'}`}>
                          {isInactiveContext ? 'خارج الخدمة' : 'في الخدمة'}
                        </span>
                        {employee?.category && (
                          <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700 ring-1 ring-slate-200">
                            {employee.category}
                          </span>
                        )}
                        {employee?.excludeFromStatistics && (
                          <span className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-100">
                            مستثنى من الإحصائيات
                          </span>
                        )}
                      </div>
                      <h3 className="text-2xl font-black leading-tight text-slate-950">
                        {employee?.rank || '—'} / {displayName || '—'}
                      </h3>
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold text-slate-600">
                        <span>{formatDepartmentLabel(employee?.department, departmentNameMap) || 'إدارة غير مسجلة'}</span>
                        <span>{formatSectionLabel(employee?.section, sectionNameMap, employee?.department) || 'قسم غير مسجل'}</span>
                        <span>{employee?.jobTitle || 'مسمى وظيفي غير مسجل'}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSwitchToEdit}
                        disabled={!employee}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Icons.edit className="w-4 h-4" />
                        تعديل البيانات
                      </button>
                      {showNavigateToManagement && typeof window !== 'undefined' && !window.location.hash.includes('#employees') && (
                        <button
                          type="button"
                          onClick={handleNavigateToEmployee}
                          disabled={!employee}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Icons.eye className="w-4 h-4" />
                          عرض في إدارة الموظفين
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 border-t border-slate-100 bg-slate-50/80 md:grid-cols-4">
                  {[
                    { label: 'رقم الملف', value: employee?.fileNumber || '—' },
                    { label: 'الرقم المدني', value: employee?.civilId || '—' },
                    { label: 'الهاتف', value: employee?.phone_number || '—' },
                    { label: 'مدة الخدمة', value: formatDuration(employee?.hiringDate) || '—' },
                  ].map((item) => (
                    <div key={item.label} className="border-l border-slate-100 px-4 py-3 last:border-l-0">
                      <div className="text-xs font-black text-slate-500">{item.label}</div>
                      <div className="mt-1 truncate text-sm font-black text-slate-950" title={item.value}>{formatDigits(item.value)}</div>
                    </div>
                  ))}
                </div>
              </div>
              {viewSections.map((section, sectionIndex) => (
                <ViewSection
                  key={`${section.title}-${sectionIndex}`}
                  title={section.title}
                  icon={section.icon}
                  isInactive={isInactiveView}
                >
                  {section.fields.map((field, index) => (
                    <ViewField key={`${section.title}-${index}`} {...field} />
                  ))}
                </ViewSection>
              ))}

              {/* قسم الرخص والاستئذانات */}
              {!hideLicenses && employee?.id && (
                <LicenseSection
                  employeeId={employee.id}
                  isVisible={localMode === 'view'}
                />
              )}
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                      <Icons.clipboard className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="text-sm font-black text-slate-900">خيارات الطباعة</div>
                      <div className="text-xs font-semibold text-slate-500">إعدادات بطاقة البيانات المطبوعة</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-600">
                    <label className={`inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 ${hideShifts ? 'opacity-60' : ''}`}>
                      <input
                        type="checkbox"
                        checked={hideShifts || printHideShifts}
                        onChange={(e) => setPrintHideShifts(e.target.checked)}
                        disabled={hideShifts}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      إخفاء قسم الخفارات في الطباعة
                    </label>
                    <label className={`inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 ${hideLicenses ? 'opacity-60' : ''}`}>
                      <input
                        type="checkbox"
                        checked={hideLicenses || printHideLicenses}
                        onChange={(e) => setPrintHideLicenses(e.target.checked)}
                        disabled={hideLicenses}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      إخفاء الرخص والاستئذانات في الطباعة
                    </label>
                    <button
                      type="button"
                      onClick={handlePrintDetails}
                      disabled={printLoading}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-70"
                    >
                      <Icons.clipboard className="w-4 h-4" />
                      {printLoading ? 'جاري تجهيز الطباعة...' : 'طباعة التفاصيل'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            // Form Mode - Professional Sectioned Layout
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-5">

              {/* Personal Information Section */}
              <SectionCard
                title="البيانات الشخصية"
                description="الفئة والاسم وموقع الموظف"
                icon={<Icons.user className="w-6 h-6" />}
                gradient="from-blue-50 to-blue-100"
                isInactive={isInactiveContext}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="lg:col-span-1">
                    <FormField
                      label="الفئة"
                      icon={<Icons.list className="w-4 h-4" />}
                    >
                      <Select
                        isDisabled={readOnly}
                        isClearable
                        options={categoryOptions}
                        value={categoryOptions.find((opt) => opt.value === (form.category || '')) || null}
                        onChange={(option) => handleCategorySelect(option as { value: string; label: string } | null)}
                        placeholder="اختر الفئة"
                        noOptionsMessage={() => 'لا توجد نتائج'}
                        styles={selectStyles}
                        menuPortalTarget={document.body}
                        menuPosition="fixed"
                      />
                    </FormField>
                  </div>

                  <div className="lg:col-span-1">
                    <FormField
                      label="الرتبة"
                      icon={<Icons.shield className="w-4 h-4" />}
                    >
                      {isCreateCivilian ? (
                        <input
                          type="text"
                          value="مدني"
                          disabled
                          className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-sm font-semibold text-slate-600 cursor-not-allowed"
                        />
                      ) : (
                        <Select
                          isDisabled={readOnly || !form.category}
                          isClearable
                          options={rankOptions}
                          value={rankOptions.find((opt) => opt.value === (form.rank || '')) || null}
                          onChange={(option) => handleSelectChange('rank', option as { value: string; label: string } | null)}
                          placeholder="اختر الرتبة"
                          noOptionsMessage={() => 'لا توجد نتائج'}
                          styles={selectStyles}
                          menuPortalTarget={document.body}
                          menuPosition="fixed"
                        />
                      )}
                    </FormField>
                  </div>

                  <div className="lg:col-span-2">
                    <FormField
                      label="الاسم الكامل"
                      icon={<Icons.user className="w-4 h-4" />}
                    >
                      <input
                        type="text"
                        name="name"
                        value={form.name || ''}
                        onChange={handleInputChange}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                        disabled={readOnly}
                        placeholder="اكتب الاسم كاملًا مرة واحدة"
                      />
                    </FormField>
                  </div>

                  <div className="lg:col-span-2">
                    <FormField
                      label="أجزاء الاسم"
                      icon={<Icons.list className="w-4 h-4" />}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                        {[
                          { name: 'firstName', placeholder: 'الاسم الأول' },
                          { name: 'secondName', placeholder: 'الاسم الثاني' },
                          { name: 'thirdName', placeholder: 'الاسم الثالث' },
                          { name: 'fourthName', placeholder: 'الاسم الرابع' },
                          { name: 'familyName', placeholder: 'العائلة' },
                        ].map((field) => (
                          <input
                            key={field.name}
                            type="text"
                            name={field.name}
                            value={(form as any)[field.name] || ''}
                            onChange={handleInputChange}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                            disabled={readOnly}
                            placeholder={field.placeholder}
                          />
                        ))}
                      </div>
                    </FormField>
                  </div>

                  <div className="lg:col-span-2">
                    <FormField
                      label="الإدارة"
                      icon={<Icons.building className="w-4 h-4" />}
                    >
                      <Select
                        isDisabled={readOnly}
                        isClearable
                        options={departmentOptions}
                        value={selectedDepartmentOption || null}
                        onChange={(option) => handleDepartmentSelect(option as { value: string; label: string } | null)}
                        placeholder="اختر الإدارة"
                        noOptionsMessage={() => 'لا توجد نتائج'}
                        styles={selectStyles}
                        menuPortalTarget={document.body}
                        menuPosition="fixed"
                      />
                    </FormField>
                  </div>

                  <div className="lg:col-span-1">
                    <FormField label="القسم" icon={<Icons.building className="w-4 h-4" />}>
                      <Select
                        isDisabled={readOnly || !form.department}
                        isClearable
                        options={sectionOptions}
                        value={selectedSectionOption || null}
                        onChange={(option) => handleSelectChange('section', option as { value: string; label: string } | null)}
                        placeholder="اختر القسم"
                        noOptionsMessage={() => 'لا توجد نتائج'}
                        styles={selectStyles}
                        menuPortalTarget={document.body}
                        menuPosition="fixed"
                      />
                      {!form.department && (
                        <p className="text-xs text-gray-500 mt-1">اختر الإدارة أولاً لعرض الأقسام</p>
                      )}
                    </FormField>
                  </div>

                  <div className="lg:col-span-1">
                    <FormField label={jobTitleLabel} icon={<Icons.briefcase className="w-4 h-4" />}>
                      <Select
                        isDisabled={readOnly || !form.category}
                        isClearable
                        options={jobTitleOptions}
                        value={jobTitleOptions.find((opt) => opt.value === (form.jobTitle || '')) || null}
                        onChange={(option) => handleSelectChange('jobTitle', option as { value: string; label: string } | null)}
                        placeholder={`${jobTitleLabel}`}
                        noOptionsMessage={() => 'لا توجد نتائج'}
                        styles={selectStyles}
                        menuPortalTarget={document.body}
                        menuPosition="fixed"
                      />
                      {availableJobTitles.length === 0 && (
                        <p className="text-xs text-gray-500 mt-1">أضف {jobTitleLabel} من صفحة الإعدادات</p>
                      )}
                    </FormField>
                  </div>

                  {form.category === 'مهنيين' && (
                    <div className="lg:col-span-1">
                      <FormField label="فئة المهنيين" icon={<Icons.list className="w-4 h-4" />}>
                        <Select
                          isDisabled={readOnly}
                          isClearable
                          options={professionalGroupOptions}
                          value={professionalGroupOptions.find((opt) => opt.value === (form.professionalGroup || '')) || null}
                          onChange={(option) => handleSelectChange('professionalGroup', option as { value: string; label: string } | null)}
                          placeholder="اختر فئة المهنيين"
                          noOptionsMessage={() => 'لا توجد نتائج'}
                          styles={selectStyles}
                          menuPortalTarget={document.body}
                          menuPosition="fixed"
                        />
                        <p className="text-xs text-gray-500 mt-1">تظهر هذه الفئة في تقارير المهنيين.</p>
                      </FormField>
                    </div>
                  )}

                  {form.category === 'مدنيين' && (
                    <div className="lg:col-span-1">
                      <FormField label="الدرجة الوظيفية" icon={<Icons.award className="w-4 h-4" />}>
                        <select
                          name="jobGrade"
                          value={form.jobGrade || ''}
                          onChange={handleInputChange}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                          disabled={readOnly}
                        >
                          <option value="">اختر الدرجة الوظيفية</option>
                          {jobGradeOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </FormField>
                    </div>
                  )}

                  <div className="lg:col-span-1">
                    <FormField label="الحالة" icon={<Icons.check className="w-4 h-4" />}>
                      <select
                        name="status"
                        value={form.status || 'active'}
                        onChange={handleInputChange}
                        className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm font-bold transition focus:outline-none focus:ring-4 ${form.status === 'inactive' ? 'border-red-200 text-red-700 focus:border-red-500 focus:ring-red-100 text-red-600' : 'border-slate-200 border-1.5 text-green-600 focus:border-blue-600 focus:ring-blue-100'}`}
                        disabled={readOnly}
                      >
                        <option className="text-green-600 font-bold" value="active">في الخدمة</option>
                        <option className="text-red-600 font-bold" value="inactive">خارج الخدمة</option>
                      </select>
                    </FormField>
                  </div>

                  {form.status === 'inactive' && (
                    <div className="lg:col-span-1">
                      <FormField label="سبب خارج الخدمة" icon={<Icons.warning className="w-4 h-4" />}>
                        <CreatableSelect
                          isDisabled={readOnly}
                          isClearable
                          options={inactiveReasonOptions}
                          value={form.reasonIfInactive ? { value: form.reasonIfInactive, label: form.reasonIfInactive } : null}
                          onChange={(option) => handleSelectChange('reasonIfInactive', option as { value: string; label: string } | null)}
                          placeholder="اختر السبب"
                          noOptionsMessage={() => 'لا توجد نتائج'}
                          formatCreateLabel={(inputValue) => `إضافة سبب: ${inputValue}`}
                          styles={selectStyles}
                          menuPortalTarget={document.body}
                          menuPosition="fixed"
                        />
                      </FormField>
                    </div>
                  )}

                  <div className="lg:col-span-1">
                    <FormField label="استثناء الإحصائيات" icon={<Icons.list className="w-4 h-4" />}>
                      <select
                        name="excludeFromStatistics"
                        value={form.excludeFromStatistics ? 'true' : 'false'}
                        onChange={(event) => handleCheckboxChange({
                          target: { name: 'excludeFromStatistics', checked: event.target.value === 'true' }
                        } as React.ChangeEvent<HTMLInputElement>)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                        disabled={readOnly}
                      >
                        <option value="false">داخل الإحصائيات</option>
                        <option value="true">مستثنى من الإحصائيات</option>
                      </select>
                    </FormField>
                  </div>

                  <div className="lg:col-span-1">
                    <FormField label="انتداب خارج الإدارة" icon={<Icons.building className="w-4 h-4" />}>
                      <select
                        name="isSecondedOutsideGeneralAdministration"
                        value={isSecondedOutside ? 'true' : 'false'}
                        onChange={(event) => handleCheckboxChange({
                          target: { name: 'isSecondedOutsideGeneralAdministration', checked: event.target.value === 'true' }
                        } as React.ChangeEvent<HTMLInputElement>)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                        disabled={readOnly}
                      >
                        <option value="false">غير منتدب</option>
                        <option value="true">منتدب خارج الإدارة</option>
                      </select>
                    </FormField>
                  </div>

                  {isSecondedOutside && (
                    <div className="lg:col-span-1">
                      <FormField label="جهة الانتداب" icon={<Icons.briefcase className="w-4 h-4" />}>
                        <input
                          type="text"
                          name="secondmentLocation"
                          value={form.secondmentLocation || ''}
                          onChange={handleInputChange}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                          disabled={readOnly}
                          placeholder="مثال: شؤون القوة"
                        />
                      </FormField>
                    </div>
                  )}
                </div>
              </SectionCard>

              {/* Identity and Numbers Section */}
              <SectionCard
                title="الهوية والأرقام"
                description="الأرقام الرسمية وبيانات الاتصال"
                icon={<Icons.id className="w-6 h-6" />}
                gradient="from-emerald-50 to-emerald-100"
                isInactive={isInactiveContext}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <FormField
                      label="الرقم المدني"
                      icon={<Icons.id className="w-4 h-4" />}
                    >
                      <input
                        type="text"
                        name="civilId"
                        value={form.civilId || ''}
                        onChange={handleInputChange}
                        inputMode="numeric"
                        maxLength={12}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                        disabled={readOnly}
                        placeholder="أدخل الرقم المدني"
                      />
                    </FormField>
                  </div>

                  {showFileNumberField && (
                    <div>
                      <FormField label="رقم الملف" icon={<Icons.hash className="w-4 h-4" />}>
                        <input
                          type="text"
                          name="fileNumber"
                          value={form.fileNumber || ''}
                          onChange={handleInputChange}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                          disabled={readOnly}
                          placeholder="أدخل رقم الملف"
                        />
                      </FormField>
                    </div>
                  )}

                  <div>
                    <FormField
                      label="رقم المرجع"
                      icon={<Icons.clipboard className="w-4 h-4" />}
                    >
                      <input
                        type="text"
                        name="referenceNumber"
                        value={form.referenceNumber || ''}
                        onChange={handleInputChange}
                        inputMode="numeric"
                        maxLength={9}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                        disabled={readOnly}
                        placeholder="أدخل رقم المرجع"
                      />
                    </FormField>
                  </div>

                  {showMilitaryNumberField && (
                    <div>
                      <FormField label="الرقم العسكري" icon={<Icons.shield className="w-4 h-4" />}>
                        <input
                          type="text"
                          name="militaryNumber"
                          value={form.militaryNumber || ''}
                          onChange={handleInputChange}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                          disabled={readOnly}
                          placeholder="أدخل الرقم العسكري"
                        />
                      </FormField>
                    </div>
                  )}

                  {form.category !== 'مدنيين' && (
                    <div>
                      <FormField label="رقم الأقدمية" icon={<Icons.award className="w-4 h-4" />}>
                        <input
                          type="text"
                          name="seniorityNumber"
                          value={form.seniorityNumber || ''}
                          onChange={handleInputChange}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                          disabled={readOnly}
                          placeholder="أدخل رقم الأقدمية"
                        />
                      </FormField>
                    </div>
                  )}

                  <div>
                    <FormField
                      label="رقم الهاتف"
                      icon={<Icons.phone className="w-4 h-4" />}
                    >
                      <input
                        type="tel"
                        name="phone_number"
                        value={form.phone_number || ''}
                        onChange={handleInputChange}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-right text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                        disabled={readOnly}
                        placeholder="أدخل رقم الهاتف"
                      />
                    </FormField>
                  </div>

                  <div>
                    <FormField label="الجنسية" icon={<Icons.globe className="w-4 h-4" />}>
                      <Select
                        isDisabled={readOnly}
                        isClearable
                        options={nationalityOptions}
                        value={nationalityOptions.find((opt) => opt.value === (form.nationality || '')) || null}
                        onChange={(option) => handleSelectChange('nationality', option as { value: string; label: string } | null)}
                        placeholder="ابحث عن الجنسية"
                        noOptionsMessage={() => 'لا توجد نتائج'}
                        styles={selectStyles}
                        menuPortalTarget={document.body}
                        menuPosition="fixed"
                      />
                    </FormField>
                  </div>

                  {isGovernmentiNationality(form.nationality) && (
                    <>
                      <div>
                        <FormField label="رقم مادة الجنسية" icon={<Icons.hash className="w-4 h-4" />}>
                          <select
                            name="nationalityArticleNumber"
                            value={form.nationalityArticleNumber || ''}
                            onChange={handleInputChange}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                            disabled={readOnly}
                          >
                            <option value="">اختياري</option>
                            {nationalityArticleOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </FormField>
                      </div>
                      <div>
                        <FormField label="تاريخ إصدار الجنسية" icon={<Icons.calendar className="w-4 h-4" />}>
                          <input
                            type="date"
                            name="nationalityIssueDate"
                            value={form.nationalityIssueDate || ''}
                            onChange={handleInputChange}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-right text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                            disabled={readOnly}
                          />
                        </FormField>
                      </div>
                    </>
                  )}

                  <div>
                    <FormField label="النوع" icon={<Icons.id className="w-4 h-4" />}>
                      <select
                        name="gender"
                        value={form.gender || ''}
                        onChange={handleInputChange}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                        disabled={readOnly}
                      >
                        <option value="">غير محدد</option>
                        <option value="ذكر">ذكر</option>
                        <option value="أنثى">أنثى</option>
                      </select>
                    </FormField>
                  </div>

                  <div>
                    <FormField label="الحالة الاجتماعية" icon={<Icons.clipboard className="w-4 h-4" />}>
                      <select
                        name="maritalStatus"
                        value={form.maritalStatus || ''}
                        onChange={handleInputChange}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                        disabled={readOnly}
                      >
                        <option value="">غير محدد</option>
                        <option value="متزوج">متزوج</option>
                        <option value="أعزب">أعزب</option>
                        <option value="أخرى">أخرى</option>
                      </select>
                    </FormField>
                  </div>

                  {(form.maritalStatus === 'أخرى' || form.maritalStatus === 'اخرى') && (
                    <div>
                      <FormField label="ملاحظة الحالة الاجتماعية" icon={<Icons.clipboard className="w-4 h-4" />}>
                        <input
                          type="text"
                          name="maritalStatusNote"
                          value={form.maritalStatusNote || ''}
                          onChange={handleInputChange}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                          disabled={readOnly}
                          placeholder="اكتب الملاحظة المطلوبة"
                        />
                      </FormField>
                    </div>
                  )}

                  <div>
                    <FormField
                      label="تاريخ الميلاد"
                      icon={<Icons.calendar className="w-4 h-4" />}
                    >
                      <input
                        type="date"
                        name="birthDate"
                        value={form.birthDate || ''}
                        onChange={handleInputChange}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-right text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                        disabled={readOnly}
                      />
                    </FormField>
                  </div>

                  <div>
                    <FormField
                      label="تاريخ التعيين"
                      icon={<Icons.calendar className="w-4 h-4" />}
                    >
                      <input
                        type="date"
                        name="hiringDate"
                        value={form.hiringDate || ''}
                        onChange={handleInputChange}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-right text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                        disabled={readOnly}
                      />
                    </FormField>
                  </div>

                  <div>
                    <FormField label="رقم قرار التعيين" icon={<Icons.clipboard className="w-4 h-4" />}>
                      <input
                        type="text"
                        name="appointmentDecisionNumber"
                        value={form.appointmentDecisionNumber || ''}
                        onChange={handleInputChange}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                        disabled={readOnly}
                        placeholder="أدخل رقم قرار التعيين"
                      />
                    </FormField>
                  </div>

                  <div>
                    <FormField label="تاريخ قرار التعيين" icon={<Icons.calendar className="w-4 h-4" />}>
                      <input
                        type="date"
                        name="appointmentDecisionDate"
                        value={form.appointmentDecisionDate || ''}
                        onChange={handleInputChange}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-right text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                        disabled={readOnly}
                      />
                    </FormField>
                  </div>
                </div>
              </SectionCard>

              {/* Education Section */}
              <SectionCard
                title="المؤهل الدراسي"
                description="الشهادة والتخصص"
                icon={<Icons.check className="w-6 h-6" />}
                gradient="from-amber-50 to-amber-100"
                isInactive={isInactiveContext}
              >
                <div className="space-y-4">
                  <SwitchField
                    name="hasEducationCertificate"
                    checked={!!form.hasEducationCertificate}
                    onChange={handleCheckboxChange}
                    label={form.hasEducationCertificate ? 'لديه شهادة دراسية' : 'لا يمتلك شهادة دراسية'}
                    description="تحديد ما إذا كان الموظف يحمل شهادة دراسية"
                    disabled={readOnly}
                  />

                  {form.hasEducationCertificate ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        label="نوع الشهادة الدراسية"
                        icon={<Icons.check className="w-4 h-4" />}
                      >
                        <select
                          name="educationCertificateType"
                          value={form.educationCertificateType || ''}
                          onChange={handleInputChange}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                          disabled={readOnly}
                        >
                          <option value="">اختر نوع الشهادة</option>
                          {educationCertificateOptions
                            .filter((option) => option !== 'بدون شهادة')
                            .map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                        </select>
                      </FormField>
                      <FormField
                        label="اسم المؤهل الدراسي (التخصص)"
                        icon={<Icons.briefcase className="w-4 h-4" />}
                      >
                        <input
                          type="text"
                          name="educationSpecialization"
                          value={form.educationSpecialization || ''}
                          onChange={handleInputChange}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                          disabled={readOnly}
                          placeholder="أدخل التخصص"
                        />
                      </FormField>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">
                      ملاحظة: عند إيقاف الخيار يتم حفظ نوع الشهادة تلقائياً كـ "بدون شهادة".
                    </p>
                  )}
                </div>
              </SectionCard>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Equipment and Facilities Section */}
                <SectionCard
                  title="المعدات والمرافق"
                  description="السلاح والمواقف"
                  icon={<Icons.shield className="w-6 h-6" />}
                  gradient="from-purple-50 to-purple-100"
                  isInactive={isInactiveContext}
                >
                  <div className="space-y-4">
                    {canHaveWeapon && (
                      <SwitchField
                        name="hasWeapon"
                        checked={!!form.hasWeapon}
                        onChange={handleCheckboxChange}
                        label="هل لديه سلاح؟"
                        description="تفعيل هذا الحقل للموظفين من فئة الضباط وضباط الصف"
                        disabled={readOnly}
                      />
                    )}

                    <SwitchField
                      name="hasParking"
                      checked={!!form.hasParking}
                      onChange={handleCheckboxChange}
                      label="هل لديه موقف سيارات؟"
                      description="تحديد ما إذا كان للموظف موقف مخصص في الجهة"
                      disabled={readOnly}
                    />

                    {canHaveWeapon && form.hasWeapon && (
                      <div className="bg-gray-50 rounded-xl p-4">
                        <FormField label="مرفقات السلاح" icon={<Icons.clipboard className="w-4 h-4" />}>
                          <textarea
                            name="weaponAttachments"
                            value={form.weaponAttachments || ''}
                            onChange={handleInputChange}
                            rows={3}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 resize-none"
                            disabled={readOnly}
                            placeholder="أدخل تفاصيل مرفقات السلاح"
                          />
                        </FormField>
                      </div>
                    )}

                    {form.hasParking && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 rounded-xl p-4">
                        <FormField label="مكان موقف السيارات" icon={<Icons.car className="w-4 h-4" />}>
                          <select
                            name="parkingLocation"
                            value={form.parkingLocation || ''}
                            onChange={handleInputChange}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                            disabled={readOnly}
                          >
                            <option value="">اختر مكان الموقف</option>
                            <option value="المواقف الداخلية">المواقف الداخلية</option>
                            <option value="المواقف الخارجية">المواقف الخارجية</option>
                          </select>
                        </FormField>

                        <FormField label="رقم موقف السيارات" icon={<Icons.hash className="w-4 h-4" />}>
                          <input
                            type="text"
                            name="parkingNumber"
                            value={form.parkingNumber || ''}
                            onChange={handleInputChange}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 transition focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                            disabled={readOnly}
                            placeholder="أدخل رقم الموقف"
                          />
                        </FormField>
                      </div>
                    )}
                  </div>
                </SectionCard>

                {/* Shift Settings Section */}
                {!hideShifts && form.category !== 'مدنيين' && (
                  <SectionCard
                    title="إعدادات الخفارات"
                    description="حالة إدراج الموظف في الخفارات"
                    icon={<Icons.settings className="w-6 h-6" />}
                    gradient="from-orange-50 to-orange-100"
                    isInactive={isInactiveContext}
                  >
                    <div className="space-y-4">
                      <SwitchField
                        name="includeInShifts"
                        checked={includeInShiftsActive}
                        onChange={handleCheckboxChange}
                        label="يدرج في الخفارات"
                        description="تحديد ما إذا كان الموظف مدرج في جدول الخفارات والدوريات"
                        disabled={readOnly}
                      />

                      {!includeInShiftsActive && (
                        <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
                          <FormField label="ملاحظات الخفارات" icon={<Icons.settings className="w-4 h-4" />}>
                            <textarea
                              name="shiftNotes"
                              value={form.shiftNotes || ''}
                              onChange={handleInputChange}
                              rows={3}
                              className="w-full px-4 py-3 border-2 border-yellow-300 rounded-xl focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 bg-white transition-all duration-200 resize-none"
                              disabled={readOnly}
                              placeholder="أدخل ملاحظات خاصة بالاستثناء من الخفارات"
                            />
                          </FormField>
                        </div>
                      )}
                    </div>
                  </SectionCard>
                )}
              </div>
            </form>
          )}
        </div>

        <ModalFooter
          mode={localMode}
          loading={loading}
          onClose={onClose}
          onSubmit={handleSubmit}
          error={error}
          warnings={warnings}
          confirming={confirmSubmit && warnings.length > 0}
        />

      </div>
    </div>,
    portalRoot
  );
};

export default EmployeeModal;
