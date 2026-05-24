import { describe, it, expect, vi, beforeEach } from 'vitest';

// session-status импортирует @platform/db на верхнем уровне. Мокаем prisma,
// чтобы тест был DB-free: findMany возвращает кандидатов, updateMany — счётчик.
vi.mock('@platform/db', () => ({
  prisma: {
    session: {
      findMany: vi.fn(() => Promise.resolve([])),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
  },
}));

import { sweepAutoDoneSessions } from '../session-status.js';
import { prisma } from '@platform/db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// Минимальный логгер формы Fastify (свипер пишет только log.error при сбоях).
// Тип сужаем через any — свипер использует лишь log.error/warn/info.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const logger = { log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } as any;

// Удобный конструктор полночи UTC для даты занятия (@db.Date).
function dateUtc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

beforeEach(() => {
  vi.clearAllMocks();
  db.session.findMany.mockResolvedValue([]);
  db.session.updateMany.mockResolvedValue({ count: 1 });
});

describe('sweepAutoDoneSessions — авто-перевод в done по дате', () => {
  it('выбирает занятия planned/live с датой в прошлом (в окне просмотра)', async () => {
    const now = dateUtc(2026, 5, 24);
    await sweepAutoDoneSessions(logger, { now });

    expect(db.session.findMany).toHaveBeenCalledTimes(1);
    const where = db.session.findMany.mock.calls[0][0].where;
    // Целевые статусы для авто-done — 'planned' и 'live' (зависшее в эфире).
    expect(where.status).toEqual({ in: ['planned', 'live'] });
    // дата строго раньше начала сегодняшнего дня (UTC) и не древнее окна.
    expect(where.date.lt).toEqual(dateUtc(2026, 5, 24));
    expect(where.date.gte).toBeInstanceOf(Date);
    expect(where.date.gte.getTime()).toBeLessThan(where.date.lt.getTime());
  });

  it('завершает занятие, которое НЕ трогали после его даты (updatedAt в пределах grace)', async () => {
    const now = dateUtc(2026, 5, 24);
    const lessonDate = dateUtc(2026, 5, 20);
    db.session.findMany.mockResolvedValue([
      // updatedAt = тот же день, что и дата занятия (штатное планирование) — в пределах grace.
      { id: 'sess-1', date: lessonDate, updatedAt: lessonDate },
    ]);

    const count = await sweepAutoDoneSessions(logger, { now });

    expect(count).toBe(1);
    // updateMany с повторным условием status IN ('planned','live') (атомарно/идемпотентно).
    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'sess-1', status: { in: ['planned', 'live'] } },
      data: { status: 'done' },
    });
  });

  it('добивает в done занятие live с прошедшей датой (зависло в эфире)', async () => {
    const now = dateUtc(2026, 5, 24);
    const lessonDate = dateUtc(2026, 5, 20);
    // Занятие было в эфире (live), но meeting.ended не дошёл; дата уже прошла,
    // руками после даты не трогали → свипер добирает его в done.
    db.session.findMany.mockResolvedValue([
      { id: 'sess-live', date: lessonDate, updatedAt: lessonDate },
    ]);

    const count = await sweepAutoDoneSessions(logger, { now });

    expect(count).toBe(1);
    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'sess-live', status: { in: ['planned', 'live'] } },
      data: { status: 'done' },
    });
  });

  it('НЕ перебивает ручной откат: занятие, тронутое ПОСЛЕ даты, не авто-завершается', async () => {
    const now = dateUtc(2026, 5, 24);
    const lessonDate = dateUtc(2026, 5, 20);
    // Админ откатил done→planned 22-го — updatedAt далеко за grace (date + 24ч).
    const touchedAfter = new Date(dateUtc(2026, 5, 22).getTime());
    db.session.findMany.mockResolvedValue([
      { id: 'sess-rollback', date: lessonDate, updatedAt: touchedAfter },
    ]);

    const count = await sweepAutoDoneSessions(logger, { now });

    expect(count).toBe(0);
    expect(db.session.updateMany).not.toHaveBeenCalled();
  });

  it('идемпотентность: updateMany count=0 (статус сменился между выборкой и апдейтом) не считается завершением', async () => {
    const now = dateUtc(2026, 5, 24);
    const lessonDate = dateUtc(2026, 5, 20);
    db.session.findMany.mockResolvedValue([
      { id: 'sess-x', date: lessonDate, updatedAt: lessonDate },
    ]);
    db.session.updateMany.mockResolvedValue({ count: 0 });

    const count = await sweepAutoDoneSessions(logger, { now });
    expect(count).toBe(0);
  });

  it('глотает ошибку на отдельном занятии — не валит весь проход', async () => {
    const now = dateUtc(2026, 5, 24);
    const lessonDate = dateUtc(2026, 5, 20);
    db.session.findMany.mockResolvedValue([
      { id: 'sess-bad', date: lessonDate, updatedAt: lessonDate },
      { id: 'sess-ok', date: lessonDate, updatedAt: lessonDate },
    ]);
    db.session.updateMany
      .mockRejectedValueOnce(new Error('БД недоступна'))
      .mockResolvedValueOnce({ count: 1 });

    const count = await sweepAutoDoneSessions(logger, { now });

    // Первый упал (поглощён), второй завершён.
    expect(count).toBe(1);
    expect(logger.log.error).toHaveBeenCalledTimes(1);
  });
});
