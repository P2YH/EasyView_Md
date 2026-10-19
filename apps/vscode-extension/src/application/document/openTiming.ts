import { logOpenWithDebug } from './openWithDebug';

const startedAt = new Map<string, number>();

/**
 * Records one stage of opening a Markdown file in the "EasyView_Md Open Debug" channel as an
 * offset from the first stage seen for that path. `request` restarts the clock.
 */
export function markOpenTiming(fsPath: string, stage: string, at = Date.now(), meta?: Record<string, unknown>): void {
  if (stage === 'request' || !startedAt.has(fsPath)) startedAt.set(fsPath, at);
  const offset = Math.round(at - startedAt.get(fsPath)!);
  logOpenWithDebug(`timing.${stage}`, { path: fsPath, ms: offset, ...meta });
}

/** Webview boot marks arrive as epoch milliseconds; log them on the same clock. */
export function markWebviewBootTiming(fsPath: string, marks: Record<string, unknown>): void {
  const entries = Object.entries(marks)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 1e12)
    .sort((a, b) => a[1] - b[1]);
  for (const [stage, at] of entries) markOpenTiming(fsPath, `webview.${stage}`, at);
  const extras = Object.fromEntries(Object.entries(marks).filter(([, value]) => typeof value !== 'number' || value <= 1e12));
  if (Object.keys(extras).length) logOpenWithDebug('timing.webview.resources', { path: fsPath, ...extras });
}
