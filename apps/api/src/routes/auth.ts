import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '@platform/db';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { signAccessToken } from '../lib/jwt.js';
import { authenticate } from '../middleware/auth.js';
import { clearConsentGateCache } from '../middleware/consent-gate.js';
import { sendPasswordResetEmail } from '../lib/email.js';
import { uploadFile, getFileUrl } from '../lib/s3.js';
import { issueSession, buildSessionUserPayload } from '../lib/auth-session.js';
import { isForeignEmail, FOREIGN_EMAIL_STUDENT_MESSAGE } from '@platform/shared';
import { normalizeEmail, isValidEmail, normalizePhone, isValidPhone } from '../lib/validation.js';
import {
  latestVersionForSlug,
  listUserConsents,
  parseConsentTypes,
  pendingRequiredConsents,
  recordConsents,
  requestUserAgent,
} from '../lib/consents.js';

// Подписанный временный URL аватара пользователя по avatarKey (или null).
async function avatarUrlFor(avatarKey: string | null | undefined): Promise<string | null> {
  if (!avatarKey) return null;
  try {
    return await getFileUrl(avatarKey);
  } catch {
    return null;
  }
}

// Допускаем строго PNG/JPEG/WebP. Проверяем И mime, И расширение имени файла,
// т.к. браузеры/ОС иногда отдают неточный mime.
const AVATAR_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const AVATAR_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

