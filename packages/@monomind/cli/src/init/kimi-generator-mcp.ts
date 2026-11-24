/**
 * kimi-code MCP config generation (.kimi-code/mcp.json).
 * File-size sweep: split out of kimi-generator.ts.
 */

import { MCP_NPM_ENV, mcpServerEntry } from '../platform-adapters/renderers/mcp.js';
import type { InitOptions } from './types.js';

/** Platform-specific pinned npx invocation, shared with mcp-generator.ts. */
function monomindMcpEntry(options: InitOptions): Record<string, unknown> {
  return mcpServerEntry(
    'kimi',
    MCP_NPM_ENV,
    process.platform,
    options.mcp.pin,
  );
}

/**
 * Build the .kimi-code/mcp.json object. Standalone (no existing file) case;
 * the executor merges into an existing file via mergeKimiMcpJson below.
 */
export function generateKimiMcpConfig(options: InitOptions): Record<string, unknown> {
  const config: Record<string, unknown> = { mcpServers: {} };
  if (options.mcp.monomind) {
    (config.mcpServers as Record<string, unknown>).monomind = monomindMcpEntry(options);
  }
  return config;
}

export function generateKimiMcpJson(options: InitOptions): string {
  return `${JSON.stringify(generateKimiMcpConfig(options), null, 2)}\n`;
}

/**
 * Merge the monomind server into an existing .kimi-code/mcp.json without
 * touching the user's other servers. Returns null when the existing file is
 * unparseable (caller should skip, never clobber).
 */
export function mergeKimiMcpJson(existing: string, options: InitOptions): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(existing) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const servers = (parsed.mcpServers ?? {}) as Record<string, unknown>;
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return null;
  if (options.mcp.monomind) servers.monomind = monomindMcpEntry(options);
  parsed.mcpServers = servers;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
