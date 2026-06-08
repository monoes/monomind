import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
/**
 * SHA256-keyed per-file extraction cache.
 * Stores parsed nodes and edges keyed by file content hash so unchanged
 * files skip reparsing on subsequent monograph build runs.
 *
 * Cache files are stored in `dir` as `<sha256(filePath)>.json`.
 * A cache hit requires the stored `fileHash` to match the provided hash.
 *
 * TODO: Integrate into pipeline runner once per-file phase iteration is
 * exposed — currently PipelineRunner delegates file iteration to individual
 * phases (e.g. parse phase), so the cache hook point lives inside the parse
 * phase execute() method rather than in runner.ts.
 */
export class ExtractionCache {
    dir;
    constructor(dir) {
        this.dir = dir;
        mkdirSync(dir, { recursive: true });
    }
    /** Compute SHA256 hex digest of a file's contents. */
    hashFile(filePath) {
        const content = readFileSync(filePath);
        return createHash('sha256').update(content).digest('hex');
    }
    entryPath(filePath) {
        const key = createHash('sha256').update(filePath).digest('hex');
        return join(this.dir, `${key}.json`);
    }
    /**
     * Retrieve a cache entry for the given file path and hash.
     * Returns null on cache miss (file not cached or hash mismatch).
     */
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
    /** Store parsed nodes and edges for a file path + hash. */
    set(filePath, fileHash, nodes, edges) {
        const entry = { fileHash, nodes, edges };
        writeFileSync(this.entryPath(filePath), JSON.stringify(entry));
    }
}
//# sourceMappingURL=extraction-cache.js.map