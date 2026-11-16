import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Document, Packer, Paragraph, TextRun, Table, TableCell, TableRow, AlignmentType, ShadingType, BorderStyle, WidthType, VerticalAlign, HeightRule, UnderlineType } from 'docx';
import { saveAs } from 'file-saver';
import { Search, Filter, Edit, Trash2, FileText, Download, X, FileEdit, UserRound, ClipboardList, Building, Users, History, RefreshCw, UploadCloud, Database, ShieldCheck, AlertTriangle, CheckCircle } from 'lucide-react';
import { LicenseService } from '../services/licenseService';
import { EmployeeService } from '../services/employeeService';
import { License, Employee, FilterOptions } from '../types';
import Modal from '../../components/UI/Modal';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal';
import LoadingPage from '../../components/LoadingPage';
import { analyzeLicenseImportFile, applyLicenseImportFile, createBackup, LicenseImportAnalysis } from '../../api';

// Helper function to calculate time since registration
const getTimeSince = (createdAt: string) => {
  const now = new Date();
  const created = new Date(createdAt);
  const diffInMs = now.getTime() - created.getTime();

  const minutes = Math.floor(diffInMs / (1000 * 60));
  const hours = Math.floor(diffInMs / (1000 * 60 * 60));
  const days = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  if (hours < 24) return `منذ ${hours} ساعة`;
  if (days < 7) return `منذ ${days} يوم`;
  if (weeks < 4) return `منذ ${weeks} أسبوع`;
  if (months < 12) return `منذ ${months} شهر`;

  const years = Math.floor(days / 365);
  return `منذ ${years} سنة`;
};

const formatHoursLabel = (value?: number | null) => {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return '';
  return `${hours} ${hours === 1 ? 'ساعة' : 'ساعات'}`;
};

const formatLicenseTypeLabel = (license: License) => {
  if (license.license_type === 'يوم كامل') return 'رخصة يوم كامل';
  if (license.license_type === 'إستئذان طبي') return 'إستئذان طبي';
  return 'إستئذان قصير';
};

const getEmployeeIdentifierDetails = (employee?: Employee) => {
  const fileNumber = String(employee?.file_number || '').trim();
  const civilId = String(employee?.civil_id || '').trim();
  if (fileNumber) return { label: 'رقم الملف', value: fileNumber };
  if (civilId) return { label: 'الرقم المدني', value: civilId };
  return { label: '', value: '' };
};

const formatLicenseHoursLabel = (license: License) => {
  if (license.license_type === 'يوم كامل') return 'رخصة يوم كامل';
  const hoursLabel = formatHoursLabel(license.hours);
  if (!hoursLabel) return 'غير مسجل';
  const permissionTime = String(license.permission_time || '').trim();
  return permissionTime ? `${hoursLabel} ● ${permissionTime}` : hoursLabel;
};

const truncateText = (value: string, maxLength: number) => (
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
);

