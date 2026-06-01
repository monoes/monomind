import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { buildAsync } from '../../../src/pipeline/orchestrator.js';
import { openDb, closeDb } from '../../../src/storage/db.js';

// ── Integration tests via buildAsync ─────────────────────────────────────────

describe('scope-resolution phase — method call resolution', () => {
  const base = join(tmpdir(), `monograph-scope-resolution-${Date.now()}`);
  const dbPath = join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    mkdirSync(join(base, 'src'), { recursive: true });

    writeFileSync(
      join(base, 'src', 'service.ts'),
      [
        `export class UserService {`,
        `  findById(id: string) {`,
        `    return id;`,
        `  }`,
        `}`,
      ].join('\n') + '\n',
    );

    writeFileSync(
      join(base, 'src', 'controller.ts'),
      [
        `import { UserService } from './service';`,
        `const svc = new UserService();`,
        `svc.findById('1');`,
      ].join('\n') + '\n',
    );

    await buildAsync(base);
  }, 60000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('creates the SQLite database', () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it('creates a CALLS edge pointing to UserService.findById with confidence_score >= 0.7', () => {
    const db = openDb(dbPath);
    try {
      // Find the findById method node
      const methodNode = db
        .prepare(`SELECT id FROM nodes WHERE name = 'findById' AND label IN ('Function', 'Method')`)
        .get() as { id: string } | undefined;

      expect(methodNode).toBeDefined();

      if (methodNode) {
        // Find any CALLS edge targeting findById
        const callsEdge = db
          .prepare(`
            SELECT * FROM edges
            WHERE target_id = ? AND relation = 'CALLS'
          `)
          .get(methodNode.id) as { confidence_score: number } | undefined;

        expect(callsEdge).toBeDefined();
        expect(callsEdge!.confidence_score).toBeGreaterThanOrEqual(0.7);
      }
    } finally {
      closeDb(db);
    }
  });
});

describe('scope-resolution phase — no crash on empty file', () => {
  it('does not crash when files have no call expressions', async () => {
    const base = join(tmpdir(), `monograph-scope-empty-${Date.now()}`);
    mkdirSync(join(base, 'src'), { recursive: true });

    writeFileSync(
      join(base, 'src', 'constants.ts'),
      `export const VERSION = '1.0.0';\nexport const MAX_RETRIES = 3;\n`,
    );

    try {
      await expect(buildAsync(base)).resolves.not.toThrow();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, 60000);
});

describe('scope-resolution phase — dynamic calls produce no edges', () => {
  const base = join(tmpdir(), `monograph-scope-dynamic-${Date.now()}`);
  const dbPath = join(base, '.monomind', 'monograph.db');

  beforeAll(async () => {
    mkdirSync(join(base, 'src'), { recursive: true });

    writeFileSync(
      join(base, 'src', 'dynamic.ts'),
      [
        `const handlers: Record<string, () => void> = {};`,
        `const key = 'myHandler';`,
        `// Dynamic call: obj[key](`,
        `const fn = handlers[key];`,
        `if (fn) fn();`,
      ].join('\n') + '\n',
    );

    await buildAsync(base);
  }, 60000);

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('creates the SQLite database', () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it('does not create CALLS edges for dynamic patterns', () => {
    const db = openDb(dbPath);
    try {
      // There should be no CALLS edges in a file with only dynamic-style calls
      // (the fn() direct call won't resolve since 'fn' is not a Function/Method node)
      const callsEdges = db
        .prepare(`SELECT COUNT(*) as cnt FROM edges WHERE relation = 'CALLS'`)
        .get() as { cnt: number };

      // No function/method named 'fn' or 'handlers' in DB, so no CALLS edge resolves
      expect(callsEdges.cnt).toBe(0);
    } finally {
      closeDb(db);
    }
  });
});
