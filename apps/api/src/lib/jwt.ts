import jwt, { type SignOptions } from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';

export interface JwtPayload {
  userId: string;
  role: string;
}

/**
 * Fail-fast по JWT_SECRET на проде. Вызывается на старте приложения
 * (см. server.ts): в production пустой/незаданный JWT_SECRET — фатальная
 * ошибка, чтобы не подняться молча с дефолтом (секрет ещё и подписывает
 * файловые ссылки S3). В dev/test проверка не выполняется — там допускается
 * дефолт/тестовый секрет (иначе посыпятся тесты с JWT_SECRET='test-...').
 *
 * Проверяем process.env напрямую, а не константу JWT_SECRET: к моменту вызова
 * dotenv уже загрузил .env, а константа подставила бы дефолт.
 */
export function assertJwtSecret(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error(
      'JWT_SECRET не задан в production. Задайте секрет в окружении — ' +
        'без него подпись токенов и файловых ссылок небезопасна.',
    );
  }
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
