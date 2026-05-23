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
} from '../lib/zoom-recording.js';

// Окно допустимого расхождения времени запроса (анти-replay): 5 минут.
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

// Форма входящего события Zoom (минимально нужные поля; всё опционально —
// валидируем на границе перед использованием).
interface ZoomEventPayload {
  event?: string;
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
): Promise<void> {
  try {
    const meetingId = obj?.id !== undefined && obj?.id !== null ? String(obj.id) : null;

    if (meetingId) {
      const session = await prisma.session.findFirst({
        where: { zoomMeetingId: meetingId },
        select: { id: true },
      });

      if (session) {
        if (event === 'recording.completed') {
          await processRecordingForSession({
            sessionId: session.id,
            meetingId,
            teacherUserId,
            payloadFiles: obj?.recording_files ?? null,
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

    // Интеграция по webhookId.
    const integration = await getZoomIntegrationByWebhookId(webhookId);
    if (!integration) {
      return reply.status(404).send({ error: 'Вебхук не найден' });
    }

    // Нечем проверить подпись — не обрабатываем (ключ шифрования / токен отсутствуют).
    if (!integration.secretTokenEnc || !isEncryptionKeySet()) {
      return reply.status(400).send({ error: 'Вебхук Zoom не настроен' });
    }

    let secretToken: string;
    try {
      secretToken = decryptSecret(integration.secretTokenEnc);
    } catch {
      return reply.status(400).send({ error: 'Вебхук Zoom не настроен' });
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
    if (event === 'recording.completed' || event === 'meeting.summary_completed') {
      void processEventAsync(app, webhookEventId, event, integration.userId, body.payload?.object);
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
