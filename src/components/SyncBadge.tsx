import React, { useCallback, useEffect, useState } from 'react';
import { fetchSyncStatus, SyncStatus } from '../api';
import { APP_SOFT_REFRESH_EVENT } from '../constants/events';
import {
  CloudIcon,
  ExclamationTriangleIcon,
  SignalIcon,
} from '@heroicons/react/24/outline';

interface Props {
  onOpenConflicts: () => void;
}

// Icon-style sync indicator matching the notification bell in the header.
const SyncBadge: React.FC<Props> = ({ onOpenConflicts }) => {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const data = await fetchSyncStatus();
    setStatus(data);
    setReachable(data ? true : false);
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    const handler = () => void refresh();
    window.addEventListener(APP_SOFT_REFRESH_EVENT, handler);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(APP_SOFT_REFRESH_EVENT, handler);
    };
  }, [refresh]);

  const hasPeer = !!status?.peerUrl;
  const conflicts = status?.pendingConflicts ?? 0;
  const pending = status?.pendingChanges ?? 0;
  const lastError = status?.meta?.lastSyncError;

  type Tone = 'offline' | 'local' | 'ok' | 'warn' | 'error';
  let tone: Tone = 'local';
  let Icon = SignalIcon;

  if (!hasPeer) {
    tone = 'local';
  } else if (reachable === false) {
    tone = 'offline';
    Icon = CloudIcon;
  } else if (lastError) {
    tone = 'error';
    Icon = ExclamationTriangleIcon;
  } else if (conflicts > 0) {
    tone = 'warn';
    Icon = ExclamationTriangleIcon;
  } else {
    tone = 'ok';
    Icon = CloudIcon;
  }

  const styles: Record<Tone, { bg: string; glow: string; icon: string }> = {
    offline: { bg: 'from-gray-400 to-gray-500', glow: 'bg-gray-400', icon: 'text-white' },
    local: { bg: 'from-slate-400 to-slate-500', glow: 'bg-slate-400', icon: 'text-white' },
    ok: { bg: 'from-emerald-500 to-emerald-600', glow: 'bg-emerald-400', icon: 'text-white' },
    warn: { bg: 'from-amber-500 to-orange-600', glow: 'bg-amber-400', icon: 'text-white' },
    error: { bg: 'from-red-500 to-red-600', glow: 'bg-red-400', icon: 'text-white' },
  };
  const s = styles[tone];

  const tooltip =
    tone === 'local'
      ? 'النسخة المحلية فقط - لم يتم إعداد المزامنة'
      : tone === 'offline'
        ? 'تعذر الوصول إلى الخادم السحابي'
        : tone === 'error'
          ? `خطأ في المزامنة: ${lastError || ''}`
          : conflicts > 0
            ? `${conflicts} تعارض مزامنة - اضغط للحل`
            : pending > 0
              ? `${pending} تعديل بانتظار المزامنة`
              : `متزامن${status?.meta?.lastSyncAt ? ` - آخر مزامنة: ${new Date(status.meta.lastSyncAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn')}` : ''}`;

  return (
    <button
      onClick={conflicts > 0 ? onOpenConflicts : undefined}
      title={tooltip}
      className={`relative flex items-center justify-center w-8 h-8 rounded-xl transition-all duration-300 group focus:outline-none hover:scale-110 me-6 ${conflicts > 0 ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <span className="sr-only">حالة المزامنة</span>
      <div className="notification-container relative">
        <div className={`notification-bg absolute inset-0 bg-gradient-to-br ${s.bg} rounded-xl`}></div>
        <div className={`notification-glow absolute inset-0 ${s.glow} rounded-xl blur-lg opacity-40 group-hover:opacity-60 transition-all duration-300`}></div>
        <div className="notification-content flex items-center justify-center w-12 h-12 rounded-xl shadow-md">
          <Icon className={`h-7 w-7 ${s.icon} drop-shadow-md`} aria-hidden="true" />
        </div>
        {conflicts > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-gradient-to-r from-red-500 to-red-600 rounded-full min-w-[18px] h-5 shadow-lg animate-pulse border border-white">
            {conflicts}
          </span>
        )}
        {tone === 'warn' && conflicts === 0 && pending > 0 && (
          <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-amber-400 border border-white" />
        )}
        {tone === 'error' && (
          <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 border border-white animate-pulse" />
        )}
      </div>
    </button>
  );
};

export default SyncBadge;
