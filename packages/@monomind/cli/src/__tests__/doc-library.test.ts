/**
 * RCL-09 — library filters.
 *
 * Browsing captures is a different question from searching them, and these
 * are the rules that make the answers predictable: OR inside a facet, AND
 * across facets, a bare domain covering its subdomains, capture time (not
 * index time) as the clock, and a local file never masquerading as a capture.
 *
 * Pure over `DocumentMeta`, so no store and no bridge — the GUI and the CLI
 * both call these functions with records they already hold.
 */

import { describe, expect, it } from 'vitest';
import type { DocumentMeta } from '../knowledge/document-pipeline.js';
import {
  documentCapturedAt,
  documentSite,
  filterDocuments,
  libraryEntry,
  libraryFacets,
  listLibrary,
  matchesLibraryFilter,
  parseWhen,
  sortDocuments,
} from '../knowledge/library.js';

const NOW = Date.parse('2026-09-21T12:00:00.000Z');

function doc(over: Partial<DocumentMeta> & { filePath: string }): DocumentMeta {
  return {
    contentHash: 'h',
    chunkCount: 3,
    indexedAt: '2026-09-21T11:00:00.000Z',
    scope: 'shared',
    size: 2048,
    ...over,
  } as DocumentMeta;
}

const capture = (
  name: string,
  url: string,
  capturedAt: string,
  extra: Record<string, unknown> = {},
) =>
  doc({
    filePath: `/inbox/${name}/readable.md`,
    canonicalUrl: url,
    provenance: {
      url,
      canonicalUrl: url,
      title: name,
      capturedAt,
      source: 'extension',
      ...extra,
    },
  });

const DOCS: DocumentMeta[] = [
  capture('sprockets', 'https://docs.example.com/sprockets', '2026-09-20T09:00:00.000Z', {
    tags: ['mechanics', 'reference'],
    collection: 'bench',
  }),
  capture('pricing', 'https://www.example.com/pricing', '2026-09-14T09:00:00.000Z', {
    tags: ['pricing'],
    collection: 'research',
    source: 'crawl',
  }),
  capture('vitals', 'https://web.dev/vitals', '2026-09-21T08:00:00.000Z', {
    tags: ['performance'],
    source: 'monobrowse',
  }),
  doc({ filePath: '/repo/docs/architecture.md', indexedAt: '2026-09-19T10:00:00.000Z' }),
];

describe('RCL-09 facets', () => {
  it('reads site and capture time off provenance, and tolerates neither', () => {
    expect(documentSite(DOCS[0])).toBe('docs.example.com');
    expect(documentSite(DOCS[1])).toBe('example.com'); // www. is not a site of its own
    expect(documentSite(DOCS[3])).toBeUndefined();
    expect(documentSite({ canonicalUrl: 'not a url' })).toBeUndefined();
    expect(documentCapturedAt(DOCS[2])).toBe('2026-09-21T08:00:00.000Z');
    // A local file has no capture time — it falls back to when it was indexed.
    expect(documentCapturedAt(DOCS[3])).toBe('2026-09-19T10:00:00.000Z');
  });

  it('parses a date, an ISO stamp and a relative age, and refuses a typo', () => {
    expect(parseWhen('2026-09-20', NOW)).toBe(Date.parse('2026-09-20T00:00:00.000Z'));
    expect(parseWhen('2026-09-20T06:30:00.000Z', NOW)).toBe(Date.parse('2026-09-20T06:30:00.000Z'));
    expect(parseWhen('7d', NOW)).toBe(NOW - 7 * 86_400_000);
    expect(parseWhen('36h', NOW)).toBe(NOW - 36 * 3_600_000);
    expect(parseWhen('last tuesday', NOW)).toBeNull();
    expect(parseWhen(undefined, NOW)).toBeNull();
  });

  it('counts facets for a sidebar', () => {
    const facets = libraryFacets(DOCS);
    expect(facets.sites.map((s) => s.value)).toEqual([
      'docs.example.com',
      'example.com',
      'web.dev',
    ]);
    expect(facets.sources).toContainEqual({ value: 'extension', count: 1 });
    expect(facets.tags.length).toBe(4);
    expect(facets.collections.map((c) => c.value).sort()).toEqual(['bench', 'research']);
  });
});

