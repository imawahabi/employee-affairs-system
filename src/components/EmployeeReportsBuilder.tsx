import React, { useEffect, useMemo, useState } from 'react';
import { AlignmentType, BorderStyle, Document, HeightRule, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType } from 'docx';
import { saveAs } from 'file-saver';
import { CheckCircle2, Columns3, Eye, FileDown, FileSpreadsheet, FileText, Filter, FolderOpen, Pencil, Pin, Plus, Printer, RotateCcw, Save, SlidersHorizontal, Trash2, UserPlus, Users, X, XCircle, Settings } from 'lucide-react';
import { fetchDepartments, fetchEmployees, fetchSections } from '../api';
import { Department, Employee, Section } from '../types';
import LoadingPage from './LoadingPage';
import { buildDepartmentNameMap, buildSectionNameMap, formatDepartmentLabel, formatSectionLabel, normalizeOrganizationName } from '../utils/organization';
import { getCategoryOrder, getRankOrder } from '../utils/rankOrder';
import { formatEmployeeDisplayName } from '../utils/employeeDisplay';
import { getSearchTokens, matchesArabicSearch } from '../utils/search';

type FieldType = 'text' | 'select' | 'number' | 'boolean';
type Operator = 'contains' | 'equals' | 'notEquals' | 'empty' | 'notEmpty' | 'gte' | 'lte';

type ReportField = {
  key: string;
  label: string;
  type: FieldType;
  getValue: (employee: Employee) => string | number | boolean | null | undefined;
  options?: string[];
};

type ReportCondition = {
  id: string;
  fieldKey: string;
  operator: Operator;
  value: string;
};

type SortRule = {
  fieldKey: string;
  direction: 'asc' | 'desc';
};

type NameDisplayMode = 'full' | 'triple' | 'quad' | 'quint';

const nameDisplayModeLabels: Record<NameDisplayMode, string> = {
  full: 'الاسم كامل',
  triple: 'ثلاثي',
  quad: 'رباعي',
  quint: 'خماسي',
};
type ReportOrientationMode = 'auto' | 'portrait' | 'landscape';
type CategoryReportRow =
  | { type: 'category'; label: string; startsNewPage: boolean }
  | { type: 'employee'; employee: Employee; index: number; globalIndex: number };

type SavedReportTemplate = {
  id: string;
  name: string;
  createdAt: string;
  title?: string;
  subtitle?: string;
  conditions: ReportCondition[];
  extraEmployeeIds?: string[];
  excludedEmployeeIds?: string[];
  selectedColumns: string[];
  sortRule?: SortRule;
  nameDisplayMode: NameDisplayMode;
  categoryNameDisplayModes?: Record<string, NameDisplayMode>;
  reportOrientationMode?: ReportOrientationMode;
  includeCategorySeparators: boolean;
  includeSummaryStats: boolean;
  summaryStatsFieldKey: string;
  hideDepartmentWord?: boolean;
  omitJobTitleCategories?: string[];
};

const SULTAN_FONT = {
  name: 'Sultan Medium',
  cs: 'Sultan Medium',
  ascii: 'Sultan Medium',
  hAnsi: 'Sultan Medium',
};

const TIMES_FONT = {
  name: 'Times New Roman',
  cs: 'Times New Roman',
  ascii: 'Times New Roman',
  hAnsi: 'Times New Roman',
};

let cachedSultanMediumFont: Uint8Array | null = null;
async function fetchSultanMediumFont(): Promise<Uint8Array | null> {
  if (cachedSultanMediumFont) return cachedSultanMediumFont;
  try {
    const res = await fetch('/Sultan-Medium.ttf');
    if (res.ok) {
      const buffer = await res.arrayBuffer();
      cachedSultanMediumFont = new Uint8Array(buffer);
      return cachedSultanMediumFont;
    }
  } catch (err) {
    console.warn('Could not load Sultan-Medium.ttf font file:', err);
  }
  return null;
}

const normalizeArabic = (value?: string | number | boolean | null) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const ageInYears = (date?: string | null) => {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date();
  let years = today.getFullYear() - parsed.getFullYear();
  const monthDiff = today.getMonth() - parsed.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parsed.getDate())) years -= 1;
  return years;
};

const operatorLabels: Record<Operator, string> = {
  contains: 'يحتوي',
  equals: 'يساوي',
  notEquals: 'لا يساوي',
  empty: 'فارغ',
  notEmpty: 'غير فارغ',
  gte: 'أكبر أو يساوي',
  lte: 'أصغر أو يساوي',
};

const textOperators: Operator[] = ['contains', 'equals', 'notEquals', 'empty', 'notEmpty'];
const selectOperators: Operator[] = ['equals', 'notEquals', 'empty', 'notEmpty'];
const numberOperators: Operator[] = ['equals', 'notEquals', 'gte', 'lte', 'empty', 'notEmpty'];
const booleanOperators: Operator[] = ['equals', 'notEquals'];

const defaultColumnKeys = ['serial', 'rank', 'name', 'fileNumber', 'civilId', 'jobTitle', 'department', 'section'];
const pinnedConditionIdPrefix = 'pinned_default_condition';
const pinnedConditionStorageKey = 'employeeReportsPinnedCondition';
const reportTemplateStorageKey = 'employeeReportsConditionTemplates';
const numericReportColumnKeys = new Set(['serial', 'fileNumber', 'militaryNumber', 'civilId', 'phone_number', 'referenceNumber', 'age', 'seniorityNumber']);
const defaultPinnedCondition: ReportCondition = {
  id: `${pinnedConditionIdPrefix}_active_status`,
  fieldKey: 'status',
  operator: 'equals',
  value: 'في الخدمة',
};
const oneCentimeterInTwips = 567;
const isInactiveEmployee = (employee: Employee) => employee.status === 'inactive';

const formatReportName = (employee: Employee, mode: NameDisplayMode) => {
  const structuredParts = [
    employee.firstName,
    employee.secondName,
    employee.thirdName,
    employee.fourthName,
    employee.familyName,
  ]
    .map((part) => (part || '').trim())
    .filter(Boolean);

  // If we have structured name parts from database, use them
  if (structuredParts.length > 0) {
    if (mode === 'full' || structuredParts.length <= 2) {
      return structuredParts.join(' ');
    }
    if (mode === 'triple') {
      if (structuredParts.length <= 3) return structuredParts.join(' ');
      return [structuredParts[0], structuredParts[1], structuredParts[structuredParts.length - 1]].join(' ');
    }
    if (mode === 'quad') {
      if (structuredParts.length <= 4) return structuredParts.join(' ');
      return [structuredParts[0], structuredParts[1], structuredParts[structuredParts.length - 2], structuredParts[structuredParts.length - 1]].join(' ');
    }
    if (structuredParts.length <= 5) return structuredParts.join(' ');
    return [structuredParts[0], structuredParts[1], structuredParts[2], structuredParts[structuredParts.length - 2], structuredParts[structuredParts.length - 1]].join(' ');
  }

  // Fallback to old system if no structured parts available
  const fullName = employee.name || '';
  const parts = fullName.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  if (mode === 'full' || parts.length <= 2) return fullName;
  if (mode === 'triple') {
    if (parts.length <= 3) return parts.join(' ');
    return [parts[0], parts[1], parts[parts.length - 1]].join(' ');
  }
  if (mode === 'quad') {
    if (parts.length <= 4) return parts.join(' ');
    return [parts[0], parts[1], parts[parts.length - 2], parts[parts.length - 1]].join(' ');
  }
  if (parts.length <= 5) return parts.join(' ');
  return [parts[0], parts[1], parts[2], parts[parts.length - 2], parts[parts.length - 1]].join(' ');
};

const formatExportValue = (value: string | number | boolean | null | undefined) => {
  if (value === true) return 'نعم';
  if (value === false) return 'لا';
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
};

const uniqueArabicOptions = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'));

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const sanitizeFileName = (value: string) => {
  const cleaned = value.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || 'تقرير شؤون الموظفين';
};

const makePinnedCondition = (condition: ReportCondition, id = `${pinnedConditionIdPrefix}_${Date.now()}`): ReportCondition => ({
  ...condition,
  id,
});

const isPinnedConditionId = (id: string) => id.startsWith(pinnedConditionIdPrefix);

const normalizePinnedCondition = (condition: Partial<ReportCondition>, id?: string): ReportCondition | null => {
  if (!condition.fieldKey || !condition.operator) return null;
  return {
    id: id || condition.id || `${pinnedConditionIdPrefix}_${Date.now()}`,
    fieldKey: condition.fieldKey,
    operator: condition.operator,
    value: condition.value ?? '',
  };
};

const getInitialPinnedConditions = (): ReportCondition[] => {
  try {
    const stored = localStorage.getItem(pinnedConditionStorageKey);
    if (!stored) return [defaultPinnedCondition];
    const parsed = JSON.parse(stored) as Partial<ReportCondition> | Array<Partial<ReportCondition>>;
    const conditions = Array.isArray(parsed)
      ? parsed.map((condition, index) => normalizePinnedCondition(condition, condition.id || `${pinnedConditionIdPrefix}_${index}`))
      : [normalizePinnedCondition(parsed, defaultPinnedCondition.id)];
    const validConditions = conditions.filter((condition): condition is ReportCondition => !!condition);
    return validConditions.length > 0 ? validConditions : [defaultPinnedCondition];
  } catch {
    return [defaultPinnedCondition];
  }
};

