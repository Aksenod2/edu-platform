/**
 * Единая логика отображения состояний «формируется / недоступно / ошибка / готово»
 * для данных, которые Zoom отдаёт ПОСЛЕ занятия: запись, итоги (summary), транскрипт.
 *
 * Проблема, которую решает: пока данные ещё формируются, нельзя показывать
 * КРАСНУЮ ошибку («Запись не получена») — это пугает. «Формируется» = дружелюбно
 * (синий инфо). КРАСНОЕ — только при реальном сбое (status === 'failed'). А если
 * данных так и нет очень долго (запрос был давно) — нейтральное серое «недоступно».
 *
 * На вход: статус (none|pending|processing|ready|failed), отметка времени запроса
 * у Zoom (requestedAt, ISO|null), признак готовности данных (есть ли контент) и
 * порог «давности» для перехода processing/pending → «недоступно».
 *
 * Возвращает «вид» (kind), по которому слой UI выбирает токены и тексты:
 *   - 'ready'      → данные готовы, показываем контент;
 *   - 'failed'     → реальная ошибка (КРАСНЫЙ / destructive);
 *   - 'processing' → ещё формируется, запрос свежий (СИНИЙ инфо, дружелюбно);
 *   - 'stale'      → формируется давно, данных всё нет (СЕРОЕ muted «недоступно»);
 *   - 'empty'      → none/нет интеграции Zoom (спокойное «не формировались»).
 */

export type ProcessingKind = 'ready' | 'failed' | 'processing' | 'stale' | 'empty';

/**
 * Пороги «давности» запроса: после них «формируется» сменяется на нейтральное
 * «недоступно» (данных так и нет — дальше обещать бессмысленно). В миллисекундах.
 *
 * Запись и итоги обычно приходят в течение нескольких минут — час-два максимум;
 * берём с большим запасом ~5 ч. Транскрипт Zoom отдаёт позже остального —
 * закладываем больший порог ~10 ч.
 */
const HOUR = 60 * 60 * 1000;
export const RECORDING_STALE_AFTER_MS = 5 * HOUR;
export const SUMMARY_STALE_AFTER_MS = 5 * HOUR;
export const TRANSCRIPT_STALE_AFTER_MS = 10 * HOUR;

/**
 * Вычислить «вид» состояния по статусу + наличию данных + давности запроса.
 *
 * @param status      Session.*Status (none|pending|processing|ready|failed | null).
 * @param hasData     Есть ли уже готовый контент (запись/итоги/транскрипт).
 * @param requestedAt ISO-строка отметки запроса у Zoom (или null).
 * @param staleAfterMs Порог давности: позже него processing/pending → 'stale'.
 * @param now         Текущее время (для тестируемости; по умолчанию Date.now()).
 */
export function resolveProcessingKind({
  status,
  hasData,
  requestedAt,
  staleAfterMs,
  now = Date.now(),
}: {
  status?: string | null;
  hasData?: boolean;
  requestedAt?: string | null;
  staleAfterMs: number;
  now?: number;
}): ProcessingKind {
  // Данные есть — всегда показываем контент, что бы ни говорил статус.
  if (hasData) return 'ready';

  if (status === 'ready') return 'ready';
  if (status === 'failed') return 'failed';

  if (status === 'processing' || status === 'pending') {
    if (requestedAt) {
      const ts = Date.parse(requestedAt);
      if (!Number.isNaN(ts) && now - ts > staleAfterMs) return 'stale';
    }
    return 'processing';
  }

  // none / null / неизвестный статус — данные не формировались.
  return 'empty';
}
