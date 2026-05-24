import { describe, it, expect, beforeEach, vi } from 'vitest';

// Юнит-тесты эпика «Авто-списание за менторские группы». DB-free: мокаем prisma
// (методы, которые трогают свиперы), а createCharge/settleOutstandingCharges и
// createNotification — мокаем как модули, чтобы тестировать ОРКЕСТРАЦИЮ свипера
// (идемпотентность периода, долг, пропуск demo, окно предупреждений) изолированно.
vi.mock('@platform/db', () => ({
  prisma: {
    stream: { findMany: vi.fn() },
    streamEnrollment: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    notification: { findFirst: vi.fn() },
    charge: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../charges.js', () => ({
  createCharge: vi.fn(),
  settleOutstandingCharges: vi.fn(),
}));

vi.mock('../notifications.js', () => ({
  createNotification: vi.fn(),
}));

import { prisma } from '@platform/db';
import { createCharge, settleOutstandingCharges } from '../charges.js';
import { createNotification } from '../notifications.js';
import {
  computeNextChargeInfo,
  sweepMentorshipCharges,
  sweepMentorshipWarnings,
  moscowPeriodKey,
  __testing,
} from '../mentorship-billing.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createChargeMock = createCharge as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const settleMock = settleOutstandingCharges as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const notifyMock = createNotification as any;

beforeEach(() => {
  // resetAllMocks (а НЕ clearAllMocks): сбрасывает и очередь mockResolvedValueOnce —
  // иначе неиспользованные «Once» из одного теста перетекали бы в следующий.
  vi.resetAllMocks();
  // По умолчанию $transaction вызывает колбэк с tx = prisma-мок (как интерактивная tx).
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(db));
});

// ─── Чистые хелперы: часовой пояс Москвы, clamp дня, периоды ────────────────────

describe('moscowPeriodKey — период по календарю Москвы', () => {
  it('момент в пределах суток МСК даёт YYYY-MM этого месяца', () => {
    // 2026-05-15T10:00:00Z → в Москве 13:00 15 мая → 2026-05.
    expect(moscowPeriodKey(new Date('2026-05-15T10:00:00Z'))).toBe('2026-05');
  });

  it('поздний вечер UTC последнего дня месяца уже относится к следующему дню МСК', () => {
    // 2026-05-31T22:00:00Z → в Москве 01:00 1 июня → период 2026-06.
    expect(moscowPeriodKey(new Date('2026-05-31T22:00:00Z'))).toBe('2026-06');
  });
});

describe('effectiveBillingDay — clamp дня к последнему дню месяца', () => {
  it('день в пределах месяца не меняется', () => {
    expect(__testing.effectiveBillingDay(2026, 5, 15)).toBe(15);
  });

  it('31 в феврале невисокосного года клампится к 28', () => {
    expect(__testing.effectiveBillingDay(2026, 2, 31)).toBe(28);
  });

  it('29 в феврале високосного года остаётся 29', () => {
    expect(__testing.effectiveBillingDay(2028, 2, 29)).toBe(29);
  });

  it('31 в апреле (30 дней) клампится к 30', () => {
    expect(__testing.effectiveBillingDay(2026, 4, 31)).toBe(30);
  });
});

