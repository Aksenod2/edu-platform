import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole } from '../middleware/auth.js';

// Лента активности ОДНОГО студента (Этап B эпика «Лог активности студента»).
//
// Эндпоинт-агрегатор: собирает в единую датированную ленту события из четырёх
// источников и отдаёт их одной страницей (cursor-пагинация по timestamp DESC):
//   1) посещаемость занятий          (SessionAttendance → Session)
//   2) сдача домашки                 (StudentAssignment.submittedAt)
//   3) проверка домашки              (StudentAssignment.reviewedAt)
//   4) просмотр видео урока          (VideoView → LessonVideo)
//
// КРИТИЧНО: карточка студента — зона админа/преподавателя (преподаватель = admin
// по решению заказчика). Ученик доступа к ленте НЕ имеет → весь роут под admin.

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

type ActivityType =
  | 'attendance'
  | 'assignment_submitted'
  | 'assignment_reviewed'
  | 'video_watched';

interface ActivityEvent {
  id: string;
  type: ActivityType;
  timestamp: string;
  lessonId: string | null;
  lessonTitle: string | null;
  streamId: string | null;
  streamName: string | null;
  status?: string;
  videoId?: string;
  videoTitle?: string | null;
  watchedPercent?: number;
  completed?: boolean;
}

// Клампим limit в [1..100], дефолт 50. Нечисловое/мусор → дефолт.
function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  const i = Math.trunc(n);
  if (i < MIN_LIMIT) return MIN_LIMIT;
  if (i > MAX_LIMIT) return MAX_LIMIT;
  return i;
}

