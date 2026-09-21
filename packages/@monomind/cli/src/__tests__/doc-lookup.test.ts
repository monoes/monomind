/**
 * RCL-02 — "have I already saved this?", the store's half.
 *
 * The extension asks this on every navigation, so the properties that
 * matter are as much about what it COSTS and what it does when things are
 * wrong as about the answer:
 *
 *  - it never throws, for any store or any input;
 *  - it matches on the ingest side's own identity rule, so the badge never
 *    claims a page is saved that cannot actually be found again;
 *  - it answers the whole question, note included — that note is the entire
 *    difference between this and a bookmark.
 *
 * Driven through the real ingest, so what is pinned is what a capture
 * actually leaves behind rather than a hand-written metadata file.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let ROOT = '';
const store = new Map<string, { value: string; tags: string[] }>();

vi.mock('../memory/memory-bridge.js', () => ({
  bridgeStoreEntry: async (o: { key: string; value: string; tags?: string[] }) => {
    store.set(o.key, { value: o.value, tags: o.tags ?? [] });
    return { success: true, id: `entry_${store.size}` };
  },
  bridgeSearchEntries: async () => ({ success: true, results: [] }),
  getProjectRoot: () => ROOT,
}));

// ~/scratch, never /tmp: the shared tmpfs filled up and blocked a whole build.
const SCRATCH = process.env.MONOMIND_TEST_SCRATCH || join(os.homedir(), 'scratch');
fs.mkdirSync(SCRATCH, { recursive: true });
ROOT = fs.mkdtempSync(join(SCRATCH, 'mm-lookup-'));

// scope `global` routes to the PERSONAL brain (`globalBrainRoot` in
// document-pipeline), which is the real one under ~/.monomind unless this
// is set. Pinned before the pipeline is imported, or a test run writes
// records into the user's own store.
process.env.MONOMIND_GLOBAL_BRAIN_DIR = join(ROOT, 'global-brain');

const { identityUrl, lookupUrl, lookupUrls } = await import('../knowledge/lookup.js');
const { ingestDocument } = await import('../knowledge/document-pipeline.js');

const CANONICAL = 'https://example.com/sprockets/calibration';

const body = (marker: string) =>
  [
    '# Sprocket Calibration',
    '',
    `${marker}: torque the sprocket to 9 Nm on the bench.`,
    '',
    'lorem ipsum dolor sit amet '.repeat(60),
  ].join('\n');

/**
 * capture writes a capture envelope the way the extension does — meta.json
 * beside readable.md — and ingests it.
 */
async function capture(
  name: string,
  meta: Record<string, unknown> = {},
  marker = 'Rule',
  url = CANONICAL,
): Promise<string> {
  const dir = join(ROOT, 'inbox', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      url: `${url}?ref=hn`,
      canonicalUrl: url,
      title: 'Sprocket Calibration',
      capturedAt: '2026-09-20T09:00:00.000Z',
      httpStatus: 200,
      note: 'torque figures worth keeping',
      tags: ['mechanics', 'reading'],
      collection: 'bench',
      source: 'extension',
      ...meta,
    }),
  );
  const file = join(dir, 'readable.md');
  fs.writeFileSync(file, body(marker));
  const result = await ingestDocument(file, 'global');
  expect(result.error).toBeUndefined();
  return dir;
}

const lookup = (url: string) => lookupUrl(url, { rootDir: ROOT, scope: 'global' });

beforeEach(() => {
  store.clear();
});

describe('identityUrl', () => {
  it('is the ingest side’s rule and nothing more', () => {
    // Matching more loosely would make the badge claim pages are saved
    // that cannot be found again.
    expect(identityUrl('https://example.com/post#section-3')).toBe('https://example.com/post');
    expect(identityUrl('https://example.com/post?ref=hn')).toBe('https://example.com/post?ref=hn');
    expect(identityUrl('https://example.com/post/')).toBe('https://example.com/post/');
    expect(identityUrl('  https://example.com/post  ')).toBe('https://example.com/post');
    expect(identityUrl(undefined)).toBe('');
  });
});

