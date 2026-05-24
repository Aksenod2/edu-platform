import jwt, { type SignOptions } from 'jsonwebtoken';

// Дефолт-заглушка для dev/test. В production он запрещён (см. assertJwtSecret).
const DEFAULT_JWT_SECRET = 'change-me-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';

export interface JwtPayload {
  userId: string;
  role: string;
}

/**
 * Fail-fast по JWT_SECRET на проде. Вызывается на старте приложения
 * (см. server.ts): в production секрет обязан быть задан, НЕ совпадать с
 * дефолт-заглушкой и быть достаточно длинным — иначе фатальная ошибка, чтобы
 * не подняться с предсказуемым/слабым секретом (он ещё и подписывает файловые
 * ссылки S3). В dev/test проверка не выполняется — там допускается дефолт/
 * тестовый секрет (иначе посыпятся тесты с JWT_SECRET='test-...').
 *
 * Проверяем process.env напрямую, а не константу JWT_SECRET: к моменту вызова
 * dotenv уже загрузил .env, а константа подставила бы дефолт.
 */
const JWT_SECRET_MIN_LEN = 16;

export function assertJwtSecret(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === DEFAULT_JWT_SECRET || secret.length < JWT_SECRET_MIN_LEN) {
    throw new Error(
      'JWT_SECRET в production не задан, совпадает с дефолтом или слишком короткий ' +
        `(< ${JWT_SECRET_MIN_LEN} символов). Задайте стойкий секрет в окружении — ` +
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
