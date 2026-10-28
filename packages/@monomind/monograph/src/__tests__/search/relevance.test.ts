import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAsync } from '../../pipeline/orchestrator.js';
import { searchGraphFused } from '../../search/fused-search.js';
import { searchGraph } from '../../search/hybrid-query.js';
import { assessRelevance } from '../../search/relevance.js';

describe('test demotion and the relevance floor', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'relevance-'));
    mkdirSync(join(tmpDir, 'src', '__tests__'), { recursive: true });
    mkdirSync(join(tmpDir, 'tests', 'fixtures'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'src', 'index-search.ts'),
      'export function searchIndex(q: string) { return q; }\n',
    );
    writeFileSync(
      join(tmpDir, 'src', '__tests__', 'index-search.test.ts'),
      'export function searchIndexHelper(q: string) { return q; }\nexport function searchIndexFixture() { return 1; }\n',
    );
    writeFileSync(
      join(tmpDir, 'tests', 'fixtures', 'search-index-data.ts'),
      'export function searchIndexSample() { return 1; }\n',
    );
    await buildAsync(tmpDir, { codeOnly: true });
    db = new Database(join(tmpDir, '.monomind', 'monograph.db'), { readonly: true });
  }, 60_000);

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ranks the real symbol above test, mock and fixture helpers', () => {
    const names = searchGraph(db, 'searchIndex', { limit: 10, scope: 'code' }).map((h) => h.name);
    expect(names[0]).toBe('searchIndex');
    expect(names.indexOf('searchIndexHelper')).toBeGreaterThan(names.indexOf('searchIndex'));
  });

  it('keeps tests at full weight when the query asks for tests', () => {
    const plain = searchGraph(db, 'searchIndexHelper', { limit: 5, scope: 'code' })[0];
    const asked = searchGraph(db, 'searchIndexHelper test', { limit: 5, scope: 'code' })[0];
    expect(plain?.name).toBe('searchIndexHelper');
    expect(asked?.relevance ?? 0).toBeGreaterThan(plain?.relevance ?? 0);
  });

  it('flags a concept the code does not have as not relevant', async () => {
    const q = 'loyalty points expiry scheduler';
    const hits = await searchGraphFused(db, q, { limit: 10, scope: 'code' });
    expect(assessRelevance(db, q, hits).relevant).toBe(false);
  });

  it('accepts a question whose words the best hit covers', async () => {
    const q = 'search the index';
    const hits = await searchGraphFused(db, q, { limit: 10, scope: 'code' });
    expect(assessRelevance(db, q, hits).relevant).toBe(true);
  });

  it('never judges a bare identifier, and reports no hits as not relevant', async () => {
    const hits = await searchGraphFused(db, 'searchIndex', { limit: 5, scope: 'code' });
    expect(assessRelevance(db, 'searchIndx', hits).relevant).toBe(true);
    expect(assessRelevance(db, 'anything at all', []).relevant).toBe(false);
  });
});
