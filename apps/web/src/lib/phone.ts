// Валидация телефона на фронте — зеркало apps/api/src/lib/validation.ts:
// нормализованный номер = опциональный «+» и 10–15 цифр (E.164 допускает до 15).

export const PHONE_HINT = 'В международном формате, например +79991234567';

export const PHONE_FORMAT_ERROR =
  'Телефон должен быть в международном формате: «+» и 10–15 цифр, например +79991234567';

/** Убирает символы форматирования (пробелы, скобки, дефисы): «+7 (999) 123-45-67» → «+79991234567». */
export function normalizePhone(raw: string): string {
  return raw.replace(/[\s()-]/g, '');
}

/** Проверка НОРМАЛИЗОВАННОГО телефона. */
export function isValidPhone(phone: string): boolean {
  return /^\+?\d{10,15}$/.test(phone);
}
