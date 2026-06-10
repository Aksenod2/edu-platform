// Шаги 3–5: админ-блок «Согласия», диалог создания, мобилка 390, тёмная тема.
import { chromium } from '@playwright/test';

const PETR_ID = '5faeec36-745a-4730-a61f-e322435d8635';
const JOIN_URL = 'http://localhost:3060/join/OvI4NV9OYJVfQi1wyS4RVPhWFahntTD9tBXmTqQJgoY';

const browser = await chromium.launch();

{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:3060/login');
  await page.fill('#email', 'admin@platform.local');
  await page.fill('#password', 'admin123');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/(admin|change-password)/, { timeout: 30000 });
  console.log('3. После логина админа:', page.url());

  await page.goto(`http://localhost:3060/admin/students/${PETR_ID}?tab=profile`);
  await page.waitForSelector('h1');
  console.log('3. Заголовок карточки:', (await page.locator('h1').innerText()).trim());
  console.log(
    '3. Мета-строка:',
    (await page.locator('h1 + * , p.text-muted-foreground').first().innerText()).trim(),
  );
  await page.waitForSelector('text=Договор-оферта');
  const section = page.locator('section', { has: page.locator('h2:has-text("Согласия")') });
  const rows = await section.locator('tbody tr').count();
  console.log('3. Строк в таблице согласий:', rows);
  console.log(
    '3. Первая строка:',
    (await section.locator('tbody tr').first().innerText()).replace(/\s+/g, ' | ').slice(0, 160),
  );
  await section.screenshot({ path: '/tmp/shots/admin-consents.png' });

  // 4. Диалог создания студента с фамилией и телефоном.
  await page.goto('http://localhost:3060/admin/students');
  await page.getByRole('button', { name: 'Создать студента' }).click();
  await page.fill('#new-name', 'Новый');
  await page.fill('#new-last-name', 'Созданный');
  await page.fill('#new-phone', '+7 (903) 111-22-33');
  await page.fill('#new-email', 'created@test.local');
  await page.screenshot({ path: '/tmp/shots/admin-create-dialog.png' });
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.waitForSelector('text=Студент создан');
  console.log('4. Студент создан диалогом (фамилия+телефон)');

  // 4b. Невалидный телефон в диалоге.
  await page.getByRole('button', { name: 'Создать студента' }).click();
  await page.fill('#new-name', 'Кривой');
  await page.fill('#new-phone', 'abc');
  await page.fill('#new-email', 'bad-phone@test.local');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.waitForSelector('[data-slot="alert"]');
  console.log(
    '4b. Невалидный телефон в диалоге →',
    (await page.locator('[data-slot="alert"]').first().innerText()).trim().slice(0, 90),
  );
  await page.keyboard.press('Escape');

  // 4c. Пустое состояние согласий у созданного без инвайта.
  const createdRow = page.locator('tr', { hasText: 'created@test.local' });
  await createdRow.click();
  await page.waitForURL('**/admin/students/**');
  const url = new URL(page.url());
  await page.goto(`${url.origin}${url.pathname}?tab=profile`);
  await page.waitForSelector('text=Согласия не зафиксированы');
  console.log('4c. Пустое состояние: «Согласия не зафиксированы» показано');
  await page.close();
}

// 5. Мобилка 390 + тёмная тема (join).
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(JOIN_URL);
  await page.waitForSelector('#consent-offer');
  const noHScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  console.log('5. Мобилка 390: нет горизонтального скролла:', noHScroll);
  await page.screenshot({ path: '/tmp/shots/join-mobile-390.png', fullPage: true });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload();
  await page.waitForSelector('#consent-offer');
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  console.log('5. Тёмная тема активна (.dark):', isDark);
  await page.screenshot({ path: '/tmp/shots/join-mobile-dark.png', fullPage: true });
  await page.close();
}

await browser.close();
