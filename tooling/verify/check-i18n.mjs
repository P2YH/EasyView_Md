// Fails when user-facing Chinese text is hard-coded outside *.i18n.ts message catalogs.
// Mark intentional non-UI Chinese (parsing rules, AI prompts, fixtures) with an `i18n-ignore`
// comment on the same or previous line, or `i18n-ignore-file` anywhere in the file.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_ROOTS = ['apps/desktop/src', 'apps/vscode-extension/src', ...(await readdir(path.join(root, 'packages'))).map((name) => `packages/${name}/src`)];
const HAN = /\p{Script=Han}/u;

function isCheckedFile(file) {
  if (/\.(?:test|spec)\.ts$|\.d\.ts$|\.i18n\.ts$/.test(file)) return false;
  return /\.(?:ts|html)$/.test(file);
}

async function walk(directory, files = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') await walk(full, files);
    } else if (isCheckedFile(full)) {
      files.push(full);
    }
  }
  return files;
}

function ignoredLines(text) {
  const lines = text.split('\n');
  const ignored = new Set();
  lines.forEach((line, index) => {
    if (line.includes('i18n-ignore')) {
      ignored.add(index);
      ignored.add(index + 1);
    }
  });
  return ignored;
}

function tsViolations(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const ignored = ignoredLines(text);
  const found = [];
  const visit = (node) => {
    const isText = ts.isStringLiteral(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node)
      || ts.isTemplateTail(node)
      || ts.isJsxText(node);
    if (isText && HAN.test(node.text)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      if (!ignored.has(line)) found.push({ line: line + 1, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function htmlViolations(text) {
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
  const ignored = ignoredLines(text);
  return withoutComments.split('\n').flatMap((line, index) =>
    HAN.test(line) && !ignored.has(index) ? [{ line: index + 1, text: line.trim() }] : []);
}

const violations = [];
for (const sourceRoot of SOURCE_ROOTS) {
  for (const file of await walk(path.join(root, sourceRoot))) {
    const text = await readFile(file, 'utf8');
    if (!HAN.test(text) || text.includes('i18n-ignore-file')) continue;
    const found = file.endsWith('.html') ? htmlViolations(text) : tsViolations(file, text);
    for (const item of found) violations.push(`${path.relative(root, file)}:${item.line}: ${item.text.slice(0, 80)}`);
  }
}

if (violations.length > 0) {
  console.error(`Hard-coded Chinese UI text found (${violations.length}). Move it into a *.i18n.ts catalog or mark it with i18n-ignore:`);
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log('i18n check passed');
