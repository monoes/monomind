import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readManifest } from '../../pipeline/manifest.js';
import { buildAsync } from '../../pipeline/orchestrator.js';
import { SYMBOL_ID_VERSION } from '../../types.js';

describe('index manifest', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'manifest-'));
    writeFileSync(join(tmpDir, 'a.ts'), '/** Adds. */\nexport function add() { return 1; }\n');
  });

  afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('records what the build produced and counts up per build', async () => {
    await buildAsync(tmpDir, { codeOnly: true, force: true });
    const open = () => new Database(join(tmpDir, '.monomind', 'monograph.db'), { readonly: true });
    let db = open();
    const first = readManifest(db);
    db.close();
    expect(first).toMatchObject({ generation: 1, scope: 'code', identityVersion: SYMBOL_ID_VERSION });
    expect(first?.nodes.Function).toBeGreaterThan(0);
    expect(first?.summarized).toBeGreaterThan(0);
    expect(first?.edges.CONTAINS).toBeGreaterThan(0);

    await buildAsync(tmpDir, { codeOnly: true, force: true });
    db = open();
    expect(readManifest(db)?.generation).toBe(2);
    db.close();
  }, 60_000);

  it('is null for an index that predates it', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    expect(readManifest(db as never)).toBeNull();
  });
});
