# Деплой edu-platform на Timeweb Cloud (App Platform)

Проект — монорепо (pnpm + turbo) из двух деплоев + база:

| Ресурс | Что это | Тип в Timeweb |
|---|---|---|
| **PostgreSQL** | основная БД (в ней же хранятся загруженные файлы) | Облачная база данных (DBaaS) |
| **API** | Fastify-бэкенд (`apps/api`), порт `4000`, health `/health` | App Platform → Docker Compose → `deploy/api` |
| **Web** | Next.js-фронт (`apps/web`), порт `3000` | App Platform → Docker Compose → `deploy/web` |

> S3/MinIO **не нужны** — файлы лежат в PostgreSQL (`fileStorage`). Учтите это при выборе размера диска БД (лимит загрузки — 50 МБ на файл).

Почему Docker Compose, а не «Dockerfile»: в режиме «Dockerfile» контекст сборки = путь к проекту, а наши Dockerfile'ы собираются из **корня** монорепо. Compose позволяет задать `context: ../..` и build-args.

---

## Шаг 0. Управляемый PostgreSQL

1. Timeweb Cloud → **Базы данных** → создать **PostgreSQL** (версия 16).
2. После создания скопируйте строку подключения. Соберите `DATABASE_URL` вида:
   ```
   postgresql://USER:PASSWORD@HOST:PORT/DBNAME?schema=public&sslmode=require
   ```
   `sslmode=require` обычно обязателен для управляемой БД Timeweb.
3. Миграции и сид прогонятся **автоматически** при первом старте API (`apps/api/start.sh`).

## Шаг 1. Приложение API (деплоим первым)

App Platform → **Создать приложение** →
- **Тип:** Docker Compose
- **Репозиторий:** `Aksenod2/edu-platform`, ветка `main` (включить авто-деплой)
- **Путь к директории проекта:** `deploy/api`
- **Переменные окружения** (см. таблицу ниже)
- Запустить деплой. После успеха скопировать публичный домен API → это `<API_URL>` (вида `https://platform-api-xxxx.twc1.net`).

После первого деплоя добавьте переменную `API_BASE_URL=<API_URL>` и передеплойте (нужно, чтобы ссылки на файлы были абсолютными).

### Переменные окружения API

| Переменная | Значение | Обяз. |
|---|---|---|
| `DATABASE_URL` | строка подключения из Шага 0 | ✅ |
| `PORT` | `4000` | ✅ |
| `HOST` | `0.0.0.0` | ✅ |
| `NODE_ENV` | `production` | ✅ |
| `JWT_SECRET` | длинная случайная строка (`openssl rand -hex 32`) | ✅ |
| `API_BASE_URL` | `<API_URL>` (после 1-го деплоя) | ✅ |
| `CORS_ORIGIN` | `<WEB_URL>` (заполнить после Шага 2) | ✅ |
| `JWT_EXPIRES_IN` | `15m` | ⬜ |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM` / `SMTP_USER` / `SMTP_PASS` | внешний SMTP (Resend/Brevo) — для писем и сброса пароля | ⬜ |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | web-push (`npx web-push generate-vapid-keys`) | ⬜ |
| `DEADLINE_REMINDER_HOURS` / `NOTIFICATION_RETENTION_DAYS` | тюнинг cron | ⬜ |

## Шаг 2. Приложение Web

App Platform → **Создать приложение** →
- **Тип:** Docker Compose
- **Репозиторий:** `Aksenod2/edu-platform`, ветка `main`
- **Путь к директории проекта:** `deploy/web`
- **Переменные окружения:**

| Переменная | Значение | Обяз. |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `<API_URL>` из Шага 1 | ✅ |

> `NEXT_PUBLIC_API_URL` зашивается в бандл **при сборке** (через build-arg в `deploy/web/docker-compose.yml`). Если поменяете адрес API — нужен **пересбор** web, рестарта мало.

После деплоя скопировать домен web → это `<WEB_URL>`.

## Шаг 3. Связать API и Web

Вернуться в приложение **API** → выставить `CORS_ORIGIN=<WEB_URL>` → передеплоить.

---

## После запуска

- Первый вход: `admin@platform.local` / `admin123` — **сразу сменить пароль** (создаётся сидом).
- Health-check API: `GET <API_URL>/health`.
- Логи деплоя и рантайма — во вкладке приложения в панели.

## Если сборка не видит `context: ../..`

Если App Platform не разрешит контекст выше папки проекта — фолбэк: один Compose-апп с обоими сервисами в корне (web получит главный домен, API будет на `:4000`). Тогда нужен отдельный root-compose без `volumes`. Напишите — соберём.
