/**
 * CLI Commands Index
 * Central registry for all CLI commands
 *
 * Command modules are lazy-loaded on demand (mirrors mcp-client.ts's
 * CATEGORY_LOADERS pattern) so a single-command invocation — or `--version`,
 * which needs no command at all — only pays for that command's transitive
 * imports (e.g. the Claude Agent SDK pulled in by org.ts), not all 32.
 */

import type { Command } from '../types.js';

type CommandLoader = () => Promise<Command>;

const COMMAND_LOADERS: Record<string, CommandLoader> = {
  init: async () => (await import('./init.js')).initCommand,
  start: async () => (await import('./start.js')).startCommand,
  status: async () => (await import('./status.js')).statusCommand,
  task: async () => (await import('./task.js')).taskCommand,
  session: async () => (await import('./session.js')).sessionCommand,
  agent: async () => (await import('./agent.js')).agentCommand,
  monoswarm: async () => (await import('./monoswarm.js')).monoswarmCommand,
  memory: async () => (await import('./memory.js')).memoryCommand,
  mcp: async () => (await import('./mcp.js')).mcpCommand,
  hooks: async () => (await import('./hooks.js')).hooksCommand,
  doctor: async () => (await import('./doctor.js')).doctorCommand,
  performance: async () => (await import('./performance.js')).performanceCommand,
  security: async () => (await import('./security.js')).securityCommand,
  browse: async () => (await import('./browse.js')).default,
  config: async () => (await import('./config.js')).configCommand,
  completions: async () => (await import('./completions.js')).completionsCommand,
  analyze: async () => (await import('./analyze.js')).analyzeCommand,
  route: async () => (await import('./route.js')).routeCommand,
  providers: async () => (await import('./providers.js')).providersCommand,
  update: async () => (await import('./update.js')).default,
  guidance: async () => (await import('./guidance.js')).guidanceCommand,
  cleanup: async () => (await import('./cleanup.js')).cleanupCommand,
  autopilot: async () => (await import('./autopilot.js')).autopilotCommand,
  monograph: async () => (await import('./monograph.js')).monographCommand,
  tokens: async () => (await import('./tokens.js')).default,
  platforms: async () => (await import('./platforms.js')).platformsCommand,
  design: async () => (await import('./design-detect.js')).designCommand,
  search: async () => (await import('./search-universal.js')).searchUniversalCommand,
  'report-crash': async () => (await import('./report-crash.js')).reportCrashCommand,
  'crash-reporting': async () => (await import('./crash-reporting.js')).crashReportingCommand,
  doc: async () => (await import('./doc.js')).docCommand,
  org: async () => (await import('./org.js')).orgCommand,
  ui: async () => (await import('./ui.js')).uiCommand,
  events: async () => (await import('./events.js')).eventsCommand,
  'download-embeddings': async () =>
    (await import('./download-embeddings.js')).downloadEmbeddingsCommand,
};

// Top-level command aliases -> canonical loader key. Kept as a static table
// (rather than discovered by loading each command) so alias lookup never
// forces an import.
const COMMAND_ALIASES: Record<string, string> = {
  new: 'task',
  add: 'task',
  ls: 'session',
  an: 'analyze',
  clean: 'cleanup',
  dashboard: 'ui',
};

/**
 * Static grouping for help display. Mirrors the previous `commandsByCategory`
 * shape but by name only, so category membership is knowable without
 * importing anything. Real Command objects (with descriptions) are attached
 * on demand by `getCommandsByCategory()`.
 */
const CATEGORY_NAMES = {
  primary: [
    'init',
    'start',
    'status',
    'ui',
    'agent',
    'monoswarm',
    'org',
    'memory',
    'doc',
    'task',
    'session',
    'mcp',
    'hooks',
  ],
  advanced: ['security', 'performance', 'guidance', 'autopilot', 'design'],
  utility: ['config', 'doctor', 'completions', 'report-crash', 'crash-reporting', 'events'],
  analysis: ['analyze', 'route', 'monograph', 'tokens', 'search'],
  management: ['providers', 'update', 'cleanup', 'platforms', 'browse', 'download-embeddings'],
} as const;

// Cache of resolved commands, keyed by every name they're reachable under
// (canonical name + aliases). Populated incrementally as commands are
// loaded — never eagerly.
const loadedCommands = new Map<string, Command>();

function canonicalName(name: string): string | undefined {
  if (COMMAND_LOADERS[name]) return name;
  return COMMAND_ALIASES[name];
}

async function loadCommand(name: string): Promise<Command | undefined> {
  const canonical = canonicalName(name);
  if (!canonical) return undefined;
  const cached = loadedCommands.get(canonical);
  if (cached) return cached;
  const loader = COMMAND_LOADERS[canonical];
  const cmd = await loader();
  loadedCommands.set(canonical, cmd);
  if (cmd.aliases) {
    for (const alias of cmd.aliases) loadedCommands.set(alias, cmd);
  }
  return cmd;
}

/**
 * Backward-compatible alias for the resolved-command cache. Never eagerly
 * populated — same Map as `loadedCommands`, exposed under its old name.
 */
export const commandRegistry = loadedCommands;

export function getCommand(name: string): Command | undefined {
  return loadedCommands.get(name);
}

export async function getCommandAsync(name: string): Promise<Command | undefined> {
  return loadCommand(name);
}

export function hasCommand(name: string): boolean {
  return Boolean(canonicalName(name));
}

export function getCommandNames(): string[] {
  return Array.from(new Set([...Object.keys(COMMAND_LOADERS), ...Object.keys(COMMAND_ALIASES)]));
}

/**
 * Load every command. Used only by help/listing/suggestion paths, which need
 * the full set — same tradeoff mcp-client.ts's `ensureAllLoaded()` makes.
 */
export async function loadAllCommands(): Promise<Command[]> {
  const names = Object.keys(COMMAND_LOADERS);
  const all = await Promise.all(names.map((name) => loadCommand(name)));
  return all.filter((cmd): cmd is Command => Boolean(cmd));
}

export async function getUniqueCommands(): Promise<Command[]> {
  const all = await loadAllCommands();
  return all.filter((cmd) => !cmd.hidden);
}

/**
 * Real Command objects grouped by category, for help display. Loads
 * everything (help is a cold path — see `loadAllCommands`).
 */
export async function getCommandsByCategory(): Promise<
  Record<keyof typeof CATEGORY_NAMES, Command[]>
> {
  await loadAllCommands();
  const result = {} as Record<keyof typeof CATEGORY_NAMES, Command[]>;
  for (const category of Object.keys(CATEGORY_NAMES) as (keyof typeof CATEGORY_NAMES)[]) {
    result[category] = CATEGORY_NAMES[category]
      .map((name) => loadedCommands.get(name))
      .filter((cmd): cmd is Command => Boolean(cmd));
  }
  return result;
}

/**
 * Setup commands in a CLI instance (async — loads everything first).
 */
export async function setupAllCommands(cli: { command: (cmd: Command) => void }): Promise<void> {
  const allCommands = await loadAllCommands();
  for (const cmd of allCommands) {
    cli.command(cmd);
  }
}
