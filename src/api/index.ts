import {
  Employee,
  Shift,
  ShiftDayException,
  Alert,
  NotificationSettings,
  Rank,
  ProfessionalExtension,
  ProfessionalExtensionStatusResponse,
  AuditLogEntry
} from '../types';

// Backend port configuration (supports Electron dynamic port)
const DEFAULT_BACKEND_PORT = Number(import.meta.env?.VITE_BACKEND_PORT) || 3106;
const PORT_STORAGE_KEY = 'gov-backend-port';
const isElectron = typeof window !== 'undefined' && !!(window as any).electron?.ipcRenderer;

let API_BASE_URL = `http://localhost:${DEFAULT_BACKEND_PORT}/api`;
let portKnown = false;
let portReadyPromise: Promise<void> | null = null;
let resolvePortReady: (() => void) | null = null;
let portSyncAttempted = false;

const resolvePortReadyNow = () => {
  if (resolvePortReady) {
    resolvePortReady();
    resolvePortReady = null;
  }
  portReadyPromise = null;
};

const applyBackendPort = (rawPort: unknown) => {
  const parsed = typeof rawPort === 'string' ? parseInt(rawPort, 10) : Number(rawPort);
  if (!Number.isFinite(parsed) || parsed <= 0) return;
  API_BASE_URL = `http://localhost:${parsed}/api`;
  portKnown = true;
  try {
    window.localStorage.setItem(PORT_STORAGE_KEY, String(parsed));
  } catch (_) {}
  resolvePortReadyNow();
};

const refreshPortFromMain = async () => {
  if (!isElectron) return;
  const ipcRenderer = (window as any).electron?.ipcRenderer;
  if (!ipcRenderer) return;
  if (typeof ipcRenderer.invoke === 'function') {
    try {
      const port = await ipcRenderer.invoke('get-backend-port');
      applyBackendPort(port);
    } catch (_) {}
  } else {
    try {
      ipcRenderer.send('request-backend-port');
    } catch (_) {}
  }
};

if (isElectron) {
  const ipcRenderer = (window as any).electron.ipcRenderer;
  ipcRenderer.on('set-backend-port', (port: unknown) => {
    applyBackendPort(port);
  });

  try {
    const savedPort = window.localStorage.getItem(PORT_STORAGE_KEY);
    if (savedPort) applyBackendPort(savedPort);
  } catch (_) {}

  try {
    ipcRenderer.send('request-backend-port');
  } catch (_) {}

  void refreshPortFromMain();
}

// Simple wrapper to ensure the backend port is known before API calls
const ensurePortSet = async (forceRefresh = false): Promise<void> => {
  if (!isElectron) return;
  if (forceRefresh) {
    if (portReadyPromise) {
      resolvePortReadyNow();
    }
  }
  if (portKnown && portSyncAttempted && !forceRefresh) return;
  if (portReadyPromise) return portReadyPromise;
  portReadyPromise = new Promise((resolve) => {
    resolvePortReady = resolve;
  });
  portSyncAttempted = true;
  void refreshPortFromMain();
  setTimeout(() => {
    resolvePortReadyNow();
  }, 2000);
  return portReadyPromise;
};

const apiFetch = async (url: string, options: FetchOptions = {}) => {
  await ensurePortSet();
  return fetch(url, options);
};

// Expose API base URL and SSE helper
export const getApiBaseUrl = () => API_BASE_URL;
export const openAlertsEventSource = async (): Promise<EventSource> => {
  await ensurePortSet(true);
  return new EventSource(`${API_BASE_URL}/alerts/stream`);
};

// Wrapper for fetch with retry logic
interface FetchOptions extends RequestInit {
  headers?: Record<string, string>;
}

const fetchWithRetry = async (url: string, options: FetchOptions = {}, retries = 3, delay = 1000) => {
  try {
    await ensurePortSet();
    const response = await apiFetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response;
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying ${url}... (${retries} attempts left)`);
      await ensurePortSet(true);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    console.error('API request failed after retries:', error);
    throw error;
  }
};

export const fetchEmployees = async () => {
  const response = await fetchWithRetry('/employees');
  return response.json();
};

export const fetchDepartments = async () => {
  const response = await fetchWithRetry('/departments');
  return response.json();
};

export const createDepartment = async (name: string) => {
  const response = await apiFetch(`${API_BASE_URL}/departments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to create department');
  }
  return response.json();
};

