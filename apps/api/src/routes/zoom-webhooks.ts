import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { prisma, Prisma } from '@platform/db';
import {
  getZoomIntegrationByWebhookId,
  verifyZoomSignature,
  buildUrlValidationResponse,
  type ZoomRecordingFile,
  type ZoomMeetingSummary,
} from '../lib/zoom.js';
import { decryptSecret, isEncryptionKeySet } from '../lib/crypto.js';
import {
  processRecordingForSession,
  processSummaryForSession,
  markRecordingPending,
} from '../lib/zoom-recording.js';
import { pullSessionAttendanceFromZoom } from '../lib/zoom-attendance.js';

// Окно допустимого расхождения времени запроса (анти-replay): 5 минут.
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

// Форма входящего события Zoom (минимально нужные поля; всё опционально —
// валидируем на границе перед использованием).
interface ZoomEventPayload {
  event?: string;
  // download_token — короткоживущий токен для скачивания файлов записи, который
  // Zoom кладёт на ВЕРХНЕМ уровне события recording.completed (рядом с event).
  download_token?: string;
  payload?: {
    plainToken?: string;
    object?: {
      id?: number | string;
      uuid?: string;
      recording_files?: ZoomRecordingFile[];
      summary_overview?: string;
      summary_details?: unknown;
      summary_title?: string;
    };
  };
  event_ts?: number;
}

// Безопасно парсит JSON из сырого буфера тела. Возвращает null при ошибке.
function parseJsonBody(raw: Buffer): ZoomEventPayload | null {
  try {
    return JSON.parse(raw.toString('utf8')) as ZoomEventPayload;
  } catch {
    return null;
  }
}

// Строит стабильный ключ идемпотентности: событие + объект + хэш сырого тела.
// Хэш тела гарантирует уникальность даже если в объекте нет стабильного id,
// и при этом одинаковый ретрай того же тела даст тот же ключ.
function buildDedupeKey(event: string, raw: Buffer): string {
  const bodyHash = createHash('sha256').update(raw).digest('hex');
  return `${event}:${bodyHash}`;
}

// Преобразует payload-резюме вебхука в форму ZoomMeetingSummary (если поля есть).
function extractSummaryFromPayload(
  obj: NonNullable<NonNullable<ZoomEventPayload['payload']>['object']>,
): ZoomMeetingSummary | null {
  if (
    obj.summary_overview === undefined &&
    obj.summary_details === undefined &&
    obj.summary_title === undefined
  ) {
    return null;
  }
  return {
    summary_title: obj.summary_title,
    summary_overview: obj.summary_overview,
    summary_details: obj.summary_details,
  };
}

