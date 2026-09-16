/**
 * Settings.json Generator
 * Creates .claude/settings.json with V1-optimized hook configurations
 */

import { MODEL_DEFAULTS } from '../pricing/model-pricing.js';
import type { HooksConfig, InitOptions } from './types.js';
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

  // Add Agent Teams configuration (experimental feature)
  settings.env = {
    // Enable Claude Code Agent Teams for multi-agent coordination
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    // Monomind specific environment
    MONOMIND_V1_ENABLED: 'true',
    MONOMIND_HOOKS_ENABLED: 'true',
    // Quiet by default: silence per-prompt advisory blocks ([AUDIT],
    // [CODEBASE], [MONOGRAPH], [INTELLIGENCE], [COST], …). Side-effects
    // (file writes, telemetry, route mutations) are unchanged. Opt out by
    // removing this or setting MONOMIND_HOOK_VERBOSE=1.
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
    monoswarm: {
      topology: options.runtime.topology,
      maxAgents: options.runtime.maxAgents,
    },
    memory: {
      backend: options.runtime.memoryBackend,
      learningBridge: { enabled: options.runtime.enableLearningBridge ?? true },
      agentScopes: { enabled: options.runtime.enableAgentScopes ?? true },
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
 * POSIX shell snippet assigning the real project directory to $p.
 *
 * $CLAUDE_PROJECT_DIR can come up empty (observed in a live session after an
 * EnterWorktree/ExitWorktree cycle) or stale/wrong — blindly trusting it (or
 * blindly falling back to a bare `.`) breaks every hook with a cryptic Node
 * MODULE_NOT_FOUND before the script even starts, on every tool call. This
 * validates the env var against the actual helpers directory, falls back to
 * $PWD (same validation), and — since a hook can fire with cwd inside a
 * subdirectory of the project — walks up parent directories (the same way
 * git looks for `.git`) until `.claude/helpers` is found or the filesystem
 * root is hit. `dirname` shortens the path monotonically, so this always
 * terminates in at most a few iterations; it never loops.
 */
const RESOLVE_PROJECT_DIR_ASSIGN =
  'p="$CLAUDE_PROJECT_DIR"; [ -d "$p/.claude/helpers" ] || p="$PWD"; ' +
  'while [ ! -d "$p/.claude/helpers" ] && [ "$p" != "/" ]; do p=$(dirname "$p"); done;';

/**
 * Build a hook command with reliable project-directory resolution.
 *
 * Uses portable `node` (resolved from PATH at runtime) instead of baking
 * the absolute `process.execPath` from the machine that ran `monomind init`.
 * The old approach broke when settings.json was copied across platforms
 * (e.g. Windows → macOS via git) because the absolute path and `cmd /c`
 * wrapper were specific to the generating OS.
 *
 * Claude Code runs hook commands through the user's shell, so `node` is
 * on PATH for nvm/fnm/volta-managed installs that load via shell profile.
 */
function hookCmd(script: string, subcommand: string): string {
  return `sh -c '${RESOLVE_PROJECT_DIR_ASSIGN} exec node "$p/${script}" ${subcommand}'`;
}

/** Shorthand for CJS hook-handler commands */
function hookHandlerCmd(subcommand: string): string {
  return hookCmd('.claude/helpers/hook-handler.cjs', subcommand);
}

/** Shorthand for ESM auto-memory-hook commands */
function autoMemoryCmd(subcommand: string): string {
  return hookCmd('.claude/helpers/auto-memory-hook.mjs', subcommand);
}

/** Shorthand for capture-handler (agent telemetry for org dashboard) */
function captureHandlerCmd(subcommand: string): string {
  // capture-handler reads stdin directly — no sh -c/exec wrapper, so the
  // directory is resolved in a nested subshell instead of the outer
  // invocation, keeping `node` itself as the one and only process.
  return `node "$(${RESOLVE_PROJECT_DIR_ASSIGN} echo "$p")/.claude/helpers/handlers/capture-handler.cjs" ${subcommand}`;
}

/** Shorthand for standalone CJS helper scripts (no subcommand) */
function standaloneHelperCmd(script: string): string {
  return `sh -c '${RESOLVE_PROJECT_DIR_ASSIGN} exec node "$p/.claude/helpers/${script}"'`;
}

/**
 * Generate statusLine configuration for Claude Code
 * Uses local helper script for cross-platform compatibility (no npx cold-start)
 */
function generateStatusLineConfig(_options: InitOptions): object {
  // Claude Code pipes JSON session data to the script via stdin.
  // Valid fields: type, command, padding (optional).
  // The script runs after each assistant message (debounced 300ms).
  return {
    type: 'command',
    command: `sh -c '${RESOLVE_PROJECT_DIR_ASSIGN} exec node "$p/.claude/helpers/statusline.cjs"'`,
  };
}

/**
 * Generate hooks configuration
 * Uses local hook-handler.cjs for cross-platform compatibility.
 * All hooks invoke scripts directly via `node <script> <subcommand>`,
 * working identically on Windows, macOS, and Linux.
 */
function generateHooksConfig(config: HooksConfig, monograph = true): object {
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
        // NotebookEdit is listed explicitly: its content field (`new_source`)
        // is scanned by the same secrets gate as Write/Edit/MultiEdit, so it
        // must not depend on `Edit` happening to substring-match.
        matcher: 'Write|Edit|MultiEdit|NotebookEdit',
        hooks: [
          {
            // Was 'pre-edit' — not a registered hook-handler.cjs dispatch
            // command (only 'pre-write' is), so this silently no-op'd on
            // every default init: hook-handler.cjs's dispatcher falls through
            // to `else if (command) { console.log('[OK] Hook: ' + command); }`
            // for any unrecognized subcommand, meaning the secrets-detection
            // gate (gates-handler.cjs's handlePreWrite) never actually ran
            // for any project set up via a default `monomind init`.
            type: 'command',
            command: hookHandlerCmd('pre-write'),
            timeout: config.timeout,
          },
        ],
      },
      // Grep/Glob → monograph_query intercept (saves tokens vs full scan)
      {
        matcher: 'Grep|Glob',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('pre-search'),
            timeout: 4000,
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
      // monograph_* tool calls → telemetry counter
      {
        matcher: 'mcp__monomind__monograph_.*',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('post-graph-tool'),
            timeout: 2000,
          },
        ],
      },
    ];
  }

  // UserPromptSubmit — intelligent task routing + lean mode switching
  if (config.userPromptSubmit) {
    hooks.UserPromptSubmit = [
      {
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('route'),
            timeout: 10000,
          },
          {
            type: 'command',
            command: standaloneHelperCmd('monolean-tracker.cjs'),
            timeout: 3000,
          },
        ],
      },
    ];
  }

  // SessionStart — restore session state + import auto memory + build knowledge graph
  if (config.sessionStart) {
    const sessionStartHooks: object[] = [
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
    ];

    if (monograph) {
      sessionStartHooks.push({
        type: 'command',
        command: standaloneHelperCmd('monograph-freshen.cjs'),
        timeout: 5000,
      });
    }

    sessionStartHooks.push({
      type: 'command',
      command: standaloneHelperCmd('control-start.cjs'),
      timeout: 5000,
    });

    sessionStartHooks.push({
      type: 'command',
      command: standaloneHelperCmd('monolean-activate.cjs'),
      timeout: 5000,
    });

    hooks.SessionStart = [{ hooks: sessionStartHooks }];
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

  // SubagentStart — status update + capture-handler telemetry for org dashboard + lean mode propagation
  hooks.SubagentStart = [
    {
      hooks: [
        {
          type: 'command',
          command: hookHandlerCmd('status'),
          timeout: 3000,
        },
        {
          type: 'command',
          command: captureHandlerCmd('subagent-start'),
          timeout: 5000,
        },
        {
          type: 'command',
          command: standaloneHelperCmd('monolean-propagate.cjs'),
          timeout: 3000,
        },
      ],
    },
  ];

  // SubagentStop — track agent completion for metrics + capture-handler telemetry
  // NOTE: The valid event is "SubagentStop" (not "SubagentEnd")
  hooks.SubagentStop = [
    {
      hooks: [
        {
          type: 'command',
          command: hookHandlerCmd('post-task'),
          timeout: 5000,
        },
        {
          type: 'command',
          command: captureHandlerCmd('subagent-stop'),
          timeout: 10000,
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
  // Agent Teams coordination lives in monomind.agentTeams.hooks instead.

  return hooks;
}

/**
 * Generate settings.json as formatted string
 */
export function generateSettingsJson(options: InitOptions): string {
  const settings = generateSettings(options);
  return JSON.stringify(settings, null, 2);
}