export async function studentsRoutes(app: FastifyInstance) {
  // Весь роут только для admin (преподаватель = admin). Ученик доступа не имеет.
  app.addHook('preHandler', requireRole('admin'));

  // GET /students/:id/activity?limit=&before=
  // :id = studentId. before — ISO-курсор: вернуть события строго СТАРШЕ (timestamp < before).
  app.get('/students/:id/activity', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string; before?: string };

    const limit = parseLimit(query.limit);

    // before — необязательный ISO-курсор. Если задан и не парсится — 400.
    let before: Date | null = null;
    if (query.before !== undefined && query.before !== '') {
      const parsed = new Date(query.before);
      if (Number.isNaN(parsed.getTime())) {
        return reply.status(HTTP_BAD_REQUEST).send({ error: 'before должен быть валидной ISO-датой' });
      }
      before = parsed;
    }

    // Студент должен существовать (404 иначе). Карточка — только про студентов.
    const student = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!student || student.role !== 'student' || student.deletedAt !== null) {
      return reply.status(HTTP_NOT_FOUND).send({ error: 'Студент не найден' });
    }

    // Каждый источник: фильтр timestamp < before (если задан), сорт по своему
    // timestamp DESC, take: limit. Затем общий merge + сорт + срез до limit даёт
    // корректную страницу (пер-источниковый take:limit гарантирует, что в merge
    // попадёт достаточно кандидатов на топ-limit самых свежих).

    // ── Посещаемость ──────────────────────────────────────────────────────────
    // timestamp = Session.date (день занятия); фолбэк на createdAt, если date null.
    // У занятия может быть И zoom-ряд, И manual-ряд → дедуп per sessionId,
    // manual приоритетнее (и для существования события, и для итогового статуса).
    // Фильтр before применяем по эффективному timestamp уже после дедупа: тянем
    // с запасом по обоим полям (date и createdAt), чтобы курсор-граница по date
    // отработала корректно даже при null-date рядах.
    const attendanceRows = await prisma.sessionAttendance.findMany({
      where: {
        userId: id,
        ...(before
          ? {
              OR: [
                { session: { date: { lt: before } } },
                { AND: [{ session: { date: null } }, { createdAt: { lt: before } }] },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        sessionId: true,
        source: true,
        status: true,
        createdAt: true,
        session: {
          select: {
            id: true,
            date: true,
            lessonId: true,
            streamId: true,
            lesson: { select: { title: true } },
            stream: { select: { name: true } },
          },
        },
      },
      // Тянем с запасом: после дедупа per sessionId число событий уменьшится,
      // поэтому берём 2× от limit, чтобы гарантировать достаточно уникальных занятий.
      orderBy: [{ session: { date: 'desc' } }, { createdAt: 'desc' }],
      take: limit * 2,
    });

    // Дедуп per sessionId: manual вытесняет zoom_report.
    const attendanceBySession = new Map<string, (typeof attendanceRows)[number]>();
    for (const row of attendanceRows) {
      const existing = attendanceBySession.get(row.sessionId);
      if (!existing) {
        attendanceBySession.set(row.sessionId, row);
      } else if (existing.source !== 'manual' && row.source === 'manual') {
        // manual имеет приоритет над zoom_report.
        attendanceBySession.set(row.sessionId, row);
      }
    }

    const attendanceEvents: ActivityEvent[] = [...attendanceBySession.values()].map((row) => {
      const ts = row.session.date ?? row.createdAt;
      return {
        id: `attendance:${row.sessionId}`,
        type: 'attendance',
        timestamp: ts.toISOString(),
        lessonId: row.session.lessonId,
        lessonTitle: row.session.lesson?.title ?? null,
        streamId: row.session.streamId,
        streamName: row.session.stream?.name ?? null,
        status: row.status,
      };
    });

    // ── Домашки: сдана (submittedAt) ────────────────────────────────────────────
    const submittedRows = await prisma.studentAssignment.findMany({
      where: {
        studentId: id,
        submittedAt: { not: null, ...(before ? { lt: before } : {}) },
      },
      select: {
        id: true,
        submittedAt: true,
        session: {
          select: {
            lessonId: true,
            streamId: true,
            lesson: { select: { title: true } },
            stream: { select: { name: true } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
      take: limit,
    });

    const submittedEvents: ActivityEvent[] = submittedRows.map((row) => ({
      id: `assignment_submitted:${row.id}`,
      type: 'assignment_submitted',
      // submittedAt отфильтрован not:null — приводим явно.
      timestamp: (row.submittedAt as Date).toISOString(),
      lessonId: row.session.lessonId,
      lessonTitle: row.session.lesson?.title ?? null,
      streamId: row.session.streamId,
      streamName: row.session.stream?.name ?? null,
    }));

    // ── Домашки: проверена (reviewedAt) ─────────────────────────────────────────
    const reviewedRows = await prisma.studentAssignment.findMany({
      where: {
        studentId: id,
        reviewedAt: { not: null, ...(before ? { lt: before } : {}) },
      },
      select: {
        id: true,
        reviewedAt: true,
        session: {
          select: {
            lessonId: true,
            streamId: true,
            lesson: { select: { title: true } },
            stream: { select: { name: true } },
          },
        },
      },
      orderBy: { reviewedAt: 'desc' },
      take: limit,
    });

    const reviewedEvents: ActivityEvent[] = reviewedRows.map((row) => ({
      id: `assignment_reviewed:${row.id}`,
      type: 'assignment_reviewed',
      timestamp: (row.reviewedAt as Date).toISOString(),
      lessonId: row.session.lessonId,
      lessonTitle: row.session.lesson?.title ?? null,
      streamId: row.session.streamId,
      streamName: row.session.stream?.name ?? null,
    }));

    // ── Видео: посмотрел (lastWatchedAt) ────────────────────────────────────────
    const videoRows = await prisma.videoView.findMany({
      where: {
        studentId: id,
        ...(before ? { lastWatchedAt: { lt: before } } : {}),
      },
      select: {
        id: true,
        lessonVideoId: true,
        streamId: true,
        watchedPercent: true,
        completedAt: true,
        lastWatchedAt: true,
        lessonVideo: {
          select: {
            id: true,
            title: true,
            lessonId: true,
            lesson: { select: { title: true } },
          },
        },
        stream: { select: { name: true } },
      },
      orderBy: { lastWatchedAt: 'desc' },
      take: limit,
    });

    const videoEvents: ActivityEvent[] = videoRows.map((row) => ({
      id: `video_watched:${row.id}`,
      type: 'video_watched',
      timestamp: row.lastWatchedAt.toISOString(),
      lessonId: row.lessonVideo.lessonId,
      lessonTitle: row.lessonVideo.lesson?.title ?? null,
      streamId: row.streamId,
      streamName: row.stream?.name ?? null,
      videoId: row.lessonVideo.id,
      videoTitle: row.lessonVideo.title ?? null,
      watchedPercent: row.watchedPercent,
      completed: row.completedAt !== null,
    }));

    // Объединяем все источники, сортируем по timestamp DESC, берём первые limit.
    const merged = [...attendanceEvents, ...submittedEvents, ...reviewedEvents, ...videoEvents].sort(
      (a, b) => b.timestamp.localeCompare(a.timestamp),
    );

    const items = merged.slice(0, limit);

    // nextCursor = timestamp последнего элемента, если их РОВНО limit (есть ещё);
    // иначе null. Следующая страница запрашивается с before=nextCursor.
    const nextCursor = items.length === limit ? items[items.length - 1].timestamp : null;

    return { items, nextCursor };
  });
}
