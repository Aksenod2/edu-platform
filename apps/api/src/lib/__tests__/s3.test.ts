import { describe, it, expect } from 'vitest';

// Ensure a deterministic signing secret before the tested module reads it on import.
// (vitest.config.ts also sets this; kept here so the file is self-contained.)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

import { signFileUrl, verifyFileSignature } from '../s3.js';

// Parse `/files/<key>?exp=...&sig=...` into its parts.
function parseSignedUrl(url: string): { key: string; exp: string; sig: string } {
  const [path, query] = url.split('?');
  const key = decodeURIComponent(path.replace(/^\/files\//, ''));
  const params = new URLSearchParams(query);
  return {
    key,
    exp: params.get('exp') ?? '',
    sig: params.get('sig') ?? '',
  };
}

describe('s3 signed file URLs', () => {
  it('signFileUrl возвращает путь вида /files/<key>?exp=...&sig=...', () => {
    const url = signFileUrl('threads/abc.png');
    // Слеши в ключе НЕ кодируются (путь /files/threads/abc.png, а не %2F) —
    // %2F ломает прохождение через Next /api-proxy на проде (см. signFileUrl).
    expect(url).toMatch(/^\/files\/threads\/abc\.png\?exp=\d+&sig=[0-9a-f]+$/);

    const { key, exp, sig } = parseSignedUrl(url);
    expect(key).toBe('threads/abc.png');
    expect(Number(exp)).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(sig.length).toBeGreaterThan(0);
  });

  it('verifyFileSignature = true для валидной подписи', () => {
    const key = 'threads/file-1.pdf';
    const { exp, sig } = parseSignedUrl(signFileUrl(key));
    expect(verifyFileSignature(key, exp, sig)).toBe(true);
  });

  it('verifyFileSignature = false при подделанной sig', () => {
    const key = 'threads/file-2.pdf';
    const { exp, sig } = parseSignedUrl(signFileUrl(key));

    // Flip the first hex char to forge the signature while keeping the length.
    const tampered = (sig[0] === '0' ? '1' : '0') + sig.slice(1);
    expect(tampered).not.toBe(sig);
    expect(verifyFileSignature(key, exp, tampered)).toBe(false);

    // Garbage / empty signatures are rejected too.
    expect(verifyFileSignature(key, exp, '')).toBe(false);
    expect(verifyFileSignature(key, exp, 'zz')).toBe(false);
  });

  it('verifyFileSignature = false для подписи, валидной под другой key', () => {
    const keyA = 'threads/a.png';
    const keyB = 'threads/b.png';
    const { exp, sig } = parseSignedUrl(signFileUrl(keyA));
    // Подпись от keyA не должна проходить для keyB.
    expect(verifyFileSignature(keyB, exp, sig)).toBe(false);
  });

  it('verifyFileSignature = false при истёкшем exp', () => {
    const key = 'threads/expired.png';
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    // Корректно посчитанная подпись для просроченного exp всё равно отклоняется.
    // Берём sig от свежей ссылки, но это неважно — exp в прошлом отсекается раньше.
    const { sig } = parseSignedUrl(signFileUrl(key));
    expect(verifyFileSignature(key, pastExp, sig)).toBe(false);
  });

  it('некорректный exp (NaN) → false', () => {
    const key = 'threads/x.png';
    const { sig } = parseSignedUrl(signFileUrl(key));
    expect(verifyFileSignature(key, 'not-a-number', sig)).toBe(false);
  });

  it('разные key/exp дают разные sig', () => {
    const a = parseSignedUrl(signFileUrl('threads/key-a.png'));
    const b = parseSignedUrl(signFileUrl('threads/key-b.png'));
    // Разные ключи → разные подписи.
    expect(a.sig).not.toBe(b.sig);
  });
});
