// Блокировка зарубежной почты при назначении email пользователю (issue #132).
//
// Ст. 10.7 149-ФЗ запрещает регистрацию российских пользователей на сервисах
// с использованием иностранных email. Полного реестра «иностранных почтовых
// сервисов» не существует, поэтому подход — чёрный список ОСНОВНЫХ зарубежных
// сервисов как добросовестное исполнение требования. Список пополняется здесь;
// фронт и бэк используют один и тот же модуль (@platform/shared).
//
// ВАЖНО: блокируем только НАЗНАЧЕНИЕ нового email (регистрация, создание
// студента, смена email). Вход/refresh/восстановление пароля существующих
// пользователей с зарубежной почтой продолжают работать.
export const FOREIGN_EMAIL_DOMAINS: readonly string[] = [
  // Google
  'gmail.com',
  'googlemail.com',
  // Microsoft
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  // Yahoo
  'yahoo.com',
  'ymail.com',
  // Apple
  'icloud.com',
  'me.com',
  'mac.com',
  // Proton
  'proton.me',
  'protonmail.com',
  'pm.me',
  // Прочие крупные зарубежные сервисы
  'aol.com',
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'zoho.com',
  'fastmail.com',
  'mail.com',
  // Основные региональные варианты
  'hotmail.fr',
  'hotmail.de',
  'hotmail.co.uk',
  'outlook.de',
  'outlook.fr',
  'yahoo.co.uk',
  'yahoo.fr',
  'yahoo.de',
  'live.fr',
  'live.de',
  'live.co.uk',
];

const FOREIGN_EMAIL_DOMAIN_SET = new Set(FOREIGN_EMAIL_DOMAINS);

/**
 * Зарубежная ли почта: домен после ПОСЛЕДНЕЙ «@» (trim + lowercase) ищется в
 * чёрном списке. Кривой email (без «@») → false: формат ловит валидация email,
 * здесь только происхождение домена.
 */
export function isForeignEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex === -1) return false;
  return FOREIGN_EMAIL_DOMAIN_SET.has(normalized.slice(atIndex + 1));
}

// Сообщение для студенческих точек (самостоятельная регистрация/смена email).
export const FOREIGN_EMAIL_STUDENT_MESSAGE =
  'К сожалению, по требованиям российского законодательства мы не можем зарегистрировать аккаунт на зарубежную почту (Gmail, Outlook, iCloud и др.). Пожалуйста, укажите адрес российского сервиса — например, Яндекс Почты или Mail.ru.';

// Короткое сообщение для админских точек (создание/правка студента админом).
export const FOREIGN_EMAIL_ADMIN_MESSAGE =
  'Зарубежная почта недоступна по требованиям закона (149-ФЗ) — укажите российский адрес.';