export const updateDepartment = async (id: string, name: string) => {
  const response = await apiFetch(`${API_BASE_URL}/departments/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to update department');
  }
  return response.json();
};

export const removeDuplicateEmployees = async (): Promise<{ success: boolean; deleted: number }> => {
  const response = await apiFetch(`${API_BASE_URL}/employees/remove-duplicates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'فشل حذف التكرارات');
  }
  return response.json();
};

// حذف جميع الموظفين
export const removeAllEmployees = async (): Promise<{ success: boolean; deleted: number }> => {
  const response = await apiFetch(`${API_BASE_URL}/employees/delete-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'فشل حذف جميع الموظفين');
  }
  return response.json();
};

export const deleteDepartment = async (id: string) => {
  const response = await apiFetch(`${API_BASE_URL}/departments/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'فشل في حذف الإدارة');
  }
  return response.json();
};

export const fetchRanks = async () => {
  const response = await apiFetch(`${API_BASE_URL}/ranks`);
  if (!response.ok) {
    throw new Error('Failed to fetch ranks');
  }
  return response.json();
};

export const createRank = async (rank: Omit<Rank, 'id'>) => {
  const response = await apiFetch(`${API_BASE_URL}/ranks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(rank),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to create rank');
  }
  return response.json();
};

export const updateRank = async (id: string, rank: Partial<Omit<Rank, 'id'>>) => {
  const response = await apiFetch(`${API_BASE_URL}/ranks/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(rank),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to update rank');
  }
  return response.json();
};

