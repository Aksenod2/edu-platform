import { prisma, Prisma } from '@platform/db';

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
 *
 * Студент, зачисленный по инвайт-ссылке, получает задания так же, как при ручном
 * добавлении админом (паритет). Принимает опциональный tx-клиент, чтобы вызываться
 * внутри prisma.$transaction.
 */
export async function enrollStudentInStream(
  streamId: string,
  userId: string,
  client: PrismaLike = prisma,
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
}
