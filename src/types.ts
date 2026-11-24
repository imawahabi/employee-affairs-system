export interface Employee {
  id: string;
  fileNumber: string | null;
  name: string;
  firstName?: string | null;
  secondName?: string | null;
  thirdName?: string | null;
  fourthName?: string | null;
  familyName?: string | null;
  category: 'قيادات' | 'مشرفون' | 'فنيون' | 'إداريون';
  rank: string;
  jobTitle: string | null;
  jobGrade?: string | null;
  professionalGroup?: string | null;
  department: string;
  status: 'active' | 'inactive';
  monthlyShiftCount: number | null;
  lastShiftDate?: string;
  lastShiftStatus?: 'attended' | 'absent';
  reasonIfInactive?: string | null;
  inactiveDate?: string | null;
  phone_number: string | null;
  referenceNumber?: string | null;
  civilId?: string | null;
  birthDate?: string | null;
  nationality?: string | null;
  nationalityArticleNumber?: string | null;
  nationalityIssueDate?: string | null;
  maritalStatus?: string | null;
  maritalStatusNote?: string | null;
  appointmentDecisionNumber?: string | null;
  appointmentDecisionDate?: string | null;
  gender?: string | null;
  hasEducationCertificate?: boolean;
  educationCertificateType?: string | null;
  educationSpecialization?: string | null;
  militaryNumber?: string | null;
  hiringDate?: string | null;
  seniorityNumber?: string | null;
  section?: string | null;
  hasWeapon?: boolean;
  weaponAttachments?: string | null;
  hasParking?: boolean;
  parkingLocation?: string | null;
  parkingNumber?: string | null;
  includeInShifts?: boolean;
  shiftNotes?: string | null;
  excludeFromStatistics?: boolean;
  isSecondedOutsideGeneralAdministration?: boolean;
  secondmentLocation?: string | null;
  manualOrder?: number | null;
}

export interface Department {
  id: string;
  name: string;
}

export interface Nationality {
  id: string;
  name: string;
}

export interface JobTitleEntity {
  id: string;
  name: string;
  category: string;
}

export interface Section {
  id: string;
  name: string;
  departmentId: string;
}

export interface Rank {
  id: string;
  name: string;
  category: string;
  order: number;
}

export interface Shift {
  id: string;
  shiftDate: string;
  createdBy: string;
  startTime: string;
  endTime: string;
  paperCopyReceived: boolean;
  title?: string | null;
  notes?: string | null;
  note?: string; // Legacy, to be removed
  createdAt: string;
}

export interface ShiftAssignment {
  id: string;
  shiftId: string;
  employeeId: string;
  status: 'attended' | 'absent';
  counted: boolean;
  note: string | null;
  addedAt: string;
}

export interface ShiftDayException {
  id: string;
  date: string;
  reason: string;
  note?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ShiftReport {
  shift: Shift;
  assignments: (ShiftAssignment & { employee: Employee })[];
}

export interface Alert {
  id: string;
  employeeId?: string;
  type: 'shift_not_received' | 'no_upcoming_shift' | 'professional_extension';
  dateTriggered: string;
  status: 'new' | 'read' | 'resolved' | 'dismissed';
  message: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  category: 'shift' | 'employee' | 'system' | 'reminder';
  actionUrl?: string;
  metadata?: Record<string, any>;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfessionalExtension {
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

export type ProfessionalExtensionStatus = 'pre_60' | 'extended' | 'not_extended';
export type ProfessionalExtensionStage = 'pre_60' | 'renewal';

export interface ProfessionalExtensionStatusItem {
  employee: Employee;
  status: ProfessionalExtensionStatus;
  stage: ProfessionalExtensionStage;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  daysRemaining: number;
  extension: ProfessionalExtension | null;
  suggestedStartDate: string;
  suggestedEndDate: string;
}

export interface ProfessionalExtensionStatusResponse {
  reminderDays: number[];
  criticalDays: number;
  approaching: ProfessionalExtensionStatusItem[];
  extended: ProfessionalExtensionStatusItem[];
  notExtended: ProfessionalExtensionStatusItem[];
  archive: ProfessionalExtensionStatusItem[];
}

export interface NotificationSettings {
  id: string;
  userId: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  shiftReminders: boolean;
  overdueAlerts: boolean;
  systemAlerts: boolean;
  reminderDays: number;
  overdueDays: number;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  message?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
}
