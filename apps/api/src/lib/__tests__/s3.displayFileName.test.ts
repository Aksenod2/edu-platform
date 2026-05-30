import { describe, it, expect } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

import { displayFileName } from '../s3.js';

describe('displayFileName — человекочитаемое имя файла сдачи', () => {
  it('корректное имя отдаётся как есть', () => {
    expect(displayFileName('Моя работа.pdf', 'assignments/1700000000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf')).toBe(
      'Моя работа.pdf',
    );
  });

  it('кириллица в имени сохраняется', () => {
    expect(displayFileName('отчёт.md', 'assignments/1700000000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md')).toBe(
      'отчёт.md',
    );
  });

  it('если fileName равен ключу — берём базовое имя из ключа без служебного префикса', () => {
    const key = 'assignments/1700000000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf';
    expect(displayFileName(key, key)).toBe('.pdf');
  });

  it('fileName выглядит как ключ (содержит ts-uuid) — не показываем сырой ключ, берём имя из fileUrl', () => {
    const key = 'assignments/1700000000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.docx';
    // fileName заражён значением ключа без папки
    const polluted = '1700000000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.docx';
    expect(displayFileName(polluted, key)).toBe('.docx');
  });

  it('fileName пустой — фолбэк из ключа', () => {
    const key = 'assignments/1700000000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.zip';
    expect(displayFileName(null, key)).toBe('.zip');
  });

  it('нет ни имени, ни ключа → null', () => {
    expect(displayFileName(null, null)).toBeNull();
    expect(displayFileName('', '')).toBeNull();
  });

  it('имя без расширения, не похожее на ключ, отдаётся как есть', () => {
    expect(displayFileName('readme', 'assignments/1700000000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe('readme');
  });
});