describe('computeNextChargeInfo — дата/период следующего списания', () => {
  it('день месяца ещё не наступил → списание в этом месяце', () => {
    // Сегодня 5 мая МСК, день списания 15 → следующее списание 15 мая 2026.
    const now = new Date('2026-05-05T09:00:00Z'); // 12:00 МСК 5 мая
    const info = computeNextChargeInfo(
      { monthlyPriceKopecks: 500000, billingDayOfMonth: 15 },
      now,
    );
    expect(info.periodKey).toBe('2026-05');
    expect(info.amountKopecks).toBe(500000);
    // Полночь 15 мая по МСК = 14 мая 21:00 UTC (UTC+3).
    expect(info.nextChargeDate.toISOString()).toBe('2026-05-14T21:00:00.000Z');
  });

  it('день месяца уже наступил → списание в следующем месяце', () => {
    // Сегодня 20 мая МСК, день 15 → следующее списание 15 июня 2026.
    const now = new Date('2026-05-20T09:00:00Z');
    const info = computeNextChargeInfo(
      { monthlyPriceKopecks: 500000, billingDayOfMonth: 15 },
      now,
    );
    expect(info.periodKey).toBe('2026-06');
    expect(info.nextChargeDate.toISOString()).toBe('2026-06-14T21:00:00.000Z');
  });

  it('переход через год: декабрь после дня списания → январь следующего года', () => {
    // 20 декабря МСК, день 10 уже прошёл → следующее списание 10 января 2027.
    const now = new Date('2026-12-20T09:00:00Z');
    const info = computeNextChargeInfo(
      { monthlyPriceKopecks: 100000, billingDayOfMonth: 10 },
      now,
    );
    expect(info.periodKey).toBe('2027-01');
    // Полночь 10 января 2027 МСК = 9 января 21:00 UTC (UTC+3).
    expect(info.nextChargeDate.toISOString()).toBe('2027-01-09T21:00:00.000Z');
  });

  it('clamp: день 31 в феврале → последний день февраля', () => {
    // 1 февраля 2026 МСК, день 31 → списание 28 февраля (clamp).
    const now = new Date('2026-02-01T09:00:00Z');
    const info = computeNextChargeInfo(
      { monthlyPriceKopecks: 100000, billingDayOfMonth: 31 },
      now,
    );
    expect(info.periodKey).toBe('2026-02');
    // Полночь 28 февраля МСК = 27 февраля 21:00 UTC.
    expect(info.nextChargeDate.toISOString()).toBe('2026-02-27T21:00:00.000Z');
  });
});

describe('duePeriods — какие периоды пора начислять', () => {
  it('день ещё не наступил, без бэкофилла → пусто', () => {
    // 5 мая МСК, день 15 → текущий период ещё не наступил.
    const now = new Date('2026-05-05T09:00:00Z');
    expect(__testing.duePeriods(now, 15, 0)).toEqual([]);
  });

  it('день наступил, без бэкофилла → текущий период', () => {
    const now = new Date('2026-05-20T09:00:00Z');
    expect(__testing.duePeriods(now, 15, 0)).toEqual(['2026-05']);
  });

  it('ровно день списания (граница) → текущий период включён', () => {
    // 15 мая 12:00 МСК, день 15 → наступил.
    const now = new Date('2026-05-15T09:00:00Z');
    expect(__testing.duePeriods(now, 15, 0)).toEqual(['2026-05']);
  });

  it('бэкофилл 2 месяца, день наступил → два прошлых + текущий (от старого к новому)', () => {
    const now = new Date('2026-05-20T09:00:00Z');
    expect(__testing.duePeriods(now, 15, 2)).toEqual(['2026-03', '2026-04', '2026-05']);
  });
});

// ─── sweepMentorshipCharges — оркестрация ──────────────────────────────────────

