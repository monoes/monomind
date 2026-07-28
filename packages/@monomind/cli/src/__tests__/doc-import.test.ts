/**
 * `monomind doc import` — the OKF bundle round-trip.
 *
 * Regression guard: `importFromOKF` shipped with zero callers, and
 * /mastermind:okf-import told users to run `doc ingest <bundle_dir>` instead.
 * Plain ingest indexes the bundle's own `index.md` manifest as if it were
 * knowledge — the exact file importFromOKF exists to skip. Export was
 * effectively one-way.
 *
 * Runs against a throwaway store: chdir into a temp dir plus
 * MONOMIND_GLOBAL_BRAIN_DIR, so the user's real Second Brain is never touched.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { docCommand } from '../commands/doc.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_GLOBAL = process.env.MONOMIND_GLOBAL_BRAIN_DIR;
const ORIGINAL_MM_CWD = process.env.MONOMIND_CWD;
let ROOT = '';

beforeAll(() => {
  ROOT = fs.mkdtempSync(join(os.tmpdir(), 'mm-doc-import-'));
  fs.mkdirSync(join(ROOT, '.monomind'), { recursive: true });
  process.env.MONOMIND_GLOBAL_BRAIN_DIR = join(ROOT, 'global-brain');
  delete process.env.MONOMIND_CWD; // must not point the store at the real project
  process.chdir(ROOT);
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
  if (ORIGINAL_GLOBAL === undefined) delete process.env.MONOMIND_GLOBAL_BRAIN_DIR;
  else process.env.MONOMIND_GLOBAL_BRAIN_DIR = ORIGINAL_GLOBAL;
  if (ORIGINAL_MM_CWD !== undefined) process.env.MONOMIND_CWD = ORIGINAL_MM_CWD;
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
});

const importCmd = (): Command => {
  const cmd = docCommand.subcommands?.find(c => c.name === 'import');
  if (!cmd) throw new Error('doc import subcommand is not registered');
  return cmd;
};

const ctx = (args: string[], flags: Record<string, unknown> = {}): CommandContext =>
  ({ args, flags: { _: args, ...flags } as CommandContext['flags'], cwd: ROOT, interactive: false });

/** CommandAction may return void; every path in `doc import` returns a result. */
const run = async (args: string[], flags: Record<string, unknown> = {}): Promise<CommandResult> => {
  const result = await importCmd().action!(ctx(args, flags));
  if (!result) throw new Error('doc import returned no CommandResult');
  return result;
};

describe('doc import', () => {
  it('is registered as a doc subcommand', () => {
    expect(docCommand.subcommands?.map(c => c.name)).toContain('import');
  });

  it('fails without a bundle directory', async () => {
    const result = await run([]);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('fails when the path is not a directory', async () => {
    const file = join(ROOT, 'not-a-bundle.md');
    fs.writeFileSync(file, '# hi\n');
    const result = await run([file]);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('fails when the path does not exist', async () => {
    const result = await run([join(ROOT, "nope")]);
    expect(result.success).toBe(false);
  });

  // The point of the whole change: index.md and log.md are bundle bookkeeping,
  // not knowledge. `doc ingest` would have indexed both.
  it('skips the bundle manifest and log, importing only real documents', async () => {
    const bundle = join(ROOT, 'bundle');
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(join(bundle, 'index.md'), '# Knowledge Bundle\n\n* [a](alpha.md) - a.md (1 chunks)\n');
    fs.writeFileSync(join(bundle, 'log.md'), '# Log\n\nexported 2026-07-28\n');
    fs.writeFileSync(join(bundle, 'alpha.md'), '---\ntitle: alpha\n---\n\nAlpha document body about widget calibration.\n');
    fs.writeFileSync(join(bundle, 'beta.md'), '---\ntitle: beta\n---\n\nBeta document body about sprocket tolerances.\n');

    const result = await run([bundle]);
    expect(result.success).toBe(true);

    const data = result.data as { filesProcessed: number; results: Array<{ filePath: string }> };
    const imported = data.results.map(r => r.filePath.split(/[\\/]/).pop());
    expect(imported.sort()).toEqual(['alpha.md', 'beta.md']);
    expect(imported).not.toContain('index.md');
    expect(imported).not.toContain('log.md');
  });

  it('records imported documents under the requested scope', async () => {
    const { listDocuments } = await import('../knowledge/document-pipeline.js');
    const docs = listDocuments(ROOT, 'shared');
    expect(docs.map(d => d.filePath.split(/[\\/]/).pop()).sort()).toEqual(['alpha.md', 'beta.md']);
  });
});
