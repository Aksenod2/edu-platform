import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// В этом окружении Chromium предустановлен Playwright'ом по фиксированному пути
// (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers), но его сборка не совпадает с той,
// что ожидает версия @playwright/test. Поэтому при наличии бинаря указываем его
// напрямую через executablePath; на других машинах Playwright возьмёт свой.
const localChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const launchOptions = existsSync(localChromium)
  ? { executablePath: localChromium }
  : {};

// ВНИМАНИЕ: тесты логинятся в каждом сценарии, а /auth/* по умолчанию ограничен
// 10 запросами в минуту. Перед прогоном поднимите лимит для API:
//   AUTH_RATE_LIMIT_MAX=1000 (см. .env), иначе будут 429 и редирект на /login.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    launchOptions,
  },
});
