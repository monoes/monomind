/**
 * GLU-07 — captures as MCP resources.
 *
 * The story is "any agent I run can read from my brain without a bespoke
 * integration", and that only holds if four things are true, each pinned here:
 *
 *  - a capture has a STABLE uri that survives being re-captured, because a
 *    URI an agent wrote down last week must still name the same page after a
 *    new version landed;
 *  - listing is filterable and paginated, because a real library is thousands
 *    of pages and `resources/list` must not dump all of them;
 *  - a read carries provenance — url, title, capture time, version — inline
 *    with the text, because a model that has to make a second call to know
 *    where a quote came from will quote it uncited;
 *  - offsets and anchors come from `citation.ts`, so a passage read here and a
 *    `monomind doc cite` agree, including the `stale` flag when the file
 *    changed after it was indexed.
 *
 * The stores are real on-disk metadata logs under ~/scratch (never /tmp: the
 * shared tmpfs filled up and blocked a whole build). Nothing here touches the
 * memory bridge — resources read the metadata log and the captured file, which
 * is exactly what makes them cheap enough to serve on every list.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DocumentMeta } from '../knowledge/document-pipeline.js';
import {
  buildCaptureUri,
  CAPTURE_URI_TEMPLATE,
  captureIndexDescriptor,
  captureLibraryIndex,
  captureResourceDescriptor,
  captureScopes,
  captureUriFor,
  isCaptureUri,
  listCaptureResources,
  loadCaptureDocuments,
  parseCaptureUri,
} from '../mcp-tools/capture-resources.js';

// ── Fixture stores ─────────────────────────────────────────────────

const SCRATCH = process.env.MONOMIND_TEST_SCRATCH || join(os.homedir(), 'scratch');
fs.mkdirSync(SCRATCH, { recursive: true });
const ROOT = fs.mkdtempSync(join(SCRATCH, 'mm-capres-'));
const PROJ = join(ROOT, 'proj');
const GLOB = join(ROOT, 'glob');
const INBOX = join(ROOT, 'inbox');

const ORIGINAL_CWD = process.env.MONOMIND_CWD;
const ORIGINAL_GLOBAL = process.env.MONOMIND_GLOBAL_BRAIN_DIR;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function writeMetadata(root: string, records: DocumentMeta[]): void {
  const dir = join(root, '.monomind', 'knowledge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    join(dir, 'doc-metadata.jsonl'),
    `${records.map((r) => JSON.stringify(r)).join('\n')}\n`,
  );
}

/** A capture envelope on disk: readable.md + meta.json, as the contract says. */
function envelope(
  slug: string,
  url: string,
  title: string,
  body: string,
  extra: Record<string, unknown>,
): { filePath: string; meta: Record<string, unknown>; text: string } {
  const dir = join(INBOX, slug);
  fs.mkdirSync(dir, { recursive: true });
  const text = `# ${title}\n\n${body}\n`;
  fs.writeFileSync(join(dir, 'readable.md'), text);
  const meta = { url, canonicalUrl: url, title, httpStatus: 200, source: 'extension', ...extra };
  fs.writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
  return { filePath: join(dir, 'readable.md'), meta, text };
}

const SPROCKETS_URL = 'https://docs.example.com/sprockets/calibration';
const PRICING_URL = 'https://www.example.com/pricing';
const VITALS_URL = 'https://web.dev/vitals';

