'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, FileText, Paperclip, X, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
import { FileLightbox } from '@/components/files/file-lightbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  uploadLessonMaterial,
  deleteLessonMaterial,
  fileDownloadUrl,
  type LessonMaterial,
} from '@/lib/api';
import {
  useLessonStreams,
  VisibilityBadge,
  VisibilitySelect,
} from '@/components/lessons/lesson-stream-visibility';

// Человекочитаемый размер файла материала.
export function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

// Секция «Материалы (PDF/MD)» урока-блока: загрузка, список, удаление.
export function LessonMaterialsSection({
  accessToken,
  lessonId,
  materials,
  onChange,
}: {
  accessToken: string;
  lessonId: string;
  materials: LessonMaterial[];
  onChange: (materials: LessonMaterial[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState<LessonMaterial | null>(null);
  // Видимость следующего загружаемого материала (undefined = общий метод).
  const [uploadStreamId, setUploadStreamId] = useState<string | undefined>(undefined);
  const sessions = useLessonStreams(accessToken, lessonId);

  const handleUpload = async (file: File) => {
    // Проверка формата на фронте (строго PDF/MD). Главная валидация — на бэке.
    const name = file.name.toLowerCase();
    const okExt = name.endsWith('.pdf') || name.endsWith('.md') || name.endsWith('.markdown');
    if (!okExt) {
      toast.error('Поддерживаются только PDF и MD');
      return;
    }
    setUploading(true);
    try {
      const { materials: updated } = await uploadLessonMaterial(
        accessToken,
        lessonId,
        file,
        uploadStreamId,
      );
      onChange(updated);
      toast.success('Материал добавлен');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки файла');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (material: LessonMaterial) => {
    try {
      const { materials: updated } = await deleteLessonMaterial(
        accessToken,
        lessonId,
        material.s3Key,
      );
      onChange(updated);
      toast.success('Материал удалён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted p-4">
      <FieldLabel>Материалы (PDF/MD)</FieldLabel>

      {materials.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {materials.map((m) => (
            <div
              key={m.s3Key}
              className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              {m.url ? (
                <FileLightbox
                  fileName={m.fileName}
                  url={m.url}
                  trigger={
                    <button
                      type="button"
                      className="flex-1 truncate text-left text-foreground underline underline-offset-4"
                      title={m.fileName}
                    >
                      {m.fileName}
                    </button>
                  }
                />
              ) : (
                <span className="flex-1 truncate text-foreground">{m.fileName}</span>
              )}
              {m.size ? (
                <span className="shrink-0 text-xs text-muted-foreground">{formatSize(m.size)}</span>
              ) : null}
              <VisibilityBadge streamId={m.streamId} sessions={sessions} />
              {m.url && (
                <Button
                  asChild
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0 text-muted-foreground"
                >
                  <a href={fileDownloadUrl(m.url)} title="Скачать">
                    <Download className="size-4" />
                    <span className="sr-only">Скачать материал</span>
                  </a>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-destructive hover:text-destructive"
                onClick={() => setToDelete(m)}
              >
                <X className="size-4" />
                <span className="sr-only">Удалить материал</span>
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Материалы не добавлены.</p>
      )}

      {/* На мобилке селектор и кнопка — в столбик, на десктопе — в строку. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <VisibilitySelect
          value={uploadStreamId}
          onChange={setUploadStreamId}
          sessions={sessions}
          disabled={uploading}
        />
        <label
          className={`inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-dashed bg-card px-3 py-1.5 text-sm ${uploading ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          {uploading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Загрузка...
            </>
          ) : (
            <>
              <Paperclip className="size-4" />
              Выбрать файл (PDF/MD)
            </>
          )}
          <input
            type="file"
            accept=".pdf,.md,.markdown,application/pdf,text/markdown"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                handleUpload(file);
                e.target.value = '';
              }
            }}
          />
        </label>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => { if (!open) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить материал?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && `Файл «${toDelete.fileName}» будет удалён из урока. Действие необратимо.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (toDelete) handleDelete(toDelete); }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
