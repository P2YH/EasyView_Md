import { contextBridge, ipcRenderer } from 'electron';

export type UpdateDialogAction = 'cancel' | 'restart' | 'install' | 'later' | 'website' | 'close';

contextBridge.exposeInMainWorld('easyviewUpdateDialog', {
  action: (id: UpdateDialogAction) => ipcRenderer.send('easyview-update-dialog-action', id),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on('easyview-update-dialog-state', listener);
    return () => ipcRenderer.removeListener('easyview-update-dialog-state', listener);
  },
});
