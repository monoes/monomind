import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePhase } from '../../src/pipeline/phases/parse.js';
import { PipelineRunner } from '../../src/pipeline/runner.js';
import { closeDb, openDb } from '../../src/storage/db.js';
import type { PipelineContext } from '../../src/pipeline/types.js';
import type { PipelineProgress } from '../../src/types.js';

describe('pipeline progress heartbeat (#680)', () => {
  it('runner reports elapsed time when a phase finishes', async () => {
    const events: PipelineProgress[] = [];
    const runner = new PipelineRunner([
      { name: 'a', deps: [], execute: async () => 'a' },
    ]);
    await runner.run({ onProgress: (p: PipelineProgress) => events.push(p) } as PipelineContext);
    expect(events[0]).toEqual({ phase: 'a' });
    expect(events[1].phase).toBe('a');
    expect(events[1].message).toMatch(/^done in \d+(\.\d+)?s$/);
  });

  it('parse reports progress with a node count while inserting nodes', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'mg680-'));
    try {
      mkdirSync(join(repo, 'src'), { recursive: true });
      const body = Array.from({ length: 2500 }, (_, i) => `export function f${i}() {}`).join('\n');
      writeFileSync(join(repo, 'src', 'big.ts'), body);
      const db = openDb(join(repo, 'monograph.db'));
      const events: PipelineProgress[] = [];
      const ctx = {
        repoPath: repo,
        db,
        onProgress: (p: PipelineProgress) => events.push(p),
        options: { codeOnly: false, force: true, maxFileSizeBytes: 524288, ignore: [] },
      } as unknown as PipelineContext;
      const fileNodes = [{ id: 'f', label: 'File', name: 'big.ts', filePath: 'src/big.ts' }];
      await parsePhase.execute(ctx, new Map([['structure', { fileNodes }]]));
      closeDb(db);
      const inserting = events.filter((e) => /inserted \d+\/\d+ nodes/.test(e.message ?? ''));
      expect(inserting.length).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
