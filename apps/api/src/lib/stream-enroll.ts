import { prisma, Prisma } from '@platform/db';
import { createCharge, settleOutstandingCharges } from './charges.js';

// Клиент Prisma: либо обычный singleton, либо транзакционный (внутри $transaction).
type PrismaLike = typeof prisma | Prisma.TransactionClient;

/**
 * Зачисляет одного студента на поток и выдаёт ему задания (бэкофилл).
 *
 * 1. Создаёт StreamEnrollment (идемпотентно: коллизия @@unique[streamId,userId]
 *    P2002 проглатывается — повторное зачисление безопасно).
 * 2. Бэкофилл StudentAssignment по всем сессиям потока, у уроков которых есть
 *    задание (lesson.hasAssignment). Ключуется по StudentAssignment(sessionId,
 *    studentId); skipDuplicates делает повторный вызов безопасным.
 * 3. Платёжный план группы (эпик «Оплата и баланс»): если у потока задана цена
 *    (Stream.priceKopecks != null), создаёт начисление (createCharge — идемпотентно,
 *    второе ОТКРЫТОЕ начисление не появится) и сразу гасит долг доступными средствами
 *    (settleOutstandingCharges — частичное погашение, баланс не уводится в минус).
 *    Без цены шаг 3 пропускается.
 *
 * Студент, зачисленный по инвайт-ссылке, получает задания так же, как при ручном
 * добавлении админом (паритет). ВСЕ шаги выполняются через переданный `client`; для
 * корректной атомарности (начисление + списание + история) вызывающий должен передавать
 * транзакционный клиент. См. enrollStudentInStreamTx — обёртку, которая сама заводит tx.
 */
export async function enrollStudentInStream(
  streamId: string,
  userId: string,
  client: PrismaLike = prisma,
  createdById?: string | null,
): Promise<void> {
  try {
    await client.streamEnrollment.create({
      data: { streamId, userId },
    });
  } catch (err) {
    // Уже зачислен (@@unique[streamId,userId]) — это нормально, идём дальше к бэкофиллу.
    if (
      !(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
    ) {
      throw err;
    }
  }

  const sessions = await client.session.findMany({
    where: { streamId, lesson: { hasAssignment: true } },
    select: { id: true },
  });

  if (sessions.length > 0) {
    await client.studentAssignment.createMany({
      data: sessions.map((session) => ({
        sessionId: session.id,
        studentId: userId,
        status: 'assigned' as const,
      })),
      skipDuplicates: true,
    });
  }

  // Платёжный план группы: начисляем и сразу гасим долг доступными средствами.
  const stream = await client.stream.findUnique({
    where: { id: streamId },
    select: { priceKopecks: true },
  });
  if (stream && stream.priceKopecks != null) {
    await createCharge(client, {
      streamId,
      userId,
      amountKopecks: stream.priceKopecks,
      createdById: createdById ?? null,
    });
    await settleOutstandingCharges(client, userId);
  }
}

/**
 * Обёртка над enrollStudentInStream, выполняющая зачисление в собственной транзакции.
 * Нужна для вызовов вне $transaction (например, ручное зачисление админом из цикла):
 * каждое зачисление атомарно (enrollment + backfill + начисление + списание + история).
 */
export async function enrollStudentInStreamTx(
  streamId: string,
  userId: string,
  createdById?: string | null,
): Promise<void> {
  await prisma.$transaction((tx) => enrollStudentInStream(streamId, userId, tx, createdById));
}
