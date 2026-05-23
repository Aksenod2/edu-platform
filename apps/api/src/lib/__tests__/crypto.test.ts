import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptSecret, decryptSecret, isEncryptionKeySet } from '../crypto.js';

// 64 hex-символа = 32 байта (валидный AES-256-ключ).
const VALID_KEY = '0'.repeat(64);

describe('crypto (AES-256-GCM)', () => {
  const original = process.env.APP_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = original;
  });

  it('round-trip: расшифровка возвращает исходную строку', () => {
    const plain = 'super-secret-zoom-client-secret';
    const enc = encryptSecret(plain);
    expect(enc.split(':')).toHaveLength(3); // base64(iv):base64(tag):base64(ciphertext)
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('каждое шифрование даёт разный результат (случайный IV)', () => {
    const plain = 'one-value';
    expect(encryptSecret(plain)).not.toBe(encryptSecret(plain));
  });

  it('isEncryptionKeySet=true при валидном ключе', () => {
    expect(isEncryptionKeySet()).toBe(true);
  });

  it('без ключа: isEncryptionKeySet=false, шифрование/расшифровка бросают', () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(isEncryptionKeySet()).toBe(false);
    expect(() => encryptSecret('x')).toThrow('APP_ENCRYPTION_KEY не настроен');
    expect(() => decryptSecret('a:b:c')).toThrow('APP_ENCRYPTION_KEY не настроен');
  });

  it('невалидный ключ (короткий/не hex): ключ считается ненастроенным', () => {
    process.env.APP_ENCRYPTION_KEY = 'not-hex';
    expect(isEncryptionKeySet()).toBe(false);
    expect(() => encryptSecret('x')).toThrow('APP_ENCRYPTION_KEY не настроен');
  });

  it('подделка тега/шифртекста ломает расшифровку (целостность GCM)', () => {
    const enc = encryptSecret('value');
    const [iv, tag, data] = enc.split(':');
    // Портим тег аутентификации — GCM обязан отвергнуть расшифровку.
    const badTag = Buffer.alloc(16, 0).toString('base64');
    expect(() => decryptSecret(`${iv}:${badTag}:${data}`)).toThrow();
    // Портим шифртекст — тег больше не сходится.
    const badData = Buffer.from('totally-different-bytes').toString('base64');
    expect(() => decryptSecret(`${iv}:${tag}:${badData}`)).toThrow();
  });
});
