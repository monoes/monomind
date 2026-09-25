import { EventEmitter } from 'node:events';
import { extname, relative } from 'node:path';
import chokidar from 'chokidar';
import { isSupportedExtension } from '../parsers/loader.js';
import type { PipelineProgress } from '../types.js';
import { createRebuildQueue, describeRebuildEvent } from './rebuild-queue.js';

/** Tested against '/'-separated paths relative to the watched repo root. */
const IGNORED_RELATIVE_PATHS = [
  /(^|\/)\../, // dotfiles
  /node_modules/,
  /\.monomind/,
  /dist\//,
  /build\//,
];

export interface WatcherOptions {
  debounceMs?: number; // default 3000ms
}

export interface WatchAsyncOptions extends WatcherOptions {
  onProgress?: (p: PipelineProgress) => void;
  force?: boolean;
  codeOnly?: boolean;
  llmMaxSections?: number;
  /** Auto-stop after this many ms of no file changes. Default 30min. 0 = never. */
  idleTimeoutMs?: number;
  /** Delay before retrying a rebuild that found the build lock held. Default 2000ms. */
  retryDelayMs?: number;
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
      opts.onProgress?.({
        phase: 'watch',
        message: `No changes for ${Math.round(idleMs / 60_000)}min — auto-stopping watcher.`,
      });
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
      opts.onProgress?.({
        phase: 'watch',
        message: 'Deferred full rebuild for aggregate analysis...',
      });
      try {
        await buildAsync(repoPath, {
          onProgress: opts.onProgress,
          codeOnly: opts.codeOnly,
          llmMaxSections: opts.llmMaxSections ?? 0,
        });
        opts.onProgress?.({ phase: 'watch', message: 'Full rebuild complete.' });
      } catch (err) {
        watcher.emit('monograph:error', err);
      }
    }, FULL_REBUILD_IDLE_MS);
    (fullRebuildTimer as { unref?: () => void }).unref?.();
  };

  const queue = createRebuildQueue({
    retryDelayMs: opts.retryDelayMs,
    build: (batch) =>
      buildIncrementalAsync(repoPath, batch, {
        onProgress: opts.onProgress,
        force: opts.force,
        codeOnly: opts.codeOnly,
        llmMaxSections: opts.llmMaxSections ?? 0,
      }),
    onEvent: (e) => {
      if (e.kind === 'built') {
        incrementalSinceLastFull = true;
        scheduleFullRebuild();
      } else if (e.kind === 'failed') {
        watcher.emit('monograph:error', e.error);
      }
      opts.onProgress?.({ phase: 'watch', message: describeRebuildEvent(e, repoPath) });
    },
  });
  watcher.on('monograph:updated', (files: string[]) => {
    resetIdle();
    queue.enqueue(files);
  });

  await watcher.start();
  resetIdle();
  return {
    stop: async () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (fullRebuildTimer) clearTimeout(fullRebuildTimer);
      queue.stop();
      await watcher.stop();
    },
  };
}

export class MonographWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges = new Set<string>();
  private readonly debounceMs: number;

  constructor(
    private readonly repoPath: string,
    opts: WatcherOptions = {},
  ) {
    super();
    this.debounceMs = opts.debounceMs ?? 3000;
  }

  async start(): Promise<void> {
    // FSEvents works natively on macOS — polling the whole tree every second is
    // far more expensive (especially on external/exFAT volumes). Poll only when
    // explicitly requested via env (e.g. network mounts where events don't fire).
    const usePolling = process.env.MONOGRAPH_WATCH_POLL === '1';

    // chokidar tests `ignored` against the full path, so match on the path
    // relative to the repo root — otherwise a repo under a dot-directory or a
    // `build/`/`dist/` ancestor has every file ignored (#255).
    this.watcher = chokidar.watch(this.repoPath, {
      ignored: (p: string) => {
        const rel = relative(this.repoPath, p).replace(/\\/g, '/');
        return IGNORED_RELATIVE_PATHS.some((re) => re.test(rel));
      },
      persistent: true,
      ignoreInitial: true,
      usePolling,
      interval: usePolling ? 1000 : undefined,
    });

    this.watcher.on('change', (path: string) => this.handleChange(path));
    this.watcher.on('add', (path: string) => this.handleChange(path));
    this.watcher.on('unlink', (path: string) => this.handleChange(path));
    this.watcher.on('error', (err: unknown) => this.emit('monograph:error', err));

    await new Promise<void>((resolve) => this.watcher?.once('ready', resolve));
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
