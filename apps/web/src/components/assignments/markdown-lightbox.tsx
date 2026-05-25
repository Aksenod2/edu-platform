'use client';

import { useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MarkdownContent } from '@/components/markdown/markdown-content';
import { toProxiedFileUrl } from '@/lib/api';

/** true для вложений, которые умеем рендерить как markdown (по имени файла). */
export function isMarkdownFile(fileName?: string | null): boolean {
  if (!fileName) return false;
  const name = fileName.toLowerCase();
  return name.endsWith('.md') || name.endsWith('.markdown');
}

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
              <MarkdownContent content={content} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Файл пуст.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
