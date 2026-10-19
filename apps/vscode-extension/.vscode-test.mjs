import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@vscode/test-cli';

const extensionDirectory = path.dirname(fileURLToPath(import.meta.url));
const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH;

export default defineConfig({
  files: 'e2e/**/*.test.js',
  extensionDevelopmentPath: extensionDirectory,
  // Each run gets an empty workspace; the suites create their own fixtures.
  workspaceFolder: mkdtempSync(path.join(tmpdir(), 'easyview-vscode-e2e-')),
  launchArgs: [
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
  ],
  ...(vscodeExecutablePath
    ? { useInstallation: { fromPath: vscodeExecutablePath } }
    : {}),
  mocha: {
    timeout: 45_000,
  },
});
