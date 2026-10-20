import { clipboard, dialog, shell } from 'electron';
import os from 'node:os';
import {
  buildXlsxBuffer,
  ImageServiceError,
  pickImage,
  readImageAsDataUrl,
  savePastedImage,
  writeDocxExport,
  writeFileAtomically,
  writeHtmlExport,
  writePdfBase64,
} from '@easyview/node-runtime';
import { hashContent } from '@easyview/editor-sync';
import type { EditorToHostMessage } from '@easyview/contracts';
import { getAiChatHost } from '../ai/createDesktopAiChatHost';
import {
  chooseExportPath,
  documentDirectory,
  renameCurrent,
  requireDocumentPath,
  saveSession,
  showExportCompleted,
  showOperationError,
} from '../document/documentWorkflow';
import {
  activeSession,
  getActiveTerminalSessionId,
  currentEditorDocumentMessage,
  notifyActiveGitChanges,
  documentSessions,
  editorDocumentMessage,
  isAllowedExternalUrl,
  failure,
  fileNameWithoutExtension,
  isNonEmptyString,
  isRecord,
  getMainWindow,
  sendEditorMessage,
  setActiveTerminalSessionId,
  setTableFirstRowStickyDefault,
  setTerminalService,
  syncTabState,
  tabRegistry,
  getTerminalService as currentTerminalService,
} from '../host/desktopRuntime';
import { TerminalService } from '@easyview/node-runtime';
import { tEditor } from './editorMessageHandler.i18n';

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalPosition(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

function imageErrorMessage(error: unknown): string {
  if (error instanceof ImageServiceError) return error.message;
  return error instanceof Error ? error.message : tEditor('image.failed');
}

function ensureTerminalService(): TerminalService {
  const existing = currentTerminalService();
  if (existing) return existing;
  const created = new TerminalService({
    defaultCwd: documentDirectory(),
    onData: (sessionId, data) => {
      sendEditorMessage({ type: 'terminalData', sessionId, data });
    },
    onExit: (sessionId, exitCode, signal) => {
      if (getActiveTerminalSessionId() === sessionId) setActiveTerminalSessionId(undefined);
      sendEditorMessage({ type: 'terminalExit', sessionId, code: exitCode, signal: signal ?? null });
    },
  });
  setTerminalService(created);
  return created;
}

export function validateEditorMessage(value: EditorToHostMessage): string | null {
  const message = value as unknown as Record<string, unknown>;
  switch (value.type) {
    case 'ready':
    case 'save':
    case 'openTerminal':
    case 'stageFile':
    case 'generateCommitMessage':
    case 'terminalClose':
      return null;
    case 'webviewRuntimeError':
      return isNonEmptyString(message.source) && typeof message.message === 'string' && isOptionalString(message.stack) ? null : tEditor('invalid.runtimeError');
    case 'openWithDebugLog':
      return isNonEmptyString(message.stage) && (message.meta === undefined || isRecord(message.meta)) ? null : tEditor('invalid.debugLog');
    case 'rowResizeDebug':
      return isNonEmptyString(message.stage) && isRecord(message.data) ? null : tEditor('invalid.tableDebug');
    case 'getImageBase64':
      return isNonEmptyString(message.requestId) && typeof message.originalSrc === 'string' ? null : tEditor('invalid.imageRequest');
    case 'pickImage':
      return isOptionalPosition(message.pos) ? null : tEditor('invalid.imagePosition');
    case 'dropImages':
      return Array.isArray(message.paths) && message.paths.every((item) => typeof item === 'string') && isOptionalPosition(message.pos) ? null : tEditor('invalid.dropImages');
    case 'pasteImage':
      return isNonEmptyString(message.requestId) && isNonEmptyString(message.documentId) && typeof message.dataUrl === 'string' && isOptionalString(message.name) ? null : tEditor('invalid.pasteImage');
    case 'exportPdfBase64':
      return isNonEmptyString(message.data) ? null : tEditor('invalid.pdfExport');
    case 'exportHtml':
      return typeof message.html === 'string' && isRecordArray(message.images) && message.images.every((image) => typeof image.originalSrc === 'string' && isNonEmptyString(image.exportFilename) && typeof image.isExternal === 'boolean') ? null : tEditor('invalid.htmlExport');
    case 'exportXlsx':
      return isRecord(message.payload) && isNonEmptyString(message.fileName) ? null : tEditor('invalid.xlsxExport');
    case 'exportDocx':
      return typeof message.title === 'string' && typeof message.markdown === 'string' && isRecordArray(message.mermaidImages) && isRecordArray(message.asciiImages) && [...message.mermaidImages, ...message.asciiImages].every((image) => typeof image.source === 'string' && isNonEmptyString(image.pngBase64) && typeof image.width === 'number' && Number.isFinite(image.width) && image.width > 0 && typeof image.height === 'number' && Number.isFinite(image.height) && image.height > 0) ? null : tEditor('invalid.docxExport');
    case 'terminalInput':
      return typeof message.data === 'string' ? null : tEditor('invalid.terminalInput');
    case 'terminalResize':
      return Number.isInteger(message.cols) && (message.cols as number) > 0 && Number.isInteger(message.rows) && (message.rows as number) > 0 ? null : tEditor('invalid.terminalSize');
    case 'aiChat.getSettings':
    case 'aiChat.abort':
      return isNonEmptyString(message.requestId) ? null : tEditor('invalid.aiRequestId');
    case 'aiChat.pickImage':
      return null;
    case 'aiChat.patchesApplied':
      return isNonEmptyString(message.requestId) && isNonEmptyString(message.operationId) && isOptionalString(message.error) ? null : tEditor('invalid.aiRequestId');
    case 'aiChat.officeDecision':
      return isNonEmptyString(message.requestId) && isNonEmptyString(message.proposalId) && typeof message.accepted === 'boolean' ? null : tEditor('invalid.aiRequestId');
    case 'aiChat.officeUndo':
      return isNonEmptyString(message.requestId) && isNonEmptyString(message.commitId) ? null : tEditor('invalid.aiRequestId');
    case 'aiChat.saveApiKey':
    case 'aiChat.saveWebSearchApiKey':
      return isNonEmptyString(message.requestId) && typeof message.apiKey === 'string' ? null : tEditor('invalid.aiApiKey');
    case 'aiChat.saveSettings':
      return isNonEmptyString(message.requestId) && isRecord(message.settings) ? null : tEditor('invalid.aiSettings');
    case 'aiChat.send':
      return isNonEmptyString(message.requestId)
        && (message.mode === 'chat' || message.mode === 'agent')
        && isNonEmptyString(message.model)
        && typeof message.userMessage === 'string'
        && Array.isArray(message.attachments)
        && Array.isArray(message.history)
        && (message.documentContent === undefined || typeof message.documentContent === 'string')
        && (message.documentFileName === undefined || typeof message.documentFileName === 'string')
        && (message.documentFilePath === undefined || typeof message.documentFilePath === 'string')
        ? null
        : tEditor('invalid.aiSend');
    default:
      return null;
  }
}

export async function handleEditorMessage(message: EditorToHostMessage): Promise<void> {
  const validationError = validateEditorMessage(message);
  if (validationError) {
    await showOperationError(failure('INVALID_ARGUMENT', validationError));
    return;
  }
  if (
    !activeSession()
    // ready / AI / debug messages may arrive before a document is focused
    && !message.type.startsWith('aiChat.')
    && message.type !== 'pasteImage'
    && message.type !== 'ready'
    && message.type !== 'webviewRuntimeError'
    && message.type !== 'openWithDebugLog'
    && message.type !== 'rowResizeDebug'
  ) return;
  switch (message.type) {
    case 'aiChat.send':
    case 'aiChat.abort':
    case 'aiChat.getSettings':
    case 'aiChat.saveSettings':
    case 'aiChat.saveApiKey':
    case 'aiChat.saveWebSearchApiKey':
    case 'aiChat.pickImage':
    case 'aiChat.patchesApplied':
    case 'aiChat.officeDecision':
    case 'aiChat.officeUndo':
      await getAiChatHost().handle(message);
      return;
    case 'ready': {
      const snapshot = currentEditorDocumentMessage('initial');
      if (snapshot) sendEditorMessage(snapshot);
      return;
    }
    case 'snapshotApplied': {
      const session = documentSessions.findByDocumentId(message.documentId);
      if (!session || message.revision !== session.sync.snapshot.revision || message.contentHash !== hashContent(session.content)) {
        sendEditorMessage({
          type: 'resyncRequired',
          documentId: session?.documentId ?? message.documentId,
          revision: session?.sync.snapshot.revision ?? message.revision,
          reason: 'Snapshot acknowledgement mismatch',
        });
      }
      return;
    }
    case 'requestResync': {
      const session = documentSessions.findByDocumentId(message.documentId);
      if (session) sendEditorMessage(editorDocumentMessage(session, 'resync'));
      return;
    }
    case 'applyEdits': {
      const session = documentSessions.findByDocumentId(message.documentId);
      if (!session) {
        sendEditorMessage({ type: 'resyncRequired', documentId: message.documentId, revision: message.baseRevision, reason: 'Document session not found' });
        return;
      }
      const applied = documentSessions.applyEdits(session.tabId, {
        documentId: message.documentId,
        baseRevision: message.baseRevision,
        edits: message.edits,
        resultHash: message.resultHash,
      });
      if (!applied.ok) {
        sendEditorMessage({ type: 'resyncRequired', documentId: session.documentId, revision: session.sync.snapshot.revision, reason: applied.message });
        return;
      }
      tabRegistry.setEditorDirty(session.tabId, session.dirty);
      if (applied.value.dirtyChanged) syncTabState();
      sendEditorMessage({ type: 'editsApplied', documentId: session.documentId, clientEditId: message.clientEditId, revision: applied.value.revision, resultHash: applied.value.resultHash });
      await applied.value.assetsUpdated;
      void notifyActiveGitChanges(session);
      return;
    }
    case 'save': {
      const session = activeSession();
      if (!session) return;
      const result = await saveSession(session.tabId, session.content);
      await showOperationError(result);
      if (result.ok && result.value) {
        sendEditorMessage({ type: 'fileRenamed', fileName: fileNameWithoutExtension(result.value.fileName) });
      }
      return;
    }
    case 'rename': {
      const result = await renameCurrent(message.newName);
      await showOperationError(result);
      if (result.ok) {
        sendEditorMessage({ type: 'fileRenamed', fileName: fileNameWithoutExtension(result.value.fileName) });
      }
      return;
    }
    case 'setTableFirstRowStickyDefault':
      setTableFirstRowStickyDefault(message.sticky);
      return;
    case 'updateUiState': {
      const session = documentSessions.findByDocumentId(message.documentId);
      if (session) session.uiState = message.state;
      return;
    }
    case 'copyTextToClipboard':
      try {
        clipboard.writeText(message.text);
        sendEditorMessage({ type: 'clipboardCopyCompleted', message: message.successMessage ?? tEditor('clipboard.copied') });
      } catch (error) {
        sendEditorMessage({
          type: 'clipboardCopyFailed',
          message: error instanceof Error ? error.message : tEditor('clipboard.copyFailed'),
        });
      }
      return;
    case 'openLink': {
      const url = message.href ?? message.url;
      if (isAllowedExternalUrl(url)) await shell.openExternal(url);
      return;
    }
    case 'showInfo':
      await dialog.showMessageBox(getMainWindow()!, { type: 'info', message: message.text });
      return;
    case 'requestTabCompletion':
      sendEditorMessage({ type: 'tabCompletionResponse', requestId: message.requestId, insertText: null });
      return;
    case 'stageFile': {
      const session = activeSession();
      try {
        if (!session) throw new Error(tEditor('git.openDocumentFirst'));
        const saveResult = await saveSession(session.tabId, session.content);
        if (!saveResult.ok) throw new Error(saveResult.message);
        const result = await documentSessions.stage(session.tabId);
        if (!result.ok) throw new Error(result.message);
        sendEditorMessage({ type: 'stageFileCompleted', message: tEditor('git.staged', { fileName: result.value.fileName }) });
        void notifyActiveGitChanges(session);
      } catch (error) {
        sendEditorMessage({ type: 'stageFileFailed', message: error instanceof Error ? error.message : tEditor('git.stageFailed') });
      }
      return;
    }
    case 'stageHunk': {
      const session = activeSession();
      try {
        if (!session) throw new Error(tEditor('git.openDocumentFirst'));
        if (typeof message.content !== 'string') throw new Error(tEditor('git.invalidHunk'));
        const saveResult = await saveSession(session.tabId, session.content);
        if (!saveResult.ok) throw new Error(saveResult.message);
        const result = await documentSessions.stageContent(session.tabId, message.content);
        if (!result.ok) throw new Error(result.message);
        sendEditorMessage({ type: 'stageFileCompleted', message: tEditor('git.stagedHunk', { fileName: result.value.fileName }) });
        void notifyActiveGitChanges(session);
      } catch (error) {
        sendEditorMessage({ type: 'stageFileFailed', message: error instanceof Error ? error.message : tEditor('git.stageFailed') });
      }
      return;
    }
    case 'generateCommitMessage':
      sendEditorMessage({ type: 'commitMessageGenerationFailed', message: tEditor('git.commitMessageUnavailable') });
      return;
    case 'commitFile': {
      if (typeof message.message !== 'string' || !message.message.trim()) {
        sendEditorMessage({ type: 'commitFileFailed', message: tEditor('git.emptyCommitMessage') });
        return;
      }
      try {
        const session = activeSession();
        if (!session) throw new Error(tEditor('git.openDocumentFirst'));
        const saveResult = await saveSession(session.tabId, session.content);
        if (!saveResult.ok) throw new Error(saveResult.message);
        const result = await documentSessions.commit(session.tabId, message.message);
        if (!result.ok) throw new Error(result.message);
        sendEditorMessage({ type: 'commitFileCompleted', message: tEditor('git.committed', { fileName: result.value.fileName }) });
        void notifyActiveGitChanges(session);
      } catch (error) {
        sendEditorMessage({ type: 'commitFileFailed', message: error instanceof Error ? error.message : tEditor('git.commitFailed') });
      }
      return;
    }
    case 'syncFile': {
      if (typeof message.message !== 'string' || !message.message.trim()) {
        sendEditorMessage({ type: 'syncFileFailed', message: tEditor('git.emptyCommitMessage') });
        return;
      }
      try {
        const session = activeSession();
        if (!session) throw new Error(tEditor('git.openDocumentFirst'));
        const saveResult = await saveSession(session.tabId, session.content);
        if (!saveResult.ok) throw new Error(saveResult.message);
        const result = await documentSessions.sync(session.tabId, message.message);
        if (!result.ok) throw new Error(result.message);
        sendEditorMessage({ type: 'syncFileCompleted', message: tEditor('git.synced', { fileName: result.value.fileName }) });
      } catch (error) {
        sendEditorMessage({ type: 'syncFileFailed', message: error instanceof Error ? error.message : tEditor('git.syncFailed') });
      }
      return;
    }
    case 'openTerminal': {
      try {
        if (getActiveTerminalSessionId()) ensureTerminalService().close(getActiveTerminalSessionId()!);
        const terminal = ensureTerminalService().open({ cwd: documentDirectory() });
        setActiveTerminalSessionId(terminal.sessionId);
        sendEditorMessage({
          type: 'terminalOpened',
          sessionId: terminal.sessionId,
          cwd: terminal.cwd,
          platform: process.platform,
          homeDir: os.homedir(),
        });
      } catch (error) {
        sendEditorMessage({ type: 'terminalError', message: error instanceof Error ? error.message : tEditor('terminal.startFailed') });
      }
      return;
    }
    case 'webviewRuntimeError':
      console.error(`[EasyView Renderer] ${message.source}: ${message.message}`, message.stack ?? '');
      return;
    case 'openWithDebugLog':
      console.debug(`[EasyView Renderer] ${message.stage}`, message.meta ?? {});
      return;
    case 'rowResizeDebug':
      console.debug(`[EasyView Table] ${message.stage}`, message.data);
      return;
    case 'getImageBase64': {
      const documentPath = activeSession()?.filePath;
      if (!documentPath) {
        sendEditorMessage({ type: 'imageBase64Response', requestId: message.requestId, base64: null });
        return;
      }
      try {
        await activeSession()?.imageAssets.whenIdle();
        const base64 = await readImageAsDataUrl({ documentPath, source: message.originalSrc });
        sendEditorMessage({ type: 'imageBase64Response', requestId: message.requestId, base64 });
      } catch {
        sendEditorMessage({ type: 'imageBase64Response', requestId: message.requestId, base64: null });
      }
      return;
    }
    case 'pickImage': {
      const documentPath = requireDocumentPath();
      if (!documentPath) return;
      try {
        const selected = await pickImage({
          documentPath,
          selectPath: async () => {
        const chosen = await dialog.showOpenDialog(getMainWindow()!, {
              properties: ['openFile'],
              filters: [{ name: tEditor('dialog.images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] }],
            });
            return chosen.canceled ? null : (chosen.filePaths[0] ?? null);
          },
        });
        sendEditorMessage({ type: 'imageSelected', src: selected.dataUrl, originalSrc: selected.relativePath, pos: message.pos });
      } catch (error) {
        if (!(error instanceof ImageServiceError && error.code === 'IMAGE_SELECTION_CANCELLED')) {
          await dialog.showMessageBox(getMainWindow()!, { type: 'error', message: imageErrorMessage(error) });
        }
      }
      return;
    }
    case 'dropImages': {
      const documentPath = requireDocumentPath();
      if (!documentPath) return;
      const images = [];
      for (const imagePath of message.paths) {
        try {
          const selected = await pickImage({ documentPath, selectPath: async () => imagePath });
          images.push({ src: selected.dataUrl, originalSrc: selected.relativePath });
        } catch (error) {
          console.warn('[EasyView_Md] Dropped image rejected:', imageErrorMessage(error));
        }
      }
      if (images.length > 0) sendEditorMessage({ type: 'imagesDropped', images, pos: message.pos });
      return;
    }
    case 'pasteImage': {
      const session = documentSessions.findByDocumentId(message.documentId);
      try {
        if (!session?.filePath) throw new Error(tEditor('image.saveDocumentFirst'));
        const documentPath = session.filePath;
        const saved = await savePastedImage({ documentPath, dataUrl: message.dataUrl, preferredName: message.name });
        const src = await readImageAsDataUrl({ documentPath, source: saved.relativePath });
        sendEditorMessage({ type: 'pasteImageResult', requestId: message.requestId, documentId: message.documentId,
          result: { ok: true, src, originalSrc: saved.relativePath } });
      } catch (error) {
        sendEditorMessage({ type: 'pasteImageResult', requestId: message.requestId, documentId: message.documentId,
          result: { ok: false, message: imageErrorMessage(error) } });
      }
      return;
    }
    case 'exportHtml': {
      const targetPath = await chooseExportPath('html', 'HTML');
      if (!targetPath) return;
      try {
        const result = await writeHtmlExport({ targetPath, documentDir: documentDirectory(), html: message.html, images: message.images });
        await showExportCompleted(result.htmlPath);
      } catch (error) {
        await dialog.showMessageBox(getMainWindow()!, { type: 'error', message: error instanceof Error ? error.message : tEditor('export.htmlFailed') });
      }
      return;
    }
    case 'exportPdfBase64': {
      const targetPath = await chooseExportPath('pdf', 'PDF');
      if (!targetPath) return;
      try {
        await writePdfBase64({ targetPath, data: message.data });
        await showExportCompleted(targetPath);
      } catch (error) {
        await dialog.showMessageBox(getMainWindow()!, { type: 'error', message: error instanceof Error ? error.message : tEditor('export.pdfFailed') });
      }
      return;
    }
    case 'exportXlsx': {
      const targetPath = await chooseExportPath('xlsx', tEditor('dialog.excelWorkbook'));
      if (!targetPath) return;
      try {
        const buffer = await buildXlsxBuffer(message.payload);
        await writeFileAtomically(targetPath, buffer);
        await showExportCompleted(targetPath);
      } catch (error) {
        await dialog.showMessageBox(getMainWindow()!, { type: 'error', message: error instanceof Error ? error.message : tEditor('export.xlsxFailed') });
      }
      return;
    }
    case 'exportDocx': {
      const targetPath = await chooseExportPath('docx', tEditor('dialog.wordDocument'));
      if (!targetPath) return;
      try {
        await writeDocxExport({
          targetPath,
          markdown: message.markdown,
          title: message.title || fileNameWithoutExtension(activeSession()?.fileName ?? 'Untitled'),
          docDir: documentDirectory(),
          mermaidImages: message.mermaidImages,
          asciiImages: message.asciiImages,
        });
        await showExportCompleted(targetPath);
      } catch (error) {
        await dialog.showMessageBox(getMainWindow()!, { type: 'error', message: error instanceof Error ? error.message : tEditor('export.docxFailed') });
      }
      return;
    }
    case 'terminalInput':
      if (getActiveTerminalSessionId() && typeof message.data === 'string') {
        ensureTerminalService().write(getActiveTerminalSessionId()!, message.data);
      }
      return;
    case 'terminalResize':
      if (getActiveTerminalSessionId() && Number.isInteger(message.cols) && Number.isInteger(message.rows)) {
        ensureTerminalService().resize(getActiveTerminalSessionId()!, message.cols, message.rows);
      }
      return;
    case 'terminalClose':
      if (getActiveTerminalSessionId()) {
        ensureTerminalService().close(getActiveTerminalSessionId()!);
        setActiveTerminalSessionId(undefined);
      }
      return;
  }
}
