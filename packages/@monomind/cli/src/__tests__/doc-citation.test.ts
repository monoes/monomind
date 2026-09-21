/**
 * RCL-10 — paragraph-level citation.
 *
 * The goal the story sets: an agent can quote a sentence and link to the place
 * it came from. That needs three things to hold together, and each is pinned
 * here:
 *
 *  - a search hit carries the chunk's character span and an anchor, without
 *    anyone re-reading the document;
 *  - the anchor resolves back to the exact passage, with the page URL and the
 *    time it was captured;
 *  - an anchor cut against an older version of a re-captured page is reported
 *    STALE rather than silently resolving to whatever text now sits at those
 *    offsets.
 *
 * The memory bridge is an in-memory fake, as in `capture-ingest.test.ts` — the
 * property under test is which tags get written and what comes back, not any
 * storage backend.
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

// ~/scratch, never /tmp: the shared tmpfs filled up and blocked a whole build.
const SCRATCH = process.env.MONOMIND_TEST_SCRATCH || join(os.homedir(), 'scratch');
fs.mkdirSync(SCRATCH, { recursive: true });
ROOT = fs.mkdtempSync(join(SCRATCH, 'mm-cite-'));

const CANONICAL = 'https://example.com/sprockets/calibration';

const meta = (extra: Record<string, unknown> = {}) => ({
  url: `${CANONICAL}?ref=hn`,
  canonicalUrl: CANONICAL,
  title: 'Sprocket Calibration',
  capturedAt: '2026-09-21T10:00:00.000Z',
  httpStatus: 200,
  tags: ['mechanics'],
  collection: 'bench',
  source: 'extension',
  ...extra,
});

/** A document long enough to chunk into several pieces. */
const body = (marker: string) =>
  [
    '# Sprocket Calibration',
    '',
    `${marker}: torque the sprocket to 9 Nm on the bench.`,
    '',
    '## Procedure',
    '',
    'lorem ipsum dolor sit amet '.repeat(140),
    '',
    '## Tolerances',
    '',
    'The tolerance band is plus or minus 0.2 Nm across the whole range.',
    '',
  ].join('\n');

function envelope(name: string, marker = 'READABLE-PASS', extra = {}): string {
  const dir = join(ROOT, 'inbox', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'readable.md'), body(marker));
  fs.writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta(extra)));
  return join(dir, 'readable.md');
}

