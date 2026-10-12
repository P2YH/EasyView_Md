import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

function isReplaceBlocked(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

export async function writeFileAtomically(
  targetPath: string,
  data: string | Uint8Array,
): Promise<void> {
  const directory = path.dirname(targetPath);
  await mkdir(directory, { recursive: true });
  const token = randomUUID();
  const temporaryPath = path.join(directory, `.${path.basename(targetPath)}.${token}.tmp`);
  const backupPath = path.join(directory, `.${path.basename(targetPath)}.${token}.bak`);
  let backupCreated = false;
  let preserveBackup = false;
  try {
    await writeFile(temporaryPath, data, { flag: "wx" });
    try {
      // rename() replaces an existing target in one step on every platform
      // (MoveFileEx with MOVEFILE_REPLACE_EXISTING on Windows), so readers never
      // observe a missing file.
      await rename(temporaryPath, targetPath);
    } catch (error) {
      // Windows refuses to replace a target that another process holds open
      // without FILE_SHARE_DELETE. Only then move the original aside first.
      if (process.platform !== "win32" || !isReplaceBlocked(error)) throw error;
      try {
        await rename(targetPath, backupPath);
        backupCreated = true;
      } catch (backupError) {
        if ((backupError as NodeJS.ErrnoException).code !== "ENOENT") throw backupError;
      }
      await rename(temporaryPath, targetPath);
    }
    if (backupCreated) await rm(backupPath, { force: true });
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (backupCreated) {
      try {
        await rename(backupPath, targetPath);
      } catch {
        preserveBackup = true;
      }
    }
    throw error;
  } finally {
    if (!preserveBackup) await rm(backupPath, { force: true }).catch(() => undefined);
  }
}

export async function replaceDirectoryAtomically(
  targetDir: string,
  temporaryDir: string,
): Promise<void> {
  const backupDir = `${targetDir}.${randomUUID()}.bak`;
  let backupCreated = false;
  try {
    try {
      await rename(targetDir, backupDir);
      backupCreated = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
    await rename(temporaryDir, targetDir);
    if (backupCreated) await rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true }).catch(() => undefined);
    if (backupCreated) {
      await rename(backupDir, targetDir).catch(() => undefined);
    }
    throw error;
  }
}
