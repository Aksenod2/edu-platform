import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';
import {
  createZoomMeeting,
  shouldAutoCreate,
  canCreateMeeting,
  deleteZoomMeeting,
} from '../lib/zoom.js';
import {
  processRecordingForSession,
  processSummaryForSession,
  processTranscriptForSession,
  type ProcessOutcome,
} from '../lib/zoom-recording.js';
import { getFileUrl, readFileText } from '../lib/s3.js';

// ─── Встречи 1-на-1 (эпик «Встречи 1-на-1», #154) ───────────────────────────
//
// Meeting — лёгкая отдельная сущность (НЕ Session): преподаватель (teacherId) +
// студент (studentId) + дата/время + опц. тема. Zoom/запись/итоги/транскрипт-поля
// зеркалят Session — обработка идёт общими обработчиками (lib/zoom-recording.ts с
// kind='meeting') и вебхуком (zoom-webhooks.ts fallback).
//
// ИЗОЛЯЦИЯ two-party (паттерн #135): встречу видят ТОЛЬКО её teacher и student.
// Все чтения сужены WHERE-фильтром; студенту отдаётся УРЕЗАННАЯ проекция (без
// recordingError и без полей транскрипта).

// ── Helpers ──────────────────────────────────────────────────────────────────

// Подписанный временный URL записи встречи по videoKey (или null). Зеркало
// videoFileUrlFor из lessons.ts: если videoKey пуст — запись в S3 не выгружена
// (есть только внешняя ссылка videoUrl). Ошибки подписания гасим в null.
async function recordingFileUrlFor(videoKey: string | null | undefined): Promise<string | null> {
  if (!videoKey) return null;
  try {
    return await getFileUrl(videoKey);
  } catch {
    return null;
  }
}

// Строит ISO-строку начала встречи для Zoom из даты (YYYY-MM-DD) и времени HH:MM.
// Без времени — null (Zoom создаст встречу без явного старта). Зеркало
// buildZoomStartTime из lessons.ts (та же форма даты у Session/Meeting).
function buildZoomStartTime(date: Date, startTime: string | null | undefined): string | null {
  if (!startTime || !startTime.trim()) return null;
  const datePart = date.toISOString().slice(0, 10);
  const time = startTime.trim().slice(0, 5); // HH:MM
  return `${datePart}T${time}:00`;
}

// Best-effort создание Zoom-встречи под аккаунтом преподавателя. Возвращает
// { joinUrl, meetingId } либо null, если интеграции нет / создание не требуется.
// УСТОЙЧИВОСТЬ: любые ошибки Zoom гасятся (warn в лог, null) — создание встречи
// 1-на-1 не должно падать из-за интеграции (зеркало maybeCreateMeetingUrl из lessons).
async function maybeCreateZoomForMeeting(
  app: FastifyInstance,
  userId: string,
  opts: { date: Date | null; startTime: string | null | undefined; topic: string },
): Promise<{ joinUrl: string; meetingId: string } | null> {
  if (!opts.date) return null;
  try {
    // Достаточно технических предусловий интеграции ИЛИ включённого тумблера
    // авто-создания — встречу 1-на-1 создаём при любой рабочей интеграции.
    const ok = (await canCreateMeeting(userId)) || (await shouldAutoCreate(userId));
    if (!ok) return null;
    const { joinUrl, meetingId } = await createZoomMeeting(userId, {
      topic: opts.topic,
      startTime: buildZoomStartTime(opts.date, opts.startTime),
      durationMinutes: 60,
    });
    return { joinUrl, meetingId };
  } catch (err) {
    app.log.warn({ err, userId }, 'Не удалось создать встречу Zoom 1-на-1 — продолжаем без ссылки');
    return null;
  }
}

// Допустимые статусы встречи (зеркало enum MeetingStatus в schema.prisma).
const MEETING_STATUSES = ['planned', 'live', 'done', 'cancelled'] as const;
type MeetingStatusValue = (typeof MEETING_STATUSES)[number];

