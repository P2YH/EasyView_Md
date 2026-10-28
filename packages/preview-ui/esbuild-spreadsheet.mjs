import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageFile = require.resolve('x-data-spreadsheet/package.json');
const root = path.dirname(packageFile);
const lifecycle = JSON.stringify(fileURLToPath(new URL('./src/spreadsheet/spreadsheetLifecycle.ts', import.meta.url)));

function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('Spreadsheet lifecycle integration needs review: source changed');
  return source.replace(from, to);
}

/** Compile the pinned engine with explicit ownership at its two event registration points. */
export function spreadsheetLifecyclePlugin() {
  return {
    name: 'spreadsheet-lifecycle',
    setup(build) {
      build.onResolve({ filter: /^x-data-spreadsheet\/dist\/xspreadsheet\.js$/ }, async () => {
        if (JSON.parse(await readFile(packageFile, 'utf8')).version !== '1.1.9') throw new Error('Review spreadsheet lifecycle integration before upgrading x-data-spreadsheet');
        return { path: path.join(root, 'src/index.js') };
      });
      build.onLoad({ filter: /x-data-spreadsheet[\\/]src[\\/].*\.js$/ }, async args => {
        let source = await readFile(args.path, 'utf8');
        const relative = path.relative(root, args.path).split(path.sep).join('/');
        if (relative === 'src/index.js') {
          source = `/*! ${await readFile(path.join(root, 'LICENSE'), 'utf8')} */\nimport { SpreadsheetLifecycle } from ${lifecycle};\n${source}`;
          source = replaceOnce(source, "import './index.less';", '');
          source = replaceOnce(source, '  constructor(selectors, options = {}) {', '  constructor(selectors, options = {}) {\n    this.lifecycle = new SpreadsheetLifecycle();\n    const leave = this.lifecycle.enter();\n    try {');
          source = replaceOnce(source, '    targetEl.appendChild(rootEl.el);', '    targetEl.appendChild(rootEl.el);\n    this.lifecycleRoot = rootEl.el;');
          source = replaceOnce(source, '  }\n\n  addSheet(', `    } catch (error) { this.lifecycle.dispose(); this.lifecycleRoot?.remove(); throw error; } finally { leave(); }\n  }\n\n  destroy() {\n    this.lifecycle.dispose();\n    this.lifecycleRoot.remove();\n    this.datas.length = 0;\n    this.data = this.sheet = this.bottombar = null;\n  }\n\n  addSheet(`);
          source = replaceOnce(source, '  reRender() {', `  commitInput() {\n    const editor = this.sheet.editor;\n    if (editor.areaOffset !== null) {\n      editor.change('finished', editor.textEl.val());\n      editor.inputText = '';\n      editor.clear();\n    }\n  }\n\n  reRender() {`);
          source = replaceOnce(source, 'const spreadsheet = (el, options = {}) => new Spreadsheet(el, options);', `for (const name of Object.getOwnPropertyNames(Spreadsheet.prototype)) {\n  if (name === 'constructor' || name === 'destroy') continue;\n  const method = Spreadsheet.prototype[name];\n  if (typeof method === 'function') Spreadsheet.prototype[name] = function (...args) { return this.lifecycle.run(() => method.apply(this, args)); };\n}\nconst spreadsheet = (el, options = {}) => new Spreadsheet(el, options);`);
        }
        if (relative === 'src/component/event.js') {
          source = `import { bindSpreadsheetEvent, unbindSpreadsheetEvent } from ${lifecycle};\n${source}`;
          source = replaceOnce(source, 'target.addEventListener(name, fn);', 'bindSpreadsheetEvent(target, name, fn);');
          source = replaceOnce(source, 'target.removeEventListener(name, fn);', 'unbindSpreadsheetEvent(target, name, fn);');
        }
        if (relative === 'src/component/element.js') {
          source = `import { bindSpreadsheetEvent } from ${lifecycle};\n${source}`;
          source = replaceOnce(source, 'this.el.addEventListener(eventName, (evt) => {', 'bindSpreadsheetEvent(this.el, eventName, (evt) => {');
        }
        if (/\bsetTimeout\(/.test(source)) {
          source = source.replace(/\bsetTimeout\(/g, 'spreadsheetSetTimeout(').replace(/\bclearTimeout\(/g, 'spreadsheetClearTimeout(');
          source = `import { spreadsheetSetTimeout, spreadsheetClearTimeout } from ${lifecycle};\n${source}`;
        }
        return { contents: source, loader: 'js', resolveDir: path.dirname(args.path) };
      });
    },
  };
}
