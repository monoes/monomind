export type ProgressPhase =
  | 'discovery' | 'parse' | 'churn' | 'complexity'
  | 'duplication' | 'scoring' | 'render' | 'complete';

export interface ProgressEvent {
  phase: ProgressPhase;
  filesProcessed?: number;
  totalFiles?: number;
  message?: string;
  elapsedMs?: number;
}

export type ProgressCallback = (event: ProgressEvent) => void;

export class ProgressReporter {
  private callbacks: ProgressCallback[] = [];
  private startTime = Date.now();
  private counts = new Map<ProgressPhase, number>();

  subscribe(cb: ProgressCallback): () => void {
    this.callbacks.push(cb);
    return () => {
      const idx = this.callbacks.indexOf(cb);
      if (idx !== -1) this.callbacks.splice(idx, 1);
    };
  }

  emit(phase: ProgressPhase, opts?: Omit<ProgressEvent, 'phase' | 'elapsedMs'>): void {
    const event: ProgressEvent = {
      phase,
      elapsedMs: Date.now() - this.startTime,
      ...opts,
    };
    for (const cb of this.callbacks) {
      try { cb(event); } catch { /* don't let progress errors crash the pipeline */ }
    }
  }

  increment(phase: ProgressPhase): void {
    this.counts.set(phase, (this.counts.get(phase) ?? 0) + 1);
  }

  getCount(phase: ProgressPhase): number {
    return this.counts.get(phase) ?? 0;
  }
}

export function consoleProgressReporter(enabled: boolean): ProgressCallback {
  return (event) => {
    if (!enabled) return;
    const pct = event.totalFiles && event.filesProcessed
      ? ` (${Math.round(event.filesProcessed / event.totalFiles * 100)}%)`
      : '';
    const msg = event.message ?? `phase: ${event.phase}`;
    process.stderr.write(`\r  ${msg}${pct}   `);
    if (event.phase === 'complete') process.stderr.write('\n');
  };
}
