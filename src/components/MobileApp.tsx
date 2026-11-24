import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchEmployees,
  fetchShifts,
  fetchShiftAssignments,
  fetchDepartments,
  fetchLicenses,
  createShift,
  recordAbsence,
  fetchAlerts,
  markAlertAsRead,
  dismissAlert,
  markAlertAsResolved,
  fetchSyncStatus,
  triggerSyncNow,
} from '../api';
import type { Alert } from '../types';
import type { Employee, Shift, ShiftAssignment } from '../types';
import logo from '../assets/logo.png';
import LicenseList from '../licenses/components/LicenseList';
import Reports from './Reports';
import Settings from './Settings';
import AuditLog from './AuditLog';
import ProfessionalExtensions from './ProfessionalExtensions';
import NextDutyQueue from './NextDutyQueue';
import EmployeeReportsBuilder from './EmployeeReportsBuilder';
import EmployeeShiftHistory from './EmployeeShiftHistory';
import ViewShifts from './ViewShifts';
import ShiftRegistration from './ShiftRegistration';
import ParkingMap from './ParkingMap';
import SyncSettings from './SyncSettings';
import { Bars3Icon, ArrowRightIcon } from '@heroicons/react/24/outline';
import {
  ClipboardList, Contact, Bell, Award, BarChart3, History,
  ListOrdered, Car, ScrollText, RefreshCw, Settings as SettingsIcon, Eye,
} from 'lucide-react';
import {
  HomeIcon,
  UsersIcon,
  CalendarDaysIcon,
  MagnifyingGlassIcon,
  ChevronLeftIcon,
} from '@heroicons/react/24/outline';

// ---------- helpers ----------
const isFutureDate = (d?: string) => !!d && d > todayKey();
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatDate = (v?: string) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

// Display helpers: rank / three-part name on phones
const shortName = (name?: string | null) => (name || '').trim().split(/\s+/).slice(0, 3).join(' ');
const rankSlashName = (e?: { name?: string | null; rank?: string | null } | null) =>
  [e?.rank, shortName(e?.name)].filter(Boolean).join(' / ') || '-';

// Word-order-insensitive match: every query word must appear in order
// inside the field (e.g. "محمد عبدالوهاب" matches "محمد احمد عبدالوهاب").
const smartMatch = (query: string, fields: Array<string | null | undefined>) => {
  const qw = norm(query).split(' ').filter(Boolean);
  if (!qw.length) return true;
  return fields.filter(Boolean).some((f) => {
    const fw = norm(String(f)).split(' ').filter(Boolean);
    let i = 0;
    for (const w of qw) {
      const idx = fw.findIndex((x, j) => j >= i && x.includes(w));
      if (idx < 0) return false;
      i = idx + 1;
    }
    return true;
  });
};

const norm = (s: string) =>
  (s || '')
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ئ/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ة/g, 'ه')
    .replace(/[\s\-_]+/g, ' ')
    .trim()
    .toLowerCase();

// ---------- types ----------
type Tab = 'home' | 'employees' | 'shifts' | 'more';

// ---------- Mobile alerts ----------
const SEVERITY_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  high: { bg: 'bg-red-100', text: 'text-red-700', label: 'عالي' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'متوسط' },
  low: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'منخفض' },
};
const STATUS_LABEL: Record<string, string> = {
  new: 'جديد', read: 'مقروء', resolved: 'محلول', dismissed: 'مؤرشف',
};

