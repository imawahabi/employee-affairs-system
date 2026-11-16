const OFFICER_RANKS = [
  'لواء',
  'عميد',
  'عقيد',
  'مقدم',
  'رائد',
  'نقيب',
  'ملازم أول',
  'ملازم',
];

const NCO_RANKS = [
  'و.أ.ضابط',
  'و.ضابط',
  'رقيب أول',
  'رقيب',
  'عريف',
  'و.عريف',
  'شرطي',
];

const normalizeArabicText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .replace(/[^\u0600-\u06FF0-9a-z\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const buildBaseRankMap = (ranks: string[]) =>
  ranks.map((name, index) => {
    const normalized = normalizeArabicText(name);
    return {
      name,
      normalized,
      compact: normalized.replace(/\s+/g, ''),
      order: index + 1,
    };
  });

const OFFICER_RANK_MAP = buildBaseRankMap(OFFICER_RANKS);
const NCO_RANK_MAP = buildBaseRankMap(NCO_RANKS);

const findRankOrder = (rankName: string, map: { normalized: string; compact: string; order: number }[]) => {
  const normalized = normalizeArabicText(rankName);
  const compact = normalized.replace(/\s+/g, '');
  for (const item of map) {
    if (!item.normalized) continue;
    if (normalized.includes(item.normalized) || compact.includes(item.compact)) {
      return item.order;
    }
  }
  return Number.MAX_SAFE_INTEGER;
};

export const getRankOrder = (rankName?: string, category?: string) => {
  if (!rankName) return Number.MAX_SAFE_INTEGER;
  if (category === 'ضباط') {
    return findRankOrder(rankName, OFFICER_RANK_MAP);
  }
  if (category === 'ضباط صف') {
    return findRankOrder(rankName, NCO_RANK_MAP);
  }
  return Number.MAX_SAFE_INTEGER;
};

export const getCategoryOrder = (category?: string) => {
  const categoryOrder: Record<string, number> = {
    'ضباط': 1,
    'ضباط صف': 2,
    'مهنيين': 3,
    'مدنيين': 4,
  };
  return categoryOrder[category || ''] ?? Number.MAX_SAFE_INTEGER;
};

export const normalizeRankName = (value: string) => normalizeArabicText(value);
