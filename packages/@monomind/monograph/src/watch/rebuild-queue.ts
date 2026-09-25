import { relative } from 'node:path';
import type { BuildResult } from '../pipeline/orchestrator.js';

export type RebuildEvent =
  | { kind: 'start'; files: string[] }
  | {
      kind: 'built';
      files: string[];
      result: Extract<BuildResult, { status: 'built' }>;
      durationMs: number;
    }
  | { kind: 'deferred'; files: string[]; retryInMs: number }
  | { kind: 'skipped'; files: string[]; message: string }
  | { kind: 'failed'; files: string[]; error: unknown };

export interface RebuildQueueOptions {
  /** Runs one rebuild covering the given changed files. */
  build: (files: string[]) => Promise<BuildResult | null>;
  onEvent: (e: RebuildEvent) => void;
  /** Delay before retrying a batch whose build found the lock held. Default 2000ms. */
  retryDelayMs?: number;
}

export interface RebuildQueue {
  enqueue(files: string[]): void;
  stop(): void;
}

/**
 * Serializes watch-triggered rebuilds. Changes that arrive while a build runs
 * are folded into the next one, and a batch whose build found the build lock
 * held (another process's build, or a session-start/init background build) is
 * kept and retried. Each change batch used to start its own fire-and-forget
 * build, so a lock-skipped batch was dropped for good while the log still said
 * the rebuild completed (#338).
 */
export function createRebuildQueue(opts: RebuildQueueOptions): RebuildQueue {
  const retryDelayMs = opts.retryDelayMs ?? 2000;
  let pending = new Set<string>();
  let running = false;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  // Set while a deferred batch is being retried, so a lock held for minutes
  // logs one "deferred" line rather than one per retry.
  let deferred = false;

  const drain = async (): Promise<void> => {
    if (running || stopped || retryTimer) return;
    running = true;
    try {
      while (pending.size > 0 && !stopped) {
        const files = [...pending];
        pending = new Set();
        if (!deferred) opts.onEvent({ kind: 'start', files });
        const started = Date.now();
        let result: BuildResult | null;
        try {
          result = await opts.build(files);
        } catch (error) {
          deferred = false;
          opts.onEvent({ kind: 'failed', files, error });
          continue;
        }
        if (result?.status === 'skipped' && result.reason === 'locked') {
          for (const f of files) pending.add(f);
          if (!deferred) opts.onEvent({ kind: 'deferred', files, retryInMs: retryDelayMs });
          deferred = true;
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void drain();
          }, retryDelayMs);
          return;
        }
        deferred = false;
        if (result?.status === 'built') {
          opts.onEvent({ kind: 'built', files, result, durationMs: Date.now() - started });
        } else if (result?.status === 'skipped') {
          opts.onEvent({ kind: 'skipped', files, message: result.message });
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    enqueue(files: string[]): void {
      for (const f of files) pending.add(f);
      void drain();
    },
    stop(): void {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    },
  };
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));

/** One log line per event, stating what actually happened to the graph. */
export function describeRebuildEvent(e: RebuildEvent, repoPath: string): string {
  switch (e.kind) {
    case 'start': {
      const shown = e.files.slice(0, 3).map((f) => relative(repoPath, f) || f);
      const more = e.files.length > 3 ? ` (+${e.files.length - 3} more)` : '';
      return `Rebuilding for ${e.files.length} changed file(s): ${shown.join(', ')}${more}…`;
    }
    case 'built': {
      const { nodes, edges } = e.result;
      return (
        `Graph updated in ${(e.durationMs / 1000).toFixed(1)}s — ` +
        `nodes ${signed(nodes.after - nodes.before)} (now ${nodes.after}), ` +
        `edges ${signed(edges.after - edges.before)} (now ${edges.after})`
      );
    }
    case 'deferred':
      return (
        `Rebuild deferred — another build is in progress; retrying ` +
        `${e.files.length} changed file(s) every ${(e.retryInMs / 1000).toFixed(1)}s until it finishes`
      );
    case 'skipped':
      return `Rebuild skipped — ${e.message}`;
    case 'failed':
      return `Rebuild failed: ${e.error instanceof Error ? e.error.message : String(e.error)}`;
  }
}
