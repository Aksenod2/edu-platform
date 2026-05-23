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