export const deleteRank = async (id: string) => {
  const response = await apiFetch(`${API_BASE_URL}/ranks/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to delete rank');
  }
  return response.json();
};

// Nationalities
export const fetchNationalities = async () => {
  const response = await apiFetch(`${API_BASE_URL}/nationalities`);
  if (!response.ok) throw new Error('Failed to fetch nationalities');
  return response.json();
};

export const createNationality = async (name: string) => {
  const response = await apiFetch(`${API_BASE_URL}/nationalities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Failed to create nationality');
  return response.json();
};

export const updateNationality = async (id: string, name: string) => {
  const response = await apiFetch(`${API_BASE_URL}/nationalities/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Failed to update nationality');
  return response.json();
};

export const deleteNationality = async (id: string) => {
  const response = await apiFetch(`${API_BASE_URL}/nationalities/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error((await response.json()).error || 'Failed to delete nationality');
  return response.json();
};

// Job titles / positions
export const fetchJobTitles = async () => {
  const response = await apiFetch(`${API_BASE_URL}/job-titles`);
  if (!response.ok) throw new Error('Failed to fetch job titles');
  return response.json();
};

export const createJobTitle = async (name: string, category: string) => {
  const response = await apiFetch(`${API_BASE_URL}/job-titles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, category }),
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Failed to create job title');
  return response.json();
};

export const updateJobTitle = async (id: string, name: string, category: string) => {
  const response = await apiFetch(`${API_BASE_URL}/job-titles/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, category }),
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Failed to update job title');
  return response.json();
};

export const deleteJobTitle = async (id: string) => {
  const response = await apiFetch(`${API_BASE_URL}/job-titles/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error((await response.json()).error || 'Failed to delete job title');
  return response.json();
};

// Sections
export const fetchSections = async () => {
  const response = await apiFetch(`${API_BASE_URL}/sections`);
  if (!response.ok) throw new Error('Failed to fetch sections');
  return response.json();
};

export const createSection = async (name: string, departmentId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/sections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, departmentId }),
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Failed to create section');
  return response.json();
};

export const updateSection = async (id: string, name: string, departmentId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/sections/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, departmentId }),
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Failed to update section');
  return response.json();
};

export const deleteSection = async (id: string) => {
  const response = await apiFetch(`${API_BASE_URL}/sections/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error((await response.json()).error || 'Failed to delete section');
  return response.json();
};

export const fetchShifts = async () => {
  const response = await apiFetch(`${API_BASE_URL}/shifts`);
  if (!response.ok) {
    throw new Error('Failed to fetch shifts');
  }
  return response.json();
};

export const checkShiftExists = async (date: string): Promise<{
  exists: boolean;
  count?: number;
  exceptional?: boolean;
  exceptionalDay?: ShiftDayException | null;
}> => {
  const response = await apiFetch(`${API_BASE_URL}/shifts/exists?date=${date}`);
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }
  return response.json();
};

export const createShift = async (shiftData: {
  shiftDate: string;
  createdBy: string;
  note?: string;
  assignments: Array<{
    employeeId: string;
    status?: string;
    counted?: boolean;
    note?: string;
  }>;
}) => {
  try {
    console.log('Sending request to:', `${API_BASE_URL}/shifts`);
    console.log('Request data:', JSON.stringify(shiftData, null, 2));
    
    const response = await apiFetch(`${API_BASE_URL}/shifts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(shiftData),
    });

    const responseText = await response.text();
    console.log('Raw response:', responseText);

    if (!response.ok) {
      try {
        // Try to parse as JSON
        const errorData = JSON.parse(responseText);
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      } catch (e) {
        // If not JSON, use the raw text
        throw new Error(`HTTP error! status: ${response.status}, response: ${responseText}`);
      }
    }

    // If response is empty, return success
    if (!responseText) {
      return { success: true };
    }

    return JSON.parse(responseText);
  } catch (error) {
    console.error('Error in createShift:', error);
    throw error;
  }
};

export const fetchShiftAssignments = async () => {
  const response = await apiFetch(`${API_BASE_URL}/shiftassignments`);
  if (!response.ok) {
    throw new Error('Failed to fetch shift assignments');
  }
  return response.json();
};

export const fetchShiftDayExceptions = async (params?: { date?: string; from?: string; to?: string }) => {
  const query = new URLSearchParams();
  if (params?.date) query.set('date', params.date);
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  const url = `${API_BASE_URL}/shift-day-exceptions${query.toString() ? `?${query.toString()}` : ''}`;
  const response = await apiFetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch shift day exceptions');
  }
  return response.json();
};

export const createShiftDayException = async (payload: {
  date: string;
  reason: string;
  note?: string;
  createdBy?: string;
}): Promise<ShiftDayException> => {
  const response = await apiFetch(`${API_BASE_URL}/shift-day-exceptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to create shift day exception');
  }
  return response.json();
};

export const updateShiftDayException = async (
  id: string,
  payload: { reason?: string; note?: string }
): Promise<ShiftDayException> => {
  const response = await apiFetch(`${API_BASE_URL}/shift-day-exceptions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to update shift day exception');
  }
  return response.json();
};

export const deleteShiftDayException = async (id: string): Promise<void> => {
  const response = await apiFetch(`${API_BASE_URL}/shift-day-exceptions/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to delete shift day exception');
  }
};

// Employee CRUD
export const createEmployee = async (employee: Omit<Employee, 'id' | 'monthlyShiftCount' | 'lastShiftDate' | 'lastShiftStatus'>) => {
  const response = await apiFetch(`${API_BASE_URL}/employees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(employee),
  });
  if (!response.ok) {
    let message = 'فشل إنشاء الموظف';
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      try {
        const text = await response.text();
        if (text) message = text;
      } catch {}
    }
    throw new Error(message);
  }
  return response.json();
};

export const updateEmployee = async (id: string, employee: Partial<Employee>) => {
  const response = await apiFetch(`${API_BASE_URL}/employees/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(employee),
  });
  if (!response.ok) {
    let message = 'فشل تحديث بيانات الموظف';
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      try {
        const text = await response.text();
        if (text) message = text;
      } catch {}
    }
    throw new Error(message);
  }
  return response.json();
};

export const updateEmployeeManualOrder = async (orderedIds: string[]): Promise<{ success: boolean; updated: number }> => {
  const send = (method: 'PATCH' | 'POST') => apiFetch(`${API_BASE_URL}/employees/manual-order`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedIds }),
  });
  let response = await send('PATCH');
  if (response.status === 404) {
    response = await send('POST');
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'فشل حفظ ترتيب الموظفين');
  }
  return response.json();
};

