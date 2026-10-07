/**
 * V1 Init System Types — the complete InitOptions shape and its presets.
 * File-size sweep: split out of types.ts.
 */

import type {
  AgentsConfig,
  CommandsConfig,
  HooksConfig,
  InitComponents,
  MCPConfig,
  RuntimeConfig,
  SkillsConfig,
  StatuslineConfig,
} from './types-components.js';
import { DEFAULT_EMBEDDING_MODEL, type EmbeddingsConfig } from './types-embeddings.js';

/**
 * Complete init options
 */
export interface InitOptions {
  /** Target directory */
  targetDir: string;
  /** Source base directory for skills/commands/agents (optional) */
  sourceBaseDir?: string;
  /** Explicit adapter targets selected by init flags; absent keeps legacy init behavior. */
  selectedPlatforms?: readonly import('../platform-adapters/types.js').PlatformId[];
  /**
   * The non-Claude trees (`.gemini/`, `.agents/`) this run may create, when
   * set; overrides what `selectedPlatforms` implies. `init skills` passes the
   * ones the project already has (#420).
   */
  platformTrees?: readonly ('gemini' | 'agents')[];
  /** Opt in to platform-native deterministic hooks; disabled by default. */
  enablePlatformHooks?: boolean;
  /** Force overwrite existing files */
  force: boolean;
  /** Keep a managed block the user edited even though `force` is set —
   *  `init upgrade` refreshes blocks with `force` but is not the user's
   *  explicit --force (see file-guard.ts). */
  preserveEdits?: boolean;
  /** `--if-missing`: create only files that don't exist yet; never touch an
   *  existing file (CLAUDE.md, .claude/settings.json, skills/commands/agents
   *  copies, …), even one `force` would otherwise refresh. Idempotent: a
   *  second run against the same directory creates nothing new. */
  ifMissing?: boolean;
  /** `--agent-teams` (#655): write Claude Code's experimental Agent Teams env flag and
   *  the `monomind.agentTeams` settings block. Off by default. */
  agentTeams?: boolean;
  /** Run in interactive mode */
  interactive: boolean;
  /** Components to initialize */
  components: InitComponents;
  /** Hooks configuration */
  hooks: HooksConfig;
  /** Opt-in packs to install on top of core (names from init/packs.ts) */
  packs?: string[];
  /** Skills configuration */
  skills: SkillsConfig;
  /** Commands configuration */
  commands: CommandsConfig;
  /** Agents configuration */
  agents: AgentsConfig;
  /** Statusline configuration */
  statusline: StatuslineConfig;
  /** MCP configuration */
  mcp: MCPConfig;
  /** Runtime configuration */
  runtime: RuntimeConfig;
  /** Embeddings configuration */
  embeddings: EmbeddingsConfig;
  /**
   * Allow the post-init doctor pass to offer a global
   * `npm install -g @anthropic-ai/claude-code` when Claude Code is selected
   * and missing. It asks first and only in an interactive terminal (#420).
   * Defaults to true (undefined is treated as true); set false
   * (`monomind init --no-install`) to never offer it.
   */
  installClaudeCode?: boolean;
  /**
   * Skip executeInit's own doctor pass because the caller runs it (via
   * `runDoctorFix`) after its later writes, so the pass sees the final state.
   */
  deferDoctor?: boolean;
  /**
   * Initialize the memory database (`.swarm/memory.db`) the way `monomind
   * memory init` does, keeping an existing one. Runs only with
   * `components.runtime`; undefined is treated as true (`--no-memory` sets false).
   */
  initMemory?: boolean;
}

/**
 * Default init options - full V1 setup
 */
export const DEFAULT_INIT_OPTIONS: InitOptions = {
  targetDir: process.cwd(),
  force: false,
  interactive: true,
  components: {
    settings: true,
    skills: true,
    commands: true,
    agents: true,
    helpers: true,
    statusline: true,
    mcp: true,
    runtime: true,
    claudeMd: true,
    monograph: true,
    antigravity: true,
    opencode: false,
    kimicode: false,
    codex: false,
  },
  hooks: {
    preToolUse: true,
    postToolUse: true,
    userPromptSubmit: true,
    sessionStart: true,
    stop: true,
    preCompact: true,
    notification: true,
    teammateIdle: true,
    taskCompleted: true,
    timeout: 5000,
    continueOnError: true,
  },
  // The core pack only (GH #411); opt-in packs via `packs`.
  skills: { core: true, all: false },
  commands: { core: true, all: false },
  agents: { core: true, all: false },
  statusline: {
    enabled: true,
    showProgress: true,
    showSecurity: true,
    showSwarm: true,
    showHooks: true,
    showPerformance: true,
    refreshInterval: 5000,
  },
  mcp: {
    monomind: true,
    monograph: false,
    autoStart: false,
    port: 3000,
  },
  runtime: {
    topology: 'hierarchical-mesh',
    maxAgents: 15,
    memoryBackend: 'hybrid',
    enableNeural: true,
  },
  embeddings: {
    enabled: true,
    model: DEFAULT_EMBEDDING_MODEL,
    hyperbolic: true,
    curvature: -1.0,
    predownload: false, // Don't auto-download to speed up init
    cacheSize: 256,
    neuralSubstrate: true,
  },
};

/**
 * Minimal init options
 */
export const MINIMAL_INIT_OPTIONS: InitOptions = {
  ...DEFAULT_INIT_OPTIONS,
  components: {
    settings: true,
    skills: true,
    commands: false,
    agents: false,
    helpers: false,
    statusline: false,
    mcp: true,
    runtime: true,
    claudeMd: true,
    monograph: false,
    antigravity: false,
    opencode: false,
    kimicode: false,
    codex: false,
  },
  hooks: {
    ...DEFAULT_INIT_OPTIONS.hooks,
    userPromptSubmit: false,
    stop: false,
    notification: false,
    teammateIdle: false,
    taskCompleted: false,
  },
  runtime: {
    topology: 'mesh',
    maxAgents: 5,
    memoryBackend: 'memory',
    enableNeural: false,
  },
  embeddings: {
    enabled: false,
    model: DEFAULT_EMBEDDING_MODEL,
    hyperbolic: false,
    curvature: -1.0,
    predownload: false,
    cacheSize: 128,
    neuralSubstrate: false,
  },
};

/**
 * Full init options (everything enabled)
 */
export const FULL_INIT_OPTIONS: InitOptions = {
  ...DEFAULT_INIT_OPTIONS,
  components: {
    settings: true,
    skills: true,
    commands: true,
    agents: true,
    helpers: true,
    statusline: true,
    mcp: true,
    runtime: true,
    claudeMd: true,
    monograph: true,
    antigravity: true,
    opencode: false,
    kimicode: false,
    codex: false,
  },
  // Every pack.
  skills: { core: true, all: true },
  commands: { core: true, all: true },
  agents: { core: true, all: true },
  mcp: {
    monomind: true,
    monograph: false,
    autoStart: false,
    port: 3000,
  },
  embeddings: {
    enabled: true,
    model: DEFAULT_EMBEDDING_MODEL,
    hyperbolic: true,
    curvature: -1.0,
    predownload: true, // Pre-download for full init
    cacheSize: 256,
    neuralSubstrate: true,
  },
};
