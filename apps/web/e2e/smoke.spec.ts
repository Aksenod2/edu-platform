import { test, expect, request as apiRequest, type Page } from '@playwright/test';

/**
 * @smoke — «замок выпуска» (эпик #174).
 *
 * Этот файл прогоняется БЛОКИРУЮЩИМ шагом в .github/workflows/vps-deploy.yml
 * против ЖИВОГО прода (E2E_BASE_URL=https://губу.рф) сразу после `up -d --build`.
 * Если хоть один @smoke красный — workflow падает и срабатывает авто-откат на
 * предыдущую версию (см. job rollback). Цель — перестать «чинить в проде».
 *
 * ПРАВИЛА этого набора:
 *  - сценарии должны быть БЫСТРЫМИ и СТАБИЛЬНЫМИ (никаких «иногда падает»);
 *  - анонимные сценарии НЕ требуют логина и тест-данных — работают на любом проде;
 *  - сценарии, требующие аккаунт, ГАТИРУЮТСЯ наличием секрета (skip, если нет),
 *    чтобы локальный/PR-прогон без секретов не краснел зря.
 *
 * Запуск только смоука:   playwright test --grep @smoke
 */

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Анонимные критичные сценарии (всегда выполняются)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('@smoke анонимные', () => {
  // Ловит «белый экран»: упавший рантайм Next, 500 от SSR, битый билд.
  test('@smoke главная отдаёт 200 и не белый экран', async ({ page }) => {
    const res = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(res, 'нет ответа на GET /').not.toBeNull();
    expect(res!.status(), `GET / вернул ${res!.status()}`).toBeLessThan(400);

    // Корень — клиентский редирект на /login (публичного лендинга нет).
    // Дожидаемся, пока окажемся на странице входа с её формой.
    await page.waitForURL('**/login', { timeout: 45_000 });

    // В <body> есть видимый контент (не пустой белый экран).
    const bodyText = (await page.locator('body').innerText()).trim();
    expect(bodyText.length, 'тело страницы пустое — похоже на белый экран').toBeGreaterThan(0);
  });

  // Ловит регресс формы логина (поля/кнопка пропали, упал компонент).
  test('@smoke страница логина рендерит поля и кнопку', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Вход в аккаунт')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
  });

  // Главная мина rewrite: /api-proxy/* должен отдавать JSON от API, а не HTML
  // (когда прокси-роут падает или NEXT_PUBLIC_API_URL не задан — приходит
  // HTML-страница ошибки Next и фронт «молча» ломается).
  test('@smoke /api-proxy/health отдаёт JSON, а не HTML', async ({ request }) => {
    const res = await request.get(`${BASE}/api-proxy/health`, { timeout: 30_000 });
    expect(res.status(), `health вернул ${res.status()}`).toBe(200);

    const contentType = res.headers()['content-type'] || '';
    expect(contentType, `content-type=${contentType} — похоже на HTML, прокси сломан`).toContain(
      'application/json',
    );

    const body = await res.json(); // упадёт, если это HTML
    expect(body.status).toBe('ok');
  });

  // Ловит фатальные ошибки рантайма на критичной странице (необработанные
  // исключения JS, провалившиеся чанки). НЕ придираемся к шумным warn/info.
  test('@smoke нет фатальных ошибок консоли на логине', async ({ page }) => {
    const fatal: string[] = [];
    page.on('pageerror', (err) => fatal.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // Отсекаем заведомо нефатальный шум (favicon, источники аналитики,
      // отменённые запросы при навигации). Список держим узким.
      if (/favicon|net::ERR_ABORTED|ResizeObserver/i.test(text)) return;
      fatal.push(`console.error: ${text}`);
    });

    await page.goto('/login', { waitUntil: 'networkidle' });
    expect(fatal, `фатальные ошибки на /login:\n${fatal.join('\n')}`).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Студенческий сценарий — ГАТИРОВАН секретами E2E_STUDENT_EMAIL/PASSWORD.
//    Без секретов — skip (локальный/PR-прогон не краснеет).
//    Именно этот сценарий поймал бы #172 (сохранение настроек уведомлений).
// ─────────────────────────────────────────────────────────────────────────────

const STUDENT_EMAIL = process.env.E2E_STUDENT_EMAIL;
const STUDENT_PASSWORD = process.env.E2E_STUDENT_PASSWORD;
const hasStudent = Boolean(STUDENT_EMAIL && STUDENT_PASSWORD);

async function loginAsStudent(page: Page) {
  await page.goto('/login');
  await page.locator('#email').fill(STUDENT_EMAIL!);
  await page.locator('#password').fill(STUDENT_PASSWORD!);
  await page.getByRole('button', { name: 'Войти' }).click();
  // Студент после входа может уйти на /consents или /change-password — для
  // смоука нужен «чистый» тест-аккаунт без долгов, ждём дашборд.
  await page.waitForURL('**/dashboard', { timeout: 45_000 });
}

test.describe('@smoke студент (гатирован секретами)', () => {
  test.skip(!hasStudent, 'нет E2E_STUDENT_EMAIL/E2E_STUDENT_PASSWORD — сценарий пропущен');

  // Регресс #172: тумблер уведомлений переключается и «Сохранить» доходит до
  // успешного тоста. Полный путь логин → настройки → переключить → сохранить.
  test('@smoke студент сохраняет настройки уведомлений', async ({ page }) => {
    await loginAsStudent(page);

    await page.goto('/dashboard/settings/notifications');
    await expect(
      page.getByRole('heading', { name: 'Настройки уведомлений' }),
    ).toBeVisible();

    // Переключаем мастер-тумблер «Все уведомления» (aria-label фиксирован в
    // компоненте notification-settings.tsx).
    const masterToggle = page.getByLabel('Все уведомления');
    await expect(masterToggle).toBeVisible();
    await masterToggle.click();

    await page.getByRole('button', { name: 'Сохранить' }).click();

    // Успех = тост «Настройки сохранены» (toast.success в компоненте).
    await expect(page.getByText('Настройки сохранены')).toBeVisible({ timeout: 15_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ЗАГОТОВКА под админский смоук — включится, когда заведём тест-админа
//    (секреты E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD). Сейчас всегда skip.
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const hasAdmin = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);

test.describe('@smoke админ (гатирован секретами)', () => {
  test.skip(!hasAdmin, 'нет E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD — админский смоук ещё не заведён');

  test('@smoke админ открывает дашборд', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill(ADMIN_EMAIL!);
    await page.locator('#password').fill(ADMIN_PASSWORD!);
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.waitForURL('**/admin', { timeout: 45_000 });
    await expect(page.getByText('Сообщения без ответа')).toBeVisible();
  });
});
