// Полный честный перечень эндпоинтов API, доступных по admin-ключу (`sk_…`).
//
// Источник истины — реальные роуты в `apps/api/src/routes/*.ts`. Этот модуль —
// НЕ-React и лежит в общем пакете `@platform/shared`, чтобы его могли
// импортировать и страница `/admin/api-access` (через реэкспорт
// `apps/web/src/lib/api-endpoints.ts`), и тест-страж на стороне api. За
// синхронность списка с фактическими роутами отвечает
// тест-страж `apps/api/src/routes/__tests__/api-docs-parity.test.ts`: он падает,
// если появился admin-доступный роут без записи здесь (и наоборот — лишняя
// запись). При добавлении/удалении роутов правьте этот список.
//
// Что НЕ включаем (служебные / не для интеграторов): публичные `/auth/*`
// (login, refresh, logout, forgot-password, reset-password, accept-invite),
// вебхуки `POST /webhooks/zoom/:id`, публичное вступление в поток
// `/public/streams/join/*`, health-check `/health` и `/readiness`. Их
// учитывает игнор-лист теста-стража.
//
// Пути параметризованы в стиле Fastify (`:id`, `:studentId`). Метод — в верхнем
// регистре.

/** Описание одного поля тела запроса (body) для документации. */
export type ApiBodyField = {
  /** Имя поля в JSON. */
  name: string;
  /** Тип значения (string / boolean / string[] / object[] и т.п.). */
  type: string;
  /** Обязательно ли поле. */
  required: boolean;
  /** Пояснение на русском (необязательно). */
  note?: string;
};

export type ApiEndpoint = {
  /** Домен/группа для подзаголовка в таблице доки. */
  group: string;
  /** HTTP-метод (GET/POST/PUT/PATCH/DELETE). */
  method: string;
  /** Путь Fastify с параметрами вида `:id`. */
  path: string;
  /** Краткое описание на русском. */
  desc: string;
  /**
   * Опциональная схема тела запроса (body) — для write-эндпоинтов. Тест-страж
   * паритета сверяет только method+path, поэтому это поле его не затрагивает.
   */
  body?: ApiBodyField[];
  /** Опциональный готовый пример curl с телом запроса. */
  example?: string;
};

// Порядок групп задаёт порядок секций в таблице доки.
export const API_ENDPOINT_GROUPS = [
  'Группы/потоки',
  'Уроки',
  'Задания/сдачи',
  'Ученики',
  'Программы',
  'Кошелёк/платежи',
  'Профили/заметки',
  'Ленты/треды/чаты',
  'Уведомления',
  'Интеграции (Zoom)',
  'Файлы',
  'API-ключи',
  'Статистика',
  'Push',
  'Профиль владельца ключа',
] as const;

