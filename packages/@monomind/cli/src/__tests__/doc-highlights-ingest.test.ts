/**
 * RCL-04, the wiring half — a capture's `highlights.json` becomes notes as
 * part of ingesting the page.
 *
 * `highlights.ts` is tested on its own (doc-highlights.test.ts). What is
 * pinned HERE is the join: ingesting a capture stores its highlights against
 * the version it just committed, and — the property that matters most — a
 * highlight that cannot be stored costs the capture nothing. Someone's page
 * must not be lost because the extension wrote a bad annotation.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

let ROOT = '';
const store = new Map<string, { value: string; tags: string[] }>();
/** When set, every `highlight:` store throws — the "bad annotation" case. */
let breakHighlights = false;

vi.mock('../memory/memory-bridge.js', () => ({
  bridgeStoreEntry: async (o: { key: string; value: string; tags?: string[] }) => {
    if (breakHighlights && o.key.startsWith('highlight:')) throw new Error('store exploded');
    store.set(o.key, { value: o.value, tags: o.tags ?? [] });
    return { success: true, id: `entry_${store.size}` };
  },
  bridgeSearchEntries: async () => ({ success: true, results: [] }),
  getProjectRoot: () => ROOT,
}));

// ~/scratch, never /tmp: the shared tmpfs filled up and blocked a whole build.
const SCRATCH = process.env.MONOMIND_TEST_SCRATCH || join(os.homedir(), 'scratch');
fs.mkdirSync(SCRATCH, { recursive: true });
ROOT = fs.mkdtempSync(join(SCRATCH, 'mm-hl-wire-'));

const CANONICAL = 'https://example.com/sprockets/calibration';
const PRESENT = 'torque the sprocket to 9 Nm on the bench';
const ABSENT = 'a sentence that is nowhere in this document';

const BODY = [
  '# Sprocket Calibration',
  '',
  `Rule: ${PRESENT}.`,
  '',
  'lorem ipsum dolor sit amet '.repeat(40),
].join('\n');

function envelope(name: string, highlights?: unknown, body = BODY): string {
  const dir = join(ROOT, 'inbox', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'readable.md'), body);
  fs.writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      url: `${CANONICAL}?ref=hn`,
      canonicalUrl: CANONICAL,
      title: 'Sprocket Calibration',
      capturedAt: '2026-09-21T10:00:00.000Z',
      source: 'extension',
    }),
  );
  if (highlights !== undefined) {
    fs.writeFileSync(
      join(dir, 'highlights.json'),
      typeof highlights === 'string' ? highlights : JSON.stringify(highlights),
    );
  }
  return join(dir, 'readable.md');
}

const twoHighlights = {
  version: 1,
  highlights: [
    { id: 'h1', text: PRESENT, anchor: { quote: PRESENT, startChar: 30 }, comment: 'the number' },
    { id: 'h2', text: ABSENT, anchor: { quote: ABSENT } },
  ],
};

const highlightKeys = () => [...store.keys()].filter((k) => k.startsWith('highlight:'));

beforeEach(() => {
  store.clear();
  breakHighlights = false;
  fs.rmSync(join(ROOT, '.monomind'), { recursive: true, force: true });
  fs.rmSync(join(ROOT, 'inbox'), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe('RCL-04 highlights through ingestDocument', () => {
  it('stores a capture’s highlights as notes linked to the document', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    const file = envelope('with-highlights', twoHighlights);
    const result = await ingestDocument(file, 'shared', ROOT);

    expect(result.chunksIndexed).toBeGreaterThan(0);
    expect(result.highlights).toEqual({ found: 2, stored: 2, anchored: 1 });

    const keys = highlightKeys();
    expect(keys).toHaveLength(2);
    // Keyed under the PARENT's content hash, like the doc: chunk keys.
    for (const key of keys) expect(key).toMatch(/^highlight:[0-9a-f]{64}:h[12]$/);

    const note = store.get(keys.find((k) => k.endsWith(':h1')) as string);
    expect(note?.value).toContain(PRESENT);
    expect(note?.value).toContain('Note: the number');
    expect(note?.tags).toContain('highlight');
    expect(note?.tags).toContain(`url:${CANONICAL}`);
    expect(note?.tags.some((t) => t.startsWith('parent:shared:'))).toBe(true);
  });

  it('ingests a capture with no highlights exactly as before', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    const result = await ingestDocument(envelope('plain'), 'shared', ROOT);
    expect(result.chunksIndexed).toBeGreaterThan(0);
    expect(result.highlights).toBeUndefined();
    expect(highlightKeys()).toEqual([]);
  });

  it('keeps the capture when the highlights cannot be stored', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    breakHighlights = true;
    const result = await ingestDocument(envelope('exploding', twoHighlights), 'shared', ROOT);

    // The page is fully indexed and committed; only the notes fell short.
    expect(result.error).toBeUndefined();
    expect(result.chunksIndexed).toBeGreaterThan(0);
    expect(result.version).toBe(1);
    expect(result.highlights).toMatchObject({ found: 2, stored: 0 });
    expect(result.highlights?.error).toMatch(/0\/2/);
    expect(highlightKeys()).toEqual([]);
  });

  it('is unbothered by a highlights.json that is nonsense', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    const result = await ingestDocument(envelope('garbage', '{ truncated'), 'shared', ROOT);
    expect(result.error).toBeUndefined();
    expect(result.chunksIndexed).toBeGreaterThan(0);
    expect(result.highlights).toBeUndefined();
  });

  it('re-stores the notes under the new hash when the page is re-captured', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    const first = await ingestDocument(envelope('v1', twoHighlights), 'shared', ROOT);
    const firstKeys = highlightKeys();

    const second = await ingestDocument(
      envelope('v2', twoHighlights, `${BODY}\n\nA new paragraph appeared.\n`),
      'shared',
      ROOT,
    );
    expect(second.version).toBe(2);
    expect(second.highlights).toEqual({ found: 2, stored: 2, anchored: 1 });
    // A new version means new keys: the old notes still cite the version they
    // were measured against, exactly like the chunks do.
    expect(highlightKeys().filter((k) => !firstKeys.includes(k))).toHaveLength(2);
    expect(first.highlights?.stored).toBe(2);
  });

  it('does nothing on an unchanged re-ingest', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    const file = envelope('same', twoHighlights);
    await ingestDocument(file, 'shared', ROOT);
    store.clear();

    const again = await ingestDocument(file, 'shared', ROOT);
    expect(again.unchanged).toBe(true);
    // Nothing was rewritten, highlights included — the notes from the first
    // ingest are still under this version's hash.
    expect(highlightKeys()).toEqual([]);
    expect(again.highlights).toBeUndefined();
  });
});
