import { test, expect } from '@playwright/test';

test.describe('Страница входа', () => {
  test('пароль: «глазик» переключает видимость', async ({ page }) => {
    await page.goto('/login');
    const pwd = page.locator('#password');
    await pwd.fill('secret123');
    await expect(pwd).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Показать пароль' }).click();
    await expect(pwd).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: 'Скрыть пароль' }).click();
    await expect(pwd).toHaveAttribute('type', 'password');
  });

  test('ошибка входа показывается как сообщение (role=alert)', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@platform.local');
    await page.locator('#password').fill('wrong-password');
    await page.getByRole('button', { name: 'Войти' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    // Это сообщение об ошибке, а не интерактивная кнопка.
    await expect(alert).toHaveAttribute('role', 'alert');
  });
});
