import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, Building, Clock, Edit, FileText, Plus, RefreshCw, Search, Settings, Trash2, User } from 'lucide-react';
import {
  createProfessionalExtension,
  deleteProfessionalExtension,
  fetchProfessionalExtensionStatus,
  updateProfessionalExtension,
} from '../api';
import {
  ProfessionalExtensionStatusItem,
  ProfessionalExtensionStatusResponse,
} from '../types';
import { formatEmployeeDisplayName } from '../utils/employeeDisplay';
import { getSearchTokens, matchesArabicSearch } from '../utils/search';
import { formatDepartmentLabel, formatSectionLabel } from '../utils/organization';
import LoadingPage from './LoadingPage';
import Modal from './UI/Modal';
import Badge from './UI/Badge';
import PageHeader from './UI/PageHeader';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { toast } from 'react-hot-toast';

type TabKey = 'approaching' | 'extended' | 'notExtended';

const dateFormatter = new Intl.DateTimeFormat('ar-US', {
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

const numberFormatter = new Intl.NumberFormat('ar-US', { numberingSystem: 'latn' });

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormatter.format(date);
};

const formatYear = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return String(date.getFullYear());
};

const parseDateOnly = (value?: string | null) => {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
};

const getAgeInfo = (value?: string | null) => {
  const birth = parseDateOnly(value);
  if (!birth) return null;
  const now = new Date();
  let years = now.getFullYear() - birth.getUTCFullYear();
  let months = now.getMonth() - birth.getUTCMonth();
  let days = now.getDate() - birth.getUTCDate();
  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    days += prevMonth.getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years: Math.max(0, years), months: Math.max(0, months) };
};

const getExtensionYear = (birthDate?: string | null, periodStart?: string | null) => {
  const birth = parseDateOnly(birthDate);
  const start = parseDateOnly(periodStart);
  if (!birth || !start) return null;
  let years = start.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = start.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && start.getUTCDate() < birth.getUTCDate())) {
    years -= 1;
  }
  return years;
};

const getExtensionOrder = (birthDate?: string | null, periodStart?: string | null) => {
  const year = getExtensionYear(birthDate, periodStart);
  if (year === null || Number.isNaN(year)) return null;
  const order = year - 59;
  if (order < 1) return null;
  return order;
};

const getExtensionLabel = (order: number | null) => {
  switch (order) {
    case 1:
      return 'التمديد الأول';
    case 2:
      return 'التمديد الثاني';
    case 3:
      return 'التمديد الثالث';
    case 4:
      return 'التمديد الرابع';
    case 5:
      return 'التمديد الأخير';
    default:
      return 'لا يوجد';
  }
};

const formatDaysRemaining = (days: number) => {
  if (days >= 0) return `متبقي ${numberFormatter.format(days)} يوم`;
  return `متأخر ${numberFormatter.format(Math.abs(days))} يوم`;
};

const stageLabel = (stage: ProfessionalExtensionStatusItem['stage']) =>
  stage === 'pre_60' ? 'قبل سن 60' : 'تجديد سنوي';

const statusBadge = (status: ProfessionalExtensionStatusItem['status']) => {
  switch (status) {
    case 'extended':
      return <Badge variant="success" size="xs">ممدد</Badge>;
    case 'not_extended':
      return <Badge variant="danger" size="xs">غير ممدد</Badge>;
    default:
      return <Badge variant="info" size="xs">قيد المتابعة</Badge>;
  }
};

const getExtensionDecisionState = (item: ProfessionalExtensionStatusItem, extensionLabel: string) => {
  if (item.extension) {
    return {
      title: `تم تنفيذ ${extensionLabel}`,
      detail: 'التمديد مسجل ويمكن تعديل بياناته عند الحاجة.',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      dotClassName: 'bg-emerald-500',
    };
  }
  if (item.daysRemaining < 0) {
    return {
      title: `مطلوب تنفيذ ${extensionLabel}`,
      detail: `متأخر ${numberFormatter.format(Math.abs(item.daysRemaining))} يوم عن تاريخ الاستحقاق.`,
      className: 'border-red-200 bg-red-50 text-red-800',
      dotClassName: 'bg-red-500',
    };
  }
  return {
    title: `مطلوب تجهيز ${extensionLabel}`,
    detail: `متبقي ${numberFormatter.format(item.daysRemaining)} يوم على الاستحقاق.`,
    className: 'border-amber-200 bg-amber-50 text-amber-800',
    dotClassName: 'bg-amber-500',
  };
};

