import nodemailer from 'nodemailer';

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

export async function sendPasswordResetEmail(to: string, resetToken: string): Promise<void> {
  const frontendUrl = process.env.CORS_ORIGIN || 'http://localhost:3000';
  const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'noreply@platform.local',
    to,
    subject: 'Сброс пароля — Обучающая платформа',
    html: `
      <p>Вы запросили сброс пароля.</p>
      <p><a href="${resetUrl}">Нажмите сюда для сброса пароля</a></p>
      <p>Ссылка действительна 1 час.</p>
      <p>Если вы не запрашивали сброс — проигнорируйте это письмо.</p>
    `,
  });
}

export async function sendInviteEmail(to: string, name: string, inviteUrl: string): Promise<void> {
  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'noreply@platform.local',
    to,
    subject: 'Приглашение на обучающую платформу',
    html: `
      <p>Здравствуйте, ${name}!</p>
      <p>Вас пригласили на обучающую платформу.</p>
      <p><a href="${inviteUrl}">Перейдите по ссылке для регистрации</a></p>
      <p>Ссылка действительна 72 часа.</p>
    `,
  });
}
