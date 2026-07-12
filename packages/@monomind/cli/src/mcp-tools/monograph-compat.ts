/**
 * Monograph compatibility shim — @monoes/monograph@1.2.0
 *
 * Only getGroupContracts and getGroupStatus are kept here because they are not
 * exported by the published @monoes/monograph@1.2.0. Everything else has been
 * moved to the real package.
 */

import { join, resolve, relative } from 'path';
import { existsSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { openDb, closeDb, countNodes, parseGroupConfig, type GroupRepo } from '@monoes/monograph';
import { getProjectCwd } from './types.js';

type Db = ReturnType<typeof openDb>;

// ── Group config reader ───────────────────────────────────────────────────────

const MAX_GROUP_CONFIG_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Read repos from a group.yaml config (the real group config format used by
 * monograph_group_query / monograph_group_sync / monograph_group_list — see
 * @monoes/monograph's groups/group-config.ts).
 *
 * Throws on an out-of-bounds or oversized path instead of silently returning
 * an empty list, so callers can distinguish "no groups configured" from
 * "your repoPath was rejected".
 */
function readGroupConfig(configPath: string): GroupRepo[] {
  if (!existsSync(configPath)) return [];
  // Guard: only allow paths within the project cwd to prevent traversal to
  // /etc/passwd etc. Uses getProjectCwd() (honors MONOMIND_CWD) rather than
  // process.cwd(), which is trivially bypassed when the MCP server runs with
  // cwd "/".
  const projectCwd = getProjectCwd();
  const resolved = resolve(configPath);
  const rel = relative(projectCwd, resolved);
  if (rel.startsWith('..') || resolve(rel) === resolve('/')) {
    throw new Error(
      `Rejected group config path outside project directory: ${resolved} (project cwd: ${projectCwd})`,
    );
  }
  // OOM guard: skip files larger than 1 MB
  if (statSync(configPath).size > MAX_GROUP_CONFIG_BYTES) {
    throw new Error(`Group config file too large (> ${MAX_GROUP_CONFIG_BYTES} bytes): ${configPath}`);
  }
  return parseGroupConfig(configPath).repos;
}

/**
 * Compute whether a repo's monograph index is stale relative to HEAD, the
 * same way monograph_staleness does: compare the last indexed commit hash
 * against `git rev-list --count <lastCommit>..HEAD`. Mirrors the threshold
 * used by monograph-tools.ts (STALENESS_THRESHOLD = 10).
 */
function isRepoStale(db: Db, repoPath: string): boolean {
  try {
    const meta = (
      (db as any).prepare("SELECT value FROM index_meta WHERE key = 'last_commit_hash'").get()
      ?? (db as any).prepare("SELECT value FROM index_meta WHERE key = 'lastCommit'").get()
    ) as { value: string } | undefined;
    const lastCommit = meta?.value;
    if (!lastCommit || !/^[0-9a-f]{7,40}$/i.test(lastCommit)) return false;
    const out = execSync(`git rev-list --count ${lastCommit}..HEAD`, {
      cwd: repoPath, encoding: 'utf-8',
    }).trim();
    return parseInt(out, 10) > 10;
  } catch {
    return false;
  }
}

// ── getGroupContracts ─────────────────────────────────────────────────────────

export async function getGroupContracts(
  configPath: string,
): Promise<{ groupName: string; symbol: string; filePath: string | null; line: number | null }[]> {
  const repos = readGroupConfig(configPath);
  const result: { groupName: string; symbol: string; filePath: string | null; line: number | null }[] = [];

  for (const repo of repos) {
    const repoPath = repo.path ?? '';
    const dbPath = join(repoPath, '.monomind', 'monograph.db');
    if (!existsSync(dbPath)) continue;
    try {
      const db = openDb(dbPath);
      const exported = (db as any).prepare(
        "SELECT * FROM nodes WHERE is_exported = 1 AND label NOT IN ('File','Folder','Community','Concept') LIMIT 100"
      ).all() as any[];
      closeDb(db);
      for (const n of exported) {
        result.push({
          groupName: repo.name ?? repoPath,
          symbol: n.name as string,
          filePath: n.file_path ?? null,
          line: n.start_line ?? null,
        });
      }
    } catch { /* skip */ }
  }

  return result;
}

// ── getGroupStatus ────────────────────────────────────────────────────────────

export async function getGroupStatus(configPath: string): Promise<{
  totalGroups: number;
  indexedGroups: number;
  stalledGroups: number;
  groups: { name: string; indexed: boolean; stale: boolean; contractCount: number; lastSync?: string }[];
}> {
  const repos = readGroupConfig(configPath);
  if (repos.length === 0) {
    return { totalGroups: 0, indexedGroups: 0, stalledGroups: 0, groups: [] };
  }

  const groups: { name: string; indexed: boolean; stale: boolean; contractCount: number; lastSync?: string }[] = [];

  for (const repo of repos) {
    const repoPath = repo.path ?? '';
    const dbPath = join(repoPath, '.monomind', 'monograph.db');
    const name = repo.name ?? repoPath;
    if (!existsSync(dbPath)) {
      groups.push({ name, indexed: false, stale: false, contractCount: 0 });
      continue;
    }
    try {
      const db = openDb(dbPath);
      const nc = countNodes(db);
      const contracts = (db as any).prepare("SELECT COUNT(*) as n FROM nodes WHERE label = 'Route'").get() as any;
      const meta = (db as any).prepare("SELECT value FROM index_meta WHERE key IN ('ua_last_commit','lastCommit') LIMIT 1").get() as any;
      const stale = isRepoStale(db, repoPath);
      closeDb(db);
      groups.push({
        name,
        indexed: nc > 0,
        stale,
        contractCount: (contracts?.n as number) ?? 0,
        ...(meta?.value ? { lastSync: meta.value as string } : {}),
      });
    } catch {
      groups.push({ name, indexed: false, stale: false, contractCount: 0 });
    }
  }

  const indexedGroups = groups.filter(g => g.indexed).length;
  const stalledGroups = groups.filter(g => g.stale).length;
  return { totalGroups: groups.length, indexedGroups, stalledGroups, groups };
}
