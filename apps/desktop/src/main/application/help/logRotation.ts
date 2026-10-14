import { appendFileSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export interface FileLoggerOptions {
  directory: string;
  baseName?: string;
  maxBytes?: number;
  maxFiles?: number;
  now?: () => Date;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEYS = /(token|password|secret|api[-_]?key|authorization)\s*[:=]\s*\S+/gi;

export function sanitizeLogText(text: string, maxLength = 2000): string {
  const redacted = text.replace(SENSITIVE_KEYS, '$1=[redacted]');
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…[truncated]` : redacted;
}

export function formatLogLine(level: LogLevel, scope: string, message: string, date: Date): string {
  return `[${date.toISOString()}] [${level.toUpperCase()}] [${scope}] ${sanitizeLogText(message)}\n`;
}

export class FileLogger {
  readonly directory: string;
  readonly filePath: string;
  private readonly baseName: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly now: () => Date;

  constructor(options: FileLoggerOptions) {
    this.directory = options.directory;
    this.baseName = options.baseName ?? 'main';
    this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
    this.maxFiles = options.maxFiles ?? 5;
    this.now = options.now ?? (() => new Date());
    this.filePath = path.join(this.directory, `${this.baseName}.log`);
  }

  write(level: LogLevel, scope: string, message: string): void {
    try {
      mkdirSync(this.directory, { recursive: true });
      this.rotateIfNeeded();
      appendFileSync(this.filePath, formatLogLine(level, scope, message, this.now()), 'utf8');
    } catch {
      // logging must never crash the app
    }
  }

  private rotateIfNeeded(): void {
    let size = 0;
    try { size = statSync(this.filePath).size; } catch { return; }
    if (size < this.maxBytes) return;
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    renameSync(this.filePath, path.join(this.directory, `${this.baseName}-${stamp}.log`));
    this.pruneArchives();
  }

  private pruneArchives(): void {
    const prefix = `${this.baseName}-`;
    const archives = readdirSync(this.directory)
      .filter((name) => name.startsWith(prefix) && name.endsWith('.log'))
      .sort();
    const keep = Math.max(0, this.maxFiles - 1);
    for (const name of archives.slice(0, Math.max(0, archives.length - keep))) {
      try { unlinkSync(path.join(this.directory, name)); } catch { /* ignore */ }
    }
  }
}
