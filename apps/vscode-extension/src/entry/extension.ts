import { registerVersionGuard } from '../version-guard/guardHost';
import { isMarkdownFilePath } from '@easyview/contracts';
import * as vscode from 'vscode';
import { stageFile as stageGitFile } from '@easyview/node-runtime';
import * as path from 'path';
import { NativeMarkdownDecorator } from '../native-editor/nativeDecorations';
import { MarkdownEditorProvider } from '../adapters/vscode/provider';
import { ensureNativeMarkdownEditorFont } from '../native-editor/nativeEditorFont';
import { NativeMermaidRenderer } from '../native-editor/nativeMermaidRenderer';
import { suppressConflictingMarkdownInlineDecorations } from '../native-editor/conflictingExtensions';
import { setPendingCursorForUri } from '../application/document/openCursorContext';
import { setPendingDocumentContentForUri } from '../application/document/openDocumentSnapshot';
import { logOpenWithDebug } from '../application/document/openWithDebug';
import { registerNativeMarkdownImagePaste } from '../native-editor/nativeImagePaste';
import { markdownImageAssets } from '../application/document/markdownImageAssets';
import { suppressNativeOutlineRestore } from '../native-editor/nativeOutlineNavigation';
import { registerWordToMarkdownCommand } from '../application/document/wordToMarkdown';
import { registerPdfToMarkdownCommand } from '../application/document/pdfToMarkdown';
import { getInstalledExtensionVersion, notifyExtensionUpdated } from './extensionUpdateNotification';
import { registerWorkspaceExplorer } from '../workspace/workspaceExplorer';
import { FilePreviewProvider } from '../preview/filePreviewProvider';
import { cycleProductTheme } from '../theme/productThemeBridge';
import { registerEasyViewMarkdownFileSystem } from '../application/document/markdownFileSystem';
import {
  openMarkdownInEasyViewEditor,
  rematerializeFileSchemeEasyViewMarkdownTabs,
  resolveMarkdownDiskUri,
} from '../application/document/openMarkdownEditor';
import {
  isDiskBackedMarkdownUri,
  sameMarkdownResource,
  toDiskFileUri,
  toEasyViewMarkdownUri,
} from '../application/document/markdownUri';
import { normalizeLocale, setLocale } from '@easyview/contracts/i18n';
import { tExtension } from './extension.i18n';

function resolveCurrentMarkdownUri(): vscode.Uri | undefined {
  const activeDoc = vscode.window.activeTextEditor?.document;
  if (activeDoc && isMarkdownFilePath(activeDoc.uri.fsPath)) {
    return activeDoc.uri;
  }

  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const tabInput = (activeTab as any)?.input;
  const uri = tabInput?.uri as vscode.Uri | undefined;
  if (uri && isMarkdownFilePath(uri.fsPath)) {
    return uri;
  }
  return undefined;
}

async function migrateDefaultEditorLayoutState(context: vscode.ExtensionContext): Promise<void> {
  const migrationKey = 'mdpre-zalman.migrations.defaultEditorLayoutState.1.0.121';
  if (context.globalState.get<boolean>(migrationKey)) {
    return;
  }

  const staleKeys = context.workspaceState.keys().filter((key) =>
    key.startsWith('mdpre-zalman.editorSettings:'),
  );

  for (const key of staleKeys) {
    await context.workspaceState.update(key, undefined);
  }

  await context.globalState.update(migrationKey, true);
}

function registerMirrorSavePropagation(): vscode.Disposable {
  return vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (!isMarkdownFilePath(document.uri.fsPath)) return;
    const diskUri = resolveMarkdownDiskUri(document.uri);
    if (sameMarkdownResource(diskUri, document.uri)) return;
    try {
      await vscode.workspace.fs.writeFile(diskUri, Buffer.from(document.getText(), 'utf8'));
      logOpenWithDebug('openMarkdown.mirrorSavedToDisk', {
        mirror: document.uri.fsPath,
        disk: diskUri.fsPath,
      });
    } catch (error) {
      logOpenWithDebug('openMarkdown.mirrorSaveFailed', {
        mirror: document.uri.fsPath,
        disk: diskUri.fsPath,
        message: error instanceof Error ? error.message : String(error),
      });
      void vscode.window.showErrorMessage(
        tExtension('mirror.writeBackFailed', { message: error instanceof Error ? error.message : String(error) }),
      );
    }
  });
}

