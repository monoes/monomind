import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ExtractionCache } from '../../src/cache/extraction-cache.js';
import type { MonographNode } from '../../src/types.js';

const sampleNodes: MonographNode[] = [
  { id: 'n1', label: 'Function', name: 'fn', normLabel: 'fn', isExported: false },
];

let cacheDir: string;
beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'monograph-cache-')); });
afterEach(() => { rmSync(cacheDir, { recursive: true, force: true }); });

describe('ExtractionCache', () => {
  it('returns null for unknown file', () => {
    const cache = new ExtractionCache(cacheDir);
    expect(cache.get('some/file.ts', 'abc123')).toBeNull();
  });

  it('stores and retrieves nodes for a file hash', () => {
    const cache = new ExtractionCache(cacheDir);
    cache.set('src/foo.ts', 'deadbeef', sampleNodes, []);
    const hit = cache.get('src/foo.ts', 'deadbeef');
    expect(hit).not.toBeNull();
    expect(hit!.nodes[0].name).toBe('fn');
  });

  it('returns null when hash has changed (cache miss)', () => {
    const cache = new ExtractionCache(cacheDir);
    cache.set('src/foo.ts', 'hash1', sampleNodes, []);
    expect(cache.get('src/foo.ts', 'hash2')).toBeNull();
  });

  it('computes file hash deterministically', () => {
    const cache = new ExtractionCache(cacheDir);
    const tmpFile = join(cacheDir, 'test.ts');
    writeFileSync(tmpFile, 'const x = 1;');
    const h1 = cache.hashFile(tmpFile);
    const h2 = cache.hashFile(tmpFile);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // sha256 hex
  });
});
