import { tTimeline } from './timeline.i18n';
/** A bounded queue that removes aborted jobs before they start. No polling or timers. */
export class HistoryTaskQueue {
  private running = 0;
  private waiting: Array<{ run(): void; cancel(): void }> = [];
  constructor(private concurrency: number, private capacity = 64) {}
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (this.waiting.length >= this.capacity) return Promise.reject(new Error(tTimeline('error.queueBusy')));
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', aborted);
      const job = {
        cancel: () => { cleanup(); reject(new Error(tTimeline('error.cancelled'))); },
        run: () => {
          cleanup();
          if (signal?.aborted) { job.cancel(); this.pump(); return; }
          this.running++;
          void Promise.resolve().then(task).then(resolve, reject).finally(() => { this.running--; this.pump(); });
        },
      };
      const aborted = () => { const index = this.waiting.indexOf(job); if (index !== -1) { this.waiting.splice(index,1); job.cancel(); } };
      signal?.addEventListener('abort', aborted, { once: true });
      this.waiting.push(job); this.pump();
    });
  }
  private pump(): void { while (this.running < this.concurrency && this.waiting.length) this.waiting.shift()!.run(); }
  get diagnostics() { return { running: this.running, waiting: this.waiting.length }; }
}
