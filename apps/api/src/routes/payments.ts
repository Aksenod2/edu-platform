import type { FastifyInstance } from 'fastify';
import { prisma, type Prisma } from '@platform/db';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { requireRole, authenticate } from '../middleware/auth.js';
import { uploadFile, getFileUrl } from '../lib/s3.js';
import { isPositiveInt, creditBalance } from '../lib/money.js';
import { settleOutstandingCharges } from '../lib/charges.js';

// Эпик «Оплата и баланс», Фаза 1.
//
// Студент пополняет баланс не сам — он переводит деньги по реквизитам (из
// PaymentSettings) и прикладывает скриншот оплаты. Заявка (TopUpRequest) уходит
// админу на проверку: тот одобряет (зачисляет реальную сумму на баланс) или
// отклоняет. Деньги — в КОПЕЙКАХ (целое). Скрин/QR — приватные файлы: ключ в
// публичные поля не кладём, отдаём только подписанным getFileUrl тому, кому положено.

const SINGLETON_ID = 'singleton';

// Допускаем строго PNG/JPEG/WebP для скрина оплаты (как и для аватаров). Проверяем
// И mime, И расширение имени файла, т.к. браузеры/ОС иногда отдают неточный mime.
const SCREENSHOT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const SCREENSHOT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

// Скрина оплаты с запасом хватает 10 МБ — меньше памяти и поверхности DoS,
// чем глобальные 50 МБ. Потолок суммы на одну операцию и длина комментария —
// защита от абсурдных значений и раздувания БД.
const SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024;
const NOTE_MAX_LEN = 1000;
const MAX_AMOUNT_KOPECKS = 100_000_000; // 1 000 000 ₽

function isScreenshotImage(fileName: string, mimeType: string): boolean {
  const lowerName = (fileName || '').toLowerCase();
  const okExt = SCREENSHOT_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const okMime = SCREENSHOT_MIME_TYPES.has((mimeType || '').toLowerCase());
  return okExt && okMime;
}

// Подписанный временный URL файла по ключу (или null). Скрин/QR — приватные.
async function fileUrlFor(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  try {
    return await getFileUrl(key);
  } catch {
    return null;
  }
}

// Сентинел-ошибка для отката транзакции с понятным HTTP-кодом 409 («уже обработана»).
class ConflictError extends Error {}

