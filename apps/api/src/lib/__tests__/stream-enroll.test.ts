import { describe, it, expect, beforeEach, vi } from 'vitest';

// Юнит-тесты зачисления студента в поток (DB-free). Prisma реэкспортируем настоящий
// (нужен Prisma.PrismaClientKnownRequestError для ветки P2002 идемпотентного create).
// createCharge/settleOutstandingCharges мокаем как модуль — проверяем, СОЗДАЁТСЯ ли
// разовое начисление в зависимости от billingType/isDemo.
vi.mock('@platform/db', async () => {
  const actual = await vi.importActual<typeof import('@platform/db')>('@platform/db');
  return { prisma: {}, Prisma: actual.Prisma };
});

vi.mock('../charges.js', () => ({
  createCharge: vi.fn(),
  settleOutstandingCharges: vi.fn(),
}));

import { createCharge, settleOutstandingCharges } from '../charges.js';
import { enrollStudentInStream } from '../stream-enroll.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createChargeMock = createCharge as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const settleMock = settleOutstandingCharges as any;

// Фабрика мок-клиента (transactional client) с методами, которые трогает зачисление.
function makeClient(opts: {
  stream: { priceKopecks: number | null; billingType: 'one_time' | 'monthly' } | null;
  user: { isDemo: boolean } | null;
}) {
  return {
    streamEnrollment: { create: vi.fn().mockResolvedValue({ id: 'enr-1' }) },
    session: { findMany: vi.fn().mockResolvedValue([]) },
    studentAssignment: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    stream: { findUnique: vi.fn().mockResolvedValue(opts.stream) },
    user: { findUnique: vi.fn().mockResolvedValue(opts.user) },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enrollStudentInStream — платёжный план при зачислении', () => {
  it('разовая группа (one_time) с ценой + НЕ demo → создаёт разовое начисление и гасит долг', async () => {
    const client = makeClient({
      stream: { priceKopecks: 10000, billingType: 'one_time' },
      user: { isDemo: false },
    });

    await enrollStudentInStream('s-1', 'u-1', client as AnyClient, 'admin-1');

    expect(createChargeMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ streamId: 's-1', userId: 'u-1', amountKopecks: 10000 }),
    );
    expect(settleMock).toHaveBeenCalledWith(client, 'u-1');
  });

  it('менторская группа (monthly) → разовое начисление НЕ создаётся (его сделает cron)', async () => {
    const client = makeClient({
      stream: { priceKopecks: 10000, billingType: 'monthly' },
      user: { isDemo: false },
    });

    await enrollStudentInStream('s-1', 'u-1', client as AnyClient, 'admin-1');

    expect(createChargeMock).not.toHaveBeenCalled();
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('демо-студент (isDemo) на разовой группе → начисление НЕ создаётся (демо не платит)', async () => {
    const client = makeClient({
      stream: { priceKopecks: 10000, billingType: 'one_time' },
      user: { isDemo: true },
    });

    await enrollStudentInStream('s-1', 'u-1', client as AnyClient, 'admin-1');

    expect(createChargeMock).not.toHaveBeenCalled();
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('разовая группа без цены (priceKopecks=null) → начисление НЕ создаётся', async () => {
    const client = makeClient({
      stream: { priceKopecks: null, billingType: 'one_time' },
      user: { isDemo: false },
    });

    await enrollStudentInStream('s-1', 'u-1', client as AnyClient, 'admin-1');

    expect(createChargeMock).not.toHaveBeenCalled();
  });

  it('бэкофилл заданий: создаёт StudentAssignment по сессиям с заданием', async () => {
    const client = makeClient({
      stream: { priceKopecks: null, billingType: 'one_time' },
      user: { isDemo: false },
    });
    client.session.findMany.mockResolvedValueOnce([{ id: 'sess-1' }, { id: 'sess-2' }]);

    await enrollStudentInStream('s-1', 'u-1', client as AnyClient);

    expect(client.studentAssignment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { sessionId: 'sess-1', studentId: 'u-1', status: 'assigned' },
          { sessionId: 'sess-2', studentId: 'u-1', status: 'assigned' },
        ],
        skipDuplicates: true,
      }),
    );
  });
});
