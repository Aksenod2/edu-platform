'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Film, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
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
  uploadLessonVideo,
  deleteLessonVideo,
  type Lesson,
} from '@/lib/api';

// Допустимые расширения видео (валидация дублируется на бэке).
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v'];

// Секция «Видеозапись урока»: ОДИН файл. Загрузка/замена/удаление видео.
// Внешняя ссылка videoUrl — отдельное поле формы рядом, как альтернатива.
export function LessonVideoSection({
  accessToken,
  lessonId,
  videoFileUrl,
  onChange,
}: {
  accessToken: string;
  lessonId: string;
  videoFileUrl: string | null;
  onChange: (lesson: Lesson) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasVideo = !!videoFileUrl;

  const handleUpload = async (file: File) => {
    const name = file.name.toLowerCase();
    if (!VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      toast.error('Поддерживаются видеофайлы (MP4/WebM/MOV)');
      return;
    }
    setUploading(true);
    try {
      const { lesson } = await uploadLessonVideo(accessToken, lessonId, file);
      onChange(lesson);
      toast.success(hasVideo ? 'Видео заменено' : 'Видео загружено');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки видео');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    try {
      const { lesson } = await deleteLessonVideo(accessToken, lessonId);
      onChange(lesson);
      toast.success('Видео удалено');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted p-4">
      <FieldLabel>Видеозапись урока</FieldLabel>

      {hasVideo ? (
        <div className="flex flex-col gap-2">
          <div className="flex max-h-[50vh] justify-center overflow-hidden rounded-lg border bg-black">
            <video
              controls
              preload="metadata"
              controlsList="nodownload"
              onContextMenu={(e) => e.preventDefault()}
              className="max-h-[50vh] w-auto max-w-full"
              src={videoFileUrl ?? undefined}
            />
          </div>
          <div className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm">
            <Film className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate text-foreground">Видео загружено</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <X className="size-4" />
              <span className="sr-only">Удалить видео</span>
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Видео не загружено.</p>
      )}

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
            {hasVideo ? 'Заменить файл' : 'Выбрать видеофайл (MP4/WebM/MOV)'}
          </>
        )}
        <input
          type="file"
          accept="video/mp4,video/webm,.mp4,.webm,.mov,.m4v"
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
      <p className="text-xs text-muted-foreground">
        Большие файлы пока ограничены лимитом сервера — загружайте небольшие записи.
      </p>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить видео?</AlertDialogTitle>
            <AlertDialogDescription>
              Загруженная видеозапись будет удалена из урока. Действие необратимо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => handleDelete()}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
