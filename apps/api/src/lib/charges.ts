import { Prisma, type Charge } from '@platform/db';
import { debitBalance } from './money.js';

// Ledger «Оплата и баланс»: начисления студенту за участие в группе (Charge) и их
// погашение списаниями с баланса. Деньги — в КОПЕЙКАХ (целое). Долг ведём отдельным
// ledger'ом, баланс НИКОГДА не уводим в минус — частичное погашение разрешено.
//
// Все функции работают ВНУТРИ переданной транзакции (tx): атомарность связки
// «создать/погасить начисление + списать баланс + запись истории» обеспечивает вызывающий.

type Tx = Prisma.TransactionClient;

/**
 * Создаёт начисление студенту за участие в группе. ИДЕМПОТЕНТНО: на пару (streamId, userId)
 * допускается не более ОДНОГО открытого начисления (гарантируется partial unique index
 * "charge_active_uniq" WHERE status='open'). Если открытое начисление уже есть — НЕ создаём
 * второе, возвращаем существующее (страхует от двойного зачисления студента / повторного
 * вызова инвайт-флоу).
 *
 * После полного погашения (status='paid') открытого начисления нет — новый вызов создаст
 * новое начисление (повторное участие можно начислить снова).
 *
 * Цена фиксируется на момент зачисления (amountKopecks) — последующее изменение
 * Stream.priceKopecks существующие начисления не трогает.
 */
export async function createCharge(
  tx: Tx,
  params: {
    streamId: string;
    userId: string;
    amountKopecks: number;
    createdById?: string | null;
    note?: string | null;
  },
): Promise<Charge> {
  const { streamId, userId, amountKopecks } = params;
  const createdById = params.createdById ?? null;
  const note = params.note ?? null;

  // Предварительная проверка открытого начисления (быстрый путь идемпотентности).
  const existing = await tx.charge.findFirst({
    where: { streamId, userId, status: 'open' },
  });
  if (existing) {
    return existing;
  }

  try {
    return await tx.charge.create({
      data: { streamId, userId, amountKopecks, paidKopecks: 0, status: 'open', createdById, note },
    });
  } catch (err) {
    // Гонка: параллельно уже создали открытое начисление (нарушение partial unique).
    // Не дублируем — возвращаем существующее открытое.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const created = await tx.charge.findFirst({
        where: { streamId, userId, status: 'open' },
      });
      if (created) return created;
    }
    throw err;
  }
}

/**
 * Гасит ОТКРЫТЫЕ начисления студента доступными средствами с баланса (авто-списание).
 * Старые начисления — первыми (orderBy createdAt asc). Для каждого начисления списываем
 * `payable = min(остаток_начисления, текущий_баланс)`; если payable>0 — debitBalance(chargeId)
 * + АТОМАРНО увеличиваем paidKopecks через increment, переводя в 'paid' при полном погашении.
 *
 * АТОМАРНОСТЬ ledger: и баланс (debitBalance условным updateMany), и paidKopecks
 * (charge.update increment) меняются на стороне БД, без перезаписи прочитанным значением,
 * поэтому одновременные settle (например approve top-up и зачисление студента) не теряют
 * обновлений paidKopecks. Статус 'paid' выставляется по ФАКТИЧЕСКОМУ значению из вернувшейся
 * записи update (а не по локальной арифметике).
 *
 * ЧАСТИЧНОЕ ПОГАШЕНИЕ разрешено: если средств меньше остатка — гасим сколько есть, начисление
 * остаётся открытым. БАЛАНС НЕ УВОДИМ В МИНУС: списываем не больше доступного. ИДЕМПОТЕНТНО:
 * повторный вызов при нулевом балансе или отсутствии открытых начислений ничего не делает.
 *
 * Возвращает суммарно списанные копейки.
 */
export async function settleOutstandingCharges(tx: Tx, userId: string): Promise<number> {
  const openCharges = await tx.charge.findMany({
    where: { userId, status: 'open' },
    orderBy: { createdAt: 'asc' },
  });
  if (openCharges.length === 0) return 0;

  // Текущий баланс — стартовая точка; уменьшаем локально по мере списаний, чтобы не
  // делать лишних запросов и не списывать больше доступного.
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { balanceKopecks: true },
  });
  let available = user.balanceKopecks;
  let totalPaid = 0;

  for (const charge of openCharges) {
    if (available <= 0) break;

    const remaining = charge.amountKopecks - charge.paidKopecks;
    if (remaining <= 0) continue; // защита: уже погашено (status рассинхрон) — пропускаем.

    const payable = Math.min(remaining, available);
    if (payable <= 0) continue;

    // Списываем с баланса (debitBalance условным updateMany не уводит в минус) и
    // привязываем списание к начислению через chargeId.
    await debitBalance(tx, {
      userId,
      amountKopecks: payable,
      note: 'Списание за группу',
      chargeId: charge.id,
    });

    // АТОМАРНО увеличиваем paidKopecks через increment (а НЕ перезаписью прочитанным
    // значением): при одновременных settle (approve top-up + зачисление студента)
    // read-then-write по stale-значению терял бы обновление. increment складывается
    // на стороне БД, потеря обновления исключена. update возвращает обновлённую строку —
    // статус выставляем по ФАКТИЧЕСКОМУ новому paidKopecks, а не по локальной арифметике.
    const updated = await tx.charge.update({
      where: { id: charge.id },
      data: { paidKopecks: { increment: payable } },
    });

    if (updated.paidKopecks >= updated.amountKopecks) {
      // Полностью погашено по факту — переводим в 'paid'. Условие на 'open' делает
      // повторный перевод безвредным (идемпотентность) при гонке двух settle.
      await tx.charge.updateMany({
        where: { id: charge.id, status: 'open' },
        data: { status: 'paid' },
      });
    }

    available -= payable;
    totalPaid += payable;
  }

  return totalPaid;
}
