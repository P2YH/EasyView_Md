import { defineConfig } from '@playwright/test';

/** Playwright suites that drive a real VS Code window (toolbar, timeline). See scripts/run-e2e.mjs. */
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: { actionTimeout: 20_000 },
  workers: 1,
  retries: 0,
});
