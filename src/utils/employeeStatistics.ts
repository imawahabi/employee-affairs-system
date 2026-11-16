import { Employee } from '../types';

const toBoolean = (value: unknown): boolean => {
  return value === true || value === 1 || value === '1';
};

export const isEmployeeExcludedFromStatistics = (employee?: Partial<Employee> | null): boolean => {
  if (!employee) return false;
  return toBoolean(employee.excludeFromStatistics);
};

export const shouldIncludeEmployeeInStatistics = (employee?: Partial<Employee> | null): boolean => {
  if (!employee) return false;
  return employee.status !== 'inactive' && !isEmployeeExcludedFromStatistics(employee);
};

export const getStatisticsEmployeeBuckets = <T extends Partial<Employee>>(employees: T[]) => {
  const included: T[] = [];
  const excluded: T[] = [];
  const inactive: T[] = [];

  employees.forEach((employee) => {
    if (employee.status === 'inactive') {
      inactive.push(employee);
      return;
    }

    if (shouldIncludeEmployeeInStatistics(employee)) {
      included.push(employee);
    } else {
      excluded.push(employee);
    }
  });

  return { included, excluded, inactive };
};
