import { app } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { macReplaceableBundle } from './updateCore';

const run = promisify(execFile);
const APP_NAME = 'EasyView_Md.app';

/**
 * Waits for the app to exit, swaps the bundle, and restores the old one if the swap fails.
 * Args: pid, target bundle, staged bundle, relaunch (1/0).
 */
const SWAP_SCRIPT = `
pid=$1; target=$2; staged=$3; relaunch=$4; backup="$staged.old"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
rm -rf "$backup"
mv "$target" "$backup" || exit 1
if mv "$staged" "$target"; then rm -rf "$backup"; else mv "$backup" "$target"; exit 1; fi
xattr -dr com.apple.quarantine "$target" 2>/dev/null
[ "$relaunch" = 1 ] && open "$target"
exit 0
`;

let pending: { target: string; staged: string; relaunch: boolean } | undefined;

/** The bundle to replace when the running app can be updated in place, else undefined. */
export async function replaceableBundle(): Promise<string | undefined> {
  const bundle = macReplaceableBundle(process.execPath);
  if (!bundle) return undefined;
  try {
    await access(path.dirname(bundle), constants.W_OK);
    return bundle;
  } catch {
    return undefined;
  }
}

/** Copies the app out of the verified DMG into `stagedApp`. */
export async function stageFromDmg(dmgPath: string, stagedApp: string): Promise<void> {
  const mountPoint = await mkdtemp(path.join(os.tmpdir(), 'easyview-update-'));
  await run('/usr/bin/hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mountPoint]);
  try {
    await rm(stagedApp, { recursive: true, force: true });
    await run('/usr/bin/ditto', [path.join(mountPoint, APP_NAME), stagedApp]);
  } finally {
    await run('/usr/bin/hdiutil', ['detach', mountPoint, '-force']).catch(() => {});
    await rm(mountPoint, { recursive: true, force: true }).catch(() => {});
  }
}

/** Replaces `target` with `staged` once the app has quit; relaunches the new version when asked. */
export function installOnQuit(target: string, staged: string, relaunch: boolean): void {
  if (!pending) {
    app.once('will-quit', () => {
      if (!pending) return;
      spawn('/bin/sh', ['-c', SWAP_SCRIPT, 'easyview-update', String(process.pid), pending.target, pending.staged, pending.relaunch ? '1' : '0'], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    });
  }
  pending = { target, staged, relaunch };
}
