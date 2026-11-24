import React, { useEffect, useMemo, useState } from 'react';
import { Car, Trash2, ParkingSquare, RefreshCw, Search, LogIn, LogOut, ArrowUpDown } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { fetchEmployees, updateEmployee } from '../api';
import { Employee } from '../types';
import LoadingPage from './LoadingPage';
import Modal from './UI/Modal';
import ConfirmDeleteModal from './ConfirmDeleteModal';

type ParkingSlot = {
  key: string;
  label: string;
  employee?: Employee;
};

type ParkingZoneData = {
  slots: ParkingSlot[];
  extras: Employee[];
};

type ParkingGateConfig = {
  id: string;
  kind: 'entry' | 'exit' | 'elevator';
  label: string;
  subtitle?: string;
  position?: 'top' | 'between' | 'bottom';
  afterRow?: number;
  align?: 'start' | 'center' | 'end';
};

type ParkingSitePoint = {
  x: number;
  y: number;
};

type ParkingSiteSpotConfig = {
  id: string;
  index: number;
  x: number;
  y: number;
};

type ParkingSiteCanopyConfig = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
};

type ParkingSitePathConfig = {
  id: string;
  points: ParkingSitePoint[];
  color: string;
  label?: string;
  labelPosition?: ParkingSitePoint;
};

type ParkingSiteGateConfig = {
  id: string;
  kind: 'entry' | 'exit' | 'elevator';
  label: string;
  subtitle?: string;
  x: number;
  y: number;
};

type ParkingSiteBuildingConfig = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  subtitle?: string;
};

type ParkingSiteConfig = {
  aspectRatio?: string;
  spots: ParkingSiteSpotConfig[];
  canopies?: ParkingSiteCanopyConfig[];
  paths?: ParkingSitePathConfig[];
  gates?: ParkingSiteGateConfig[];
  building?: ParkingSiteBuildingConfig;
};

type ParkingLayoutConfig = {
  variant?: 'grid' | 'site';
  minSlots: number;
  rowSizes?: number[];
  perRow?: number;
  rowGap?: number;
  slotGap?: number;
  gates?: ParkingGateConfig[];
  site?: ParkingSiteConfig;
};

type ParkingLocationConfig = {
  value: string;
  title: string;
  subtitle: string;
  accent: string;
  lane: string;
  chip: string;
  layout: ParkingLayoutConfig;
};

// عدّل إعدادات الصفوف والبوابات هنا للتحكم في توزيع المواقف والكروكي ومكان المداخل/المخارج/المصعد.
const PARKING_LOCATIONS: ParkingLocationConfig[] = [
  {
    value: 'المواقف الداخلية',
    title: 'المواقف الداخلية',
    subtitle: 'المواقف الداخلية للمبنى في السرداب',
    accent: 'from-blue-600 to-indigo-600',
    lane: 'border-blue-200/70',
    chip: 'bg-blue-50 text-blue-700 border-blue-200',
    layout: {
      variant: 'grid',
      minSlots: 24,
      rowSizes: [12, 12],
      perRow: 12,
      rowGap: 24,
      slotGap: 16,
      gates: [
        {
          id: 'entry',
          kind: 'entry',
          label: 'بوابة الدخول',
          subtitle: 'السرداب',
          position: 'between',
          afterRow: 0,
          align: 'start',
        },
        {
          id: 'elevator',
          kind: 'elevator',
          label: 'المصعد',
          subtitle: 'بوابة المصعد',
          position: 'between',
          afterRow: 0,
          align: 'center',
        },
        {
          id: 'exit',
          kind: 'exit',
          label: 'بوابة الخروج',
          subtitle: 'السرداب',
          position: 'bottom',
          align: 'end',
        },
      ],
    },
  },
  {
    value: 'المواقف الخارجية',
    title: 'المواقف الخارجية',
    subtitle: '36 موقف متتالية مع اسم كل موظف',
    accent: 'from-amber-500 to-orange-500',
    lane: 'border-orange-200/70',
    chip: 'bg-orange-50 text-orange-700 border-orange-200',
    layout: {
      variant: 'grid',
      minSlots: 36,
      rowSizes: [12, 12, 12],
      perRow: 12,
      rowGap: 16,
      slotGap: 12,
      gates: [],
    },
  },
];

