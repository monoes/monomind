import { existsSync } from 'fs';
import { join } from 'path';
import { listRepos } from '../registry/repo-registry.js';
export const listReposTool = {
    name: 'monograph_list_repos',
    description: 'List all repositories indexed by monograph with their metadata.',
    inputSchema: {
        type: 'object',
        properties: {},
        required: [],
    },
    async handler(_args) {
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
//# sourceMappingURL=list-repos.js.map