const sprockets = envelope(
  '2026-09-20-sprockets',
  SPROCKETS_URL,
  'Sprocket Calibration',
  // Long enough to chunk more than once (chunk size is 3200 characters).
  Array.from(
    { length: 60 },
    (_, i) =>
      `Paragraph ${i}: the calibration jig holds the sprocket at a fixed angle while the gauge sweeps the tooth profile, and the reading is logged.`,
  ).join('\n\n'),
  {
    capturedAt: '2026-09-20T09:00:00.000Z',
    tags: ['mechanics', 'reference'],
    collection: 'bench',
    byline: 'R. Mott',
  },
);
const pricing = envelope(
  '2026-09-14-pricing',
  PRICING_URL,
  'Pricing',
  'Starter is nine dollars a month. Team is twenty-nine dollars a month.',
  {
    capturedAt: '2026-09-14T09:00:00.000Z',
    tags: ['pricing'],
    collection: 'research',
    source: 'crawl',
  },
);
const vitals = envelope(
  '2026-09-21-vitals',
  VITALS_URL,
  'Web Vitals',
  'Largest Contentful Paint should land under two and a half seconds.',
  { capturedAt: '2026-09-21T08:00:00.000Z', tags: ['performance'], source: 'monobrowse' },
);

const LOCAL_DOC = join(PROJ, 'notes', 'architecture.md');

function record(
  filePath: string,
  text: string,
  over: Partial<DocumentMeta> & { scope: string },
): DocumentMeta {
  return {
    filePath,
    contentHash: sha256(text),
    chunkCount: 1,
    indexedAt: '2026-09-21T11:00:00.000Z',
    size: Buffer.byteLength(text),
    ...over,
  } as DocumentMeta;
}

beforeAll(() => {
  fs.mkdirSync(join(PROJ, '.monomind'), { recursive: true });
  fs.mkdirSync(join(PROJ, 'notes'), { recursive: true });
  fs.writeFileSync(LOCAL_DOC, '# Architecture\n\nThe pipeline is one way.\n');

  // Captures live in the personal global brain — `~/.monomind/inbox` is
  // outside any project, so that is where `doc ingest` routes them.
  writeMetadata(GLOB, [
    record(sprockets.filePath, sprockets.text, {
      scope: 'global',
      canonicalUrl: SPROCKETS_URL,
      version: 1,
      chunkCount: 3,
      provenance: sprockets.meta,
    } as Partial<DocumentMeta> & { scope: string }),
    // Version 2 of the same page: a second record, same canonicalUrl.
    record(sprockets.filePath, sprockets.text, {
      scope: 'global',
      canonicalUrl: SPROCKETS_URL,
      version: 2,
      chunkCount: 3,
      supersedes: sha256('older text'),
      provenance: sprockets.meta,
    } as Partial<DocumentMeta> & { scope: string }),
    record(pricing.filePath, pricing.text, {
      scope: 'global',
      canonicalUrl: PRICING_URL,
      version: 1,
      provenance: pricing.meta,
    } as Partial<DocumentMeta> & { scope: string }),
    record(vitals.filePath, vitals.text, {
      scope: 'global',
      canonicalUrl: VITALS_URL,
      version: 1,
      provenance: vitals.meta,
    } as Partial<DocumentMeta> & { scope: string }),
  ]);

  writeMetadata(PROJ, [
    record(LOCAL_DOC, fs.readFileSync(LOCAL_DOC, 'utf-8'), {
      scope: 'shared',
      indexedAt: '2026-09-19T10:00:00.000Z',
    }),
  ]);

  process.env.MONOMIND_CWD = PROJ;
  process.env.MONOMIND_GLOBAL_BRAIN_DIR = GLOB;
});

