/**
 * Regression test for a release-blocking bug: `monomind search --type code`
 * (and plain `monomind search`) always returned "No results found", even
 * for a symbol independently confirmed indexed (`monomind monograph search`
 * found it fine, with file:line, via the same on-disk database).
 *
 * Root cause: CapabilityModule.search() is optional, and
 * CapabilityManager.search() only calls `module.search()` when a module
 * defines one (see manager.ts). `codeCapability` in cap-code.ts never
 * defined a `search` method at all — it was a pure no-op stub with a
 * comment claiming "existing monograph handles code indexing", but nothing
 * ever wired that claim up. The `code` capability therefore silently
 * contributed zero results to every top-level search, including the
 * advertised `--type code` filter.
 *
 * Fix: codeCapability.search() now opens the same monograph FTS database
 * `monomind monograph search` reads and queries it directly.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insertNode, openDb } from '@monoes/monograph';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codeCapability } from '../capabilities/cap-code.js';

// codeCapability.search is optional on CapabilityModule (that optionality is
// exactly what let the old no-op stub silently omit it). Route calls through
// a helper that throws a clear error if it's ever missing again, instead of
// asserting it away with `!` in every test.
function searchCode(query: string, limit?: number) {
  if (!codeCapability.search) throw new Error('codeCapability.search is not defined');
  return codeCapability.search(query, limit);
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cap-code-search-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('codeCapability.search()', () => {
  it('is defined (a no-op stub silently contributed zero results to every search)', () => {
    expect(codeCapability.search).toBeTypeOf('function');
  });

  it('returns [] when no monograph database exists yet, instead of throwing', async () => {
    await codeCapability.activate(tmp);
    const results = await searchCode('anything', 10);
    expect(results).toEqual([]);
  });

  it('finds a symbol that monograph indexed, matching monomind monograph search', async () => {
    const dbPath = join(tmp, '.monomind', 'monograph.db');
    const db = openDb(dbPath);
    insertNode(db, {
      id: 'sym_qacrosshittoken77fn_function',
      label: 'Function',
      name: 'qaCrossHitToken77Fn',
      normLabel: 'qacrosshittoken77fn',
      filePath: 'src/sample_cross.py',
      startLine: 1,
      endLine: 3,
      isExported: false,
    });
    db.close();

    await codeCapability.activate(tmp);
    const results = await searchCode('qaCrossHitToken77Fn', 15);

    expect(results).toHaveLength(1);
    expect(results[0]?.type).toBe('code');
    expect(results[0]?.path).toBe('src/sample_cross.py');
    expect(results[0]?.snippet).toContain('qaCrossHitToken77Fn');
  });
});
