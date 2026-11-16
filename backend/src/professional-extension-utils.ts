export type ExtensionStatus = 'pre_60' | 'extended' | 'not_extended';
export type ExtensionStage = 'pre_60' | 'renewal';

export interface ProfessionalExtensionRecord {
    id: string;
    employeeId: string;
    decisionNumber?: string | null;
    letterNumber?: string | null;
    decisionDate?: string | null;
    extensionStartDate: string;
    extensionEndDate: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface ExtensionStatusResult {
    status: ExtensionStatus;
    stage: ExtensionStage;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    daysRemaining: number;
    extension: ProfessionalExtensionRecord | null;
    suggestedStartDate: string;
    suggestedEndDate: string;
}

interface EmployeeForExtension {
    id: string;
    category?: string;
    birthDate?: string | null;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export const parseDateOnly = (value?: string | null): Date | null => {
    if (!value || !DATE_ONLY_RE.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(Date.UTC(year, month - 1, day));
};

export const toDateOnlyString = (date: Date): string => {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
        .toISOString()
        .slice(0, 10);
};

export const addYears = (date: Date, years: number): Date => {
    return new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()));
};

export const getTodayUtc = (): Date => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

export const diffInDays = (from: Date, to: Date): number => {
    return Math.round((to.getTime() - from.getTime()) / DAY_MS);
};

export const computeExtensionStatusForEmployee = (
    employee: EmployeeForExtension,
    extensions: ProfessionalExtensionRecord[],
    today: Date
): ExtensionStatusResult | null => {
    if (employee.category !== 'مهنيين') return null;
    const birthDate = parseDateOnly(employee.birthDate);
    if (!birthDate) return null;

    const start60 = addYears(birthDate, 60);
    const end65 = addYears(birthDate, 65);

    if (today >= end65) return null;

    const findValidExtension = (periodStart: Date, todayDate: Date) => {
        const minEndDate = todayDate < periodStart ? periodStart : todayDate;
        const matches = extensions
            .map((ext) => ({
                ext,
                start: parseDateOnly(ext.extensionStartDate),
                end: parseDateOnly(ext.extensionEndDate)
            }))
            .filter((item) => item.start && item.end && item.start <= periodStart && item.end >= minEndDate)
            .sort((a, b) => a.end!.getTime() - b.end!.getTime());
        return matches.length ? matches[0].ext : null;
    };

    if (today < start60) {
        const periodStart = start60;
        const periodEnd = addYears(start60, 1);
        const dueDate = periodStart;
        const currentExtension = findValidExtension(periodStart, today);
        if (currentExtension) {
            const extEnd = parseDateOnly(currentExtension.extensionEndDate) || periodEnd;
            return {
                status: 'extended',
                stage: 'pre_60',
                periodStart: toDateOnlyString(periodStart),
                periodEnd: toDateOnlyString(periodEnd),
                dueDate: toDateOnlyString(extEnd),
                daysRemaining: diffInDays(today, extEnd),
                extension: currentExtension,
                suggestedStartDate: toDateOnlyString(periodStart),
                suggestedEndDate: toDateOnlyString(periodEnd)
            };
        }
        return {
            status: 'pre_60',
            stage: 'pre_60',
            periodStart: toDateOnlyString(periodStart),
            periodEnd: toDateOnlyString(periodEnd),
            dueDate: toDateOnlyString(dueDate),
            daysRemaining: diffInDays(today, dueDate),
            extension: null,
            suggestedStartDate: toDateOnlyString(periodStart),
            suggestedEndDate: toDateOnlyString(periodEnd)
        };
    }

    let periodStart = start60;
    let periodEnd = addYears(start60, 1);
    while (today >= periodEnd && periodEnd < end65) {
        periodStart = periodEnd;
        periodEnd = addYears(periodEnd, 1);
    }

    const currentExtension = findValidExtension(periodStart, today);

    if (currentExtension) {
        const extEnd = parseDateOnly(currentExtension.extensionEndDate) || periodEnd;
        return {
            status: 'extended',
            stage: 'renewal',
            periodStart: toDateOnlyString(periodStart),
            periodEnd: toDateOnlyString(periodEnd),
            dueDate: toDateOnlyString(extEnd),
            daysRemaining: diffInDays(today, extEnd),
            extension: currentExtension,
            suggestedStartDate: toDateOnlyString(periodStart),
            suggestedEndDate: toDateOnlyString(periodEnd)
        };
    }

    return {
        status: 'not_extended',
        stage: 'renewal',
        periodStart: toDateOnlyString(periodStart),
        periodEnd: toDateOnlyString(periodEnd),
        dueDate: toDateOnlyString(periodStart),
        daysRemaining: diffInDays(today, periodStart),
        extension: null,
        suggestedStartDate: toDateOnlyString(periodStart),
        suggestedEndDate: toDateOnlyString(periodEnd)
    };
};
