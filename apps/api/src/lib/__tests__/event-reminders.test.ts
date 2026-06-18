import { describe, it, expect, beforeEach, vi } from 'vitest';

// Юнит-тесты эпика «Напоминания о событиях» (#169). DB-free: мокаем prisma (методы,
// что трогает свипер) и sendPushToUser (изолируем оркестрацию: окно, идемпотентность,
// резолв получателей). Prisma (для instanceof PrismaClientKnownRequestError в ветке
// P2002) реэкспортируем НАСТОЯЩИЙ через importActual — как в charges.test.ts.
vi.mock('@platform/db', async () => {
  const actual = await vi.importActual<typeof import('@platform/db')>('@platform/db');
  return {
    Prisma: actual.Prisma,
    prisma: {
      session: { findMany: vi.fn() },
      meeting: { findMany: vi.fn() },
      streamEnrollment: { findMany: vi.fn() },
      notificationPreference: { findMany: vi.fn() },
      eventReminderSent: { create: vi.fn(), deleteMany: vi.fn() },
    },
  };
});

vi.mock('../notifications.js', () => ({
  sendPushToUser: vi.fn(() => Promise.resolve()),
}));

import { prisma, Prisma as RealPrisma } from '@platform/db';
import { sendPushToUser } from '../notifications.js';
import { sweepEventReminders, cleanupOldEventReminders, __testing } from '../event-reminders.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pushMock = sendPushToUser as any;

const { candidateDates, eventStartUtc, formatStartTime } = __testing;

// data всех вызовов eventReminderSent.create (без per-line any в тестах).
interface MarkerData {
  eventType: 'session' | 'meeting';
  eventId: string;
  offsetMinutes: number;
  userId: string;
}
function createdMarkers(): MarkerData[] {
  return db.eventReminderSent.create.mock.calls.map(
    (c: [{ data: MarkerData }]) => c[0].data,
  );
}

// @db.Date: Prisma отдаёт как Date в полночь UTC дня.
function dbDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

// Москва = UTC+3, значит старт 12:00 МСК 2026-06-20 = 09:00 UTC.
function activeUser(id: string) {
  return { id, isActive: true, deletedAt: null };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Дефолты: пусто.
  db.session.findMany.mockResolvedValue([]);
  db.meeting.findMany.mockResolvedValue([]);
  db.streamEnrollment.findMany.mockResolvedValue([]);
  db.notificationPreference.findMany.mockResolvedValue([]);
  db.eventReminderSent.create.mockResolvedValue({});
  db.eventReminderSent.deleteMany.mockResolvedValue({ count: 0 });
});

// ─── Чистые хелперы: сборка старта, окно, даты ─────────────────────────────────

describe('eventStartUtc — сборка UTC-инстанта старта из date+startTime', () => {
  it('12:00 МСК 2026-06-20 → 09:00 UTC', () => {
    const start = eventStartUtc(dbDate('2026-06-20'), '12:00');
    expect(start?.toISOString()).toBe('2026-06-20T09:00:00.000Z');
  });

  it('00:30 МСК 2026-06-20 → 21:30 UTC предыдущих суток (граница суток)', () => {
    const start = eventStartUtc(dbDate('2026-06-20'), '00:30');
    expect(start?.toISOString()).toBe('2026-06-19T21:30:00.000Z');
  });

  it('старт на границе месяца: 01:00 МСК 2026-07-01 → 22:00 UTC 2026-06-30', () => {
    const start = eventStartUtc(dbDate('2026-07-01'), '01:00');
    expect(start?.toISOString()).toBe('2026-06-30T22:00:00.000Z');
  });

  it('нет startTime → null (событие не выбирается)', () => {
    expect(eventStartUtc(dbDate('2026-06-20'), null)).toBeNull();
    expect(eventStartUtc(dbDate('2026-06-20'), '')).toBeNull();
  });

  it('невалидный startTime → null', () => {
    expect(eventStartUtc(dbDate('2026-06-20'), '25:00')).toBeNull();
    expect(eventStartUtc(dbDate('2026-06-20'), 'abc')).toBeNull();
    expect(eventStartUtc(dbDate('2026-06-20'), '12:99')).toBeNull();
  });

  it('нет date → null', () => {
    expect(eventStartUtc(null, '12:00')).toBeNull();
  });
});

describe('candidateDates — московские даты-кандидаты окна', () => {
  it('окно внутри одних суток → одна дата', () => {
    const start = new Date('2026-06-20T09:00:00.000Z'); // 12:00 МСК
    const end = new Date(start.getTime() + 60_000);
    const dates = candidateDates(start, end).map((d) => d.toISOString());
    expect(dates).toEqual(['2026-06-20T00:00:00.000Z']);
  });

  it('окно на границе суток МСК → две даты', () => {
    // 20:59 UTC = 23:59 МСК 20-го; +60c пересекает 00:00 МСК 21-го (21:00 UTC).
    const start = new Date('2026-06-20T20:59:30.000Z');
    const end = new Date(start.getTime() + 60_000); // 21:00:30 UTC = 00:00:30 МСК 21-го
    const dates = candidateDates(start, end).map((d) => d.toISOString());
    expect(dates).toContain('2026-06-20T00:00:00.000Z');
    expect(dates).toContain('2026-06-21T00:00:00.000Z');
    expect(dates.length).toBe(2);
  });
});

