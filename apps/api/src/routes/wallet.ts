import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';
import { isPositiveInt, debitBalance, InsufficientFundsError } from '../lib/money.js';

// Кошелёк студента: ручной баланс в копейках + история операций.
// Пополнение/списание делает администратор вручную (после скриншота перевода в чате).
// Студент видит свой баланс и историю (read-only).
//
// TODO: автосписание за менторскую занятие (per-occurrence spend) появится вместе
// с моделью «Занятие» — тогда списание будет привязано к занятию (рефакторинг этого роута).
//
// isPositiveInt и логика пополнения вынесены в lib/money.ts (переиспользуются
// в payments.ts). Здесь ручное пополнение оставлено на массивной форме
// $transaction([...]) — поведение не меняем.

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
      return reply.status(404).send({ error: 'Студент не найден' });
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
      return reply.status(404).send({ error: 'Студент не найден' });
    }

    // Нельзя уводить баланс в минус — ранняя проверка для понятного 400 без обращения
    // к транзакции (быстрый отказ). Финальный инвариант гарантирует debitBalance
    // условным списанием (защита от гонок).
    if (student.balanceKopecks - amount < 0) {
      return reply.status(400).send({ error: 'Недостаточно средств' });
    }

    const admin = await prisma.user.findUnique({
      where: { id: request.user!.userId },
      select: { name: true },
    });

    // Атомарно: уменьшаем баланс и создаём запись истории (через общий хелпер
    // debitBalance — условное списание balanceKopecks>=amount не уводит в минус).
    try {
      const { balanceKopecks, transaction } = await prisma.$transaction((tx) =>
        debitBalance(tx, {
          userId: id,
          amountKopecks: amount,
          note,
          createdBy: admin?.name ?? null,
        }),
      );
      return { balanceKopecks, transaction };
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
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
      return reply.status(404).send({ error: 'Студент не найден' });
    }

    const transactions = await prisma.walletTransaction.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
    });

    // Начисления за группы (ledger «Оплата и баланс»): что и сколько начислено/погашено.
    // Финансы видит только админ либо сам студент (guard self||admin выше).
    const chargeRows = await prisma.charge.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        streamId: true,
        amountKopecks: true,
        paidKopecks: true,
        status: true,
        stream: { select: { name: true } },
      },
    });

    const charges = chargeRows.map((c) => ({
      id: c.id,
      streamId: c.streamId,
      streamName: c.stream?.name ?? null,
      amountKopecks: c.amountKopecks,
      paidKopecks: c.paidKopecks,
      status: c.status,
    }));

    // Текущий долг = сумма (начислено − погашено) по ОТКРЫТЫМ начислениям.
    const outstandingKopecks = chargeRows.reduce(
      (sum, c) => (c.status === 'open' ? sum + (c.amountKopecks - c.paidKopecks) : sum),
      0,
    );

    return { balanceKopecks: student.balanceKopecks, transactions, charges, outstandingKopecks };
  });
}