function isMeetingStatus(value: unknown): value is MeetingStatusValue {
  return typeof value === 'string' && (MEETING_STATUSES as readonly string[]).includes(value);
}

// Разрешённые переходы статуса встречи 1-на-1 (зеркало логики занятия:
// session-status-control «Провести» гонит planned/live→done). Принцип:
//   - planned → live | done | cancelled (запланировали → идёт / провели / отменили);
//   - live    → done | cancelled        (идёт → провели / отменили);
//   - done / cancelled — ТЕРМИНАЛЬНЫ (обратных переходов нет).
// Обратные переходы (done→planned, cancelled→planned) НЕ разрешаем осознанно (#170):
// отмена удаляет Zoom-созвон (PATCH /cancel → deleteZoomMeeting), поэтому переоткрытие
// оставило бы мёртвый zoomMeetingId/meetingUrl; откат «провели» спрятал бы уже
// подтянутую запись. Требования «распровести/переоткрыть» нет — нужна новая встреча.
// Переход в тот же статус — допускаем (идемпотентно). Прочие — 409 как нелогичные.
const MEETING_STATUS_TRANSITIONS: Record<MeetingStatusValue, readonly MeetingStatusValue[]> = {
  planned: ['live', 'done', 'cancelled'],
  live: ['done', 'cancelled'],
  done: [],
  cancelled: [],
};

function canTransitionMeeting(from: string, to: MeetingStatusValue): boolean {
  if (from === to) return true; // идемпотентно
  const allowed = MEETING_STATUS_TRANSITIONS[from as MeetingStatusValue];
  return !!allowed && allowed.includes(to);
}

// Поля Meeting, нужные для ПОЛНОЙ проекции (админ/преподаватель). Транскрипт-ключи
// тут НЕ селектим — тело отдаётся отдельным эндпоинтом GET /meetings/:id/transcript.
const meetingSelect = {
  id: true,
  teacherId: true,
  studentId: true,
  title: true,
  status: true,
  date: true,
  startTime: true,
  meetingUrl: true,
  videoUrl: true,
  videoKey: true,
  zoomMeetingId: true,
  recordingStatus: true,
  recordingError: true,
  summary: true,
  summarySource: true,
  summaryStatus: true,
  transcriptStatus: true,
  transcriptError: true,
  transcriptRequestedAt: true,
  recordingRequestedAt: true,
  summaryRequestedAt: true,
  createdAt: true,
  updatedAt: true,
  teacher: { select: { id: true, name: true } },
  student: { select: { id: true, name: true } },
} as const;

type MeetingRow = {
  id: string;
  teacherId: string;
  studentId: string;
  title: string | null;
  status: string;
  date: Date | null;
  startTime: string | null;
  meetingUrl: string | null;
  videoUrl: string | null;
  videoKey: string | null;
  zoomMeetingId: string | null;
  recordingStatus: string | null;
  recordingError: string | null;
  summary: string | null;
  summarySource: string | null;
  summaryStatus: string | null;
  transcriptStatus: string | null;
  transcriptError: string | null;
  transcriptRequestedAt: Date | null;
  recordingRequestedAt: Date | null;
  summaryRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  teacher: { id: string; name: string };
  student: { id: string; name: string };
};

