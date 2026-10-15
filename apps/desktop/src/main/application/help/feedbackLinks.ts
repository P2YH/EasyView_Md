import { tFeedback } from './feedbackLinks.i18n';

export const FEEDBACK_REPO_URL = 'https://github.com/tiantianmanmanzou/EasyView_Md';
export const FEEDBACK_EMAIL = 'zalmanzxy@gmail.com';

export interface FeedbackEnvironment {
  appVersion: string;
  platform: string;
  osVersion: string;
  arch: string;
  electronVersion?: string;
  logsDirectory?: string;
}

const PLATFORM_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

export function formatEnvironment(env: FeedbackEnvironment): string {
  const lines = [
    `- EasyView: ${env.appVersion}`,
    `- OS: ${PLATFORM_NAMES[env.platform] ?? env.platform} ${env.osVersion}`.trimEnd(),
    `- Arch: ${env.arch}`,
  ];
  if (env.electronVersion) lines.push(`- Electron: ${env.electronVersion}`);
  if (env.logsDirectory) lines.push(`- Logs: ${env.logsDirectory}`);
  return lines.join('\n');
}

export function buildIssueUrl(env: FeedbackEnvironment): string {
  const params = new URLSearchParams({
    template: 'bug_report.yml',
    labels: 'bug,desktop',
    title: '[Bug] ',
    environment: formatEnvironment(env),
  });
  return `${FEEDBACK_REPO_URL}/issues/new?${params.toString()}`;
}

export function buildFeedbackMailto(env: FeedbackEnvironment): string {
  const subject = tFeedback('mail.subject', { version: env.appVersion });
  const body = [
    tFeedback('mail.describe'),
    '',
    '',
    tFeedback('mail.steps'),
    '1. ',
    '',
    '---',
    tFeedback('mail.environment'),
    formatEnvironment(env),
  ].join('\n');
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export interface PathAnonymizeContext {
  platform: string;
  homeDir: string;
  appData?: string;
  userProfile?: string;
}

function replacePrefix(target: string, prefix: string | undefined, token: string, caseInsensitive: boolean, separators: string): string | undefined {
  if (!prefix) return undefined;
  const trimmed = prefix.replace(/[\\/]+$/, '');
  if (!trimmed) return undefined;
  const a = caseInsensitive ? target.toLowerCase() : target;
  const b = caseInsensitive ? trimmed.toLowerCase() : trimmed;
  if (a === b) return token;
  if (a.startsWith(b) && separators.includes(target[trimmed.length] ?? '')) return token + target.slice(trimmed.length);
  return undefined;
}

/** Removes the user name from a local path before it goes into a public issue/email. */
export function anonymizePath(target: string, ctx: PathAnonymizeContext): string {
  if (ctx.platform === 'win32') {
    return replacePrefix(target, ctx.appData, '%APPDATA%', true, '\\/')
      ?? replacePrefix(target, ctx.userProfile ?? ctx.homeDir, '%USERPROFILE%', true, '\\/')
      ?? target.replace(/^([a-z]:\\Users\\)[^\\]+/i, '$1<user>');
  }
  return replacePrefix(target, ctx.homeDir, '~', false, '/')
    ?? target.replace(/^\/(Users|home)\/[^/]+/, '/$1/<user>');
}