function isAvatarImage(fileName: string, mimeType: string): boolean {
  const lowerName = (fileName || '').toLowerCase();
  const okExt = AVATAR_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const okMime = AVATAR_MIME_TYPES.has((mimeType || '').toLowerCase());
  return okExt && okMime;
}

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
      where: { email: normalizeEmail(email) },
      include: { studentProfile: { select: { questionnaireCompletedAt: true } } },
    });
    if (!user || !user.isActive) {
      return reply.status(401).send({ error: 'Неверный email или пароль' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return reply.status(401).send({ error: 'Неверный email или пароль' });
    }

    // Выдача access/refresh-токенов, cookie и сборка user-объекта — в общем хелпере
    // (переиспользуется публичной регистрацией по инвайт-ссылке).
    return issueSession(reply, user);
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
      reply.clearCookie('refreshToken', { path: '/' });
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
      path: '/',
      maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
    });

    const accessToken = signAccessToken({
      userId: storedToken.user.id,
      role: storedToken.user.role,
    });

    return {
      accessToken,
      // User-объект собирается общим хелпером (тот же, что в issueSession/login):
      // avatarUrl, questionnaireCompleted и pendingConsents — в одном месте.
      user: await buildSessionUserPayload(storedToken.user),
    };
  });

  // POST /auth/logout
  app.post('/auth/logout', async (request, reply) => {
    const refreshTokenValue = request.cookies.refreshToken;
    if (refreshTokenValue) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshTokenValue } });
    }
    reply.clearCookie('refreshToken', { path: '/' });
    return { success: true };
  });

  // POST /auth/forgot-password
  app.post('/auth/forgot-password', async (request, reply) => {
    const { email } = request.body as { email: string };
    if (!email) {
      return reply.status(400).send({ error: 'Email обязателен' });
    }

    // Always return success to prevent email enumeration
    const normalizedEmail = normalizeEmail(email);
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (user && user.isActive) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken,
          resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });

      // Письмо отправляем НЕ блокируя HTTP-ответ: иначе при недоступном SMTP запрос
      // висит на ретраях, а форма на фронте бесконечно показывает «Отправка...».
      // Заодно это держит ответ быстрым и одинаковым (защита от перечисления email).
      void sendPasswordResetEmail(normalizedEmail, resetToken).catch((err) => {
        request.log.error(err, 'Failed to send password reset email');
      });
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

    // Инвалидируем все сессии (refresh-токены) — как в reset-password и
    // PATCH /users/me: смена пароля должна разлогинивать другие устройства.
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    // Issue new access token with updated state
    const accessToken = signAccessToken({ userId: user.id, role: user.role });

    return { accessToken, message: 'Пароль успешно изменён' };
  });

  // POST /auth/accept-invite — accept invite and set password
  app.post('/auth/accept-invite', async (request, reply) => {
    const body = (request.body ?? {}) as {
      token?: unknown;
      password?: unknown;
      lastName?: unknown;
      phone?: unknown;
      consents?: unknown;
    };
    const token = typeof body.token === 'string' ? body.token : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!token || !password) {
      return reply.status(400).send({ error: 'Токен и пароль обязательны' });
    }

    if (password.length < 6) {
      return reply.status(400).send({ error: 'Пароль должен быть не менее 6 символов' });
    }

    // --- Опциональные фамилия и телефон (Волна 1 «правовой минимум») ---
    if (body.lastName !== undefined && typeof body.lastName !== 'string') {
      return reply.status(400).send({ error: 'Некорректный формат фамилии' });
    }
    const lastName =
      typeof body.lastName === 'string' && body.lastName.trim() !== ''
        ? body.lastName.trim()
        : null;

    if (body.phone !== undefined && typeof body.phone !== 'string') {
      return reply.status(400).send({ error: 'Некорректный формат телефона' });
    }
    const phone = typeof body.phone === 'string' ? normalizePhone(body.phone) : null;
    if (phone !== null && !isValidPhone(phone)) {
      return reply.status(400).send({ error: 'Некорректный формат телефона' });
    }

    // --- Опциональные согласия: валидируем по enum (400 на неизвестные значения) ---
    const consentTypes = parseConsentTypes(body.consents);
    if (consentTypes === null) {
      return reply.status(400).send({ error: 'Некорректное значение согласий' });
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
        // Фамилию/телефон пишем только если переданы — иначе не трогаем поля.
        ...(lastName !== null ? { lastName } : {}),
        ...(phone !== null ? { phone } : {}),
      },
    });

    // Фиксируем переданные согласия ПОСЛЕ успешной активации аккаунта.
    // recordConsents не кидает (мягкая деградация — см. lib/consents.ts).
    await recordConsents(user.id, consentTypes, request);

    return { message: 'Регистрация завершена. Теперь вы можете войти.' };
  });

  // PATCH /users/me — самостоятельное обновление профиля текущего пользователя.
  // Доступно любому аутентифицированному пользователю (студент или админ).
  // Позволяет менять только своё имя, email и пароль; role/isActive менять нельзя.
  app.patch('/users/me', { onRequest: authenticate }, async (request, reply) => {
    const userId = request.user!.userId;

    const body = (request.body ?? {}) as {
      name?: string;
      lastName?: unknown;
      phone?: unknown;
      email?: string;
      currentPassword?: string;
      newPassword?: string;
    };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt !== null) {
      return reply.status(404).send({ error: 'Пользователь не найден' });
    }

    const data: Record<string, unknown> = {};

    // --- Имя ---
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) {
        return reply.status(400).send({ error: 'Имя не может быть пустым' });
      }
      data.name = name;
    }

    // --- Фамилия (nullable: пустая строка очищает поле) ---
    if (body.lastName !== undefined) {
      if (typeof body.lastName !== 'string') {
        return reply.status(400).send({ error: 'Некорректный формат фамилии' });
      }
      const lastName = body.lastName.trim();
      data.lastName = lastName === '' ? null : lastName;
    }

    // --- Телефон (nullable: пустая строка очищает поле) ---
    if (body.phone !== undefined) {
      if (typeof body.phone !== 'string') {
        return reply.status(400).send({ error: 'Некорректный формат телефона' });
      }
      const phone = normalizePhone(body.phone);
      if (phone !== null && !isValidPhone(phone)) {
        return reply.status(400).send({ error: 'Некорректный формат телефона' });
      }
      data.phone = phone;
    }

    // --- Email ---
    if (body.email !== undefined) {
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) {
        return reply.status(400).send({ error: 'Некорректный формат email' });
      }
      if (email !== user.email) {
        // Зарубежная почта запрещена при смене email (ст. 10.7 149-ФЗ, issue #132).
        // Проверяем только НОВЫЙ адрес: существующие аккаунты на зарубежной почте
        // продолжают работать (вход/refresh/сброс пароля не трогаем).
        if (isForeignEmail(email)) {
          return reply.status(400).send({ error: FOREIGN_EMAIL_STUDENT_MESSAGE });
        }
        const emailTaken = await prisma.user.findUnique({ where: { email } });
        if (emailTaken) {
          return reply.status(409).send({ error: 'Этот email уже используется' });
        }
        data.email = email;
      }
    }

    // --- Смена пароля ---
    // Менять пароль можно только подтвердив текущий через bcrypt.compare.
    const wantsPasswordChange =
      body.newPassword !== undefined || body.currentPassword !== undefined;
    if (wantsPasswordChange) {
      if (!body.currentPassword || !body.newPassword) {
        return reply
          .status(400)
          .send({ error: 'Для смены пароля укажите текущий и новый пароль' });
      }
      if (body.newPassword.length < 6) {
        return reply
          .status(400)
          .send({ error: 'Новый пароль должен быть не менее 6 символов' });
      }
      const validPassword = await bcrypt.compare(body.currentPassword, user.passwordHash);
      if (!validPassword) {
        return reply.status(403).send({ error: 'Неверный текущий пароль' });
      }
      data.passwordHash = await bcrypt.hash(body.newPassword, 12);
      // Самостоятельная смена пароля снимает флаг принудительной смены.
      data.mustChangePassword = false;
    }

    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: 'Нет данных для обновления' });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        avatarKey: true,
        createdAt: true,
      },
    });

    // При смене пароля инвалидируем все остальные сессии (refresh-токены)
    // и выдаём новый access-токен для текущей сессии.
    let accessToken: string | undefined;
    if (data.passwordHash) {
      await prisma.refreshToken.deleteMany({ where: { userId } });
      accessToken = signAccessToken({ userId: updated.id, role: updated.role });
    }

    const { avatarKey, ...userFields } = updated;
    return {
      user: { ...userFields, avatarUrl: await avatarUrlFor(avatarKey) },
      accessToken,
    };
  });

  // POST /users/me/avatar — загрузка аватара текущего пользователя (любой
  // аутентифицированный). Принимается ОДИН файл-изображение (PNG/JPEG/WebP).
  // Файл кладётся в хранилище (folder 'avatars'), ключ пишется в user.avatarKey.
  // Возвращает подписанный временный avatarUrl.
  app.post('/users/me/avatar', { onRequest: authenticate }, async (request, reply) => {
    const userId = request.user!.userId;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt !== null) {
      return reply.status(404).send({ error: 'Пользователь не найден' });
    }

    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Ожидается multipart/form-data' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'Файл не найден в запросе' });
    }

    const originalName = data.filename || 'avatar';
    const mimeType = data.mimetype || 'application/octet-stream';

    if (!isAvatarImage(originalName, mimeType)) {
      // Слив потока, чтобы не подвиснуть на необработанном файле.
      data.file.resume();
      return reply.status(400).send({ error: 'Поддерживаются изображения PNG, JPEG и WebP' });
    }

    const chunks: Buffer[] = [];
    await pipeline(
      data.file,
      new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk);
          cb();
        },
      }),
    );

    const buffer = Buffer.concat(chunks);

    let uploaded: { key: string; url: string; size: number };
    try {
      uploaded = await uploadFile(buffer, originalName, mimeType, 'avatars');
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : 'Ошибка загрузки файла' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { avatarKey: uploaded.key },
    });

    return reply.status(201).send({ avatarUrl: await getFileUrl(uploaded.key) });
  });

  // GET /users/me/consents — история СВОИХ юридических согласий (любой
  // аутентифицированный). Форма та же, что у админского GET /users/:id/consents:
  // свои ip/userAgent пользователь видеть может.
  app.get('/users/me/consents', { onRequest: authenticate }, async (request) => {
    return { consents: await listUserConsents(request.user!.userId) };
  });

  // POST /users/me/consents — досбор согласий у СУЩЕСТВУЮЩИХ пользователей
  // (Волна 1.1): студенты, зарегистрированные ДО появления согласий, дают
  // обязательные при следующем заходе на платформу. Журнал append-only через
  // recordConsents (ip/userAgent фиксируются автоматически); marketing можно
  // передавать вместе с обязательными. В ответе — оставшиеся обязательные
  // согласия: по пустому массиву фронт понимает, что гейт снят.
  app.post('/users/me/consents', { onRequest: authenticate }, async (request, reply) => {
    const userId = request.user!.userId;
    const body = (request.body ?? {}) as { consents?: unknown };

    const types = parseConsentTypes(body.consents);
    if (types === null) {
      return reply.status(400).send({ error: 'Некорректный формат согласий' });
    }
    if (types.length === 0) {
      return reply.status(400).send({ error: 'Не передано ни одного согласия' });
    }

    // Уже данные обязательные согласия повторно не журналируем (повторный POST
    // не должен плодить дубли в append-only журнале); marketing — append by design:
    // granted-запись = актуальный статус подписки, пишем как передали.
    const pendingBefore = await pendingRequiredConsents(userId);
    const toRecord = types.filter((type) => type === 'marketing' || pendingBefore.includes(type));
    await recordConsents(userId, toRecord, request);
    // Сброс кэша серверного гейта согласий (issue #119): сейчас отрицательный
    // результат там не кэшируется, так что это страховка инварианта «после
    // выдачи согласий доступ открывается сразу» на случай будущих изменений.
    clearConsentGateCache(userId);

    return reply.status(201).send({ pendingConsents: await pendingRequiredConsents(userId) });
  });

  // POST /users/me/consents/marketing — дать/отозвать согласие на рекламные
  // рассылки из ЛК. Append-only: пишем НОВУЮ запись granted/revoked с актуальной
  // версией marketing-consent (текущий статус = последняя запись). Если версий
  // документа ещё нет — 409: фиксировать не к чему (documentVersionId NOT NULL).
  app.post('/users/me/consents/marketing', { onRequest: authenticate }, async (request, reply) => {
    const userId = request.user!.userId;
    const body = (request.body ?? {}) as { granted?: unknown };

    if (typeof body.granted !== 'boolean') {
      return reply.status(400).send({ error: 'Поле granted (boolean) обязательно' });
    }

    const version = await latestVersionForSlug('marketing-consent');
    if (!version) {
      return reply.status(409).send({
        error:
          'Документ «Согласие на рекламные рассылки» ещё не опубликован — изменить согласие пока нельзя',
      });
    }

    const consent = await prisma.userConsent.create({
      data: {
        userId,
        documentVersionId: version.id,
        consentType: 'marketing',
        action: body.granted ? 'granted' : 'revoked',
        ip: request.ip || null,
        userAgent: requestUserAgent(request),
      },
      select: { id: true, consentType: true, action: true, createdAt: true },
    });

    return reply.status(201).send({ consent });
  });

  // DELETE /users/me/avatar — удаление аватара текущего пользователя.
  // Обнуляем avatarKey (физическое удаление объекта не обязательно).
  app.delete('/users/me/avatar', { onRequest: authenticate }, async (request, reply) => {
    const userId = request.user!.userId;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt !== null) {
      return reply.status(404).send({ error: 'Пользователь не найден' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { avatarKey: null },
    });

    return { avatarUrl: null };
  });
}
