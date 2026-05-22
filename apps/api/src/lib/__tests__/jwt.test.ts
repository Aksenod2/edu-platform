import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';

// Ensure a deterministic secret before the tested module reads it on import.
// (vitest.config.ts also sets this; kept here so the file is self-contained.)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

import { signAccessToken, verifyAccessToken, type JwtPayload } from '../jwt.js';

describe('jwt', () => {
  const payload: JwtPayload = { userId: 'user-123', role: 'TEACHER' };

  it('round-trip: подписанный токен корректно верифицируется и payload сохраняется', () => {
    const token = signAccessToken(payload);
    expect(typeof token).toBe('string');

    const decoded = verifyAccessToken(token);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.role).toBe(payload.role);
  });

  it('битый/невалидный токен → verifyAccessToken бросает', () => {
    expect(() => verifyAccessToken('not-a-real-token')).toThrow();
    expect(() => verifyAccessToken('aaa.bbb.ccc')).toThrow();
    expect(() => verifyAccessToken('')).toThrow();
  });

  it('токен с чужой подписью → verifyAccessToken бросает', () => {
    const foreign = jwt.sign(payload, 'completely-different-secret', { expiresIn: '15m' });
    expect(() => verifyAccessToken(foreign)).toThrow();
  });

  it('просроченный токен → verifyAccessToken бросает', () => {
    const expired = jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: '-1s' });
    expect(() => verifyAccessToken(expired)).toThrow();
  });

  it('токен содержит стандартные claims (iat/exp)', () => {
    const token = signAccessToken(payload);
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded).toHaveProperty('iat');
    expect(decoded).toHaveProperty('exp');
  });
});