export const deleteEmployee = async (id: string) => {
  const response = await apiFetch(`${API_BASE_URL}/employees/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete employee');
  return response.json();
};

export type ForceWordSyncProposal = {
  id: string;
  action: 'create' | 'update';
  reason: 'missing_employee' | 'missing_field' | 'different_field';
  employeeId?: string;
  employeeName: string;
  category: string;
  matchedBy?: string | null;
  field?: keyof Employee | string;
  label?: string;
  currentValue?: unknown;
  suggestedValue?: unknown;
  sourceValue?: unknown;
  payload?: Partial<Employee>;
  sourceEmployee: {
    sourceId: string;
    category: string;
    name: string;
    rank?: string | null;
    fileNumber?: string | null;
    militaryNumber?: string | null;
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
    jobTitle?: string | null;
    jobGrade?: string | null;
    educationCertificateType?: string | null;
    educationSpecialization?: string | null;
    phone_number?: string | null;
    hiringDate?: string | null;
    seniorityNumber?: string | null;
    hasWeapon?: boolean | null;
    weaponAttachments?: string | null;
    hasParking?: boolean | null;
    parkingLocation?: string | null;
    parkingNumber?: string | null;
    includeInShifts?: boolean | null;
    shiftNotes?: string | null;
    excludeFromStatistics?: boolean | null;
    isSecondedOutsideGeneralAdministration?: boolean | null;
    secondmentLocation?: string | null;
    rawDepartmentText?: string | null;
    department?: string | null;
    section?: string | null;
  };
  options?: Array<{ value: string; label: string; departmentId?: string }>;
  sectionOptions?: Array<{ value: string; label: string; departmentId?: string }>;
  warning?: string | null;
  confidence?: number;
  reviewRequired?: boolean;
  matchDetails?: string[];
  sourceRawValue?: unknown;
};

export type ForceWordSyncAnalysis = {
  sourceFile: string;
  databasePath: string;
  parsedEmployees: number;
  proposals: ForceWordSyncProposal[];
  warnings?: Array<{
    id: string;
    severity: 'warning' | 'error';
    employeeName: string;
    message: string;
  }>;
  dbOnlyEmployees: Array<Partial<Employee> & { id: string }>;
  departments: Array<{ value: string; label: string }>;
  sections: Array<{ value: string; label: string; departmentId?: string }>;
  analysisKind?: 'force' | 'phones';
  analysisLabel?: string;
  detectedKind?: 'force' | 'phones';
  detectedReason?: string;
};

export type WordAnalyzeInput = string | {
  filePath?: string;
  fileName?: string;
  fileBase64?: string;
  file?: File;
  kind?: 'auto' | 'force' | 'phones';
};

export type LicenseImportSampleRow = {
  id: string;
  employeeId: string;
  licenseType: string;
  licenseDate: string;
  hours: number | null;
  permissionTime: string | null;
  notes: string;
  employeeName: string;
  employeeRank: string;
  fileNumber: string;
  civilId: string;
  existingLicenseId?: string;
  oldEmployeeId?: string;
  oldEmployeeName?: string;
  oldEmployeeRank?: string;
};

export type LicenseImportAnalysis = {
  sourceFile: string;
  sourceType: 'json' | 'sqlite';
  sourceLicenses: number;
  sourceEmployees: number;
  matched: number;
  insertable: number;
  reassignable: number;
  existing: number;
  missingEmployees: string[];
  invalidRows: number;
  duplicatesInSource: number;
  samples: {
    insertable: LicenseImportSampleRow[];
    reassignable: LicenseImportSampleRow[];
    missing: string[];
    existing: LicenseImportSampleRow[];
  };
  applied?: boolean;
  inserted?: number;
  reassigned?: number;
};

const postLicenseImportFile = async (
  endpoint: string,
  file: File
): Promise<LicenseImportAnalysis> => {
  const response = await apiFetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'فشل قراءة ملف الرخص');
  }
  return response.json();
};

export const analyzeLicenseImportFile = async (file: File): Promise<LicenseImportAnalysis> => {
  return postLicenseImportFile('/licenses/import/analyze', file);
};

export const applyLicenseImportFile = async (file: File): Promise<LicenseImportAnalysis> => {
  return postLicenseImportFile('/licenses/import/apply', file);
};

const buildWordAnalyzeBody = (input: WordAnalyzeInput, kind?: 'auto' | 'force' | 'phones') => {
  const body = typeof input === 'string' ? { filePath: input } : { ...input };
  if (kind) body.kind = kind;
  return body;
};

const postWordAnalysis = async (
  endpoint: string,
  input: WordAnalyzeInput,
  kind: 'auto' | 'force' | 'phones'
): Promise<ForceWordSyncAnalysis> => {
  const uploadFile = typeof input === 'object' && input.file ? input.file : null;
  const response = uploadFile
    ? await apiFetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(uploadFile.name),
          'X-Analysis-Kind': kind
        },
        body: uploadFile
      })
    : await apiFetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildWordAnalyzeBody(input, kind)),
      });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'فشل تحليل ملف Word');
  }
  return response.json();
};

export const analyzeWordFileAuto = async (input: WordAnalyzeInput): Promise<ForceWordSyncAnalysis> => {
  return postWordAnalysis('/word-sync/analyze', input, 'auto');
};

export const analyzeForceWordFile = async (input: WordAnalyzeInput): Promise<ForceWordSyncAnalysis> => {
  return postWordAnalysis('/force-word-sync/analyze', input, 'force');
};

export const analyzePhoneWordFile = async (input: WordAnalyzeInput): Promise<ForceWordSyncAnalysis> => {
  return postWordAnalysis('/phone-word-sync/analyze', input, 'phones');
};

// Professional extensions
export const fetchProfessionalExtensionStatus = async (): Promise<ProfessionalExtensionStatusResponse> => {
  const response = await fetchWithRetry('/professional-extensions/status');
  return response.json();
};

export const createProfessionalExtension = async (
  extension: Omit<ProfessionalExtension, 'id' | 'createdAt' | 'updatedAt'>
) => {
  const response = await apiFetch(`${API_BASE_URL}/professional-extensions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(extension),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to create professional extension');
  }
  return response.json();
};

