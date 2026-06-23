/**
 * Инициалы из имени для аватаров (первые буквы слов, до 2 символов, uppercase).
 * Канонический дом — реализация перенесена из components/lessons/teacher-picker.
 * Безопасна к пустому/одному слову/null/undefined.
 */
export function initials(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
