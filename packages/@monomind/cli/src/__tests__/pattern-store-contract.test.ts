/**
 * PatternStore contract — the same behaviour suite run against both
 * implementations: the JSON-file LocalReasoningBank and SqlitePatternStore.
 * Each case uses an isolated temp project directory (MONOMIND_CWD), never HOME.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalReasoningBank } from '../memory/intelligence-reasoning-bank.js';
import type { ReasoningBankStore } from '../memory/intelligence-sqlite-store.js';
import { openSqlitePatternStore } from '../memory/intelligence-sqlite-store.js';

interface Impl {
  name: string;
  open(dir: string, maxSize: number): ReasoningBankStore;
  /** Persist and drop an instance so a later open() sees only what is on disk. */
  close(store: ReasoningBankStore): void;
}

const neuralDir = (dir: string) => join(dir, '.monomind', 'neural');

const impls: Impl[] = [
  {
    name: 'json (LocalReasoningBank)',
    open: (_dir, maxSize) => new LocalReasoningBank({ maxSize }),
    close: (s) => s.flushToDisk(),
  },
  {
    name: 'sqlite (SqlitePatternStore)',
    open: (dir, maxSize) => {
      const s = openSqlitePatternStore(neuralDir(dir), maxSize);
      if (!s) throw new Error('better-sqlite3 must be available in the test environment');
      return s;
    },
    close: (s) => (s as { close?: () => void }).close?.(),
  },
];

const vec = (...v: number[]) => v;
const base = (id: string, extra: Partial<Parameters<ReasoningBankStore['store']>[0]> = {}) => ({
  id,
  type: 'action',
  content: `content ${id}`,
  confidence: 0.6,
  embedding: vec(1, 0, 0),
  ...extra,
});

