import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { prisma, Prisma } from '@platform/db';
import { isValidEmail, isValidPassword, MIN_PASSWORD_LENGTH } from '../lib/validation.js';
import { enrollStudentInStream } from '../lib/stream-enroll.js';
import { issueSession } from '../lib/auth-session.js';

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
      };

      const email =
        typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      // --- Валидация входа (единые правила из lib/validation) ---
      if (!email || !name || !password) {
        return reply.status(400).send({ error: 'Email, имя и пароль обязательны' });
      }
      if (!isValidEmail(email)) {
        return reply.status(400).send({ error: 'Некорректный формат email' });
      }
      if (!isValidPassword(password)) {
        return reply
          .status(400)
          .send({ error: `Пароль должен быть не менее ${MIN_PASSWORD_LENGTH} символов` });
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
        return reply.status(409).send({ error: 'Набор в этот поток закрыт' });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      // Создание пользователя + зачисление (с бэкофиллом заданий) — атомарно.
      let user: {
        id: string;
        email: string;
        name: string;
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
              passwordHash,
              role: 'student',
            },
            select: {
              id: true,
              email: true,
              name: true,
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

      // Сразу логиним только что зарегистрированного студента.
      const session = await issueSession(reply, {
        ...user,
        studentProfile: null,
      });

      return reply.status(201).send(session);
    },
  );
}
