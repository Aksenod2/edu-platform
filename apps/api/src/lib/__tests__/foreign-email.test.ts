// Юнит-тесты isForeignEmail (@platform/shared) — блокировка зарубежной почты
// при назначении email (ст. 10.7 149-ФЗ, issue #132). Тест живёт в @platform/api:
// у пакета shared нет своего тест-раннера, а api — основной потребитель проверки
// (аналогично api-docs-parity.test.ts, который тоже тестирует @platform/shared).
import { describe, it, expect } from 'vitest';
import {
  FOREIGN_EMAIL_DOMAINS,
  isForeignEmail,
  FOREIGN_EMAIL_STUDENT_MESSAGE,
  FOREIGN_EMAIL_ADMIN_MESSAGE,
} from '@platform/shared/foreign-email';

describe('isForeignEmail', () => {
  it('блокирует каждый домен из чёрного списка', () => {
    for (const domain of FOREIGN_EMAIL_DOMAINS) {
      expect(isForeignEmail(`user@${domain}`), domain).toBe(true);
    }
  });

  it('не зависит от регистра и пробелов по краям', () => {
    expect(isForeignEmail('  User@GMail.COM ')).toBe(true);
    expect(isForeignEmail('\tstudent@Outlook.Com\n')).toBe(true);
    expect(isForeignEmail('  Marina@Yandex.RU ')).toBe(false);
  });

  it('российские и корпоративные домены проходят', () => {
    expect(isForeignEmail('user@mail.ru')).toBe(false);
    expect(isForeignEmail('user@yandex.ru')).toBe(false);
    expect(isForeignEmail('user@bk.ru')).toBe(false);
    expect(isForeignEmail('user@rambler.ru')).toBe(false);
    expect(isForeignEmail('user@domain.ru')).toBe(false);
  });

  it('строка без @ → false (формат ловит валидация email, не эта проверка)', () => {
    expect(isForeignEmail('not-an-email')).toBe(false);
    expect(isForeignEmail('')).toBe(false);
    expect(isForeignEmail('gmail.com')).toBe(false);
  });

  it('домен берётся после ПОСЛЕДНЕЙ @', () => {
    // Кавычки в local-part допускают @ внутри: "user@gmail.com"@yandex.ru —
    // фактический домен yandex.ru, не блокируем.
    expect(isForeignEmail('"user@gmail.com"@yandex.ru')).toBe(false);
    expect(isForeignEmail('"user@yandex.ru"@gmail.com')).toBe(true);
  });

  it('поддомены зарубежных сервисов НЕ в списке → проходят (чёрный список точных доменов)', () => {
    expect(isForeignEmail('user@corp.gmail.com')).toBe(false);
  });

  it('тексты сообщений заданы (контракт фронта)', () => {
    expect(FOREIGN_EMAIL_STUDENT_MESSAGE).toContain('зарубежную почту');
    expect(FOREIGN_EMAIL_ADMIN_MESSAGE).toContain('149-ФЗ');
  });
});