describe('RCL-09 filtering', () => {
  it('ORs within a facet and ANDs across facets', () => {
    const sites = filterDocuments(DOCS, { site: ['example.com', 'web.dev'] }, NOW);
    expect(sites.map((d) => d.provenance?.title)).toEqual(['sprockets', 'pricing', 'vitals']);

    // A bare domain covers its subdomains; adding a second facet narrows.
    const narrowed = filterDocuments(DOCS, { site: ['example.com'], tag: ['pricing'] }, NOW);
    expect(narrowed.map((d) => d.provenance?.title)).toEqual(['pricing']);
    expect(filterDocuments(DOCS, { site: ['ample.com'] }, NOW)).toEqual([]);
  });

  it('filters by capture date range, not index date', () => {
    const recent = filterDocuments(DOCS, { since: '2d' }, NOW);
    expect(recent.map((d) => d.provenance?.title)).toEqual(['sprockets', 'vitals']);
    // A local file has no capture time, so a date window judges it by when it
    // was indexed — it is still in the library, just not a capture.
    const window = filterDocuments(
      DOCS,
      { since: '2026-09-14', until: '2026-09-20T23:59:59.000Z' },
      NOW,
    );
    expect(window.map((d) => d.provenance?.title ?? 'architecture.md')).toEqual([
      'sprockets',
      'pricing',
      'architecture.md',
    ]);
    expect(
      filterDocuments(
        DOCS,
        { since: '2026-09-14', until: '2026-09-20T23:59:59.000Z', capturedOnly: true },
        NOW,
      ),
    ).toHaveLength(2);
  });

  it('filters by tag, collection and source, and separates captures from files', () => {
    expect(filterDocuments(DOCS, { tag: ['MECHANICS'] }, NOW)).toHaveLength(1);
    expect(filterDocuments(DOCS, { collection: ['research'] }, NOW)).toHaveLength(1);
    expect(filterDocuments(DOCS, { source: ['crawl', 'monobrowse'] }, NOW)).toHaveLength(2);
    expect(filterDocuments(DOCS, { capturedOnly: true }, NOW)).toHaveLength(3);
    // The local file matches no capture facet at all.
    expect(matchesLibraryFilter(DOCS[3], { source: ['extension'] }, NOW)).toBe(false);
    expect(matchesLibraryFilter(DOCS[3], {}, NOW)).toBe(true);
  });

  it('matches text across title, url and path', () => {
    expect(filterDocuments(DOCS, { text: 'sprock' }, NOW)).toHaveLength(1);
    expect(filterDocuments(DOCS, { text: 'architecture' }, NOW)).toHaveLength(1);
  });
});

describe('RCL-09 listing', () => {
  it('sorts by capture time, newest first, and caps', () => {
    const rows = listLibrary(DOCS, { capturedOnly: true, limit: 2, now: NOW });
    expect(rows.map((r) => r.title)).toEqual(['vitals', 'sprockets']);
    const asc = sortDocuments(DOCS, 'captured', 'asc').map((d) => d.filePath);
    expect(asc[0]).toBe('/inbox/pricing/readable.md');
    expect(
      sortDocuments(DOCS, 'title').map((d) => d.provenance?.title ?? 'architecture.md')[0],
    ).toBe('vitals');
  });

  it('projects a JSON row the GUI can render', () => {
    const row = libraryEntry(DOCS[0]);
    expect(row).toMatchObject({
      title: 'sprockets',
      url: 'https://docs.example.com/sprockets',
      site: 'docs.example.com',
      capturedAt: '2026-09-20T09:00:00.000Z',
      source: 'extension',
      collection: 'bench',
      tags: ['mechanics', 'reference'],
      captured: true,
    });
    const local = libraryEntry(DOCS[3]);
    expect(local.captured).toBe(false);
    expect(local.title).toBe('architecture.md');
    expect(local.url).toBeUndefined();
  });

  it('is empty, not broken, with nothing indexed', () => {
    expect(listLibrary([], { site: ['example.com'] })).toEqual([]);
  });
});
