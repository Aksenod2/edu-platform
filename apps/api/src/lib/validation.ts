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
