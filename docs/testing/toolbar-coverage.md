# Toolbar button coverage matrix

Every top-toolbar button of every file type, mapped to a test that asserts its **effect** (not just that it is clickable).
Desktop e2e specs live in `apps/desktop/e2e/` (`npm run test:e2e:desktop`), VS Code e2e in `apps/vscode-extension/e2e/` (`npm run test:e2e:vscode`). See [README.md](README.md) for the test layers.

**VS Code extension.** The extension renders the same `@easyview/editor-core` file header and `@easyview/preview-ui` viewers/toolbars as the desktop app. The desktop e2e therefore exercises the shared components for both. Extension-specific wiring is covered by its own tests, listed in the next section.

## VS Code extension
Only Save and Theme cross the webview → extension boundary. Print, Export/download and the sidebar toggle run entirely inside the webview, so they are asserted in real VS Code.

| Button | Asserted effect | Test |
|---|---|---|
| Save (xlsx) | bold, fill, border, merge, freeze and filter re-read from disk with ExcelJS | real VS Code e2e `apps/vscode-extension/e2e/toolbar.spec.ts`; unit `apps/vscode-extension/src/preview/filePreviewBridge.test.ts` (real `LazyWorkbook` serialiser → `writeBytes` handler → disk) |
| Save (docx) | `<w:b/>` written to `word/document.xml` | real VS Code e2e |
| Save, error paths | empty payload and read-only routes rejected, disk untouched; error surfaced in the webview | `filePreviewBridge.test.ts`, `previewWebviewBridge.test.ts` |
| Save, webview host | base64 payload, reply matched by id, descriptor size/mtime updated | `apps/vscode-extension/src/preview/previewWebviewBridge.test.ts` |
| Theme (per file) | `writePreviewFileTheme` persisted in workspaceState and restored on reopen; invalid modes ignored; the product-theme broadcast rethemes the document | both unit tests; real VS Code e2e (light → gray → dark → light) |
| Print | opens the print window and calls print() | real VS Code e2e (docx) |
| Export (download) | a `.docx` download is triggered | real VS Code e2e |
| Toggle sidebar | `data-preview-sidebar` toggles | real VS Code e2e |
| xlsx toolbar centre line | icon centres ≤ 0.5px off the toolbar centre (measured 0.00) | real VS Code e2e |

Run the VS Code e2e with `npm run test:e2e:vscode` (`apps/vscode-extension/scripts/run-e2e.mjs`, config `playwright.e2e.config.ts`). Set `EASYVIEW_SCREENSHOT_DIR` to also capture screenshots; the desktop counterpart is `apps/desktop/e2e/toolbar-screenshots.spec.ts`.

## Markdown (`toolbar-markdown.spec.ts`)
| Button | Asserted effect | Test |
|---|---|---|
| 大纲 (outline) | TOC sidebar opens and closes | view buttons |
| 源码模式 | source editor shown, then back to rich | view buttons |
| 全宽 | paragraph width grows, then restores | view buttons |
| 表格换行 | table cell wrap style toggles | view buttons |
| 折叠/展开 | headings fold and unfold | view buttons |
| 缩放 | editor font size changes, then resets | view buttons |
| 滚动到顶部/底部 | scrollTop moves to 0 / max | view buttons |
| 外部编辑跟随 | active state plus localStorage persisted | view buttons |
| 小签 | sticky note appears and is removed | view buttons |
| 变更视图 / 暂存 / 提交 | diff view shown; `git` index staged; commit created (checked with `git log`) | git … |
| 内置终端 | terminal modal opens and closes | git … |
| 历史面板 | `.history-panel` loses/gains `hidden`; button `active` | git … |
| 导出 (HTML) | file written via a stubbed save dialog | git … |
| 主题模式 | body class cycles through light/gray/dark back to the start | git … |
| 强调色 | `body[data-mdpre-accent]` changes, then restores | git … |
| 配置工具栏快捷键 | shortcuts modal opens and closes | git … |
| 更多操作 | collapsed buttons reached through the menu (the `byTitle` helper) | all |
| Title bar: 隐藏工具栏, IndexArea, 仓库, AI 对话 | toolbar hidden; editor left/right edge moves; active class | title bar |
| Cmd+S in a second tab | latest content saved to disk | `tabs.spec.ts` |

