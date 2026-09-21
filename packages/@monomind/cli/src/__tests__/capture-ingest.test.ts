/**
 * RCL-01 / RCL-06 / RCL-07 — capture envelopes through the document pipeline.
 *
 * The three properties under test:
 *
 *  - the sibling `readable.md` beats our own extraction of `page.html`
 *    (the extension already cleaned the LIVE DOM);
 *  - `meta.json` provenance rides along on the stored record, so a search hit
 *    can cite its source — and a missing or corrupt `meta.json` never fails an
 *    ingest;
 *  - identity is the EXTRACTED-TEXT hash keyed on `canonicalUrl`: the same URL
 *    with the same text is a no-op "unchanged", the same URL with new text is
 *    a new VERSION, never a second row, and the superseded version's chunks
 *    stop being live.
 *
 * The memory bridge is replaced with an in-memory fake for the same reason
 * `doc-partial-ingest.test.ts` does it: the property is about which keys get
 * written and which records survive, not about any backend.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

let ROOT = '';

const store = new Map<string, { value: string; tags: string[] }>();

vi.mock('../memory/memory-bridge.js', () => ({
  bridgeStoreEntry: async (o: { key: string; value: string; tags?: string[] }) => {
    store.set(o.key, { value: o.value, tags: o.tags ?? [] });
    return { success: true, id: `entry_${store.size}` };
  },
  bridgeSearchEntries: async () => ({
    success: true,
    results: [...store.entries()].map(([key, v], i) => ({
      id: `entry_${i}`,
      key,
      content: v.value,
      tags: v.tags,
      score: 0.9,
    })),
  }),
  getProjectRoot: () => ROOT,
}));

ROOT = fs.mkdtempSync(join(os.tmpdir(), 'mm-capture-'));

const CANONICAL = 'https://example.com/sprockets/calibration';

const META = {
  url: `${CANONICAL}?ref=hn`,
  canonicalUrl: CANONICAL,
  title: 'Sprocket Calibration',
  byline: 'A. Machinist',
  publishedAt: '2026-08-01T00:00:00.000Z',
  capturedAt: '2026-09-21T10:00:00.000Z',
  httpStatus: 200,
  contentHash: 'sha256:deadbeef',
  favicon: 'https://example.com/favicon.ico',
  selection: null,
  note: null,
  tags: ['mechanics', 'reference'],
  collection: 'bench',
  source: 'extension',
};

const PAGE_HTML =
  '<html><head><title>Sprocket</title></head><body>' +
  '<nav class="site-nav">Home Docs</nav>' +
  '<article><h1>Sprocket Calibration</h1>' +
  '<p>ARCHIVE-PASS: torque the sprocket to 9 Nm on the bench.</p></article>' +
  '<footer>&copy; 2026 Widgetcorp</footer></body></html>';

const readableBody = (marker: string) =>
  `# Sprocket Calibration\n\n${marker}: torque the sprocket to 9 Nm on the bench.\n`;

/** Write a capture envelope; `meta` of null omits meta.json, a string writes
 *  it verbatim (for the malformed case). */
function makeEnvelope(
  name: string,
  opts: { readable?: string | null; meta?: unknown | null | string } = {},
): string {
  const dir = join(ROOT, 'inbox', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'page.html'), PAGE_HTML);
  if (opts.readable !== null) {
    fs.writeFileSync(join(dir, 'readable.md'), opts.readable ?? readableBody('READABLE-PASS'));
  }
  if (opts.meta !== null) {
    fs.writeFileSync(
      join(dir, 'meta.json'),
      typeof opts.meta === 'string' ? opts.meta : JSON.stringify(opts.meta ?? META, null, 2),
    );
  }
  return join(dir, 'page.html');
}

async function pipeline() {
  return import('../knowledge/document-pipeline.js');
}

const ingest = async (file: string) => (await pipeline()).ingestDocument(file, 'shared', ROOT);
const docs = async () => (await pipeline()).listDocuments(ROOT, 'shared');
const liveHashes = async () => (await pipeline()).liveContentHashes(ROOT);
const chunkText = () =>
  [...store.entries()]
    .filter(([k]) => k.startsWith('doc:'))
    .map(([, v]) => v.value)
    .join('\n');

