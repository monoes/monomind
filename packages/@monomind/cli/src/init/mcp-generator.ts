/**
 * MCP Configuration Generator
 * Creates .mcp.json for Claude Code MCP server integration
 * Handles cross-platform compatibility (Windows requires cmd /c wrapper)
 */

import fs from 'node:fs';
import path from 'node:path';
import { mcpCommand, mcpServerEntry } from '../platform-adapters/renderers/mcp.js';
import type { InitOptions } from './types.js';

/**
 * Build the remote HTTP MCP entry for a connected monoes.me account.
 * Shared by generateMCPConfig() (init-time) and the dashboard's runtime
 * .mcp.json sync (routes-monoes.mjs, plain JS, duplicates this shape since
 * it can't import compiled TS at runtime).
 */
export function buildMonoesMcpEntry(accessToken: string, monoesUrl = 'https://monoes.me/api/mcp'): object {
  return {
    type: 'http',
    url: monoesUrl,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  };
}

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
  if (config.monomind) {
    mcpServers.monomind = mcpServerEntry('claude', {
      ...npmEnv,
      MONOMIND_MODE: 'v1',
      MONOMIND_HOOKS_ENABLED: 'true',
      MONOMIND_TOPOLOGY: options.runtime.topology,
      MONOMIND_MAX_AGENTS: String(options.runtime.maxAgents),
      MONOMIND_MEMORY_BACKEND: options.runtime.memoryBackend,
    });
  }

  // Monograph knowledge graph — built into monomind MCP server since v1.8.0.
  // Available as mcp__monomind__monograph_build, monograph_query, monograph_suggest, monograph_health.
  // No separate server needed — the monomind entry above provides all monograph tools.

  // If this project already has a monoes.me connection (e.g. re-running init
  // after connecting via the dashboard), carry the entry forward.
  try {
    const connectionFile = path.join(options.targetDir, '.monomind', 'monoes-connection.json');
    const conn = JSON.parse(fs.readFileSync(connectionFile, 'utf8'));
    if (conn?.accessToken) {
      mcpServers.monoes = buildMonoesMcpEntry(conn.accessToken);
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