const normalizeSlotKey = (value?: string | null) => String(value || '').trim();

const buildParkingSlots = (employees: Employee[], fallbackSlots = 24): ParkingZoneData => {
  const slotMap = new Map<string, Employee>();
  const extras: Employee[] = [];
  const numericSlots: number[] = [];

  employees.forEach((employee) => {
    const key = normalizeSlotKey(employee.parkingNumber);
    if (!key) {
      extras.push(employee);
      return;
    }
    const numeric = Number(key);
    if (Number.isFinite(numeric) && numeric > 0) {
      const normalizedKey = String(numeric);
      if (slotMap.has(normalizedKey)) {
        extras.push(employee);
        return;
      }
      slotMap.set(normalizedKey, employee);
      numericSlots.push(numeric);
      return;
    }
    extras.push(employee);
  });

  const maxSlot = numericSlots.length ? Math.max(...numericSlots) : 0;
  const totalSlots = Math.max(maxSlot, fallbackSlots);
  const slots = Array.from({ length: totalSlots }, (_, index) => {
    const label = String(index + 1);
    return {
      key: label,
      label,
      employee: slotMap.get(label),
    };
  });

  return { slots, extras };
};

const getLocationTitle = (value: string) => (
  PARKING_LOCATIONS.find((location) => location.value === value)?.title || value
);

const splitSlots = (slots: ParkingSlot[], perRow: number) => {
  const rows: ParkingSlot[][] = [];
  for (let i = 0; i < slots.length; i += perRow) {
    rows.push(slots.slice(i, i + perRow));
  }
  return rows;
};

const buildSlotRows = (slots: ParkingSlot[], rowSizes: number[], perRow: number) => {
  if (!rowSizes.length) {
    return splitSlots(slots, perRow);
  }
  const rows: ParkingSlot[][] = [];
  let cursor = 0;
  rowSizes.forEach((size) => {
    if (cursor >= slots.length) return;
    rows.push(slots.slice(cursor, cursor + size));
    cursor += size;
  });
  while (cursor < slots.length) {
    rows.push(slots.slice(cursor, cursor + perRow));
    cursor += perRow;
  }
  return rows;
};

const getDisplayName = (employee: Employee) => {
  const name = employee.name || 'غير مسجل';
  const rank = employee.rank || '';
  return rank ? `${rank} / ${name}` : name;
};

const getShortName = (value: string) => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return parts.join(' ');
  return `${parts[0]} ${parts[parts.length - 1]}`;
};

const truncateText = (value: string, maxLength: number) => (
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
);

const getDisplayParts = (employee: Employee) => {
  const fullName = employee.name || 'غير مسجل';
  return {
    rank: employee.rank || '',
    name: getShortName(fullName),
  };
};

