/** Workspace and web-search tools available to EasyView Agent mode. */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { applyAiTextPatches, type AiTextPatch } from '@easyview/contracts';
import { writeFileAtomically } from '../filesystem/file-write';
import { tAi } from './ai.i18n';

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 1_000_000;
const MAX_LIST_ENTRIES = 500;
const BRAVE_WEB_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

export interface ActiveAgentDocument {
  path: string;
  content: string;
  applyPatches: (patches: AiTextPatch[]) => Promise<void> | void;
}

export interface CreateAiAgentToolsOptions {
  workspaceRootPath: string | null;
  activeDocument?: ActiveAgentDocument;
  includeWorkspaceTools?: boolean;
  webSearchApiKey?: string | null;
  fetchImpl?: typeof fetch;
}

interface EditBaseline {
  id: string;
  path: string;
  content: string;
}

type WorkspaceFileEntry = { path: string; type: 'file' | 'directory'; size?: number };

function ensureRelativePath(value: string, field = 'path'): string {
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized === '.') throw new Error(tAi('tools.fieldEmpty', { field }));
  if (path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error(tAi('tools.fieldNotRelative', { field }));
  }
  return normalized;
}

function ensureWithinRoot(rootPath: string, candidatePath: string): void {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new Error(tAi('tools.pathOutsideWorkspace'));
}

function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

function numberedLines(content: string, startLine: number, endLine: number): string {
  return content.split('\n').slice(startLine - 1, endLine).map((line, index) => `${startLine + index}\t${line}`).join('\n');
}

async function workspaceRoot(rootPath: string): Promise<string> {
  const stat = await fs.stat(rootPath);
  if (!stat.isDirectory()) throw new Error(tAi('tools.workspaceRootUnavailable'));
  return fs.realpath(rootPath);
}

async function resolveExistingPath(rootPath: string, relativePath: string): Promise<string> {
  const candidate = path.resolve(rootPath, ensureRelativePath(relativePath));
  ensureWithinRoot(rootPath, candidate);
  const stat = await fs.lstat(candidate);
  if (stat.isSymbolicLink()) throw new Error(tAi('tools.symlinkUnsupported'));
  const realPath = await fs.realpath(candidate);
  ensureWithinRoot(rootPath, realPath);
  return realPath;
}

async function resolveCreationPath(rootPath: string, relativePath: string): Promise<string> {
  const candidate = path.resolve(rootPath, ensureRelativePath(relativePath));
  ensureWithinRoot(rootPath, candidate);
  const parentPath = path.dirname(candidate);
  const parentStat = await fs.lstat(parentPath);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error(tAi('tools.parentUnavailable'));
  const realParent = await fs.realpath(parentPath);
  ensureWithinRoot(rootPath, realParent);
  const targetPath = path.join(realParent, path.basename(candidate));
  ensureWithinRoot(rootPath, targetPath);
  return targetPath;
}

function assertContentSize(content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error(tAi('tools.contentTooLarge', { max: MAX_FILE_BYTES }));
}

async function gitBaseline(rootPath: string, relativePath: string): Promise<{ repository: boolean; status: string; diff: string }> {
  try {
    const [{ stdout: status }, { stdout: diff }] = await Promise.all([
      execFileAsync('git', ['status', '--short'], { cwd: rootPath, maxBuffer: MAX_FILE_BYTES }),
      execFileAsync('git', ['diff', '--', relativePath], { cwd: rootPath, maxBuffer: MAX_FILE_BYTES }),
    ]);
    return { repository: true, status: status.trimEnd(), diff: diff.trimEnd() };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const rawExitCode = (error as { code?: unknown }).code;
    const exitCode = typeof rawExitCode === 'number' || typeof rawExitCode === 'string'
      ? Number(rawExitCode)
      : undefined;
    if (code === 'ENOENT' || exitCode === 128) return { repository: false, status: '', diff: '' };
    throw error;
  }
}

