import type { TimelineClient, TimelineEntry, TimelinePage, TimelineSource, TimelineUiState } from '@easyview/contracts';
export interface TimelinePort { configureSettings?(): Promise<void>; post(message: unknown): void; subscribe(listener: (message: any) => void): { dispose(): void }; loadState(): TimelineUiState | undefined; saveState(state: TimelineUiState): void }
export class RpcTimelineClient implements TimelineClient {
  configureSettings?: () => Promise<void>;
  private nextId = 0;
  private pending = new Map<string, { resolve(value: any): void; reject(error: Error): void }>();
  private listeners = new Set<() => void>();
  private subscription: { dispose(): void };
  constructor(private port: TimelinePort) {
    this.configureSettings = port.configureSettings;
    this.subscription = port.subscribe((message) => {
      if (message.type === 'timeline.changed') { for (const listener of this.listeners) listener(); }
      if (message.type !== 'timeline.result') return;
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.value);
    });
  }
  private request<T>(method: string, payload: unknown, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted(); const id = String(++this.nextId);
    return new Promise<T>((resolve, reject) => {
      const aborted = () => { this.pending.delete(id); this.port.post({ type: 'timeline.cancel', id }); reject(new Error('Timeline query cancelled')); };
      const cleanup = () => signal.removeEventListener('abort', aborted);
      this.pending.set(id, { resolve: (value) => { cleanup(); resolve(value); }, reject: (error) => { cleanup(); reject(error); } });
      signal.addEventListener('abort', aborted, { once: true });
      this.port.post({ type: 'timeline.request', id, method, payload });
    });
  }
  list(filePath: string, sources: TimelineSource[], cursor: string | undefined, signal: AbortSignal): Promise<TimelinePage> { return this.request('list', { filePath, sources, cursor }, signal); }
  open(entry: TimelineEntry, signal: AbortSignal): Promise<void> { return this.request('open', { entry }, signal); }
  restore(entry: TimelineEntry, signal: AbortSignal): Promise<void> { return this.request('restore', { entry }, signal); }
  watch(filePath: string, listener: () => void): { dispose(): void } {
    this.listeners.add(listener); this.port.post({ type: 'timeline.watch', filePath });
    return { dispose: () => { this.listeners.delete(listener); this.port.post({ type: 'timeline.watch', filePath: null }); } };
  }
  loadState(): TimelineUiState | undefined { return this.port.loadState(); }
  saveState(state: TimelineUiState): void { this.port.saveState(state); }
  dispose(): void { this.subscription.dispose(); for (const pending of this.pending.values()) pending.reject(new Error('Timeline closed')); this.pending.clear(); this.listeners.clear(); this.port.post({ type: 'timeline.watch', filePath: null }); }
}
