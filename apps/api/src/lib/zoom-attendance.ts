import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { canCreateMeeting, getZoomAccessToken } from './zoom.js';

// Забор посещаемости занятия из Zoom Report Participants API (B5, фаза 2).
//
// GET https://api.zoom.us/v2/report/meetings/{meetingId}/participants (Bearer).
// Отчёт готов НЕ сразу после meeting.ended (Zoom агрегирует минуты), поэтому
// триггер на вебхуке отложен/повторяем свипером (см. zoom-webhooks.ts / cron.ts).
//
// ВАЖНО про дедуп: уникальные ограничения таблицы SessionAttendance — ЧАСТИЧНЫЕ
// (только в SQL-миграции, НЕ в schema.prisma): UNIQUE(sessionId, zoomParticipantId)
// WHERE zoomParticipantId NOT NULL и UNIQUE(sessionId, userId) WHERE source='manual'.
// Prisma-upsert по составному ключу для них недоступен → дедупим вручную
// (findFirst → update/create). Синк по одной встрече последовательный, гонок нет.

const ZOOM_API_URL = 'https://api.zoom.us/v2';

// Сколько участников запрашивать за страницу (макс. у Zoom — 300).
const PAGE_SIZE = 300;

// Жёсткий предел числа страниц (анти-залипание на кривом next_page_token).
const MAX_PAGES = 50;

// Один участник из отчёта Zoom (минимально нужные поля; всё опционально —
// валидируем перед использованием). У одного участника может быть несколько
// записей (переподключения) — агрегируем по стабильному ключу.
interface ZoomReportParticipant {
  id?: string; // постоянный participant id (может быть пустым для гостей)
  user_id?: string; // id участника в рамках встречи
  name?: string;
  user_email?: string;
  join_time?: string;
  leave_time?: string;
  duration?: number; // секунды
}

interface ZoomReportResponse {
  participants?: ZoomReportParticipant[];
  next_page_token?: string;
  page_count?: number;
}

// Результат синка: либо успех (сколько записей затронули), либо мягкий отказ с
// понятной причиной (scope не выдан / нет встречи / ошибка Zoom) — НЕ бросаем.
export type AttendanceSyncResult =
  | {
      ok: true;
      participantCount: number; // сколько уникальных участников обработали
      matchedCount: number; // из них сопоставлено со студентами потока
      unmatchedCount: number; // несопоставленные гости
    }
  | { ok: false; reason: string };

// Агрегат по одному участнику (суммируем переподключения).
interface AggregatedParticipant {
  // Стабильный ключ дедупа в рамках встречи (zoomParticipantId).
  participantKey: string;
  displayName: string | null;
  email: string | null;
  joinedAt: Date | null; // самый ранний join_time
  leftAt: Date | null; // самый поздний leave_time
  durationSec: number; // сумма duration по всем сессиям участника
}

// Безопасно парсит дату из строки Zoom (ISO). Возвращает null при пустом/кривом.
function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Тянет ВСЕ страницы отчёта участников встречи и агрегирует переподключения по
// participant id. Ключ дедупа: id (постоянный) → user_id → name+email — берём
// первый непустой, чтобы не разносить переподключения одного человека по разным рядам.
async function fetchAllParticipants(
  token: string,
  meetingId: string,
): Promise<AggregatedParticipant[]> {
  const byKey = new Map<string, AggregatedParticipant>();

  let nextPageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(
      `${ZOOM_API_URL}/report/meetings/${encodeURIComponent(meetingId)}/participants`,
    );
    url.searchParams.set('page_size', String(PAGE_SIZE));
    if (nextPageToken) url.searchParams.set('next_page_token', nextPageToken);

    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      // Пробрасываем HTTP-код, чтобы вызывающий отличил «scope не выдан» (403) от
      // прочих ошибок и вернул мягкий ok:false без падения вебхука/запроса.
      const err = new ZoomReportHttpError(res.status);
      throw err;
    }

    const data = (await res.json()) as ZoomReportResponse;
    const participants = data.participants ?? [];

    for (const p of participants) {
      // Ключ дедупа: предпочитаем стабильный id; иначе user_id встречи; иначе
      // комбинацию имя+email (гость без id). Без ключа — пропускаем (нечего дедупить).
      const key =
        (p.id && p.id.trim()) ||
        (p.user_id && p.user_id.trim()) ||
        ((p.name || p.user_email) ? `anon:${p.name ?? ''}|${p.user_email ?? ''}` : '');
      if (!key) continue;

      const joinedAt = parseDate(p.join_time);
      const leftAt = parseDate(p.leave_time);
      const duration = typeof p.duration === 'number' && p.duration > 0 ? p.duration : 0;
      const name = p.name && p.name.trim() ? p.name.trim() : null;
      const email = p.user_email && p.user_email.trim() ? p.user_email.trim() : null;

      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          participantKey: key,
          displayName: name,
          email,
          joinedAt,
          leftAt,
          durationSec: duration,
        });
        continue;
      }

      // Агрегируем переподключения: min join, max leave, сумма duration.
      if (joinedAt && (!existing.joinedAt || joinedAt < existing.joinedAt)) {
        existing.joinedAt = joinedAt;
      }
      if (leftAt && (!existing.leftAt || leftAt > existing.leftAt)) {
        existing.leftAt = leftAt;
      }
      existing.durationSec += duration;
      if (!existing.displayName && name) existing.displayName = name;
      if (!existing.email && email) existing.email = email;
    }

    nextPageToken = data.next_page_token && data.next_page_token.trim()
      ? data.next_page_token.trim()
      : undefined;
    if (!nextPageToken) break;
  }

  return Array.from(byKey.values());
}

