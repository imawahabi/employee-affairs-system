import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Settings as SettingsIcon,
  Building,
  Award,
  Save,
  Loader2,
  Bell,
  Shield,
  Database,
  Plus,
  Edit,
  Trash2,
  AlertTriangle,
  ClipboardList,
  Globe,
  Clock,
  Search,
  Users,
  UserX,
  Monitor,
  HardDrive,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  Briefcase,
  Layers
} from 'lucide-react';
import { fetchDepartments, createDepartment, updateDepartment, deleteDepartment, fetchRanks, createRank, updateRank, deleteRank, fetchSettings, updateSettings, createBackup, fetchNationalities, createNationality, updateNationality, deleteNationality, fetchJobTitles, createJobTitle, updateJobTitle, deleteJobTitle, fetchSections, createSection, updateSection, deleteSection, fetchEmployees } from '../api';
import { getRankOrder } from '../utils/rankOrder';
import { formatEmployeeDisplayName } from '../utils/employeeDisplay';
import { normalizeOrganizationName } from '../utils/organization';
import { getStatisticsEmployeeBuckets } from '../utils/employeeStatistics';
import { Department, Rank, Nationality, JobTitleEntity, Section, Employee } from '../types';
import { toast } from 'react-hot-toast';
import { useSystem } from '../contexts/SystemContext';
import DepartmentModal from './DepartmentModal';
import RankModal from './RankModal';
import NationalityModal from './NationalityModal';
import JobTitleModal from './JobTitleModal';
import SectionModal from './SectionModal';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import LoadingPage from './LoadingPage';

interface AppSettings {
  systemName: string;
  departmentName: string;
  companyName: string;
  companyPhone: string;
  companyEmail: string;
  companyAddress: string;
  alertOverdueDays: number;
  alertUpcomingDays: number;
  extensionReminderDays: string;
  extensionCriticalDays: number;
  emailNotifications: boolean;
  hideShifts: boolean;
  hideLicenses: boolean;
  hideParking: boolean;
  hideProfessionalExtensions: boolean;
  excludeWeekendShifts: boolean;
  restrictToDepartment: boolean;
  restrictedDepartmentName: string;
  autoBackup: boolean;
  backupFrequency: string;
}

interface SettingsProps {
  mode?: 'general' | 'departments' | 'ranks' | 'nationalities' | 'job-titles';
}

const SETTINGS_SAVE_PASSWORD = (import.meta.env.VITE_SETTINGS_SAVE_PASSWORD || 'darin123').trim();