describe('formatStartTime', () => {
  it('нормализует часы до двух цифр', () => {
    expect(formatStartTime('9:05')).toBe('09:05');
    expect(formatStartTime('12:00')).toBe('12:00');
  });
});

// ─── Оркестрация свипера: окно, получатели, идемпотентность ────────────────────

// now выбираем так, чтобы для offset=60 целевое окно старта = 09:00 UTC (12:00 МСК).
// now = 08:00:00 UTC → minuteStart 08:00 → +60мин = 09:00 UTC.
const NOW = new Date('2026-06-20T08:00:00.000Z');

describe('sweepEventReminders — занятия (Session)', () => {
  it('занятие со стартом в окне off=60: шлёт push преподавателю и активным студентам', async () => {
    db.session.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        streamId: 'stream-1',
        date: dbDate('2026-06-20'),
        startTime: '12:00', // 09:00 UTC = NOW+60мин
        stream: { name: 'Поток А' },
        lesson: { title: 'Урок 1', teachers: [{ user: activeUser('teacher-1') }] },
      },
    ]);
    db.streamEnrollment.findMany.mockResolvedValue([
      { streamId: 'stream-1', userId: 'student-1' },
      { streamId: 'stream-1', userId: 'student-2' },
    ]);

    await sweepEventReminders({ now: NOW });

    // Метка создаётся на каждого из 3 получателей с offset=60.
    const createdUsers = createdMarkers()
      .filter((d) => d.offsetMinutes === 60 && d.eventId === 'sess-1')
      .map((d) => d.userId)
      .sort();
    expect(createdUsers).toEqual(['student-1', 'student-2', 'teacher-1']);
    expect(pushMock).toHaveBeenCalledTimes(3);
  });

  it('несколько преподавателей урока — push всем активным', async () => {
    db.session.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        streamId: 'stream-1',
        date: dbDate('2026-06-20'),
        startTime: '12:00',
        stream: { name: 'Поток А' },
        lesson: {
          title: 'Урок 1',
          teachers: [{ user: activeUser('teacher-1') }, { user: activeUser('teacher-2') }],
        },
      },
    ]);

    await sweepEventReminders({ now: NOW });

    const users = createdMarkers().map((d) => d.userId).sort();
    expect(users).toEqual(['teacher-1', 'teacher-2']);
  });

  it('деактивированный преподаватель не получает push', async () => {
    db.session.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        streamId: 'stream-1',
        date: dbDate('2026-06-20'),
        startTime: '12:00',
        stream: { name: 'Поток А' },
        lesson: {
          title: 'Урок 1',
          teachers: [
            { user: activeUser('teacher-1') },
            { user: { id: 'teacher-off', isActive: false, deletedAt: null } },
          ],
        },
      },
    ]);

    await sweepEventReminders({ now: NOW });
    const users = createdMarkers().map((d) => d.userId);
    expect(users).toEqual(['teacher-1']);
  });

  it('отчисленный студент не попадает (его нет в активных enrollment)', async () => {
    db.session.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        streamId: 'stream-1',
        date: dbDate('2026-06-20'),
        startTime: '12:00',
        stream: { name: 'Поток А' },
        lesson: { title: 'Урок 1', teachers: [] },
      },
    ]);
    // streamEnrollment.findMany уже фильтрует по active/role в where — мокаем результат
    // как «только активный студент остался».
    db.streamEnrollment.findMany.mockResolvedValue([
      { streamId: 'stream-1', userId: 'student-active' },
    ]);

    await sweepEventReminders({ now: NOW });
    const users = createdMarkers().map((d) => d.userId);
    expect(users).toEqual(['student-active']);

    // where включает фильтр активности — проверим, что свипер его передаёт.
    const where = db.streamEnrollment.findMany.mock.calls[0][0].where;
    expect(where.user).toMatchObject({ isActive: true, deletedAt: null, role: 'student' });
  });

  it('занятие без startTime не выбирается БД (where startTime not null) и не шлётся', async () => {
    // Эмулируем, что БД вернула пусто (т.к. where startTime: { not: null }).
    db.session.findMany.mockResolvedValue([]);
    await sweepEventReminders({ now: NOW });
    expect(db.eventReminderSent.create).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    // Проверим, что where действительно требует непустой startTime и planned.
    const where = db.session.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'planned', startTime: { not: null } });
  });

  it('занятие со стартом ВНЕ окна не шлётся (старт 13:00 МСК ≠ 12:00)', async () => {
    db.session.findMany.mockResolvedValue([
      {
        id: 'sess-late',
        streamId: 'stream-1',
        date: dbDate('2026-06-20'),
        startTime: '13:00', // 10:00 UTC, окно ждёт 09:00
        stream: { name: 'Поток А' },
        lesson: { title: 'Урок', teachers: [{ user: activeUser('teacher-1') }] },
      },
    ]);
    await sweepEventReminders({ now: NOW });
    expect(db.eventReminderSent.create).not.toHaveBeenCalled();
  });
});

