/** Platform-aware rendering of the Monomind stdio MCP server. */

import type { ArtifactIntent, InstallScope, PlatformAdapter } from '../types.js';

export interface McpRenderOptions {
  scope: InstallScope;
  os?: NodeJS.Platform;
  env?: Readonly<Record<string, string>>;
  /** Exact version to pin the MCP server to; omit for floating `@latest`. */
  pin?: string;
}

export interface McpRenderResult {
  intents: ArtifactIntent[];
  diagnostics: string[];
}

/** Canonical scoped package; the unscoped `monomind` is its single-bin alias. */
export const MCP_SCOPED_PACKAGE = '@monoes/monomindcli';

/**
 * The command line is identical across platforms; Windows needs cmd.exe so
 * npm's executable shim is resolved consistently by every supported client.
 *
 * Unpinned (the default) uses the unscoped `monomind@latest`, which declares a
 * single bin, so `npx -y monomind@latest mcp start` resolves. An exact pin has
 * to name the scoped package, and that package declares three bins — npx then
 * refuses with "could not determine executable to run" (issue #312). Selecting
 * the package with `--package=` and the bin positionally is the form that works
 * against every already-published version, including those predating the
 * package-named bin.
 */
export function mcpCommand(
  _platform: PlatformAdapter['id'],
  os: NodeJS.Platform = process.platform,
  pin?: string,
): string[] {
  const command = pin
    ? ['npx', '-y', `--package=${MCP_SCOPED_PACKAGE}@${pin}`, 'monomind', 'mcp', 'start']
    : ['npx', '-y', 'monomind@latest', 'mcp', 'start'];
  return os === 'win32' ? ['cmd', '/c', ...command] : command;
}

/**
 * The single source of truth for every `claude mcp add monomind -- …` hint the
 * CLI prints, so a doctor fix, `mcp verify` and the generated CLAUDE.md can
 * never drift from what `init` actually writes.
 */
export function mcpAddHint(pin?: string, os: NodeJS.Platform = process.platform): string {
  return `claude mcp add monomind -- ${mcpCommand('claude', os, pin).join(' ')}`;
}

/**
 * Convert the portable stdio command into the schema used by the target.
 * OpenCode expects its command as an array, while the other JSON MCP clients
 * use the conventional command-plus-args form.
 */
export function mcpServerEntry(
  platform: PlatformAdapter['id'],
  env: Readonly<Record<string, string>> = {},
  os: NodeJS.Platform = process.platform,
  pin?: string,
): Record<string, unknown> {
  const command = mcpCommand(platform, os, pin);
  if (platform === 'opencode') {
    return { type: 'local', command, enabled: true, env: { ...env } };
  }

  const [executable, ...args] = command;
  return { command: executable, args, env: { ...env } };
}

/**
 * Emit a mergeable named entry only when the adapter's evidence-gated MCP
 * capability and its requested scope both declare a concrete configuration
 * location. Path resolution and mutation deliberately remain in operations.
 */
export function renderMcpArtifacts(
  adapter: PlatformAdapter,
  options: McpRenderOptions,
): McpRenderResult {
  if (adapter.capabilities.mcp !== 'native') {
    return {
      intents: [],
      diagnostics: [
        `${adapter.displayName}: MCP is ${adapter.capabilities.mcp}; use the Monomind CLI fallback`,
      ],
    };
  }

  const location = adapter.paths.locations.mcp?.[options.scope];
  if (!location || location === 'discovery' || location === 'cli_fallback') {
    return {
      intents: [],
      diagnostics: [
        `${adapter.displayName}: no declared ${options.scope} MCP location; no artifact was generated`,
      ],
    };
  }
  if (!location.entryPath?.length) {
    return {
      intents: [],
      diagnostics: [
        `${adapter.displayName}: MCP location has no named entry path; no artifact was generated`,
      ],
    };
  }

  return {
    intents: [
      {
        kind: 'mcp',
        locationKey: 'mcp',
        content: JSON.stringify(mcpServerEntry(adapter.id, options.env, options.os, options.pin)),
        scope: options.scope,
        replace: 'named_entry',
        entryPath: location.entryPath,
        format: location.format,
      },
    ],
    diagnostics: [],
  };
}