// Фоновая обработка события (fire-and-forget). Сама ловит ошибки и проставляет
// ZoomWebhookEvent.status processed/failed + processedAt. Никогда не бросает.
async function processEventAsync(
  app: FastifyInstance,
  webhookEventId: string,
  event: string,
  teacherUserId: string,
  obj: NonNullable<NonNullable<ZoomEventPayload['payload']>['object']> | undefined,
  downloadToken: string | null,
): Promise<void> {
  try {
    const meetingId = obj?.id !== undefined && obj?.id !== null ? String(obj.id) : null;

    if (meetingId) {
      const session = await prisma.session.findFirst({
        where: { zoomMeetingId: meetingId },
        select: { id: true, streamId: true, zoomMeetingId: true },
      });

      if (session) {
        if (event === 'meeting.started') {
          // Созвон начался → занятие «Идёт» (live). Переводим ТОЛЬКО из 'planned':
          // не трогаем уже завершённые ('done'), отменённые ('cancelled') и
          // черновики ('draft'). updateMany с условием status='planned' идемпотентен:
          // повторный meeting.started затронет 0 строк (занятие уже 'live'), а откат
          // руками в иной статус не перебивается. ВАЖНО: фактическая доставка
          // 'meeting.started' зависит от включения этого события в подписке Zoom-
          // приложения (вне кода) — код к нему готов заранее.
          const { count } = await prisma.session.updateMany({
            where: { id: session.id, status: 'planned' },
            data: { status: 'live' },
          });
          app.log.info(
            { sessionId: session.id, meetingId, updated: count },
            'meeting.started: занятие переведено в live (из planned)',
          );
        } else if (event === 'meeting.ended') {
          // Созвон завершён, облачная запись ещё обрабатывается на стороне Zoom —
          // помечаем запись «готовится» (идемпотентно, не перетирая обработку).
          await markRecordingPending({ sessionId: session.id });

          // Забор посещаемости из Zoom Report API. Отчёт участников готов НЕ сразу
          // после meeting.ended (Zoom агрегирует минуты), поэтому здесь это
          // best-effort: ранний прогон может вернуть ok:false («отчёт ещё не
          // сформирован» / нет scope) — окончательно добирает свипер по cron
          // (sweepSessionAttendance). pullSessionAttendanceFromZoom сама не бросает
          // (возвращает ok:false при ошибке), но на всякий случай ловим и тут,
          // чтобы сбой посещаемости не повалил обработку записи/вебхука.
          try {
            await pullSessionAttendanceFromZoom(app, {
              id: session.id,
              streamId: session.streamId,
              zoomMeetingId: session.zoomMeetingId,
            });
          } catch (err) {
            app.log.error(
              { err, sessionId: session.id },
              'Ошибка забора посещаемости на meeting.ended (добёрёт свипер)',
            );
          }

          // Авто-перевод занятия в «Проведён»: созвон завершился → урок проведён.
          // Это автоматически включает выдачу ДЗ / показ записи (они завязаны на
          // status='done'). Переводим из 'planned' ИЛИ 'live' (занятие могло быть
          // в эфире, если ранее пришёл meeting.started) — не трогаем уже отменённые
          // ('cancelled'), уже завершённые ('done') и черновики ('draft').
          // updateMany с условием status IN ('planned','live') идемпотентен:
          // повторный вебхук затронет 0 строк. Откат done→planned руками (PATCH)
          // тоже не перебивается — повторный meeting.ended на ту же встречу обычно
          // не приходит, а если придёт по ретраю — дедуп вебхука его отсечёт.
          await prisma.session.updateMany({
            where: { id: session.id, status: { in: ['planned', 'live'] } },
            data: { status: 'done' },
          });
        } else if (event === 'recording.completed') {
          await processRecordingForSession({
            sessionId: session.id,
            meetingId,
            teacherUserId,
            payloadFiles: obj?.recording_files ?? null,
            downloadToken,
          });
        } else if (event === 'meeting.summary_completed') {
          await processSummaryForSession({
            sessionId: session.id,
            meetingId,
            teacherUserId,
            payloadSummary: obj ? extractSummaryFromPayload(obj) : null,
          });
        }
      }
      // Нет Session под этот meetingId — это нормально (встреча не наша): просто
      // помечаем событие обработанным ниже.
    }

    await prisma.zoomWebhookEvent.update({
      where: { id: webhookEventId },
      data: { status: 'processed', processedAt: new Date() },
    });
  } catch (err) {
    app.log.error({ err, event, webhookEventId }, 'Ошибка фоновой обработки вебхука Zoom');
    await prisma.zoomWebhookEvent
      .update({
        where: { id: webhookEventId },
        data: { status: 'failed', processedAt: new Date() },
      })
      .catch(() => {});
  }
}

