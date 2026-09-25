/**
 * #338: `monograph watch` logged "rebuilding" but the graph never changed.
 *
 * These drive the real watcher + real builds against a temp project and
 * assert on the DB, not on log lines: a change must end up searchable, and a
 * change that arrives while another process holds the build lock must be
 * retried rather than dropped.
 */
import { appendFileSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAsync } from '../../src/pipeline/orchestrator.js';
import { closeDb, openDb } from '../../src/storage/db.js';
import { ftsSearch } from '../../src/storage/fts-store.js';
import { watchAsync } from '../../src/watch/watcher.js';

const tmpRepo = join(tmpdir(), `monograph-watch-rebuild-${Date.now()}`);
const dbPath = join(tmpRepo, '.monomind', 'monograph.db');
const lockPath = `${dbPath}.build-lock`;
const srcDir = join(tmpRepo, 'src');

let messages: string[] = [];
let stop: (() => Promise<void>) | undefined;

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out; progress: ${messages.join(' | ')}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function isIndexed(name: string): boolean {
  const db = openDb(dbPath);
  try {
    return ftsSearch(db, name, 10).some((r) => r.name === name);
  } finally {
    closeDb(db);
  }
}

function functionCount(): number {
  const db = openDb(dbPath);
  try {
    return (db.prepare("SELECT COUNT(*) AS n FROM nodes WHERE label = 'Function'").get() as { n: number }).n;
  } finally {
    closeDb(db);
  }
}

const updatesSeen = (): number => messages.filter((m) => m.startsWith('Graph updated')).length;

beforeAll(async () => {
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, 'a.ts'), 'export function alphaFn(): number { return 1; }\n');
  writeFileSync(join(srcDir, 'b.ts'), 'export function bravoFn(): number { return 2; }\n');
  await buildAsync(tmpRepo, { codeOnly: true });
  const w = await watchAsync(tmpRepo, {
    debounceMs: 200,
    idleTimeoutMs: 0,
    codeOnly: true,
    retryDelayMs: 200,
    onProgress: (p) => {
      if (p.phase === 'watch' && p.message) messages.push(p.message);
    },
  });
  stop = w.stop;
}, 30000);

afterAll(async () => {
  await stop?.();
  rmSync(tmpRepo, { recursive: true, force: true });
});

describe('watchAsync rebuild (#338)', () => {
  it('makes a newly added function searchable and reports the node delta', async () => {
    const before = functionCount();
    messages = [];
    appendFileSync(join(srcDir, 'a.ts'), 'export function watchAddedFn(): number { return 3; }\n');

    await waitFor(() => updatesSeen() > 0, 15000);

    expect(isIndexed('watchAddedFn')).toBe(true);
    expect(functionCount()).toBe(before + 1);
    expect(messages.find((m) => m.startsWith('Graph updated'))).toMatch(/nodes \+\d+/);
  }, 20000);

  it('retries a change that arrives while another build holds the lock, instead of dropping it', async () => {
    messages = [];
    // A live PID, so the lock is not reclaimed as stale.
    writeFileSync(lockPath, String(process.pid));
    try {
      appendFileSync(join(srcDir, 'b.ts'), 'export function lockedAddedFn(): number { return 4; }\n');
      await waitFor(() => messages.some((m) => m.includes('another build is in progress')), 15000);
      expect(isIndexed('lockedAddedFn')).toBe(false);
      expect(updatesSeen()).toBe(0);
    } finally {
      unlinkSync(lockPath);
    }

    await waitFor(() => updatesSeen() > 0, 15000);
    expect(isIndexed('lockedAddedFn')).toBe(true);
  }, 35000);

  it('removes a deleted file’s symbols', async () => {
    messages = [];
    unlinkSync(join(srcDir, 'b.ts'));

    await waitFor(() => updatesSeen() > 0, 15000);

    expect(isIndexed('bravoFn')).toBe(false);
    expect(isIndexed('alphaFn')).toBe(true);
    expect(messages.find((m) => m.startsWith('Graph updated'))).toMatch(/nodes -\d+/);
  }, 20000);
});
