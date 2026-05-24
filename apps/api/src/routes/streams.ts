import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma, Prisma, type StreamBillingType } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';
import {
  deriveStreamTeachers,
  streamTeacherSourcesInclude,
} from '../lib/stream-teachers.js';
import { enrollStudentInStreamTx } from '../lib/stream-enroll.js';
import { isNonNegativeInt, MAX_AMOUNT_KOPECKS } from '../lib/money.js';

// День месяца для месячного списания: 1..28 (29–31 не допускаем во вводе — короткие
// месяцы делают их неоднозначными; cron всё равно клампит, но на вводе требуем 1..28).
const MIN_BILLING_DAY = 1;
const MAX_BILLING_DAY = 28;

// Поля плана биллинга группы из тела запроса (create/update).
interface BillingInput {
  billingType?: unknown;
  monthlyPriceKopecks?: unknown;
  billingDayOfMonth?: unknown;
}

// Нормализованный план биллинга для записи в Stream (только заданные ключи).
interface BillingFields {
  billingType?: StreamBillingType;
  monthlyPriceKopecks?: number | null;
  billingDayOfMonth?: number | null;
}

/**
 * Валидирует и нормализует поля плана биллинга группы. Возвращает либо набор полей для
 * записи (только присутствующие во вводе ключи), либо текст ошибки 400.
 *
 * Правила: billingType ∈ {one_time, monthly}; для monthly billingDayOfMonth обязателен и
 * 1..28, monthlyPriceKopecks ≥ 0 (целое, ≤ потолка). `existing` — текущий тип группы (для
 * PATCH, где billingType может не передаваться, но проверить инварианты надо).
 *
 * «Либо/либо»: при monthly разовая ветка зачисления не срабатывает (см. stream-enroll.ts),
 * поэтому priceKopecks для monthly-группы остаётся справочным и здесь не трогается.
 */
function parseBilling(
  body: BillingInput,
  existing?: { billingType: StreamBillingType },
): { fields: BillingFields } | { error: string } {
  const fields: BillingFields = {};

  // billingType (если передан) — строго из enum.
  if (body.billingType !== undefined) {
    if (body.billingType !== 'one_time' && body.billingType !== 'monthly') {
      return { error: 'Тип биллинга должен быть one_time или monthly' };
    }
    fields.billingType = body.billingType;
  }

  // monthlyPriceKopecks (если передан) — целое 0..MAX (или null = снять сумму).
  if (body.monthlyPriceKopecks !== undefined) {
    if (body.monthlyPriceKopecks === null) {
      fields.monthlyPriceKopecks = null;
    } else if (!isNonNegativeInt(body.monthlyPriceKopecks)) {
      return { error: 'Месячная сумма должна быть целым числом копеек не меньше нуля' };
    } else if (body.monthlyPriceKopecks > MAX_AMOUNT_KOPECKS) {
      return { error: 'Месячная сумма слишком большая' };
    } else {
      fields.monthlyPriceKopecks = body.monthlyPriceKopecks;
    }
  }

  // billingDayOfMonth (если передан) — целое 1..28 (или null = снять день).
  if (body.billingDayOfMonth !== undefined) {
    if (body.billingDayOfMonth === null) {
      fields.billingDayOfMonth = null;
    } else if (
      typeof body.billingDayOfMonth !== 'number' ||
      !Number.isInteger(body.billingDayOfMonth) ||
      body.billingDayOfMonth < MIN_BILLING_DAY ||
      body.billingDayOfMonth > MAX_BILLING_DAY
    ) {
      return { error: 'День списания должен быть целым числом от 1 до 28' };
    } else {
      fields.billingDayOfMonth = body.billingDayOfMonth;
    }
  }

  // Итоговый тип группы после применения изменений (для проверки инвариантов monthly).
  const effectiveType = fields.billingType ?? existing?.billingType ?? 'one_time';

  if (effectiveType === 'monthly') {
    // Итоговый день и сумма с учётом текущих значений (для PATCH, где поле могло не прийти).
    const effectiveDay =
      body.billingDayOfMonth !== undefined ? fields.billingDayOfMonth : undefined;
    const effectivePrice =
      body.monthlyPriceKopecks !== undefined ? fields.monthlyPriceKopecks : undefined;

    // При СОЗДАНИИ monthly (existing нет) день обязателен и сумма обязательна (≥0).
    if (!existing) {
      if (fields.billingDayOfMonth == null) {
        return { error: 'Для ежемесячного биллинга укажите день списания (1–28)' };
      }
      if (fields.monthlyPriceKopecks == null) {
        return { error: 'Для ежемесячного биллинга укажите месячную сумму' };
      }
    } else {
      // При ОБНОВЛЕНИИ: если поле пришло — оно не должно обнулять обязательные значения.
      if (effectiveDay === null) {
        return { error: 'Для ежемесячного биллинга укажите день списания (1–28)' };
      }
      if (effectivePrice === null) {
        return { error: 'Для ежемесячного биллинга укажите месячную сумму' };
      }
      // Переключение на monthly при PATCH без передачи дня — требуем явно задать день.
      if (fields.billingType === 'monthly' && body.billingDayOfMonth === undefined) {
        return { error: 'Для ежемесячного биллинга укажите день списания (1–28)' };
      }
    }
  }

  return { fields };
}

