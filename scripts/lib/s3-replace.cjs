/**
 * Разовая утилита: БЕЗОПАСНО заменяет объект в S3 исправленным файлом.
 * Запускается ВНУТРИ контейнера `api` (см. s3-get.cjs — тот же резон).
 *
 * Порядок (важен для безопасности и обратимости):
 *   1. HeadObject(оригинал) → запоминаем ContentType и пользовательские метаданные
 *      (там лежит original-name — имя файла для UI).
 *   2. CopyObject(оригинал → BACKUP_KEY) — серверная копия, без перекачки;
 *      сохраняет метаданные. Это наша точка отката.
 *   3. Upload(исправленный файл IN → исходный ключ) с теми же ContentType и
 *      метаданными — ссылка на видео НЕ меняется, имя файла в UI сохраняется.
 *   4. HeadObject(оригинал) — проверяем, что новый объект реально читается и
 *      непустой.
 *
 * Вход (переменные окружения):
 *   S3KEY      — исходный ключ (перезаписываем его)
 *   BACKUP_KEY — куда сложить резервную копию оригинала
 *   IN         — путь к исправленному файлу внутри контейнера (например /tmp/fixed.mp4)
 */
const fs = require('node:fs');
const { S3Client, HeadObjectCommand, CopyObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const KEY = process.env.S3KEY;
const BACKUP_KEY = process.env.BACKUP_KEY;
const IN = process.env.IN;
if (!KEY || !BACKUP_KEY || !IN) {
  console.error('s3-replace: требуются переменные S3KEY, BACKUP_KEY и IN');
  process.exit(2);
}

const Bucket = process.env.S3_BUCKET;
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'ru-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

(async () => {
  // 1. Читаем характеристики оригинала, чтобы сохранить их на новом объекте.
  const head = await client.send(new HeadObjectCommand({ Bucket, Key: KEY }));
  const contentType = head.ContentType || 'video/mp4';
  const metadata = head.Metadata || {};

  // 2. Резервная копия оригинала (серверная, без перекачки данных).
  await client.send(
    new CopyObjectCommand({
      Bucket,
      Key: BACKUP_KEY,
      CopySource: `${Bucket}/${KEY}`,
      MetadataDirective: 'COPY',
    }),
  );
  console.error(`s3-replace: резервная копия оригинала → ${BACKUP_KEY}`);

  // 3. Заливаем исправленный файл на ИСХОДНЫЙ ключ (ссылка не меняется),
  //    сохраняя тип и метаданные (в т.ч. original-name для имени в UI).
  const upload = new Upload({
    client,
    params: {
      Bucket,
      Key: KEY,
      Body: fs.createReadStream(IN),
      ContentType: contentType,
      Metadata: metadata,
    },
    queueSize: 4,
    partSize: 16 * 1024 * 1024,
    leavePartsOnError: false,
  });
  await upload.done();

  // 4. Проверяем, что новый объект реально читается и непустой.
  const verify = await client.send(new HeadObjectCommand({ Bucket, Key: KEY }));
  if (!verify.ContentLength || verify.ContentLength <= 0) {
    throw new Error('после заливки объект пустой — что-то пошло не так');
  }
  console.error(`s3-replace: готово, новый размер ${verify.ContentLength} байт`);
  process.stdout.write(JSON.stringify({ newSize: verify.ContentLength, backupKey: BACKUP_KEY }) + '\n');
})().catch((err) => {
  console.error('s3-replace: ошибка —', err && err.name ? err.name : err, err && err.message ? `(${err.message})` : '');
  process.exit(1);
});
