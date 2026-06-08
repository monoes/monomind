import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import { isSupportedExtension } from '../parsers/loader.js';
import { extname } from 'path';
import { platform } from 'os';
/** Convenience: start a watcher and trigger buildAsync on every change. Returns stop() fn. */
export async function watchAsync(repoPath, opts = {}) {
    const { buildAsync } = await import('../pipeline/orchestrator.js');
    const watcher = new MonographWatcher(repoPath, { debounceMs: opts.debounceMs ?? 3000 });
    watcher.on('monograph:updated', async (files) => {
        opts.onProgress?.({ phase: 'watch', message: `Changed: ${files.slice(0, 3).join(', ')}` });
        await buildAsync(repoPath, { onProgress: opts.onProgress, force: opts.force, codeOnly: opts.codeOnly, llmMaxSections: opts.llmMaxSections ?? 0 });
        opts.onProgress?.({ phase: 'watch', message: 'Graph rebuilt.' });
    });
    await watcher.start();
    return { stop: () => watcher.stop() };
}
export class MonographWatcher extends EventEmitter {
    repoPath;
    watcher = null;
    debounceTimer = null;
    pendingChanges = new Set();
    debounceMs;
    constructor(repoPath, opts = {}) {
        super();
        this.repoPath = repoPath;
        this.debounceMs = opts.debounceMs ?? 3000;
    }
    async start() {
        const usePolling = platform() === 'darwin';
        this.watcher = chokidar.watch(this.repoPath, {
            ignored: [
                /(^|[/\\])\../, // dotfiles
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
        this.watcher.on('change', (path) => this.handleChange(path));
        this.watcher.on('add', (path) => this.handleChange(path));
        this.watcher.on('unlink', (path) => this.handleChange(path));
        this.watcher.on('error', (err) => this.emit('monograph:error', err));
        await new Promise(resolve => this.watcher.once('ready', resolve));
    }
    async stop() {
        if (this.debounceTimer)
            clearTimeout(this.debounceTimer);
        if (this.watcher)
            await this.watcher.close();
        this.watcher = null;
    }
    handleChange(filePath) {
        const ext = extname(filePath);
        if (!isSupportedExtension(ext))
            return;
        this.pendingChanges.add(filePath);
        if (this.debounceTimer)
            clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            const changed = [...this.pendingChanges];
            this.pendingChanges.clear();
            this.emit('monograph:updated', changed);
        }, this.debounceMs);
    }
}
//# sourceMappingURL=watcher.js.map