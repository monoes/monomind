import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '@monoes/monograph';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkMonographSemantic,
  readToolAssetsSetting,
} from '../commands/doctor-monograph-checks.js';

describe('checkMonographSemantic', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'doctor-semantic-'));
    mkdirSync(join(dir, '.monomind'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** A graph with `total` summaries, `embedded` of which have a vector. */
  function graph(total: number, embedded: number): void {
    const db = openDb(join(dir, '.monomind', 'monograph.db'));
    for (let i = 0; i < total; i++) {
      db.prepare('INSERT INTO node_summaries_fts (node_id, text) VALUES (?, ?)').run(
        `n${i}`,
        `text ${i}`,
      );
      if (i < embedded)
        db.prepare('INSERT INTO node_embeddings (node_id, text_hash, vec) VALUES (?, ?, ?)').run(
          `n${i}`,
          'h',
          Buffer.alloc(4),
        );
    }
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('embedding_model', 'toy')").run();
    db.close();
  }

  it('passes quietly when there is no graph yet', async () => {
    expect((await checkMonographSemantic(dir)).status).toBe('pass');
  });

  it('warns that an index built before summaries existed is keyword only', async () => {
    graph(0, 0);
    const r = await checkMonographSemantic(dir);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('no symbol summaries');
  });

  it('passes when everything is embedded', async () => {
    graph(3, 3);
    const r = await checkMonographSemantic(dir);
    expect(r).toMatchObject({ status: 'pass', message: '3/3 summaries embedded (toy)' });
  });

  it('points at download-embeddings when the model is missing', async () => {
    graph(3, 0);
    const r = await checkMonographSemantic(dir, async () => false);
    expect(r.status).toBe('warn');
    expect(r.fix).toBe('monomind download-embeddings');
  });

  it('points at monograph embed when the model is there but vectors are missing', async () => {
    graph(3, 1);
    const r = await checkMonographSemantic(dir, async () => true);
    expect(r.status).toBe('warn');
    expect(r.fix).toBe('monomind monograph embed');
    expect(r.message).toContain('1/3');
  });
});

describe('readToolAssetsSetting', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'doctor-toolassets-'));
    mkdirSync(join(dir, '.monomind'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is null without a graph, off by default and on once recorded', () => {
    expect(readToolAssetsSetting(dir)).toBeNull();
    openDb(join(dir, '.monomind', 'monograph.db')).close();
    expect(readToolAssetsSetting(dir)).toBe(false);
    const db = openDb(join(dir, '.monomind', 'monograph.db'));
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('tool_assets', '1')").run();
    db.close();
    expect(readToolAssetsSetting(dir)).toBe(true);
  });
});
