/**
 * GLU-07 — the tool half of captures-as-resources.
 *
 * Resources are the point (`resource-router.ts`), but two things they cannot
 * do are worth a tool each:
 *
 *  - `resources/list` has no filter parameters in the protocol, and a library
 *    of thousands of pages needs "from this site, tagged that, since last
 *    week" rather than a cursor walk. `knowledge_captures` is that query, and
 *    it hands back the resource URI of every hit so the agent can switch to
 *    the resource surface for the actual read.
 *  - a client that does not implement resources at all still deserves the
 *    provenance-carrying read: `knowledge_capture_read`.
 *
 * Both are thin: the work lives in `capture-resources.ts`, `library.ts` and
 * `citation.ts`.
 *
 * @module v1/cli/mcp-tools/capture-resource-tools
 */

import type { MCPTool, MCPToolResult } from './types.js';

const json = (data: unknown, isError = false): MCPToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  ...(isError ? { isError: true } : {}),
});

const fail = (error: string): MCPToolResult => json({ success: false, error }, true);

/** A repeated string filter, from a string or an array of them. */
function strList(value: unknown): string[] | undefined {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const out = items.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return out.length ? out : undefined;
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const MAX_TARGET_CHARS = 2048;

const knowledgeCaptures: MCPTool = {
  name: 'knowledge_captures',
  description:
    'Browse captured pages in the second brain (the MCP `capture://` resources), filtered by ' +
    'site, tag, collection, source or capture date. Returns each page with its resource URI, ' +
    'title, URL, capture time and version — read one with knowledge_capture_read or by ' +
    'reading its resource URI directly. Searches both the project store and the personal ' +
    'global brain, which is where browser captures land.',
  category: 'knowledge',
  tags: ['captures', 'library', 'resources', 'second-brain'],
  inputSchema: {
    type: 'object',
    properties: {
      site: {
        type: 'array',
        items: { type: 'string' },
        description: 'Host, or a parent domain of it (example.com matches docs.example.com)',
      },
      tag: { type: 'array', items: { type: 'string' }, description: 'Capture tags (OR)' },
      collection: { type: 'array', items: { type: 'string' }, description: 'Collections (OR)' },
      source: {
        type: 'array',
        items: { type: 'string' },
        description: "'extension' | 'monobrowse' | 'crawl'",
      },
      since: { type: 'string', description: 'ISO date/time, or an age: 7d, 24h, 30m' },
      until: { type: 'string', description: 'ISO date/time, or an age' },
      text: { type: 'string', description: 'Substring over title, URL, path and note' },
      scope: { type: 'string', description: 'Knowledge scope (e.g. global, shared)' },
      store: { type: 'string', description: "'project' | 'global' | 'all' (default: all)" },
      sort: { type: 'string', description: 'captured (default) | indexed | title | path | size' },
      order: { type: 'string', description: "'desc' (default) | 'asc'" },
      limit: { type: 'number', description: 'Page size (default 50, max 200)' },
      cursor: { type: 'string', description: 'nextCursor from a previous call' },
      includeLocal: {
        type: 'boolean',
        description: 'Also list ordinary indexed files, which are not captures',
      },
      facets: { type: 'boolean', description: 'Include site/tag/collection/source counts' },
    },
  },
  handler: async (input): Promise<MCPToolResult> => {
    try {
      const { listCaptureResources, loadCaptureDocuments, selectCaptureDocuments } = await import(
        './capture-resources.js'
      );
      const store = str(input.store);
      const docs = await loadCaptureDocuments(
        store === 'project' || store === 'global' || store === 'all' ? { store } : {},
      );

      const opts = {
        ...(strList(input.site) ? { site: strList(input.site) } : {}),
        ...(strList(input.tag) ? { tag: strList(input.tag) } : {}),
        ...(strList(input.collection) ? { collection: strList(input.collection) } : {}),
        ...(strList(input.source) ? { source: strList(input.source) } : {}),
        ...(str(input.since) ? { since: str(input.since) } : {}),
        ...(str(input.until) ? { until: str(input.until) } : {}),
        ...(str(input.text) ? { text: str(input.text) } : {}),
        ...(str(input.scope) ? { scope: str(input.scope) } : {}),
        ...(str(input.sort) ? { sort: str(input.sort) as 'captured' } : {}),
        ...(input.order === 'asc' ? { order: 'asc' as const } : {}),
        ...(typeof input.limit === 'number' ? { pageSize: input.limit } : {}),
        ...(str(input.cursor) ? { cursor: str(input.cursor) } : {}),
        ...(input.includeLocal === true ? { includeLocal: true } : {}),
      };

      const page = listCaptureResources(docs, opts);
      const body: Record<string, unknown> = {
        success: true,
        total: page.total,
        captures: page.rows,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
      if (input.facets === true) {
        const { libraryFacets } = await import('../knowledge/library.js');
        body.facets = libraryFacets(selectCaptureDocuments(docs, opts));
      }
      return json(body);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
};

const knowledgeCaptureRead: MCPTool = {
  name: 'knowledge_capture_read',
  description:
    'Read one captured page with its provenance: the readable Markdown plus url, title, ' +
    'capture time, version and citation anchors, so a quote can be cited. Takes a ' +
    'capture:// resource URI, or the page URL / indexed file path. `chunk` or `anchor` ' +
    'returns one passage with a link that lands on it; a passage or page whose file ' +
    'changed since it was indexed comes back flagged stale.',
  category: 'knowledge',
  tags: ['captures', 'citation', 'provenance', 'second-brain'],
  inputSchema: {
    type: 'object',
    properties: {
      uri: { type: 'string', description: 'capture://<scope>/<percent-encoded url>' },
      url: { type: 'string', description: 'The page URL or indexed file path, instead of a uri' },
      version: { type: 'number', description: 'A stored version (default: the current one)' },
      chunk: { type: 'number', description: 'Return only this chunk, as a citable passage' },
      anchor: { type: 'string', description: 'Citation anchor <hash12>#<start>-<end>' },
      maxChars: { type: 'number', description: 'Truncate the document text (default 200000)' },
      includeText: {
        type: 'boolean',
        description: 'Include the Markdown itself (default true)',
      },
    },
  },
  handler: async (input): Promise<MCPToolResult> => {
    try {
      const { buildCaptureUri, isCaptureUri, parseCaptureUri } = await import(
        './capture-resources.js'
      );
      const { readCapture, resolveCaptureUri } = await import('./capture-resource-read.js');

      const rawUri = str(input.uri);
      const target = str(input.url);
      if (!rawUri && !target) return fail('pass either uri or url');
      if ((rawUri ?? target ?? '').length > MAX_TARGET_CHARS) {
        return fail(`uri/url is longer than ${MAX_TARGET_CHARS} characters`);
      }

      let uri = rawUri;
      if (!uri) {
        uri = await resolveCaptureUri(target as string);
        if (!uri) return fail(`not indexed: ${target}`);
      } else if (!isCaptureUri(uri)) {
        return fail(`not a capture uri: ${uri}`);
      }

      // Extras given as arguments win over anything already in the uri.
      const parsed = parseCaptureUri(uri);
      if (!parsed) return fail(`malformed capture uri: ${uri}`);
      const extras = {
        ...(typeof input.version === 'number' ? { version: input.version } : {}),
        ...(typeof input.chunk === 'number' ? { chunkIndex: input.chunk } : {}),
        ...(str(input.anchor) ? { anchor: str(input.anchor) } : {}),
      };
      const finalUri = Object.keys(extras).length
        ? buildCaptureUri(parsed.scope, parsed.identity, extras)
        : uri;

      const read = await readCapture(finalUri, {
        ...(typeof input.maxChars === 'number' ? { maxChars: input.maxChars } : {}),
      });
      return json({
        success: true,
        ...read.info,
        ...(input.includeText === false ? {} : { markdown: read.markdown }),
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
};

export const captureResourceTools: MCPTool[] = [knowledgeCaptures, knowledgeCaptureRead];
