// packages/@monomind/cli/src/orgrt/bus.ts
import { appendFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BusEvent } from './types.js';

type Listener = (e: BusEvent) => void;

/**
 * Ground-truth event log for one org run. Append-only JSONL + in-process fanout.
 * Every message, tool decision, asset, and usage record flows through here.
 */
export class OrgBus {
  private listeners = new Set<Listener>();
  private seq = 0;
  private pending: Promise<void> = Promise.resolve();
  readonly file: string;

  constructor(readonly org: string, readonly run: string, readonly dir: string) {
    this.file = join(dir, 'bus.jsonl');
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(partial: Omit<BusEvent, 'id' | 'ts' | 'org' | 'run'>): BusEvent {
    const e: BusEvent = {
      id: `${this.run}-${Date.now()}-${this.seq++}`,
      ts: Date.now(),
      org: this.org,
      run: this.run,
      ...partial,
    };
    // serialize writes; never block emitters
    this.pending = this.pending.then(async () => {
      await mkdir(this.dir, { recursive: true });
      await appendFile(this.file, JSON.stringify(e) + '\n', 'utf8');
    }).catch(() => {});
    for (const fn of this.listeners) { try { fn(e); } catch { /* listener errors never break the bus */ } }
    return e;
  }

  /** Await all queued disk writes (tests, shutdown). Listeners registered via subscribe() run
   *  synchronously inside emit() — flush() has no visibility into any async work they schedule
   *  off of that (e.g. the forwarder's HTTP POSTs). A caller that needs an async subscriber's
   *  work to have settled too must await that subscriber's own completion signal separately
   *  (see daemon.ts stopOrg(), which awaits forwarder.settle() alongside bus.flush()). */
  flush(): Promise<void> { return this.pending; }

  static readHistory(dir: string): BusEvent[] {
    const f = join(dir, 'bus.jsonl');
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l) as BusEvent; } catch { return null; } })
      .filter((e): e is BusEvent => e !== null);
  }
}
