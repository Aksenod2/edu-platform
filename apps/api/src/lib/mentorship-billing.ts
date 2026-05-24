import { prisma, type Stream } from '@platform/db';
import { createCharge, settleOutstandingCharges } from './charges.js';
import { createNotification } from './notifications.js';

// ─────────────────────────────────────────────────────────────────────────────
// Эпик «Авто-списание за менторские группы».
//
// Раз в месяц (в день Stream.billingDayOfMonth по Москве) со студентов менторских
// групп (billingType='monthly') автоматически начисляется Stream.monthlyPriceKopecks
// и тут же гасится с баланса. Не хватило денег — уходим в долг (Charge остаётся open),
// долг гасится при следующем пополнении (settleOutstandingCharges в payments.ts).
//
// ИДЕМПОТЕНТНОСТЬ ПЕРИОДА: на (streamId, userId, periodKey 'YYYY-MM') допускается ровно
// одно начисление в любом статусе (partial unique "charge_period_uniq"). Повторный прогон
// cron за тот же период не двоит начисление (createCharge ловит P2002 → пропуск).
//
// ДЕМО-АККАУНТЫ (User.isDemo=true) НЕ списываются — ни регулярно, ни разово.
//
// ВРЕМЯ строго в часовом поясе Europe/Moscow (через Intl, без внешних либ). С 2014 года
// Москва — постоянный UTC+3 (переходов на летнее время нет), но смещение НЕ хардкодим:
// вычисляем фактический offset зоны для конкретного момента.
// ─────────────────────────────────────────────────────────────────────────────

const MOSCOW_TZ = 'Europe/Moscow';

// За сколько дней до списания предупреждать студента о возможной нехватке средств.
const MENTORSHIP_REMINDER_DAYS = Number(process.env.MENTORSHIP_REMINDER_DAYS) || 7;

// Сколько прошлых месяцев добирать («бэкофилл») при прогоне. По умолчанию 0 —
// начисляем только за текущий период (не плодим задним числом долги за прошлое).
const MENTORSHIP_BILLING_BACKFILL_MONTHS =
  Number(process.env.MENTORSHIP_BILLING_BACKFILL_MONTHS) || 0;

// Сколько студентов обрабатывать за раз (батчинг — не держим всё в памяти/одной пачкой).
const ENROLLMENT_BATCH_SIZE = 200;

// Компоненты «настенных» даты/времени в зоне Москвы для заданного момента.
interface MoscowParts {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
}

// Разбирает момент `date` на год/месяц/день по календарю Москвы (Intl, en-CA даёт ISO-порядок).
function moscowParts(date: Date): MoscowParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

// periodKey 'YYYY-MM' для момента по календарю Москвы (напр. 2026-05).
export function moscowPeriodKey(date: Date): string {
  const { year, month } = moscowParts(date);
  return `${year}-${String(month).padStart(2, '0')}`;
}

// Число дней в месяце (month: 1–12). Используем UTC-конструктор: day=0 следующего
// месяца = последний день текущего (от часового пояса это число не зависит).
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Момент (UTC instant), которому соответствует ПОЛНОЧЬ в Москве для даты year-month-day.
 * Смещение зоны не хардкодим: берём UTC-полночь этой даты, узнаём фактический offset
 * Москвы в этот момент и сдвигаем назад. Для постоянного UTC+3 даёт 21:00 UTC прошлых суток.
 */
function moscowMidnightUtc(year: number, month: number, day: number): Date {
  // Базовый момент: эти же «цифры» как будто они в UTC.
  const asUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  // Фактический offset Москвы (в минутах) для этого момента.
  const offsetMin = moscowOffsetMinutes(new Date(asUtc));
  // Настенное время Москвы = UTC + offset ⇒ нужный instant = asUtc − offset.
  return new Date(asUtc - offsetMin * 60_000);
}

