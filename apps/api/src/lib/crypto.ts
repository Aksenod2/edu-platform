import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Симметричное шифрование секретов (AES-256-GCM) для хранения в БД.
//
// КРИТИЧНО для прода: ключ APP_ENCRYPTION_KEY читается ЛЕНИВО — только в момент
// шифрования/расшифровки. Модуль НЕ читает env при импорте и НЕ падает на старте
// API: иначе деплой уронит весь прод-API, пока ключа нет в .env.vps. Если ключ
// не настроен, шифрующие функции бросают понятную ошибку, а вызывающий код
// (роуты Zoom) превращает её в ответ 400.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // рекомендованная длина IV для GCM
const KEY_LENGTH = 32; // 32 байта = AES-256

// Читает и валидирует ключ из env. Ожидается hex-строка из 64 символов (32 байта).
// Бросает Error, если ключ отсутствует или невалиден.
function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('APP_ENCRYPTION_KEY не настроен');
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length !== KEY_LENGTH) {
    throw new Error('APP_ENCRYPTION_KEY не настроен');
  }
  return key;
}

// Проверка наличия валидного ключа БЕЗ броска — для безопасного ветвления
// в роутах (например, чтобы вернуть encryptionKeySet в ответе GET).
export function isEncryptionKeySet(): boolean {
  const raw = process.env.APP_ENCRYPTION_KEY;
  return Boolean(raw && /^[0-9a-fA-F]{64}$/.test(raw));
}

// Шифрует строку. Формат результата: base64(iv):base64(tag):base64(ciphertext).
export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

// Расшифровывает строку формата base64(iv):base64(tag):base64(ciphertext).
export function decryptSecret(enc: string): string {
  const key = getKey();
  const parts = enc.split(':');
  if (parts.length !== 3) {
    throw new Error('Некорректный формат зашифрованного значения');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}
