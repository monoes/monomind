/**
 * MCP 2026-07-28 ("modern", stateless) additions for the stdio entry points.
 *
 * Dependency-free on purpose: bin/cli.js (the fast path a bare
 * `monomind mcp start` runs) imports it from dist/ and must stay cheap.
 *
 * Everything here is additive. The `initialize` handshake is untouched, so
 * legacy clients keep working; a modern client that skips it is served
 * statelessly. Spec: modelcontextprotocol.io/specification/2026-07-28
 * (basic/versioning, server/discover, server/utilities/caching).
 */

export const MODERN_PROTOCOL_VERSION = '2026-07-28';
export const SUPPORTED_MODERN_VERSIONS = [MODERN_PROTOCOL_VERSION];

/** JSON-RPC code for UnsupportedProtocolVersionError (spec range -32020..-32099). */
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

const VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

/**
 * Caching hints (SEP-2549). The tool roster is fixed for the life of a stdio
 * process and identical for every caller, so "public"; the TTL stays short
 * because this server cannot push list_changed to a stateless client.
 */
export const CACHE_TTL_MS = 60_000;

export type CacheScope = 'public' | 'private';

/** `resources/read` returns local user data, so callers pass 'private' for it. */
export function withCacheHints<T extends object>(
  result: T,
  cacheScope: CacheScope = 'public',
): T & { ttlMs: number; cacheScope: CacheScope } {
  return { ...result, ttlMs: CACHE_TTL_MS, cacheScope };
}

interface ServerIdentity {
  name: string;
  version: string;
}

export function buildDiscoverResult(
  serverInfo: ServerIdentity,
  capabilities: Record<string, unknown>,
) {
  return withCacheHints({
    resultType: 'complete',
    supportedVersions: SUPPORTED_MODERN_VERSIONS,
    capabilities,
    _meta: { [SERVER_INFO_META_KEY]: serverInfo },
  });
}

/**
 * A request that declares a modern protocol version this server does not
 * implement must get UnsupportedProtocolVersionError. Requests that carry no
 * such declaration (every legacy client) return null and are served as before.
 */
export function checkRequestedVersion(
  params: unknown,
): { code: number; message: string; data: { supported: string[]; requested: unknown } } | null {
  const meta = (params as { _meta?: Record<string, unknown> } | null | undefined)?._meta;
  if (!meta || typeof meta !== 'object' || !(VERSION_META_KEY in meta)) return null;
  const requested = meta[VERSION_META_KEY];
  if (typeof requested === 'string' && SUPPORTED_MODERN_VERSIONS.includes(requested)) return null;
  return {
    code: UNSUPPORTED_PROTOCOL_VERSION,
    message: 'Unsupported protocol version',
    data: { supported: SUPPORTED_MODERN_VERSIONS, requested },
  };
}
