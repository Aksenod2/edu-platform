// Запрет зарубежной почты при регистрации — зеркало серверной валидации.
// Источник истины (список доменов и текст для студентов) — в общем пакете
// `@platform/shared`; здесь только реэкспорт по образцу `@/lib/api-endpoints`.
export { isForeignEmail, FOREIGN_EMAIL_STUDENT_MESSAGE } from '@platform/shared';

/**
 * Email синтаксически полон (`имя@домен.зона`) — подсказку о зарубежной почте
 * показываем только после этого, чтобы не ругаться, пока человек печатает.
 */
export function isEmailSyntaxComplete(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
