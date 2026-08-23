/**
 * Second Brain: superseded document versions must not be returned by default,
 * and `knowledge_search` must apply the CLI's empty-surface chunks fallback.
 *
 * Everything here runs against a throwaway store: `process.chdir()` into a temp
 * dir (the project store is keyed to cwd) plus MONOMIND_GLOBAL_BRAIN_DIR. The
 * user's real Second Brain is never read or written.
 *
 * Why this exists — measured on this repo's own store (2026-07-26):
 * 9,067 `doc:`-keyed rows in `knowledge:shared`, spanning 798 distinct content
 * hashes, of which 139 were current. 8,542 rows (94.2%) were chunks of document
 * versions that had since been re-ingested, and all of them were searchable.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_GLOBAL = process.env.MONOMIND_GLOBAL_BRAIN_DIR;
let ROOT = '';

beforeAll(() => {
  ROOT = fs.mkdtempSync(join(os.tmpdir(), 'mm-superseded-'));
  fs.mkdirSync(join(ROOT, '.monomind'), { recursive: true });
  process.env.MONOMIND_GLOBAL_BRAIN_DIR = join(ROOT, 'global-brain');
  process.chdir(ROOT);
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
  if (ORIGINAL_GLOBAL === undefined) delete process.env.MONOMIND_GLOBAL_BRAIN_DIR;
  else process.env.MONOMIND_GLOBAL_BRAIN_DIR = ORIGINAL_GLOBAL;
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('superseded-version predicates', () => {
  it('classifies doc keys against the live content-hash set', async () => {
    const { isSupersededKey } = await import('../knowledge/document-pipeline.js');
    const live = new Set(['aaa']);
    expect(isSupersededKey('doc:aaa:0', live)).toBe(false); // current version
    expect(isSupersededKey('doc:bbb:0', live)).toBe(true); // older version
    expect(isSupersededKey('doc:bbb:17', live)).toBe(true); // any chunk index
    expect(isSupersededKey('pattern:bbb', live)).toBe(false); // not a document chunk
    expect(isSupersededKey('', live)).toBe(false);
    // No metadata must not read as "everything is stale".
    expect(isSupersededKey('doc:bbb:0', new Set())).toBe(false);
  });

  it('over-fetches only when filtering can actually happen', async () => {
    const { supersededOverfetchLimit } = await import('../knowledge/document-pipeline.js');
    expect(supersededOverfetchLimit(10, new Set())).toBe(10); // nothing to filter
    expect(supersededOverfetchLimit(10, new Set(['a']))).toBe(200); // 20x
    expect(supersededOverfetchLimit(100, new Set(['a']))).toBe(300); // capped
  });

  it('liveContentHashes reads the current hash per document from the metadata log', async () => {
    const { liveContentHashes } = await import('../knowledge/document-pipeline.js');
    const root = fs.mkdtempSync(join(os.tmpdir(), 'mm-meta-'));
    const dir = join(root, '.monomind', 'knowledge');
    fs.mkdirSync(dir, { recursive: true });
    const rec = (filePath: string, contentHash: string, chunkCount: number) =>
      JSON.stringify({
        filePath,
        contentHash,
        chunkCount,
        scope: 'shared',
        indexedAt: '',
        size: 1,
      });
    fs.writeFileSync(
      join(dir, 'doc-metadata.jsonl'),
      `${[
        rec('/a.md', 'h-old', 3), // superseded by the next line (last-wins)
        rec('/a.md', 'h-new', 3),
        rec('/b.md', 'h-b', 2),
        rec('/b.md', '', -1), // removal tombstone
      ].join('\n')}\n`,
    );
    const live = liveContentHashes(root);
    expect([...live].sort()).toEqual(['h-new']);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('searchKnowledge hides superseded document versions', () => {
  it('returns only the current version after a re-ingest, and keeps the old rows retrievable on request', async () => {
    const { ingestDocument, searchKnowledge } = await import('../knowledge/document-pipeline.js');
    const docPath = join(ROOT, 'runbook.md');

    // v1 — distinctive term "zebracorn"
    fs.writeFileSync(
      docPath,
      [
        '# Deployment runbook',
        '',
        'The rollback procedure is owned by the zebracorn team. '.repeat(20),
      ].join('\n'),
    );
    const v1 = await ingestDocument(docPath, 'shared', ROOT);
    expect(v1.chunksIndexed).toBeGreaterThan(0);

    const beforeRewrite = await searchKnowledge('who owns the rollback procedure', {
      rootDir: ROOT,
      limit: 10,
      minScore: 0.1,
      store: 'project',
    });
    expect(beforeRewrite.map((e) => e.text).join('\n')).toContain('zebracorn');

    // v2 — same file, new content, new contentHash → new keys, v1 rows orphaned
    fs.writeFileSync(
      docPath,
      [
        '# Deployment runbook',
        '',
        'The rollback procedure is owned by the narwhal team. '.repeat(20),
      ].join('\n'),
    );
    const v2 = await ingestDocument(docPath, 'shared', ROOT);
    expect(v2.skipped).toBe(false);
    expect(v2.chunksIndexed).toBeGreaterThan(0);

    // Default search: current version only.
    const current = await searchKnowledge('who owns the rollback procedure', {
      rootDir: ROOT,
      limit: 10,
      minScore: 0.1,
      store: 'project',
    });
    const currentText = current.map((e) => e.text).join('\n');
    expect(current.length).toBeGreaterThan(0);
    expect(currentText).toContain('narwhal');
    expect(currentText).not.toContain('zebracorn');
    expect(current.every((e) => e.superseded === undefined)).toBe(true);

    // Nothing was deleted: opting in brings the old version back, flagged.
    const withOld = await searchKnowledge('who owns the rollback procedure', {
      rootDir: ROOT,
      limit: 20,
      minScore: 0.1,
      store: 'project',
      includeSuperseded: true,
    });
    const stale = withOld.filter((e) => e.superseded === true);
    expect(stale.length).toBeGreaterThan(0);
    expect(stale.map((e) => e.text).join('\n')).toContain('zebracorn');
    // and the current version is still there alongside it
    expect(withOld.some((e) => !e.superseded && e.text.includes('narwhal'))).toBe(true);
  }, 600_000);
});

describe('knowledge_search matches the CLI fallback behaviour', () => {
  it('falls back to chunks when a confident non-chunk route finds nothing', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    const { routeQuery } = await import('../memory/query-router.js');
    const { knowledgeTools } = await import('../mcp-tools/knowledge-tools.js');

    const docPath = join(ROOT, 'incident-notes.md');
    fs.writeFileSync(
      docPath,
      [
        '# Incident notes',
        '',
        'We decided to keep the pager rotation weekly after the flamingo outage. '.repeat(20),
      ].join('\n'),
    );
    const ing = await ingestDocument(docPath, 'shared', ROOT);
    expect(ing.chunksIndexed).toBeGreaterThan(0);

    // The premise of the fallback: this query routes confidently AWAY from chunks.
    const query = 'what did we decide previously';
    const route = routeQuery(query);
    expect(route.confident).toBe(true);
    expect(route.surfaces).toEqual(['memory']);

    const tool = knowledgeTools.find((t) => t.name === 'knowledge_search')!;
    const res = (await tool.handler({ query, limit: 5, minScore: 0.05 }, {} as never)) as {
      content: Array<{ text: string }>;
    };
    const payload = JSON.parse(res.content[0].text);

    expect(payload.success).toBe(true);
    expect(payload.routing.fellBackToChunks).toBe(true);
    expect(payload.excerpts.length).toBeGreaterThan(0);
    // excerpts is now an id/metadata-only projection (token-efficiency fix) —
    // full chunk text lives only in the canonical `results` list.
    expect(payload.excerpts[0]).not.toHaveProperty('text');
    expect(payload.results.map((e: { text?: string }) => e.text ?? '').join('\n')).toContain(
      'flamingo',
    );
    expect(payload.count).toBeGreaterThan(0);
  }, 600_000);
});
