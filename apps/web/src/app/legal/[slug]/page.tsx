'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { MarkdownContent } from '@/components/markdown/markdown-content';
import {
  formatLegalDate,
  LegalDocumentBodySkeleton,
  LegalDocumentPending,
} from '@/components/legal-document-lightbox';
import { ApiError, getPublicLegalDocument, type PublicLegalDocument } from '@/lib/api';

// Публичная страница юридического документа (без авторизации): актуальная
// редакция markdown-текста; пока версий нет — заглушка «готовится к публикации».
export default function LegalDocumentPage() {
  const params = useParams();
  const slug = (params.slug as string) || '';

  const [doc, setDoc] = useState<PublicLegalDocument | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    getPublicLegalDocument(slug)
      .then(({ document }) => setDoc(document))
      .catch((err) => {
        // 404 — неизвестный slug (своя страница-заглушка), остальное — ошибка с ретраем.
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError(err instanceof Error ? err.message : 'Не удалось загрузить документ');
      })
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(load, [load]);

  const backLink = (
    <Link
      href="/legal"
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      <ArrowLeft className="size-4" />
      Все документы
    </Link>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {backLink}
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <Separator />
        <LegalDocumentBodySkeleton />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-start gap-4">
        {backLink}
        <h1 className="text-2xl font-semibold tracking-tight">Документ не найден</h1>
        <p className="text-sm text-muted-foreground">
          Такого документа нет — возможно, ссылка устарела. Все актуальные документы
          собраны в общем списке.
        </p>
        <Button asChild variant="outline">
          <Link href="/legal">К списку документов</Link>
        </Button>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="flex flex-col items-start gap-4">
        {backLink}
        <Alert variant="destructive">
          <AlertDescription>{error || 'Не удалось загрузить документ'}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={load}>
          Повторить
        </Button>
      </div>
    );
  }

  return (
    <article className="flex flex-col gap-5">
      {backLink}
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          {doc.title}
        </h1>
        {doc.versionNumber !== null && doc.publishedAt !== null && (
          <p className="text-sm text-muted-foreground">
            Редакция №{doc.versionNumber} от {formatLegalDate(doc.publishedAt)}
          </p>
        )}
      </header>
      <Separator />
      {doc.body === null ? (
        <LegalDocumentPending />
      ) : (
        // text-[15px]/leading-7 — читаемая типографика длинного юридического текста.
        <MarkdownContent content={doc.body} className="text-[15px] leading-7" />
      )}
    </article>
  );
}