export const updateProfessionalExtension = async (
  id: string,
  extension: Partial<Omit<ProfessionalExtension, 'id' | 'createdAt' | 'updatedAt'>>
) => {
  const response = await apiFetch(`${API_BASE_URL}/professional-extensions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(extension),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to update professional extension');
  }
  return response.json();
};

export const deleteProfessionalExtension = async (id: string) => {
  const response = await apiFetch(`${API_BASE_URL}/professional-extensions/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to delete professional extension');
  }
  return response.json();
};

// Alerts/Notifications API
export const fetchAlerts = async (params?: {
  status?: string;
  type?: string;
  severity?: string;
  limit?: number;
  offset?: number;
}) => {
  const queryParams = new URLSearchParams();
  if (params?.status) queryParams.append('status', params.status);
  if (params?.type) queryParams.append('type', params.type);
  if (params?.severity) queryParams.append('severity', params.severity);
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.offset) queryParams.append('offset', params.offset.toString());

  const response = await apiFetch(`${API_BASE_URL}/alerts?${queryParams}`);
  if (!response.ok) {
    throw new Error('Failed to fetch alerts');
  }
  const result = await response.json();
  return result.data || []; // Return the data array, or empty array if no data
};

export const getUnreadAlertsCount = async () => {
  const response = await apiFetch(`${API_BASE_URL}/alerts/unread-count`);
  if (!response.ok) {
    throw new Error('Failed to fetch unread alerts count');
  }
  return response.json();
};

export const markAlertAsRead = async (alertId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/alerts/${alertId}/read`, {
    method: 'PATCH',
  });
  if (!response.ok) {
    throw new Error('Failed to mark alert as read');
  }
  return response.json();
};

export const markAlertAsResolved = async (alertId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/alerts/${alertId}/resolve`, {
    method: 'PATCH',
  });
  if (!response.ok) {
    throw new Error('Failed to resolve alert');
  }
  return response.json();
};

export const dismissAlert = async (alertId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/alerts/${alertId}/dismiss`, {
    method: 'PATCH',
  });
  if (!response.ok) {
    throw new Error('Failed to dismiss alert');
  }
  return response.json();
};

export const createAlert = async (alertData: Omit<Alert, 'id' | 'createdAt' | 'updatedAt'>) => {
  const response = await apiFetch(`${API_BASE_URL}/alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(alertData),
  });
  if (!response.ok) {
    throw new Error('Failed to create alert');
  }
  return response.json();
};

export const deleteAlert = async (alertId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/alerts/${alertId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete alert');
  }
  return response.json();
};

// Notification Settings API
export const fetchNotificationSettings = async (userId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/notification-settings/${userId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch notification settings');
  }
  return response.json();
};