// Смещение зоны Москвы относительно UTC (в минутах) для конкретного момента.
// Считаем как разницу между «настенным» временем Москвы и UTC для одного и того же instant.
function moscowOffsetMinutes(date: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOSCOW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  let hour = get('hour');
  // Intl может вернуть час 24 для полуночи в некоторых средах — нормализуем к 0.
  if (hour === 24) hour = 0;
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  // Разница округлена до минут.
  return Math.round((asIfUtc - date.getTime()) / 60_000);
}

// Эффективный день списания месяца: billingDayOfMonth с CLAMP к последнему дню месяца
// (напр. 31 в феврале → 28/29). day валидируется на входе (1..28), но clamp оставляем
// как страховку для исторических/ручных значений 29–31.
function effectiveBillingDay(year: number, month: number, billingDayOfMonth: number): number {
  return Math.min(billingDayOfMonth, daysInMonth(year, month));
}

/**
 * Информация о СЛЕДУЮЩЕМ месячном списании группы относительно момента `now`.
 *
 * Если в текущем месяце день списания ещё НЕ наступил (now < эффективный день) —
 * следующее списание в этом месяце; иначе — в следующем месяце. Возвращает дату
 * списания (полночь Москвы как UTC instant), periodKey этого списания и сумму.
 *
 * Экспортируется: нужен и cron'у, и эндпоинту кошелька (прогноз ближайших списаний).
 */
export function computeNextChargeInfo(
  stream: Pick<Stream, 'monthlyPriceKopecks' | 'billingDayOfMonth'>,
  now: Date,
): { nextChargeDate: Date; periodKey: string; amountKopecks: number } {
  const billingDay = stream.billingDayOfMonth ?? 1;
  const amountKopecks = stream.monthlyPriceKopecks ?? 0;

  const { year, month, day } = moscowParts(now);
  const effDayThisMonth = effectiveBillingDay(year, month, billingDay);

  let targetYear = year;
  let targetMonth = month;
  // День этого месяца уже наступил (или сегодня) — следующее списание в следующем месяце.
  if (day >= effDayThisMonth) {
    targetMonth += 1;
    if (targetMonth > 12) {
      targetMonth = 1;
      targetYear += 1;
    }
  }

  const effDay = effectiveBillingDay(targetYear, targetMonth, billingDay);
  const nextChargeDate = moscowMidnightUtc(targetYear, targetMonth, effDay);
  const periodKey = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;

  return { nextChargeDate, periodKey, amountKopecks };
}

