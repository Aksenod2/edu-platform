import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { prisma, Prisma } from '@platform/db';
import {
  isValidEmail,
  isValidPassword,
  isValidPhone,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  normalizePhone,
} from '../lib/validation.js';
import { isForeignEmail, FOREIGN_EMAIL_STUDENT_MESSAGE } from '@platform/shared/foreign-email';
import { enrollStudentInStream, notifyStreamTeachersOfEnrollment } from '../lib/stream-enroll.js';
import { issueSession } from '../lib/auth-session.js';
import { parseConsentTypes, recordConsents } from '../lib/consents.js';

/**
 * Публичные эндпоинты вступления в поток по инвайт-ссылке. БЕЗ JWT: доступ по
 * публичному токену потока (Stream.joinToken). Регистрируется отдельным
 * плагин-скоупом с локальным rate-limit (по образцу zoom-webhooks/auth-scope).
 */
export async function streamsPublicRoutes(app: FastifyInstance) {
  // GET мягче, POST жёстче — задаём базовый лимит на скоуп, на POST переопределяем.
  const getMax = Number(process.env.PUBLIC_JOIN_GET_RATE_LIMIT_MAX) || 60;
  const postMax = Number(process.env.PUBLIC_JOIN_POST_RATE_LIMIT_MAX) || 10;

  await app.register(rateLimit, {
    max: getMax,
    timeWindow: '1 minute',
  });

  // GET /public/streams/join/:token — превью потока по инвайт-токену.
  // Возвращает только имя и флаг closed (true для архивного потока). Ничего лишнего.
  app.get('/public/streams/join/:token', async (request, reply) => {
    const { token } = request.params as { token: string };

    const stream = await prisma.stream.findUnique({
      where: { joinToken: token },
      select: { name: true, status: true },
    });

    if (!stream) {
      return reply.status(404).send({ error: 'Ссылка недействительна' });
    }

    return { stream: { name: stream.name, closed: stream.status === 'archived' } };
  });

  // POST /public/streams/join/:token — регистрация студента по инвайт-ссылке.
  // Создаёт пользователя (role student) + зачисляет на поток в одной транзакции,
  // затем сразу выдаёт сессию (accessToken + refresh-cookie). Жёсткий rate-limit
  // и bodyLimit (тело крошечное: email/name/password).
  app.post(
    '/public/streams/join/:token',
    {
      bodyLimit: 4 * 1024,
      config: {
        rateLimit: {
          max: postMax,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const body = (request.body ?? {}) as {
        email?: unknown;
        name?: unknown;
        password?: unknown;
        lastName?: unknown;
        phone?: unknown;
        consents?: unknown;
      };

      const email =
        typeof body.email === 'string' ? normalizeEmail(body.email) : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      // --- Валидация входа (единые правила из lib/validation) ---
      if (!email || !name || !password) {
        return reply.status(400).send({ error: 'Email, имя и пароль обязательны' });
      }
      if (!isValidEmail(email)) {
        return reply.status(400).send({ error: 'Некорректный формат email' });
      }
      // Зарубежная почта запрещена при регистрации (ст. 10.7 149-ФЗ, issue #132).
      // Проверка ПОСЛЕ нормализации email.
      if (isForeignEmail(email)) {
        return reply.status(400).send({ error: FOREIGN_EMAIL_STUDENT_MESSAGE });
      }
      if (!isValidPassword(password)) {
        return reply
          .status(400)
          .send({ error: `Пароль должен быть не менее ${MIN_PASSWORD_LENGTH} символов` });
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

      // --- Поиск потока по токену ---
      const stream = await prisma.stream.findUnique({
        where: { joinToken: token },
        select: { id: true, status: true },
      });
      if (!stream) {
        return reply.status(404).send({ error: 'Ссылка недействительна' });
      }

      // В архивный поток по ссылке записаться нельзя.
      if (stream.status === 'archived') {
        return reply.status(409).send({ error: 'Набор в эту группу закрыт' });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      // Создание пользователя + зачисление (с бэкофиллом заданий) — атомарно.
      let user: {
        id: string;
        email: string;
        name: string;
        lastName: string | null;
        phone: string | null;
        role: string;
        mustChangePassword: boolean;
        avatarKey: string | null;
      };
      try {
        user = await prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              email,
              name,
              lastName,
              phone,
              passwordHash,
              role: 'student',
            },
            select: {
              id: true,
              email: true,
              name: true,
              lastName: true,
              phone: true,
              role: true,
              mustChangePassword: true,
              avatarKey: true,
            },
          });
          await enrollStudentInStream(stream.id, created.id, tx);
          return created;
        });
      } catch (err) {
        // Email уже занят (User.email @unique). Отвечаем НЕЙТРАЛЬНО: не подтверждаем
        // существование сверх этого и НЕ проверяем пароль существующего аккаунта.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply
            .status(409)
            .send({ error: 'Аккаунт с таким email уже существует — войдите' });
        }
        throw err;
      }

      // Уведомляем преподавателей потока о новом студенте (student_enrolled). Студент
      // здесь только что создан, поэтому зачисление всегда новое. Шлём ПОСЛЕ коммита tx,
      // fire-and-forget: сбой рассылки не должен ломать регистрацию.
      notifyStreamTeachersOfEnrollment(stream.id, user.id).catch(() => {});

      // Фиксируем переданные согласия ПОСЛЕ успешного создания пользователя.
      // recordConsents не кидает: отсутствие опубликованной версии документа или
      // ошибка журнала НЕ ломают регистрацию (мягкая деградация, warn/error в лог).
      await recordConsents(user.id, consentTypes, request);

      // Сразу логиним только что зарегистрированного студента.
      const session = await issueSession(reply, {
        ...user,
        studentProfile: null,
      });

      return reply.status(201).send(session);
    },
  );
}
