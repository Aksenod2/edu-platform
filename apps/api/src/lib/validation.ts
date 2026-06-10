// Единые правила валидации учётных данных, чтобы и /auth, и публичная регистрация
// по инвайт-ссылке проверяли email/пароль одинаково (одно правило на весь API).

// Простая проверка формата email (как в HTML5 type=email, без избыточной строгости).
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Минимальная длина пароля (совпадает с /auth/reset-password, /auth/change-password и пр.).
export const MIN_PASSWORD_LENGTH = 6;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function isValidPassword(password: string): boolean {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH;
}

// Нормализация email: регистр и пробелы по краям не должны влиять на поиск/уникальность.
// Применяем ЕДИНООБРАЗНО везде, где email приходит от пользователя (вход, сброс, создание,
// смена) — иначе аккаунт, заведённый как "Marina@mail.ru", не найдётся по "marina@mail.ru".
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ─── Телефон (Волна 1 «правовой минимум») ───────────────────────────────────
// Храним телефон в нормализованном виде: только цифры и (опционально) ведущий «+».
// Формат международный, без привязки к стране: 10–15 цифр (E.164 допускает до 15).

// Нормализованный телефон: опциональный «+», затем 10–15 цифр.
export const PHONE_REGEX = /^\+?\d{10,15}$/;

/**
 * Нормализация телефона: убирает пробелы, скобки и дефисы (символы форматирования,
 * которые обычно вводят люди: «+7 (999) 123-45-67»). Пустая строка (или строка из
 * одних разделителей) трактуется как «телефон не указан» → null (так фронт может
 * очистить поле, прислав "").
 */
export function normalizePhone(raw: string): string | null {
  const normalized = raw.replace(/[\s()-]/g, '');
  return normalized === '' ? null : normalized;
}

/** Проверка НОРМАЛИЗОВАННОГО телефона: опциональный «+» и 10–15 цифр. */
export function isValidPhone(phone: string): boolean {
  return PHONE_REGEX.test(phone);
}
