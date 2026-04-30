/**
 * MCP Tool backing for monograph_group_list
 *
 * Returns metadata for each repo in a group: index timestamp and node count.
 */

import { join } from 'path';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import { parseGroupConfig } from '../groups/group-config.js';

export interface GroupRepoInfo {
  name: string;
  path: string;
  indexedAt: string | null;
  nodeCount: number;
}

export interface GroupListResult {
  groups: GroupInfo[];
}

export interface GroupInfo {
  name: string;
  repos: GroupRepoInfo[];
}

function getRepoDbPath(repoPath: string): string {
  return join(repoPath, '.monomind', 'monograph.db');
}

function readRepStats(
  repoName: string,
  repoPath: string,
): { indexedAt: string | null; nodeCount: number } {
  const dbPath = getRepoDbPath(repoPath);
  if (!existsSync(dbPath)) {
    return { indexedAt: null, nodeCount: 0 };
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });

    const metaRow = db
      .prepare(`SELECT value FROM index_meta WHERE key = 'indexed_at'`)
      .get() as { value: string } | undefined;

    const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM nodes`).get() as { cnt: number };

    return {
      indexedAt: metaRow?.value ?? null,
      nodeCount: countRow.cnt,
    };
  } catch (err) {
    console.warn(`[group-list] Error reading repo "${repoName}": ${err}`);
    return { indexedAt: null, nodeCount: 0 };
  } finally {
    db?.close();
  }
}

/**
 * Get list information for all repos in a group.
 *
 * @param configPath - Path to group.yaml (defaults to ./group.yaml)
 */
export async function getGroupList(configPath?: string): Promise<GroupListResult> {
  const resolvedPath = configPath ?? join(process.cwd(), 'group.yaml');
  const config = parseGroupConfig(resolvedPath);

  const repos: GroupRepoInfo[] = config.repos.map((repo) => {
    const { indexedAt, nodeCount } = readRepStats(repo.name, repo.path);
    return {
      name: repo.name,
      path: repo.path,
      indexedAt,
      nodeCount,
    };
  });

  return {
    groups: [
      {
        name: config.name,
        repos,
      },
    ],
  };
}
