const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();


export const normalizeOrganizationName = (value?: string | null) => {
  if (!value) return '';
  const trimmed = normalizeWhitespace(value);
  return normalizeWhitespace(
    trimmed.replace(/^(?:ال)?(?:إدارة|ادارة|قسم)\s*[:：-]?\s*/u, '')
  );
};

export const isSameOrganizationName = (left?: string | null, right?: string | null) => {
  if (!left && !right) return true;
  return normalizeOrganizationName(left) === normalizeOrganizationName(right);
};

export const buildDepartmentNameMap = (departments: Array<{ name: string }>) => {
  const map = new Map<string, string>();
  departments.forEach((dep) => {
    const key = normalizeOrganizationName(dep.name);
    if (!key) return;
    map.set(key, normalizeWhitespace(dep.name));
  });
  return map;
};

export const buildSectionNameMap = (
  sections: Array<{ name: string; departmentId: string }>,
  departments: Array<{ id: string; name: string }>
) => {
  const map = new Map<string, string>();
  sections.forEach((section) => {
    const departmentName = departments.find((dep) => dep.id === section.departmentId)?.name || '';
    const departmentKey = normalizeOrganizationName(departmentName);
    const sectionKey = normalizeOrganizationName(section.name);
    if (!sectionKey) return;
    const key = departmentKey ? `${departmentKey}__${sectionKey}` : sectionKey;
    map.set(key, normalizeWhitespace(section.name));
    if (!map.has(sectionKey)) {
      map.set(sectionKey, normalizeWhitespace(section.name));
    }
  });
  return map;
};

export const resolveDepartmentName = (
  value?: string | null,
  departmentMap?: Map<string, string>
) => {
  const trimmed = normalizeWhitespace(value || '');
  if (!trimmed) return '';
  const key = normalizeOrganizationName(trimmed);
  return (departmentMap && departmentMap.get(key)) || trimmed;
};

export const resolveSectionName = (
  departmentValue?: string | null,
  sectionValue?: string | null,
  sectionMap?: Map<string, string>
) => {
  const sectionTrimmed = normalizeWhitespace(sectionValue || '');
  if (!sectionTrimmed) return '';
  const departmentKey = normalizeOrganizationName(departmentValue || '');
  const sectionKey = normalizeOrganizationName(sectionTrimmed);
  const key = departmentKey ? `${departmentKey}__${sectionKey}` : sectionKey;
  return (sectionMap && (sectionMap.get(key) || sectionMap.get(sectionKey))) || sectionTrimmed;
};

export const formatDepartmentLabel = (
  value?: string | null,
  departmentMap?: Map<string, string>
) => {
  return resolveDepartmentName(value, departmentMap);
};

export const formatSectionLabel = (
  value?: string | null,
  sectionMap?: Map<string, string>,
  departmentValue?: string | null
) => {
  return resolveSectionName(departmentValue || '', value, sectionMap);
};
