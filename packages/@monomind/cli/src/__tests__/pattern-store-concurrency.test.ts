/**
 * Several OS processes writing one pattern store at once — the hook-process
 * scenario that motivated the SQLite store. Each child is a real `node`
 * process (TS via tsx) started against the same temp project directory and
 * released at the same instant.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openSqlitePatternStore } from '../memory/intelligence-sqlite-store.js';

const require = createRequire(import.meta.url);
const TSX = require.resolve('tsx');
const memDir = fileURLToPath(new URL('../memory/', import.meta.url));
const WRITERS = 6;
const PER_WRITER = 40;

const CHILD = `
import { pathToFileURL } from 'node:url';
const [impl, neural, writer, perWriter, startAt, memDir] = process.argv.slice(2);
const mod = (f) => import(pathToFileURL(memDir + f).href);
const store = impl === 'sqlite'
  ? (await mod('intelligence-sqlite-store.ts')).openSqlitePatternStore(neural, 100000)
  : new (await mod('intelligence-reasoning-bank.ts')).LocalReasoningBank({ maxSize: 100000 });
if (!store) process.exit(3);
while (Date.now() < Number(startAt)) { /* release every writer together */ }
for (let i = 0; i < Number(perWriter); i++) {
  store.store({ id: 'w' + writer + '-' + i, type: 'action', content: 'x', confidence: 0.5, embedding: [i, 1] });
  store.recordUsage('shared');
  if (impl === 'json') store.flushToDisk();
}
if (impl === 'sqlite') store.close(); else store.flushToDisk();
`;

function runWriters(impl: 'sqlite' | 'json', dir: string, neural: string, script: string) {
  const startAt = Date.now() + 4000; // tsx start-up varies; release together
  return Promise.all(
    Array.from(
      { length: WRITERS },
      (_, w) =>
        new Promise<number>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              '--import',
              TSX,
              script,
              impl,
              neural,
              String(w),
              String(PER_WRITER),
              String(startAt),
              memDir,
            ],
            { env: { ...process.env, MONOMIND_CWD: dir }, stdio: ['ignore', 'ignore', 'pipe'] },
          );
          let err = '';
          child.stderr.on('data', (d) => (err += d));
          child.on('error', reject);
          child.on('exit', (code) =>
            code === 0 ? resolve(code) : reject(new Error(`writer ${w}: ${code} ${err}`)),
          );
        }),
    ),
  );
}

describe('pattern store with several concurrent writer processes', () => {
  let dir: string;
  let neural: string;
  let script: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mm-pconc-'));
    neural = join(dir, '.monomind', 'neural');
    mkdirSync(neural, { recursive: true });
    script = join(dir, 'writer.mjs');
    writeFileSync(script, CHILD);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('sqlite: no pattern and no usage increment is lost', { timeout: 120_000 }, async () => {
    const seed = openSqlitePatternStore(neural, 100000);
    seed?.store({ id: 'shared', type: 'action', content: 's', confidence: 0.5, embedding: [1, 1] });
    seed?.close();

    await runWriters('sqlite', dir, neural, script);

    const s = openSqlitePatternStore(neural, 100000);
    if (!s) throw new Error('better-sqlite3 unavailable');
    const ids = new Set(s.getAll().map((p) => p.id));
    for (let w = 0; w < WRITERS; w++) {
      for (let i = 0; i < PER_WRITER; i++) expect(ids.has(`w${w}-${i}`)).toBe(true);
    }
    expect(ids.size).toBe(WRITERS * PER_WRITER + 1);
    expect(s.get('shared')?.usageCount).toBe(WRITERS * PER_WRITER);
    s.close();
  });

  it('sqlite: concurrent first opens import a legacy patterns.json exactly once', {
    timeout: 120_000,
  }, async () => {
    const legacy = Array.from({ length: 25 }, (_, i) => ({
      id: `legacy-${i}`,
      type: 'action',
      content: 'old',
      confidence: 0.4,
      embedding: [1, 0],
    }));
    writeFileSync(join(neural, 'patterns.json'), JSON.stringify(legacy));

    await runWriters('sqlite', dir, neural, script);

    const s = openSqlitePatternStore(neural, 100000);
    if (!s) throw new Error('better-sqlite3 unavailable');
    const all = s.getAll();
    expect(all.filter((p) => p.id.startsWith('legacy-'))).toHaveLength(25);
    expect(all.filter((p) => p.id.startsWith('legacy-')).every((p) => p.usageCount === 0)).toBe(
      true,
    );
    s.close();
    const files = readdirSync(neural);
    expect(files).toContain('patterns.json.imported');
    expect(files).not.toContain('patterns.json');
    expect(files.filter((f) => f.startsWith('patterns.json.imported'))).toHaveLength(1);
  });

  it('json: the file stays a valid pattern array under concurrent writers', {
    timeout: 120_000,
  }, async () => {
    await runWriters('json', dir, neural, script);
    const data = JSON.parse(readFileSync(join(neural, 'patterns.json'), 'utf-8')) as {
      id: string;
    }[];
    expect(Array.isArray(data)).toBe(true);
    // The JSON store's lock + merge is best-effort; it is not expected to keep
    // every write (the reason the SQLite store exists), only to stay readable.
    expect(data.length).toBeGreaterThan(0);
  });
});
