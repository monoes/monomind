import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import { isSupportedExtension } from '../parsers/loader.js';
import type { PipelineProgress } from '../types.js';
import { extname } from 'path';

export interface WatcherOptions {
  debounceMs?: number;  // default 3000ms
}

export interface WatchAsyncOptions extends WatcherOptions {
  onProgress?: (p: PipelineProgress) => void;
  force?: boolean;
  codeOnly?: boolean;
  llmMaxSections?: number;
  /** Auto-stop after this many ms of no file changes. Default 30min. 0 = never. */
  idleTimeoutMs?: number;
}

/** Convenience: start a watcher and trigger buildAsync on every change. Returns stop() fn. */
export async function watchAsync(
  repoPath: string,
  opts: WatchAsyncOptions = {},
): Promise<{ stop: () => Promise<void> }> {
  const { buildAsync, buildIncrementalAsync } = await import('../pipeline/orchestrator.js');
  const watcher = new MonographWatcher(repoPath, { debounceMs: opts.debounceMs ?? 3000 });

  const idleMs = opts.idleTimeoutMs ?? 30 * 60_000;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdle = (): void => {
    if (idleMs <= 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      opts.onProgress?.({ phase: 'watch', message: `No changes for ${Math.round(idleMs / 60_000)}min — auto-stopping watcher.` });
      watcher.stop().catch(() => {});
    }, idleMs);
    (idleTimer as { unref?: () => void }).unref?.();
  };

  // After 60s of no incremental activity, run a full rebuild to refresh
  // aggregate phases (communities, god-nodes, surprises, churn, report).
  const FULL_REBUILD_IDLE_MS = 60_000;
  let fullRebuildTimer: ReturnType<typeof setTimeout> | null = null;
  let incrementalSinceLastFull = false;
  const scheduleFullRebuild = (): void => {
    if (fullRebuildTimer) clearTimeout(fullRebuildTimer);
    fullRebuildTimer = setTimeout(async () => {
      if (!incrementalSinceLastFull) return;
      incrementalSinceLastFull = false;
      opts.onProgress?.({ phase: 'watch', message: 'Deferred full rebuild for aggregate analysis...' });
      try {
        await buildAsync(repoPath, { onProgress: opts.onProgress, codeOnly: opts.codeOnly, llmMaxSections: opts.llmMaxSections ?? 0 });
        opts.onProgress?.({ phase: 'watch', message: 'Full rebuild complete.' });
      } catch (err) {
        watcher.emit('monograph:error', err);
      }
    }, FULL_REBUILD_IDLE_MS);
    (fullRebuildTimer as { unref?: () => void }).unref?.();
  };

  let building = false;
  let pendingFiles = new Set<string>();
  watcher.on('monograph:updated', async (files: string[]) => {
    resetIdle();
    for (const f of files) pendingFiles.add(f);
    if (building) return;
    building = true;
    try {
      while (pendingFiles.size > 0) {
        const batch = [...pendingFiles];
        pendingFiles = new Set();
        opts.onProgress?.({ phase: 'watch', message: `Changed: ${batch.slice(0, 3).join(', ')}` });
        try {
          await buildIncrementalAsync(repoPath, batch, {
            onProgress: opts.onProgress, force: opts.force,
            codeOnly: opts.codeOnly, llmMaxSections: opts.llmMaxSections ?? 0,
          });
          incrementalSinceLastFull = true;
          scheduleFullRebuild();
          opts.onProgress?.({ phase: 'watch', message: 'Graph updated (incremental).' });
        } catch (err) {
          watcher.emit('monograph:error', err);
          opts.onProgress?.({ phase: 'watch', message: `Rebuild failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    } finally {
      building = false;
    }
  });

  await watcher.start();
  resetIdle();
  return {
    stop: async () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (fullRebuildTimer) clearTimeout(fullRebuildTimer);
      await watcher.stop();
    },
  };
}

export class MonographWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges = new Set<string>();
  private readonly debounceMs: number;

  constructor(private readonly repoPath: string, opts: WatcherOptions = {}) {
    super();
    this.debounceMs = opts.debounceMs ?? 3000;
  }

  async start(): Promise<void> {
    // FSEvents works natively on macOS — polling the whole tree every second is
    // far more expensive (especially on external/exFAT volumes). Poll only when
    // explicitly requested via env (e.g. network mounts where events don't fire).
    const usePolling = process.env.MONOGRAPH_WATCH_POLL === '1';

    this.watcher = chokidar.watch(this.repoPath, {
      ignored: [
        /(^|[/\\])\../,     // dotfiles
        /node_modules/,
        /\.monomind/,
        /dist\//,
        /build\//,
      ],
      persistent: true,
      ignoreInitial: true,
      usePolling,
      interval: usePolling ? 1000 : undefined,
    });

    this.watcher.on('change', (path: string) => this.handleChange(path));
    this.watcher.on('add', (path: string) => this.handleChange(path));
    this.watcher.on('unlink', (path: string) => this.handleChange(path));
    this.watcher.on('error', (err: unknown) => this.emit('monograph:error', err));

    await new Promise<void>(resolve => this.watcher!.once('ready', resolve));
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.watcher) await this.watcher.close();
    this.watcher = null;
  }

  private handleChange(filePath: string): void {
    const ext = extname(filePath);
    if (!isSupportedExtension(ext)) return;

    this.pendingChanges.add(filePath);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const changed = [...this.pendingChanges];
      this.pendingChanges.clear();
      this.emit('monograph:updated', changed);
    }, this.debounceMs);
  }
}
