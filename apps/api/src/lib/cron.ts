import cron from 'node-cron';
import { prisma } from '@platform/db';
import { createNotification } from './notifications.js';
import { sweepFailedRecordings } from './zoom-recording.js';
import { sweepSessionAttendance } from './zoom-attendance.js';

// Минимальный логгер (форма Fastify-логгера) для свиперов, работающих вне
// HTTP-контекста (нет request/app в cron). Пишем в console, как остальные задачи.
const cronLogger = {
  log: {
    error: (...args: unknown[]) => console.error('[cron]', ...args),
    warn: (...args: unknown[]) => console.warn('[cron]', ...args),
    info: (...args: unknown[]) => console.log('[cron]', ...args),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

/**
 * How many hours before deadline to send reminder (default: 24).
 */
const DEADLINE_REMINDER_HOURS = Number(process.env.DEADLINE_REMINDER_HOURS) || 24;

/**
 * Auto-delete notifications older than N days (default: 90).
 */
const NOTIFICATION_RETENTION_DAYS = Number(process.env.NOTIFICATION_RETENTION_DAYS) || 90;

/**
 * Auto-delete processed/failed Zoom webhook events older than N days (default: 30).
 * Записи нужны лишь для идемпотентности недавних доставок — старые можно чистить.
 */
const ZOOM_WEBHOOK_EVENT_RETENTION_DAYS =
  Number(process.env.ZOOM_WEBHOOK_EVENT_RETENTION_DAYS) || 30;

let cronStarted = false;

export function startCronJobs(): void {
  if (cronStarted) return;
  cronStarted = true;

  // Deadline reminders — every hour
  cron.schedule('0 * * * *', async () => {
    try {
      await sendDeadlineReminders();
    } catch (err) {
      console.error('[cron] deadline reminders error', err);
    }
  });

  // Auto-cleanup old notifications — every day at 03:00
  cron.schedule('0 3 * * *', async () => {
    try {
      await cleanupOldNotifications();
    } catch (err) {
      console.error('[cron] cleanup notifications error', err);
    }
  });

  // Auto-cleanup old processed/failed Zoom webhook events — every day at 03:30
  cron.schedule('30 3 * * *', async () => {
    try {
      await cleanupOldZoomWebhookEvents();
    } catch (err) {
      console.error('[cron] cleanup zoom webhook events error', err);
    }
  });

  // Свипер «недокачанных» записей Zoom — каждые 30 минут. Добирает транзиентные
  // сбои, которые не вытянул авто-ретрай внутри обработки (файл доехал по CDN Zoom
  // спустя минуты), и реанимирует «зависший processing». Сама выборка/повтор —
  // в sweepFailedRecordings (zoom-recording.ts), ошибки внутри она глотает.
  // NB: при >1 инстансе API возможны дубли проходов; сейчас инстанс ОДИН, поэтому
  // распределённый лок не нужен (claim внутри обработки и так защищает от дублей).
  cron.schedule('*/30 * * * *', async () => {
    try {
      await sweepFailedRecordings();
    } catch (err) {
      console.error('[cron] sweep zoom recordings error', err);
    }
  });

  // Свипер посещаемости Zoom — каждые 15 минут. Report participants готов НЕ сразу
  // после meeting.ended (Zoom агрегирует минуты), поэтому добираем недавно
  // завершённые занятия с привязкой к встрече, у которых ещё нет zoom-записей
  // посещаемости. Выборка/повтор/грейсфул — в sweepSessionAttendance
  // (zoom-attendance.ts), ошибки внутри она глотает.
  cron.schedule('*/15 * * * *', async () => {
    try {
      await sweepSessionAttendance(cronLogger);
    } catch (err) {
      console.error('[cron] sweep zoom attendance error', err);
    }
  });

  console.log('[cron] jobs started');
}

async function sendDeadlineReminders(): Promise<void> {
  const windowStart = new Date();
  const windowEnd = new Date(windowStart.getTime() + DEADLINE_REMINDER_HOURS * 60 * 60 * 1000);

  // Find sessions with a due assignment in the reminder window
  const sessions = await prisma.session.findMany({
    where: {
      dueDate: { gte: windowStart, lte: windowEnd },
      lesson: { hasAssignment: true },
    },
    include: {
      lesson: true,
      stream: true,
      studentAssignments: {
        where: { status: { in: ['assigned'] } },
        include: { student: true },
      },
    },
  });

  for (const session of sessions) {
    if (!session.dueDate) continue;

    const formattedDate = session.dueDate.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

    for (const sa of session.studentAssignments) {
      // Avoid duplicate: check if reminder was already sent this window
      const existingReminder = await prisma.notification.findFirst({
        where: {
          userId: sa.studentId,
          type: 'deadline_reminder',
          metadata: { path: ['sessionId'], equals: session.id },
          createdAt: { gte: new Date(Date.now() - DEADLINE_REMINDER_HOURS * 60 * 60 * 1000) },
        },
      });

      if (existingReminder) continue;

      await createNotification({
        userId: sa.studentId,
        type: 'deadline_reminder',
        title: 'Дедлайн приближается',
        body: `Срок сдачи задания «${session.lesson.assignmentTitle}» — ${formattedDate}`,
        metadata: { sessionId: session.id, lessonId: session.lessonId },
      });
    }
  }
}

async function cleanupOldNotifications(): Promise<void> {
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.notification.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  if (count > 0) {
    console.log(`[cron] deleted ${count} old notifications (older than ${NOTIFICATION_RETENTION_DAYS} days)`);
  }
}

// Чистит уже обработанные/проваленные события вебхуков Zoom старше N дней.
// Не трогаем status='received' (вдруг ещё в обработке / зависшие — пусть видны).
async function cleanupOldZoomWebhookEvents(): Promise<void> {
  const cutoff = new Date(
    Date.now() - ZOOM_WEBHOOK_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const { count } = await prisma.zoomWebhookEvent.deleteMany({
    where: { status: { in: ['processed', 'failed'] }, createdAt: { lt: cutoff } },
  });
  if (count > 0) {
    console.log(
      `[cron] deleted ${count} old Zoom webhook events (older than ${ZOOM_WEBHOOK_EVENT_RETENTION_DAYS} days)`,
    );
  }
}
