/** Resource ownership for the pinned spreadsheet engine; never patches browser globals. */
let activeScope: SpreadsheetLifecycle | undefined;
type Binding = { target: EventTarget; name: string; wrapped: EventListener; release(): void };
const bindings = new WeakMap<EventListener, Set<Binding>>();
const timers = new Map<ReturnType<typeof setTimeout>, () => void>();

export class SpreadsheetLifecycle {
  readonly resources = new Set<() => void>();
  disposed = false;

  enter(): () => void {
    if (this.disposed) throw new Error('Spreadsheet has been destroyed');
    const previous = activeScope;
    activeScope = this;
    return () => { activeScope = previous; };
  }

  run<T>(operation: () => T): T {
    const leave = this.enter();
    try { return operation(); } finally { leave(); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const release of [...this.resources]) release();
    this.resources.clear();
  }
}

function requireScope(): SpreadsheetLifecycle {
  if (!activeScope) throw new Error('Spreadsheet resource has no lifecycle owner');
  return activeScope;
}

export function bindSpreadsheetEvent(target: EventTarget, name: string, listener: EventListener): void {
  const owner = requireScope();
  const wrapped: EventListener = event => {
    if (!owner.disposed) owner.run(() => listener(event));
  };
  const records = bindings.get(listener) ?? new Set<Binding>();
  bindings.set(listener, records);
  const binding: Binding = { target, name, wrapped, release: () => {
    target.removeEventListener(name, wrapped);
    records.delete(binding);
    if (!records.size) bindings.delete(listener);
    owner.resources.delete(binding.release);
  } };
  records.add(binding);
  owner.resources.add(binding.release);
  target.addEventListener(name, wrapped);
}

export function unbindSpreadsheetEvent(target: EventTarget, name: string, listener: EventListener): void {
  for (const binding of [...(bindings.get(listener) ?? [])]) {
    if (binding.target === target && binding.name === name) binding.release();
  }
}

export function spreadsheetSetTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
  const owner = requireScope();
  const id = setTimeout(() => {
    timers.delete(id);
    owner.resources.delete(release);
    if (!owner.disposed) owner.run(callback);
  }, delay);
  const release = () => {
    clearTimeout(id);
    timers.delete(id);
    owner.resources.delete(release);
  };
  timers.set(id, release);
  owner.resources.add(release);
  return id;
}

export function spreadsheetClearTimeout(id: ReturnType<typeof setTimeout>): void {
  timers.get(id)?.();
}
