import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { buildAsync } from '../../../src/pipeline/orchestrator.js';
import { openDb, closeDb } from '../../../src/storage/db.js';

// ── Helper: create a temp project dir and run buildAsync ─────────────────────

async function buildProject(label: string, files: Record<string, string>): Promise<string> {
  const base = join(tmpdir(), `monograph-processes-${label}-${Date.now()}`);
  mkdirSync(join(base, 'src'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(base, 'src', name), content);
  }
  await buildAsync(base);
  return base;
}

// ── Test: basic entry-point detection + BFS ────────────────────────────────

describe('processes phase — basic entry-point + BFS', () => {
  let base: string;
  const dbPathFn = () => join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    base = await buildProject('basic', {
      'index.ts': [
        `export function main(): void {`,
        `  helper();`,
        `}`,
        ``,
        `function helper(): void {`,
        `  // leaf function`,
        `}`,
        ``,
        `main();`,
      ].join('\n'),
    });
  }, 60_000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('creates the SQLite database', () => {
    expect(existsSync(dbPathFn())).toBe(true);
  });

  it('creates at least one Process node', () => {
    const db = openDb(dbPathFn());
    try {
      const row = db
        .prepare(`SELECT COUNT(*) as cnt FROM nodes WHERE label = 'Process'`)
        .get() as { cnt: number };
      expect(row.cnt).toBeGreaterThan(0);
    } finally {
      closeDb(db);
    }
  });

  it('the main function process includes main as a step', () => {
    const db = openDb(dbPathFn());
    try {
      // Find a Process named 'main'
      const proc = db
        .prepare(`SELECT id FROM nodes WHERE label = 'Process' AND name = 'main'`)
        .get() as { id: string } | undefined;

      expect(proc).toBeDefined();
      if (!proc) return;

      // Find the main function node
      const mainFn = db
        .prepare(`SELECT id FROM nodes WHERE name = 'main' AND label IN ('Function', 'Method')`)
        .get() as { id: string } | undefined;

      expect(mainFn).toBeDefined();
      if (!mainFn) return;

      // Check STEP_IN_PROCESS edge: process → main
      const stepEdge = db
        .prepare(
          `SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = 'STEP_IN_PROCESS'`,
        )
        .get(proc.id, mainFn.id) as { id: string } | undefined;

      expect(stepEdge).toBeDefined();
    } finally {
      closeDb(db);
    }
  });

  it('creates ENTRY_POINT_OF edge from entry symbol to process', () => {
    const db = openDb(dbPathFn());
    try {
      const entryEdge = db
        .prepare(`SELECT id FROM edges WHERE relation = 'ENTRY_POINT_OF'`)
        .get() as { id: string } | undefined;
      expect(entryEdge).toBeDefined();
    } finally {
      closeDb(db);
    }
  });
});

// ── Test: BFS does NOT infinite-loop on mutually recursive functions ─────────

describe('processes phase — no infinite loop on mutual recursion', () => {
  let base: string;
  const dbPathFn = () => join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    base = await buildProject('recursive', {
      'index.ts': [
        `export function a(): void {`,
        `  b();`,
        `}`,
        ``,
        `export function b(): void {`,
        `  a();`,
        `}`,
        ``,
        `a();`,
      ].join('\n'),
    });
  }, 60_000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('completes build without hanging on cyclic call graph', () => {
    // If we got here, buildAsync terminated — BFS visited set prevents loops
    expect(existsSync(dbPathFn())).toBe(true);
  });

  it('creates Process nodes (recursion does not prevent detection)', () => {
    const db = openDb(dbPathFn());
    try {
      const row = db
        .prepare(`SELECT COUNT(*) as cnt FROM nodes WHERE label = 'Process'`)
        .get() as { cnt: number };
      expect(row.cnt).toBeGreaterThan(0);
    } finally {
      closeDb(db);
    }
  });
});

// ── Test: processResult.stats.totalProcesses > 0 ──────────────────────────

describe('processes phase — stats reporting', () => {
  let base: string;
  const dbPathFn = () => join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    base = await buildProject('stats', {
      'app.ts': [
        `export function run(): void {`,
        `  compute();`,
        `}`,
        ``,
        `function compute(): number {`,
        `  return 42;`,
        `}`,
      ].join('\n'),
    });
  }, 60_000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('has at least one Process node in the DB (stats.totalProcesses > 0)', () => {
    const db = openDb(dbPathFn());
    try {
      const row = db
        .prepare(`SELECT COUNT(*) as cnt FROM nodes WHERE label = 'Process'`)
        .get() as { cnt: number };
      expect(row.cnt).toBeGreaterThan(0);
    } finally {
      closeDb(db);
    }
  });

  it('has STEP_IN_PROCESS edges', () => {
    const db = openDb(dbPathFn());
    try {
      const row = db
        .prepare(`SELECT COUNT(*) as cnt FROM edges WHERE relation = 'STEP_IN_PROCESS'`)
        .get() as { cnt: number };
      expect(row.cnt).toBeGreaterThan(0);
    } finally {
      closeDb(db);
    }
  });
});
