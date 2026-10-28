/** Byte publication after Provider authorization. No delete-and-recreate fallback. */
import { mkdtemp, open, rename, rm, stat, link, unlink } from 'node:fs/promises';
import { basename, dirname, join, toNamespacedPath } from 'node:path';

async function windowsReplace(target: string, temporary: string): Promise<void> {
  const koffi = (await import('koffi')).default;
  const kernel = koffi.load('kernel32.dll');
  const replace = kernel.func('int __stdcall ReplaceFileW(const char16_t *target, const char16_t *replacement, const char16_t *backup, uint32_t flags, void *exclude, void *reserved)');
  const lastError = kernel.func('uint32_t __stdcall GetLastError()');
  if (!replace(toNamespacedPath(target), toNamespacedPath(temporary), null, 0, null, null)) throw new Error(`ReplaceFileW failed (${lastError()}); original and journal retained`);
}

async function copyWindowsDacl(target: string, temporary: string): Promise<void> {
  const koffi = (await import('koffi')).default;
  const security = koffi.load('advapi32.dll');
  const get = security.func('int __stdcall GetFileSecurityW(const char16_t *path, uint32_t information, void *descriptor, uint32_t length, _Out_ uint32_t *needed)');
  const set = security.func('int __stdcall SetFileSecurityW(const char16_t *path, uint32_t information, const void *descriptor)');
  const needed = [0]; get(toNamespacedPath(target), 4, null, 0, needed);
  if (!needed[0] || needed[0] > 1024 * 1024) throw new Error('Cannot read original file permissions');
  const descriptor = Buffer.alloc(needed[0]);
  if (!get(toNamespacedPath(target), 4, descriptor, descriptor.length, needed)
    || !set(toNamespacedPath(temporary), 0x80000004, descriptor)) throw new Error('Cannot preserve original file permissions');
}

export async function replaceLocalBytes(path: string, bytes: Uint8Array, verify: () => Promise<void>): Promise<void> {
  const info = await stat(path);
  if (!info.isFile() || info.nlink !== 1) throw new Error('Byte publication requires a regular file without hard-link aliases');
  const staging = await mkdtemp(join(dirname(path), '.easyview-'));
  const temporary = join(staging, basename(path));
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      if (process.platform === 'win32') await copyWindowsDacl(path, temporary);
      await file.writeFile(bytes); await file.chmod(info.mode); await file.sync();
    } finally { await file.close(); }
    await verify();
    if (process.platform === 'win32') await windowsReplace(path, temporary);
    else {
      await rename(temporary, path);
      const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    // Only our newly-created staging directory can be removed here. Publication
    // success is established by journal read-back, even if residue cleanup fails.
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/** Publish a complete file atomically with an OS-level no-overwrite condition. */
export async function createLocalBytes(path: string, bytes: Uint8Array, verify: () => Promise<void>): Promise<void> {
  const staging = await mkdtemp(join(dirname(path), '.easyview-'));
  const temporary = join(staging, basename(path));
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await verify();
    if (process.platform === 'win32') {
      const koffi = (await import('koffi')).default, kernel = koffi.load('kernel32.dll');
      const move = kernel.func('int __stdcall MoveFileExW(const char16_t *source, const char16_t *target, uint32_t flags)');
      const lastError = kernel.func('uint32_t __stdcall GetLastError()');
      // WRITE_THROUGH only: deliberately omit REPLACE_EXISTING and COPY_ALLOWED.
      if (!move(toNamespacedPath(temporary), toNamespacedPath(path), 8)) throw new Error(`Exclusive file publication failed (${lastError()})`);
    } else {
      await link(temporary, path); await unlink(temporary);
      const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await rm(staging, { recursive: true, force: true }).catch(() => {}); }
}
