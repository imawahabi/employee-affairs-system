import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BellIcon,
  XMarkIcon,
  CheckIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { Alert } from '../types';
import {
  fetchAlerts,
  getUnreadAlertsCount,
  markAlertAsRead,
  dismissAlert,
  openAlertsEventSource,
} from '../api';
import { APP_SOFT_REFRESH_EVENT } from '../constants/events';

interface NotificationDropdownProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 60 * 1000;
const RECONNECT_DELAY_MS = 4000;

const NotificationDropdown: React.FC<NotificationDropdownProps> = ({ isOpen, onToggle, onClose }) => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const isOpenRef = useRef(isOpen);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const loadAlerts = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetchAlerts({ limit: 10, status: 'new' });
      const alertsData = Array.isArray(response) ? response : response?.data || [];
      setAlerts(alertsData);
    } catch (error) {
      console.error('Failed to load alerts:', error);
      if (!silent) setAlerts([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadUnreadCount = useCallback(async () => {
    try {
      const data = await getUnreadAlertsCount();
      setUnreadCount(Number(data?.count) || 0);
    } catch (error) {
      console.error('Failed to load unread count:', error);
    }
  }, []);

  const refreshNotifications = useCallback(
    async ({ withAlerts = false, silent = true }: { withAlerts?: boolean; silent?: boolean } = {}) => {
      if (!silent) setIsRefreshing(true);
      try {
        await Promise.all([
          loadUnreadCount(),
          withAlerts ? loadAlerts({ silent }) : Promise.resolve(),
        ]);
      } finally {
        if (!silent) setIsRefreshing(false);
      }
    },
    [loadAlerts, loadUnreadCount]
  );

  const scheduleReconnect = useCallback(
    (connect: () => Promise<void>) => {
      if (disposedRef.current || reconnectTimerRef.current !== null) return;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!disposedRef.current) {
          void connect();
        }
      }, RECONNECT_DELAY_MS);
    },
    []
  );

  const connectEventSource = useCallback(async () => {
    clearReconnectTimer();
    closeEventSource();

    try {
      const es = await openAlertsEventSource();
      if (disposedRef.current) {
        es.close();
        return;
      }

      eventSourceRef.current = es;

      const onUnread = (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          setUnreadCount(Number(data?.count) || 0);
        } catch { }
      };

      const onCreated = (ev: MessageEvent) => {
        try {
          const payload = JSON.parse(ev.data);
          const created: Alert = payload.alert || payload;
          setAlerts((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            if (list.some((item) => item.id === created.id)) return list;
            return [created, ...list].slice(0, 10);
          });
          if (typeof payload.unreadCount === 'number') setUnreadCount(payload.unreadCount);
        } catch { }
      };

      const onUpdated = (ev: MessageEvent) => {
        try {
          const payload = JSON.parse(ev.data) as { id: string; status?: string; unreadCount?: number };
          setAlerts((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            if (payload.status !== 'new') {
              return list.filter((alert) => alert.id !== payload.id);
            }
            return list.map((alert) =>
              alert.id === payload.id ? ({ ...alert, status: payload.status } as Alert) : alert
            );
          });
          if (typeof payload.unreadCount === 'number') setUnreadCount(payload.unreadCount);
        } catch { }
      };

      const onDeleted = (ev: MessageEvent) => {
        try {
          const payload = JSON.parse(ev.data) as { id: string; unreadCount?: number };
          setAlerts((prev) => (Array.isArray(prev) ? prev.filter((alert) => alert.id !== payload.id) : prev));
          if (typeof payload.unreadCount === 'number') setUnreadCount(payload.unreadCount);
        } catch { }
      };

      es.addEventListener('alerts_unread_count', onUnread as EventListener);
      es.addEventListener('alert_created', onCreated as EventListener);
      es.addEventListener('alert_updated', onUpdated as EventListener);
      es.addEventListener('alert_deleted', onDeleted as EventListener);

      es.onopen = () => {
        void refreshNotifications({ withAlerts: isOpenRef.current, silent: true });
      };

      es.onerror = () => {
        closeEventSource();
        scheduleReconnect(connectEventSource);
      };
    } catch (error) {
      scheduleReconnect(connectEventSource);
    }
  }, [clearReconnectTimer, closeEventSource, refreshNotifications, scheduleReconnect]);

  useEffect(() => {
    if (isOpen) {
      void loadAlerts({ silent: false });
    }
  }, [isOpen, loadAlerts]);

  useEffect(() => {
    const sync = () => {
      void refreshNotifications({ withAlerts: isOpenRef.current, silent: true });
    };

    sync();

    const intervalId = window.setInterval(sync, POLL_INTERVAL_MS);
    const handleFocus = () => sync();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sync();
      }
    };
    const handleSoftRefresh = () => sync();

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener(APP_SOFT_REFRESH_EVENT, handleSoftRefresh as EventListener);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener(APP_SOFT_REFRESH_EVENT, handleSoftRefresh as EventListener);
    };
  }, [refreshNotifications]);

  useEffect(() => {
    disposedRef.current = false;
    void connectEventSource();

    return () => {
      disposedRef.current = true;
      clearReconnectTimer();
      closeEventSource();
    };
  }, [clearReconnectTimer, closeEventSource, connectEventSource]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  const handleMarkAsRead = async (alertId: string) => {
    try {
      await markAlertAsRead(alertId);
      setAlerts((prev) => prev.map((alert) => (alert.id === alertId ? { ...alert, status: 'read' } : alert)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const handleDismiss = async (alertId: string) => {
    try {
      await dismissAlert(alertId);
      setAlerts((prev) => prev.filter((alert) => alert.id !== alertId));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to dismiss alert:', error);
    }
  };

  const handleManualRefresh = () => {
    void refreshNotifications({ withAlerts: true, silent: false });
  };

  const getAlertIcon = (type: string, severity: string) => {
    if (severity === 'high') {
      return <ExclamationTriangleIcon className="h-5 w-5 text-red-600 drop-shadow-sm" />;
    }
    switch (type) {
      case 'overdue_shift':
        return <ClockIcon className="h-5 w-5 text-orange-600 drop-shadow-sm" />;
      case 'professional_extension':
        return <ClockIcon className="h-5 w-5 text-amber-600 drop-shadow-sm" />;
      case 'reminder':
        return <BellIcon className="h-5 w-5 text-blue-600 drop-shadow-sm" />;
      default:
        return <BellIcon className="h-5 w-5 text-gray-600 drop-shadow-sm" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high':
        return 'border-r-red-500 bg-gradient-to-l from-red-50 to-red-25';
      case 'medium':
        return 'border-r-amber-500 bg-gradient-to-l from-amber-50 to-amber-25';
      case 'low':
        return 'border-r-blue-500 bg-gradient-to-l from-blue-50 to-blue-25';
      default:
        return 'border-r-gray-400 bg-gradient-to-l from-gray-50 to-gray-25';
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

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={onToggle}
        className="relative flex items-center justify-center w-8 h-8 rounded-xl transition-all duration-300 group focus:outline-none hover:scale-110"
        title="عرض التنبيهات"
      >
        <span className="sr-only">عرض التنبيهات</span>
        <div className="notification-container relative">
          <div className="notification-bg absolute inset-0 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl"></div>
          <div className="notification-glow absolute inset-0 bg-orange-400 rounded-xl blur-lg opacity-40 group-hover:opacity-60 transition-all duration-300"></div>
          <div className="notification-content flex items-center justify-center w-12 h-12 rounded-xl group-hover:from-amber-600 group-hover:to-amber-700 transition-all duration-300 shadow-md shadow-orange-400/30">
            <BellIcon className="h-7 w-7 text-white drop-shadow-md" aria-hidden="true" />
          </div>
        </div>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-gradient-to-r from-red-500 to-red-600 rounded-full min-w-[18px] h-5 shadow-lg animate-pulse border border-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-3 w-96 bg-white rounded-2xl shadow-2xl border border-orange-200/60 z-50 max-h-[32rem] overflow-hidden backdrop-blur-sm" dir="rtl">
          <div className="px-6 py-4 border-b border-orange-200 bg-gradient-to-r from-orange-100 via-orange-100 to-orange-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl">
                  <BellIcon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">التنبيهات</h3>
                  <p className="text-xs text-gray-600">آخر التحديثات والإشعارات</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <span className="bg-gradient-to-r from-red-500 to-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-md">
                    {unreadCount} جديد
                  </span>
                )}
                <button
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  className="p-2 hover:bg-orange-100 rounded-xl transition-all duration-200 text-gray-600 hover:text-gray-800 disabled:opacity-60"
                  title="تحديث التنبيهات"
                >
                  <ArrowPathIcon className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-orange-100 rounded-xl transition-all duration-200 text-gray-600 hover:text-gray-800"
                  title="إغلاق"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-orange-200 scrollbar-track-orange-50">
            {loading ? (
              <div className="p-6 text-center text-orange-600">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto"></div>
                <p className="mt-3 text-sm font-medium">جاري التحميل...</p>
              </div>
            ) : !Array.isArray(alerts) || alerts.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-amber-100 to-orange-100 rounded-full flex items-center justify-center">
                  <BellIcon className="h-8 w-8 text-orange-400" />
                </div>
                <p className="font-bold text-gray-700 mb-2">لا توجد تنبيهات جديدة</p>
                <p className="text-sm text-gray-500">ستظهر التنبيهات الجديدة هنا عند توفرها</p>
              </div>
            ) : (
              <div className="divide-y divide-orange-100/50">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-5 hover:bg-gradient-to-r hover:from-orange-50/50 hover:to-amber-50/50 transition-all duration-200 border-r-4 ${getSeverityColor(alert.severity)}`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 mt-1 p-2 rounded-full bg-white shadow-sm">
                        {getAlertIcon(alert.type, alert.severity)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="text-sm font-bold text-gray-900 mb-2 leading-relaxed">{alert.title}</p>
                            <p className="text-sm text-gray-700 mb-3 leading-relaxed">{alert.message}</p>
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 bg-orange-400 rounded-full"></div>
                              <p className="text-xs text-gray-500 font-medium">{formatTimeAgo(alert.dateTriggered)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 mr-3">
                            {alert.status === 'new' && (
                              <button
                                onClick={() => handleMarkAsRead(alert.id)}
                                className="p-2 hover:bg-green-100 rounded-xl text-green-600 hover:text-green-700 transition-all duration-200 shadow-sm hover:shadow-md"
                                title="تحديد كمقروء"
                              >
                                <CheckIcon className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDismiss(alert.id)}
                              className="p-2 hover:bg-red-100 rounded-xl text-red-500 hover:text-red-600 transition-all duration-200 shadow-sm hover:shadow-md"
                              title="إخفاء"
                            >
                              <XMarkIcon className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationDropdown;