// Публичный токен инвайт-ссылки: 32 случайных байта в base64url (URL-safe).
function generateJoinToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// Адрес фронтенда для сборки публичной ссылки вступления (как в lib/email.ts).
function joinUrlFor(token: string): string {
  const frontendUrl = process.env.CORS_ORIGIN || 'http://localhost:3000';
  return `${frontendUrl}/join/${token}`;
}

// Источник преподавателей потока перенесён в lib/stream-teachers.ts:
// поток больше не владеет уроками, они достижимы через программу
// (program.programLessons.lesson.teachers) и/или сессии (sessions.lesson.teachers).
const streamTeachersInclude = {
  owner: { select: { id: true, name: true } },
  ...streamTeacherSourcesInclude,
} as const;

export async function streamRoutes(app: FastifyInstance) {
  const adminOnly = requireRole('admin');

  // GET /streams — список потоков
  // Admin: все потоки (или только свои при ?mine=true); Student: только активные потоки, на которые он зачислен
  app.get('/streams', { onRequest: authenticate }, async (request) => {
    const isAdmin = request.user?.role === 'admin';
    const mine = (request.query as { mine?: string }).mine === 'true';
    const streams = await prisma.stream.findMany({
      where: !isAdmin
        ? {
            status: 'active',
            enrollments: { some: { userId: request.user!.userId } },
          }
        : mine
          ? { ownerId: request.user!.userId }
          : {},
      include: { ...streamTeachersInclude, _count: { select: { enrollments: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      // joinToken/joinTokenAt НЕ светим в общих ответах — только через
      // POST/DELETE /streams/:id/join-link.
      streams: streams.map(
        ({ program, sessions, owner, _count, joinToken: _jt, joinTokenAt: _jta, ...stream }) => ({
          ...stream,
          owner,
          // Число зачисленных учеников — для колонки «Учеников» в списке потоков.
          studentsCount: _count.enrollments,
          program: program
            ? { id: program.id, name: program.name, type: program.type }
            : null,
          ...deriveStreamTeachers({ program, sessions }),
        }),
      ),
    };
  });

  // POST /streams — создание потока
  // programId опционален: с ним поток привязан к программе, без него —
  // менторский поток (уроки набираются через сессии).
  app.post('/streams', { onRequest: adminOnly }, async (request, reply) => {
    const body = request.body as {
      name: string;
      programId?: string | null;
      priceKopecks?: number | null;
    } & BillingInput;
    const { name, programId, priceKopecks } = body;

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'Название группы обязательно' });
    }

    // Цена группы (РАЗОВАЯ, billingType=one_time): null/undefined = план не задан; иначе целое ≥ 0.
    if (priceKopecks !== undefined && priceKopecks !== null) {
      if (!isNonNegativeInt(priceKopecks)) {
        return reply
          .status(400)
          .send({ error: 'Цена группы должна быть целым числом копеек не меньше нуля' });
      }
      // Верхняя граница: защита от переполнения колонки Int4 и абсурдных значений.
      if (priceKopecks > MAX_AMOUNT_KOPECKS) {
        return reply.status(400).send({ error: 'Цена слишком большая' });
      }
    }

    // План биллинга (monthly): тип/сумма/день — валидируем и нормализуем общим хелпером.
    const billing = parseBilling(body);
    if ('error' in billing) {
      return reply.status(400).send({ error: billing.error });
    }

    // Если задана программа — проверяем, что она существует.
    if (programId !== undefined && programId !== null) {
      const program = await prisma.program.findUnique({
        where: { id: programId },
        select: { id: true },
      });
      if (!program) {
        return reply.status(400).send({ error: 'Программа не найдена' });
      }
    }

    // Создающий администратор становится ведущим потока.
    const stream = await prisma.stream.create({
      data: {
        name: name.trim(),
        ownerId: request.user!.userId,
        ...(programId !== undefined && programId !== null && { programId }),
        ...(priceKopecks !== undefined && { priceKopecks }),
        ...billing.fields,
      },
    });

    return reply.status(201).send({ stream });
  });

  // PATCH /streams/:id — обновление потока (название и/или ведущий)
  app.patch('/streams/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      ownerId?: string | null;
      programId?: string | null;
      priceKopecks?: number | null;
    } & BillingInput;
    const { name, ownerId, programId, priceKopecks } = body;

    const existing = await prisma.stream.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Группа не найдена' });
    }

    if (name !== undefined && !name.trim()) {
      return reply.status(400).send({ error: 'Название группы не может быть пустым' });
    }

    // Меняем ТОЛЬКО цену группы (платёжный план) на будущее; уже созданные Charge
    // не пересчитываем (цена в начислении зафиксирована на момент зачисления).
    // null = снять план; иначе целое ≥ 0.
    if (priceKopecks !== undefined && priceKopecks !== null) {
      if (!isNonNegativeInt(priceKopecks)) {
        return reply
          .status(400)
          .send({ error: 'Цена группы должна быть целым числом копеек не меньше нуля' });
      }
      // Верхняя граница: защита от переполнения колонки Int4 и абсурдных значений.
      if (priceKopecks > MAX_AMOUNT_KOPECKS) {
        return reply.status(400).send({ error: 'Цена слишком большая' });
      }
    }

    // План биллинга (monthly): тип/сумма/день — валидация с учётом текущего типа группы.
    // Уже созданные месячные Charge не пересчитываем (цена/период зафиксированы).
    const billing = parseBilling(body, { billingType: existing.billingType });
    if ('error' in billing) {
      return reply.status(400).send({ error: billing.error });
    }

    // Если задаётся ведущий — проверяем, что это существующий администратор.
    if (ownerId !== undefined && ownerId !== null) {
      const owner = await prisma.user.findFirst({
        where: { id: ownerId, role: 'admin', deletedAt: null },
        select: { id: true },
      });
      if (!owner) {
        return reply.status(400).send({ error: 'Ведущий должен быть существующим администратором' });
      }
    }

    // Если задаётся программа (не null) — проверяем её существование.
    // programId === null допустим: поток становится менторским (без программы).
    if (programId !== undefined && programId !== null) {
      const program = await prisma.program.findUnique({
        where: { id: programId },
        select: { id: true },
      });
      if (!program) {
        return reply.status(400).send({ error: 'Программа не найдена' });
      }
    }

    const stream = await prisma.stream.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(ownerId !== undefined && { ownerId }),
        ...(programId !== undefined && { programId }),
        ...(priceKopecks !== undefined && { priceKopecks }),
        ...billing.fields,
      },
    });

    return { stream };
  });

  // GET /streams/:id — детали потока со счётчиками (admin)
  app.get('/streams/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const stream = await prisma.stream.findUnique({
      where: { id },
      include: {
        _count: {
          // Stream больше не владеет уроками — считаем сессии (фолбэк для менторских).
          select: { enrollments: true, sessions: true },
        },
        owner: { select: { id: true, name: true } },
        sessions: streamTeacherSourcesInclude.sessions,
        // program: источники преподавателей + _count.programLessons (число уроков программы).
        program: {
          select: {
            ...streamTeacherSourcesInclude.program.select,
            _count: { select: { programLessons: true } },
          },
        },
      },
    });

    if (!stream) {
      return reply.status(404).send({ error: 'Группа не найдена' });
    }

    // joinToken/joinTokenAt НЕ светим в общих ответах — только через эндпоинты join-link.
    const { _count, program, sessions, owner, joinToken: _jt, joinTokenAt: _jta, ...streamFields } = stream;
    // Число уроков: для программного потока — уроки программы; иначе — сессии.
    const lessonsCount = stream.programId
      ? program?._count.programLessons ?? 0
      : _count.sessions;
    return {
      stream: {
        ...streamFields,
        owner,
        studentsCount: _count.enrollments,
        lessonsCount,
        ...deriveStreamTeachers({ program, sessions }),
      },
    };
  });

  // GET /streams/:id/students — список зачисленных студентов (admin)
  app.get('/streams/:id/students', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const stream = await prisma.stream.findUnique({ where: { id } });
    if (!stream) {
      return reply.status(404).send({ error: 'Группа не найдена' });
    }

    const enrollments = await prisma.streamEnrollment.findMany({
      where: {
        streamId: id,
        user: { deletedAt: null },
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, isActive: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const students = enrollments.map((e) => e.user);
    return { students };
  });

  // GET /streams/:id/charges — статус оплаты по студентам группы (admin).
  //
  // Долг считаем АГРЕГАТОМ по ВСЕМ открытым начислениям студента в этой группе (а не по
  // «последнему» начислению): для месячных групп у студента несколько Charge по периодам,
  // и долг — это сумма (amount−paid) по всем open. paymentStatus и outstandingKopecks
  // отражают суммарную задолженность; периоды отдаём списком (periods) — фронт может
  // показать детализацию и отличить месячные начисления по kind. Только админ.
  //
  // Совместимость с разовыми группами: при одном начислении агрегатные amountKopecks/
  // paidKopecks/outstandingKopecks совпадают с одиночными значениями (форма не ломается).
  app.get('/streams/:id/charges', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const stream = await prisma.stream.findUnique({
      where: { id },
      select: { id: true, priceKopecks: true, billingType: true, monthlyPriceKopecks: true },
    });
    if (!stream) {
      return reply.status(404).send({ error: 'Группа не найдена' });
    }

    // Зачисленные студенты (без soft-deleted) + ВСЕ их начисления именно за эту группу.
    const enrollments = await prisma.streamEnrollment.findMany({
      where: { streamId: id, user: { deletedAt: null } },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            charges: {
              where: { streamId: id },
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                amountKopecks: true,
                paidKopecks: true,
                status: true,
                kind: true,
                periodKey: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const students = enrollments.map((e) => {
      const charges = e.user.charges;

      // Агрегаты по всем начислениям студента в этой группе.
      const totalAmount = charges.reduce((s, c) => s + c.amountKopecks, 0);
      const totalPaid = charges.reduce((s, c) => s + c.paidKopecks, 0);
      // Долг — только по ОТКРЫТЫМ (amount−paid); refunded/paid не считаем.
      const outstandingKopecks = charges.reduce(
        (s, c) => (c.status === 'open' ? s + (c.amountKopecks - c.paidKopecks) : s),
        0,
      );

      let paymentStatus: 'paid' | 'partial' | 'unpaid' | 'none';
      if (charges.length === 0) {
        paymentStatus = 'none';
      } else if (outstandingKopecks <= 0) {
        // Долга нет — всё, что начислено, погашено (или возвращено).
        paymentStatus = 'paid';
      } else if (totalPaid > 0) {
        // Есть долг, но что-то уже оплачено — частично.
        paymentStatus = 'partial';
      } else {
        paymentStatus = 'unpaid';
      }

      return {
        id: e.user.id,
        name: e.user.name,
        email: e.user.email,
        // Агрегатные суммы по всем начислениям (для разовой группы = одиночные значения).
        amountKopecks: charges.length > 0 ? totalAmount : null,
        paidKopecks: charges.length > 0 ? totalPaid : null,
        outstandingKopecks,
        // status — свежайшего начисления (совместимость с разовыми); истину о долге
        // несут outstandingKopecks/paymentStatus (у месячных единого статуса нет).
        status: charges[0]?.status ?? null,
        paymentStatus,
        // Детализация по периодам (для месячных): фронт отличает их по kind/periodKey.
        periods: charges.map((c) => ({
          id: c.id,
          amountKopecks: c.amountKopecks,
          paidKopecks: c.paidKopecks,
          status: c.status,
          kind: c.kind,
          periodKey: c.periodKey,
        })),
      };
    });

    return {
      priceKopecks: stream.priceKopecks,
      billingType: stream.billingType,
      monthlyPriceKopecks: stream.monthlyPriceKopecks,
      students,
    };
  });

  // POST /streams/:id/students — зачисление студентов (admin)
  app.post('/streams/:id/students', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { studentIds } = request.body as { studentIds?: string[] };

    const stream = await prisma.stream.findUnique({ where: { id } });
    if (!stream) {
      return reply.status(404).send({ error: 'Группа не найдена' });
    }

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return reply.status(400).send({ error: 'Список студентов обязателен' });
    }

    // Оставляем только существующих пользователей с ролью student (без soft-deleted)
    const validStudents = await prisma.user.findMany({
      where: {
        id: { in: studentIds },
        role: 'student',
        deletedAt: null,
      },
      select: { id: true },
    });

    // Зачисление + бэкфилл заданий + (если задана цена) начисление и авто-списание —
    // в общем хелпере (паритет с регистрацией по инвайт-ссылке). Каждое зачисление в
    // своей транзакции (enrollStudentInStreamTx): идемпотентно, баланс не в минус.
    const adminId = request.user!.userId;
    for (const s of validStudents) {
      await enrollStudentInStreamTx(id, s.id, adminId);
    }

    const enrollments = await prisma.streamEnrollment.findMany({
      where: {
        streamId: id,
        user: { deletedAt: null },
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, isActive: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const students = enrollments.map((e) => e.user);
    return { students };
  });

  // DELETE /streams/:id/students/:studentId — отчисление студента (admin, идемпотентно)
  app.delete(
    '/streams/:id/students/:studentId',
    { onRequest: adminOnly },
    async (request) => {
      const { id, studentId } = request.params as { id: string; studentId: string };

      await prisma.streamEnrollment.deleteMany({
        where: { streamId: id, userId: studentId },
      });

      return { success: true };
    },
  );

  // POST /streams/:id/join-link — получить инвайт-ссылку вступления (admin).
  // Идемпотентно: если токен уже есть — возвращаем существующий; иначе генерируем,
  // сохраняем (joinTokenAt=now) и возвращаем. Одна постоянная ссылка на поток.
  app.post('/streams/:id/join-link', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const stream = await prisma.stream.findUnique({
      where: { id },
      select: { id: true, joinToken: true },
    });
    if (!stream) {
      return reply.status(404).send({ error: 'Группа не найдена' });
    }

    if (stream.joinToken) {
      return { token: stream.joinToken, joinUrl: joinUrlFor(stream.joinToken) };
    }

    const token = generateJoinToken();
    await prisma.stream.update({
      where: { id },
      data: { joinToken: token, joinTokenAt: new Date() },
    });

    return { token, joinUrl: joinUrlFor(token) };
  });

  // DELETE /streams/:id/join-link — перевыпуск инвайт-ссылки (admin).
  // Старая ссылка инвалидируется: генерируем новый токен и сохраняем (joinTokenAt=now).
  app.delete('/streams/:id/join-link', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const stream = await prisma.stream.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!stream) {
      return reply.status(404).send({ error: 'Группа не найдена' });
    }

    const token = generateJoinToken();
    await prisma.stream.update({
      where: { id },
      data: { joinToken: token, joinTokenAt: new Date() },
    });

    return { token, joinUrl: joinUrlFor(token) };
  });

  // POST /streams/:id/archive — архивирование потока
  app.post('/streams/:id/archive', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.stream.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Группа не найдена' });
    }

    if (existing.status === 'archived') {
      return reply.status(400).send({ error: 'Группа уже архивирована' });
    }

    const stream = await prisma.stream.update({
      where: { id },
      data: { status: 'archived' },
    });

    return { stream };
  });

  // DELETE /streams/:id — полное удаление потока (admin).
  // В отличие от архивирования удаляет поток безвозвратно. Каскад на уровне БД
  // (onDelete: Cascade) подчищает связанные StreamEnrollment, Session (и их
  // StudentAssignment) и Conversation потока. Уроки-блоки (Lesson) — переиспользуемые
  // шаблоны и НЕ удаляются.
  app.delete('/streams/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await prisma.stream.delete({ where: { id } });
    } catch (err) {
      // P2025 — запись для удаления не найдена (поток отсутствует или уже удалён).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        return reply.status(404).send({ error: 'Группа не найдена' });
      }
      throw err;
    }

    return { message: 'Группа удалена' };
  });
}
