/**
 * `ingestDirectory` — the batch path's own dedupe, which the single-file path
 * already had.
 *
 * Two independent faults lived here, and each is pinned separately below so a
 * regression in one cannot hide behind the other:
 *
 *  - SCOPE: the batch resolved its metadata root from the project, never
 *    through `effectiveRoot`. Under `global` (or `profile:<id>`) the cache was
 *    therefore read from a store nothing was ever written to, so no ingest
 *    could find its predecessor and every sweep re-indexed the whole tree.
 *    Pinned with ONE file swept TWICE — a single file cannot exercise the
 *    second fault at all.
 *
 *  - BATCH VISIBILITY: the cache was a snapshot taken before the loop and
 *    handed unchanged to every file, so files within one sweep could not see
 *    each other's writes. Pinned with ONE sweep over a capture envelope, under
 *    `shared` + the project root, where `effectiveRoot` is the identity and
 *    the first fault cannot be the cause.
 *
 * The end-to-end consequence — a first-ever ingest of one capture reporting
 * two documents and `versions: 2` — is the last describe block.
 *
 * The memory bridge is faked for the same reason the rest of the knowledge
 * suite fakes it: the property under test is which metadata records survive,
 * not which backend stored the chunks.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

let PROJECT = '';

const store = new Map<string, { value: string; tags: string[] }>();

vi.mock('../memory/memory-bridge.js', () => ({
  bridgeStoreEntry: async (o: { key: string; value: string; tags?: string[] }) => {
    store.set(o.key, { value: o.value, tags: o.tags ?? [] });
    return { success: true, id: `entry_${store.size}` };
  },
  bridgeSearchEntries: async () => ({ success: true, results: [] }),
  getProjectRoot: () => PROJECT,
}));

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-batch-ingest-'));
const BRAIN = path.join(WORK, 'brain');
PROJECT = path.join(WORK, 'project');
process.env.MONOMIND_GLOBAL_BRAIN_DIR = BRAIN;

const CANONICAL = 'https://example.com/sprockets/calibration';

const META = {
  url: `${CANONICAL}?ref=hn`,
  canonicalUrl: CANONICAL,
  title: 'Sprocket Calibration',
  capturedAt: '2026-09-21T10:00:00.000Z',
  httpStatus: 200,
  tags: ['mechanics'],
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

/** A capture envelope as the extension writes one: meta + archive + readable. */
function makeEnvelope(name: string, readable = readableBody('READABLE-PASS')): string {
  const dir = path.join(PROJECT, 'inbox', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(META, null, 2));
  fs.writeFileSync(path.join(dir, 'page.html'), PAGE_HTML);
  fs.writeFileSync(path.join(dir, 'readable.md'), readable);
  return dir;
}

function makeDir(name: string, files: Record<string, string>): string {
  const dir = path.join(PROJECT, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), body);
  return dir;
}

async function pipeline() {
  return import('../knowledge/document-pipeline.js');
}

beforeEach(() => {
  store.clear();
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(PROJECT, { recursive: true });
  fs.mkdirSync(BRAIN, { recursive: true });
});