const ParkingSpotCard: React.FC<{
  slot: ParkingSlot;
  accentClass: string;
  onEdit: (employee: Employee) => void;
  onDelete: (employee: Employee) => void;
  onAdd: (slot: ParkingSlot) => void;
}> = ({ slot, accentClass, onEdit, onDelete, onAdd }) => {
  const employee = slot.employee;
  const displayParts = employee ? getDisplayParts(employee) : null;
  const departmentLabel = String(employee?.department || '').trim() || 'غير مسجل';
  const departmentDisplay = truncateText(departmentLabel, 20);
  const isEmpty = !employee;
  return (
    <div className="flex w-[82px] flex-col items-center gap-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => (employee ? onEdit(employee) : onAdd(slot))}
          className={`relative h-24 w-16 rounded-[22px] border transition ${
            employee
              ? 'cursor-pointer border-slate-200 bg-gradient-to-b from-slate-100 via-white to-slate-200 shadow-sm hover:shadow-md hover:-translate-y-0.5'
              : 'cursor-pointer border-amber-200 bg-gradient-to-b from-amber-50 via-white to-amber-100 shadow-sm hover:shadow-md hover:-translate-y-0.5'
          }`}
          aria-label={employee ? `تعديل موقف ${getDisplayName(employee)}` : `إضافة موقف رقم ${slot.label}`}
        >
          <div
            className={`absolute inset-[5px] rounded-[18px] border ${
              isEmpty ? 'border-slate-300 bg-gradient-to-b from-slate-100 via-slate-200 to-slate-300' : 'border-slate-200 bg-gradient-to-b from-white via-slate-50 to-slate-100'
            }`}
          >
            <div className={`absolute left-2 right-2 top-1.5 h-3.5 rounded-full ${isEmpty ? 'bg-slate-600/70' : 'bg-slate-800/90'}`} />
            <div className={`absolute left-2 right-2 bottom-1.5 h-3.5 rounded-full ${isEmpty ? 'bg-slate-600/70' : 'bg-slate-800/90'}`} />
            <div className={`absolute inset-x-2 top-1/2 h-1 -translate-y-1/2 rounded-full ${isEmpty ? 'bg-slate-300/80' : 'bg-slate-200/80'}`} />
            <div className={`absolute inset-x-2 top-6 h-2 rounded-full ${isEmpty ? 'bg-slate-200/70' : 'bg-white/80'}`} />
            <div className={`absolute inset-x-2 bottom-6 h-2 rounded-full ${isEmpty ? 'bg-slate-200/70' : 'bg-white/80'}`} />
          </div>
          <div className={`absolute -left-1 top-6 h-3 w-2 rounded-full ${isEmpty ? 'bg-slate-300' : 'bg-slate-400'}`} />
          <div className={`absolute -left-1 bottom-6 h-3 w-2 rounded-full ${isEmpty ? 'bg-slate-300' : 'bg-slate-400'}`} />
          <div className={`absolute -right-1 top-6 h-3 w-2 rounded-full ${isEmpty ? 'bg-slate-300' : 'bg-slate-400'}`} />
          <div className={`absolute -right-1 bottom-6 h-3 w-2 rounded-full ${isEmpty ? 'bg-slate-300' : 'bg-slate-400'}`} />
          <div className="absolute inset-x-2 bottom-0.5 h-1 rounded-full bg-slate-200/70" />

          {!employee && (
            <div className="absolute inset-x-3 top-1/2 h-2 -translate-y-1/2 rotate-12 rounded-full bg-amber-200/80 shadow-sm" />
          )}

          <div className={`absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border px-2.5 py-0.5 text-sm font-black shadow ${accentClass}`}>
            {slot.label}
          </div>
        </button>

        {employee ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(employee);
            }}
            className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-red-200 bg-white text-red-600 shadow-sm hover:bg-red-50"
            aria-label="حذف بيانات الموقف"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      {employee ? (
        <>
          <div className="text-center leading-tight">
            {displayParts?.rank ? (
              <div className="text-[10px] font-semibold text-slate-600">{displayParts.rank}</div>
            ) : null}
            <div className="text-[11px] font-bold text-slate-900 truncate" title={displayParts?.name}>
              {displayParts?.name}
            </div>
            <div className="text-[10px] text-slate-500 truncate" title={departmentLabel}>
              {departmentDisplay}
            </div>
          </div>
        </>
      ) : (
        <div className="text-[11px] text-slate-300 font-bold">
          موقف شاغر
          </div>
      )}
    </div>
  );
};

