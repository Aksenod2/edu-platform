# Карта переиспользования (reuse map)

> Прежде чем писать утилиту / компонент / хелпер — **ищи здесь готовое**. Архитектор и
> оркестратор дают эту карту исполнителю в ТЗ; исполнитель сверяется с ней до кода.
> Новое общее размещаем по правилу в конце документа.
>
> Статус: ✅ есть, бери · 🔨 дом создан, идёт чистка дублей · ⏳ план (#174).
>
> 🔒 **Гейт включён** (`.github/workflows/dup-gate.yml`, на PR): новый дубль / локальная копия
> `formatDate`/`initials`/`relativeTime` вместо дома → красный чек. Локально перед пушем:
> `pnpm dup:check` (рост копипаста) и `pnpm reuse:check` (запрещённые пере-определения).
> Убрал дубли — понизь baseline: `pnpm dup:update`.
>
> Контекст: ретро `docs/retro/2026-06-23.md`, эпик #174, долги — `docs/DEBTS.md` (раздел «Дублирование»).

## Даты и время

| Что | Где | Берёшь вместо того, чтобы писать |
|-----|-----|-----|
| Дата / дата-время / время (UI) 🔨 | `@/lib/format-date` | `formatDate`, `formatDateTime`, `formatTime` — НЕ пиши `toLocaleDateString` руками |
| «5 мин назад» (относительное) 🔨 | `@/lib/format-date` → `formatRelative` | НЕ копируй diff-в-минуты (было 2 расходящихся формата: «мин.» vs «мин») |
| Разделитель дат в ленте чата ✅ | `@/lib/chat-date` (`isNewDay`, `formatChatDayLabel`) + `@/components/chat-date-separator` | для чат-лент |
| Серверное время Москвы (api) ✅ | `apps/api/src/lib/moscow-time.ts` (`MOSCOW_TZ`, `moscowParts`, offset) | биллинг/напоминания — НЕ хардкодь UTC+3 |

## Идентичность пользователя

| Что | Где | |
|-----|-----|-----|
| Инициалы из имени 🔨 | `@/lib/initials` (`initials(name)`) | было 3 копии функции + инлайн |
| Аватар с fallback-инициалами 🔨 | `@/components/user-avatar` | связка shadcn `Avatar` + `initials` |

## Статусы и enum-метки

| Что | Где | |
|-----|-----|-----|
| Статусы задания: метки/вариант/порядок ✅ | `@/lib/assignment-status` (`STATUS_LABELS`, `getStatusMeta`, `STATUS_ORDER`) | ОБРАЗЕЦ источника правды |
| Статусы занятия: метки ✅ | `LESSON_STATUS_LABELS` из `@/lib/api` |  |
| Статусы занятия: вариант бейджа + «живой» бейдж ✅ | `@/components/schedule/utils` (`STATUS_BADGE_VARIANT`), `@/components/schedule/lesson-status-badge` |  |
| Тип/метки программы ✅ | `@/components/programs/program-type` |  |
| Коды + метки доменных enum (роли, статусы) — общее 🔨 | `@platform/shared/enums` | если метка нужна и на api, и на web |
| Рендер бейджа | shadcn `@/components/ui/badge` напрямую + метка из `*-status` | НЕ делай обёртку-StatusBadge |

## Пустые состояния и UI-паттерны

| Что | Где | |
|-----|-----|-----|
| Пустое состояние списка 🔨 | `@/components/empty-state` | было ~16 инлайн-копий |
| Подсказка-callout ✅ | `@/components/hint-callout` |  |
| Кнопка «назад» ✅ | `@/components/back-button` |  |

## Валидация (сквозная, api + web)

| Что | Где | |
|-----|-----|-----|
| Email: regex / normalize / isValid 🔨 | `@platform/shared/validation` | api `validation.ts` и web `phone.ts` сводятся к реэкспорту |
| Пароль: `MIN_PASSWORD_LENGTH`, `isValidPassword` 🔨 | `@platform/shared/validation` |  |
| Телефон: `PHONE_REGEX`, `normalizePhone`, `isValidPhone` 🔨 | `@platform/shared/validation`; UI-тексты (`PHONE_HINT`) — `@/lib/phone` |  |
| Зарубежный email (149-ФЗ) ✅ | `@platform/shared/foreign-email` (`isForeignEmail`, сообщения) | ОБРАЗЕЦ сквозного модуля |

## API-контракты

| Что | Где | |
|-----|-----|-----|
| Клиент API, типы ответов ✅ | `@/lib/api` (единственная точка fetch + типы) | НЕ дублируй fetch-логику |
| Совместимость старого формата уроков ✅ | проекционный shim в `apps/api/src/routes/lessons.ts` | при смене формата урока — учитывай shim |
| Перечень admin-эндпоинтов ✅ | `@platform/shared` (`API_ENDPOINTS`), страж `api-docs-parity.test.ts` | при +/- роута правь список |
| Единый Zod-контракт api↔web ⏳ | план, эпик #174 | пока типы в `@/lib/api` вручную |

## Prisma select/include (api)

| Что | Где | |
|-----|-----|-----|
| Публичная «визитка» автора `{id,name,role}` 🔨 | `apps/api/src/lib/selects.ts` (`authorPublicSelect`) | было ~10 копий в `conversations.ts` |
| Мини-визитка `{id,name}` 🔨 | `apps/api/src/lib/selects.ts` (`userMiniSelect` / `streamMiniSelect`) |  |

## Правило размещения нового общего

Спроси: **«кто это использует?»**

- **И api, и web** (правило валидации, enum-код+метка, контракт, доменная константа) → `packages/shared/src/*`. React/DOM — **нельзя** (пакет тянется в Node-api).
- **Только web, без JSX** (формат даты, инициалы, парсинг) → `apps/web/src/lib/<тема>.ts`.
- **Только web, c JSX** (пустое состояние, аватар) → `apps/web/src/components/<имя>.tsx`. Не оборачивать shadcn без нужды; композитный доменный компонент — можно.
- **Только api** (Prisma select, серверный хелпер) → `apps/api/src/lib/<тема>.ts`.
- **Сомневаешься «фронт-онли или сквозное»** → если логика есть/будет на бэке, клади в `shared`. Лучше сразу общее, чем потом переносить.
