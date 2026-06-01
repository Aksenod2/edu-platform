/**
 * Разовая утилита: скачивает объект из S3 (Timeweb) в локальный файл внутри
 * контейнера api. Запускается ВНУТРИ контейнера `api` (через
 * `docker compose exec -T api node - < scripts/lib/s3-get.cjs`), потому что там
 * уже есть @aws-sdk/client-s3 и переменные S3_* из .env.vps — тот же путь к
 * хранилищу, что использует само приложение (lib/s3.ts), а значит гарантированно
 * рабочий (path-style Timeweb).
 *
 * Вход (через переменные окружения):
 *   S3KEY — ключ объекта (например lesson-videos/<ts>-<uuid>.mp4)
 *   OUT   — куда сохранить (путь внутри контейнера, например /tmp/orig.mp4)
 *
 * Вывод в stdout: одна строка JSON с метаданными объекта (contentType,
 * contentLength, metadata) — её парсит вызывающий bash-скрипт. Только чтение,
 * ничего не изменяет.
 */
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const KEY = process.env.S3KEY;
const OUT = process.env.OUT;
if (!KEY || !OUT) {
  console.error('s3-get: требуются переменные S3KEY и OUT');
  process.exit(2);
}

const Bucket = process.env.S3_BUCKET;
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'ru-1',
  forcePathStyle: true, // Timeweb работает только в path-style — как в lib/s3.ts
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

(async () => {
  const head = await client.send(new HeadObjectCommand({ Bucket, Key: KEY }));
  const info = {
    contentType: head.ContentType || null,
    contentLength: head.ContentLength ?? null,
    metadata: head.Metadata || {},
  };

  const out = await client.send(new GetObjectCommand({ Bucket, Key: KEY }));
  await pipeline(out.Body, fs.createWriteStream(OUT));

  // Единственная строка stdout — машиночитаемый JSON для вызывающего скрипта.
  process.stdout.write(JSON.stringify(info) + '\n');
})().catch((err) => {
  console.error('s3-get: ошибка —', err && err.name ? err.name : err, err && err.message ? `(${err.message})` : '');
  process.exit(1);
});
