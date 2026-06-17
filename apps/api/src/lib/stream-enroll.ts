import { prisma, Prisma } from '@platform/db';
import { createCharge, settleOutstandingCharges } from './charges.js';
import { notifyMany } from './notifications.js';
import { getStreamTeacherList } from './stream-teachers.js';

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
 * 3. Платёжный план группы (эпик «Оплата и баланс»): создаёт РАЗОВОЕ начисление
 *    (createCharge — идемпотентно, второе ОТКРЫТОЕ начисление не появится) и сразу гасит
 *    долг доступными средствами (settleOutstandingCharges — частичное погашение, баланс
 *    не уводится в минус). Шаг 3 выполняется ТОЛЬКО для разовых групп с заданной ценой:
 *      - billingType='monthly' (менторская): разовое начисление НЕ создаём — первое
 *        месячное сделает cron в день billingDayOfMonth (эпик «Авто-списание за группы»);
 *      - student.isDemo=true (демо/служебный): не начисляем ВООБЩЕ (демо не платит);
 *      - priceKopecks == null (разовая цена не задана): шаг 3 пропускается.
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
): Promise<boolean> {
  // newlyEnrolled = студент именно сейчас добавлен в поток (а не повторное идемпотентное
  // зачисление). По нему вызывающий решает, слать ли уведомление student_enrolled —
  // чтобы преподаватели не получали дубль при повторном прогоне зачисления уже зачисленного.
  let newlyEnrolled = true;
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
    newlyEnrolled = false;
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

  // Платёжный план группы: разовое начисление + авто-погашение долга. Только для
  // разовых групп (billingType='one_time') с заданной ценой и НЕ для демо-студентов.
  // Менторские (monthly) начисляет cron (первое — в день billingDayOfMonth); демо не платит.
  const [stream, student] = await Promise.all([
    client.stream.findUnique({
      where: { id: streamId },
      select: { priceKopecks: true, billingType: true },
    }),
    client.user.findUnique({
      where: { id: userId },
      select: { isDemo: true },
    }),
  ]);
  if (
    stream &&
    stream.billingType === 'one_time' &&
    stream.priceKopecks != null &&
    student &&
    !student.isDemo
  ) {
    await createCharge(client, {
      streamId,
      userId,
      amountKopecks: stream.priceKopecks,
      createdById: createdById ?? null,
    });
    await settleOutstandingCharges(client, userId);
  }

  return newlyEnrolled;
}

/**
 * Уведомить преподавателей потока о зачислении нового студента (тип student_enrolled).
 *
 * ВЫЗЫВАТЬ ПОСЛЕ КОММИТА транзакции зачисления, а не внутри неё: createNotification
 * пишет Notification глобальным prisma-клиентом и шлёт email/push fire-and-forget —
 * внутри незакоммиченной tx это создало бы фантомные уведомления при откате.
 * Получатели — дедуплицированный список преподавателей потока (getStreamTeacherList уже
 * схлопывает преподавателя, ведущего несколько уроков потока). Если преподавателей нет,
 * уведомлять некого — это не админское событие (для админов оно избыточно).
 */
export async function notifyStreamTeachersOfEnrollment(
  streamId: string,
  userId: string,
): Promise<void> {
  const [teachers, stream, student] = await Promise.all([
    getStreamTeacherList(streamId),
    prisma.stream.findUnique({ where: { id: streamId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);
  if (teachers.length === 0 || !stream || !student) return;

  await notifyMany(
    teachers.map((t) => t.id),
    'student_enrolled',
    'Новый студент в группе',
    `В группу «${stream.name}» зачислен студент ${student.name}`,
    { streamId, studentId: userId },
  );
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
  const newlyEnrolled = await prisma.$transaction((tx) =>
    enrollStudentInStream(streamId, userId, tx, createdById),
  );
  // Уведомляем преподавателей потока только о НОВОМ зачислении и только после коммита tx
  // (см. notifyStreamTeachersOfEnrollment). Fire-and-forget: сбой рассылки не валит зачисление.
  if (newlyEnrolled) {
    notifyStreamTeachersOfEnrollment(streamId, userId).catch(() => {});
  }
}
