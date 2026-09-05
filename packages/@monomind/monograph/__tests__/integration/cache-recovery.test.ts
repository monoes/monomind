import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, unlinkSync, readdirSync } from 'fs';
import { vi } from 'vitest';

// Regression: the extraction cache is flushed to disk BEFORE the build's SQL
// transaction commits, and a cache hit used to skip inserting the cached
// nodes/edges on the assumption that they were already in SQLite. That
// assumption breaks whenever the database and the cache disagree:
//
//   1. a build that fails and rolls back leaves a fully-populated cache in
//      front of an empty database — the retry then "succeeds" with ZERO nodes;
//   2. deleting/replacing the database file while keeping the cache produces
//      the same silently-empty graph.
//
// Cached extraction is now treated as reusable INPUT that repopulates storage
// on its own, so neither case can under-populate the index.
const state = vi.hoisted(() => ({ failNext: false }));

// suggest is the last phase and nothing else consumes its output, so failing it
// exercises "everything parsed and inserted, then the build aborts".
vi.mock('../../src/pipeline/phases/suggest.js', () => ({
  suggestPhase: {
    name: 'suggest',
    deps: [],
    execute: async () => {
      if (state.failNext) throw new Error('injected post-parse failure');
      return { questions: [] };
    },
  },
}));

const tmpRepo = join(tmpdir(), `monograph-cache-recovery-${Date.now()}`);
const dbPath = join(tmpRepo, '.monomind', 'monograph.db');
const cacheDir = join(tmpRepo, '.monomind', 'parse-cache');

beforeAll(() => {
  mkdirSync(join(tmpRepo, 'src'), { recursive: true });
  writeFileSync(
    join(tmpRepo, 'src', 'greeter.ts'),
    `
export class GreeterImpl {
  greet(name: string): string {
    return 'hello ' + name;
  }
}
export function makeGreeter(): GreeterImpl {
  return new GreeterImpl();
}
`,
  );
});

afterAll(() => rmSync(tmpRepo, { recursive: true, force: true }));

async function countNodesInDb(): Promise<number> {
  const { openDb, closeDb } = await import('../../src/storage/db.js');
  const { countNodes } = await import('../../src/storage/node-store.js');
  const db = openDb(dbPath);
  try {
    return countNodes(db);
  } finally {
    closeDb(db);
  }
}

function cacheEntryCount(): number {
  if (!existsSync(cacheDir)) return 0;
  return readdirSync(cacheDir).filter((f) => f.endsWith('.json')).length;
}

describe('cache recovery is consistent with database recovery', () => {
  it('a failed build followed by a normal retry produces a complete graph', async () => {
    const { buildAsync } = await import('../../src/pipeline/orchestrator.js');

    state.failNext = true;
    await expect(buildAsync(tmpRepo)).rejects.toThrow(/injected post-parse failure/);

    // The failed build rolled the database back but still flushed its parse cache.
    expect(await countNodesInDb()).toBe(0);
    expect(cacheEntryCount()).toBeGreaterThan(0);

    // The retry hits the cache for every file. It must still repopulate storage.
    state.failNext = false;
    await buildAsync(tmpRepo);

    expect(await countNodesInDb()).toBeGreaterThan(0);

    const { openDb, closeDb } = await import('../../src/storage/db.js');
    const { getNodesForFile } = await import('../../src/storage/node-store.js');
    const db = openDb(dbPath);
    try {
      const names = getNodesForFile(db, 'src/greeter.ts').map((n) => n.name);
      expect(names).toContain('GreeterImpl');
      expect(names).toContain('makeGreeter');
    } finally {
      closeDb(db);
    }
  }, 60000);

  it('recreates the graph when the database is deleted but the parse cache is retained', async () => {
    const { buildAsync } = await import('../../src/pipeline/orchestrator.js');
    state.failNext = false;

    await buildAsync(tmpRepo);
    const before = await countNodesInDb();
    expect(before).toBeGreaterThan(0);

    // Drop only the database — every parse-cache entry stays on disk.
    unlinkSync(dbPath);
    for (const suffix of ['-wal', '-shm']) {
      const p = `${dbPath}${suffix}`;
      if (existsSync(p)) unlinkSync(p);
    }
    expect(cacheEntryCount()).toBeGreaterThan(0);

    await buildAsync(tmpRepo);

    expect(await countNodesInDb()).toBe(before);
  }, 60000);
});
