'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getPublicLegalDocuments, type PublicLegalDocumentSummary } from '@/lib/api';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// Публичный список юридических документов портала (без авторизации).
export default function LegalListPage() {
  const [documents, setDocuments] = useState<PublicLegalDocumentSummary[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    getPublicLegalDocuments()
      .then(({ documents }) => setDocuments(documents))
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить документы'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Правовая информация</h1>
        <p className="text-sm text-muted-foreground">
          Документы и реквизиты портала OCHOBA
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col divide-y rounded-lg border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 px-4 py-3.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button variant="outline" onClick={load}>
            Повторить
          </Button>
        </div>
      ) : !documents || documents.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Документы пока не добавлены
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {documents.map((doc) => (
            <li key={doc.slug}>
              <Link
                href={`/legal/${doc.slug}`}
                className="group flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-accent/50"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{doc.title}</span>
                  {doc.currentVersion ? (
                    <span className="text-xs text-muted-foreground">
                      Редакция №{doc.currentVersion.versionNumber} от{' '}
                      {formatDate(doc.currentVersion.publishedAt)}
                    </span>
                  ) : (
                    <Badge variant="secondary" className="mt-0.5">
                      Готовится к публикации
                    </Badge>
                  )}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
