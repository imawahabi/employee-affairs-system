import React, { useState, useEffect } from 'react';
import {
  BellIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  CalendarIcon,
  CheckCircleIcon,
  XMarkIcon,
  EyeIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import { fetchAlerts, markAlertAsRead, markAlertAsResolved, dismissAlert, deleteAlert } from '../api';
import { Alert } from '../types';
import LoadingPage from './LoadingPage';
import PageHeader from './UI/PageHeader';

const Alerts: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters and search
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAlerts, setSelectedAlerts] = useState<string[]>([]);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    loadAlerts();
  }, [currentPage, filterStatus, filterSeverity, filterType]);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const params = {
        limit: itemsPerPage,
        offset: (currentPage - 1) * itemsPerPage,
        ...(filterStatus !== 'all' && { status: filterStatus }),
        ...(filterSeverity !== 'all' && { severity: filterSeverity }),
        ...(filterType !== 'all' && { type: filterType }),
      };

      const response = await fetchAlerts(params);
      setAlerts(response.data || response);
      setTotalPages(Math.ceil((response.total || response.length) / itemsPerPage));
    } catch (err) {
      setError('فشل في تحميل التنبيهات');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Action handlers
  const handleMarkAsRead = async (alertId: string) => {
    try {
      await markAlertAsRead(alertId);
      setAlerts(prev => prev.map(alert =>
        alert.id === alertId ? { ...alert, status: 'read' } : alert
      ));
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const handleResolve = async (alertId: string) => {
    try {
      await markAlertAsResolved(alertId);
      setAlerts(prev => prev.map(alert =>
        alert.id === alertId ? { ...alert, status: 'resolved' } : alert
      ));
    } catch (error) {
      console.error('Failed to resolve alert:', error);
    }
  };

  const handleDismiss = async (alertId: string) => {
    try {
      await dismissAlert(alertId);
      setAlerts(prev => prev.filter(alert => alert.id !== alertId));
    } catch (error) {
      console.error('Failed to dismiss alert:', error);
    }
  };

  const handleDelete = async (alertId: string) => {
    try {
      await deleteAlert(alertId);
      setAlerts(prev => prev.filter(alert => alert.id !== alertId));
    } catch (error) {
      console.error('Failed to delete alert:', error);
    }
  };

  const handleBulkAction = async (action: 'read' | 'resolve' | 'dismiss' | 'delete') => {
    try {
      const promises = selectedAlerts.map(alertId => {
        switch (action) {
          case 'read': return markAlertAsRead(alertId);
          case 'resolve': return markAlertAsResolved(alertId);
          case 'dismiss': return dismissAlert(alertId);
          case 'delete': return deleteAlert(alertId);
        }
      });

      await Promise.all(promises);

      if (action === 'dismiss' || action === 'delete') {
        setAlerts(prev => prev.filter(alert => !selectedAlerts.includes(alert.id)));
      } else {
        const newStatus = action === 'read' ? 'read' : 'resolved';
        setAlerts(prev => prev.map(alert =>
          selectedAlerts.includes(alert.id) ? { ...alert, status: newStatus } : alert
        ));
      }

      setSelectedAlerts([]);
    } catch (error) {
      console.error(`Failed to ${action} alerts:`, error);
    }
  };

  // Helper functions
  const getAlertIcon = (type: string, severity: string) => {
    if (severity === 'high') {
      return <ExclamationTriangleIcon className="h-5 w-5 text-red-500" />;
    }
    switch (type) {
      case 'overdue_shift':
        return <ClockIcon className="h-5 w-5 text-orange-500" />;
      case 'no_upcoming_shift':
        return <CalendarIcon className="h-5 w-5 text-blue-500" />;
      case 'professional_extension':
        return <ClockIcon className="h-5 w-5 text-amber-500" />;
      case 'reminder':
        return <BellIcon className="h-5 w-5 text-blue-500" />;
      default:
        return <BellIcon className="h-5 w-5 text-gray-500" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'bg-red-50 border-red-200 text-red-800';
      case 'medium': return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      case 'low': return 'bg-blue-50 border-blue-200 text-blue-800';
      default: return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const getSeverityLabel = (severity: string) => {
    switch (severity) {
      case 'high': return 'عالية';
      case 'medium': return 'متوسطة';
      case 'low': return 'منخفضة';
      default: return severity;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'no_upcoming_shift': return 'لا توجد مناوبة قادمة';
      case 'shift_not_received': return 'مناوبة غير مستلمة';
      case 'professional_extension': return 'تمديد مهني';
      default: return type;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'new': return 'جديد';
      case 'read': return 'مقروء';
      case 'resolved': return 'تم التدقيق عليه';
      case 'dismissed': return 'مخفي';
      default: return status;
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return 'الآن';
    if (diffInMinutes < 60) return `منذ ${diffInMinutes} دقيقة`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `منذ ${diffInHours} ساعة`;

    const diffInDays = Math.floor(diffInHours / 24);
    return `منذ ${diffInDays} يوم`;
  };

  // Filter alerts based on search and filters
  const filteredAlerts = alerts.filter(alert => {
    const matchesSearch = searchQuery === '' ||
      alert.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      alert.message.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = filterStatus === 'all' || alert.status === filterStatus;
    const matchesSeverity = filterSeverity === 'all' || alert.severity === filterSeverity;
    const matchesType = filterType === 'all' || alert.type === filterType;

    return matchesSearch && matchesStatus && matchesSeverity && matchesType;
  });

  if (loading) {
    return <LoadingPage variant="dashboard" title="جاري تحميل التنبيهات" subtitle="يرجى الانتظار بينما نحضر التنبيهات والإشعارات..." />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className=" mx-auto">
          <div className="text-center py-12">
            <ExclamationTriangleIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">خطأ في التحميل</h3>
            <p className="text-gray-600 mb-4">{error}</p>
            <button
              onClick={() => loadAlerts()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              إعادة المحاولة
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto space-y-8">
        <PageHeader
          icon={<BellIcon className="h-8 w-8" />}
          title="إدارة التنبيهات"
          description="عرض وإدارة جميع التنبيهات والإشعارات في النظام"
          actions={(
            <>
              <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="text-sm text-gray-600">غير مقروءة ({alerts.filter(a => a.status === 'new').length})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <span className="text-sm text-gray-600">مقروءة ({alerts.filter(a => a.status !== 'new').length})</span>
                  </div>
              </div>
              <div className="bg-blue-50 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-blue-600">{filteredAlerts.length}</div>
                <div className="text-sm text-gray-600">إجمالي التنبيهات</div>
              </div>
            </>
          )}
        />

        {/* Enhanced Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="group bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-gray-200/50 hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm font-medium">عالية الأولوية</p>
                <p className="text-3xl font-bold text-red-600 mt-2">
                  {filteredAlerts.filter(a => a.severity === 'high').length}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="text-xs text-gray-500">تحتاج اهتمام فوري</span>
                </div>
              </div>
              <div className="w-16 h-16 bg-gradient-to-br from-red-500 to-red-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                <ExclamationTriangleIcon className="h-8 w-8 text-white" />
              </div>
            </div>
          </div>

          <div className="group bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-gray-200/50 hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm font-medium">متوسطة الأولوية</p>
                <p className="text-3xl font-bold text-yellow-600 mt-2">
                  {filteredAlerts.filter(a => a.severity === 'medium').length}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  <span className="text-xs text-gray-500">تحتاج متابعة</span>
                </div>
              </div>
              <div className="w-16 h-16 bg-gradient-to-br from-yellow-500 to-orange-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                <ClockIcon className="h-8 w-8 text-white" />
              </div>
            </div>
          </div>

          <div className="group bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-gray-200/50 hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm font-medium">منخفضة الأولوية</p>
                <p className="text-3xl font-bold text-blue-600 mt-2">
                  {filteredAlerts.filter(a => a.severity === 'low').length}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-xs text-gray-500">للمعلومية</span>
                </div>
              </div>
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                <BellIcon className="h-8 w-8 text-white" />
              </div>
            </div>
          </div>

          <div className="group bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-gray-200/50 hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm font-medium">تم التدقيق عليهة</p>
                <p className="text-3xl font-bold text-green-600 mt-2">
                  {alerts.filter(a => a.status === 'resolved').length}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-xs text-gray-500">تم حلها</span>
                </div>
              </div>
              <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                <CheckCircleIcon className="h-8 w-8 text-white" />
              </div>
            </div>
          </div>
        </div>

        {/* Enhanced Filters and Search */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
          <div className="mb-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-3">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              البحث والتصفية
            </h3>
          </div>

          <div className="flex flex-col lg:flex-row gap-6">
            {/* Enhanced Search */}
            <div className="flex-1 relative">
              <div className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="ابحث في التنبيهات بالعنوان أو المحتوى..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pr-14 pl-6 py-4 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all duration-200 text-md placeholder-gray-400"
              />
              {searchQuery && (
                <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
                  <div className="bg-blue-100 text-blue-600 px-3 py-1 rounded-full text-sm font-medium">
                    {filteredAlerts.length} نتيجة
                  </div>
                </div>
              )}
            </div>

            {/* Enhanced Filters */}
            <div className="flex flex-col md:flex-row gap-4">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all"
              >
                <option value="all">جميع الحالات</option>
                <option value="new">جديد</option>
                <option value="read">مقروء</option>
                <option value="resolved">تم التدقيق عليه</option>
                <option value="dismissed">مخفي</option>
              </select>

              <select
                value={filterSeverity}
                onChange={(e) => setFilterSeverity(e.target.value)}
                className="px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all"
              >
                <option value="all">جميع الأولويات</option>
                <option value="high">عالية</option>
                <option value="medium">متوسطة</option>
                <option value="low">منخفضة</option>
              </select>

              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all"
              >
                <option value="all">جميع الأنواع</option>
                <option value="no_upcoming_shift">لا توجد مناوبة قادمة</option>
                <option value="shift_not_received">مناوبة غير مستلمة</option>
                <option value="professional_extension">تمديد مهني</option>
              </select>

              <button
                onClick={() => {
                  setSearchQuery('');
                  setFilterStatus('all');
                  setFilterSeverity('all');
                  setFilterType('all');
                }}
                className="px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl transition-all font-medium"
              >
                إعادة تعيين
              </button>
            </div>
          </div>

          {/* Enhanced Bulk Actions */}
          {selectedAlerts.length > 0 && (
            <div className="mt-6 p-6 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border-2 border-blue-200">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <span className="text-lg font-bold text-blue-800">
                    تم تحديد {selectedAlerts.length} تنبيه
                  </span>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => handleBulkAction('read')}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all shadow-lg hover:shadow-xl"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    تحديد كمقروء
                  </button>
                  <button
                    onClick={() => handleBulkAction('resolve')}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl transition-all shadow-lg hover:shadow-xl"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    حل
                  </button>
                  <button
                    onClick={() => handleBulkAction('dismiss')}
                    className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-xl transition-all shadow-lg hover:shadow-xl"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                    </svg>
                    إخفاء
                  </button>
                  <button
                    onClick={() => handleBulkAction('delete')}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-all shadow-lg hover:shadow-xl"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    حذف
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Enhanced Alerts List */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 overflow-hidden">
          <div className="px-8 py-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
                  <BellIcon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">قائمة التنبيهات</h2>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="bg-white rounded-xl px-4 py-2 shadow-sm">
                  <span className="text-sm font-medium text-gray-600">
                    عرض {filteredAlerts.length} من {alerts.length}
                  </span>
                </div>
                {selectedAlerts.length > 0 && (
                  <div className="bg-blue-600 text-white rounded-xl px-4 py-2">
                    <span className="text-sm font-bold">
                      {selectedAlerts.length} محدد
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            {filteredAlerts.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <BellIcon className="h-12 w-12 text-gray-400" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3">لا توجد تنبيهات</h3>
                <p className="text-gray-600 text-lg">لا توجد تنبيهات تطابق المعايير المحددة</p>
              </div>
            ) : (
              filteredAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`group p-6 hover:bg-blue-50/50 transition-all duration-200 border-r-4 ${
                    alert.status === 'new'
                      ? 'bg-blue-50/30 border-r-blue-500'
                      : alert.severity === 'high'
                      ? 'border-r-red-500'
                      : alert.severity === 'medium'
                      ? 'border-r-yellow-500'
                      : 'border-r-blue-500'
                  }`}
                >
                  <div className="flex items-start gap-6">
                    {/* Enhanced Checkbox */}
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedAlerts.includes(alert.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedAlerts(prev => [...prev, alert.id]);
                          } else {
                            setSelectedAlerts(prev => prev.filter(id => id !== alert.id));
                          }
                        }}
                        className="w-5 h-5 text-blue-600 focus:ring-blue-500 border-2 border-gray-300 rounded-lg transition-all"
                      />
                    </div>

                    {/* Enhanced Icon */}
                    <div className="flex-shrink-0">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                        alert.severity === 'high'
                          ? 'bg-red-100'
                          : alert.severity === 'medium'
                          ? 'bg-yellow-100'
                          : 'bg-blue-100'
                      }`}>
                        {getAlertIcon(alert.type, alert.severity)}
                      </div>
                    </div>

                    {/* Enhanced Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <h3 className={`text-md font-bold ${alert.status === 'new' ? 'text-gray-900' : 'text-gray-700'}`}>
                              {alert.title}
                            </h3>
                            {alert.status === 'new' && (
                              <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getSeverityColor(alert.severity)}`}>
                              {getSeverityLabel(alert.severity)}
                            </span>
                            <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">
                              {getTypeLabel(alert.type)}
                            </span>
                            <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">
                              {getStatusLabel(alert.status)}
                            </span>
                          </div>

                          <p className="text-gray-600 mb-2  text-sm leading-relaxed">{alert.message}</p>
                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span>{formatTimeAgo(alert.dateTriggered)}</span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 ml-4">
                          {alert.status === 'new' && (
                            <button
                              onClick={() => handleMarkAsRead(alert.id)}
                              className="p-2 hover:bg-blue-100 rounded-lg text-blue-600 transition-colors"
                              title="تحديد كمقروء"
                            >
                              <EyeIcon className="h-4 w-4" />
                            </button>
                          )}
                          {alert.status !== 'resolved' && (
                            <button
                              onClick={() => handleResolve(alert.id)}
                              className="p-2 hover:bg-green-100 rounded-lg text-green-600 transition-colors"
                              title="حل التنبيه"
                            >
                              <CheckCircleIcon className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDismiss(alert.id)}
                            className="p-2 hover:bg-yellow-100 rounded-lg text-yellow-600 transition-colors"
                            title="إخفاء التنبيه"
                          >
                            <XMarkIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(alert.id)}
                            className="p-2 hover:bg-red-100 rounded-lg text-red-600 transition-colors"
                            title="حذف التنبيه"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  صفحة {currentPage} من {totalPages}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 bg-white border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
                  >
                    السابق
                  </button>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 bg-white border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
                  >
                    التالي
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Alerts;
