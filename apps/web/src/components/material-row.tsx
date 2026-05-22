'use client';

import { FileText, ExternalLink, Download } from 'lucide-react';
import { fileDownloadUrl, type LessonMaterial } from '@/lib/api';
import { Button } from '@/components/ui/button';

function formatSize(size: number) {
  return size < 1024 * 1024
    ? `${Math.round(size / 1024)} КБ`
    : `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}

/**
 * Строка материала урока с явными действиями «Открыть» (просмотр в новой
 * вкладке) и «Скачать» (форс-загрузка вложением). На узких экранах подписи
 * скрываются, остаются иконки.
 */
export function MaterialRow({ material }: { material: LessonMaterial }) {
  const { url, fileName, size } = material;

  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <FileText className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{fileName}</div>
        {size ? <div className="text-xs text-muted-foreground">{formatSize(size)}</div> : null}
      </div>
      {url && (
        <div className="flex shrink-0 items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" />
              <span className="hidden sm:inline">Открыть</span>
            </a>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={fileDownloadUrl(url)}>
              <Download className="size-4" />
              <span className="hidden sm:inline">Скачать</span>
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
