import { test, expect, request as apiRequest, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const ADMIN = { email: 'admin@platform.local', password: 'admin123' };

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.locator('#password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL('**/admin', { timeout: 45_000 });
}

// Гарантируем, что есть хотя бы один поток — без него страницы «Уроки»/«Расписание»
// показывают пустую заглушку и нечего проверять.
test.beforeAll(async () => {
  const ctx = await apiRequest.newContext({ baseURL: BASE });
  const login = await ctx.post('/api-proxy/auth/login', { data: ADMIN });
  const { accessToken } = await login.json();
  const headers = { Authorization: `Bearer ${accessToken}` };
  const res = await ctx.get('/api-proxy/streams', { headers });
  const { streams } = await res.json();
  if (!streams || streams.length === 0) {
    await ctx.post('/api-proxy/streams', { headers, data: { name: 'E2E Поток' } });
  }
  await ctx.dispose();
});

test.describe('Админ-кабинет', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('дашборд: блок «Сообщения без ответа» (без «Треды без ответа»)', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('Сообщения без ответа')).toBeVisible();
    await expect(page.getByText('Треды без ответа')).toHaveCount(0);
  });

  test('уроки: кнопка «Добавить урок» доступна в режиме «Все потоки»', async ({ page }) => {
    await page.goto('/admin/lessons');
    await expect(page.getByRole('button', { name: 'Добавить урок' })).toBeVisible();
  });

  test('уроки: переключатель «Календарь» показывает календарь', async ({ page }) => {
    await page.goto('/admin/lessons');
    await page.getByRole('button', { name: 'Календарь' }).click();
    await expect(page.getByRole('button', { name: 'Сегодня' })).toBeVisible();
  });

  test('сообщения: есть «Чаты групп», нет вкладки «Группы»', async ({ page }) => {
    await page.goto('/admin/messages');
    const tablist = page.getByRole('tablist');
    await expect(tablist.getByRole('tab', { name: 'Чаты групп' })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: 'Группы', exact: true })).toHaveCount(0);
  });

  test('профиль: блок «Аватар» с загрузкой фото', async ({ page }) => {
    await page.goto('/admin/profile');
    await expect(page.getByText('Аватар', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Загрузить фото' })).toBeVisible();
  });
});
