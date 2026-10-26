# Testing

## Where tests live

| Kind | Location | Runner |
|---|---|---|
| Unit | next to the code: `apps/*/src/**/*.test.ts`, `packages/*/src/**/*.test.ts` (`src/__tests__/` only when a test has no single owner) | Vitest. The root `vitest.config.ts` finds them by glob; jsdom suites opt in with `// @vitest-environment jsdom` |
| Desktop e2e | `apps/desktop/e2e/*.spec.ts` (helpers in `e2e/support/`) | Playwright + Electron, `apps/desktop/playwright.config.ts ` |
| VS Code extension e2e | `apps/vscode-extension/e2e/*.spec.ts` (Playwright drives a real VS Code window, `playwright.e2e.config.ts`) and `apps/vscode-extension/e2e/*.test.js` (Mocha suites inside the extension host, launched by `extension-host.spec.ts`) | `apps/vscode-extension/scripts/run-e2e.mjs`: the local VS Code install on macOS, else `$VSCODE_EXECUTABLE_PATH` or a downloaded stable build |
| Shared fixtures | `tests/fixtures/` | — |
| Sample documents | `样例文件/` (中文 + English docx/doc/xlsx/pptx/pdf/xmind/zip/png/md/mdc/mp4/mp3/html), helper `tests/fixtures/sampleFiles.ts` | — |

## Sample documents (`样例文件/`)
Use the repo's `样例文件/` whenever a test needs a realistic document, instead of building one in the test.
- `tests/fixtures/sampleFiles.ts` exports `SAMPLE_FILES_DIR`, `copySampleFiles(target)` and `listSampleFiles()`.
- Desktop e2e: every `launchPreviewWorkspace()` workspace already contains a copy under `样例文件/` (`SAMPLE_WORKSPACE_FOLDER`), so `ws.open('样例文件/中文/示例文档.docx')` works without setup.
- `apps/desktop/e2e/sample-files.spec.ts` opens every sample and fails on an error, an "unsupported" message, or nothing rendered.
- The owner keeps editing these files. Tests copy them into a temporary directory, never write to the originals, and assert behaviour rather than exact content.
- Exact-content assertions and formats that are not in `样例文件/` (csv, heic, …) use `tests/fixtures/preview/`.
- `示例音频.mp3` / `Sample Audio.mp3` is Giuseppe Ferrata, *Album Leaves, Gavotte Op. 11 No. 1* (public domain), from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Album_Leaves_Gavotte_Op._11_No._1.mp3).
- `示例视频.mp4` / `Sample Video.mp4` is a 20-second excerpt (1:02–1:22) of NASA Johnson, *Earth Illuminated: ISS Time-lapse Photography* (public domain), from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Earth_Illuminated-_ISS_Time-lapse_Photography.webm), re-encoded as H.264/AAC 1280×720. Its original soundtrack is replaced with the first 20 seconds of the sample MP3.
- `示例PDF文档.pdf` / `Sample PDF Document.pdf` is an 8-page A4 white paper written for these samples and printed from HTML with Chromium. It has a PDF outline (6 chapters, 13 sections), a linked contents page, tables, SVG charts, a code block, the sample photo, and page headers and footers.
- `示例截图.png` / `Sample Screenshot.png` is National Park Service, *Oolah Valley* (NPS Photo/Cadence Cook, public domain), from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Oolah_Valley_(16089307144).jpg), scaled to 1600 px wide and saved as PNG.

Unit tests never ship: the extension bundles only esbuild entry points and `.vscodeignore` drops `src/**` and `e2e/**`; desktop Forge packaging keeps only the built `dist/`.

## Layers

| Layer | What | Command | Workflow (trigger) |
|---|---|---|---|
| 1. Quick checks | typecheck, lint, architecture/i18n/brand checks, build, **all** unit tests | `npm run verify:quick` | `ci.yml`: ubuntu, push to `main`, PRs |
| 2a. Desktop e2e | desktop build, Electron e2e, package/runtime checks, DMG / NSIS install smoke | `npm run test:e2e:desktop` | `desktop-build.yml`: macos-14 + windows-latest, push to `main`, PRs |
| 2b. Extension e2e | Playwright VS Code suites, extension-host suites included (xvfb), then VSIX package + verify | `npm run test:e2e:vscode` | `extension-e2e.yml`: ubuntu, push to `main`, PRs |
| 3. Release gate | the tagged commit must already have green layer 1 + 2 runs; nothing is re-run | `npm run check:release-gate -- --sha <commit>` | `release.yml` job `ci-gate` (`actions: read`). Waits up to 50 min for runs in progress. `workflow_dispatch` input `skip_ci_gate` is the emergency override |
| 4. Install smoke | install/uninstall the built installers on clean runners | — | `desktop-build.yml` and the `release.yml` build jobs (`.github/scripts/*-install-test.*`) |

## Background mode (local e2e)
Local e2e runs don't disturb the person using the machine:
- Desktop: `playwright.config.ts` sets `EASYVIEW_E2E_BACKGROUND=1`. EasyView then never shows its windows (print windows included), never takes focus, and has no Dock icon; rendering stays unthrottled. `background-mode.spec.ts` guards this.
- VS Code: `keepElectronInBackground()` (`apps/desktop/e2e/support/electronApp.ts`) makes the test VS Code window fully transparent and click-through, stops it taking focus, and hides its Dock icon. Hiding the window isn't an option: VS Code re-shows hidden windows and its webviews stop painting. The extension-host suites (`e2e/*.test.js`) run under it too, so tests can't rely on the window having OS focus. Before a focus-routed command such as `undo`, move keyboard focus explicitly (for example `workbench.action.focusActiveEditorGroup`).
- `image-paste.spec.ts` needs the real system clipboard; it saves the user's clipboard (text, HTML, RTF, image) first and restores it afterwards.
- CI keeps real windows. Set `EASYVIEW_E2E_HEADED=1` to watch a local run.

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
