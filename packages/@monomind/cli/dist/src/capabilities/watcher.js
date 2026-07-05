import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
const DEFAULT_IGNORE = new Set(['node_modules', '.git', '.monomind', '__pycache__', 'dist', 'build']);
export class FileWatcher extends EventEmitter {
    watcher = null;
    debounceTimers = new Map();
    _mode = 'fs';
    debounceMs = 300;
    knownFiles = new Set();
    get mode() {
        return this._mode;
    }
    async start(root, options) {
        // Guard against double-start: close previous watcher to prevent fd leak
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        const gitExists = fs.existsSync(path.join(root, '.git'));
        const useGit = options?.useGit ?? gitExists;
        this._mode = useGit ? 'git' : 'fs';
        this.debounceMs = options?.debounceMs ?? 300;
        const ignore = new Set([...DEFAULT_IGNORE, ...(options?.ignore ?? [])]);
        const isIgnored = (filename) => filename.split(path.sep).some(p => ignore.has(p) || p.startsWith('.'));
        // Seed known files so pre-existing files are treated as changes, not adds.
        this.seedKnownFiles(root, root, isIgnored);
        this.watcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
            if (!filename)
                return;
            // Skip ignored directories
            if (isIgnored(filename))
                return;
            const fullPath = path.resolve(root, filename);
            // Prevent symlink traversal: reject paths that escape root
            if (!fullPath.startsWith(root + path.sep) && fullPath !== root)
                return;
            // Debounce rapid events on the same file
            const existing = this.debounceTimers.get(filename);
            if (existing)
                clearTimeout(existing);
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
                            }
                            else {
                                this.knownFiles.add(fullPath);
                                this.emit('add', fullPath);
                            }
                        }
                    }
                    else if (this.knownFiles.has(fullPath)) {
                        this.knownFiles.delete(fullPath);
                        this.emit('remove', fullPath);
                    }
                }
                catch {
                    // file may have been deleted between check and stat
                }
            }, this.debounceMs));
        });
    }
    seedKnownFiles(root, dir, isIgnored) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const rel = path.relative(root, fullPath);
            if (isIgnored(rel))
                continue;
            if (entry.isSymbolicLink())
                continue;
            if (entry.isDirectory()) {
                this.seedKnownFiles(root, fullPath, isIgnored);
            }
            else if (entry.isFile()) {
                this.knownFiles.add(fullPath);
            }
        }
    }
    async stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        this.knownFiles.clear();
        this.removeAllListeners();
    }
}
//# sourceMappingURL=watcher.js.map