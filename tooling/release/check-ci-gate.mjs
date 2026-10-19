#!/usr/bin/env node
/**
 * Release gate (layer 3): the commit being released must already have green runs of the
 * layer-1 and layer-2 workflows. Nothing is re-run here; we only read the Actions API through
 * `gh` (GITHUB_TOKEN with `actions: read` in CI, or your own `gh auth` locally).
 *
 *   node tooling/release/check-ci-gate.mjs --sha <commit> [--repo owner/name]
 *        [--workflows ci.yml,extension-e2e.yml,desktop-build.yml] [--timeout-minutes 45] [--interval-seconds 30]
 *
 * For each workflow, the newest run for the commit decides:
 *   success                      -> pass
 *   queued / in_progress         -> wait (bounded by --timeout-minutes), then fail
 *   failure / cancelled / other  -> fail now
 *   no run yet                   -> wait up to --missing-grace-minutes (default 3), then fail
 */
import { execFileSync } from 'node:child_process';

const DEFAULT_WORKFLOWS = ['ci.yml', 'extension-e2e.yml', 'desktop-build.yml'];
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, index, all) => {
  if (arg.startsWith('--')) { const [key, inline] = arg.slice(2).split('='); pairs.push([key, inline ?? all[index + 1]]); }
  return pairs;
}, []));
let sha = args.sha ?? process.env.GATE_SHA;
const repo = args.repo ?? process.env.GITHUB_REPOSITORY ?? execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { encoding: 'utf8' }).trim();
const workflows = (args.workflows ?? DEFAULT_WORKFLOWS.join(',')).split(',').map((name) => name.trim()).filter(Boolean);
const deadline = Date.now() + Number(args['timeout-minutes'] ?? 45) * 60_000;
const missingDeadline = Date.now() + Number(args['missing-grace-minutes'] ?? 3) * 60_000;
const interval = Number(args['interval-seconds'] ?? 30) * 1000;
if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) { console.error('Usage: check-ci-gate.mjs --sha <commit>'); process.exit(2); }
// The runs API only matches full SHAs.
if (sha.length < 40) sha = execFileSync('gh', ['api', `repos/${repo}/commits/${sha}`, '-q', '.sha'], { encoding: 'utf8' }).trim();

function latestRun(workflow) {
  const out = execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', `repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=20`], { encoding: 'utf8' });
  const runs = (JSON.parse(out).workflow_runs ?? []).filter((run) => run.head_sha === sha);
  return runs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}

console.log(`Release gate for ${repo}@${sha}: ${workflows.join(', ')}`);
for (;;) {
  const pending = []; const failed = [];
  for (const workflow of workflows) {
    let run;
    try { run = latestRun(workflow); }
    catch (error) { failed.push(`${workflow}: cannot query (${String(error.message ?? error).split('\n')[0]})`); continue; }
    if (!run) { (Date.now() < missingDeadline ? pending : failed).push(`${workflow}: no run for this commit`); continue; }
    const label = `${workflow}: ${run.status}${run.conclusion ? `/${run.conclusion}` : ''} ${run.html_url}`;
    if (run.status !== 'completed') pending.push(label);
    else if (run.conclusion === 'success') console.log(`  ok   ${label}`);
    else failed.push(label);
  }
  if (failed.length) { console.error('Release gate FAILED:'); for (const line of [...failed, ...pending]) console.error(`  ${line}`); process.exit(1); }
  if (!pending.length) { console.log('Release gate passed.'); process.exit(0); }
  if (Date.now() >= deadline) { console.error('Release gate timed out waiting for:'); for (const line of pending) console.error(`  ${line}`); process.exit(1); }
  console.log(`  waiting: ${pending.join(' | ')}`);
  await new Promise((resolve) => setTimeout(resolve, interval));
}
