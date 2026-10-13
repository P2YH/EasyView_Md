import type { TimelineComparison, TimelineEntry, TimelineRequestMessage, TimelineResultMessage } from '@easyview/contracts';
import type { TimelineService } from './timeline-service';
export interface TimelineChannelHost {
  service: TimelineService;
  authorize(filePath: string): Promise<string>;
  current(filePath: string): Promise<string>;
  reveal?(entry: TimelineEntry): boolean;
  open(comparison: TimelineComparison, signal: AbortSignal): Promise<void>;
  restore(entry: TimelineEntry, signal: AbortSignal): Promise<void>;
  post(message: TimelineResultMessage): void;
}
/** One channel per window/sidebar. Closing it kills pending work and file subscriptions. */
export class TimelineChannel {
  private requests = new Map<string, AbortController>();
  private subscription?: { dispose(): void };
  private disposed = false;
  private watchRevision = 0;
  constructor(private host: TimelineChannelHost) {}
  async handle(message: TimelineRequestMessage): Promise<void> {
    if (this.disposed) return;
    if (!message || typeof message !== 'object') throw new Error('Timeline 请求无效');
    if (message.type === 'timeline.cancel') { this.requests.get(message.id)?.abort(); return; }
    if (message.type === 'timeline.watch') {
      const revision = ++this.watchRevision;
      this.subscription?.dispose(); this.subscription = undefined;
      if (message.filePath) {
        const filePath = await this.host.authorize(message.filePath);
        if (!this.disposed && revision === this.watchRevision) this.subscription = this.host.service.watch(filePath, () => this.host.post({ type: 'timeline.changed' }));
      }
      return;
    }
    if (message.type !== 'timeline.request' || typeof message.id !== 'string' || !message.payload) throw new Error('Timeline 请求无效');
    this.requests.get(message.id)?.abort();
    const abort = new AbortController(); this.requests.set(message.id, abort);
    try {
      const payload = message.payload;
      const filePath = await this.host.authorize(payload.filePath ?? payload.entry?.filePath ?? '');
      abort.signal.throwIfAborted();
      let value: unknown;
      if (message.method === 'list') {
        const sources = payload.sources ?? ['local', 'vscode', 'cursor', 'git'];
        if (!sources.every((source) => ['local','vscode','cursor','git'].includes(source))) throw new Error('历史来源无效');
        value = await this.host.service.list(filePath, sources, payload.cursor, abort.signal);
      } else if (payload.entry && payload.entry.filePath === filePath) {
        if (message.method === 'open' && this.host.reveal?.(payload.entry)) {
          value = undefined;
        } else if (message.method === 'open') {
          const comparison = await this.host.service.compare(payload.entry, payload.entry.source === 'git' ? '' : await this.host.current(filePath), abort.signal);
          abort.signal.throwIfAborted(); await this.host.open(comparison, abort.signal);
        } else if (message.method === 'restore') await this.host.restore(payload.entry, abort.signal);
        else throw new Error('Timeline 方法无效');
      } else throw new Error('历史版本无效');
      if (!this.disposed && !abort.signal.aborted) this.host.post({ type: 'timeline.result', id: message.id, value });
    } catch (error) {
      if (!this.disposed && !abort.signal.aborted) this.host.post({ type: 'timeline.result', id: message.id, error: error instanceof Error ? error.message : String(error) });
    } finally { if (this.requests.get(message.id) === abort) this.requests.delete(message.id); }
  }
  dispose(): void { this.watchRevision++; this.disposed = true; this.subscription?.dispose(); this.subscription = undefined; for (const abort of this.requests.values()) abort.abort(); this.requests.clear(); }
  get diagnostics() { return { requests: this.requests.size, subscriptions: this.subscription ? 1 : 0 }; }
}