beforeEach(() => {
  store.clear();
  fs.rmSync(join(ROOT, '.monomind'), { recursive: true, force: true });
  fs.rmSync(join(ROOT, 'inbox'), { recursive: true, force: true });
});

afterAll(() => {
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('RCL-01 — capture envelope extraction', () => {
  it('prefers the sibling readable.md over extracting page.html', async () => {
    const page = makeEnvelope('20260921-alpha');
    const result = await ingest(page);

    expect(result.skipped).toBe(false);
    expect(chunkText()).toContain('READABLE-PASS');
    expect(chunkText()).not.toContain('ARCHIVE-PASS');
  });

  it('falls back to its own extractor when there is no readable.md', async () => {
    const page = makeEnvelope('20260921-bravo', { readable: null });
    await ingest(page);

    expect(chunkText()).toContain('ARCHIVE-PASS');
    // The fallback still strips chrome.
    expect(chunkText()).not.toContain('Home Docs');
    expect(chunkText()).not.toContain('Widgetcorp');
  });

  it('ingests a bare .html file outside any envelope', async () => {
    const loose = join(ROOT, 'loose.html');
    fs.writeFileSync(loose, PAGE_HTML);
    const result = await ingest(loose);

    expect(result.skipped).toBe(false);
    expect(result.chunksIndexed).toBeGreaterThan(0);
    expect(chunkText()).toContain('ARCHIVE-PASS');
  });
});

describe('RCL-07 — provenance is a first-class record', () => {
  it('carries every meta.json field onto the stored document', async () => {
    await ingest(makeEnvelope('20260921-alpha'));
    const [doc] = await docs();

    expect(doc.canonicalUrl).toBe(CANONICAL);
    expect(doc.provenance).toMatchObject({
      url: `${CANONICAL}?ref=hn`,
      canonicalUrl: CANONICAL,
      title: 'Sprocket Calibration',
      byline: 'A. Machinist',
      publishedAt: '2026-08-01T00:00:00.000Z',
      capturedAt: '2026-09-21T10:00:00.000Z',
      httpStatus: 200,
      contentHash: 'sha256:deadbeef',
      tags: ['mechanics', 'reference'],
      collection: 'bench',
      source: 'extension',
    });
    // Nulls in the envelope are absences, not values.
    expect(doc.provenance?.note).toBeUndefined();
    expect(doc.provenance?.selection).toBeUndefined();
  });

  it('surfaces provenance on search results so a hit can cite its source', async () => {
    await ingest(makeEnvelope('20260921-alpha'));
    const { searchKnowledge } = await pipeline();
    const hits = await searchKnowledge('sprocket', {
      scope: 'shared',
      rootDir: ROOT,
      store: 'project',
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].provenance?.canonicalUrl).toBe(CANONICAL);
    expect(hits[0].provenance?.title).toBe('Sprocket Calibration');
  });

  it('ingests normally when meta.json is absent', async () => {
    const page = makeEnvelope('20260921-charlie', { meta: null });
    const result = await ingest(page);

    expect(result.skipped).toBe(false);
    expect(result.error).toBeUndefined();
    expect((await docs())[0].provenance).toBeUndefined();
  });

  it('ingests normally when meta.json is truncated mid-write', async () => {
    const page = makeEnvelope('20260921-delta', { meta: '{"url":"https://example.com/a","ti' });
    const result = await ingest(page);

    expect(result.skipped).toBe(false);
    expect(result.error).toBeUndefined();
    expect((await docs())[0].provenance).toBeUndefined();
  });

  it('keeps the good half of a partially wrong-typed meta.json', async () => {
    const page = makeEnvelope('20260921-echo', {
      meta: { canonicalUrl: CANONICAL, title: 'Kept', httpStatus: 'not a number', tags: 'solo' },
    });
    await ingest(page);
    const [doc] = await docs();

    expect(doc.provenance?.title).toBe('Kept');
    expect(doc.provenance?.httpStatus).toBeUndefined();
    expect(doc.provenance?.tags).toEqual(['solo']);
  });
});

describe('RCL-06 — hash dedupe and versioning', () => {
  it('reports an unchanged re-ingest as unchanged, not as a duplicate', async () => {
    const page = makeEnvelope('20260921-alpha');
    const first = await ingest(page);
    const second = await ingest(page);

    expect(first.version).toBe(1);
    expect(second.skipped).toBe(true);
    expect(second.unchanged).toBe(true);
    expect(second.chunksIndexed).toBe(first.chunksIndexed);
    expect(await docs()).toHaveLength(1);
  });

  it('stores a new version when the same path changes, with a supersedes pointer', async () => {
    const page = makeEnvelope('20260921-alpha');
    const v1 = await ingest(page);
    const v1Hash = (await docs())[0].contentHash;

    fs.writeFileSync(join(ROOT, 'inbox', '20260921-alpha', 'readable.md'), readableBody('REVISED'));
    const v2 = await ingest(page);

    expect(v2.skipped).toBe(false);
    expect(v2.version).toBe(2);
    expect(v2.supersedes).toBe(v1Hash);
    expect(v1.version).toBe(1);

    const all = await docs();
    expect(all).toHaveLength(1);
    expect(all[0].version).toBe(2);
    // The old version's chunks are no longer live, so search stops serving
    // them — the same mark-don't-destroy rule a re-ingest already used.
    expect(await liveHashes()).not.toContain(v1Hash);
  });

  it('versions by canonicalUrl when the same page is re-captured to a new path', async () => {
    const first = makeEnvelope('20260921-alpha');
    const v1 = await ingest(first);
    const v1Hash = (await docs())[0].contentHash;

    const second = makeEnvelope('20260922-alpha', { readable: readableBody('RECAPTURED') });
    const v2 = await ingest(second);

    expect(v2.skipped).toBe(false);
    expect(v2.version).toBe(2);
    expect(v2.supersedes).toBe(v1Hash);
    expect(v1.version).toBe(1);

    // One row for the page, not two — and the first capture's chunks are
    // retired rather than left orphaned in the store.
    const all = await docs();
    expect(all).toHaveLength(1);
    expect(all[0].filePath).toBe(second);
    expect(await liveHashes()).not.toContain(v1Hash);
  });

  it('is a no-op when the same page is re-captured to a new path unchanged', async () => {
    await ingest(makeEnvelope('20260921-alpha'));
    const again = await ingest(makeEnvelope('20260922-alpha'));

    expect(again.skipped).toBe(true);
    expect(again.unchanged).toBe(true);
    expect(await docs()).toHaveLength(1);
  });

  it('keeps the prior version addressable through the version history', async () => {
    const first = makeEnvelope('20260921-alpha');
    await ingest(first);
    fs.writeFileSync(join(ROOT, 'inbox', '20260921-alpha', 'readable.md'), readableBody('REVISED'));
    await ingest(first);

    const { listDocumentVersions } = await pipeline();
    const history = listDocumentVersions(ROOT, CANONICAL, 'shared');

    expect(history.map((h) => h.version)).toEqual([1, 2]);
    expect(history[1].supersedes).toBe(history[0].contentHash);
  });

  it('treats two unrelated captures as two documents', async () => {
    await ingest(makeEnvelope('20260921-alpha'));
    await ingest(
      makeEnvelope('20260921-other', {
        readable: '# Chainring Wear\n\nChainrings wear from the inside out.\n',
        meta: { ...META, canonicalUrl: 'https://example.com/chainrings', url: undefined },
      }),
    );

    expect(await docs()).toHaveLength(2);
  });

  it('skips the envelope PDF when a better representation is present', async () => {
    const dir = join(ROOT, 'inbox', '20260921-alpha');
    makeEnvelope('20260921-alpha');
    const pdf = join(dir, 'page.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4 not really a pdf');

    const result = await ingest(pdf);
    expect(result.skipped).toBe(true);
    expect(result.error).toMatch(/capture envelope/);
  });
});
