import { app, type WebContents } from 'electron';
import { FileLogger, type LogLevel } from './logRotation';

let logger: FileLogger | undefined;

export function getLogsDirectory(): string {
  return app.getPath('logs');
}

export function log(level: LogLevel, scope: string, message: string): void {
  logger?.write(level, scope, message);
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
}

function attachWebContents(contents: WebContents): void {
  contents.on('render-process-gone', (_event, details) => {
    log('error', 'renderer', `render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
  contents.on('unresponsive', () => log('warn', 'renderer', 'window unresponsive'));
  contents.on('responsive', () => log('info', 'renderer', 'window responsive again'));
  contents.on('preload-error', (_event, preloadPath, error) => log('error', 'preload', `${preloadPath}: ${describeError(error)}`));
  contents.on('did-fail-load', (_event, code, description) => log('warn', 'renderer', `did-fail-load ${code} ${description}`));
  // Only renderer errors (level 3) are recorded; message text comes from console/window.onerror, not document content.
  contents.on('console-message', (...args: unknown[]) => {
    const first = args[0] as { level?: unknown; message?: unknown; lineNumber?: unknown; sourceId?: unknown };
    const level = typeof first?.level === 'string' ? first.level : args[1];
    const isError = level === 'error' || level === 3;
    if (!isError) return;
    const message = typeof first?.message === 'string' ? first.message : String(args[2] ?? '');
    const source = typeof first?.sourceId === 'string' ? first.sourceId : String(args[4] ?? '');
    const line = first?.lineNumber ?? args[3];
    log('error', 'renderer-console', `${message} (${source.split('/').pop()}:${String(line)})`);
  });
}

export function installAppLogger(): void {
  if (logger) return;
  logger = new FileLogger({ directory: getLogsDirectory(), baseName: 'main', maxBytes: 2 * 1024 * 1024, maxFiles: 5 });
  log('info', 'app', `starting EasyView ${app.getVersion()} electron=${process.versions.electron} ${process.platform}/${process.arch}`);
  process.on('uncaughtException', (error) => log('error', 'main', `uncaughtException ${describeError(error)}`));
  process.on('unhandledRejection', (reason) => log('error', 'main', `unhandledRejection ${describeError(reason)}`));
  app.on('ready', () => log('info', 'app', 'ready'));
  app.on('web-contents-created', (_event, contents) => attachWebContents(contents));
  app.on('child-process-gone', (_event, details) => log('error', 'app', `child-process-gone type=${details.type} reason=${details.reason}`));
  app.on('window-all-closed', () => log('info', 'app', 'window-all-closed'));
  app.on('before-quit', () => log('info', 'app', 'before-quit'));
  app.on('will-quit', () => log('info', 'app', 'will-quit'));
}
