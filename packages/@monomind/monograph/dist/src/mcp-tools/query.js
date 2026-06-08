import { join } from 'path';
import { openDb, closeDb } from '../storage/db.js';
import { hybridQuery } from '../search/hybrid-query.js';
export const monographQueryTool = {
    name: 'monograph_query',
    description: 'Process-aware hybrid search across the monograph knowledge graph. Returns symbols and process nodes ranked by relevance.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query' },
            repoPath: { type: 'string', description: 'Absolute path to the repository root' },
            topK: { type: 'number', description: 'Max results to return (default: 20)' },
            includeProcesses: {
                type: 'boolean',
                description: 'Include Process nodes in results (default: true)',
            },
        },
        required: ['query'],
    },
    async handler(args) {
        const { query, repoPath, topK = 20, includeProcesses = true } = args;
        let db = null;
        let shouldClose = false;
        if (args.db) {
            db = args.db;
        }
        else if (repoPath) {
            db = openDb(join(repoPath, '.monomind', 'monograph.db'));
            shouldClose = true;
        }
        else {
            return { query, results: [], processCount: 0, symbolCount: 0 };
        }
        try {
            const hits = await hybridQuery(db, query, { limit: topK * 3 });
            const results = hits
                .filter(h => includeProcesses || h.label !== 'Process')
                .map(h => ({
                id: h.id,
                label: h.label ?? 'Symbol',
                name: h.name ?? h.id,
                filePath: h.filePath ?? undefined,
                score: h.score,
                isProcess: h.label === 'Process',
            }));
            return {
                query,
                results,
                processCount: results.filter(r => r.isProcess).length,
                symbolCount: results.filter(r => !r.isProcess).length,
            };
        }
        finally {
            if (shouldClose && db)
                closeDb(db);
        }
    },
};
//# sourceMappingURL=query.js.map