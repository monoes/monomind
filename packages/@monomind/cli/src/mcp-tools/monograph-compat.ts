/**
 * Monograph compatibility shim — @monoes/monograph@1.2.0
 *
 * Only getGroupContracts and getGroupStatus are kept here because they are not
 * exported by the published @monoes/monograph@1.2.0. Everything else has been
 * moved to the real package.
 */

import { join, resolve, relative } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import { openDb, closeDb, countNodes } from '@monoes/monograph';

type Db = ReturnType<typeof openDb>;

// ── Group config reader ───────────────────────────────────────────────────────

interface GroupRepoEntry { name?: string; path?: string }

const MAX_GROUP_CONFIG_BYTES = 1 * 1024 * 1024; // 1 MB

function readGroupConfig(configPath: string): GroupRepoEntry[] {
  if (!existsSync(configPath)) return [];
  try {
    // Guard: only allow paths within cwd to prevent traversal to /etc/passwd etc.
    const resolved = resolve(configPath);
    const rel = relative(process.cwd(), resolved);
    if (rel.startsWith('..') || resolve(rel) === resolve('/')) return [];
    // OOM guard: skip files larger than 1 MB
    if (statSync(configPath).size > MAX_GROUP_CONFIG_BYTES) return [];
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as GroupRepoEntry[];
  } catch { return []; }
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
      closeDb(db);
      groups.push({
        name,
        indexed: nc > 0,
        stale: false,
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
