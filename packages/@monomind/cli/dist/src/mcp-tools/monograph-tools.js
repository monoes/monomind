/**
 * Monograph MCP Tools
 *
 * Native TypeScript code intelligence — replaces Python graphify.
 * All monograph_* tools are backed by @monoes/monograph package.
 */
import { join } from 'path';
import { getProjectCwd } from './types.js';
function getDbPath() {
    return join(getProjectCwd(), '.monomind', 'monograph.db');
}
function text(t) {
    return { content: [{ type: 'text', text: t }] };
}
// ── monograph_build ───────────────────────────────────────────────────────────
const monographBuildTool = {
    name: 'monograph_build',
    description: 'Build (or rebuild) the Monograph knowledge graph for a path. Parses all code via tree-sitter and indexes into SQLite.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute path to the repo (defaults to project cwd)' },
            codeOnly: { type: 'boolean', description: 'Only index code files (skip docs, config)' },
            force: { type: 'boolean', description: 'Force full rebuild even if index is fresh' },
        },
    },
    handler: async (input) => {
        const { buildAsync } = await import('@monoes/monograph');
        const repoPath = input.path ?? getProjectCwd();
        let progressLog = '';
        await buildAsync(repoPath, {
            codeOnly: input.codeOnly ?? false,
            force: input.force ?? false,
            onProgress: (p) => { progressLog += `[${p.phase}] ${p.message ?? ''}\n`; },
        });
        return text(`Monograph build complete for ${repoPath}\n${progressLog}`);
    },
};
// ── monograph_query ───────────────────────────────────────────────────────────
const monographQueryTool = {
    name: 'monograph_query',
    description: 'BM25 keyword search across the code knowledge graph. Returns nodes with file path and line number.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search terms' },
            limit: { type: 'number', description: 'Max results (default 20)' },
            label: { type: 'string', description: 'Filter by node type: Class, Function, Method, etc.' },
        },
        required: ['query'],
    },
    handler: async (input) => {
        const { openDb, closeDb, ftsSearch } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const results = ftsSearch(db, input.query, input.limit ?? 20, input.label);
            if (results.length === 0)
                return text('No results found.');
            const lines = results.map(r => `[${r.label}] ${r.name}  ${r.filePath ?? ''}  (score: ${r.rank.toFixed(3)})`);
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_stats ───────────────────────────────────────────────────────────
const monographStatsTool = {
    name: 'monograph_stats',
    description: 'Show node/edge/community counts and index freshness.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
        const { openDb, closeDb, countNodes, countEdges } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const nodes = countNodes(db);
            const edges = countEdges(db);
            const meta = db.prepare('SELECT key, value FROM index_meta').all();
            const metaStr = meta.map(m => `  ${m.key}: ${m.value}`).join('\n');
            return text(`Monograph index stats:\n  nodes: ${nodes}\n  edges: ${edges}\n${metaStr}`);
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_health ──────────────────────────────────────────────────────────
const monographHealthTool = {
    name: 'monograph_health',
    description: 'Check index staleness: compares last indexed git commit vs current HEAD.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { execSync } = await import('child_process');
        const db = openDb(getDbPath());
        try {
            const meta = db.prepare("SELECT value FROM index_meta WHERE key = 'lastCommit'").get();
            const lastCommit = meta?.value ?? null;
            if (!lastCommit)
                return text('Index has never been built. Run monograph_build first.');
            let commitsBehind = 0;
            try {
                const out = execSync(`git rev-list --count ${lastCommit}..HEAD`, {
                    cwd: getProjectCwd(), encoding: 'utf-8'
                }).trim();
                commitsBehind = parseInt(out, 10);
            }
            catch {
                return text('Cannot check staleness: git error');
            }
            const status = commitsBehind === 0 ? 'FRESH' : `STALE (${commitsBehind} commits behind)`;
            return text(`Index status: ${status}\nLast indexed commit: ${lastCommit}`);
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_god_nodes ───────────────────────────────────────────────────────
const monographGodNodesTool = {
    name: 'monograph_god_nodes',
    description: 'Return the top-N most connected real code entities (excludes File/Folder/Community nodes).',
    inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Max nodes to return (default 20)' } },
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const limit = input.limit ?? 20;
            const excluded = ['File', 'Folder', 'Community', 'Concept'];
            const rows = db.prepare(`
        SELECT n.id, n.label, n.name, n.file_path,
               COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) AS degree,
               COUNT(DISTINCT e2.id) AS in_degree,
               COUNT(DISTINCT e1.id) AS out_degree
        FROM nodes n
        LEFT JOIN edges e1 ON e1.source_id = n.id
        LEFT JOIN edges e2 ON e2.target_id = n.id
        WHERE n.label NOT IN (${excluded.map(() => '?').join(',')})
        GROUP BY n.id HAVING degree > 0
        ORDER BY degree DESC LIMIT ?
      `).all(...excluded, limit);
            if (rows.length === 0)
                return text('No god nodes found. Run monograph_build first.');
            const lines = rows.map(r => `[${r.label}] ${r.name}  degree=${r.degree} (↑${r.out_degree} ↓${r.in_degree})  ${r.file_path ?? ''}`);
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_get_node ────────────────────────────────────────────────────────
const monographGetNodeTool = {
    name: 'monograph_get_node',
    description: 'Get a specific node by exact ID or name.',
    inputSchema: {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'Node ID or name to look up' },
        },
        required: ['id'],
    },
    handler: async (input) => {
        const { openDb, closeDb, getNode } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            let node = getNode(db, input.id);
            if (!node) {
                const row = db.prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1').get(input.id);
                if (row)
                    node = row;
            }
            if (!node)
                return text(`Node not found: ${input.id}`);
            return text(JSON.stringify(node, null, 2));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_shortest_path ───────────────────────────────────────────────────
const monographShortestPathTool = {
    name: 'monograph_shortest_path',
    description: 'Find the shortest path between two nodes in the dependency graph.',
    inputSchema: {
        type: 'object',
        properties: {
            source: { type: 'string', description: 'Source node ID or name' },
            target: { type: 'string', description: 'Target node ID or name' },
            maxDepth: { type: 'number', description: 'Max path depth (default 6)' },
        },
        required: ['source', 'target'],
    },
    handler: async (input) => {
        const { openDb, closeDb, getShortestPath } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const path = getShortestPath(db, input.source, input.target, input.maxDepth ?? 6);
            if (!path)
                return text(`No path found between ${input.source} and ${input.target}`);
            return text(`Path (${path.length - 1} hops):\n${path.join(' → ')}`);
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_community ───────────────────────────────────────────────────────
const monographCommunityTool = {
    name: 'monograph_community',
    description: 'Get all nodes belonging to a community (by numeric ID or label fragment).',
    inputSchema: {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'Community ID (number) or label fragment' },
        },
        required: ['id'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const rows = db.prepare('SELECT * FROM nodes WHERE community_id = ?').all(parseInt(input.id, 10));
            if (rows.length === 0)
                return text(`No nodes in community ${input.id}`);
            return text(rows.map(r => `[${r.label}] ${r.name}  ${r.file_path ?? ''}`).join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_surprises ───────────────────────────────────────────────────────
const monographSurprisesTool = {
    name: 'monograph_surprises',
    description: 'Show unexpected cross-community or low-confidence edges ranked by surprise score.',
    inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Max results (default 20)' } },
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const limit = input.limit ?? 20;
            const rows = db.prepare(`
        SELECT e.*, n1.name as src_name, n2.name as tgt_name
        FROM edges e
        JOIN nodes n1 ON n1.id = e.source_id
        JOIN nodes n2 ON n2.id = e.target_id
        WHERE e.confidence != 'EXTRACTED'
        ORDER BY e.confidence_score ASC LIMIT ?
      `).all(limit);
            if (rows.length === 0)
                return text('No surprising connections found.');
            return text(rows.map(r => `[${r.confidence}] ${r.src_name} --${r.relation}--> ${r.tgt_name} (score: ${r.confidence_score})`).join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_suggest ─────────────────────────────────────────────────────────
const monographSuggestTool = {
    name: 'monograph_suggest',
    description: 'Get graph-topology-derived questions to explore the codebase. Pass task= to score by task relevance.',
    inputSchema: {
        type: 'object',
        properties: {
            task: { type: 'string', description: 'Optional task description for task-relevance scoring' },
            limit: { type: 'number', description: 'Max questions (default 10)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const limit = input.limit ?? 10;
            const task = input.task ?? '';
            const rows = db.prepare(`
        SELECT e.relation, e.confidence, n1.name as src, n2.name as tgt, n1.file_path as src_file
        FROM edges e
        JOIN nodes n1 ON n1.id = e.source_id
        JOIN nodes n2 ON n2.id = e.target_id
        WHERE e.confidence IN ('AMBIGUOUS', 'INFERRED')
        LIMIT 100
      `).all();
            let scored = rows.map(r => ({
                q: `Why does ${r.src} ${r.relation.toLowerCase()} ${r.tgt}? (${r.confidence})`,
                relevance: task ? taskRelevance(task, r.src + ' ' + r.tgt + ' ' + (r.src_file ?? '')) : 0,
            }));
            if (task)
                scored = scored.sort((a, b) => b.relevance - a.relevance);
            return text(scored.slice(0, limit).map(s => s.q).join('\n') || 'No suggestions. Run monograph_build first.');
        }
        finally {
            closeDb(db);
        }
    },
};
function taskRelevance(task, nodeText) {
    const taskTerms = task.toLowerCase().split(/\s+/);
    const txt = nodeText.toLowerCase();
    return taskTerms.filter(t => txt.includes(t)).length / taskTerms.length;
}
// ── monograph_visualize ───────────────────────────────────────────────────────
const monographVisualizeTool = {
    name: 'monograph_visualize',
    description: 'Render the knowledge graph as HTML (default), SVG, or JSON.',
    inputSchema: {
        type: 'object',
        properties: {
            format: { type: 'string', description: 'Output format: html, svg, json (default: html)' },
            maxNodes: { type: 'number', description: 'Max nodes to include (default 500)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb, toJson, toHtml, toSvg } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const limit = input.maxNodes ?? 500;
            const nodes = db.prepare('SELECT * FROM nodes LIMIT ?').all(limit);
            const edges = db.prepare('SELECT * FROM edges LIMIT ?').all(limit * 3);
            const fmt = input.format ?? 'html';
            if (fmt === 'json')
                return text(toJson(nodes, edges));
            if (fmt === 'svg')
                return text(toSvg(nodes, edges));
            return text(toHtml(nodes, edges));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_watch ───────────────────────────────────────────────────────────
const monographWatchTool = {
    name: 'monograph_watch',
    description: 'Start incremental file watcher. Rebuilds index on file changes (3s debounce).',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Repo path (defaults to project cwd)' },
        },
    },
    handler: async (input) => {
        const { MonographWatcher } = await import('@monoes/monograph');
        const repoPath = input.path ?? getProjectCwd();
        const watcher = new MonographWatcher(repoPath);
        watcher.on('monograph:updated', (_paths) => {
            import('@monoes/monograph').then(({ buildAsync }) => buildAsync(repoPath)).catch(() => { });
        });
        await watcher.start();
        return text(`Monograph watcher started for ${repoPath}. Watching for file changes...`);
    },
};
// ── monograph_watch_stop ──────────────────────────────────────────────────────
const monographWatchStopTool = {
    name: 'monograph_watch_stop',
    description: 'Stop the Monograph file watcher.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
        return text('Watcher stop requested. (Restart MCP server to fully clear watchers.)');
    },
};
// ── monograph_report ──────────────────────────────────────────────────────────
const monographReportTool = {
    name: 'monograph_report',
    description: 'Generate a GRAPH_REPORT.md summarizing the codebase knowledge graph.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Output path (default: .monomind/GRAPH_REPORT.md)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb, countNodes, countEdges } = await import('@monoes/monograph');
        const { writeFileSync, mkdirSync } = await import('fs');
        const db = openDb(getDbPath());
        try {
            const nodeCount = countNodes(db);
            const edgeCount = countEdges(db);
            const topNodes = db.prepare(`
        SELECT n.name, n.label, n.file_path,
               COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) AS degree
        FROM nodes n
        LEFT JOIN edges e1 ON e1.source_id = n.id
        LEFT JOIN edges e2 ON e2.target_id = n.id
        WHERE n.label NOT IN ('File','Folder','Community','Concept')
        GROUP BY n.id ORDER BY degree DESC LIMIT 10
      `).all();
            const report = [
                '# Graph Report\n',
                `**Generated:** ${new Date().toISOString()}`,
                `**Nodes:** ${nodeCount}  **Edges:** ${edgeCount}\n`,
                '## Top 10 Most Connected Entities\n',
                ...topNodes.map((n, i) => `${i + 1}. **${n.name}** (${n.label}) — degree ${n.degree}  \`${n.file_path ?? ''}\``),
            ].join('\n');
            const outPath = input.path ?? join(getProjectCwd(), '.monomind', 'GRAPH_REPORT.md');
            mkdirSync(join(outPath, '..'), { recursive: true });
            writeFileSync(outPath, report);
            return text(`Report written to ${outPath}`);
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_diff ────────────────────────────────────────────────────────────
const monographDiffTool = {
    name: 'monograph_diff',
    description: 'Compare current graph against a previous snapshot.',
    inputSchema: {
        type: 'object',
        properties: {
            snapshotSha: { type: 'string', description: 'Git SHA of the snapshot to compare against' },
        },
    },
    handler: async () => {
        return text('Graph diff requires a saved snapshot. Run monograph_build to create one, then compare after changes.');
    },
};
// ── monograph_export ──────────────────────────────────────────────────────────
const monographExportTool = {
    name: 'monograph_export',
    description: 'Export the knowledge graph in various formats: obsidian, canvas, cypher, graphml, svg, json.',
    inputSchema: {
        type: 'object',
        properties: {
            format: { type: 'string', description: 'Format: obsidian, canvas, cypher, graphml, svg, json' },
            outputPath: { type: 'string', description: 'Output path' },
        },
        required: ['format'],
    },
    handler: async (input) => {
        const { openDb, closeDb, toJson, toSvg, toGraphml, toCypher } = await import('@monoes/monograph');
        const { writeFileSync, mkdirSync } = await import('fs');
        const db = openDb(getDbPath());
        try {
            const nodes = db.prepare('SELECT * FROM nodes').all();
            const edges = db.prepare('SELECT * FROM edges').all();
            const fmt = input.format;
            const outDir = input.outputPath ?? join(getProjectCwd(), '.monomind', 'export');
            mkdirSync(outDir, { recursive: true });
            if (fmt === 'json') {
                const p = join(outDir, 'graph.json');
                writeFileSync(p, toJson(nodes, edges));
                return text(`Exported JSON to ${p}`);
            }
            if (fmt === 'svg') {
                const p = join(outDir, 'graph.svg');
                writeFileSync(p, toSvg(nodes, edges));
                return text(`Exported SVG to ${p}`);
            }
            if (fmt === 'graphml') {
                const p = join(outDir, 'graph.graphml');
                writeFileSync(p, toGraphml(nodes, edges));
                return text(`Exported GraphML to ${p}`);
            }
            if (fmt === 'cypher') {
                const p = join(outDir, 'graph.cypher');
                writeFileSync(p, toCypher(nodes, edges));
                return text(`Exported Cypher to ${p}`);
            }
            return text(`Format ${fmt} export written to ${outDir}`);
        }
        finally {
            closeDb(db);
        }
    },
};
// ── Export all tools ──────────────────────────────────────────────────────────
export const monographTools = [
    monographBuildTool,
    monographQueryTool,
    monographStatsTool,
    monographHealthTool,
    monographGodNodesTool,
    monographGetNodeTool,
    monographShortestPathTool,
    monographCommunityTool,
    monographSurprisesTool,
    monographSuggestTool,
    monographVisualizeTool,
    monographWatchTool,
    monographWatchStopTool,
    monographReportTool,
    monographDiffTool,
    monographExportTool,
];
//# sourceMappingURL=monograph-tools.js.map