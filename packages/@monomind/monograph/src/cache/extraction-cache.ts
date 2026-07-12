import { createHash } from 'crypto';
import { readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, mkdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import type { MonographNode, MonographEdge } from '../types.js';

/**
 * Bump this whenever the parser/extractor output format changes in a way that
 * would make previously-cached nodes/edges stale or wrong (e.g. a parser bugfix,
 * a change to what symbols get extracted, a change to node/edge shape). Any
 * cached entry written under an older version is treated as a miss on read, so
 * bumping this effectively invalidates the entire on-disk extraction cache.
 */
export const EXTRACTION_CACHE_VERSION = 1;

export interface CacheEntry {
  fileHash: string;
  mtimeMs?: number;
  size?: number;
  nodes: MonographNode[];
  edges: MonographEdge[];
  /** Extraction format version this entry was written under — see EXTRACTION_CACHE_VERSION. */
  cacheVersion?: number;
}

export class ExtractionCache {
  private pending: Array<{ path: string; data: string }> = [];

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  hashFile(filePath: string): string {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
  }

  hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private entryPath(filePath: string): string {
    const key = createHash('sha256').update(filePath).digest('hex');
    return join(this.dir, `${key}.json`);
  }

  /** tmp+rename write — cache corruption is low-stakes but a torn write from a
   * killed process still shouldn't poison the next read. */
  private writeAtomic(p: string, data: string): void {
    const tmp = `${p}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, data);
      renameSync(tmp, p);
    } catch {
      try { unlinkSync(tmp); } catch { /* ignore */ }
    }
  }

  /**
   * Delete cache entries whose mtime exceeds maxAgeMs (default 30 days).
   * Covers files that were deleted/renamed (their cache entry is now orphaned
   * and would otherwise sit on disk forever) as well as entries simply not
   * touched in a long time. Single readdir + stat pass over the cache dir.
   * Returns the number of entries removed.
   */
  prune(maxAgeMs = 30 * 24 * 60 * 60 * 1000): number {
    let removed = 0;
    let entries: string[];
    try {
      entries = readdirSync(this.dir).filter((f) => f.endsWith('.json') && !f.startsWith('._'));
    } catch {
      return 0;
    }
    const cutoff = Date.now() - maxAgeMs;
    for (const f of entries) {
      const p = join(this.dir, f);
      try {
        if (statSync(p).mtimeMs < cutoff) {
          unlinkSync(p);
          removed++;
        }
      } catch { /* ignore */ }
    }
    return removed;
  }

  /**
   * Fast-path: check mtime+size before falling back to content hash.
   * Returns cached entry if file hasn't changed, null on miss.
   */
  getWithStat(filePath: string): CacheEntry | null {
    const p = this.entryPath(filePath);
    if (!existsSync(p)) return null;
    try {
      const entry: CacheEntry = JSON.parse(readFileSync(p, 'utf-8'));
      if (entry.cacheVersion !== EXTRACTION_CACHE_VERSION) return null;
      const st = statSync(filePath);
      if (entry.mtimeMs === st.mtimeMs && entry.size === st.size) return entry;
      // mtime/size differ or missing — recheck content hash
      const hash = this.hashFile(filePath);
      if (entry.fileHash !== hash) return null;
      // Hash matches — update entry with current mtime+size for next run
      entry.mtimeMs = st.mtimeMs;
      entry.size = st.size;
      try { this.writeAtomic(p, JSON.stringify(entry)); } catch { /* non-fatal */ }
      return entry;
    } catch { return null; }
  }

  get(filePath: string, fileHash: string): CacheEntry | null {
    const p = this.entryPath(filePath);
    if (!existsSync(p)) return null;
    try {
      const entry: CacheEntry = JSON.parse(readFileSync(p, 'utf-8'));
      if (entry.cacheVersion !== EXTRACTION_CACHE_VERSION) return null;
      return entry.fileHash === fileHash ? entry : null;
    } catch { return null; }
  }

  set(filePath: string, fileHash: string, nodes: MonographNode[], edges: MonographEdge[]): void {
    let mtimeMs: number | undefined;
    let size: number | undefined;
    try { const st = statSync(filePath); mtimeMs = st.mtimeMs; size = st.size; } catch { /* ignore */ }
    const entry: CacheEntry = { fileHash, mtimeMs, size, nodes, edges, cacheVersion: EXTRACTION_CACHE_VERSION };
    this.writeAtomic(this.entryPath(filePath), JSON.stringify(entry));
  }

  setDeferred(filePath: string, fileHash: string, nodes: MonographNode[], edges: MonographEdge[]): void {
    let mtimeMs: number | undefined;
    let size: number | undefined;
    try { const st = statSync(filePath); mtimeMs = st.mtimeMs; size = st.size; } catch { /* ignore */ }
    const entry: CacheEntry = { fileHash, mtimeMs, size, nodes, edges, cacheVersion: EXTRACTION_CACHE_VERSION };
    this.pending.push({ path: this.entryPath(filePath), data: JSON.stringify(entry) });
  }

  flush(): void {
    for (const { path, data } of this.pending) {
      try { this.writeAtomic(path, data); } catch { /* non-fatal */ }
    }
    this.pending = [];
  }
}
