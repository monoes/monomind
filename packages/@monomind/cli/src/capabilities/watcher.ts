import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

export interface WatcherOptions {
  useGit?: boolean;     // auto-detect by default
  debounceMs?: number;  // default 300
  ignore?: string[];
}

const DEFAULT_IGNORE = new Set(['node_modules', '.git', '.monomind', '__pycache__', 'dist', 'build']);

export class FileWatcher extends EventEmitter {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private _mode: 'git' | 'fs' = 'fs';
  private debounceMs = 300;
  private knownFiles = new Set<string>();

  get mode(): 'git' | 'fs' {
    return this._mode;
  }

  async start(root: string, options?: WatcherOptions): Promise<void> {
    const gitExists = fs.existsSync(path.join(root, '.git'));
    const useGit = options?.useGit ?? gitExists;
    this._mode = useGit ? 'git' : 'fs';
    this.debounceMs = options?.debounceMs ?? 300;

    const ignore = new Set([...DEFAULT_IGNORE, ...(options?.ignore ?? [])]);
    const isIgnored = (filename: string): boolean =>
      filename.split(path.sep).some(p => ignore.has(p) || p.startsWith('.'));

    // Seed known files so pre-existing files are treated as changes, not adds.
    this.seedKnownFiles(root, root, isIgnored);

    this.watcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;

      // Skip ignored directories
      if (isIgnored(filename)) return;

      const fullPath = path.join(root, filename);

      // Debounce rapid events on the same file
      const existing = this.debounceTimers.get(filename);
      if (existing) clearTimeout(existing);

      this.debounceTimers.set(filename, setTimeout(() => {
        this.debounceTimers.delete(filename);
        try {
          if (fs.existsSync(fullPath)) {
            const stat = fs.statSync(fullPath);
            if (stat.isFile()) {
              // fs.watch's eventType ('rename' vs 'change') is unreliable across
              // platforms (e.g. macOS reports 'rename' for in-place modifications),
              // so track previously-seen files to distinguish add vs change.
              if (this.knownFiles.has(fullPath)) {
                this.emit('change', fullPath);
              } else {
                this.knownFiles.add(fullPath);
                this.emit('add', fullPath);
              }
            }
          } else if (this.knownFiles.has(fullPath)) {
            this.knownFiles.delete(fullPath);
            this.emit('remove', fullPath);
          }
        } catch {
          // file may have been deleted between check and stat
        }
      }, this.debounceMs));
    });
  }

  private seedKnownFiles(root: string, dir: string, isIgnored: (rel: string) => boolean): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(root, fullPath);
      if (isIgnored(rel)) continue;
      if (entry.isDirectory()) {
        this.seedKnownFiles(root, fullPath, isIgnored);
      } else if (entry.isFile()) {
        this.knownFiles.add(fullPath);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.knownFiles.clear();
  }
}
