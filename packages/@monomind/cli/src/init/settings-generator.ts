/**
 * Settings.json Generator
 * Creates .claude/settings.json with V1-optimized hook configurations
 */

import { MODEL_DEFAULTS } from '../pricing/model-pricing.js';
import { generateHooksConfig, generateStatusLineConfig } from './settings-generator-hooks.js';
import type { InitOptions } from './types.js';
import { detectPlatform } from './types.js';

/**
 * Generate the complete settings.json content
 */
export function generateSettings(options: InitOptions): object {
  const settings: Record<string, unknown> = {};

  // Add hooks if enabled
  if (options.components.settings) {
    settings.hooks = generateHooksConfig(options.hooks, options.components.monograph);
  }

  // Add statusLine configuration if enabled
  if (options.statusline.enabled) {
    settings.statusLine = generateStatusLineConfig(options);
  }

  // Add permissions
  // SECURITY: tightened allowlist patterns.
  //   `Bash(npx monomind*)` previously matched any package starting with
  //   "monomind" (including a hypothetical future typosquat). Anchor to the
  //   official scope/namespaces only, with an explicit space between command
  //   tokens so partial-prefix matches are rejected.
  settings.permissions = {
    allow: [
      'Bash(npx @monomind/*)',
      'Bash(npx monomind *)',
      'Bash(npx -y monomind *)',
      'Bash(npx monomind@*)',
      'Bash(node .claude/helpers/*)',
      'mcp__monomind__*',
    ],
    deny: ['Read(./.env)', 'Read(./.env.*)'],
  };

  // Note: Claude Code expects 'model' to be a string, not an object
  // Model preferences are stored in monomind settings instead
  // settings.model = 'claude-sonnet-4-5-20250929'; // Uncomment if you want to set a default model

  settings.env = {
    // Claude Code's experimental Agent Teams (long-lived teammate agents that
    // message the lead) are opt-in (`init --agent-teams`, #655): nothing in
    // Monomind uses them, and idle teammate messages keep waking a large parent
    // context.
    ...(options.agentTeams ? { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } : {}),
    // Monomind specific environment
    MONOMIND_V1_ENABLED: 'true',
    MONOMIND_HOOKS_ENABLED: 'true',
    // Quiet by default: silence per-prompt advisory blocks ([AUDIT],
    // [CODEBASE], [MONOGRAPH], [INTELLIGENCE], [COST], …). Side-effects
    // (file writes, telemetry, route mutations) are unchanged, and the one
    // [PICK] line still reaches Claude. Opt out by removing this or setting
    // it to 0.
    MONOMIND_HOOK_QUIET: '1',
  };

  // Detect platform for platform-aware configuration
  const platform = detectPlatform();

  // Add V1-specific settings
  settings.monomind = {
    version: '3.0.0',
    enabled: true,
    platform: {
      os: platform.os,
      arch: platform.arch,
      shell: platform.shell,
    },
    modelPreferences: {
      default: MODEL_DEFAULTS.opus,
      routing: MODEL_DEFAULTS.haiku,
    },
    ...(options.agentTeams
      ? {
          agentTeams: {
            enabled: true,
            teammateMode: 'auto', // 'auto' | 'in-process' | 'tmux'
            taskListEnabled: true,
            mailboxEnabled: true,
            coordination: {
              autoAssignOnIdle: true, // Auto-assign pending tasks when teammate is idle
              trainPatternsOnComplete: true, // Train neural patterns when tasks complete
              notifyLeadOnComplete: true, // Notify team lead when tasks complete
              sharedMemoryNamespace: 'agent-teams', // Memory namespace for team coordination
            },
            hooks: {
              teammateIdle: {
                enabled: true,
                autoAssign: true,
                checkTaskList: true,
              },
              taskCompleted: {
                enabled: true,
                trainPatterns: true,
                notifyLead: true,
              },
            },
          },
        }
      : {}),
    monoswarm: {
      topology: options.runtime.topology,
      maxAgents: options.runtime.maxAgents,
    },
    memory: {
      backend: options.runtime.memoryBackend,
    },
    neural: {
      enabled: options.runtime.enableNeural,
    },
    learning: {
      enabled: true,
      autoTrain: true,
      patterns: ['coordination', 'optimization', 'prediction'],
      retention: {
        shortTerm: '24h',
        longTerm: '30d',
      },
    },
    adr: {
      autoGenerate: true,
      directory: '/docs/adr',
      template: 'madr',
    },
    ddd: {
      trackDomains: true,
      validateBoundedContexts: true,
      directory: '/docs/ddd',
    },
    security: {
      autoScan: true,
      scanOnEdit: true,
      cveCheck: true,
      threatModel: true,
    },
  };

  return settings;
}

/**
 * Generate settings.json as formatted string
 */
export function generateSettingsJson(options: InitOptions): string {
  const settings = generateSettings(options);
  return JSON.stringify(settings, null, 2);
}
