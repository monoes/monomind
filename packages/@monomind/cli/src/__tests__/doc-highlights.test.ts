/**
 * RCL-04 — highlights as atomic notes, the ingest half.
 *
 * The story promises three things, and each is pinned here:
 *
 *  - a highlight becomes a note IN ITS OWN RIGHT, with its own text, its
 *    own comment and its own date, not a tag on the page it came from;
 *  - that note LINKS BACK to the parent capture, by document id and by URL,
 *    so "what did I highlight on this page" and "where is this quote from"
 *    are both answerable;
 *  - its anchor is re-measured against the EXTRACTED text rather than
 *    trusted from the browser, because the offsets the extension recorded
 *    were measured against the live DOM and `readable.md` is not that.
 *
 * The memory bridge is an in-memory fake, as in doc-citation.test.ts: what
 * is under test is which notes get written and what they carry, not any
 * storage backend.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, { value: string; tags: string[] }>();
let failNext = 0;

vi.mock('../memory/memory-bridge.js', () => ({
  bridgeStoreEntry: async (o: { key: string; value: string; tags?: string[] }) => {
    if (failNext > 0) {
      failNext--;
      return { success: false };
    }
    store.set(o.key, { value: o.value, tags: o.tags ?? [] });
    return { success: true, id: `entry_${store.size}` };
  },
  getProjectRoot: () => ROOT,
}));

// ~/scratch, never /tmp: the shared tmpfs filled up and blocked a whole build.
const SCRATCH = process.env.MONOMIND_TEST_SCRATCH || join(os.homedir(), 'scratch');
fs.mkdirSync(SCRATCH, { recursive: true });
const ROOT = fs.mkdtempSync(join(SCRATCH, 'mm-hl-'));

// Pinned before the pipeline is imported: scope `global` would otherwise
// route to the user's real personal brain under ~/.monomind.
process.env.MONOMIND_GLOBAL_BRAIN_DIR = join(ROOT, 'global-brain');

const {
  HIGHLIGHT_TAG,
  PARENT_TAG_PREFIX,
  URL_TAG_PREFIX,
  highlightKey,
  highlightNotes,
  ingestHighlights,
  locate,
  normalizeHighlight,
  readHighlights,
} = await import('../knowledge/highlights.js');

const CANONICAL = 'https://example.com/sprockets/calibration';

/** The extracted text: what `readable.md` holds after the Readability pass. */
const EXTRACTED = [
  '# Sprocket Calibration',
  '',
  'Torque the sprocket to 9 Nm on the bench, then re-check.',
  '',
  '## Tolerances',
  '',
  'The tolerance band is plus or minus 0.2 Nm across the whole range.',
  '',
  'See below for the full procedure.',
  '',
  '## Procedure',
  '',
  'See below for the full procedure.',
].join('\n');

const PARENT = {
  filePath: join(ROOT, 'inbox', 'post', 'readable.md'),
  scope: 'global',
  contentHash: '3f1a9c7b21de99aa0011',
  text: EXTRACTED,
  canonicalUrl: CANONICAL,
  provenance: {
    canonicalUrl: CANONICAL,
    title: 'Sprocket Calibration',
    capturedAt: '2026-09-20T09:00:00.000Z',
    source: 'extension',
  },
};

const highlight = (text: string, extra: Record<string, unknown> = {}) => ({
  id: `hl-${text.slice(0, 6).replace(/\W/g, '')}`,
  text,
  anchor: {
    quote: text,
    startChar: EXTRACTED.indexOf(text),
    endChar: EXTRACTED.indexOf(text) + text.length,
  },
  createdAt: '2026-09-21T10:00:00.000Z',
  ...extra,
});

/** Write a capture envelope containing a highlights.json. */
function envelope(name: string, body: unknown): string {
  const dir = join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'meta.json'), JSON.stringify({ url: CANONICAL }));
  fs.writeFileSync(join(dir, 'readable.md'), EXTRACTED);
  fs.writeFileSync(
    join(dir, 'highlights.json'),
    typeof body === 'string' ? body : JSON.stringify(body, null, 2),
  );
  return dir;
}

beforeEach(() => {
  store.clear();
  failNext = 0;
});

