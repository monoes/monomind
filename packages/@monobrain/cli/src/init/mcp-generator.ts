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

  // Monobrain MCP server (core)
  if (config.monobrain) {
    mcpServers['monobrain'] = createMCPServerEntry(
      ['monobrain@latest', 'mcp', 'start'],
      {
        ...npmEnv,
        MONOBRAIN_MODE: 'v1',
        MONOBRAIN_HOOKS_ENABLED: 'true',
        MONOBRAIN_TOPOLOGY: options.runtime.topology,
        MONOBRAIN_MAX_AGENTS: String(options.runtime.maxAgents),
        MONOBRAIN_MEMORY_BACKEND: options.runtime.memoryBackend,
      },
      { autoStart: config.autoStart }
    );
  }



  // Graphify knowledge graph — built into monobrain MCP server since v1.3.0.
  // Available as mcp__monobrain__graphify_build, graphify_report, graphify_suggest, graphify_health.
  // No separate server needed — the monobrain entry above provides all graphify tools.

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
    if (config.monobrain) {
      commands.push('claude mcp add monobrain -- cmd /c npx -y monobrain@latest mcp start');
    }
  } else {
    if (config.monobrain) {
      commands.push("claude mcp add monobrain -- npx -y monobrain@latest mcp start");
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
