// Коды и русские метки доменных enum, общие для api и web.
//
// Цель — один источник пар «код ↔ человекочитаемая метка», чтобы и бэк, и фронт
// называли роль/статус одинаково (без расхождений «Студент»/«Ученик»).
//
// Границы (Шаг 1 «дом», карта docs/reuse-map.md):
//   - Кладём ТОЛЬКО бесспорное и стабильное: коды совпадают со схемой Prisma
//     (packages/db/prisma/schema.prisma), метки — с уже принятыми в UI.
//   - Здесь только ЧИСТЫЕ ДАННЫЕ (код + метка). UI-варианты бейджей (цвет/вариант),
//     порядок отображения, иконки — НЕ здесь (это зона web).
//   - LESSON_STATUS_LABELS из apps/web/src/lib/api.ts сюда НЕ переносим — это зона
//     общего контракта (#174), отдельной задачей.
//   - Существующие потребители пока НЕ переключаем — только создаём источник.
//
// Файл расширяемый: новые enum добавляются по тому же образцу (коды из схемы +
// метки из принятого UI).

// ─── Роль пользователя (Prisma enum UserRole) ─────────────────────────────────
// Метки — канонические из UI (apps/web/src/components/app-sidebar.tsx, settings).

export const USER_ROLES = ['student', 'admin'] as const;
export type UserRoleCode = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRoleCode, string> = {
  student: 'Студент',
  admin: 'Администратор',
};

// ─── Статус потока (Prisma enum StreamStatus) ─────────────────────────────────

export const STREAM_STATUSES = ['active', 'archived'] as const;
export type StreamStatusCode = (typeof STREAM_STATUSES)[number];

export const STREAM_STATUS_LABELS: Record<StreamStatusCode, string> = {
  active: 'Активен',
  archived: 'В архиве',
};

// ─── Статус занятия в потоке (Prisma enum SessionStatus) ──────────────────────

export const SESSION_STATUSES = ['draft', 'planned', 'live', 'done', 'cancelled'] as const;
export type SessionStatusCode = (typeof SESSION_STATUSES)[number];

export const SESSION_STATUS_LABELS: Record<SessionStatusCode, string> = {
  draft: 'Черновик',
  planned: 'Запланировано',
  live: 'Идёт',
  done: 'Проведено',
  cancelled: 'Отменено',
};

// ─── Статус встречи 1-на-1 (Prisma enum MeetingStatus) ────────────────────────
// Зеркало SessionStatus без draft — у встречи нет черновика.

export const MEETING_STATUSES = ['planned', 'live', 'done', 'cancelled'] as const;
export type MeetingStatusCode = (typeof MEETING_STATUSES)[number];

export const MEETING_STATUS_LABELS: Record<MeetingStatusCode, string> = {
  planned: 'Запланирована',
  live: 'Идёт',
  done: 'Проведена',
  cancelled: 'Отменена',
};