const normalizeSearchText = (value: unknown) => String(value ?? '')
  .toLowerCase()
  .replace(/[إأآٱ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[ًٌٍَُِّْـ]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

const matchesSearchText = (haystackValues: unknown[], query: string) => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeSearchText(haystackValues.filter(Boolean).join(' '));
  if (haystack.includes(normalizedQuery)) return true;
  return normalizedQuery.split(/\s+/).every(token => haystack.includes(token));
};

const getRankBadgeClasses = (employee?: Employee) => {
  const category = employee?.category || '';
  if (category === 'مدني') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
};

interface EditLicenseModalProps {
  isOpen: boolean;
  license: License | null;
  employees: Employee[];
  onUpdate: (updatedLicense: Partial<License>) => void;
  onClose: () => void;
}

const EditLicenseModal: React.FC<EditLicenseModalProps> = ({
  isOpen,
  license,
  employees,
  onUpdate,
  onClose
}) => {
  const [formData, setFormData] = useState<Partial<License>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [showEmployeeList, setShowEmployeeList] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setFormData({});
      setSelectedEmployee(null);
      setSearchQuery('');
      setShowEmployeeList(false);
      return;
    }

    if (license) {
      const permissionTimeValue =
        license.permission_time ?? (license as { permissionTime?: string | null }).permissionTime ?? '';
      setFormData({
        ...license,
        permission_time: permissionTimeValue ? String(permissionTimeValue) : '',
        license_date: license.license_date.split('T')[0] // Format for input[type=date]
      });
      // Find and set the selected employee
      const employee = employees.find(emp => emp.id === license.employee_id);
      if (employee) {
        setSelectedEmployee(employee);
        setSearchQuery(employee.full_name);
      } else {
        setSelectedEmployee(null);
      }
      setShowEmployeeList(false);
    } else {
      setFormData({});
      setSelectedEmployee(null);
      setSearchQuery('');
    }
  }, [isOpen, license, employees]);

  if (!isOpen || !license) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isHourly = formData.license_type === 'إستئذان قصير' || formData.license_type === 'إستئذان طبي';
    const permissionTimeValue = isHourly
      ? (formData.permission_time ? String(formData.permission_time) : '')
      : null;
    const updatedData = {
      ...formData,
      hours: isHourly ? formData.hours : undefined,
      permission_time: permissionTimeValue,
      permissionTime: permissionTimeValue,
      notes: formData.notes || ''
    } as Partial<License> & { permissionTime?: string | null };
    onUpdate(updatedData);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleEmployeeSelect = (employee: Employee) => {
    setSelectedEmployee(employee);
    setSearchQuery(employee.full_name);
    setFormData(prev => ({ ...prev, employee_id: employee.id }));
    setShowEmployeeList(false);
  };

  const filteredEmployees = employees.filter(emp =>
    emp.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    emp.rank.toLowerCase().includes(searchQuery.toLowerCase()) ||
    emp.file_number.toString().includes(searchQuery)
  );

  const inputBaseClass = "w-full h-12 px-4 py-1.5 leading-6 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white text-right";
  const modalHeader = (
    <div className="relative overflow-hidden rounded-t-lg border-b border-blue-700/30 bg-gradient-to-r from-blue-700 via-blue-600 to-blue-500 px-6 py-6 text-white">
      <div className="relative z-10 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-white/15 ring-1 ring-white/25 flex items-center justify-center shadow-md">
            <FileEdit className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold">تعديل الرخصة/الاستئذان</h3>
            <p className="text-xs text-blue-100">نموذج لتحديث بيانات الرخصة وربطها بالموظف</p>
          </div>
        </div>
        <div className="flex items-center gap-3">

          <button
            type="button"
            onClick={onClose}
            className="h-10 w-10 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 flex items-center justify-center transition-colors"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),transparent_60%)]" />
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="تعديل الرخصة/الاستئذان"
      size="xl"
      header={modalHeader}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6">
          <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 space-y-4 relative">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center">
                <UserRound className="w-5 h-5 text-slate-600" />
              </div>
              <div>
                <h5 className="text-sm font-bold text-slate-900">بيانات الموظف</h5>
                <p className="text-xs text-slate-500">اختيار الموظف المرتبط بالرخصة/الاستئذان</p>
              </div>
            </div>

            {selectedEmployee && (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-blue-900">{selectedEmployee.rank} / {selectedEmployee.full_name}</p>
                    <p className="text-sm text-blue-600">رقم الملف: {selectedEmployee.file_number}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEmployee(null);
                      setSearchQuery('');
                      setShowEmployeeList(true);
                    }}
                    className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded-lg transition-colors"
                    aria-label="مسح الموظف المحدد"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2 relative">
              <label className="block text-sm font-semibold text-gray-700">بحث الموظف <span className="text-red-500">*</span></label>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="ابحث بالاسم، الرتبة، أو رقم الملف..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowEmployeeList(true);
                  }}
                  onFocus={() => setShowEmployeeList(true)}
                  className={`${inputBaseClass} pr-10`}
                />
              </div>

              {showEmployeeList && searchQuery && filteredEmployees.length > 0 && (
                <div className="absolute z-20 w-full mt-2 max-h-64 overflow-y-auto border border-gray-200 rounded-xl bg-white shadow-lg">
                  <div className="p-2 bg-gray-50 border-b border-gray-200">
                    <p className="text-sm font-medium text-gray-700">اختر موظف</p>
                  </div>
                  {filteredEmployees.map((employee) => (
                    <button
                      key={employee.id}
                      type="button"
                      onClick={() => handleEmployeeSelect(employee)}
                      className="w-full text-right p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{employee.rank} / {employee.full_name}</p>
                        <p className="text-sm text-gray-500">رقم الملف: {employee.file_number}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 shadow-sm flex items-center justify-center">
                <ClipboardList className="w-5 h-5 text-slate-600" />
              </div>
              <div>
                <h5 className="text-sm font-bold text-slate-900">تفاصيل الرخصة</h5>
                <p className="text-xs text-slate-500">نوع الرخصة، التاريخ، وعدد الساعات</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">نوع الرخصة/الاستئذان</label>
                <select
                  name="license_type"
                  value={formData.license_type || ''}
                  onChange={handleInputChange}
                  className={inputBaseClass}
                >
                  <option value="يوم كامل">رخصة يوم كامل</option>
                  <option value="إستئذان قصير">إستئذان قصير</option>
                  <option value="إستئذان طبي">إستئذان طبي</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">تاريخ الرخصة/الاستئذان</label>
                <input
                  type="date"
                  name="license_date"
                  value={formData.license_date || ''}
                  onChange={handleInputChange}
                  required
                  className={inputBaseClass}
                />
              </div>

              {(formData.license_type === 'إستئذان قصير' || formData.license_type === 'إستئذان طبي') && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:col-span-2">
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-700">عدد الساعات</label>
                    <input
                      type="number"
                      name="hours"
                      value={formData.hours || ''}
                      onChange={handleInputChange}
                      className={inputBaseClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-700">وقت الاستئذان (اختياري)</label>
                    <select
                      name="permission_time"
                      value={formData.permission_time || ''}
                      onChange={handleInputChange}
                      className={inputBaseClass}
                    >
                      <option value="">بدون تحديد</option>
                      <option value="بداية الدوام">بداية الدوام</option>
                      <option value="أثناء الدوام">أثناء الدوام</option>
                      <option value="نهاية الدوام">نهاية الدوام</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="space-y-2 md:col-span-2">
                <label className="block text-sm font-semibold text-gray-700">ملاحظات (اختياري)</label>
                <textarea
                  name="notes"
                  value={formData.notes || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="أضف أي ملاحظات إضافية..."
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white text-right resize-none"
                  rows={4}
                />
              </div>
            </div>
          </section>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-gray-100 border border-gray-300 rounded-xl hover:bg-gray-200 transition-colors"
          >
            إلغاء
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
          >
            حفظ التغييرات
          </button>
        </div>
      </form>
    </Modal>
  );
};

interface LicenseImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
}

const LicenseImportModal: React.FC<LicenseImportModalProps> = ({ isOpen, onClose, onImported }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<LicenseImportAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) return;
    setSelectedFile(null);
    setAnalysis(null);
    setError(null);
    setIsAnalyzing(false);
    setIsApplying(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const selectFile = () => {
    setError(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    if (!/\.(json|sqlite|sqlite3|db)$/i.test(file.name)) {
      setError('الملف يجب أن يكون JSON أو SQLite (.sqlite/.db)');
      return;
    }
    setSelectedFile(file);
    setAnalysis(null);
    setError(null);
  };

  const analyzeFile = async () => {
    if (!selectedFile) {
      setError('اختر ملف قاعدة الرخص أولاً');
      return;
    }
    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeLicenseImportFile(selectedFile);
      setAnalysis(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const applyImport = async () => {
    if (!selectedFile) {
      setError('اختر ملف قاعدة الرخص أولاً');
      return;
    }
    setIsApplying(true);
    setError(null);
    try {
      await createBackup();
      const result = await applyLicenseImportFile(selectedFile);
      setAnalysis(result);
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsApplying(false);
    }
  };

  const statCards = analysis ? [
    { label: 'إجمالي المصدر', value: analysis.sourceLicenses, tone: 'slate' },
    { label: 'مطابق لموظفين', value: analysis.matched, tone: 'blue' },
    { label: 'جاهز للإضافة', value: analysis.insertable, tone: 'emerald' },
    { label: 'جاهز للنقل', value: analysis.reassignable || 0, tone: 'blue' },
    { label: 'موجود مسبقاً', value: analysis.existing, tone: 'amber' },
    { label: 'غير مطابق', value: analysis.missingEmployees.length, tone: 'rose' },
    { label: 'غير صالح', value: analysis.invalidRows, tone: 'slate' },
  ] : [];

  const toneClass = (tone: string) => {
    if (tone === 'blue') return 'bg-blue-50 text-blue-700 border-blue-100';
    if (tone === 'emerald') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    if (tone === 'amber') return 'bg-amber-50 text-amber-700 border-amber-100';
    if (tone === 'rose') return 'bg-rose-50 text-rose-700 border-rose-100';
    return 'bg-slate-50 text-slate-700 border-slate-100';
  };

  const modalHeader = (
    <div className="relative overflow-hidden rounded-t-lg border-b border-emerald-700/30 bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-600 px-6 py-6 text-white">
      <div className="relative z-10 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <Database className="h-6 w-6 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-black">استيراد رخص واستئذانات</h3>
            <p className="text-xs font-semibold text-emerald-50">إضافة الرخص الناقصة فقط حسب رقم الملف أو الرقم المدني</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/15 transition-colors hover:bg-white/25"
          aria-label="إغلاق"
        >
          <X className="h-5 w-5 text-white" />
        </button>
      </div>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="استيراد رخص واستئذانات" size="xl" header={modalHeader}>
      <div className="space-y-5" dir="rtl">
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.sqlite,.sqlite3,.db,application/json,application/octet-stream"
          onChange={handleFileChange}
          className="hidden"
        />

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
          <button
            type="button"
            onClick={selectFile}
            className="flex items-center justify-between gap-4 rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/60 px-5 py-4 text-right transition hover:border-emerald-300 hover:bg-emerald-50"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm">
                <UploadCloud className="h-5 w-5" />
              </span>
              <div>
                <div className="text-sm font-black text-slate-900">
                  {selectedFile ? selectedFile.name : 'اختر قاعدة الرخص أو ملف JSON'}
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-500">
                  لا يتم تعديل الموظفين. سيتم ربط السجلات بموظفي النظام الحالي فقط.
                </div>
              </div>
            </div>
            <span className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-emerald-700 shadow-sm">
              اختيار ملف
            </span>
          </button>

          <button
            type="button"
            onClick={analyzeFile}
            disabled={isAnalyzing || !selectedFile}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-4 text-sm font-black text-white shadow-lg hover:bg-emerald-700 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
            تحليل الملف
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold leading-6 text-slate-600">
          الاستيراد هنا إضافة فقط: لا إنشاء موظفين، لا تعديل موظفين، ولا مسح للسجلات القديمة. قبل التنفيذ يتم إنشاء نسخة احتياطية تلقائياً.
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        )}

        {analysis && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              {statCards.map((card) => (
                <div key={card.label} className={`rounded-xl border px-4 py-3 ${toneClass(card.tone)}`}>
                  <div className="text-xs font-bold opacity-80">{card.label}</div>
                  <div className="mt-1 text-2xl font-black">{card.value}</div>
                </div>
              ))}
            </div>

            {analysis.applied && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">
                <CheckCircle className="h-4 w-4" />
                تم تنفيذ الاستيراد: إضافة {analysis.inserted ?? 0} سجل، ونقل {analysis.reassigned ?? 0} سجل.
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <section className="rounded-2xl border border-emerald-100 bg-white p-4">
                <div className="mb-3 text-sm font-black text-slate-900">عينة السجلات الجاهزة للإضافة</div>
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {analysis.samples.insertable.length > 0 ? analysis.samples.insertable.map((row) => (
                    <div key={row.id} className="rounded-xl border border-slate-100 bg-emerald-50/50 px-3 py-2 text-sm">
                      <div className="font-bold text-slate-900">{row.employeeRank} / {row.employeeName}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {row.licenseType} - {row.licenseDate} - رقم الملف: {row.fileNumber || row.civilId || 'غير مسجل'}
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm font-bold text-slate-500">
                      لا توجد سجلات جديدة للإضافة.
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-blue-100 bg-white p-4">
                <div className="mb-3 text-sm font-black text-slate-900">عينة السجلات الجاهزة للنقل</div>
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {analysis.samples.reassignable.length > 0 ? analysis.samples.reassignable.map((row) => (
                    <div key={`${row.existingLicenseId || row.id}-${row.employeeId}`} className="rounded-xl border border-slate-100 bg-blue-50/60 px-3 py-2 text-sm">
                      <div className="font-bold text-slate-900">{row.employeeRank} / {row.employeeName}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {row.licenseType} - {row.licenseDate} - من: {row.oldEmployeeRank || ''} / {row.oldEmployeeName || 'موظف خارج الخدمة'}
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm font-bold text-slate-500">
                      لا توجد سجلات تحتاج نقل من موظف خارج الخدمة.
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-rose-100 bg-white p-4">
                <div className="mb-3 text-sm font-black text-slate-900">أرقام لم يتم العثور على موظفيها</div>
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {analysis.samples.missing.length > 0 ? analysis.samples.missing.map((item) => (
                    <div key={item} className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
                      {item}
                    </div>
                  )) : (
                    <div className="rounded-xl bg-emerald-50 px-3 py-6 text-center text-sm font-bold text-emerald-700">
                      كل السجلات المطابقة لها موظفون داخل النظام.
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <div className="text-xs font-bold text-slate-500">
                الموجود مسبقاً أو المكرر لن يتم إدخاله مرة أخرى. السجلات المرتبطة بموظف خارج الخدمة سيتم نقلها للموظف النشط المطابق.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  إغلاق
                </button>
                <button
                  type="button"
                  onClick={applyImport}
                  disabled={isApplying || !selectedFile || ((analysis.insertable || 0) + (analysis.reassignable || 0) === 0)}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  <ShieldCheck className="h-4 w-4" />
                  تنفيذ الاسترداد ({(analysis.insertable || 0) + (analysis.reassignable || 0)})
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

const LicenseList: React.FC = () => {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterOptions>({});
  const [showEditModal, setShowEditModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedLicense, setSelectedLicense] = useState<License | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; license: License | null }>({
    isOpen: false,
    license: null
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(15);
  const [highlightLicenseId, setHighlightLicenseId] = useState<string | null>(null);
  const [highlightFallback, setHighlightFallback] = useState<{ employeeId: string; dateKey: string } | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const messageTimerRef = useRef<number | null>(null);

  // Enhanced search state
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchStats, setSearchStats] = useState({ total: 0, filtered: 0, employees: 0 });
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!message) return;
    if (messageTimerRef.current) {
      window.clearTimeout(messageTimerRef.current);
    }
    messageTimerRef.current = window.setTimeout(() => {
      setMessage(null);
    }, 5000);
    return () => {
      if (messageTimerRef.current) {
        window.clearTimeout(messageTimerRef.current);
      }
    };
  }, [message]);

  const resolveEmployeeIdentifier = (employee?: Employee) => {
    if (!employee) return 'غير مسجل';
    const fileNumber = String(employee.file_number || '').trim();
    const civilId = String(employee.civil_id || '').trim();
    return fileNumber || civilId || 'غير مسجل';
  };

  const jumpToEmployee = (employee?: Employee) => {
    if (!employee?.id) return;
    const categoryLabel = String(employee.category || '');
    const showCivilians = categoryLabel.includes('مدني');
    try {
      localStorage.setItem('employeeHighlightId', String(employee.id));
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
        detail: {
          highlightId: String(employee.id),
          clearSearch: true,
          showCivilians,
          at: Date.now(),
        }
      });
      window.dispatchEvent(evt);
    } catch { }
    try {
      localStorage.setItem('currentPage', 'employees');
    } catch { }
    if (window.location.hash !== '#employees') {
      window.location.hash = '#employees';
    }
  };

  const employeesWithLicenses = useMemo(() => {
    const licensedEmployeeIds = new Set(licenses.map(l => l.employee_id));
    return employees.filter(emp => licensedEmployeeIds.has(emp.id));
  }, [licenses, employees]);

  const departmentOptions = useMemo(() => {
    const departments = employeesWithLicenses
      .map(emp => String(emp.department || '').trim())
      .filter(Boolean);
    return Array.from(new Set(departments)).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [employeesWithLicenses]);

  useEffect(() => {
    loadData();
  }, []);

  const toDateKey = (value?: string) => {
    if (!value) return '';
    const directMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (directMatch) return directMatch[1];
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const applyLicenseHighlight = (payload: {
    id?: string;
    employeeId?: string;
    date?: string;
    clearSearch?: boolean;
    clearFilters?: boolean;
  }) => {
    if (payload.clearSearch) {
      setSearchQuery('');
    }
    if (payload.clearFilters) {
      setFilters({});
    }
    if (payload.id) {
      setHighlightLicenseId(String(payload.id));
    }
    const dateKey = toDateKey(payload.date);
    if (payload.employeeId && dateKey) {
      setHighlightFallback({ employeeId: String(payload.employeeId), dateKey });
    } else {
      setHighlightFallback(null);
    }
  };

  useEffect(() => {
    try {
      const highlightId = localStorage.getItem('licenseHighlightId');
      const employeeId = localStorage.getItem('licenseHighlightEmployeeId');
      const highlightDate = localStorage.getItem('licenseHighlightDate');
      const clearSearch = localStorage.getItem('licenseHighlightClearSearch');
      const clearFilters = localStorage.getItem('licenseHighlightClearFilters');
      if (highlightId || employeeId || highlightDate) {
        applyLicenseHighlight({
          id: highlightId || undefined,
          employeeId: employeeId || undefined,
          date: highlightDate || undefined,
          clearSearch: clearSearch === 'true',
          clearFilters: clearFilters === 'true'
        });
        try {
          localStorage.removeItem('licenseHighlightId');
          localStorage.removeItem('licenseHighlightEmployeeId');
          localStorage.removeItem('licenseHighlightDate');
          localStorage.removeItem('licenseHighlightAt');
          localStorage.removeItem('licenseHighlightClearSearch');
          localStorage.removeItem('licenseHighlightClearFilters');
        } catch { }
      }
    } catch { }

    const onLicenseHighlight = (e: Event) => {
      const ce = e as CustomEvent;
      const id = (ce?.detail?.id as string) || '';
      const employeeId = (ce?.detail?.employeeId as string) || '';
      const date = (ce?.detail?.date as string) || '';
      const clearSearch = (ce?.detail?.clearSearch as boolean) || false;
      const clearFilters = (ce?.detail?.clearFilters as boolean) || false;
      if (!id && !employeeId && !date) return;
      applyLicenseHighlight({ id, employeeId, date, clearSearch, clearFilters });
    };
    window.addEventListener('license-highlight', onLicenseHighlight as EventListener);
    return () => {
      window.removeEventListener('license-highlight', onLicenseHighlight as EventListener);
    };
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [licensesData, employeesData] = await Promise.all([
        LicenseService.getAll(),
        EmployeeService.getAll()
      ]);
      const activeEmployees = employeesData.filter(employee => employee.status !== 'inactive');
      const employeesById = new Map(activeEmployees.map(emp => [String(emp.id), emp]));
      const enrichedLicenses = licensesData.map((license) => {
        const fallbackEmployee = employeesById.get(String(license.employee_id));
        if (!fallbackEmployee) return license;
        const baseEmployee = license.employee ?? fallbackEmployee;
        const mergedEmployee = {
          ...fallbackEmployee,
          ...baseEmployee,
          civil_id: baseEmployee.civil_id || fallbackEmployee.civil_id,
          department: baseEmployee.department || fallbackEmployee.department,
          section: baseEmployee.section || fallbackEmployee.section
        };
        return {
          ...license,
          employee: mergedEmployee
        };
      });
      setLicenses(enrichedLicenses);
      setEmployees(activeEmployees);
    } catch (err) {
      console.error("Failed to load data:", err);
      setError("حدث خطأ أثناء تحميل البيانات. يرجى المحاولة مرة أخرى.");
    } finally {
      setLoading(false);
    }
  };

  // Enhanced search suggestions logic
  const generateSearchSuggestions = useMemo(() => {
    return (query: string) => {
      if (!query.trim()) {
        return [
          'ابحث بالاسم',
          'ابحث بالرتبة',
          'ابحث برقم الملف',
          'ابحث بالرقم المدني',
          'ابحث بالقسم',
          'ابحث بالادارة'
        ];
      }

      const suggestions: string[] = [];
      const lowerQuery = query.toLowerCase();

      // Employee-based suggestions
      employees.forEach(emp => {
        if (emp.full_name.toLowerCase().includes(lowerQuery) && !suggestions.includes(emp.full_name)) {
          suggestions.push(emp.full_name);
        }
        if (emp.rank.toLowerCase().includes(lowerQuery) && !suggestions.includes(emp.rank)) {
          suggestions.push(emp.rank);
        }
        if (emp.file_number.toString().includes(query) && !suggestions.includes(emp.file_number.toString())) {
          suggestions.push(emp.file_number.toString());
        }
        if (emp.civil_id && emp.civil_id.includes(query) && !suggestions.includes(emp.civil_id)) {
          suggestions.push(emp.civil_id);
        }
      });

      // License type suggestions
      const licenseTypes = [...new Set(licenses.map(l => l.license_type))];
      licenseTypes.forEach(type => {
        if (type.toLowerCase().includes(lowerQuery) && !suggestions.includes(type)) {
          suggestions.push(type);
        }
      });

      // Department suggestions
      const departments = [...new Set(employees.map(emp => emp.department).filter((dept): dept is string => Boolean(dept)))];
      departments.forEach(dept => {
        if (dept.toLowerCase().includes(lowerQuery) && !suggestions.includes(dept)) {
          suggestions.push(dept);
        }
      });

      return suggestions.slice(0, 8); // Limit to 8 suggestions
    };
  }, [employees, licenses]);

  // Handle search input changes with debouncing
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    setIsSearching(true);

    // Generate suggestions
    const suggestions = generateSearchSuggestions(query);
    setSearchSuggestions(suggestions);
    setShowSuggestions(true);

    // Add to recent searches if not empty
    if (query.trim() && !recentSearches.includes(query)) {
      const newRecentSearches = [query, ...recentSearches.slice(0, 4)];
      setRecentSearches(newRecentSearches);
      localStorage.setItem('licenseRecentSearches', JSON.stringify(newRecentSearches));
    }

    // Debounce search
    setTimeout(() => setIsSearching(false), 300);
  };

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('licenseRecentSearches');
      if (saved) {
        setRecentSearches(JSON.parse(saved));
      }
    } catch { }
  }, []);

  const sortedAndFilteredLicenses = useMemo(() => {
    const filteredLicenses = licenses.filter(license => {
      const employee = license.employee;

      const matchesSearch = matchesSearchText([
        employee?.full_name,
        employee?.rank,
        employee?.file_number,
        employee?.civil_id,
        license.license_type,
        employee?.department,
        employee?.section
      ], searchQuery);

      const matchesFilters =
        (!filters.department || String(employee?.department || '').trim() === String(filters.department)) &&
        (!filters.license_type || license.license_type === filters.license_type) &&
        (!filters.month || license.month === Number(filters.month)) &&
        (!filters.year || license.year === Number(filters.year));

      return matchesSearch && matchesFilters;
    });

    // ترتيب التراخيص حسب تاريخ الإنشاء (الأحدث أولاً)
    return filteredLicenses.sort((a, b) => {
      const dateA = new Date(a.created_at || a.license_date);
      const dateB = new Date(b.created_at || b.license_date);
      return dateB.getTime() - dateA.getTime();
    });
  }, [licenses, searchQuery, filters]);

  // Update search stats
  useEffect(() => {
    const stats = {
      total: licenses.length,
      filtered: sortedAndFilteredLicenses.length,
      employees: new Set(sortedAndFilteredLicenses.map(l => l.employee_id)).size
    };
    setSearchStats(stats);
  }, [sortedAndFilteredLicenses, licenses]);

  // Pagination logic
  const totalPages = Math.ceil(sortedAndFilteredLicenses.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentPageLicenses = sortedAndFilteredLicenses.slice(startIndex, endIndex);

  const highlightIndex = useMemo(() => {
    if (!highlightLicenseId && !highlightFallback) return -1;
    let index = -1;
    if (highlightLicenseId) {
      index = sortedAndFilteredLicenses.findIndex(license => String(license.id) === highlightLicenseId);
    }
    if (index < 0 && highlightFallback) {
      index = sortedAndFilteredLicenses.findIndex((license) => {
        const employeeId = String(license.employee_id || '');
        if (employeeId !== highlightFallback.employeeId) return false;
        const licenseDateKey = toDateKey(license.license_date || license.created_at);
        return licenseDateKey === highlightFallback.dateKey;
      });
    }
    return index;
  }, [sortedAndFilteredLicenses, highlightLicenseId, highlightFallback]);

  useEffect(() => {
    if (highlightIndex < 0) return;
    const targetPage = Math.floor(highlightIndex / itemsPerPage) + 1;
    if (currentPage !== targetPage) {
      setCurrentPage(targetPage);
      return;
    }
    const targetLicense = sortedAndFilteredLicenses[highlightIndex];
    if (!targetLicense) return;
    const targetId = String(targetLicense.id);
    if (highlightLicenseId !== targetId) {
      setHighlightLicenseId(targetId);
    }
    const row = document.getElementById(`license-row-${targetId}`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setHighlightFallback(null);
  }, [highlightIndex, currentPage, itemsPerPage, sortedAndFilteredLicenses, highlightLicenseId]);

  useEffect(() => {
    if (!highlightLicenseId || highlightIndex < 0) return;
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightLicenseId(null);
    }, 5000);
    return () => {
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, [highlightLicenseId, highlightIndex]);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filters]);

  const openDeleteModal = (license: License) => {
    setDeleteModal({ isOpen: true, license });
  };

  const closeDeleteModal = () => {
    setDeleteModal({ isOpen: false, license: null });
  };

  const handleDeleteConfirm = async () => {
    const license = deleteModal.license;
    if (!license) return;
    try {
      await LicenseService.delete(String(license.id));
      setMessage({ text: 'تم حذف الرخصة/الاستئذان بنجاح', type: 'success' });
      loadData();
    } catch (error) {
      console.error('Failed to delete license:', error);
      setMessage({ text: 'فشل حذف الرخصة/الاستئذان', type: 'error' });
    } finally {
      closeDeleteModal();
    }
  };

  const handleEdit = (license: License) => {
    setSelectedLicense(license);
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setSelectedLicense(null);
  };

  const handleUpdate = async (updatedLicense: Partial<License>) => {
    if (!selectedLicense) return;
    try {
      await LicenseService.update(String(selectedLicense.id), updatedLicense);
      setMessage({ text: 'تم تحديث الرخصة/الاستئذان بنجاح', type: 'success' });
      setShowEditModal(false);
      setSelectedLicense(null);
      loadData(); // Refresh data
    } catch (error) {
      console.error('Failed to update license:', error);
      setMessage({ text: 'فشل تحديث الرخصة/الاستئذان', type: 'error' });
    }
  };

  const handleImportApplied = async () => {
    setMessage({ text: 'تم تنفيذ استيراد الرخص/الاستئذانات وتحديث السجلات', type: 'success' });
    await loadData();
  };

  const clearFilters = () => {
    setFilters({});
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchSuggestions([]);
    setShowSuggestions(false);
    searchInputRef.current?.focus();
  };

  const applyQuickFilter = (filter: string) => {
    setSearchQuery(filter);
    setShowSuggestions(false);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '';
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${year}/${month}/${day}`;
    } catch (error) {
      return '';
    }
  };

  const getMonthName = (month: number) => {
    const date = new Date();
    date.setMonth(month - 1);
    return date.toLocaleDateString('ar-US', { month: 'long' });
  };

  const exportToWord = () => {
    if (sortedAndFilteredLicenses.length === 0) {
      setMessage({ text: 'لا توجد بيانات لتصديرها.', type: 'error' });
      return;
    }
    const title = new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: "نظام الرخص والاستئذانات للإدارة العامة لالمكتب الرئيسي",
        font: "Sultan bold",
        size: 42, // 21pt
        bold: false,
        underline: { type: UnderlineType.SINGLE, color: "000000" },
        rightToLeft: true,
      })],
      spacing: { after: 400 },
    });

    const createCell = (text: string, isHeader: boolean) => new TableCell({
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text,
          font: isHeader ? "Sultan bold" : "Times New Roman",
          size: 26, // 13pt
          bold: !isHeader,
          rightToLeft: true,
        })],
      })],
      verticalAlign: VerticalAlign.CENTER,
      shading: isHeader ? { type: ShadingType.SOLID, color: 'E5E7EB', fill: 'E5E7EB' } : undefined,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
        left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
        right: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      },
    });

    const tableHeader = new TableRow({
      children: ['م', 'الرتبة', 'اسم الموظف', 'رقم الملف/المدني', 'الإدارة', 'نوع الرخصة/الاستئذان', 'تاريخ الرخصة/الاستئذان', 'الساعات', 'السنة'].map(text => createCell(text, true)),
      height: { value: 567, rule: HeightRule.EXACT }, // 1cm
    });

    const tableRows = sortedAndFilteredLicenses.map((license, index) => new TableRow({
      children: [
        createCell(String(index + 1), false),
        createCell(license.employee?.category === 'ضابط' || license.employee?.category === 'ضابط صف'
          ? license.employee?.rank || ''
          : license.employee?.category || '', false),
        createCell(license.employee?.full_name || '', false),
        createCell(resolveEmployeeIdentifier(license.employee), false),
        createCell(license.employee?.department || 'غير مسجل', false),
        createCell(formatLicenseTypeLabel(license), false),
        createCell(formatDate(license.license_date), false),
        createCell(formatLicenseHoursLabel(license), false),
        createCell(String(license.year), false),
      ],
      height: { value: 567, rule: HeightRule.EXACT }, // 1cm
    }));

    const table = new Table({
      rows: [tableHeader, ...tableRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
      visuallyRightToLeft: true,
    });

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: {
              top: 720, // 0.5 inch
              right: 720, // 0.5 inch
              bottom: 720, // 0.5 inch
              left: 720, // 0.5 inch
            },
          },
        },
        children: [title, table],
      }],
    });

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const arabicMonths = [
      "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
      "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
    ];
    const currentMonthName = arabicMonths[month];
    const fileName = `نظام الرخص والاستئذانات للإدارة العامة لالمكتب الرئيسي - ${currentMonthName} - ${year}.docx`;
    Packer.toBlob(doc).then(blob => {
      saveAs(blob, fileName);
    }).catch(err => {
      console.error('Word export error:', err);
      setMessage({ text: 'فشل تصدير ملف Word. تحقق من الكونسول لمزيد من التفاصيل.', type: 'error' });
    });
  };

  const exportData = () => {
    if (sortedAndFilteredLicenses.length === 0) {
      setMessage({ text: 'لا توجد بيانات لتصديرها.', type: 'error' });
      return;
    }
    let csvContent = "\uFEFF"; // BOM for UTF-8
    csvContent += "م,الرتبة,اسم الموظف,رقم الملف/المدني,الإدارة,نوع الرخصة/الاستئذان,تاريخ الرخصة/الاستئذان,الساعات,الشهر,السنة\r\n";
    sortedAndFilteredLicenses.forEach((license, index) => {
      const row = [
        index + 1,
        license.employee?.rank || '',
        `"${license.employee?.full_name || ''}"`,
        `"${resolveEmployeeIdentifier(license.employee)}"`,
        `"${license.employee?.department || 'غير مسجل'}"`,
        formatLicenseTypeLabel(license),
        formatDate(license.license_date),
        formatLicenseHoursLabel(license),
        license.month,
        license.year
      ].join(',');
      csvContent += row + "\r\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, "licenses.csv");
  };

  // Show loading state
  if (loading) {
    return <LoadingPage variant="dashboard" title="جاري تحميل سجلات الاستئذانات" subtitle="يرجى الانتظار بينما نحضر الرخص والاستئذانات..." />;
  }

  if (error) {
    return <div className="flex justify-center items-center h-screen"><div className="text-red-500">{error}</div></div>;
  }

  const deleteDescription = deleteModal.license?.employee?.full_name
    ? `سيتم حذف الرخصة/الاستئذان الخاص بـ ${deleteModal.license.employee.full_name} نهائياً.`
    : 'سيتم حذف الرخصة/الاستئذان نهائياً.';

  return (
    <div className="p-3 max-w-full">
      <div className="mx-auto space-y-6 animate-fade-in max-w-full">
        {message && (
          <div className={`fixed top-5 right-5 p-4 rounded-md shadow-lg text-white z-50 ${message.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
            {message.text}
          </div>
        )}

        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-7 max-w-full">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl flex items-center justify-center shadow-lg">
                <FileText className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-gray-900">سجلات الرخص والاستئذانات</h1>
                <p className="text-sm text-gray-600 mt-1">عرض وتتبع جميع الرخص والاستئذانات المسجلة</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-600">
              <button
                type="button"
                onClick={() => setShowImportModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
              >
                <UploadCloud className="h-4 w-4" />
                استيراد
              </button>
              <span className="rounded-xl border border-gray-200 bg-white px-4 py-2">
                إجمالي السجلات: <span className="text-gray-900">{sortedAndFilteredLicenses.length}</span>
              </span>
              <span className="rounded-xl border border-gray-200 bg-white px-4 py-2">
                في الصفحة: <span className="text-gray-900">{currentPageLicenses.length}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Quick Search Section */}
        <div className="relative rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-blue-50/70 p-6 shadow-lg max-w-full overflow-hidden">
          <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-blue-200/30 blur-2xl" />
          <div className="pointer-events-none absolute -left-12 -bottom-12 h-40 w-40 rounded-full bg-indigo-200/30 blur-2xl" />
          <div className="relative z-10 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-500 shadow-lg flex items-center justify-center">
                  <Search className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">البحث السريع</h2>
                  <p className="text-xs text-gray-600">ابحث بالاسم، الرتبة، رقم الملف، الإدارة أو القسم</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-white/80 px-3 py-2 text-xs text-gray-600">
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  <span>الإجمالي</span>
                  <span className="font-bold text-gray-900">{searchStats.total}</span>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-white/80 px-3 py-2 text-xs text-gray-600">
                  <Filter className="w-3.5 h-3.5 text-emerald-600" />
                  <span>المطابقة</span>
                  <span className="font-bold text-gray-900">{searchStats.filtered}</span>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-white/80 px-3 py-2 text-xs text-gray-600">
                  <Users className="w-3.5 h-3.5 text-indigo-600" />
                  <span>موظفين</span>
                  <span className="font-bold text-gray-900">{searchStats.employees}</span>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="flex flex-col xl:flex-row gap-4">
                <div className="flex-1 relative">
                  <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none">
                    {isSearching ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                    ) : (
                      <Search className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="ابحث بالاسم، الرتبة، رقم الملف، القسم، نوع الرخصة..."
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    className="w-full pr-12 pl-12 py-4 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-400 transition-all duration-200 bg-white/90 text-right text-base font-semibold"
                  />
                  {searchQuery && (
                    <button
                      onClick={clearSearch}
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`px-9 py-4 rounded-2xl transition-all duration-200 flex items-middle gap-2 text-sm font-bold ${showFilters
                      ? 'bg-blue-100 text-blue-700 shadow-sm border border-blue-200 hover:bg-blue-200'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                      }`}
                  >
                    <Filter className="w-4 h-4" />
                    <span>الفلاتر</span>
                  </button>
                  {searchQuery && (
                    <button
                      onClick={clearSearch}
                      className="px-4 py-2 rounded-xl bg-red-50 text-red-700 border border-red-100 hover:bg-red-100 transition-all duration-200 flex items-center gap-2 text-xs font-semibold"
                    >
                      <X className="w-4 h-4" />
                      <span>مسح البحث</span>
                    </button>
                  )}

                </div>
              </div>

              {showSuggestions && (searchSuggestions.length > 0 || recentSearches.length > 0) && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden">
                  <div className="max-h-72 overflow-y-auto">
                    {searchSuggestions.length > 0 && (
                      <div className="border-b border-slate-100">
                        <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
                          <span className="text-sm font-semibold text-slate-700">اقتراحات البحث</span>
                          <button
                            onClick={() => setShowSuggestions(false)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="p-2 space-y-1">
                          {searchSuggestions.map((suggestion, index) => (
                            <button
                              key={index}
                              onClick={() => applyQuickFilter(suggestion)}
                              className="w-full text-right p-3 hover:bg-blue-50 rounded-xl transition-colors text-sm"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-slate-900">{suggestion}</span>
                                <span className="text-xs text-slate-500">اضغط للبحث</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {recentSearches.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
                          <span className="text-sm font-semibold text-slate-700">البحث الأخير</span>
                          <button
                            onClick={() => setRecentSearches([])}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="p-2 space-y-1">
                          {recentSearches.map((search, index) => (
                            <button
                              key={index}
                              onClick={() => applyQuickFilter(search)}
                              className="w-full text-right p-3 hover:bg-emerald-50 rounded-xl transition-colors text-sm flex items-center justify-between"
                            >
                              <span className="text-slate-900">{search}</span>
                              <History className="w-4 h-4 text-emerald-500" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {showFilters && (
              <div className="pt-4 border-t border-slate-200/70 animate-slide-up">
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 md:p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center">
                        <Filter className="w-4 h-4 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-gray-800">خيارات الفلترة</h3>
                        <p className="text-xs text-gray-500">اختر الإدارة ونوع الرخصة/الاستئذان والتاريخ</p>
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
                      <label className="block text-xs font-semibold text-gray-600">الإدارة</label>
                      <select
                        value={filters.department || ''}
                        onChange={(e) => {
                          const value = e.target.value || undefined;
                          setFilters(prev => ({ ...prev, department: value }));
                        }}
                        className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                      >
                        <option value="">جميع الإدارات</option>
                        {departmentOptions.map((department) => (
                          <option key={department} value={department}>{department}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-gray-600">نوع الرخصة/الاستئذان</label>
                      <select
                        value={filters.license_type || ''}
                        onChange={(e) => setFilters(prev => ({ ...prev, license_type: e.target.value }))}
                        className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                      >
                        <option value="">جميع الأنواع</option>
                        {[...new Set(licenses.map(l => l.license_type))].map(type => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-gray-600">الشهر</label>
                      <select
                        value={filters.month ?? ''}
                        onChange={(e) => {
                          const value = e.target.value ? Number(e.target.value) : undefined;
                          setFilters(prev => ({ ...prev, month: value }));
                        }}
                        className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                      >
                        <option value="">جميع الشهور</option>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                          <option key={m} value={m}>{getMonthName(Number(m))}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-gray-600">السنة</label>
                      <select
                        value={filters.year ?? ''}
                        onChange={(e) => {
                          const value = e.target.value ? Number(e.target.value) : undefined;
                          setFilters(prev => ({ ...prev, year: value }));
                        }}
                        className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                      >
                        <option value="">جميع السنوات</option>
                        {[...new Set(licenses.map(l => l.year))].sort((a, b) => b - a).map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* License List */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden max-w-full">
          <div className="bg-gradient-to-r from-blue-600 to-blue-800 px-8 py-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white">سجلات الرخص والاستئذانات</h2>
                  <p className="text-sm text-blue-100 mt-1">
                    عرض {startIndex + 1}-{Math.min(endIndex, sortedAndFilteredLicenses.length)} من أصل {sortedAndFilteredLicenses.length} سجل
                    {totalPages > 1 && ` (صفحة ${currentPage} من ${totalPages})`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={exportToWord}
                  className="rounded-xl bg-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/30 transition-colors inline-flex items-center gap-2 border border-white/30"
                >
                  <Download size={14} />
                  Word
                </button>
                <button
                  onClick={exportData}
                  className="rounded-xl bg-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/30 transition-colors inline-flex items-center gap-2 border border-white/30"
                >
                  <Download size={14} />
                  CSV
                </button>
              </div>
            </div>
          </div>
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            </div>
          ) : error ? (
            <div className="text-center py-10 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 font-semibold text-lg">{error}</p>
              <button onClick={loadData} className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500">
                إعادة المحاولة
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                  <tr>
                    <th className="px-6 py-4 text-right text-sm font-bold text-gray-700 border-b-2 border-gray-200">م</th>
                    <th className="px-6 py-4 text-right text-sm font-bold text-gray-700 border-b-2 border-gray-200">اسم الموظف</th>
                    <th className="px-6 py-4 text-right text-sm font-bold text-gray-700 border-b-2 border-gray-200">الإدارة / القسم</th>
                    <th className="px-6 py-4 text-right text-sm font-bold text-gray-700 border-b-2 border-gray-200">النوع</th>
                    <th className="px-6 py-4 text-right text-sm font-bold text-gray-700 border-b-2 border-gray-200">التاريخ</th>
                    <th className="px-6 py-4 text-right text-sm font-bold text-gray-700 border-b-2 border-gray-200">الساعات</th>
                    <th className="px-6 py-4 text-right text-sm font-bold text-gray-700 border-b-2 border-gray-200">سُجلت منذ</th>
                    <th className="px-6 py-4 text-right text-sm font-bold text-gray-700 border-b-2 border-gray-200">ملاحظات</th>
                    <th className="px-6 py-4 text-center text-sm font-bold text-gray-700 border-b-2 border-gray-200">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {currentPageLicenses.length > 0 ? (
                    currentPageLicenses.map((license, index) => {
                      const isHighlighted = String(license.id) === highlightLicenseId;
                      const identifier = getEmployeeIdentifierDetails(license.employee);
                      const rankLabel = license.employee?.category === 'ضابط' || license.employee?.category === 'ضابط صف'
                        ? license.employee?.rank
                        : license.employee?.category;
                      return (
                        <tr
                          key={license.id}
                          id={`license-row-${license.id}`}
                          className={`transition-colors duration-200 group ${isHighlighted ? 'bg-yellow-50 ring-2 ring-yellow-200' : 'hover:bg-blue-50'
                            }`}
                        >
                          <td className="px-6 py-4 text-sm text-gray-900">
                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center font-bold text-blue-600 group-hover:bg-blue-200">
                              {startIndex + index + 1}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                {rankLabel ? (
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${getRankBadgeClasses(license.employee)}`}
                                  >
                                    {rankLabel}
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => jumpToEmployee(license.employee)}
                                  className="cursor-pointer text-right font-bold text-gray-900 hover:text-blue-700 transition-colors"
                                  title="الانتقال إلى إدارة الموظفين"
                                >
                                  {license.employee?.full_name || '—'}
                                </button>
                              </div>
                              {identifier.value ? (
                                <div className="text-xs text-gray-500">
                                  {identifier.label}: <span className="font-bold text-gray-800">{identifier.value}</span>
                                </div>
                              ) : (
                                <div className="text-xs text-gray-400 italic">غير مسجل</div>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700">
                            {license.employee?.department ? (
                              <div className="flex items-start gap-2">
                                <Building className="w-4 h-4 text-blue-500 mt-0.5" />
                                <div className="text-sm text-gray-800">
                                  <span
                                    className="whitespace-pre-line break-words"
                                    title={license.employee.department}
                                  >
                                    {truncateText(license.employee.department, 28)}
                                  </span>
                                  {license.employee.section && (
                                    <div className="text-[11px] text-gray-500 mt-1 leading-snug">
                                      {license.employee.section}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-400 italic">غير مسجل</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm">
                            <span className={`px-4 py-1 rounded-full text-xs font-bold shadow-sm ${license.license_type === 'يوم كامل'
                              ? 'bg-green-100 text-green-800 border border-green-200'
                              : license.license_type === 'إستئذان طبي'
                                ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                : 'bg-orange-100 text-orange-800 border border-orange-200'
                              }`}>
                              {formatLicenseTypeLabel(license)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700 font-medium">
                            <span className="font-bold text-xs text-gray-500">
                              {new Date(license.license_date).toLocaleDateString('ar-US', {
                                weekday: 'long',
                              })}
                            </span><br />
                            <span className="font-bold text-sm">{formatDate(license.license_date)}</span>
                          </td>
                          <td className="px-6 py-4 text-sm">
                            {license.license_type === 'يوم كامل' ? (
                              <span className="text-gray-400 font-medium">يوم كامل</span>
                            ) : formatHoursLabel(license.hours) ? (
                              <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold">
                                {formatLicenseHoursLabel(license)}
                              </span>
                            ) : (
                              <span className="text-gray-400 font-medium">غير مسجل</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm">
                            <span className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs font-medium">
                              {license.created_at ? getTimeSince(license.created_at) : 'غير متوفر'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700">
                            {license.notes ? (
                              <div className="max-w-xs truncate" title={license.notes}>
                                {license.notes}
                              </div>
                            ) : (
                              <span className="text-gray-400 italic">لا توجد ملاحظات</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleEdit(license)}
                                className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-all duration-200 group/btn"
                                title="تعديل الرخصة/الاستئذان"
                              >
                                <Edit className="w-4 h-4 group-hover/btn:scale-110 transition-transform duration-200" />
                              </button>
                              <button
                                onClick={() => openDeleteModal(license)}
                                className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-all duration-200 group/btn"
                                title="حذف الرخصة/الاستئذان"
                              >
                                <Trash2 className="w-4 h-4 group-hover/btn:scale-110 transition-transform duration-200" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} className="text-center py-16">
                        <div className="flex flex-col items-center justify-center">
                          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                            <FileText className="w-8 h-8 text-gray-400" />
                          </div>
                          <h3 className="text-lg font-semibold text-gray-700 mb-2">لا توجد رخص أو استئذانات</h3>
                          <p className="text-gray-500 mb-4">لم يتم العثور على أي رخص أو استئذانات تطابق معايير البحث</p>
                          <div className="flex gap-3">
                            <button
                              onClick={clearFilters}
                              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200"
                            >
                              مسح الفلاتر
                            </button>
                            <button
                              onClick={() => setSearchQuery('')}
                              className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200"
                            >
                              مسح البحث
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mt-6">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                عرض {startIndex + 1} إلى {Math.min(endIndex, sortedAndFilteredLicenses.length)} من أصل {sortedAndFilteredLicenses.length} سجل
              </div>

              <div className="flex items-center gap-2">
                {/* Previous Button */}
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${currentPage === 1
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                    }`}
                >
                  السابق
                </button>

                {/* Page Numbers */}
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors duration-200 ${currentPage === pageNum
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                {/* Next Button */}
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${currentPage === totalPages
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                    }`}
                >
                  التالي
                </button>
              </div>
            </div>
          </div>
        )}

        <EditLicenseModal
          isOpen={showEditModal}
          license={selectedLicense}
          employees={employees}
          onUpdate={handleUpdate}
          onClose={closeEditModal}
        />

        <LicenseImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onImported={handleImportApplied}
        />

        <ConfirmDeleteModal
          isOpen={deleteModal.isOpen}
          onClose={closeDeleteModal}
          onConfirm={handleDeleteConfirm}
          title="حذف الرخصة/الاستئذان"
          description={deleteDescription}
          confirmLabel="حذف نهائي"
        />
      </div>
    </div>
  );
};

export default LicenseList;