describe('sweepMentorshipCharges', () => {
  const stream = {
    id: 'st-1',
    name: 'Менторская',
    monthlyPriceKopecks: 500000,
    billingDayOfMonth: 15,
  };

  it('начисляет не-demo студенту за наступивший период и гасит долг (без долга → без уведомления)', async () => {
    db.stream.findMany.mockResolvedValueOnce([stream]);
    // Один зачисленный студент; вторая выборка батча — пусто (конец).
    db.streamEnrollment.findMany
      .mockResolvedValueOnce([{ id: 'enr-1', userId: 'u-1' }])
      .mockResolvedValueOnce([]);
    createChargeMock.mockResolvedValueOnce({ id: 'c-1' });
    settleMock.mockResolvedValueOnce(500000);
    // После погашения начисление закрыто (долга нет).
    db.charge.findUnique.mockResolvedValueOnce({
      id: 'c-1',
      status: 'paid',
      amountKopecks: 500000,
      paidKopecks: 500000,
    });

    await sweepMentorshipCharges({ now: new Date('2026-05-20T09:00:00Z') });

    expect(createChargeMock).toHaveBeenCalledTimes(1);
    expect(createChargeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        streamId: 'st-1',
        userId: 'u-1',
        amountKopecks: 500000,
        periodKey: '2026-05',
        kind: 'monthly',
      }),
    );
    expect(settleMock).toHaveBeenCalledWith(expect.anything(), 'u-1');
    // Долга нет → уведомление о долге НЕ шлём.
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('нехватка средств → начисление осталось open → уведомление о долге (с дедупом)', async () => {
    db.stream.findMany.mockResolvedValueOnce([stream]);
    db.streamEnrollment.findMany
      .mockResolvedValueOnce([{ id: 'enr-1', userId: 'u-1' }])
      .mockResolvedValueOnce([]);
    createChargeMock.mockResolvedValueOnce({ id: 'c-1' });
    settleMock.mockResolvedValueOnce(0); // нечем гасить
    db.charge.findUnique.mockResolvedValueOnce({
      id: 'c-1',
      status: 'open',
      amountKopecks: 500000,
      paidKopecks: 0,
    });
    db.notification.findFirst.mockResolvedValueOnce(null); // дубля нет

    await sweepMentorshipCharges({ now: new Date('2026-05-20T09:00:00Z') });

    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-1',
        type: 'mentorship_charge_debt',
        metadata: expect.objectContaining({ streamId: 'st-1', periodKey: '2026-05' }),
      }),
    );
  });

  it('дедуп долга: если уведомление за период уже было — повторно не шлём', async () => {
    db.stream.findMany.mockResolvedValueOnce([stream]);
    db.streamEnrollment.findMany
      .mockResolvedValueOnce([{ id: 'enr-1', userId: 'u-1' }])
      .mockResolvedValueOnce([]);
    createChargeMock.mockResolvedValueOnce({ id: 'c-1' });
    settleMock.mockResolvedValueOnce(0);
    db.charge.findUnique.mockResolvedValueOnce({ id: 'c-1', status: 'open' });
    db.notification.findFirst.mockResolvedValueOnce({ id: 'n-existing' }); // дубль найден

    await sweepMentorshipCharges({ now: new Date('2026-05-20T09:00:00Z') });

    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('идемпотентность: повторный прогон за период не двоит (P2002 проглочен в createCharge → существующее)', async () => {
    // createCharge на повторном прогоне вернёт уже существующее начисление (его задача —
    // поймать P2002 на charge_period_uniq). Свип не должен ничего двоить.
    db.stream.findMany.mockResolvedValueOnce([stream]);
    db.streamEnrollment.findMany
      .mockResolvedValueOnce([{ id: 'enr-1', userId: 'u-1' }])
      .mockResolvedValueOnce([]);
    createChargeMock.mockResolvedValueOnce({ id: 'c-existing' }); // вернулось существующее
    settleMock.mockResolvedValueOnce(0);
    db.charge.findUnique.mockResolvedValueOnce({ id: 'c-existing', status: 'paid' });

    await sweepMentorshipCharges({ now: new Date('2026-05-20T09:00:00Z') });

    // Ровно один вызов createCharge (на одного студента за один период) — без дублей.
    expect(createChargeMock).toHaveBeenCalledTimes(1);
  });

  it('день периода ещё не наступил → ничего не начисляем', async () => {
    db.stream.findMany.mockResolvedValueOnce([stream]);

    await sweepMentorshipCharges({ now: new Date('2026-05-05T09:00:00Z') }); // 5 мая < 15

    expect(db.streamEnrollment.findMany).not.toHaveBeenCalled();
    expect(createChargeMock).not.toHaveBeenCalled();
  });

  it('demo-студенты отфильтрованы запросом (выборка зачислений требует isDemo=false)', async () => {
    db.stream.findMany.mockResolvedValueOnce([stream]);
    db.streamEnrollment.findMany.mockResolvedValueOnce([]); // demo не попал в выборку

    await sweepMentorshipCharges({ now: new Date('2026-05-20T09:00:00Z') });

    // Проверяем, что выборка зачислений фильтрует demo/удалённых/неактивных.
    expect(db.streamEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          streamId: 'st-1',
          user: expect.objectContaining({ isDemo: false, deletedAt: null, isActive: true }),
        }),
      }),
    );
    expect(createChargeMock).not.toHaveBeenCalled();
  });

  it('ошибка на одном студенте не валит весь свип (глотается)', async () => {
    // Свип логирует проглоченную ошибку через console.error — глушим, чтобы тест-лог был чистым.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.stream.findMany.mockResolvedValueOnce([stream]);
    db.streamEnrollment.findMany
      .mockResolvedValueOnce([
        { id: 'enr-1', userId: 'u-1' },
        { id: 'enr-2', userId: 'u-2' },
      ])
      .mockResolvedValueOnce([]);
    // Первый студент — падение в транзакции; второй — успех.
    db.$transaction
      .mockImplementationOnce(async () => {
        throw new Error('boom');
      })
      .mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(db));
    createChargeMock.mockResolvedValueOnce({ id: 'c-2' });
    settleMock.mockResolvedValueOnce(0);
    db.charge.findUnique.mockResolvedValueOnce({ id: 'c-2', status: 'paid' });

    await expect(
      sweepMentorshipCharges({ now: new Date('2026-05-20T09:00:00Z') }),
    ).resolves.toBeUndefined();

    // Второй студент обработан, несмотря на падение первого.
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('группы без плана (сумма 0 или нет дня) отфильтрованы запросом', async () => {
    db.stream.findMany.mockResolvedValueOnce([]); // ничего не подходит под where

    await sweepMentorshipCharges({ now: new Date('2026-05-20T09:00:00Z') });

    expect(db.stream.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          billingType: 'monthly',
          monthlyPriceKopecks: { gt: 0 },
          billingDayOfMonth: { not: null },
          status: 'active',
        }),
      }),
    );
  });
});

