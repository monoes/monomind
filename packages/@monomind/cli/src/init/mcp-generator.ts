/**
 * MCP Configuration Generator
 * Creates .mcp.json for Claude Code MCP server integration
 * Handles cross-platform compatibility (Windows requires cmd /c wrapper)
 */

import fs from 'node:fs';
import path from 'node:path';
// buildMonoesMcpEntry lives in a plain-ESM sibling, not here: routes-monoes.mjs
// ships as-is with no build step and cannot import compiled TypeScript, so the
// shape both writers emit has to live somewhere importable by both. Compiled
// TS *can* import a .mjs sibling (the constraint is one-directional), so this
// re-export keeps `generateMCPConfig()` and the existing test's
// `import { buildMonoesMcpEntry } from './mcp-generator.js'` working.
import { buildMonoesMcpEntry } from '../mcp/monoes-mcp-entry.mjs';
import { mcpCommand, mcpServerEntry } from '../platform-adapters/renderers/mcp.js';
import type { InitOptions } from './types.js';

export { buildMonoesMcpEntry };

/**
 * Generate MCP configuration
 */
export function generateMCPConfig(options: InitOptions): object {
  const config = options.mcp;
  const mcpServers: Record<string, object> = {};

  const npmEnv = {
    npm_config_update_notifier: 'false',
  };

  // Monomind MCP server (core)
  // i-041/i-117 §4: MONOMIND_MODE, MONOMIND_HOOKS_ENABLED, MONOMIND_TOPOLOGY,
  // MONOMIND_MAX_AGENTS and MONOMIND_MEMORY_BACKEND were written here but had
  // no `process.env` reader anywhere in the repo — grepped repo-wide (see
  // claudemd-truth.test.ts and the developer report for the exact commands).
  // The MCP server itself never read them back; they sat in the spawned
  // process's env doing nothing. Writing an unread var into real config is
  // the same class of lie as a wrong count in a doc string.
  if (config.monomind) {
    mcpServers.monomind = mcpServerEntry('claude', {
      ...npmEnv,
    });
  }

  // Monograph knowledge graph — built into monomind MCP server since v1.8.0.
  // Available as mcp__monomind__monograph_build, monograph_query, monograph_suggest, monograph_health.
  // No separate server needed — the monomind entry above provides all monograph tools.

  // If this project already has a monoes.me connection (e.g. re-running init
  // after connecting via the dashboard), carry the entry forward — gated on
  // the connection *existing*, never on reading its accessToken into the
  // returned config (buildMonoesMcpEntry takes no token at all: see
  // mcp/monoes-mcp-entry.mjs). A never-connected project gets no entry —
  // one that's guaranteed to fail on every MCP startup would be worse than
  // absent (the proxy has nothing to authenticate with).
  try {
    const connectionFile = path.join(options.targetDir, '.monomind', 'monoes-connection.json');
    const conn = JSON.parse(fs.readFileSync(connectionFile, 'utf8'));
    if (conn?.accessToken) {
      mcpServers.monoes = buildMonoesMcpEntry();
    }
  } catch {
    // No connection file, or unreadable — omit the entry.
  }

  return { mcpServers };
}

/**
 * Generate .mcp.json as formatted string
 */
export function generateMCPJson(options: InitOptions): string {
  const config = generateMCPConfig(options);
  return JSON.stringify(config, null, 2);
}

/**
 * Generate MCP server add commands for manual setup
 */
export function generateMCPCommands(options: InitOptions): string[] {
  const commands: string[] = [];
  const config = options.mcp;

  if (config.monomind)
    commands.push(`claude mcp add monomind -- ${mcpCommand('claude').join(' ')}`);

  return commands;
}

/**
 * Get platform-specific setup instructions
 */
export function getPlatformInstructions(): { platform: string; note: string } {
  if (process.platform === 'win32') {
    return {
      platform: 'Windows',
      note: 'MCP configuration uses cmd /c wrapper for npx compatibility.',
    };
  }
  return {
    platform: process.platform === 'darwin' ? 'macOS' : 'Linux',
    note: 'MCP configuration uses npx directly.',
  };
}
