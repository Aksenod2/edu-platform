/**
 * Единый источник ТЕКСТОВ для состояний «формируется / недоступно / ошибка»
 * по данным, которые Zoom отдаёт после созвона (запись, итоги, транскрипт).
 *
 * Зачем отдельный модуль: подписи-инфоблоки занятия и встречи 1-на-1 раньше
 * дублировались копипастой (lesson-view.tsx и meeting-detail.tsx). Цветной бейдж
 * статуса (RecordingStatusBadge) уже общий; здесь — длинные пояснения под ним и
 * тексты состояний итогов/транскрипта. Различие «занятие» vs «встреча» задаётся
 * параметром (kindLabel — родительный падеж: «занятия» / «встречи»), а не копией.
 *
 * Логика выбора состояния (processing/stale/failed/...) живёт в processing-status.ts
 * (resolveProcessingKind) — тут только тексты, чтобы оба экрана брали их отсюда.
 */

/** Родительный падеж названия созвона для подстановки в тексты. */
export type CallKind = 'занятия' | 'встречи';

/**
 * Подпись под бейджем записи (инфоблок состояния записи).
 * Соответствует ветвям recKind: processing / stale / failed.
 *
 * @param error Текст ошибки от бэка (recordingError) — показываем при failed, если есть.
 */
export function recordingStatusHint(
  kind: 'processing' | 'stale' | 'failed',
  call: CallKind,
  error?: string | null,
): string {
  if (kind === 'failed') {
    return (
      error?.trim() ||
      `Запись с Zoom не получена — обновите позже или перезапустите загрузку.`
    );
  }
  if (kind === 'stale') {
    return `Запись от Zoom пока не пришла. Загляните позже или обновите вручную.`;
  }
  // processing
  return `Формируется запись ${call === 'встречи' ? 'встречи' : 'конференции'} — подтянется автоматически из Zoom. Зайдите позже.`;
}

/** Подпись «формируется» для итогов (синий инфо). */
export function summaryProcessingHint(call: CallKind): string {
  return `Формируются итоги ${call} — Zoom обычно готовит их за несколько минут. Зайдите позже.`;
}

/** Подпись «недоступно давно» для итогов (нейтральное). */
export function summaryStaleHint(call: CallKind): string {
  return `Итоги ${call} пока недоступны. Загляните позже или обновите вручную.`;
}

/** Подпись «реальная ошибка» для итогов (красный). */
export function summaryFailedHint(call: CallKind): string {
  return `Не удалось получить итоги ${call} из Zoom.`;
}

/** Подпись «нет интеграции / не формировались» для итогов (нейтральное). */
export function summaryEmptyHint(call: CallKind): string {
  return `Итоги по ${call === 'встречи' ? 'этой встрече' : 'этому занятию'} не формировались.`;
}

/** Подпись «формируется» для транскрипта (синий инфо). */
export function transcriptProcessingHint(call: CallKind): string {
  return `Формируется транскрипт ${call} — он приходит из Zoom позже записи. Загляните позже.`;
}

/** Подпись «недоступно давно» для транскрипта (нейтральное). */
export function transcriptStaleHint(call: CallKind): string {
  return `Транскрипт по ${call === 'встречи' ? 'этой встрече' : 'этому занятию'} пока недоступен. Загляните позже или обновите вручную.`;
}

/** Подпись «реальная ошибка» для транскрипта (красный). */
export function transcriptFailedHint(call: CallKind, error?: string | null): string {
  return error?.trim() || `Не удалось получить транскрипт ${call} из Zoom.`;
}
