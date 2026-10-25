/**
 * V1 Init System Types — component/feature configuration interfaces.
 * File-size sweep: split out of types.ts.
 */

/**
 * Components that can be initialized
 */
export interface InitComponents {
  /** Create .claude/settings.json with hooks */
  settings: boolean;
  /** Copy skills to .claude/skills/, .gemini/skills/, .agents/skills/ */
  skills: boolean;
  /** Copy commands to .claude/commands/ */
  commands: boolean;
  /** Copy agents to .claude/agents/ */
  agents: boolean;
  /** Create helper scripts in .claude/helpers/ */
  helpers: boolean;
  /** Configure statusline */
  statusline: boolean;
  /** Create MCP configuration */
  mcp: boolean;
  /** Create .monomind/ directory (V1 runtime) */
  runtime: boolean;
  /** Create CLAUDE.md with swarm guidance */
  claudeMd: boolean;
  /** Build knowledge graph on init using monograph (TypeScript) */
  monograph: boolean;
  /** Emit Antigravity (Gemini) artifacts. */
  antigravity: boolean;
  /** Emit opencode artifacts (opencode.json + .opencode/). Opt-in — default
   *  false so standard `monomind init` (Claude + Antigravity) is unchanged. */
  opencode: boolean;
  /** Emit Kimi Code artifacts (.kimi-code/ + AGENTS.md). Opt-in — default
   *  false so standard `monomind init` is unchanged. */
  kimicode: boolean;
  /** Emit Codex artifacts (.codex/config.toml + AGENTS.md). Opt-in — default
   *  false so standard `monomind init` is unchanged. */
  codex: boolean;
  /** Emit cline artifacts (.clinerules/monomind.md). Opt-in via `--target
   *  cline`; absent means false. */
  cline?: boolean;
  /** Emit Qwen Code / Crush mesh artifacts (.qwen/settings.json, crush.json).
   *  Opt-in via `--target qwen` / `--target crush`; absent means false. */
  qwen?: boolean;
  crush?: boolean;
  /** `--target agents`: write AGENTS.md and nothing else (no Claude files,
   *  no `.monomind/` state) — for runtimes that read AGENTS.md natively.
   *  Absent means false. */
  agentsOnly?: boolean;
}

/**
 * Hook configuration options
 * Valid Claude Code hook events (23 total):
 *   PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit,
 *   SessionStart, SessionEnd, Stop, SubagentStart, SubagentStop,
 *   PreCompact, PostCompact, Notification, ConfigChange,
 *   InstructionsLoaded, PermissionRequest, WorktreeCreate, WorktreeRemove,
 *   TeammateIdle, TaskCompleted, Elicitation, ElicitationResult
 */
export interface HooksConfig {
  /** Enable PreToolUse hooks */
  preToolUse: boolean;
  /** Enable PostToolUse hooks */
  postToolUse: boolean;
  /** Enable UserPromptSubmit for routing */
  userPromptSubmit: boolean;
  /** Enable SessionStart hooks */
  sessionStart: boolean;
  /** No longer generates a hook (#417); kept so existing option objects stay valid */
  stop: boolean;
  /** Enable PreCompact hooks (context preservation before compaction) */
  preCompact: boolean;
  /** No longer generates a hook (#417); kept so existing option objects stay valid */
  notification: boolean;
  /** Enable TeammateIdle hooks (agent teams auto-assign) */
  teammateIdle: boolean;
  /** Enable TaskCompleted hooks (agent teams pattern learning) */
  taskCompleted: boolean;
  /** Hook timeout in milliseconds */
  timeout: number;
  /** Continue on hook error */
  continueOnError: boolean;
}

/**
 * Which packs (see init/packs.ts) a run installs for one kind of asset:
 * `core` — the core pack; `all` — every pack. Opt-in packs are chosen
 * with `InitOptions.packs`.
 */
export interface PackSelection {
  /** Install the core pack */
  core: boolean;
  /** Install every pack (`--full`, `--all-packs`) */
  all: boolean;
}

/** Skills configuration */
export type SkillsConfig = PackSelection;

/** Commands configuration */
export type CommandsConfig = PackSelection;

/** Agents configuration */
export type AgentsConfig = PackSelection;

/**
 * Statusline configuration
 */
export interface StatuslineConfig {
  /** Enable statusline */
  enabled: boolean;
  /** Show V1 progress */
  showProgress: boolean;
  /** Show security status */
  showSecurity: boolean;
  /** Show swarm activity */
  showSwarm: boolean;
  /** Show hooks metrics */
  showHooks: boolean;
  /** Show performance targets */
  showPerformance: boolean;
  /** Refresh interval in milliseconds */
  refreshInterval: number;
}

/**
 * MCP configuration
 */
export interface MCPConfig {
  /** Include monomind MCP server */
  monomind: boolean;
  /** Include monograph knowledge graph MCP server */
  monograph: boolean;
  /** Auto-start MCP server */
  autoStart: boolean;
  /** Server port */
  port: number;
  /**
   * Exact version to pin the generated MCP entry to (`monomind init --pin`).
   * Undefined — the default — pins to the running CLI's version (#419);
   * `latest` keeps the floating `monomind@latest` command. `init --force`
   * refreshes the pin after an upgrade.
   */
  pin?: string;
}

/**
 * Runtime configuration (.monomind/)
 */
export interface RuntimeConfig {
  /** Swarm topology */
  topology: 'mesh' | 'hierarchical' | 'hierarchical-mesh' | 'adaptive';
  /** Maximum agents */
  maxAgents: number;
  /** Memory backend */
  memoryBackend: 'memory' | 'sqlite' | 'hybrid';
  /** Enable neural learning */
  enableNeural: boolean;
  /** CLAUDE.md template variant */
  claudeMdTemplate?: ClaudeMdTemplate;
}

/** Template variants for generated CLAUDE.md files */
export type ClaudeMdTemplate =
  | 'minimal'
  | 'standard'
  | 'full'
  | 'security'
  | 'performance'
  | 'solo';