// Проекция встречи в API. forStudent=true → УРЕЗАННАЯ форма: БЕЗ recordingError и
// БЕЗ полей транскрипта (transcriptStatus/transcriptError/transcriptRequestedAt) —
// эти ключи ОТСУТСТВУЮТ в объекте (исключены, а не занулены). summary отдаётся
// обоим (итоги встречи полезны студенту). Запись (videoUrl/videoKey/статус +
// подписанный recordingFileUrl) — обоим.
//
// ASYNC: подписание S3-URL записи (recordingFileUrl) — await, поэтому проекция
// асинхронная. Зеркало lessons.ts (recordingFileUrl по Session.videoKey).
async function projectMeeting(m: MeetingRow, forStudent: boolean) {
  // Подписанный временный URL записи (приоритетно для плеера); внешний videoUrl —
  // фолбэк на фронте. Если videoKey пуст → null.
  const recordingFileUrl = await recordingFileUrlFor(m.videoKey);
  const base = {
    id: m.id,
    teacherId: m.teacherId,
    studentId: m.studentId,
    title: m.title,
    status: m.status,
    date: m.date ? m.date.toISOString().slice(0, 10) : null,
    startTime: m.startTime,
    meetingUrl: m.meetingUrl,
    videoUrl: m.videoUrl,
    videoKey: m.videoKey,
    recordingFileUrl,
    recordingStatus: m.recordingStatus,
    recordingRequestedAt: m.recordingRequestedAt
      ? m.recordingRequestedAt.toISOString()
      : null,
    summary: m.summary,
    summarySource: m.summarySource,
    summaryStatus: m.summaryStatus,
    summaryRequestedAt: m.summaryRequestedAt ? m.summaryRequestedAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    teacher: m.teacher,
    student: m.student,
  };

  if (forStudent) {
    // Студенту НЕ отдаём recordingError и поля транскрипта (внутренняя
    // диагностика/дословная расшифровка — только преподавателю/админу).
    return base;
  }

  return {
    ...base,
    recordingError: m.recordingError,
    transcriptStatus: m.transcriptStatus,
    transcriptError: m.transcriptError,
    transcriptRequestedAt: m.transcriptRequestedAt
      ? m.transcriptRequestedAt.toISOString()
      : null,
  };
}