beforeEach(() => {
  store.clear();
  fs.rmSync(join(ROOT, '.monomind'), { recursive: true, force: true });
  fs.rmSync(join(ROOT, 'inbox'), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe('RCL-10 citation anchors', () => {
  it('round-trips an anchor and rejects a malformed one', async () => {
    const { citationAnchor, parseCitationAnchor, anchorMatchesHash } = await import(
      '../knowledge/citation.js'
    );
    const hash = 'a'.repeat(64);
    const anchor = citationAnchor(hash, 120, 3320);
    expect(anchor).toBe(`${'a'.repeat(12)}#120-3320`);
    expect(parseCitationAnchor(anchor)).toEqual({
      hashPrefix: 'a'.repeat(12),
      startChar: 120,
      endChar: 3320,
    });
    expect(anchorMatchesHash(anchor, hash)).toBe(true);
    expect(anchorMatchesHash(anchor, 'b'.repeat(64))).toBe(false);
    expect(parseCitationAnchor('not-an-anchor')).toBeNull();
    expect(parseCitationAnchor('aaaaaaaaaaaa#900-100')).toBeNull();
  });

  it('builds a text fragment link that escapes fragment syntax', async () => {
    const { citationUrl, textFragment } = await import('../knowledge/citation.js');
    expect(textFragment('Torque, gently - then stop.')).toBe(
      ':~:text=Torque%2C%20gently%20%2D%20then%20stop.',
    );
    // Past 16 words the fragment becomes textStart,textEnd — short enough at
    // both ends to survive the site re-flowing its markup after capture.
    const long =
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen';
    expect(textFragment(long)).toBe(
      ':~:text=one%20two%20three%20four%20five%20six%20seven%20eight,eleven%20twelve%20thirteen%20fourteen%20fifteen%20sixteen%20seventeen%20eighteen',
    );
    // An existing fragment is replaced, not appended to.
    expect(citationUrl('https://example.com/a#intro', 'hello there')).toBe(
      'https://example.com/a#:~:text=hello%20there',
    );
    expect(citationUrl(undefined, 'hello there')).toBeUndefined();
  });

  it('quotes the prose, not the markdown', async () => {
    const { passageProse, passageQuote, textFragment } = await import('../knowledge/citation.js');
    // § context prefixes are added by chunk enrichment, not by the page.
    expect(passageQuote('§ Doc · A > B\nThe tolerance band   is wide.')).toBe(
      'The tolerance band is wide.',
    );
    const md = '## Tolerances\n\n- **Torque** is `9 Nm`, see [the bench guide](/bench).\n';
    expect(passageQuote(md)).toBe('Tolerances Torque is 9 Nm, see the bench guide.');
    // A fragment starts at the paragraph, not at the heading above it.
    expect(passageProse(md, true)).toBe('Torque is 9 Nm, see the bench guide.');
    expect(textFragment(md)).not.toContain('Tolerances');
    // Nothing but a heading still yields a usable quote.
    expect(passageProse('# Only a heading', true)).toBe('Only a heading');
  });
});

describe('RCL-10 citation through the pipeline', () => {
  it('tags every chunk with its span and serves it on a search hit', async () => {
    const { ingestDocument, searchKnowledge } = await import('../knowledge/document-pipeline.js');
    const file = envelope('2026-09-21-sprockets');
    const ingest = await ingestDocument(file, 'shared', ROOT);
    expect(ingest.chunksIndexed).toBeGreaterThan(1);

    for (const [, v] of store) {
      expect(v.tags.some((t) => /^span:\d+-\d+$/.test(t))).toBe(true);
    }

    const hits = await searchKnowledge('tolerance band', {
      scope: 'shared',
      rootDir: ROOT,
      store: 'project',
      limit: 5,
    });
    expect(hits.length).toBeGreaterThan(0);
    const hit = hits[0];
    expect(typeof hit.startChar).toBe('number');
    expect(hit.endChar).toBeGreaterThan(hit.startChar as number);
    expect(hit.anchor).toMatch(/^[0-9a-f]{12}#\d+-\d+$/);
    expect(hit.provenance?.canonicalUrl).toBe(CANONICAL);
  });

  it('resolves a chunk back to its passage, URL and capture time', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    const { resolveCitation } = await import('../knowledge/citation.js');
    const file = envelope('2026-09-21-sprockets');
    await ingestDocument(file, 'shared', ROOT);

    const cite = await resolveCitation(CANONICAL, {
      rootDir: ROOT,
      scope: 'shared',
      chunkIndex: 0,
    });
    expect(cite.filePath).toBe(file);
    expect(cite.startChar).toBe(0);
    expect(cite.passage).toContain('READABLE-PASS');
    // The quote is the prose a reader sees — no markdown syntax, because a
    // text fragment made of `#` characters matches nothing on the live page.
    expect(cite.quote.startsWith('Sprocket Calibration READABLE-PASS')).toBe(true);
    expect(cite.citeUrl).not.toContain('%23');
    expect(cite.url).toBe(CANONICAL);
    expect(cite.citeUrl).toContain('#:~:text=');
    expect(cite.capturedAt).toBe('2026-09-21T10:00:00.000Z');
    expect(cite.source).toBe('extension');
    expect(cite.stale).toBeUndefined();
    expect(cite.docId).toBe(`shared:${file}`);

    // The docId form and the file path resolve to the same citation.
    const byPath = await resolveCitation(file, { rootDir: ROOT, chunkIndex: 0 });
    expect(byPath.anchor).toBe(cite.anchor);
  });

  it('resolves an anchor by offsets, and flags one cut against an older version', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    const { resolveCitation } = await import('../knowledge/citation.js');
    const first = envelope('2026-09-21-v1', 'READABLE-PASS');
    await ingestDocument(first, 'shared', ROOT);
    const anchorV1 = (
      await resolveCitation(CANONICAL, { rootDir: ROOT, scope: 'shared', chunkIndex: 1 })
    ).anchor;

    // Same page, re-captured with different text: a NEW version at a new path.
    const second = envelope('2026-09-22-v2', 'REVISED-PASS');
    const again = await ingestDocument(second, 'shared', ROOT);
    expect(again.version).toBe(2);

    const stale = await resolveCitation(CANONICAL, {
      rootDir: ROOT,
      scope: 'shared',
      anchor: anchorV1,
    });
    expect(stale.filePath).toBe(second);
    expect(stale.stale).toBe(true);
    expect(stale.passage.length).toBeGreaterThan(0);

    const fresh = await resolveCitation(CANONICAL, {
      rootDir: ROOT,
      scope: 'shared',
      anchor: stale.anchor,
    });
    expect(fresh.stale).toBeUndefined();
  });

  it('refuses to invent a citation it cannot check', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    const { resolveCitation } = await import('../knowledge/citation.js');
    const file = envelope('2026-09-21-sprockets');
    await ingestDocument(file, 'shared', ROOT);

    await expect(resolveCitation('https://example.com/nope', { rootDir: ROOT })).rejects.toThrow(
      /not indexed/,
    );
    await expect(resolveCitation(CANONICAL, { rootDir: ROOT, chunkIndex: 99 })).rejects.toThrow(
      /out of range/,
    );
    await expect(resolveCitation(CANONICAL, { rootDir: ROOT, anchor: 'garbage' })).rejects.toThrow(
      /malformed/,
    );

    fs.rmSync(file);
    await expect(resolveCitation(CANONICAL, { rootDir: ROOT, chunkIndex: 0 })).rejects.toThrow(
      /source file is gone/,
    );
  });
});
