/**
 * Second Brain item 4b-i — reconcile the document index against the filesystem.
 *
 * THE DEFECT
 * ----------
 * `removeDocument` only tombstones metadata, and nothing has ever reconciled the
 * index against the filesystem. Delete a file and its chunks stay searchable
 * forever. Measured on this repo's own store 2026-07-28:
 *
 *   live index entries        257
 *     real doc, file present  146   <- the genuinely valid corpus
 *     real doc, file DELETED   15   <- incl. docs/concepts/memory.md
 *     `._` junk, file present   2
 *     `._` junk, file DELETED  94   <- predate the walk guard
 *
 * 109 of 257 entries (42.4%) have no file behind them. The Second Brain answers
 * questions from documents the user deleted — one of which is the memory
 * concept doc.
 *
 * The 94 `._` AppleDouble entries predate the walk's dotfile guard
 * (document-pipeline.ts:385, added 3e429194 on 2026-07-19). That guard works;
 * it simply never applied retroactively. Do NOT re-add it — see
 * `rejects AppleDouble files at the ingestDocument boundary` below for the hole
 * that IS still open.
 *
 * WHY THIS IS THE MOST DANGEROUS ITEM ON THE BOARD
 * -----------------------------------------------
 * "Delete index entries when the file is missing" has the exact shape of the
 * near-miss recorded earlier this cycle: a gitignore-based exclusion rule that
 * was elegant, zero-heuristic, covered 92.4% of its target, and would have
 * silently destroyed 148 of 257 live documents — the entire research library
 * and the plan being executed — because this repo gitignores `docs/` broadly.
 * It was caught only by running it against the whole corpus instead of against
 * the cases that motivated it.
 *
 * A missing file is not necessarily a deleted file. It is also an unmounted
 * volume, a checked-out branch, a partial clone, or a permissions failure. This
 * suite exists to make the safe reading the only reachable one.
 *
 * TWO GUARDS TESTED AND REJECTED BEFORE WRITING THIS
 * -------------------------------------------------
 * 1. "Abort if >50% of entries are missing." Useless here: the real, legitimate
 *    missing fraction is 42.4%, so the threshold never fires in the one case we
 *    have. A threshold tuned to fire on this data would be fitted to it.
 * 2. "Only reconcile when the parent directory still exists." Also useless:
 *    83 of the 109 missing files have a live parent, but 26 do not because
 *    whole directories (`docs/concepts`, `docs/adrs`, `docs/commands`) were
 *    legitimately deleted. A deleted directory and an unmounted volume are
 *    indistinguishable at the parent-dir level.
 *
 * What actually discriminates is the ROOT: if the project root is intact and
 * readable, the tree is genuinely present and a missing file is genuinely gone.
 * If the root is missing, everything below it is unknowable and nothing may be
 * removed. That is the contract below.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_GLOBAL = process.env.MONOMIND_GLOBAL_BRAIN_DIR;
let ROOT = '';

beforeEach(() => {
  ROOT = fs.mkdtempSync(join(os.tmpdir(), 'mm-reconcile-'));
  fs.mkdirSync(join(ROOT, '.monomind', 'knowledge'), { recursive: true });
  process.env.MONOMIND_GLOBAL_BRAIN_DIR = join(ROOT, 'global-brain');
  process.chdir(ROOT);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  if (ORIGINAL_GLOBAL === undefined) delete process.env.MONOMIND_GLOBAL_BRAIN_DIR;
  else process.env.MONOMIND_GLOBAL_BRAIN_DIR = ORIGINAL_GLOBAL;
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/** Append a metadata record describing an indexed document. */
function indexRecord(filePath: string, contentHash: string, chunkCount = 3, scope = 'shared') {
  fs.appendFileSync(
    join(ROOT, '.monomind', 'knowledge', 'doc-metadata.jsonl'),
    `${JSON.stringify({ filePath, scope, contentHash, chunkCount })}\n`,
    'utf-8',
  );
}

