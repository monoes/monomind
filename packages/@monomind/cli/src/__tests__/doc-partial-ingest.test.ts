/**
 * Document ingest is all-or-nothing per version
 * (memory/knowledge-graph review 2026-09-05, finding K10).
 *
 * The defect: a multi-chunk document whose first chunk stored and whose
 * remaining chunks failed returned one indexed chunk and NO error, and still
 * recorded the document's content hash. The hash check at the top of
 * `ingestDocument` then skipped the file on every later ingest, so the missing
 * chunks were never retried — permanently, silently half-indexed. A failed
 * RE-ingest was worse still: the previous version's metadata was tombstoned
 * before the replacement was known to land, so the document lost its last good
 * index too.
 *
 * The memory bridge is replaced with an in-memory fake because the property
 * under test is "what happens when store N of M is refused" — a real backend
 * cannot be told to fail one specific chunk.
 *
 * Covers the four cases the review named: total failure, partial failure,
 * retry, and document revision/removal.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

let ROOT = '';

/** key → stored chunk text, mimicking the bridge's upsert-by-key contract. */
const store = new Map<string, string>();
/** Refuse every store whose key matches, mimicking a backend refusal. */
let failStoreWhen: ((key: string) => boolean) | null = null;

vi.mock('../memory/memory-bridge.js', () => ({
  bridgeStoreEntry: async (o: { key: string; value: string }) => {
    if (failStoreWhen?.(o.key)) return { success: false, id: '', error: 'disk full (simulated)' };
    store.set(o.key, o.value);
    return { success: true, id: `entry_${store.size}` };
  },
  getProjectRoot: () => ROOT,
}));

const chunkKeys = () => [...store.keys()].filter((k) => k.startsWith('doc:'));
/** Refuse chunk `n` onward, so chunks 0..n-1 land and the rest do not —
 *  the shape of a store that dies partway through a document. */
const failChunksAfter = (n: number) => (key: string) =>
  key.startsWith('doc:') && Number(key.split(':')[2]) >= n;

ROOT = fs.mkdtempSync(join(os.tmpdir(), 'mm-doc-partial-'));
const DOC = join(ROOT, 'handbook.md');

/** Long enough to chunk several times (DEFAULT_CHUNK_SIZE is 3200). */
function body(marker: string): string {
  const para = `${marker} paragraph about widget calibration tolerances and the sprocket bench. `;
  return `# Handbook\n\n${para.repeat(400)}\n`;
}

async function ingest() {
  const { ingestDocument } = await import('../knowledge/document-pipeline.js');
  return ingestDocument(DOC, 'shared', ROOT);
}

async function liveDocs() {
  const { listDocuments } = await import('../knowledge/document-pipeline.js');
  return listDocuments(ROOT, 'shared');
}

afterAll(() => {
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

beforeEach(() => {
  store.clear();
  failStoreWhen = null;
  fs.rmSync(join(ROOT, '.monomind'), { recursive: true, force: true });
  fs.writeFileSync(DOC, body('v1'));
});

describe('ingestDocument commits a version only when every chunk stores', () => {
  it('indexes a multi-chunk document and records it when all chunks succeed', async () => {
    const result = await ingest();

    // The whole finding is about multi-chunk documents; if the fixture stopped
    // producing several chunks the other cases below would be vacuous.
    expect(result.chunksIndexed).toBeGreaterThan(1);
    expect(result.error).toBeUndefined();
    expect(result.partial).toBeUndefined();
    expect(await liveDocs()).toHaveLength(1);
  });

  it('records nothing and reports an error when every chunk store fails', async () => {
    failStoreWhen = () => true;
    const result = await ingest();

    expect(result.chunksIndexed).toBe(0);
    expect(result.error).toBe('all chunk stores failed');
    expect(await liveDocs()).toHaveLength(0);
  });

  // The core defect: this returned chunksIndexed:1 with no error and recorded
  // the hash anyway.
  it('reports a partial store and does NOT record the version', async () => {
    failStoreWhen = failChunksAfter(1);
    const result = await ingest();

    expect(result.chunksIndexed).toBe(1);
    // No metadata record ⇒ nothing claims this document is indexed, and the
    // one written chunk sits under a hash that is not live, so superseded
    // filtering keeps it out of search.
    expect(await liveDocs()).toHaveLength(0);
    expect(result.error).toMatch(/partial store: 1\/\d+ chunks/);
    expect(result.partial).toBe(true);
  });

  // The damage was permanent because of this step: the recorded hash made the
  // retry a no-op skip.
  it('repairs the document on a healthy retry after a partial failure', async () => {
    failStoreWhen = failChunksAfter(1);
    await ingest();
    const afterPartial = chunkKeys().length;

    failStoreWhen = null;
    const retry = await ingest();

    // Pre-fix this was a skip: the hash recorded by the partial attempt made
    // the healthy retry believe the document was already ingested.
    expect(retry.skipped).toBe(false);
    expect(retry.chunksIndexed).toBeGreaterThan(afterPartial);
    expect(chunkKeys()).toHaveLength(retry.chunksIndexed);
    expect(await liveDocs()).toHaveLength(1);
    expect(retry.error).toBeUndefined();
    expect(retry.partial).toBeUndefined();
  });

  it('skips an unchanged document that is already fully indexed', async () => {
    const first = await ingest();
    const second = await ingest();

    expect(second.skipped).toBe(true);
    expect(second.chunksIndexed).toBe(first.chunksIndexed);
  });

  it('keeps the previous usable version when a re-ingest of new content fails', async () => {
    const first = await ingest();
    const v1Hash = (await liveDocs())[0].contentHash;

    fs.writeFileSync(DOC, body('v2'));
    failStoreWhen = failChunksAfter(1);
    const revision = await ingest();

    // v1 is still the live version: a failed replacement must not leave the
    // document worse off than before it started. Pre-fix the previous record
    // was tombstoned up front, so this left the document with no live version.
    const docs = await liveDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0].contentHash).toBe(v1Hash);
    expect(docs[0].chunkCount).toBe(first.chunksIndexed);
    expect(revision.partial).toBe(true);
  });

  it('replaces the live version when a revision fully succeeds', async () => {
    await ingest();
    const v1Hash = (await liveDocs())[0].contentHash;

    fs.writeFileSync(DOC, body('v2'));
    const revision = await ingest();

    expect(revision.partial).toBeUndefined();
    const docs = await liveDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0].contentHash).not.toBe(v1Hash);
    expect(docs[0].chunkCount).toBe(revision.chunksIndexed);
  });

  it('removal drops the document, and a later ingest re-adds it', async () => {
    const { removeDocument } = await import('../knowledge/document-pipeline.js');
    await ingest();

    await removeDocument(DOC, 'shared', ROOT);
    expect(await liveDocs()).toHaveLength(0);

    const reAdded = await ingest();
    expect(reAdded.skipped).toBe(false);
    expect(reAdded.partial).toBeUndefined();
    expect(await liveDocs()).toHaveLength(1);
  });
});
