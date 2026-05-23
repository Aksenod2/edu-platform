import { Clock, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * Бейдж статуса автозагрузки записи Zoom для прошедшего занятия.
 *
 * Статусы (Session.recordingStatus): none | pending | processing | ready | failed.
 *   - pending     → «Ждём запись от Zoom» (запись ещё не пришла);
 *   - processing  → «Запись обрабатывается» (идёт скачивание/обработка);
 *   - ready       → «Запись готова» (показываем тихо; видео и так в плеере);
 *   - failed      → «Запись не получена» (destructive; текст ошибки — в title);
 *   - none/пусто/null → ничего не рендерим.
 *
 * showReady=false скрывает «готово» там, где бейдж избыточен (видео и так видно).
 */
export function RecordingStatusBadge({
  status,
  error,
  showReady = true,
  className,
}: {
  status?: string | null;
  error?: string | null;
  showReady?: boolean;
  className?: string;
}) {
  if (!status || status === 'none') return null;

  if (status === 'pending') {
    return (
      <Badge variant="secondary" className={className}>
        <Clock className="size-3" />
        Ждём запись от Zoom
      </Badge>
    );
  }

  if (status === 'processing') {
    return (
      <Badge variant="secondary" className={className}>
        <Loader2 className="size-3 animate-spin" />
        Запись обрабатывается
      </Badge>
    );
  }

  if (status === 'ready') {
    if (!showReady) return null;
    return (
      <Badge variant="outline" className={className}>
        <CheckCircle2 className="size-3" />
        Запись готова
      </Badge>
    );
  }

  if (status === 'failed') {
    const reason = error?.trim() || 'Запись не получена';
    return (
      // title — подсказка по наведению; aria-label дублирует причину для скринридеров,
      // т.к. сам title недоступен с клавиатуры/тача.
      <Badge
        variant="destructive"
        className={className}
        title={error ?? undefined}
        aria-label={reason}
      >
        <AlertTriangle className="size-3" />
        Запись не получена
      </Badge>
    );
  }

  return null;
}
