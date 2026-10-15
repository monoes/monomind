import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { buildAsync } from '../../src/pipeline/orchestrator.js';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNodes } from '../../src/storage/node-store.js';

// Regression: a rebuild that re-parsed nothing re-inserted every cached node with
// INSERT OR REPLACE, which reset community_id and properties, and then skipped the
// communities phase — so every community assignment and enriched property vanished.
// Separately, the orphan sweep for deleted files ran after the derived phases, so
// communities and Process rows kept describing symbols that no longer existed.

const tmpRepo = join(tmpdir(), `monograph-derived-integrity-${Date.now()}`);
const dbPath = join(tmpRepo, '.monomind', 'monograph.db');
const srcDir = join(tmpRepo, 'src');

const MAIN = `
import { stepOne } from './one.js';
import { stepTwo } from './two.js';
export function main(): number {
  return stepOne() + stepTwo();
}
`;
const ONE = `
import { shared } from './shared.js';
export function stepOne(): number {
  return shared() + 1;
}
`;
const TWO = `
import { shared } from './shared.js';
export function stepTwo(): number {
  return shared() + 2;
}
`;
const SHARED = `
export function shared(): number {
  return 40;
}
`;

function withDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const db = openDb(dbPath);
  try {
    return fn(db);
  } finally {
    closeDb(db);
  }
}

const one = <T>(sql: string, ...params: unknown[]): T =>
  withDb((db) => db.prepare(sql).get(...params) as T);

beforeAll(() => {
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, 'main.ts'), MAIN);
  writeFileSync(join(srcDir, 'one.ts'), ONE);
  writeFileSync(join(srcDir, 'two.ts'), TWO);
  writeFileSync(join(srcDir, 'shared.ts'), SHARED);
});

afterAll(() => rmSync(tmpRepo, { recursive: true, force: true }));

describe('rebuilds keep derived data intact', () => {
  it('keeps community ids and enriched properties through a no-change rebuild', async () => {
    await buildAsync(tmpRepo);
    const assigned = one<{ c: number }>(
      'SELECT COUNT(*) as c FROM nodes WHERE community_id IS NOT NULL',
    ).c;
    expect(assigned).toBeGreaterThan(0);

    withDb((db) =>
      db
        .prepare(
          `UPDATE nodes SET properties = json_set(COALESCE(properties, '{}'), '$.summary', 'enriched')
           WHERE name = 'shared' AND label = 'Function'`,
        )
        .run(),
    );

    const result = await buildAsync(tmpRepo);
    expect(result.status).toBe('built');

    expect(
      one<{ c: number }>('SELECT COUNT(*) as c FROM nodes WHERE community_id IS NOT NULL').c,
    ).toBe(assigned);
    expect(
      one<{ s: string | null }>(
        `SELECT json_extract(properties, '$.summary') as s FROM nodes
         WHERE name = 'shared' AND label = 'Function'`,
      ).s,
    ).toBe('enriched');
  }, 60000);

  it('re-derives communities and processes after a file is deleted', async () => {
    expect(one<{ c: number }>("SELECT COUNT(*) as c FROM nodes WHERE label = 'Process'").c).toBe(
      1,
    );
    unlinkSync(join(srcDir, 'shared.ts'));
    await buildAsync(tmpRepo);

    // Every community's recorded size matches its live members, and none is empty.
    const mismatched = withDb(
      (db) =>
        db
          .prepare(
            `SELECT c.id FROM communities c
             WHERE c.size != (SELECT COUNT(*) FROM nodes n WHERE n.community_id = c.id)`,
          )
          .all().length,
    );
    expect(mismatched).toBe(0);

    // The Process rooted at main() describes its current call chain, not the old one.
    const proc = one<{ steps: number; recorded: number }>(
      `SELECT
         (SELECT COUNT(*) FROM edges e WHERE e.source_id = p.id AND e.relation = 'STEP_IN_PROCESS') AS steps,
         json_extract(p.properties, '$.stepCount') AS recorded
       FROM nodes p WHERE p.label = 'Process'`,
    );
    expect(proc.recorded).toBe(proc.steps);
  }, 60000);
});

describe('insertNodes upsert', () => {
  it('refreshes structural columns but keeps community_id and merges properties', () => {
    const upsertDb = join(tmpRepo, '.monomind', 'upsert.db');
    const db = openDb(upsertDb);
    try {
      const base = {
        id: 'n1',
        label: 'Function' as const,
        name: 'alpha',
        filePath: 'src/a.ts',
        startLine: 1,
        isExported: false,
      };
      insertNodes(db, [{ ...base, properties: { fresh: 1 } }]);
      db.prepare(
        `UPDATE nodes SET community_id = 7, properties = json_set(properties, '$.summary', 'kept') WHERE id = 'n1'`,
      ).run();

      insertNodes(db, [{ ...base, name: 'beta', startLine: 9, properties: { fresh: 2 } }]);

      const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get('n1') as Record<
        string,
        unknown
      >;
      expect(row.name).toBe('beta');
      expect(row.start_line).toBe(9);
      expect(row.community_id).toBe(7);
      expect(JSON.parse(row.properties as string)).toEqual({ fresh: 2, summary: 'kept' });
    } finally {
      closeDb(db);
    }
  });
});
