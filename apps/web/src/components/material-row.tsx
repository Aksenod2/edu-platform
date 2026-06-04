'use client';

import { FileText, Download, Eye } from 'lucide-react';
import { fileDownloadUrl, trackMaterialAccess, type LessonMaterial } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { FileLightbox } from '@/components/files/file-lightbox';

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
export function MaterialRow({
  material,
  track,
}: {
  material: LessonMaterial;
  /**
   * Контекст для лога обращений студента к материалу (фоновая телеметрия).
   * Если задан — на «Просмотр»/«Скачать» отправляем событие viewed/downloaded.
   * Не задан (например, админ-экран) — поведение прежнее, без трекинга.
   */
  track?: { accessToken: string; lessonId: string; streamId: string };
}) {
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
          <FileLightbox
            fileName={fileName}
            url={url}
            trigger={
              // onClick на триггер-кнопке (DialogTrigger asChild сливает обработчики):
              // лог уходит на том же жесте открытия лайтбокса, без эффекта на ре-рендере.
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={
                  track
                    ? () =>
                        trackMaterialAccess(track.accessToken, track.lessonId, {
                          streamId: track.streamId,
                          s3Key: material.s3Key,
                          accessType: 'viewed',
                        })
                    : undefined
                }
              >
                <Eye className="size-4" />
                <span className="hidden sm:inline">Просмотр</span>
              </Button>
            }
          />
          <Button asChild variant="ghost" size="sm">
            <a
              href={fileDownloadUrl(url)}
              onClick={
                track
                  ? () =>
                      trackMaterialAccess(track.accessToken, track.lessonId, {
                        streamId: track.streamId,
                        s3Key: material.s3Key,
                        accessType: 'downloaded',
                      })
                  : undefined
              }
            >
              <Download className="size-4" />
              <span className="hidden sm:inline">Скачать</span>
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