/** Create a real file on disk AND index it. */
function presentDoc(rel: string, hash: string) {
  const full = join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `# ${rel}\n\nreal content\n`, 'utf-8');
  indexRecord(full, hash);
  return full;
}

/** Index a document whose file does NOT exist. */
function missingDoc(rel: string, hash: string) {
  const full = join(ROOT, rel);
  indexRecord(full, hash);
  return full;
}

describe('4b-i — reconcileIndex is a dry run by default', () => {
  it('reports what it would remove without removing anything', async () => {
    const { reconcileIndex, listDocuments } = await import('../knowledge/document-pipeline.js');
    presentDoc('docs/alive.md', 'h-alive');
    missingDoc('docs/deleted.md', 'h-deleted');

    const report = await reconcileIndex(ROOT, { scope: 'shared' });

    expect(report.missing.map((m: { filePath: string }) => path.basename(m.filePath))).toEqual([
      'deleted.md',
    ]);
    expect(report.applied).toBe(false);
    // Nothing removed — a reconcile that deletes before you asked is not a report.
    expect(listDocuments(ROOT, 'shared')).toHaveLength(2);
  });

  it('removes only when explicitly applied', async () => {
    const { reconcileIndex, listDocuments } = await import('../knowledge/document-pipeline.js');
    presentDoc('docs/alive.md', 'h-alive');
    missingDoc('docs/deleted.md', 'h-deleted');

    const report = await reconcileIndex(ROOT, { scope: 'shared', apply: true });

    expect(report.applied).toBe(true);
    expect(report.removed).toBe(1);
    const left = listDocuments(ROOT, 'shared');
    expect(left).toHaveLength(1);
    expect(path.basename(left[0].filePath)).toBe('alive.md');
  });

  it('never removes an entry whose file is present', async () => {
    const { reconcileIndex, listDocuments } = await import('../knowledge/document-pipeline.js');
    for (let i = 0; i < 5; i++) presentDoc(`docs/keep-${i}.md`, `h-${i}`);

    const report = await reconcileIndex(ROOT, { scope: 'shared', apply: true });

    expect(report.removed).toBe(0);
    expect(listDocuments(ROOT, 'shared')).toHaveLength(5);
  });
});

