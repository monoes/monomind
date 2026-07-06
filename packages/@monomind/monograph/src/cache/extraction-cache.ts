import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import type { MonographNode, MonographEdge } from '../types.js';

export interface CacheEntry {
  fileHash: string;
  mtimeMs?: number;
  size?: number;
  nodes: MonographNode[];
  edges: MonographEdge[];
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

  /**
   * Fast-path: check mtime+size before falling back to content hash.
   * Returns cached entry if file hasn't changed, null on miss.
   */
  getWithStat(filePath: string): CacheEntry | null {
    const p = this.entryPath(filePath);
    if (!existsSync(p)) return null;
    try {
      const entry: CacheEntry = JSON.parse(readFileSync(p, 'utf-8'));
      const st = statSync(filePath);
      if (entry.mtimeMs === st.mtimeMs && entry.size === st.size) return entry;
      // mtime/size differ or missing — recheck content hash
      const hash = this.hashFile(filePath);
      if (entry.fileHash !== hash) return null;
      // Hash matches — update entry with current mtime+size for next run
      entry.mtimeMs = st.mtimeMs;
      entry.size = st.size;
      try { writeFileSync(p, JSON.stringify(entry)); } catch { /* non-fatal */ }
      return entry;
    } catch { return null; }
  }

  get(filePath: string, fileHash: string): CacheEntry | null {
    const p = this.entryPath(filePath);
    if (!existsSync(p)) return null;
    try {
      const entry: CacheEntry = JSON.parse(readFileSync(p, 'utf-8'));
      return entry.fileHash === fileHash ? entry : null;
    } catch { return null; }
  }

  set(filePath: string, fileHash: string, nodes: MonographNode[], edges: MonographEdge[]): void {
    let mtimeMs: number | undefined;
    let size: number | undefined;
    try { const st = statSync(filePath); mtimeMs = st.mtimeMs; size = st.size; } catch { /* ignore */ }
    const entry: CacheEntry = { fileHash, mtimeMs, size, nodes, edges };
    writeFileSync(this.entryPath(filePath), JSON.stringify(entry));
  }

  setDeferred(filePath: string, fileHash: string, nodes: MonographNode[], edges: MonographEdge[]): void {
    let mtimeMs: number | undefined;
    let size: number | undefined;
    try { const st = statSync(filePath); mtimeMs = st.mtimeMs; size = st.size; } catch { /* ignore */ }
    const entry: CacheEntry = { fileHash, mtimeMs, size, nodes, edges };
    this.pending.push({ path: this.entryPath(filePath), data: JSON.stringify(entry) });
  }

  flush(): void {
    for (const { path, data } of this.pending) {
      try { writeFileSync(path, data); } catch { /* non-fatal */ }
    }
    this.pending = [];
  }
}