describe('reading highlights.json', () => {
  it('reads what the extension wrote', () => {
    const dir = envelope('read-ok', {
      version: 1,
      url: CANONICAL,
      highlights: [
        highlight('Torque the sprocket to 9 Nm', { comment: 'the number' }),
        highlight('The tolerance band is plus or minus 0.2 Nm'),
      ],
    });

    const got = readHighlights(dir);
    expect(got).toHaveLength(2);
    expect(got[0].text).toBe('Torque the sprocket to 9 Nm');
    expect(got[0].comment).toBe('the number');
    expect(got[0].anchor.quote).toBe('Torque the sprocket to 9 Nm');
  });

  it('is empty rather than throwing for anything malformed', () => {
    // Every one of these is a real way the file can arrive: written by an
    // older extension, truncated when the worker was suspended, or simply
    // never there.
    expect(readHighlights(join(ROOT, 'does-not-exist'))).toEqual([]);
    expect(readHighlights(envelope('bad-json', '{"highlights": ['))).toEqual([]);
    expect(readHighlights(envelope('not-an-object', '"a string"'))).toEqual([]);
    expect(readHighlights(envelope('wrong-shape', { highlights: 'nope' }))).toEqual([]);
    expect(readHighlights(envelope('empty', { version: 1, highlights: [] }))).toEqual([]);
  });

  it('drops the entries that are not highlights and keeps the ones that are', () => {
    const dir = envelope('mixed', {
      highlights: [
        highlight('Torque the sprocket to 9 Nm'),
        { id: 'hl-empty', text: '   ' }, // no text at all
        null,
        'not even an object',
        highlight('Torque the sprocket to 9 Nm'), // a duplicate id
      ],
    });
    const got = readHighlights(dir);
    expect(got).toHaveLength(1);
  });

  it('accepts a bare array, which is what a hand-written file looks like', () => {
    const dir = envelope('bare', [highlight('Torque the sprocket to 9 Nm')]);
    expect(readHighlights(dir)).toHaveLength(1);
  });

  it('coerces a record with a wrong-typed anchor instead of rejecting it', () => {
    const got = normalizeHighlight({
      id: 'hl-1',
      text: 'Torque the sprocket to 9 Nm',
      anchor: 'this should have been an object',
    });
    expect(got?.anchor.quote).toBe('Torque the sprocket to 9 Nm');
    expect(got?.anchor.startChar).toBeUndefined();
  });
});

describe('locating a highlight in the extracted text', () => {
  it('finds a quote that is simply there', () => {
    const span = locate(EXTRACTED, { quote: 'Torque the sprocket to 9 Nm' });
    expect(EXTRACTED.slice(span?.startChar, span?.endChar)).toBe('Torque the sprocket to 9 Nm');
  });

  it('uses the neighbourhood when the offsets have drifted', () => {
    // The Readability pass dropped a nav bar, so every offset the browser
    // recorded is too large — but the words either side did not change.
    const span = locate(EXTRACTED, {
      quote: 'Torque the sprocket to 9 Nm',
      startChar: 99_999,
      prefix: '\n\n',
      suffix: ' on the bench',
    });
    expect(EXTRACTED.slice(span?.startChar, span?.endChar)).toBe('Torque the sprocket to 9 Nm');
  });

  it('uses the offset to choose between repeats of the same phrase', () => {
    const second = EXTRACTED.lastIndexOf('See below for the full procedure.');
    const span = locate(EXTRACTED, {
      quote: 'See below for the full procedure.',
      startChar: second - 3,
    });
    expect(span?.startChar).toBe(second);
  });

  it('gives no span for a quote the document does not contain', () => {
    // A highlight taken from a comment thread the Readability pass dropped.
    expect(locate(EXTRACTED, { quote: 'first!' })).toBeNull();
    expect(locate(EXTRACTED, { quote: '' })).toBeNull();
    expect(locate('', { quote: 'anything' })).toBeNull();
  });
});

