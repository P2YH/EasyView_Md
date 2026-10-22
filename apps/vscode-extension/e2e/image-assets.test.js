const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
async function waitFor(predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Timed out waiting for image asset lifecycle');
}
async function exists(target) {
  return fs.stat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
}
async function replace(document, content) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), content);
  assert.equal(await vscode.workspace.applyEdit(edit), true);
}

suite('EasyView image asset lifecycle', () => {
  let root;
  const documents = [];
  setup(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'easyview-ext-image-assets-'));
    await vscode.extensions.getExtension('zhangxy.easyview-md').activate();
    // Earlier suites in the same VS Code instance may leave EasyView editor tabs open.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });
  teardown(async () => {
    for (const document of documents.splice(0)) {
      if (!document.isClosed && document.isDirty) await document.save();
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await fs.rm(root, { recursive: true, force: true });
  });

  async function open(name, mode = 'native', count = 1) {
    const file = path.join(root, `${name}.md`);
    const directory = path.join(root, `.${name}.assets`);
    const image = path.join(directory, 'image.png');
    const reference = `![](.${name}.assets/image.png)`;
    const content = `# ${name}\n\n${Array(count).fill(reference).join('\n\n')}\n`;
    await fs.mkdir(directory); await fs.writeFile(image, bytes); await fs.writeFile(file, content);
    const uri = vscode.Uri.file(file).with({ scheme: mode === 'native' ? 'file' : 'easyviewMd' });
    const document = await vscode.workspace.openTextDocument(uri);
    documents.push(document);
    if (mode === 'native') await vscode.window.showTextDocument(document, { preview: false });
    else await vscode.commands.executeCommand('vscode.openWith', uri, 'easyviewMd.markdownEditor', { preview: false });
    return { file, directory, image, reference, content, document };
  }

  test('native source mode cleans assets without a rendered editor and supports undo, redo and save', async () => {
    const fixture = await open('native', 'native', 2);
    assert.equal(vscode.window.tabGroups.all.some(group => group.tabs.some(tab =>
      tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'easyviewMd.markdownEditor')), false);
    await replace(fixture.document, `# One reference\n\n${fixture.reference}\n`);
    await fixture.document.save();
    assert.deepEqual(await fs.readFile(fixture.image), bytes);
    const editor = vscode.window.activeTextEditor;
    assert.equal(await editor.edit(builder => builder.delete(new vscode.Range(
      fixture.document.positionAt(0), fixture.document.positionAt(fixture.document.getText().length)))), true);
    await waitFor(async () => !await exists(fixture.directory));
    // `undo` targets whatever holds keyboard focus, which isn't necessarily the editor in a fresh window.
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    await vscode.commands.executeCommand('undo');
    await waitFor(() => exists(fixture.image));
    assert.deepEqual(await fs.readFile(fixture.image), bytes);
    await vscode.commands.executeCommand('redo');
    await waitFor(async () => !await exists(fixture.directory));
    assert.equal(await fixture.document.save(), true);
    assert.equal((await fs.readFile(fixture.file, 'utf8')).includes('.assets'), false);
  });

  test('rendered extension documents share the same deletion and restoration lifecycle', async () => {
    const fixture = await open('rendered', 'rendered');
    await replace(fixture.document, '# No image\n');
    await waitFor(async () => !await exists(fixture.directory));
    await replace(fixture.document, fixture.content);
    await waitFor(() => exists(fixture.image));
    assert.deepEqual(await fs.readFile(fixture.image), bytes);
    await replace(fixture.document, '# Saved without image\n');
    await waitFor(async () => !await exists(fixture.directory));
    assert.equal(await fixture.document.save(), true);
    await waitFor(async () => !(await fs.readFile(fixture.file, 'utf8')).includes('.assets'));
  });

  test('discarding a native deletion restores the asset referenced by the saved Markdown', async () => {
    const fixture = await open('discard');
    await replace(fixture.document, '# Unsaved deletion\n');
    await waitFor(async () => !await exists(fixture.directory));
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await waitFor(() => exists(fixture.image));
    assert.deepEqual(await fs.readFile(fixture.image), bytes);
    assert.equal(await fs.readFile(fixture.file, 'utf8'), fixture.content);
  });
});
