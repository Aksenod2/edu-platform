'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileClock, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { MarkdownContent } from '@/components/markdown/markdown-content';
import { ApiError, getPublicLegalDocument, type PublicLegalDocument } from '@/lib/api';

/**
 * Полноэкранный лайтбокс правового документа + общие куски рендера документа,
 * переиспользуемые страницей /legal/[slug].
 */

export function formatLegalDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Заглушка «документ готовится к публикации» (версий ещё нет). */
export function LegalDocumentPending() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <FileClock className="size-8 text-muted-foreground" />
      <p className="text-sm font-medium">Документ готовится к публикации</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Текст появится здесь после публикации. Загляните позже или посмотрите другие
        документы.
      </p>
    </div>
  );
}

/** Скелетон строк текста документа на время загрузки. */
export function LegalDocumentBodySkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="h-4" style={{ width: `${100 - (i % 4) * 9}%` }} />
      ))}
    </div>
  );
}

export function LegalDocumentLightbox({
  slug,
  open,
  onOpenChange,
}: {
  slug: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [doc, setDoc] = useState<PublicLegalDocument | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!slug) return;
    setLoading(true);
    setError('');
    setNotFound(false);
    setDoc(null);
    getPublicLegalDocument(slug)
      .then(({ document }) => setDoc(document))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError(err instanceof Error ? err.message : 'Не удалось загрузить документ');
      })
      .finally(() => setLoading(false));
  }, [slug]);

  // Грузим при каждом открытии: документ публичный и лёгкий, зато всегда актуален.
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="inset-0 top-0 left-0 flex h-svh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:max-w-none"
      >
        <header className="flex items-start gap-3 border-b px-4 py-3 md:px-6">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {loading ? (
              <>
                <DialogTitle className="sr-only">Загрузка документа</DialogTitle>
                <Skeleton className="h-5 w-2/3 max-w-72" />
                <Skeleton className="h-3.5 w-44" />
              </>
            ) : (
              <DialogTitle className="text-base text-balance md:text-lg">
                {doc
                  ? doc.title
                  : notFound
                    ? 'Документ не найден'
                    : 'Не удалось загрузить документ'}
              </DialogTitle>
            )}
            {doc && doc.versionNumber !== null && doc.publishedAt !== null ? (
              <DialogDescription>
                Редакция №{doc.versionNumber} от {formatLegalDate(doc.publishedAt)}
              </DialogDescription>
            ) : (
              <DialogDescription className="sr-only">
                Полный текст правового документа
              </DialogDescription>
            )}
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" aria-label="Закрыть" className="-mr-1 shrink-0">
              <X />
            </Button>
          </DialogClose>
        </header>
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
            {loading ? (
              <LegalDocumentBodySkeleton />
            ) : notFound ? (
              <p className="text-sm text-muted-foreground">
                Такого документа нет — возможно, ссылка устарела. Все актуальные документы
                собраны на странице «Правовые документы».
              </p>
            ) : error || !doc ? (
              <div className="flex flex-col items-start gap-4">
                <Alert variant="destructive">
                  <AlertDescription>
                    {error || 'Не удалось загрузить документ'}
                  </AlertDescription>
                </Alert>
                <Button variant="outline" onClick={load}>
                  Повторить
                </Button>
              </div>
            ) : doc.body === null ? (
              <LegalDocumentPending />
            ) : (
              // text-[15px]/leading-7 — читаемая типографика длинного юридического текста.
              <MarkdownContent content={doc.body} className="text-[15px] leading-7" />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
