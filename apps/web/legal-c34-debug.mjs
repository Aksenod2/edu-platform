// Дебаг тумблера маркетинга: логируем ответы GET /users/me/consents.
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('response', async (res) => {
  if (res.url().includes('/users/me/consents') && res.request().method() === 'GET') {
    const body = await res.json().catch(() => null);
    const list = body?.consents?.map((c) => `${c.consentType}:${c.action}@${c.createdAt}`) ?? [];
    console.log('GET consents →', list.slice(0, 3).join(' | '));
  }
  if (res.url().includes('/consents/marketing')) {
    console.log('POST marketing →', res.status(), await res.text().catch(() => ''));
  }
});

await page.goto('http://localhost:3060/login');
await page.fill('#email', 'invitee@test.local');
await page.fill('#password', 'secret123');
await page.getByRole('button', { name: 'Войти' }).click();
await page.waitForURL('**/dashboard**');
await page.goto('http://localhost:3060/dashboard/profile');
await page.waitForSelector('#marketing-toggle');
await page.waitForTimeout(2000);

const state = () => page.locator('#marketing-toggle').getAttribute('data-state');
console.log('Начальное состояние тумблера:', await state());

await page.locator('#marketing-toggle').click();
await page.waitForTimeout(3000);
console.log('После клика #1:', await state());

await page.locator('#marketing-toggle').click();
await page.waitForTimeout(3000);
console.log('После клика #2:', await state());

await browser.close();