## DOCX / DOCM (`toolbar-docx.spec.ts`)
Every control, with the saved `document.xml` checked after save:
- Character formatting: B, I, U, S, text colour, highlight/shading, subscript, size (sz 40), font (Georgia).
- Paragraph: line spacing, indent, alignment (center, right, justify), paragraph style (Heading1), list (numPr).
- Insert: link (hyperlink).
- Also: undo/redo, export download, print (opens a window and calls print), theme, sidebar toggle (first position).
- Second test: centre-line alignment and bordered-control containment for DOCX and XLSX.

## XLSX (`xlsx-toolbar.spec.ts`)
Every x-spreadsheet button is checked by its persisted cell style, re-read with ExcelJS after Save:
- Font and alignment: bold, italic, underline, strike, colour, background, font, size.
- Borders: border-all.
- Alignment: left/center, middle/top, wrap, merge.
- Format: clear format, paint format.
- Sheet: freeze, autofilter, functions (formula).

The same spec also covers:
- Format dropdowns, Save, theme, and the More menu at 760px.
- The overflow button never covering the chrome at 700/900px.
- Print preview opens and cancels.
- The sheet bar: 24px high, no vertical scrollbar.

## Preview types (`toolbar-preview.spec.ts`)
| Type | Buttons covered |
|---|---|
| csv, tsv, ods | search, zoom, download, theme |
| doc | sidebar, search, zoom, download, print (直接 + 遮罩/盖章 designer), open as HTML, theme |
| pdf | the doc set plus zoom reset |
| xmind | the pdf set |
| drawio | search, zoom, download, print, HTML, theme |
| png, jpg | zoom, download, print, HTML, theme |
| tiff | the png set plus rotate (angle label 0° → 90° → 0° → turned) |
| pptx | the doc set plus slideshow |
| epub, psd, ttf | search, download, HTML, theme |
| html | source/preview toggle, theme |
| http | 发送: a loopback request is refused by the private-address guard before connecting; theme |
| heic | theme; the sandboxed decoder iframe must render (its script is inlined at build time) |
| mp4, m4v; mp3, m4a, wav, ogg, flac | theme; playback uses EasyView's own player controls (see Media below) |
| json, svg, zip, tar, tgz, yaml, txt, ppt, class | theme (the only button) |

Content-area controls (epub 目录/翻页, psd layer toggles, archive 导出) are not in the top toolbar and are not covered here. `.icns` currently falls back to "unsupported" and is not listed.

## Preview refresh (`preview-refresh.spec.ts`)
- Clicking an already-open xlsx preview in IndexArea keeps the rendered spreadsheet node (no re-render).
- Rewriting the xlsx on disk reloads the visible preview; rewriting a txt shows the new text.

## Media and Cursor rules
- Desktop `preview-media.spec.ts` and VS Code `e2e/media.spec.ts`: an H.264/AAC mp4 loads, plays and (Desktop) seeks via byte ranges.
- The same specs play the sample mp3: the live spectrum canvas rises while playing (Desktop: and falls back after pausing). Output goes through a zero-gain node, so the run is silent.
- Desktop: while a video plays, its control bar hides once the pointer leaves and returns when it comes back; paused videos keep it visible.
- The same specs open a `.mdc` rule in the Markdown editor: heading, bold text and the front-matter grid render, and the file on disk is unchanged.

Code files (`.ts` etc.) open in the Markdown/code editor and are covered by the Markdown header tests.

## Unit tests (wiring with no e2e path)
- `packages/preview-ui/src/viewers/spreadsheetToolbarReserve.test.ts`: `reserveToolbarChrome` width reservation, detach behaviour, idempotency, and resize re-layout.
- `packages/preview-ui/src/spreadsheet/lazyWorkbookToolbarRoundTrip.test.ts`: x-spreadsheet style ↔ workbook round-trip.
- `packages/editor-core/src/ui/FileHeader.lifecycle.test.ts`: file header lifecycle.
- `apps/vscode-extension/src/preview/filePreviewBridge.test.ts` and `previewWebviewBridge.test.ts`: the extension Save/Theme bridge (see the VS Code section).