// Enhanced Form Section Component
const FormSection = React.memo(({ title, description, children, icon: Icon, badge, actions }: {
  title: string;
  description?: string;
  children: React.ReactNode;
  icon?: React.ComponentType<any>;
  badge?: string;
  actions?: React.ReactNode;
}) => (
  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-all duration-200">
    <div className="px-8 py-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {Icon && (
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <Icon className="w-6 h-6 text-white" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-bold text-gray-900">{title}</h3>
              {badge && (
                <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">
                  {badge}
                </span>
              )}
            </div>
            {description && (
              <p className="mt-1 text-sm text-gray-500">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
    <div className="p-8">
      {children}
    </div>
  </div>
))

// Enhanced Input Component
const FormInput = React.memo(({ label, value, onChange, placeholder, type = 'text', required = false, error, icon: Icon, disabled = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  error?: string;
  icon?: React.ComponentType<any>;
  disabled?: boolean;
}) => (
  <div className="space-y-2">
    <label className="block text-sm font-semibold text-gray-700">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    <div className="relative">
      {Icon && (
        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
          <Icon className="h-5 w-5 text-gray-400" />
        </div>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full px-4 py-3 ${Icon ? 'pr-12' : ''} border-2 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 ${
          error ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white hover:border-gray-300'
        } ${disabled ? 'bg-gray-50 cursor-not-allowed' : ''}`}
      />
    </div>
    {error && (
      <div className="flex items-center gap-2 text-sm text-red-600">
        <AlertTriangle className="w-4 h-4" />
        {error}
      </div>
    )}
  </div>
));

// Enhanced Toggle Switch Component
const ToggleSwitch = React.memo(({ label, description, checked, onChange, disabled = false }: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) => (
  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
    <div className="flex-1">
      <h4 className="text-sm font-semibold text-gray-900">{label}</h4>
      {description && <p className="text-sm text-gray-600 mt-1">{description}</p>}
    </div>
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="sr-only peer"
      />
      <div className={`relative w-12 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}></div>
    </label>
  </div>
));

const ModuleToggleCard = React.memo(({ label, description, checked, onChange, icon: Icon }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon: React.ComponentType<any>;
}) => (
  <div
    className={`relative overflow-hidden rounded-2xl border p-5 transition-all ${
      checked ? 'border-red-200 bg-red-50/60' : 'border-emerald-200 bg-white shadow-sm hover:shadow-md'
    }`}
  >
    <div className={`absolute inset-x-0 top-0 h-1 ${checked ? 'bg-red-300' : 'bg-emerald-300'}`} />
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${checked ? 'bg-red-100 text-red-600' : 'bg-emerald-500 text-white'} shadow-sm`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-gray-900">{label}</h4>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${checked ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
              {checked ? 'مخفي' : 'ظاهر'}
            </span>
          </div>
          <p className="text-xs text-gray-600 mt-1">{description}</p>
        </div>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="relative w-12 h-6 rounded-full bg-emerald-500 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-200 peer-checked:bg-red-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
      </label>
    </div>
  </div>
));

const normalizeNationality = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
const getCountryCode = (value: string) => {
  const matches = value.match(/[a-zA-Z]{2}/g);
  return matches && matches.length ? matches[matches.length - 1].toUpperCase() : '';
};
const codeToFlag = (code: string) => {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(127397 + code.charCodeAt(0), 127397 + code.charCodeAt(1));
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
const nationalityFlagMap: Record<string, string> = {
  'الكويت': '🇰🇼',
  'كويتي': '🇰🇼',
  'كويتية': '🇰🇼',
  'دولة الكويت': '🇰🇼',
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
  'الفلبين': '🇵🇭',
  'فلبيني': '🇵🇭',
  'فلبينية': '🇵🇭'
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
const nationalityNameByCode: Record<string, string> = {
  EG: 'مصر',
  SA: 'السعودية',
  KW: 'الكويت',
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
const getNationalityFlagEmoji = (nationality?: string | null) => {
  if (!nationality) return '';
  const labelNormalized = normalizeNationality(getNationalityLabel(nationality));
  if (nationalityFlagMap[labelNormalized]) return nationalityFlagMap[labelNormalized];
  const normalized = normalizeNationality(nationality);
  if (nationalityFlagMap[normalized]) return nationalityFlagMap[normalized];
  if (nationalityFlagMapEnglish[normalized]) return nationalityFlagMapEnglish[normalized];
  const parts = normalized.split(/[\s/|-]+/).filter(Boolean);
  for (const part of parts) {
    if (nationalityFlagMap[part]) return nationalityFlagMap[part];
    if (nationalityFlagMapEnglish[part]) return nationalityFlagMapEnglish[part];
  }
  const code = getCountryCode(nationality);
  return code ? codeToFlag(code) : '';
};
const getNationalityFlagData = (nationality?: string | null) => {
  const label = getNationalityLabel(nationality);
  const flagEmoji = getNationalityFlagEmoji(nationality);
  const code = flagEmoji ? flagEmojiToCode(flagEmoji) : getCountryCode(nationality || '');
  const flagUrl = code ? getFlagImageUrl(code) : '';
  return { flagEmoji, flagUrl, label: label || (nationality || '').trim() };
};
type OrgNodeType = 'root' | 'department' | 'section';
interface OrgNode {
  id: string;
  name: string;
  type: OrgNodeType;
  children?: OrgNode[];
}

const OrgTreeNode: React.FC<{ node: OrgNode; level?: number }> = ({ node, level = 0 }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const isRoot = node.type === 'root';
  const isDepartment = node.type === 'department';
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="relative">
      <div className="flex items-center gap-3">
        {hasChildren && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-6 h-6 flex items-center justify-center rounded-full bg-blue-100 hover:bg-blue-200 transition-colors"
          >
            <ChevronDown className={`w-4 h-4 text-blue-600 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
          </button>
        )}
        {!hasChildren && <div className="w-6" />}
        <div className={`flex items-center gap-3 rounded-xl border-2 px-4 py-2.5 shadow-sm transition-all hover:shadow-md ${
 isRoot
   ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white border-blue-600'
   : isDepartment
     ? 'bg-white text-gray-900 border-blue-300 hover:border-blue-400'
     : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-gray-300'
}`}>
 <div className={`w-2.5 h-2.5 rounded-full ${isRoot ? 'bg-white' : isDepartment ? 'bg-blue-500' : 'bg-gray-400'}`}></div>
 <span className="font-semibold text-sm">{node.name}</span>
</div>
      </div>

      {hasChildren && isExpanded && (
        <div className="relative mt-3 pr-6">
          <div className="absolute right-2 top-0 h-full w-0.5 bg-blue-200"></div>
          <div className="space-y-2">
            {node.children!.map((child, index) => (
              <div key={child.id || `${child.type}-${child.name}-${index}`} className="relative">
                {index < node.children!.length - 1 && (
                  <div className="absolute right-2 top-4 h-full w-0.5 bg-blue-200"></div>
                )}
                <div className="absolute right-2 top-4 h-px w-4 bg-blue-200"></div>
                <OrgTreeNode node={child} level={level + 1} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const Settings: React.FC<SettingsProps> = ({ mode = 'general' }) => {
  const {
    updateSystemName,
    updateDepartmentName,
    updateCompanyName,
    updateHideShifts,
    updateHideLicenses,
    updateHideParking,
    updateHideProfessionalExtensions,
    updateExcludeWeekendShifts,
    updateRestrictToDepartment,
    updateRestrictedDepartmentName
  } = useSystem();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [nationalities, setNationalities] = useState<Nationality[]>([]);
  const [jobTitles, setJobTitles] = useState<JobTitleEntity[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Modal states
  const [departmentModal, setDepartmentModal] = useState<{
    isOpen: boolean;
    department: Department | null;
    mode: 'create' | 'edit';
  }>({
    isOpen: false,
    department: null,
    mode: 'create'
  });

  const [rankModal, setRankModal] = useState<{
    isOpen: boolean;
    rank: Rank | null;
    mode: 'create' | 'edit';
  }>({
    isOpen: false,
    rank: null,
    mode: 'create'
  });

  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  const [nationalityModal, setNationalityModal] = useState<{ isOpen: boolean; nationality: Nationality | null }>({
    isOpen: false,
    nationality: null
  });
  const [jobTitleModal, setJobTitleModal] = useState<{ isOpen: boolean; jobTitle: JobTitleEntity | null }>({
    isOpen: false,
    jobTitle: null
  });
  const [sectionModal, setSectionModal] = useState<{ isOpen: boolean; section: Section | null; departmentId?: string | null }>({
    isOpen: false,
    section: null,
    departmentId: null
  });
  const [deleteTarget, setDeleteTarget] = useState<{
    isOpen: boolean;
    type: 'department' | 'rank' | 'nationality' | 'jobTitle' | 'section' | null;
    id: string | null;
    name: string;
  }>({
    isOpen: false,
    type: null,
    id: null,
    name: ''
  });

  // Settings state with default values
  const [settings, setSettings] = useState<AppSettings>({
    systemName: 'نظام شؤون الموظفين',
    departmentName: 'إدارة الخدمات المالية والإدارية والصيانة',
    companyName: 'الإدارة العامة - مكتب الوكيل',
    companyPhone: '+965-65500470',
    companyEmail: 'admin@moi.gov.kw',
    companyAddress: 'المقر الرئيسي',
    alertOverdueDays: 5,
    alertUpcomingDays: 5,
    extensionReminderDays: '30',
    extensionCriticalDays: 30,
    emailNotifications: true,
    hideShifts: false,
    hideLicenses: false,
    hideParking: false,
    hideProfessionalExtensions: false,
    excludeWeekendShifts: true,
    restrictToDepartment: false,
    restrictedDepartmentName: '',
    autoBackup: false,
    backupFrequency: 'daily',
  });

  // Validation state
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [showSettingsPasswordModal, setShowSettingsPasswordModal] = useState(false);
  const [settingsPassword, setSettingsPassword] = useState('');
  const [showOrgTree, setShowOrgTree] = useState(false);
  const [departmentSearch, setDepartmentSearch] = useState('');
  const [showUnassignedEmployees, setShowUnassignedEmployees] = useState(false);
  const [unassignedSearch, setUnassignedSearch] = useState('');

  const statisticsEmployees = useMemo(
    () => getStatisticsEmployeeBuckets(employees),
    [employees]
  );
  const employeesIncludedInStatistics = statisticsEmployees.included;
  const excludedFromStatisticsCount = statisticsEmployees.excluded.length;

  const selectedDepartment = useMemo(
    () => departments.find((dep) => dep.id === selectedDepartmentId) || null,
    [departments, selectedDepartmentId]
  );

  const selectedSections = useMemo(
    () => sections.filter((section) => section.departmentId === selectedDepartmentId),
    [sections, selectedDepartmentId]
  );

  const filteredDepartments = useMemo(() => {
    const query = departmentSearch.trim().toLowerCase();
    if (!query) return departments;
    const normalizedQuery = normalizeOrganizationName(query);
    return departments.filter((dep) => {
      const nameValue = (dep.name || '').toLowerCase();
      const normalizedName = normalizeOrganizationName(dep.name || '').toLowerCase();
      return nameValue.includes(query) || (normalizedQuery && normalizedName.includes(normalizedQuery));
    });
  }, [departments, departmentSearch]);

  const departmentEmployeeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    employeesIncludedInStatistics.forEach((employee) => {
      const key = normalizeOrganizationName(employee.department);
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [employeesIncludedInStatistics]);

  const departmentKeys = useMemo(() => {
    return new Set(
      departments
        .map((dep) => normalizeOrganizationName(dep.name))
        .filter(Boolean)
    );
  }, [departments]);

  const unassignedEmployees = useMemo(() => {
    if (!employeesIncludedInStatistics.length) return [];
    if (departmentKeys.size === 0) return employeesIncludedInStatistics;
    return employeesIncludedInStatistics.filter((employee) => {
      const key = normalizeOrganizationName(employee.department);
      return !key || !departmentKeys.has(key);
    });
  }, [employeesIncludedInStatistics, departmentKeys]);

  const filteredUnassignedEmployees = useMemo(() => {
    const query = unassignedSearch.trim().toLowerCase();
    if (!query) return unassignedEmployees;
    return unassignedEmployees.filter((employee) => {
      const nameValue = `${employee.rank || ''} ${employee.name || ''}`.toLowerCase();
      const fileValue = `${employee.fileNumber || employee.militaryNumber || ''}`.toLowerCase();
      const departmentValue = (employee.department || '').toLowerCase();
      return (
        nameValue.includes(query) ||
        fileValue.includes(query) ||
        departmentValue.includes(query)
      );
    });
  }, [unassignedEmployees, unassignedSearch]);

  const assignedEmployeesCount = useMemo(() => {
    if (!employeesIncludedInStatistics.length || departmentKeys.size === 0) return 0;
    return employeesIncludedInStatistics.filter((employee) => {
      const key = normalizeOrganizationName(employee.department);
      return key && departmentKeys.has(key);
    }).length;
  }, [employeesIncludedInStatistics, departmentKeys]);

  const unassignedEmployeesCount = useMemo(() => {
    if (!employeesIncludedInStatistics.length) return 0;
    return employeesIncludedInStatistics.length - assignedEmployeesCount;
  }, [employeesIncludedInStatistics, assignedEmployeesCount]);

  const selectedDepartmentEmployeeCount = useMemo(() => {
    if (!selectedDepartment) return 0;
    return departmentEmployeeCounts[normalizeOrganizationName(selectedDepartment.name)] || 0;
  }, [selectedDepartment, departmentEmployeeCounts]);

  const selectedDepartmentSectionCount = selectedSections.length;

  const sectionEmployeeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    employeesIncludedInStatistics.forEach((employee) => {
      const departmentKey = normalizeOrganizationName(employee.department);
      const sectionKey = normalizeOrganizationName(employee.section || '');
      if (!departmentKey || !sectionKey) return;
      const key = `${departmentKey}__${sectionKey}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [employeesIncludedInStatistics]);

  const selectedDepartmentKey = useMemo(
    () => (selectedDepartment ? normalizeOrganizationName(selectedDepartment.name) : ''),
    [selectedDepartment]
  );

  const orgTree = useMemo<OrgNode | null>(() => {
    if (departments.length === 0) return null;

    const normalizeName = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();
    const includesAny = (name: string | null | undefined, keywords: string[]) =>
      keywords.some((keyword) => normalizeName(name).includes(keyword));

    const mainOffice = departments.find((dep) =>
      includesAny(dep.name, ['المدير العام', 'المدير العام', 'المدير العام'])
    );
    const officeAffairs = departments.find((dep) =>
      includesAny(dep.name, ['م.م.ع. شئون المكتب', 'م.م.ع. شؤون المكتب', 'شئون المكتب', 'شؤون المكتب'])
    );
    const technicalAffairs = departments.find((dep) =>
      includesAny(dep.name, ['م.م.ع. شئون الفنية', 'م.م.ع. شؤون الفنية', 'شئون الفنية', 'شؤون الفنية'])
    );

    const sectionsByDepartment = sections.reduce<Record<string, Section[]>>((acc, section) => {
      if (!acc[section.departmentId]) acc[section.departmentId] = [];
      acc[section.departmentId].push(section);
      return acc;
    }, {});

    const buildSectionNodes = (departmentId: string) =>
      (sectionsByDepartment[departmentId] || []).map((section) => ({
        id: section.id,
        name: section.name,
        type: 'section' as const
      }));

    const buildDepartmentNode = (dep: Department, extraChildren: OrgNode[] = []): OrgNode => {
      const sectionNodes = buildSectionNodes(dep.id);
      return {
        id: dep.id,
        name: dep.name,
        type: 'department',
        children: [...extraChildren, ...sectionNodes]
      };
    };

    const usedDepartments = new Set<string>();
    const rootChildren: OrgNode[] = [];

    if (mainOffice) {
      usedDepartments.add(mainOffice.id);
      const subDepartments: OrgNode[] = [];
      if (officeAffairs) {
        usedDepartments.add(officeAffairs.id);
        subDepartments.push(buildDepartmentNode(officeAffairs));
      }
      if (technicalAffairs) {
        usedDepartments.add(technicalAffairs.id);
        subDepartments.push(buildDepartmentNode(technicalAffairs));
      }

      rootChildren.push(buildDepartmentNode(mainOffice, subDepartments));
    }

    departments.forEach((dep) => {
      if (!usedDepartments.has(dep.id)) {
        rootChildren.push(buildDepartmentNode(dep));
      }
    });

    return {
      id: 'org-root',
      name: 'سعادة وكيل الهيئة العامة للشؤون الإدارية والموارد البشرية',
      type: 'root',
      children: rootChildren
    };
  }, [departments, sections]);

  // Load data function
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [departmentsData, ranksData, settingsData, nationalitiesData, jobTitlesData, sectionsData, employeesData] = await Promise.all([
        fetchDepartments(),
        fetchRanks(),
        fetchSettings(),
        fetchNationalities(),
        fetchJobTitles(),
        fetchSections(),
        fetchEmployees()
      ]);

      setDepartments(departmentsData);
      setRanks(ranksData);
      setNationalities(nationalitiesData);
      setJobTitles(jobTitlesData);
      setSections(sectionsData);
      setEmployees(employeesData);

      if (settingsData) {
        setSettings({
          systemName: settingsData.system_name?.value || 'نظام شؤون الموظفين',
          departmentName: settingsData.department_name?.value || 'إدارة الخدمات المالية والإدارية والصيانة',
          companyName: settingsData.company_name?.value || 'الإدارة العامة - مكتب الوكيل',
          companyPhone: settingsData.company_phone?.value || '+965-65500470',
          companyEmail: settingsData.company_email?.value || 'admin@moi.gov.kw',
          companyAddress: settingsData.company_address?.value || 'المقر الرئيسي',
          alertOverdueDays: parseInt(settingsData.alert_overdue_days?.value || '5'),
          alertUpcomingDays: parseInt(settingsData.alert_upcoming_days?.value || '5'),
          extensionReminderDays: settingsData.extension_reminder_days?.value || '30',
          extensionCriticalDays: parseInt(settingsData.extension_critical_days?.value || '30'),
          emailNotifications: settingsData.email_notifications?.value === 'true',
          hideShifts: settingsData.hide_shifts?.value === 'true',
          hideLicenses: settingsData.hide_licenses?.value === 'true',
          hideParking: settingsData.hide_parking?.value === 'true',
          hideProfessionalExtensions: settingsData.hide_professional_extensions?.value === 'true',
          excludeWeekendShifts: settingsData.exclude_weekend_shifts?.value !== 'false',
          restrictToDepartment: settingsData.restrict_to_department?.value === 'true',
          restrictedDepartmentName: settingsData.restricted_department_name?.value || '',
          autoBackup: settingsData.auto_backup?.value === 'true',
          backupFrequency: settingsData.backup_frequency?.value || 'daily',
        });
      }
    } catch (err) {
      console.error('Error loading data:', err);
      setError('فشل في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (departments.length === 0) {
      setSelectedDepartmentId(null);
      return;
    }
    if (!selectedDepartmentId || !departments.some((dep) => dep.id === selectedDepartmentId)) {
      setSelectedDepartmentId(departments[0].id);
    }
  }, [departments, selectedDepartmentId]);

  // Handle setting changes with validation
  const handleSettingChange = (key: keyof AppSettings, value: any) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));

    setTimeout(() => {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[key];

        const error = validateSetting(key, value);
        if (error) {
          newErrors[key] = error;
        }

        return newErrors;
      });
    }, 0);
  };

  // Validation function
  const validateSetting = (key: keyof AppSettings, value: any): string | null => {
    switch (key) {
      case 'systemName':
      case 'departmentName':
      case 'companyName':
        if (!value || value.trim().length < 2) {
          return 'الاسم يجب أن يكون على الأقل حرفين';
        }
        break;
      case 'companyEmail':
        if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          return 'البريد الإلكتروني غير صحيح';
        }
        break;
      case 'companyPhone':
        if (value && !/^[\+]?[0-9\-\s\(\)]+$/.test(value)) {
          return 'رقم الهاتف غير صحيح';
        }
        break;
      case 'extensionReminderDays': {
        const parsed = String(value)
          .split(/[,\\s]+/)
          .map((val) => parseInt(val, 10))
          .filter((num) => Number.isFinite(num) && num > 0);
        if (parsed.length === 0) {
          return 'أدخل يومًا واحدًا على الأقل للتنبيه';
        }
        break;
      }
      case 'extensionCriticalDays':
        if (!Number.isFinite(value) || value < 1) {
          return 'عدد الأيام يجب أن يكون رقمًا موجبًا';
        }
        break;
    }
    return null;
  };

  // Create backup
  const handleCreateBackup = async () => {
    try {
      setCreating(true);

      const result = await createBackup();
      toast.success(`تم إنشاء النسخة الاحتياطية بنجاح: ${result.filename}`);
    } catch (error) {
      console.error('Error creating backup:', error);
      toast.error('فشل في إنشاء النسخة الاحتياطية');
    } finally {
      setCreating(false);
    }
  };

  const validateAllSettingsBeforeSave = (): boolean => {
    // Check for validation errors
    if (Object.keys(validationErrors).length > 0) {
      toast.error('يرجى تصحيح الأخطاء قبل الحفظ');
      return false;
    }

    // Validate all settings before saving
    const errors: Record<string, string> = {};
    Object.keys(settings).forEach((key) => {
      const error = validateSetting(key as keyof AppSettings, settings[key as keyof AppSettings]);
      if (error) {
        errors[key] = error;
      }
    });

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      toast.error('يرجى تصحيح الأخطاء قبل الحفظ');
      return false;
    }

    return true;
  };

  const closeSettingsPasswordModal = () => {
    if (saving) return;
    setShowSettingsPasswordModal(false);
    setSettingsPassword('');
  };

  const handleSaveSettings = () => {
    if (!validateAllSettingsBeforeSave()) return;
    setSettingsPassword('');
    setShowSettingsPasswordModal(true);
  };

  const handleConfirmSaveSettings = async () => {
    if (!settingsPassword) {
      toast.error('يرجى إدخال كلمة المرور أولاً');
      return;
    }

    if (settingsPassword.trim() !== SETTINGS_SAVE_PASSWORD) {
      toast.error('كلمة المرور غير صحيحة. لا توجد صلاحيات كافية لحفظ الإعدادات.');
      return;
    }

    try {
      setSaving(true);

      // Convert settings to the format expected by the API
      const settingsToSave = {
        system_name: settings.systemName,
        department_name: settings.departmentName,
        company_name: settings.companyName,
        company_phone: settings.companyPhone,
        company_email: settings.companyEmail,
        company_address: settings.companyAddress,
        alert_overdue_days: settings.alertOverdueDays.toString(),
        alert_upcoming_days: settings.alertUpcomingDays.toString(),
        extension_reminder_days: settings.extensionReminderDays.toString(),
        extension_critical_days: settings.extensionCriticalDays.toString(),
        email_notifications: settings.emailNotifications.toString(),
        hide_shifts: settings.hideShifts.toString(),
        hide_licenses: settings.hideLicenses.toString(),
        hide_parking: settings.hideParking.toString(),
        hide_professional_extensions: settings.hideProfessionalExtensions.toString(),
        exclude_weekend_shifts: settings.excludeWeekendShifts.toString(),
        restrict_to_department: settings.restrictToDepartment.toString(),
        restricted_department_name: settings.restrictedDepartmentName,
        auto_backup: settings.autoBackup.toString(),
        backup_frequency: settings.backupFrequency,
      };

      await updateSettings(settingsToSave, settingsPassword);

      // Update system name in context
      updateSystemName(settings.systemName);
      updateDepartmentName(settings.departmentName);
      updateCompanyName(settings.companyName);
      updateHideShifts(settings.hideShifts);
      updateHideLicenses(settings.hideLicenses);
      updateHideParking(settings.hideParking);
      updateHideProfessionalExtensions(settings.hideProfessionalExtensions);
      updateExcludeWeekendShifts(settings.excludeWeekendShifts);
      updateRestrictToDepartment(settings.restrictToDepartment);
      updateRestrictedDepartmentName(settings.restrictedDepartmentName);

      toast.success('تم حفظ الإعدادات بنجاح');
      setShowSettingsPasswordModal(false);
      setSettingsPassword('');
    } catch (error) {
      console.error('Error saving settings:', error);
      const message = error instanceof Error && error.message
        ? error.message
        : 'فشل في حفظ الإعدادات';
      toast.error(message);
      setSettingsPassword('');
    } finally {
      setSaving(false);
    }
  };

  // Department modal handlers
  const openDepartmentModal = (department: Department | null = null) => {
    setDepartmentModal({
      isOpen: true,
      department,
      mode: department ? 'edit' : 'create'
    });
  };

  const closeDepartmentModal = () => {
    setDepartmentModal({
      isOpen: false,
      department: null,
      mode: 'create'
    });
  };

  const handleSaveDepartment = async (departmentData: Omit<Department, 'id'> | Department) => {
    try {
      if ('id' in departmentData) {
        // Update existing department
        const nameToUse = departmentData.name.trim();
        const updated = await updateDepartment(departmentData.id, nameToUse);
        const updatedName = (updated && typeof updated === 'object' && 'name' in updated && typeof updated.name === 'string' && updated.name.trim())
          ? updated.name
          : nameToUse;
        setDepartments(prev => prev.map(dep =>
          dep.id === departmentData.id ? { ...dep, name: updatedName } : dep
        ));
        toast.success('تم تحديث الإدارة بنجاح');
      } else {
        // Create new department
        const created = await createDepartment(departmentData.name);
        setDepartments(prev => [...prev, created]);
        setSelectedDepartmentId(created.id);
        toast.success('تم إضافة الإدارة بنجاح');
      }
    } catch (error) {
      console.error('Error saving department:', error);
      toast.error('فشل في حفظ الإدارة');
      throw error;
    }
  };

  const handleDeleteDepartment = (id: string, name: string) => {
    openDeleteModal('department', id, name);
  };

  // Rank modal handlers
  const openRankModal = (rank: Rank | null = null) => {
    setRankModal({
      isOpen: true,
      rank,
      mode: rank ? 'edit' : 'create'
    });
  };

  const closeRankModal = () => {
    setRankModal({
      isOpen: false,
      rank: null,
      mode: 'create'
    });
  };

  const handleSaveRank = async (rankData: Omit<Rank, 'id'> | Rank) => {
    try {
      const derivedOrder = getRankOrder(rankData.name, rankData.category);
      const orderValue = derivedOrder === Number.MAX_SAFE_INTEGER ? 999 : derivedOrder;
      if ('id' in rankData) {
        const payload = {
          name: rankData.name,
          category: rankData.category,
          order: orderValue
        };
        await updateRank(rankData.id, payload);
        setRanks(prev => prev.map(rank => rank.id === rankData.id ? { ...rank, ...payload } : rank));
        toast.success('تم تحديث المسمى الوظيفي بنجاح');
      } else {
        const payload = {
          name: rankData.name,
          category: rankData.category,
          order: orderValue
        };
        const created = await createRank(payload);
        setRanks(prev => [...prev, created]);
        toast.success('تم إضافة المسمى الوظيفي بنجاح');
      }
    } catch (error) {
      console.error('Error saving rank:', error);
      toast.error('فشل في حفظ المسمى الوظيفي');
      throw error;
    }
  };

  const handleDeleteRank = (id: string, name: string) => {
    openDeleteModal('rank', id, name);
  };

  const openNationalityModal = (nationality: Nationality | null = null) => {
    setNationalityModal({ isOpen: true, nationality });
  };

  const closeNationalityModal = () => {
    setNationalityModal({ isOpen: false, nationality: null });
  };

  const handleSaveNationality = async (data: Omit<Nationality, 'id'> | Nationality) => {
    try {
      if ('id' in data) {
        const name = data.name.trim();
        await updateNationality(data.id, name);
        setNationalities((prev) => prev.map((n) => n.id === data.id ? { ...n, name } : n));
        toast.success('تم تحديث الجنسية بنجاح');
      } else {
        const created = await createNationality(data.name.trim());
        setNationalities((prev) => [...prev, created]);
        toast.success('تم إضافة الجنسية بنجاح');
      }
    } catch (error) {
      console.error('Error saving nationality:', error);
      toast.error('فشل في حفظ الجنسية');
      throw error;
    }
  };

  const openJobTitleModal = (jobTitle: JobTitleEntity | null = null) => {
    setJobTitleModal({ isOpen: true, jobTitle });
  };

  const closeJobTitleModal = () => {
    setJobTitleModal({ isOpen: false, jobTitle: null });
  };

  const handleSaveJobTitle = async (data: Omit<JobTitleEntity, 'id'> | JobTitleEntity) => {
    try {
      if ('id' in data) {
        const name = data.name.trim();
        await updateJobTitle(data.id, name, data.category);
        setJobTitles((prev) => prev.map((jt) => jt.id === data.id ? { ...jt, name, category: data.category } : jt));
        toast.success('تم تحديث المسمى / المنصب بنجاح');
      } else {
        const created = await createJobTitle(data.name.trim(), data.category);
        setJobTitles((prev) => [...prev, created]);
        toast.success('تم إضافة المسمى / المنصب بنجاح');
      }
    } catch (error) {
      console.error('Error saving job title:', error);
      toast.error('فشل في حفظ المسمى / المنصب');
      throw error;
    }
  };

  const openSectionModal = (section: Section | null = null, departmentId?: string | null) => {
    setSectionModal({ isOpen: true, section, departmentId: departmentId ?? section?.departmentId ?? selectedDepartmentId });
  };

  const closeSectionModal = () => {
    setSectionModal({ isOpen: false, section: null, departmentId: null });
  };

  const handleSaveSection = async (data: Omit<Section, 'id'> | Section) => {
    try {
      if ('id' in data) {
        const name = data.name.trim();
        await updateSection(data.id, name, data.departmentId);
        setSections((prev) => prev.map((s) => s.id === data.id ? { ...s, name, departmentId: data.departmentId } : s));
        toast.success('تم تحديث القسم بنجاح');
      } else {
        const created = await createSection(data.name.trim(), data.departmentId);
        setSections((prev) => [...prev, created]);
        toast.success('تم إضافة القسم بنجاح');
      }
    } catch (error) {
      console.error('Error saving section:', error);
      toast.error('فشل في حفظ القسم');
      throw error;
    }
  };

  const openDeleteModal = (type: 'department' | 'rank' | 'nationality' | 'jobTitle' | 'section', id: string, name: string) => {
    setDeleteTarget({ isOpen: true, type, id, name });
  };

  const closeDeleteModal = () => {
    setDeleteTarget({ isOpen: false, type: null, id: null, name: '' });
  };

  const confirmDelete = async () => {
    if (!deleteTarget.type || !deleteTarget.id) return;
    try {
      if (deleteTarget.type === 'department') {
        await deleteDepartment(deleteTarget.id);
        setDepartments((prev) => prev.filter((dep) => dep.id !== deleteTarget.id));
        setSections((prev) => prev.filter((section) => section.departmentId !== deleteTarget.id));
        toast.success('تم حذف الإدارة بنجاح');
      } else if (deleteTarget.type === 'rank') {
        await deleteRank(deleteTarget.id);
        setRanks((prev) => prev.filter((rank) => rank.id !== deleteTarget.id));
        toast.success('تم حذف المسمى الوظيفي بنجاح');
      } else if (deleteTarget.type === 'nationality') {
        await deleteNationality(deleteTarget.id);
        setNationalities((prev) => prev.filter((n) => n.id !== deleteTarget.id));
        toast.success('تم حذف الجنسية بنجاح');
      } else if (deleteTarget.type === 'jobTitle') {
        await deleteJobTitle(deleteTarget.id);
        setJobTitles((prev) => prev.filter((jt) => jt.id !== deleteTarget.id));
        toast.success('تم حذف المسمى / المنصب بنجاح');
      } else if (deleteTarget.type === 'section') {
        await deleteSection(deleteTarget.id);
        setSections((prev) => prev.filter((s) => s.id !== deleteTarget.id));
        toast.success('تم حذف القسم بنجاح');
      }
    } catch (error) {
      console.error('Error deleting entity:', error);
      const message = error instanceof Error && error.message ? error.message : 'فشل في عملية الحذف';
      toast.error(message);
    } finally {
      closeDeleteModal();
    }
  };

  const pageMeta = {
    general: {
      title: 'إعدادات النظام',
      description: 'إعدادات عامة للنظام والنسخ الاحتياطي والإشعارات',
      icon: SettingsIcon
    },
    departments: {
      title: 'الإدارات والأقسام',
      description: 'تنظيم الإدارات والأقسام الفرعية',
      icon: Building
    },
    ranks: {
      title: 'الرتب',
      description: 'إدارة رتب الفئات المختلفة',
      icon: Award
    },
    nationalities: {
      title: 'الجنسيات',
      description: 'إدارة الجنسيات وربطها بالموظفين',
      icon: Globe
    },
    'job-titles': {
      title: 'المسميات والمناصب',
      description: 'المسميات الوظيفية والمناصب حسب الفئة',
      icon: Award
    }
  } as const;

  const activeMeta = pageMeta[mode];
  const HeaderIcon = activeMeta.icon;
  const showGeneralSection = mode === 'general';
  const showNotificationsSection = mode === 'general';
  const showBackupSection = mode === 'general';
  const showDepartmentsSection = mode === 'departments';
  const showRanksSection = mode === 'ranks';
  const showNationalitiesSection = mode === 'nationalities';
  const showJobTitlesSection = mode === 'job-titles';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-blue-50/30">
      {/* Enhanced Header */}
      <div className="bg-white/80 backdrop-blur-sm shadow-lg border-b border-gray-200/50 rounded-2xl py-3">
        <div className="mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-20 ">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                <HeaderIcon className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{activeMeta.title}</h1>
                <p className="text-sm text-gray-600 mt-1">{activeMeta.description}</p>
              </div>
            </div>
            {mode === 'general' && (
              <div className="flex items-center gap-4">
                {saving && (
                  <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 text-blue-700 rounded-xl border border-blue-200">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-sm font-medium">جاري الحفظ...</span>
                  </div>
                )}
                <button
                  onClick={handleSaveSettings}
                  disabled={saving || Object.keys(validationErrors).length > 0}
                  className={`inline-flex items-center gap-3 px-6 py-4 text-white text-sm font-semibold rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl ${
                    Object.keys(validationErrors).length > 0
                      ? 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800'
                      : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700'
                  }`}
                >
                  {saving ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : Object.keys(validationErrors).length > 0 ? (
                    <AlertTriangle className="w-5 h-5" />
                  ) : (
                    <Save className="w-5 h-5" />
                  )}
                  {saving ? 'جاري الحفظ...' : Object.keys(validationErrors).length > 0 ? 'يوجد أخطاء' : 'حفظ جميع الإعدادات'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto px-6 lg:px-8 py-8">
          <div className="space-y-8">
            {loading ? (
              <div className="fixed inset-0 z-50">
                <LoadingPage variant="settings" />
              </div>
            ) : error ? (
              <div className="bg-gradient-to-r from-red-50 to-red-100 border-2 border-red-200 rounded-2xl p-6 shadow-lg">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-red-500 rounded-xl flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-red-900">حدث خطأ</h3>
                    <p className="text-red-800 mt-1">{error}</p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* Enhanced General Settings Tab */}
                {showGeneralSection && (
                  <div className="xl:col-span-2">
                    <FormSection
                      title="إعدادات عامة"
                      icon={SettingsIcon}
                      badge="أساسي"
                    >
                      <div className="space-y-8">
                        <FormInput
                          label="اسم النظام"
                          value={settings.systemName}
                          onChange={(value) => handleSettingChange('systemName', value)}
                          placeholder="أدخل اسم النظام"
                          required
                          icon={Monitor}
                          error={validationErrors.systemName}
                        />

                        <FormInput
                          label="اسم الإدارة"
                          value={settings.departmentName}
                          onChange={(value) => handleSettingChange('departmentName', value)}
                          placeholder="أدخل اسم الإدارة"
                          required
                          icon={Building}
                          error={validationErrors.departmentName}
                        />

                        <FormInput
                          label="اسم الإدارة العامة"
                          value={settings.companyName}
                          onChange={(value) => handleSettingChange('companyName', value)}
                          placeholder="أدخل اسم الإدارة العامة"
                          required
                          icon={Building}
                          error={validationErrors.companyName}
                        />

                        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-blue-50 p-6">
                          <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
                                <Shield className="w-6 h-6 text-white" />
                              </div>
                              <div>
                                <h4 className="text-lg font-bold text-gray-900">وحدات النظام</h4>
                                <p className="text-sm text-gray-600 mt-1">تحكم مباشر في إظهار أو إخفاء الأنظمة الفرعية حسب الحاجة.</p>
                              </div>
                            </div>
                            <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-700">إدارة الظهور</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <ModuleToggleCard
                              label="إخفاء نظام المناوبات"
                              description="إخفاء جميع صفحات المناوبات والتنبيهات المرتبطة بها."
                              checked={settings.hideShifts}
                              onChange={(checked) => handleSettingChange('hideShifts', checked)}
                              icon={Clock}
                            />
                            <ModuleToggleCard
                              label="إخفاء نظام الرخص والاستئذانات"
                              description="تعطيل صفحات إدارة الرخص والاستئذانات داخل النظام."
                              checked={settings.hideLicenses}
                              onChange={(checked) => handleSettingChange('hideLicenses', checked)}
                              icon={Award}
                            />
                            <ModuleToggleCard
                              label="إخفاء نظام مواقف الموظفين"
                              description="إخفاء صفحة ونظام مواقف الموظفين من القائمة."
                              checked={settings.hideParking}
                              onChange={(checked) => handleSettingChange('hideParking', checked)}
                              icon={HardDrive}
                            />
                            <ModuleToggleCard
                              label="إخفاء تمديدات الفنيون"
                              description="إخفاء صفحة تمديدات الفنيون من القائمة."
                              checked={settings.hideProfessionalExtensions}
                              onChange={(checked) => handleSettingChange('hideProfessionalExtensions', checked)}
                              icon={ClipboardList}
                            />
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-blue-50 p-6">
                          <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                              <Users className="w-5 h-5 text-white" />
                            </div>
                            <div>
                              <h4 className="font-bold text-gray-900">نطاق النظام</h4>
                              <p className="text-sm text-gray-600 mt-1">اختيار عرض جميع الإدارات أو تخصيص النظام لإدارة محددة.</p>
                            </div>
                          </div>
                          <ToggleSwitch
                            checked={settings.restrictToDepartment}
                            onChange={(checked) => {
                              handleSettingChange('restrictToDepartment', checked);
                              if (!checked) {
                                handleSettingChange('restrictedDepartmentName', '');
                              }
                            }}
                            label="تخصيص النظام لإدارة محددة"
                            description="مفعّل: يعرض موظفي إدارة واحدة فقط في جميع الأنظمة."
                          />
                          {settings.restrictToDepartment && (
                            <div className="mt-4">
                              <label className="block text-sm font-semibold text-gray-700 mb-2">الإدارة المحددة</label>
                              <select
                                value={settings.restrictedDepartmentName}
                                onChange={(e) => handleSettingChange('restrictedDepartmentName', e.target.value)}
                                className="w-full px-4 py-3 border-2 border-blue-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 bg-white"
                              >
                                <option value="">-- اختر إدارة --</option>
                                {departments.map((dep) => (
                                  <option key={dep.id} value={dep.name}>
                                    {dep.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                        {!settings.hideShifts && (
                          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-slate-50 p-6">
                            <div className="flex items-center gap-3 mb-4">
                              <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center">
                                <Clock className="w-5 h-5 text-white" />
                              </div>
                              <div>
                                <h4 className="font-bold text-emerald-900">عطلة نهاية الأسبوع للمناوبات</h4>
                              </div>
                            </div>
                            <ToggleSwitch
                              checked={settings.excludeWeekendShifts}
                              onChange={(checked) => handleSettingChange('excludeWeekendShifts', checked)}
                              label="اعتبار الجمعة والسبت عطلة (منع تسجيل المناوبات)"
                              description="مفعّل: يمنع تسجيل مناوبات الجمعة والسبت. غير مفعّل: يسمح بتسجيل المناوبات في جميع الأيام بما فيها الجمعة والسبت."
                            />
                          </div>
                        )}
                      </div>
                    </FormSection>
                  </div>
                )}

                {/* Enhanced Notifications Tab */}
                {showNotificationsSection && (
                  <div className="contents">
                    <FormSection
                      title="إعدادات الإشعارات والتنبيهات"
                      icon={Bell}
                      badge="تنبيهات"
                    >
                      <div className="space-y-8">
                        {/* Alert Settings */}
                        <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl p-6 border border-blue-200">
                          <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                              <AlertTriangle className="w-5 h-5 text-white" />
                            </div>
                            <h4 className="font-semibold text-blue-900">تنبيهات المناوبات (المناوبات)</h4>
                          </div>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="space-y-2">
                              <label className="block text-sm font-semibold text-gray-700">
                                تنبيه تأخر استلام المناوبة (بالأيام)
                              </label>
                              <div className="relative">
                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                  <Clock className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                  type="number"
                                  min="1"
                                  max="30"
                                  value={settings.alertOverdueDays}
                                  onChange={(e) => handleSettingChange('alertOverdueDays', parseInt(e.target.value) || 1)}
                                  className="w-full px-4 py-3 pr-12 border-2 border-blue-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 bg-white"
                                />
                              </div>
                              <p className="text-xs text-blue-700">عدد الأيام بعد تاريخ المناوبة لإرسال تنبيه عدم الاستلام</p>
                            </div>

                            <div className="space-y-2">
                              <label className="block text-sm font-semibold text-gray-700">
                                تنبيه عدم وجود مناوبة قادمة (بالأيام)
                              </label>
                              <div className="relative">
                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                  <Clock className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                  type="number"
                                  min="1"
                                  max="30"
                                  value={settings.alertUpcomingDays}
                                  onChange={(e) => handleSettingChange('alertUpcomingDays', parseInt(e.target.value) || 1)}
                                  className="w-full px-4 py-3 pr-12 border-2 border-blue-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 bg-white"
                                />
                              </div>
                              <p className="text-xs text-blue-700">إذا لم توجد مناوبة مجدولة خلال هذا العدد يتم إرسال تنبيه</p>
                            </div>
                          </div>
                        </div>

                        {/* Professional extension alerts */}
                        <div className="bg-gradient-to-r from-amber-50 to-yellow-100 rounded-xl p-6 border border-amber-200">
                          <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 bg-amber-500 rounded-lg flex items-center justify-center">
                              <ClipboardList className="w-5 h-5 text-white" />
                            </div>
                            <h4 className="font-semibold text-amber-900">تنبيهات تمديد الفنيون</h4>
                          </div>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="space-y-2">
                              <label className="block text-sm font-semibold text-gray-700">
                                أيام التنبيه قبل الانتهاء
                              </label>
                              <div className="relative">
                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                  <Clock className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                  type="text"
                                  value={settings.extensionReminderDays}
                                  onChange={(e) => handleSettingChange('extensionReminderDays', e.target.value)}
                                  className="w-full px-4 py-3 pr-12 border-2 border-amber-200 rounded-xl focus:ring-4 focus:ring-amber-500/20 focus:border-amber-500 transition-all duration-200 bg-white"
                                  placeholder="مثال: 90,60,30"
                                />
                              </div>
                              <p className="text-xs text-amber-800">يمكن إدخال عدة قيم مفصولة بفواصل، ويُستخدم أولها كنافذة عرض اقتراب التمديد.</p>
                              {validationErrors.extensionReminderDays && (
                                <p className="text-xs text-red-600">{validationErrors.extensionReminderDays}</p>
                              )}
                            </div>

                            <div className="space-y-2">
                              <label className="block text-sm font-semibold text-gray-700">
                                التنبيه الحرج قبل الانتهاء (بالأيام)
                              </label>
                              <div className="relative">
                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                  <AlertTriangle className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                  type="number"
                                  min="1"
                                  max="365"
                                  value={settings.extensionCriticalDays}
                                  onChange={(e) => handleSettingChange('extensionCriticalDays', parseInt(e.target.value) || 1)}
                                  className="w-full px-4 py-3 pr-12 border-2 border-amber-200 rounded-xl focus:ring-4 focus:ring-amber-500/20 focus:border-amber-500 transition-all duration-200 bg-white"
                                />
                              </div>
                              <p className="text-xs text-amber-800">عند بلوغ هذا العدد يتحول التنبيه إلى عالي الخطورة.</p>
                              {validationErrors.extensionCriticalDays && (
                                <p className="text-xs text-red-600">{validationErrors.extensionCriticalDays}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </FormSection>
                  </div>
                )}

                {/* Enhanced Backup Tab */}
                {showBackupSection && (
                  <div className="contents">
                    <FormSection
                      title="إعدادات النسخ الاحتياطي "
                      icon={Database}
                      badge=""
                    >
                      <div className="space-y-8">
                        <ToggleSwitch
                          checked={settings.autoBackup}
                          onChange={(checked) => handleSettingChange('autoBackup', checked)}
                          label="النسخ الاحتياطي التلقائي"
                        />

                        {settings.autoBackup && (
                          <div className="bg-blue-50 rounded-xl p-6 border border-blue-200">
                            <div className="space-y-6">
                              <div className="flex items-center gap-3 mb-4">
                                <Clock className="w-5 h-5 text-blue-600" />
                                <h4 className="font-semibold text-blue-900">جدولة النسخ الاحتياطي</h4>
                              </div>

                              <div className="space-y-2">
                                <label className="block text-sm font-semibold text-gray-700">
                                  تكرار النسخ الاحتياطي
                                </label>
                                <div className="relative">
                                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                    <RefreshCw className="h-5 w-5 text-gray-400" />
                                  </div>
                                  <select
                                    value={settings.backupFrequency}
                                    onChange={(e) => handleSettingChange('backupFrequency', e.target.value)}
                                    className="w-full px-4 py-3 pr-12 border-2 border-blue-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 bg-white"
                                  >
                                    <option value="daily">يومياً</option>
                                    <option value="weekly">أسبوعياً</option>
                                    <option value="monthly">شهرياً</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl p-6 border border-blue-200">
                          <div className="flex items-start gap-4">
                            <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center">
                              <HardDrive className="w-6 h-6 text-white" />
                            </div>
                            <div className="flex-1">
                              <h4 className="font-semibold text-blue-900 mb-2">إنشاء نسخة احتياطية يدوية</h4>
                              <p className="text-sm text-blue-800 mb-4 leading-relaxed">
                                انقر على الزر أدناه لإنشاء نسخة احتياطية فورية من جميع البيانات المهمة في النظام
                              </p>
                              <button
                                onClick={handleCreateBackup}
                                disabled={creating}
                                className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl"
                              >
                                {creating ? (
                                  <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                  <HardDrive className="w-5 h-5" />
                                )}
                                {creating ? 'جاري إنشاء النسخة...' : 'إنشاء نسخة احتياطية الآن'}
                              </button>
                            </div>
                          </div>
                        </div>

                      </div>
                    </FormSection>
                  </div>
                )}
                </div>

                {/* Enhanced Departments Tab */}
                {showDepartmentsSection && (
                  <div className="space-y-8">
                    {/* Statistics Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* Total Departments Card */}
                      <div className="group bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-2xl p-6 text-white shadow-lg hover:shadow-xl transition-all duration-300">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-emerald-100 text-sm font-medium">إجمالي الإدارات</p>
                            <p className="text-4xl font-bold mt-2">{departments.length}</p>
                            <p className="text-emerald-200 text-xs mt-1">إدارة مسجلة</p>
                          </div>
                          <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                            <Building className="w-7 h-7" />
                          </div>
                        </div>
                        <div className="mt-4 h-1 bg-white/20 rounded-full overflow-hidden">
                          <div className="h-full bg-white rounded-full" style={{ width: '100%' }}></div>
                        </div>
                      </div>

                      {/* Total Sections Card */}
                      <div className="group bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-6 text-white shadow-lg hover:shadow-xl transition-all duration-300">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-blue-100 text-sm font-medium">إجمالي الأقسام</p>
                            <p className="text-4xl font-bold mt-2">{sections.length}</p>
                            <p className="text-blue-200 text-xs mt-1">قسم مسجل</p>
                          </div>
                          <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                            <Layers className="w-7 h-7" />
                          </div>
                        </div>
                        <div className="mt-4 h-1 bg-white/20 rounded-full overflow-hidden">
                          <div className="h-full bg-white rounded-full" style={{ width: '100%' }}></div>
                        </div>
                      </div>

                      {/* Assigned vs Unassigned Employees Card */}
                      <div className="group bg-gradient-to-br from-teal-500 to-teal-600 rounded-2xl p-6 text-white shadow-lg hover:shadow-xl transition-all duration-300">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-teal-100 text-sm font-medium">تسكين الموظفين بالإدارات</p>
                            <p className="text-3xl font-bold mt-2">{assignedEmployeesCount}</p>
                            <p className="text-teal-200 text-xs mt-1">غير مسكنين: {unassignedEmployeesCount}</p>
                            {excludedFromStatisticsCount > 0 && (
                              <p className="text-amber-100 text-[11px] mt-1">
                                مستثنى من الإحصاء: {excludedFromStatisticsCount}
                              </p>
                            )}
                          </div>
                          <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                            <Briefcase className="w-7 h-7" />
                          </div>
                        </div>
                        <div className="mt-4 h-1 bg-white/20 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-white rounded-full"
                            style={{
                              width: `${employeesIncludedInStatistics.length > 0 ? (assignedEmployeesCount / employeesIncludedInStatistics.length * 100) : 0}%`
                            }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    <FormSection
                      title="إدارة الإدارات والأقسام"
                      icon={Building}
                      badge={`${departments.length} إدارة`}
                    >
                      <div className="space-y-6">
                        {departments.length > 0 ? (
                          <>
                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                              <div className="xl:col-span-1 space-y-4">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <h4 className="text-sm font-semibold text-gray-700">قائمة الإدارات</h4>
                                    <div className="text-xs text-gray-500">إجمالي {departments.length} إدارة</div>
                                  </div>
                                  <button
                                    onClick={() => openDepartmentModal()}
                                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-md hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                                  >
                                    <Plus className="w-4 h-4" />
                                    إضافة إدارة
                                  </button>
                                </div>
                                <div className="relative">
                                  <Search className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                  <input
                                    type="text"
                                    value={departmentSearch}
                                    onChange={(e) => setDepartmentSearch(e.target.value)}
                                    placeholder="ابحث باسم الإدارة..."
                                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 pr-10 text-sm focus:border-blue-400 focus:ring-4 focus:ring-blue-500/20 transition-all"
                                  />
                                </div>
                                <div className="bg-white rounded-2xl border border-gray-200 p-3 space-y-3 max-h-[520px] overflow-auto">
                                  {filteredDepartments.length > 0 ? (
                                    filteredDepartments.map((dep, index) => {
                                      const isActive = dep.id === selectedDepartmentId;
                                      const sectionCount = sections.filter((s) => s.departmentId === dep.id).length;
                                      const employeeCount = departmentEmployeeCounts[normalizeOrganizationName(dep.name)] || 0;
                                      return (
                                        <div
                                          key={dep.id || `${dep.name}-${index}`}
                                          className={`group p-4 rounded-xl border transition-all cursor-pointer ${
                                            isActive ? 'border-blue-400 bg-blue-50 shadow-sm' : 'border-gray-200 bg-white hover:border-blue-200'
                                          }`}
                                          onClick={() => setSelectedDepartmentId(dep.id)}
                                        >
                                          <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3">
                                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-semibold ${
                                                isActive ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                                              }`}>
                                                {index + 1}
                                              </div>
                                              <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                  <span className="font-bold text-gray-900">{dep.name}</span>
                                                  {isActive && (
                                                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-blue-100 text-blue-700">
                                                      محدد
                                                    </span>
                                                  )}
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                                                    <Layers className="w-3.5 h-3.5" />
                                                    {sectionCount} قسم
                                                  </span>
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                                                    <Users className="w-3.5 h-3.5" />
                                                    {employeeCount} موظف
                                                  </span>
                                                </div>
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  openDepartmentModal(dep);
                                                }}
                                                className="text-blue-600 hover:text-blue-800"
                                              >
                                                <Edit className="w-4 h-4" />
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleDeleteDepartment(dep.id, dep.name);
                                                }}
                                                className="text-red-600 hover:text-red-800"
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <div className="flex flex-col items-center justify-center py-10 text-center text-gray-500">
                                      <Search className="w-10 h-10 text-gray-300 mb-3" />
                                      <div className="text-sm font-semibold">لا توجد نتائج مطابقة</div>
                                      <div className="text-xs text-gray-400 mt-1">جرّب كلمة بحث مختلفة</div>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="xl:col-span-2 space-y-4">
                                {selectedDepartment && (
                                  <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-2xl border border-blue-200 p-5">
                                    <div className="flex flex-wrap items-center justify-between gap-4">
                                      <div className="flex items-center gap-3">
                                        <div className="w-11 h-11 bg-blue-600 text-white rounded-xl flex items-center justify-center">
                                          <Building className="w-6 h-6" />
                                        </div>
                                        <div>
                                          <div className="text-xs text-blue-700">الإدارة المختارة</div>
                                          <div className="text-lg font-bold text-blue-900">{selectedDepartment.name}</div>
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white text-blue-700 border border-blue-200">
                                          <Layers className="w-3.5 h-3.5" />
                                          {selectedDepartmentSectionCount} قسم
                                        </span>
                                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white text-emerald-700 border border-emerald-200">
                                          <Users className="w-3.5 h-3.5" />
                                          {selectedDepartmentEmployeeCount} موظف
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                <div className="flex items-center justify-between">
                                  <div>
                                    <h4 className="text-sm font-semibold text-gray-700">الأقسام الفرعية</h4>
                                    {selectedDepartment ? (
                                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mt-1">
                                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                                          {selectedDepartment.name}
                                        </span>
                                        <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                                          {selectedDepartmentSectionCount} قسم
                                        </span>
                                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                                          {selectedDepartmentEmployeeCount} موظف
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="text-xs text-gray-500 mt-1">اختر إدارة لعرض الأقسام.</div>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => openSectionModal(null, selectedDepartmentId)}
                                    disabled={!selectedDepartmentId}
                                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-md hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    <Plus className="w-4 h-4" />
                                    إضافة قسم
                                  </button>
                                </div>

                                <div className="bg-white rounded-2xl border border-gray-200 p-6 min-h-[320px]">
                                  {selectedDepartment ? (
                                    selectedSections.length > 0 ? (
                                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {selectedSections.map((section) => {
                                          const sectionKey = `${selectedDepartmentKey}__${normalizeOrganizationName(section.name)}`;
                                          const employeesCount = sectionEmployeeCounts[sectionKey] || 0;
                                          return (
                                            <div
                                              key={section.id || `${section.name}-${section.departmentId}`}
                                              className="group bg-gray-50 border border-gray-200 rounded-xl p-4 hover:border-blue-200 hover:shadow-sm transition-all"
                                            >
                                              <div className="flex items-start justify-between gap-2">
                                                <div className="space-y-2">
                                                  <p className="font-semibold text-gray-900">{section.name}</p>
                                                  <div className="flex items-center gap-2 text-xs text-gray-600">
                                                    <Users className="w-3.5 h-3.5 text-emerald-500" />
                                                    <span>{employeesCount} موظف</span>
                                                  </div>
                                                </div>
                                                <div className="flex items-center gap-2 opacity-80 group-hover:opacity-100">
                                                  <button
                                                    onClick={() => openSectionModal(section)}
                                                    className="text-blue-600 hover:text-blue-800"
                                                  >
                                                    <Edit className="w-4 h-4" />
                                                  </button>
                                                  <button
                                                    onClick={() => openDeleteModal('section', section.id, section.name)}
                                                    className="text-red-600 hover:text-red-800"
                                                  >
                                                    <Trash2 className="w-4 h-4" />
                                                  </button>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                                        <ClipboardList className="w-10 h-10 text-gray-300 mb-3" />
                                        <div className="text-sm">لا توجد أقسام فرعية بعد لهذه الإدارة.</div>
                                      </div>
                                    )
                                  ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                                      <Building className="w-10 h-10 text-gray-300 mb-3" />
                                      <div className="text-sm">اختر إدارة من القائمة لعرض الأقسام.</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                              <div className="bg-white rounded-2xl border border-gray-200 p-6">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <h4 className="text-lg font-bold text-gray-700">الهيكل التنظيمي</h4>
                                    <div className="text-xs text-gray-500">عرض تفصيلي للإدارات والأقسام</div>
                                  </div>
                                  <button
                                    onClick={() => setShowOrgTree(!showOrgTree)}
                                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-md hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                                  >
                                    {showOrgTree ? (
                                      <>
                                        <ChevronDown className="w-4 h-4" />
                                        إخفاء الهيكل
                                      </>
                                    ) : (
                                      <>
                                        <ChevronLeft className="w-4 h-4" />
                                        عرض الهيكل التنظيمي
                                      </>
                                    )}
                                  </button>
                                </div>
                                {showOrgTree && (
                                  orgTree ? (
                                    <div className="bg-gradient-to-br from-gray-50 to-blue-50/30 rounded-xl border border-blue-200 p-6 overflow-auto">
                                      <div className="min-w-[400px]">
                                        <OrgTreeNode node={orgTree} />
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-center h-32 text-sm text-gray-500 bg-gray-50 rounded-xl border border-gray-200">
                                      لا توجد بيانات كافية لعرض الهيكل التنظيمي.
                                    </div>
                                  )
                                )}
                              </div>

                              <div className="bg-white rounded-2xl border border-gray-200 p-6">
                                <div className="flex items-center justify-between gap-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-11 h-11 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
                                      <UserX className="w-6 h-6" />
                                    </div>
                                    <div>
                                      <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-gray-800">
                                        الموظفون غير المسكنين
                                        <span className="text-[11px] font-semibold text-red-700">
                                          الإجمالي: {unassignedEmployees.length}
                                        </span>
                                      </div>
                                      <div className="text-xs text-gray-500">لم يتم ربطهم بأي إدارة حتى الآن</div>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => setShowUnassignedEmployees((prev) => !prev)}
                                    className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 transition-all"
                                  >
                                    <ChevronDown className={`w-4 h-4 transition-transform ${showUnassignedEmployees ? 'rotate-180' : ''}`} />
                                    {showUnassignedEmployees ? 'إخفاء القائمة' : 'عرض القائمة'}
                                  </button>
                                </div>

                                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                                  {unassignedSearch && (
                                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
                                      نتائج البحث: {filteredUnassignedEmployees.length}
                                    </span>
                                  )}
                                </div>

                                {showUnassignedEmployees && (
                                  <div className="mt-4 space-y-4">
                                    <div className="relative">
                                      <Search className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                      <input
                                        type="text"
                                        value={unassignedSearch}
                                        onChange={(e) => setUnassignedSearch(e.target.value)}
                                        placeholder="ابحث بالاسم أو الرقم أو الإدارة المسجلة..."
                                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 pr-10 text-sm focus:border-blue-400 focus:ring-4 focus:ring-blue-500/20 transition-all"
                                      />
                                    </div>
                                    {filteredUnassignedEmployees.length > 0 ? (
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-auto">
                                        {filteredUnassignedEmployees.map((employee) => {
                                          const displayName = formatEmployeeDisplayName(employee) || employee.name || '-';
                                          const displayLabel = employee.rank ? `${employee.rank} / ${displayName}` : displayName;
                                          const fileLabel = employee.fileNumber || employee.militaryNumber || '';
                                          return (
                                            <div
                                              key={employee.id}
                                              className="border border-gray-200 rounded-xl p-3 bg-gray-50 hover:border-blue-200 hover:shadow-sm transition-all"
                                            >
                                              <div className="flex items-center justify-between gap-2">
                                                <div className="font-semibold text-gray-900 text-sm">{displayLabel}</div>
                                                {fileLabel && (
                                                  <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                                                    {fileLabel}
                                                  </span>
                                                )}
                                              </div>
                                              {employee.department ? (
                                                <div className="text-xs text-gray-500 mt-2">
                                                  الإدارة المسجلة: <span className="font-semibold text-gray-700">{employee.department}</span>
                                                </div>
                                              ) : (
                                                <div className="text-xs text-gray-400 mt-2">بدون إدارة مسجلة</div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <div className="flex flex-col items-center justify-center text-center text-gray-500 py-6">
                                        <Users className="w-10 h-10 text-gray-300 mb-3" />
                                        <div className="text-sm font-semibold">لا توجد نتائج مطابقة</div>
                                        <div className="text-xs text-gray-400 mt-1">جرّب تغيير كلمات البحث</div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="text-center py-16">
                            <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                              <Building className="w-10 h-10 text-gray-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">لا توجد إدارات</h3>
                            <p className="text-gray-600 mb-6">ابدأ بإضافة الإدارات المختلفة في مؤسستك</p>
                            <button
                              onClick={() => openDepartmentModal()}
                              className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-lg hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                            >
                              <Plus className="w-5 h-5" />
                              إضافة أول إدارة
                            </button>
                          </div>
                        )}
                      </div>
                    </FormSection>
                  </div>
                )}

                {/* Enhanced Ranks Tab */}
                {showRanksSection && (
                  <div className="space-y-8">
                    <FormSection
                      title="إدارة الرتب"
                      icon={Award}
                      badge={`${ranks.length} مسمى وظيفي`}
                      actions={
                        <button
                          onClick={() => openRankModal()}
                          className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-500/20 transition-all duration-200 shadow-lg hover:shadow-xl"
                        >
                          <Plus className="w-4 h-4" />
                          إضافة مسمى وظيفي جديدة
                        </button>
                      }
                    >
                      <div className="space-y-6">
                        {ranks.length > 0 ? (
                          <div className="grid gap-6">
                            {[
                              { label: 'قيادات', color: 'from-blue-500 to-blue-600', text: 'الرتب المعتمدة' },
                              { label: 'مشرفون', color: 'from-blue-500 to-blue-600', text: 'الرتب المعتمدة' },
                              { label: 'فنيون', color: 'from-blue-500 to-blue-600', text: 'الرتب المعتمدة' },
                              { label: 'إداريون', color: 'from-blue-500 to-blue-600', text: 'الرتب المعتمدة' }
                            ].map((cat) => {
                              const items = ranks
                                .filter((rank) => rank.category === cat.label)
                                .slice()
                                .sort((a, b) => {
                                  const orderDiff = getRankOrder(a.name, a.category) - getRankOrder(b.name, b.category);
                                  if (orderDiff !== 0) return orderDiff;
                                  return a.name.localeCompare(b.name, 'ar');
                                });
                              return (
                                <div key={cat.label} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                                  <div className={`p-5 bg-gradient-to-r ${cat.color} text-white`}>
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <h3 className="text-xl font-black">{cat.label}</h3>
                                      </div>
                                      <span className="px-3 py-1 text-xs font-semibold bg-white/20 rounded-full">
                                        {items.length} مسمى وظيفي
                                      </span>
                                    </div>
                                  </div>
                                  <div className="p-5">
                                    {items.length > 0 ? (
                                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                        {items.map((rank) => (
                                          <div
                                            key={rank.id || `${rank.name}-${rank.category}`}
                                            className="group bg-gray-50 border border-gray-200 rounded-xl p-4 hover:border-blue-200 hover:shadow-sm transition-all"
                                          >
                                            <div className="flex items-center justify-between">
                                              <div>
                                                <p className="text-sm font-semibold text-gray-900">{rank.name}</p>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <button
                                                  onClick={() => openRankModal(rank)}
                                                  className="text-blue-600 hover:text-blue-800"
                                                >
                                                  <Edit className="w-4 h-4" />
                                                </button>
                                                <button
                                                  onClick={() => handleDeleteRank(rank.id, rank.name)}
                                                  className="text-red-600 hover:text-red-800"
                                                >
                                                  <Trash2 className="w-4 h-4" />
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="text-sm text-gray-600 bg-gray-50 border border-dashed border-gray-200 rounded-xl px-4 py-4">
                                        لا توجد رتب مسجلة لهذه الفئة بعد.
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-center py-16">
                            <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                              <Award className="w-10 h-10 text-gray-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">لا توجد رتب</h3>
                            <p className="text-gray-600 mb-6">ابدأ بإضافة الرتب والمناصب المختلفة</p>
                            <button
                              onClick={() => openRankModal()}
                              className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-lg hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                            >
                              <Plus className="w-5 h-5" />
                              إضافة أول مسمى وظيفي
                            </button>
                          </div>
                        )}
                      </div>
                    </FormSection>
                  </div>
                )}

                {/* Nationalities Tab */}
                {showNationalitiesSection && (
                  <div className="space-y-8">
                    <FormSection
                      title="إدارة الجنسيات"
                      icon={Globe}
                      badge={`${nationalities.length} جنسية`}
                      actions={
                        <button
                          onClick={() => openNationalityModal()}
                          className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-lg hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                        >
                          <Plus className="w-4 h-4" />
                          إضافة جنسية
                        </button>
                      }
                    >
                      <div className="space-y-6">
                        {nationalities.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {nationalities.map((nat) => {
                              const nationalityMeta = getNationalityFlagData(nat.name);
                              const fallbackLetter = (nationalityMeta.label || nat.name || '').slice(0, 1);

                              return (
                                <div
                                  key={nat.id || nat.name}
                                  className="group bg-white border border-gray-200 rounded-2xl p-4 hover:border-blue-200 hover:shadow-sm transition-all"
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center font-bold">
                                        {nationalityMeta.flagUrl ? (
                                          <img
                                            src={nationalityMeta.flagUrl}
                                            alt=""
                                            className="h-6 w-6"
                                            loading="lazy"
                                          />
                                        ) : nationalityMeta.flagEmoji ? (
                                          <span
                                            className="text-lg leading-none"
                                            style={{ fontFamily: 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji' }}
                                          >
                                            {nationalityMeta.flagEmoji}
                                          </span>
                                        ) : (
                                          <span>{fallbackLetter || '?'}</span>
                                        )}
                                      </div>
                                      <div>
                                        <p className="font-semibold text-gray-900">{nationalityMeta.label || nat.name}</p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => openNationalityModal(nat)}
                                        className="text-blue-600 hover:text-blue-800"
                                      >
                                        <Edit className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => openDeleteModal('nationality', nat.id, nat.name)}
                                        className="text-red-600 hover:text-red-800"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-center py-16">
                            <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                              <Globe className="w-10 h-10 text-gray-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">لا توجد جنسيات</h3>
                            <p className="text-gray-600 mb-6">ابدأ بإضافة الجنسيات لاستخدامها في ملفات الموظفين</p>
                            <button
                              onClick={() => openNationalityModal()}
                              className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-lg hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                            >
                              <Plus className="w-5 h-5" />
                              إضافة أول جنسية
                            </button>
                          </div>
                        )}
                      </div>
                    </FormSection>
                  </div>
                )}

                {/* Job titles tab */}
                {showJobTitlesSection && (
                  <div className="space-y-8">
                    <FormSection
                      title="المسميات الوظيفية / المناصب"
                      icon={Award}
                      badge={`${jobTitles.length} مسمى`}
                      actions={
                        <button
                          onClick={() => openJobTitleModal()}
                          className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-lg hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                        >
                          <Plus className="w-4 h-4" />
                          إضافة مسمى
                        </button>
                      }
                    >
                      <div className="space-y-6">
                        {['قيادات', 'مشرفون', 'فنيون', 'إداريون'].map((cat) => {
                          const list = jobTitles.filter((jt) => jt.category === cat);
                          const titleText = cat;
                          const descriptionText = cat === 'قيادات'
                            ? 'القيادات - مناصب'
                            : cat === 'مشرفون'
                              ? 'مشرفون - مسميات وظيفية'
                              : cat === 'فنيون'
                                ? 'الفنيون - مسميات وظيفية'
                                : 'الإداريون - مسميات وظيفية ومناصب';
                          return (
                            <div key={cat} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                              <div className="p-5 bg-gradient-to-r from-blue-500 to-blue-600 text-white flex items-center justify-between">
                                <div>
                                  <h3 className="text-lg font-bold">{titleText}</h3>
                                  <p className="text-xs text-white/80">{descriptionText}</p>
                                </div>
                                <span className="px-3 py-1 text-xs font-semibold bg-white/20 rounded-full">
                                  {list.length} مسمى
                                </span>
                              </div>
                              <div className="p-5">
                                {list.length > 0 ? (
                                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {list.map((jt) => (
                                      <div
                                        key={jt.id || `${jt.name}-${jt.category}`}
                                        className="group bg-gray-50 border border-gray-200 rounded-xl p-4 hover:border-blue-200 hover:shadow-sm transition-all"
                                      >
                                        <div className="flex items-center justify-between">
                                          <div>
                                            <p className="font-semibold text-gray-900">{jt.name}</p>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <button
                                              onClick={() => openJobTitleModal(jt)}
                                              className="text-blue-600 hover:text-blue-800"
                                            >
                                              <Edit className="w-4 h-4" />
                                            </button>
                                            <button
                                              onClick={() => openDeleteModal('jobTitle', jt.id, jt.name)}
                                              className="text-red-600 hover:text-red-800"
                                            >
                                              <Trash2 className="w-4 h-4" />
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-sm text-gray-600 bg-gray-50 border border-dashed border-gray-200 rounded-xl px-4 py-4">
                                    لا توجد مسميات مسجلة لهذه الفئة بعد.
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </FormSection>
                  </div>
                )}
              </>
            )}
          </div>
      </div>

      {/* Modals */}
      {showSettingsPasswordModal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
                <Shield className="h-5 w-5 text-amber-700" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">تأكيد حفظ الإعدادات</h3>
                <p className="text-sm text-gray-600">أدخل كلمة المرور للمتابعة</p>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleConfirmSaveSettings();
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">كلمة المرور</label>
                <input
                  type="password"
                  value={settingsPassword}
                  onChange={(e) => setSettingsPassword(e.target.value)}
                  autoFocus
                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                  placeholder="أدخل كلمة المرور"
                />
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeSettingsPasswordModal}
                  disabled={saving}
                  className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'جارٍ التحقق...' : 'تأكيد الحفظ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <DepartmentModal
        isOpen={departmentModal.isOpen}
        onClose={closeDepartmentModal}
        onSave={handleSaveDepartment}
        department={departmentModal.department}
        title={departmentModal.department ? 'تعديل الإدارة' : 'إضافة إدارة جديدة'}
      />

      <RankModal
        isOpen={rankModal.isOpen}
        onClose={closeRankModal}
        onSave={handleSaveRank}
        rank={rankModal.rank}
        title={rankModal.rank ? 'تعديل المسمى الوظيفي' : 'إضافة مسمى وظيفي جديدة'}
      />

      <NationalityModal
        isOpen={nationalityModal.isOpen}
        onClose={closeNationalityModal}
        onSave={handleSaveNationality}
        nationality={nationalityModal.nationality}
        title={nationalityModal.nationality ? 'تعديل الجنسية' : 'إضافة جنسية جديدة'}
      />

      <JobTitleModal
        isOpen={jobTitleModal.isOpen}
        onClose={closeJobTitleModal}
        onSave={handleSaveJobTitle}
        jobTitle={jobTitleModal.jobTitle}
        title={jobTitleModal.jobTitle ? 'تعديل المسمى / المنصب' : 'إضافة مسمى جديد'}
      />

      <SectionModal
        isOpen={sectionModal.isOpen}
        onClose={closeSectionModal}
        onSave={handleSaveSection}
        section={sectionModal.section}
        departments={departments}
        defaultDepartmentId={sectionModal.departmentId || undefined}
        title={sectionModal.section ? 'تعديل القسم' : 'إضافة قسم جديد'}
      />

      <ConfirmDeleteModal
        isOpen={deleteTarget.isOpen}
        onClose={closeDeleteModal}
        onConfirm={confirmDelete}
        title="تأكيد الحذف"
        description={`هل أنت متأكد من حذف "${deleteTarget.name}"؟ لا يمكن التراجع عن هذه العملية.`}
        confirmLabel="حذف"
      />
    </div>
  );
};

export default Settings;
