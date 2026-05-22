import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';

// Кошелёк студента: ручной баланс в копейках + история операций.
// Пополнение/списание делает администратор вручную (после скриншота перевода в чате).
// Студент видит свой баланс и историю (read-only).
//
// TODO: автосписание за менторскую занятие (per-occurrence spend) появится вместе
// с моделью «Занятие» — тогда списание будет привязано к занятию (рефакторинг этого роута).

// Проверка: положительное целое число копеек (защита от NaN/дробей/отрицательных).
function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export async function walletRoutes(app: FastifyInstance) {
  const adminOnly = requireRole('admin');
  const anyAuth = authenticate;

  // POST /students/:id/wallet/topup — ручное пополнение баланса студента (admin)
  app.post('/students/:id/wallet/topup', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { amountKopecks?: unknown; note?: unknown };

    if (!isPositiveInt(body.amountKopecks)) {
      return reply.status(400).send({ error: 'Сумма должна быть положительным целым числом копеек' });
    }
    const amount = body.amountKopecks;
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

    const student = await prisma.user.findUnique({ where: { id } });
    if (!student || student.role !== 'student') {
      return reply.status(404).send({ error: 'Ученик не найден' });
    }

    // Имя администратора, выполняющего операцию (для атрибуции в истории).
    const admin = await prisma.user.findUnique({
      where: { id: request.user!.userId },
      select: { name: true },
    });

    // Атомарно: увеличиваем баланс и создаём запись истории.
    const [updatedUser, transaction] = await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { balanceKopecks: { increment: amount } },
        select: { balanceKopecks: true },
      }),
      prisma.walletTransaction.create({
        data: {
          userId: id,
          amount,
          kind: 'topup',
          note,
          createdBy: admin?.name ?? null,
        },
      }),
    ]);

    return { balanceKopecks: updatedUser.balanceKopecks, transaction };
  });

  // POST /students/:id/wallet/debit — ручное списание с баланса студента (admin)
  app.post('/students/:id/wallet/debit', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { amountKopecks?: unknown; note?: unknown };

    if (!isPositiveInt(body.amountKopecks)) {
      return reply.status(400).send({ error: 'Сумма должна быть положительным целым числом копеек' });
    }
    const amount = body.amountKopecks;
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

    const student = await prisma.user.findUnique({ where: { id } });
    if (!student || student.role !== 'student') {
      return reply.status(404).send({ error: 'Ученик не найден' });
    }

    // Нельзя уводить баланс в минус.
    if (student.balanceKopecks - amount < 0) {
      return reply.status(400).send({ error: 'Недостаточно средств' });
    }

    const admin = await prisma.user.findUnique({
      where: { id: request.user!.userId },
      select: { name: true },
    });

    // Атомарно: уменьшаем баланс и создаём запись истории.
    const [updatedUser, transaction] = await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { balanceKopecks: { decrement: amount } },
        select: { balanceKopecks: true },
      }),
      prisma.walletTransaction.create({
        data: {
          userId: id,
          amount,
          kind: 'debit',
          note,
          createdBy: admin?.name ?? null,
        },
      }),
    ]);

    return { balanceKopecks: updatedUser.balanceKopecks, transaction };
  });

  // GET /students/:id/wallet — баланс + история (admin или сам студент)
  app.get('/students/:id/wallet', { onRequest: anyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const isAdmin = request.user?.role === 'admin';
    const isSelf = request.user?.userId === id;

    if (!isAdmin && !isSelf) {
      return reply.status(403).send({ error: 'Нет доступа' });
    }

    const student = await prisma.user.findUnique({
      where: { id },
      select: { balanceKopecks: true, role: true },
    });
    if (!student || student.role !== 'student') {
      return reply.status(404).send({ error: 'Ученик не найден' });
    }

    const transactions = await prisma.walletTransaction.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
    });

    return { balanceKopecks: student.balanceKopecks, transactions };
  });
}
