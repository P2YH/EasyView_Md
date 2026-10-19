import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../tests/e2e/vscode-extension',
  testMatch: 'toolbar.spec.ts',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: { actionTimeout: 20_000 },
  workers: 1,
  retries: 0,
});