afterAll(() => {
  try {
    fs.rmSync(WORK, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('ingestDirectory resolves its metadata root through the scope', () => {
  it('finds a previous global sweep instead of re-indexing it', async () => {
    const { ingestDirectory, listDocuments } = await pipeline();
    const dir = makeDir('notes', {
      'alpha.md': '# Alpha\n\nOne document, swept twice. Nothing else is in this directory.\n',
    });

    const first = await ingestDirectory(dir, 'global', { rootDir: PROJECT });
    expect(first.filesProcessed).toBe(1);
    expect(first.results[0].version).toBe(1);

    // The write landed in the global brain, so the second sweep's cache has to
    // be read from there — not from the project root it was told about.
    expect(listDocuments(BRAIN, 'global')).toHaveLength(1);

    const second = await ingestDirectory(dir, 'global', { rootDir: PROJECT });
    expect(second.results[0].unchanged).toBe(true);
    expect(second.filesProcessed).toBe(0);
    expect(second.filesSkipped).toBe(1);
    expect(listDocuments(BRAIN, 'global')).toHaveLength(1);
    expect(listDocuments(BRAIN, 'global')[0].version).toBe(1);
  });
});

describe('a batch sees the writes it made earlier in the same batch', () => {
  // `shared` + the project root: `effectiveRoot` is the identity here, so the
  // scope fault above cannot account for anything this test observes.
  it('indexes a capture envelope once, not once per member', async () => {
    const { ingestDirectory, listDocuments, listDocumentVersions } = await pipeline();
    const dir = makeEnvelope('20260921-alpha');

    const result = await ingestDirectory(dir, 'shared', { rootDir: PROJECT });

    expect(result.filesProcessed).toBe(1);
    expect(result.filesSkipped).toBe(1);
    expect(result.results.some((r) => r.unchanged)).toBe(true);
    expect(listDocuments(PROJECT, 'shared')).toHaveLength(1);
    // What `doc lookup` counts: one capture is one version, however many
    // members of the envelope the walk happened to visit.
    expect(listDocumentVersions(PROJECT, CANONICAL, 'shared')).toHaveLength(1);
  });

  it('still indexes genuinely distinct documents in one sweep', async () => {
    const { ingestDirectory, listDocuments } = await pipeline();
    const dir = makeDir('library', {
      'alpha.md': '# Alpha\n\nThe first document, about sprockets and their calibration.\n',
      'beta.md': '# Beta\n\nThe second document, about flanges and their tolerances.\n',
    });

    const result = await ingestDirectory(dir, 'shared', { rootDir: PROJECT });

    expect(result.filesProcessed).toBe(2);
    expect(listDocuments(PROJECT, 'shared')).toHaveLength(2);
  });
});

describe('one capture envelope is one document, at the readable.md path', () => {
  it('files the envelope under readable.md, whatever order the walk sees', async () => {
    const { ingestDirectory, listDocuments } = await pipeline();
    const dir = makeEnvelope('20260921-alpha');

    await ingestDirectory(dir, 'shared', { rootDir: PROJECT });
    const [doc] = listDocuments(PROJECT, 'shared');

    // `page.html` extracts THROUGH readable.md, so the record that names
    // page.html would document a file whose own text was never indexed —
    // and which member the walk reaches first is readdir order, not a choice.
    expect(doc.filePath).toBe(path.join(dir, 'readable.md'));
  });

  it('reports one version, the readable.md path, and unchanged on re-ingest', async () => {
    const { ingestDirectory } = await pipeline();
    const { lookupUrl } = await import('../knowledge/lookup.js');
    const dir = makeEnvelope('20260921-alpha');

    await ingestDirectory(dir, 'shared', { rootDir: PROJECT });
    const first = lookupUrl(CANONICAL, { rootDir: PROJECT, scope: 'shared' });
    expect(first.saved).toBe(true);
    expect(first.versions).toBe(1);
    expect(first.filePath).toBe(path.join(dir, 'readable.md'));

    const again = await ingestDirectory(dir, 'shared', { rootDir: PROJECT });
    expect(again.filesProcessed).toBe(0);
    expect(again.results.every((r) => r.skipped)).toBe(true);
    expect(lookupUrl(CANONICAL, { rootDir: PROJECT, scope: 'shared' }).versions).toBe(1);
  });

  it('counts a re-capture of the same page as the second version', async () => {
    const { ingestDirectory } = await pipeline();
    const { lookupUrl } = await import('../knowledge/lookup.js');

    await ingestDirectory(makeEnvelope('20260921-alpha'), 'shared', { rootDir: PROJECT });
    const second = makeEnvelope('20260922-alpha', readableBody('REVISED-PASS'));
    await ingestDirectory(second, 'shared', { rootDir: PROJECT });

    const found = lookupUrl(CANONICAL, { rootDir: PROJECT, scope: 'shared' });
    expect(found.versions).toBe(2);
    expect(found.filePath).toBe(path.join(second, 'readable.md'));
  });
});
