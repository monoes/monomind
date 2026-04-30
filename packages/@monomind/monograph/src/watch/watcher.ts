import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import { isSupportedExtension } from '../parsers/loader.js';
import { extname } from 'path';
import { platform } from 'os';

export interface WatcherOptions {
  debounceMs?: number;  // default 3000ms
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
    const usePolling = platform() === 'darwin';

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