// Ошибка Zoom Report API с HTTP-кодом (для различения 403 «scope не выдан»).
class ZoomReportHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Zoom report API вернул ${status}`);
    this.status = status;
  }
}

// Человекочитаемая причина мягкого отказа по HTTP-коду Zoom.
function reasonForHttpStatus(status: number): string {
  if (status === 403) {
    return 'Нет доступа к отчёту посещаемости Zoom (scope report:read:admin ещё не выдан)';
  }
  if (status === 400) {
    return 'Zoom ещё не сформировал отчёт по встрече (попробуйте позже)';
  }
  if (status === 404) {
    return 'Встреча или отчёт не найдены в Zoom';
  }
  return `Zoom вернул ошибку отчёта посещаемости (${status})`;
}

// Идентичность хоста встречи (Zoom-аккаунт, под которым создаются встречи).
// Используется, чтобы пометить ряд хоста в посещаемости и исключить его из
// студентов-гостей. Оба поля могут быть null, если хоста опознать не удалось.
interface HostIdentity {
  hostEmail: string | null;
  hostZoomUserId: string | null;
}

// Ответ Zoom GET /users/me (минимально нужные поля).
interface ZoomMeResponse {
  id?: string;
  email?: string;
}

// Возвращает идентичность хоста для teacherUserId. Берёт из кэша в
// ZoomIntegration; если оба поля пусты — лениво дёргает GET /users/me тем же
// Bearer-токеном, что и забор отчёта, и СОХРАНЯЕТ результат в ZoomIntegration.
// Ошибку /users/me не валим: при неуспехе возвращаем { null, null } (хоста не
// опознаём — поведение как раньше).
async function resolveHostIdentity(
  app: Pick<FastifyInstance, 'log'>,
  teacherUserId: string,
  token: string,
): Promise<HostIdentity> {
  const integration = await prisma.zoomIntegration.findUnique({
    where: { userId: teacherUserId },
    select: { hostEmail: true, hostZoomUserId: true },
  });

  // Уже знаем хоста — отдаём из кэша, без сетевого запроса.
  if (integration && (integration.hostEmail || integration.hostZoomUserId)) {
    return {
      hostEmail: integration.hostEmail ?? null,
      hostZoomUserId: integration.hostZoomUserId ?? null,
    };
  }

  // Лениво опознаём владельца аккаунта (для S2S OAuth `me` — это хост встреч).
  try {
    const res = await fetch(`${ZOOM_API_URL}/users/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      app.log.warn(
        { status: res.status, teacherUserId },
        'Zoom /users/me: не удалось опознать хоста для посещаемости',
      );
      return { hostEmail: null, hostZoomUserId: null };
    }
    const me = (await res.json()) as ZoomMeResponse;
    const hostEmail = me.email && me.email.trim() ? me.email.trim() : null;
    const hostZoomUserId = me.id && me.id.trim() ? me.id.trim() : null;

    // Кэшируем идентичность (best-effort: ошибка записи не должна валить синк).
    if (hostEmail || hostZoomUserId) {
      try {
        await prisma.zoomIntegration.update({
          where: { userId: teacherUserId },
          data: { hostEmail, hostZoomUserId },
        });
      } catch (err) {
        app.log.warn(
          { err, teacherUserId },
          'Не удалось сохранить идентичность хоста Zoom в ZoomIntegration',
        );
      }
    }

    return { hostEmail, hostZoomUserId };
  } catch (err) {
    app.log.warn(
      { err, teacherUserId },
      'Ошибка запроса Zoom /users/me при определении хоста посещаемости',
    );
    return { hostEmail: null, hostZoomUserId: null };
  }
}

