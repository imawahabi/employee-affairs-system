import React from 'react';
import logo from '../assets/logo.png';
import { fetchProfessionalExtensionStatus, fetchShifts, fetchShiftDayExceptions } from '../api';
import { ProfessionalExtensionStatusResponse, Shift } from '../types';
import { useSystem } from '../contexts/SystemContext';
import { APP_SOFT_REFRESH_EVENT } from '../constants/events';
import {
  LayoutDashboard,
  UsersRound,
  CalendarClock,
  ListChecks,
  ClipboardList,
  CalendarPlus,
  ListOrdered,
  LineChart,
  BellRing,
  SlidersHorizontal,
  Network,
  BadgeCheck,
  Flag,
  Briefcase,
  ParkingCircle,
  Database,
  FileText,
  FilePlus,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';

interface NavigationItem {
  id: string;
  name: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  category?: 'home' | 'overview' | 'shifts' | 'licenses' | 'system';
  children?: NavigationItem[];
}

const otherSettingsChildren: NavigationItem[] = [
  { id: 'settings-departments', name: 'الإدارات والأقسام', icon: Network },
  { id: 'settings-ranks', name: 'المسميات الوظيفية', icon: BadgeCheck },
  { id: 'settings-job-titles', name: 'المسميات والمناصب', icon: Briefcase },
  { id: 'settings-nationalities', name: 'الجنسيات', icon: Flag },
];

const settingsOtherChildIds = new Set(otherSettingsChildren.map((item) => item.id));

const navigation: NavigationItem[] = [
  { id: 'dashboard', name: 'اللوحة الرئيسية', icon: LayoutDashboard, category: 'home' },
  { id: 'employees', name: 'إدارة الموظفين', icon: UsersRound, category: 'overview' },
  { id: 'employee-reports', name: 'تقارير مخصصة ', icon: FileText, category: 'overview' },
  { id: 'parking-map', name: 'مواقف الموظفين', icon: ParkingCircle, category: 'overview' },
  { id: 'professional-extensions', name: 'تمديدات الفنيين', icon: CalendarClock, category: 'overview' },
  { id: 'view-shifts', name: 'كشف المناوبات', icon: ListChecks, category: 'shifts' },
  { id: 'shifts', name: 'تسجيل مناوبة جديدة', icon: CalendarPlus, category: 'shifts' },
  { id: 'next-queue', name: 'أولوية المناوبات', icon: ListOrdered, category: 'shifts' },
  { id: 'employee-shift-history', name: 'سجلات المناوبات', icon: ClipboardList, category: 'shifts' },
  { id: 'reports', name: 'التقارير والإحصائيات', icon: LineChart, category: 'shifts' },
  { id: 'licenses-list', name: 'سجلات رخص واستئذانات', icon: FileText, category: 'licenses' },
  { id: 'licenses-add', name: 'تسجيل رخصة/استئذان', icon: FilePlus, category: 'licenses' },
  { id: 'licenses-report-new', name: 'إنشاء تقرير جديد', icon: FilePlus, category: 'licenses' },
  { id: 'licenses-reports', name: 'التقارير الشاملة', icon: BarChart3, category: 'licenses' },
  { id: 'settings-other', name: 'إدارة البيانات', icon: Database, category: 'system', children: otherSettingsChildren },
  { id: 'settings', name: 'الإعدادات العامة', icon: SlidersHorizontal, category: 'system' },
  { id: 'audit-log', name: 'سجل التغييرات', icon: FileText, category: 'system' },
  { id: 'alerts', name: 'التنبيهات', icon: BellRing, category: 'system' },
];

const categoryLabels = {
  overview: 'نظام شؤون الموظفين',
  licenses: 'نظام الرخص والاستئذانات',
  shifts: 'نظام المناوبات',
  system: 'إعدادات النظام'
};

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  currentPage: string;
  onPageChange: (page: string) => void;
}

