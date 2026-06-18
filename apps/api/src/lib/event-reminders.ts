import { prisma, Prisma } from '@platform/db';
import { sendPushToUser } from './notifications.js';
import { moscowParts, moscowWallTimeToUtc } from './moscow-time.js';

// ─────────────────────────────────────────────────────────────────────────────
// Эпик «Напоминания о событиях» (#169). Push-only напоминания за 60 и 15 минут до
// старта запланированного занятия (Session) или встречи 1-на-1 (Meeting).
//
// КЛЮЧЕВОЙ ТЕХФАКТ: момент старта НЕ хранится единым timestamp. `date` = @db.Date,
// `startTime` = строка "HH:MM" (москва-настенное). Тик собирает их в UTC-инстант
// через moscow-хелперы и сравнивает с окном now+off.
//
// КОНСТРУКЦИЯ ТИКА (раз в минуту): для оффсетов 60/15 целевой момент старта = now+off;
// окно = [начало текущей минуты + off, +60с). Берём planned-события с непустым
// startTime на московские даты-кандидаты окна; оставляем те, чей собранный старт
// попал ровно в окно. Прошедшие оффсеты НЕ догоняем (окно только будущего).
//
// ИДЕМПОТЕНТНОСТЬ: для каждого (userId, eventType, eventId, offset) сначала пишем метку
// EventReminderSent (unique event_reminder_uniq); P2002 = уже слали → пропуск (защита
// от двойного тика). Push шлём только после успешного create. Per-user сбой глотаем.
//
// ПОЛУЧАТЕЛИ резолвятся В МОМЕНТ ТИКА: занятие → преподаватель(и) урока потока +
// активные студенты потока (актуальный enrollment); встреча → teacher + student.
// Деактивированным/отчисленным/удалённым не шлём.
//
// НАСТРОЙКА per-user: NotificationPreference типа event_reminder_60 / event_reminder_15,
// дефолт ВКЛ (нет записи → слать). Для оффсета 60 смотрим _60, для 15 — _15.
//
// NB: инстанс API ОДИН (как у sweepMentorship*), распределённый лок не нужен —
// идемпотентность по unique-метке и так защищает от дублей.
// ─────────────────────────────────────────────────────────────────────────────

const OFFSETS = [60, 15] as const;
type Offset = (typeof OFFSETS)[number];

// Тип уведомления-тумблера по оффсету.
function prefType(off: Offset): 'event_reminder_60' | 'event_reminder_15' {
  return off === 60 ? 'event_reminder_60' : 'event_reminder_15';
}

// Человекочитаемая фраза оффсета для тела push.
function offsetPhrase(off: Offset): string {
  return off === 60 ? 'через час' : 'через 15 минут';
}

