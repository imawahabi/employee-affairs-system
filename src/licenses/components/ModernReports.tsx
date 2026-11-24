import React, { useState, useMemo, useEffect } from 'react';
import { FileText, Calendar, Users, Printer, Eye, ChevronLeft, CheckCircle } from 'lucide-react';
import Select from 'react-select';
import DatePicker from './DatePicker';
import LoadingPage from '../../components/LoadingPage';

import { LicenseService } from '../services/licenseService';
import { License } from '../types';
import { CATEGORY_ORDER, OFFICER_RANK_ORDER, NCO_RANK_ORDER } from '../utils/sorting';

const isActiveEmployee = (employee?: License['employee'] | null) => employee?.status !== 'inactive';

interface ReportConfig {
  title: string;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  categories: string[];
  includeDetails: boolean;
}

interface ModernReportsProps {
  onNavigate?: (tab: string) => void;
}

const ModernReports: React.FC<ModernReportsProps> = ({ onNavigate }) => {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [currentStep, setCurrentStep] = useState(1);
  const [reportConfig, setReportConfig] = useState<ReportConfig>({
    title: '',
    dateRange: {
    startDate: (() => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}-01`;
    })(),
      endDate: new Date().toISOString().split('T')[0] // Today
    },
    categories: [],
    includeDetails: false
  });
  const [showReport, setShowReport] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const todayString = new Date().toISOString().split('T')[0];

  // Ensure dateRange dates are not in the future and endDate >= startDate
  useEffect(() => {
    setReportConfig(prev => {
      let { startDate, endDate } = prev.dateRange;
      let changed = false;
      if (startDate && startDate > todayString) { startDate = todayString; changed = true; }
      if (endDate && endDate > todayString) { endDate = todayString; changed = true; }
      if (startDate && endDate && endDate < startDate) { endDate = startDate; changed = true; }
      if (changed) return { ...prev, dateRange: { startDate, endDate } };
      return prev;
    });
  }, [todayString]);

  // Load data on component mount
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const licensesData = await LicenseService.getAll();
        setLicenses(licensesData);
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Filter licenses based on config
  const filteredLicenses = useMemo(() => {
    if (!reportConfig.dateRange.startDate || !reportConfig.dateRange.endDate) {
      return [];
    }

    return licenses.filter(license => {
      if (!license.employee || !isActiveEmployee(license.employee)) return false;
      
      const licenseDate = new Date(license.license_date);
      const startDate = new Date(reportConfig.dateRange.startDate);
      const endDate = new Date(reportConfig.dateRange.endDate);
      endDate.setHours(23, 59, 59, 999);

      const dateMatch = licenseDate >= startDate && licenseDate <= endDate;
      const categoryMatch = reportConfig.categories.length === 0 || 
        reportConfig.categories.includes(license.employee.category);

      return dateMatch && categoryMatch;
    });
  }, [licenses, reportConfig]);

  // Generate report data
  const reportData = useMemo(() => {
    const employeeMap = new Map();
    
    filteredLicenses.forEach(license => {
      const employeeId = license.employee!.id;
      if (!employeeMap.has(employeeId)) {
        employeeMap.set(employeeId, {
          employee: license.employee,
          fullDays: 0,
          halfDays: 0,
          medicalLicenses: 0,
          totalHours: 0,
          licenses: []
        });
      }
      
      const data = employeeMap.get(employeeId);
      data.licenses.push(license);
      
      if (license.license_type === 'يوم كامل') {
        data.fullDays += 1;
      } else if (license.license_type === 'إستئذان قصير') {
        data.halfDays += 1;
        data.totalHours += Number(license.hours) || 0;
      } else if (license.license_type === 'إستئذان طبي') {
        data.medicalLicenses += 1;
      }
    });
    
    const employeeReports = Array.from(employeeMap.values());
    
    // استخدام وظيفة sortEmployees من ملف sorting.ts لترتيب البيانات حسب الفئة والمسمى الوظيفي
    return employeeReports.sort((a, b) => {
      // استخدام نفس منطق الترتيب الموجود في وظيفة sortEmployees
      const employeeA = a.employee;
      const employeeB = b.employee;
      
      const categoryA = CATEGORY_ORDER[employeeA.category] || 99;
      const categoryB = CATEGORY_ORDER[employeeB.category] || 99;

      if (categoryA !== categoryB) {
        return categoryA - categoryB;
      }

      if (employeeA.category === 'قيادات') {
        const rankA = OFFICER_RANK_ORDER[employeeA.rank.trim()] || 99;
        const rankB = OFFICER_RANK_ORDER[employeeB.rank.trim()] || 99;
        if (rankA !== rankB) return rankA - rankB;
      }

      if (employeeA.category === 'مشرفون') {
        const rankA = NCO_RANK_ORDER[employeeA.rank] || 99;
        const rankB = NCO_RANK_ORDER[employeeB.rank] || 99;
        if (rankA !== rankB) return rankA - rankB;
      }

      return employeeA.full_name.localeCompare(employeeB.full_name, 'ar');
    });
  }, [filteredLicenses]);

  const canProceedToNextStep = () => {
    if (currentStep === 1) {
      return !!(reportConfig.dateRange.startDate && reportConfig.dateRange.endDate);
    }
    return false;
  };

  const handleNext = () => {
    if (currentStep < 2 && canProceedToNextStep()) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleCloseModal = () => {
    // Reset form and close modal
    setReportConfig({
      title: '',
      dateRange: {
        startDate: (() => {
          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          return `${year}-${month}-01`;
        })(),
        endDate: new Date().toISOString().split('T')[0]
      },
      categories: [],
      includeDetails: false
    });
    setCurrentStep(1);
    setShowReport(false);
    setShowPreviewModal(false);
    
    if (onNavigate) {
      onNavigate('licenses-list');
      return;
    }

    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.location.href = '/';
  };

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state?.modalOpen) {
        handleCloseModal();
      }
    };

    window.addEventListener('popstate', handlePopState);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);



  const handlePrint = () => {
    // Create custom print window with only the report content
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) return;

    const printContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title></title>
        <style>
          @page {
            size: A4;
            margin: 2.5cm 1.27cm 1.5cm 1.27cm;
            orientation: portrait;
            @top-left { content: none !important; }
            @top-center { content: none !important; }
            @top-right { content: none !important; }
            @bottom-left { content: none !important; }
            @bottom-center { content: none !important; }
            @bottom-right { content: none !important; }
          }

          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Cairo', sans-serif;
            font-size: 12pt;
            line-height: 1.4;
            color: #000;
            background: white;
            padding-top: 50px;
            direction: rtl;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
          }

          .report-header {
            text-align: center;
            margin-bottom: 0;
            flex: 0 0 auto;
            padding: 0;
          }

          .content-wrapper {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
          }

          .report-title {
            font-family: 'Cairo', sans-serif;
            font-size: 22pt;
            font-weight: normal;
            text-decoration: none;
            text-align: center;
            margin-bottom: 0;
            color: #000;
          }

          .report-date {
            font-family: 'Cairo', sans-serif;
            font-size: 18pt;
            color: #000;
            text-align: center;
            margin-bottom: 0;
            font-weight:bold;
          }

          .report-date-range {
            color: #d00000;
          }

          .report-categories {
            font-family: 'Cairo', sans-serif;
            font-size: 18pt;
            color: #ff0000;
            margin-bottom: 8px;
          }

          .table-wrapper {
            width: 100%;
            margin: 15px auto 0 auto;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            direction: rtl;
            table-layout: auto;
          }

          th, td {
            border: 1px solid #000;
            padding: 6px 4px;
            text-align: center;
            vertical-align: middle;
            font-family: 'Cairo', sans-serif;
            font-size: 14pt;
          }

          th {
            background: #e0e0e0; /* رأس الجدول رمادي فاتح */
            font-family: 'Cairo', sans-serif;
            font-size: 15pt;
          }

          thead tr {
            border-bottom-width: 2px;
          }

          tbody tr:nth-child(even) {
            background-color: #ffffff;
          }

          tbody tr:nth-child(odd) {
            background-color: #ffffff;
          }

          tbody td:first-child {
            background-color: #e0e0e0; /* عمود المسلسل رمادي فاتح بالكامل */
          }

          .number-cell {
            font-family: 'Cairo', sans-serif;
            font-weight: bold;
          }

          .employee-name {
            text-align: center;
            padding-right: 0;
          }

          .rank-cell {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 100%;
            text-align: center;
            padding: 6px 8px;
          }

          @media print {
            body {
              padding: 0;
              margin: 0;
            }

            .report-header {
              padding-top: 0;
            }

            .no-print {
              display: none !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="content-wrapper">
          <div class="report-header">
            <h1 class="report-title">${reportConfig.title || `تقرير متابعة موظفي الإدارة العامة لسنة <b>${new Date(reportConfig.dateRange.startDate).getFullYear()}`}</b></h1>
            <p class="report-date">من <span class="report-date-range">${reportConfig.dateRange.startDate.replace(/-/g, '/')}</span> إلى <span class="report-date-range">${reportConfig.dateRange.endDate.replace(/-/g, '/')}</span></p>
            ${reportConfig.categories.length > 0 ? `<p class="report-categories">( ${reportConfig.categories.map(cat => {
              if (cat === 'قيادات') return 'قيادات';
              if (cat === 'مشرفون') return 'مشرفون';
              if (cat === 'فني') return 'فنيون';
              if (cat === 'إداري') return 'إداريون';
              return cat;
            }).join(' / ')} )</p>` : ''}
          </div>

          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style="width: auto; min-width: 40px">م</th>
                  <th style="width: auto; min-width: 80px">المسمى الوظيفي</th>
                  <th style="width: auto; min-width: 150px">الاسم</th>
                  <th style="width: auto; min-width: 70px">رخصة يوم</th>
                  <th style="width: auto; min-width: 70px">استئذان قصير</th>
                  <th style="width: auto; min-width: 80px">إستئذان طبي</th>
                </tr>
              </thead>
              <tbody>
                ${reportData.map((item, index) => `
                  <tr>
                    <td class="number-cell">${index + 1}</td>
                    <td class="rank-cell">${(item.employee.category === 'قيادات' || item.employee.category === 'مشرفون') ? item.employee.rank : item.employee.category}</td>
                    <td class="employee-name">${item.employee.full_name}</td>
                    <td class="number-cell">${item.fullDays}</td>
                    <td class="number-cell">${item.halfDays}</td>
                    <td class="number-cell">${item.medicalLicenses}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </body>
      </html>
    `;

    printWindow.document.documentElement.innerHTML = printContent;

    // Wait for content to load then print
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 1000);
  };

  const customSelectStyles = {
    control: (base: any) => ({
      ...base,
      textAlign: 'right',
      direction: 'rtl',
      minHeight: '50px',
      borderRadius: '14px',
      border: '1.5px solid #e5e7eb',
      '&:hover': {
        border: '1.5px solid #2563eb'
      },
      '&:focus-within': {
        border: '1.5px solid #2563eb',
        boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.12)'
      }
    }),
    placeholder: (base: any) => ({
      ...base,
      textAlign: 'right',
      color: '#9ca3af'
    }),
    multiValue: (base: any) => ({
      ...base,
      backgroundColor: '#dbeafe',
      borderRadius: '6px'
    }),
    multiValueLabel: (base: any) => ({
      ...base,
      color: '#1e40af',
      fontWeight: '500'
    })
  };

  // Show loading state
  if (loading) {
    return <LoadingPage variant="dashboard" title="جاري تحميل تقارير الاستئذانات" subtitle="يرجى الانتظار بينما نحضر بيانات التقارير..." />;
  }

  if (showReport) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Print Header - Only visible when printing */}
        <div className="print-only text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            {reportConfig.title || `تقرير متابعة موظفي الإدارة العامة لسنة ${new Date(reportConfig.dateRange.startDate).getFullYear()}`}
          </h1>
          <p className="text-gray-600 text-lg mb-2">
            من {reportConfig.dateRange.startDate.replace(/-/g, '/')} إلى {reportConfig.dateRange.endDate.replace(/-/g, '/')}
          </p>
          {reportConfig.categories.length > 0 && (
            <p className="text-blue-600 font-semibold mt-2">
              ( {reportConfig.categories.map(cat => {
                if (cat === 'قيادات') return 'قيادات';
                if (cat === 'مشرفون') return 'مشرفون';
                if (cat === 'فني') return 'فنيون';
                if (cat === 'إداري') return 'إداريون';
                return cat;
              }).join(' / ')} )
            </p>
          )}
        </div>

        {/* Screen Header - Hidden when printing */}
        <div className="no-print bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowReport(false)}
                className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronLeft className="w-4 h-4 rotate-180" />
                العودة للإعدادات
              </button>
              <div className="h-6 w-px bg-gray-300"></div>
              <h1 className="text-xl font-bold text-gray-800">
                {reportConfig.title || 'تقرير متابعة الموظفين'}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-lg"
              >
                <Printer className="w-4 h-4" />
                طباعة
              </button>
            </div>
          </div>
        </div>

        {/* Report Content */}
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            {/* Report Header */}
            <div className="no-print bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4">
              <div className="flex items-center justify-between text-white">
                <div className="flex items-center gap-3">
                  <FileText className="w-6 h-6" />
                  <div>
                    <h2 className="text-lg font-bold">نتائج التقرير</h2>
                    <p className="text-blue-100 text-sm">عرض {reportData.length} موظف</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-blue-100">الفترة</p>
                  <p className="font-semibold">
                    {new Date(reportConfig.dateRange.startDate).toLocaleDateString('en-US')} - 
                    {new Date(reportConfig.dateRange.endDate).toLocaleDateString('en-US')}
                  </p>
                </div>
              </div>
            </div>

            {/* Report Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-center text-sm font-bold text-gray-700 border-b-2 border-gray-200">م</th>
                    <th className="px-6 py-4 text-center text-sm font-bold text-gray-700 border-b-2 border-gray-200">المسمى الوظيفي</th>
                    <th className="px-6 py-4 text-center text-sm font-bold text-gray-700 border-b-2 border-gray-200">اسم الموظف</th>
                    <th className="px-6 py-4 text-center text-sm font-bold text-gray-700 border-b-2 border-gray-200">رخصة يوم كامل</th>
                    <th className="px-6 py-4 text-center text-sm font-bold text-gray-700 border-b-2 border-gray-200">استئذان قصير</th>
                    <th className="px-6 py-4 text-center text-sm font-bold text-gray-700 border-b-2 border-gray-200">إستئذان طبي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reportData.length > 0 ? reportData.map((data, index) => (
                    <tr key={data.employee.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-center text-sm text-gray-900">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center font-bold text-blue-600 mx-auto">
                          {index + 1}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center text-sm font-medium text-gray-700">
                        <span className="bg-gray-100 px-3 py-1 rounded-full text-xs font-semibold">
                          {data.employee.category === 'قيادات' || data.employee.category === 'مشرفون'
                            ? data.employee.rank
                            : data.employee.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-sm font-bold text-gray-900">{data.employee.full_name}</td>
                      <td className="px-6 py-4 text-center">
                        <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-bold">
                          {data.fullDays || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-sm font-bold">
                          {data.halfDays || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-bold">
                          {data.medicalLicenses || '-'}
                        </span>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                        <div className="flex flex-col items-center gap-3">
                          <FileText className="w-16 h-16 text-gray-300" />
                          <p className="text-lg font-medium">لا توجد بيانات</p>
                          <p className="text-sm">لا توجد رخص في الفترة المحددة</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <div className="max-w-full mx-auto px-4 py-4 space-y-8">
        {/* Header Card - يتماشى مع صفحة تسجيل رخصة جديدة */}
        <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-xl shadow-slate-200/60 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-lg shadow-blue-200">
                <FileText className="h-8 w-8 text-white" />
              </div>
              <div className="text-right">
                <h1 className="text-3xl font-black text-slate-900">إنشاء تقرير جديد</h1>
                <p className="text-slate-600 mt-1">حدد معايير التقرير لتسجيل رخصة/استئذان</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm">
                الخطوة {currentStep} من 2
              </div>
              {currentStep === 2 && (
                <div className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-gray-600 shadow-sm">
                  {reportData.length} موظف في النتائج
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Step Indicators */}
        <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-lg shadow-slate-200/50 p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { id: 1, title: 'إعدادات التقرير', icon: FileText },
              { id: 2, title: 'معاينة وطباعة', icon: Eye }
            ].map((step, index) => {
              const isActive = step.id === currentStep;
              const isCompleted = currentStep > step.id;
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
            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 via-blue-600 to-blue-500 transition-all duration-500 shadow-md" style={{ width: `${(currentStep / 2) * 100}%` }} />
          </div>
        </div>

        {/* Content Card */}
        <div className="bg-white/90 rounded-3xl shadow-lg shadow-slate-200/50 p-6 border border-slate-200">
          {currentStep === 1 && (
            <div className="space-y-8">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-3">عنوان التقرير</label>
                <input
                  type="text"
                  value={reportConfig.title}
                  onChange={(e) => setReportConfig(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="تقرير متابعة موظفي الإدارة العامة لسنة 2025"
                  className="w-full px-5 py-3.5 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 transition-all duration-200 text-right text-gray-900 placeholder:text-gray-400 bg-white"
                />
                <p className="text-xs text-gray-500 mt-1">اتركه فارغاً لاستخدام العنوان الافتراضي</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <DatePicker
                  label="من تاريخ"
                  value={reportConfig.dateRange.startDate}
                  onChange={(date) => setReportConfig(prev => ({
                    ...prev,
                    dateRange: { ...prev.dateRange, startDate: date }
                  }))}
                  placeholder="اختر تاريخ البداية"
                  maxDate={todayString}
                  required
                />
                <DatePicker
                  label="إلى تاريخ"
                  value={reportConfig.dateRange.endDate}
                  onChange={(date) => setReportConfig(prev => ({
                    ...prev,
                    dateRange: { ...prev.dateRange, endDate: date }
                  }))}
                  placeholder="اختر تاريخ النهاية"
                  minDate={reportConfig.dateRange.startDate}
                  maxDate={todayString}
                  required
                />
              </div>

              <div className="relative z-20">
                <label className="block text-sm font-semibold text-gray-700 mb-3">اختيار الفئات</label>
                <Select
                  isMulti
                  options={Object.keys(CATEGORY_ORDER).map(cat => ({ value: cat, label: cat }))}
                  value={reportConfig.categories.map(cat => ({ value: cat, label: cat }))}
                  onChange={(newValue) => setReportConfig(prev => ({
                    ...prev,
                    categories: newValue ? newValue.map((v: any) => v.value) : []
                  }))}
                  placeholder="اختر الفئات المراد تضمينها..."
                  styles={{
                    ...customSelectStyles,
                    menuPortal: (base: any) => ({ ...base, zIndex: 9999 })
                  }}
                  className="react-select-container"
                  classNamePrefix="react-select"
                  menuPortalTarget={document.body}
                  menuPosition="fixed"
                />
                <p className="text-sm text-gray-500 mt-2">اتركها فارغة لتشمل جميع الفئات</p>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-8">
              {/* Report Preview Header */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                    <Eye className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">معاينة التقرير</h3>
                </div>

                <div className="space-y-4">
                  {/* Report Title Card */}
                  <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-600">عنوان التقرير</span>
                      <FileText className="w-4 h-4 text-blue-500" />
                    </div>
                    <p className="text-slate-900 font-semibold mt-1 text-right">
                      {reportConfig.title || 'تقرير متابعة موظفي الإدارة العامة'} لسنة {new Date(reportConfig.dateRange.startDate).getFullYear()}
                    </p>
                  </div>

                  {/* Date Range Card */}
                  <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-600">الفترة الزمنية</span>
                      <Calendar className="w-4 h-4 text-blue-500" />
                    </div>
                    <p className="text-slate-900 font-semibold mt-1 text-right">
                      {reportConfig.dateRange.startDate && reportConfig.dateRange.endDate
                        ? `من ${new Date(reportConfig.dateRange.startDate).toLocaleDateString('ar-US')} إلى ${new Date(reportConfig.dateRange.endDate).toLocaleDateString('ar-US')}`
                        : 'غير محدد'}
                    </p>
                  </div>

                  {/* Categories Card */}
                  <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-600">الفئات المحددة</span>
                      <Users className="w-4 h-4 text-blue-500" />
                    </div>
                    <p className="text-slate-900 font-semibold mt-1 text-right">
                      {reportConfig.categories.length > 0 ? reportConfig.categories.map(cat => {
                        if (cat === 'قيادات') return 'قيادات';
                        if (cat === 'مشرفون') return 'مشرفون';
                        if (cat === 'فني') return 'فنيون';
                        if (cat === 'إداري') return 'إداريون';
                        return cat;
                      }).join(' • ') : 'جميع الفئات'}
                    </p>
                  </div>

                  {/* Statistics */}
                  {reportData.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-4 border border-gray-200">
                        <div className="text-center">
                          <div className="text-xl font-bold text-gray-700">
                            {reportData.reduce((sum, emp) => sum + emp.fullDays, 0)}
                          </div>
                          <div className="text-xs text-gray-600 font-medium">رخصة يوم كامل</div>
                        </div>
                      </div>
                      <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-4 border border-gray-200">
                        <div className="text-center">
                          <div className="text-xl font-bold text-gray-700">
                            {reportData.reduce((sum, emp) => sum + emp.halfDays, 0)}
                          </div>
                          <div className="text-xs text-gray-600 font-medium">إستئذانات قصيرة</div>
                        </div>
                      </div>
                      <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-4 border border-gray-200">
                        <div className="text-center">
                          <div className="text-xl font-bold text-gray-700">
                            {reportData.reduce((sum, emp) => sum + emp.medicalLicenses, 0)}
                          </div>
                          <div className="text-xs text-gray-600 font-medium">إستئذان طبي</div>
                        </div>
                      </div>
                      <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-200">
                        <div className="text-center">
                          <div className="text-xl font-bold text-green-700">
                            {reportData.reduce((sum, emp) => sum + (Number(emp.totalHours) || 0), 0).toFixed(2)}
                          </div>
                          <div className="text-xs text-green-600 font-medium">ساعات الاستئذانات القصيرة</div>
                        </div>
                      </div>
                      <div className="bg-gradient-to-br from-blue-50 to-blue-50 rounded-xl p-4 border border-blue-200">
                        <div className="text-center">
                          <div className="text-xl font-bold text-blue-700">
                            {reportData.length}
                          </div>
                          <div className="text-xs text-blue-600 font-medium">إجمالي الموظفين</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {reportData.length === 0 && reportConfig.dateRange.startDate && reportConfig.dateRange.endDate && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-yellow-800">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">تنبيه: لا توجد رخص في الفترة المحددة</span>
                  </div>
                  <p className="text-sm text-yellow-700 mt-1">جرب تغيير نطاق التاريخ أو الفئات للحصول على نتائج</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-4 justify-center">
                <button
                  onClick={() => setShowPreviewModal(true)}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-sm"
                >
                  <Eye className="w-5 h-5" />
                  معاينة التقرير
                </button>

              </div>
            </div>
          )}
        </div>

        {/* Footer - Action Buttons */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <button
            onClick={handleBack}
            disabled={currentStep === 1}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-all ${
              currentStep === 1 ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-slate-700 text-white hover:bg-slate-800 shadow-lg'
            }`}
          >
            <ChevronLeft className="h-4 w-4 rotate-180" />السابق
          </button>

          {currentStep === 2 ? (
            <button
              onClick={handlePrint}
              className="inline-flex items-center justify-center gap-3 rounded-xl px-8 py-3 text-sm font-semibold transition-all bg-green-600 text-white hover:bg-green-700 shadow-lg"
            >
              <Printer className="w-5 h-5" />
              طباعة التقرير
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={!canProceedToNextStep()}
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-8 py-3 text-sm font-semibold transition-all ${
                canProceedToNextStep() ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg' : 'bg-slate-300 text-white cursor-not-allowed'
              }`}
            >
              التالي
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>

      {/* Preview Modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[98vh] overflow-hidden">
            {/* Modal Header */}
            <div className="no-print bg-gradient-to-r from-blue-600 to-blue-800 px-6 py-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">معاينة التقرير</h3>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="text-white hover:text-gray-200 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
              {/* Report Header */}
              <div className="text-center mb-8 pb-6 border-b border-gray-200">
                <h1 className="text-2xl font-bold text-gray-800 mb-2">
                  {reportConfig.title || 'تقرير متابعة موظفي الإدارة العامة'} لسنة {new Date(reportConfig.dateRange.startDate).getFullYear()}
                </h1>
                <p className="text-gray-600">
                  من تاريخ {new Date(reportConfig.dateRange.startDate).toLocaleDateString('ar-US')}
                  إلى تاريخ {new Date(reportConfig.dateRange.endDate).toLocaleDateString('ar-US')}
                </p>
                {reportConfig.categories.length > 0 && (
                  <p className="text-blue-600 font-semibold mt-2">
                    ( {reportConfig.categories.join(' / ')} )
                  </p>
                )}
              </div>

              {/* Report Table */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-gray-300 text-sm">
                  <thead>
                    <tr className="bg-blue-600 text-white">
                      <th className="border border-gray-300 px-4 py-3 text-center font-bold">م</th>
                      <th className="border border-gray-300 px-4 py-3 text-center font-bold">المسمى الوظيفي</th>
                      <th className="border border-gray-300 px-4 py-3 text-center font-bold">الاسم</th>
                      <th className="border border-gray-300 px-4 py-3 text-center font-bold">رخصة يوم كامل</th>
                      <th className="border border-gray-300 px-4 py-3 text-center font-bold">استئذان قصير</th>
                      <th className="border border-gray-300 px-4 py-3 text-center font-bold">إستئذان طبي</th>
                      <th className="border border-gray-300 px-4 py-3 text-center font-bold">ساعات الاستئذانات القصيرة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.map((item, index) => (
                      <tr key={item.employee.id} className={index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                        <td className="border border-gray-300 px-4 py-3 text-center font-medium">{index + 1}</td>
                        <td className="border border-gray-300 px-4 py-3 text-center">
                          {item.employee.category === 'قيادات' || item.employee.category === 'مشرفون'
                            ? item.employee.rank
                            : item.employee.category}
                        </td>
                        <td className="border border-gray-300 px-4 py-3 text-center font-semibold">{item.employee.full_name}</td>
                        <td className="border border-gray-300 px-4 py-3 text-center font-bold text-blue-600">{item.fullDays}</td>
                        <td className="border border-gray-300 px-4 py-3 text-center font-bold text-green-600">{item.halfDays}</td>
                        <td className="border border-gray-300 px-4 py-3 text-center font-bold text-purple-600">{item.medicalLicenses}</td>
                        <td className="border border-gray-300 px-4 py-3 text-center font-bold text-indigo-600">{Number(item.totalHours || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary Footer */}
              <div className="no-print mt-6 bg-gray-50 rounded-xl p-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-blue-600">{reportData.length}</div>
                    <div className="text-sm text-gray-600">إجمالي الموظفين</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-purple-600">{reportData.reduce((sum, emp) => sum + emp.fullDays, 0)}</div>
                    <div className="text-sm text-gray-600">رخصة يوم كامل</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-orange-600">{reportData.reduce((sum, emp) => sum + emp.halfDays, 0)}</div>
                    <div className="text-sm text-gray-600">الاستئذانات القصيرة</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-pink-600">{reportData.reduce((sum, emp) => sum + emp.medicalLicenses, 0)}</div>
                    <div className="text-sm text-gray-600">الإستئذان الطبي</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-green-600">{reportData.reduce((sum, emp) => sum + (Number(emp.totalHours) || 0), 0).toFixed(2)}</div>
                    <div className="text-sm text-gray-600">ساعات الاستئذانات القصيرة</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="no-print bg-gray-50 px-6 py-4 flex items-center justify-between border-t border-gray-200">
              <button
                onClick={() => setShowPreviewModal(false)}
                className="px-6 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded-lg transition-colors"
              >
                إغلاق
              </button>
              <button
                onClick={() => {
                  setShowPreviewModal(false);
                  handlePrint();
                }}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Printer className="w-4 h-4" />
                طباعة
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ModernReports;