function fileTools(rootPath: string, activeDocument?: ActiveAgentDocument): ToolSet {
  const baselines = new Map<string, EditBaseline>();
  const activePath = activeDocument ? path.resolve(activeDocument.path) : undefined;
  const activeRelativePath = activePath ? path.relative(rootPath, activePath).split(path.sep).join('/') : undefined;

  const inspectPath = async (requestedPath?: string): Promise<{ path: string; content: string; diskPath?: string; active: boolean }> => {
    if (!requestedPath && activeDocument && activeRelativePath && !activeRelativePath.startsWith('..')) {
      return { path: activeRelativePath, content: activeDocument.content, active: true };
    }
    if (!requestedPath) throw new Error(tAi('tools.pathRequired'));
    const normalized = ensureRelativePath(requestedPath);
    const filePath = await resolveExistingPath(rootPath, normalized);
    const stat = await fs.lstat(filePath);
    if (!stat.isFile()) throw new Error(tAi('tools.notRegularFile'));
    if (stat.size > MAX_FILE_BYTES) throw new Error(tAi('tools.fileTooLarge', { size: stat.size, max: MAX_FILE_BYTES }));
    const content = await fs.readFile(filePath, 'utf8');
    if (content.includes('\0')) throw new Error(tAi('tools.binaryUnsupported'));
    return { path: normalized, content, diskPath: filePath, active: activePath === path.resolve(filePath) };
  };

  return {
    list_files: tool({
      description: tAi('tools.listFiles.description'),
      inputSchema: z.object({ path: z.string().optional().describe(tAi('tools.listFiles.path')) }),
      execute: async ({ path: relativePath = '.' }): Promise<{ path: string; entries: WorkspaceFileEntry[] }> => {
        const directoryPath = relativePath === '.' ? rootPath : await resolveExistingPath(rootPath, relativePath);
        const stat = await fs.lstat(directoryPath);
        if (!stat.isDirectory()) throw new Error(tAi('tools.listFiles.notDirectory'));
        const entries = await fs.readdir(directoryPath, { withFileTypes: true });
        if (entries.length > MAX_LIST_ENTRIES) throw new Error(tAi('tools.listFiles.tooManyEntries', { count: entries.length, max: MAX_LIST_ENTRIES }));
        const result = await Promise.all(entries.filter((entry) => !entry.isSymbolicLink()).map(async (entry): Promise<WorkspaceFileEntry> => {
          const entryPath = path.join(directoryPath, entry.name);
          const relative = path.relative(rootPath, entryPath).split(path.sep).join('/');
          if (entry.isDirectory()) return { path: relative, type: 'directory' };
          return { path: relative, type: 'file', size: (await fs.stat(entryPath)).size };
        }));
        result.sort((left, right) => left.type.localeCompare(right.type) || left.path.localeCompare(right.path));
        return { path: relativePath, entries: result };
      },
    }),

    inspect_file: tool({
      description: tAi('tools.inspectFile.description'),
      inputSchema: z.object({
        path: z.string().optional().describe(tAi('tools.inspectFile.path')),
        startLine: z.number().int().min(1).optional().describe(tAi('tools.inspectFile.startLine')),
        endLine: z.number().int().min(1).optional().describe(tAi('tools.inspectFile.endLine')),
      }),
      execute: async ({ path: requestedPath, startLine = 1, endLine }): Promise<{ baselineId: string; path: string; totalLines: number; selectedLines: string; git: { repository: boolean; status: string; diff: string } }> => {
        const inspected = await inspectPath(requestedPath);
        const totalLines = inspected.content.split('\n').length;
        const finalEndLine = Math.min(endLine ?? totalLines, totalLines);
        if (startLine > finalEndLine) throw new Error(tAi('tools.inspectFile.invalidRange'));
        const baselineId = `${inspected.path}:${contentHash(inspected.content)}`;
        baselines.set(baselineId, { id: baselineId, path: inspected.path, content: inspected.content });
        return {
          baselineId,
          path: inspected.path,
          totalLines,
          selectedLines: numberedLines(inspected.content, startLine, finalEndLine),
          git: await gitBaseline(rootPath, inspected.path),
        };
      },
    }),

    read_file: tool({
      description: tAi('tools.readFile.description'),
      inputSchema: z.object({ path: z.string().describe(tAi('tools.readFile.path')) }),
      execute: async ({ path: requestedPath }): Promise<{ path: string; content: string }> => {
        const inspected = await inspectPath(requestedPath);
        return { path: inspected.path, content: inspected.content };
      },
    }),

    apply_patch: tool({
      description: tAi('tools.applyPatch.description'),
      inputSchema: z.object({
        baselineId: z.string().min(1).describe(tAi('tools.applyPatch.baselineId')),
        patches: z.array(z.object({
          description: z.string().min(1).describe(tAi('tools.applyPatch.patchDescription')),
          expectedText: z.string().min(1).describe(tAi('tools.applyPatch.expectedText')),
          replacement: z.string().describe(tAi('tools.applyPatch.replacement')),
        })).min(1),
      }),
      execute: async ({ baselineId, patches }): Promise<{ path: string; changed: number }> => {
        const baseline = baselines.get(baselineId);
        if (!baseline) throw new Error(tAi('tools.applyPatch.baselineMissing'));
        const inspected = await inspectPath(baseline.path);
        if (inspected.content !== baseline.content) throw new Error(tAi('tools.applyPatch.baselineStale'));
        const nextContent = applyAiTextPatches(baseline.content, patches);
        if (inspected.active) {
          if (!activeDocument) throw new Error(tAi('tools.applyPatch.activeDocumentUnavailable'));
          await activeDocument.applyPatches(patches);
        } else {
          if (!inspected.diskPath) throw new Error(tAi('tools.applyPatch.targetPathUnavailable'));
          await writeFileAtomically(inspected.diskPath, nextContent);
        }
        return { path: baseline.path, changed: patches.length };
      },
    }),

    create_file: tool({
      description: tAi('tools.createFile.description'),
      inputSchema: z.object({ path: z.string().describe(tAi('tools.createFile.path')), content: z.string().describe(tAi('tools.createFile.content')) }),
      execute: async ({ path: relativePath, content }): Promise<{ path: string; bytes: number }> => {
        assertContentSize(content);
        const filePath = await resolveCreationPath(rootPath, relativePath);
        await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
        return { path: ensureRelativePath(relativePath), bytes: Buffer.byteLength(content, 'utf8') };
      },
    }),
  };
}

