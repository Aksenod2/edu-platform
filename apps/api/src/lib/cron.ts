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

  console.log('[cron] jobs started');
}

async function sendDeadlineReminders(): Promise<void> {
  const windowStart = new Date();
  const windowEnd = new Date(windowStart.getTime() + DEADLINE_REMINDER_HOURS * 60 * 60 * 1000);

  // Find assignments with dueDate in the reminder window
  const assignments = await prisma.assignment.findMany({
    where: {
      dueDate: { gte: windowStart, lte: windowEnd },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      studentAssignments: {
        where: { status: { in: ['assigned'] } },
        select: { studentId: true },
      },
    },
  });

  for (const assignment of assignments) {
    if (!assignment.dueDate) continue;

    const formattedDate = assignment.dueDate.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

    for (const sa of assignment.studentAssignments) {
      // Avoid duplicate: check if reminder was already sent this window
      const existingReminder = await prisma.notification.findFirst({
        where: {
          userId: sa.studentId,
          type: 'deadline_reminder',
          metadata: { path: ['assignmentId'], equals: assignment.id },
          createdAt: { gte: new Date(Date.now() - DEADLINE_REMINDER_HOURS * 60 * 60 * 1000) },
        },
      });

      if (existingReminder) continue;

      await createNotification({
        userId: sa.studentId,
        type: 'deadline_reminder',
        title: 'Дедлайн приближается',
        body: `Срок сдачи задания «${assignment.title}» — ${formattedDate}`,
        metadata: { assignmentId: assignment.id },
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
