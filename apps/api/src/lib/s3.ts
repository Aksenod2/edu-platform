import { prisma } from '@platform/db';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// Лимит размера для ВИДЕО уроков (per-route, не общий multipart-лимит). Записи
// Телемоста/Zoom на десятки минут весят сотни МБ — 5 ГБ хватает с запасом.
export const VIDEO_MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

const API_BASE_URL =
  process.env.API_BASE_URL ||
  (process.env.RENDER_EXTERNAL_URL
    ? `https://${process.env.RENDER_EXTERNAL_URL}`
    : `http://localhost:${process.env.PORT || 4000}`);

// База для ФАЙЛОВЫХ ссылок — без суффикса /api-proxy. Файлы отдаются по /files
// напрямую (Caddy: handle /files/* → api), а НЕ через хрупкий /api-proxy (он на
// проде не доносит /api-proxy/files/... до обработчика → таймаут/404). На проде
// API_BASE_URL = https://губу.рф/api-proxy — для файлов срезаем хвост /api-proxy.
const FILE_BASE_URL = API_BASE_URL.replace(/\/api-proxy\/?$/, '');

// Reuse the server JWT secret to sign file download capability links.
const SIGNING_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

// Signed URL TTL: 1 hour.
const FILE_URL_TTL_SECONDS = 60 * 60;

// --- Хранилище: S3 (Timeweb, path-style), иначе фолбэк в PostgreSQL ----------
// Если заданы все S3_* переменные — новые файлы пишутся в объектное хранилище.
// Чтение всегда сперва пробует S3, затем PostgreSQL (чтобы старые файлы,
// загруженные до миграции, продолжали открываться).
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION || 'ru-1';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;

const s3Enabled = Boolean(S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY);

const s3 = s3Enabled
  ? new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      // Timeweb S3 работает только в path-style (bucket в пути, не в поддомене).
      forcePathStyle: true,
      credentials: {
        accessKeyId: S3_ACCESS_KEY as string,
        secretAccessKey: S3_SECRET_KEY as string,
      },
    })
  : null;

export function isS3Enabled(): boolean {
  return s3Enabled;
}

function computeSignature(key: string, exp: number): string {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(`${key}.${exp}`).digest('hex');
}

/**
 * Build a signed, time-limited path for a file key:
 *   /files/<key>?exp=<unixSeconds>&sig=<hex>
 * where sig = HMAC_SHA256(secret, `${key}.${exp}`).
 */
export function signFileUrl(key: string): string {
  const exp = Math.floor(Date.now() / 1000) + FILE_URL_TTL_SECONDS;
  const sig = computeSignature(key, exp);
  // Кодируем сегменты ключа ПО ОТДЕЛЬНОСТИ, сохраняя реальные слеши: путь должен
  // быть /files/lessons/<...>, а НЕ /files/lessons%2F<...>. Закодированный слеш
  // (%2F) ломает прохождение через Next /api-proxy (catch-all) на проде — запрос
  // не матчится в route-handler и улетает в API целиком → «Route not found 404».
  // Подпись (HMAC от исходного key) НЕ меняется; /files/* читает декодированный
  // путь как тот же key — обратная совместимость сохранена.
  const encodedPath = key.split('/').map(encodeURIComponent).join('/');
  return `/files/${encodedPath}?exp=${exp}&sig=${sig}`;
}

/**
 * Verify a file signature: constant-time compare and expiry check.
 */
