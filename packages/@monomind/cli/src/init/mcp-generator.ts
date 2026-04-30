/**
 * MCP Configuration Generator
 * Creates .mcp.json for Claude Code MCP server integration
 * Handles cross-platform compatibility (Windows requires cmd /c wrapper)
 */

import type { InitOptions, MCPConfig } from './types.js';

/**
 * Check if running on Windows
 */
function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Generate platform-specific MCP server entry
 * - Windows: uses 'cmd /c npx' directly
 * - Unix: uses 'npx' directly (simple, reliable)
 */
function createMCPServerEntry(
  npxArgs: string[],
  env: Record<string, string>,
  additionalProps: Record<string, unknown> = {}
): object {
  if (isWindows()) {
    return {
      command: 'cmd',
      args: ['/c', 'npx', '-y', ...npxArgs],
      env,
      ...additionalProps,
    };
  }

  // Unix: direct npx invocation — simple and reliable
  return {
    command: 'npx',
    args: ['-y', ...npxArgs],
    env,
    ...additionalProps,
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
    mcpServers['monomind'] = createMCPServerEntry(
      ['monomind@latest', 'mcp', 'start'],
      {
        ...npmEnv,
        MONOMIND_MODE: 'v1',
        MONOMIND_HOOKS_ENABLED: 'true',
        MONOMIND_TOPOLOGY: options.runtime.topology,
        MONOMIND_MAX_AGENTS: String(options.runtime.maxAgents),
        MONOMIND_MEMORY_BACKEND: options.runtime.memoryBackend,
      },
      { autoStart: config.autoStart }
    );
  }



  // Monograph knowledge graph — built into monomind MCP server since v1.8.0.
  // Available as mcp__monomind__monograph_build, monograph_query, monograph_suggest, monograph_health.
  // No separate server needed — the monomind entry above provides all monograph tools.

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

  if (isWindows()) {
    if (config.monomind) {
      commands.push('claude mcp add monomind -- cmd /c npx -y monomind@latest mcp start');
    }
  } else {
    if (config.monomind) {
      commands.push("claude mcp add monomind -- npx -y monomind@latest mcp start");
    }
  }

  return commands;
}

/**
 * Get platform-specific setup instructions
 */
export function getPlatformInstructions(): { platform: string; note: string } {
  if (isWindows()) {
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
