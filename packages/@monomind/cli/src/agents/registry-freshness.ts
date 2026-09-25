/**
 * Where the agent registry lives and when it must be rebuilt.
 *
 * `.monomind/registry.json` belongs to the PROJECT, not to whatever directory
 * the CLI happens to run in: `findProjectRoot` walks up from cwd, and
 * `ensureRegistry` rebuilds synchronously only when the file is missing or
 * older than the newest agent definition — project, user (~/.claude/agents)
 * or extra — an mtime scan, no parsing. Implemented in
 * .claude/helpers/agent-registry.cjs, which the SessionStart hook shares.
 */
import { homedir } from 'node:os';
import {
  type AgentRegistry,
  type AgentRoot,
  type AgentRootOptions,
  agentRegistryModule,
} from './registry-builder.js';

/**
 * The nearest directory at or above `cwd` holding `.claude/agents` or
 * `.monomind`. The walk stops at the git root (inclusive) and never looks at
 * the home directory itself, whose `~/.monomind` is the user's global state,
 * not a project. Null when no project is found.
 */
export function findProjectRoot(cwd: string, home: string = homedir()): string | null {
  return agentRegistryModule().findProjectRoot(cwd, home);
}

/** Newest mtime (ms) of any agent `.md` under `roots` (directories count too,
 *  so a deleted file also marks the registry stale). 0 when there are none. */
export function newestAgentMtime(roots: (string | AgentRoot)[]): number {
  return agentRegistryModule().newestAgentMtime(roots);
}

export const registryPath = (root: string): string => agentRegistryModule().registryPath(root);

/** True when `root`'s registry is missing or older than an agent definition. */
export function registryIsStale(root: string, opts?: AgentRootOptions): boolean {
  return agentRegistryModule().isStale(root, opts);
}

/**
 * Rebuilds `root`'s registry when stale, synchronously, so a caller that reads
 * it next (`monomind pick`, MCP pick) never races a fire-and-forget build.
 * Returns the built registry, or null when it was already fresh. Never throws.
 */
export function ensureRegistry(root: string, opts?: AgentRootOptions): AgentRegistry | null {
  try {
    return agentRegistryModule().ensure(root, opts);
  } catch {
    return null;
  }
}
