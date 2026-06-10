// Финальный прогон: гонка тумблера (фикс), занятый email, админ-блок «Согласия»,
// диалог создания студента с фамилией/телефоном, мобилка 390, тёмная тема.
import { chromium } from '@playwright/test';

const PETR_ID = '5faeec36-745a-4730-a61f-e322435d8635';
const JOIN_URL = 'http://localhost:3060/join/OvI4NV9OYJVfQi1wyS4RVPhWFahntTD9tBXmTqQJgoY';

const browser = await chromium.launch();

// ── 1. Гонка тумблера: тот же быстрый сценарий, что падал до фикса ──
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:3060/login');
  await page.fill('#email', 'invitee@test.local');
  await page.fill('#password', 'secret123');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL('**/dashboard**');
  await page.goto('http://localhost:3060/dashboard/profile');
  const toggle = page.locator('#marketing-toggle');
  await toggle.waitFor();
  await page.waitForFunction(() => !document.querySelector('#marketing-toggle[disabled]'));
  console.log('1. Тумблер старт:', await toggle.getAttribute('data-state'));
  await toggle.click();
  await page.waitForSelector('text=Согласие на рекламно-информационные материалы дано');
  await page.waitForFunction(
    () => document.querySelector('#marketing-toggle')?.getAttribute('data-state') === 'checked',
  );
  await toggle.click();
  await page.waitForSelector('text=Согласие на рекламно-информационные материалы отозвано');
  await page.waitForFunction(
    () => document.querySelector('#marketing-toggle')?.getAttribute('data-state') === 'unchecked',
    null,
    { timeout: 10000 },
  );
  console.log('1. Быстрый цикл granted→revoked: тумблер вернулся в unchecked — гонка устранена');
  await page.close();
}

// ── 2. Занятый email на join (паритет со старым поведением) ──
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(JOIN_URL);
  await page.waitForSelector('#name');
  await page.fill('#name', 'Дубль');
  await page.fill('#lastName', 'Дублёв');
  await page.fill('#phone', '+79990000002');
  await page.fill('#email', 'petr@test.local'); // уже зарегистрирован
  await page.fill('#password', 'secret123');
  await page.fill('#confirmPassword', 'secret123');
  await page.click('#consent-offer');
  await page.click('#consent-personal-data');
  await page.click('#consent-service');
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await page.waitForSelector('[data-slot="alert"]');
  console.log('2. Занятый email →', (await page.locator('[data-slot="alert"]').innerText()).trim());
  await page.close();
}

// ── 3+4. Админ: блок «Согласия» в карточке + диалог создания ──
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:3060/login');
  await page.fill('#email', 'admin@platform.local');
  await page.fill('#password', 'admin123');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL('**/admin**');

  await page.goto(`http://localhost:3060/admin/students/${PETR_ID}?tab=profile`);
  await page.waitForSelector('h1');
  console.log('3. Заголовок карточки:', (await page.locator('h1').innerText()).trim());
  await page.waitForSelector('text=Согласия');
  await page.waitForSelector('text=Договор-оферта');
  const rows = await page.locator('section:has(h2:has-text("Согласия")) tbody tr').count();
  console.log('3. Строк в таблице согласий:', rows);
  const ipCell = await page
    .locator('section:has(h2:has-text("Согласия")) tbody tr')
    .first()
    .innerText();
  console.log('3. Первая строка:', ipCell.replace(/\s+/g, ' ').slice(0, 140));
  await page
    .locator('section:has(h2:has-text("Согласия"))')
    .screenshot({ path: '/tmp/shots/admin-consents.png' });

  // Пустое состояние: админ сам без согласий — смотрим его консенты через карточку другого юзера?
  // Проще: участник без согласий — admin teacher@? Берём второго админа нельзя (карточки только студентов).
  // Создаём студента диалогом с фамилией и телефоном (4) и открываем его карточку (пустое состояние).
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

  // Пустое состояние блока согласий у только что созданного.
  const createdId = await page.evaluate(async () => {
    const res = await fetch('/api-proxy/users', {
      headers: { Authorization: 'Bearer ' + '' },
    });
    return null; // id вытащим из БД на шаге Bash
  });
  await page.close();
}

// ── 5. Мобилка 390 + тёмная тема (join) ──
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(JOIN_URL);
  await page.waitForSelector('#consent-offer');
  const noHScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  console.log('5. Мобилка 390: нет горизонтального скролла:', noHScroll);
  await page.screenshot({ path: '/tmp/shots/join-mobile-390.png', fullPage: true });

  // Тёмная тема через next-themes (localStorage + класс .dark).
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