export const updateNotificationSettings = async (userId: string, settings: Partial<NotificationSettings>) => {
  const response = await apiFetch(`${API_BASE_URL}/notification-settings/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new Error('Failed to update notification settings');
  }
  return response.json();
};

// Maintenance API
export const createBackup = async (): Promise<{ filename: string }> => {
  const response = await apiFetch(`${API_BASE_URL}/backup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error('Failed to create backup');
  }
  return response.json();
};

// Settings API
export interface SettingsResponse {
  [key: string]: {
    value: string;
    description: string;
  };
}

export const fetchSettings = async (): Promise<SettingsResponse> => {
  const response = await apiFetch(`${API_BASE_URL}/settings`);
  if (!response.ok) {
    throw new Error('Failed to fetch settings');
  }
  return response.json();
};

export const fetchLicenseStats = async () => {
  const response = await fetchWithRetry('/stats');
  return response.json();
};

export const fetchLicenses = async () => {
  const response = await fetchWithRetry('/licenses');
  return response.json();
};

export const updateSettings = async (
  settings: Record<string, string | number | boolean>,
  password: string
): Promise<{ success: boolean; message: string }> => {
  const response = await apiFetch(`${API_BASE_URL}/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Settings-Password': password,
    },
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || 'فشل في حفظ الإعدادات');
  }

  return response.json();
};

export const fetchAuditLog = async (params: {
  entityType?: string;
  entityTypes?: string[];
  excludeEntityTypes?: string[];
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ data: AuditLogEntry[]; total: number; limit: number; offset: number }> => {
  const query = new URLSearchParams();
  if (params.entityType) query.set('entityType', params.entityType);
  if (params.entityTypes?.length) query.set('entityTypes', params.entityTypes.join(','));
  if (params.excludeEntityTypes?.length) query.set('excludeEntityTypes', params.excludeEntityTypes.join(','));
  if (params.entityId) query.set('entityId', params.entityId);
  if (params.action) query.set('action', params.action);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));

  const response = await fetchWithRetry(`/audit-log?${query.toString()}`);
  return response.json();
};

// Shift API

export const updateShiftReceptionStatus = async (shiftId: string, paperCopyReceived: boolean): Promise<Shift> => {
  const response = await apiFetch(`${API_BASE_URL}/shifts/${shiftId}/reception`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ paperCopyReceived }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Failed to update shift reception status (HTTP ${response.status})`;
    try {
      const errorBody = JSON.parse(errorText);
      errorMessage = errorBody.error || errorBody.message || errorMessage;
    } catch {
      if (errorText) {
        errorMessage = `${errorMessage}: ${errorText}`;
      }
    }
    console.error('Failed to update shift reception status:', errorMessage);
    throw new Error(errorMessage);
  }
  return response.json();
};

export const recordAbsence = async (assignmentId: string, note: string | null): Promise<void> => {
  const response = await apiFetch(`${API_BASE_URL}/shiftassignments/${assignmentId}/absence`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ note }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to record absence');
  }
};

export const fetchShiftsByMonth = async (year: number, month: number) => {
  const response = await apiFetch(`${API_BASE_URL}/shifts/month?year=${year}&month=${month}`);
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Error from /api/shifts/month: ${response.status} - ${errorBody}`);
    throw new Error('Failed to fetch shifts by month');
  }
  return response.json();
};

export const deleteShift = async (shiftId: string): Promise<void> => {
  const response = await apiFetch(`${API_BASE_URL}/shifts/${shiftId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to delete shift');
  }

  return response.json();
};

export const updateShiftAssignmentEmployee = async (assignmentId: string, newEmployeeId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/shiftassignments/${assignmentId}/employee`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ newEmployeeId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'فشل في تعديل الموظف');
  }

  return response.json();
};

// Add a new shift assignment (assign an employee to a shift)
export const addShiftAssignment = async (shiftId: string, employeeId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/shiftassignments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ shiftId, employeeId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'فشل في إضافة الموظف إلى الخفارة');
  }

  return response.json();
};

// Remove an existing shift assignment
export const removeShiftAssignment = async (assignmentId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/shiftassignments/${assignmentId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'فشل في إزالة الموظف من الخفارة');
  }

  return response.json();
};

export const updateShiftDetails = async (shiftId: string, title: string, notes: string): Promise<Shift> => {
  const response = await apiFetch(`${API_BASE_URL}/shifts/${shiftId}/details`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, notes }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to update shift details');
  }

  return response.json();
};
