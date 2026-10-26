# Desktop preview smoke fixtures

For realistic documents, use the repo's `samples/` first (see `tests/fixtures/sampleFiles.ts`). Add a file here only when a test needs exact content or a format that `samples/` does not have.

Small local fixtures for targeted Desktop preview verification. The legacy `.doc`, `.ppt`, and `.ods` files were generated from the corresponding source fixtures for parser smoke tests only. Runtime implementation must remain independent of LibreOffice.

Use the existing repository assets for ICNS and font preview checks:

- `apps/desktop/assets/icon.icns`
- `resources/editor/fonts/NotoSansSymbols2-Regular.ttf`
