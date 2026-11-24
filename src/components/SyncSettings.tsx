import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchSyncStatus,
  triggerSyncNow,
  setApiToken,
  getApiToken,
  isWebCloudMode,
  SyncStatus,
} from '../api';
import { CloudIcon, ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

const SyncSettings: React.FC = () => {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [tokenInput, setTokenInput] = useState(getApiToken());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await fetchSyncStatus());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(load, 15_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const handleSyncNow = async () => {
    setSyncing(true);
    setMessage('');
    try {
      const result = await triggerSyncNow();
      if (!result) {
        setMessage('تعذّر الوصول إلى خدمة المزامنة (قد لا يكون الضيف مهيأً على هذا الجهاز)');
      } else if (result.error) {
        setMessage(`فشلت المزامنة: ${result.error}`);
      } else {
        setMessage(`تمت المزامنة - أُرسل ${result.pushed} واستُقبل ${result.pulled}، تعارضات: ${result.conflicts}`);
      }
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveToken = () => {
    setApiToken(tokenInput.trim());
    setMessage('تم حفظ المفتاح - جاري إعادة التحميل...');
    setTimeout(() => window.location.reload(), 600);
  };

  const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString('ar-SA-u-ca-gregory-nu-latn') : '-');

  return (
    <div className="max-w-3xl mx-auto space-y-6" dir="rtl">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-1">
          <CloudIcon className="h-6 w-6 text-blue-600" />
          <h2 className="text-xl font-bold text-gray-800">المزامنة السحابية</h2>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          النسخة المحلية هي الأساس، وتُزامَن التعديلات مع النسخة الأونلاين تلقائياً عند توفر الإنترنت.
        </p>

        {loading ? (
          <div className="text-gray-400 text-sm py-6 text-center">جارٍ التحميل...</div>
        ) : !status ? (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
            لا تتوفر معلومات المزامنة على هذا الجهاز.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">معرّف هذا الجهاز</div>
              <div className="font-mono text-sm text-gray-800" dir="ltr">{status.deviceId}</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">الخادم السحابي</div>
              <div className="font-mono text-sm text-gray-800 break-all" dir="ltr">
                {status.peerUrl || 'غير مهيأ - يعمل محلياً فقط'}
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">تعديلات بانتظار الإرسال</div>
              <div className="text-lg font-bold text-gray-800">{status.pendingChanges}</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">تعارضات معلّقة</div>
              <div className={`text-lg font-bold ${status.pendingConflicts > 0 ? 'text-amber-600' : 'text-gray-800'}`}>
                {status.pendingConflicts}
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">آخر مزامنة ناجحة</div>
              <div className="text-sm font-medium text-gray-800">{fmt(status.meta?.lastSyncAt)}</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">آخر خطأ</div>
              <div className="text-sm font-medium text-gray-800 break-all">
                {status.meta?.lastSyncError || 'لا يوجد'}
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={handleSyncNow}
            disabled={syncing || !status?.peerUrl}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-5 py-2.5 rounded-xl transition-colors"
          >
            <ArrowPathIcon className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'جارٍ المزامنة...' : 'مزامنة الآن'}
          </button>
          {message && (
            <span className="text-sm text-gray-600 inline-flex items-center gap-1">
              {message.includes('فشلت') || message.includes('تعذّر') ? (
                <ExclamationTriangleIcon className="h-4 w-4 text-amber-500" />
              ) : (
                <CheckCircleIcon className="h-4 w-4 text-emerald-500" />
              )}
              {message}
            </span>
          )}
        </div>
      </div>

      {isWebCloudMode() && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-1">مفتاح الوصول (API Token)</h3>
          <p className="text-sm text-gray-500 mb-4">
            المفتاح المطلوب للدخول إلى النسخة الأونلاين. يُحفظ على هذا الجهاز فقط.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="أدخل مفتاح الوصول"
              className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              dir="ltr"
            />
            <button
              onClick={handleSaveToken}
              className="bg-slate-700 hover:bg-slate-800 text-white font-bold px-5 py-2.5 rounded-xl transition-colors"
            >
              حفظ المفتاح
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SyncSettings;
