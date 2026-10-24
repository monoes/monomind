/**
 * Settings.json Generator — hook command builders and hooks config
 * Split out of settings-generator.ts (file-size sweep). Pure move.
 */

import type { HooksConfig, InitOptions } from './types.js';

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
export function generateStatusLineConfig(_options: InitOptions): object {
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
/** Claude Code reads hook `timeout` in seconds; HooksConfig.timeout is milliseconds. */
function seconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

export function generateHooksConfig(config: HooksConfig, monograph = true): object {
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
            timeout: seconds(config.timeout),
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
            timeout: seconds(config.timeout),
          },
        ],
      },
      // Task/Agent spawns → record whether the subagent followed the prompt's
      // [PICK] (.monomind/pick-adherence.jsonl). Observation only, never blocks.
      {
        matcher: 'Task|Agent',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('pre-agent'),
            timeout: 3,
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
            timeout: 4,
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
            timeout: 10,
          },
        ],
      },
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('post-bash'),
            timeout: seconds(config.timeout),
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
            timeout: 2,
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
            // Covers the route hook's own exit deadline with the longest Jev
            // window (MONOMIND_JEV_HOOK_TIMEOUT_MS, capped at 3 s, + 1.5 s).
            timeout: 12,
          },
          {
            type: 'command',
            command: standaloneHelperCmd('monolean-tracker.cjs'),
            timeout: 3,
          },
          {
            type: 'command',
            command: standaloneHelperCmd('mesh-inbox.cjs'),
            timeout: 3,
          },
        ],
      },
    ];
  }

  // SessionStart — restore session state + build knowledge graph
  if (config.sessionStart) {
    const sessionStartHooks: object[] = [
      {
        type: 'command',
        command: hookHandlerCmd('session-restore'),
        timeout: 15,
      },
    ];

    if (monograph) {
      sessionStartHooks.push({
        type: 'command',
        command: standaloneHelperCmd('monograph-freshen.cjs'),
        timeout: 5,
      });
    }

    sessionStartHooks.push({
      type: 'command',
      command: standaloneHelperCmd('control-start.cjs'),
      timeout: 5,
    });

    sessionStartHooks.push({
      type: 'command',
      command: standaloneHelperCmd('monolean-activate.cjs'),
      timeout: 5,
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
            timeout: 10,
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
            timeout: 5,
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
            timeout: 6,
          },
        ],
      },
    ];
  }

  // SubagentStart — capture-handler telemetry for org dashboard + lean mode propagation
  hooks.SubagentStart = [
    {
      hooks: [
        {
          type: 'command',
          command: captureHandlerCmd('subagent-start'),
          timeout: 5,
        },
        {
          type: 'command',
          command: standaloneHelperCmd('monolean-propagate.cjs'),
          timeout: 3,
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
          timeout: 5,
        },
        {
          type: 'command',
          command: captureHandlerCmd('subagent-stop'),
          timeout: 10,
        },
      ],
    },
  ];

  // NOTE: Stop and Notification get no hook: their only hooks (the
  // auto-memory sync and hook-handler `notify`) did nothing (#417).
  // NOTE: TeammateIdle, TaskCompleted, and PostCompact are NOT accepted by
  // Claude Code's settings.json validator (rejected as "Invalid key in record").
  // Agent Teams coordination lives in monomind.agentTeams.hooks instead.

  return hooks;
}
