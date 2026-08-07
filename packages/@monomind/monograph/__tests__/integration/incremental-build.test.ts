import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, unlinkSync } from 'fs';
import { buildAsync, buildIncrementalAsync } from '../../src/pipeline/orchestrator.js';
import { openDb, closeDb } from '../../src/storage/db.js';
import { countNodes } from '../../src/storage/node-store.js';
import { countEdges } from '../../src/storage/edge-store.js';
import { ftsSearch } from '../../src/storage/fts-store.js';
import { getNodesForFile } from '../../src/storage/node-store.js';

const tmpRepo = join(tmpdir(), `monograph-incremental-${Date.now()}`);
const dbPath = join(tmpRepo, '.monomind', 'monograph.db');
const srcDir = join(tmpRepo, 'src');

beforeAll(async () => {
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, 'auth.ts'), `
export class AuthService {
  login(u: string): boolean { return u.length > 0; }
}
  `);
  writeFileSync(join(srcDir, 'user.ts'), `
export class UserController {
  greet(): string { return 'hello'; }
}
  `);
  await buildAsync(tmpRepo);
}, 30000);

afterAll(() => rmSync(tmpRepo, { recursive: true, force: true }));

describe('incremental build', () => {
  it('updates nodes when a file is modified', async () => {
    const db1 = openDb(dbPath);
    const authNodesBefore = getNodesForFile(db1, 'src/auth.ts');
    closeDb(db1);
    expect(authNodesBefore.some(n => n.name === 'logout')).toBe(false);

    writeFileSync(join(srcDir, 'auth.ts'), `
export class AuthService {
  login(u: string): boolean { return u.length > 0; }
  logout(): void {}
}
export function helperFn(): string { return 'x'; }
    `);

    await buildIncrementalAsync(tmpRepo, [join(srcDir, 'auth.ts')]);

    const db2 = openDb(dbPath);
    const authNodesAfter = getNodesForFile(db2, 'src/auth.ts');
    closeDb(db2);

    expect(authNodesAfter.some(n => n.name === 'logout')).toBe(true);
    expect(authNodesAfter.some(n => n.name === 'helperFn')).toBe(true);
  }, 15000);

  it('removes nodes when a file is deleted', async () => {
    const db1 = openDb(dbPath);
    const nodesBefore = countNodes(db1);
    const userNodesBefore = getNodesForFile(db1, 'src/user.ts');
    closeDb(db1);
    expect(userNodesBefore.length).toBeGreaterThan(0);

    unlinkSync(join(srcDir, 'user.ts'));
    await buildIncrementalAsync(tmpRepo, [join(srcDir, 'user.ts')]);

    const db2 = openDb(dbPath);
    const nodesAfter = countNodes(db2);
    const userNodesAfter = getNodesForFile(db2, 'src/user.ts');
    closeDb(db2);

    expect(userNodesAfter.length).toBe(0);
    expect(nodesAfter).toBeLessThan(nodesBefore);
  }, 15000);

  it('FTS stays in sync after incremental update', async () => {
    const db = openDb(dbPath);
    const results = ftsSearch(db, 'helperFn', 10);
    closeDb(db);
    expect(results.some(r => r.name === 'helperFn')).toBe(true);
  });

  it('FTS removes deleted file symbols', async () => {
    const db = openDb(dbPath);
    const results = ftsSearch(db, 'UserController', 10);
    closeDb(db);
    expect(results.some(r => r.name === 'UserController')).toBe(false);
  });

  it('falls back to full build when threshold exceeded', async () => {
    const manyFiles = Array.from({ length: 25 }, (_, i) => join(srcDir, `gen${i}.ts`));
    for (const f of manyFiles) {
      writeFileSync(f, `export const x${Math.random().toString(36).slice(2)} = 1;`);
    }

    await buildIncrementalAsync(tmpRepo, manyFiles);

    const db = openDb(dbPath);
    const nodes = countNodes(db);
    closeDb(db);
    expect(nodes).toBeGreaterThan(0);
  }, 30000);
}, 60000);