// ─── sweepMentorshipWarnings — предупреждения о ближайшем списании ──────────────

describe('sweepMentorshipWarnings', () => {
  const stream = {
    id: 'st-1',
    name: 'Менторская',
    monthlyPriceKopecks: 500000,
    billingDayOfMonth: 15,
  };

  it('в окне напоминания и средств не хватает → уведомление mentorship_charge_upcoming', async () => {
    db.stream.findMany.mockResolvedValueOnce([stream]);
    db.streamEnrollment.findMany
      .mockResolvedValueOnce([{ id: 'enr-1', userId: 'u-1' }])
      .mockResolvedValueOnce([]);
    db.user.findUnique.mockResolvedValueOnce({ balanceKopecks: 1000 }); // мало
    db.notification.findFirst.mockResolvedValueOnce(null);

    // 12 мая МСК, день 15 → до списания 3 дня (≤7) → в окне.
    await sweepMentorshipWarnings({ now: new Date('2026-05-12T09:00:00Z') });

    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-1',
        type: 'mentorship_charge_upcoming',
        metadata: expect.objectContaining({ streamId: 'st-1', periodKey: '2026-05' }),
      }),
    );
  });

  it('средств хватает → не предупреждаем', async () => {
    db.stream.findMany.mockResolvedValueOnce([stream]);
    db.streamEnrollment.findMany
      .mockResolvedValueOnce([{ id: 'enr-1', userId: 'u-1' }])
      .mockResolvedValueOnce([]);
    db.user.findUnique.mockResolvedValueOnce({ balanceKopecks: 600000 }); // хватает

    await sweepMentorshipWarnings({ now: new Date('2026-05-12T09:00:00Z') });

    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('до списания далеко (вне окна REMINDER_DAYS) → не предупреждаем', async () => {
    db.stream.findMany.mockResolvedValueOnce([stream]);

    // 1 мая МСК, день 15 → 14 дней до списания (>7) → вне окна, зачисления даже не читаем.
    await sweepMentorshipWarnings({ now: new Date('2026-05-01T09:00:00Z') });

    expect(db.streamEnrollment.findMany).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('дедуп: предупреждение за период уже было → повторно не шлём', async () => {
    db.stream.findMany.mockResolvedValueOnce([stream]);
    db.streamEnrollment.findMany
      .mockResolvedValueOnce([{ id: 'enr-1', userId: 'u-1' }])
      .mockResolvedValueOnce([]);
    db.user.findUnique.mockResolvedValueOnce({ balanceKopecks: 1000 });
    db.notification.findFirst.mockResolvedValueOnce({ id: 'n-existing' });

    await sweepMentorshipWarnings({ now: new Date('2026-05-12T09:00:00Z') });

    expect(notifyMock).not.toHaveBeenCalled();
  });
});
