import * as vscode from 'vscode';
import { isMarkdownDocument, parseMarkdownDocument } from './markdownModel';
import { tNative } from './nativeEditor.i18n';

export class NativeMarkdownHoverProvider implements vscode.HoverProvider {
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new NativeMarkdownHoverProvider();
    const disposable = vscode.languages.registerHoverProvider(
      [{ language: 'markdown' }, { language: 'mdx' }],
      provider
    );
    context.subscriptions.push(disposable);
    return disposable;
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    if (!isMarkdownDocument(document)) return undefined;

    const info = parseMarkdownDocument(document);
    const character = position.character;
    const link = [...info.links, ...info.images].find((item) =>
      item.line === position.line && character >= item.start && character <= item.end
    );

    if (link) {
      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(`**${tNative(link.isImage ? 'hover.image' : 'hover.link')}**\n\n`);
      markdown.appendCodeblock(link.target);
      markdown.isTrusted = true;
      return new vscode.Hover(markdown, new vscode.Range(link.line, link.start, link.line, link.end));
    }

    const task = info.tasks.find((item) => item.line === position.line);
    if (task) {
      return new vscode.Hover(tNative(task.checked ? 'hover.completedTask' : 'hover.openTask'));
    }

    const table = info.tables.find((item) => item.line === position.line);
    if (table) {
      return new vscode.Hover(tNative('hover.tableRow', { columns: table.columns }));
    }

    const heading = info.headings.find((item) => item.line === position.line);
    if (heading) {
      return new vscode.Hover(tNative('hover.anchor', { anchor: heading.anchor }));
    }

    return undefined;
  }
}
