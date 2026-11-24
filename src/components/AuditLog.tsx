import React, { useEffect, useMemo, useState } from 'react';
import { 
  History, Search, RefreshCw, ArrowDownUp, Download, Filter, 
  Calendar, Clock, Users, FileText, TrendingUp, AlertCircle,
  CheckCircle, XCircle, Plus, Edit, Trash2, UserPlus, UserMinus,
  BarChart3, PieChart, Activity, Database, Settings
} from 'lucide-react';
import { fetchAuditLog } from '../api';
import { AuditLogEntry } from '../types';
import { useSystem } from '../contexts/SystemContext';
import PageHeader from './UI/PageHeader';

const ENTITY_LABELS: Record<string, string> = {
  employee: 'الموظفون',
  shift: 'المناوبات',
  license: 'الرخص والاستئذانات',
  system: 'النظام'
};

const ACTION_LABELS: Record<string, string> = {
  create: 'إضافة',
  update: 'تعديل',
  delete: 'حذف',
  assign: 'إضافة موظف',
  unassign: 'إزالة موظف',
  absence: 'غياب'
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
  create: <Plus size={14} />,
  update: <Edit size={14} />,
  delete: <Trash2 size={14} />,
  assign: <UserPlus size={14} />,
  unassign: <UserMinus size={14} />
};

const ENTITY_ICONS: Record<string, React.ReactNode> = {
  employee: <Users size={16} />,
  shift: <Clock size={16} />,
  license: <FileText size={16} />,
  system: <Settings size={16} />
};

const formatDateTime = (value: string) => {
  try {
    const date = new Date(value);
    return date.toLocaleString('ar-UK', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return value;
  }
};

const formatRelativeTime = (value: string) => {
  try {
    const date = new Date(value);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) return 'منذ لحظات';
    if (diffInSeconds < 3600) return `منذ ${Math.floor(diffInSeconds / 60)} دقيقة`;
    if (diffInSeconds < 86400) return `منذ ${Math.floor(diffInSeconds / 3600)} ساعة`;
    if (diffInSeconds < 2592000) return `منذ ${Math.floor(diffInSeconds / 86400)} يوم`;
    return `منذ ${Math.floor(diffInSeconds / 2592000)} شهر`;
  } catch {
    return '';
  }
};

