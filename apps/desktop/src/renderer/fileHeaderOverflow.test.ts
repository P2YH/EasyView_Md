/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const css = readFileSync(path.join(__dirname, 'desktop.css'), 'utf8');

function ruleBody(selector: string): string {
  const idx = css.indexOf(selector);
  expect(idx, `missing selector ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

it('keeps Markdown accent/export dropdowns unclipped while the toolbar is expanded', () => {
  const expanded = ruleBody('.easyview-desktop .file-header-bar');
  expect(expanded).toMatch(/overflow:\s*visible/);
  expect(expanded).not.toMatch(/overflow:\s*hidden/);

  const collapsed = ruleBody('.easyview-desktop.desktop-toolbar-hidden .file-header-bar');
  expect(collapsed).toMatch(/overflow:\s*hidden/);
});