export async function paymentRoutes(app: FastifyInstance) {
  const adminOnly = requireRole('admin');

  // ─── Студент ──────────────────────────────────────────────────────────────

  // POST /topup-requests — создать заявку на пополнение (multipart: скрин оплаты).
  // Поля формы: file=скрин (обязателен), claimedAmountKopecks? (если задано —
  // положительное целое), note?. Анти-спам: одна pending-заявка на пользователя.
  app.post(
    '/topup-requests',
    {
      onRequest: authenticate,
      // Анти-DoS: ограничиваем частоту создания заявок (плюс анти-спам по pending ниже).
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const userId = request.user!.userId;

      if (!request.isMultipart()) {
        return reply.status(400).send({ error: 'Ожидается multipart/form-data' });
      }

      // Читаем части потоком (request.parts) — поля и файл приходят в любом порядке.
      // Лимит на скрин — 10 МБ; превышение → 413, в S3 ничего не пишем.
      let buffer: Buffer | null = null;
      let originalName = 'screenshot';
      let mimeType = 'application/octet-stream';
      let rawClaimed: string | undefined;
      let rawNote: string | undefined;

      try {
        for await (const part of request.parts({
          limits: { fileSize: SCREENSHOT_MAX_BYTES, files: 1, fields: 10 },
        })) {
          if (part.type === 'file') {
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) chunks.push(chunk);
            // Превышение лимита: multipart обрезает поток и ставит truncated.
            if (part.file.truncated) {
              return reply.status(413).send({ error: 'Файл слишком большой (макс. 10 МБ)' });
            }
            buffer = Buffer.concat(chunks);
            originalName = part.filename || originalName;
            mimeType = part.mimetype || mimeType;
          } else {
            const value = part.value as string;
            if (part.fieldname === 'claimedAmountKopecks') rawClaimed = value;
            else if (part.fieldname === 'note') rawNote = value;
          }
        }
      } catch (err) {
        if (err instanceof Error && /file too large|FST_REQ_FILE_TOO_LARGE/i.test(err.message)) {
          return reply.status(413).send({ error: 'Файл слишком большой (макс. 10 МБ)' });
        }
        return reply.status(400).send({ error: 'Не удалось обработать загрузку' });
      }

      if (!buffer) {
        return reply.status(400).send({ error: 'Файл не найден в запросе' });
      }

      if (!isScreenshotImage(originalName, mimeType)) {
        return reply.status(400).send({ error: 'Поддерживаются изображения PNG, JPEG и WebP' });
      }

      // claimedAmountKopecks опционально; если передано — должно быть положительным целым.
      let claimedAmountKopecks: number | null = null;
      if (rawClaimed !== undefined && rawClaimed !== '') {
        const parsed = Number(rawClaimed);
        if (!isPositiveInt(parsed) || parsed > MAX_AMOUNT_KOPECKS) {
          return reply.status(400).send({
            error:
              'Заявленная сумма должна быть положительным целым числом копеек в разумных пределах',
          });
        }
        claimedAmountKopecks = parsed;
      }

      const note =
        typeof rawNote === 'string' && rawNote.trim()
          ? rawNote.trim().slice(0, NOTE_MAX_LEN)
          : null;

      // Анти-спам: у пользователя не может быть более одной заявки на рассмотрении.
      const existingPending = await prisma.topUpRequest.findFirst({
        where: { userId, status: 'pending' },
        select: { id: true },
      });
      if (existingPending) {
        return reply.status(409).send({ error: 'У вас уже есть заявка на рассмотрении' });
      }

      let uploaded: { key: string; url: string; size: number };
      try {
        uploaded = await uploadFile(buffer, originalName, mimeType, 'topups');
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : 'Ошибка загрузки файла' });
      }

      const created = await prisma.topUpRequest.create({
        data: {
          userId,
          screenshotKey: uploaded.key,
          claimedAmountKopecks,
          note,
          status: 'pending',
        },
        select: { id: true, status: true, claimedAmountKopecks: true, createdAt: true },
      });

      // Ответ без screenshotKey (приватный ключ в публичные поля не отдаём).
      return reply.status(201).send(created);
    },
  );

  // GET /topup-requests/me — свои заявки (desc) + подписанный screenshotUrl у каждой.
  app.get('/topup-requests/me', { onRequest: authenticate }, async (request) => {
    const userId = request.user!.userId;

    const rows = await prisma.topUpRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        claimedAmountKopecks: true,
        creditedAmountKopecks: true,
        note: true,
        screenshotKey: true,
        reviewedAt: true,
        createdAt: true,
      },
    });

    const requests = await Promise.all(
      rows.map(async ({ screenshotKey, ...rest }) => ({
        ...rest,
        screenshotUrl: await fileUrlFor(screenshotKey),
      })),
    );

    return { requests };
  });

  // ─── Админ: модерация заявок ────────────────────────────────────────────────

  // GET /admin/topup-requests?status=pending|approved|rejected|all (default pending)
  app.get('/admin/topup-requests', { onRequest: adminOnly }, async (request) => {
    const query = request.query as { status?: string };
    const status = query.status ?? 'pending';
    const where: Prisma.TopUpRequestWhereInput =
      status === 'all'
        ? {}
        : status === 'approved' || status === 'rejected'
          ? { status }
          : { status: 'pending' };

    const rows = await prisma.topUpRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        claimedAmountKopecks: true,
        creditedAmountKopecks: true,
        note: true,
        screenshotKey: true,
        reviewedAt: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const requests = await Promise.all(
      rows.map(async ({ screenshotKey, ...rest }) => ({
        ...rest,
        screenshotUrl: await fileUrlFor(screenshotKey),
      })),
    );

    return { requests };
  });

  // POST /admin/topup-requests/:id/approve { amountKopecks } — одобрить и зачислить.
  // Идемпотентно: в одной транзакции переводим заявку pending→approved (updateMany
  // с фильтром по статусу — count===0 значит уже обработана → 409), зачисляем баланс
  // (creditBalance) и привязываем walletTransactionId к заявке. Повторный approve
  // не сработает (статус уже approved) — баланс не двоится.
  app.post(
    '/admin/topup-requests/:id/approve',
    { onRequest: adminOnly },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { amountKopecks?: unknown };

      if (!isPositiveInt(body.amountKopecks) || body.amountKopecks > MAX_AMOUNT_KOPECKS) {
        return reply.status(400).send({
          error: 'Сумма должна быть положительным целым числом копеек в разумных пределах',
        });
      }
      const amount = body.amountKopecks;
      const adminId = request.user!.userId;

      // Имя администратора — для атрибуции в истории операций.
      const admin = await prisma.user.findUnique({
        where: { id: adminId },
        select: { name: true },
      });

      try {
        const result = await prisma.$transaction(async (tx) => {
          // (a) Перевести заявку pending→approved атомарно. Фильтр по status:'pending'
          // защищает от гонки/повторного одобрения.
          const updated = await tx.topUpRequest.updateMany({
            where: { id, status: 'pending' },
            data: {
              status: 'approved',
              reviewedById: adminId,
              reviewedAt: new Date(),
              creditedAmountKopecks: amount,
            },
          });
          if (updated.count === 0) {
            throw new ConflictError('Заявка уже обработана');
          }

          const target = await tx.topUpRequest.findUniqueOrThrow({
            where: { id },
            select: { userId: true },
          });

          // (b) Зачислить баланс в той же транзакции.
          const credit = await creditBalance(tx, {
            userId: target.userId,
            amountKopecks: amount,
            note: 'Пополнение по заявке',
            createdBy: admin?.name ?? null,
          });

          // (c) Привязать транзакцию к заявке (walletTransactionId @unique → идемпотентность).
          await tx.topUpRequest.update({
            where: { id },
            data: { walletTransactionId: credit.transaction.id },
          });

          // (d) Авто-дозачёт долга: пополнили баланс → гасим открытые начисления студента
          // доступными средствами (частично, баланс не в минус). Идемпотентно: повторно
          // approve не пройдёт (статус уже approved), второго списания не будет.
          const settled = await settleOutstandingCharges(tx, target.userId);

          const finalRequest = await tx.topUpRequest.findUniqueOrThrow({
            where: { id },
            select: {
              id: true,
              status: true,
              claimedAmountKopecks: true,
              creditedAmountKopecks: true,
              note: true,
              reviewedAt: true,
              createdAt: true,
            },
          });

          // Баланс после авто-погашения: если что-то списали, перечитываем актуальный.
          const balanceKopecks =
            settled > 0
              ? (
                  await tx.user.findUniqueOrThrow({
                    where: { id: target.userId },
                    select: { balanceKopecks: true },
                  })
                ).balanceKopecks
              : credit.balanceKopecks;

          return {
            balanceKopecks,
            transaction: credit.transaction,
            request: finalRequest,
          };
        });

        return result;
      } catch (err) {
        if (err instanceof ConflictError) {
          return reply.status(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // POST /admin/topup-requests/:id/reject { note? } — отклонить заявку.
  // Идемпотентно: updateMany по status:'pending' → rejected; count===0 → 409.
  app.post('/admin/topup-requests/:id/reject', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { note?: unknown };
    const note =
      typeof body.note === 'string' && body.note.trim()
        ? body.note.trim().slice(0, NOTE_MAX_LEN)
        : null;
    const adminId = request.user!.userId;

    const updated = await prisma.topUpRequest.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'rejected',
        reviewedById: adminId,
        reviewedAt: new Date(),
        ...(note !== null ? { note } : {}),
      },
    });

    if (updated.count === 0) {
      return reply.status(409).send({ error: 'Заявка уже обработана' });
    }

    const finalRequest = await prisma.topUpRequest.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        status: true,
        claimedAmountKopecks: true,
        creditedAmountKopecks: true,
        note: true,
        reviewedAt: true,
        createdAt: true,
      },
    });

    return { request: finalRequest };
  });

  // ─── Возврат по начислению за группу (ledger «Оплата и баланс») ─────────────

  // POST /admin/charges/:id/refund { amountKopecks } — ручной возврат админом.
  // Возвращает деньги на баланс студента (creditBalance, kind=topup, note='Возврат',
  // привязка к начислению chargeId) и уменьшает Charge.paidKopecks на сумму возврата;
  // начисление помечается status='refunded'. Сумма — целое 0<amount<=paidKopecks.
  //
  // ИДЕМПОТЕНТНОСТЬ: списываем уплату условным updateMany по (id, status!='refunded',
  // paidKopecks>=amount) — count===0 значит уже возвращено / сумма больше уплаченной → 409/400.
  app.post('/admin/charges/:id/refund', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { amountKopecks?: unknown };

    if (!isPositiveInt(body.amountKopecks) || body.amountKopecks > MAX_AMOUNT_KOPECKS) {
      return reply.status(400).send({
        error: 'Сумма возврата должна быть положительным целым числом копеек в разумных пределах',
      });
    }
    const amount = body.amountKopecks;
    const adminId = request.user!.userId;

    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { name: true },
    });

    // Проверяем существование начисления и что сумма возврата не превышает уплаченное.
    const charge = await prisma.charge.findUnique({
      where: { id },
      select: { id: true, userId: true, paidKopecks: true, status: true },
    });
    if (!charge) {
      return reply.status(404).send({ error: 'Начисление не найдено' });
    }
    if (charge.status === 'refunded') {
      return reply.status(409).send({ error: 'Возврат уже выполнен' });
    }
    if (amount > charge.paidKopecks) {
      return reply.status(400).send({ error: 'Сумма возврата больше уплаченной' });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Атомарно уменьшаем paidKopecks и помечаем refunded — фильтр по
        // (status!='refunded', paidKopecks>=amount) защищает от гонок/повторного возврата.
        const updated = await tx.charge.updateMany({
          where: { id, status: { not: 'refunded' }, paidKopecks: { gte: amount } },
          data: { paidKopecks: { decrement: amount }, status: 'refunded' },
        });
        if (updated.count === 0) {
          throw new ConflictError('Возврат уже выполнен');
        }

        // Возвращаем деньги на баланс (привязка к начислению chargeId).
        const credit = await creditBalance(tx, {
          userId: charge.userId,
          amountKopecks: amount,
          note: 'Возврат',
          createdBy: admin?.name ?? null,
          chargeId: id,
        });

        const finalCharge = await tx.charge.findUniqueOrThrow({
          where: { id },
          select: { id: true, amountKopecks: true, paidKopecks: true, status: true },
        });

        return {
          balanceKopecks: credit.balanceKopecks,
          transaction: credit.transaction,
          charge: finalCharge,
        };
      });

      return result;
    } catch (err) {
      if (err instanceof ConflictError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });

  // ─── Настройки оплаты (реквизиты для перевода) ──────────────────────────────

  // GET /payment-settings — реквизиты для студента (ленивый upsert синглтона).
  // Без секретов: отдаём transferUrl/transferPhone/instructions + подписанный qrUrl.
  app.get('/payment-settings', { onRequest: authenticate }, async () => {
    const settings = await prisma.paymentSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID },
      update: {},
      select: {
        transferUrl: true,
        transferPhone: true,
        instructions: true,
        qrFileKey: true,
      },
    });

    return {
      transferUrl: settings.transferUrl,
      transferPhone: settings.transferPhone,
      instructions: settings.instructions,
      qrUrl: await fileUrlFor(settings.qrFileKey),
    };
  });

  // PUT /admin/payment-settings { transferUrl?, transferPhone?, instructions? }
  app.put('/admin/payment-settings', { onRequest: adminOnly }, async (request, reply) => {
    const body = request.body as {
      transferUrl?: unknown;
      transferPhone?: unknown;
      instructions?: unknown;
    };
    const adminId = request.user!.userId;

    // Нормализуем: строка/пусто → trim или null; отсутствие ключа — не трогаем.
    const norm = (v: unknown): string | null | undefined => {
      if (v === undefined) return undefined;
      if (typeof v !== 'string') return undefined;
      const t = v.trim();
      return t ? t : null;
    };
    const transferUrl = norm(body.transferUrl);
    const transferPhone = norm(body.transferPhone);
    const instructions = norm(body.instructions);

    // Ссылка на перевод рендерится как href — пускаем только http(s), чтобы
    // исключить javascript:/data: и т.п. (норм уже отбросил пустую строку → null).
    if (typeof transferUrl === 'string' && !/^https?:\/\//i.test(transferUrl)) {
      return reply.status(400).send({ error: 'Ссылка должна начинаться с http:// или https://' });
    }

    const writeFields = {
      ...(transferUrl !== undefined ? { transferUrl } : {}),
      ...(transferPhone !== undefined ? { transferPhone } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
      updatedById: adminId,
    };

    const settings = await prisma.paymentSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...writeFields },
      update: writeFields,
      select: {
        transferUrl: true,
        transferPhone: true,
        instructions: true,
        qrFileKey: true,
      },
    });

    return {
      transferUrl: settings.transferUrl,
      transferPhone: settings.transferPhone,
      instructions: settings.instructions,
      qrUrl: await fileUrlFor(settings.qrFileKey),
    };
  });

  // POST /admin/payment-settings/qr — загрузить QR-код (multipart, image/*).
  app.post('/admin/payment-settings/qr', { onRequest: adminOnly }, async (request, reply) => {
    const adminId = request.user!.userId;

    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Ожидается multipart/form-data' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'Файл не найден в запросе' });
    }

    const originalName = data.filename || 'qr';
    const mimeType = data.mimetype || 'application/octet-stream';

    if (!mimeType.toLowerCase().startsWith('image/')) {
      data.file.resume();
      return reply.status(400).send({ error: 'Поддерживаются только изображения' });
    }

    const chunks: Buffer[] = [];
    await pipeline(
      data.file,
      new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk);
          cb();
        },
      }),
    );
    if (data.file.truncated) {
      return reply.status(413).send({ error: 'Файл слишком большой' });
    }
    const buffer = Buffer.concat(chunks);

    let uploaded: { key: string; url: string; size: number };
    try {
      uploaded = await uploadFile(buffer, originalName, mimeType, 'payment');
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : 'Ошибка загрузки файла' });
    }

    await prisma.paymentSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, qrFileKey: uploaded.key, updatedById: adminId },
      update: { qrFileKey: uploaded.key, updatedById: adminId },
    });

    return reply.status(201).send({ qrUrl: await getFileUrl(uploaded.key) });
  });

  // DELETE /admin/payment-settings/qr — убрать QR-код (qrFileKey = null).
  app.delete('/admin/payment-settings/qr', { onRequest: adminOnly }, async (request) => {
    const adminId = request.user!.userId;

    await prisma.paymentSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, updatedById: adminId },
      update: { qrFileKey: null, updatedById: adminId },
    });

    return { qrUrl: null };
  });
}
