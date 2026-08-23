/**
 * #124: shared JSONL helpers, consolidated from two hand-copied
 * implementations (knowledge-store.ts, prompt-version-store.ts) that had
 * already drifted on empty-collection write semantics and read tolerance.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendJsonl, readJsonl, rewriteJsonl } from './jsonl-store.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jsonl-store-test-'));
  file = join(dir, 'records.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('appendJsonl / readJsonl round-trip', () => {
  it('appends and reads back records in order', () => {
    appendJsonl(file, { id: 1 });
    appendJsonl(file, { id: 2 });
    expect(readJsonl<{ id: number }>(file)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('readJsonl on a nonexistent file returns an empty array (no throw)', () => {
    expect(readJsonl(join(dir, 'missing.jsonl'))).toEqual([]);
  });
});

describe('#124: readJsonl never throws — a corrupt line is dropped, not fatal', () => {
  it('skips a malformed line and still returns the well-formed ones', () => {
    writeFileSync(file, '{"id":1}\nnot json at all\n{"id":2}\n', 'utf-8');
    expect(readJsonl<{ id: number }>(file)).toEqual([{ id: 1 }, { id: 2 }]);
  });
});

describe('#124: rewriteJsonl empty-collection write is a genuinely empty file', () => {
  it('writes zero bytes for an empty record set (not a lone "\\n")', () => {
    rewriteJsonl(file, [{ id: 1 }]);
    rewriteJsonl(file, []);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf-8')).toBe('');
  });

  it('reading back an empty-written file returns an empty array', () => {
    rewriteJsonl(file, []);
    expect(readJsonl(file)).toEqual([]);
  });

  it('rewrite replaces the full contents, trailing newline included for non-empty sets', () => {
    rewriteJsonl(file, [{ id: 1 }, { id: 2 }]);
    expect(readFileSync(file, 'utf-8')).toBe('{"id":1}\n{"id":2}\n');
  });
});
