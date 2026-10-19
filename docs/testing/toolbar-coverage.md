# Toolbar button coverage matrix

Every top-toolbar button of every file type, mapped to a test that asserts its **effect** (not just that it is clickable).
Desktop e2e specs live in `apps/desktop/e2e/`; run them with `npm run test:e2e --workspace @easyview/desktop`.

**VS Code extension.** The extension renders the same `@easyview/editor-core` file header and `@easyview/preview-ui` viewers/toolbars as the desktop app. The desktop e2e therefore exercises the shared components for both. Extension-specific wiring that has no Electron equivalent is covered by unit tests (see the last section).

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
| csv | search, zoom, download, theme |
| doc | sidebar, search, zoom, download, print (直接 + 遮罩/盖章 designer), open as HTML, theme |
| pdf | the doc set plus zoom reset |
| png (images) | zoom, download, print, HTML, theme |
| pptx | the doc set plus slideshow |
| html | source/preview toggle, theme |
| json, svg, zip, txt | theme (the only button) |

Code files (`.ts` etc.) open in the Markdown/code editor and are covered by the Markdown header tests.

## Unit tests (wiring with no e2e path)
- `packages/preview-ui/tests/spreadsheetToolbarReserve.test.ts`: `reserveToolbarChrome` width reservation, detach behaviour, idempotency, and resize re-layout.
- `packages/preview-ui/tests/lazyWorkbookToolbarRoundTrip.test.ts`: x-spreadsheet style ↔ workbook round-trip.
- `packages/editor-core/src/ui/FileHeader.lifecycle.test.ts`: file header lifecycle.
