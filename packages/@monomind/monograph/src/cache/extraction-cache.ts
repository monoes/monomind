import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { MonographNode, MonographEdge } from '../types.js';

export interface CacheEntry {
  fileHash: string;
  nodes: MonographNode[];
  edges: MonographEdge[];
}

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
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  /** Compute SHA256 hex digest of a file's contents. */
  hashFile(filePath: string): string {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
  }

  private entryPath(filePath: string): string {
    const key = createHash('sha256').update(filePath).digest('hex');
    return join(this.dir, `${key}.json`);
  }

  /**
   * Retrieve a cache entry for the given file path and hash.
   * Returns null on cache miss (file not cached or hash mismatch).
   */
  get(filePath: string, fileHash: string): CacheEntry | null {
    const p = this.entryPath(filePath);
    if (!existsSync(p)) return null;
    try {
      const entry: CacheEntry = JSON.parse(readFileSync(p, 'utf-8'));
      return entry.fileHash === fileHash ? entry : null;
    } catch { return null; }
  }

  /** Store parsed nodes and edges for a file path + hash. */
  set(filePath: string, fileHash: string, nodes: MonographNode[], edges: MonographEdge[]): void {
    const entry: CacheEntry = { fileHash, nodes, edges };
    writeFileSync(this.entryPath(filePath), JSON.stringify(entry));
  }
}
