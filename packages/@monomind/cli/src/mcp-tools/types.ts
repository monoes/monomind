/**
 * MCP Tool Types for CLI
 *
 * Local type definitions to avoid external imports outside package boundary.
 */

import { statSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

export interface MCPToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * Returns the effective project working directory.
 * Prefers MONOMIND_CWD (set by the install script for global/MCP installs
 * where process.cwd() may resolve to '/') over the real process.cwd().
 */
export function getProjectCwd(): string {
  return process.env.MONOMIND_CWD || process.cwd();
}

/**
 * Returns the stable Monomind data root that survives branch switches and is
 * shared across all git worktrees of the same repository.
 *
 * Resolution order:
 *   1. MONOMIND_DATA_DIR env var — allows overriding to e.g. ~/.monomind/<project>
 *   2. <repo>/.git/monomind/     — regular repo (branch-agnostic, shared by design)
 *   3. <main-repo>/.git/monomind/— worktree: .git is a pointer file → resolve to
 *                                  the shared .git dir of the main worktree
 *   4. <cwd>/.monomind/          — fallback when git is unavailable
 *
 * Mirrors the _getGitMonomindDir() function in server.mjs so session, task,
 * memory, and org data all land in the same stable location.
 */
const _dataRootCache = new Map<string, string>();
export function getMonomindDataRoot(cwd?: string): string {
  if (process.env.MONOMIND_DATA_DIR) return process.env.MONOMIND_DATA_DIR;
  const workDir = cwd || getProjectCwd();
  if (_dataRootCache.has(workDir)) return _dataRootCache.get(workDir)!;
  let result: string;
  try {
    const gitEntry = join(workDir, '.git');
    const st = statSync(gitEntry);
    if (st.isDirectory()) {
      result = join(gitEntry, 'monomind');
    } else {
      // Worktree: .git is a text file "gitdir: /main/.git/worktrees/name"
      const m = readFileSync(gitEntry, 'utf8').match(/^gitdir:\s*(.+)/m);
      if (m) {
        const worktreeDir = resolve(workDir, m[1].trim());
        const commonGitDir = dirname(dirname(worktreeDir));
        result = join(commonGitDir, 'monomind');
      } else {
        result = join(workDir, '.monomind');
      }
    }
  } catch {
    result = join(workDir, '.monomind');
  }
  _dataRootCache.set(workDir, result);
  return result;
}

/**
 * One-time migration for the agent/task/hive/swarm stores that historically lived
 * under `<projectCwd>/.monomind/<subpath>` (via getProjectCwd()) before being
 * consolidated onto the canonical getMonomindDataRoot() location (typically
 * `<repo>/.git/monomind/<subpath>`). Several MCP tool files (agent-tools.ts,
 * hive-mind-tools.ts, swarm-tools.ts, system-tools.ts) used to read/write the
 * legacy path directly, causing the same logical store to physically split from
 * task-tools.ts/session-tools.ts, which always used getMonomindDataRoot().
 *
 * If the canonical file is missing but the legacy file exists, copy (never move,
 * for safety) the legacy file into place so pre-existing data isn't silently
 * orphaned. Best-effort and idempotent — never throws, and it's a no-op once the
 * canonical file exists or when the two paths already coincide (e.g. no .git).
 *
 * @param canonicalPath Absolute path under getMonomindDataRoot() the tool now reads from.
 * @param legacySubpath Path relative to `.monomind/` that the tool used to read from
 *   (e.g. `join('agents', 'store.json')`).
 * @param cwd Optional project cwd override (defaults to getProjectCwd()).
 */
export function migrateLegacyStoreFile(canonicalPath: string, legacySubpath: string, cwd?: string): void {
  try {
    if (existsSync(canonicalPath)) return;
    const legacyPath = join(cwd || getProjectCwd(), '.monomind', legacySubpath);
    if (legacyPath === canonicalPath) return;
    if (!existsSync(legacyPath)) return;
    mkdirSync(dirname(canonicalPath), { recursive: true });
    copyFileSync(legacyPath, canonicalPath);
  } catch {
    // Best-effort; leave both stores as-is on any failure.
  }
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
  category?: string;
  tags?: string[];
  version?: string;
  cacheable?: boolean;
  cacheTTL?: number;
  handler: (input: Record<string, unknown>, context?: Record<string, unknown>) => Promise<MCPToolResult | unknown>;
}
