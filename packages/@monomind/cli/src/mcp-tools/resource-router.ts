/**
 * The MCP `resources/*` surface, in one place (GLU-07).
 *
 * There are THREE stdio loops in this package — `bin/cli.js`'s fast path (what
 * a client spawning a bare `monomind mcp start` actually runs), `bin/mcp-server.js`,
 * and `MCPServerManager.startStdioServer` — and all three advertise a
 * `resources` capability. Only one of them implemented `resources/list`, and
 * none of them knew about captures. Putting the handling here and delegating
 * from all three is the difference between "the brain is browsable" and "the
 * brain is browsable if you happen to have started the server the right way".
 *
 * What is served:
 *
 *   monograph://repo/…      the code-graph exports (unchanged, moved here)
 *   capture://<scope>       a capture library index: facets + newest pages
 *   capture://<scope>/<id>  one captured page — see `capture-resources.ts`
 *
 * NOT served: `resources/subscribe`. The capability is advertised by all three
 * stdio loops, but none of them has a channel for server-initiated
 * notifications, so a subscription would be accepted and then never fire. The
 * HTTP/WebSocket server in `@monoes/mcp` does implement subscribe/notify for
 * real; the stdio paths now advertise `subscribe: false` rather than promise
 * something they cannot do.
 *
 * @module v1/cli/mcp-tools/resource-router
 */

import {
  CAPTURE_INDEX_URI_TEMPLATE,
  CAPTURE_JSON_MIME_TYPE,
  CAPTURE_MIME_TYPE,
  CAPTURE_URI_TEMPLATE,
  type CaptureResourceDescriptor,
  captureIndexDescriptor,
  captureScopes,
  isCaptureUri,
  type ListCaptureResourcesOptions,
  listCaptureResources,
  loadCaptureDocuments,
} from './capture-resources.js';

