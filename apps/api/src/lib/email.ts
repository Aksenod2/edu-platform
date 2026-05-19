import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: Number(process.env.SMTP_PORT) || 1025,
  secure: false,
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