describe.each(impls)('PatternStore contract: $name', (impl) => {
  let dir: string;
  let prevCwd: string | undefined;
  const open: ReasoningBankStore[] = [];
  const make = (maxSize = 100) => {
    const s = impl.open(dir, maxSize);
    open.push(s);
    return s;
  };
  const reopen = (s: ReasoningBankStore, maxSize = 100) => {
    impl.close(s);
    return make(maxSize);
  };

  beforeEach(() => {
    prevCwd = process.env.MONOMIND_CWD;
    dir = mkdtempSync(join(tmpdir(), 'mm-pstore-'));
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    process.env.MONOMIND_CWD = dir;
  });

  afterEach(() => {
    for (const s of open.splice(0)) impl.close(s);
    if (prevCwd === undefined) delete process.env.MONOMIND_CWD;
    else process.env.MONOMIND_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores a new pattern with default usage and timestamps', () => {
    const s = make();
    const before = Date.now();
    s.store(base('a'));
    const got = s.get('a');
    expect(got).toMatchObject({ id: 'a', type: 'action', content: 'content a', confidence: 0.6 });
    expect(got?.usageCount).toBe(0);
    expect(got?.createdAt).toBeGreaterThanOrEqual(before);
    expect(got?.lastUsedAt).toBeGreaterThanOrEqual(before);
    expect(got?.embedding).toEqual([1, 0, 0]);
  });

  it('honours explicit usageCount/createdAt/lastUsedAt on insert', () => {
    const s = make();
    s.store(base('a', { usageCount: 7, createdAt: 1000, lastUsedAt: 2000 }));
    expect(s.get('a')).toMatchObject({ usageCount: 7, createdAt: 1000, lastUsedAt: 2000 });
  });

  it('re-storing an id updates fields, adds one use and keeps createdAt and metadata', () => {
    const s = make();
    s.store(base('a', { createdAt: 1000, metadata: { source: 'x' } }));
    s.store(base('a', { content: 'updated', confidence: 0.9, usageCount: 50 }));
    const got = s.get('a');
    expect(got).toMatchObject({
      content: 'updated',
      confidence: 0.9,
      usageCount: 1,
      createdAt: 1000,
    });
    expect(got?.metadata).toEqual({ source: 'x' });
    expect(s.getAll()).toHaveLength(1);
  });

  it('findSimilar ranks by cosine, applies k/threshold/type and reports score as confidence', () => {
    const s = make();
    s.store(base('same', { embedding: vec(1, 0, 0) }));
    s.store(base('close', { embedding: vec(0.9, 0.1, 0) }));
    s.store(base('far', { embedding: vec(0, 1, 0) }));
    s.store(base('other-type', { type: 'thought', embedding: vec(1, 0, 0) }));

    const hits = s.findSimilar(vec(1, 0, 0), { k: 5, threshold: 0.5 });
    expect(hits.map((h) => h.id)).toEqual(['same', 'other-type', 'close']);
    expect(hits[0]?.confidence).toBeCloseTo(1, 10);

    expect(s.findSimilar(vec(1, 0, 0), { k: 1 }).map((h) => h.id)).toHaveLength(1);
    expect(s.findSimilar(vec(1, 0, 0), { type: 'thought' }).map((h) => h.id)).toEqual([
      'other-type',
    ]);
    expect(s.findSimilar(vec(0, 0, 1), { threshold: 0.5 })).toEqual([]);
  });

  it('findSimilar is a pure read: returns copies and leaves usage untouched', () => {
    const s = make();
    s.store(base('a'));
    const hit = s.findSimilar(vec(1, 0, 0), {})[0];
    expect(hit).toBeDefined();
    if (hit) hit.content = 'mutated copy';
    expect(s.get('a')?.content).toBe('content a');
    expect(s.get('a')?.usageCount).toBe(0);
    expect(s.get('a')?.confidence).toBe(0.6);
  });

  it('recordUsage increments usage and bumps lastUsedAt; unknown ids are ignored', () => {
    const s = make();
    s.store(base('a', { lastUsedAt: 1 }));
    s.recordUsage('a');
    s.recordUsage('a');
    expect(s.get('a')?.usageCount).toBe(2);
    expect(s.get('a')?.lastUsedAt).toBeGreaterThan(1);
    expect(() => s.recordUsage('missing')).not.toThrow();
    expect(s.get('missing')).toBeUndefined();
  });

  it('getAll keeps insertion order; getByType filters', () => {
    const s = make();
    s.store(base('a'));
    s.store(base('b', { type: 'thought' }));
    s.store(base('c'));
    s.store(base('a', { content: 'again' })); // update keeps position
    expect(s.getAll().map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(s.getByType('action').map((p) => p.id)).toEqual(['a', 'c']);
    expect(s.getByType('nope')).toEqual([]);
  });

  it('delete reports whether the id existed; clear empties the store', () => {
    const s = make();
    s.store(base('a'));
    s.store(base('b'));
    expect(s.delete('a')).toBe(true);
    expect(s.delete('a')).toBe(false);
    expect(s.get('a')).toBeUndefined();
    s.clear();
    expect(s.getAll()).toEqual([]);
    expect(s.stats()).toEqual({ size: 0, patternCount: 0 });
  });

  it('retention: evicts the oldest inserted pattern beyond maxSize', () => {
    const s = make(3);
    s.store(base('p1'));
    s.store(base('p2'));
    s.store(base('p3'));
    s.store(base('p1', { content: 'touched' })); // an update does not refresh age
    s.store(base('p4'));
    expect(s.getAll().map((p) => p.id)).toEqual(['p2', 'p3', 'p4']);
    expect(s.stats()).toEqual({ size: 3, patternCount: 3 });
  });

  it('persists stored patterns and usage across reopen', () => {
    const s = make();
    s.store(base('a', { metadata: { k: 1 } }));
    s.store(base('b', { embedding: vec(0.1234567890123, -2.5e-7, 3) }));
    s.recordUsage('a');
    const r = reopen(s);
    expect(r.getAll().map((p) => p.id)).toEqual(['a', 'b']);
    expect(r.get('a')).toMatchObject({ usageCount: 1, metadata: { k: 1 } });
    // Embeddings round-trip exactly (no float32 truncation).
    expect(r.get('b')?.embedding).toEqual([0.1234567890123, -2.5e-7, 3]);
  });

  it('get() returns the live record: in-place edits persist through flushToDisk', () => {
    const s = make();
    s.store(base('a'));
    const live = s.get('a');
    if (!live) throw new Error('missing');
    live.confidence = 0.95;
    live.usageCount = 4;
    expect(s.get('a')?.confidence).toBe(0.95);
    s.flushToDisk();
    const r = reopen(s);
    expect(r.get('a')).toMatchObject({ confidence: 0.95, usageCount: 4 });
  });
});