// Московские календарные даты-кандидаты для окна [start, end). На границе суток
// окно может задеть 2 даты. Возвращаем UTC-полночь @db.Date (Date.UTC(y,m-1,d)) —
// именно так Prisma фильтрует поле @db.Date (полночь UTC соответствующего дня).
function candidateDates(windowStart: Date, windowEnd: Date): Date[] {
  const seen = new Set<string>();
  const result: Date[] = [];
  for (const m of [windowStart, new Date(windowEnd.getTime() - 1)]) {
    const { year, month, day } = moscowParts(m);
    const key = `${year}-${month}-${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(new Date(Date.UTC(year, month - 1, day, 0, 0, 0)));
  }
  return result;
}

// Собирает UTC-инстант старта из @db.Date + "HH:MM" (москва-настенное). Date поля
// @db.Date Prisma отдаёт как Date в полночь UTC соответствующего дня — берём из него
// московские год/месяц/день (для UTC-полуночи это те же цифры) и комбинируем с HH:MM.
// Невалидный startTime ("", не "HH:MM", вне диапазона) → null (событие пропускаем).
function eventStartUtc(date: Date | null, startTime: string | null): Date | null {
  if (!date || !startTime) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  // @db.Date хранится как полночь UTC — год/месяц/день берём из UTC-компонент.
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return moscowWallTimeToUtc(year, month, day, hour, minute);
}

// Текст времени старта "ЧЧ:ММ" для тела push (как настенное москва — берём из БД-строки).
function formatStartTime(startTime: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim());
  if (!match) return startTime;
  return `${match[1]!.padStart(2, '0')}:${match[2]}`;
}

interface Recipient {
  userId: string;
  eventType: 'session' | 'meeting';
  eventId: string;
  // Заголовок/тело push зависят от типа события и оффсета — формируем при отправке.
  title: string;
  body: string;
  url: string;
}

/**
 * Один тик свипера напоминаний о событиях. Для каждого оффсета (60, 15):
 *  1) окно [минута+off, +60с), вычисляем московские даты-кандидаты;
 *  2) выбираем planned Session + Meeting с непустым startTime на эти даты (пачкой);
 *  3) оставляем те, чей собранный UTC-старт попал ровно в окно;
 *  4) резолвим получателей (активные препод(ы)/студенты), читаем тумблеры пачкой;
 *  5) для каждого получателя: create метки (P2002 → пропуск) → push.
 * Ошибки на каждом получателе глотаются — тик не падает.
 */
export async function sweepEventReminders({ now }: { now?: Date } = {}): Promise<void> {
  const nowDate = now ?? new Date();
  // Начало текущей минуты (отбрасываем секунды/мс) — стабильная граница окна.
  const minuteStart = Math.floor(nowDate.getTime() / 60_000) * 60_000;

  for (const off of OFFSETS) {
    try {
      await sweepOffset(off, minuteStart);
    } catch (err) {
      console.error('[cron] event reminders offset error', { off }, err);
    }
  }
}

async function sweepOffset(off: Offset, minuteStart: number): Promise<void> {
  const windowStart = new Date(minuteStart + off * 60_000);
  const windowEnd = new Date(windowStart.getTime() + 60_000);
  const dates = candidateDates(windowStart, windowEnd);

  // Попадает ли старт события ровно в окно [windowStart, windowEnd).
  const inWindow = (start: Date | null): boolean =>
    start !== null && start.getTime() >= windowStart.getTime() && start.getTime() < windowEnd.getTime();

  // ── Занятия (Session) ─────────────────────────────────────────────────────
  const sessions = await prisma.session.findMany({
    where: { status: 'planned', date: { in: dates }, startTime: { not: null } },
    select: {
      id: true,
      streamId: true,
      date: true,
      startTime: true,
      stream: { select: { name: true } },
      lesson: {
        select: {
          title: true,
          teachers: {
            select: {
              user: { select: { id: true, isActive: true, deletedAt: true } },
            },
          },
        },
      },
    },
  });

  const recipients: Recipient[] = [];

  // Отфильтруем занятия по окну (собранный старт попал ровно в окно).
  const sessionsInWindow = sessions.filter((s) => inWindow(eventStartUtc(s.date, s.startTime)));

  if (sessionsInWindow.length > 0) {
    // Активные студенты потоков этих занятий — одной пачкой (без N+1).
    const streamIds = [...new Set(sessionsInWindow.map((s) => s.streamId))];
    const enrollments = await prisma.streamEnrollment.findMany({
      where: {
        streamId: { in: streamIds },
        user: { isActive: true, deletedAt: null, role: 'student' },
      },
      select: { streamId: true, userId: true },
    });
    const studentsByStream = new Map<string, string[]>();
    for (const e of enrollments) {
      const arr = studentsByStream.get(e.streamId) ?? [];
      arr.push(e.userId);
      studentsByStream.set(e.streamId, arr);
    }

    for (const s of sessionsInWindow) {
      const streamId = s.streamId;
      const streamName = s.stream?.name ?? 'Поток';
      const lessonTitle = s.lesson?.title ?? 'Занятие';
      const startStr = formatStartTime(s.startTime ?? '');
      const title = 'Скоро занятие';
      const body = `«${lessonTitle}» (${streamName}) начнётся ${offsetPhrase(off)} — в ${startStr}.`;
      const url = '/dashboard/schedule';

      const userIds = new Set<string>();
      // Преподаватель(и) урока — только активные.
      for (const t of s.lesson?.teachers ?? []) {
        if (t.user.isActive && !t.user.deletedAt) userIds.add(t.user.id);
      }
      // Активные студенты потока.
      for (const uid of studentsByStream.get(streamId) ?? []) userIds.add(uid);

      for (const userId of userIds) {
        recipients.push({ userId, eventType: 'session', eventId: s.id, title, body, url });
      }
    }
  }

  // ── Встречи 1-на-1 (Meeting) ──────────────────────────────────────────────
  const meetings = await prisma.meeting.findMany({
    where: { status: 'planned', date: { in: dates }, startTime: { not: null } },
    select: {
      id: true,
      date: true,
      startTime: true,
      title: true,
      teacher: { select: { id: true, isActive: true, deletedAt: true } },
      student: { select: { id: true, isActive: true, deletedAt: true } },
    },
  });

  for (const m of meetings) {
    if (!inWindow(eventStartUtc(m.date, m.startTime))) continue;
    const startStr = formatStartTime(m.startTime ?? '');
    const meetingTitle = m.title?.trim() || 'Встреча 1-на-1';
    const title = 'Скоро встреча';
    const body = `«${meetingTitle}» начнётся ${offsetPhrase(off)} — в ${startStr}.`;
    const url = `/dashboard/meetings/${m.id}`;

    const parties = [m.teacher, m.student];
    for (const p of parties) {
      if (!p || !p.isActive || p.deletedAt) continue;
      recipients.push({ userId: p.id, eventType: 'meeting', eventId: m.id, title, body, url });
    }
  }

  if (recipients.length === 0) return;

  // ── Тумблеры пачкой: дефолт ВКЛ (нет записи → слать) ──────────────────────
  const type = prefType(off);
  const uniqueUserIds = [...new Set(recipients.map((r) => r.userId))];
  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: { in: uniqueUserIds }, type },
    select: { userId: true, pushEnabled: true },
  });
  // userId → pushEnabled (есть запись). Нет записи → дефолт true.
  const prefByUser = new Map<string, boolean>();
  for (const p of prefs) prefByUser.set(p.userId, p.pushEnabled);

  // ── Отправка: метка ДО push (P2002 → пропуск), per-user сбой глотаем ───────
  for (const r of recipients) {
    const enabled = prefByUser.get(r.userId) ?? true;
    if (!enabled) continue;

    try {
      await prisma.eventReminderSent.create({
        data: {
          eventType: r.eventType,
          eventId: r.eventId,
          offsetMinutes: off,
          userId: r.userId,
        },
      });
    } catch (err) {
      // Уже слали (двойной тик/повтор) — пропуск; прочие ошибки логируем и пропускаем.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
      console.error('[cron] event reminder marker error', { ...r, off }, err);
      continue;
    }

    // Метка записана успешно (значит мы первые) — шлём push (только push, без ленты).
    try {
      await sendPushToUser(r.userId, { title: r.title, body: r.body, data: { url: r.url } });
    } catch (err) {
      console.error('[cron] event reminder push error', { ...r, off }, err);
    }
  }
}

// Чистка меток EventReminderSent старше N дней (ретеншн): метки нужны лишь для
// идемпотентности недавних тиков — старые можно удалять.
export async function cleanupOldEventReminders(retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.eventReminderSent.deleteMany({
    where: { sentAt: { lt: cutoff } },
  });
  return count;
}

// Экспорт чистых хелперов для юнит-тестов (сборка старта/окно/даты).
export const __testing = {
  candidateDates,
  eventStartUtc,
  formatStartTime,
  prefType,
  offsetPhrase,
};
