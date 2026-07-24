import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { vi } from 'vitest';

// Regression (issue #40 follow-up): a phase crashing mid-build used to leave
// the DB in a stale, partially-rebuilt state — earlier phases' writes
// (autocommitted by better-sqlite3 outside an explicit transaction) stayed
// committed even though the build as a whole failed, and a subsequent build
// attempt would skip re-scanning cache-hit files, permanently under-counting
// the index until a hard cache clear. The build is now wrapped in one SQL
// transaction spanning the whole pipeline run, rolled back on any failure.
vi.mock('../../src/pipeline/phases/god-nodes.js', () => ({
  godNodesPhase: {
    name: 'god-nodes',
    deps: ['cross-file'],
    execute: async () => { throw new Error('simulated late-stage phase crash'); },
  },
}));

const tmpRepo = join(tmpdir(), `monograph-atomicity-${Date.now()}`);

beforeAll(() => {
  mkdirSync(join(tmpRepo, 'src'), { recursive: true });
  writeFileSync(join(tmpRepo, 'src', 'greeter.ts'), `
export interface Greeter {
  greet(name: string): string;
}
export class GreeterImpl implements Greeter {
  greet(name: string): string {
    return 'hello ' + name;
  }
}
  `);
});

afterAll(() => rmSync(tmpRepo, { recursive: true, force: true }));

describe('build atomicity — a phase crash rolls back the whole build', () => {
  it('leaves zero nodes/edges after a mid-build crash, instead of a partial write', async () => {
    const { buildAsync } = await import('../../src/pipeline/orchestrator.js');
    await expect(buildAsync(tmpRepo)).rejects.toThrow(/simulated late-stage phase crash/);

    const dbPath = join(tmpRepo, '.monomind', 'monograph.db');
    expect(existsSync(dbPath)).toBe(true);

    const { openDb, closeDb } = await import('../../src/storage/db.js');
    const { countNodes } = await import('../../src/storage/node-store.js');
    const { countEdges } = await import('../../src/storage/edge-store.js');
    const db = openDb(dbPath);
    try {
      // parse/cross-file/etc. all ran and wrote real rows before god-nodes
      // threw — without the transaction wrap, those writes would be
      // committed already. With it, the whole attempt rolls back to empty.
      expect(countNodes(db)).toBe(0);
      expect(countEdges(db)).toBe(0);
    } finally {
      closeDb(db);
    }
  }, 30000);
});