export async function zoomWebhookRoutes(app: FastifyInstance) {
  // Публичный эндпоинт без JWT — ограничиваем частоту запросов по IP
  // (анти-DoS и анти-перебор webhookId). Скоуп-локально, как у auth-роутов.
  await app.register(rateLimit, {
    max: Number(process.env.ZOOM_WEBHOOK_RATE_LIMIT_MAX) || 120,
    timeWindow: '1 minute',
  });

  // СЫРОЕ ТЕЛО для HMAC. Парсер инкапсулирован в этом плагин-скоупе и НЕ влияет
  // на остальные роуты (Fastify изолирует content-type-parser по скоупу).
  // request.body здесь — Buffer (сырое тело), JSON парсим вручную.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  // POST /webhooks/zoom/:webhookId — приём вебхуков Zoom. ПУБЛИЧНЫЙ эндпоинт:
  // аутентификация — по подписи Webhook Secret Token (HMAC-SHA256), не по JWT.
  // bodyLimit: тело вебхука Zoom небольшое — ограничиваем публичный приём.
  app.post('/webhooks/zoom/:webhookId', { bodyLimit: 1024 * 1024 }, async (request, reply) => {
    const { webhookId } = request.params as { webhookId: string };

    // Сырое тело — Buffer (для подписи). На всякий случай нормализуем.
    const raw: Buffer = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(
          typeof request.body === 'string'
            ? request.body
            : JSON.stringify(request.body ?? {}),
          'utf8',
        );

    // Единый нейтральный ответ для всех случаев «не можем принять по этому
    // webhookId» (нет интеграции / не настроена / ключ шифрования отсутствует).
    // Раньше различимые 404 «не найден» и 400 «не настроен» давали оракул для
    // перебора webhookId — теперь снаружи случаи неразличимы.
    const notAcceptable = () => reply.status(404).send({ error: 'Вебхук не найден' });

    // Интеграция по webhookId.
    const integration = await getZoomIntegrationByWebhookId(webhookId);
    if (!integration) {
      return notAcceptable();
    }

    // Нечем проверить подпись — не обрабатываем (ключ шифрования / токен отсутствуют).
    if (!integration.secretTokenEnc || !isEncryptionKeySet()) {
      return notAcceptable();
    }

    let secretToken: string;
    try {
      secretToken = decryptSecret(integration.secretTokenEnc);
    } catch {
      return notAcceptable();
    }

    const body = parseJsonBody(raw);
    if (!body || typeof body.event !== 'string') {
      return reply.status(400).send({ error: 'Некорректное тело вебхука' });
    }

    const event = body.event;

    // Handshake валидации эндпоинта — без проверки подписи (Zoom его так задумал).
    if (event === 'endpoint.url_validation') {
      const plainToken = body.payload?.plainToken;
      if (typeof plainToken !== 'string') {
        return reply.status(400).send({ error: 'plainToken отсутствует' });
      }
      return reply.status(200).send(buildUrlValidationResponse(secretToken, plainToken));
    }

    // Проверка подписи (timing-safe в verifyZoomSignature).
    const signature = request.headers['x-zm-signature'];
    const timestamp = request.headers['x-zm-request-timestamp'];
    if (typeof signature !== 'string' || typeof timestamp !== 'string') {
      return reply.status(401).send({ error: 'Нет подписи' });
    }

    // Анти-replay: отбиваем слишком старый/будущий timestamp. Zoom может слать
    // timestamp в секундах (10 цифр) или миллисекундах (13 цифр) — нормализуем
    // к мс, иначе при секундах сравнение всегда вышло бы за окно (все 401).
    let ts = Number(timestamp);
    if (Number.isFinite(ts) && ts < 1e12) ts *= 1000;
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) {
      return reply.status(401).send({ error: 'Просроченная подпись' });
    }

    if (!verifyZoomSignature(secretToken, raw.toString('utf8'), timestamp, signature)) {
      return reply.status(401).send({ error: 'Неверная подпись' });
    }

    // Идемпотентность: пытаемся вставить событие; коллизия unique → уже обрабатывали.
    const dedupeKey = buildDedupeKey(event, raw);
    let webhookEventId: string;
    try {
      const created = await prisma.zoomWebhookEvent.create({
        data: { dedupeKey, event, status: 'received' },
        select: { id: true },
      });
      webhookEventId = created.id;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Уже получали это событие — отвечаем 200 без повторной обработки.
        return reply.status(200).send({ status: 'duplicate' });
      }
      throw err;
    }

    // Тяжёлую работу (скачивание/резюме) делаем асинхронно, чтобы Zoom не
    // ретраил по таймауту. Отвечаем 200 сразу.
    if (
      event === 'meeting.started' ||
      event === 'meeting.ended' ||
      event === 'recording.completed' ||
      event === 'meeting.summary_completed'
    ) {
      void processEventAsync(
        app,
        webhookEventId,
        event,
        integration.userId,
        body.payload?.object,
        body.download_token ?? null,
      );
    } else {
      // Прочие события нам не интересны — сразу помечаем обработанными.
      void prisma.zoomWebhookEvent
        .update({
          where: { id: webhookEventId },
          data: { status: 'processed', processedAt: new Date() },
        })
        .catch(() => {});
    }

    return reply.status(200).send({ status: 'accepted' });
  });
}
