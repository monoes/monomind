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
  const { buildAsync } = await import('../pipeline/orchestrator.js');
  const watcher = new MonographWatcher(repoPath, { debounceMs: opts.debounceMs ?? 3000 });

  // Idle timeout: auto-stop after prolonged inactivity to reclaim resources.
  const idleMs = opts.idleTimeoutMs ?? 30 * 60_000; // default 30min
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

  // monolean: full rebuild per change-batch, serialized — true incremental rebuild
  // (re-parse only changed files) requires restructuring the phase pipeline.
  let building = false;
  let rerun = false;
  watcher.on('monograph:updated', async (files: string[]) => {
    resetIdle();
    if (building) { rerun = true; return; } // coalesce saves that land mid-build
    building = true;
    try {
      do {
        rerun = false;
        opts.onProgress?.({ phase: 'watch', message: `Changed: ${files.slice(0, 3).join(', ')}` });
        try {
          await buildAsync(repoPath, { onProgress: opts.onProgress, force: opts.force, codeOnly: opts.codeOnly, llmMaxSections: opts.llmMaxSections ?? 0 });
          opts.onProgress?.({ phase: 'watch', message: 'Graph rebuilt.' });
        } catch (err) {
          // A rebuild failure (locked DB past busy_timeout, disk full, transient
          // I/O error) must not crash the watch process — log it, notify listeners,
          // and keep watching for the next change instead of letting an unhandled
          // rejection escape this listener.
          watcher.emit('monograph:error', err);
          opts.onProgress?.({ phase: 'watch', message: `Rebuild failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      } while (rerun);
    } finally {
      building = false;
    }
  });

  await watcher.start();
  resetIdle(); // start the idle clock
  return {
    stop: async () => {
      if (idleTimer) clearTimeout(idleTimer);
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
