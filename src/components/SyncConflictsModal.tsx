import React, { useCallback, useEffect, useState } from 'react';
import { fetchSyncConflicts, resolveSyncConflict, SyncConflict } from '../api';
import { APP_SOFT_REFRESH_EVENT } from '../constants/events';
import { XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

const TABLE_LABELS: Record<string, string> = {
  Departments: 'الإدارات',
  Ranks: 'الرتب',
  Employees: 'الموظفين',
  Shifts: 'المناوبات',
  ShiftAssignments: 'تعيينات المناوبات',
  ShiftDayExceptions: 'أيام الاستثناء',
  ShiftExceptions: 'استثناءات المناوبات',
  Settings: 'الإعدادات',
  Alerts: 'التنبيهات',
  ProfessionalExtensions: 'تمديدات الفنيون',
  Licenses: 'الرخص والاستئذانات',
  AuditLog: 'سجل التغييرات',
  NotificationSettings: 'إعدادات الإشعارات',
  AlertLog: 'سجل التنبيهات',
  Nationalities: 'الجنسيات',
  JobTitles: 'المسميات الوظيفية',
  Sections: 'الأقسام',
  SyncConflicts: 'تعارضات المزامنة',
};

const FIELD_LABELS: Record<string, string> = {
  id: 'المعرف',
  name: 'الاسم',
  nameAr: 'الاسم',
  fileNumber: 'رقم الملف',
  rank: 'المسمى الوظيفي',
  category: 'الفئة',
  department: 'الإدارة',
  section: 'القسم',
  jobTitle: 'المسمى الوظيفي',
  status: 'الحالة',
  phone_number: 'رقم الهاتف',
  civilId: 'الرقم المدني',
  shiftDate: 'تاريخ المناوبة',
  createdBy: 'أنشأها',
  note: 'ملاحظة',
  notes: 'ملاحظات',
  value: 'القيمة',
  key: 'المفتاح',
  description: 'الوصف',
};

const friendlyValue = (v: any): string => {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const diffFields = (a: any, b: any): Array<{ field: string; local: any; remote: any }> => {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out: Array<{ field: string; local: any; remote: any }> = [];
  keys.forEach((k) => {
    const va = a?.[k];
    const vb = b?.[k];
    if (JSON.stringify(va) !== JSON.stringify(vb)) {
      out.push({ field: k, local: va, remote: vb });
    }
  });
  return out;
};

interface Props {
  open: boolean;
  onClose: () => void;
  onResolved?: () => void;
}

const SyncConflictsModal: React.FC<Props> = ({ open, onClose, onResolved }) => {
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setConflicts(await fetchSyncConflicts());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    const handler = () => { if (open) void load(); };
    window.addEventListener(APP_SOFT_REFRESH_EVENT, handler);
    return () => window.removeEventListener(APP_SOFT_REFRESH_EVENT, handler);
  }, [open, load]);

  if (!open) return null;

  const handleResolve = async (id: string, keep: 'local' | 'remote') => {
    setResolvingId(id);
    setError('');
    try {
      await resolveSyncConflict(id, keep);
      await load();
      onResolved?.();
    } catch (e: any) {
      setError(e?.message || 'فشل حل التعارض');
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <ArrowPathIcon className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-bold text-gray-800">تعارضات المزامنة</h2>
            {conflicts.length > 0 && (
              <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
                {conflicts.length}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-2">{error}</div>
          )}
          {loading && conflicts.length === 0 && (
            <div className="text-center text-gray-400 py-10">جارٍ التحميل...</div>
          )}
          {!loading && conflicts.length === 0 && (
            <div className="text-center text-gray-400 py-10">لا توجد تعارضات معلّقة</div>
          )}

          {conflicts.map((c) => {
            const diffs = diffFields(c.localData, c.remoteData);
            const tableLabel = TABLE_LABELS[c.tableName] || c.tableName;
            return (
              <div key={c.id} className="border border-amber-200 bg-amber-50/40 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded-lg">
                    {tableLabel}
                  </span>
                  <span className="text-xs text-gray-500" dir="ltr">{c.rowId}</span>
                  <span className="text-xs text-gray-400 mr-auto">
                    {new Date(c.createdAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn')}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <div className="bg-white border border-gray-200 rounded-lg p-3">
                    <div className="text-xs font-bold text-gray-500 mb-2">
                      النسخة المحلية {c.localDevice ? `(${c.localDevice})` : ''}
                    </div>
                    {c.localData === null ? (
                      <div className="text-sm text-red-500 font-medium">تم الحذف</div>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {diffs.map((d) => (
                          <div key={d.field} className="text-xs">
                            <span className="text-gray-500">{FIELD_LABELS[d.field] || d.field}: </span>
                            <span className="font-medium text-gray-800">{friendlyValue(d.local)}</span>
                          </div>
                        ))}
                        {diffs.length === 0 && <div className="text-xs text-gray-400">لا فروقات</div>}
                      </div>
                    )}
                  </div>
                  <div className="bg-white border border-gray-200 rounded-lg p-3">
                    <div className="text-xs font-bold text-gray-500 mb-2">
                      النسخة البعيدة {c.remoteDevice ? `(${c.remoteDevice})` : ''}
                    </div>
                    {c.remoteData === null ? (
                      <div className="text-sm text-red-500 font-medium">تم الحذف</div>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {diffs.map((d) => (
                          <div key={d.field} className="text-xs">
                            <span className="text-gray-500">{FIELD_LABELS[d.field] || d.field}: </span>
                            <span className="font-medium text-gray-800">{friendlyValue(d.remote)}</span>
                          </div>
                        ))}
                        {diffs.length === 0 && <div className="text-xs text-gray-400">لا فروقات</div>}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    disabled={resolvingId === c.id}
                    onClick={() => handleResolve(c.id, 'local')}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold py-2 rounded-lg transition-colors"
                  >
                    {resolvingId === c.id ? 'جارٍ...' : 'الاعتماد على النسخة المحلية'}
                  </button>
                  <button
                    disabled={resolvingId === c.id}
                    onClick={() => handleResolve(c.id, 'remote')}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold py-2 rounded-lg transition-colors"
                  >
                    {resolvingId === c.id ? 'جارٍ...' : 'الاعتماد على النسخة البعيدة'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SyncConflictsModal;