export function verifyFileSignature(key: string, exp: string | number, sig: string): boolean {
  const expNum = typeof exp === 'number' ? exp : Number(exp);
  if (!Number.isFinite(expNum) || !sig) {
    return false;
  }

  // Reject expired links.
  if (expNum < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = computeSignature(key, expNum);
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  if (sigBuf.length !== expectedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

export async function ensureBucketExists(): Promise<void> {
  // No-op: бакет создаётся в панели Timeweb; PostgreSQL-фолбэк не требует init.
}

// Канонические расширения для известных image-mime. Нужно, чтобы ключ в S3
// соответствовал реальному типу: загруженный как «x.txt» PNG лёг с .png.
// Для неизвестных mime маппинга нет — сохраняем расширение исходного имени.
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// Возвращает расширение для ключа: по mime-типу (если он известен), иначе —
// расширение из исходного имени файла (прежнее поведение).
function extensionForKey(originalName: string, mimeType: string): string {
  const byMime = MIME_EXTENSIONS[mimeType.toLowerCase()];
  if (byMime) return byMime;
  return originalName.includes('.') ? (originalName.split('.').pop() ?? '') : '';
}

// Генерирует ключ объекта в хранилище: `<folder>/<ts>-<uuid>.<ext>`. Расширение
// берётся по mime-типу (если известен) либо из исходного имени (см.
// extensionForKey). Вынесено из uploadFile для переиспользования в uploadLargeFile.
function buildStorageKey(originalName: string, mimeType: string, folder: string): string {
  const ext = extensionForKey(originalName, mimeType);
  return `${folder}/${Date.now()}-${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;
}

export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  folder: string = 'threads',
): Promise<{ key: string; url: string; size: number }> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('Файл превышает максимальный размер 50MB');
  }

  const key = buildStorageKey(originalName, mimeType, folder);

  if (s3 && S3_BUCKET) {
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        // Имя файла храним в метаданных (percent-encoded — поддержка кириллицы).
        Metadata: { 'original-name': encodeURIComponent(originalName) },
      }),
    );
  } else {
    await prisma.fileStorage.create({
      data: {
        key,
        data: Uint8Array.from(buffer),
        mimeType,
        fileName: originalName,
        size: buffer.length,
      },
    });
  }

  return {
    key,
    url: `/files/${encodeURIComponent(key)}`,
    size: buffer.length,
  };
}

/**
 * Проверяет, что объект РЕАЛЬНО присутствует/читается в хранилище по ключу
 * (HeadObject). Защита после загрузки: если PutObject «прошёл», но объект потом
 * не читается (права на чтение префикса / недурабельная запись на стороне
 * хранилища), мы узнаём об этом СРАЗУ и не отдаём «успех», который позже
 * превращается в 404. Возвращает реальную причину (имя ошибки S3 + HTTP-код).
 * При DB-фолбэке (S3 выключен) всегда ok — там запись и чтение синхронны.
 */
export async function verifyStoredObject(
  key: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (!s3 || !S3_BUCKET) return { ok: true };
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return { ok: true };
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    return { ok: false, detail: `${e?.name ?? 'S3Error'} (HTTP ${e?.$metadata?.httpStatusCode ?? '?'})` };
  }
}

/**
 * Удаляет файл по ключу из хранилища (S3 и/или PostgreSQL-фолбэк). Применяется
 * для уборки осиротевших файлов (например, прежний QR при замене/удалении).
 *
 * Best-effort по своей природе: вызывающий, как правило, оборачивает в
 * `.catch(() => {})`, чтобы сбой удаления не валил основную операцию. Отсутствие
 * объекта (NoSuchKey/404) ошибкой не считается. Чистим оба места, потому что
 * старый файл мог лежать ещё в PostgreSQL (до миграции на S3).
 */
export async function deleteFile(key: string): Promise<void> {
  if (s3 && S3_BUCKET) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    } catch (err) {
      // Уже нет объекта — не ошибка; остальное пробрасываем.
      if (!isS3NotFound(err)) throw err;
    }
  }

  // Подчищаем PostgreSQL-фолбэк: deleteMany не бросает, если записи нет.
  await prisma.fileStorage.deleteMany({ where: { key } });
}

// Размер части multipart-загрузки (16MB) и число параллельных частей.
// Подобрано под большие файлы (записи Zoom на гигабайты): минимум сетевых
// раундтрипов при умеренном расходе памяти (queueSize × partSize ≈ 64MB).
const STREAM_PART_SIZE = 16 * 1024 * 1024; // 16MB
const STREAM_QUEUE_SIZE = 4;

/**
 * Стримовая (multipart) загрузка большого объекта в S3 БЕЗ лимита MAX_FILE_SIZE.
 * Предназначена для записей Zoom (гигабайты): тело качается потоком, не буферясь
 * в память целиком.
 *
 * Ключ задаёт вызывающий (`key`) — функция кладёт объект ровно по нему и
 * возвращает `{ key, url }` для последующего чтения через роут /files/*.
 *
 * `body` принимает Node.js Readable или web ReadableStream (например
 * `response.body` от fetch) — web-поток оборачивается в Readable.fromWeb.
 *
 * Требует настроенного S3 (фолбэк в PostgreSQL для потоковой загрузки не
 * поддерживается — большие записи в БД не место). Ошибки пробрасываются,
 * чтобы вызывающий мог пометить запись как failed.
 */
export async function uploadStream(
  body: Readable | ReadableStream,
  key: string,
  contentType: string,
): Promise<{ key: string; url: string }> {
  if (!s3 || !S3_BUCKET) {
    throw new Error('S3 не настроен: стримовая загрузка недоступна');
  }

  // Приводим web ReadableStream к Node.js Readable (fetch отдаёт web-поток).
  const nodeBody =
    body instanceof Readable
      ? body
      : Readable.fromWeb(body as unknown as NodeWebReadableStream);

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: S3_BUCKET,
      Key: key,
      Body: nodeBody,
      ContentType: contentType,
    },
    queueSize: STREAM_QUEUE_SIZE,
    partSize: STREAM_PART_SIZE,
    // Догружать остаток при ошибке части не нужно — пробрасываем ошибку наружу.
    leavePartsOnError: false,
  });

  await upload.done();

  return {
    key,
    url: `/files/${encodeURIComponent(key)}`,
  };
}

/**
 * Стримовая загрузка ЗАГРУЖАЕМОГО клиентом файла (multipart) в S3 БЕЗ лимита
 * MAX_FILE_SIZE. В отличие от uploadStream сама генерирует ключ через
 * buildStorageKey (вызывающему не нужно знать формат ключа) — для пользовательских
 * загрузок видео уроков (lesson-videos), которые могут весить гигабайты.
 *
 * Тело (`body`) качается потоком и не буферится в память целиком. При S3 грузим
 * multipart-ом через @aws-sdk/lib-storage Upload; в dev-фолбэке без S3 собираем
 * поток в буфер и пишем в PostgreSQL (как uploadFile) — для локальной разработки.
 */
export async function uploadLargeFile(
  body: Readable,
  originalName: string,
  mimeType: string,
  folder: string,
): Promise<{ key: string; url: string }> {
  const key = buildStorageKey(originalName, mimeType, folder);

  if (s3 && S3_BUCKET) {
    const upload = new Upload({
      client: s3,
      params: {
        Bucket: S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: mimeType,
        // Имя файла храним в метаданных (percent-encoded — поддержка кириллицы).
        Metadata: { 'original-name': encodeURIComponent(originalName) },
      },
      queueSize: STREAM_QUEUE_SIZE,
      partSize: STREAM_PART_SIZE,
      leavePartsOnError: false,
    });

    await upload.done();
  } else {
    // Dev-фолбэк без S3: собираем поток в буфер и пишем в PostgreSQL.
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    await prisma.fileStorage.create({
      data: {
        key,
        data: Uint8Array.from(buffer),
        mimeType,
        fileName: originalName,
        size: buffer.length,
      },
    });
  }

  return {
    key,
    url: `/files/${encodeURIComponent(key)}`,
  };
}

export async function getFileUrl(key: string): Promise<string> {
  // Returns an absolute, signed, time-limited URL. Файл отдаётся по /files на
  // FILE_BASE_URL (без /api-proxy) — этот путь Caddy шлёт прямо в API, поэтому
  // ссылка резолвится и в браузере, и из серверных интеграций (sk_-ключ).
  return `${FILE_BASE_URL}${signFileUrl(key)}`;
}

// --- Чтение файла (для роута GET /files/*) -----------------------------------

export type ReadFileResult =
  | {
      kind: 'ok';
      body: Buffer | Readable;
      contentType: string;
      fileName: string;
      contentLength: number; // длина тела ответа (всего файла или диапазона)
      totalSize: number; // полный размер объекта
      isPartial: boolean;
      start: number;
      end: number;
    }
  | { kind: 'not_found' }
  | { kind: 'range_not_satisfiable'; totalSize: number };

// Парсит заголовок Range против известного размера. Возвращает диапазон,
// null (нет/неподдерживаемый Range → отдать целиком) или 'invalid' (416).
function parseRange(
  rangeHeader: string | undefined,
  total: number,
): { start: number; end: number } | null | 'invalid' {
  if (!rangeHeader) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) return null;
  let start = m[1] === '' ? NaN : parseInt(m[1], 10);
  let end = m[2] === '' ? NaN : parseInt(m[2], 10);
  if (Number.isNaN(start) && !Number.isNaN(end)) {
    start = Math.max(total - end, 0);
    end = total - 1;
  } else {
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= total) end = total - 1;
  }
  if (start > end || start >= total) return 'invalid';
  return { start, end };
}

async function readFromPostgres(key: string, rangeHeader?: string): Promise<ReadFileResult> {
  const file = await prisma.fileStorage.findUnique({ where: { key } });
  if (!file) return { kind: 'not_found' };

  const data = Buffer.from(file.data);
  const total = data.length;
  const range = parseRange(rangeHeader, total);

  if (range === 'invalid') return { kind: 'range_not_satisfiable', totalSize: total };

  if (range) {
    const chunk = data.subarray(range.start, range.end + 1);
    return {
      kind: 'ok',
      body: chunk,
      contentType: file.mimeType,
      fileName: file.fileName,
      contentLength: chunk.length,
      totalSize: total,
      isPartial: true,
      start: range.start,
      end: range.end,
    };
  }

  return {
    kind: 'ok',
    body: data,
    contentType: file.mimeType,
    fileName: file.fileName,
    contentLength: total,
    totalSize: total,
    isPartial: false,
    start: 0,
    end: total - 1,
  };
}

function isS3NotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

function fileNameFromKey(key: string): string {
  const base = key.split('/').pop() || key;
  return base;
}

/**
 * Возвращает человекочитаемое имя файла для UI.
 *
 * Источник истины об оригинальном имени — поле `fileName` в БД (для сдач —
 * `StudentAssignment.fileName`, копия `part.filename`). Но у части записей туда
 * по ошибке/в старой схеме лёг сырой ключ хранилища (`fileUrl`) либо имя вовсе
 * не сохранилось. Чтобы в интерфейсе НИКОГДА не светился сырой ключ:
 *  - если `fileName` пустой ИЛИ совпадает с ключом ИЛИ выглядит как наш ключ
 *    (`<folder>/<ts>-<uuid>.<ext>`), берём базовое имя из ключа и срезаем
 *    служебный префикс `<timestamp>-<uuid>-`, оставляя расширение;
 *  - иначе возвращаем сохранённое имя как есть.
 *
 * Для НОВЫХ загрузок `fileName` всегда корректен (см. submit-хендлер), поэтому
 * этот хелпер — защитный фолбэк для старых/битых записей, а не основной путь.
 */
export function displayFileName(
  fileName: string | null | undefined,
  fileUrl: string | null | undefined,
): string | null {
  const key = fileUrl ?? '';
  const name = fileName?.trim() ?? '';

  // Похоже ли значение на сырой ключ хранилища: содержит наш префикс-папку со
  // слешем и сегмент `<ts>-<uuid>` (uuid v4), либо буквально равно ключу.
  const looksLikeKey = (value: string): boolean => {
    if (!value) return false;
    if (key && value === key) return true;
    return /(^|\/)\d{10,}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
      value,
    );
  };

  if (name && !looksLikeKey(name)) return name;

  // Фолбэк из ключа: базовое имя без папки и без служебного префикса
  // `<timestamp>-<uuid>-`. Если после среза ничего не осталось — отдаём базовое
  // имя ключа целиком, чтобы не вернуть пустую строку.
  if (!key) return name || null;
  const base = fileNameFromKey(key);
  const stripped = base.replace(
    /^\d{10,}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-?/i,
    '',
  );
  return stripped || base || null;
}

async function readFromS3(key: string, rangeHeader?: string): Promise<ReadFileResult | null> {
  if (!s3 || !S3_BUCKET) return null;
  try {
    const out = await s3.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      }),
    );

    const metaName = out.Metadata?.['original-name'];
    const fileName = metaName ? decodeURIComponent(metaName) : fileNameFromKey(key);
    const contentType = out.ContentType || 'application/octet-stream';
    const body = out.Body as unknown as Readable;
    const contentLength = out.ContentLength ?? 0;

    // ContentRange вида "bytes start-end/total" присутствует при частичном ответе.
    if (out.ContentRange) {
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(out.ContentRange);
      const start = m ? parseInt(m[1], 10) : 0;
      const end = m ? parseInt(m[2], 10) : contentLength - 1;
      const total = m ? parseInt(m[3], 10) : contentLength;
      return {
        kind: 'ok',
        body,
        contentType,
        fileName,
        contentLength,
        totalSize: total,
        isPartial: true,
        start,
        end,
      };
    }

    return {
      kind: 'ok',
      body,
      contentType,
      fileName,
      contentLength,
      totalSize: contentLength,
      isPartial: false,
      start: 0,
      end: Math.max(contentLength - 1, 0),
    };
  } catch (err) {
    if (isS3NotFound(err)) return null; // нет в S3 → попробуем PostgreSQL
    if ((err as { name?: string }).name === 'InvalidRange') {
      return { kind: 'range_not_satisfiable', totalSize: 0 };
    }
    throw err;
  }
}

/**
 * Читает файл по ключу для отдачи через роут /files/*. Сначала пробует S3
 * (если настроен), затем PostgreSQL — чтобы файлы, загруженные до миграции,
 * продолжали открываться. Поддерживает HTTP Range.
 */
export async function readFile(key: string, rangeHeader?: string): Promise<ReadFileResult> {
  if (s3Enabled) {
    const fromS3 = await readFromS3(key, rangeHeader);
    if (fromS3) return fromS3;
  }
  return readFromPostgres(key, rangeHeader);
}

/**
 * Читает файл целиком как текст (UTF-8) — для inline-отдачи в JSON (напр. текст
 * транскрипта), чтобы интеграции не зависели от достижимости файлового URL.
 * Возвращает null, если объекта нет. Тело S3 приходит потоком — собираем целиком.
 */
export async function readFileText(key: string): Promise<string | null> {
  const result = await readFile(key);
  if (result.kind !== 'ok') return null;
  if (Buffer.isBuffer(result.body)) return result.body.toString('utf8');
  const chunks: Buffer[] = [];
  for await (const chunk of result.body as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export { MAX_FILE_SIZE };
