import React, { useState, useEffect, useMemo } from 'react';
import Select from 'react-select';
import { Search, FileText, CheckCircle, Filter, Calendar, Users, BarChart2, Sparkles } from 'lucide-react';
import { LicenseService } from '../services/licenseService';
import { License } from '../types';
import LoadingPage from '../../components/LoadingPage';

interface ReportFilters {
  selectedYear: string;
  selectedMonth: string;
  selectedEmployees: string[];
  categories: string[];
}

const customSelectStyles = {
  control: (provided: any) => ({
    ...provided,
    minHeight: '44px',
    border: '2px solid #e5e7eb',
    borderRadius: '14px',
    '&:hover': {
      borderColor: '#3b82f6',
    },
    '&:focus-within': {
      borderColor: '#3b82f6',
      boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.15)',
    },
  }),
  option: (provided: any, state: any) => ({
    ...provided,
    backgroundColor: state.isSelected ? '#2563eb' : state.isFocused ? '#eff6ff' : 'white',
    color: state.isSelected ? 'white' : '#111827',
    padding: '10px 12px',
  }),
};

interface ReportStep {
  id: 'filters' | 'preview';
  title: string;
  icon: React.ComponentType<any>;
}

const ReportsNew: React.FC = () => {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentStep] = useState<ReportStep['id']>('filters');

  const currentDate = new Date();
  const currentYear = currentDate.getFullYear().toString();
  const currentMonth = (currentDate.getMonth() + 1).toString();

  const [filters, setFilters] = useState<ReportFilters>({
    selectedYear: currentYear,
    selectedMonth: currentMonth,
    selectedEmployees: [],
    categories: []
  });

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const licensesData = await LicenseService.getAll();
        setLicenses(licensesData);
      } catch (error) {
        console.error('Failed to load licenses:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const uniqueEmployees = useMemo(() => {
    const employeeMap = new Map();
    licenses.forEach(license => {
      if (license.employee && !employeeMap.has(license.employee.id)) {
        employeeMap.set(license.employee.id, license.employee);
      }
    });
    return Array.from(employeeMap.values());
  }, [licenses]);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    licenses.forEach(license => {
      const year = new Date(license.license_date).getFullYear().toString();
      years.add(year);
    });
    years.add(currentYear);
    return Array.from(years).sort((a, b) => parseInt(b) - parseInt(a));
  }, [licenses, currentYear]);

  const availableMonths = [
    { value: '1', label: 'يناير' },
    { value: '2', label: 'فبراير' },
    { value: '3', label: 'مارس' },
    { value: '4', label: 'أبريل' },
    { value: '5', label: 'مايو' },
    { value: '6', label: 'يونيو' },
    { value: '7', label: 'يوليو' },
    { value: '8', label: 'أغسطس' },
    { value: '9', label: 'سبتمبر' },
    { value: '10', label: 'أكتوبر' },
    { value: '11', label: 'نوفمبر' },
    { value: '12', label: 'ديسمبر' }
  ];

  const filteredLicenses = useMemo(() => {
    const loweredSearch = searchTerm.toLowerCase();
    return licenses.filter(license => {
      const licenseDate = new Date(license.license_date);
      const yearMatches = !filters.selectedYear || licenseDate.getFullYear().toString() === filters.selectedYear;
      const monthMatches = !filters.selectedMonth || (licenseDate.getMonth() + 1).toString() === filters.selectedMonth;

      const employee = license.employee;
      const employeeId = employee?.id?.toString();
      const matchesEmployees = filters.selectedEmployees.length === 0 || (employeeId ? filters.selectedEmployees.includes(employeeId) : false);
      const matchesCategories = filters.categories.length === 0 || (employee?.category ? filters.categories.includes(employee.category) : false);

      const matchesSearch = loweredSearch
        ? (employee?.full_name?.toLowerCase().includes(loweredSearch) ||
          employee?.rank?.toLowerCase().includes(loweredSearch) ||
          employee?.file_number?.toLowerCase().includes(loweredSearch))
        : true;

      return yearMatches && monthMatches && matchesEmployees && matchesCategories && matchesSearch;
    });
  }, [licenses, filters, searchTerm]);

  const selectedEmployeesDetails = useMemo(() => {
    return uniqueEmployees.filter(emp => filters.selectedEmployees.includes(emp.id.toString()));
  }, [filters.selectedEmployees, uniqueEmployees]);

  const reportSteps: ReportStep[] = [
    { id: 'filters', title: 'تحديد معايير التقرير', icon: Filter },
    { id: 'preview', title: 'عرض النتائج والتصدير', icon: FileText }
  ];

  const currentStepIndex = reportSteps.findIndex(step => step.id === currentStep);
  const progressPercent = ((currentStepIndex + 1) / reportSteps.length) * 100;
  const monthLabel = availableMonths.find(month => month.value === filters.selectedMonth)?.label || 'جميع الشهور';
  const categoryOptions = [
    { value: 'ضابط', label: 'ضابط' },
    { value: 'ضابط صف', label: 'ضابط صف' },
    { value: 'جندي', label: 'جندي' },
    { value: 'مهني', label: 'مهني' },
    { value: 'مدني', label: 'مدني' }
  ];

  const highlightedEmployees = useMemo(() => {
    const seen = new Set<string>();
    const names: { id: string; name: string; rank?: string }[] = [];
    filteredLicenses.forEach(license => {
      if (!license.employee || seen.has(license.employee.id) || names.length >= 3) return;
      seen.add(license.employee.id);
      names.push({ id: license.employee.id, name: license.employee.full_name, rank: license.employee.rank });
    });
    return names;
  }, [filteredLicenses]);

  if (loading) {
    return <LoadingPage variant="dashboard" title="جاري تحميل تقارير الاستئذانات" subtitle="يرجى الانتظار بينما نحضر بيانات التقارير..." />;
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-xl shadow-slate-200/60 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-lg shadow-blue-200">
                <FileText className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-black text-slate-900">إنشاء تقرير جديد</h1>
                <p className="text-slate-600 mt-1">حدد معايير التقرير لتسجيل رخصة/استئذان جديد</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm">
                الخطوة {currentStepIndex + 1} من {reportSteps.length}
              </div>
              <div className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 shadow-sm">
                {filteredLicenses.length} سجل مطابق للمعايير
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-lg shadow-slate-200/50 p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reportSteps.map((step, index) => {
              const isActive = step.id === currentStep;
              const isCompleted = currentStepIndex > index;
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-md shadow-slate-200/60">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-slate-500 uppercase">إجمالي السجلات</div>
              <BarChart2 className="h-4 w-4 text-slate-400" />
            </div>
            <div className="text-3xl font-black text-slate-900">{licenses.length}</div>
            <p className="text-xs text-slate-500 mt-1">جميع الرخص والاستئذانات المسجلة</p>
          </div>
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-md shadow-blue-100/80">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-blue-800 uppercase">الموظفون المميزون</div>
              <Users className="h-4 w-4 text-blue-700" />
            </div>
            <div className="text-3xl font-black text-blue-900">{selectedEmployeesDetails.length || uniqueEmployees.length}</div>
            <p className="text-xs text-blue-800 mt-1">
              {filters.selectedEmployees.length > 0 ? 'موظفون تم اختيارهم للتقرير' : 'كل الموظفين سيتم تضمينهم'}
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-md shadow-emerald-100/80">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-emerald-800 uppercase">النتائج المتوقعة</div>
              <Sparkles className="h-4 w-4 text-emerald-700" />
            </div>
            <div className="text-3xl font-black text-emerald-900">{filteredLicenses.length}</div>
            <p className="text-xs text-emerald-800 mt-1">سجلات مطابقة للمعايير الحالية</p>
          </div>
        </div>

        <div className="bg-white/90 rounded-3xl shadow-lg shadow-slate-200/50 p-6 border border-slate-200">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center border border-blue-200">
                <Filter className="h-6 w-6 text-blue-700" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">حدد معايير التقرير</h3>
                <p className="text-sm text-slate-500">اختر السنة والشهر والفئات بنفس أسلوب صفحة تسجيل الرخصة</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-4 py-2">
              <Search className="h-4 w-4 text-slate-500" />
              <span>ابحث أو دقق النتائج فوراً</span>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-2 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center justify-between text-sm font-semibold text-slate-700">
                    <span>البحث عن موظف</span>
                    <Search className="h-4 w-4 text-slate-400" />
                  </label>
                  <input
                    type="text"
                    placeholder="ابحث بالاسم، الرتبة أو رقم الملف"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="flex items-center justify-between text-sm font-semibold text-slate-700">
                    <span>الشهر</span>
                    <Calendar className="h-4 w-4 text-slate-400" />
                  </label>
                  <select
                    value={filters.selectedMonth}
                    onChange={(e) => setFilters(prev => ({ ...prev, selectedMonth: e.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                  >
                    {availableMonths.map(month => (
                      <option key={month.value} value={month.value}>{month.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center justify-between text-sm font-semibold text-slate-700">
                    <span>السنة</span>
                    <Calendar className="h-4 w-4 text-slate-400" />
                  </label>
                  <select
                    value={filters.selectedYear}
                    onChange={(e) => setFilters(prev => ({ ...prev, selectedYear: e.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                  >
                    {availableYears.map(year => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center justify-between text-sm font-semibold text-slate-700">
                    <span>الفئات المستهدفة</span>
                    <Users className="h-4 w-4 text-slate-400" />
                  </label>
                  <Select
                    isMulti
                    options={categoryOptions}
                    value={filters.categories.map(cat => ({ value: cat, label: cat }))}
                    onChange={(newValue) => setFilters(prev => ({
                      ...prev,
                      categories: newValue ? newValue.map(v => v.value) : []
                    }))}
                    placeholder="جميع الفئات"
                    styles={customSelectStyles}
                    className="text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center justify-between text-sm font-semibold text-slate-700">
                  <span>الموظفون</span>
                  <Users className="h-4 w-4 text-slate-400" />
                </label>
                <Select
                  isMulti
                  options={uniqueEmployees.map(emp => ({
                    value: emp.id.toString(),
                    label: `${emp.full_name} - ${emp.rank}`
                  }))}
                  value={filters.selectedEmployees.map(empId => {
                    const emp = uniqueEmployees.find(e => e.id.toString() === empId);
                    return emp ? { value: empId, label: `${emp.full_name} - ${emp.rank}` } : null;
                  }).filter(Boolean)}
                  onChange={(newValue) => setFilters(prev => ({
                    ...prev,
                    selectedEmployees: newValue ? newValue.map(v => v!.value) : []
                  }))}
                  placeholder="كل الموظفين"
                  styles={customSelectStyles}
                  className="text-sm"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-blue-900">ملخص المعايير المختارة</h4>
                    <p className="text-xs text-blue-700 mt-1">يتم تحديثه فوراً حسب اختياراتك</p>
                  </div>
                  <CheckCircle className="h-5 w-5 text-blue-700" />
                </div>
                <div className="mt-4 space-y-2 text-sm text-blue-900">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">السنة:</span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold border border-blue-200">{filters.selectedYear}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">الشهر:</span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold border border-blue-200">{monthLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">الفئات:</span>
                    <span className="text-xs font-bold">{filters.categories.length ? filters.categories.join('، ') : 'كل الفئات'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">عدد الموظفين:</span>
                    <span className="text-xs font-bold">{filters.selectedEmployees.length || uniqueEmployees.length}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-slate-800">
                  <BarChart2 className="h-5 w-5 text-slate-500" />
                  <h4 className="text-sm font-bold">نظرة سريعة على النتائج</h4>
                </div>
                <p className="text-xs text-slate-600 mt-2">سيتم تضمين {filteredLicenses.length} رخصة/استئذان في التقرير.</p>
                {highlightedEmployees.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-700">أبرز الموظفين في النتائج:</p>
                    <div className="flex flex-wrap gap-2">
                      {highlightedEmployees.map(emp => (
                        <span key={emp.id} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-800 border border-slate-200 shadow-sm">
                          <Users className="h-3 w-3 text-slate-500" />
                          {emp.name}{emp.rank ? ` - ${emp.rank}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white/70 p-3 text-xs text-slate-600">
                  يمكنك التوجه لعرض النتائج والتصدير فوراً بعد تثبيت المعايير المطلوبة.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportsNew;