export default function Sidebar({ isCollapsed, onToggle, currentPage, onPageChange }: SidebarProps) {
  const { systemName, departmentName, companyName, hideShifts, hideLicenses, hideParking, hideProfessionalExtensions } = useSystem();
  const [isOtherSettingsOpen, setIsOtherSettingsOpen] = React.useState(settingsOtherChildIds.has(currentPage));
  const [isNavScrolled, setIsNavScrolled] = React.useState(false);
  const [extensionDelayCount, setExtensionDelayCount] = React.useState(0);
  const [shiftDelayActive, setShiftDelayActive] = React.useState(false);
  const navRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (settingsOtherChildIds.has(currentPage)) {
      setIsOtherSettingsOpen(true);
    }
  }, [currentPage]);

  React.useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    setIsNavScrolled(nav.scrollTop > 0);
  }, []);

  const loadExtensionDelayCount = React.useCallback(async () => {
    try {
      const status = await fetchProfessionalExtensionStatus();
      const data = status as ProfessionalExtensionStatusResponse;
      setExtensionDelayCount(data?.notExtended?.length || 0);
    } catch (error) {
      console.error('Failed to load extension delay status:', error);
      setExtensionDelayCount(0);
    }
  }, []);

  const getShiftDateKey = (shift: Shift | any) => {
    const raw = shift?.shiftDate || shift?.shift_date || shift?.date || '';
    const match = String(raw).match(/\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getTodayKey = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const loadShiftDelayStatus = React.useCallback(async () => {
    if (hideShifts) {
      setShiftDelayActive(false);
      return;
    }
    try {
      const [shiftsResponse, exceptionsResponse] = await Promise.all([
        fetchShifts(),
        fetchShiftDayExceptions()
      ]);
      const shifts = Array.isArray((shiftsResponse as { data?: Shift[] }).data)
        ? (shiftsResponse as { data: Shift[] }).data
        : (shiftsResponse as Shift[]);
      const exceptions = Array.isArray(exceptionsResponse) ? exceptionsResponse : [];
      const shiftDateKeys = shifts.map(getShiftDateKey).filter(Boolean);
      const exceptionDateKeys = exceptions.map((day: any) => getShiftDateKey(day)).filter(Boolean);
      const plannedDates = [...shiftDateKeys, ...exceptionDateKeys].sort();

      if (!plannedDates.length) {
        // لا توجد مناوبات أو أيام استثنائية => تعتبر حالة تأخير/نقص في الجدولة
        setShiftDelayActive(true);
        return;
      }

      const latestDate = plannedDates[plannedDates.length - 1];
      const todayKey = getTodayKey();
      // إذا لم يوجد أي مناوبة/استثناء بعد تاريخ اليوم الحالي نُفعّل تحذير التأخير
      const hasUpcomingShift = latestDate > todayKey;
      setShiftDelayActive(!hasUpcomingShift);
    } catch (error) {
      console.error('Failed to load shifts for delay badge:', error);
      setShiftDelayActive(false);
    }
  }, [hideShifts]);

  React.useEffect(() => {
    loadExtensionDelayCount();
    const handleFocus = () => loadExtensionDelayCount();
    window.addEventListener('focus', handleFocus);
    const intervalId = window.setInterval(loadExtensionDelayCount, 5 * 60 * 1000);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.clearInterval(intervalId);
    };
  }, [loadExtensionDelayCount]);

  React.useEffect(() => {
    loadShiftDelayStatus();
    if (hideShifts) return;
    const handleFocus = () => loadShiftDelayStatus();
    window.addEventListener('focus', handleFocus);
    const intervalId = window.setInterval(loadShiftDelayStatus, 5 * 60 * 1000);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.clearInterval(intervalId);
    };
  }, [loadShiftDelayStatus, hideShifts]);

  React.useEffect(() => {
    const handleAppRefresh = () => {
      void loadExtensionDelayCount();
      void loadShiftDelayStatus();
    };

    window.addEventListener(APP_SOFT_REFRESH_EVENT, handleAppRefresh as EventListener);
    return () => {
      window.removeEventListener(APP_SOFT_REFRESH_EVENT, handleAppRefresh as EventListener);
    };
  }, [loadExtensionDelayCount, loadShiftDelayStatus]);

  const visibleNavigation = navigation.filter((item) => {
    if (hideShifts && item.category === 'shifts') return false;
    if (hideLicenses && item.category === 'licenses') return false;
    if (hideParking && item.id === 'parking-map') return false;
    if (hideProfessionalExtensions && item.id === 'professional-extensions') return false;
    return true;
  });

  const groupedNavigation = visibleNavigation.reduce((acc, item) => {
    const category = item.category || 'main';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, NavigationItem[]>);

  return (
    <div
      dir="rtl"
      className={`flex h-screen flex-col bg-gradient-to-b from-white via-white to-slate-50 border-l border-gray-200 shadow-xl transition-all duration-300 fixed right-0 top-0 z-50 ${isCollapsed ? 'w-24' : 'w-64'}`}>
      {/* Header Section */}
      <div className={`relative ${isCollapsed ? 'h-20' : 'h-48'} bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 border-b border-blue-800 shadow-xl`}>
        <div className="h-full flex flex-col items-center justify-center p-4">
          {!isCollapsed ? (
            <>
              {/* Logo */}
              <div
                className="p-3 glass rounded-3xl bg-gradient-to-br from-blue-200/80 to-blue-400/80 border-b border-white/50 shadow-md shadow-blue-700 hover:shadow-lg transition-all duration-200 backdrop-blur-md font-white/100"
                style={{ WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)' }}
              >
                <img
                  src={logo}
                  alt="Entity Logo"
                  className=" blur-[0px] w-16 h-16 object-contain  blur-[0px]"
                />
              </div>
              {/* System Info */}
              <div className="text-center space-y-1 mt-2">
                <h1 className="text-lg font-bold text-white drop-shadow-md">
                  {systemName}
                </h1>
                <p className="text-blue-100 text-xs font-medium drop-shadow">
                  {departmentName}
                </p>
                <p className="text-blue-200 text-xs drop-shadow">
                  {companyName}
                </p>
              </div>
            </>
          ) : (
            <div className="w-18 h-18 rounded-full px-1 py-1 flex items-center justify-center">
              <img
                src={logo}
                alt="Entity Logo"
                className="w-12 h-12 object-contain"
              />
            </div>
          )}
        </div>
      </div>

      {/* Navigation Section */}
      <nav
        ref={navRef}
        onScroll={(event) => {
          const target = event.currentTarget;
          const scrolled = target.scrollTop > 0;
          setIsNavScrolled((prev) => (prev === scrolled ? prev : scrolled));
        }}
        className="flex-1 overflow-y-auto py-4 relative"
      >
        <div
          className={`pointer-events-none absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-slate-900/15 via-slate-900/5 to-transparent transition-opacity z-20 ${isNavScrolled ? 'opacity-100' : 'opacity-0'
            }`}
        />
        <div className="px-3 space-y-4 relative z-0">
          {Object.entries(groupedNavigation).map(([category, items]) => {
            const categoryLabel = (categoryLabels as Record<string, string | undefined>)[category];
            return (
              <div className="mt-3" key={category}>
                {!isCollapsed && categoryLabel && (
                  <div className="mb-3 px-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-500 tracking-wide bg-slate-100 px-4 py-1 rounded-full">
                        {categoryLabel}
                      </span>
                      <span className="flex-1 h-px bg-slate-200"></span>
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  {items.map((item) => {
                    if (item.children && item.children.length > 0) {
                      const isChildActive = item.children.some((child) => child.id === currentPage);
                      const isExpanded = item.id === 'settings-other' ? isOtherSettingsOpen : false;
                      return (
                        <div key={item.id} className="space-y-1">
                          <button
                            onClick={() => {
                              if (isCollapsed) {
                                onPageChange('settings');
                                return;
                              }
                              if (item.id === 'settings-other') {
                                setIsOtherSettingsOpen((prev) => !prev);
                              }
                            }}
                            className={`
                            w-full group flex items-center justify-between rounded-xl transition-all duration-200 relative border border-transparent
                            ${isCollapsed ? 'px-3 py-3 mx-1' : 'px-4 py-3'}
                            ${isChildActive
                                ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm'
                                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 hover:shadow-sm'
                              }
                          `}
                            title={isCollapsed ? item.name : undefined}
                          >
                            <div className="flex items-center space-x-3 space-x-reverse">
                              <item.icon
                                className={`
                                ${isCollapsed ? 'h-4 w-4 ' : 'h-5 w-5'} transition-colors duration-200
                                ${isChildActive ? 'text-blue-600' : 'text-gray-500 group-hover:text-blue-600'}
                              `}
                                strokeWidth={2}
                              />
                              {!isCollapsed && <span className="text-sm">{item.name}</span>}
                            </div>
                            {!isCollapsed && (
                              <ChevronDown
                                className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180 text-blue-600' : 'text-gray-400 group-hover:text-gray-600'}`}
                              />
                            )}
                            {isChildActive && (
                              <>
                                <span className={`absolute ${isCollapsed ? 'right-0.5' : 'right-1'} top-1/2 -translate-y-1/2 ${isCollapsed ? 'h-5 w-1' : 'h-6 w-1.5'} rounded-full bg-blue-600`}></span>
                                <div className="absolute right-0 top-0 w-full h-full rounded-md bg-blue-500/10 backdrop-blur-sm animate-pulse z-[-1]"></div>
                              </>
                            )}
                          </button>
                          {!isCollapsed && isExpanded && (
                            <div className="mr-4 space-y-1">
                              {item.children.map((child) => {
                                const isChildItemActive = currentPage === child.id;
                                return (
                                  <button
                                    key={child.id}
                                    onClick={() => onPageChange(child.id)}
                                    className={`w-full group flex items-center justify-between rounded-xl transition-all duration-200 relative px-4 py-2.5 border border-transparent ${isChildItemActive
                                        ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm'
                                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                      }`}
                                  >
                                    <div className="flex items-center space-x-3 space-x-reverse">
                                      <child.icon
                                        className={`h-4 w-4 transition-colors duration-200 ${isChildItemActive ? 'text-blue-600' : 'text-gray-500 group-hover:text-blue-600'}`}
                                        strokeWidth={2}
                                      />
                                      <span className="text-sm">{child.name}</span>
                                    </div>
                                    {isChildItemActive && (
                                      <>
                                        <div className="absolute right-0 top-0 w-full h-full rounded-md bg-blue-500/10 backdrop-blur-sm z-[-1]"></div>
                                      </>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    }

                    const isActive = currentPage === item.id;
                    const showExtensionBadge = item.id === 'professional-extensions' && extensionDelayCount > 0;
                    const showShiftDelayBadge = item.id === 'view-shifts' && shiftDelayActive;
                    return (
                      <button
                        key={item.id}
                        onClick={() => onPageChange(item.id)}
                        className={`
                        w-full group flex items-center justify-between rounded-xl transition-all duration-200 relative border
                        ${isCollapsed ? 'px-3 py-3 mx-1' : 'px-4 py-3'}
                        ${isActive
                            ? 'bg-blue-50 text-blue-700 border-blue-100 shadow-md shadow-blue-100/50 font-bold transition-all'
                            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 border-transparent'
                          }
                      `}
                        title={isCollapsed ? item.name : undefined}
                      >
                        <div className="flex items-center space-x-3 space-x-reverse">
                          <item.icon
                            className={`
                            ${isCollapsed ? 'h-5 w-5' : 'h-5 w-5'} transition-colors duration-200
                            ${isActive ? 'text-blue-600' : 'text-gray-500 group-hover:text-blue-600'}
                          `}
                            strokeWidth={2}
                          />
                          {!isCollapsed && (
                            <span className="text-sm">
                              {item.name}
                            </span>
                          )}
                        </div>
                        {showExtensionBadge && (
                          isCollapsed ? (
                            <span className="absolute left-2 top-2 h-2 w-2 rounded-full bg-red-500" title="تأخيرات التمديد"></span>
                          ) : (
                            <span className="inline-flex min-w-[24px] items-center justify-center rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">
                              {extensionDelayCount}
                            </span>
                          )
                        )}
                        {showShiftDelayBadge && (
                          isCollapsed ? (
                            <span className="absolute left-2 bottom-2 h-2 w-2 rounded-full bg-red-500" title="تأخير المناوبات"></span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">
                              تنبيه
                            </span>
                          )
                        )}
                        {isActive && (
                          <>
                            <div className="absolute right-0 top-0 w-full h-full rounded-md bg-blue-500/10 backdrop-blur-sm animate-pulse z-[-1]"></div>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </nav>
      {/* Footer Section - Toggle Button from Licenses System Design */}
      <div className="mt-auto border-t border-gray-100 bg-white/50 backdrop-blur-sm p-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05),0_-2px_4px_-1px_rgba(0,0,0,0.03)]">
        <button
          onClick={onToggle}
          className="w-full group relative transition-all duration-500 ease-out"
          aria-label={isCollapsed ? 'فتح القائمة' : 'إغلاق القائمة'}
          title={isCollapsed ? 'فتح القائمة' : 'إغلاق القائمة'}
        >
          <div className="relative">
            {/* Animated Glow */}
            <div className="absolute -inset-2 bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-400 rounded-full opacity-0 group-hover:opacity-40 blur-lg transition-all duration-500"></div>

            {/* Main Button */}
            <div
              className="relative w-full h-10 rounded-lg bg-gradient-to-r from-blue-600 to-blue-800 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 flex items-center justify-center border border-blue-500/50 group-hover:-translate-y-0.5"
              style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}
            >
              {/* Inner Light */}
              <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-white/20 to-transparent"></div>

              {/* Icon and Text Container */}
              <div className="relative flex items-center justify-center gap-2 text-white">
                {isCollapsed ? (
                  <>
                    <ChevronLeft className="h-5 w-5 transition-all duration-300 group-hover:scale-125" />
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-5 w-5 transition-all duration-300 group-hover:scale-125" />
                    <span className="text-sm font-base">إغلاق القائمة</span>
                  </>
                )}
              </div>

              {/* Shimmer */}
              <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
