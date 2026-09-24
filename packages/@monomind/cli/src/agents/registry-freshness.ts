/**
 * Where the agent registry lives and when it must be rebuilt.
 *
 * `.monomind/registry.json` belongs to the PROJECT, not to whatever directory
 * the CLI happens to run in: `findProjectRoot` walks up from cwd, and
 * `ensureRegistry` rebuilds synchronously only when the file is missing or
 * older than the newest agent definition (an mtime scan, no parsing).
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { type AgentRegistry, buildUnifiedRegistry, computeAgentRoots } from './registry-builder.js';

/**
 * The nearest directory at or above `cwd` holding `.claude/agents` or
 * `.monomind`. The walk stops at the git root (inclusive) and never looks at
 * the home directory itself, whose `~/.monomind` is the user's global state,
 * not a project. Null when no project is found.
 */
export function findProjectRoot(cwd: string, home: string = homedir()): string | null {
  const stopAt = resolve(home);
  let dir = resolve(cwd);
  for (;;) {
    if (dir === stopAt) return null;
    if (existsSync(join(dir, '.claude', 'agents')) || existsSync(join(dir, '.monomind')))
      return dir;
    if (existsSync(join(dir, '.git'))) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Newest mtime (ms) of any agent `.md` under `roots` (directories count too,
 *  so a deleted file also marks the registry stale). 0 when there are none. */
export function newestAgentMtime(roots: string[]): number {
  let newest = 0;
  const walk = (dir: string): void => {
    let entries: import('node:fs').Dirent[];
    try {
      newest = Math.max(newest, statSync(dir).mtimeMs);
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && extname(e.name) === '.md') {
        try {
          newest = Math.max(newest, statSync(full).mtimeMs);
        } catch {
          /* vanished mid-scan */
        }
      }
    }
  };
  for (const root of roots) walk(root);
  return newest;
}

export const registryPath = (root: string): string => join(root, '.monomind', 'registry.json');

/** True when `root`'s registry is missing or older than an agent definition. */
export function registryIsStale(root: string): boolean {
  let at: number;
  try {
    at = statSync(registryPath(root)).mtimeMs;
  } catch {
    return true;
  }
  return newestAgentMtime(computeAgentRoots(root)) > at;
}

/**
 * Rebuilds `root`'s registry when stale, synchronously, so a caller that reads
 * it next (`monomind pick`, MCP pick) never races a fire-and-forget build.
 * Returns the built registry, or null when it was already fresh. Never throws.
 */
export function ensureRegistry(root: string): AgentRegistry | null {
  try {
    if (!registryIsStale(root)) return null;
    mkdirSync(join(root, '.monomind'), { recursive: true });
    return buildUnifiedRegistry(computeAgentRoots(root), registryPath(root), { base: root });
  } catch {
    return null;
  }
}
