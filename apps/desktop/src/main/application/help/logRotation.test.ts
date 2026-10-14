import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileLogger, sanitizeLogText } from './logRotation';

describe('FileLogger', () => {
  it('writes formatted lines', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ev-log-'));
    const logger = new FileLogger({ directory: dir });
    logger.write('info', 'app', 'started');
    expect(readFileSync(logger.filePath, 'utf8')).toMatch(/\[INFO\] \[app\] started/);
  });

  it('rotates by size and caps retained files', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ev-log-'));
    let t = Date.UTC(2026, 0, 1);
    const logger = new FileLogger({ directory: dir, maxBytes: 100, maxFiles: 3, now: () => new Date(t += 1000) });
    for (let i = 0; i < 40; i += 1) logger.write('info', 'test', 'x'.repeat(60));
    const files = readdirSync(dir);
    expect(files).toContain('main.log');
    expect(files.length).toBe(3);
  });

  it('redacts secrets and truncates long text', () => {
    expect(sanitizeLogText('apiKey=abc123 ok')).toBe('apiKey=[redacted] ok');
    expect(sanitizeLogText('a'.repeat(50), 10)).toBe(`${'a'.repeat(10)}…[truncated]`);
  });
});
