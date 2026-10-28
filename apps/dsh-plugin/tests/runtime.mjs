import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export const runtimeRoot = process.env.DSH_TEST_RUNTIME;
if (!runtimeRoot) throw new Error('DSH_TEST_RUNTIME must identify the target DSH installation');
const requireRuntime = createRequire(resolve(runtimeRoot, 'package.json'));
const vendored = resolve(runtimeRoot, 'vendor/cordis/lib/index.js');
export const { Context } = requireRuntime(existsSync(vendored) ? vendored : '@deepseek-ai/cordis');