function webSearchTool(apiKey: string, fetchImpl?: typeof fetch): ToolSet {
  return {
    web_search: tool({
      description: tAi('tools.webSearch.description'),
      inputSchema: z.object({ query: z.string().trim().min(1).max(400).describe(tAi('tools.webSearch.query')), count: z.number().int().min(1).max(10).optional().describe(tAi('tools.webSearch.count')) }),
      execute: async ({ query, count = 5 }): Promise<{ query: string; results: Array<{ title: string; url: string; snippet: string; publishedAt?: string }> }> => {
        const requestUrl = new URL(BRAVE_WEB_SEARCH_URL);
        requestUrl.searchParams.set('q', query);
        requestUrl.searchParams.set('count', String(count));
        const response = await (fetchImpl ?? fetch)(requestUrl, { headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey } });
        if (!response.ok) throw new Error(tAi('tools.webSearch.failed', { status: response.status, detail: (await response.text()).slice(0, 300) }));
        const payload = await response.json() as { web?: { results?: Array<{ title?: unknown; url?: unknown; description?: unknown; age?: unknown }> } };
        const results = (payload.web?.results ?? []).filter((item): item is { title: string; url: string; description?: string; age?: string } => typeof item.title === 'string' && typeof item.url === 'string').map((item) => ({
          title: item.title,
          url: item.url,
          snippet: typeof item.description === 'string' ? item.description : '',
          ...(typeof item.age === 'string' ? { publishedAt: item.age } : {}),
        }));
        return { query, results };
      },
    }),
  };
}

/** Creates only the tools that can be executed in the current host context. */
export async function createAiAgentTools(options: CreateAiAgentToolsOptions): Promise<ToolSet> {
  const tools: ToolSet = {};
  if (options.includeWorkspaceTools && options.workspaceRootPath) {
    Object.assign(tools, fileTools(await workspaceRoot(options.workspaceRootPath), options.activeDocument));
  }
  if (options.webSearchApiKey?.trim()) Object.assign(tools, webSearchTool(options.webSearchApiKey.trim(), options.fetchImpl));
  return tools;
}
