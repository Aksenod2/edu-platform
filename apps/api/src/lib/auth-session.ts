import crypto from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { prisma } from '@platform/db';
import { signAccessToken } from './jwt.js';
import { getFileUrl } from './s3.js';

// Срок жизни refresh-токена (в днях). Должен совпадать с тем, что было в auth.ts.
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

export function refreshTokenExpiresAt(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

// Подписанный временный URL аватара пользователя по avatarKey (или null).
export async function avatarUrlFor(
  avatarKey: string | null | undefined,
): Promise<string | null> {
  if (!avatarKey) return null;
  try {
    return await getFileUrl(avatarKey);
  } catch {
    return null;
  }
}

// Минимальный набор полей пользователя, нужный для выдачи сессии и сборки ответа.
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  mustChangePassword: boolean;
  avatarKey: string | null;
  studentProfile?: { questionnaireCompletedAt: Date | null } | null;
}

export interface SessionResult {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    mustChangePassword: boolean;
    avatarUrl: string | null;
    questionnaireCompleted?: boolean;
  };
}

/**
 * Выдаёт сессию пользователю: подписывает access-токен, создаёт refresh-токен,
 * ставит httpOnly-cookie и собирает user-объект ответа (с подписанным avatarUrl
 * и флагом questionnaireCompleted для студентов).
 *
 * Вынесено из POST /auth/login, чтобы переиспользовать при публичной регистрации
 * по инвайт-ссылке («после регистрации сразу логиним студента»). Поведение login
 * не меняется.
 */
export async function issueSession(
  reply: FastifyReply,
  user: SessionUser,
): Promise<SessionResult> {
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
    path: '/',
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
      avatarUrl: await avatarUrlFor(user.avatarKey),
      questionnaireCompleted:
        user.role === 'student'
          ? !!user.studentProfile?.questionnaireCompletedAt
          : undefined,
    },
  };
}
