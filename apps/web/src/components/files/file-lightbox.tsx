'use client';

import { useState, type ReactNode } from 'react';
import { Download, ExternalLink, Eye, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MarkdownContent } from '@/components/markdown/markdown-content';
import { fileDownloadUrl, toProxiedFileUrl } from '@/lib/api';
import { previewKind } from '@/lib/file-type';

/**
 * Кнопка-триггер + лайтбокс (Dialog) для предпросмотра любого файла нашего
 * хранилища прямо в интерфейсе — без открытия новой вкладки.
 *
 * Тип превью определяется по расширению имени файла (см. previewKind):
 * картинка/PDF грузятся по same-origin прокси (toProxiedFileUrl, куки идут сами),
 * markdown/текст фетчатся текстом; для неизвестных типов — заглушка с действиями
 * «Скачать» / «Открыть в новой вкладке».
 *
 * Сырой HTML в markdown НЕ рендерим (нет rehype-raw) — защита от XSS.
 */
export function FileLightbox({
  fileName,
  url,
  triggerVariant = 'ghost',
  triggerSize = 'sm',
  className,
  trigger,
}: {
  fileName: string;
  /**
   * Подписанный URL файла (приходит с бэка абсолютным: `${API_BASE_URL}/files/...?exp&sig`).
   * Картинки/PDF и fetch текста идут через same-origin прокси (toProxiedFileUrl) —
   * иначе CORS. «Скачать»/«Открыть в новой вкладке» ходят по исходному URL.
   */
  url: string;
  triggerVariant?: React.ComponentProps<typeof Button>['variant'];
  triggerSize?: React.ComponentProps<typeof Button>['size'];
  className?: string;
  /** Кастомный триггер вместо кнопки «Просмотр» по умолчанию. */
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [content, setContent] = useState('');

  const kind = previewKind(fileName);
  const proxied = toProxiedFileUrl(url);

  const handleOpenChange = async (next: boolean) => {
    setOpen(next);
    if (!next) return;
    // Текстовые типы грузим один раз; картинки/PDF тянет сам тег по src.
    if (kind !== 'markdown' && kind !== 'text') return;
    if (content || loading) return;
    setLoading(true);
    setError('');
    try {
      // Файловый URL абсолютный (кросс-доменный) — `fetch().text()` упёрся бы в CORS.
      // Идём через same-origin `/api-proxy` (тот же путь, что у всех API-вызовов).
      const res = await fetch(proxied, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setContent(await res.text());
    } catch (e) {
      // HTTP-код помогает отличить «объект пропал» (404) от «доступ» (401/403).
      const detail = e instanceof Error && /^HTTP \d+/.test(e.message) ? ` (${e.message})` : '';
      setError(`Не удалось открыть файл${detail}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant={triggerVariant} size={triggerSize} className={className}>
            <Eye className="size-4" />
            Просмотр
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-3xl">
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
          ) : kind === 'image' ? (
            <img
              src={proxied}
              alt={fileName}
              className="mx-auto max-h-[78vh] w-auto object-contain"
            />
          ) : kind === 'pdf' ? (
            <iframe src={proxied} className="h-[78vh] w-full rounded-md border" title={fileName} />
          ) : kind === 'markdown' ? (
            content.trim() ? (
              <MarkdownContent content={content} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Файл пуст.</p>
            )
          ) : kind === 'text' ? (
            content.trim() ? (
              <pre className="whitespace-pre-wrap break-words text-sm">{content}</pre>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Файл пуст.</p>
            )
          ) : (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                Предпросмотр для этого типа файла недоступен.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={fileDownloadUrl(url)}>
              <Download className="size-4" />
              Скачать
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" />
              Открыть в новой вкладке
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