export interface ResourceDescriptor {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface JsonRpcError {
  code: number;
  message: string;
}

export type ResourceResponse = { result: unknown } | { error: JsonRpcError } | null;

/** The code-graph resources, unchanged from when they lived in mcp-server.ts. */
export const MONOGRAPH_RESOURCES: ResourceDescriptor[] = [
  {
    uri: 'monograph://repo/processes',
    name: 'Processes',
    description: 'All detected Process nodes with their steps',
    mimeType: 'application/json',
  },
  {
    uri: 'monograph://repo/communities',
    name: 'Communities',
    description: 'All community clusters with member symbols',
    mimeType: 'application/json',
  },
  {
    uri: 'monograph://repo/schema',
    name: 'Schema',
    description: 'Graph schema: node labels, edge relations, counts',
    mimeType: 'application/json',
  },
  {
    uri: 'monograph://repo/graph',
    name: 'Graph',
    description: 'Full graph export (nodes + edges, up to 2000 nodes)',
    mimeType: 'application/json',
  },
];

/** A message that names something the caller got wrong, rather than something
 *  that went wrong on our side — the difference between -32602 and -32603. */
const CALLER_ERROR =
  /not indexed|not a capture uri|malformed|is not recorded|out of range|library index|invalid cursor|drop either/i;

function errorFor(err: unknown): JsonRpcError {
  const message = err instanceof Error ? err.message : String(err);
  return { code: CALLER_ERROR.test(message) ? -32602 : -32603, message };
}

// ── list ───────────────────────────────────────────────────────────

export interface ListResourcesParams extends Record<string, unknown> {
  cursor?: string;
  /** Non-standard, honoured when a caller sets it: captures per page. */
  pageSize?: number;
  /** Non-standard: the library filters from `library.ts`, so a client that
   *  can pass them does not have to page through the whole brain. */
  filter?: ListCaptureResourcesOptions;
}

/**
 * `resources/list`.
 *
 * The fixed resources (the code graph, one library index per scope) are the
 * head of the FIRST page only; `cursor` pages through captures alone, so a
 * client walking to the end never sees a static entry twice.
 */
export async function listResources(params: ListResourcesParams = {}): Promise<{
  resources: ResourceDescriptor[];
  nextCursor?: string;
  total: number;
}> {
  const docs = await loadCaptureDocuments();
  const opts: ListCaptureResourcesOptions = {
    ...(params.filter ?? {}),
    ...(typeof params.pageSize === 'number' ? { pageSize: params.pageSize } : {}),
    ...(params.cursor ? { cursor: params.cursor } : {}),
  };
  const page = listCaptureResources(docs, opts);

  const head: CaptureResourceDescriptor[] = [];
  if (!params.cursor) {
    head.push(...MONOGRAPH_RESOURCES);
    for (const scope of captureScopes(docs)) {
      head.push(
        captureIndexDescriptor(
          scope,
          listCaptureResources(docs, { ...(params.filter ?? {}), scope, pageSize: 1 }).total,
        ),
      );
    }
  }

  return {
    resources: [...head, ...page.resources],
    total: page.total,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

export function listResourceTemplates(): {
  resourceTemplates: Array<{
    uriTemplate: string;
    name: string;
    description: string;
    mimeType: string;
  }>;
} {
  return {
    resourceTemplates: [
      {
        uriTemplate: CAPTURE_URI_TEMPLATE,
        name: 'Captured page',
        description:
          'A captured page from the second brain. `scope` is `global` for the personal ' +
          'brain (where browser captures land) or a project scope; `identity` is the ' +
          "page's canonical URL, percent-encoded. Add `?v=<n>` for a stored version, " +
          '`?chunk=<n>` or `?anchor=<hash12>%23<start>-<end>` for one citable passage.',
        mimeType: CAPTURE_MIME_TYPE,
      },
      {
        uriTemplate: CAPTURE_INDEX_URI_TEMPLATE,
        name: 'Capture library index',
        description:
          'Facet counts (sites, tags, collections, sources) and the newest captures in ' +
          'one scope — what to read before paging through the library.',
        mimeType: CAPTURE_JSON_MIME_TYPE,
      },
    ],
  };
}

// ── read ───────────────────────────────────────────────────────────

async function readMonographResource(
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const { join } = await import('node:path');
  const {
    closeDb,
    getCommunitiesResource,
    getGraphResource,
    getProcessesResource,
    getSchemaResource,
    openDb,
  } = await import('@monoes/monograph');
  const projectCwd = process.env.MONOMIND_CWD || process.cwd();
  const db = openDb(join(projectCwd, '.monomind', 'monograph.db'));
  let data: unknown;
  try {
    switch (uri) {
      case 'monograph://repo/processes':
        data = getProcessesResource(db);
        break;
      case 'monograph://repo/communities':
        data = getCommunitiesResource(db);
        break;
      case 'monograph://repo/schema':
        data = getSchemaResource(db);
        break;
      case 'monograph://repo/graph':
        data = getGraphResource(db);
        break;
      default:
        throw new Error(`Unknown resource URI: ${uri}`);
    }
  } finally {
    closeDb(db);
  }
  return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }] };
}

export async function readResource(
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  if (isCaptureUri(uri)) {
    const { captureResourceContents } = await import('./capture-resource-read.js');
    return await captureResourceContents(uri);
  }
  if (uri.startsWith('monograph://')) return await readMonographResource(uri);
  throw new Error(`Unknown resource URI: ${uri}`);
}

// ── the JSON-RPC entry point the three stdio loops share ───────────

/**
 * Answer a `resources/*` method, or return null when it is not one — the
 * caller then falls through to its own switch. Never throws: a failed read
 * comes back as a JSON-RPC error object.
 */
export async function handleResourceMethod(
  method: string,
  params: Record<string, unknown> = {},
): Promise<ResourceResponse> {
  try {
    switch (method) {
      case 'resources/list':
        return { result: await listResources(params as ListResourcesParams) };
      case 'resources/templates/list':
        return { result: listResourceTemplates() };
      case 'resources/read': {
        const uri = typeof params.uri === 'string' ? params.uri : '';
        if (!uri)
          return { error: { code: -32602, message: 'Invalid params.uri: expected a string' } };
        if (!isCaptureUri(uri) && !uri.startsWith('monograph://')) {
          return { error: { code: -32602, message: `Unknown resource URI: ${uri}` } };
        }
        return { result: await readResource(uri) };
      }
      default:
        return null;
    }
  } catch (err) {
    return { error: errorFor(err) };
  }
}
