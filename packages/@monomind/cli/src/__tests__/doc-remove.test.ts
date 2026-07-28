/**
 * `monomind doc remove` — the Second Brain can finally forget.
 *
 * Two regressions guarded here:
 *
 * 1. `removeDocument` shipped with zero callers. There was no CLI or MCP way to
 *    un-ingest a document; a stale doc polluted search forever.
 *
 * 2. Removal of the LAST document was a no-op. `isSupersededKey` treated an
 *    empty live-hash set as "no metadata, cannot judge, filter nothing" — so
 *    once the only document was tombstoned, its chunks came straight back in
 *    search results. `hasKnowledgeMetadata` now separates "log missing" from
 *    "log exists and everything was removed".
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
  ROOT = fs.mkdtempSync(join(os.tmpdir(), 'mm-doc-remove-'));
  fs.mkdirSync(join(ROOT, '.monomind'), { recursive: true });
  process.env.MONOMIND_GLOBAL_BRAIN_DIR = join(ROOT, 'global-brain');
  delete process.env.MONOMIND_CWD;
  process.chdir(ROOT);
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
  if (ORIGINAL_GLOBAL === undefined) delete process.env.MONOMIND_GLOBAL_BRAIN_DIR;
  else process.env.MONOMIND_GLOBAL_BRAIN_DIR = ORIGINAL_GLOBAL;
  if (ORIGINAL_MM_CWD !== undefined) process.env.MONOMIND_CWD = ORIGINAL_MM_CWD;
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
});

const sub = (name: string): Command => {
  const cmd = docCommand.subcommands?.find(c => c.name === name);
  if (!cmd) throw new Error(`doc ${name} subcommand is not registered`);
  return cmd;
};

const ctx = (args: string[], flags: Record<string, unknown> = {}): CommandContext =>
  ({ args, flags: { _: args, ...flags } as CommandContext['flags'], cwd: ROOT, interactive: false });

const run = async (name: string, args: string[], flags: Record<string, unknown> = {}): Promise<CommandResult> => {
  const result = await sub(name).action!(ctx(args, flags));
  if (!result) throw new Error(`doc ${name} returned no CommandResult`);
  return result;
};

describe('superseded filtering distinguishes "no metadata" from "all removed"', () => {
  it('keeps chunks when no metadata log exists', async () => {
    const { isSupersededKey } = await import('../knowledge/document-pipeline.js');
    // metadataPresent=false — we cannot judge, so nothing is stale.
    expect(isSupersededKey('doc:aaa:0', new Set(), false)).toBe(false);
  });

  it('drops every chunk when the log exists and nothing is live', async () => {
    const { isSupersededKey } = await import('../knowledge/document-pipeline.js');
    // This is the case that used to leak: the last document was removed.
    expect(isSupersededKey('doc:aaa:0', new Set(), true)).toBe(true);
  });

  it('leaves non-document keys alone either way', async () => {
    const { isSupersededKey } = await import('../knowledge/document-pipeline.js');
    expect(isSupersededKey('pattern:aaa', new Set(), true)).toBe(false);
    expect(isSupersededKey('rules:x', new Set(['b']), true)).toBe(false);
  });

  it('defaults to the old two-argument behaviour for existing callers', async () => {
    const { isSupersededKey } = await import('../knowledge/document-pipeline.js');
    expect(isSupersededKey('doc:aaa:0', new Set())).toBe(false);
    expect(isSupersededKey('doc:aaa:0', new Set(['bbb']))).toBe(true);
  });

  it('reports metadata presence from disk without creating the directory', async () => {
    const { hasKnowledgeMetadata } = await import('../knowledge/document-pipeline.js');
    const empty = join(ROOT, 'no-brain-here');
    fs.mkdirSync(empty, { recursive: true });
    expect(hasKnowledgeMetadata(empty)).toBe(false);
    expect(fs.existsSync(join(empty, '.monomind'))).toBe(false);
  });
});

describe('doc remove', () => {
  it('is registered as a doc subcommand', () => {
    expect(docCommand.subcommands?.map(c => c.name)).toContain('remove');
  });

  it('fails without a document path', async () => {
    const result = await run('remove', []);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('fails on a path that was never indexed, instead of writing a dud tombstone', async () => {
    const result = await run('remove', [join(ROOT, 'never-ingested.md')]);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('drops the document from doc list', async () => {
    const { listDocuments } = await import('../knowledge/document-pipeline.js');
    const keep = join(ROOT, 'keep.md');
    const drop = join(ROOT, 'drop.md');
    fs.writeFileSync(keep, 'Widget calibration procedure and tolerances.\n');
    fs.writeFileSync(drop, 'Obsolete sprocket rotation guidance, superseded.\n');
    await run('ingest', [keep]);
    await run('ingest', [drop]);
    expect(listDocuments(ROOT, 'shared').map(d => d.filePath).sort()).toEqual([drop, keep]);

    const result = await run('remove', [drop]);
    expect(result.success).toBe(true);
    expect(listDocuments(ROOT, 'shared').map(d => d.filePath)).toEqual([keep]);
  });

  // The regression: with `keep.md` also gone the live set is empty, which used
  // to disable filtering entirely and resurrect both documents.
  it('keeps the brain empty after the last document is removed', async () => {
    const { listDocuments, liveContentHashes, hasKnowledgeMetadata, isSupersededKey } =
      await import('../knowledge/document-pipeline.js');
    const keep = join(ROOT, 'keep.md');

    await run('remove', [keep]);
    expect(listDocuments(ROOT, 'shared')).toEqual([]);

    const live = liveContentHashes(ROOT);
    expect(live.size).toBe(0);
    expect(hasKnowledgeMetadata(ROOT)).toBe(true);
    // Every surviving chunk of every removed document is now filtered out.
    expect(isSupersededKey('doc:anything:0', live, hasKnowledgeMetadata(ROOT))).toBe(true);
  });
});