describe('sweepEventReminders — встречи (Meeting)', () => {
  it('встреча в окне: push teacher+student', async () => {
    db.meeting.findMany.mockResolvedValue([
      {
        id: 'meet-1',
        date: dbDate('2026-06-20'),
        startTime: '12:00',
        title: 'Разбор',
        teacher: activeUser('teacher-1'),
        student: activeUser('student-1'),
      },
    ]);

    await sweepEventReminders({ now: NOW });

    const users = createdMarkers()
      .filter((d) => d.eventType === 'meeting')
      .map((d) => d.userId)
      .sort();
    expect(users).toEqual(['student-1', 'teacher-1']);
  });

  it('деактивированный студент встречи не получает', async () => {
    db.meeting.findMany.mockResolvedValue([
      {
        id: 'meet-1',
        date: dbDate('2026-06-20'),
        startTime: '12:00',
        title: 'Разбор',
        teacher: activeUser('teacher-1'),
        student: { id: 'student-off', isActive: false, deletedAt: null },
      },
    ]);
    await sweepEventReminders({ now: NOW });
    const users = createdMarkers().map((d) => d.userId);
    expect(users).toEqual(['teacher-1']);
  });
});

describe('sweepEventReminders — тумблеры (preferences)', () => {
  it('pushEnabled=false для типа _60 → не шлём этому пользователю', async () => {
    db.meeting.findMany.mockResolvedValue([
      {
        id: 'meet-1',
        date: dbDate('2026-06-20'),
        startTime: '12:00',
        title: 'Разбор',
        teacher: activeUser('teacher-1'),
        student: activeUser('student-1'),
      },
    ]);
    db.notificationPreference.findMany.mockResolvedValue([
      { userId: 'student-1', pushEnabled: false },
    ]);

    await sweepEventReminders({ now: NOW });
    const users = createdMarkers().map((d) => d.userId);
    expect(users).toEqual(['teacher-1']);
    // Тип preference для off=60 — event_reminder_60.
    const where = db.notificationPreference.findMany.mock.calls[0][0].where;
    expect(where.type).toBe('event_reminder_60');
  });

  it('нет записи preference → дефолт ВКЛ (шлём)', async () => {
    db.meeting.findMany.mockResolvedValue([
      {
        id: 'meet-1',
        date: dbDate('2026-06-20'),
        startTime: '12:00',
        title: 'Разбор',
        teacher: activeUser('teacher-1'),
        student: activeUser('student-1'),
      },
    ]);
    db.notificationPreference.findMany.mockResolvedValue([]);
    await sweepEventReminders({ now: NOW });
    expect(db.eventReminderSent.create).toHaveBeenCalledTimes(2);
  });
});

describe('sweepEventReminders — идемпотентность (двойной тик)', () => {
  it('повторный тик за минуту: P2002 на метке → push НЕ шлётся второй раз', async () => {
    const meetingRow = {
      id: 'meet-1',
      date: dbDate('2026-06-20'),
      startTime: '12:00',
      title: 'Разбор',
      teacher: activeUser('teacher-1'),
      student: activeUser('student-1'),
    };
    db.meeting.findMany.mockResolvedValue([meetingRow]);

    // Первый тик: create успешен.
    await sweepEventReminders({ now: NOW });
    expect(db.eventReminderSent.create).toHaveBeenCalledTimes(2);
    expect(pushMock).toHaveBeenCalledTimes(2);

    // Второй тик: create бросает P2002 (метка уже есть) → push не вызывается.
    pushMock.mockClear();
    db.eventReminderSent.create.mockRejectedValue(
      new RealPrisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await sweepEventReminders({ now: NOW });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('per-user сбой push не валит остальных', async () => {
    db.meeting.findMany.mockResolvedValue([
      {
        id: 'meet-1',
        date: dbDate('2026-06-20'),
        startTime: '12:00',
        title: 'Разбор',
        teacher: activeUser('teacher-1'),
        student: activeUser('student-1'),
      },
    ]);
    pushMock.mockRejectedValueOnce(new Error('push boom'));
    await expect(sweepEventReminders({ now: NOW })).resolves.toBeUndefined();
    // Обоим попытались отправить (метки созданы), сбой первого не остановил второго.
    expect(db.eventReminderSent.create).toHaveBeenCalledTimes(2);
    expect(pushMock).toHaveBeenCalledTimes(2);
  });
});

describe('cleanupOldEventReminders', () => {
  it('удаляет метки старше N дней и возвращает count', async () => {
    db.eventReminderSent.deleteMany.mockResolvedValue({ count: 5 });
    const count = await cleanupOldEventReminders(7);
    expect(count).toBe(5);
    const where = db.eventReminderSent.deleteMany.mock.calls[0][0].where;
    expect(where.sentAt.lt).toBeInstanceOf(Date);
  });
});
