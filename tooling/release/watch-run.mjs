#!/usr/bin/env node
/**
 * Watches one GitHub Actions run until it completes, listing every job and every step with its
 * live status. Network errors are retried silently; the exit code is the run's outcome.
 *
 *   node tooling/release/watch-run.mjs <run-id> [--repo owner/name] [--interval-seconds 10]
 *
 * In a terminal the view redraws full-screen every second, folding jobs that already succeeded;
 * when output goes to a file (a background job) a full snapshot is printed when a step changes state
 * and a one-line heartbeat with the running steps' elapsed time on every other poll.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const option = (name) => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : undefined; };
const runId = argv.find((arg, index) => /^\d+$/.test(arg) && !argv[index - 1]?.startsWith('--'));
const repo = option('repo');
const interval = Number(option('interval-seconds') ?? 10) * 1000;
if (!runId) { console.error('Usage: watch-run.mjs <run-id> [--repo owner/name] [--interval-seconds 10]'); process.exit(2); }

const tty = process.stdout.isTTY;
const BAR_WIDTH = 24;
const ICON = { success: '✓', failure: '✗', cancelled: '⊘', skipped: '–', timed_out: '✗', in_progress: '▶', queued: '·', waiting: '·', pending: '·' };

const gh = async (...args) => JSON.parse((await run('gh', [...args, ...(repo ? ['--repo', repo] : [])], { maxBuffer: 16 * 1024 * 1024 })).stdout);
const fetchRun = (id = runId) => gh('run', 'view', String(id), '--json', 'status,conclusion,workflowName,workflowDatabaseId,displayTitle,url,createdAt,jobs');

// Jobs gated by `needs` only show up once they are queued, so the last successful run of the
// same workflow supplies the full job and step list. Without one, only visible jobs are shown.
let baseline;
async function loadBaseline(workflowId) {
  try {
    const [last] = await gh('run', 'list', '--workflow', String(workflowId), '--status', 'success', '--limit', '1', '--json', 'databaseId');
    baseline = new Map(last ? (await fetchRun(last.databaseId)).jobs.map((job) => [job.name, (job.steps ?? []).map((step) => step.name)]) : []);
  } catch { /* retried on the next poll */ }
}

