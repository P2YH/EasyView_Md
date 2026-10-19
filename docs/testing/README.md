# Testing

## Where tests live

| Kind | Location | Runner |
|---|---|---|
| Unit | next to the code: `apps/*/src/**/*.test.ts`, `packages/*/src/**/*.test.ts` (`src/__tests__/` only when a test has no single owner) | Vitest. The root `vitest.config.ts` finds them by glob; jsdom suites opt in with `// @vitest-environment jsdom` |
| Desktop e2e | `apps/desktop/e2e/*.spec.ts` (helpers in `e2e/support/`) | Playwright + Electron, `apps/desktop/playwright.config.ts ` |
| VS Code extension e2e | `apps/vscode-extension/e2e/*.test.js` (extension host, `@vscode/test-cli`, `.vscode-test.mjs`) and `apps/vscode-extension/e2e/*.spec.ts` (Playwright drives a real VS Code window, `playwright.e2e.config.ts`) | `apps/vscode-extension/scripts/run-e2e.mjs` runs both against one VS Code build |
| Shared fixtures | `tests/fixtures/` | — |

Unit tests never ship: the extension bundles only esbuild entry points and `.vscodeignore` drops `src/**` and `e2e/**`; desktop Forge packaging keeps only the built `dist/`.

## Layers

| Layer | What | Command | Workflow (trigger) |
|---|---|---|---|
| 1. Quick checks | typecheck, lint, architecture/i18n/brand checks, build, **all** unit tests | `npm run verify:quick` | `ci.yml`: ubuntu, push to `main`, PRs |
| 2a. Desktop e2e | desktop build, Electron e2e, package/runtime checks | `npm run test:e2e:desktop` | `desktop-build.yml`: macos-14 + windows-latest, push to `main`, PRs |
| 2b. Extension e2e | vscode-test suites + Playwright VS Code suites (xvfb), then VSIX package + verify | `npm run test:e2e:vscode` | `extension-e2e.yml`: ubuntu, push to `main`, PRs |
| 3. Release gate | the tagged commit must already have green layer 1 + 2 runs; nothing is re-run | `npm run check:release-gate -- --sha <commit>` | `release.yml` job `ci-gate` (`actions: read`). Waits up to 50 min for runs in progress. `workflow_dispatch` input `skip_ci_gate` is the emergency override |
| 4. Install smoke | install/uninstall the built installers on clean runners | — | the `release.yml` build jobs (`.github/scripts/*-install-test.*`), `windows-smoke-test.yml` |

## Local commands

```bash
npm run verify:quick       # layer 1
npm run test:unit          # unit tests only (root vitest.config.ts)
npm run test:e2e:desktop   # layer 2a
npm run test:e2e:vscode    # layer 2b (macOS uses the installed VS Code; elsewhere a cached download; Linux needs xvfb-run)
npm run test:e2e:all       # 2a + 2b
npm run verify:release     # verify:quick + test:e2e:all, run before tagging
npm run check:release-gate -- --sha <commit>   # same check the release job runs (needs gh auth)
```

Toolbar button coverage is tracked in [toolbar-coverage.md](toolbar-coverage.md).