// Минимальное описание Session, нужное для синка.
export interface SessionForAttendance {
  id: string;
  streamId: string;
  zoomMeetingId: string | null;
}

// Определяет teacherUserId (под чьим OAuth-токеном дёргать Zoom) тем же каскадом,
// что и свипер записей: первый преподаватель урока с рабочей Zoom-интеграцией.
// Возвращает null, если рабочей интеграции нет.
async function resolveTeacherUserId(lessonId: string): Promise<string | null> {
  const teachers = await prisma.lessonTeacher.findMany({
    where: { lessonId },
    select: { userId: true },
  });
  for (const t of teachers) {
    if (await canCreateMeeting(t.userId)) return t.userId;
  }
  return null;
}

// Главная функция синка посещаемости одной встречи из Zoom.
//
// Грейсфул: при отсутствии zoomMeetingId / рабочей интеграции / scope / любой
// ошибке Zoom — НЕ бросает, а возвращает { ok:false, reason } с понятным текстом
// (для UI) и логирует. Идемпотентность: на каждого участника findFirst по
// (sessionId, zoomParticipantId) → update либо create; РУЧНЫЕ записи (source
// 'manual') синк не трогает (разные ряды: у zoom-ряда есть zoomParticipantId).
//
// teacherUserId можно передать (из роута/свипера); иначе определяется каскадом.
export async function pullSessionAttendanceFromZoom(
  app: Pick<FastifyInstance, 'log'>,
  session: SessionForAttendance,
  teacherUserIdOverride?: string | null,
): Promise<AttendanceSyncResult> {
  if (!session.zoomMeetingId) {
    return { ok: false, reason: 'нет встречи Zoom' };
  }

  // Под чьим токеном тянуть отчёт.
  let teacherUserId = teacherUserIdOverride ?? null;
  if (teacherUserId === null) {
    const lessonSession = await prisma.session.findUnique({
      where: { id: session.id },
      select: { lessonId: true },
    });
    if (lessonSession) {
      teacherUserId = await resolveTeacherUserId(lessonSession.lessonId);
    }
  }
  if (!teacherUserId) {
    return {
      ok: false,
      reason: 'Не настроена рабочая интеграция Zoom для забора посещаемости',
    };
  }

  let token: string;
  try {
    token = await getZoomAccessToken(teacherUserId);
  } catch (err) {
    app.log.error(
      { err, sessionId: session.id },
      'Не удалось получить токен Zoom для забора посещаемости',
    );
    return { ok: false, reason: 'Не удалось авторизоваться в Zoom' };
  }

  // Идентичность хоста встречи (для исключения его из студентов-гостей).
  const { hostEmail, hostZoomUserId } = await resolveHostIdentity(
    app,
    teacherUserId,
    token,
  );

  let participants: AggregatedParticipant[];
  try {
    participants = await fetchAllParticipants(token, session.zoomMeetingId);
  } catch (err) {
    if (err instanceof ZoomReportHttpError) {
      app.log.warn(
        { status: err.status, sessionId: session.id },
        'Zoom report API: отчёт посещаемости недоступен',
      );
      return { ok: false, reason: reasonForHttpStatus(err.status) };
    }
    app.log.error(
      { err, sessionId: session.id },
      'Ошибка забора посещаемости из Zoom',
    );
    return { ok: false, reason: 'Ошибка обращения к Zoom за посещаемостью' };
  }

  // Состав потока для сопоставления по email (case-insensitive). Грузим email
  // каждого зачисленного студента один раз.
  const enrollments = await prisma.streamEnrollment.findMany({
    where: { streamId: session.streamId },
    select: { user: { select: { id: true, email: true } } },
  });
  const emailToUserId = new Map<string, string>();
  for (const e of enrollments) {
    if (e.user?.email) {
      emailToUserId.set(e.user.email.trim().toLowerCase(), e.user.id);
    }
  }

  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const p of participants) {
    // Признак ряда хоста встречи (преподаватель): совпадение по email хоста ЛИБО
    // по id пользователя Zoom (запасной признак, если email скрыт в отчёте).
    const emailLc = p.email?.toLowerCase() ?? null;
    const isHost =
      (!!hostEmail && !!emailLc && emailLc === hostEmail.toLowerCase()) ||
      (!!hostZoomUserId && p.participantKey === hostZoomUserId);

    const emailUserId = p.email
      ? emailToUserId.get(p.email.toLowerCase()) ?? null
      : null;

    // Дедуп вручную по (sessionId, zoomParticipantId). Ищем СТРОГО zoom-ряд
    // (source 'zoom_report') — ручные ряды (source 'manual') синк не перезатирает.
    const existing = await prisma.sessionAttendance.findFirst({
      where: {
        sessionId: session.id,
        zoomParticipantId: p.participantKey,
        source: 'zoom_report',
      },
      select: { id: true, userId: true },
    });

    // Ряд хоста НЕ сопоставляем со студентом (даже если email вдруг совпал бы со
    // студентом) — это преподаватель, а не гость. Для обычных участников сохраняем
    // ручную привязку: если у ряда уже есть сопоставленный студент (через /match
    // или ранее по email) — пересинк его НЕ перезатирает; авто-сопоставление по
    // email применяем только к ещё не привязанным.
    const finalUserId = isHost ? null : existing?.userId ?? emailUserId;
    // Счётчики студентов-гостей: хоста не считаем ни в matched, ни в unmatched.
    if (!isHost) {
      if (finalUserId) matchedCount += 1;
      else unmatchedCount += 1;
    }

    const data = {
      userId: finalUserId,
      source: 'zoom_report',
      status: 'present',
      isHost,
      displayName: p.displayName,
      email: p.email,
      joinedAt: p.joinedAt,
      leftAt: p.leftAt,
      durationSec: p.durationSec > 0 ? p.durationSec : null,
    };

    if (existing) {
      await prisma.sessionAttendance.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.sessionAttendance.create({
        data: {
          sessionId: session.id,
          zoomParticipantId: p.participantKey,
          ...data,
        },
      });
    }
  }

  return {
    ok: true,
    participantCount: participants.length,
    matchedCount,
    unmatchedCount,
  };
}

