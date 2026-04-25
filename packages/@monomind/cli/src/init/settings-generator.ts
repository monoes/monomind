/**
 * Settings.json Generator
 * Creates .claude/settings.json with V1-optimized hook configurations
 */

import type { InitOptions, HooksConfig, PlatformInfo } from './types.js';
import { detectPlatform } from './types.js';

/**
 * Generate the complete settings.json content
 */
export function generateSettings(options: InitOptions): object {
  const settings: Record<string, unknown> = {};

  // Add hooks if enabled
  if (options.components.settings) {
    settings.hooks = generateHooksConfig(options.hooks);
  }

  // Add statusLine configuration if enabled
  if (options.statusline.enabled) {
    settings.statusLine = generateStatusLineConfig(options);
  }

  // Add permissions
  settings.permissions = {
    allow: [
      'Bash(npx @monobrain*)',
      'Bash(npx monobrain*)',
      'Bash(node .claude/*)',
      'mcp__monobrain__:*',
    ],
    deny: [
      'Read(./.env)',
      'Read(./.env.*)',
    ],
  };

  // Add monobrain attribution for git commits and PRs
  settings.attribution = {
    commit: 'Co-Authored-By: nokhodian <nokhodian@gmail.com>',
    pr: '🤖 Generated with [monobrain](https://github.com/nokhodian/monobrain)',
  };

  // Note: Claude Code expects 'model' to be a string, not an object
  // Model preferences are stored in monobrain settings instead
  // settings.model = 'claude-sonnet-4-5-20250929'; // Uncomment if you want to set a default model

  // Add Agent Teams configuration (experimental feature)
  settings.env = {
    // Enable Claude Code Agent Teams for multi-agent coordination
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    // Monobrain specific environment
    MONOBRAIN_V1_ENABLED: 'true',
    MONOBRAIN_HOOKS_ENABLED: 'true',
  };

  // Detect platform for platform-aware configuration
  const platform = detectPlatform();

  // Add V1-specific settings
  settings.monobrain = {
    version: '3.0.0',
    enabled: true,
    platform: {
      os: platform.os,
      arch: platform.arch,
      shell: platform.shell,
    },
    modelPreferences: {
      default: 'claude-opus-4-6',
      routing: 'claude-haiku-4-5-20251001',
    },
    agentTeams: {
      enabled: true,
      teammateMode: 'auto', // 'auto' | 'in-process' | 'tmux'
      taskListEnabled: true,
      mailboxEnabled: true,
      coordination: {
        autoAssignOnIdle: true,       // Auto-assign pending tasks when teammate is idle
        trainPatternsOnComplete: true, // Train neural patterns when tasks complete
        notifyLeadOnComplete: true,   // Notify team lead when tasks complete
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
    swarm: {
      topology: options.runtime.topology,
      maxAgents: options.runtime.maxAgents,
    },
    memory: {
      backend: options.runtime.memoryBackend,
      enableHNSW: options.runtime.enableHNSW,
      learningBridge: { enabled: options.runtime.enableLearningBridge ?? true },
      memoryGraph: { enabled: options.runtime.enableMemoryGraph ?? true },
      agentScopes: { enabled: options.runtime.enableAgentScopes ?? true },
    },
    neural: {
      enabled: options.runtime.enableNeural,
    },
    daemon: {
      autoStart: false,  // Opt-in only — prevents unintended token consumption (#1427, #1330)
      workers: [
        'map',           // Codebase mapping
        'audit',         // Security auditing (critical priority)
        'optimize',      // Performance optimization (high priority)
      ],
      schedules: {
        audit: { interval: '4h', priority: 'critical' },
        optimize: { interval: '2h', priority: 'high' },
      },
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
 * Detect if we're on Windows for platform-aware hook commands.
 */
const IS_WINDOWS = process.platform === 'win32';

/**
 * Build a hook command with reliable $CLAUDE_PROJECT_DIR expansion.
 * Wraps in `sh -c` to guarantee shell expansion on all platforms (macOS zsh,
 * Linux bash). Falls back to "." if CLAUDE_PROJECT_DIR is unset, since
 * Claude Code runs hooks from the project root.
 * On Windows, uses `cmd /c` with %CLAUDE_PROJECT_DIR%.
 */
function hookCmd(script: string, subcommand: string): string {
  if (IS_WINDOWS) {
    return `cmd /c node %CLAUDE_PROJECT_DIR%/${script} ${subcommand}`.trim();
  }
  // Use sh -c to ensure $CLAUDE_PROJECT_DIR is expanded by a real shell,
  // even if Claude Code doesn't invoke hooks through a shell on macOS.
  // eslint-disable-next-line no-template-curly-in-string
  const dir = '${CLAUDE_PROJECT_DIR:-.}';
  return `sh -c 'exec node "${dir}/${script}" ${subcommand}'`;
}

/** Shorthand for CJS hook-handler commands */
function hookHandlerCmd(subcommand: string): string {
  return hookCmd('.claude/helpers/hook-handler.cjs', subcommand);
}

/** Shorthand for ESM auto-memory-hook commands */
function autoMemoryCmd(subcommand: string): string {
  return hookCmd('.claude/helpers/auto-memory-hook.mjs', subcommand);
}

/**
 * Generate statusLine configuration for Claude Code
 * Uses local helper script for cross-platform compatibility (no npx cold-start)
 */
function generateStatusLineConfig(_options: InitOptions): object {
  // Claude Code pipes JSON session data to the script via stdin.
  // Valid fields: type, command, padding (optional).
  // The script runs after each assistant message (debounced 300ms).
  // NOTE: statusline must NOT use `cmd /c` — Claude Code manages its stdin
  // directly for statusline commands, and `cmd /c` blocks stdin forwarding.
  // eslint-disable-next-line no-template-curly-in-string
  const dir = '${CLAUDE_PROJECT_DIR:-.}';
  return {
    type: 'command',
    command: `sh -c 'exec node "${dir}/.claude/helpers/statusline.cjs"'`,
  };
}

/**
 * Generate hooks configuration
 * Uses local hook-handler.cjs for cross-platform compatibility.
 * All hooks invoke scripts directly via `node <script> <subcommand>`,
 * working identically on Windows, macOS, and Linux.
 */
function generateHooksConfig(config: HooksConfig): object {
  const hooks: Record<string, unknown[]> = {};

  // Node.js scripts handle errors internally via try/catch.
  // No shell-level error suppression needed (2>/dev/null || true breaks Windows).

  // PreToolUse — validate commands and edits before execution
  if (config.preToolUse) {
    hooks.PreToolUse = [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('pre-bash'),
            timeout: config.timeout,
          },
        ],
      },
      {
        matcher: 'Write|Edit|MultiEdit',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('pre-edit'),
            timeout: config.timeout,
          },
        ],
      },
    ];
  }

  // PostToolUse — record edits and commands for session metrics / learning
  if (config.postToolUse) {
    hooks.PostToolUse = [
      {
        matcher: 'Write|Edit|MultiEdit',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('post-edit'),
            timeout: 10000,
          },
        ],
      },
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('post-bash'),
            timeout: config.timeout,
          },
        ],
      },
    ];
  }

  // UserPromptSubmit — intelligent task routing
  if (config.userPromptSubmit) {
    hooks.UserPromptSubmit = [
      {
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('route'),
            timeout: 10000,
          },
        ],
      },
    ];
  }

  // SessionStart — restore session state + import auto memory
  if (config.sessionStart) {
    hooks.SessionStart = [
      {
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('session-restore'),
            timeout: 15000,
          },
          {
            type: 'command',
            command: autoMemoryCmd('import'),
            timeout: 8000,
          },
        ],
      },
    ];
  }

  // SessionEnd — persist session state
  if (config.sessionStart) {
    hooks.SessionEnd = [
      {
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('session-end'),
            timeout: 10000,
          },
        ],
      },
    ];
  }

  // Stop — sync auto memory on exit
  if (config.stop) {
    hooks.Stop = [
      {
        hooks: [
          {
            type: 'command',
            command: autoMemoryCmd('sync'),
            timeout: 10000,
          },
        ],
      },
    ];
  }

  // PreCompact — preserve context before compaction
  if (config.preCompact) {
    hooks.PreCompact = [
      {
        matcher: 'manual',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('compact-manual'),
          },
          {
            type: 'command',
            command: hookHandlerCmd('session-end'),
            timeout: 5000,
          },
        ],
      },
      {
        matcher: 'auto',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('compact-auto'),
          },
          {
            type: 'command',
            command: hookHandlerCmd('session-end'),
            timeout: 6000,
          },
        ],
      },
    ];
  }

  // SubagentStart — status update when a sub-agent is spawned
  hooks.SubagentStart = [
    {
      hooks: [
        {
          type: 'command',
          command: hookHandlerCmd('status'),
          timeout: 3000,
        },
      ],
    },
  ];

  // SubagentStop — track agent completion for metrics
  // NOTE: The valid event is "SubagentStop" (not "SubagentEnd")
  hooks.SubagentStop = [
    {
      hooks: [
        {
          type: 'command',
          command: hookHandlerCmd('post-task'),
          timeout: 5000,
        },
      ],
    },
  ];

  // Notification — capture Claude Code notifications for logging
  if (config.notification) {
    hooks.Notification = [
      {
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('notify'),
            timeout: 3000,
          },
        ],
      },
    ];
  }

  // NOTE: TeammateIdle, TaskCompleted, and PostCompact are NOT accepted by
  // Claude Code's settings.json validator (rejected as "Invalid key in record").
  // Agent Teams coordination lives in monobrain.agentTeams.hooks instead.

  return hooks;
}

/**
 * Generate settings.json as formatted string
 */
export function generateSettingsJson(options: InitOptions): string {
  const settings = generateSettings(options);
  return JSON.stringify(settings, null, 2);
}
