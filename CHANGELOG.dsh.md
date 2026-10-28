# DSH adaptation release notes

## 2026-10-28 — development source integration

- Extract the browser workbench into `@easyview/workbench-core`, shared by the existing desktop application and the independent `dsh-plugin-easyview` package.
- Expose `easyview.workbench` through the public DSH Factory API. Office owns navigation; the adapter provides workspace files, draft recovery, explicit saves and file history without launching Electron.
- Preserve the existing editor, format viewers and AI panel. Add durable text-editor lifecycle, DOCX/XLSX checkpoints, and proposal apply/reject/undo recovery.
- Add DSH workspace menu actions, welcome-page restoration, default AI sidebar visibility, scoped Office colors, and capability-driven welcome actions.
- Update contracts, build inputs, architecture checks and tests. Redirect extension tests to the extracted workspace explorer.
- Retain upstream licensing and the original repository as `upstream`; maintain the DSH changes in the P2YH fork.

This is a development integration. Format coverage, native OS picker automation, complete real-model UI coverage and offline release acceptance remain limited as documented in `apps/dsh-plugin/docs/acceptance.md` and `agent-progress.md`. Local raw acceptance artifacts are excluded from source commits.

Validated for this integration: workspace and DSH plugin typechecks, DSH plugin and desktop builds, architecture and localization checks, 219 browser regressions across 53 files, and 40 DSH Host tests. These checks use controlled fixtures and do not imply complete real-model or offline acceptance.
