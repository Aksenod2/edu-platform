import { Prisma, type Charge, type ChargeKind } from '@platform/db';
import { debitBalance } from './money.js';

// Ledger «Оплата и баланс»: начисления студенту за участие в группе (Charge) и их
// погашение списаниями с баланса. Деньги — в КОПЕЙКАХ (целое). Долг ведём отдельным
// ledger'ом, баланс НИКОГДА не уводим в минус — частичное погашение разрешено.
//
// Все функции работают ВНУТРИ переданной транзакции (tx): атомарность связки
// «создать/погасить начисление + списать баланс + запись истории» обеспечивает вызывающий.

type Tx = Prisma.TransactionClient;

/**
 * Создаёт начисление студенту за участие в группе. ИДЕМПОТЕНТНО, но правило зависит от вида:
 *
 *  - РАЗОВОЕ (periodKey = null, kind = 'one_time', по умолчанию): на пару (streamId, userId)
 *    допускается не более ОДНОГО открытого начисления (partial unique "charge_active_uniq"
 *    WHERE status='open' AND periodKey IS NULL). Если открытое уже есть — НЕ создаём второе,
 *    возвращаем существующее (страхует от двойного зачисления / повторного инвайт-флоу).
 *    После полного погашения (status='paid') открытого нет — новый вызов создаст новое.
 *
 *  - МЕСЯЧНОЕ (periodKey задан, kind = 'monthly'): ровно одно начисление на тройку
 *    (streamId, userId, periodKey) в ЛЮБОМ статусе (partial unique "charge_period_uniq"
 *    WHERE periodKey IS NOT NULL). Долг прошлого месяца НЕ блокирует начисление за новый
 *    период. Если за этот период начисление уже есть (даже непогашенное) — НЕ создаём
 *    второе, возвращаем существующее (идемпотентность повторного прогона cron).
 *
 * Цена фиксируется на момент создания (amountKopecks) — последующее изменение
 * Stream.priceKopecks / monthlyPriceKopecks существующие начисления не трогает.
 */
export async function createCharge(
  tx: Tx,
  params: {
    streamId: string;
    userId: string;
    amountKopecks: number;
    createdById?: string | null;
    note?: string | null;
    // Период месячного начисления 'YYYY-MM' (null = разовое).
    periodKey?: string | null;
    // Вид начисления: 'one_time' (разовое) | 'monthly' (ежемесячное менторское).
    kind?: ChargeKind;
  },
): Promise<Charge> {
  const { streamId, userId, amountKopecks } = params;
  const createdById = params.createdById ?? null;
  const note = params.note ?? null;
  const periodKey = params.periodKey ?? null;
  const kind: ChargeKind = params.kind ?? 'one_time';

  // Условие быстрого пути идемпотентности зависит от вида начисления:
  //  - месячное: одно начисление на (streamId, userId, periodKey) в любом статусе;
  //  - разовое: одно ОТКРЫТОЕ начисление на (streamId, userId) без периода.
  const existingWhere =
    periodKey != null
      ? { streamId, userId, periodKey }
      : { streamId, userId, status: 'open' as const, periodKey: null };

  // Предварительная проверка (быстрый путь идемпотентности).
  const existing = await tx.charge.findFirst({ where: existingWhere });
  if (existing) {
    return existing;
  }

  try {
    return await tx.charge.create({
      data: {
        streamId,
        userId,
        amountKopecks,
        paidKopecks: 0,
        status: 'open',
        createdById,
        note,
        periodKey,
        kind,
      },
    });
  } catch (err) {
    // Гонка/повторный прогон: уже создано начисление (нарушение partial unique —
    // charge_active_uniq для разовых либо charge_period_uniq для месячных). Не
    // дублируем — возвращаем существующее.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const created = await tx.charge.findFirst({ where: existingWhere });
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
