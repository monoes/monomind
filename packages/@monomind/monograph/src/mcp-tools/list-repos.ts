import { existsSync } from 'fs';
import { join } from 'path';
import { listRepos } from '../registry/repo-registry.js';

export interface ListReposResult {
  repos: Array<{
    name: string;
    path: string;
    dbPath: string;
    exists: boolean;
    indexedAt?: string;
  }>;
}

export const listReposTool = {
  name: 'monograph_list_repos',
  description: 'List all repositories indexed by monograph with their metadata.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
  },
  async handler(_args: Record<string, unknown>): Promise<ListReposResult> {
    const repos = listRepos();
    return {
      repos: repos.map((r) => {
        const dbPath = join(r.path, '.monomind', 'monograph.db');
        return {
          name: r.name,
          path: r.path,
          dbPath,
          exists: existsSync(dbPath),
          indexedAt: r.lastIndexed,
        };
      }),
    };
  },
};
