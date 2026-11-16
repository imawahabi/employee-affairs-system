const normalizeCivilIdDigits = (value?: string | null) =>
  String(value || '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/\D/g, '');

export const birthDateFromCivilId = (value?: string | null) => {
  const digits = normalizeCivilIdDigits(value);
  if (!/^[23]\d{11}$/.test(digits)) return null;

  const century = digits[0] === '2' ? '19' : '20';
  const year = Number(`${century}${digits.slice(1, 3)}`);
  const month = Number(digits.slice(3, 5));
  const day = Number(digits.slice(5, 7));

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