export function activate(context: vscode.ExtensionContext) {
  setLocale(normalizeLocale(vscode.env.language) ?? 'en');
  void migrateDefaultEditorLayoutState(context);
  const installedVersion = getInstalledExtensionVersion();
  if (installedVersion) {
    void notifyExtensionUpdated(context, installedVersion);
  }

  // Must register before markdown CustomTextEditor opens easyviewMd: URIs.
  context.subscriptions.push(registerEasyViewMarkdownFileSystem());
  context.subscriptions.push(registerMirrorSavePropagation());
  context.subscriptions.push(markdownImageAssets.register());

  const mermaidRenderer = NativeMermaidRenderer.register(context);
  context.subscriptions.push(NativeMarkdownDecorator.register(context, mermaidRenderer));
  context.subscriptions.push(MarkdownEditorProvider.register(context));
  context.subscriptions.push(FilePreviewProvider.register(context));
  context.subscriptions.push(
    vscode.commands.registerCommand('easyviewMd.debug.htmlPreviewState', () => FilePreviewProvider.getHtmlPreviewState()),
    vscode.commands.registerCommand('easyviewMd.debug.htmlPreviewClick', (text: unknown) => (
      typeof text === 'string' && text ? FilePreviewProvider.clickHtmlPreviewMenu(text) : false
    )),
  );
  context.subscriptions.push(registerNativeMarkdownImagePaste());
  context.subscriptions.push(registerWordToMarkdownCommand(context));
  context.subscriptions.push(registerPdfToMarkdownCommand(context));
  context.subscriptions.push(registerWorkspaceExplorer(context));
  context.subscriptions.push(registerVersionGuard(context));
  void rematerializeFileSchemeEasyViewMarkdownTabs(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('easyviewMd.showEditorDiagnostics', () => {
      const editorDiagnostics = MarkdownEditorProvider.getDiagnostics();
      const previewDiagnostics = FilePreviewProvider.getDiagnostics();
      const output = vscode.window.createOutputChannel('EasyView_Md Diagnostics');
      output.clear();
      output.appendLine('EasyView_Md Editor Diagnostics');
      output.appendLine(`Generated: ${new Date().toISOString()}`);
      output.appendLine(JSON.stringify({ ...editorDiagnostics, ...previewDiagnostics }, null, 2));
      output.show(true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyviewMd.cycleProductTheme', async () => {
      const mode = await cycleProductTheme(context);
      void vscode.window.setStatusBarMessage(tExtension('theme.status', { mode: tExtension(`theme.${mode}`) }), 2000);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyviewMd.openEditor', async (uri?: vscode.Uri) => {
      const activeEditor = vscode.window.activeTextEditor;
      const rawTargetUri = uri ?? activeEditor?.document.uri;

      if (rawTargetUri && isMarkdownFilePath(rawTargetUri.fsPath)) {
        const diskUri = toDiskFileUri(
          rawTargetUri.scheme === 'file' || isDiskBackedMarkdownUri(rawTargetUri)
            ? (rawTargetUri.scheme === 'file' ? vscode.Uri.file(rawTargetUri.fsPath) : rawTargetUri)
            : vscode.Uri.file(rawTargetUri.fsPath),
        );
        const schemeUri = toEasyViewMarkdownUri(diskUri);
        const hadExistingPanels =
          MarkdownEditorProvider.hasPanelsForDocument(schemeUri)
          || MarkdownEditorProvider.hasPanelsForDocument(diskUri);

        const sourceEditor = activeEditor && (
          sameMarkdownResource(activeEditor.document.uri, diskUri)
          || sameMarkdownResource(activeEditor.document.uri, schemeUri)
        )
          ? activeEditor
          : vscode.window.visibleTextEditors.find((editor) =>
            sameMarkdownResource(editor.document.uri, diskUri)
            || sameMarkdownResource(editor.document.uri, schemeUri)
          );

        const selection = sourceEditor?.selection.active;
        if (selection) {
          setPendingCursorForUri(schemeUri, {
            line: selection.line,
            character: selection.character,
          });
          setPendingCursorForUri(diskUri, {
            line: selection.line,
            character: selection.character,
          });
        }
        if (sourceEditor) {
          const snapshot = sourceEditor.document.getText();
          setPendingDocumentContentForUri(schemeUri, snapshot);
          setPendingDocumentContentForUri(diskUri, snapshot);
          logOpenWithDebug('openEditor.snapshotCaptured', {
            path: diskUri.fsPath,
            snapshotLength: snapshot.length,
            isDirty: sourceEditor.document.isDirty,
          });
        }

        suppressNativeOutlineRestore();
        logOpenWithDebug('openEditor.executeOpenWith', {
          path: diskUri.fsPath,
          viewColumn: sourceEditor?.viewColumn ?? 'unknown',
        });

        let openUri: vscode.Uri;
        try {
          openUri = await openMarkdownInEasyViewEditor(
            diskUri,
            context,
            sourceEditor?.viewColumn,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logOpenWithDebug('openEditor.openFailed', {
            path: diskUri.fsPath,
            message,
          });
          void vscode.window.showErrorMessage(tExtension('open.failed', { message }));
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 120));
        if (
          !hadExistingPanels
          && !MarkdownEditorProvider.hasPanelsForDocument(openUri)
          && !MarkdownEditorProvider.hasPanelsForDocument(schemeUri)
          && !MarkdownEditorProvider.hasPanelsForDocument(diskUri)
        ) {
          logOpenWithDebug('openEditor.openWithNoPanel', {
            path: diskUri.fsPath,
            openUri: openUri.toString(true),
          });
          void vscode.window.showErrorMessage(tExtension('open.noPanel'));
          return;
        }

        const reloaded = hadExistingPanels
          ? await MarkdownEditorProvider.reloadPanelsForDocument(
            openUri,
            sourceEditor?.document.getText(),
          )
          : false;
        logOpenWithDebug('openEditor.reloadExistingPanels', {
          path: diskUri.fsPath,
          openUri: openUri.toString(true),
          hadExistingPanels,
          reloaded,
        });
        logOpenWithDebug('openEditor.openWithCompleted', {
          path: diskUri.fsPath,
          openUri: openUri.toString(true),
        });
        if (selection) {
          await vscode.commands.executeCommand(
            'easyviewMd.revealCursorInEasyView',
            openUri,
            selection.line,
            selection.character,
          );
        }
        return;
      }

      vscode.window.showInformationMessage(tExtension('open.selectMarkdownFirst'));
      logOpenWithDebug('openEditor.noMarkdownTarget');
      return undefined;
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyviewMd.openNativeEditor', async (uri?: vscode.Uri) => {
      const rawTargetUri = uri ?? resolveCurrentMarkdownUri();

      if (rawTargetUri && isMarkdownFilePath(rawTargetUri.fsPath)) {
        const diskUri = toDiskFileUri(
          rawTargetUri.scheme === 'file'
            ? vscode.Uri.file(rawTargetUri.fsPath)
            : rawTargetUri,
        );
        try {
          // Open the built-in text editor in the workbench. Cursor can render a
          // large file there even when it refuses to synchronize that file's
          // TextDocument to extensions. Opening the TextDocument here fails
          // before the editor is shown, and vscode.open may choose another
          // custom editor from workbench.editorAssociations.
          await vscode.commands.executeCommand('vscode.openWith', diskUri, 'default', {
            preview: false,
            preserveFocus: false,
          });
          const editor = vscode.window.activeTextEditor;
          if (editor && sameMarkdownResource(editor.document.uri, diskUri)) {
            await ensureNativeMarkdownEditorFont(editor.document);
            await suppressConflictingMarkdownInlineDecorations(editor);
          }
          return editor;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logOpenWithDebug('openNativeEditor.failed', {
            path: diskUri.fsPath,
            message,
          });
          void vscode.window.showErrorMessage(tExtension('openNative.failed', { message }));
          return undefined;
        }
      }

      vscode.window.showInformationMessage(tExtension('open.selectMarkdownFirst'));
      return undefined;
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyviewMd.stageFile', async () => {
      const targetUri = resolveCurrentMarkdownUri();
      const diskUri = targetUri ? resolveMarkdownDiskUri(targetUri) : undefined;
      if (!diskUri || diskUri.scheme !== 'file') {
        if (!MarkdownEditorProvider.notifyActivePanel({
          type: 'stageFileFailed',
          message: tExtension('stage.openMarkdownFirst'),
        })) {
          vscode.window.showInformationMessage(tExtension('stage.openMarkdownFirst'));
        }
        return;
      }
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(diskUri);
      const cwd = workspaceFolder?.uri.fsPath ?? path.dirname(diskUri.fsPath);
      try {
        await stageGitFile(cwd, diskUri.fsPath);
        const successText = tExtension('stage.completed', { name: path.basename(diskUri.fsPath) });
        if (!MarkdownEditorProvider.notifyActivePanel({
          type: 'stageFileCompleted',
          message: successText,
        })) {
          vscode.window.showInformationMessage(successText);
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        const failText = tExtension('stage.failed', { message: messageText });
        if (!MarkdownEditorProvider.notifyActivePanel({
          type: 'stageFileFailed',
          message: failText,
        })) {
          vscode.window.showErrorMessage(failText);
        }
      }
    }),
  );
}

export function deactivate() {}
