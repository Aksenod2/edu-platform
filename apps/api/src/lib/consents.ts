import type { FastifyRequest } from 'fastify';
import { prisma } from '@platform/db';
import type { Prisma } from '@platform/db';

/**
 * Фиксация юридических согласий пользователя (Волна 1 «правовой минимум»).
 *
 * Согласие привязывается к АКТУАЛЬНОЙ (max versionNumber) опубликованной версии
 * соответствующего документа. История append-only: записи не правим и не удаляем.
 */

// Типы согласий — зеркало enum ConsentType из Prisma-схемы (camelCase по ТЗ).
export const CONSENT_TYPES = ['offer', 'personalData', 'serviceNotifications', 'marketing'] as const;
export type ConsentTypeValue = (typeof CONSENT_TYPES)[number];

// userAgent в журнале согласий обрезаем: заголовок может быть произвольно длинным,
// для юридической фиксации достаточно первых 512 символов.
const USER_AGENT_MAX_LENGTH = 512;

// Маппинг тип согласия → slug документа, версию которого фиксируем.
// ВЫБОР по serviceNotifications: отдельного документа «согласие на сервисные
// уведомления» среди 8 карточек нет, а documentVersionId в схеме NOT NULL.
// Юридически сервисные уведомления — часть обработки ПДн (использование контактов
// для исполнения договора), поэтому привязываем к той же версии pd-consent, что и
// personalData; сами согласия различаются полем consentType.
export const CONSENT_TYPE_TO_SLUG: Record<ConsentTypeValue, string> = {
  offer: 'offer',
  personalData: 'pd-consent',
  serviceNotifications: 'pd-consent',
  marketing: 'marketing-consent',
};

export function isConsentType(value: unknown): value is ConsentTypeValue {
  return typeof value === 'string' && (CONSENT_TYPES as readonly string[]).includes(value);
}

/**
 * Разбор body.consents: ожидаем массив строк-значений ConsentType.
 * Возвращает массив валидных типов БЕЗ дублей, либо null, если вход некорректен
 * (не массив / есть неизвестные значения) — в этом случае роут отвечает 400.
 * Отсутствующее поле (undefined) трактуется как «согласий не передали» → [].
 */
export function parseConsentTypes(input: unknown): ConsentTypeValue[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;
  const result: ConsentTypeValue[] = [];
  for (const value of input) {
    if (!isConsentType(value)) return null;
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

/** Усечённый user-agent запроса для журнала согласий (или null, если заголовка нет). */
export function requestUserAgent(request: FastifyRequest): string | null {
  const userAgent = request.headers['user-agent'];
  if (typeof userAgent !== 'string' || userAgent === '') return null;
  return userAgent.slice(0, USER_AGENT_MAX_LENGTH);
}

/**
 * Актуальная (max versionNumber) опубликованная версия документа по slug,
 * либо null, если версий ещё не опубликовано.
 */
export async function latestVersionForSlug(
  slug: string,
): Promise<{ id: string; versionNumber: number } | null> {
  return prisma.legalDocumentVersion.findFirst({
    where: { document: { slug } },
    orderBy: { versionNumber: 'desc' },
    select: { id: true, versionNumber: true },
  });
}

/**
 * История согласий пользователя для выдачи в API (новые сверху): тип, действие,
 * дата, ip/userAgent и slug+title+versionNumber документа. Используется и админским
 * GET /users/:id/consents, и личным GET /users/me/consents — форма одна.
 */
export async function listUserConsents(userId: string) {
  const consents = await prisma.userConsent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      consentType: true,
      action: true,
      ip: true,
      userAgent: true,
      createdAt: true,
      documentVersion: {
        select: {
          versionNumber: true,
          document: { select: { slug: true, title: true } },
        },
      },
    },
  });

  return consents.map((consent) => ({
    id: consent.id,
    consentType: consent.consentType,
    action: consent.action,
    ip: consent.ip,
    userAgent: consent.userAgent,
    createdAt: consent.createdAt,
    document: {
      slug: consent.documentVersion.document.slug,
      title: consent.documentVersion.document.title,
      versionNumber: consent.documentVersion.versionNumber,
    },
  }));
}

/**
 * Фиксирует согласия пользователя (action=granted) с актуальными версиями документов.
 *
 * МЯГКАЯ ДЕГРАДАЦИЯ (осознанно): пока у документа НЕТ опубликованной версии,
 * зафиксировать согласие невозможно (documentVersionId NOT NULL) — такие типы
 * пропускаем с warn в лог, а регистрация продолжает работать как раньше.
 * Требование «без согласий не регистрируем» включится на фронте после публикации
 * версий. Функция НИКОГДА не кидает: журнал согласий не должен ронять уже
 * успешную регистрацию/активацию пользователя (ошибки БД — error в лог).
 */
export async function recordConsents(
  userId: string,
  types: ConsentTypeValue[],
  request: FastifyRequest,
): Promise<void> {
  if (types.length === 0) return;

  try {
    // Актуальные версии всех нужных документов одним запросом: берём версии по
    // убыванию versionNumber и оставляем первую на каждый slug.
    const slugs = [...new Set(types.map((t) => CONSENT_TYPE_TO_SLUG[t]))];
    const versions = await prisma.legalDocumentVersion.findMany({
      where: { document: { slug: { in: slugs } } },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, document: { select: { slug: true } } },
    });
    const latestBySlug = new Map<string, string>();
    for (const version of versions) {
      if (!latestBySlug.has(version.document.slug)) {
        latestBySlug.set(version.document.slug, version.id);
      }
    }

    const ip = request.ip || null;
    const userAgent = requestUserAgent(request);

    const rows: Prisma.UserConsentCreateManyInput[] = [];
    for (const consentType of types) {
      const slug = CONSENT_TYPE_TO_SLUG[consentType];
      const documentVersionId = latestBySlug.get(slug);
      if (!documentVersionId) {
        request.log.warn(
          { userId, consentType, slug },
          'Согласие не зафиксировано: у документа нет опубликованной версии',
        );
        continue;
      }
      rows.push({ userId, documentVersionId, consentType, action: 'granted', ip, userAgent });
    }

    if (rows.length > 0) {
      await prisma.userConsent.createMany({ data: rows });
    }
  } catch (err) {
    request.log.error({ err, userId, types }, 'Не удалось зафиксировать согласия пользователя');
  }
}
