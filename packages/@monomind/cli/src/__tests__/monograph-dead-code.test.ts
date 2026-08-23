/**
 * monograph_dead_code regression tests.
 *
 * This tool shipped broken: findStaleDist() called `require('fs')` inside an
 * ESM module, so every invocation using the default categories threw
 * "require is not defined" before returning anything. Nothing caught it because
 * monograph-tools.ts (2,460 lines) had no test importing it at all.
 *
 * These tests exercise each category end-to-end against a real temp index, so
 * a module-system or SQL regression in any of the three fails here instead of
 * at a user's terminal.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { monographTools } from '../mcp-tools/monograph-tools.js';

const deadCodeTool = monographTools.find((t) => t.name === 'monograph_dead_code')!;

/** Parse the tool's MCP text payload back into an object. */
function parseResult(res: unknown): Record<string, any> {
  const content = (res as { content?: Array<{ text?: string }> }).content;
  return JSON.parse(content?.[0]?.text ?? '{}');
}

describe('monograph_dead_code', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'monograph-deadcode-'));
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  /** Create a monograph index with one File node and no inbound IMPORTS. */
  async function seedIndex() {
    const { openDb } = await import('@monoes/monograph');
    mkdirSync(join(repo, '.monomind'), { recursive: true });
    // openDb creates and migrates the schema on open.
    const db = openDb(join(repo, '.monomind', 'monograph.db'));
    db.prepare(
      'INSERT INTO nodes (id, name, label, file_path, start_line) VALUES (?, ?, ?, ?, ?)',
    ).run('n1', 'orphanThing', 'File', 'src/orphan.ts', 1);
    db.close();

    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'orphan.ts'), 'export function orphanThing() {}\n', 'utf-8');
  }

  it('reports a clear error when no index exists rather than crashing', async () => {
    const out = parseResult(await deadCodeTool.handler({ path: repo }, {} as never));
    expect(out.error).toMatch(/No monograph index found/i);
  });

  it('runs all three default categories without throwing', async () => {
    // The original bug: default categories include stale-dist, whose
    // findStaleDist() used CJS require() in an ESM module and threw.
    await seedIndex();
    const out = parseResult(await deadCodeTool.handler({ path: repo }, {} as never));
    expect(out.error).toBeUndefined();
    expect(out).toHaveProperty('dead-functions');
    expect(out).toHaveProperty('orphan-files');
    expect(out).toHaveProperty('stale-dist');
  });

  it('stale-dist runs standalone and reports no findings for a bare repo', async () => {
    await seedIndex();
    const out = parseResult(
      await deadCodeTool.handler({ path: repo, categories: ['stale-dist'] }, {} as never),
    );
    expect(out.error).toBeUndefined();
    expect(out['stale-dist']).toBeDefined();
    expect(out['stale-dist'].count).toBe(0);
  });

  it('stale-dist detects a dist/ directory with no corresponding source', async () => {
    await seedIndex();
    // dist/src/gone/ has no src/gone/ counterpart -> stale
    mkdirSync(join(repo, 'dist', 'src', 'gone'), { recursive: true });
    writeFileSync(join(repo, 'dist', 'src', 'removed.js'), '// stale build output\n', 'utf-8');

    const out = parseResult(
      await deadCodeTool.handler({ path: repo, categories: ['stale-dist'] }, {} as never),
    );
    expect(out.error).toBeUndefined();
    expect(out['stale-dist'].count).toBeGreaterThan(0);
  });

  it('orphan-files runs standalone and returns a well-formed shape', async () => {
    await seedIndex();
    const out = parseResult(
      await deadCodeTool.handler({ path: repo, categories: ['orphan-files'] }, {} as never),
    );
    expect(out.error).toBeUndefined();
    expect(out['orphan-files']).toHaveProperty('count');
    expect(Array.isArray(out['orphan-files'].candidates)).toBe(true);
  });

  it('dead-functions runs standalone and returns a well-formed shape', async () => {
    await seedIndex();
    const out = parseResult(
      await deadCodeTool.handler({ path: repo, categories: ['dead-functions'] }, {} as never),
    );
    expect(out.error).toBeUndefined();
    expect(out['dead-functions']).toHaveProperty('count');
    expect(Array.isArray(out['dead-functions'].candidates)).toBe(true);
  });
});