// Сдвиг периода 'YYYY-MM' на `delta` месяцев (delta может быть отрицательным).
function shiftPeriod(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = (year * 12 + (month - 1)) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

// Активные менторские группы с заданным планом (monthly + сумма>0 + день задан + не архив).
async function activeMonthlyStreams() {
  return prisma.stream.findMany({
    where: {
      billingType: 'monthly',
      monthlyPriceKopecks: { gt: 0 },
      billingDayOfMonth: { not: null },
      status: 'active',
    },
    select: {
      id: true,
      name: true,
      monthlyPriceKopecks: true,
      billingDayOfMonth: true,
    },
  });
}

// Зачисления группы для биллинга: только не-демо, не удалённые, активные студенты.
// Батчим по cursor, чтобы не тянуть всех зачисленных одной пачкой.
async function* enrollmentsForBilling(streamId: string) {
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.streamEnrollment.findMany({
      where: {
        streamId,
        user: { isDemo: false, deletedAt: null, isActive: true, role: 'student' },
      },
      select: { id: true, userId: true },
      orderBy: { id: 'asc' },
      take: ENROLLMENT_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    for (const e of batch) yield e;
    if (batch.length < ENROLLMENT_BATCH_SIZE) break;
    cursor = batch[batch.length - 1]!.id;
  }
}

/**
 * СВИПЕР месячных списаний. Для каждой активной менторской группы и каждого её
 * не-демо студента: если день периода по Москве уже наступил и за этот период ещё нет
 * начисления — в транзакции создаём Charge(kind='monthly', periodKey) и тут же гасим
 * долг доступными средствами. Если осталось открытым (ушли в долг) — шлём уведомление
 * mentorship_charge_debt (с дедупом по (streamId, periodKey)).
 *
 * Идемпотентность: повторный прогон за тот же период → P2002 на charge_period_uniq →
 * пропуск (createCharge возвращает существующее). Ошибки на КАЖДОМ студенте глотаются —
 * один сбой не валит весь свип. Backfill прошлых периодов — по env (по умолчанию 0).
 */
export async function sweepMentorshipCharges({ now }: { now?: Date } = {}): Promise<void> {
  const nowDate = now ?? new Date();
  const streams = await activeMonthlyStreams();

  for (const stream of streams) {
    const amountKopecks = stream.monthlyPriceKopecks ?? 0;
    const billingDay = stream.billingDayOfMonth ?? 0;
    if (amountKopecks <= 0 || billingDay <= 0) continue;

    // Периоды к начислению: текущий (если день наступил) + опциональный бэкофилл прошлых.
    const periods = duePeriods(nowDate, billingDay, MENTORSHIP_BILLING_BACKFILL_MONTHS);
    if (periods.length === 0) continue;

    for await (const enrollment of enrollmentsForBilling(stream.id)) {
      for (const periodKey of periods) {
        try {
          await chargeStudentForPeriod({
            streamId: stream.id,
            streamName: stream.name,
            userId: enrollment.userId,
            amountKopecks,
            periodKey,
          });
        } catch (err) {
          // Глотаем ошибку конкретного студента/периода — cron не должен падать.
          console.error(
            '[cron] mentorship charge error',
            { streamId: stream.id, userId: enrollment.userId, periodKey },
            err,
          );
        }
      }
    }
  }
}

// Список периодов 'YYYY-MM', за которые ПОРА начислять на момент now:
//  - текущий период включаем, только если день списания уже наступил (day по МСК >= effDay);
//  - плюс backfillMonths прошлых периодов (каждый прошлый месяц всегда «наступил»).
function duePeriods(now: Date, billingDay: number, backfillMonths: number): string[] {
  const { year, month, day } = moscowParts(now);
  const result: string[] = [];

  // Прошлые периоды (бэкофилл) — от самого старого к новому.
  for (let i = backfillMonths; i >= 1; i -= 1) {
    const p = shiftPeriod(year, month, -i);
    result.push(`${p.year}-${String(p.month).padStart(2, '0')}`);
  }

  // Текущий период — только если день уже наступил.
  const effDay = effectiveBillingDay(year, month, billingDay);
  if (day >= effDay) {
    result.push(`${year}-${String(month).padStart(2, '0')}`);
  }

  return result;
}

// Начисляет одному студенту за один период (в своей транзакции) и гасит долг.
// При нехватке средств начисление остаётся open → шлём уведомление о долге (с дедупом).
async function chargeStudentForPeriod(params: {
  streamId: string;
  streamName: string;
  userId: string;
  amountKopecks: number;
  periodKey: string;
}): Promise<void> {
  const { streamId, streamName, userId, amountKopecks, periodKey } = params;

  const charge = await prisma.$transaction(async (tx) => {
    // Идемпотентно: повторный прогон за период вернёт существующее начисление (P2002 внутри).
    const created = await createCharge(tx, {
      streamId,
      userId,
      amountKopecks,
      periodKey,
      kind: 'monthly',
      note: `Менторская группа · ${periodKey}`,
    });
    // Гасим долг доступными средствами (частично, баланс не в минус).
    await settleOutstandingCharges(tx, userId);
    // Перечитываем актуальный статус начисления после погашения.
    return tx.charge.findUnique({
      where: { id: created.id },
      select: { id: true, status: true, amountKopecks: true, paidKopecks: true },
    });
  });

  // Ушли в долг (начисление осталось открытым) — уведомляем студента (best-effort, с дедупом).
  if (charge && charge.status === 'open') {
    await notifyChargeDebt({ userId, streamId, streamName, periodKey });
  }
}

// Уведомление о долге за период (mentorship_charge_debt) с дедупом по (streamId, periodKey):
// одно уведомление о долге за период на студента, повторный прогон не плодит дубли.
async function notifyChargeDebt(params: {
  userId: string;
  streamId: string;
  streamName: string;
  periodKey: string;
}): Promise<void> {
  const { userId, streamId, streamName, periodKey } = params;
  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      type: 'mentorship_charge_debt',
      AND: [
        { metadata: { path: ['streamId'], equals: streamId } },
        { metadata: { path: ['periodKey'], equals: periodKey } },
      ],
    },
    select: { id: true },
  });
  if (existing) return;

  await createNotification({
    userId,
    type: 'mentorship_charge_debt',
    title: 'Долг за менторскую группу',
    body: `Не хватило средств на оплату «${streamName}». Пополните баланс, чтобы погасить долг.`,
    metadata: { streamId, periodKey, url: '/dashboard/balance' },
  });
}

