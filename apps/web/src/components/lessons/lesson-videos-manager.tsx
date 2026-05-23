'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Paperclip,
  ChevronUp,
  ChevronDown,
  Trash2,
  ExternalLink,
  Link as LinkIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  addLessonVideoFile,
  addLessonVideoLink,
  updateLessonVideoItem,
  deleteLessonVideoItem,
  reorderLessonVideos,
  type LessonVideo,
} from '@/lib/api';
import { parseVideoEmbed } from '@/lib/video-embed';

// Менеджер НЕСКОЛЬКИХ видео урока: список с превью (файл — встроенный плеер,
// ссылка — iframe или кнопка), редактирование названия/url, порядок, удаление,
// плюс блок добавления файла/ссылки. Все мутации возвращают свежий список видео.
export function LessonVideosManager({
  accessToken,
  lessonId,
  videos,
  onChange,
}: {
  accessToken: string;
  lessonId: string;
  videos: LessonVideo[];
  onChange: (videos: LessonVideo[]) => void;
}) {
  // Глобальная блокировка кнопок на время любого запроса (порядок/удаление/добавление).
  const [busy, setBusy] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Загрузка видео-ФАЙЛА.
  const handleUploadFile = async (file: File) => {
    setBusy(true);
    try {
      const { videos: next } = await addLessonVideoFile(
        accessToken,
        lessonId,
        file,
        uploadTitle.trim() || undefined,
      );
      onChange(next);
      setUploadTitle('');
      toast.success('Видео загружено');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки видео');
    } finally {
      setBusy(false);
    }
  };

  // Добавление видео-ССЫЛКИ.
  const handleAddLink = async () => {
    const url = linkUrl.trim();
    if (!url) {
      toast.error('Укажите ссылку на видео');
      return;
    }
    setBusy(true);
    try {
      const { videos: next } = await addLessonVideoLink(
        accessToken,
        lessonId,
        url,
        linkTitle.trim() || undefined,
      );
      onChange(next);
      setLinkUrl('');
      setLinkTitle('');
      toast.success('Ссылка добавлена');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка добавления ссылки');
    } finally {
      setBusy(false);
    }
  };

  // Сохранение поля (title/url) видео по onBlur, если значение изменилось.
  const handlePatch = async (
    videoId: string,
    patch: { title?: string | null; url?: string },
  ) => {
    setBusy(true);
    try {
      const { videos: next } = await updateLessonVideoItem(
        accessToken,
        lessonId,
        videoId,
        patch,
      );
      onChange(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  // Удаление элемента видео.
  const handleDelete = async (videoId: string) => {
    setBusy(true);
    try {
      const { videos: next } = await deleteLessonVideoItem(accessToken, lessonId, videoId);
      onChange(next);
      toast.success('Видео удалено');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления');
    } finally {
      setBusy(false);
    }
  };

  // Перемещение видео вверх/вниз: считаем новый порядок id и шлём целиком.
  const handleMove = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= videos.length) return;
    const orderedIds = videos.map((v) => v.id);
    [orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];
    setBusy(true);
    try {
      const { videos: next } = await reorderLessonVideos(accessToken, lessonId, orderedIds);
      onChange(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка изменения порядка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted p-4">
      <FieldLabel>Видео урока</FieldLabel>

      {videos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Видео не добавлены.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {videos.map((video, index) => (
            <VideoCard
              key={video.id}
              video={video}
              isFirst={index === 0}
              isLast={index === videos.length - 1}
              busy={busy}
              onMoveUp={() => handleMove(index, -1)}
              onMoveDown={() => handleMove(index, 1)}
              onDelete={() => setConfirmDeleteId(video.id)}
              onPatch={(patch) => handlePatch(video.id, patch)}
            />
          ))}
        </div>
      )}

      {/* Блок добавления: на мобилке — в столбик, на десктопе — в строку. */}
      <div className="flex flex-col gap-3 rounded-md border border-dashed bg-card p-3">
        {/* Добавить файл */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label
            className={`inline-flex w-fit shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-sm ${
              busy ? 'cursor-not-allowed opacity-60' : ''
            }`}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Paperclip className="size-4" />
            )}
            Добавить файл
            <input
              type="file"
              accept="video/mp4,video/webm,.mp4,.webm,.mov,.m4v"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleUploadFile(file);
                  e.target.value = '';
                }
              }}
            />
          </label>
          <Input
            value={uploadTitle}
            onChange={(e) => setUploadTitle(e.target.value)}
            placeholder="Название (необязательно)"
            disabled={busy}
            className="w-full"
          />
        </div>

        {/* Добавить ссылку */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://..."
            type="url"
            disabled={busy}
            className="w-full"
          />
          <Input
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            placeholder="Название (необязательно)"
            disabled={busy}
            className="w-full"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleAddLink}
            disabled={busy}
            className="w-full shrink-0 sm:w-auto"
          >
            <LinkIcon className="size-4" />
            Добавить ссылку
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Большие файлы пока ограничены лимитом сервера — загружайте небольшие записи.
      </p>

      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить видео?</AlertDialogTitle>
            <AlertDialogDescription>
              Видео будет удалено из урока. Действие необратимо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmDeleteId) handleDelete(confirmDeleteId);
                setConfirmDeleteId(null);
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Карточка одного видео: превью + поля + кнопки управления.
function VideoCard({
  video,
  isFirst,
  isLast,
  busy,
  onMoveUp,
  onMoveDown,
  onDelete,
  onPatch,
}: {
  video: LessonVideo;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onPatch: (patch: { title?: string | null; url?: string }) => void;
}) {
  // Локальное состояние полей, чтобы редактировать без дёрганья при каждом запросе.
  const [title, setTitle] = useState(video.title ?? '');
  const [url, setUrl] = useState(video.url);

  const embedUrl = video.kind === 'link' ? parseVideoEmbed(video.url) : null;

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
      {/* Превью */}
      {video.kind === 'file' ? (
        <div className="flex justify-center overflow-hidden rounded bg-black">
          <video
            controls
            preload="metadata"
            controlsList="nodownload"
            onContextMenu={(e) => e.preventDefault()}
            className="max-h-48 w-auto max-w-full"
            src={video.url}
          />
        </div>
      ) : embedUrl ? (
        <div className="aspect-video w-full overflow-hidden rounded border bg-muted">
          <iframe
            src={embedUrl}
            title={video.title ?? 'Видео урока'}
            className="size-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <Button asChild variant="outline" size="sm" className="w-fit">
          <a href={video.url} target="_blank" rel="noopener noreferrer">
            Открыть видео
            <ExternalLink className="size-4" />
          </a>
        </Button>
      )}

      {/* Название */}
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          const next = title.trim();
          if (next !== (video.title ?? '')) onPatch({ title: next || null });
        }}
        placeholder="Название (необязательно)"
        disabled={busy}
        className="w-full"
      />

      {/* URL — редактируем только у ссылки */}
      {video.kind === 'link' && (
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => {
            const next = url.trim();
            if (next && next !== video.url) onPatch({ url: next });
          }}
          placeholder="https://..."
          type="url"
          disabled={busy}
          className="w-full"
        />
      )}

      {/* Кнопки управления */}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8"
          disabled={busy || isFirst}
          onClick={onMoveUp}
        >
          <ChevronUp className="size-4" />
          <span className="sr-only">Вверх</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8"
          disabled={busy || isLast}
          onClick={onMoveDown}
        >
          <ChevronDown className="size-4" />
          <span className="sr-only">Вниз</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto size-8 text-destructive hover:text-destructive"
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
          <span className="sr-only">Удалить</span>
        </Button>
      </div>
    </div>
  );
}
