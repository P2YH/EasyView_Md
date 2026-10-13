import { HistoryTaskQueue } from '@easyview/node-runtime';
const captureQueue = new HistoryTaskQueue(2);
import { app } from 'electron';
import path from 'node:path';
import { readFile, stat, realpath } from 'node:fs/promises';
import { TimelineService, discoverHostHistoryRoots, writeFileAtomically } from '@easyview/node-runtime';
import { DEFAULT_LOCAL_HISTORY_SETTINGS, type LocalHistorySettings } from '@easyview/contracts';
let servicePromise: Promise<TimelineService> | undefined;
let settings: LocalHistorySettings = { ...DEFAULT_LOCAL_HISTORY_SETTINGS };
export function desktopHistory(): Promise<TimelineService> {
  return servicePromise ??= Promise.all([
    discoverHostHistoryRoots(),
    readFile(path.join(app.getPath('userData'), 'timeline-settings.json'), 'utf8').then((raw) => { settings = validateHistorySettings(JSON.parse(raw)); }).catch((error) => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }),
  ]).then(([roots]) => new TimelineService(path.join(app.getPath('userData'), 'timeline'), roots));
}
export function validateHistorySettings(value: unknown): LocalHistorySettings {
  const input = value as LocalHistorySettings;
  if (!input || typeof input.enabled !== 'boolean' || !Number.isFinite(input.maxFileSize) || input.maxFileSize < 1 || !Number.isInteger(input.maxFileEntries) || input.maxFileEntries < 0 || !Number.isFinite(input.mergeWindow) || input.mergeWindow < 1) throw new Error('本地历史设置无效');
  return { enabled: input.enabled, maxFileSize: input.maxFileSize, maxFileEntries: input.maxFileEntries, mergeWindow: input.mergeWindow };
}
export async function getHistorySettings(): Promise<LocalHistorySettings> { await desktopHistory(); return { ...settings }; }
export async function setHistorySettings(value: unknown): Promise<void> { const next = validateHistorySettings(value); await writeFileAtomically(path.join(app.getPath('userData'), 'timeline-settings.json'), JSON.stringify(next)); settings = next; }
export async function captureDesktopHistory(filePath: string, content: string, label: string): Promise<void> {
  const service = await desktopHistory(); await service.local.capture(filePath, content, label, settings);
}
export function disposeDesktopHistory(): void { void servicePromise?.then((service) => service.dispose()); }

export async function captureDesktopHistoryPath(filePath: string): Promise<void> {
  await captureQueue.run(async () => { const service = await desktopHistory(); filePath = await realpath(filePath); if (!settings.enabled || !settings.maxFileEntries) return; const info = await stat(filePath); if (!info.isFile() || info.size > settings.maxFileSize * 1024) return; await service.local.capture(filePath, await readFile(filePath, 'utf8'), '外部文件变化', settings); });
}
