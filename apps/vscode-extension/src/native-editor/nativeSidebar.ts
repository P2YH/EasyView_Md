import * as vscode from 'vscode';
import { computeGitLineRanges } from '../application/git/gitChangeTracker';
import { isMarkdownDocument, parseMarkdownDocument } from './markdownModel';
import { tNative } from './nativeEditor.i18n';

type NodeKind = 'section' | 'heading' | 'task' | 'link' | 'image' | 'git';
type SectionId = 'outline' | 'tasks' | 'links' | 'images' | 'git';

class NativeMarkdownTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly kind: NodeKind,
    public readonly uri?: vscode.Uri,
    public readonly line?: number,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    public readonly section?: SectionId,
  ) {
    super(label, collapsibleState);
    this.contextValue = kind;
    this.iconPath = new vscode.ThemeIcon(NativeMarkdownTreeItem.iconFor(kind));
    if (uri && typeof line === 'number') {
      this.command = {
        command: 'easyviewMd.revealLine',
        title: tNative('sidebar.reveal'),
        arguments: [uri, line],
      };
    }
  }

  private static iconFor(kind: NodeKind): string {
    switch (kind) {
      case 'heading': return 'symbol-string';
      case 'task': return 'checklist';
      case 'link': return 'link';
      case 'image': return 'file-media';
      case 'git': return 'git-compare';
      default: return 'list-tree';
    }
  }
}

export class NativeMarkdownSidebarProvider implements vscode.TreeDataProvider<NativeMarkdownTreeItem>, vscode.Disposable {
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new NativeMarkdownSidebarProvider();
    const tree = vscode.window.createTreeView('easyviewMd.nativePanel', { treeDataProvider: provider });
    context.subscriptions.push(provider, tree);
    provider.initialize();
    return vscode.Disposable.from(provider, tree);
  }

  private readonly disposables: vscode.Disposable[] = [];
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<NativeMarkdownTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private initialize(): void {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (isMarkdownDocument(event.document)) this.refresh();
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (isMarkdownDocument(document)) this.refresh();
      }),
      vscode.commands.registerCommand('easyviewMd.refreshNativePanel', () => this.refresh())
    );
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: NativeMarkdownTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: NativeMarkdownTreeItem): Promise<NativeMarkdownTreeItem[]> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isMarkdownDocument(editor.document)) {
      return [];
    }

    const uri = editor.document.uri;
    const info = parseMarkdownDocument(editor.document);

    if (!element) {
      return [
        new NativeMarkdownTreeItem(tNative('sidebar.outline', { count: info.headings.length }), 'section', undefined, undefined, vscode.TreeItemCollapsibleState.Expanded, 'outline'),
        new NativeMarkdownTreeItem(tNative('sidebar.tasks', { count: info.tasks.length }), 'section', undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed, 'tasks'),
        new NativeMarkdownTreeItem(tNative('sidebar.links', { count: info.links.length }), 'section', undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed, 'links'),
        new NativeMarkdownTreeItem(tNative('sidebar.images', { count: info.images.length }), 'section', undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed, 'images'),
        new NativeMarkdownTreeItem(tNative('sidebar.gitChanges'), 'section', undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed, 'git'),
      ];
    }

    if (element.section === 'outline') {
      return info.headings.map((heading) =>
        new NativeMarkdownTreeItem(`${'#'.repeat(heading.level)} ${heading.text}`, 'heading', uri, heading.line)
      );
    }

    if (element.section === 'tasks') {
      return info.tasks.map((task) =>
        new NativeMarkdownTreeItem(`${task.checked ? '[x]' : '[ ]'} ${task.text}`, 'task', uri, task.line)
      );
    }

    if (element.section === 'links') {
      return info.links.map((link) =>
        new NativeMarkdownTreeItem(`${link.text} -> ${link.target}`, 'link', uri, link.line)
      );
    }

    if (element.section === 'images') {
      return info.images.map((image) =>
        new NativeMarkdownTreeItem(`${image.text} -> ${image.target}`, 'image', uri, image.line)
      );
    }

    if (element.section === 'git') {
      const ranges = await computeGitLineRanges(uri, editor.document.getText());
      return ranges.map((range) =>
        new NativeMarkdownTreeItem(
          tNative(range.kind === 'added' ? 'sidebar.gitAdded' : 'sidebar.gitModified', { start: range.startLine, end: range.endLine }),
          'git',
          uri,
          range.startLine - 1,
        )
      );
    }

    return [];
  }
}
