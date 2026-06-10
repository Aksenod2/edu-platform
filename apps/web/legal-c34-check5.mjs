// Личные данные участника: сохранение фамилии/телефона + невалидный телефон.
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('http://localhost:3060/login');
await page.fill('#email', 'invitee@test.local');
await page.fill('#password', 'secret123');
await page.getByRole('button', { name: 'Войти' }).click();
await page.waitForURL('**/dashboard**');
await page.goto('http://localhost:3060/dashboard/profile');
await page.waitForSelector('#last-name');

// Невалидный телефон → тост ошибки, ничего не сохраняется.
await page.fill('#phone', '+7abc');
await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
await page.waitForSelector('text=Телефон должен быть в международном формате');
console.log('Профиль: невалидный телефон отбит тостом');

// Валидные данные → сохранение.
await page.fill('#last-name', 'Инвайтова-Новая');
await page.fill('#phone', '+7 905 000-99-88');
await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
await page.waitForSelector('text=Личные данные сохранены');
console.log('Профиль: личные данные сохранены');
console.log('Поле телефона после сохранения:', await page.inputValue('#phone'));
await page.screenshot({ path: '/tmp/shots/profile-personal.png', fullPage: true });
await browser.close();
