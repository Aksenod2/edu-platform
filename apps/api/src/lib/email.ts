import nodemailer from 'nodemailer';
import * as templates from './email-templates.js';

const smtpPort = Number(process.env.SMTP_PORT) || 1025;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: smtpPort,
  // port 465 uses implicit TLS; port 587 uses STARTTLS (secure: false)
  secure: smtpPort === 465,
  ...(process.env.SMTP_USER && process.env.SMTP_PASS
    ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
    : {}),
});

const from = () => process.env.SMTP_FROM || 'noreply@platform.local';
const frontendUrl = () => process.env.CORS_ORIGIN || 'http://localhost:3000';

async function send(to: string, msg: templates.EmailMessage): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await transporter.sendMail({
        from: from(),
        to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
    }
  }
}

// ─── Existing endpoints (refactored to branded templates) ────────

export async function sendPasswordResetEmail(to: string, resetToken: string): Promise<void> {
  const url = frontendUrl();
  const msg = templates.passwordReset({
    frontendUrl: url,
    resetUrl: `${url}/reset-password?token=${resetToken}`,
  });
  await send(to, msg);
}

export async function sendInviteEmail(to: string, name: string, inviteUrl: string): Promise<void> {
  const msg = templates.platformInvite({
    frontendUrl: frontendUrl(),
    name,
    inviteUrl,
  });
  await send(to, msg);
}

/**
 * Generic notification email (legacy — kept for backwards compat).
 */
export async function sendNotificationEmail(
  to: string,
  name: string,
  title: string,
  body: string,
): Promise<void> {
  const url = frontendUrl();
  await send(to, {
    subject: title,
    html: templates.platformInvite({ frontendUrl: url, name, inviteUrl: url }).html
      .replace('Добро пожаловать!', title)
      .replace(/Вас пригласили[\s\S]*?Принять приглашение/, body),
    text: `Здравствуйте, ${name}!\n\n${body}\n\nПерейти на платформу: ${url}\n\n---\nУправление уведомлениями: ${url}/settings/notifications`,
  });
}

// ─── New notification emails ─────────────────────────────────────

export async function sendNewLessonEmail(
  to: string,
  ctx: { studentName: string; lessonTitle: string; streamTitle: string; lessonUrl: string },
): Promise<void> {
  await send(to, templates.newLessonPublished({ frontendUrl: frontendUrl(), ...ctx }));
}

export async function sendNewAssignmentEmail(
  to: string,
  ctx: { studentName: string; assignmentTitle: string; streamTitle: string; deadline?: string; assignmentUrl: string },
): Promise<void> {
  await send(to, templates.newAssignmentAdded({ frontendUrl: frontendUrl(), ...ctx }));
}

export async function sendDeadlineReminderEmail(
  to: string,
  ctx: { studentName: string; assignmentTitle: string; deadline: string; assignmentUrl: string },
): Promise<void> {
  await send(to, templates.deadlineReminder({ frontendUrl: frontendUrl(), ...ctx }));
}

export async function sendTeacherReplyEmail(
  to: string,
  ctx: { studentName: string; threadSubject: string; replyPreview: string; threadUrl: string },
): Promise<void> {
  await send(to, templates.teacherReply({ frontendUrl: frontendUrl(), ...ctx }));
}

export async function sendAssignmentReviewedEmail(
  to: string,
  ctx: { studentName: string; assignmentTitle: string; grade?: string; feedbackPreview?: string; assignmentUrl: string },
): Promise<void> {
  await send(to, templates.assignmentReviewed({ frontendUrl: frontendUrl(), ...ctx }));
}

export async function sendNewScheduleEventEmail(
  to: string,
  ctx: { studentName: string; eventTitle: string; eventDate: string; eventTime?: string; streamTitle: string; scheduleUrl: string },
): Promise<void> {
  await send(to, templates.newScheduleEvent({ frontendUrl: frontendUrl(), ...ctx }));
}

export async function sendSubmissionReceivedEmail(
  to: string,
  ctx: { adminName: string; studentName: string; assignmentTitle: string; streamTitle: string; submissionUrl: string },
): Promise<void> {
  await send(to, templates.submissionReceived({ frontendUrl: frontendUrl(), ...ctx }));
}
