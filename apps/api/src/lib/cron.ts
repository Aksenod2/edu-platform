import cron from 'node-cron';
import { prisma } from '@platform/db';
import { createNotification } from './notifications.js';

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
