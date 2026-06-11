import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '@platform/db';
import { requireRole } from '../middleware/auth.js';
import { sendInviteEmail } from '../lib/email.js';
import { getFileUrl } from '../lib/s3.js';
import { isForeignEmail, FOREIGN_EMAIL_ADMIN_MESSAGE } from '@platform/shared';
import { normalizeEmail, normalizePhone, isValidPhone } from '../lib/validation.js';
import { listUserConsents } from '../lib/consents.js';
import { clearConsentGateCache } from '../middleware/consent-gate.js';

const INVITE_TOKEN_TTL_HOURS = 72;

export async function userRoutes(app: FastifyInstance) {
  // All routes require admin role
  app.addHook('preHandler', requireRole('admin'));

  // GET /users — list students
  app.get('/users', async (request) => {
    const { search, includeDeleted } = request.query as {
      search?: string;
      includeDeleted?: string;
    };

    const where: Record<string, unknown> = { role: 'student' as const };

    if (includeDeleted !== 'true') {
      where.deletedAt = null;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        // isDemo отдаём в списке студентов, чтобы фронт пометил демо/служебные аккаунты
        // бейджем «Демо». Из списка их НЕ скрываем (админ ими управляет) — демо
        // исключается только из числовых метрик (см. stats.ts, studentsCount и т.п.).
        isDemo: true,
        balanceKopecks: true,
        createdAt: true,
        inviteToken: true,
        inviteExpiresAt: true,
        deletedAt: true,
        _count: {
          select: {
            studentAssignments: { where: { status: 'submitted' } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { users: users.map((u) => ({ ...u, submittedCount: u._count.studentAssignments, _count: undefined })) };
  });

  // GET /teachers — список преподавателей (пользователей с ролью admin) для пикеров
  app.get('/teachers', async () => {
    const teachers = await prisma.user.findMany({
      where: { role: 'admin', deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
    return { teachers };
  });

  // POST /users — create student
  app.post('/users', async (request, reply) => {
    const body = request.body as {
      email: string;
      name: string;
      lastName?: unknown;
      phone?: unknown;
    };
    const { email: rawEmail, name } = body;

    if (!rawEmail || !name) {
      return reply.status(400).send({ error: 'Email и имя обязательны' });
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

    const email = normalizeEmail(rawEmail);

    // Зарубежная почта запрещена при назначении email (ст. 10.7 149-ФЗ, issue #132).
    if (isForeignEmail(email)) {
      return reply.status(400).send({ error: FOREIGN_EMAIL_ADMIN_MESSAGE });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ error: 'Пользователь с таким email уже существует' });
    }

    // Generate temporary password — student will set their own via invite
    const tempPassword = crypto.randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = await prisma.user.create({
      data: {
        email,
        name,
        lastName,
        phone,
        passwordHash,
        role: 'student',
        mustChangePassword: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return reply.status(201).send({ user });
  });

  // GET /users/:id — get single student
  app.get('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        isDemo: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
        inviteToken: true,
        inviteExpiresAt: true,
        deletedAt: true,
      },
    });

    if (!user) {
      return reply.status(404).send({ error: 'Пользователь не найден' });
    }

    return { user };
  });

  // GET /users/:id/consents — история юридических согласий ученика (admin).
  // Append-only журнал: тип, действие, дата, ip/userAgent и документ (slug+версия).
  app.get('/users/:id/consents', async (request, reply) => {
    const { id } = request.params as { id: string };

    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) {
      return reply.status(404).send({ error: 'Пользователь не найден' });
    }

    return { consents: await listUserConsents(id) };
  });

  // DELETE /users/:id/consents — сброс журнала согласий ДЕМО-аккаунта (issue #127).
  //
  // ПОЧЕМУ это исключение из append-only: журнал UserConsent — юридический,
  // записи РЕАЛЬНЫХ людей не удаляются никогда. Но заказчику нужно повторно
  // показывать механику гейта согласий (экран досбора при входе) — для этого
  // у ДЕМО-аккаунта (User.isDemo) согласия сбрасываются целиком, и при
  // следующем запросе студента гейт снова требует обязательные согласия.
  app.delete('/users/:id/consents', async (request, reply) => {
    const { id } = request.params as { id: string };

    const user = await prisma.user.findUnique({ where: { id }, select: { isDemo: true } });
    if (!user) {
      return reply.status(404).send({ error: 'Пользователь не найден' });
    }

    // Жёсткая серверная проверка: журнал реального человека не сбросить
    // ни при каких условиях — только аккаунты с флагом isDemo.
    if (!user.isDemo) {
      return reply
        .status(403)
        .send({ error: 'Сброс согласий доступен только для демо-аккаунтов' });
    }

    const { count } = await prisma.userConsent.deleteMany({ where: { userId: id } });

    // ОБЯЗАТЕЛЬНО чистим положительный кэш серверного гейта («долга нет»,
    // TTL 60с): иначе гейт ещё до минуты считал бы согласия данными,
    // и демонстрация механики смазалась бы.
    clearConsentGateCache(id);

    return { deleted: count };
  });

  // PATCH /users/:id — update student (block/unblock, edit name/email)
  app.patch('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      isActive?: boolean;
      name?: string;
      lastName?: unknown;
      phone?: unknown;
      email?: string;
      isDemo?: boolean;
    };

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Пользователь не найден' });
    }

    const normalizedEmail = body.email ? normalizeEmail(body.email) : undefined;
    // Зарубежная почта запрещена при смене email (ст. 10.7 149-ФЗ, issue #132).
    // Проверяем только НОВЫЙ email: существующий зарубежный адрес не блокирует
    // правку остальных полей.
    if (normalizedEmail && normalizedEmail !== existing.email && isForeignEmail(normalizedEmail)) {
      return reply.status(400).send({ error: FOREIGN_EMAIL_ADMIN_MESSAGE });
    }
    if (normalizedEmail && normalizedEmail !== existing.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (emailTaken) {
        return reply.status(409).send({ error: 'Этот email уже используется' });
      }
    }

    // isDemo (демо/служебный аккаунт): принимаем только булево; такого студента не
    // списываем (ни регулярно, ни разово) и (в другой задаче) скрываем из статистики.
    if (body.isDemo !== undefined && typeof body.isDemo !== 'boolean') {
      return reply.status(400).send({ error: 'isDemo должен быть булевым значением' });
    }

    // --- Фамилия и телефон (nullable: пустая строка очищает поле) ---
    if (body.lastName !== undefined && typeof body.lastName !== 'string') {
      return reply.status(400).send({ error: 'Некорректный формат фамилии' });
    }
    if (body.phone !== undefined && typeof body.phone !== 'string') {
      return reply.status(400).send({ error: 'Некорректный формат телефона' });
    }
    const phone = typeof body.phone === 'string' ? normalizePhone(body.phone) : undefined;
    if (typeof phone === 'string' && !isValidPhone(phone)) {
      return reply.status(400).send({ error: 'Некорректный формат телефона' });
    }

    const data: Record<string, unknown> = {};
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.name) data.name = body.name;
    if (typeof body.lastName === 'string') {
      const lastName = body.lastName.trim();
      data.lastName = lastName === '' ? null : lastName;
    }
    if (phone !== undefined) data.phone = phone;
    if (normalizedEmail) data.email = normalizedEmail;
    if (body.isDemo !== undefined) data.isDemo = body.isDemo;

    // When deactivating, also invalidate all refresh tokens
    if (body.isActive === false) {
      await prisma.refreshToken.deleteMany({ where: { userId: id } });
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        isDemo: true,
        createdAt: true,
        deletedAt: true,
      },
    });

    return { user };
  });

  // DELETE /users/:id — soft delete
  app.delete('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Пользователь не найден' });
    }

    // Soft delete: deactivate + set deletedAt
    await prisma.refreshToken.deleteMany({ where: { userId: id } });
    const user = await prisma.user.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        deletedAt: true,
      },
    });

    return { user };
  });

  // POST /users/:id/invite — generate invite link
  app.post('/users/:id/invite', async (request, reply) => {
    const { id } = request.params as { id: string };

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return reply.status(404).send({ error: 'Пользователь не найден' });
    }

    if (!user.isActive) {
      return reply.status(400).send({ error: 'Нельзя отправить приглашение заблокированному пользователю' });
    }

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_HOURS * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id },
      data: { inviteToken, inviteExpiresAt },
    });

    const frontendUrl = process.env.CORS_ORIGIN || 'http://localhost:3000';
    const inviteUrl = `${frontendUrl}/invite?token=${inviteToken}`;

    try {
      await sendInviteEmail(user.email, user.name, inviteUrl);
    } catch (err) {
      request.log.error(err, 'Failed to send invite email');
    }

    return { inviteUrl, expiresAt: inviteExpiresAt };
  });

  // POST /users/:id/reset-password — admin reset password
  app.post('/users/:id/reset-password', async (request, reply) => {
    const { id } = request.params as { id: string };

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return reply.status(404).send({ error: 'Пользователь не найден' });
    }

    // Generate new temporary password
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: true,
        resetToken: null,
        resetTokenExpiresAt: null,
      },
    });

    // Invalidate all sessions
    await prisma.refreshToken.deleteMany({ where: { userId: id } });

    return { tempPassword, message: 'Пароль сброшен. Передайте временный пароль студенту.' };
  });

  // GET /users/:id/export — aggregated JSON dump of a student's data (admin only).
  // File URLs are signed so a CLI can download each file (the admin Bearer also
  // works directly against /files/*).
  app.get('/users/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string };

    const student = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        lastName: true,
        phone: true,
        email: true,
        role: true,
        createdAt: true,
        isActive: true,
        studentProfile: true,
      },
    });

    if (!student || student.role !== 'student') {
      return reply.status(404).send({ error: 'Студент не найден' });
    }

    const [studentAssignments, thread] = await Promise.all([
      prisma.studentAssignment.findMany({
        where: { studentId: id },
        include: {
          session: {
            include: {
              lesson: { select: { assignmentTitle: true, title: true } },
              stream: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.conversation.findUnique({
        where: { studentId: id },
        include: { entries: { orderBy: { createdAt: 'asc' } } },
      }),
    ]);

    // Collect file keys (de-duplicated) along with display names.
    const fileMap = new Map<string, string>();

    const assignments = await Promise.all(
      studentAssignments.map(async (sa) => {
        let fileUrl: string | null = null;
        if (sa.fileUrl) {
          fileUrl = await getFileUrl(sa.fileUrl);
          if (!fileMap.has(sa.fileUrl)) {
            fileMap.set(sa.fileUrl, sa.fileName ?? sa.fileUrl);
          }
        }
        const { session, ...rest } = sa;
        return {
          ...rest,
          assignmentTitle: session.lesson.assignmentTitle,
          status: sa.status,
          fileUrl,
        };
      }),
    );

    const threadEntries = thread?.entries ?? [];
    const threadExport = await Promise.all(
      threadEntries.map(async (entry) => {
        let fileUrl: string | null = null;
        const meta = (entry.metadata ?? null) as Record<string, unknown> | null;
        const s3Key = meta?.s3Key as string | undefined;
        if (s3Key) {
          fileUrl = await getFileUrl(s3Key);
          if (!fileMap.has(s3Key)) {
            fileMap.set(s3Key, (meta?.fileName as string | undefined) ?? s3Key);
          }
        }
        return { ...entry, fileUrl };
      }),
    );

    const files = await Promise.all(
      [...fileMap.entries()].map(async ([key, name]) => ({
        key,
        name,
        signedUrl: await getFileUrl(key),
      })),
    );

    const { studentProfile, role: _role, ...studentFields } = student;

    return {
      student: { ...studentFields, profile: studentProfile ?? null },
      assignments,
      thread: threadExport,
      files,
    };
  });
}
