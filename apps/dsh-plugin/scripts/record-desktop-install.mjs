/** Record the authorized daily-profile installation only after exact-package and real-model checks pass. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = resolve(process.env.USERPROFILE, '.dsh/profiles/desktop');
const backup = resolve(profile, '.desktop-plugin-backups/easyview-20261028');
const installedRoot = resolve(profile, 'node_modules/dsh-plugin-easyview');
const load = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [artifact, before, after, protocol, ui, checks, packaged] = await Promise.all([
  load(resolve(root, 'artifacts/development-package.json')), load(resolve(backup, 'package.json')),
  load(resolve(profile, 'package.json')), load(resolve(root, 'docs/evidence/e05-desktop-real-ai.json')),
  load(resolve(root, 'docs/evidence/e05-desktop-real-ui.json')), load(resolve(root, 'docs/evidence/local-checks/results.json')),
  load(resolve(root, 'docs/evidence/development-package-check.json')),
]);
for (const evidence of [protocol, ui, checks, packaged]) assert.equal(evidence.status, 'passed');
assert.equal(packaged.sha256, artifact.sha256);
assert.equal(protocol.runs.length, 7); assert.equal(ui.realUserRequests, 1);
const originalBundles = before.dsh.profile.bundles;
assert.ok(originalBundles.every(name => after.dsh.profile.bundles.includes(name)));
assert.ok(after.dsh.profile.bundles.includes('dsh-plugin-easyview'));
for (const [name, value] of Object.entries(before.dependencies)) {
  if (name !== 'dsh-plugin-easyview') assert.equal(after.dependencies[name], value);
}
assert.deepEqual(await readFile(resolve(profile, 'cordis.patch.yml')), await readFile(resolve(backup, 'cordis.patch.yml')));
const archive = after.dependencies['dsh-plugin-easyview'].replace(/^file:/, '');
assert.equal(hash(await readFile(archive)), artifact.sha256);
let filesVerified = 0;
for (const file of artifact.files) {
  assert.deepEqual(await readFile(resolve(installedRoot, file.path)), await readFile(resolve(root, file.path)), file.path);
  filesVerified++;
}
for (const evidence of [protocol, ui]) for (const [path, expected] of Object.entries(evidence.installedRuntime)) {
  assert.equal(hash(await readFile(resolve(installedRoot, path))), expected, path);
}
const cache = resolve(profile, '.desktop-bundles/77a6620c101c23f71571/package');
const cacheManifest = await load(resolve(cache, 'SHA256SUMS.json'));
for (const file of cacheManifest.files) assert.equal(hash(await readFile(resolve(cache, file.path))), file.sha256, file.path);
const result = { status: 'installed-and-tested', updatedAt: new Date().toISOString(), desktopVersion: protocol.application.version,
  profile, artifact: archive, sha256: artifact.sha256, backup, currentConfiguredModel: protocol.model,
  packageInstallationCompleted: true, easyviewBundleEnabled: true, exactInstalledPackageFilesVerified: filesVerified,
  existingBundlesPreserved: true, originalBundles, existingDependencySpecsPreserved: true, userConfigurationPatchUnchanged: true,
  globalModelUnchanged: protocol.globalModelUnchanged && ui.globalModelUnchanged,
  verifiedRealModelUserRequests: protocol.runs.length + ui.realUserRequests,
  modelHttpCallCount: null, modelHttpCallCountNote: 'DSH owns tool-loop model HTTP calls; counts above are verified user requests, not HTTP calls or all diagnostic attempts.',
  evidence: { protocol: 'e05-desktop-real-ai.json', originalUi: 'e05-desktop-real-ui.json', screenshot: 'e05-desktop-real-ui.png',
    localChecks: 'local-checks/results.json', package: 'development-package-check.json', installationLog: 'desktop-install.log' },
  originalOfficeCacheRestored: { from: 'same installed Desktop bundled-plugins/dsh-plugin-office-agents/package',
    archiveSha256: '77a6620c101c23f715718f1c55c389737402a3960e282a90523b1a29757843ae', inventoryFilesVerified: cacheManifest.files.length, mismatches: 0 },
  desktopRelaunched: false,
  remainingGates: 'Development plugin only. E06 incomplete; E07 Office portal integration not started; complex format/lifecycle/offline/upgrade/uninstall acceptance remains.' };
await writeFile(resolve(root, 'docs/evidence/desktop-install-20261028.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, filesVerified, verifiedRealModelUserRequests: result.verifiedRealModelUserRequests, sha256: result.sha256 }, null, 2));
