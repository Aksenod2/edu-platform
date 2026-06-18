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
// personalDataPolicy — фиксация ОЗНАКОМЛЕНИЯ с «Политикой обработки персональных
// данных»: отдельная запись по требованию юриста заказчика (issue #130);
// action=granted трактуем как «подтвердил ознакомление».
export const CONSENT_TYPES = [
  'offer',
  'personalData',
  'personalDataPolicy',
  'serviceNotifications',
  'marketing',
  // Согласие на запись/транскрибацию созвонов (эпик «Встречи 1-на-1», #154).
  // РАЗОВОЕ: фиксируется, но НЕ входит в REQUIRED_CONSENT_TYPES — вход не блокирует.
  'meetingRecording',
] as const;
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
  personalDataPolicy: 'personal-data-policy',
  serviceNotifications: 'pd-consent',
  marketing: 'marketing-consent',
  meetingRecording: 'meeting-recording-consent',
};

// Обязательные юридические согласия: без них студент не может пользоваться
// платформой (Волна 1.1 «досбор согласий у существующих пользователей»).
// marketing — опциональное, в гейт не входит.
//
// personalDataPolicy добавлен в обязательные ОСОЗНАННО (issue #130, решение
// заказчика): у ВСЕХ существующих студентов появляется «долг» по этому типу →
// серверный гейт (consent-gate) и фронт-гейт потребуют новую галочку
// «ознакомлен с Политикой обработки персональных данных» при следующем заходе.
export const REQUIRED_CONSENT_TYPES: ConsentTypeValue[] = [
  'offer',
  'personalData',
  'personalDataPolicy',
  'serviceNotifications',
];

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
 * Недостающие ОБЯЗАТЕЛЬНЫЕ согласия пользователя: типы из REQUIRED_CONSENT_TYPES,
 * по которым нет НИ ОДНОЙ записи action=granted (любой версии документа).
 *
 * Тип считается недостающим, только если у его документа ЕСТЬ опубликованная
 * версия: пока версий нет, фиксировать согласие не к чему — вход не блокируем
 * (та же мягкая деградация, что в recordConsents).
 */
export async function pendingRequiredConsents(userId: string): Promise<ConsentTypeValue[]> {
  // Один запрос за granted-записями пользователя по обязательным типам.
  const granted = await prisma.userConsent.findMany({
    where: { userId, consentType: { in: REQUIRED_CONSENT_TYPES }, action: 'granted' },
    select: { consentType: true },
    distinct: ['consentType'],
  });
  const grantedTypes = new Set<string>(granted.map((c) => c.consentType));

  const missing = REQUIRED_CONSENT_TYPES.filter((type) => !grantedTypes.has(type));
  if (missing.length === 0) return [];

  // И один — за наличием опубликованных версий у документов недостающих типов.
  // Запрашиваем сами ДОКУМЕНТЫ с фильтром versions: { some: {} } — по строке на
  // документ, а не на каждую версию (число редакций со временем растёт).
  const slugs = [...new Set(missing.map((type) => CONSENT_TYPE_TO_SLUG[type]))];
  const documents = await prisma.legalDocument.findMany({
    where: { slug: { in: slugs }, versions: { some: {} } },
    select: { slug: true },
  });
  const publishedSlugs = new Set(documents.map((d) => d.slug));

  return missing.filter((type) => publishedSlugs.has(CONSENT_TYPE_TO_SLUG[type]));
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
