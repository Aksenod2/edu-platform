// Тесты валидации телефона (Волна 1 «правовой минимум»): normalizePhone убирает
// форматирование (пробелы/скобки/дефисы), isValidPhone проверяет международный
// формат (опциональный «+», 10–15 цифр). Пустая строка = «телефон не указан» (null).
import { describe, it, expect } from 'vitest';
import { normalizePhone, isValidPhone } from '../validation.js';

describe('normalizePhone', () => {
  it('убирает пробелы, скобки и дефисы', () => {
    expect(normalizePhone('+7 (999) 123-45-67')).toBe('+79991234567');
  });

  it('сохраняет ведущий «+»', () => {
    expect(normalizePhone('+49 30 901820')).toBe('+4930901820');
  });

  it('номер без «+» остаётся без «+»', () => {
    expect(normalizePhone('8 999 123 45 67')).toBe('89991234567');
  });

  it('пустая строка → null (телефон не указан / очистка поля)', () => {
    expect(normalizePhone('')).toBeNull();
  });

  it('строка из одних разделителей → null', () => {
    expect(normalizePhone(' ( ) - ')).toBeNull();
  });

  it('НЕ трогает посторонние символы (их отбракует isValidPhone)', () => {
    expect(normalizePhone('abc')).toBe('abc');
  });
});

describe('isValidPhone', () => {
  it('принимает международный номер с «+» (11 цифр)', () => {
    expect(isValidPhone('+79991234567')).toBe(true);
  });

  it('принимает номер без «+»', () => {
    expect(isValidPhone('89991234567')).toBe(true);
  });

  it('принимает границы 10 и 15 цифр', () => {
    expect(isValidPhone('1234567890')).toBe(true);
    expect(isValidPhone('+123456789012345')).toBe(true);
  });

  it('отклоняет короче 10 и длиннее 15 цифр', () => {
    expect(isValidPhone('123456789')).toBe(false);
    expect(isValidPhone('+1234567890123456')).toBe(false);
  });

  it('отклоняет буквы и «+» не в начале', () => {
    expect(isValidPhone('abc')).toBe(false);
    expect(isValidPhone('7999+1234567')).toBe(false);
  });

  it('работает в паре с normalizePhone: «+7 (999) 123-45-67» валиден', () => {
    const normalized = normalizePhone('+7 (999) 123-45-67');
    expect(normalized).not.toBeNull();
    expect(isValidPhone(normalized!)).toBe(true);
  });
});