describe('4b-i — the unmounted-volume / missing-root guard', () => {
  it('REFUSES to reconcile when the project root does not exist', async () => {
    const { reconcileIndex } = await import('../knowledge/document-pipeline.js');
    const ghost = join(os.tmpdir(), 'mm-reconcile-nonexistent-root-xyz');

    // Every file under a missing root looks "deleted". This is the unmounted
    // volume case and it must abort, not reconcile.
    await expect(reconcileIndex(ghost, { scope: 'shared', apply: true })).rejects.toThrow();
  });

  it('REFUSES when the root exists but is an empty shell — no metadata log', async () => {
    const { reconcileIndex } = await import('../knowledge/document-pipeline.js');
    const bare = fs.mkdtempSync(join(os.tmpdir(), 'mm-reconcile-bare-'));
    try {
      // "No metadata" must not read as "everything is stale" — the same
      // distinction hasKnowledgeMetadata() already draws for superseded filtering.
      await expect(reconcileIndex(bare, { scope: 'shared', apply: true })).rejects.toThrow();
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it('does NOT rely on a missing-fraction threshold', async () => {
    const { reconcileIndex } = await import('../knowledge/document-pipeline.js');
    // Real data: 42.4% of entries were legitimately missing. Any threshold that
    // would have blocked this reconcile is fitted to nothing. With an intact
    // root, a high missing fraction is a fact about the corpus, not a red flag.
    presentDoc('docs/alive.md', 'h-alive');
    for (let i = 0; i < 9; i++) missingDoc(`docs/gone-${i}.md`, `h-gone-${i}`);

    const report = await reconcileIndex(ROOT, { scope: 'shared', apply: true });

    expect(report.removed).toBe(9); // 90% missing, intact root, proceed
  });

  it('reconciles entries whose whole parent directory was deleted', async () => {
    const { reconcileIndex } = await import('../knowledge/document-pipeline.js');
    // 26 of the 109 real missing entries had no parent dir, because
    // docs/concepts, docs/adrs and docs/commands were deleted wholesale. A
    // parent-dir-exists guard would have permanently stranded those entries.
    presentDoc('docs/alive.md', 'h-alive');
    missingDoc('docs/concepts/memory.md', 'h-mem'); // docs/concepts never created
    missingDoc('docs/concepts/hooks.md', 'h-hooks');

    const report = await reconcileIndex(ROOT, { scope: 'shared', apply: true });

    expect(report.removed).toBe(2);
  });
});

describe('4b-i — reconcile is reversible and never silent', () => {
  it('archives removed entries before dropping them', async () => {
    const { reconcileIndex } = await import('../knowledge/document-pipeline.js');
    missingDoc('docs/deleted.md', 'h-deleted');

    const report = await reconcileIndex(ROOT, { scope: 'shared', apply: true });

    // Same precondition as the delete path: nothing is destroyed without a
    // recoverable copy written first, and it happens inside the operation so no
    // caller can bypass it by forgetting.
    expect(report.archivePath).toBeTruthy();
    expect(fs.existsSync(report.archivePath!)).toBe(true);
  });

  it('does not run implicitly as part of an ingest', async () => {
    const { ingestDocument, listDocuments } = await import('../knowledge/document-pipeline.js');
    presentDoc('docs/alive.md', 'h-alive');
    missingDoc('docs/deleted.md', 'h-deleted');

    await ingestDocument(join(ROOT, 'docs/alive.md'), 'shared', ROOT);

    // Reconciliation is destructive; it belongs behind a deliberate pass, never
    // as a side effect of an unrelated operation.
    expect(listDocuments(ROOT, 'shared').length).toBeGreaterThanOrEqual(2);
  });
});

describe('4b-i — the ingestDocument boundary guard', () => {
  it('rejects AppleDouble files at the ingestDocument boundary, not only in the walk', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    // The walk guard (document-pipeline.ts:385) works and must NOT be
    // duplicated. But two `._` files are indexed in the real store despite it —
    // including the resource fork of the Second Brain plan itself — so a second
    // ingest path reaches ingestDocument directly. That is the open hole.
    const fork = join(ROOT, 'docs', '._notes.md');
    fs.mkdirSync(path.dirname(fork), { recursive: true });
    fs.writeFileSync(fork, 'Mac OS X  binary resource fork junk', 'utf-8');

    const result = await ingestDocument(fork, 'shared', ROOT);

    expect(result.skipped).toBe(true);
    expect(result.chunksIndexed).toBe(0);
    expect(String(result.error)).toMatch(/resource fork|AppleDouble|dotfile/i);
  });

  it('does not reject a legitimate file merely for containing "._"', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    // Guard on the BASENAME PREFIX, not a substring anywhere in the path.
    const ok = join(ROOT, 'docs', 'v1._2-release.md');
    fs.mkdirSync(path.dirname(ok), { recursive: true });
    fs.writeFileSync(ok, '# Release notes\n\nreal content worth indexing\n', 'utf-8');

    const result = await ingestDocument(ok, 'shared', ROOT);

    expect(result.skipped).toBeFalsy();
    expect(result.chunksIndexed).toBeGreaterThan(0);
  });

  it('does not reject a file inside a directory whose name starts with a dot', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    // `.monodesign` critique snapshots are deliberately surfaced in the Second
    // Brain (the walk carves out an exception for exactly this). A boundary
    // guard that rejected on any dot-segment in the path would silently undo it.
    const snap = join(ROOT, '.monodesign', 'snapshots', 'home.md');
    fs.mkdirSync(path.dirname(snap), { recursive: true });
    fs.writeFileSync(snap, '# Critique\n\nreal design critique content\n', 'utf-8');

    const result = await ingestDocument(snap, 'shared', ROOT);

    expect(result.skipped).toBeFalsy();
  });
});
