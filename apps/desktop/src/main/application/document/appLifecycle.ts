/**
 * Shared restart / close confirmation gate. Every restart entry (app menu,
 * Dock, Windows user task, second-instance RESTART_FLAG) must go through
 * requestRestart so dirty documents cannot be discarded silently.
 */
export interface RestartWindow {
  prepare(): Promise<void>;
  hasDirtyDocuments(): boolean;
  confirmCloseAll(): Promise<boolean>;
}

export interface RestartRequest {
  windows(): RestartWindow[];
  relaunch(): void;
}

export async function requestRestart(request: RestartRequest): Promise<boolean> {
  // Prompts yield to other windows. Recheck all owners before the global exit,
  // including documents edited or windows opened while a prompt was visible.
  for (;;) {
    const windows = request.windows();
    for (const window of windows) await window.prepare();
    const dirty = windows.filter(window => window.hasDirtyDocuments());
    if (!dirty.length) break;
    for (const window of dirty) {
      if (window.hasDirtyDocuments() && !await window.confirmCloseAll()) return false;
    }
  }
  request.relaunch();
  return true;
}
