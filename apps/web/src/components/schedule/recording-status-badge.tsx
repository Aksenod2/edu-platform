import { Clock, Loader2, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  resolveProcessingKind,
  RECORDING_STALE_AFTER_MS,
} from '@/components/schedule/processing-status';

/**
 * Бейдж статуса автозагрузки записи Zoom для прошедшего занятия.
 *
 * Логика «формируется / недоступно / ошибка» — едина (resolveProcessingKind):
 *   - processing/pending + свежий запрос → СИНИЙ инфо «Формируется запись…»;
 *   - processing/pending + запрос давно   → СЕРОЕ muted «Запись недоступна»;
 *   - ready    → тихое «Запись готова» (видео и так в плеере; гейтится showReady);
 *   - failed   → КРАСНЫЙ «Запись не получена» (реальная ошибка; текст — в title);
 *   - none/пусто/null → ничего не рендерим.
 *
 * КРАСНОЕ показываем ТОЛЬКО при реальном сбое (failed), а не пока данные едут.
 * requestedAt (recordingRequestedAt) — отметка запроса у Zoom: по её давности
 * «формируется» сменяется на нейтральное «недоступно».
 *
 * showReady=false скрывает «готово» там, где бейдж избыточен (видео и так видно).
 */
export function RecordingStatusBadge({
  status,
  error,
  requestedAt,
  showReady = true,
  className,
}: {
  status?: string | null;
  error?: string | null;
  requestedAt?: string | null;
  showReady?: boolean;
  className?: string;
}) {
  if (!status || status === 'none') return null;

  const kind = resolveProcessingKind({
    status,
    requestedAt,
    staleAfterMs: RECORDING_STALE_AFTER_MS,
  });

  if (kind === 'processing') {
    // Дружелюбное «формируется» — синий инфо (text-blue-*), со спиннером.
    return (
      <Badge
        variant="secondary"
        className={`border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 ${className ?? ''}`}
      >
        <Loader2 className="size-3 animate-spin" />
        Формируется запись
      </Badge>
    );
  }

  if (kind === 'stale') {
    // Данных давно нет — нейтральное серое «недоступно» (muted, НЕ destructive).
    return (
      <Badge variant="secondary" className={className}>
        <Clock className="size-3" />
        Запись недоступна
      </Badge>
    );
  }

  if (kind === 'ready') {
    if (!showReady) return null;
    return (
      <Badge variant="outline" className={className}>
        <CheckCircle2 className="size-3" />
        Запись готова
      </Badge>
    );
  }

  if (kind === 'failed') {
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

  // kind === 'empty' — на этом экране бейдж не нужен (показываем тихо/ничего).
  return (
    <Badge variant="secondary" className={className}>
      <Info className="size-3" />
      Запись не формировалась
    </Badge>
  );
}