export async function meetingRoutes(app: FastifyInstance) {
  const adminOnly = requireRole('admin');

  // POST /meetings — создать встречу 1-на-1 (admin). teacherId = текущий админ.
  // Body: { studentId, date, startTime?, title? }. Best-effort Zoom-встреча.
  app.post('/meetings', { onRequest: adminOnly }, async (request, reply) => {
    const body = (request.body ?? {}) as {
      studentId?: unknown;
      date?: unknown;
      startTime?: unknown;
      title?: unknown;
    };

    // Валидация входа на границе.
    const studentId = typeof body.studentId === 'string' ? body.studentId.trim() : '';
    if (!studentId) {
      return reply.status(400).send({ error: 'Не указан студент (studentId)' });
    }

    const dateStr = typeof body.date === 'string' ? body.date.trim() : '';
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return reply.status(400).send({ error: 'Некорректная дата (ожидается YYYY-MM-DD)' });
    }
    const date = new Date(`${dateStr}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      return reply.status(400).send({ error: 'Некорректная дата' });
    }

    let startTime: string | null = null;
    if (body.startTime !== undefined && body.startTime !== null && body.startTime !== '') {
      if (typeof body.startTime !== 'string' || !/^\d{2}:\d{2}$/.test(body.startTime.trim())) {
        return reply.status(400).send({ error: 'Некорректное время (ожидается HH:MM)' });
      }
      startTime = body.startTime.trim();
    }

    let title: string | null = null;
    if (body.title !== undefined && body.title !== null) {
      if (typeof body.title !== 'string') {
        return reply.status(400).send({ error: 'Некорректная тема' });
      }
      const trimmed = body.title.trim();
      title = trimmed === '' ? null : trimmed.slice(0, 500);
    }

    // Студент должен существовать и быть студентом (не админом/удалённым).
    const student = await prisma.user.findFirst({
      where: { id: studentId, role: 'student', deletedAt: null },
      select: { id: true, name: true },
    });
    if (!student) {
      return reply.status(404).send({ error: 'Студент не найден' });
    }

    const teacherId = request.user!.userId;

    // Best-effort Zoom-встреча — не валит создание при отсутствии интеграции.
    const topic = title ?? `Встреча 1-на-1 с ${student.name}`;
    const zoom = await maybeCreateZoomForMeeting(app, teacherId, { date, startTime, topic });

    const created = await prisma.meeting.create({
      data: {
        teacherId,
        studentId: student.id,
        title,
        date,
        startTime,
        meetingUrl: zoom?.joinUrl ?? null,
        zoomMeetingId: zoom?.meetingId ?? null,
      },
      select: meetingSelect,
    });

    return reply.status(201).send(await projectMeeting(created as MeetingRow, false));
  });

  // GET /meetings — список встреч с ИЗОЛЯЦИЕЙ: admin видит свои (teacherId=me),
  // student — свои (studentId=me). WHERE-фильтр на уровне SQL.
  app.get('/meetings', { onRequest: authenticate }, async (request) => {
    const { userId, role } = request.user!;
    const where =
      role === 'admin' ? { teacherId: userId } : { studentId: userId };

    const meetings = await prisma.meeting.findMany({
      where,
      select: meetingSelect,
      orderBy: [{ date: 'desc' }, { startTime: 'desc' }, { createdAt: 'desc' }],
    });

    const forStudent = role !== 'admin';
    return {
      meetings: await Promise.all(
        meetings.map((m) => projectMeeting(m as MeetingRow, forStudent)),
      ),
    };
  });

  // GET /meetings/:id — деталь встречи. Проверка участия (teacher ИЛИ student),
  // иначе 404 (не раскрываем существование чужой встречи). Студенту — урезанная
  // проекция.
  app.get('/meetings/:id', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId, role } = request.user!;

    const meeting = await prisma.meeting.findUnique({
      where: { id },
      select: meetingSelect,
    });

    // Участие: teacher ИЛИ student встречи. Чужому (в т.ч. другому админу) — 404.
    const isParticipant =
      meeting && (meeting.teacherId === userId || meeting.studentId === userId);
    if (!meeting || !isParticipant) {
      return reply.status(404).send({ error: 'Встреча не найдена' });
    }

    const forStudent = role !== 'admin' || meeting.teacherId !== userId;
    return await projectMeeting(meeting as MeetingRow, forStudent);
  });

  // PATCH /meetings/:id/cancel — отмена встречи (admin, только своей: teacherId=me).
  // status=cancelled + best-effort удаление Zoom-встречи.
  app.patch('/meetings/:id/cancel', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const teacherId = request.user!.userId;

    const meeting = await prisma.meeting.findUnique({
      where: { id },
      select: { id: true, teacherId: true, status: true, zoomMeetingId: true },
    });
    // Чужую (или несуществующую) встречу не раскрываем — 404.
    if (!meeting || meeting.teacherId !== teacherId) {
      return reply.status(404).send({ error: 'Встреча не найдена' });
    }

    // Best-effort удаление Zoom-встречи (не валит отмену при ошибке интеграции).
    if (meeting.zoomMeetingId) {
      try {
        await deleteZoomMeeting(teacherId, meeting.zoomMeetingId);
      } catch (err) {
        app.log.warn(
          { err, meetingId: id },
          'Не удалось удалить встречу Zoom при отмене — продолжаем',
        );
      }
    }

    const updated = await prisma.meeting.update({
      where: { id },
      data: { status: 'cancelled' },
      select: meetingSelect,
    });

    return await projectMeeting(updated as MeetingRow, false);
  });

  // GET /meetings/:id/transcript?format=vtt|txt — тело транскрипта встречи.
  // ТОЛЬКО админ-преподаватель встречи (teacherId=me). Студенту — 404 (как и чужому).
  // Зеркало lessons-транскрипт-роута: подписанный временный S3-URL (или inline-текст).
  app.get('/meetings/:id/transcript', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { format, inline } = request.query as { format?: string; inline?: string };
    const fmt = format === 'vtt' ? 'vtt' : 'txt';
    const wantInline = inline === 'true' || inline === '1';
    const teacherId = request.user!.userId;

    const meeting = await prisma.meeting.findUnique({
      where: { id },
      select: {
        id: true,
        teacherId: true,
        transcriptStatus: true,
        transcriptVttKey: true,
        transcriptTxtKey: true,
      },
    });
    // Только преподаватель встречи; чужую/несуществующую — 404.
    if (!meeting || meeting.teacherId !== teacherId) {
      return reply.status(404).send({ error: 'Встреча не найдена' });
    }

    const key = fmt === 'vtt' ? meeting.transcriptVttKey : meeting.transcriptTxtKey;
    if (!key) {
      return reply
        .status(404)
        .send({ error: 'Транскрипт недоступен', status: meeting.transcriptStatus ?? null });
    }

    if (wantInline) {
      const text = await readFileText(key);
      if (text === null) {
        return reply
          .status(404)
          .send({
            error: 'Транскрипт недоступен в хранилище',
            status: meeting.transcriptStatus ?? null,
          });
      }
      return { format: fmt, status: meeting.transcriptStatus ?? null, text };
    }

    const url = await getFileUrl(key);
    return { format: fmt, url, status: meeting.transcriptStatus ?? null };
  });

  // PATCH /meetings/:id/status — смена статуса встречи 1-на-1 (admin, только своей:
  // teacherId=me). Зеркало смены Session.status у занятия (PATCH /lessons/:id +
  // session-status-control «Провести»: planned/live→done). Студент статус НЕ меняет
  // (роут admin-only). Допустимые переходы — см. MEETING_STATUS_TRANSITIONS.
  // Body: { status: 'planned'|'live'|'done'|'cancelled' } → { meeting }.
  //
  // ВАЖНО: авто-переходы (live на meeting.started, done на meeting.ended) делает
  // вебхук Zoom — это РУЧНОЙ контрол на случай отсутствия Zoom / расхождения. Забор
  // записи тут НЕ дёргаем (ручной добор — отдельный POST /refresh): на meeting.ended
  // вебхук уже пометил запись/итоги/транскрипт «готовится» и инициирует забор; этот
  // роут лишь меняет статус.
  app.patch('/meetings/:id/status', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const teacherId = request.user!.userId;
    const body = (request.body ?? {}) as { status?: unknown };

    if (!isMeetingStatus(body.status)) {
      return reply.status(400).send({
        error: 'Недопустимый статус (planned|live|done|cancelled)',
      });
    }
    const nextStatus = body.status;

    const meeting = await prisma.meeting.findUnique({
      where: { id },
      select: { id: true, teacherId: true, status: true },
    });
    // Чужую/несуществующую встречу не раскрываем — 404.
    if (!meeting || meeting.teacherId !== teacherId) {
      return reply.status(404).send({ error: 'Встреча не найдена' });
    }

    if (!canTransitionMeeting(meeting.status, nextStatus)) {
      return reply.status(409).send({
        error: `Недопустимый переход статуса: ${meeting.status} → ${nextStatus}`,
      });
    }

    const updated = await prisma.meeting.update({
      where: { id },
      data: { status: nextStatus },
      select: meetingSelect,
    });

    return { meeting: await projectMeeting(updated as MeetingRow, false) };
  });

  // POST /meetings/:id/refresh — ручная подтяжка из Zoom («Обновить из Zoom»):
  // запись + итоги + транскрипт. Право: admin-преподаватель встречи (teacherId=me).
  // Зеркало POST /lessons/:id/sessions/:streamId/refresh, но без посещаемости (для
  // 1-на-1 её не забираем). teacherUserId — владелец встречи (Meeting.teacherId), под
  // его OAuth-токеном Zoom скачиваются файлы (в отличие от Session, у Meeting реальный
  // владелец хранится в БД, каскад resolveTeacherForZoom не нужен).
  //
  // Требует zoomMeetingId (без него нет id для API Zoom) — иначе 400. Каждый шаг
  // best-effort (ошибка одного не валит остальные); по итогу возвращаем ОБНОВЛЁННУЮ
  // проекцию { meeting } (статусы полей в ней отражают исход подтяжки).
  app.post('/meetings/:id/refresh', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const teacherId = request.user!.userId;

    const meeting = await prisma.meeting.findUnique({
      where: { id },
      select: { id: true, teacherId: true, zoomMeetingId: true, zoomMeetingUuid: true },
    });
    // Чужую/несуществующую встречу не раскрываем — 404.
    if (!meeting || meeting.teacherId !== teacherId) {
      return reply.status(404).send({ error: 'Встреча не найдена' });
    }

    if (!meeting.zoomMeetingId) {
      return reply.status(400).send({ error: 'Zoom-встреча не создана' });
    }
    const meetingId = meeting.zoomMeetingId;

    // Шаг best-effort: запускает работу, ошибку/«формируется» гасит (refresh не должен
    // падать целиком из-за одного источника). Исход не возвращаем наружу — финальная
    // проекция и так несёт актуальные статусы полей. Ошибку лишь логируем.
    const step = async (fn: () => Promise<ProcessOutcome>, what: string) => {
      try {
        await fn();
      } catch (err) {
        app.log.error({ err, meetingId: meeting.id }, `refresh встречи: ${what}`);
      }
    };

    // Параллельно — шаги независимы (разные поля Meeting). kind='meeting' переключает
    // общие обработчики на Prisma-делегат Meeting.
    await Promise.all([
      step(
        () =>
          processRecordingForSession({
            sessionId: meeting.id,
            meetingId,
            teacherUserId: teacherId,
            kind: 'meeting',
          }),
        'не удалось обновить запись',
      ),
      step(
        () =>
          processSummaryForSession({
            sessionId: meeting.id,
            meetingId,
            teacherUserId: teacherId,
            meetingUuid: meeting.zoomMeetingUuid,
            kind: 'meeting',
          }),
        'не удалось обновить итоги',
      ),
      step(
        () =>
          processTranscriptForSession({
            sessionId: meeting.id,
            meetingId,
            teacherUserId: teacherId,
            kind: 'meeting',
          }),
        'не удалось обновить транскрипт',
      ),
    ]);

    // Перечитываем встречу — отдаём актуальную проекцию (статусы полей обновлены).
    const updated = await prisma.meeting.findUnique({ where: { id }, select: meetingSelect });
    if (!updated) {
      return reply.status(404).send({ error: 'Встреча не найдена' });
    }
    return { meeting: await projectMeeting(updated as MeetingRow, false) };
  });

  // POST /meetings/:id/recording/retry — повторная попытка забора записи Zoom
  // (admin-преподаватель встречи, teacherId=me). Зеркало
  // POST /lessons/:id/sessions/:streamId/recording/retry. Идемпотентность встроена в
  // processRecordingForSession (claim не пустит двойное скачивание). Требует
  // zoomMeetingId — иначе 400. Запуск fire-and-forget (тяжёлое скачивание не держим в
  // запросе); возвращаем ОБНОВЛЁННУЮ проекцию { meeting } (claim уже мог перевести
  // failed→processing).
  app.post(
    '/meetings/:id/recording/retry',
    { onRequest: adminOnly },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const teacherId = request.user!.userId;

      const meeting = await prisma.meeting.findUnique({
        where: { id },
        select: { id: true, teacherId: true, zoomMeetingId: true },
      });
      // Чужую/несуществующую встречу не раскрываем — 404.
      if (!meeting || meeting.teacherId !== teacherId) {
        return reply.status(404).send({ error: 'Встреча не найдена' });
      }

      if (!meeting.zoomMeetingId) {
        return reply.status(400).send({ error: 'Zoom-встреча не создана' });
      }

      // fire-and-forget: повтор скачивания/заливки в фоне (как у занятия). Под
      // OAuth-токеном владельца встречи (Meeting.teacherId), kind='meeting'.
      void processRecordingForSession({
        sessionId: meeting.id,
        meetingId: meeting.zoomMeetingId,
        teacherUserId: teacherId,
        kind: 'meeting',
      }).catch((err) => {
        app.log.error(
          { err, meetingId: meeting.id },
          'Ошибка ручного ретрая записи Zoom (1-на-1)',
        );
      });

      // Перечитываем — claim в processRecordingForSession уже мог перевести статус.
      const updated = await prisma.meeting.findUnique({ where: { id }, select: meetingSelect });
      if (!updated) {
        return reply.status(404).send({ error: 'Встреча не найдена' });
      }
      return { meeting: await projectMeeting(updated as MeetingRow, false) };
    },
  );
}