const MobileAlerts: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [empNames, setEmpNames] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState<'all' | 'new' | 'read' | 'resolved'>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, e] = await Promise.all([
        fetchAlerts({ limit: 200 }).catch(() => []),
        fetchEmployees().catch(() => []),
      ]);
      setAlerts(Array.isArray(a) ? a : []);
      const m = new Map<string, string>();
      (Array.isArray(e) ? e : []).forEach((emp: any) => m.set(emp.id, emp.name));
      setEmpNames(m);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = alerts.filter((a) => (filter === 'all' ? true : a.status === filter));
  const counts = {
    new: alerts.filter((a) => a.status === 'new').length,
    read: alerts.filter((a) => a.status === 'read').length,
    resolved: alerts.filter((a) => a.status === 'resolved').length,
  };

  const act = async (id: string, fn: (id: string) => Promise<any>) => {
    try { await fn(id); await load(); } catch {}
  };

  if (loading) {
    return <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {([
          { id: 'all', label: `الكل (${alerts.length})` },
          { id: 'new', label: `جديدة (${counts.new})` },
          { id: 'read', label: `مقروءة (${counts.read})` },
          { id: 'resolved', label: `محلولة (${counts.resolved})` },
        ] as const).map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
              filter === f.id ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((a) => {
          const sev = SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.low;
          const empName = a.employeeId ? empNames.get(a.employeeId) : undefined;
          const dateStr = a.dateTriggered || a.createdAt;
          return (
            <div key={a.id} className={`bg-white rounded-2xl border p-4 ${a.status === 'new' ? 'border-blue-200 shadow-sm' : 'border-gray-100 opacity-90'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${sev.bg} ${sev.text}`}>{sev.label}</span>
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{STATUS_LABEL[a.status] || a.status}</span>
                  </div>
                  <div className="font-bold text-gray-800 text-sm mt-1.5">{a.title}</div>
                  <div className="text-xs text-gray-600 mt-1 leading-relaxed">{a.message}</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-[11px] text-gray-400">
                    {empName && <span className="text-blue-600 font-medium">{shortName(empName)}</span>}
                    <span>{formatDate(dateStr)}</span>
                  </div>
                </div>
              </div>
              {a.status !== 'resolved' && a.status !== 'dismissed' && (
                <div className="flex gap-2 mt-3">
                  {a.status === 'new' && (
                    <button onClick={() => act(a.id, markAlertAsRead)} className="flex-1 text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded-lg py-2">تحديد كمقروء</button>
                  )}
                  <button onClick={() => act(a.id, markAlertAsResolved)} className="flex-1 text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg py-2">حل</button>
                  <button onClick={() => act(a.id, dismissAlert)} className="flex-1 text-xs font-bold bg-gray-50 text-gray-500 border border-gray-200 rounded-lg py-2">أرشفة</button>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 py-12 text-sm">لا توجد تنبيهات في هذا التصنيف</div>
        )}
      </div>
    </div>
  );
};

// ---------- Sync status card (More page) ----------
const SyncStatusCard: React.FC<{ onOpenSyncPage?: () => void }> = ({ onOpenSyncPage }) => {
  const [status, setStatus] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const s = await fetchSyncStatus().catch(() => null);
    setStatus(s);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const syncNow = async () => {
    setSyncing(true);
    setMsg('');
    try {
      const r: any = await triggerSyncNow();
      setMsg(r?.error ? `فشلت: ${r.error}` : `تم - أُرسل ${r?.pushed ?? 0} واستُقبل ${r?.pulled ?? 0}`);
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const hasPeer = !!status?.peerUrl;
  const conflicts = status?.pendingConflicts ?? 0;
  const pending = status?.pendingChanges ?? 0;
  const err = status?.meta?.lastSyncError;
  const lastAt = status?.meta?.lastSyncAt;

  const tone = !hasPeer ? 'bg-slate-50 border-slate-200' : err ? 'bg-red-50 border-red-200' : conflicts > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200';
  const dot = !hasPeer ? 'bg-slate-400' : err ? 'bg-red-500' : conflicts > 0 ? 'bg-amber-500' : 'bg-emerald-500';
  const headline = !hasPeer ? 'يعمل محلياً فقط' : err ? 'خطأ في المزامنة' : conflicts > 0 ? `${conflicts} تعارض يحتاج قرارك` : pending > 0 ? `${pending} تعديل بانتظار الإرسال` : 'متزامن مع السحابة';

  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${dot} ${!err && !conflicts ? 'animate-pulse' : ''}`} />
          <span className="font-black text-gray-800 text-sm">{headline}</span>
        </div>
        <button onClick={syncNow} disabled={syncing || !hasPeer} className="text-xs font-bold bg-blue-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-40">
          {syncing ? '...' : 'مزامنة الآن'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-gray-600">
        <div>الجهاز: <b className="font-mono" dir="ltr">{status?.deviceId || '-'}</b></div>
        <div>السحابة: <b className="font-mono" dir="ltr">{status?.peerUrl ? 'متصلة' : 'غير مهيأة'}</b></div>
        <div>معلق: <b>{pending}</b></div>
        <div>تعارضات: <b className={conflicts ? 'text-amber-600' : ''}>{conflicts}</b></div>
        <div className="col-span-2">آخر مزامنة: <b>{lastAt ? new Date(lastAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn') : '-'}</b></div>
        {err && <div className="col-span-2 text-red-600 break-all">الخطأ: {err}</div>}
        {msg && <div className="col-span-2 text-blue-700">{msg}</div>}
      </div>
      {hasPeer && (
        <button onClick={onOpenSyncPage} className="mt-3 text-[11px] font-bold text-blue-600">عرض صفحة المزامنة الكاملة ←</button>
      )}
    </div>
  );
};

const EXTRA_PAGES: Array<{ id: string; label: string; icon: any; component: React.ComponentType; color: string }> = [
  { id: 'view-shifts', label: 'عرض المناوبات', icon: Eye, component: ViewShifts, color: 'bg-blue-100 text-blue-600' },
  { id: 'shift-registration', label: 'تسجيل مناوبة', icon: ClipboardList, component: ShiftRegistration, color: 'bg-indigo-100 text-indigo-600' },
  { id: 'licenses', label: 'الرخص والاستئذانات', icon: Contact, component: LicenseList, color: 'bg-emerald-100 text-emerald-600' },
  { id: 'alerts', label: 'التنبيهات', icon: Bell, component: MobileAlerts, color: 'bg-red-100 text-red-600' },
  { id: 'extensions', label: 'التمديدات المهنية', icon: Award, component: ProfessionalExtensions, color: 'bg-amber-100 text-amber-600' },
  { id: 'reports', label: 'التقارير', icon: BarChart3, component: Reports, color: 'bg-violet-100 text-violet-600' },
  { id: 'emp-reports', label: 'تقارير الموظفين', icon: BarChart3, component: EmployeeReportsBuilder, color: 'bg-purple-100 text-purple-600' },
  { id: 'emp-history', label: 'سجل مناوبات الموظف', icon: History, component: EmployeeShiftHistory, color: 'bg-cyan-100 text-cyan-600' },
  { id: 'next-queue', label: 'طابور المناوبة القادمة', icon: ListOrdered, component: NextDutyQueue, color: 'bg-orange-100 text-orange-600' },
  { id: 'parking', label: 'خريطة المواقف', icon: Car, component: ParkingMap, color: 'bg-teal-100 text-teal-600' },
  { id: 'audit', label: 'سجل التغييرات', icon: ScrollText, component: AuditLog, color: 'bg-slate-100 text-slate-600' },
  { id: 'sync', label: 'المزامنة السحابية', icon: RefreshCw, component: SyncSettings, color: 'bg-sky-100 text-sky-600' },
  { id: 'settings', label: 'الإعدادات', icon: SettingsIcon, component: Settings, color: 'bg-gray-100 text-gray-600' },
];

const MobileApp: React.FC = () => {
  const [tab, setTab] = useState<Tab>('home');
  const [extraPage, setExtraPage] = useState<string | null>(null);
  const [focusEmpId, setFocusEmpId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [licenses, setLicenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [empQuery, setEmpQuery] = useState('');
  const [shiftQuery, setShiftQuery] = useState('');
  const [openShiftId, setOpenShiftId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, s, a, d, l] = await Promise.all([
        fetchEmployees().catch(() => []),
        fetchShifts().catch(() => []),
        fetchShiftAssignments().catch(() => []),
        fetchDepartments().catch(() => []),
        fetchLicenses().catch(() => []),
      ]);
      setEmployees(Array.isArray(e) ? e : []);
      setShifts(Array.isArray(s) ? s : (s as any)?.data || []);
      setAssignments(Array.isArray(a) ? a : []);
      setDepartments(Array.isArray(d) ? d : []);
      const lj = Array.isArray(l) ? l : (l as any)?.data || (l as any)?.licenses || [];
      setLicenses(Array.isArray(lj) ? lj : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  const empById = useMemo(() => {
    const m = new Map<string, Employee>();
    employees.forEach((e) => m.set(e.id, e));
    return m;
  }, [employees]);

  const deptName = (idOrName?: string) => {
    if (!idOrName) return '';
    const d = departments.find((x: any) => x.id === idOrName || x.name === idOrName);
    return d?.name || idOrName;
  };

  const filteredEmployees = useMemo(() => {
    const q = norm(empQuery);
    if (!q) return employees;
    return employees.filter((e) =>
      [e.name, e.fileNumber, e.rank, e.department, e.jobTitle, e.civilId, e.phone_number]
        .filter(Boolean)
        .some((v) => smartMatch(empQuery, [String(v)]))
    );
  }, [employees, empQuery]);

  const sortedShifts = useMemo(() => {
    const list = [...shifts].sort(
      (a: any, b: any) => new Date(b.shiftDate || b.date || 0).getTime() - new Date(a.shiftDate || a.date || 0).getTime()
    );
    const q = norm(shiftQuery);
    if (!q) return list;
    return list.filter((s: any) => {
      const dateStr = formatDate(s.shiftDate || s.date);
      const names = assignments
        .filter((a) => a.shiftId === s.id)
        .map((a) => empById.get(a.employeeId)?.name || '')
        .join(' ');
      return norm(`${dateStr} ${s.note || ''} ${s.createdBy || ''} ${names}`).includes(q);
    });
  }, [shifts, assignments, empById, shiftQuery]);

  const todayShifts = useMemo(
    () => shifts.filter((s: any) => String(s.shiftDate || s.date || '').startsWith(todayKey())),
    [shifts]
  );

  // Detailed dashboard data
  const todayDuty = useMemo(() => {
    const todayIds = new Set(todayShifts.map((s: any) => s.id));
    const seen = new Set<string>();
    const list: Array<{ name: string; rank?: string; fileNumber?: string }> = [];
    assignments
      .filter((a) => todayIds.has(a.shiftId))
      .forEach((a) => {
        if (seen.has(a.employeeId)) return;
        seen.add(a.employeeId);
        const emp = empById.get(a.employeeId);
        if (emp) list.push({ name: emp.name, rank: emp.rank ?? undefined, fileNumber: emp.fileNumber ?? undefined });
      });
    return list;
  }, [todayShifts, assignments, empById]);

  const recentShifts = useMemo(
    () => [...shifts]
      .sort((a: any, b: any) => new Date(b.shiftDate || b.date || 0).getTime() - new Date(a.shiftDate || a.date || 0).getTime())
      .slice(0, 5),
    [shifts]
  );

  const activeEmployeesMemo = useMemo(() => employees.filter((e) => e.status !== 'inactive'), [employees]);

  const deptCounts = useMemo(() => {
    const m = new Map<string, number>();
    activeEmployeesMemo.forEach((e) => {
      const d = e.department || 'بدون إدارة';
      m.set(d, (m.get(d) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [employees]);

  const activeEmployees = activeEmployeesMemo;

  // Workforce statistics (mirrors desktop dashboard)
  const workforceStats = useMemo(() => {
    const byCat = (cat: string) => activeEmployeesMemo.filter((e) => e.category === cat).length;
    return {
      officers: byCat('قيادات'),
      ncos: byCat('مشرفون'),
      professionals: byCat('فنيون'),
      civilians: byCat('إداريون'),
      active: activeEmployeesMemo.length,
      inactive: employees.length - activeEmployeesMemo.length,
    };
  }, [activeEmployeesMemo, employees.length]);

  const licenseStats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const inMonth = (l: any) => {
      const d = new Date(l.start_date || l.date || l.created_at || l.startDate || 0);
      return d >= monthStart && d <= monthEnd;
    };
    const byType = (list: any[], t: string) => list.filter((l) => l.license_type === t || l.type === t).length;
    const monthly = licenses.filter(inMonth);
    const TYPES = ['يوم كامل', 'إستئذان قصير', 'إستئذان طبي'];
    return {
      monthlyTotal: monthly.length,
      monthly: TYPES.map((t) => ({ type: t, count: byType(monthly, t) })),
      total: licenses.length,
      totalByType: TYPES.map((t) => ({ type: t, count: byType(licenses, t) })),
    };
  }, [licenses]);

  const shiftAssignmentsFor = (shiftId: string) =>
    assignments.filter((a) => a.shiftId === shiftId);

  const tabs: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'home', label: 'الرئيسية', icon: HomeIcon },
    { id: 'employees', label: 'الموظفين', icon: UsersIcon },
    { id: 'shifts', label: 'المناوبات', icon: CalendarDaysIcon },
    { id: 'more', label: 'المزيد', icon: Bars3Icon },
  ];

  return (
    <div className="h-[100dvh] bg-gray-100 flex flex-col overflow-hidden" dir="rtl">
      {/* Header */}
      <header className="bg-gradient-to-l from-blue-700 to-blue-600 text-white px-4 py-4 shadow-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img src={logo} alt="شعار الهيئة" className="w-11 h-11 object-contain bg-white rounded-xl p-1 shrink-0" />
          <div>
            <h1 className="text-lg font-bold leading-tight">نظام شؤون الموظفين</h1>
            <p className="text-blue-100 text-[11px] mt-0.5">
              {new Date().toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-3 pb-4">
        {extraPage ? (
          <div>
            <button
              onClick={() => setExtraPage(null)}
              className="mb-3 inline-flex items-center gap-1 text-sm font-bold text-blue-600 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm"
            >
              <ArrowRightIcon className="h-4 w-4" />
              رجوع
            </button>
            {(() => {
              const page = EXTRA_PAGES.find((p) => p.id === extraPage);
              if (!page) return null;
              const PageComponent = page.component;
              // Render desktop pages scaled-to-fit so every section works on phones.
              const pageScale = Math.max(0.45, Math.min(1, (typeof window !== 'undefined' ? window.innerWidth : 390) / 768));
              return (
                <div style={{ width: 768 * pageScale }} className="mx-auto">
                  <div style={{ width: 768, zoom: pageScale, transformOrigin: 'top right' }} dir="rtl">
                    <PageComponent />
                  </div>
                </div>
              );
            })()}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : tab === 'home' ? (
          <HomeTab
            employeesCount={activeEmployees.length}
            totalEmployees={employees.length}
            shiftsCount={shifts.length}
            todayCount={todayShifts.length}
            todayDuty={todayDuty}
            recentShifts={recentShifts}
            deptCounts={deptCounts}
            departmentsCount={departments.length}
            workforceStats={workforceStats}
            licenseStats={licenseStats}
            assignmentsFor={shiftAssignmentsFor}
            onGo={setTab}
            employees={employees}
            shifts={shifts}
            assignments={assignments}
            deptName={deptName}
            onOpenEmployee={(id) => { setTab('employees'); setFocusEmpId(id); }}
          />
        ) : tab === 'employees' ? (
          <EmployeesTab
            employees={filteredEmployees}
            total={employees.length}
            query={empQuery}
            setQuery={setEmpQuery}
            deptName={deptName}
            shifts={shifts}
            assignments={assignments}
            empById={empById}
            focusEmpId={focusEmpId}
            onFocusHandled={() => setFocusEmpId(null)}
          />
        ) : tab === 'shifts' ? (
          <ShiftsTab
            shifts={sortedShifts}
            query={shiftQuery}
            setQuery={setShiftQuery}
            assignmentsFor={shiftAssignmentsFor}
            empById={empById}
            employees={activeEmployees}
            openShiftId={openShiftId}
            setOpenShiftId={setOpenShiftId}
            onChanged={load}
            deptName={deptName}
          />
        ) : tab === 'more' ? (
          <div className="space-y-4">
            <SyncStatusCard onOpenSyncPage={() => setExtraPage('sync')} />
            <div className="bg-gradient-to-l from-blue-700 to-blue-600 rounded-2xl p-4 text-white">
              <h2 className="font-black text-lg">كل أقسام النظام</h2>
              <p className="text-blue-100 text-xs mt-1">{EXTRA_PAGES.length} أقسام متاحة على هاتفك</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {EXTRA_PAGES.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setExtraPage(p.id)}
                  className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-right active:scale-[0.97] transition-transform flex flex-col"
                >
                  <div className="flex items-start justify-between">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${p.color}`}>
                      <p.icon className="h-6 w-6" />
                    </div>
                    <ChevronLeftIcon className="h-4 w-4 text-gray-300" />
                  </div>
                  <div className="text-sm font-bold text-gray-800 mt-3 leading-snug">{p.label}</div>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </main>

      {/* Bottom nav */}
      <nav className="shrink-0 bg-white border-t border-gray-200 flex pb-[env(safe-area-inset-bottom)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center py-2.5 text-xs font-bold transition-colors ${
              tab === t.id ? 'text-blue-600' : 'text-gray-400'
            }`}
          >
            <t.icon className="h-6 w-6 mb-0.5" />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
};

// ---------- Smart search (dashboard) ----------
const SmartSearch: React.FC<{
  employees: Employee[];
  shifts: Shift[];
  assignments: ShiftAssignment[];
  empById: Map<string, Employee>;
  deptName: (v?: string) => string;
  onOpenEmployee?: (id: string) => void;
}> = ({ employees, shifts, assignments, empById, deptName, onOpenEmployee }) => {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = norm(query);
    if (q.length < 2) return [];
    return employees
      .filter((e) =>
        [e.name, e.rank, e.fileNumber, e.civilId, e.phone_number, e.jobTitle, e.department]
          .filter(Boolean)
          .some((v) => smartMatch(query, [String(v)]))
      )
      .slice(0, 8);
  }, [employees, query]);

  const shiftById = useMemo(() => {
    const m = new Map<string, any>();
    shifts.forEach((s: any) => m.set(s.id, s));
    return m;
  }, [shifts]);

  const lastDuties = (empId: string) =>
    assignments
      .filter((a) => a.employeeId === empId)
      .map((a) => ({ a, s: shiftById.get(a.shiftId) }))
      .filter((x) => x.s)
      .sort((x, y) => String(y.s.shiftDate || y.s.date || '').localeCompare(String(x.s.shiftDate || x.s.date || '')))
      .slice(0, 6);

  const selected = selectedId ? empById.get(selectedId) : null;
  const duties = selectedId ? lastDuties(selectedId) : [];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <h3 className="font-bold text-gray-700 mb-3 flex items-center gap-2">
        <MagnifyingGlassIcon className="h-4 w-4 text-blue-600" />
        البحث المتقدم
      </h3>
      <div className="relative">
        <MagnifyingGlassIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedId(null); }}
          placeholder="اسم، مسمى وظيفي، رقم ملف، مدني، جوال..."
          className="w-full bg-gray-50 border border-gray-200 rounded-xl pr-9 pl-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* نتائج البحث */}
      {query.length >= 2 && results.length > 0 && (
        <div className="mt-2 border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-56 overflow-y-auto">
          {results.map((e) => (
            <button
              key={e.id}
              onClick={() => { setSelectedId(e.id === selectedId ? null : e.id); onOpenEmployee?.(e.id); }}
              className={`w-full flex items-center justify-between px-3 py-2.5 text-right ${selectedId === e.id ? 'bg-blue-50' : 'active:bg-gray-50'}`}
            >
              <div className="min-w-0">
                <div className="text-sm font-bold text-gray-800 truncate">{rankSlashName(e)}</div>
                <div className="text-xs text-gray-500">{[e.jobTitle, e.fileNumber && `ملف ${e.fileNumber}`].filter(Boolean).join(' • ')}</div>
              </div>
              {e.status === 'inactive' && <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold shrink-0">غير نشط</span>}
            </button>
          ))}
        </div>
      )}
      {query.length >= 2 && results.length === 0 && (
        <div className="mt-2 text-center text-xs text-gray-400 py-3">لا توجد نتائج</div>
      )}

      {/* بطاقة الموظف - مودال */}
      {selected && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center" dir="rtl" onClick={() => setSelectedId(null)}>
          <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-black text-gray-800 text-lg">{selected.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {[selected.rank, selected.jobTitle, selected.category].filter(Boolean).join(' • ')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${selected.status === 'inactive' ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'}`}>
                  {selected.status === 'inactive' ? 'غير نشط' : 'نشط'}
                </span>
                <button onClick={() => setSelectedId(null)} className="text-gray-400 text-xl leading-none px-1">✕</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs bg-gray-50 rounded-xl p-3">
              {selected.fileNumber && <div className="text-gray-600">ملف: <b>{selected.fileNumber}</b></div>}
              {selected.civilId && <div className="text-gray-600">مدني: <b>{selected.civilId}</b></div>}
              {selected.phone_number && (
                <a href={`tel:${selected.phone_number}`} className="text-blue-600 font-bold col-span-2" dir="ltr">{selected.phone_number}</a>
              )}
              {selected.department && <div className="text-blue-500 col-span-2">{deptName(selected.department)}</div>}
            </div>

            {/* آخر المناوبات */}
            <div className="mt-4">
              <div className="text-xs font-bold text-gray-500 mb-1.5">آخر المناوبات ({duties.length})</div>
              {duties.length === 0 ? (
                <div className="text-xs text-gray-400">لا توجد مناوبات مسجلة</div>
              ) : (
                <div className="space-y-1.5">
                  {duties.map(({ a, s }: any) => {
                    const d = String(s.shiftDate || s.date || '');
                    const isToday = d.startsWith(todayKey());
                    return (
                      <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                        <div className="text-xs">
                          <span className="font-bold text-gray-700">{formatDate(d)}</span>
                          {isToday && <span className="mr-1 text-[9px] bg-emerald-100 text-emerald-700 px-1 rounded">اليوم</span>}
                          {s.note && <span className="text-gray-400"> - {s.note}</span>}
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          String(s.shiftDate || s.date || '') > todayKey() ? 'bg-blue-100 text-blue-700' : a.status === 'attended' ? 'bg-emerald-100 text-emerald-700' : a.status === 'absent' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {String(s.shiftDate || s.date || '') > todayKey() ? 'مجدول' : a.status === 'attended' ? 'حضر' : a.status === 'absent' ? 'غائب' : 'لم يسجل'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------- Tabs ----------

const StatCard: React.FC<{ label: string; value: React.ReactNode; onClick?: () => void }> = ({ label, value, onClick }) => (
  <button
    onClick={onClick}
    className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-center active:scale-95 transition-transform"
  >
    <div className="text-2xl font-black text-blue-700">{value}</div>
    <div className="text-xs text-gray-500 mt-1">{label}</div>
  </button>
);

const HomeTab: React.FC<{
  employeesCount: number;
  totalEmployees: number;
  shiftsCount: number;
  todayCount: number;
  todayDuty: Array<{ name: string; rank?: string; fileNumber?: string }>;
  recentShifts: Shift[];
  deptCounts: Array<[string, number]>;
  departmentsCount: number;
  workforceStats: { officers: number; ncos: number; professionals: number; civilians: number; active: number; inactive: number };
  licenseStats: { monthlyTotal: number; monthly: Array<{ type: string; count: number }>; total: number; totalByType: Array<{ type: string; count: number }> };
  assignmentsFor: (id: string) => ShiftAssignment[];
  employees: Employee[];
  shifts: Shift[];
  assignments: ShiftAssignment[];
  deptName: (v?: string) => string;
  onOpenEmployee?: (id: string) => void;
  onGo: (t: Tab) => void;
}> = ({ employeesCount, totalEmployees, shiftsCount, todayCount, todayDuty, recentShifts, deptCounts, departmentsCount, workforceStats, licenseStats, assignmentsFor, employees, shifts, assignments, deptName, onOpenEmployee, onGo }) => (
  <div className="space-y-4">
    <SmartSearch employees={employees} shifts={shifts} assignments={assignments} empById={new Map(employees.map((e) => [e.id, e]))} deptName={deptName} onOpenEmployee={onOpenEmployee} />

    {/* إحصائيات القوة - نفس إحصائيات النظام */}
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <h3 className="font-bold text-gray-700 mb-3">إحصائيات القوة</h3>
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'قيادات', value: workforceStats.officers, color: 'bg-blue-500' },
          { label: 'مشرفون', value: workforceStats.ncos, color: 'bg-indigo-500' },
          { label: 'فنيون', value: workforceStats.professionals, color: 'bg-emerald-500' },
          { label: 'إداريون', value: workforceStats.civilians, color: 'bg-amber-500' },
        ].map((c) => (
          <div key={c.label} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
            <div className={`w-3 h-10 rounded-full ${c.color}`}></div>
            <div>
              <div className="text-xl font-black text-gray-800">{c.value}</div>
              <div className="text-xs text-gray-500">{c.label}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <div className="flex-1 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
          <div className="text-lg font-black text-emerald-700">{workforceStats.active}</div>
          <div className="text-xs text-emerald-600">موظفون نشطون</div>
        </div>
        <div className="flex-1 bg-red-50 border border-red-200 rounded-xl p-3 text-center">
          <div className="text-lg font-black text-red-600">{workforceStats.inactive}</div>
          <div className="text-xs text-red-500">غير نشطين</div>
        </div>
      </div>
    </div>

    {/* إحصائيات الرخص والاستئذانات */}
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <h3 className="font-bold text-gray-700 mb-3">الرخص والاستئذانات - هذا الشهر</h3>
      <div className="grid grid-cols-4 gap-2 text-center">
        {licenseStats.monthly.map((l) => (
          <div key={l.type} className="bg-gray-50 rounded-xl p-2">
            <div className="text-lg font-black text-blue-700">{l.count}</div>
            <div className="text-[10px] text-gray-500 leading-tight">{l.type}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-500 mt-2 text-center">
        الإجمالي الكلي: {licenseStats.total}
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3">
      <StatCard label="مناوبات مسجلة" value={shiftsCount} onClick={() => onGo('shifts')} />
      <StatCard label="مناوبات اليوم" value={todayCount} onClick={() => onGo('shifts')} />
      <StatCard label="الإدارات" value={departmentsCount} />
      <StatCard label="إجمالي الموظفين" value={totalEmployees} onClick={() => onGo('employees')} />
    </div>

    {/* مناوبة اليوم */}
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <h3 className="font-bold text-gray-700 mb-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
        مناوبة اليوم ({todayDuty.length})
      </h3>
      {todayDuty.length === 0 ? (
        <div className="text-sm text-gray-400 text-center py-2">لا توجد مناوبات اليوم</div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {todayDuty.map((p, i) => (
            <div key={i} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
              <div>
                <div className="text-sm font-bold text-gray-800">{[p.rank, shortName(p.name)].filter(Boolean).join(' / ')}</div>
                <div className="text-xs text-gray-500">{p.fileNumber ? `ملف ${p.fileNumber}` : ''}</div>
              </div>
              <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">يوم</span>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* أحدث المناوبات */}
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <h3 className="font-bold text-gray-700 mb-3">أحدث المناوبات</h3>
      <div className="space-y-2">
        {recentShifts.map((s: any) => {
          const count = assignmentsFor(s.id).length;
          const isToday = String(s.shiftDate || s.date || '').startsWith(todayKey());
          return (
            <button key={s.id} onClick={() => onGo('shifts')} className="w-full flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2 text-right">
              <div>
                <div className="text-sm font-bold text-gray-800 flex items-center gap-2">
                  {formatDate(s.shiftDate || s.date)}
                  {isToday && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">اليوم</span>}
                </div>
                {s.note && <div className="text-xs text-gray-500 mt-0.5">{s.note}</div>}
              </div>
              <span className="text-xs font-bold text-blue-600">{count} موظف</span>
            </button>
          );
        })}
        {recentShifts.length === 0 && <div className="text-sm text-gray-400 text-center py-2">لا توجد مناوبات</div>}
      </div>
    </div>

    {/* توزيع الموظفين على الإدارات */}
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <h3 className="font-bold text-gray-700 mb-3">توزيع الموظفين على الإدارات</h3>
      <div className="space-y-2">
        {deptCounts.map(([name, count]) => {
          const pct = employeesCount ? Math.round((count / employeesCount) * 100) : 0;
          return (
            <div key={name}>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-gray-700">{name}</span>
                <span className="text-gray-500">{count} ({pct}%)</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>

    {totalEmployees > employeesCount && (
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
        يوجد {totalEmployees - employeesCount} موظف غير نشط
      </div>
    )}
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <h3 className="font-bold text-gray-700 mb-2">اختصارات</h3>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => onGo('employees')} className="bg-blue-50 text-blue-700 rounded-xl py-3 text-sm font-bold">
          بحث عن موظف
        </button>
        <button onClick={() => onGo('shifts')} className="bg-blue-50 text-blue-700 rounded-xl py-3 text-sm font-bold">
          كشف المناوبات
        </button>
      </div>
    </div>
  </div>
);

const EmployeesTab: React.FC<{
  employees: Employee[];
  total: number;
  query: string;
  setQuery: (v: string) => void;
  deptName: (v?: string) => string;
  shifts: Shift[];
  assignments: ShiftAssignment[];
  empById: Map<string, Employee>;
  focusEmpId: string | null;
  onFocusHandled: () => void;
}> = ({ employees, total, query, setQuery, deptName, shifts, assignments, empById, focusEmpId, onFocusHandled }) => {
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    if (focusEmpId) {
      setDetailId(focusEmpId);
      onFocusHandled();
    }
  }, [focusEmpId, onFocusHandled]);

  const shiftById = useMemo(() => {
    const m = new Map<string, any>();
    shifts.forEach((s: any) => m.set(s.id, s));
    return m;
  }, [shifts]);

  const dutiesOf = (empId: string) =>
    assignments
      .filter((a) => a.employeeId === empId)
      .map((a) => ({ a, s: shiftById.get(a.shiftId) }))
      .filter((x) => x.s)
      .sort((x, y) => String(y.s.shiftDate || y.s.date || '').localeCompare(String(x.s.shiftDate || x.s.date || '')))
      .slice(0, 10);

  const detail = detailId ? empById.get(detailId) || employees.find((e) => e.id === detailId) : null;
  const duties = detailId ? dutiesOf(detailId) : [];

  return (
    <div className="space-y-3">
      <div className="relative">
        <MagnifyingGlassIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث بالاسم أو الرقم أو المسمى الوظيفي..."
          className="w-full bg-white border border-gray-200 rounded-xl pr-10 pl-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="text-xs text-gray-500 px-1">{employees.length} من {total} موظف - اضغط على موظف لعرض ملفه</div>
      <div className="space-y-2">
        {employees.map((e) => (
          <button key={e.id} onClick={() => setDetailId(e.id)} className="w-full text-right bg-white rounded-xl shadow-sm border border-gray-100 p-3 active:bg-blue-50/50 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-gray-800 text-sm truncate">{rankSlashName(e)}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {[e.jobTitle, e.department].filter(Boolean).join(' • ')}
                </div>
              </div>
              {e.status === 'inactive' && (
                <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold shrink-0">غير نشط</span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
              {e.fileNumber && <span>ملف: {e.fileNumber}</span>}
              {e.civilId && <span>مدني: {e.civilId}</span>}
              {e.phone_number && <span dir="ltr">{e.phone_number}</span>}
            </div>
            <div className="text-xs text-blue-600 mt-1.5 font-medium">{deptName(e.department)} ←</div>
          </button>
        ))}
        {employees.length === 0 && (
          <div className="text-center text-gray-400 py-10 text-sm">لا توجد نتائج</div>
        )}
      </div>

      {/* ملف الموظف - مودال */}
      {detail && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center" dir="rtl" onClick={() => setDetailId(null)}>
          <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="font-black text-gray-800 text-lg">{rankSlashName(detail)}</div>
                <div className="text-xs text-gray-500 mt-0.5">{[detail.jobTitle, detail.category].filter(Boolean).join(' • ')}</div>
              </div>
              <button onClick={() => setDetailId(null)} className="text-gray-400 text-xl leading-none px-1">✕</button>
            </div>

            <div className="bg-gray-50 rounded-xl divide-y divide-gray-100 text-sm">
              {[
                ['المسمى الوظيفي', detail.rank],
                ['المسمى الوظيفي', detail.jobTitle],
                ['الفئة', detail.category],
                ['رقم الملف', detail.fileNumber],
                ['الرقم المدني', detail.civilId],
                ['الإدارة', deptName(detail.department)],
                ['القسم', detail.section],
                ['الجنسية', (detail as any).nationality],
              ].filter(([, v]) => v).map(([label, value]) => (
                <div key={label as string} className="flex justify-between px-3 py-2.5">
                  <span className="text-gray-500 text-xs">{label}</span>
                  <span className="font-bold text-gray-800 text-xs text-left">{value}</span>
                </div>
              ))}
              {detail.phone_number && (
                <div className="flex justify-between items-center px-3 py-2.5">
                  <span className="text-gray-500 text-xs">رقم الهاتف</span>
                  <a href={`tel:${detail.phone_number}`} className="font-bold text-blue-600 text-sm" dir="ltr">{detail.phone_number}</a>
                </div>
              )}
              <div className="flex justify-between px-3 py-2.5">
                <span className="text-gray-500 text-xs">الحالة</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${detail.status === 'inactive' ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'}`}>
                  {detail.status === 'inactive' ? 'غير نشط' : 'نشط'}
                </span>
              </div>
            </div>

            {/* مناوباته */}
            <div className="mt-4">
              <div className="text-xs font-bold text-gray-500 mb-1.5">المناوبات الأخيرة ({duties.length})</div>
              {duties.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-3">لا توجد مناوبات مسجلة</div>
              ) : (
                <div className="space-y-1.5">
                  {duties.map(({ a, s }: any) => {
                    const d = String(s.shiftDate || s.date || '');
                    const isToday = d.startsWith(todayKey());
                    return (
                      <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                        <div className="text-xs">
                          <span className="font-bold text-gray-700">{formatDate(d)}</span>
                          {isToday && <span className="mr-1 text-[9px] bg-emerald-100 text-emerald-700 px-1 rounded">اليوم</span>}
                          {s.note && <span className="text-gray-400"> - {s.note}</span>}
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          String(s.shiftDate || s.date || '') > todayKey() ? 'bg-blue-100 text-blue-700' : a.status === 'attended' ? 'bg-emerald-100 text-emerald-700' : a.status === 'absent' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {String(s.shiftDate || s.date || '') > todayKey() ? 'مجدول' : a.status === 'attended' ? 'حضر' : a.status === 'absent' ? 'غائب' : 'لم يسجل'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ShiftsTab: React.FC<{
  shifts: Shift[];
  query: string;
  setQuery: (v: string) => void;
  assignmentsFor: (id: string) => ShiftAssignment[];
  empById: Map<string, Employee>;
  employees: Employee[];
  openShiftId: string | null;
  setOpenShiftId: (id: string | null) => void;
  onChanged: () => void;
  deptName: (v?: string) => string;
}> = ({ shifts, query, setQuery, assignmentsFor, empById, employees, openShiftId, setOpenShiftId, onChanged, deptName }) => {
  const [registerOpen, setRegisterOpen] = useState(false);
  const [shiftFilter, setShiftFilter] = useState<'all' | 'today' | 'upcoming' | 'past'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'cal'>('list');
  const [calCursor, setCalCursor] = useState(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); });
  const [calDate, setCalDate] = useState<string | null>(null);
  const [regDate, setRegDate] = useState(todayKey());
  const [regNote, setRegNote] = useState('');
  const [regQuery, setRegQuery] = useState('');
  const [regSelected, setRegSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleEmp = (id: string) => {
    setRegSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filteredRegEmployees = useMemo(() => {
    const q = norm(regQuery);
    if (!q) return employees;
    return employees.filter((e) =>
      [e.name, e.rank, e.fileNumber, e.department].filter(Boolean).some((v) => norm(String(v)).includes(q))
    );
  }, [employees, regQuery]);

  const submitShift = async () => {
    if (!regDate || regSelected.size === 0) {
      setError('اختر التاريخ وموظفاً واحداً على الأقل');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await createShift({
        shiftDate: regDate,
        createdBy: 'mobile',
        note: regNote || undefined,
        assignments: [...regSelected].map((employeeId) => ({ employeeId, status: 'scheduled' })),
      });
      setRegisterOpen(false);
      setRegSelected(new Set());
      setRegNote('');
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'فشل تسجيل المناوبة');
    } finally {
      setSaving(false);
    }
  };

  const markAbsent = async (assignmentId: string) => {
    try {
      await recordAbsence(assignmentId, 'غائب - من الهاتف');
      onChanged();
    } catch {}
  };

  // Smart filtering + month grouping
  const filteredShifts = useMemo(() => {
    const today = todayKey();
    return shifts.filter((s: any) => {
      const d = String(s.shiftDate || s.date || '');
      if (shiftFilter === 'today') return d.startsWith(today);
      if (shiftFilter === 'upcoming') return d >= today;
      if (shiftFilter === 'past') return d < today;
      if (shiftFilter === 'all' && query === '') return true;
      return true;
    });
  }, [shifts, shiftFilter, query, calDate]);

  const groupedShifts = useMemo(() => {
    const groups = new Map<string, any[]>();
    filteredShifts.forEach((s: any) => {
      const d = new Date(s.shiftDate || s.date || 0);
      const key = isNaN(d.getTime()) ? 'بدون تاريخ' : d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' });
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    });
    return [...groups.entries()];
  }, [filteredShifts]);

  const monthStats = useMemo(() => {
    const monthPrefix = todayKey().slice(0, 7);
    const monthShifts = shifts.filter((s: any) => { const d = String(s.shiftDate || s.date || ''); return d.startsWith(monthPrefix) && d <= todayKey(); });
    let attended = 0, absent = 0;
    monthShifts.forEach((s: any) => {
      assignmentsFor(s.id).forEach((a) => {
        if (a.status === 'attended') attended++;
        else if (a.status === 'absent') absent++;
      });
    });
    return { count: monthShifts.length, attended, absent };
  }, [shifts, assignmentsFor]);

  return (
    <div className="space-y-3">
      <button
        onClick={() => setRegisterOpen(true)}
        className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl shadow-sm active:scale-[0.98] transition-transform"
      >
        + تسجيل مناوبة جديدة
      </button>

      {/* تبديل العرض */}
      <div className="flex gap-2">
        {([['list','القائمة'],['cal','التقويم']] as const).map(([m,l]) => (
          <button key={m} onClick={() => { setViewMode(m); if(m==='list') setCalDate(null); }}
            className={'flex-1 py-2 rounded-xl text-xs font-bold transition-colors ' + (viewMode===m?'bg-blue-600 text-white':'bg-white text-gray-600 border border-gray-200')}>{l}</button>
        ))}
      </div>

      {viewMode === 'cal' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3">
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => { const [y,m]=calCursor.split('-').map(Number); const d=new Date(y,m-2,1); setCalCursor(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')); }} className="p-1.5 text-gray-500">›</button>
            <div className="text-sm font-black text-gray-700">{new Date(calCursor+'-02').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn',{month:'long',year:'numeric'})}</div>
            <button onClick={() => { const [y,m]=calCursor.split('-').map(Number); const d=new Date(y,m,1); setCalCursor(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')); }} className="p-1.5 text-gray-500">‹</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-gray-400 mb-1">
            {['أحد','إثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'].map(d=><div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {(() => {
              const [y,m]=calCursor.split('-').map(Number);
              const first=new Date(y,m-1,1); const startDay=(first.getDay()+1)%7;
              const days=new Date(y,m,0).getDate();
              const shiftDays=new Map<string,number>();
              shifts.forEach((s:any)=>{ const d=String(s.shiftDate||s.date||''); if(d.startsWith(calCursor)) shiftDays.set(d,(shiftDays.get(d)||0)+1); });
              const cells=[];
              for(let i=0;i<startDay;i++) cells.push(<div key={'e'+i}/>);
              for(let d=1;d<=days;d++){
                const key=calCursor+'-'+String(d).padStart(2,'0');
                const cnt=shiftDays.get(key)||0;
                const sel=calDate===key;
                cells.push(<button key={key} onClick={()=>setCalDate(sel?null:key)}
                  className={'relative rounded-lg py-1.5 text-xs font-bold transition-colors ' + (sel?'bg-blue-600 text-white':cnt?'bg-blue-50 text-blue-700':'text-gray-400')}>
                  {d}{cnt>0&&<span className={'absolute -top-1 -left-1 w-4 h-4 rounded-full text-[8px] flex items-center justify-center font-black ' + (sel?'bg-white text-blue-600':'bg-blue-600 text-white')}>{cnt}</span>}
                </button>);
              }
              return cells;
            })()}
          </div>
          {calDate && <button onClick={()=>setCalDate(null)} className="mt-2 w-full text-xs font-bold text-blue-600 bg-blue-50 rounded-lg py-2">عرض الكل - إلغاء تحديد اليوم</button>}
        </div>
      )}



      <div className="relative">
        <MagnifyingGlassIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث بتاريخ أو اسم موظف..."
          className="w-full bg-white border border-gray-200 rounded-xl pr-10 pl-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* فلاتر سريعة */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {([
          { id: 'all', label: 'الكل' },
          { id: 'today', label: 'اليوم' },
          { id: 'upcoming', label: 'القادمة' },
          { id: 'past', label: 'السابقة' },
        ] as const).map((f) => (
          <button
            key={f.id}
            onClick={() => setShiftFilter(f.id)}
            className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
              shiftFilter === f.id ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ملخص الشهر */}
      <div className="bg-gradient-to-l from-blue-600 to-blue-500 text-white rounded-2xl p-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-blue-100">مناوبات هذا الشهر</div>
          <div className="text-2xl font-black">{monthStats.count}</div>
        </div>
        <div className="text-left">
          <div className="text-xs text-blue-100">حضور / غياب</div>
          <div className="text-sm font-bold">
            <span className="text-emerald-200">{monthStats.attended}</span>
            {' / '}
            <span className="text-red-200">{monthStats.absent}</span>
          </div>
        </div>
      </div>

      {viewMode === 'list' && (
      <div className="space-y-4">
        {groupedShifts.map(([monthLabel, monthShifts]) => (
          <div key={monthLabel}>
            <div className="text-xs font-bold text-gray-500 mb-2 px-1 sticky top-0 bg-gray-100 py-1">{monthLabel}</div>
            <div className="space-y-2">
        {monthShifts.map((s: any) => {
          const assigns = assignmentsFor(s.id);
          const open = openShiftId === s.id;
          const dateStr = s.shiftDate || s.date || '';
          const dObj = new Date(dateStr);
          const isToday = dateStr.startsWith(todayKey());
          const isPast = dateStr < todayKey();
          const isFut = dateStr > todayKey();
          const attended = isFut ? 0 : assigns.filter((a) => a.status === 'attended').length;
          const absent = isFut ? 0 : assigns.filter((a) => a.status === 'absent').length;
          const dayNum = isNaN(dObj.getTime()) ? '-' : dObj.getDate();
          const weekday = isNaN(dObj.getTime()) ? '' : dObj.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'short' });
          return (
            <div key={s.id} className={`bg-white rounded-2xl shadow-sm border overflow-hidden ${isToday ? 'border-emerald-300 ring-1 ring-emerald-200' : 'border-gray-100'}`}>
              {/* صف المناوبة - سطر واحد */}
              <button
                onClick={() => setOpenShiftId(open ? null : s.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-right active:bg-gray-50"
              >
                {/* كتلة التاريخ */}
                <div className={`flex flex-col items-center justify-center w-12 h-12 rounded-xl shrink-0 ${isToday ? 'bg-emerald-500' : isPast ? 'bg-gray-200' : 'bg-blue-600'}`}>
                  <span className={`text-lg font-black leading-none ${isToday || !isPast ? 'text-white' : 'text-gray-600'}`}>{dayNum}</span>
                  <span className={`text-[9px] font-bold ${isToday || !isPast ? 'text-blue-100' : 'text-gray-500'}`}>{weekday}</span>
                </div>
                {/* معلومات */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-800 text-sm">{formatDate(dateStr)}</span>
                    {isToday && <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">اليوم</span>}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                    <span>{assigns.length} مناوب</span>
                    {attended > 0 && <span className="text-emerald-600 font-bold">حضر {attended}</span>}
                    {absent > 0 && <span className="text-red-500 font-bold">غائب {absent}</span>}
                  </div>
                </div>
                <ChevronLeftIcon className={`h-5 w-5 text-gray-300 shrink-0 transition-transform ${open ? '-rotate-90' : ''}`} />
              </button>

              {/* قائمة المناوبين التفصيلية */}
              {open && (
                <div className="border-t border-gray-100">
                  {assigns.length === 0 && (
                    <div className="p-4 text-xs text-gray-400 text-center">لا يوجد مناوبون مسجلون</div>
                  )}
                  {assigns.map((a, idx) => {
                    const emp = empById.get(a.employeeId);
                    const isFutRow = dateStr > todayKey();
                    const isAbsent = !isFutRow && a.status === 'absent';
                    const isAttended = !isFutRow && a.status === 'attended';
                    return (
                      <div key={a.id} className={`px-4 py-3 ${idx < assigns.length - 1 ? 'border-b border-gray-50' : ''} ${isAbsent ? 'bg-red-50/50' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-gray-800">{emp ? rankSlashName(emp) : 'موظف محذوف'}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                                isFutRow ? 'bg-blue-100 text-blue-700' : isAttended ? 'bg-emerald-100 text-emerald-700' : isAbsent ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                              }`}>
                                {isFutRow ? 'مجدول' : isAttended ? 'حضر' : isAbsent ? 'غائب' : 'لم يسجل'}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                              {emp?.jobTitle && <div>{emp.jobTitle}</div>}
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                                {emp?.fileNumber && <span>ملف: {emp.fileNumber}</span>}
                                {emp?.civilId && <span>مدني: {emp.civilId}</span>}
                                {emp?.phone_number && (
                                  <a href={`tel:${emp.phone_number}`} className="text-blue-600 font-bold" dir="ltr">
                                    {emp.phone_number}
                                  </a>
                                )}
                                {emp?.department && <span className="text-blue-500">{deptName(emp.department)}</span>}
                              </div>
                            </div>
                          </div>
                          {!isAbsent && !isAttended && (
                            <button
                              onClick={() => markAbsent(a.id)}
                              className="text-[10px] bg-red-50 text-red-600 border border-red-200 px-2.5 py-1 rounded-lg font-bold shrink-0 active:bg-red-100"
                            >
                              تسجيل غياب
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
            </div>
          </div>
        ))}
        {filteredShifts.length === 0 && (
          <div className="text-center text-gray-400 py-10 text-sm">لا توجد مناوبات</div>
        )}
      </div>
      )}

      {/* تسجيل مناوبة - نموذج */}
      {registerOpen && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center" dir="rtl">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="font-bold text-gray-800">تسجيل مناوبة جديدة</h3>
              <button onClick={() => setRegisterOpen(false)} className="text-gray-400 text-xl leading-none">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">تاريخ المناوبة</label>
                <input type="date" value={regDate} onChange={(e) => setRegDate(e.target.value)} className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm" dir="ltr" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">ملاحظة (اختياري)</label>
                <input value={regNote} onChange={(e) => setRegNote(e.target.value)} placeholder="مثال: مناوبة أسبوعية" className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">الموظفون ({regSelected.size} محدد)</label>
                <input value={regQuery} onChange={(e) => setRegQuery(e.target.value)} placeholder="ابحث بالاسم أو المسمى الوظيفي..." className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm mb-2" />
                <div className="border border-gray-200 rounded-xl max-h-72 overflow-y-auto divide-y divide-gray-50">
                  {filteredRegEmployees.map((e) => (
                    <button key={e.id} onClick={() => toggleEmp(e.id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-right active:bg-blue-50">
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${regSelected.has(e.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
                        {regSelected.has(e.id) && <span className="text-white text-xs">✓</span>}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{rankSlashName(e)}</div>
                        <div className="text-xs text-gray-500">{e.department ? `• ${deptName(e.department)}` : ''}</div>
                      </div>
                    </button>
                  ))}
                  {filteredRegEmployees.length === 0 && <div className="p-4 text-center text-gray-400 text-sm">لا نتائج</div>}
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200">
              <button
                onClick={submitShift}
                disabled={saving}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
              >
                {saving ? 'جارٍ الحفظ...' : `حفظ المناوبة (${regSelected.size} موظف)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileApp;
