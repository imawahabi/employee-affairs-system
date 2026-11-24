import { Employee, License } from '../types';

export const CATEGORY_ORDER: { [key: string]: number } = {
  'قيادات': 1,
  'مشرفون': 2,
  'فني': 3,
  'إداري': 4,
};

export const OFFICER_RANK_ORDER: { [key: string]: number } = {
  'مدير عام': 1,
  'مدير إدارة': 2,
  'مساعد مدير إدارة': 3,
  'رئيس قسم': 4,
  'مشرف أول': 5,
  'مشرف': 6,
  'موظف أول': 7,
};

export const NCO_RANK_ORDER: { [key: string]: number } = {
  'مشرف': 1,
  'مشرف مساعد': 2,
  'موظف أول': 3,
  'موظف': 4,
  'موظف خدمات': 5
};

export const sortEmployees = (employees: Employee[]): Employee[] => {
  return [...employees].sort((a, b) => {
    const categoryA = CATEGORY_ORDER[a.category] || 99;
    const categoryB = CATEGORY_ORDER[b.category] || 99;

    if (categoryA !== categoryB) {
      return categoryA - categoryB;
    }

    if (a.category === 'قيادات') {
      const rankA = OFFICER_RANK_ORDER[a.rank.trim()] || 99;
      const rankB = OFFICER_RANK_ORDER[b.rank.trim()] || 99;
      if (rankA !== rankB) return rankA - rankB;
    }

    if (a.category === 'مشرفون') {
      const rankA = NCO_RANK_ORDER[a.rank] || 99;
      const rankB = NCO_RANK_ORDER[b.rank] || 99;
      if (rankA !== rankB) return rankA - rankB;
    }

    return a.full_name.localeCompare(b.full_name);
  });
};

export const sortLicenses = (licenses: License[]): License[] => {
  return [...licenses].sort((a, b) => {
    const dateA = new Date(a.created_at || a.license_date).getTime() || 0;
    const dateB = new Date(b.created_at || b.license_date).getTime() || 0;
    return dateB - dateA;
  });
};