// ── Отложенный забор + свипер (report готов не сразу) ───────────────────────
//
// Аналог записей: на meeting.ended report участников ещё не готов (Zoom считает
// минуты), поэтому забор делаем отложенно и добираем свипером по расписанию (cron).

// Окно (часы), в течение которого свипер пытается добрать посещаемость занятий
// с привязкой к Zoom-встрече, но без записей посещаемости. За окном не долбим.
const ATTENDANCE_SWEEP_WINDOW_HOURS =
  Number(process.env.ATTENDANCE_SWEEP_WINDOW_HOURS) || 24;

// Сколько занятий обрабатывать за один проход свипера.
const ATTENDANCE_SWEEP_BATCH = Number(process.env.ATTENDANCE_SWEEP_BATCH) || 20;

// Свипер посещаемости: добирает отчёты по недавно завершённым Zoom-занятиям, у
// которых ещё НЕТ ни одной zoom-записи посещаемости (отчёт «доезжает» минуты после
// meeting.ended). Берёт занятия с zoomMeetingId, updatedAt в окне последних N часов
// и без attendance source='zoom_report'. Ошибки на каждом занятии глотает (cron не
// должен падать). Возвращает число занятий, по которым успешно забрал отчёт.
export async function sweepSessionAttendance(
  app: Pick<FastifyInstance, 'log'>,
  params?: { now?: Date },
): Promise<number> {
  const now = params?.now ?? new Date();
  const windowStart = new Date(
    now.getTime() - ATTENDANCE_SWEEP_WINDOW_HOURS * 60 * 60 * 1000,
  );

  const candidates = await prisma.session.findMany({
    where: {
      zoomMeetingId: { not: null },
      updatedAt: { gte: windowStart },
      // Ещё не забирали отчёт посещаемости из Zoom для этого занятия.
      attendance: { none: { source: 'zoom_report' } },
    },
    select: { id: true, streamId: true, zoomMeetingId: true },
    orderBy: { updatedAt: 'asc' },
    take: ATTENDANCE_SWEEP_BATCH,
  });

  let synced = 0;
  for (const s of candidates) {
    try {
      const result = await pullSessionAttendanceFromZoom(app, {
        id: s.id,
        streamId: s.streamId,
        zoomMeetingId: s.zoomMeetingId,
      });
      if (result.ok) synced += 1;
    } catch (err) {
      // Глотаем: один проблемный сессион не должен валить весь проход свипера.
      app.log.error(
        { err, sessionId: s.id },
        'Ошибка забора посещаемости в свипере',
      );
    }
  }

  return synced;
}
