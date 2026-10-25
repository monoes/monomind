/**
 * kimi-code Tier 3 plugin manifest generation.
 * File-size sweep: split out of kimi-generator.ts.
 */

import type { InitOptions } from './types.js';

/**
 * Generate kimi.plugin.json for the self-contained plugin directory
 * (.kimi-code/plugin/). The manifest deliberately declares only `commands`
 * and `hooks`:
 *   - skills/agents stay project-level (.kimi-code/skills, .kimi-code/agents)
 *     so they work with zero install — no duplication inside the plugin.
 *   - mcpServers stays in project .kimi-code/mcp.json to avoid a duplicate
 *     "monomind" server when both the project config and the plugin load.
 *   - hooks are the plugin's whole reason to exist: kimi has no project-level
 *     hooks, so the gate bridge only runs while the plugin is enabled — which
 *     also means disabling the plugin cleanly disables monomind enforcement.
 */
export function generateKimiPluginManifest(_options: InitOptions): string {
  const manifest = {
    name: 'monomind',
    version: '1.0.0',
    description: 'Monomind hooks and commands for Kimi Code (knowledge graph, memory, gates)',
    commands: './commands/',
    hooks: [
      {
        event: 'PreToolUse',
        matcher: 'Bash',
        command: 'node ./hooks/monomind-gate.mjs',
        timeout: 5,
      },
      {
        event: 'PreToolUse',
        matcher: '^(Write|Edit|MultiEdit)$',
        command: 'node ./hooks/monomind-gate.mjs',
        timeout: 5,
      },
      {
        event: 'PreToolUse',
        matcher: '^(Grep|Glob)$',
        command: 'node ./hooks/monomind-gate.mjs',
        timeout: 5,
      },
      {
        event: 'UserPromptSubmit',
        command: 'node ./hooks/monomind-mesh.mjs',
        timeout: 5,
      },
    ],
    interface: {
      displayName: 'Monomind',
      shortDescription: 'Knowledge graph, memory, and gate hooks for kimi',
    },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
