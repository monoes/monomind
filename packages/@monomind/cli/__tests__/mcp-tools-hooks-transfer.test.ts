/**
 * IN-7 regression: `hooks transfer` used to only *count* patterns found in
 * the source project's memory store and never wrote anything to the
 * destination project — the reported numbers were real counts of source
 * data, but nothing was actually transferred.
 *
 * This test proves patterns physically land in the destination project's
 * `.monomind/neural/patterns.json`, deduped by id via the same merge logic
 * `hooks intelligence import` uses (mergeRecordsById in utils/json-file.ts),
 * and that the reported byType counts match what was actually written.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hooksTransfer } from '../src/mcp-tools/hooks-routing.js';

describe('hooks_transfer', () => {
  let sourceDir: string;
  let destDir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    // sourcePath is validated to live under the home directory, so the
    // source fixture must be created there too.
    sourceDir = mkdtempSync(join(homedir(), '.mm-transfer-src-'));
    destDir = mkdtempSync(join(homedir(), '.mm-transfer-dest-'));
    prevCwd = process.env.MONOMIND_CWD;
    process.env.MONOMIND_CWD = destDir;
  });

  afterEach(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(destDir, { recursive: true, force: true });
    if (prevCwd === undefined) delete process.env.MONOMIND_CWD;
    else process.env.MONOMIND_CWD = prevCwd;
  });

  function writeSourcePatterns(patterns: unknown[]): void {
    const dir = join(sourceDir, '.monomind', 'neural');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'patterns.json'), JSON.stringify(patterns, null, 2));
  }

  it('reports no patterns when the source has none', async () => {
    const result = (await hooksTransfer.handler({ sourcePath: sourceDir })) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.transferred).toEqual({ total: 0, byType: {} });
    // Nothing should have been written to the destination.
    expect(existsSync(join(destDir, '.monomind', 'neural', 'patterns.json'))).toBe(false);
  });

  it('actually copies qualifying patterns into the destination, with correct type counts', async () => {
    writeSourcePatterns([
      { id: 'p1', type: 'file-pattern', confidence: 0.95, content: 'a' },
      { id: 'p2', type: 'file-pattern', confidence: 0.9, content: 'b' },
      { id: 'p3', type: 'routing', confidence: 0.8, content: 'c' },
      // Below the default 0.7 confidence threshold — must not transfer.
      { id: 'p4', type: 'file-pattern', confidence: 0.2, content: 'd' },
    ]);

    const result = (await hooksTransfer.handler({ sourcePath: sourceDir })) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.transferred).toEqual({
      total: 3,
      byType: { 'file-pattern': 2, routing: 1 },
    });

    const destPatternsPath = join(destDir, '.monomind', 'neural', 'patterns.json');
    expect(existsSync(destPatternsPath)).toBe(true);
    const written = JSON.parse(readFileSync(destPatternsPath, 'utf-8')) as Array<{ id: string }>;
    const ids = written.map((p) => p.id).sort();
    expect(ids).toEqual(['p1', 'p2', 'p3']);
  });

  it('honors the filter and minConfidence params', async () => {
    writeSourcePatterns([
      { id: 'p1', type: 'file-pattern', confidence: 0.95 },
      { id: 'p2', type: 'routing', confidence: 0.95 },
      { id: 'p3', type: 'routing', confidence: 0.5 },
    ]);

    const result = (await hooksTransfer.handler({
      sourcePath: sourceDir,
      filter: 'routing',
      minConfidence: 0.9,
    })) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.transferred).toEqual({ total: 1, byType: { routing: 1 } });
  });

  it('dedupes by id against patterns already present in the destination', async () => {
    writeSourcePatterns([
      { id: 'existing', type: 'file-pattern', confidence: 0.95 },
      { id: 'new-one', type: 'file-pattern', confidence: 0.95 },
    ]);

    const destNeuralDir = join(destDir, '.monomind', 'neural');
    mkdirSync(destNeuralDir, { recursive: true });
    writeFileSync(
      join(destNeuralDir, 'patterns.json'),
      JSON.stringify([{ id: 'existing', type: 'file-pattern', confidence: 0.5 }], null, 2),
    );

    const result = (await hooksTransfer.handler({ sourcePath: sourceDir })) as Record<string, unknown>;

    // Only the genuinely new pattern counts as "transferred".
    expect(result.transferred).toEqual({ total: 1, byType: { 'file-pattern': 1 } });

    const written = JSON.parse(readFileSync(join(destNeuralDir, 'patterns.json'), 'utf-8')) as Array<{
      id: string;
      confidence: number;
    }>;
    expect(written).toHaveLength(2);
    // The pre-existing record's own data is untouched by the merge.
    expect(written.find((p) => p.id === 'existing')?.confidence).toBe(0.5);
  });
});