afterAll(() => {
  if (ORIGINAL_CWD === undefined) delete process.env.MONOMIND_CWD;
  else process.env.MONOMIND_CWD = ORIGINAL_CWD;
  if (ORIGINAL_GLOBAL === undefined) delete process.env.MONOMIND_GLOBAL_BRAIN_DIR;
  else process.env.MONOMIND_GLOBAL_BRAIN_DIR = ORIGINAL_GLOBAL;
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

// Synthetic records for the pure list/filter tests — no disk needed.
const doc = (over: Partial<DocumentMeta> & { filePath: string; scope: string }): DocumentMeta =>
  ({
    contentHash: 'h',
    chunkCount: 2,
    indexedAt: '2026-09-21T11:00:00.000Z',
    size: 1024,
    ...over,
  }) as DocumentMeta;

const cap = (slug: string, url: string, capturedAt: string, extra: Record<string, unknown> = {}) =>
  doc({
    filePath: `/inbox/${slug}/readable.md`,
    scope: 'global',
    canonicalUrl: url,
    version: 1,
    provenance: { url, canonicalUrl: url, title: slug, capturedAt, source: 'extension', ...extra },
  });

const DOCS: DocumentMeta[] = [
  cap('sprockets', SPROCKETS_URL, '2026-09-20T09:00:00.000Z', {
    tags: ['mechanics', 'reference'],
    collection: 'bench',
  }),
  cap('pricing', PRICING_URL, '2026-09-14T09:00:00.000Z', {
    tags: ['pricing'],
    collection: 'research',
    source: 'crawl',
  }),
  cap('vitals', VITALS_URL, '2026-09-21T08:00:00.000Z', { tags: ['performance'] }),
  doc({ filePath: '/repo/docs/architecture.md', scope: 'shared' }),
];

// ── URIs ───────────────────────────────────────────────────────────

describe('GLU-07 capture URIs', () => {
  it('keys on the page, not the path, so a re-capture keeps the same uri', () => {
    const v1 = captureUriFor(DOCS[0]);
    const v2 = captureUriFor(
      doc({
        filePath: '/inbox/2026-10-02-sprockets/readable.md',
        scope: 'global',
        canonicalUrl: SPROCKETS_URL,
        version: 2,
      }),
    );
    expect(v2).toBe(v1);
    expect(v1).toBe(`capture://global/${encodeURIComponent(SPROCKETS_URL)}`);
  });

  it('falls back to the file path for a document that is not a capture', () => {
    expect(captureUriFor(DOCS[3])).toBe(
      `capture://shared/${encodeURIComponent('/repo/docs/architecture.md')}`,
    );
  });

  it('round-trips scope, identity, version, chunk and anchor', () => {
    const uri = buildCaptureUri('global', SPROCKETS_URL);
    expect(parseCaptureUri(uri)).toEqual({ scope: 'global', identity: SPROCKETS_URL });
    expect(parseCaptureUri(buildCaptureUri('global', SPROCKETS_URL, { version: 3 }))).toEqual({
      scope: 'global',
      identity: SPROCKETS_URL,
      version: 3,
    });
    expect(parseCaptureUri(buildCaptureUri('global', SPROCKETS_URL, { chunkIndex: 2 }))).toEqual({
      scope: 'global',
      identity: SPROCKETS_URL,
      chunkIndex: 2,
    });
    const anchor = 'a1b2c3d4e5f6#100-3200';
    expect(parseCaptureUri(buildCaptureUri('global', SPROCKETS_URL, { anchor }))).toEqual({
      scope: 'global',
      identity: SPROCKETS_URL,
      anchor,
    });
  });

  it('survives a url with a query string, a space and a fragment', () => {
    const messy = 'https://example.com/a b?q=1&r=2';
    const uri = buildCaptureUri('global', messy);
    // One path segment: the registry matches templates with `[^/]+`, so an
    // un-escaped slash in the identity would make the uri unroutable.
    expect(uri.slice('capture://global/'.length)).not.toContain('/');
    expect(parseCaptureUri(uri)?.identity).toBe(messy);
  });

  it('names the scope index with no identity, and refuses foreign uris', () => {
    expect(parseCaptureUri('capture://global')).toEqual({ scope: 'global', identity: '' });
    expect(parseCaptureUri('monograph://repo/schema')).toBeNull();
    expect(parseCaptureUri('capture://global/%zz')).toBeNull();
    expect(parseCaptureUri('capture://global/x?v=0')).toBeNull();
    expect(isCaptureUri('capture://global/x')).toBe(true);
    expect(isCaptureUri('monograph://repo/schema')).toBe(false);
  });

  it('publishes a template a client can fill in', () => {
    expect(CAPTURE_URI_TEMPLATE).toBe('capture://{scope}/{identity}');
  });
});

// ── Listing ────────────────────────────────────────────────────────

describe('GLU-07 resource listing', () => {
  it('lists captures newest first and leaves ordinary files out', () => {
    const { resources, rows, total } = listCaptureResources(DOCS);
    expect(total).toBe(3);
    expect(rows.map((r) => r.title)).toEqual(['vitals', 'sprockets', 'pricing']);
    expect(resources.every((r) => r.mimeType === 'text/markdown')).toBe(true);
    expect(resources.map((r) => r.uri)).toEqual(rows.map((r) => r.uri));
    // The local markdown file is indexed, but it is not a capture.
    expect(rows.some((r) => r.filePath.endsWith('architecture.md'))).toBe(false);
  });

  it('includes ordinary documents only when asked', () => {
    const { total } = listCaptureResources(DOCS, { includeLocal: true });
    expect(total).toBe(4);
  });

  it('applies the library filters rather than reimplementing them', () => {
    expect(listCaptureResources(DOCS, { site: ['example.com'] }).total).toBe(2);
    expect(listCaptureResources(DOCS, { tag: ['pricing'] }).rows.map((r) => r.title)).toEqual([
      'pricing',
    ]);
    expect(listCaptureResources(DOCS, { collection: ['bench'] }).total).toBe(1);
    expect(listCaptureResources(DOCS, { source: ['crawl'] }).total).toBe(1);
    expect(
      listCaptureResources(DOCS, { since: '2026-09-19', now: Date.parse('2026-09-21T12:00:00Z') })
        .total,
    ).toBe(2);
  });

  it('describes a capture with the provenance an agent picks on', () => {
    const [first] = listCaptureResources(DOCS, { tag: ['mechanics'] }).resources;
    expect(first.name).toBe('sprockets');
    expect(first.description).toContain(SPROCKETS_URL);
    expect(first.description).toContain('2026-09-20');
    expect(first.description).toContain('mechanics');
  });

  it('paginates with an opaque cursor and stops at the end', () => {
    const page1 = listCaptureResources(DOCS, { pageSize: 2 });
    expect(page1.resources).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = listCaptureResources(DOCS, { pageSize: 2, cursor: page1.nextCursor });
    expect(page2.resources).toHaveLength(1);
    expect(page2.nextCursor).toBeUndefined();
    const seen = [...page1.rows, ...page2.rows].map((r) => r.title);
    expect(new Set(seen).size).toBe(3);
  });

  it('refuses a cursor cut against a different filter, instead of paging nonsense', () => {
    const page1 = listCaptureResources(DOCS, { pageSize: 1 });
    expect(() =>
      listCaptureResources(DOCS, { pageSize: 1, cursor: page1.nextCursor, tag: ['pricing'] }),
    ).toThrow(/cursor/i);
    expect(() => listCaptureResources(DOCS, { cursor: 'not-a-cursor' })).toThrow(/cursor/i);
  });

  it('offers one index resource per scope, with facet counts', () => {
    expect(captureScopes(DOCS)).toEqual(['global']);
    const index = captureIndexDescriptor('global', 3);
    expect(index.uri).toBe('capture://global');
    expect(index.mimeType).toBe('application/json');

    const payload = captureLibraryIndex(DOCS, 'global');
    expect(payload.total).toBe(3);
    expect(payload.facets.sites.map((s) => s.value)).toContain('docs.example.com');
    expect(payload.facets.tags.map((t) => t.value)).toContain('pricing');
    expect(payload.uriTemplate).toBe(CAPTURE_URI_TEMPLATE);
    expect(payload.latest[0].uri).toBe(captureUriFor(DOCS[2]));
  });

  it('reads both stores, because captures land in the global brain', async () => {
    const docs = await loadCaptureDocuments();
    const uris = new Set(docs.map((d) => captureUriFor(d)));
    expect(uris.has(buildCaptureUri('global', SPROCKETS_URL))).toBe(true);
    expect(uris.has(buildCaptureUri('shared', LOCAL_DOC))).toBe(true);
    // Last-wins per (filePath, scope): two versions of one page, one record.
    expect(docs.filter((d) => d.canonicalUrl === SPROCKETS_URL)).toHaveLength(1);
    expect(docs.find((d) => d.canonicalUrl === SPROCKETS_URL)?.version).toBe(2);

    const onlyGlobal = await loadCaptureDocuments({ store: 'global' });
    expect(onlyGlobal.some((d) => d.filePath === LOCAL_DOC)).toBe(false);
  });

  it('descriptor name never comes back empty, even with no title', () => {
    const d = captureResourceDescriptor(
      doc({ filePath: '/inbox/x/readable.md', scope: 'global', canonicalUrl: 'https://x.test/a' }),
    );
    expect(d.name.length).toBeGreaterThan(0);
  });
});

// ── Reading ────────────────────────────────────────────────────────

describe('GLU-07 resource read', () => {
  it('returns the readable markdown with provenance in front of it', async () => {
    const { readCapture } = await import('../mcp-tools/capture-resource-read.js');
    const uri = buildCaptureUri('global', SPROCKETS_URL);
    const out = await readCapture(uri);

    expect(out.uri).toBe(uri);
    expect(out.info.title).toBe('Sprocket Calibration');
    expect(out.info.url).toBe(SPROCKETS_URL);
    expect(out.info.capturedAt).toBe('2026-09-20T09:00:00.000Z');
    expect(out.info.version).toBe(2);
    expect(out.info.source).toBe('extension');
    expect(out.info.byline).toBe('R. Mott');
    expect(out.info.tags).toEqual(['mechanics', 'reference']);
    expect(out.info.stale).toBeUndefined();

    // Front matter first, then the document — and the offset that says where
    // the document starts, so the spans below stay meaningful.
    expect(out.markdown.startsWith('---\n')).toBe(true);
    expect(out.markdown).toContain(`url: ${SPROCKETS_URL}`);
    expect(out.markdown).toContain('version: 2');
    expect(out.markdown.slice(out.info.textStartsAt)).toBe(sprockets.text);
  });

  it('carries chunk spans and citation anchors bound to the version', async () => {
    const { readCapture } = await import('../mcp-tools/capture-resource-read.js');
    const { anchorMatchesHash } = await import('../knowledge/citation.js');
    const out = await readCapture(buildCaptureUri('global', SPROCKETS_URL));

    expect(out.info.chunks.length).toBeGreaterThan(1);
    const [first] = out.info.chunks;
    expect(first.chunkIndex).toBe(0);
    expect(first.startChar).toBe(0);
    expect(first.anchor).toMatch(/^[0-9a-f]{12}#\d+-\d+$/);
    expect(anchorMatchesHash(first.anchor, out.info.contentHash)).toBe(true);
    expect(out.info.chunks[1].uri).toBe(
      buildCaptureUri('global', SPROCKETS_URL, { chunkIndex: 1 }),
    );
  });

  it('reads one passage, with the link that lands on it', async () => {
    const { readCapture } = await import('../mcp-tools/capture-resource-read.js');
    const out = await readCapture(buildCaptureUri('global', SPROCKETS_URL, { chunkIndex: 1 }));
    expect(out.info.chunkIndex).toBe(1);
    expect(out.info.quote).toBeTruthy();
    expect(out.info.citeUrl).toContain('#:~:text=');
    expect(out.info.citeUrl?.startsWith(SPROCKETS_URL)).toBe(true);
    expect(out.markdown).toContain(out.info.quote as string);
    // A passage read is the passage, not the whole page.
    expect(out.markdown.length).toBeLessThan(sprockets.text.length);
  });

  it('resolves an anchor, and says so when it is stale', async () => {
    const { readCapture } = await import('../mcp-tools/capture-resource-read.js');
    const uri = buildCaptureUri('global', VITALS_URL, {
      anchor: `${'0'.repeat(12)}#0-10`,
    });
    const out = await readCapture(uri);
    expect(out.info.stale).toBe(true);
    expect(out.info.passage).toBe(vitals.text.slice(0, 10));
  });

  it('flags a document whose file changed after it was indexed', async () => {
    const { readCapture } = await import('../mcp-tools/capture-resource-read.js');
    fs.appendFileSync(pricing.filePath, '\nEnterprise is on request.\n');
    const out = await readCapture(buildCaptureUri('global', PRICING_URL));
    expect(out.info.stale).toBe(true);
    expect(out.info.contentHash).not.toBe(out.info.indexedContentHash);
  });

  it('serves a named version and lists the versions it knows', async () => {
    const { readCapture } = await import('../mcp-tools/capture-resource-read.js');
    const out = await readCapture(buildCaptureUri('global', SPROCKETS_URL, { version: 1 }));
    expect(out.info.version).toBe(1);
    expect(out.info.versions?.map((v) => v.version)).toEqual([1, 2]);
    await expect(
      readCapture(buildCaptureUri('global', SPROCKETS_URL, { version: 9 })),
    ).rejects.toThrow(/version 9/);
  });

  it('fails loudly on an unknown capture, a bad uri and a bad chunk', async () => {
    const { readCapture } = await import('../mcp-tools/capture-resource-read.js');
    await expect(readCapture('capture://global/https%3A%2F%2Fnope.test%2Fx')).rejects.toThrow(
      /not indexed|no capture/i,
    );
    await expect(readCapture('monograph://repo/schema')).rejects.toThrow(/capture uri/i);
    await expect(
      readCapture(buildCaptureUri('global', VITALS_URL, { chunkIndex: 99 })),
    ).rejects.toThrow(/chunk 99/);
  });

  it('serves the scope index as json', async () => {
    const { captureResourceContents } = await import('../mcp-tools/capture-resource-read.js');
    const { contents } = await captureResourceContents('capture://global');
    expect(contents).toHaveLength(1);
    expect(contents[0].mimeType).toBe('application/json');
    const payload = JSON.parse(contents[0].text);
    expect(payload.scope).toBe('global');
    expect(payload.total).toBeGreaterThanOrEqual(3);
  });

  it('serves a document as markdown plus a provenance json part', async () => {
    const { captureResourceContents } = await import('../mcp-tools/capture-resource-read.js');
    const uri = buildCaptureUri('global', VITALS_URL);
    const { contents } = await captureResourceContents(uri);
    expect(contents.map((c) => c.mimeType)).toEqual(['text/markdown', 'application/json']);
    expect(contents.every((c) => c.uri === uri)).toBe(true);
    const info = JSON.parse(contents[1].text);
    expect(info.url).toBe(VITALS_URL);
    expect(info.capturedAt).toBe('2026-09-21T08:00:00.000Z');
  });
});

// ── The MCP surface ────────────────────────────────────────────────

describe('GLU-07 resource router', () => {
  it('lists the monograph resources and the captures together', async () => {
    const { handleResourceMethod } = await import('../mcp-tools/resource-router.js');
    const res = (await handleResourceMethod('resources/list', {})) as {
      result: { resources: Array<{ uri: string }>; nextCursor?: string };
    };
    const uris = res.result.resources.map((r) => r.uri);
    expect(uris).toContain('monograph://repo/schema');
    expect(uris).toContain('capture://global');
    expect(uris).toContain(buildCaptureUri('global', VITALS_URL));
  });

  it('pages, and repeats neither the statics nor a capture', async () => {
    const { handleResourceMethod } = await import('../mcp-tools/resource-router.js');
    const first = (await handleResourceMethod('resources/list', { pageSize: 1 })) as {
      result: { resources: Array<{ uri: string }>; nextCursor?: string };
    };
    expect(first.result.nextCursor).toBeTruthy();
    const second = (await handleResourceMethod('resources/list', {
      cursor: first.result.nextCursor,
      pageSize: 1,
    })) as { result: { resources: Array<{ uri: string }> } };
    const firstUris = new Set(first.result.resources.map((r) => r.uri));
    expect(second.result.resources.some((r) => firstUris.has(r.uri))).toBe(false);
    expect(second.result.resources.some((r) => r.uri.startsWith('monograph://'))).toBe(false);
  });

  it('advertises the capture template', async () => {
    const { handleResourceMethod } = await import('../mcp-tools/resource-router.js');
    const res = (await handleResourceMethod('resources/templates/list', {})) as {
      result: { resourceTemplates: Array<{ uriTemplate: string }> };
    };
    expect(res.result.resourceTemplates.map((t) => t.uriTemplate)).toContain(CAPTURE_URI_TEMPLATE);
  });

  it('reads a capture and rejects an unknown uri with -32602', async () => {
    const { handleResourceMethod } = await import('../mcp-tools/resource-router.js');
    const ok = (await handleResourceMethod('resources/read', {
      uri: buildCaptureUri('global', VITALS_URL),
    })) as { result: { contents: Array<{ text: string }> } };
    expect(ok.result.contents[0].text).toContain('Largest Contentful Paint');

    const bad = (await handleResourceMethod('resources/read', { uri: 'nope://x' })) as {
      error: { code: number; message: string };
    };
    expect(bad.error.code).toBe(-32602);
    expect(bad.error.message).toMatch(/unknown resource/i);
  });

  it('is not the place other methods get answered', async () => {
    const { handleResourceMethod } = await import('../mcp-tools/resource-router.js');
    expect(await handleResourceMethod('tools/list', {})).toBeNull();
  });
});

// ── The tools, for clients that do not speak resources ─────────────

describe('GLU-07 capture tools', () => {
  const call = async (name: string, input: Record<string, unknown>) => {
    const { knowledgeTools } = await import('../mcp-tools/knowledge-tools.js');
    const tool = knowledgeTools.find((t) => t.name === name);
    if (!tool) throw new Error(`${name} is not registered in knowledgeTools`);
    const result = (await tool.handler(input)) as { content: Array<{ text?: string }> };
    return JSON.parse(String(result.content[0].text));
  };

  it('knowledge_captures browses the library and hands back resource uris', async () => {
    const out = await call('knowledge_captures', { tag: ['performance'] });
    expect(out.success).toBe(true);
    expect(out.total).toBe(1);
    expect(out.captures[0].uri).toBe(buildCaptureUri('global', VITALS_URL));
    expect(out.captures[0].url).toBe(VITALS_URL);
  });

  it('knowledge_captures reports facets and pages', async () => {
    const page1 = await call('knowledge_captures', { limit: 1, facets: true });
    expect(page1.captures).toHaveLength(1);
    expect(page1.nextCursor).toBeTruthy();
    expect(page1.facets.sources.length).toBeGreaterThan(0);
    const page2 = await call('knowledge_captures', { limit: 1, cursor: page1.nextCursor });
    expect(page2.captures[0].uri).not.toBe(page1.captures[0].uri);
  });

  it('knowledge_capture_read takes a uri or a plain url', async () => {
    const byUri = await call('knowledge_capture_read', {
      uri: buildCaptureUri('global', VITALS_URL),
    });
    expect(byUri.success).toBe(true);
    expect(byUri.markdown).toContain('Largest Contentful Paint');
    expect(byUri.capturedAt).toBe('2026-09-21T08:00:00.000Z');

    const byUrl = await call('knowledge_capture_read', { url: VITALS_URL });
    expect(byUrl.uri).toBe(byUri.uri);
  });

  it('knowledge_capture_read reports a failure instead of throwing', async () => {
    const out = await call('knowledge_capture_read', { url: 'https://nope.test/missing' });
    expect(out.success).toBe(false);
    expect(String(out.error)).toMatch(/not indexed|no capture/i);
  });
});
