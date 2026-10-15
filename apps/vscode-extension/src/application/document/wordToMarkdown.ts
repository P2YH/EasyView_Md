import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  convertWordToMarkdown,
  flattenPngWithWhiteBackground,
  rewriteExtractedMediaPaths,
} from '@easyview/node-runtime';
import { openMarkdownInEasyViewEditor } from './openMarkdownEditor';
import { tDocument } from './document.i18n';

export { flattenPngWithWhiteBackground, rewriteExtractedMediaPaths };

async function convertWithOverwritePrompt(sourcePath: string) {
  try {
    return await convertWordToMarkdown({ sourcePath, overwrite: false });
  } catch (error: any) {
    if (error?.code !== 'OUTPUT_EXISTS') throw error;
    const outputPath = path.join(
      path.dirname(sourcePath),
      `${path.basename(sourcePath, path.extname(sourcePath))}.md`,
    );
    const replaceAction = tDocument('convert.replace');
    const selection = await vscode.window.showWarningMessage(
      tDocument('convert.outputExists', { name: path.basename(outputPath) }),
      { modal: true },
      replaceAction,
    );
    if (selection !== replaceAction) return null;
    return convertWordToMarkdown({ sourcePath, overwrite: true });
  }
}

export function registerWordToMarkdownCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('easyviewMd.convertWordToMarkdown', async (uri?: vscode.Uri) => {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri || targetUri.scheme !== 'file') {
      vscode.window.showErrorMessage(tDocument('convertWord.selectFirst'));
      return;
    }

    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: tDocument('convertWord.progress'),
          cancellable: false,
        },
        () => convertWithOverwritePrompt(targetUri.fsPath),
      );
      if (!result) return;
      const outputUri = vscode.Uri.file(result.outputPath);
      const openAction = tDocument('convert.openMarkdown');
      const selection = await vscode.window.showInformationMessage(
        tDocument('convert.converted', { name: path.basename(result.outputPath) }),
        openAction,
      );
      if (selection === openAction) {
        await openMarkdownInEasyViewEditor(outputUri, context);
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(tDocument('convertWord.failed', { message: error?.message || String(error) }));
    }
  });
}