const buildSearchText = (entry: AuditLogEntry) => {
  const metadataText = entry.metadata ? JSON.stringify(entry.metadata) : '';
  return [
    entry.message,
    entry.entityType,
    entry.action,
    entry.field,
    entry.oldValue,
    entry.newValue,
    metadataText
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
};

interface FilterState {
  searchQuery: string;
  selectedEntity: string;
  selectedAction: string;
  dateRange: 'all' | 'today' | 'week' | 'month';
  sortDescending: boolean;
}

const AuditLog: React.FC = () => {
  const { hideShifts } = useSystem();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  
  const [filters, setFilters] = useState<FilterState>({
    searchQuery: '',
    selectedEntity: 'all',
    selectedAction: 'all',
    dateRange: 'all',
    sortDescending: true
  });

  const loadEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAuditLog({
        entityType: filters.selectedEntity !== 'all' ? filters.selectedEntity : undefined,
        action: filters.selectedAction !== 'all' ? filters.selectedAction : undefined,
        excludeEntityTypes: hideShifts ? ['shift'] : undefined,
        limit: 500
      });
      setEntries(response.data || []);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error loading audit log:', err);
      setError('تعذر تحميل سجل التغييرات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.selectedEntity, filters.selectedAction, hideShifts]);

  useEffect(() => {
    if (hideShifts && filters.selectedEntity === 'shift') {
      setFilters(prev => ({ ...prev, selectedEntity: 'all' }));
    }
  }, [hideShifts, filters.selectedEntity]);

  const filteredEntries = useMemo(() => {
    let filtered = entries;

    // Apply search filter
    if (filters.searchQuery.trim()) {
      const query = filters.searchQuery.trim().toLowerCase();
      filtered = filtered.filter((entry) => buildSearchText(entry).includes(query));
    }

    // Apply date range filter
    if (filters.dateRange !== 'all') {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      filtered = filtered.filter((entry) => {
        const entryDate = new Date(entry.createdAt);
        switch (filters.dateRange) {
          case 'today':
            return entryDate >= today;
          case 'week':
            const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            return entryDate >= weekAgo;
          case 'month':
            const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
            return entryDate >= monthAgo;
          default:
            return true;
        }
      });
    }

    // Sort entries
    return [...filtered].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return filters.sortDescending ? dateB - dateA : dateA - dateB;
    });
  }, [entries, filters]);

  const analytics = useMemo(() => {
    const total = entries.length;
    const today = entries.filter(entry => {
      const today = new Date().toDateString();
      return new Date(entry.createdAt).toDateString() === today;
    }).length;
    
    const byAction = entries.reduce((acc, entry) => {
      acc[entry.action] = (acc[entry.action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const byEntity = entries.reduce((acc, entry) => {
      acc[entry.entityType] = (acc[entry.entityType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const recentActivity = entries
      .filter(entry => {
        const entryDate = new Date(entry.createdAt);
        const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
        return entryDate >= hourAgo;
      }).length;

    return { total, today, byAction, byEntity, recentActivity };
  }, [entries]);

  const getActionStyles = (action: string) => {
    switch (action) {
      case 'create':
        return {
          badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          icon: 'bg-emerald-100 text-emerald-700 border-emerald-200'
        };
      case 'update':
        return {
          badge: 'bg-blue-50 text-blue-700 border-blue-200',
          icon: 'bg-blue-100 text-blue-700 border-blue-200'
        };
      case 'delete':
        return {
          badge: 'bg-red-50 text-red-700 border-red-200',
          icon: 'bg-red-100 text-red-700 border-red-200'
        };
      case 'assign':
        return {
          badge: 'bg-purple-50 text-purple-700 border-purple-200',
          icon: 'bg-purple-100 text-purple-700 border-purple-200'
        };
      case 'unassign':
        return {
          badge: 'bg-amber-50 text-amber-700 border-amber-200',
          icon: 'bg-amber-100 text-amber-700 border-amber-200'
        };
      default:
        return {
          badge: 'bg-gray-50 text-gray-600 border-gray-200',
          icon: 'bg-gray-100 text-gray-600 border-gray-200'
        };
    }
  };

  const exportData = () => {
    const csvContent = [
      ['التاريخ', 'النظام', 'العملية', 'الرسالة', 'القيمة القديمة', 'القيمة الجديدة'].join(','),
      ...filteredEntries.map(entry => [
        formatDateTime(entry.createdAt),
        ENTITY_LABELS[entry.entityType] || entry.entityType,
        ACTION_LABELS[entry.action] || entry.action,
        `"${entry.message || ''}"`,
        `"${entry.oldValue || ''}"`,
        `"${entry.newValue || ''}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const groupedEntries = useMemo(() => {
    const groups = filteredEntries.reduce((acc, entry) => {
      const dateKey = new Date(entry.createdAt).toDateString();
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(entry);
      return acc;
    }, {} as Record<string, AuditLogEntry[]>);

    return Object.entries(groups).sort((a, b) => 
      new Date(b[0]).getTime() - new Date(a[0]).getTime()
    );
  }, [filteredEntries]);

  return (
    <div className="min-h-screen p-3">
      <div className="mx-auto space-y-6">
        <PageHeader
          icon={<History size={36} />}
          title="سجل التغييرات"
          description="تتبع شامل لجميع التعديلات والأنشطة"
          actions={(
            <>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-8 py-4 rounded-xl flex items-center gap-3 shadow-lg transition-all transform hover:scale-105 hover:shadow-xl"
              >
                <Filter size={24} />
                <span className="font-semibold">المرشحات</span>
              </button>
              <button
                onClick={exportData}
                className="bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white px-8 py-4 rounded-xl flex items-center gap-3 shadow-lg transition-all transform hover:scale-105 hover:shadow-xl"
              >
                <Download size={24} />
                <span className="font-semibold">تصدير</span>
              </button>
            </>
          )}
        />

        {/* Analytics Cards - Same style as EmployeeManagement */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <Database size={18} className="text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">إجمالي السجلات</p>
                <p className="text-xl font-bold text-gray-900">{analytics.total}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                <Calendar size={18} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">اليوم</p>
                <p className="text-xl font-bold text-gray-900">{analytics.today}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                <Activity size={18} className="text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">آخر ساعة</p>
                <p className="text-xl font-bold text-gray-900">{analytics.recentActivity}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                <Clock size={18} className="text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">آخر تحديث</p>
                <p className="text-sm font-semibold text-gray-900">
                  {lastUpdated ? lastUpdated.toLocaleTimeString('ar-UK', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  }) : '-'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters Section */}
        {showFilters && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700">البحث</label>
                <div className="relative">
                  <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={filters.searchQuery}
                    onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
                    placeholder="ابحث في السجلات..."
                    className="w-full pr-10 pl-4 py-2.5 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700">النظام</label>
                <select
                  value={filters.selectedEntity}
                  onChange={(e) => setFilters(prev => ({ ...prev, selectedEntity: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                >
                  <option value="all">كل الأنظمة</option>
                  <option value="employee">الموظفون</option>
                  {!hideShifts && <option value="shift">المناوبات</option>}
                  <option value="license">الرخص والاستئذانات</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700">العملية</label>
                <select
                  value={filters.selectedAction}
                  onChange={(e) => setFilters(prev => ({ ...prev, selectedAction: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                >
                  <option value="all">كل العمليات</option>
                  <option value="create">إضافة</option>
                  <option value="update">تعديل</option>
                  <option value="delete">حذف</option>
                  <option value="assign">إضافة موظف</option>
                  <option value="unassign">إزالة موظف</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700">الفترة الزمنية</label>
                <select
                  value={filters.dateRange}
                  onChange={(e) => setFilters(prev => ({ ...prev, dateRange: e.target.value as any }))}
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                >
                  <option value="all">كل الوقت</option>
                  <option value="today">اليوم</option>
                  <option value="week">آخر أسبوع</option>
                  <option value="month">آخر شهر</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700">ترتيب</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setFilters(prev => ({ ...prev, sortDescending: !prev.sortDescending }))}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    <ArrowDownUp size={14} />
                    {filters.sortDescending ? 'الأحدث' : 'الأقدم'}
                  </button>
                  <button
                    onClick={loadEntries}
                    className="px-3 py-2.5 rounded-lg border border-blue-200 bg-blue-50 text-sm font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View Mode Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'list' 
                  ? 'bg-blue-100 text-blue-700 border border-blue-200' 
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              قائمة
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'timeline' 
                  ? 'bg-blue-100 text-blue-700 border border-blue-200' 
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              خط زمني
            </button>
          </div>
          <div className="text-sm text-gray-600">
            عرض {filteredEntries.length} من {entries.length} سجل
          </div>
        </div>

        {/* Content Section */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          {loading && (
            <div className="py-16 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-100 mb-4">
                <RefreshCw size={20} className="text-blue-600 animate-spin" />
              </div>
              <p className="text-gray-600 font-medium">جاري تحميل السجل...</p>
            </div>
          )}

          {error && (
            <div className="py-12 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-red-100 mb-4">
                <AlertCircle size={20} className="text-red-600" />
              </div>
              <p className="text-red-600 font-semibold">{error}</p>
              <button
                onClick={loadEntries}
                className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-medium transition-colors"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

          {!loading && !error && filteredEntries.length === 0 && (
            <div className="py-16 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gray-100 mb-4">
                <Search size={20} className="text-gray-400" />
              </div>
              <p className="text-gray-600 font-medium">لا توجد سجلات مطابقة</p>
              <p className="text-gray-500 mt-2">جرب تعديل معايير البحث أو المرشحات</p>
            </div>
          )}

          {!loading && !error && filteredEntries.length > 0 && (
            <>
              {viewMode === 'list' ? (
                <div className="divide-y divide-gray-100">
                  {filteredEntries.map((entry) => {
                    const entityLabel = ENTITY_LABELS[entry.entityType] || entry.entityType;
                    const actionLabel = ACTION_LABELS[entry.action] || entry.action;
                    const metaLabel = entry.metadata?.label;
                    const actionStyles = getActionStyles(entry.action);

                    return (
                      <div key={entry.id} className="py-5 px-6 hover:bg-gray-50/50 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center ${actionStyles.icon} flex-shrink-0`}>
                            {ACTION_ICONS[entry.action] || <History size={16} />}
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className={`px-2 py-1 rounded-full text-xs font-semibold border ${actionStyles.badge}`}>
                                    {actionLabel}
                                  </span>
                                  <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                                    {ENTITY_ICONS[entry.entityType]}
                                    {entityLabel}
                                  </span>
                                  {metaLabel && (
                                    <span className="px-2 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-600 border border-purple-200">
                                      {metaLabel}
                                    </span>
                                  )}
                                </div>
                                
                                <h3 className="text-sm font-semibold text-gray-900 mb-2">
                                  {entry.message || `${actionLabel} ضمن ${entityLabel}`}
                                </h3>
                                
                                {(entry.oldValue || entry.newValue) && (
                                  <div className="flex items-center gap-2 text-sm">
                                    {entry.oldValue && (
                                      <div className="flex items-center gap-2 bg-red-50 px-2 py-1 rounded-lg border border-red-100">
                                        <span className="text-red-600 font-semibold text-xs">من:</span>
                                        <span className="text-red-700 text-xs">{entry.oldValue}</span>
                                      </div>
                                    )}
                                    {entry.oldValue && entry.newValue && (
                                      <div className="text-gray-400">
                                        <ArrowDownUp size={14} />
                                      </div>
                                    )}
                                    {entry.newValue && (
                                      <div className="flex items-center gap-2 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100">
                                        <span className="text-emerald-600 font-semibold text-xs">إلى:</span>
                                        <span className="text-emerald-700 text-xs">{entry.newValue}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              
                              <div className="text-right flex-shrink-0 ml-8">
                                <div className="text-right">
                                  <div className="text-sm font-bold text-gray-900 mb-1">
                                    {formatDateTime(entry.createdAt)}
                                  </div>
                                  <div className="text-xs text-gray-500 bg-gray-100 px-3 py-1.5 rounded-lg">
                                    {formatRelativeTime(entry.createdAt)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4">
                  {groupedEntries.map(([dateKey, dayEntries]) => {
                    const date = new Date(dateKey);
                    const isToday = dateKey === new Date().toDateString();
                    
                    return (
                      <div key={dateKey} className="mb-6 last:mb-0">
                        <div className="flex items-center gap-3 mb-3">
                          <div className={`px-3 py-1.5 rounded-xl font-semibold text-sm ${
                            isToday 
                              ? 'bg-blue-100 text-blue-700 border border-blue-200' 
                              : 'bg-gray-100 text-gray-700 border border-gray-200'
                          }`}>
                            {isToday ? 'اليوم' : date.toLocaleDateString('ar-UK', { 
                              weekday: 'long', 
                              year: 'numeric', 
                              month: 'long', 
                              day: 'numeric' 
                            })}
                          </div>
                          <div className="h-px bg-gray-200 flex-1"></div>
                          <div className="text-xs text-gray-500 font-medium">
                            {dayEntries.length} نشاط
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          {dayEntries.map((entry) => {
                            const entityLabel = ENTITY_LABELS[entry.entityType] || entry.entityType;
                            const actionLabel = ACTION_LABELS[entry.action] || entry.action;
                            const actionStyles = getActionStyles(entry.action);
                            
                            return (
                              <div key={entry.id} className="flex items-center gap-3 p-3 bg-gray-50/50 rounded-xl hover:bg-gray-50 transition-colors">
                                <div className={`w-8 h-8 rounded-xl border-2 flex items-center justify-center ${actionStyles.icon} flex-shrink-0`}>
                                  {ACTION_ICONS[entry.action] || <History size={14} />}
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${actionStyles.badge}`}>
                                      {actionLabel}
                                    </span>
                                    <span className="text-xs text-gray-600">{entityLabel}</span>
                                  </div>
                                  <p className="text-sm text-gray-900 font-medium">
                                    {entry.message || `${actionLabel} ضمن ${entityLabel}`}
                                  </p>
                                </div>
                                
                                <div className="text-xs text-gray-500 text-right ml-6">
                                  {new Date(entry.createdAt).toLocaleTimeString('ar-UK', { 
                                    hour: '2-digit', 
                                    minute: '2-digit' 
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuditLog;
