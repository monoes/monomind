/**
 * Deliberate-violation test for item 4b-i (reconcileIndex + isResourceFork).
 *
 * WHY THIS EXISTS: a guard whose only evidence of working is that it has never
 * complained is in the same "unverified" class as the network guard that
 * reported "0 attempts" while blocking nothing. These tests inject KNOWN
 * violations and prove the guard FIRES, then prove reconcile CLEANS.
 *
 * Named command that produced the 259→148 live-store cleanup:
 *   `node packages/@monomind/cli/bin/cli.js doc reconcile --apply`
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Dynamic imports — document-pipeline is ESM
const loadPipeline = async () => import('../knowledge/document-pipeline.js');

describe('item 4b-i — deliberate violation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-test-'));
    // Create the knowledge metadata directory
    const metaDir = path.join(tmpDir, '.monomind', 'knowledge');
    fs.mkdirSync(metaDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('isResourceFork rejects AppleDouble sidecars at any depth', async () => {
    const { isResourceFork } = await loadPipeline();
    // MUST reject
    expect(isResourceFork('/project/._README.md')).toBe(true);
    expect(isResourceFork('/project/sub/dir/._file.md')).toBe(true);
    expect(isResourceFork('._bare.md')).toBe(true);
    // MUST accept (not forks)
    expect(isResourceFork('/project/README.md')).toBe(false);
    expect(isResourceFork('/project/v1._2-release.md')).toBe(false);
    expect(isResourceFork('/project/.monodesign/snapshot.md')).toBe(false);
  });

  it('reconcileIndex detects an injected ghost and removes it on --apply', async () => {
    const { reconcileIndex } = await loadPipeline();

    // Create a real file so the root is not empty
    const realFile = path.join(tmpDir, 'real-doc.md');
    fs.writeFileSync(realFile, '# Real document\nThis exists on disk.');

    // Seed metadata with one real entry and one ghost
    const metaPath = path.join(tmpDir, '.monomind', 'knowledge', 'doc-metadata.jsonl');
    const realEntry = JSON.stringify({
      filePath: realFile,
      scope: 'shared',
      contentHash: 'aaa',
      chunkCount: 3,
      indexedAt: new Date().toISOString(),
      size: 100,
    });
    const ghostFile = path.join(tmpDir, 'this-file-does-not-exist.md');
    const ghostEntry = JSON.stringify({
      filePath: ghostFile,
      scope: 'shared',
      contentHash: 'bbb',
      chunkCount: 5,
      indexedAt: new Date().toISOString(),
      size: 200,
    });
    fs.writeFileSync(metaPath, `${realEntry}\n${ghostEntry}\n`);

    // DRY RUN — ghost is detected, nothing changed
    const dryReport = await reconcileIndex(tmpDir, { scope: 'shared', apply: false });
    expect(dryReport.missing.length).toBe(1);
    expect(dryReport.missing[0].filePath).toBe(ghostFile);
    expect(dryReport.applied).toBe(false);
    expect(dryReport.removed).toBe(0);

    // APPLY — ghost is tombstoned
    const applyReport = await reconcileIndex(tmpDir, { scope: 'shared', apply: true });
    expect(applyReport.missing.length).toBe(1);
    expect(applyReport.applied).toBe(true);
    expect(applyReport.removed).toBe(1);
    expect(applyReport.archivePath).toBeDefined();
    // Archive file must exist and contain the ghost
    const archive = fs.readFileSync(applyReport.archivePath!, 'utf-8');
    expect(archive).toContain(ghostFile);

    // RE-RUN — index is now clean
    const cleanReport = await reconcileIndex(tmpDir, { scope: 'shared', apply: false });
    expect(cleanReport.missing.length).toBe(0);
    expect(cleanReport.scanned).toBe(1); // only the real entry survives
  });

  it('reconcileIndex refuses to run against a missing root (unmounted volume guard)', async () => {
    const { reconcileIndex } = await loadPipeline();
    const missingRoot = path.join(tmpDir, 'does-not-exist');
    await expect(reconcileIndex(missingRoot)).rejects.toThrow(/project root does not exist/);
  });

  it('reconcileIndex refuses to run without metadata (empty tree guard)', async () => {
    const { reconcileIndex } = await loadPipeline();
    // tmpDir exists but has no doc-metadata.jsonl
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-empty-'));
    try {
      await expect(reconcileIndex(emptyRoot)).rejects.toThrow(/no knowledge metadata/);
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});
