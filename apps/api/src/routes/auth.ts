import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '@platform/db';
import { signAccessToken } from '../lib/jwt.js';
import { sendPasswordResetEmail } from '../lib/email.js';

const REFRESH_TOKEN_EXPIRY_DAYS = 7;

function refreshTokenExpiresAt(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/login
  app.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email и пароль обязательны' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { studentProfile: { select: { questionnaireCompletedAt: true } } },
    });
    if (!user || !user.isActive) {
      return reply.status(401).send({ error: 'Неверный email или пароль' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return reply.status(401).send({ error: 'Неверный email или пароль' });
    }

    const accessToken = signAccessToken({ userId: user.id, role: user.role });

    const refreshTokenValue = crypto.randomBytes(48).toString('hex');
    await prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId: user.id,
        expiresAt: refreshTokenExpiresAt(),
      },
    });

    reply.setCookie('refreshToken', refreshTokenValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth',
      maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        questionnaireCompleted: user.role === 'student'
          ? !!user.studentProfile?.questionnaireCompletedAt
          : undefined,
      },
    };
  });

  // POST /auth/refresh
  app.post('/auth/refresh', async (request, reply) => {
    const refreshTokenValue = request.cookies.refreshToken;
    if (!refreshTokenValue) {
      return reply.status(401).send({ error: 'Refresh token не предоставлен' });
    }

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshTokenValue },
      include: {
        user: {
          include: { studentProfile: { select: { questionnaireCompletedAt: true } } },
        },
      },
    });

    if (!storedToken || storedToken.expiresAt < new Date() || !storedToken.user.isActive) {
      if (storedToken) {
        await prisma.refreshToken.delete({ where: { id: storedToken.id } });
      }
      reply.clearCookie('refreshToken', { path: '/auth' });
      return reply.status(401).send({ error: 'Невалидный или просроченный refresh token' });
    }

    // Rotate refresh token
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });
    const newRefreshTokenValue = crypto.randomBytes(48).toString('hex');
    await prisma.refreshToken.create({
      data: {
        token: newRefreshTokenValue,
        userId: storedToken.userId,
        expiresAt: refreshTokenExpiresAt(),
      },
    });

    reply.setCookie('refreshToken', newRefreshTokenValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth',
      maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
    });

    const accessToken = signAccessToken({
      userId: storedToken.user.id,
      role: storedToken.user.role,
    });

    return {
      accessToken,
      user: {
        id: storedToken.user.id,
        email: storedToken.user.email,
        name: storedToken.user.name,
        role: storedToken.user.role,
        mustChangePassword: storedToken.user.mustChangePassword,
        questionnaireCompleted: storedToken.user.role === 'student'
          ? !!storedToken.user.studentProfile?.questionnaireCompletedAt
          : undefined,
      },
    };
  });

  // POST /auth/logout
  app.post('/auth/logout', async (request, reply) => {
    const refreshTokenValue = request.cookies.refreshToken;
    if (refreshTokenValue) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshTokenValue } });
    }
    reply.clearCookie('refreshToken', { path: '/auth' });
    return { success: true };
  });

  // POST /auth/forgot-password
  app.post('/auth/forgot-password', async (request, reply) => {
    const { email } = request.body as { email: string };
    if (!email) {
      return reply.status(400).send({ error: 'Email обязателен' });
    }

    // Always return success to prevent email enumeration
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.isActive) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken,
          resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });

      try {
        await sendPasswordResetEmail(email, resetToken);
      } catch (err) {
        request.log.error(err, 'Failed to send password reset email');
      }
    }

    return { message: 'Если аккаунт существует, письмо со ссылкой отправлено' };
  });

  // POST /auth/reset-password
  app.post('/auth/reset-password', async (request, reply) => {
    const { token, password } = request.body as { token: string; password: string };

    if (!token || !password) {
      return reply.status(400).send({ error: 'Токен и новый пароль обязательны' });
    }

    if (password.length < 6) {
      return reply.status(400).send({ error: 'Пароль должен быть не менее 6 символов' });
    }

    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiresAt: { gt: new Date() },
      },
    });

    if (!user) {
      return reply.status(400).send({ error: 'Невалидный или просроченный токен сброса' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiresAt: null,
        mustChangePassword: false,
      },
    });

    // Invalidate all refresh tokens on password change
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    return { message: 'Пароль успешно изменён' };
  });

  // POST /auth/change-password (for forced password change on first login)
  app.post('/auth/change-password', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Токен не предоставлен' });
    }

    let userId: string;
    try {
      const { verifyAccessToken } = await import('../lib/jwt.js');
      const payload = verifyAccessToken(authHeader.slice(7));
      userId = payload.userId;
    } catch {
      return reply.status(401).send({ error: 'Невалидный токен' });
    }

    const { currentPassword, newPassword } = request.body as {
      currentPassword: string;
      newPassword: string;
    };

    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ error: 'Текущий и новый пароль обязательны' });
    }

    if (newPassword.length < 6) {
      return reply.status(400).send({ error: 'Новый пароль должен быть не менее 6 символов' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.status(404).send({ error: 'Пользователь не найден' });
    }

    const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!validPassword) {
      return reply.status(401).send({ error: 'Неверный текущий пароль' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: false,
      },
    });

    // Issue new access token with updated state
    const accessToken = signAccessToken({ userId: user.id, role: user.role });

    return { accessToken, message: 'Пароль успешно изменён' };
  });

  // POST /auth/accept-invite — accept invite and set password
  app.post('/auth/accept-invite', async (request, reply) => {
    const { token, password } = request.body as { token: string; password: string };

    if (!token || !password) {
      return reply.status(400).send({ error: 'Токен и пароль обязательны' });
    }

    if (password.length < 6) {
      return reply.status(400).send({ error: 'Пароль должен быть не менее 6 символов' });
    }

    const user = await prisma.user.findFirst({
      where: {
        inviteToken: token,
        inviteExpiresAt: { gt: new Date() },
      },
    });

    if (!user) {
      return reply.status(400).send({ error: 'Невалидная или просроченная ссылка приглашения' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        inviteToken: null,
        inviteExpiresAt: null,
        mustChangePassword: false,
      },
    });

    return { message: 'Регистрация завершена. Теперь вы можете войти.' };
  });
}
