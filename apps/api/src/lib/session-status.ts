import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';

// Авто-перевод занятий в «Проведён» по дате (для занятий БЕЗ Zoom, где нет
// вебхука meeting.ended). Занятия c Zoom закрывает вебхук (zoom-webhooks.ts),
// но свипер служит и подстраховкой, если вебхук не дошёл.
//
// ── Защита от перебивания РУЧНЫХ откатов (done→planned) ──────────────────────
// Откаты статуса разрешены: админ может вернуть проведённое занятие в 'planned'.
// Свипер НЕ должен тут же снова авто-завершать такое занятие. Флага «тронуто
// руками» в схеме нет (колонку не заводим без миграции), поэтому используем
// эвристику по Session.updatedAt:
//   авто-done разрешён ТОЛЬКО если занятие НЕ редактировали после наступления его
//   даты (updatedAt <= date + GRACE). Любая ручная правка после даты (в т.ч.
//   откат статуса) поднимает updatedAt за порог → свипер занятие не трогает.
// Session.date хранится как @db.Date (полночь UTC даты занятия), поэтому к ней
// добавляем GRACE-часы, чтобы покрыть само время проведения в течение дня и
// штатные правки расписания в день занятия.

// Грейс-окно (часы) после полуночи даты занятия, в пределах которого ручные
// правки НЕ считаются «откатом» (штатное планирование/проведение). Правка позже
// этого порога блокирует авто-done (защита откатов). По умолчанию 24ч.
const AUTO_DONE_GRACE_HOURS = Number(process.env.AUTO_DONE_GRACE_HOURS) || 24;

// Насколько в прошлое смотрит свипер (дни). Древние занятия не воскрешаем —
// если их давно не закрыли, это уже не задача авто-свипера. По умолчанию 30 дней.
const AUTO_DONE_LOOKBACK_DAYS = Number(process.env.AUTO_DONE_LOOKBACK_DAYS) || 30;

// Сколько занятий обрабатывать за один проход (анти-долбёж БД). По умолчанию 200.
const AUTO_DONE_BATCH = Number(process.env.AUTO_DONE_BATCH) || 200;

// Возвращает полночь UTC «сегодня» (начало текущего дня). Занятие считается
// прошедшим, если его date СТРОГО раньше этой границы (т.е. день уже наступил
// целиком). Сравниваем в UTC, т.к. @db.Date хранится как полночь UTC.
function startOfTodayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Свипер авто-done по дате. Переводит в 'done' занятия со status='planned' и
// датой в прошлом, КРОМЕ тех, что редактировали руками после наступления даты
// (защита откатов — см. вверху). 'cancelled'/'done'/'draft' не трогает.
// Идемпотентен: повторный проход затрагивает 0 строк (статус уже не 'planned',
// либо updatedAt поднялся самим update'ом за порог). Ошибки на каждом занятии
// глотает (cron не должен падать). Возвращает число завершённых занятий.
export async function sweepAutoDoneSessions(
  app: Pick<FastifyInstance, 'log'>,
  params?: { now?: Date },
): Promise<number> {
  const now = params?.now ?? new Date();
  const todayStart = startOfTodayUtc(now);
  const lookbackStart = new Date(
    todayStart.getTime() - AUTO_DONE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );
  const graceMs = AUTO_DONE_GRACE_HOURS * 60 * 60 * 1000;

  // Кандидаты: запланированные занятия с датой в прошлом, в окне просмотра.
  // Фильтр «не тронуто после даты» делаем в коде (порог зависит от date каждого
  // ряда — выразить это в одном where-условии Prisma нельзя).
  const candidates = await prisma.session.findMany({
    where: {
      status: 'planned',
      date: { lt: todayStart, gte: lookbackStart },
    },
    select: { id: true, date: true, updatedAt: true },
    orderBy: { date: 'asc' },
    take: AUTO_DONE_BATCH,
  });

  let done = 0;
  for (const s of candidates) {
    if (!s.date) continue;
    const threshold = new Date(s.date.getTime() + graceMs);
    // Тронуто руками после наступления даты (в т.ч. откат done→planned) — не трогаем.
    if (s.updatedAt > threshold) continue;

    try {
      // updateMany с повторным условием status='planned' — атомарно и идемпотентно
      // (если статус успели сменить между выборкой и апдейтом, затронем 0 строк).
      const { count } = await prisma.session.updateMany({
        where: { id: s.id, status: 'planned' },
        data: { status: 'done' },
      });
      if (count > 0) done += 1;
    } catch (err) {
      // Глотаем: один проблемный сессион не должен валить весь проход свипера.
      app.log.error({ err, sessionId: s.id }, 'Ошибка авто-перевода занятия в done');
    }
  }

  return done;
}
