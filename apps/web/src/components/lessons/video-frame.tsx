// Общие контейнеры плеера для видео урока и записи занятия (DRY): используются
// на странице урока студента, в блоке расписания админа и т.п.

// Единый контейнер плеера для видеофайла. Стабильная высота (max-h-[70vh]),
// центрирование и тёмный нейтральный фон-леттербокс через семантический токен
// bg-muted — вертикальные сторис 9:16 кэпятся по высоте и не растягивают экран,
// горизонтальные 16:9 не выходят за ширину карточки. object-contain не искажает кадр.
export function VideoFileFrame({ src, label }: { src: string; label?: string }) {
  return (
    <div className="flex max-h-[70vh] items-center justify-center overflow-hidden rounded-lg border bg-muted">
      <video
        controls
        preload="metadata"
        controlsList="nodownload"
        onContextMenu={(e) => e.preventDefault()}
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
