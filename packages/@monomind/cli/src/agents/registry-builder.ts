/**
 * Registry Builder (Task 30)
 *
 * Scans agent definition .md files, parses YAML frontmatter, and produces a
 * unified AgentRegistry JSON. The implementation lives in
 * .claude/helpers/agent-registry.cjs — shared with the SessionStart hook,
 * which cannot import TypeScript — and this module is its typed interface.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type TriggerPattern = { pattern: string; mode: 'glob' | 'regex' | 'exact' };
/** Where an agent definition came from: the project's `.claude/agents`, the
 *  user's `~/.claude/agents`, or an extra root (MONOMIND_EXTRA_AGENT_PATHS /
 *  a sibling agency-agents dir). */
export type AgentOrigin = 'project' | 'user' | 'extra';
type AgentRegistryEntry = {
  slug: string;
  name: string;
  version: string;
  category: string;
  description: string;
  /** One-line `when_to_use:` frontmatter — the picker's lead description. */
  whenToUse?: string;
  tags: string[];
  /** Optional `vibe:` frontmatter (personality line); stored, never ranked. */
  vibe?: string;
  capabilities: string[];
  taskTypes: string[];
  tools: string[];
  triggers: TriggerPattern[];
  deprecated: boolean;
  deprecatedBy?: string;
  dependencies: string[];
  origin: AgentOrigin;
  /** Relative to the project, or `~/.claude/agents/...` for a user agent. */
  filePath: string;
  registeredAt: string;
  lastUpdated: string;
};
/** A slug defined more than once: the first file kept, the others dropped. */
export type DuplicateSlug = { slug: string; kept: string; dropped: string[] };
/** A user agent left out because a project or extra agent has its slug or name. */
export type ShadowedAgent = { slug: string; name: string; filePath: string };
export type AgentRegistry = {
  version: string;
  generatedAt: string;
  totalAgents: number;
  /** Indexed agents per origin. */
  counts: Record<AgentOrigin, number>;
  agents: AgentRegistryEntry[];
  /** Duplicate slugs found while building (first root / first file wins). */
  duplicates: DuplicateSlug[];
  shadowed: ShadowedAgent[];
};
/** One agent-definition directory. `label` replaces the directory in
 *  recorded filePaths (`~/.claude/agents`). */
export type AgentRoot = { dir: string; origin: AgentOrigin; label?: string };
export type AgentRootOptions = { home?: string; user?: boolean; env?: NodeJS.ProcessEnv };

interface AgentRegistryModule {
  USER_LABEL: string;
  computeAgentRoots(cwd: string, opts?: AgentRootOptions): AgentRoot[];
  buildUnifiedRegistry(
    roots: (string | AgentRoot)[],
    outputPath?: string,
    opts?: { base?: string },
  ): AgentRegistry;
  writeRegistryFile(file: string, registry: AgentRegistry): boolean;
  newestAgentMtime(dirs: (string | AgentRoot)[]): number;
  registryPath(root: string): string;
  isStale(root: string, opts?: AgentRootOptions): boolean;
  ensure(root: string, opts?: AgentRootOptions): AgentRegistry | null;
  findProjectRoot(cwd: string, home?: string): string | null;
}

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/agents → ../.. is the package root; dist/src/agents → ../../.. */
const HELPER_CANDIDATES = [
  join(HERE, '..', '..', '.claude', 'helpers', 'agent-registry.cjs'),
  join(HERE, '..', '..', '..', '.claude', 'helpers', 'agent-registry.cjs'),
];

let loaded: AgentRegistryModule | undefined;

/** The shared CommonJS implementation; throws on an install without it. */
export function agentRegistryModule(): AgentRegistryModule {
  if (loaded) return loaded;
  const file = HELPER_CANDIDATES.find((p) => existsSync(p));
  if (!file) throw new Error('agent-registry.cjs not found in the monomind package');
  loaded = createRequire(import.meta.url)(file) as AgentRegistryModule;
  return loaded;
}

/** `~/.claude/agents` — how user agents' filePaths are recorded. */
export const USER_AGENTS_LABEL = '~/.claude/agents';

/**
 * Build the agent registry by scanning `.md` files under `agentsRoot`.
 *
 * @param agentsRoot - Root directory to scan.
 * @param outputPath - Optional path to write the registry JSON file.
 * @returns The built AgentRegistry object.
 */
export function buildRegistry(agentsRoot: string, outputPath?: string): AgentRegistry {
  return buildUnifiedRegistry([agentsRoot], outputPath);
}

/**
 * The ordered agent-definition roots for `cwd`: extras (canonical, from
 * MONOMIND_EXTRA_AGENT_PATHS or a sibling `agency-agents` dir), the project's
 * `.claude/agents`, then the user's `~/.claude/agents` (`opts.user: false`
 * leaves it out, `opts.home` overrides the home directory). Shared by CLI
 * startup, pick and `monomind doctor` so all build the registry the same way.
 */
export function computeAgentRoots(cwd: string, opts?: AgentRootOptions): AgentRoot[] {
  return agentRegistryModule().computeAgentRoots(cwd, opts);
}

/**
 * Build a unified agent registry from multiple roots, deduplicating by slug:
 * the first root in the array wins (a plain path counts as a project root).
 * A `user` agent also loses to an earlier agent with the same frontmatter
 * `name` — Claude Code gives project agents precedence over user agents.
 *
 * @param roots      - Ordered list of roots to scan (first-wins on slug conflict).
 * @param outputPath - Optional path to write the merged registry JSON file.
 * @returns The deduplicated AgentRegistry.
 */
export function buildUnifiedRegistry(
  roots: (string | AgentRoot)[],
  outputPath?: string,
  opts: { base?: string } = {},
): AgentRegistry {
  return agentRegistryModule().buildUnifiedRegistry(roots, outputPath, opts);
}

/**
 * Atomically writes `registry` to `file` — except an empty registry never
 * replaces a non-empty one (a build from a directory without agent files must
 * not wipe the project's catalog). Returns whether the file was written.
 */
export function writeRegistryFile(file: string, registry: AgentRegistry): boolean {
  return agentRegistryModule().writeRegistryFile(file, registry);
}
