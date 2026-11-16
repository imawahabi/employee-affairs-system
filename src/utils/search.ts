const arabicDigitMap: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

export const normalizeArabicDigits = (value: string) =>
  value.replace(/[٠-٩]/g, (digit) => arabicDigitMap[digit] ?? digit)
    .replace(/[۰-۹]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0x06F0 + 48));

export const normalizeArabicSearch = (value?: string | null) =>
  normalizeArabicDigits(String(value || ''))
    .toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ء/g, '')
    .replace(/ـ/g, '')
    .replace(/[^0-9a-z\u0600-\u06FF]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const getSearchTokens = (value?: string | null) =>
  normalizeArabicSearch(value).split(' ').filter(Boolean);

export const matchesArabicSearch = (values: Array<string | number | null | undefined>, tokens: string[]) => {
  if (!tokens.length) return true;
  const normalized = normalizeArabicSearch(values.filter(Boolean).join(' '));
  const compact = normalized.replace(/\s+/g, '');
  return tokens.every((token) => normalized.includes(token) || compact.includes(token));
};
