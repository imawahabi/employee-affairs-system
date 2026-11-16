import { Employee } from '../types';

type EmployeeNameInput = Pick<
  Employee,
  'name' | 'firstName' | 'secondName' | 'thirdName' | 'fourthName' | 'familyName' | 'educationCertificateType'
>;

const DOCTOR_PREFIX_PATTERN = /^د\.?\s+/;

export const formatCompactEmployeeName = (name?: string | null) => {
  const rawName = (name || '').replace(/\s+/g, ' ').trim();
  if (!rawName) return '';

  const hasDoctorPrefix = DOCTOR_PREFIX_PATTERN.test(rawName);
  const nameWithoutPrefix = hasDoctorPrefix ? rawName.replace(DOCTOR_PREFIX_PATTERN, '').trim() : rawName;
  const parts = nameWithoutPrefix.split(' ').filter(Boolean);
  const compactName = parts.length > 4
    ? [parts[0], parts[1], parts[parts.length - 2], parts[parts.length - 1]].join(' ')
    : nameWithoutPrefix;

  return hasDoctorPrefix ? `د. ${compactName}` : compactName;
};

export const buildEmployeeFullName = (employee: Partial<EmployeeNameInput>) =>
  [
    employee.firstName,
    employee.secondName,
    employee.thirdName,
    employee.fourthName,
    employee.familyName,
  ]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(' ') || employee.name?.trim() || '';

export const formatEmployeeNameByParts = (
  employee: Partial<EmployeeNameInput>,
  partCount: 2 | 3 | 4 | 5
) => {
  const structuredParts = [
    employee.firstName,
    employee.secondName,
    employee.thirdName,
    employee.fourthName,
    employee.familyName,
  ]
    .map((part) => (part || '').trim())
    .filter(Boolean);

  const rawName = buildEmployeeFullName(employee);
  const hasDoctorPrefix = DOCTOR_PREFIX_PATTERN.test(rawName);
  const nameWithoutPrefix = hasDoctorPrefix ? rawName.replace(DOCTOR_PREFIX_PATTERN, '').trim() : rawName;
  const fallbackParts = nameWithoutPrefix.split(' ').filter(Boolean);
  const parts = structuredParts.length > 0 ? structuredParts : fallbackParts;

  if (parts.length <= partCount) {
    return hasDoctorPrefix ? `د. ${parts.join(' ')}` : parts.join(' ');
  }

  const selectedParts = partCount === 2
    ? [parts[0], parts[parts.length - 1]]
    : partCount === 3
      ? [parts[0], parts[1], parts[parts.length - 1]]
      : partCount === 4
        ? [parts[0], parts[1], parts[2], parts[parts.length - 1]]
        : parts;

  const name = selectedParts.filter(Boolean).join(' ');
  return hasDoctorPrefix ? `د. ${name}` : name;
};

export const formatEmployeeDisplayName = (employee: EmployeeNameInput) => {
  const name = buildEmployeeFullName(employee);
  if (!name) return '';
  const hasDoctorate = (employee.educationCertificateType || '').includes('دكتوراه');
  const alreadyPrefixed = DOCTOR_PREFIX_PATTERN.test(name);
  if (hasDoctorate && !alreadyPrefixed) {
    return `د. ${name}`;
  }
  return name;
};

export const formatShiftEmployeeDisplayName = (employee: EmployeeNameInput) => {
  const compactName = formatCompactEmployeeName(buildEmployeeFullName(employee));
  if (!compactName) return '';

  const hasDoctorate = (employee.educationCertificateType || '').includes('دكتوراه');
  const alreadyPrefixed = DOCTOR_PREFIX_PATTERN.test(compactName);
  if (hasDoctorate && !alreadyPrefixed) {
    return `د. ${compactName}`;
  }
  return compactName;
};