describe('a highlight as a note', () => {
  it('is its own note, linked to the parent capture', () => {
    const [note] = highlightNotes(PARENT, [
      highlight('Torque the sprocket to 9 Nm', { comment: 'the number', color: 'green' }),
    ]);

    expect(note.text).toBe('Torque the sprocket to 9 Nm');
    expect(note.comment).toBe('the number');
    expect(note.createdAt).toBe('2026-09-21T10:00:00.000Z');
    expect(note.parentDocId).toBe(`global:${PARENT.filePath}`);
    expect(note.parentUrl).toBe(CANONICAL);
    expect(note.parentTitle).toBe('Sprocket Calibration');
    expect(note.capturedAt).toBe('2026-09-20T09:00:00.000Z');

    // Findable as a highlight, and traceable to its parent, without
    // parsing the content.
    expect(note.tags).toContain(HIGHLIGHT_TAG);
    expect(note.tags).toContain(`${PARENT_TAG_PREFIX}global:${PARENT.filePath}`);
    expect(note.tags).toContain(`${URL_TAG_PREFIX}${CANONICAL}`);
    expect(note.tags).toContain('color:green');
  });

  it('carries the reader’s comment and the source in the stored body', () => {
    const [note] = highlightNotes(PARENT, [
      highlight('Torque the sprocket to 9 Nm', { comment: 'check on the bench' }),
    ]);
    // A search hit has to be legible on its own, without a second lookup.
    expect(note.content).toContain('Torque the sprocket to 9 Nm');
    expect(note.content).toContain('Note: check on the bench');
    expect(note.content).toContain('Sprocket Calibration');
  });

  it('anchors against the extracted text, not the offsets the browser sent', () => {
    // The browser measured against the live DOM: these offsets are wrong
    // for `readable.md`, and a note that trusted them would quote the
    // wrong words.
    const [note] = highlightNotes(PARENT, [
      {
        id: 'hl-drifted',
        text: 'Torque the sprocket to 9 Nm',
        anchor: {
          quote: 'Torque the sprocket to 9 Nm',
          startChar: 41_200,
          endChar: 41_227,
          prefix: '',
          suffix: ' on the bench',
        },
      },
    ]);

    expect(note.anchor).toBeDefined();
    expect(note.startChar).toBe(EXTRACTED.indexOf('Torque the sprocket to 9 Nm'));
    // citation.ts's shape: offsets bound to the version they were cut
    // against, so a re-capture makes them detectably stale rather than
    // silently wrong.
    expect(note.anchor).toBe(
      `${PARENT.contentHash.slice(0, 12)}#${note.startChar}-${note.endChar}`,
    );
    expect(EXTRACTED.slice(note.startChar, note.endChar)).toBe('Torque the sprocket to 9 Nm');
  });

  it('gives no anchor at all to a quote the document does not contain', () => {
    const [note] = highlightNotes(PARENT, [highlight('first!')]);

    // Still a note — the reader did read it — but not offered as a
    // citation, because a citation that cannot be checked is worse than
    // none. Same rule citation.ts applies to a stale anchor.
    expect(note.text).toBe('first!');
    expect(note.anchor).toBeUndefined();
    expect(note.startChar).toBeUndefined();
  });

  it('links back to the live page at the passage', () => {
    const [fromExtension] = highlightNotes(PARENT, [
      highlight('Torque the sprocket to 9 Nm', { url: `${CANONICAL}#:~:text=Torque%20the` }),
    ]);
    expect(fromExtension.citeUrl).toBe(`${CANONICAL}#:~:text=Torque%20the`);

    // …and builds one the way citation.ts does when the extension did not.
    const [built] = highlightNotes(PARENT, [highlight('Torque the sprocket to 9 Nm')]);
    expect(built.citeUrl).toContain('#:~:text=');
    expect(built.citeUrl).toContain(CANONICAL);
  });

  it('stores notes unanchored when the parent’s text is not to hand', () => {
    const [note] = highlightNotes({ ...PARENT, text: undefined }, [
      highlight('Torque the sprocket to 9 Nm'),
    ]);
    expect(note.anchor).toBeUndefined();
    expect(note.text).toBe('Torque the sprocket to 9 Nm');
  });
});

describe('ingesting highlights', () => {
  it('stores one entry per highlight, keyed under the parent’s version', async () => {
    const result = await ingestHighlights(PARENT, {
      highlights: [
        highlight('Torque the sprocket to 9 Nm', { comment: 'the number' }),
        highlight('The tolerance band is plus or minus 0.2 Nm'),
      ],
    });

    expect(result.found).toBe(2);
    expect(result.stored).toBe(2);
    expect(result.anchored).toBe(2);
    expect(result.error).toBeUndefined();

    const keys = [...store.keys()];
    expect(keys).toHaveLength(2);
    for (const key of keys) expect(key).toContain(PARENT.contentHash);
    expect(store.get(highlightKey(PARENT.contentHash, 'hl-Torque'))?.value).toContain('the number');
  });

  it('re-ingesting the same version upserts rather than accumulating', async () => {
    const highlights = [highlight('Torque the sprocket to 9 Nm')];
    await ingestHighlights(PARENT, { highlights });
    await ingestHighlights(PARENT, { highlights });

    expect(store.size).toBe(1);
  });

  it('a re-captured page gets its own notes, keyed under the new version', async () => {
    const highlights = [highlight('Torque the sprocket to 9 Nm')];
    await ingestHighlights(PARENT, { highlights });
    await ingestHighlights({ ...PARENT, contentHash: 'aa11bb22cc33dd44' }, { highlights });

    // Two versions of the page, two sets of notes — each anchored to the
    // text it was actually measured against.
    expect(store.size).toBe(2);
  });

  it('reads the envelope when no highlights are passed', async () => {
    const dir = envelope('from-disk', {
      highlights: [highlight('Torque the sprocket to 9 Nm')],
    });
    const result = await ingestHighlights({ ...PARENT, filePath: join(dir, 'readable.md') });

    expect(result.found).toBe(1);
    expect(result.stored).toBe(1);
  });

  it('a capture with no highlights costs nothing and reports nothing wrong', async () => {
    const result = await ingestHighlights(PARENT, { highlights: [] });
    expect(result).toMatchObject({ found: 0, stored: 0, anchored: 0 });
    expect(result.error).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('reports a partial store instead of claiming success', async () => {
    failNext = 1;
    const result = await ingestHighlights(PARENT, {
      highlights: [
        highlight('Torque the sprocket to 9 Nm'),
        highlight('The tolerance band is plus or minus 0.2 Nm'),
      ],
    });

    expect(result.stored).toBe(1);
    expect(result.error).toContain('1/2');
    expect(result.error).toContain('re-ingest');
  });
});
