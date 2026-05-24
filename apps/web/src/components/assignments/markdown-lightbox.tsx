'use client';

import { useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Eye, Loader2 } from 'lucide-react';
import { cn } from '@platform/ui/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toProxiedFileUrl } from '@/lib/api';

/** true для вложений, которые умеем рендерить как markdown (по имени файла). */
export function isMarkdownFile(fileName?: string | null): boolean {
  if (!fileName) return false;
  const name = fileName.toLowerCase();
  return name.endsWith('.md') || name.endsWith('.markdown');
}

// Кастомные стили элементов markdown на семантических токенах (плагина prose
// в проекте нет, поэтому стилизуем напрямую). Размер — text-sm, мягкий leading.
const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 mb-3 text-xl font-semibold text-foreground first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-5 mb-2 text-lg font-semibold text-foreground first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-4 mb-2 text-base font-semibold text-foreground first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3 mb-1.5 text-sm font-semibold text-foreground first:mt-0">{children}</h4>
  ),
  p: ({ children }) => <p className="my-2 leading-relaxed text-foreground">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-4"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-foreground">{children}</ul>,
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 text-foreground">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border pl-4 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  // Инлайн-код и блоки кода различаем по наличию переноса строки в содержимом.
  code: ({ className, children }) => {
    const isBlock = /\n/.test(String(children));
    if (isBlock) {
      return (
        <code className={cn('block font-mono text-xs text-foreground', className)}>{children}</code>
      );
    }
    return (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
        {children}
      </code>
    );
  },
  // Блок кода скроллится по горизонтали — на узких экранах нет выезда вёрстки.
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-md border bg-muted p-3">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-foreground">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted px-2 py-1 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
  img: ({ src, alt }) => (
    <img
      src={typeof src === 'string' ? src : undefined}
      alt={alt ?? ''}
      className="my-3 max-w-full rounded-md"
    />
  ),
};

/**
 * Кнопка «Просмотр» + лайтбокс (Dialog) для предпросмотра .md-вложения без
 * скачивания: грузит текст по подписанному URL и рендерит markdown на месте.
 * Сырой HTML НЕ рендерим (нет rehype-raw) — защита от XSS.
 */
export function MarkdownLightbox({
  fileName,
  url,
  triggerVariant = 'ghost',
  triggerSize = 'sm',
  className,
}: {
  fileName: string;
  /**
   * Подписанный URL файла (приходит с бэка абсолютным: `${API_BASE_URL}/files/...?exp&sig`).
   * Для предпросмотра фетчим через same-origin прокси (см. toProxiedFileUrl) — иначе CORS.
   */
  url: string;
  triggerVariant?: React.ComponentProps<typeof Button>['variant'];
  triggerSize?: React.ComponentProps<typeof Button>['size'];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [content, setContent] = useState('');

  const handleOpen = async () => {
    setOpen(true);
    // Грузим один раз — повторное открытие показывает уже загруженный текст.
    if (content || loading) return;
    setLoading(true);
    setError('');
    try {
      // Бэк отдаёт URL файла абсолютным (кросс-доменным) — `fetch().text()` по нему
      // упёрся бы в CORS. Идём через same-origin `/api-proxy` (тот же путь, которым
      // ходят все API-вызовы), чтобы предпросмотр работал на проде. Скачивание
      // (<a href>) остаётся на исходном абсолютном URL и трогать его не нужно.
      const res = await fetch(toProxiedFileUrl(url), { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setContent(await res.text());
    } catch {
      setError('Не удалось открыть файл');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size={triggerSize}
        className={className}
        onClick={handleOpen}
      >
        <Eye className="size-4" />
        Просмотр
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6 text-left" title={fileName}>
              {fileName}
            </DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : content.trim() ? (
              <div className="text-sm break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {content}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Файл пуст.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