const started = (value) => value && !value.startsWith('0001-');
function duration(from, to) {
  if (!started(from)) return '';
  const seconds = Math.max(0, Math.round(((started(to) ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  const m = Math.floor(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m${String(seconds % 60).padStart(2, '0')}s`;
}
const bar = (fraction) => { const filled = Math.round(Math.min(1, Math.max(0, fraction)) * BAR_WIDTH); return `${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}`; };
const stateOf = (item) => (item.status === 'completed' ? item.conclusion || 'completed' : item.status);

function jobsWithSteps(data) {
  const jobs = (data.jobs ?? []).map((job) => ({
    ...job,
    steps: job.steps?.length ? job.steps : (baseline?.get(job.name) ?? []).map((name) => ({ name, status: 'pending' })),
  }));
  if (data.status === 'completed' || !baseline) return jobs;
  const seen = new Set(jobs.map((job) => job.name));
  for (const [name, steps] of baseline) {
    if (!seen.has(name)) jobs.push({ name, status: 'pending', steps: steps.map((step) => ({ name: step, status: 'pending' })) });
  }
  return jobs;
}

function jobFraction(job) {
  if (job.status === 'completed') return 1;
  return job.steps.length ? job.steps.filter((step) => step.status === 'completed').length / job.steps.length : 0;
}

function render(data, note, compact = false) {
  const jobs = jobsWithSteps(data);
  const overall = jobs.length ? jobs.reduce((sum, job) => sum + jobFraction(job), 0) / jobs.length : 0;
  const state = stateOf(data);
  const lines = [
    `${data.workflowName} · ${data.displayTitle}`,
    `${bar(overall)} ${String(Math.round(overall * 100)).padStart(3)}%  ${ICON[state] ?? ''} ${state}  ${duration(data.createdAt)}${note ? `  (${note})` : ''}`,
  ];
  for (const job of jobs) {
    const done = job.steps.filter((step) => step.status === 'completed').length;
    lines.push('', `${ICON[stateOf(job)] ?? ' '} ${job.name}  ${bar(jobFraction(job))} ${done}/${job.steps.length}  ${duration(job.startedAt, job.completedAt)}`);
    if (compact && job.conclusion === 'success') continue;
    const nameWidth = Math.max(0, ...job.steps.map((step) => step.name.length));
    for (const step of job.steps) {
      const stepState = stateOf(step);
      const time = stepState === 'skipped' ? '' : duration(step.startedAt, step.completedAt);
      lines.push(`    ${ICON[stepState] ?? ' '} ${step.name.padEnd(nameWidth)}  ${time}`.trimEnd());
    }
  }
  lines.push('', data.url);
  return lines;
}

function failedSteps(data) {
  return (data.jobs ?? []).filter((job) => job.conclusion && !['success', 'skipped'].includes(job.conclusion))
    .map((job) => `✗ ${job.name}: ${(job.steps ?? []).filter((step) => step.conclusion === 'failure').map((step) => step.name).join(', ') || job.conclusion}`);
}

// The terminal view lives on the alternate screen and is redrawn from the top, clipped to the
// window: cursor-relative redraws break once output is taller or wider than the terminal.
const leaveScreen = () => process.stdout.write('\x1b[?25h\x1b[?1049l');
if (tty) {
  process.stdout.write('\x1b[?1049h\x1b[?25l');
  process.on('SIGINT', () => { leaveScreen(); process.exit(130); });
}

let data;
let note = '';
let lastSignature = '';
function draw() {
  if (!data) return;
  if (tty) {
    const rows = process.stdout.rows || 60;
    const columns = process.stdout.columns || 140;
    let lines = render(data, note, true).map((line) => line.slice(0, columns));
    if (lines.length > rows) lines = [...lines.slice(0, rows - 1), `… ${lines.length - rows + 1} more lines, enlarge the window to see them`.slice(0, columns)];
    process.stdout.write(`\x1b[H${lines.map((line) => `${line}\x1b[K`).join('\n')}\x1b[J`);
    return;
  }
  const lines = render(data, note);
  const signature = JSON.stringify(jobsWithSteps(data).map((job) => [job.name, job.status, job.conclusion, job.steps.map(stateOf)]).concat([data.status]));
  const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  if (signature === lastSignature) {
    const running = (data.jobs ?? []).flatMap((job) => (job.steps ?? []).filter((step) => step.status === 'in_progress').map((step) => `${job.name} › ${step.name} ${duration(step.startedAt)}`));
    console.log(`[${now}] ${duration(data.createdAt)}  ▶ ${running.join(' | ') || stateOf(data)}${note ? `  (${note})` : ''}`);
    return;
  }
  lastSignature = signature;
  console.log(`[${now}]`);
  console.log(lines.join('\n'));
}

const ticker = tty ? setInterval(draw, 1000) : undefined;
for (;;) {
  try {
    const next = await fetchRun();
    if (!baseline && next.status !== 'completed') await loadBaseline(next.workflowDatabaseId);
    data = next;
    note = '';
  } catch (error) {
    note = `query failed, retrying: ${String(error.stderr || error.message).trim().split('\n')[0].slice(0, 80)}`;
    if (!data) console.error(note);
  }
  draw();
  if (data?.status === 'completed') break;
  await new Promise((resolve) => setTimeout(resolve, data ? interval : 5000));
}
clearInterval(ticker);
if (tty) { leaveScreen(); console.log(render(data, '').join('\n')); }

const failures = failedSteps(data);
if (failures.length) console.log(failures.join('\n'));
console.log(`Run ${data.conclusion}: ${data.url}`);
process.exit(data.conclusion === 'success' ? 0 : 1);
