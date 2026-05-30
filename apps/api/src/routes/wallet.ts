import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';
import {
  isPositiveInt,
  creditBalance,
  debitBalance,
  InsufficientFundsError,
  MAX_AMOUNT_KOPECKS,
} from '../lib/money.js';
import { settleOutstandingCharges } from '../lib/charges.js';
import { computeNextChargeInfo } from '../lib/mentorship-billing.js';

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

    if (!isPositiveInt(body.amountKopecks) || body.amountKopecks > MAX_AMOUNT_KOPECKS) {
      return reply.status(400).send({
        error: 'Сумма должна быть положительным целым числом копеек в разумных пределах',
      });
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

    // Атомарно (в одной транзакции): зачисляем баланс + запись истории, затем
    // авто-дозачёт долга — гасим открытые начисления студента доступными средствами
    // (как делает одобрение заявки на пополнение в payments.ts). settleOutstandingCharges
    // идемпотентна и не уводит баланс в минус; интерактивная форма $transaction нужна,
    // чтобы прокинуть один и тот же tx в creditBalance и settleOutstandingCharges.
    const { balanceKopecks, transaction, settledKopecks } = await prisma.$transaction(
      async (tx) => {
        const credit = await creditBalance(tx, {
          userId: id,
          amountKopecks: amount,
          note,
          createdBy: admin?.name ?? null,
        });

        const settled = await settleOutstandingCharges(tx, id);

        // Баланс после авто-погашения: если что-то списали — перечитываем актуальный.
        const finalBalance =
          settled > 0
            ? (
                await tx.user.findUniqueOrThrow({
                  where: { id },
                  select: { balanceKopecks: true },
                })
              ).balanceKopecks
            : credit.balanceKopecks;

        return {
          balanceKopecks: finalBalance,
          transaction: credit.transaction,
          settledKopecks: settled,
        };
      },
    );

    return { balanceKopecks, transaction, settledKopecks };
  });

  // POST /students/:id/wallet/debit — ручное списание с баланса студента (admin)
  app.post('/students/:id/wallet/debit', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { amountKopecks?: unknown; note?: unknown };

    if (!isPositiveInt(body.amountKopecks) || body.amountKopecks > MAX_AMOUNT_KOPECKS) {
      return reply.status(400).send({
        error: 'Сумма должна быть положительным целым числом копеек в разумных пределах',
      });
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
      select: { balanceKopecks: true, role: true, isDemo: true },
    });
    if (!student || student.role !== 'student') {
      return reply.status(404).send({ error: 'Студент не найден' });
    }

    const transactions = await prisma.walletTransaction.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
    });

    // Прогноз ближайших месячных списаний по активным менторским группам студента.
    // Демо-аккаунты не списываются — для них список пуст. Для каждой активной monthly-группы
    // с заданными суммой(>0) и днём считаем дату/период следующего списания и признак
    // нехватки средств (упрощённо: текущий баланс < месячной суммы).
    const nextMentorshipCharges: Array<{
      streamId: string;
      streamName: string;
      nextChargeDate: string;
      amountKopecks: number;
      willGoIntoDebt: boolean;
    }> = [];

    // Группы студента с внешней ссылкой на оплату — для кнопки «Оплатить» на /dashboard/balance.
    // Только АКТИВНЫЕ группы с заданным paymentUrl. Демо-аккаунты не платят → для них пусто.
    let payableStreams: Array<{ id: string; name: string; paymentUrl: string }> = [];

    if (!student.isDemo) {
      const monthlyEnrollments = await prisma.streamEnrollment.findMany({
        where: {
          userId: id,
          stream: {
            status: 'active',
            billingType: 'monthly',
            monthlyPriceKopecks: { gt: 0 },
            billingDayOfMonth: { not: null },
          },
        },
        select: {
          stream: {
            select: {
              id: true,
              name: true,
              monthlyPriceKopecks: true,
              billingDayOfMonth: true,
            },
          },
        },
      });

      const now = new Date();
      for (const { stream } of monthlyEnrollments) {
        const { nextChargeDate, amountKopecks } = computeNextChargeInfo(stream, now);
        nextMentorshipCharges.push({
          streamId: stream.id,
          streamName: stream.name,
          nextChargeDate: nextChargeDate.toISOString(),
          amountKopecks,
          willGoIntoDebt: student.balanceKopecks < amountKopecks,
        });
      }
      // Ближайшее списание — первым.
      nextMentorshipCharges.sort((a, b) =>
        a.nextChargeDate < b.nextChargeDate ? -1 : a.nextChargeDate > b.nextChargeDate ? 1 : 0,
      );

      // Скоуп по userId=id (guard self||admin выше) — студент видит только свои группы.
      const payableEnrollments = await prisma.streamEnrollment.findMany({
        where: {
          userId: id,
          stream: { status: 'active', paymentUrl: { not: null } },
        },
        select: {
          stream: { select: { id: true, name: true, paymentUrl: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      payableStreams = payableEnrollments.map(({ stream }) => ({
        id: stream.id,
        name: stream.name,
        // paymentUrl не null по условию запроса (not: null) — приводим тип.
        paymentUrl: stream.paymentUrl as string,
      }));
    }

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

    return {
      balanceKopecks: student.balanceKopecks,
      transactions,
      charges,
      outstandingKopecks,
      nextMentorshipCharges,
      payableStreams,
    };
  });
}