const ParkingZone: React.FC<{
  title: string;
  subtitle: string;
  accent: string;
  chip: string;
  lane: string;
  data: ParkingZoneData;
  locationValue: string;
  layout: ParkingLayoutConfig;
  onEdit: (employee: Employee) => void;
  onDelete: (employee: Employee) => void;
  onAdd: (location: string, slot: ParkingSlot) => void;
}> = ({ title, subtitle, chip, lane, data, locationValue, layout, onEdit, onDelete, onAdd }) => {
  const isSiteLayout = layout.variant === 'site' && layout.site;
  const slotMap = new Map(data.slots.map((slot) => [slot.label, slot]));
  const siteConfig = layout.site;
  const siteSlots = isSiteLayout && siteConfig
    ? siteConfig.spots.map((spot) => {
        const label = String(spot.index);
        return slotMap.get(label) || { key: label, label };
      })
    : [];
  const displaySlots = isSiteLayout ? siteSlots : data.slots;
  const perRow = layout.perRow ?? 12;
  const rows = isSiteLayout ? [] : buildSlotRows(displaySlots, layout.rowSizes ?? [], perRow);
  const rowGap = layout.rowGap ?? 24;
  const slotGap = layout.slotGap ?? 16;
  const gates = layout.gates ?? [];
  const topGates = gates.filter((gate) => gate.position === 'top');
  const bottomGates = gates.filter((gate) => gate.position === 'bottom');
  const betweenGates = gates.filter((gate) => !gate.position || gate.position === 'between');
  const gatesAfterRow = betweenGates.reduce((acc, gate) => {
    const index = typeof gate.afterRow === 'number' ? gate.afterRow : 0;
    const list = acc.get(index) || [];
    list.push(gate);
    acc.set(index, list);
    return acc;
  }, new Map<number, ParkingGateConfig[]>());
  const occupied = displaySlots.filter((slot) => slot.employee).length;
  const empty = displaySlots.length - occupied;

  const getGateAlignClass = (align?: ParkingGateConfig['align']) => {
    switch (align) {
      case 'start':
        return 'justify-start';
      case 'end':
        return 'justify-end';
      default:
        return 'justify-center';
    }
  };

  const gateVariants = {
    entry: {
      icon: LogIn,
      badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      gradient: 'from-emerald-500 to-emerald-600',
      shape: 'rounded-2xl',
      label: 'دخول',
    },
    exit: {
      icon: LogOut,
      badge: 'bg-rose-100 text-rose-700 border-rose-200',
      gradient: 'from-rose-500 to-red-600',
      shape: 'rounded-2xl',
      label: 'خروج',
    },
    elevator: {
      icon: ArrowUpDown,
      badge: 'bg-indigo-100 text-indigo-700 border-indigo-200',
      gradient: 'from-indigo-500 to-indigo-600',
      shape: 'rounded-2xl',
      label: 'مصعد',
    },
  };

  const renderGate = (gate: ParkingGateConfig) => {
    const variant = gateVariants[gate.kind];
    const Icon = variant.icon;
    return (
      <div key={gate.id} className={`flex items-center ${getGateAlignClass(gate.align)}`}>
        <div className={`relative inline-flex items-center gap-3 border border-slate-200 bg-white/80 px-4 py-3 shadow-lg ${variant.shape}`}>
          <span className={`absolute -top-2 right-3 rounded-full border px-2 py-0.5 text-[10px] font-bold ${variant.badge}`}>
            {variant.label}
          </span>
          <div className={`h-10 w-10 flex items-center justify-center text-white shadow-sm ${variant.shape} bg-gradient-to-br ${variant.gradient}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">{gate.label}</div>
            <div className="text-xs text-slate-500">{gate.subtitle || subtitle}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderSiteGate = (gate: ParkingSiteGateConfig) => {
    const variant = gateVariants[gate.kind];
    const Icon = variant.icon;
    return (
      <div
        key={gate.id}
        className="absolute z-20"
        style={{ left: `${gate.x}%`, top: `${gate.y}%`, transform: 'translate(-50%, -50%)' }}
      >
        <div className={`relative flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-3 py-2 shadow-md ${variant.shape}`}>
          <div className={`h-8 w-8 flex items-center justify-center text-white shadow-sm ${variant.shape} bg-gradient-to-br ${variant.gradient}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="text-[10px] leading-tight">
            <div className="font-bold text-slate-800">{gate.label}</div>
            {gate.subtitle ? (
              <div className="text-[9px] text-slate-500">{gate.subtitle}</div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const renderSiteLayout = () => {
    if (!isSiteLayout || !siteConfig) return null;
    const aspectRatio = siteConfig.aspectRatio || '16 / 10';
    const slotsWithPosition = siteConfig.spots.map((spot) => {
      const label = String(spot.index);
      const slot = slotMap.get(label) || { key: label, label };
      return { spot, slot };
    });

    return (
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
        <div
          className="relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-100"
          style={{ aspectRatio }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,_rgba(148,163,184,0.22)_1px,_transparent_0)] [background-size:18px_18px]" />

          {siteConfig.canopies?.map((canopy) => (
            <div
              key={canopy.id}
              className="absolute z-10 rounded-2xl border border-white/90 bg-white shadow-lg"
              style={{
                left: `${canopy.x}%`,
                top: `${canopy.y}%`,
                width: `${canopy.width}%`,
                height: `${canopy.height}%`,
                transform: `translate(-50%, -50%) rotate(${canopy.rotation || 0}deg)`,
              }}
            />
          ))}

          {siteConfig.building ? (
            <div
              className="absolute z-10 flex flex-col items-center justify-center rounded-3xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-center shadow-md"
              style={{
                left: `${siteConfig.building.x}%`,
                top: `${siteConfig.building.y}%`,
                width: `${siteConfig.building.width}%`,
                height: `${siteConfig.building.height}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div className="text-xs font-bold text-amber-800">{siteConfig.building.label}</div>
              {siteConfig.building.subtitle ? (
                <div className="text-[10px] text-amber-600 mt-1">{siteConfig.building.subtitle}</div>
              ) : null}
            </div>
          ) : null}

          {siteConfig.paths?.length ? (
            <svg
              className="pointer-events-none absolute inset-0 z-0"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <defs>
                {siteConfig.paths.map((path) => (
                  <marker
                    key={`${path.id}-marker`}
                    id={`marker-${path.id}`}
                    markerWidth="6"
                    markerHeight="6"
                    refX="4"
                    refY="3"
                    orient="auto"
                    markerUnits="strokeWidth"
                  >
                    <path d="M0,0 L6,3 L0,6 Z" fill={path.color} />
                  </marker>
                ))}
              </defs>
              {siteConfig.paths.map((path) => (
                <polyline
                  key={path.id}
                  points={path.points.map((point) => `${point.x},${point.y}`).join(' ')}
                  fill="none"
                  stroke={path.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  markerEnd={`url(#marker-${path.id})`}
                />
              ))}
            </svg>
          ) : null}

          {siteConfig.paths?.map((path) => (
            path.label && path.labelPosition ? (
              <div
                key={`${path.id}-label`}
                className="absolute z-20 rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-slate-700 shadow-sm"
                style={{
                  left: `${path.labelPosition.x}%`,
                  top: `${path.labelPosition.y}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {path.label}
              </div>
            ) : null
          ))}

          {siteConfig.gates?.map(renderSiteGate)}

          {slotsWithPosition.map(({ spot, slot }) => (
            <div
              key={spot.id}
              className="absolute z-30 flex flex-col items-center"
              style={{ left: `${spot.x}%`, top: `${spot.y}%`, transform: 'translate(-50%, -50%)' }}
            >
              <span className="pointer-events-none absolute -top-2 h-2 w-2 rounded-full bg-red-500 shadow-sm" />
              <div className="relative z-10 scale-[0.8] origin-top">
                <ParkingSpotCard
                  slot={slot}
                  accentClass={chip}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onAdd={(selectedSlot) => onAdd(locationValue, selectedSlot)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section className="relative rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-lg overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,_rgba(148,163,184,0.12)_1px,_transparent_0)] [background-size:18px_18px]" />
      <div className="relative space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 font-semibold ${chip}`}>
              <Car className="h-3.5 w-3.5" />
              مشغول: {occupied}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-semibold text-slate-600">
              متاح: {empty}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-500">
              الإجمالي: {data.slots.length}
            </span>
          </div>
        </div>

        {isSiteLayout ? (
          renderSiteLayout()
        ) : (
          <div className="flex flex-col" style={{ gap: rowGap }}>
            {topGates.map(renderGate)}

            {rows.map((row, index) => (
              <React.Fragment key={`row-${index}`}>
                {row.length > 0 && (
                  <div className={`rounded-2xl border ${lane} bg-white/70 p-4 overflow-x-auto`}>
                    <div className="grid" style={{ gap: slotGap, gridAutoFlow: 'column', gridAutoColumns: 'minmax(72px, 1fr)' }}>
                      {row.map((slot) => (
                        <ParkingSpotCard
                          key={slot.key}
                          slot={slot}
                          accentClass={chip}
                          onEdit={onEdit}
                          onDelete={onDelete}
                          onAdd={(selectedSlot) => onAdd(locationValue, selectedSlot)}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {(gatesAfterRow.get(index) || []).map(renderGate)}
              </React.Fragment>
            ))}

            {bottomGates.map(renderGate)}
          </div>
        )}

        {data.extras.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
            <h4 className="text-sm font-semibold text-slate-700 mb-3">مواقف بدون رقم محدد</h4>
            <div className="flex flex-wrap gap-2">
              {data.extras.map((employee) => (
                <button
                  key={employee.id}
                  onClick={() => onEdit(employee)}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <span>{getDisplayName(employee)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

const ParkingMap: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [editEmployeeSelection, setEditEmployeeSelection] = useState<Employee | null>(null);
  const [editSearch, setEditSearch] = useState('');
  const [deleteEmployee, setDeleteEmployee] = useState<Employee | null>(null);
  const [createSlot, setCreateSlot] = useState<{ location: string; number: string } | null>(null);
  const [createEmployee, setCreateEmployee] = useState<Employee | null>(null);
  const [createSearch, setCreateSearch] = useState('');
  const [createLocation, setCreateLocation] = useState('');
  const [createNumber, setCreateNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [formLocation, setFormLocation] = useState('');
  const [formNumber, setFormNumber] = useState('');

  const loadEmployees = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEmployees();
      setEmployees(data);
    } catch (err) {
      console.error(err);
      setError('حدث خطأ أثناء تحميل بيانات المواقف.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    if (!editEmployee) {
      setEditEmployeeSelection(null);
      setEditSearch('');
      return;
    }
    setFormLocation(editEmployee.parkingLocation || '');
    setFormNumber(editEmployee.parkingNumber || '');
    setEditEmployeeSelection(editEmployee);
    setEditSearch('');
  }, [editEmployee]);

  useEffect(() => {
    if (!createSlot) return;
    setCreateLocation(createSlot.location);
    setCreateNumber(createSlot.number);
    setCreateEmployee(null);
    setCreateSearch('');
  }, [createSlot]);

  const closeCreateModal = () => {
    setCreateSlot(null);
    setCreateEmployee(null);
    setCreateSearch('');
    setCreateLocation('');
    setCreateNumber('');
  };

  const filteredCreateEmployees = useMemo(() => {
    const query = createSearch.trim().toLowerCase();
    if (!query) return [];
    return employees.filter((employee) => {
      const name = employee.name?.toLowerCase() || '';
      const rank = employee.rank?.toLowerCase() || '';
      const fileNumber = String(employee.fileNumber || '').toLowerCase();
      const department = employee.department?.toLowerCase() || '';
      return (
        name.includes(query) ||
        rank.includes(query) ||
        fileNumber.includes(query) ||
        department.includes(query)
      );
    }).slice(0, 20);
  }, [createSearch, employees]);

  const filteredEditEmployees = useMemo(() => {
    const query = editSearch.trim().toLowerCase();
    if (!query) return [];
    return employees.filter((employee) => {
      const name = employee.name?.toLowerCase() || '';
      const rank = employee.rank?.toLowerCase() || '';
      const fileNumber = String(employee.fileNumber || '').toLowerCase();
      const department = employee.department?.toLowerCase() || '';
      return (
        name.includes(query) ||
        rank.includes(query) ||
        fileNumber.includes(query) ||
        department.includes(query)
      );
    }).slice(0, 20);
  }, [editSearch, employees]);

  const openCreateModal = (location: string, slot: ParkingSlot) => {
    setCreateSlot({ location, number: slot.label });
  };

  const handleSave = async () => {
    if (!editEmployeeSelection) {
      toast.error('يرجى اختيار الموظف أولاً');
      return;
    }
    const locationValue = formLocation || 'المواقف الداخلية';
    setSaving(true);
    try {
      if (editEmployee && editEmployeeSelection.id !== editEmployee.id) {
        await updateEmployee(editEmployee.id, {
          hasParking: false,
          parkingLocation: '',
          parkingNumber: '',
        });
      }
      await updateEmployee(editEmployeeSelection.id, {
        hasParking: true,
        parkingLocation: locationValue,
        parkingNumber: formNumber ? String(formNumber).trim() : '',
      });
      toast.success('تم تحديث بيانات الموقف');
      setEditEmployee(null);
      setEditEmployeeSelection(null);
      await loadEmployees();
    } catch (err) {
      console.error(err);
      toast.error('فشل تحديث بيانات الموقف');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateSave = async () => {
    if (!createEmployee) {
      toast.error('يرجى اختيار الموظف أولاً');
      return;
    }
    const locationValue = createLocation || createSlot?.location || 'المواقف الداخلية';
    setSaving(true);
    try {
      await updateEmployee(createEmployee.id, {
        hasParking: true,
        parkingLocation: locationValue,
        parkingNumber: createNumber ? String(createNumber).trim() : '',
      });
      toast.success('تم إضافة الموقف بنجاح');
      closeCreateModal();
      await loadEmployees();
    } catch (err) {
      console.error(err);
      toast.error('فشل إضافة الموقف');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteEmployee) return;
    setSaving(true);
    try {
      await updateEmployee(deleteEmployee.id, {
        hasParking: false,
        parkingLocation: '',
        parkingNumber: '',
      });
      toast.success('تم حذف الموقف بنجاح');
      setDeleteEmployee(null);
      await loadEmployees();
    } catch (err) {
      console.error(err);
      toast.error('فشل حذف الموقف');
    } finally {
      setSaving(false);
    }
  };

  const parkingByLocation = useMemo(() => {
    const assigned = employees.filter((employee) => employee.hasParking);
    const grouped = new Map<string, Employee[]>();
    assigned.forEach((employee) => {
      const location = employee.parkingLocation || '';
      if (!grouped.has(location)) grouped.set(location, []);
      grouped.get(location)?.push(employee);
    });
    return grouped;
  }, [employees]);

  if (loading) {
    return <LoadingPage variant="employees" title="جاري تحميل المواقف" subtitle="يرجى الانتظار بينما نحضر مخطط المواقف..." />;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 flex items-center justify-center shadow-lg">
              <ParkingSquare className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900">كروكي مواقف السيارات</h1>
              <p className="text-sm text-slate-500 mt-1">عرض مرئي لمواقع الموظفين في المواقف الداخلية والخارجية</p>
            </div>
          </div>
          <button
            onClick={loadEmployees}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            تحديث البيانات
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {PARKING_LOCATIONS.map((location) => {
          const locationEmployees = parkingByLocation.get(location.value) || [];
          const fallbackSlots = location.layout.site?.spots.length ?? location.layout.minSlots;
          const data = buildParkingSlots(locationEmployees, fallbackSlots);
          return (
            <ParkingZone
              key={location.value}
              title={location.title}
              subtitle={location.subtitle}
              accent={location.accent}
              chip={location.chip}
              lane={location.lane}
              data={data}
              locationValue={location.value}
              layout={location.layout}
              onEdit={(employee) => setEditEmployee(employee)}
              onDelete={(employee) => setDeleteEmployee(employee)}
              onAdd={openCreateModal}
            />
          );
        })}
      </div>

      <Modal
        isOpen={Boolean(editEmployee)}
        onClose={() => setEditEmployee(null)}
        title="تعديل بيانات الموقف"
        size="md"
      >
        {editEmployee && (
          <div className="space-y-5">
            {editEmployeeSelection ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-600">الموظف</div>
                    <div className="text-base font-bold text-slate-900 mt-1">{getDisplayName(editEmployeeSelection)}</div>
                    <div className="text-xs mt-1 text-gray-500">
                      رقم التواصل: <span className="font-bold text-sm text-green-600">{editEmployeeSelection.phone_number || 'غير مسجل'}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditEmployeeSelection(null);
                      setEditSearch('');
                    }}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                  >
                    تغيير الموظف
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">بحث الموظف</label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={editSearch}
                    onChange={(event) => setEditSearch(event.target.value)}
                    placeholder="ابحث بالاسم، المسمى الوظيفي، رقم الملف، أو الإدارة..."
                    className="w-full h-11 pr-10 pl-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm text-right"
                  />
                </div>

                {editSearch ? (
                  filteredEditEmployees.length > 0 ? (
                    <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                      {filteredEditEmployees.map((employee) => (
                        <button
                          key={employee.id}
                          type="button"
                          onClick={() => {
                            setEditEmployeeSelection(employee);
                            setEditSearch('');
                          }}
                          className="w-full text-right px-3 py-2 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors"
                        >
                          <div className="text-sm font-semibold text-slate-900">{getDisplayName(employee)}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            رقم التواصل: {employee.phone_number || 'غير مسجل'}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">لا توجد نتائج مطابقة</div>
                  )
                ) : (
                  <div className="text-xs text-slate-400">اكتب للبحث عن الموظف</div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">مكان الموقف</label>
              <select
                value={formLocation}
                onChange={(e) => setFormLocation(e.target.value)}
                className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
              >
                <option value="">اختر مكان الموقف</option>
                {PARKING_LOCATIONS.map((location) => (
                  <option key={location.value} value={location.value}>
                    {location.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">رقم الموقف</label>
              <input
                type="text"
                value={formNumber}
                onChange={(e) => setFormNumber(e.target.value)}
                placeholder="أدخل رقم الموقف"
                className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={() => setEditEmployee(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors"
                disabled={saving}
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                disabled={saving || !editEmployeeSelection}
              >
                حفظ التغييرات
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(createSlot)}
        onClose={closeCreateModal}
        title="إضافة موقف لموظف"
        size="md"
      >
        {createSlot && (
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-600">الموقف المحدد</div>
              <div className="text-base font-bold text-slate-900 mt-1">{getLocationTitle(createSlot.location)}</div>
              <div className="text-xs text-slate-500 mt-1">رقم الموقف: {createSlot.number}</div>
            </div>

            {createEmployee ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-500">الموظف المحدد</div>
                    <div className="text-sm font-bold text-slate-900 mt-1">{getDisplayName(createEmployee)}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      رقم الملف: {createEmployee.fileNumber || createEmployee.civilId || 'غير مسجل'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCreateEmployee(null);
                      setCreateSearch('');
                    }}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                  >
                    تغيير
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">بحث الموظف</label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={createSearch}
                    onChange={(event) => setCreateSearch(event.target.value)}
                    placeholder="ابحث بالاسم، المسمى الوظيفي، رقم الملف، أو الإدارة..."
                    className="w-full h-11 pr-10 pl-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm text-right"
                  />
                </div>

                {createSearch ? (
                  filteredCreateEmployees.length > 0 ? (
                    <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                      {filteredCreateEmployees.map((employee) => (
                        <button
                          key={employee.id}
                          type="button"
                          onClick={() => {
                            setCreateEmployee(employee);
                            setCreateSearch('');
                          }}
                          className="w-full text-right px-3 py-2 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors"
                        >
                          <div className="text-sm font-semibold text-slate-900">{getDisplayName(employee)}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            رقم الملف: {employee.fileNumber || employee.civilId || 'غير مسجل'}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">لا توجد نتائج مطابقة</div>
                  )
                ) : (
                  <div className="text-xs text-slate-400">اكتب للبحث عن الموظف</div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">مكان الموقف</label>
                <select
                  value={createLocation}
                  onChange={(event) => setCreateLocation(event.target.value)}
                  className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                >
                  <option value="">اختر مكان الموقف</option>
                  {PARKING_LOCATIONS.map((location) => (
                    <option key={location.value} value={location.value}>
                      {location.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">رقم الموقف</label>
                <input
                  type="text"
                  value={createNumber}
                  onChange={(event) => setCreateNumber(event.target.value)}
                  placeholder="أدخل رقم الموقف"
                  className="w-full h-11 px-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={closeCreateModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors"
                disabled={saving}
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleCreateSave}
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                disabled={saving || !createEmployee}
              >
                حفظ الموقف
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDeleteModal
        isOpen={Boolean(deleteEmployee)}
        onClose={() => setDeleteEmployee(null)}
        onConfirm={handleDelete}
        title="حذف الموقف"
        description={deleteEmployee ? `سيتم حذف موقف ${getDisplayName(deleteEmployee)} نهائياً.` : 'سيتم حذف الموقف نهائياً.'}
        confirmLabel="حذف الموقف"
      />
    </div>
  );
};

export default ParkingMap;
