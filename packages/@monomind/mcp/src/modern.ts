/**
 * @monoes/mcp - MCP 2026-07-28 ("modern", stateless) additions.
 *
 * Additive only: the `initialize` handshake and session handling are
 * untouched, so legacy clients behave exactly as before. A request that
 * declares the modern protocol version in `_meta` is served without a prior
 * `initialize`. Spec: modelcontextprotocol.io/specification/2026-07-28
 * (basic/versioning, server/discover, server/utilities/caching,
 * basic/transports/streamable-http#server-validation).
 */

export const MODERN_PROTOCOL_VERSION = '2026-07-28';
export const SUPPORTED_MODERN_VERSIONS = [MODERN_PROTOCOL_VERSION];

/** Spec-reserved JSON-RPC codes (-32020..-32099). */
export const HEADER_MISMATCH = -32020;
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

const VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

/** Short TTL: change notifications need a subscription a stateless client may not hold. */
export const CACHE_TTL_MS = 60_000;

export type CacheScope = 'public' | 'private';

export function withCacheHints<T extends object>(
  result: T,
  cacheScope: CacheScope = 'public',
): T & { resultType: 'complete'; ttlMs: number; cacheScope: CacheScope } {
  return { ...result, resultType: 'complete', ttlMs: CACHE_TTL_MS, cacheScope };
}

function requestedVersion(params: unknown): { present: boolean; value?: unknown } {
  const meta = (params as { _meta?: Record<string, unknown> } | null | undefined)?._meta;
  if (!meta || typeof meta !== 'object' || !(VERSION_META_KEY in meta)) return { present: false };
  return { present: true, value: meta[VERSION_META_KEY] };
}

/** True when the request declares a modern version this server implements. */
export function isModernRequest(params: unknown): boolean {
  const v = requestedVersion(params);
  return v.present && typeof v.value === 'string' && SUPPORTED_MODERN_VERSIONS.includes(v.value);
}

/** UnsupportedProtocolVersionError for a declared-but-unknown version; null otherwise. */
export function checkRequestedVersion(
  params: unknown,
): { code: number; message: string; data: { supported: string[]; requested: unknown } } | null {
  const v = requestedVersion(params);
  if (!v.present || isModernRequest(params)) return null;
  return {
    code: UNSUPPORTED_PROTOCOL_VERSION,
    message: 'Unsupported protocol version',
    data: { supported: SUPPORTED_MODERN_VERSIONS, requested: v.value },
  };
}

export function buildDiscoverResult(
  serverInfo: { name: string; version: string },
  capabilities: object,
) {
  return withCacheHints({
    supportedVersions: SUPPORTED_MODERN_VERSIONS,
    capabilities,
    _meta: { [SERVER_INFO_META_KEY]: serverInfo },
  });
}

/** Header value of a standard request header, base64 sentinel decoded. */
function decodeHeader(value: string): string {
  const m = /^=\?base64\?(.*)\?=$/.exec(value);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : value;
}

/**
 * Server validation for the Streamable HTTP request headers. Only headers that
 * are actually present are checked, so legacy clients (which send none) are
 * unaffected. Returns an error message for a HeaderMismatch (HTTP 400), or null.
 */
export function validateModernHeaders(
  headers: Record<string, string | string[] | undefined>,
  body: { method?: unknown; params?: unknown },
): string | null {
  const first = (name: string): string | undefined => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const method = first('mcp-method');
  if (method !== undefined && method !== body.method) {
    return `Header mismatch: Mcp-Method header value '${method}' does not match body value '${String(body.method)}'`;
  }

  const name = first('mcp-name');
  if (name !== undefined) {
    const p = (body.params ?? {}) as { name?: unknown; uri?: unknown };
    const expected = body.method === 'resources/read' ? p.uri : p.name;
    if (decodeHeader(name) !== expected) {
      return `Header mismatch: Mcp-Name header value '${name}' does not match body value '${String(expected)}'`;
    }
  }

  const version = first('mcp-protocol-version');
  const declared = requestedVersion(body.params);
  if (version !== undefined && declared.present && version !== declared.value) {
    return `Header mismatch: MCP-Protocol-Version header value '${version}' does not match body value '${String(declared.value)}'`;
  }
  return null;
}
