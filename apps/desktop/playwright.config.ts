import { defineConfig } from '@playwright/test';

// Specs assert Chinese UI text; pin the language so results don't depend on the machine's locale.
process.env.EASYVIEW_DESKTOP_LANGUAGE ??= 'zh-CN';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Without this, a click on a missing/covered element waits for the whole test timeout.
  use: { actionTimeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // One retry on CI absorbs runner-load flakes (drag/drop pointer timing, save races); local runs stay strict.
  retries: process.env.CI ? 1 : 0,
});
