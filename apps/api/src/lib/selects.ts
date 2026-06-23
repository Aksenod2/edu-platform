// Типизированные общие Prisma select-объекты — канонический «дом» для повторяющихся
// проекций (Шаг 1, карта docs/reuse-map.md).
//
// Зачем: одни и те же select-объекты дублируются по роутам (например, публичная
// проекция автора { id, name, role } встречается ~10 раз в conversations.ts).
// Один источник = одна форма ответа и один тип результата на всех точках.
//
// Prisma.validator<...>() даёт типобезопасность: select сверяется со схемой на
// этапе компиляции (опечатка в имени поля → ошибка типов, а не молчаливый дрейф).
//
// На Шаге 1 модуль только СОЗДАЁТСЯ — существующие роуты пока НЕ переключаем на эти
// константы (переключение — отдельный шаг чистки).
//
// Prisma импортируется из @platform/db (реэкспорт из @prisma/client) — по конвенции
// проекта (ср. apps/api/src/lib/charges.ts, notifications.ts).

import { Prisma } from '@platform/db';

/**
 * Публичная проекция пользователя-автора: id + отображаемое имя + роль.
 * Используется как author: { select: authorPublicSelect } в тредах/сообщениях
 * (≈10 копий в apps/api/src/routes/conversations.ts).
 */
export const authorPublicSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  name: true,
  role: true,
});

/**
 * Минимальная проекция пользователя: только id + имя (для списков/ссылок,
 * где роль не нужна).
 */
export const userMiniSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  name: true,
});