export const API_ENDPOINTS: ApiEndpoint[] = [
  // ─── Группы/потоки ───────────────────────────────────────────────────────
  { group: 'Группы/потоки', method: 'GET', path: '/streams', desc: 'Список групп/потоков' },
  {
    group: 'Группы/потоки',
    method: 'POST',
    path: '/streams',
    desc: 'Создать группу',
    body: [
      { name: 'name', type: 'string', required: true, note: 'Название потока.' },
      {
        name: 'programId',
        type: 'string',
        required: false,
        note: 'Привязка к программе. Без неё поток менторский (уроки задаются напрямую). Создатель становится ведущим.',
      },
    ],
    example:
      `curl -X POST <BASE>/streams \\\n` +
      `  -H 'Authorization: Bearer sk_ваш_ключ' \\\n` +
      `  -H 'Content-Type: application/json' \\\n` +
      `  -d '{"name": "Поток сентябрь", "programId": "ID_ПРОГРАММЫ"}'`,
  },
  { group: 'Группы/потоки', method: 'GET', path: '/streams/:id', desc: 'Карточка группы' },
  {
    group: 'Группы/потоки',
    method: 'PATCH',
    path: '/streams/:id',
    desc: 'Изменить группу',
    body: [
      { name: 'name', type: 'string', required: false, note: 'Новое название (непустое).' },
      { name: 'ownerId', type: 'string', required: false, note: 'Новый ведущий (существующий admin).' },
      { name: 'programId', type: 'string', required: false, note: 'Программа; null делает поток менторским.' },
    ],
    example:
      `curl -X PATCH <BASE>/streams/ID_ГРУППЫ \\\n` +
      `  -H 'Authorization: Bearer sk_ваш_ключ' \\\n` +
      `  -H 'Content-Type: application/json' \\\n` +
      `  -d '{"name": "Поток октябрь"}'`,
  },
  { group: 'Группы/потоки', method: 'DELETE', path: '/streams/:id', desc: 'Удалить группу' },
  { group: 'Группы/потоки', method: 'GET', path: '/streams/:id/students', desc: 'Ученики группы' },
  {
    group: 'Группы/потоки',
    method: 'POST',
    path: '/streams/:id/students',
    desc: 'Зачислить ученика в группу',
    body: [
      {
        name: 'studentIds',
        type: 'string[]',
        required: true,
        note: 'Непустой массив id учеников (роль student). Невалидные/чужие id игнорируются. Зачисление идемпотентно, заданиями добивается автоматически.',
      },
    ],
    example:
      `curl -X POST <BASE>/streams/ID_ГРУППЫ/students \\\n` +
      `  -H 'Authorization: Bearer sk_ваш_ключ' \\\n` +
      `  -H 'Content-Type: application/json' \\\n` +
      `  -d '{"studentIds": ["ID_УЧЕНИКА_1", "ID_УЧЕНИКА_2"]}'`,
  },
  { group: 'Группы/потоки', method: 'DELETE', path: '/streams/:id/students/:studentId', desc: 'Отчислить ученика из группы' },
  { group: 'Группы/потоки', method: 'POST', path: '/streams/:id/join-link', desc: 'Получить инвайт-ссылку вступления' },
  { group: 'Группы/потоки', method: 'DELETE', path: '/streams/:id/join-link', desc: 'Отозвать инвайт-ссылку' },
  { group: 'Группы/потоки', method: 'POST', path: '/streams/:id/archive', desc: 'Архивировать группу' },

  // ─── Уроки (блок/материалы/видео/сессии) ─────────────────────────────────
  { group: 'Уроки', method: 'GET', path: '/lessons', desc: 'Список уроков (блоков)' },
  {
    group: 'Уроки',
    method: 'POST',
    path: '/lessons',
    desc: 'Создать урок',
    body: [
      { name: 'title', type: 'string', required: true, note: 'Название урока.' },
      {
        name: 'streamId',
        type: 'string',
        required: false,
        note: 'Без streamId создаётся только переиспользуемый БЛОК-копилка (без расписания). С streamId блок привязывается к программе потока и заводится Session.',
      },
      { name: 'videoUrl', type: 'string', required: false, note: 'Внешняя ссылка на видео.' },
      { name: 'summary', type: 'string', required: false, note: 'Описание/итоги (без streamId — описание блока).' },
      { name: 'notes', type: 'string', required: false, note: 'Заметки преподавателя.' },
      { name: 'sortOrder', type: 'number', required: false },
      {
        name: 'materials',
        type: 'object[]',
        required: false,
        note: 'Дескрипторы материалов {s3Key, fileName, mimeType, size}. Сначала загрузите файл и подставьте его ключ.',
      },
      {
        name: 'teacherIds',
        type: 'string[]',
        required: false,
        note: 'id преподавателей (роль admin). В ответе читаются как teachers[].',
      },
      {
        name: 'status',
        type: 'string',
        required: false,
        note: "draft | planned | done | cancelled. РАСПИСАНИЕ сохраняется только при streamId (живёт в Session). planned требует date.",
      },
      { name: 'date', type: 'string', required: false, note: "YYYY-MM-DD. Только при streamId (Session)." },
      { name: 'startTime', type: 'string', required: false, note: "HH:MM. Только при streamId (Session)." },
      { name: 'meetingUrl', type: 'string', required: false, note: 'Ссылка на встречу (Session, при streamId).' },
      {
        name: 'generateMeeting',
        type: 'boolean',
        required: false,
        note: 'Сгенерировать ссылку Zoom по запросу (даже при выключенном автотумблере). Нужна date.',
      },
      { name: 'hasAssignment', type: 'boolean', required: false, note: 'Свёрнутое ДЗ в блоке урока (аддитивно, как у PATCH).' },
      { name: 'assignmentTitle', type: 'string', required: false },
      { name: 'assignmentDescription', type: 'string', required: false },
      { name: 'assignmentCriteria', type: 'string', required: false },
      { name: 'assignmentType', type: 'string', required: false, note: "short | long." },
      { name: 'assignmentTags', type: 'string[]', required: false },
      { name: 'assignmentMaterials', type: 'object[]', required: false },
    ],
    example:
      `curl -X POST <BASE>/lessons \\\n` +
      `  -H 'Authorization: Bearer sk_ваш_ключ' \\\n` +
      `  -H 'Content-Type: application/json' \\\n` +
      `  -d '{"title": "Вводный урок", "streamId": "ID_ГРУППЫ", "status": "planned", "date": "2026-06-01", "startTime": "18:00", "teacherIds": ["ID_ПРЕПОДА"]}'`,
  },
  { group: 'Уроки', method: 'GET', path: '/lessons/:id', desc: 'Карточка урока' },
  {
    group: 'Уроки',
    method: 'PATCH',
    path: '/lessons/:id',
    desc: 'Изменить урок',
    body: [
      { name: 'title', type: 'string', required: false },
      {
        name: 'streamId',
        type: 'string',
        required: false,
        note: 'Контекст потока: без него поля расписания (date/startTime/status/meetingUrl) и summary-как-итоги ИГНОРИРУЮТСЯ (правится только блок).',
      },
      { name: 'videoUrl', type: 'string', required: false },
      {
        name: 'summary',
        type: 'string',
        required: false,
        note: 'Со streamId — итоги конкретного занятия (Session.summary, источник manual). Без streamId — описание блока.',
      },
      { name: 'notes', type: 'string', required: false },
      { name: 'sortOrder', type: 'number', required: false },
      { name: 'materials', type: 'object[]', required: false, note: 'Полная замена списка материалов блока.' },
      { name: 'teacherIds', type: 'string[]', required: false, note: 'Полная замена набора преподавателей.' },
      { name: 'status', type: 'string', required: false, note: "draft | planned | done | cancelled. Только при streamId (Session)." },
      { name: 'date', type: 'string', required: false, note: "YYYY-MM-DD. Только при streamId." },
      { name: 'startTime', type: 'string', required: false, note: "HH:MM. Только при streamId." },
      { name: 'meetingUrl', type: 'string', required: false, note: 'Только при streamId.' },
      { name: 'generateMeeting', type: 'boolean', required: false },
      { name: 'hasAssignment', type: 'boolean', required: false, note: 'Свёрнутое ДЗ блока урока.' },
      { name: 'assignmentTitle', type: 'string', required: false },
      { name: 'assignmentDescription', type: 'string', required: false },
      { name: 'assignmentCriteria', type: 'string', required: false },
      { name: 'assignmentType', type: 'string', required: false, note: "short | long." },
      { name: 'assignmentTags', type: 'string[]', required: false },
      { name: 'assignmentMaterials', type: 'object[]', required: false },
    ],
    example:
      `curl -X PATCH <BASE>/lessons/ID_УРОКА \\\n` +
      `  -H 'Authorization: Bearer sk_ваш_ключ' \\\n` +
      `  -H 'Content-Type: application/json' \\\n` +
      `  -d '{"streamId": "ID_ГРУППЫ", "status": "done", "summary": "Итоги занятия"}'`,
  },
  { group: 'Уроки', method: 'DELETE', path: '/lessons/:id', desc: 'Удалить урок' },
  { group: 'Уроки', method: 'POST', path: '/lessons/:id/materials', desc: 'Загрузить материал урока' },
  { group: 'Уроки', method: 'DELETE', path: '/lessons/:id/materials/:s3Key', desc: 'Удалить материал урока' },
  { group: 'Уроки', method: 'POST', path: '/lessons/:id/video', desc: 'Загрузить видео урока (одиночное, легаси)' },
  { group: 'Уроки', method: 'DELETE', path: '/lessons/:id/video', desc: 'Удалить видео урока (одиночное, легаси)' },
  { group: 'Уроки', method: 'POST', path: '/lessons/:id/videos', desc: 'Добавить видео в коллекцию урока' },
  { group: 'Уроки', method: 'PATCH', path: '/lessons/:id/videos/:videoId', desc: 'Изменить видео урока' },
  { group: 'Уроки', method: 'DELETE', path: '/lessons/:id/videos/:videoId', desc: 'Удалить видео урока' },
  { group: 'Уроки', method: 'PUT', path: '/lessons/:id/videos/order', desc: 'Переупорядочить видео урока' },
  { group: 'Уроки', method: 'GET', path: '/lessons/:id/analytics', desc: 'Аналитика сдач по занятию (в потоке)' },
  { group: 'Уроки', method: 'GET', path: '/lessons/:id/attendance', desc: 'Посещаемость занятия (сводка + записи)' },
  { group: 'Уроки', method: 'POST', path: '/lessons/:id/attendance/resync', desc: 'Забрать посещаемость из Zoom заново' },
  { group: 'Уроки', method: 'POST', path: '/lessons/:id/attendance/mark', desc: 'Ручная отметка посещаемости студента' },
  { group: 'Уроки', method: 'PATCH', path: '/lessons/:id/attendance/:attendanceId/match', desc: 'Привязать гостя Zoom к студенту' },
  { group: 'Уроки', method: 'GET', path: '/lessons/:id/sessions', desc: 'Проведения урока (сессии по потокам)' },
  { group: 'Уроки', method: 'DELETE', path: '/lessons/:id/sessions/:streamId', desc: 'Снять урок с расписания потока' },
  { group: 'Уроки', method: 'POST', path: '/lessons/:id/sessions/:streamId/recording/retry', desc: 'Повторить автозагрузку записи Zoom' },
  { group: 'Уроки', method: 'POST', path: '/lessons/:id/sessions/:streamId/refresh', desc: 'Обновить из Zoom: запись, итоги, транскрипт, посещаемость' },
  { group: 'Уроки', method: 'GET', path: '/lessons/:id/sessions/:streamId/transcript', desc: 'Транскрипт занятия (vtt|txt) — препод урока/админ' },

  // ─── Задания/сдачи ───────────────────────────────────────────────────────
  { group: 'Задания/сдачи', method: 'GET', path: '/assignments', desc: 'Список заданий' },
  {
    group: 'Задания/сдачи',
    method: 'POST',
    path: '/assignments',
    desc: 'Выдать задание группе (автовыдача ученикам)',
    body: [
      { name: 'streamId', type: 'string', required: true, note: 'Поток, которому выдаётся задание.' },
      {
        name: 'lessonId',
        type: 'string',
        required: true,
        note: 'Урок-блок, в который пишется ДЗ (hasAssignment=true). Обязателен.',
      },
      { name: 'title', type: 'string', required: true, note: 'Название задания.' },
      { name: 'description', type: 'string', required: false },
      { name: 'criteria', type: 'string', required: false, note: 'Критерии проверки.' },
      { name: 'type', type: 'string', required: false, note: "short | long (по умолчанию short)." },
      { name: 'tags', type: 'string[]', required: false },
      { name: 'dueDate', type: 'string', required: false, note: 'ISO-дата дедлайна (пишется в Session).' },
      {
        name: 'materials',
        type: 'object[]',
        required: false,
        note: 'Материалы {type, name, url, s3Key?, size?} (загрузка через POST /assignments/upload-material).',
      },
    ],
    example:
      `curl -X POST <BASE>/assignments \\\n` +
      `  -H 'Authorization: Bearer sk_ваш_ключ' \\\n` +
      `  -H 'Content-Type: application/json' \\\n` +
      `  -d '{"streamId": "ID_ГРУППЫ", "lessonId": "ID_УРОКА", "title": "Эссе", "type": "long", "dueDate": "2026-06-10"}'`,
  },
  { group: 'Задания/сдачи', method: 'GET', path: '/assignments/:id', desc: 'Карточка задания' },
  { group: 'Задания/сдачи', method: 'PATCH', path: '/assignments/:id', desc: 'Изменить задание' },
  { group: 'Задания/сдачи', method: 'DELETE', path: '/assignments/:id', desc: 'Удалить задание' },
  { group: 'Задания/сдачи', method: 'POST', path: '/assignments/upload-material', desc: 'Загрузить материал к заданию' },
  { group: 'Задания/сдачи', method: 'GET', path: '/students/:id/assignments-summary', desc: 'Сводка по заданиям ученика' },
  { group: 'Задания/сдачи', method: 'GET', path: '/student-assignments', desc: 'Сдачи (с фильтром ?studentId=)' },
  { group: 'Задания/сдачи', method: 'PATCH', path: '/student-assignments/:id', desc: 'Проверить сдачу / выставить статус' },

  // ─── Ученики ─────────────────────────────────────────────────────────────
  { group: 'Ученики', method: 'GET', path: '/users', desc: 'Список учеников' },
  {
    group: 'Ученики',
    method: 'POST',
    path: '/users',
    desc: 'Создать ученика',
    body: [
      { name: 'email', type: 'string', required: true, note: 'Уникальный email (409 при дубле).' },
      { name: 'name', type: 'string', required: true, note: 'Имя ученика.' },
    ],
    example:
      `curl -X POST <BASE>/users \\\n` +
      `  -H 'Authorization: Bearer sk_ваш_ключ' \\\n` +
      `  -H 'Content-Type: application/json' \\\n` +
      `  -d '{"email": "ivan@example.com", "name": "Иван Иванов"}'`,
  },
  { group: 'Ученики', method: 'GET', path: '/teachers', desc: 'Список преподавателей (admin)' },
  { group: 'Ученики', method: 'GET', path: '/users/:id', desc: 'Карточка ученика' },
  { group: 'Ученики', method: 'PATCH', path: '/users/:id', desc: 'Изменить ученика' },
  { group: 'Ученики', method: 'DELETE', path: '/users/:id', desc: 'Удалить ученика' },
  { group: 'Ученики', method: 'POST', path: '/users/:id/invite', desc: 'Сгенерировать ссылку-приглашение' },
  { group: 'Ученики', method: 'POST', path: '/users/:id/reset-password', desc: 'Сбросить пароль ученика' },
  { group: 'Ученики', method: 'GET', path: '/users/:id/export', desc: 'Выгрузить все данные ученика (профиль, задания, лента, файлы)' },

  // ─── Программы ───────────────────────────────────────────────────────────
  { group: 'Программы', method: 'GET', path: '/programs', desc: 'Список программ' },
  { group: 'Программы', method: 'POST', path: '/programs', desc: 'Создать программу' },
  { group: 'Программы', method: 'GET', path: '/programs/:id', desc: 'Карточка программы' },
  { group: 'Программы', method: 'PATCH', path: '/programs/:id', desc: 'Изменить программу' },
  { group: 'Программы', method: 'DELETE', path: '/programs/:id', desc: 'Удалить программу' },
  { group: 'Программы', method: 'POST', path: '/programs/:id/lessons', desc: 'Добавить урок в программу' },
  { group: 'Программы', method: 'DELETE', path: '/programs/:id/lessons/:lessonId', desc: 'Убрать урок из программы' },
  { group: 'Программы', method: 'PATCH', path: '/programs/:id/lessons/reorder', desc: 'Переупорядочить уроки программы' },

  // ─── Кошелёк/платежи ─────────────────────────────────────────────────────
  { group: 'Кошелёк/платежи', method: 'POST', path: '/students/:id/wallet/topup', desc: 'Пополнить кошелёк ученика' },
  { group: 'Кошелёк/платежи', method: 'POST', path: '/students/:id/wallet/debit', desc: 'Списать с кошелька ученика' },
  { group: 'Кошелёк/платежи', method: 'GET', path: '/students/:id/wallet', desc: 'Баланс и история кошелька' },
  { group: 'Кошелёк/платежи', method: 'POST', path: '/topup-requests', desc: 'Создать заявку на пополнение (от лица владельца ключа)' },
  { group: 'Кошелёк/платежи', method: 'GET', path: '/topup-requests/me', desc: 'Свои заявки на пополнение' },
  { group: 'Кошелёк/платежи', method: 'GET', path: '/admin/topup-requests', desc: 'Все заявки на пополнение (admin)' },
  { group: 'Кошелёк/платежи', method: 'POST', path: '/admin/topup-requests/:id/approve', desc: 'Одобрить заявку на пополнение' },
  { group: 'Кошелёк/платежи', method: 'POST', path: '/admin/topup-requests/:id/reject', desc: 'Отклонить заявку на пополнение' },
  { group: 'Кошелёк/платежи', method: 'GET', path: '/payment-settings', desc: 'Реквизиты для оплаты' },
  { group: 'Кошелёк/платежи', method: 'PUT', path: '/admin/payment-settings', desc: 'Изменить реквизиты для оплаты' },
  { group: 'Кошелёк/платежи', method: 'POST', path: '/admin/payment-settings/qr', desc: 'Загрузить QR-код для оплаты' },
  { group: 'Кошелёк/платежи', method: 'DELETE', path: '/admin/payment-settings/qr', desc: 'Удалить QR-код для оплаты' },

  // ─── Профили/заметки ─────────────────────────────────────────────────────
  { group: 'Профили/заметки', method: 'GET', path: '/profiles/:studentId', desc: 'Профиль ученика' },
  { group: 'Профили/заметки', method: 'PATCH', path: '/profiles/:studentId', desc: 'Изменить профиль ученика' },
  { group: 'Профили/заметки', method: 'GET', path: '/profiles/:studentId/notes', desc: 'Заметки преподавателя об ученике' },
  { group: 'Профили/заметки', method: 'POST', path: '/profiles/:studentId/notes', desc: 'Добавить заметку об ученике' },
  { group: 'Профили/заметки', method: 'DELETE', path: '/profiles/:studentId/notes/:noteId', desc: 'Удалить заметку об ученике' },

  // ─── Ленты/треды/чаты (записи append-only: правки/удаления нет) ───────────
  { group: 'Ленты/треды/чаты', method: 'GET', path: '/threads', desc: 'Список лент учеников' },
  { group: 'Ленты/треды/чаты', method: 'GET', path: '/threads/:studentId', desc: 'Лента ученика' },
  { group: 'Ленты/треды/чаты', method: 'POST', path: '/threads/:studentId/entries', desc: 'Добавить запись в ленту (append-only)' },
  { group: 'Ленты/треды/чаты', method: 'PATCH', path: '/threads/:studentId/entries/:entryId/read', desc: 'Отметить запись ленты прочитанной' },
  { group: 'Ленты/треды/чаты', method: 'GET', path: '/conversations/staff', desc: 'Штаб-канал персонала' },
  { group: 'Ленты/треды/чаты', method: 'GET', path: '/conversations/staff/unread', desc: 'Непрочитанные в штаб-канале' },
  { group: 'Ленты/треды/чаты', method: 'POST', path: '/conversations/staff/entries', desc: 'Написать в штаб-канал (append-only)' },
  { group: 'Ленты/треды/чаты', method: 'GET', path: '/conversations/streams', desc: 'Список чатов групп' },
  { group: 'Ленты/треды/чаты', method: 'GET', path: '/conversations/stream/:streamId', desc: 'Чат группы (для персонала)' },
  { group: 'Ленты/треды/чаты', method: 'POST', path: '/conversations/stream/:streamId/entries', desc: 'Написать в чат группы (append-only)' },
  { group: 'Ленты/треды/чаты', method: 'GET', path: '/conversations/cohorts', desc: 'Список своих когорт-чатов' },
  { group: 'Ленты/треды/чаты', method: 'GET', path: '/conversations/cohort/:streamId', desc: 'Когорта-чат (для участника)' },
  { group: 'Ленты/треды/чаты', method: 'POST', path: '/conversations/cohort/:streamId/entries', desc: 'Написать в когорта-чат (append-only)' },

  // ─── Уведомления ─────────────────────────────────────────────────────────
  { group: 'Уведомления', method: 'GET', path: '/notifications/count', desc: 'Счётчик уведомлений (?unread=true)' },
  { group: 'Уведомления', method: 'GET', path: '/notifications', desc: 'Список уведомлений' },
  { group: 'Уведомления', method: 'PATCH', path: '/notifications/read-all', desc: 'Отметить все прочитанными' },
  { group: 'Уведомления', method: 'PATCH', path: '/notifications/:id/read', desc: 'Отметить уведомление прочитанным' },
  { group: 'Уведомления', method: 'DELETE', path: '/notifications/:id', desc: 'Удалить уведомление' },
  { group: 'Уведомления', method: 'GET', path: '/notification-preferences', desc: 'Настройки уведомлений' },
  { group: 'Уведомления', method: 'PATCH', path: '/notification-preferences', desc: 'Изменить настройки уведомлений' },

  // ─── Интеграции (Zoom) ───────────────────────────────────────────────────
  { group: 'Интеграции (Zoom)', method: 'GET', path: '/admin/integrations/zoom', desc: 'Текущие настройки Zoom' },
  { group: 'Интеграции (Zoom)', method: 'PUT', path: '/admin/integrations/zoom', desc: 'Сохранить настройки Zoom (отключение = сохранить пустые credentials)' },
  { group: 'Интеграции (Zoom)', method: 'POST', path: '/admin/integrations/zoom/test', desc: 'Проверить подключение к Zoom' },

  // ─── Файлы ───────────────────────────────────────────────────────────────
  { group: 'Файлы', method: 'GET', path: '/files/*', desc: 'Скачать файл (по подписи или админским Bearer)' },
  { group: 'Файлы', method: 'DELETE', path: '/admin/files', desc: 'Удалить ВСЕ загруженные файлы (сброс данных, необратимо)' },

  // ─── API-ключи ───────────────────────────────────────────────────────────
  { group: 'API-ключи', method: 'GET', path: '/api-keys', desc: 'Список своих API-ключей' },
  { group: 'API-ключи', method: 'POST', path: '/api-keys', desc: 'Создать API-ключ (значение показывается один раз)' },
  { group: 'API-ключи', method: 'DELETE', path: '/api-keys/:id', desc: 'Отозвать API-ключ' },

  // ─── Статистика ──────────────────────────────────────────────────────────
  { group: 'Статистика', method: 'GET', path: '/stats', desc: 'Сводная статистика платформы' },

  // ─── Push ────────────────────────────────────────────────────────────────
  { group: 'Push', method: 'GET', path: '/push-subscriptions/vapid-public-key', desc: 'Публичный VAPID-ключ для web-push' },
  { group: 'Push', method: 'POST', path: '/push-subscriptions', desc: 'Зарегистрировать push-подписку' },
  { group: 'Push', method: 'DELETE', path: '/push-subscriptions/:id', desc: 'Удалить push-подписку' },

  // ─── Профиль владельца ключа ─────────────────────────────────────────────
  { group: 'Профиль владельца ключа', method: 'PATCH', path: '/users/me', desc: 'Изменить свой профиль' },
  { group: 'Профиль владельца ключа', method: 'POST', path: '/users/me/avatar', desc: 'Загрузить свой аватар' },
  { group: 'Профиль владельца ключа', method: 'DELETE', path: '/users/me/avatar', desc: 'Удалить свой аватар' },
  { group: 'Профиль владельца ключа', method: 'POST', path: '/auth/change-password', desc: 'Сменить свой пароль' },
];
