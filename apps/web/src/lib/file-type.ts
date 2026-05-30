/**
 * Определение типа файла нашего хранилища по расширению имени — для выбора
 * способа предпросмотра в лайтбоксе (см. FileLightbox).
 */

export type PreviewKind = 'image' | 'pdf' | 'markdown' | 'text' | 'unknown';

function ext(fileName?: string | null): string {
  if (!fileName) return '';
  const name = fileName.toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1);
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp']);
const TEXT_EXT = new Set([
  'txt',
  'csv',
  'log',
  'json',
  'yml',
  'yaml',
  'xml',
  'sql',
  'ini',
  'env',
  'conf',
  'tsv',
]);

/** true для вложений, которые умеем рендерить как markdown (по имени файла). */
export function isMarkdownFile(fileName?: string | null): boolean {
  const e = ext(fileName);
  return e === 'md' || e === 'markdown';
}

/** Категория предпросмотра по расширению имени файла. */
export function previewKind(fileName?: string | null): PreviewKind {
  const e = ext(fileName);
  if (IMAGE_EXT.has(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (e === 'md' || e === 'markdown') return 'markdown';
  if (TEXT_EXT.has(e)) return 'text';
  return 'unknown';
}
