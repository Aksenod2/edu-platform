import type { FastifyRequest, FastifyReply } from 'fastify';
import { pendingRequiredConsents } from '../lib/consents.js';

/**
 * Серверный гейт обязательных согласий (issue #119).
 *
 * Волна 1.1 сделала гейт только на фронте (страница /consents) — студент с
 * валидным токеном мог пользоваться API в обход страницы. Этот хук принуждает
 * гейт на сервере: студент с недоданными ОБЯЗАТЕЛЬНЫМИ согласиями получает
 * 403 CONSENTS_REQUIRED на все роуты, кроме явного списка исключений
 * (auth-флоу, сам досбор согласий, правовые документы, вебхуки, файлы).
 *
 * ПОЧЕМУ фаза preHandler: аутентификация (authenticate) подключается роутами
 * и плагинами в фазе onRequest, то есть к фазе preHandler `request.user` уже
 * установлен —
 * и для JWT, и для API-ключей sk_. Глобальный preHandler на корневом
 * инстансе выполняется раньше любых роут-уровневых preHandler, но после
 * всех onRequest.
 */

// TTL положительного кэша: максимум столько студент с уже данными согласиями
// «помнится» без похода в БД. 60 секунд — компромисс между нагрузкой на БД
// (гейт стоит на КАЖДОМ запросе) и устареванием (новых обязательных типов
// согласий между деплоями не появляется, так что устаревание не страшно).
const CACHE_TTL_MS = 60_000;

// In-memory кэш «у пользователя НЕТ долга по согласиям»: userId → expiresAt (ms).
// Кэшируем ТОЛЬКО положительный результат: согласие, однажды данное, не
// отзывается (журнал append-only), поэтому «долга нет» — стабильный факт.
// ОТРИЦАТЕЛЬНЫЙ результат (долг есть) НЕ кэшируем: сразу после
// POST /users/me/consents доступ должен открыться без ожидания TTL.
const noDebtCache = new Map<string, number>();

/**
 * Сброс кэша для пользователя — вызывается после записи согласий
 * (POST /users/me/consents): сейчас это no-op по инварианту (отрицательный
 * результат не кэшируется), но страхует от регрессии, если кэш когда-нибудь
 * станет двусторонним.
 */
export function clearConsentGateCache(userId: string): void {
  noDebtCache.delete(userId);
}

/** Полный сброс кэша — для изоляции тестов. */
export function resetConsentGateCache(): void {
  noDebtCache.clear();
}

// Пути, на которых гейт НЕ действует:
// - /auth/ — логин/refresh/logout/смена пароля: студент должен мочь войти,
//   обновить сессию и выйти, иначе он не доберётся и до страницы согласий;
// - /users/me/consents — сам досбор согласий (и чтение своей истории,
//   и /users/me/consents/marketing) — то, ради чего гейт существует;
// - /public/ — публичные роуты, включая правовые документы /public/legal*:
//   тексты оферты/политик должны быть читаемы ДО принятия согласий;
// - /health — служебный health-check (точное совпадение, чтобы не зацепить
//   будущие /health-* роуты);
// - /webhooks/ — приём вебхуков (Zoom): аутентификация по HMAC, не от юзера;
// - /files/ — отдача файлов по подписанным URL (аватарки на странице согласий).
// На /public/, /health, /webhooks/ и /files/ request.user не бывает и гейт
// пропустил бы их и так — держим в списке как документацию намерения.
const EXEMPT_EXACT_PATHS = new Set(['/health']);
const EXEMPT_PATH_PREFIXES = [
  '/auth/',
  '/users/me/consents',
  '/public/',
  '/webhooks/',
  '/files/',
];

/**
 * Fastify preHandler: блокирует студента с недоданными обязательными
 * согласиями. Не-студентов и неаутентифицированные запросы пропускает —
 * у них своя авторизация на самих роутах.
 */
export async function consentGateHook(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  // Нет request.user (публичный роут или невалидный токен — 401 отдаст сам
  // роут) либо не студент (admin/teacher согласия не гейтят) — пропускаем.
  if (!user || user.role !== 'student') return;

  // Матчим по КАНОНИЧЕСКОМУ паттерну смэтченного роута (request.routeOptions.url),
  // а не по сырому request.url: исключает расхождения нормализации (кодирование,
  // двойные слэши) между гейтом и роутером. Фолбэк на сырой путь без query —
  // для запросов без смэтченного роута (404).
  const path = request.routeOptions.url ?? request.url.split('?')[0];
  if (
    EXEMPT_EXACT_PATHS.has(path) ||
    EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
  ) {
    return;
  }

  // Свежая положительная отметка в кэше — в БД не ходим.
  const cachedUntil = noDebtCache.get(user.userId);
  if (cachedUntil !== undefined) {
    if (cachedUntil > Date.now()) return;
    noDebtCache.delete(user.userId); // ленивая уборка протухшей записи
  }

  const pendingConsents = await pendingRequiredConsents(user.userId);
  if (pendingConsents.length === 0) {
    noDebtCache.set(user.userId, Date.now() + CACHE_TTL_MS);
    return;
  }

  return reply.status(403).send({
    error: 'Для продолжения работы примите обязательные согласия',
    code: 'CONSENTS_REQUIRED',
    pendingConsents,
  });
}
