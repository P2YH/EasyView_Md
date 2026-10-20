import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import { DocumentImageAssets } from '@easyview/node-runtime';
import { isDiskBackedMarkdownUri, markdownUriKey, toDiskFileUri } from './markdownUri';
import { tDocument } from './document.i18n';

interface ImageAssetDocument {
  readonly assets: DocumentImageAssets;
  readonly diskPath: string;
  readonly documents: Set<string>;
  content: string;
  generation: number;
}

/** One image lifecycle per disk resource, shared by native and rendered editors. */
export class MarkdownImageAssets implements vscode.Disposable {
  private readonly records = new Map<string, ImageAssetDocument>();
  private readonly subscriptions: vscode.Disposable[] = [];

  register(): vscode.Disposable {
    for (const document of vscode.workspace.textDocuments) this.open(document);
    this.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument(document => this.open(document)),
      vscode.workspace.onDidChangeTextDocument(event => this.change(event.document)),
      vscode.workspace.onWillSaveTextDocument(event => {
        const record = this.record(event.document);
        if (record) event.waitUntil(record.assets.whenIdle());
      }),
      vscode.workspace.onDidCloseTextDocument(document => { void this.close(document); }),
    );
    return this;
  }

  whenIdle(document: vscode.TextDocument): Promise<void> {
    this.open(document);
    return this.record(document)?.assets.whenIdle() ?? Promise.resolve();
  }

  private record(document: vscode.TextDocument): ImageAssetDocument | undefined {
    if (!isDiskBackedMarkdownUri(document.uri) || !/\.(?:md|markdown|mdx)$/i.test(document.uri.fsPath)) return;
    return this.records.get(markdownUriKey(document.uri));
  }

  private open(document: vscode.TextDocument): void {
    if (!isDiskBackedMarkdownUri(document.uri) || !/\.(?:md|markdown|mdx)$/i.test(document.uri.fsPath)) return;
    const key = markdownUriKey(document.uri);
    const uri = document.uri.toString();
    const existing = this.records.get(key);
    if (existing) {
      if (existing.documents.has(uri)) return;
      const wasClosed = existing.documents.size === 0;
      existing.documents.add(uri);
      existing.generation++;
      if (wasClosed) this.change(document);
      return;
    }
    this.records.set(key, { assets: new DocumentImageAssets(), diskPath: toDiskFileUri(document.uri).fsPath,
      documents: new Set([uri]), content: document.getText(), generation: 0 });
  }

  private change(document: vscode.TextDocument): void {
    this.open(document);
    const record = this.record(document);
    if (!record) return;
    const before = record.content;
    const after = document.getText();
    record.content = after;
    void record.assets.reconcile(record.diskPath, before, after).catch(error => this.report(error));
  }

  private async close(document: vscode.TextDocument): Promise<void> {
    const record = this.record(document);
    if (!record) return;
    record.documents.delete(document.uri.toString());
    if (record.documents.size) return;
    const generation = ++record.generation;
    try {
      const persisted = await readFile(record.diskPath, 'utf8');
      if (record.documents.size || record.generation !== generation) return;
      // Discarding an unsaved deletion restores files referenced by the saved document.
      await record.assets.reconcile(record.diskPath, record.content, persisted);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.report(error);
    } finally {
      if (!record.documents.size && record.generation === generation) {
        record.assets.dispose();
        this.records.delete(markdownUriKey(document.uri));
      }
    }
  }

  private report(error: unknown): void {
    void vscode.window.showErrorMessage(tDocument('image.assetsUpdateFailed', {
      message: error instanceof Error ? error.message : String(error),
    }));
  }

  dispose(): void {
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
    for (const record of this.records.values()) record.assets.dispose();
    this.records.clear();
  }
}

export const markdownImageAssets = new MarkdownImageAssets();