const ProfessionalExtensions: React.FC = () => {
  const [data, setData] = useState<ProfessionalExtensionStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('notExtended');
  const [searchTerm, setSearchTerm] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [selectedItem, setSelectedItem] = useState<ProfessionalExtensionStatusItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [archiveSearchTerm, setArchiveSearchTerm] = useState('');
  const [formState, setFormState] = useState({
    decisionNumber: '',
    letterNumber: '',
    decisionDate: '',
    extensionStartDate: '',
    extensionEndDate: '',
  });
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    item: ProfessionalExtensionStatusItem | null;
  }>({ isOpen: false, item: null });

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchProfessionalExtensionStatus();
      setData(response);
    } catch (err) {
      setError('تعذر تحميل بيانات تمديدات الفنيين');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const list = useMemo(() => {
    if (!data) return [];
    const source =
      activeTab === 'approaching'
        ? data.approaching
        : activeTab === 'extended'
          ? data.extended
          : data.notExtended;

    const searchTokens = getSearchTokens(searchTerm);
    if (!searchTokens.length) return source;
    return source.filter((item) => {
      const employee = item.employee;
      return matchesArabicSearch([
        formatEmployeeDisplayName(employee) || employee.name,
        employee.name,
        employee.firstName,
        employee.secondName,
        employee.thirdName,
        employee.fourthName,
        employee.familyName,
        employee.fileNumber,
        employee.rank,
        employee.department,
        formatDepartmentLabel(employee.department),
        employee.section,
        formatSectionLabel(employee.section),
        employee.jobTitle,
        item.extension?.decisionNumber,
        item.extension?.letterNumber,
      ], searchTokens);
    });
  }, [data, activeTab, searchTerm]);

  const archiveList = useMemo(() => {
    const source = data?.archive || [];
    if (!source.length) return [];
    const searchTokens = getSearchTokens(archiveSearchTerm);
    if (!searchTokens.length) return source;
    return source.filter((item) => {
      const employee = item.employee;
      return matchesArabicSearch([
        formatEmployeeDisplayName(employee) || employee.name,
        employee.name,
        employee.firstName,
        employee.secondName,
        employee.thirdName,
        employee.fourthName,
        employee.familyName,
        employee.fileNumber,
        employee.rank,
        employee.department,
        formatDepartmentLabel(employee.department),
        employee.section,
        formatSectionLabel(employee.section),
        employee.jobTitle,
        item.extension?.decisionNumber,
        item.extension?.letterNumber,
      ], searchTokens);
    });
  }, [data, archiveSearchTerm]);

  const openCreateModal = (item: ProfessionalExtensionStatusItem) => {
    setModalMode('create');
    setSelectedItem(item);
    setFormState({
      decisionNumber: '',
      letterNumber: '',
      decisionDate: '',
      extensionStartDate: item.suggestedStartDate,
      extensionEndDate: item.suggestedEndDate,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (item: ProfessionalExtensionStatusItem) => {
    if (!item.extension) return;
    setModalMode('edit');
    setSelectedItem(item);
    setFormState({
      decisionNumber: item.extension.decisionNumber || '',
      letterNumber: item.extension.letterNumber || '',
      decisionDate: item.extension.decisionDate || '',
      extensionStartDate: item.extension.extensionStartDate,
      extensionEndDate: item.extension.extensionEndDate,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setSelectedItem(null);
    setFormError(null);
  };

  const handleSave = async () => {
    if (!selectedItem) return;
    if (!formState.extensionStartDate || !formState.extensionEndDate) {
      setFormError('يرجى تحديد بداية ونهاية التمديد');
      return;
    }
    const start = new Date(formState.extensionStartDate);
    const end = new Date(formState.extensionEndDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      setFormError('تواريخ التمديد غير صحيحة');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (modalMode === 'create') {
        await createProfessionalExtension({
          employeeId: selectedItem.employee.id,
          decisionNumber: formState.decisionNumber || null,
          letterNumber: formState.letterNumber || null,
          decisionDate: formState.decisionDate || null,
          extensionStartDate: formState.extensionStartDate,
          extensionEndDate: formState.extensionEndDate,
        });
        toast.success('تم إضافة التمديد بنجاح');
      } else if (selectedItem.extension) {
        await updateProfessionalExtension(selectedItem.extension.id, {
          decisionNumber: formState.decisionNumber || null,
          letterNumber: formState.letterNumber || null,
          decisionDate: formState.decisionDate || null,
          extensionStartDate: formState.extensionStartDate,
          extensionEndDate: formState.extensionEndDate,
        });
        toast.success('تم تحديث التمديد بنجاح');
      }
      setModalOpen(false);
      setSelectedItem(null);
      await loadData();
    } catch (err) {
      console.error(err);
      toast.error('فشل حفظ بيانات التمديد');
    } finally {
      setSaving(false);
    }
  };

  const openDeleteModal = (item: ProfessionalExtensionStatusItem) => {
    setDeleteModal({ isOpen: true, item });
  };

  const closeDeleteModal = () => {
    setDeleteModal({ isOpen: false, item: null });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal.item?.extension?.id) return;
    try {
      await deleteProfessionalExtension(deleteModal.item.extension.id);
      toast.success('تم حذف التمديد بنجاح');
      closeDeleteModal();
      await loadData();
    } catch (err) {
      console.error(err);
      toast.error('فشل حذف التمديد');
    }
  };

  if (loading) {
    return <LoadingPage variant="dashboard" title="جاري تحميل تمديدات الفنيين" subtitle="يرجى الانتظار..." />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="text-center py-12">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">خطأ في التحميل</h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={loadData}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  const reminderSummary = data?.reminderDays?.length
    ? data.reminderDays.map((day) => numberFormatter.format(day)).join('، ')
    : '30';

  const stats = [
    {
      label: 'قريب من التمديد',
      value: data?.approaching.length || 0,
      icon: Clock,
      gradient: 'from-amber-500 via-amber-600 to-amber-700',
      glow: 'from-amber-400 to-amber-600',
      tag: 'تنبيه',
      tagColor: 'text-amber-100',
    },
    {
      label: 'تم تمديده',
      value: data?.extended.length || 0,
      icon: FileText,
      gradient: 'from-emerald-500 via-emerald-600 to-emerald-700',
      glow: 'from-emerald-400 to-emerald-600',
      tag: 'تمديد',
      tagColor: 'text-emerald-100',
    },
    {
      label: 'غير ممدد - يحتاج متابعة عاجلة',
      value: data?.notExtended.length || 0,
      icon: AlertTriangle,
      gradient: 'from-red-500 via-red-600 to-red-700',
      glow: 'from-red-400 to-red-600',
      tag: 'عاجل',
      tagColor: 'text-red-100',
    },
  ];
  const archiveCount = data?.archive?.length || 0;
  const hasArchive = archiveCount > 0;
  const selectedDisplayName = selectedItem
    ? (formatEmployeeDisplayName(selectedItem.employee) || selectedItem.employee.name || '—')
    : '—';

  const renderExtensionList = (
    items: ProfessionalExtensionStatusItem[],
    emptyTitle: string,
    emptyDescription: string,
    archiveMode = false
  ) => (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {items.length === 0 ? (
        <div className="px-6 py-14 text-center text-slate-500">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
            <Search className="h-7 w-7 text-slate-400" />
          </div>
          <div className="text-base font-black text-slate-700">{emptyTitle}</div>
          <div className="mt-1 text-sm text-slate-400">{emptyDescription}</div>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {items.map((item) => {
            const extensionOrder = getExtensionOrder(item.employee.birthDate, item.periodStart);
            const extensionLabel = getExtensionLabel(extensionOrder);
            const isLastExtension = extensionOrder === 5;
            const rowKey = item.extension?.id || `${item.employee.id}-${item.periodStart}`;
            const displayName = formatEmployeeDisplayName(item.employee) || item.employee.name || '—';
            const departmentLabel = formatDepartmentLabel(item.employee.department) || 'غير مسجل';
            const sectionLabel = item.employee.section ? formatSectionLabel(item.employee.section) : '';
            const ageInfo = getAgeInfo(item.employee.birthDate);
            const birthYear = formatYear(item.employee.birthDate);
            const decisionState = getExtensionDecisionState(item, extensionLabel);
            const rowAccent = item.extension
              ? 'border-r-emerald-500'
              : item.daysRemaining < 0
                ? 'border-r-red-500'
                : 'border-r-amber-500';

            return (
              <article
                key={rowKey}
                className={`grid gap-4 border-r-4 ${rowAccent} bg-white px-5 py-4 transition-colors hover:bg-slate-50/80 xl:grid-cols-[minmax(280px,1.25fr)_minmax(290px,1fr)_minmax(260px,0.9fr)_minmax(150px,auto)] xl:items-center`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-black text-slate-950">
                      {item.employee.rank ? `${item.employee.rank} / ` : ''}{displayName}
                    </h3>
                    <Badge variant="default" size="xs">{item.employee.jobTitle || '—'}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold">
                    <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-600">
                      ملف {item.employee.fileNumber || 'بدون رقم'}
                    </span>
                    <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-blue-700">
                      ميلاد {birthYear}
                    </span>
                    <span className="rounded-lg bg-red-50 px-2.5 py-1 text-red-700">
                      عمر {ageInfo ? `${numberFormatter.format(ageInfo.years)} سنة` : '—'}
                    </span>
                    <span className="rounded-lg bg-green-50 px-2.5 py-1 text-green-700">
                      {item.employee.nationality || "غير محدد الجنسية"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${archiveMode ? 'bg-slate-100 text-slate-700' : 'bg-blue-50 text-blue-700'}`}>
                      <Building className="h-3.5 w-3.5" />
                      {departmentLabel}
                    </span>
                    {sectionLabel && (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                        {sectionLabel}
                      </span>
                    )}
                  </div>
                </div>

                <div className={`rounded-2xl border px-4 py-3 ${decisionState.className}`}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${decisionState.dotClassName}`}></span>
                    <div>
                      <div className="text-sm font-black">{decisionState.title}</div>
                      <div className="mt-1 text-xs font-bold opacity-80">{decisionState.detail}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant={isLastExtension ? 'danger' : 'default'} size="xs">{extensionLabel}</Badge>
                    <Badge variant="info" size="xs">{stageLabel(item.stage)}</Badge>
                    {statusBadge(item.status)}
                  </div>
                </div>

                <div className="grid gap-2 text-sm">
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                    <span className="text-xs font-black text-slate-500">الاستحقاق</span>
                    <span className="font-black text-slate-900">{formatDate(item.dueDate)}</span>
                  </div>
                  <div className={`rounded-xl px-3 py-2 text-xs font-black ${item.daysRemaining < 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                    {formatDaysRemaining(item.daysRemaining)}
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                    {item.extension ? formatDate(item.extension.extensionStartDate) : formatDate(item.suggestedStartDate)}
                    <span className="mx-1 text-slate-300">إلى</span>
                    {item.extension ? formatDate(item.extension.extensionEndDate) : formatDate(item.suggestedEndDate)}
                  </div>
                </div>

                <div className="flex flex-col gap-2 xl:items-end">
                  {item.extension ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEditModal(item)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700 transition-colors hover:bg-blue-100"
                        title="تعديل التمديد"
                        aria-label="تعديل التمديد"
                      >
                        <Edit className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => openDeleteModal(item)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-700 transition-colors hover:bg-red-100"
                        title="حذف التمديد"
                        aria-label="حذف التمديد"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => openCreateModal(item)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-emerald-700"
                    >
                      <Plus className="h-4 w-4" />
                      إضافة تمديد
                    </button>
                  )}
                  {item.extension && (
                    <div className="max-w-[220px] text-right text-[10px] font-semibold leading-5 text-slate-400">
                      قرار {item.extension.decisionNumber || '—'} | {item.extension.decisionDate ? formatDate(item.extension.decisionDate) : '—'} | كتاب {item.extension.letterNumber || '—'}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen p-3" dir="rtl">
      <div className="mx-auto space-y-6">
        <PageHeader
          icon={<Settings size={36} />}
          title="تمديدات الفنيين"
          description="متابعة الموظفين الفنيون بين 60 و65 سنة وإدارة قرارات التمديد السنوية"
          actions={(
            <>
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm text-gray-700">
                أيام التنبيه: <span className="font-semibold text-gray-900">{reminderSummary}</span>
              </div>
              <button
                onClick={loadData}
                className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-3 rounded-xl flex items-center gap-3 shadow-lg transition-all transform hover:scale-105 hover:shadow-xl"
              >
                <RefreshCw size={20} />
                <span className="font-semibold">تحديث</span>
              </button>
            </>
          )}
        />

        {/* Statistics Cards (Category Style) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {stats.map((stat) => {
            const IconComponent = stat.icon;
            return (
              <div key={stat.label} className="relative group">
                <div className={`absolute inset-0 bg-gradient-to-r ${stat.glow} rounded-2xl blur opacity-25 group-hover:opacity-40 transition-opacity`}></div>
                <div className={`relative bg-gradient-to-br ${stat.gradient} rounded-2xl p-5 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-12 h-12 bg-white bg-opacity-20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                      <IconComponent size={24} className="text-white" />
                    </div>
                    <div className="text-right">
                      <div className="text-5xl font-black mb-1">{numberFormatter.format(stat.value)}</div>
                      <div className={`${stat.tagColor} text-xs font-medium`}>{stat.tag}</div>
                    </div>
                  </div>
                  <div className="border-t border-white border-opacity-20 pt-3">
                    <h4 className="text-lg font-bold">{stat.label}</h4>
                  </div>
                  <div className="absolute top-3 right-3 w-6 h-6 bg-white bg-opacity-10 rounded-full"></div>
                  <div className="absolute bottom-3 left-3 w-8 h-8 bg-white bg-opacity-5 rounded-full"></div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Enhanced Search and Filters */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200 p-6">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-3">
              <Search className="w-6 h-6 text-blue-600" />
              البحث والتصفية
            </h3>
          </div>

          <div className="flex flex-col lg:flex-row gap-6">
            {/* Enhanced Search */}
            <div className="flex-1 relative">
              <div className="absolute right-5 top-7 transform -translate-y-1/2 text-gray-400 cursor-pointer">
                <Search size={24} />
              </div>
              <input
                type="text"
                placeholder="ابحث بالاسم، رقم الملف، المسمى الوظيفي، أو الإدارة..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pr-14 pl-4 py-4 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all duration-200 text-md placeholder-gray-400"
              />
              {searchTerm && (
                <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
                  <div className="bg-blue-100 text-blue-600 px-3 py-1 rounded-full text-sm font-medium">
                    {list.length} نتيجة
                  </div>
                </div>
              )}
            </div>

            {/* Enhanced Filter Tabs */}
            <div className="flex items-center gap-3 flex-wrap">
              {([
                { key: 'approaching', label: 'اقترب موعد تمديده', count: data?.approaching.length || 0, color: 'amber' },
                { key: 'extended', label: 'تم تمديده', count: data?.extended.length || 0, color: 'emerald' },
                { key: 'notExtended', label: 'لم يتم تمديد خدمته', count: data?.notExtended.length || 0, color: 'rose' },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-5 py-4 rounded-xl transition-all duration-200 font-medium ${activeTab === tab.key
                    ? (tab.key === 'notExtended'
                      ? 'bg-red-600 text-white shadow-lg border-2 border-red-200'
                      : 'bg-blue-600 text-white shadow-lg border-2 border-blue-200')
                    : 'bg-white text-gray-800 border-2 border-gray-200 hover:bg-gray-50'
                    }`}
                >
                  <span>{tab.label}</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${activeTab === tab.key
                    ? 'bg-white text-gray-600'
                    : 'bg-gray-100 text-gray-600'
                    }`}>
                    {numberFormatter.format(tab.count)}
                  </span>
                </button>
              ))}
              {hasArchive && (
                <button
                  onClick={() => setShowArchive((prev) => !prev)}
                  className={`flex items-center gap-2 px-5 py-4 rounded-xl transition-all duration-200 font-medium ${showArchive
                    ? 'bg-gray-900 text-white shadow-lg border-2 border-gray-200'
                    : 'bg-white text-gray-800 border-2 border-gray-200 hover:bg-gray-50'
                    }`}
                >
                  <Archive className="w-5 h-5" />
                  <span>الأرشيف</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${showArchive
                    ? 'bg-white text-gray-700'
                    : 'bg-gray-100 text-gray-600'
                    }`}>
                    {numberFormatter.format(archiveCount)}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {renderExtensionList(list, 'لا توجد بيانات مطابقة', 'جرب تغيير معايير البحث أو الفلاتر')}

        {hasArchive && showArchive && (
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
            <div className="border-b border-gray-200/60 px-6 py-5">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gray-900 rounded-2xl flex items-center justify-center shadow-md">
                    <Archive className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">أرشيف التمديدات</h3>
                    <p className="text-sm text-gray-600">تمديدات الفنيين خارج الخدمة</p>
                  </div>
                </div>
                <div className="flex-1 max-w-md relative">
                  <div className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400">
                    <Search size={18} />
                  </div>
                  <input
                    type="text"
                    placeholder="ابحث داخل الأرشيف بالاسم أو رقم الملف..."
                    value={archiveSearchTerm}
                    onChange={(e) => setArchiveSearchTerm(e.target.value)}
                    className="w-full pr-12 pl-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-gray-500/20 focus:border-gray-700 bg-white transition-all duration-200 text-sm placeholder-gray-400"
                  />
                  {archiveSearchTerm && (
                    <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
                      <div className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-xs font-medium">
                        {numberFormatter.format(archiveList.length)} نتيجة
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="p-4">
              {renderExtensionList(archiveList, 'لا توجد بيانات مطابقة في الأرشيف', 'جرّب تغيير معايير البحث', true)}
            </div>
          </div>
        )}

        {/* Enhanced Modal */}
        <Modal
          isOpen={modalOpen}
          onClose={closeModal}
          title={modalMode === 'create' ? 'إضافة تمديد فني' : 'تعديل تمديد فني'}
          size="lg"
        >
          <div className="space-y-8">
            {selectedItem && (
              <div className="bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 rounded-2xl p-6">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center">
                    <User className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <div className="text-md text-blue-600 font-semibold">{selectedItem.employee.jobTitle}</div>
                    <div className="text-xl font-bold text-gray-900 mt-1">{selectedItem.employee.rank} / {selectedDisplayName}</div>
                    <div className="text-sm text-gray-600 mt-1">
                      رقم الملف :  <span className="font-black">{selectedItem.employee.fileNumber || 'بدون رقم ملف'} </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold text-gray-800 mb-3">رقم القرار</label>
                <input
                  type="text"
                  value={formState.decisionNumber}
                  onChange={(e) => setFormState((prev) => ({ ...prev, decisionNumber: e.target.value }))}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-right"
                  placeholder="أدخل رقم القرار"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-800 mb-3">رقم الكتاب</label>
                <input
                  type="text"
                  value={formState.letterNumber}
                  onChange={(e) => setFormState((prev) => ({ ...prev, letterNumber: e.target.value }))}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-right"
                  placeholder="أدخل رقم الكتاب"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-800 mb-3">تاريخ القرار</label>
                <input
                  type="date"
                  value={formState.decisionDate}
                  onChange={(e) => setFormState((prev) => ({ ...prev, decisionDate: e.target.value }))}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-right"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-800 mb-3">بداية التمديد</label>
                <input
                  type="date"
                  value={formState.extensionStartDate}
                  onChange={(e) => setFormState((prev) => ({ ...prev, extensionStartDate: e.target.value }))}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-right"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-gray-800 mb-3">نهاية التمديد</label>
                <input
                  type="date"
                  value={formState.extensionEndDate}
                  onChange={(e) => setFormState((prev) => ({ ...prev, extensionEndDate: e.target.value }))}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-right"
                />
              </div>
            </div>

            {formError && (
              <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
                <div className="flex items-center gap-3 text-red-800">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="font-semibold">{formError}</span>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-4 pt-6 border-t border-gray-200">
              <button
                type="button"
                onClick={closeModal}
                className="px-8 py-3 text-sm font-bold text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-all duration-200"
                disabled={saving}
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-8 py-3 text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                disabled={saving}
              >
                {saving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    جارٍ الحفظ...
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4" />
                    حفظ
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>

        <ConfirmDeleteModal
          isOpen={deleteModal.isOpen}
          onClose={closeDeleteModal}
          onConfirm={handleDeleteConfirm}
          title="تنبيه قبل الحذف"
          description={`سيتم حذف بيانات تمديد ${deleteModal.item?.employee.rank ? `${deleteModal.item.employee.rank}` : ''} / ${deleteModal.item?.employee ? `${formatEmployeeDisplayName(deleteModal.item.employee) || deleteModal.item.employee.name || ''}` : ''} نهائياً ولا يمكن التراجع.`}
          confirmLabel="حذف التمديد"
        />
      </div>
    </div>
  );
};

export default ProfessionalExtensions;
