import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Тест адресации уведомлений в чатах потока (issue #179): преподаватель потока
// получает, посторонний админ (НЕ преподаватель этого потока) — НЕ получает.
// Мокаем prisma на уровне методов, которые трогают POST-хендлеры stream/cohort.
vi.mock('@platform/db', async () => {
  const actual = await vi.importActual<typeof import('@platform/db')>('@platform/db');
  return {
    prisma: {
      stream: { findUnique: vi.fn(), findMany: vi.fn() },
      streamEnrollment: { findMany: vi.fn(), findUnique: vi.fn() },
      conversation: { findFirst: vi.fn(), create: vi.fn() },
      conversationEntry: { create: vi.fn(), count: vi.fn(), findMany: vi.fn() },
      conversationRead: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
      user: { findMany: vi.fn(), findFirst: vi.fn() },
    },
    Prisma: actual.Prisma,
  };
});

// Уведомления мокаем: проверяем, КОМУ ушёл fan-out, без реальной БД/почты/пуша.
vi.mock('../../lib/notifications.js', () => ({
  notifyMany: vi.fn(async () => {}),
  createNotification: vi.fn(async () => {}),
}));

// S3 не задействован в JSON-ветке, но импортируется модулем — стабим на всякий случай.
vi.mock('../../lib/s3.js', () => ({
  uploadFile: vi.fn(async () => ({ key: 'k', url: '/files/k', size: 1 })),
  getFileUrl: vi.fn(async (k: string) => `https://signed.example/${k}`),
  deleteFile: vi.fn(async () => {}),
  MAX_FILE_SIZE: 50 * 1024 * 1024,
}));

import { conversationRoutes } from '../conversations.js';
import { prisma } from '@platform/db';
import { notifyMany } from '../../lib/notifications.js';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const notifyManyMock = vi.mocked(notifyMany);

async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(conversationRoutes);
  await app.ready();
  return app;
}

const adminToken = (id: string) => signAccessToken({ userId: id, role: 'admin' });
const studentToken = (id: string) => signAccessToken({ userId: id, role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

// Поток в форме streamTeacherSourcesInclude: преподаватели берутся из program.programLessons.
// teacherUserIds — кто ведёт поток (попадут в deriveStreamTeachers).
function streamWithTeachers(teacherUserIds: string[]) {
  return {
    program: {
      id: 'prog-1',
      name: 'Программа',
      type: 'course',
      programLessons: [
        {
          lesson: {
            teachers: teacherUserIds.map((id) => ({ user: { id, name: `Преп ${id}` } })),
          },
        },
      ],
    },
    sessions: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Канал преподавателей потока (notifyStream) ───────────────────────────────

describe('POST /conversations/stream/:streamId/entries — адресация (notifyStream)', () => {
  it('преподаватели потока получают; посторонний админ НЕ получает', async () => {
    // Поток ведут teacher-1 и teacher-2 (>1 → «общий», чат разрешён). Автор — teacher-1.
    db.stream.findUnique.mockImplementation(({ select }: { select?: unknown }) =>
      // getStreamShared/getStreamTeachers читает через select=streamTeacherSourcesInclude;
      // обычный findUnique (без include source-полей) возвращает имя для текста.
      select && 'program' in (select as Record<string, unknown>)
        ? Promise.resolve(streamWithTeachers(['teacher-1', 'teacher-2']))
        : Promise.resolve({ id: 'stream-1', name: 'Поток А' }),
    );
    db.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    db.conversationEntry.create.mockResolvedValue({
      id: 'entry-1',
      author: { id: 'teacher-1', name: 'Преп teacher-1', role: 'admin' },
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/stream/stream-1/entries',
      headers: authHeaders(adminToken('teacher-1')),
      payload: { type: 'text', content: 'привет коллеги' },
    });

    expect(res.statusCode).toBe(201);
    await flushAsync();

    expect(notifyManyMock).toHaveBeenCalledTimes(1);
    const recipients = notifyManyMock.mock.calls[0][0] as string[];
    // teacher-2 (второй препод потока) получает; teacher-1 (автор) — исключён.
    expect(recipients).toEqual(['teacher-2']);
    // Посторонний админ (не препод потока) НЕ в списке — и user.findMany по role:'admin' не звался.
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});

// ─── Общий чат потока (notifyCohort) ──────────────────────────────────────────

describe('POST /conversations/cohort/:streamId/entries — адресация (notifyCohort)', () => {
  it('студенты потока + преподаватели получают; посторонний админ НЕ получает', async () => {
    // Поток ведёт teacher-1; зачислены student-1, student-2. Автор — student-1.
    db.stream.findUnique.mockImplementation(({ select }: { select?: unknown }) =>
      select && 'program' in (select as Record<string, unknown>)
        ? Promise.resolve(streamWithTeachers(['teacher-1']))
        : Promise.resolve({ id: 'stream-1', name: 'Поток А' }),
    );
    db.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    // canAccessCohort → isEnrolled: студент-автор зачислён (findUnique непустой).
    db.streamEnrollment.findUnique.mockResolvedValue({ id: 'enr-self' });
    // notifyCohort: активные зачисленные студенты потока (findMany).
    db.streamEnrollment.findMany.mockResolvedValue([
      { userId: 'student-1' },
      { userId: 'student-2' },
    ]);
    db.conversationEntry.create.mockResolvedValue({
      id: 'entry-1',
      author: { id: 'student-1', name: 'Студент 1', role: 'student' },
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/cohort/stream-1/entries',
      headers: authHeaders(studentToken('student-1')),
      payload: { type: 'text', content: 'вопрос группе' },
    });

    expect(res.statusCode).toBe(201);
    await flushAsync();

    expect(notifyManyMock).toHaveBeenCalledTimes(1);
    const recipients = (notifyManyMock.mock.calls[0][0] as string[]).slice().sort();
    // Сокурсник student-2 + преподаватель teacher-1; автор student-1 исключён.
    expect(recipients).toEqual(['student-2', 'teacher-1']);
    // Никаких «всех админов»: user.findMany по role:'admin' не вызывается.
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