/**
 * СВИПЕР предупреждений о ближайшем списании. Для активных менторских групп и их
 * не-демо студентов: если до следующего списания осталось <= MENTORSHIP_REMINDER_DAYS дней
 * и (упрощённый прогноз) баланса не хватает на месячную сумму — шлём уведомление
 * mentorship_charge_upcoming (с дедупом по (streamId, periodKey)). Об успешном списании
 * НЕ уведомляем — только о риске нехватки. Ошибки на каждом студенте глотаются.
 */
export async function sweepMentorshipWarnings({ now }: { now?: Date } = {}): Promise<void> {
  const nowDate = now ?? new Date();
  const streams = await activeMonthlyStreams();

  for (const stream of streams) {
    const amountKopecks = stream.monthlyPriceKopecks ?? 0;
    if (amountKopecks <= 0) continue;

    const { nextChargeDate, periodKey } = computeNextChargeInfo(stream, nowDate);
    const daysUntil = (nextChargeDate.getTime() - nowDate.getTime()) / (24 * 60 * 60 * 1000);
    // Окно предупреждения: списание в пределах REMINDER_DAYS вперёд (и ещё не прошло).
    if (daysUntil < 0 || daysUntil > MENTORSHIP_REMINDER_DAYS) continue;

    for await (const enrollment of enrollmentsForBilling(stream.id)) {
      try {
        await warnStudentIfShort({
          userId: enrollment.userId,
          streamId: stream.id,
          streamName: stream.name,
          amountKopecks,
          periodKey,
        });
      } catch (err) {
        console.error(
          '[cron] mentorship warning error',
          { streamId: stream.id, userId: enrollment.userId, periodKey },
          err,
        );
      }
    }
  }
}

// Предупреждает студента о ближайшем списании, если прогноз — нехватка средств
// (упрощённо: текущий баланс < месячной суммы) и предупреждение за период ещё не слали.
async function warnStudentIfShort(params: {
  userId: string;
  streamId: string;
  streamName: string;
  amountKopecks: number;
  periodKey: string;
}): Promise<void> {
  const { userId, streamId, streamName, amountKopecks, periodKey } = params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { balanceKopecks: true },
  });
  if (!user) return;
  // Прогноз достаточности: если на балансе хватает на месяц — не тревожим.
  if (user.balanceKopecks >= amountKopecks) return;

  // Дедуп: одно предупреждение о ближайшем списании за период на студента.
  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      type: 'mentorship_charge_upcoming',
      AND: [
        { metadata: { path: ['streamId'], equals: streamId } },
        { metadata: { path: ['periodKey'], equals: periodKey } },
      ],
    },
    select: { id: true },
  });
  if (existing) return;

  await createNotification({
    userId,
    type: 'mentorship_charge_upcoming',
    title: 'Скоро списание за менторскую группу',
    body: `Скоро спишется оплата за «${streamName}». На балансе может не хватить средств — пополните баланс.`,
    metadata: { streamId, periodKey, url: '/dashboard/balance' },
  });
}

// Хелперы экспортируются для юнит-тестов (clamp/периоды/TZ).
export const __testing = {
  moscowParts,
  moscowPeriodKey,
  moscowMidnightUtc,
  effectiveBillingDay,
  duePeriods,
  daysInMonth,
};
