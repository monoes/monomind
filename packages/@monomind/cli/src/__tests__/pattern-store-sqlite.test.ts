/**
 * SqlitePatternStore specifics: the one-time patterns.json import, fallback to
 * the JSON store when SQLite is unavailable, cross-connection visibility, and
 * the file helpers the import/export/transfer commands use. Temp dirs only.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openPatternDb,
  patternDbStats,
  readPatternDbRecords,
  setPatternDbDriverForTests,
  writePatternDbRecords,
} from '../memory/intelligence-pattern-db.js';
import {
  openSqlitePatternStore,
  type SqlitePatternStore,
} from '../memory/intelligence-sqlite-store.js';

let dir: string;
let neural: string;
let prevCwd: string | undefined;
const stores: SqlitePatternStore[] = [];

function open(maxSize = 100): SqlitePatternStore {
  const s = openSqlitePatternStore(neural, maxSize);
  if (!s) throw new Error('better-sqlite3 must be available in the test environment');
  stores.push(s);
  return s;
}

function writeJson(records: unknown, name = 'patterns.json'): string {
  mkdirSync(neural, { recursive: true });
  const p = join(neural, name);
  writeFileSync(p, typeof records === 'string' ? records : JSON.stringify(records, null, 2));
  return p;
}

const rec = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'action',
  content: `c-${id}`,
  confidence: 0.7,
  usageCount: 3,
  createdAt: 1000,
  lastUsedAt: 2000,
  embedding: [0.5, 0.25],
  ...extra,
});

beforeEach(() => {
  prevCwd = process.env.MONOMIND_CWD;
  dir = mkdtempSync(join(tmpdir(), 'mm-psqlite-'));
  mkdirSync(join(dir, '.monomind'), { recursive: true });
  neural = join(dir, '.monomind', 'neural');
  process.env.MONOMIND_CWD = dir;
});

afterEach(async () => {
  for (const s of stores.splice(0)) s.close();
  setPatternDbDriverForTests(undefined);
  const intel = await import('../memory/intelligence.js');
  intel.clearIntelligence();
  if (prevCwd === undefined) delete process.env.MONOMIND_CWD;
  else process.env.MONOMIND_CWD = prevCwd;
  rmSync(dir, { recursive: true, force: true });
});

describe('one-time patterns.json import', () => {
  it('imports into an empty store, keeps every field, and renames (never deletes) the JSON', () => {
    const original = JSON.stringify([rec('a', { trigger: 'on-edit' }), rec('b')], null, 2);
    const jsonPath = writeJson(original);
    const s = open();
    expect(s.getAll().map((p) => p.id)).toEqual(['a', 'b']);
    expect(s.get('a')).toMatchObject({
      usageCount: 3,
      createdAt: 1000,
      lastUsedAt: 2000,
      embedding: [0.5, 0.25],
    });
    expect(existsSync(jsonPath)).toBe(false);
    expect(readFileSync(`${jsonPath}.imported`, 'utf-8')).toBe(original);
    // Non-core fields survive for export/transfer.
    expect(readPatternDbRecords(neural)?.[0]).toMatchObject({ id: 'a', trigger: 'on-edit' });
  });

  it('leaves the JSON alone when the store already has patterns', () => {
    const s = open();
    s.store({ id: 'existing', type: 't', content: 'x', confidence: 0.5, embedding: [1] });
    s.close();
    const jsonPath = writeJson([rec('a')]);
    const r = open();
    expect(r.getAll().map((p) => p.id)).toEqual(['existing']);
    expect(existsSync(jsonPath)).toBe(true);
  });

  it('imports only once, even if a patterns.json appears again later', () => {
    writeJson([rec('a')]);
    open().clear();
    const again = writeJson([rec('b')]);
    expect(open().getAll()).toEqual([]);
    expect(existsSync(again)).toBe(true);
  });

  it('skips a corrupt JSON file and leaves it in place', () => {
    const jsonPath = writeJson('{not json');
    expect(open().getAll()).toEqual([]);
    expect(readFileSync(jsonPath, 'utf-8')).toBe('{not json');
  });

  it('applies the JSON store validation and the retention bound while importing', () => {
    writeJson([
      rec('bad', { confidence: 1e9 }),
      rec('p1'),
      rec('p2'),
      rec('p3'),
      rec('p4'),
      { no: 'id' },
    ]);
    expect(
      open(3)
        .getAll()
        .map((p) => p.id),
    ).toEqual(['p2', 'p3', 'p4']);
  });

  it('does not overwrite an earlier patterns.json.imported', () => {
    writeJson('["earlier backup"]', 'patterns.json.imported');
    writeJson([rec('a')]);
    open();
    expect(readFileSync(join(neural, 'patterns.json.imported'), 'utf-8')).toBe(
      '["earlier backup"]',
    );
    expect(readdirSync(neural).filter((f) => f.startsWith('patterns.json.imported-'))).toHaveLength(
      1,
    );
  });
});

describe('SqlitePatternStore beyond the shared contract', () => {
  it('a delete stays deleted after reopen', () => {
    const s = open();
    s.store({ id: 'x', type: 't', content: 'c', confidence: 0.5, embedding: [1] });
    s.delete('x');
    s.close();
    expect(open().get('x')).toBeUndefined();
  });

  it('sees writes committed by another connection', () => {
    const a = open();
    const b = open();
    a.store({ id: 'x', type: 't', content: 'c', confidence: 0.5, embedding: [1] });
    expect(b.get('x')?.content).toBe('c');
    b.recordUsage('x');
    b.recordUsage('x');
    expect(a.get('x')?.usageCount).toBe(2);
    b.delete('x');
    expect(a.getAll()).toEqual([]);
  });

  it('skips tampered rows on load', () => {
    open().store({ id: 'ok', type: 't', content: 'c', confidence: 0.5, embedding: [1] });
    const db = openPatternDb(neural);
    db?.prepare(
      `INSERT INTO patterns (id, type, content, confidence, usage_count, created_at, last_used_at)
       VALUES ('evil', 't', 'c', 1e9, 0, 0, 0)`,
    ).run();
    db?.close();
    expect(
      open()
        .getAll()
        .map((p) => p.id),
    ).toEqual(['ok']);
  });

  it('opens in WAL mode with a busy timeout', () => {
    open();
    const db = openPatternDb(neural);
    expect(db?.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db?.pragma('busy_timeout', { simple: true })).toBe(5000);
    db?.close();
  });
});

describe('store selection', () => {
  it('uses SQLite by default and reports patterns.db as the patterns file', async () => {
    const intel = await import('../memory/intelligence.js');
    intel.clearIntelligence();
    await intel.initializeIntelligence();
    expect(intel.getPersistenceStatus().patternsFile).toBe(join(neural, 'patterns.db'));
    expect(intel.getPersistenceStatus().patternsExist).toBe(true);
  });

  it('falls back to the JSON store when better-sqlite3 is unavailable', async () => {
    setPatternDbDriverForTests(null);
    expect(openSqlitePatternStore(neural, 10)).toBeNull();
    expect(writePatternDbRecords(neural, [rec('a')], 'add')).toBe(false);
    expect(readPatternDbRecords(neural)).toBeNull();
    const intel = await import('../memory/intelligence.js');
    intel.clearIntelligence();
    await intel.initializeIntelligence();
    expect(intel.getPersistenceStatus().patternsFile).toBe(join(neural, 'patterns.json'));
    expect(existsSync(join(neural, 'patterns.db'))).toBe(false);
  });
});

describe('file helpers used by import/export/transfer', () => {
  it("'add' keeps existing ids untouched, 'replace' swaps the set", () => {
    expect(writePatternDbRecords(neural, [rec('a'), rec('b')], 'add')).toBe(true);
    writePatternDbRecords(neural, [rec('a', { content: 'changed' }), rec('c')], 'add');
    expect(readPatternDbRecords(neural)?.map((r) => [r.id, r.content])).toEqual([
      ['a', 'c-a'],
      ['b', 'c-b'],
      ['c', 'c-c'],
    ]);
    writePatternDbRecords(neural, [rec('z')], 'replace');
    expect(readPatternDbRecords(neural)?.map((r) => r.id)).toEqual(['z']);
    expect(patternDbStats(neural)).toMatchObject({ entries: 1 });
  });

  it('read-only helpers never create a database', () => {
    expect(readPatternDbRecords(neural)).toBeNull();
    expect(patternDbStats(neural)).toBeNull();
    expect(existsSync(join(neural, 'patterns.db'))).toBe(false);
  });
});
