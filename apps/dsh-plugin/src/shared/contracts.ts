/** Public v1 bootstrap. Capabilities report verified operations, not file extensions. */
export interface EasyViewBootstrap {
  apiVersion: 1;
  pluginVersion: string;
  upstreamSha: string;
  status: 'source-build-required' | 'ui-probe' | 'recoverable-office-preview';
  workspaces: Array<{ id: string; title: string }>;
  capabilities: {
    originalWorkbench: boolean;
    edit: boolean;
    save: boolean;
    ai: boolean;
    sessionModelSelection: boolean;
  };
  frameUrl: string | null;
  checkpointPolicy: { delayMs: number; maxRetries: number };
}

export interface EasyViewFactoryProps {
  apiVersion: 1;
  presentation: 'standalone' | 'embedded';
  /** Optional host palette. Document formatting remains owned by EasyView. */
  hostTheme?: 'office';
  workspaceId?: string;
  openIntentId?: string;
  onReady?(controller: EasyViewWorkbenchController): void;
}
export interface EasyViewWorkbenchController {
  openDocument(relativePath: string): Promise<void>;
  flush(): Promise<void>;
  requestClose(): Promise<boolean>;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  dispose(): Promise<void>;
}

export interface AssetManifest { files: string[] }
export interface EasyViewService {
  readonly ai?: { tool(name: string, args: unknown, execution: import('./ai').AiExecution): Promise<string> } | null;
  bootstrap(): EasyViewBootstrap;
  documents: Pick<import('../host/documents.ts').DocumentProvider, 'list' | 'open' | 'read'>;
}

/** Structural adapter to the authenticated DSH Host surface; no private framework classes. */
export interface EasyViewHostContext {
  get(name: 'workspaceRegistry'): { list(): Array<{ id: string; title: string; path: string }> } | undefined;
  get(name: 'fs'): import('../host/documents.ts').DocumentFileSystem | undefined;
  get(name: 'profileContext'): { home: string } | undefined;
  get(name: 'sessionController'): Partial<import('./ai').DshSessions> | undefined;
  get(name: 'tools'): import('./ai').AiTools | undefined;
  get(name: 'agents'): { get(id: string): object | undefined } | undefined;
  get(name: 'systemPrompt'): { assemble(context: { scope: object }): Promise<{ tools: Array<{ name: string }> }> } | undefined;
  provide(name: 'easyview', service: EasyViewService): void;
  effect(install: () => () => Promise<void>): unknown;
  logger: { error(error: unknown): void };
  connection: {
    fetch: {
      register(route: {
        path: string;
        methods: Array<'GET' | 'HEAD' | 'POST'>;
        requestBody: 'buffered' | 'streaming';
        fetch(request: Request): Promise<Response>;
      }): () => Promise<void>;
    };
  };
}
