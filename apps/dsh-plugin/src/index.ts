/** Independent EasyView Host. DSH's connection owns authentication and route admission. */
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssetManifest, EasyViewBootstrap, EasyViewHostContext } from './shared/contracts.ts';
import { DocumentProvider, DocumentError } from './host/documents.ts';
import { DraftStore } from './host/draft-store.ts';
import { installDraftRoutes } from './host/draft-routes.ts';
import { OperationJournal } from './host/operation-journal.ts';
import { DshAiAdapter } from './host/ai-adapter';
import { installAiRoutes } from './host/ai-routes';
import { FileCommands } from './host/file-commands';
import { XlsxProposals } from './host/xlsx-proposals';
import { readBounded } from './host/draft-routes';

export const name = 'easyview';
export const inject = ['connection'];
export const UPSTREAM_SHA = '2400d66d2f8458822f895240b5389fee5bd8006d';
const PREFIX = '/api/easyview/v1';
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2', '.otf': 'font/otf', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png' };

/** Install only routes backed by built, inventoried files. Unload awaits every route disposer. */
export function apply(ctx: EasyViewHostContext, config: { maxDocumentBytes?: number; maxPendingCheckpoints?: number; checkpointDelayMs?: number; checkpointMaxRetries?: number } = {}): void {
  const maxDocumentBytes = config.maxDocumentBytes ?? 128 * 1024 * 1024;
  if (!Number.isSafeInteger(maxDocumentBytes) || maxDocumentBytes < 1 || maxDocumentBytes > 1024 * 1024 * 1024) throw new Error('maxDocumentBytes must be between 1 and 1073741824');
  const maxPendingCheckpoints = config.maxPendingCheckpoints ?? 2;
  if (!Number.isSafeInteger(maxPendingCheckpoints) || maxPendingCheckpoints < 1 || maxPendingCheckpoints > 16) throw new Error('maxPendingCheckpoints must be between 1 and 16');
  const checkpointDelayMs = config.checkpointDelayMs ?? 500, checkpointMaxRetries = config.checkpointMaxRetries ?? 3;
  if (!Number.isSafeInteger(checkpointDelayMs) || checkpointDelayMs < 50 || checkpointDelayMs > 30_000
    || !Number.isSafeInteger(checkpointMaxRetries) || checkpointMaxRetries < 0 || checkpointMaxRetries > 10) throw new Error('Invalid checkpoint delay or retry policy');
  const assetRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'workbench');
  const disposers: Array<() => Promise<void>> = [];
  let disposed = false;
  let manifest: AssetManifest | null = null;
  let store: DraftStore | null = null;
  let journal: OperationJournal | null = null;
  let ai: DshAiAdapter | null = null;
  let files: FileCommands | null = null;
  let xlsx: XlsxProposals | null = null;
  const documents = new DocumentProvider(() => ctx.get('fs'), () => ctx.get('workspaceRegistry')?.list() ?? [], maxDocumentBytes);
  const workspaces = () => {
    const registry = ctx.get('workspaceRegistry');
    return typeof registry?.list === 'function'
      ? registry.list().map(({ id, title }) => ({ id: String(id), title })) : [];
  };
  const bootstrap = (): EasyViewBootstrap => ({
    apiVersion: 1, pluginVersion: '0.1.0-dev.0', upstreamSha: UPSTREAM_SHA,
    status: manifest ? (store ? 'recoverable-office-preview' : 'ui-probe') : 'source-build-required',
    workspaces: workspaces(),
    capabilities: { originalWorkbench: Boolean(manifest), edit: Boolean(store), save: Boolean(journal), ai: false,
      sessionModelSelection: typeof ctx.get('sessionController')?.selectSessionModel === 'function' },
    frameUrl: manifest ? `${PREFIX}/assets/index.html` : null,
    checkpointPolicy: { delayMs: checkpointDelayMs, maxRetries: checkpointMaxRetries },
  });
  ctx.provide('easyview', { bootstrap, documents, get ai() { return ai; } });
  ctx.effect(() => {
    const install = async () => {
      const home = ctx.get('profileContext')?.home;
      if (home) {
        const directory = resolve(home, 'plugins/easyview');
        store = await DraftStore.open(directory);
        journal = new OperationJournal(directory, store, documents);
        await journal.recover();
        files = new FileCommands(documents, journal, maxDocumentBytes);
      }
      try {
        const parsed: unknown = JSON.parse(await readFile(resolve(assetRoot, 'asset-manifest.json'), 'utf8'));
        if (!parsed || typeof parsed !== 'object' || !('files' in parsed) || !Array.isArray(parsed.files)
          || !parsed.files.every((file: unknown): file is string => typeof file === 'string')) throw new Error('Invalid EasyView asset manifest');
        manifest = { files: parsed.files };
      } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
      if (disposed) return;
      const register = (route: Parameters<EasyViewHostContext['connection']['fetch']['register']>[0]) => disposers.push(ctx.connection.fetch.register(route));
      const drafts = store ? installDraftRoutes({ register, documents, store, journal, maxBytes: maxDocumentBytes, maxPending: maxPendingCheckpoints, isDisposed: () => disposed, logError: error => ctx.logger.error(error) }) : null;
      if (store && journal && drafts && files) {
        const directory = resolve(home!, 'plugins/easyview');
        xlsx = new XlsxProposals(directory, store, journal, documents, drafts);
        ai = new DshAiAdapter(directory, store, documents, {
          sessions: () => ctx.get('sessionController'), tools: () => ctx.get('tools'),
          agent: id => ctx.get('agents')?.get(id), workspaceExists: id => workspaces().some(workspace => workspace.id === id),
          modelSchemas: async agent => {
            const prompt = ctx.get('systemPrompt');
            if (!prompt) throw new DocumentError('DEPENDENCY_MISSING', 'DSH 模型工具装配接口不可用。');
            return (await prompt.assemble({ scope: agent })).tools;
          },
        }, files, xlsx);
      }
      if (ai) installAiRoutes(register, ai);
      if (files) register({ path: `${PREFIX}/create-markdown`, methods: ['POST'], requestBody: 'streaming', fetch: async request => {
        try {
          if (disposed) throw new Error('Plugin is unloading');
          const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(request, Math.min(maxDocumentBytes * 6 + 4096, 16 * 1024 * 1024))));
          const result = await files!.createMarkdown(input, request.signal);
          if (result.state !== 'committed') throw new DocumentError('CONFLICT', `新建提交状态：${result.state}，请查看恢复记录。`);
          return Response.json({ ok: true, value: result }, { headers: { 'cache-control': 'no-store' } });
        } catch (error) {
          if (!(error instanceof DocumentError)) ctx.logger.error(error);
          return Response.json({ ok: false, code: error instanceof DocumentError ? error.code : 'UNKNOWN',
            message: error instanceof DocumentError ? error.message : '新建未获确认，请核对文件列表及恢复记录。' }, { status: error instanceof DocumentError && error.code === 'PERMISSION_DENIED' ? 403 : 409 });
        }
      } });
      register({ path: `${PREFIX}/close`, methods: ['POST'], requestBody: 'buffered', fetch: async request => {
        const ids: unknown = await request.json();
        if (!Array.isArray(ids) || ids.length > 512 || !ids.every(id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id))) return new Response('Invalid document IDs', { status: 400 });
        for (const id of ids) { documents.close(id); drafts?.release(id); }
        return Response.json({ ok: true, value: true });
      } });
      register({ path: `${PREFIX}/bootstrap`, methods: ['GET'], requestBody: 'buffered',
        fetch: async () => Response.json(bootstrap(), { headers: { 'cache-control': 'no-store' } }) });
      const command = (path: string, action: (params: URLSearchParams, signal: AbortSignal) => Promise<unknown>) => {
        register({ path: `${PREFIX}/${path}`, methods: ['GET'], requestBody: 'buffered', fetch: async request => {
          try { return Response.json({ ok: true, value: await action(new URL(request.url).searchParams, request.signal) }, { headers: { 'cache-control': 'no-store' } }); }
          catch (error) {
            if (error instanceof DocumentError) return Response.json({ ok: false, code: error.code, message: error.message }, { status: error.code === 'PERMISSION_DENIED' ? 403 : error.code === 'CONFLICT' ? 409 : error.code === 'NOT_FOUND' ? 404 : 400 });
            ctx.logger.error(error);
            return Response.json({ ok: false, code: 'UNKNOWN', message: '文档操作失败，请查看插件日志。' }, { status: 500 });
          }
        } });
      };
      command('tree', (params, signal) => documents.list(params.get('workspaceId') ?? '', params.get('path') ?? '', signal));
      command('models', async () => {
        const controller = ctx.get('sessionController');
        if (!controller?.modelCatalog) throw new DocumentError('DEPENDENCY_MISSING', 'DSH 模型目录不可用。');
        return controller.modelCatalog();
      });
      command('open', (params, signal) => documents.open(params.get('workspaceId') ?? '', params.get('path') ?? '', signal));
      register({ path: `${PREFIX}/content`, methods: ['GET', 'HEAD'], requestBody: 'buffered', fetch: async request => {
        try {
          const bytes = await documents.read(new URL(request.url).searchParams.get('documentId') ?? '', request.signal);
          return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers: {
            'content-type': 'application/octet-stream', 'content-disposition': 'attachment', 'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; sandbox", 'cache-control': 'no-store',
          } });
        } catch (error) { return Response.json({ ok: false, code: error instanceof DocumentError ? error.code : 'UNKNOWN' }, { status: error instanceof DocumentError && error.code === 'PERMISSION_DENIED' ? 403 : 409 }); }
      } });
      if (!manifest) return;
      if (!Array.isArray(manifest.files)) throw new Error('Invalid EasyView asset manifest');
      const serve = async (file: string, method: string): Promise<Response> => {
        const filename = await realpath(resolve(assetRoot, file));
        const inside = relative(await realpath(assetRoot), filename);
        if (inside.startsWith('..') || isAbsolute(inside)) return new Response('Forbidden', { status: 403 });
        return new Response(method === 'HEAD' ? null : new Uint8Array(await readFile(filename)), {
          headers: { 'content-type': MIME[extname(file)] ?? 'application/octet-stream',
            'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
        });
      };
      const inventory = new Set(manifest.files);
      // DSH exact routes exclude spaces, commas and parentheses. Preserve these assets
      // through an inventoried query endpoint; drawing-engine URL adaptation is pending.
      register({ path: `${PREFIX}/asset`, methods: ['GET', 'HEAD'], requestBody: 'buffered', fetch: async request => {
        const file = new URL(request.url).searchParams.get('file');
        return file && inventory.has(file) ? serve(file, request.method) : new Response('Not found', { status: 404 });
      } });
      for (const file of manifest.files) {
        if (typeof file !== 'string' || file.includes('\\') || isAbsolute(file) || file.split('/').some(part => !part || part === '..' || part === '.')) {
          throw new Error('Unsafe EasyView asset entry');
        }
        if (!file.split('/').every(segment => /^[A-Za-z0-9_$.-]+$/.test(segment))) continue;
        register({ path: `${PREFIX}/assets/${file}`, methods: ['GET', 'HEAD'], requestBody: 'buffered',
          fetch: request => serve(file, request.method) });
      }
    };
    const ready = install().catch(error => { ctx.logger.error(error); throw error; });
    return async () => {
      disposed = true;
      await ready.catch(() => {});
      for (const dispose of disposers.reverse()) await dispose();
      manifest = null;
      await ai?.close(); ai = null;
      await xlsx?.close(); xlsx = null;
      await journal?.close(); journal = null;
      documents.dispose();
      await store?.close(); store = null;
    };
  });
}