const savePinnedConditions = (conditions: ReportCondition[]) => {
  localStorage.setItem(pinnedConditionStorageKey, JSON.stringify(conditions.map((condition) => ({
    id: condition.id,
    fieldKey: condition.fieldKey,
    operator: condition.operator,
    value: condition.value,
  }))));
};

const readSavedReportTemplates = (): SavedReportTemplate[] => {
  try {
    const stored = localStorage.getItem(reportTemplateStorageKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedReportTemplate =>
      !!item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.conditions)
    );
  } catch {
    return [];
  }
};

const saveReportTemplates = (templates: SavedReportTemplate[]) => {
  localStorage.setItem(reportTemplateStorageKey, JSON.stringify(templates));
};

const EmployeeReportsBuilder: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [title, setTitle] = useState('كشف مخصص لشؤون الموظفين');
  const [subtitle, setSubtitle] = useState('');
  const [nameDisplayMode, setNameDisplayMode] = useState<NameDisplayMode>('full');
  const [categoryNameDisplayModes, setCategoryNameDisplayModes] = useState<Record<string, NameDisplayMode>>({});
  const [reportOrientationMode, setReportOrientationMode] = useState<ReportOrientationMode>('auto');
  const [includeSummaryStats, setIncludeSummaryStats] = useState(false);
  const [summaryStatsFieldKey, setSummaryStatsFieldKey] = useState('category');
  const [includeCategorySeparators, setIncludeCategorySeparators] = useState(false);
  const [hideDepartmentWord, setHideDepartmentWord] = useState(false);
  const [omitJobTitleCategories, setOmitJobTitleCategories] = useState<string[]>([]);
  const [pinnedConditions, setPinnedConditions] = useState<ReportCondition[]>(() => getInitialPinnedConditions());
  const [conditions, setConditions] = useState<ReportCondition[]>(() => getInitialPinnedConditions());
  const [extraEmployeeIds, setExtraEmployeeIds] = useState<string[]>([]);
  const [extraEmployeeSearch, setExtraEmployeeSearch] = useState('');
  const [excludedEmployeeIds, setExcludedEmployeeIds] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(defaultColumnKeys);
  const [reportTemplates, setReportTemplates] = useState<SavedReportTemplate[]>(() => readSavedReportTemplates());
  const [templateName, setTemplateName] = useState('');
  const [showReportTemplates, setShowReportTemplates] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [employeeData, departmentData, sectionData] = await Promise.all([
          fetchEmployees(),
          fetchDepartments(),
          fetchSections(),
        ]);
        setEmployees(employeeData);
        setDepartments(departmentData);
        setSections(sectionData);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const departmentMap = useMemo(() => buildDepartmentNameMap(departments), [departments]);
  const sectionMap = useMemo(() => buildSectionNameMap(sections, departments), [sections, departments]);

  const fields = useMemo<ReportField[]>(() => {
    const unique = (values: Array<string | null | undefined>) =>
      Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'));

    return [
      { key: 'smartOrder', label: 'الترتيب الذكي', type: 'number', getValue: () => 0 },
      { key: 'name', label: 'الاسم', type: 'text', getValue: (employee) => formatEmployeeDisplayName(employee) || employee.name },
      { key: 'rank', label: 'المسمى الوظيفي', type: 'select', getValue: (employee) => employee.rank, options: unique(employees.map((employee) => employee.rank)) },
      { key: 'category', label: 'الفئة', type: 'select', getValue: (employee) => employee.category, options: ['قيادات', 'مشرفون', 'فنيون', 'إداريون'] },
      { key: 'fileNumber', label: 'رقم الملف', type: 'text', getValue: (employee) => employee.fileNumber },
      { key: 'militaryNumber', label: 'الرقم الوظيفي', type: 'text', getValue: (employee) => employee.militaryNumber },
      { key: 'civilId', label: 'الرقم المدني', type: 'text', getValue: (employee) => employee.civilId },
      { key: 'phone_number', label: 'رقم الهاتف', type: 'text', getValue: (employee) => employee.phone_number },
      { key: 'referenceNumber', label: 'رقم المرجع', type: 'text', getValue: (employee) => employee.referenceNumber },
      { key: 'jobTitle', label: 'المسمى الوظيفي', type: 'text', getValue: (employee) => employee.jobTitle },
      { key: 'jobGrade', label: 'الدرجة الوظيفية', type: 'select', getValue: (employee) => employee.jobGrade, options: unique(employees.map((employee) => employee.jobGrade)) },
      { key: 'professionalGroup', label: 'فئة الفنيون', type: 'select', getValue: (employee) => employee.professionalGroup, options: unique(employees.map((employee) => employee.professionalGroup)) },
      { key: 'department', label: 'الإدارة', type: 'select', getValue: (employee) => formatDepartmentLabel(employee.department, departmentMap), options: departments.map((department) => department.name) },
      { key: 'section', label: 'القسم', type: 'select', getValue: (employee) => formatSectionLabel(employee.section, sectionMap, employee.department), options: unique(sections.map((section) => section.name)) },
      { key: 'status', label: 'الحالة', type: 'select', getValue: (employee) => employee.status === 'active' ? 'في الخدمة' : 'خارج الخدمة', options: ['في الخدمة', 'خارج الخدمة'] },
      { key: 'nationality', label: 'الجنسية', type: 'select', getValue: (employee) => employee.nationality, options: unique(employees.map((employee) => employee.nationality)) },
      { key: 'age', label: 'العمر', type: 'number', getValue: (employee) => ageInYears(employee.birthDate) },
      { key: 'seniorityNumber', label: 'رقم الأقدمية', type: 'text', getValue: (employee) => employee.seniorityNumber },
      { key: 'birthDate', label: 'تاريخ الميلاد', type: 'text', getValue: (employee) => employee.birthDate },
      { key: 'hiringDate', label: 'تاريخ التعيين', type: 'text', getValue: (employee) => employee.hiringDate },
      { key: 'hasEducationCertificate', label: 'لديه شهادة', type: 'boolean', getValue: (employee) => employee.hasEducationCertificate === true },
      { key: 'educationCertificateType', label: 'المؤهل العلمي', type: 'select', getValue: (employee) => employee.educationCertificateType, options: unique(employees.map((employee) => employee.educationCertificateType)) },
      { key: 'educationSpecialization', label: 'التخصص', type: 'text', getValue: (employee) => employee.educationSpecialization },
      { key: 'hasWeapon', label: 'لديه جهاز اتصال', type: 'boolean', getValue: (employee) => employee.hasWeapon === true },
      { key: 'hasParking', label: 'لديه موقف', type: 'boolean', getValue: (employee) => employee.hasParking === true },
      { key: 'includeInShifts', label: 'مدرج في المناوبات', type: 'boolean', getValue: (employee) => employee.includeInShifts !== false },
      { key: 'excludeFromStatistics', label: 'مستثنى من الإحصائيات', type: 'boolean', getValue: (employee) => employee.excludeFromStatistics === true },
      { key: 'isSecondedOutsideGeneralAdministration', label: 'منتدب من خارج الإدارة', type: 'boolean', getValue: (employee) => employee.isSecondedOutsideGeneralAdministration === true },
      { key: 'secondmentLocation', label: 'جهة الندب', type: 'text', getValue: (employee) => employee.secondmentLocation },
      { key: 'reasonIfInactive', label: 'سبب خارج الخدمة', type: 'text', getValue: (employee) => employee.reasonIfInactive },
    ];
  }, [departmentMap, departments, employees, sectionMap, sections]);

  const fieldMap = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
  const defaultSectionOptions = useMemo(() => uniqueArabicOptions(sections.map((section) => section.name)), [sections]);
  const availableCategories = useMemo(() => {
    const defaultCats = ['قيادات', 'مشرفون', 'فنيون', 'إداريون'];
    const fromData = Array.from(new Set(employees.map((e) => String(e.category || '').trim()).filter(Boolean)));
    return Array.from(new Set([...defaultCats, ...fromData]));
  }, [employees]);

  const resolveConditionDepartmentId = (value: string) => {
    const normalizedValue = normalizeOrganizationName(value);
    if (!normalizedValue) return '';
    const matchedDepartment = departments.find((department) => {
      const departmentName = formatDepartmentLabel(department.name, departmentMap);
      return normalizeOrganizationName(department.name) === normalizedValue || normalizeOrganizationName(departmentName) === normalizedValue;
    });
    return matchedDepartment?.id || '';
  };

  const getSectionOptionsForCondition = (conditionIndex: number) => {
    const previousDepartmentCondition = [...conditions]
      .slice(0, conditionIndex)
      .reverse()
      .find((condition) => condition.fieldKey === 'department' && condition.operator === 'equals' && condition.value.trim());
    const departmentId = previousDepartmentCondition ? resolveConditionDepartmentId(previousDepartmentCondition.value) : '';
    if (!departmentId) return defaultSectionOptions;
    return uniqueArabicOptions(sections.filter((section) => section.departmentId === departmentId).map((section) => section.name));
  };

  const addCondition = () => {
    setConditions((current) => [
      ...current,
      { id: `condition_${Date.now()}`, fieldKey: 'name', operator: 'contains', value: '' },
    ]);
  };

  const updateCondition = (id: string, patch: Partial<ReportCondition>) => {
    setConditions((current) => current.map((condition) => {
      if (condition.id !== id) return condition;
      const next = { ...condition, ...patch };
      const field = fieldMap.get(next.fieldKey);
      if (patch.fieldKey && field) {
        next.operator = field.type === 'number' ? 'gte' : field.type === 'boolean' || field.type === 'select' ? 'equals' : 'contains';
        next.value = field.type === 'boolean' ? 'true' : '';
      }
      if (isPinnedConditionId(id)) {
        setPinnedConditions((currentPinned) => {
          const nextPinned = currentPinned.map((item) => item.id === id ? next : item);
          savePinnedConditions(nextPinned);
          return nextPinned;
        });
      }
      return next;
    }));
  };

  const removeCondition = (id: string) => {
    if (isPinnedConditionId(id)) {
      setPinnedConditions((currentPinned) => {
        const nextPinned = currentPinned.filter((condition) => condition.id !== id);
        savePinnedConditions(nextPinned);
        return nextPinned;
      });
    }
    setConditions((current) => current.filter((condition) => condition.id !== id));
  };

  const pinConditionAsDefault = (condition: ReportCondition) => {
    const nextPinned = makePinnedCondition(condition);
    setPinnedConditions((currentPinned) => {
      const nextPinnedConditions = [...currentPinned, nextPinned];
      savePinnedConditions(nextPinnedConditions);
      return nextPinnedConditions;
    });
    setConditions((current) => current.map((item) => item.id === condition.id ? nextPinned : item));
  };

  const buildTemplateSnapshot = (name: string, id = `report_template_${Date.now()}`): SavedReportTemplate => ({
    id,
    name,
    createdAt: new Date().toISOString(),
    title,
    subtitle,
    conditions: conditions.map((condition, index) => ({ ...condition, id: `condition_${Date.now()}_${index}` })),
    extraEmployeeIds,
    excludedEmployeeIds,
    selectedColumns,
    nameDisplayMode,
    categoryNameDisplayModes,
    reportOrientationMode,
    includeCategorySeparators,
    includeSummaryStats,
    summaryStatsFieldKey,
    hideDepartmentWord,
    omitJobTitleCategories,
  });

  const saveCurrentTemplate = () => {
    const name = templateName.trim() || `نموذج كشف ${new Date().toLocaleDateString('ar-KW')}`;
    const template = buildTemplateSnapshot(name);
    setReportTemplates((current) => {
      const next = [template, ...current].slice(0, 20);
      saveReportTemplates(next);
      return next;
    });
    setTemplateName('');
  };

  const updateTemplateFromCurrent = (templateId: string) => {
    setReportTemplates((current) => {
      const target = current.find((template) => template.id === templateId);
      if (!target) return current;
      const next = current.map((template) =>
        template.id === templateId
          ? buildTemplateSnapshot(templateName.trim() || template.name, template.id)
          : template
      );
      saveReportTemplates(next);
      return next;
    });
    setTemplateName('');
  };

  const applyTemplate = (template: SavedReportTemplate) => {
    setTitle(template.title || 'كشف مخصص لشؤون الموظفين');
    setSubtitle(template.subtitle || '');
    setConditions(template.conditions.map((condition, index) => ({
      ...condition,
      id: `condition_${Date.now()}_${index}`,
    })));
    setSelectedColumns(Array.isArray(template.selectedColumns) && template.selectedColumns.length > 0 ? template.selectedColumns : defaultColumnKeys);
    setExtraEmployeeIds(Array.isArray(template.extraEmployeeIds) ? template.extraEmployeeIds : []);
    setExcludedEmployeeIds(Array.isArray(template.excludedEmployeeIds) ? template.excludedEmployeeIds : []);
    setExtraEmployeeSearch('');
    setNameDisplayMode(template.nameDisplayMode || 'full');
    setCategoryNameDisplayModes(
      template.categoryNameDisplayModes && typeof template.categoryNameDisplayModes === 'object'
        ? template.categoryNameDisplayModes
        : {}
    );
    setReportOrientationMode(template.reportOrientationMode || 'auto');
    setIncludeCategorySeparators(!!template.includeCategorySeparators);
    setIncludeSummaryStats(!!template.includeSummaryStats);
    setSummaryStatsFieldKey(template.summaryStatsFieldKey || 'category');
    setHideDepartmentWord(!!template.hideDepartmentWord);
    setOmitJobTitleCategories(Array.isArray(template.omitJobTitleCategories) ? template.omitJobTitleCategories : []);
  };

  const removeTemplate = (templateId: string) => {
    setReportTemplates((current) => {
      const next = current.filter((template) => template.id !== templateId);
      saveReportTemplates(next);
      return next;
    });
  };

  const toggleColumn = (key: string) => {
    setSelectedColumns((current) => {
      if (key === 'serial') return current;
      return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    });
  };

  const resetReport = () => {
    setTitle('كشف مخصص لشؤون الموظفين');
    setSubtitle('');
    setNameDisplayMode('full');
    setCategoryNameDisplayModes({});
    setReportOrientationMode('auto');
    setIncludeSummaryStats(false);
    setSummaryStatsFieldKey('category');
    setIncludeCategorySeparators(false);
    setHideDepartmentWord(false);
    setOmitJobTitleCategories([]);
    setConditions(pinnedConditions);
    setExtraEmployeeIds([]);
    setExtraEmployeeSearch('');
    setExcludedEmployeeIds([]);
    setSelectedColumns(defaultColumnKeys);
  };

  const getOperators = (field?: ReportField) => {
    if (!field) return textOperators;
    if (field.type === 'select') return selectOperators;
    if (field.type === 'number') return numberOperators;
    if (field.type === 'boolean') return booleanOperators;
    return textOperators;
  };

  const conditionMatches = (employee: Employee, condition: ReportCondition) => {
    const field = fieldMap.get(condition.fieldKey);
    if (!field) return true;
    const rawValue = field.getValue(employee);
    const hasValue = rawValue !== undefined && rawValue !== null && rawValue !== '';
    if (condition.operator === 'empty') return !hasValue;
    if (condition.operator === 'notEmpty') return hasValue;
    if (field.type === 'number') {
      const current = Number(rawValue);
      const target = Number(condition.value);
      if (Number.isNaN(current) || Number.isNaN(target)) return false;
      if (condition.operator === 'gte') return current >= target;
      if (condition.operator === 'lte') return current <= target;
      if (condition.operator === 'equals') return current === target;
      if (condition.operator === 'notEquals') return current !== target;
      return false;
    }
    if (field.type === 'boolean') {
      const current = rawValue === true ? 'true' : 'false';
      return condition.operator === 'notEquals' ? current !== condition.value : current === condition.value;
    }
    const current = normalizeArabic(rawValue);
    const target = normalizeArabic(condition.value);
    if (condition.operator === 'equals') return current === target;
    if (condition.operator === 'notEquals') return current !== target;
    return current.includes(target);
  };

  const sortReportEmployees = (list: Employee[]) => {
    return [...list].sort((a, b) => {
      const categoryDiff = getCategoryOrder(a.category) - getCategoryOrder(b.category);
      if (categoryDiff !== 0) return categoryDiff;
      const rankDiff = getRankOrder(a.rank, a.category) - getRankOrder(b.rank, b.category);
      if (rankDiff !== 0) return rankDiff;
      return (formatEmployeeDisplayName(a) || a.name).localeCompare(formatEmployeeDisplayName(b) || b.name, 'ar');
    });
  };

  const conditionEmployees = useMemo(() => {
    return employees.filter((employee) => !isInactiveEmployee(employee) && conditions.every((condition) => conditionMatches(employee, condition)));
  }, [conditions, employees, fieldMap]);

  const reportEmployeesBeforeExclusions = useMemo(() => {
    const byId = new Map(conditionEmployees.map((employee) => [employee.id, employee]));
    extraEmployeeIds.forEach((id) => {
      const employee = employees.find((item) => item.id === id);
      if (employee) byId.set(employee.id, employee);
    });
    return sortReportEmployees(Array.from(byId.values()));
  }, [conditionEmployees, employees, extraEmployeeIds]);

  const filteredEmployees = useMemo(() => {
    const excluded = new Set(excludedEmployeeIds);
    return reportEmployeesBeforeExclusions.filter((employee) => !excluded.has(employee.id));
  }, [excludedEmployeeIds, reportEmployeesBeforeExclusions]);

  const conditionEmployeeIds = useMemo(
    () => new Set(conditionEmployees.map((employee) => employee.id)),
    [conditionEmployees]
  );

  const extraEmployees = useMemo(
    () => extraEmployeeIds
      .map((id) => employees.find((employee) => employee.id === id))
      .filter((employee): employee is Employee => !!employee),
    [employees, extraEmployeeIds]
  );

  const extraEmployeeCandidates = useMemo(() => {
    const selected = new Set(extraEmployeeIds);
    const searchTokens = getSearchTokens(extraEmployeeSearch);
    return employees
      .filter((employee) => !selected.has(employee.id) && !conditionEmployeeIds.has(employee.id))
      .filter((employee) => {
        return matchesArabicSearch([
          formatEmployeeDisplayName(employee) || employee.name,
          employee.name,
          employee.firstName,
          employee.secondName,
          employee.thirdName,
          employee.fourthName,
          employee.familyName,
          employee.rank,
          employee.fileNumber,
          employee.civilId,
          employee.department,
          employee.section,
          employee.jobTitle
        ], searchTokens);
      })
      .slice(0, 80);
  }, [conditionEmployeeIds, employees, extraEmployeeIds, extraEmployeeSearch]);

  const excludedEmployees = useMemo(
    () => excludedEmployeeIds
      .map((id) => employees.find((employee) => employee.id === id))
      .filter((employee): employee is Employee => !!employee),
    [employees, excludedEmployeeIds]
  );

  const addExtraEmployee = (employeeId: string) => {
    if (!employeeId) return;
    setExtraEmployeeIds((current) => current.includes(employeeId) ? current : [...current, employeeId]);
    setExcludedEmployeeIds((current) => current.filter((id) => id !== employeeId));
    setExtraEmployeeSearch('');
  };

  const removeExtraEmployee = (employeeId: string) => {
    setExtraEmployeeIds((current) => current.filter((id) => id !== employeeId));
  };

  const toggleEmployeeExclusion = (employeeId: string) => {
    setExcludedEmployeeIds((current) =>
      current.includes(employeeId)
        ? current.filter((id) => id !== employeeId)
        : [...current, employeeId]
    );
  };

  const visibleColumns = useMemo(() => {
    return selectedColumns
      .map((key) => key === 'serial'
        ? { key: 'serial', label: 'م', type: 'number' as FieldType, getValue: () => '' }
        : fieldMap.get(key))
      .filter((field): field is ReportField & { key: string } => !!field);
  }, [fieldMap, selectedColumns]);

  const activeConditionCount = conditions.length;
  const activeColumnCount = Math.max(selectedColumns.length, 1);
  const resolvedReportOrientation = reportOrientationMode === 'auto'
    ? activeColumnCount > 6 ? 'landscape' : 'portrait'
    : reportOrientationMode;
  const resolvedReportOrientationLabel = resolvedReportOrientation === 'landscape' ? 'أفقي' : 'رأسي';

  const summaryStatsField = fieldMap.get(summaryStatsFieldKey) || fieldMap.get('category');
  const summaryStatsRows = useMemo(() => {
    if (!includeSummaryStats || !summaryStatsField) return [];
    const counts = filteredEmployees.reduce<Record<string, number>>((acc, employee) => {
      const rawValue = summaryStatsField.getValue(employee);
      const label = rawValue === true
        ? 'نعم'
        : rawValue === false
          ? 'لا'
          : String(rawValue || 'غير مسجل').trim() || 'غير مسجل';
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    }, {});
    const categoryOrder = ['قيادات', 'مشرفون', 'فنيون', 'إداريون'];
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        if (summaryStatsField.key === 'category') {
          const indexA = categoryOrder.indexOf(a.label);
          const indexB = categoryOrder.indexOf(b.label);
          const safeA = indexA === -1 ? categoryOrder.length : indexA;
          const safeB = indexB === -1 ? categoryOrder.length : indexB;
          if (safeA !== safeB) return safeA - safeB;
        }
        return b.count - a.count || a.label.localeCompare(b.label, 'ar');
      });
  }, [filteredEmployees, includeSummaryStats, summaryStatsField]);

  const resolveEmployeeNameDisplayMode = (employee: Employee): NameDisplayMode => {
    const employeeCategory = String(employee.category || '').trim();
    if (employeeCategory && categoryNameDisplayModes[employeeCategory]) {
      return categoryNameDisplayModes[employeeCategory];
    }
    return nameDisplayMode;
  };

  const handleCategoryNameDisplayModeChange = (category: string, mode: NameDisplayMode | 'inherit') => {
    setCategoryNameDisplayModes((current) => {
      const next = { ...current };
      if (mode === 'inherit' || !mode) {
        delete next[category];
      } else {
        next[category] = mode;
      }
      return next;
    });
  };

  const resetCategoryNameDisplayModes = () => {
    setCategoryNameDisplayModes({});
  };

  const getPrintableValue = (employee: Employee, column: ReportField & { key: string }, index: number) => {
    if (column.key === 'serial') return index + 1;
    if (column.key === 'name') {
      const mode = resolveEmployeeNameDisplayMode(employee);
      return formatReportName(employee, mode);
    }
    if (column.key === 'jobTitle') {
      const employeeCategory = String(employee.category || '').trim();
      if (omitJobTitleCategories.includes(employeeCategory)) {
        return '';
      }
    }
    const rawValue = column.getValue(employee);
    if (column.key === 'department' && hideDepartmentWord && typeof rawValue === 'string') {
      return rawValue.replace(/(?:^|\s)(?:إدارة|ادارة|الإدارة|الادارة)(?=\s|$)/gu, '').replace(/\s+/g, ' ').trim() || rawValue;
    }
    return rawValue;
  };

  const exportHeaders = useMemo(() => visibleColumns.map((column) => column.label), [visibleColumns]);
  const isNumericColumn = (column: ReportField & { key: string }) => column.type === 'number' || numericReportColumnKeys.has(column.key);

  const getEmployeeCategoryLabel = (employee: Employee) => String(employee.category || 'غير محدد').trim() || 'غير محدد';

  const getCategorySeparatedRows = (list: Employee[]): CategoryReportRow[] => {
    let lastCategory = '';
    let categoryIndex = 0;
    const rows: CategoryReportRow[] = [];
    list.forEach((employee, globalIndex) => {
      const category = getEmployeeCategoryLabel(employee);
      if (includeCategorySeparators && category !== lastCategory) {
        rows.push({ type: 'category', label: category, startsNewPage: rows.length > 0 });
        lastCategory = category;
        categoryIndex = 0;
      }
      rows.push({
        type: 'employee',
        employee,
        index: includeCategorySeparators ? categoryIndex : globalIndex,
        globalIndex,
      });
      categoryIndex += 1;
    });
    return rows;
  };

  const exportRows = useMemo(
    () => getCategorySeparatedRows(filteredEmployees).map((row) => row.type === 'category'
      ? { type: 'category' as const, label: row.label, startsNewPage: row.startsNewPage }
      : {
        type: 'employee' as const,
        cells: visibleColumns.map((column) => {
          const isJobTitleOmitted = column.key === 'jobTitle' && omitJobTitleCategories.includes(String(row.employee.category || '').trim());
          const printableVal = getPrintableValue(row.employee, column, row.index);
          return {
            columnKey: column.key,
            value: isJobTitleOmitted ? '' : formatExportValue(printableVal),
            isNumeric: isNumericColumn(column),
          };
        }),
      }),
    [categoryNameDisplayModes, filteredEmployees, hideDepartmentWord, includeCategorySeparators, nameDisplayMode, omitJobTitleCategories, visibleColumns]
  );

  const getVisibleSerialIndex = (employee: Employee) => {
    const currentIndex = reportEmployeesBeforeExclusions.findIndex((item) => item.id === employee.id);
    if (currentIndex < 0) return 0;
    const visibleBefore = reportEmployeesBeforeExclusions
      .slice(0, currentIndex + 1)
      .filter((item) => !excludedEmployeeIds.includes(item.id));
    if (!includeCategorySeparators) return visibleBefore.length - 1;
    const category = getEmployeeCategoryLabel(employee);
    return visibleBefore.filter((item) => getEmployeeCategoryLabel(item) === category).length - 1;
  };

  const getReportFileName = (extension: string) => `${sanitizeFileName(title)}-${new Date().toISOString().slice(0, 10)}.${extension}`;

  const exportToExcel = () => {
    const columnCount = Math.max(exportHeaders.length, 1);
    const headerCells = exportHeaders.map((header, index) => `<th class="${isNumericColumn(visibleColumns[index]) ? 'numeric-cell' : ''}">${escapeHtml(header)}</th>`).join('');
    const dataRows = exportRows.length > 0
      ? exportRows.map((row) => row.type === 'category'
        ? `<tr class="category-row ${row.startsNewPage ? 'report-page-break' : ''}"><td colspan="${columnCount}">${escapeHtml(row.label)}</td></tr>`
        : `<tr>${row.cells.map((cell) => `<td class="text-cell ${cell.isNumeric ? 'numeric-cell' : ''}">${escapeHtml(cell.value)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${columnCount}">لا توجد نتائج مطابقة للشروط الحالية.</td></tr>`;

    const summaryTable = includeSummaryStats && summaryStatsRows.length > 0
      ? `
        <h3>إحصائية حسب ${escapeHtml(summaryStatsField?.label || 'الحقل المختار')}</h3>
        <table>
          <thead>
            <tr>
              <th>${escapeHtml(summaryStatsField?.label || 'البند')}</th>
              <th>العدد</th>
            </tr>
          </thead>
          <tbody>
            ${summaryStatsRows.map((row) => `<tr><td class="text-cell">${escapeHtml(row.label)}</td><td class="numeric-cell">${row.count}</td></tr>`).join('')}
            <tr class="total-row"><td>الإجمالي</td><td class="numeric-cell">${filteredEmployees.length}</td></tr>
          </tbody>
        </table>
      `
      : '';

    const workbook = `
      <!doctype html>
      <html dir="rtl">
        <head>
          <meta charset="utf-8" />
          <style>
            body { direction: rtl; font-family: 'Times New Roman', serif; color: #000; }
            h2, h3, p { text-align: center; margin: 0 0 8px; }
            h2, h3 { font-family: 'Times New Roman', serif; font-size: 18px; font-weight: normal; }
            p { font-family: 'Times New Roman', serif; font-size: 14px; font-weight: normal; color: #555; }
            table { width: 100%; border-collapse: collapse; direction: rtl; table-layout: auto; }
            th, td { border: 1px solid #000; padding: 8px 4px; text-align: center; vertical-align: middle; font-family: 'Times New Roman', serif; font-size: 14px; line-height: 1.25; color: #000; font-weight: normal; }
            th { background: #f3f4f6; font-family: 'Times New Roman', serif; font-size: 12px; font-weight: normal; }
            tr:nth-child(even):not(.category-row):not(.total-row) td { background: #f7f7f7; }
            .category-row td { background: #efefef; font-family: 'Times New Roman', serif; font-size: 12px; font-weight: normal; }
            .total-row td { background: #e6e6e6; font-family: 'Times New Roman', serif; font-size: 12px; font-weight: normal; }
            .text-cell { mso-number-format: "\\@"; }
            .numeric-cell { font-family: 'Times New Roman', serif; font-weight: 700; }
            .report-page-break { page-break-before: always; break-before: page; }
          </style>
        </head>
        <body>
          <h2>${escapeHtml(title)}</h2>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
          <table>
            <thead><tr>${headerCells}</tr></thead>
            <tbody>
              ${dataRows}
              <tr class="total-row"><td colspan="${columnCount}">الإجمالي: ${filteredEmployees.length}</td></tr>
            </tbody>
          </table>
          ${summaryTable}
        </body>
      </html>
    `;

    saveAs(new Blob([`\ufeff${workbook}`], { type: 'application/vnd.ms-excel;charset=utf-8' }), getReportFileName('xls'));
  };

  const exportToWord = async () => {
    const ROW_HEIGHT_06CM = Math.round(0.6 * 567); // 340 twips (0.6 cm)

    const cellBorders = {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'B7B7B7' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'B7B7B7' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'B7B7B7' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'B7B7B7' },
    };

    const makeCell = (
      text: string,
      options: {
        isHeader?: boolean;
        columnKey?: string;
        isNumeric?: boolean;
        columnSpan?: number;
        fill?: string;
        overrideFontSize?: number;
        overrideFont?: typeof SULTAN_FONT;
        overrideBold?: boolean;
      } = {}
    ) => {
      const isHeader = !!options.isHeader;
      const isNumeric = !!options.isNumeric;
      const columnKey = options.columnKey;

      let font = SULTAN_FONT;
      let fontSize = 28; // 14pt
      let isBold = false;

      if (isHeader) {
        font = SULTAN_FONT;
        fontSize = 32; // 16pt
        isBold = true;
      } else if (columnKey === 'rank' || columnKey === 'name') {
        font = SULTAN_FONT;
        fontSize = 32; // 16pt
        isBold = false;
      } else if (isNumeric) {
        font = TIMES_FONT;
        fontSize = 28; // 14pt
        isBold = true;
      } else {
        font = SULTAN_FONT;
        fontSize = 28; // 14pt
        isBold = false;
      }

      if (options.overrideFontSize !== undefined) fontSize = options.overrideFontSize;
      if (options.overrideFont !== undefined) font = options.overrideFont;
      if (options.overrideBold !== undefined) isBold = options.overrideBold;

      return new TableCell({
        children: [
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0, line: 260 },
            children: [
              new TextRun({
                text,
                bold: isBold,
                size: fontSize,
                sizeComplexScript: fontSize,
                font,
                color: '000000',
                rightToLeft: true,
              }),
            ],
          }),
        ],
        verticalAlign: VerticalAlign.CENTER,
        borders: cellBorders,
        margins: { top: 90, bottom: 90, left: 100, right: 100 },
        ...(options.columnSpan && options.columnSpan > 1 ? { columnSpan: options.columnSpan } : {}),
        shading: {
          type: ShadingType.CLEAR,
          color: 'auto',
          fill: isHeader ? 'F2F2F2' : (options.fill || 'FFFFFF'),
        },
      });
    };

    const makeReportTable = (rows: TableRow[]) => new Table({
      rows: [
        new TableRow({
          tableHeader: true,
          height: { value: ROW_HEIGHT_06CM, rule: HeightRule.ATLEAST },
          children: exportHeaders.map((header, index) =>
            makeCell(header, {
              isHeader: true,
              columnKey: visibleColumns[index]?.key,
              isNumeric: isNumericColumn(visibleColumns[index]),
            })
          ),
        }),
        ...rows,
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
      alignment: AlignmentType.CENTER,
      visuallyRightToLeft: true,
    });

    const reportBlocks: Array<Paragraph | Table> = [];
    if (exportRows.length > 0) {
      let currentRows: TableRow[] = [];
      let currentLabel = '';
      let currentStartsNewPage = false;

      const flushGroup = () => {
        if (!currentRows.length) return;
        if (includeCategorySeparators && currentLabel) {
          reportBlocks.push(new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            pageBreakBefore: currentStartsNewPage,
            spacing: { before: currentStartsNewPage ? 0 : 140, after: 80 },
            children: [
              new TextRun({
                text: currentLabel,
                bold: true,
                size: 32, // 16pt
                sizeComplexScript: 32,
                font: SULTAN_FONT,
                rightToLeft: true,
              }),
            ],
          }));
        }
        reportBlocks.push(makeReportTable(currentRows));
        currentRows = [];
      };

      exportRows.forEach((row) => {
        if (row.type === 'category') {
          flushGroup();
          currentLabel = row.label;
          currentStartsNewPage = row.startsNewPage;
          return;
        }
        currentRows.push(new TableRow({
          height: { value: ROW_HEIGHT_06CM, rule: HeightRule.ATLEAST },
          children: row.cells.map((cell) =>
            makeCell(cell.value, {
              columnKey: cell.columnKey,
              isNumeric: cell.isNumeric,
            })
          ),
        }));
      });
      flushGroup();
    } else {
      reportBlocks.push(makeReportTable([
        new TableRow({
          height: { value: ROW_HEIGHT_06CM, rule: HeightRule.ATLEAST },
          children: [makeCell('لا توجد نتائج مطابقة للشروط الحالية.', { columnSpan: exportHeaders.length })],
        }),
      ]));
    }

    const children = [
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.CENTER,
        spacing: { after: subtitle ? 80 : 160 },
        children: [
          new TextRun({
            text: title,
            bold: true,
            size: 36, // 18pt
            sizeComplexScript: 36,
            font: SULTAN_FONT,
            rightToLeft: true,
          }),
        ],
      }),
      ...(subtitle
        ? [
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
            children: [
              new TextRun({
                text: subtitle,
                bold: false,
                size: 26, // 13pt
                sizeComplexScript: 26,
                font: SULTAN_FONT,
                color: '555555',
                rightToLeft: true,
              }),
            ],
          }),
        ]
        : []),
      ...reportBlocks,
      new Table({
        rows: [
          new TableRow({
            height: { value: ROW_HEIGHT_06CM, rule: HeightRule.ATLEAST },
            children: [
              makeCell(`الإجمالي: ${filteredEmployees.length}`, {
                isHeader: false,
                columnSpan: exportHeaders.length,
                fill: 'EAEAEA',
                overrideFontSize: 28,
                overrideBold: true,
                overrideFont: SULTAN_FONT,
              }),
            ],
          }),
        ],
        width: { size: 100, type: WidthType.PERCENTAGE },
        alignment: AlignmentType.CENTER,
        visuallyRightToLeft: true,
      }),
      ...(includeSummaryStats && summaryStatsRows.length > 0
        ? [
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 100 },
            children: [
              new TextRun({
                text: `إحصائية حسب ${summaryStatsField?.label || 'الحقل المختار'}`,
                bold: true,
                size: 32, // 16pt
                sizeComplexScript: 32,
                font: SULTAN_FONT,
                rightToLeft: true,
              }),
            ],
          }),
          new Table({
            rows: [
              new TableRow({
                tableHeader: true,
                height: { value: ROW_HEIGHT_06CM, rule: HeightRule.ATLEAST },
                children: [
                  makeCell(summaryStatsField?.label || 'البند', { isHeader: true }),
                  makeCell('العدد', { isHeader: true }),
                ],
              }),
              ...summaryStatsRows.map((row) =>
                new TableRow({
                  height: { value: ROW_HEIGHT_06CM, rule: HeightRule.ATLEAST },
                  children: [
                    makeCell(row.label, { overrideFont: SULTAN_FONT, overrideFontSize: 28 }),
                    makeCell(String(row.count), { isNumeric: true, overrideFont: TIMES_FONT, overrideFontSize: 28, overrideBold: true }),
                  ],
                })
              ),
              new TableRow({
                height: { value: ROW_HEIGHT_06CM, rule: HeightRule.ATLEAST },
                children: [
                  makeCell('الإجمالي', { fill: 'EAEAEA', overrideBold: true, overrideFont: SULTAN_FONT, overrideFontSize: 28 }),
                  makeCell(String(filteredEmployees.length), { fill: 'EAEAEA', isNumeric: true, overrideFont: TIMES_FONT, overrideFontSize: 28, overrideBold: true }),
                ],
              }),
            ],
            width: { size: 100, type: WidthType.PERCENTAGE },
            alignment: AlignmentType.CENTER,
            visuallyRightToLeft: true,
          }),
        ]
        : []),
    ];

    const sultanFontData = await fetchSultanMediumFont();

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: SULTAN_FONT,
              rightToLeft: true,
            },
          },
        },
      },
      fonts: sultanFontData ? [
        { name: 'Sultan Medium', data: sultanFontData as any },
      ] : undefined,
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: oneCentimeterInTwips,
                right: oneCentimeterInTwips,
                bottom: oneCentimeterInTwips,
                left: oneCentimeterInTwips,
              },
              size: { orientation: resolvedReportOrientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            },
          },
          children,
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, getReportFileName('docx'));
  };

  if (loading) return <LoadingPage variant="employees" />;
  if (error) return <div className="p-8 text-center font-bold text-red-600">{error}</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-gray-100 p-6 text-slate-900" dir="rtl">
      <style>{`
        @media print {
          @page { margin: 1cm; size: ${resolvedReportOrientation === 'landscape' ? 'landscape' : 'portrait'}; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          body * { visibility: hidden; }
          .employee-report-print, .employee-report-print * { visibility: visible; }
          .employee-report-print { position: absolute; inset: 0; width: 100%; background: white; padding: 0 !important; border: 0 !important; box-shadow: none !important; }
          .employee-report-print > div { padding-left: 0 !important; padding-right: 0 !important; }
          .print-hide { display: none !important; }
          .screen-only { display: none !important; }
          .print-only { display: table-row-group !important; }
          .employee-report-title { padding: 0 0 10px !important; border: 0 !important; background: white !important; }
          .employee-report-title h2 { font-family: 'Times New Roman', serif !important; font-size: 21px, !important; font-weight: normal !important; line-height: 1.35 !important; color: #000 !important; }
          .employee-report-title p { margin-top: 2px !important; font-family: 'Times New Roman', serif !important; font-size: 14px !important; font-weight: normal !important; color: #555 !important; }
          .employee-report-print h3 { font-family: 'Times New Roman', serif !important; font-weight:   !important; }
          .employee-report-table { width: 100%; border-collapse: collapse; table-layout: auto; font-family: 'Times New Roman', serif !important; font-size: 14px; line-height: 1.25; }
          .employee-report-table th,
          .employee-report-table td { border: 1px solid #000 !important; padding: 8px 4px !important; text-align: center; vertical-align: middle; color: #000 !important; font-weight: normal !important; }
          .employee-report-table th { border: 1px solid #000 !important; padding: 8px 4px !important; text-align: center; vertical-align: middle; color: #000 !important; background: #f3f4f6 !important; font-family: 'Times New Roman', serif !important; font-size: 12px !important; font-weight: normal !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .employee-report-table tbody tr:nth-child(even):not(.report-category-row):not(.report-total-row) td { background: #f7f7f7 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-category-row td { background: #efefef !important; font-family: 'Times New Roman', serif !important; font-size: 16px !important; font-weight: normal !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-total-row td { background: #e6e6e6 !important; font-family: 'Times New Roman', serif !important; padding: 6px !important; font-size: 14px !important; font-weight: normal !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-page-break { break-before: page; page-break-before: always; }
          .report-number-cell { font-family: 'Times New Roman', serif !important; }
          .report-nowrap { white-space: nowrap; }
        }
        @media screen {
          .print-only { display: none !important; }
          .employee-report-table { border-collapse: collapse; line-height: 1.35; }
          .employee-report-table th,
          .employee-report-table td { border-color: #c4c4c4; padding: 6px 8px; font-weight: 700; }
          .employee-report-table th { background: #f2f2f2; color: #111827; font-size: 14px; }
          .employee-report-table tbody tr:nth-child(even):not(.report-category-row):not(.report-total-row) td { background: #f8fafc; }
          .report-category-row td { background: #efefef; color: #111827; font-weight: 900; }
          .report-total-row td { background: #e6e6e6; color: #111827; font-weight: 900; }
        }
      `}</style>

      <div className="mx-auto max-w-[1680px] space-y-5">
        <div className="print-hide overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-l from-slate-950 via-blue-950 to-slate-900 p-6 text-white">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white ring-1 ring-white/15">
                  <FileText className="h-7 w-7" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-black text-blue-100">منشئ كشوف شؤون الموظفين</div>
                  <h1 className="mt-1 text-3xl font-black">تقارير مخصصة</h1>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <button onClick={resetReport} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/15">
                  <RotateCcw className="h-4 w-4" />
                  إعادة تعيين
                </button>
                <button onClick={() => window.print()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700">
                  <Printer className="h-4 w-4" />
                  طباعة / PDF
                </button>
                <button onClick={exportToWord} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700">
                  <FileDown className="h-4 w-4" />
                  Word
                </button>
                <button onClick={exportToExcel} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700">
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel
                </button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 lg:grid-cols-6">
            {[
              { label: 'نتائج الكشف', value: filteredEmployees.length, icon: Users, color: 'text-blue-700 bg-blue-50' },
              { label: 'الشروط', value: activeConditionCount, icon: Filter, color: 'text-emerald-700 bg-emerald-50' },
              { label: 'الأعمدة', value: activeColumnCount, icon: Columns3, color: 'text-violet-700 bg-violet-50' },
              { label: 'الإضافات', value: extraEmployees.length, icon: UserPlus, color: 'text-cyan-700 bg-cyan-50' },
              { label: 'الإلغاءات', value: excludedEmployees.length, icon: XCircle, color: 'text-rose-700 bg-rose-50' },
              { label: 'الصفحة', value: resolvedReportOrientationLabel, icon: Settings, color: 'text-amber-700 bg-amber-50' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div>
                    <div className="text-[11px] font-bold text-slate-500">{item.label}</div>
                    <div className="mt-1 text-xl font-black text-slate-950">{item.value}</div>
                  </div>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.color}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="print-hide rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                <Save className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-950">النماذج الجاهزة</h2>
                <p className="text-xs font-bold text-slate-500">يحفظ النموذج العنوان، الشروط، الإضافات، الإلغاءات، الأعمدة، واتجاه الصفحة.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(220px,1fr)_auto] lg:w-[650px]">
              <button
                type="button"
                onClick={() => setShowReportTemplates((current) => !current)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-700 hover:bg-slate-100"
              >
                <Eye className="h-4 w-4" />
                {showReportTemplates ? 'إخفاء النماذج' : `عرض النماذج (${reportTemplates.length})`}
              </button>
              <input
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                placeholder="اسم النموذج الجاهز"
              />
              <button
                type="button"
                onClick={saveCurrentTemplate}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
              >
                <Save className="h-4 w-4" />
                حفظ نموذج
              </button>
            </div>
          </div>

          {showReportTemplates && (
            reportTemplates.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {reportTemplates.map((template) => (
                  <div key={template.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="min-w-0 truncate text-sm font-black text-slate-950">{template.name}</div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => applyTemplate(template)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100"
                        title="استرجاع النموذج"
                      >
                        <FolderOpen className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateTemplateFromCurrent(template.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        title="تعديل النموذج من الإعدادات الحالية"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeTemplate(template.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-700 hover:bg-red-100"
                        title="حذف النموذج"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-500">
                لا توجد نماذج محفوظة بعد.
              </div>
            )
          )}
        </div>

        <div className="print-hide grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_410px]">
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[390px_minmax(0,1fr)]">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                    <SlidersHorizontal className="h-5 w-5" />
                  </div>
                  <h2 className="text-base font-black text-slate-950">تموظف الكشف</h2>
                </div>
                <div className="space-y-4">
                  <label className="space-y-2">
                    <span className="text-xs font-bold text-slate-600">عنوان الكشف</span>
                    <input value={title} onChange={(event) => setTitle(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100" />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs font-bold text-slate-600">عنوان فرعي</span>
                    <input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100" />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs font-bold text-slate-600">صيغة الاسم العامة (الافتراضية)</span>
                    <select value={nameDisplayMode} onChange={(event) => setNameDisplayMode(event.target.value as NameDisplayMode)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100">
                      <option value="full">الاسم كامل</option>
                      <option value="triple">ثلاثي</option>
                      <option value="quad">رباعي</option>
                      <option value="quint">خماسي</option>
                    </select>
                  </label>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-slate-800">تخصيص صيغة الاسم حسب الفئة</span>
                          {Object.keys(categoryNameDisplayModes).length > 0 && (
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">
                              {Object.keys(categoryNameDisplayModes).length} فئات مخصصة
                            </span>
                          )}
                        </div>
                        <span className="block text-[11px] font-medium text-slate-500 mt-0.5">
                          حدد صيغة خاصة لكل فئة (مثل: قيادات ثلاثي، ومشرفون رباعي... إلخ)
                        </span>
                      </div>
                      {Object.keys(categoryNameDisplayModes).length > 0 && (
                        <button
                          type="button"
                          onClick={resetCategoryNameDisplayModes}
                          className="text-[11px] font-bold text-blue-600 hover:text-blue-800 underline transition shrink-0"
                        >
                          إلغاء التخصيص
                        </button>
                      )}
                    </div>

                    <div className="space-y-2 pt-1">
                      {availableCategories.map((cat) => {
                        const activeMode = categoryNameDisplayModes[cat] || 'inherit';
                        const isCustomized = !!categoryNameDisplayModes[cat];
                        return (
                          <div
                            key={cat}
                            className={`flex items-center justify-between gap-2 rounded-xl border p-2 text-xs transition ${
                              isCustomized
                                ? 'border-blue-200 bg-white shadow-sm ring-1 ring-blue-100'
                                : 'border-slate-200/80 bg-white/60 hover:bg-white'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${isCustomized ? 'bg-blue-600' : 'bg-slate-300'}`} />
                              <span className="font-bold text-slate-800 truncate">{cat}</span>
                              {isCustomized && (
                                <span className="text-[10px] font-extrabold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md">
                                  {nameDisplayModeLabels[categoryNameDisplayModes[cat]]}
                                </span>
                              )}
                            </div>
                            <select
                              value={activeMode}
                              onChange={(e) => handleCategoryNameDisplayModeChange(cat, e.target.value as NameDisplayMode | 'inherit')}
                              className={`h-8 rounded-lg border px-2 text-xs font-bold outline-none transition cursor-pointer ${
                                isCustomized
                                  ? 'border-blue-300 bg-blue-50/80 text-blue-800 focus:ring-2 focus:ring-blue-200'
                                  : 'border-slate-200 bg-slate-50 text-slate-600 focus:border-blue-400 focus:bg-white'
                              }`}
                            >
                              <option value="inherit">افتراضي ({nameDisplayModeLabels[nameDisplayMode]})</option>
                              <option value="triple">ثلاثي</option>
                              <option value="quad">رباعي</option>
                              <option value="quint">خماسي</option>
                              <option value="full">الاسم كامل</option>
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <label className="space-y-2">
                    <span className="text-xs font-bold text-slate-600">اتجاه الصفحة</span>
                    <select
                      value={reportOrientationMode}
                      onChange={(event) => setReportOrientationMode(event.target.value as ReportOrientationMode)}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    >
                      <option value="auto">تلقائي حسب عدد الأعمدة</option>
                      <option value="portrait">رأسي</option>
                      <option value="landscape">أفقي</option>
                    </select>
                    <span className="block text-[11px] font-bold text-slate-500">المحدد حالياً: {resolvedReportOrientationLabel}</span>
                  </label>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <label className="flex items-center justify-between gap-3">
                      <span className="text-sm font-black text-slate-800">إحصائية نهاية الكشف</span>
                      <input
                        type="checkbox"
                        checked={includeSummaryStats}
                        onChange={(event) => setIncludeSummaryStats(event.target.checked)}
                        className="h-4 w-4 accent-blue-600"
                      />
                    </label>
                    <select
                      value={summaryStatsFieldKey}
                      onChange={(event) => setSummaryStatsFieldKey(event.target.value)}
                      disabled={!includeSummaryStats}
                      className="mt-3 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-60 focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    >
                      {fields
                        .filter((field) => field.key !== 'smartOrder' && field.key !== 'serial' && field.key !== 'name')
                        .map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                    </select>
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <span className="text-sm font-black text-slate-800">فصل الفئات في الجدول</span>
                    <input
                      type="checkbox"
                      checked={includeCategorySeparators}
                      onChange={(event) => setIncludeCategorySeparators(event.target.checked)}
                      className="h-4 w-4 accent-blue-600"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 cursor-pointer transition hover:bg-slate-100/80">
                    <div>
                      <span className="text-sm font-black text-slate-800">إخفاء كلمة "إدارة"</span>
                      <span className="block text-[11px] font-bold text-slate-500">حذف كلمة إدارة من عامود الإدارة</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={hideDepartmentWord}
                      onChange={(event) => setHideDepartmentWord(event.target.checked)}
                      className="h-4 w-4 rounded accent-blue-600 cursor-pointer"
                    />
                  </label>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2">
                      <span className="text-sm font-black text-slate-800">حذف المسمى الوظيفي لفئات معينة</span>
                      <span className="block text-[11px] font-bold text-slate-500">اختر الفئات لإفراغ خانة المسمى الوظيفي لها في الكشف</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {availableCategories.map((cat) => {
                        const isSelected = omitJobTitleCategories.includes(cat);
                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => {
                              setOmitJobTitleCategories((current) =>
                                current.includes(cat) ? current.filter((item) => item !== cat) : [...current, cat]
                              );
                            }}
                            className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-bold transition ${
                              isSelected
                                ? 'border-red-300 bg-red-50 text-red-700 shadow-sm'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <span>{cat}</span>
                            <span className={`h-2.5 w-2.5 rounded-full ${isSelected ? 'bg-red-600 ring-2 ring-red-200' : 'bg-slate-300'}`} />
                          </button>
                        );
                      })}
                    </div>
                    {omitJobTitleCategories.length > 0 && (
                      <div className="mt-2.5 flex items-center justify-between border-t border-slate-200/80 pt-2 text-[11px] font-bold text-red-600">
                        <span>تم تحديد: {omitJobTitleCategories.join('، ')}</span>
                        <button
                          type="button"
                          onClick={() => setOmitJobTitleCategories([])}
                          className="underline hover:text-red-800"
                        >
                          إلغاء التحديد
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                      <Filter className="h-5 w-5" />
                    </div>
                    <h2 className="text-base font-black text-slate-950">شروط التقرير</h2>
                  </div>
                  <button onClick={addCondition} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700">
                    <Plus className="h-4 w-4" />
                    إضافة شرط
                  </button>
                </div>

                <div className="space-y-3">
                  {conditions.map((condition, index) => {
                    const field = fieldMap.get(condition.fieldKey);
                    const operators = getOperators(field);
                    const isPinnedCondition = isPinnedConditionId(condition.id);
                    const selectOptions = field?.key === 'section' ? getSectionOptionsForCondition(index) : field?.options || [];
                    const selectValue = condition.value && selectOptions.includes(condition.value) ? condition.value : '';
                    return (
                      <div key={condition.id} className={`grid min-w-0 grid-cols-1 items-center gap-2 overflow-hidden rounded-2xl border p-2 lg:grid-cols-[42px_minmax(110px,1fr)_108px_minmax(120px,1fr)_76px] xl:grid-cols-[42px_minmax(130px,1fr)_116px_minmax(140px,1fr)_76px] ${isPinnedCondition ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-200 bg-slate-50'}`}>
                        <div className="flex h-9 min-w-0 items-center justify-center rounded-lg bg-white px-2 text-xs font-black text-slate-500 ring-1 ring-slate-200" title={isPinnedCondition ? 'مثبت افتراضياً' : undefined}>
                          {isPinnedCondition ? <Pin className="h-4 w-4 text-emerald-700" /> : index + 1}
                        </div>
                        <select value={condition.fieldKey} onChange={(event) => updateCondition(condition.id, { fieldKey: event.target.value })} className="h-9 min-w-0 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">
                          {fields.filter((item) => item.key !== 'smartOrder').map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                        </select>
                        <select value={condition.operator} onChange={(event) => updateCondition(condition.id, { operator: event.target.value as Operator })} className="h-9 min-w-0 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">
                          {operators.map((operator) => <option key={operator} value={operator}>{operatorLabels[operator]}</option>)}
                        </select>
                        {condition.operator === 'empty' || condition.operator === 'notEmpty' ? (
                          <div className="flex h-9 min-w-0 items-center rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-400">لا يحتاج قيمة</div>
                        ) : field?.type === 'select' ? (
                          <select value={selectValue} onChange={(event) => updateCondition(condition.id, { value: event.target.value })} className="h-9 min-w-0 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">
                            <option value="">اختر قيمة</option>
                            {selectOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        ) : field?.type === 'boolean' ? (
                          <select value={condition.value || 'true'} onChange={(event) => updateCondition(condition.id, { value: event.target.value })} className="h-9 min-w-0 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">
                            <option value="true">نعم</option>
                            <option value="false">لا</option>
                          </select>
                        ) : (
                          <input value={condition.value} onChange={(event) => updateCondition(condition.id, { value: event.target.value })} className="h-9 min-w-0 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" placeholder="اكتب القيمة" />
                        )}
                        <div className="flex h-9 min-w-0 items-center justify-center gap-1 rounded-lg bg-white/80 px-1 ring-1 ring-slate-200">
                          {!isPinnedCondition && (
                            <button
                              type="button"
                              onClick={() => pinConditionAsDefault(condition)}
                              title="تثبيت كشرط افتراضي"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-700 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                            >
                              <Pin className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button onClick={() => removeCondition(condition.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-100 bg-red-50 text-red-700 hover:bg-red-100" title={isPinnedCondition ? 'حذف الشرط المثبت' : 'حذف الشرط'}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {conditions.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
                      لا توجد شروط.
                    </div>
                  )}
                </div>

                <div className="mt-5 border-t border-slate-200 pt-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                        <UserPlus className="h-5 w-5" />
                      </div>
                      <h2 className="text-base font-black text-slate-950">إضافات استثنائية ضمن الشروط</h2>
                    </div>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                      {extraEmployees.length}
                    </span>
                  </div>

                  <div className="relative">
                    <input
                      value={extraEmployeeSearch}
                      onChange={(event) => setExtraEmployeeSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && extraEmployeeCandidates.length > 0) {
                          event.preventDefault();
                          addExtraEmployee(extraEmployeeCandidates[0].id);
                        }
                      }}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
                      placeholder="ابحث بالاسم، المسمى الوظيفي، رقم الملف..."
                    />
                    {extraEmployeeSearch.trim() && (
                      <div className="absolute right-0 left-0 top-full z-20 mt-2 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                        {extraEmployeeCandidates.length > 0 ? (
                          extraEmployeeCandidates.slice(0, 12).map((employee) => (
                            <button
                              key={employee.id}
                              type="button"
                              onClick={() => addExtraEmployee(employee.id)}
                              className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-right text-sm transition last:border-b-0 hover:bg-blue-50"
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-black text-slate-900">
                                  {(employee.rank ? `${employee.rank} / ` : '')}{formatEmployeeDisplayName(employee) || employee.name}
                                </span>
                                <span className="mt-1 block truncate text-xs font-bold text-slate-500">
                                  {employee.fileNumber || employee.civilId || 'بدون رقم'}{employee.jobTitle ? ` - ${employee.jobTitle}` : ''}
                                </span>
                              </span>
                              {isInactiveEmployee(employee) && (
                                <span className="shrink-0 rounded-full bg-red-50 px-2 py-1 text-[11px] font-black text-red-700">
                                  خارج الخدمة
                                </span>
                              )}
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-5 text-center text-sm font-bold text-slate-400">
                            لا توجد نتائج مطابقة.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {extraEmployees.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {extraEmployees.map((employee) => (
                        <span key={employee.id} className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800">
                          {(employee.rank ? `${employee.rank} / ` : '')}{formatEmployeeDisplayName(employee) || employee.name}{isInactiveEmployee(employee) ? ' - خارج الخدمة' : ''}
                          <button
                            type="button"
                            onClick={() => removeExtraEmployee(employee.id)}
                            className="rounded-full p-0.5 text-blue-500 hover:bg-blue-100 hover:text-blue-800"
                            title="إزالة من الإضافات"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-xs font-bold text-slate-500">
                      لا توجد إضافات استثنائية.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-5 xl:sticky xl:top-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                  <Columns3 className="h-5 w-5" />
                </div>
                <h2 className="text-base font-black text-slate-950">الأعمدة</h2>
              </div>
              <div className="mt-4 max-h-[435px] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-2">
                <div className="grid grid-cols-2 gap-2">
                  <button className="rounded-xl border border-blue-200 bg-blue-600 px-3 py-2 text-xs font-bold text-white">م</button>
                  {fields.filter((field) => field.key !== 'smartOrder').map((field) => (
                    <button
                      key={field.key}
                      onClick={() => toggleColumn(field.key)}
                      className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${selectedColumns.includes(field.key) ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}
                    >
                      {field.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {includeSummaryStats && summaryStatsRows.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                    <Settings className="h-5 w-5" />
                  </div>
                  <h2 className="text-base font-black text-slate-950">إحصائية حسب {summaryStatsField?.label || 'الحقل المختار'}</h2>
                </div>
                {includeSummaryStats && summaryStatsRows.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {summaryStatsRows.slice(0, 6).map((row) => (
                      <div key={row.label} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
                        <span className="truncate font-bold text-slate-600">{row.label}</span>
                        <span className="font-black text-slate-900">{row.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="employee-report-print overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
          <div className="employee-report-title border-b border-slate-200 bg-gradient-to-l from-slate-50 to-white px-6 py-5 text-center">
            <h2 className="text-2xl font-black text-slate-900">{title}</h2>
            <p className="mt-1 text-sm font-bold text-slate-500">{subtitle || ' '}</p>
          </div>
          <div className="overflow-x-auto p-5">
            <table className="employee-report-table min-w-full text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <th className="screen-only border border-slate-300 px-3 py-2 text-center font-black text-slate-700" title="الحالة في الكشف">
                    <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-700" />
                  </th>
                  {visibleColumns.map((column) => (
                    <th key={column.key} className={`border border-slate-300 px-3 py-2 text-center font-black text-slate-700 ${column.key === 'name' || column.key === 'rank' ? 'report-nowrap whitespace-nowrap' : ''} ${isNumericColumn(column) ? 'report-number-cell' : ''}`}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="screen-only">
                {getCategorySeparatedRows(reportEmployeesBeforeExclusions).map((row, rowIndex) => {
                  if (row.type === 'category') {
                    return (
                      <tr key={`screen-category-${row.label}-${rowIndex}`} className="report-category-row">
                        <td colSpan={visibleColumns.length + 1} className="border border-slate-300 px-3 py-2 text-center text-sm font-black">
                          {row.label}
                        </td>
                      </tr>
                    );
                  }
                  const { employee, index } = row;
                  const isExcluded = excludedEmployeeIds.includes(employee.id);
                  const visibleIndex = getVisibleSerialIndex(employee);
                  return (
                    <tr key={employee.id} className={isExcluded ? 'bg-red-50/80 text-slate-400' : ''}>
                      <td className="border border-slate-200 px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => toggleEmployeeExclusion(employee.id)}
                          title={isExcluded ? 'ملغى من الكشف' : 'مفعل في الكشف'}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border transition ${isExcluded ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                        >
                          {isExcluded ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                        </button>
                      </td>
                      {visibleColumns.map((column) => {
                        const isJobTitleOmitted = column.key === 'jobTitle' && omitJobTitleCategories.includes(String(employee.category || '').trim());
                        const value = column.key === 'serial' && isExcluded
                          ? '-'
                          : getPrintableValue(employee, column, column.key === 'serial' ? visibleIndex : index);
                        return <td key={column.key} className={`border border-slate-200 px-3 py-2 text-center font-semibold ${isExcluded ? 'text-slate-400 line-through decoration-red-300' : 'text-slate-800'} ${column.key === 'name' || column.key === 'rank' ? 'report-nowrap whitespace-nowrap' : ''} ${isNumericColumn(column) ? 'report-number-cell' : ''}`}>{value === true ? 'نعم' : value === false ? 'لا' : isJobTitleOmitted ? '' : (value || '-')}</td>;
                      })}
                    </tr>
                  );
                })}
                {reportEmployeesBeforeExclusions.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length + 1} className="border border-slate-200 px-3 py-10 text-center font-bold text-slate-400">
                      لا توجد نتائج مطابقة للشروط الحالية.
                    </td>
                  </tr>
                )}
                <tr className="report-total-row">
                  <td colSpan={visibleColumns.length + 1} className="border border-slate-300 px-3 py-3 text-center text-base font-black text-slate-900">
                    الإجمالي: {filteredEmployees.length}
                  </td>
                </tr>
              </tbody>
              <tbody className="print-only">
                {getCategorySeparatedRows(filteredEmployees).map((row, rowIndex) => {
                  if (row.type === 'category') {
                    return (
                      <tr key={`print-category-${row.label}-${rowIndex}`} className={`report-category-row ${row.startsNewPage ? 'report-page-break' : ''}`}>
                        <td colSpan={visibleColumns.length} className="border border-slate-300 px-3 py-2 text-center text-sm font-black text-slate-900">
                          {row.label}
                        </td>
                      </tr>
                    );
                  }
                  const { employee, index } = row;
                  return (
                    <tr key={employee.id}>
                      {visibleColumns.map((column) => {
                        const isJobTitleOmitted = column.key === 'jobTitle' && omitJobTitleCategories.includes(String(employee.category || '').trim());
                        const value = getPrintableValue(employee, column, index);
                        return <td key={column.key} className={`border border-slate-200 px-3 py-2 text-center font-semibold text-slate-800 ${column.key === 'name' || column.key === 'rank' ? 'report-nowrap whitespace-nowrap' : ''} ${isNumericColumn(column) ? 'report-number-cell' : ''}`}>{value === true ? 'نعم' : value === false ? 'لا' : isJobTitleOmitted ? '' : (value || '-')}</td>;
                      })}
                    </tr>
                  );
                })}
                {filteredEmployees.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length} className="border border-slate-200 px-3 py-10 text-center font-bold text-slate-400">
                      لا توجد نتائج مطابقة للشروط الحالية.
                    </td>
                  </tr>
                )}
                <tr className="report-total-row">
                  <td colSpan={visibleColumns.length} className="border border-slate-300 px-3 py-3 text-center text-base font-black text-slate-900">
                    الإجمالي: {filteredEmployees.length}
                  </td>
                </tr>
              </tbody>
            </table>

            {includeSummaryStats && summaryStatsRows.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-3 text-center text-lg font-black text-slate-900">
                  إحصائية حسب {summaryStatsField?.label || 'الحقل المختار'}
                </h3>
                <table className="employee-report-table min-w-full text-sm">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-slate-300 px-3 py-2 text-center font-black text-slate-700">{summaryStatsField?.label || 'البند'}</th>
                      <th className="border border-slate-300 px-3 py-2 text-center font-black text-slate-700">العدد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryStatsRows.map((row) => (
                      <tr key={row.label}>
                        <td className="border border-slate-200 px-3 py-2 text-center font-semibold text-slate-800">{row.label}</td>
                        <td className="report-number-cell border border-slate-200 px-3 py-2 text-center font-black text-slate-900">{row.count}</td>
                      </tr>
                    ))}
                    <tr className="report-total-row">
                      <td className="border border-slate-300 px-3 py-2 text-center font-black text-slate-900">الإجمالي</td>
                      <td className="report-number-cell border border-slate-300 px-3 py-2 text-center font-black text-slate-900">{filteredEmployees.length}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeReportsBuilder;