describe('looking a URL up', () => {
  it('answers the whole question for a saved page', async () => {
    const dir = await capture('first');

    const got = lookup(CANONICAL);

    expect(got.saved).toBe(true);
    expect(got.url).toBe(CANONICAL);
    expect(got.title).toBe('Sprocket Calibration');
    expect(got.site).toBe('example.com');
    expect(got.capturedAt).toBe('2026-09-20T09:00:00.000Z');
    expect(got.versions).toBe(1);
    expect(got.tags).toEqual(['mechanics', 'reading']);
    expect(got.collection).toBe('bench');
    expect(got.source).toBe('extension');
    // The note is the whole point: a bookmark can say a page was saved,
    // only this can say why.
    expect(got.note).toBe('torque figures worth keeping');
    // And "open the archived copy" needs the envelope, not the file.
    expect(got.envelope).toBe(dir);
    expect(got.filePath).toBe(join(dir, 'readable.md'));
  });

  it('matches the URL a tab is actually on, fragment and all', async () => {
    await capture('fragment');
    expect(lookup(`${CANONICAL}#section-3`).saved).toBe(true);
  });

  it('does not match a different page whose URL merely starts the same', async () => {
    await capture('prefix');
    expect(lookup(`${CANONICAL}/comments`).saved).toBe(false);
    expect(lookup('https://example.com/sprockets').saved).toBe(false);
  });

  it('reports an unsaved page as an ordinary answer', async () => {
    await capture('unsaved-neighbour');
    const got = lookup('https://example.com/never-visited');

    expect(got.saved).toBe(false);
    expect(got.url).toBe('https://example.com/never-visited');
    expect(got.versions).toBe(0);
    expect(got.tags).toEqual([]);
  });

  it('counts the versions of a page that was re-captured', async () => {
    await capture('v1', {}, 'Rule');
    // RCL-06: the same URL, new content, lands as a new VERSION at a new
    // path — and the badge should say so rather than say "saved" twice.
    await capture('v2', { capturedAt: '2026-09-21T09:00:00.000Z' }, 'Revised rule');

    const got = lookup(CANONICAL);
    expect(got.saved).toBe(true);
    expect(got.versions).toBe(2);
    // The newest version is the one described.
    expect(got.capturedAt).toBe('2026-09-21T09:00:00.000Z');
    expect(got.filePath).toContain('v2');
  });

  it('counts a page saved once as one version, not zero', async () => {
    const once = 'https://example.com/saved-exactly-once';
    await capture('single', {}, 'Rule', once);
    expect(lookup(once).versions).toBe(1);
  });

  it('carries the note written on the newest capture, not an older one', async () => {
    await capture('note-v1', { note: 'first thoughts' }, 'Rule');
    await capture('note-v2', { note: 'actually, this is the number' }, 'Revised rule');

    expect(lookup(CANONICAL).note).toBe('actually, this is the number');
  });

  it('falls back to the plain url when there is no canonical one', async () => {
    const dir = join(ROOT, 'inbox', 'no-canonical');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({ url: 'https://plain.test/page', title: 'Plain' }),
    );
    const file = join(dir, 'readable.md');
    fs.writeFileSync(file, body('Plain'));
    await ingestDocument(file, 'global');

    expect(lookup('https://plain.test/page').saved).toBe(true);
  });

  it('counts the highlights on the page when asked to', async () => {
    const url = 'https://example.com/highlighted';
    const dir = await capture('with-highlights', {}, 'Rule', url);
    fs.writeFileSync(
      join(dir, 'highlights.json'),
      JSON.stringify({
        version: 1,
        url: CANONICAL,
        highlights: [
          {
            id: 'hl-1',
            text: 'torque the sprocket to 9 Nm',
            anchor: { quote: 'torque the sprocket to 9 Nm' },
          },
          { id: 'hl-2', text: 'on the bench', anchor: { quote: 'on the bench' } },
        ],
      }),
    );

    expect(lookupUrl(url, { rootDir: ROOT, scope: 'global' }).highlights).toBeUndefined();
    expect(
      lookupUrl(url, { rootDir: ROOT, scope: 'global', withHighlights: true }).highlights,
    ).toBe(2);
  });

  it('is unbothered by a highlights.json that is nonsense', async () => {
    const url = 'https://example.com/bad-highlights';
    const dir = await capture('bad-highlights', {}, 'Rule', url);
    fs.writeFileSync(join(dir, 'highlights.json'), '{ truncated');

    const got = lookupUrl(url, { rootDir: ROOT, scope: 'global', withHighlights: true });
    expect(got.saved).toBe(true);
    expect(got.highlights).toBeUndefined();
  });
});

describe('never failing a page load', () => {
  it('answers for a store that has never been written', () => {
    // A project store, not `global`: scope `global` routes to the personal
    // brain and ignores rootDir entirely (see getKnowledgeRoot).
    const empty = fs.mkdtempSync(join(SCRATCH, 'mm-lookup-empty-'));
    expect(lookupUrl(CANONICAL, { rootDir: empty, scope: 'shared' })).toMatchObject({
      saved: false,
      versions: 0,
    });
  });

  it('answers for a store directory that does not exist at all', () => {
    expect(
      lookupUrl(CANONICAL, { rootDir: join(SCRATCH, 'no-such-store-at-all'), scope: 'shared' }),
    ).toMatchObject({ saved: false });
  });

  it('answers for input that is not a URL', () => {
    for (const input of ['', '   ', 'not a url', 'chrome://newtab', '#']) {
      const got = lookup(input);
      expect(got.saved).toBe(false);
      expect(got.versions).toBe(0);
    }
  });

  it('answers a batch in one call', async () => {
    await capture('batch', {}, 'Rule', 'https://example.com/batched');
    const got = lookupUrls(['https://example.com/batched', 'https://example.com/other'], {
      rootDir: ROOT,
      scope: 'global',
    });
    expect(got.map((g) => g.saved)).toEqual([true, false]);
  });
});
