/**
 * CLI Init Command
 * Comprehensive initialization for Monomind with Claude Code integration
 */

import { DEFAULT_INIT_OPTIONS } from '../init/index.js';
import type { Command } from '../types.js';
import { initAction } from './init-action.js';
import { quickstartCommand } from './init-quickstart.js';
import { checkCommand, hooksCommand, skillsCommand } from './init-subcommands.js';
import { upgradeCommand } from './init-upgrade.js';
import { wizardCommand } from './init-wizard.js';

export const initCommand: Command = {
  name: 'init',
  description: 'Initialize MonoMind in the current directory',
  subcommands: [
    wizardCommand,
    checkCommand,
    skillsCommand,
    hooksCommand,
    upgradeCommand,
    quickstartCommand,
  ],
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Overwrite existing configuration',
      type: 'boolean',
      default: false,
    },
    {
      name: 'yes',
      short: 'y',
      description: 'Skip confirmation prompts (also honoured via CI=true env var)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'minimal',
      short: 'm',
      description: 'Create minimal configuration',
      type: 'boolean',
      default: false,
    },
    {
      name: 'full',
      description:
        'Create full configuration with all components, every pack and all five platforms',
      type: 'boolean',
      default: false,
    },
    {
      name: 'packs',
      description:
        'Opt-in packs to install on top of core, comma-separated (see `monomind packs list`)',
      type: 'string',
    },
    {
      name: 'all-packs',
      description: 'Install every pack (every shipped skill, command and agent)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'skip-claude',
      description: 'Skip .claude/ directory creation (runtime only)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'only-claude',
      description: 'Only create .claude/ directory (skip runtime)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'no-install',
      description:
        'Never offer to install the Claude Code CLI (`npm install -g @anthropic-ai/claude-code`). Without it, init asks first, and only in an interactive terminal',
      type: 'boolean',
      default: false,
    },
    {
      name: 'project',
      description: 'Initialize <dir> instead of the current directory (validated to exist)',
      type: 'string',
    },
    {
      name: 'if-missing',
      description:
        'Create only files that do not already exist; never modify an existing CLAUDE.md, ' +
        'AGENTS.md, .claude/settings.json, .mcp.json, or any other existing file. Safe to run ' +
        'again on an already-initialized directory (idempotent — a second run creates nothing)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'agent-teams',
      description:
        "Enable Claude Code's experimental Agent Teams (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 " +
        'and the monomind.agentTeams settings). Off by default: teammates add background messages ' +
        'that wake the lead context and raise token use',
      type: 'boolean',
      default: false,
    },
    {
      name: 'json',
      description:
        'Print a machine-readable result on stdout — ' +
        '{root, created, skipped, claude_project_registered, duration_ms} — and suppress ' +
        'human-readable output',
      type: 'boolean',
      default: false,
    },
    {
      name: 'no-graph',
      description: 'Skip building the Monograph code graph (the slowest step of init)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'register-claude-project',
      description:
        'Create ~/.claude/projects/<slug>/ for this directory without a model call, so Claude ' +
        'Code / mono-agent lists it immediately (see doc/agent-exec-protocol.md §11)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'target',
      short: 't',
      description:
        'Coding system to initialize (default: the installed ones). `all` is all five; `agents` writes only AGENTS.md (not part of all)',
      type: 'string',
      choices: [
        'all',
        'claude',
        'antigravity',
        'opencode',
        'kimicode',
        'codex',
        'cline',
        'aider',
        'agents',
      ],
    },
    {
      name: 'platforms',
      description:
        'Platforms to write, comma-separated (claude,antigravity,opencode,kimi,codex, or any adapter id). ' +
        'Default: the ones installed here (CLI on PATH or ~/.<name> config), else Claude Code',
      type: 'string',
    },
    {
      name: 'platform',
      description: 'Same as --platforms (older spelling)',
      type: 'string',
    },
    {
      name: 'all-platforms',
      description:
        'Write all five platforms (claude, antigravity, opencode, kimi, codex), installed or not',
      type: 'boolean',
      default: false,
    },
    {
      name: 'enable-hooks',
      description: 'Opt in to deterministic native platform hooks',
      type: 'boolean',
      default: false,
    },
    {
      // Pinned by default (#419): a floating @latest re-resolves on every MCP
      // start (3–4 s), can hang on a cold npx cache and drifts mid-session.
      // `monomind init --force` re-pins after an upgrade.
      name: 'pin',
      description:
        'Version the generated MCP entry runs (default: this version; ' +
        '--pin <version> for another, --pin latest for monomind@latest)',
      type: 'string',
    },
    {
      name: 'no-pin',
      description: 'Launch the MCP server from monomind@latest (same as --pin latest)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'opencode',
      description: 'Initialize only OpenCode (alias for --target opencode)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'kimicode',
      description: 'Initialize only Kimi Code (alias for --target kimicode)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'codex',
      description: 'Initialize only Codex (alias for --target codex)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'start-all',
      description: 'Auto-start swarm and seed worker metrics after init (default: true)',
      type: 'boolean',
      default: true,
    },
    {
      // Declared as the positive `memory` so `--no-memory` reaches it (see
      // `watch` below). Initializes the same database `memory init` does.
      name: 'memory',
      description:
        'Initialize the memory database (.swarm/memory.db) during init (default: true; --no-memory skips)',
      type: 'boolean',
      default: true,
    },
    {
      // Declared as the positive `watch` so the parser's `--no-X` negation
      // actually reaches it. Declaring it as `no-watch` made `--no-watch` a
      // no-op — see the noWatch resolution in initAction.
      name: 'watch',
      description:
        'Start the monograph knowledge graph watcher after init ' +
        '(default: only when running interactively; --watch forces, --no-watch skips)',
      type: 'boolean',
      // Deliberately no `default`. The value must stay undefined when nobody
      // passed the flag, so init can tell "not asked" from "asked for true"
      // and only auto-start for an interactive user (#50).
    },
    {
      name: 'dashboard',
      description:
        'Start the dashboard (Control Room, :4242) at every Claude Code session start (writes .monomind/dashboard.json)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'with-embeddings',
      description:
        'Write the embeddings config and download the local embedding model memory search uses (one-time, needs network; degrades to keyword search offline)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'embedding-model',
      description: 'ONNX embedding model to use',
      type: 'string',
      default: DEFAULT_INIT_OPTIONS.embeddings.model,
      choices: [
        DEFAULT_INIT_OPTIONS.embeddings.model,
        'Xenova/all-MiniLM-L6-v2',
        'Xenova/all-mpnet-base-v2',
      ],
    },
  ],
  examples: [
    {
      command: 'monomind init',
      description: 'Initialize for the coding platforms installed on this machine',
    },
    {
      command: 'monomind init --no-start-all',
      description: 'Initialize without auto-starting services',
    },
    { command: 'monomind init --minimal', description: 'Initialize with minimal configuration' },
    { command: 'monomind init --full', description: 'Initialize with all components' },
    { command: 'monomind init --force', description: 'Reinitialize and overwrite existing config' },
    { command: 'monomind init --only-claude', description: 'Only create Claude Code integration' },
    { command: 'monomind init --skip-claude', description: 'Only create v1 runtime' },
    { command: 'monomind init --opencode', description: 'Initialize only OpenCode' },
    { command: 'monomind init --kimicode', description: 'Initialize only Kimi Code' },
    { command: 'monomind init --codex', description: 'Initialize only Codex' },
    {
      command: 'monomind init --platforms claude,codex',
      description: 'Initialize Claude Code and Codex, whatever is installed',
    },
    {
      command: 'monomind init --all-platforms',
      description: 'Initialize all five coding platforms (same as --target all)',
    },
    { command: 'monomind init --target codex', description: 'Initialize only Codex' },
    { command: 'monomind init wizard', description: 'Interactive setup wizard' },
    {
      command: 'monomind init --no-memory',
      description: 'Initialize without creating the memory database',
    },
    {
      command: 'monomind init --no-watch',
      description: 'Initialize without starting the background graph watcher',
    },
    {
      command: 'monomind init --dashboard',
      description: 'Auto-start the dashboard at every session start',
    },
    { command: 'monomind init --with-embeddings', description: 'Initialize with ONNX embeddings' },
    {
      command: 'monomind init --with-embeddings --embedding-model Xenova/all-mpnet-base-v2',
      description: 'Use larger embedding model',
    },
    { command: 'monomind init skills --all', description: 'Install all available skills' },
    { command: 'monomind init hooks --minimal', description: 'Create minimal hooks configuration' },
    { command: 'monomind init upgrade', description: 'Update helpers while preserving data' },
    {
      command: 'monomind init upgrade --settings',
      description: 'Update helpers and merge new settings (Agent Teams)',
    },
    { command: 'monomind init upgrade --verbose', description: 'Show detailed upgrade info' },
    {
      command: 'monomind init --project ./workspace --if-missing --json --yes --no-graph',
      description:
        'Headless, idempotent workspace init for a coder session (see doc/agent-exec-protocol.md §11)',
    },
  ],
  action: initAction,
};

export default initCommand;
