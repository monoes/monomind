import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
export class ExtractionCache {
    dir;
    pending = [];
    constructor(dir) {
        this.dir = dir;
        mkdirSync(dir, { recursive: true });
    }
    hashFile(filePath) {
        const content = readFileSync(filePath);
        return createHash('sha256').update(content).digest('hex');
    }
    hashContent(content) {
        return createHash('sha256').update(content).digest('hex');
    }
    entryPath(filePath) {
        const key = createHash('sha256').update(filePath).digest('hex');
        return join(this.dir, `${key}.json`);
    }
    /**
     * Fast-path: check mtime+size before falling back to content hash.
     * Returns cached entry if file hasn't changed, null on miss.
     */
    getWithStat(filePath) {
        const p = this.entryPath(filePath);
        if (!existsSync(p))
            return null;
        try {
            const entry = JSON.parse(readFileSync(p, 'utf-8'));
            const st = statSync(filePath);
            if (entry.mtimeMs === st.mtimeMs && entry.size === st.size)
                return entry;
            // mtime/size differ or missing — recheck content hash
            const hash = this.hashFile(filePath);
            if (entry.fileHash !== hash)
                return null;
            // Hash matches — update entry with current mtime+size for next run
            entry.mtimeMs = st.mtimeMs;
            entry.size = st.size;
            try {
                writeFileSync(p, JSON.stringify(entry));
            }
            catch { /* non-fatal */ }
            return entry;
        }
        catch {
            return null;
        }
    }
    get(filePath, fileHash) {
        const p = this.entryPath(filePath);
        if (!existsSync(p))
            return null;
        try {
            const entry = JSON.parse(readFileSync(p, 'utf-8'));
            return entry.fileHash === fileHash ? entry : null;
        }
        catch {
            return null;
        }
    }
    set(filePath, fileHash, nodes, edges) {
        let mtimeMs;
        let size;
        try {
            const st = statSync(filePath);
            mtimeMs = st.mtimeMs;
            size = st.size;
        }
        catch { /* ignore */ }
        const entry = { fileHash, mtimeMs, size, nodes, edges };
        writeFileSync(this.entryPath(filePath), JSON.stringify(entry));
    }
    setDeferred(filePath, fileHash, nodes, edges) {
        let mtimeMs;
        let size;
        try {
            const st = statSync(filePath);
            mtimeMs = st.mtimeMs;
            size = st.size;
        }
        catch { /* ignore */ }
        const entry = { fileHash, mtimeMs, size, nodes, edges };
        this.pending.push({ path: this.entryPath(filePath), data: JSON.stringify(entry) });
    }
    flush() {
        for (const { path, data } of this.pending) {
            try {
                writeFileSync(path, data);
            }
            catch { /* non-fatal */ }
        }
        this.pending = [];
    }
}
//# sourceMappingURL=extraction-cache.js.map