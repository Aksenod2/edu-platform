'use client';

import { useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useVideoTracking, type VideoTrackTarget } from '@/components/lessons/use-video-tracking';

// Общие контейнеры плеера для видео урока и записи занятия (DRY): используются
// на странице урока студента, в блоке расписания админа и т.п.

// Единый контейнер плеера для видеофайла. Стабильная высота (max-h-[70vh]),
// центрирование и тёмный нейтральный фон-леттербокс через семантический токен
// bg-muted — вертикальные сторис 9:16 кэпятся по высоте и не растягивают экран,
// горизонтальные 16:9 не выходят за ширину карточки. object-contain не искажает кадр.
// playsInline — чтобы на iOS видео играло встроенно, а не уходило в фуллскрин.
// onError — если браузер не может проиграть (напр. .mov/HEVC или файл недоступен),
// показываем понятный текст вместо чёрного экрана.
export function VideoFileFrame({
  src,
  label,
  track,
}: {
  src: string;
  label?: string;
  // Опционально: включает фоновый трекинг прогресса просмотра НАШЕГО видеофайла
  // урока (лог активности студента). Не передан — поведение плеера не меняется.
  track?: VideoTrackTarget;
}) {
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { accessToken } = useAuth();

  useVideoTracking({
    videoRef,
    target: track ?? null,
    accessToken,
  });

  if (failed) {
    return (
      <div className="flex max-h-[70vh] items-center justify-center rounded-lg border bg-muted p-6">
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Не удалось воспроизвести видео — возможно, формат не поддерживается
          браузером (например, .mov или HEVC). Загрузите видео в MP4 (H.264).
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-h-[70vh] items-center justify-center overflow-hidden rounded-lg border bg-muted">
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        controlsList="nodownload"
        onContextMenu={(e) => e.preventDefault()}
        onError={() => setFailed(true)}
        className="max-h-[70vh] w-auto max-w-full object-contain"
        src={src}
        aria-label={label}
      />
    </div>
  );
}

// Единый контейнер для встраиваемого видео (iframe). Соотношение 16:9.
export function VideoEmbedFrame({ src, title }: { src: string; title: string }) {
  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted">
      <iframe
        src={src}
        title={title}
        className="size-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
