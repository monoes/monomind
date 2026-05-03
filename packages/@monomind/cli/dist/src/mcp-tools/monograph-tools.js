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
    description: 'Build (or rebuild) the Monograph knowledge graph for a path. Indexes code (tree-sitter AST) AND documents (Markdown/MDX/txt/rst/PDF) — sections, wiki links, #tags, frontmatter, cross-references, and contextual concept proximity all become graph nodes/edges. Pass llmMaxSections > 0 to enrich with Claude-inferred semantic relationships (requires ANTHROPIC_API_KEY).',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute path to the repo (defaults to project cwd)' },
            codeOnly: { type: 'boolean', description: 'Only index code files (skip docs, config)' },
            force: { type: 'boolean', description: 'Force full rebuild even if index is fresh' },
            llmMaxSections: { type: 'number', description: 'Max doc sections to enrich with Claude-extracted semantic triples (0 = disabled, default 0). Requires ANTHROPIC_API_KEY.' },
        },
    },
    handler: async (input) => {
        const { buildAsync } = await import('@monoes/monograph');
        const repoPath = input.path ?? getProjectCwd();
        let progressLog = '';
        await buildAsync(repoPath, {
            codeOnly: input.codeOnly ?? false,
            force: input.force ?? false,
            llmMaxSections: input.llmMaxSections ?? 0,
            onProgress: (p) => { progressLog += `[${p.phase}] ${p.message ?? ''}\n`; },
        });
        return text(`Monograph build complete for ${repoPath}\n${progressLog}`);
    },
};
// ── monograph_query ───────────────────────────────────────────────────────────
const monographQueryTool = {
    name: 'monograph_query',
    description: 'Search the knowledge graph across code AND docs. Supports BM25 keyword search (default), semantic/embedding-based search, or hybrid (BM25 + cosine merged via RRF). Use label="Section" to search only docs, label="Function" for only code.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search terms' },
            limit: { type: 'number', description: 'Max results (default 20)' },
            label: { type: 'string', description: 'Filter by node type: Class, Function, Method, Section, Concept, File, etc.' },
            mode: { type: 'string', enum: ['bm25', 'semantic', 'hybrid'], description: 'Search mode: bm25 (default), semantic (embedding cosine), hybrid (both merged via RRF)' },
        },
        required: ['query'],
    },
    handler: async (input) => {
        const { openDb, closeDb, ftsSearch, semanticSearch } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        const limit = input.limit ?? 20;
        const label = input.label;
        const mode = input.mode ?? 'bm25';
        try {
            if (mode === 'semantic') {
                const results = semanticSearch(db, input.query, limit, label);
                if (results.length === 0)
                    return text('No results found.');
                const lines = results.map(r => `[${r.label}] ${r.name}  ${r.filePath ?? ''}  (score: ${r.score.toFixed(4)})`);
                return text(lines.join('\n'));
            }
            if (mode === 'hybrid') {
                const bm25 = ftsSearch(db, input.query, limit * 2, label);
                const sem = semanticSearch(db, input.query, limit * 2, label);
                // RRF merge: score = Σ 1/(60 + rank)
                const K = 60;
                const scores = new Map();
                const meta = new Map();
                bm25.forEach((r, i) => {
                    scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (K + i + 1));
                    meta.set(r.id, { label: r.label, name: r.name, filePath: r.filePath });
                });
                sem.forEach((r, i) => {
                    scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (K + i + 1));
                    if (!meta.has(r.id))
                        meta.set(r.id, { label: r.label, name: r.name, filePath: r.filePath });
                });
                const merged = [...scores.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, limit);
                if (merged.length === 0)
                    return text('No results found.');
                const lines = merged.map(([id, score]) => {
                    const m = meta.get(id);
                    return `[${m.label}] ${m.name}  ${m.filePath ?? ''}  (rrf: ${score.toFixed(4)})`;
                });
                return text(lines.join('\n'));
            }
            // default: bm25
            const results = ftsSearch(db, input.query, limit, label);
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
            const actions = rows.map(r => ({
                type: 'refactor',
                file: r.file_path ?? undefined,
                symbol: r.name,
                description: `High-centrality node (${r.degree} connections) — consider decomposing`,
                confidence: 'medium',
            }));
            return text(lines.join('\n') + '\n\n## Actions\n' + JSON.stringify(actions, null, 2));
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
            const mainText = rows.map(r => `[${r.confidence}] ${r.src_name} --${r.relation}--> ${r.tgt_name} (score: ${r.confidence_score})`).join('\n');
            const actions = rows.map(r => {
                if (r.confidence === 'AMBIGUOUS') {
                    return {
                        type: 'review',
                        file: r.src_file ?? undefined,
                        description: `Unexpected cross-community dependency: ${r.src_name} --${r.relation}--> ${r.tgt_name}`,
                        confidence: 'medium',
                    };
                }
                return {
                    type: 'investigate',
                    description: `Verify inferred edge ${r.relation}: ${r.src_name} → ${r.tgt_name} (score: ${r.confidence_score})`,
                    confidence: 'low',
                };
            });
            return text(mainText + '\n\n## Actions\n' + JSON.stringify(actions, null, 2));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_suggest ─────────────────────────────────────────────────────────
const monographSuggestTool = {
    name: 'monograph_suggest',
    description: 'Get graph-topology-derived questions to explore the codebase: ambiguous edges, bridge nodes (high cross-community degree), isolated nodes, and god nodes. Pass task= to rank by relevance.',
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
            const questions = [];
            // 1. AMBIGUOUS/INFERRED edges
            const ambiguousRows = db.prepare(`
        SELECT e.relation, e.confidence, n1.name as src, n2.name as tgt, n1.file_path as src_file
        FROM edges e
        JOIN nodes n1 ON n1.id = e.source_id
        JOIN nodes n2 ON n2.id = e.target_id
        WHERE e.confidence IN ('AMBIGUOUS', 'INFERRED')
        LIMIT 60
      `).all();
            for (const r of ambiguousRows) {
                questions.push({
                    type: 'ambiguous_edge',
                    q: `What is the exact relationship between \`${r.src}\` and \`${r.tgt}\`?`,
                    why: `Edge tagged ${r.confidence} (relation: ${r.relation}) — confidence is low.`,
                    relevance: task ? taskRelevance(task, r.src + ' ' + r.tgt + ' ' + (r.src_file ?? '')) : 0,
                });
            }
            // 2. Bridge nodes — high cross-community degree
            const bridges = db.prepare(`
        SELECT n.name, n.label, n.file_path, n.community_id,
               COUNT(DISTINCT e1.target_id) + COUNT(DISTINCT e2.source_id) AS degree
        FROM nodes n
        LEFT JOIN edges e1 ON e1.source_id = n.id
        LEFT JOIN edges e2 ON e2.target_id = n.id
        WHERE n.label NOT IN ('File','Folder','Community','Concept') AND n.community_id IS NOT NULL
        GROUP BY n.id HAVING degree > 2
        ORDER BY degree DESC LIMIT 5
      `).all();
            for (const b of bridges) {
                questions.push({
                    type: 'bridge_node',
                    q: `Why is \`${b.name}\` (${b.label}) a cross-cutting concern connecting multiple modules?`,
                    why: `High degree=${b.degree} in community ${b.community_id} — potential architecture hub.`,
                    relevance: task ? taskRelevance(task, b.name + ' ' + (b.file_path ?? '')) : 0,
                });
            }
            // 3. Isolated nodes (no edges) — potential dead code
            const isolated = db.prepare(`
        SELECT n.name, n.label, n.file_path FROM nodes n
        WHERE n.label NOT IN ('File','Folder','Community','Concept')
        AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)
        LIMIT 5
      `).all();
            for (const iso of isolated) {
                questions.push({
                    type: 'isolated_node',
                    q: `Is \`${iso.name}\` (${iso.label}) dead code or an entry point with no declared consumers?`,
                    why: `Zero edges in the graph — either unused or not yet indexed.`,
                    relevance: task ? taskRelevance(task, iso.name + ' ' + (iso.file_path ?? '')) : 0,
                });
            }
            // Sort by relevance if task given, otherwise keep type-balanced order
            if (task)
                questions.sort((a, b) => b.relevance - a.relevance);
            const topQuestions = questions.slice(0, limit);
            const out = topQuestions.map(q => `[${q.type}] ${q.q}\n  → ${q.why}`).join('\n\n');
            if (!out)
                return text('No suggestions. Run monograph_build first.');
            // Build structured actions from the raw DB rows we already have
            const actions = [];
            for (const r of ambiguousRows.slice(0, limit)) {
                actions.push({
                    type: 'review',
                    file: r.src_file ?? undefined,
                    description: `Verify edge type: ${r.relation} between ${r.src} and ${r.tgt}`,
                    confidence: 'medium',
                });
            }
            for (const b of bridges.slice(0, limit)) {
                actions.push({
                    type: 'investigate',
                    file: b.file_path ?? undefined,
                    description: `Bridge between communities — high coupling risk (degree=${b.degree})`,
                    confidence: 'high',
                });
            }
            for (const iso of isolated) {
                actions.push({
                    type: 'delete',
                    file: iso.file_path ?? undefined,
                    symbol: iso.name,
                    description: `No edges — candidate for removal if unused`,
                    confidence: isolated.length === 1 ? 'high' : 'low',
                });
            }
            return text(out + '\n\n## Actions\n' + JSON.stringify(actions, null, 2));
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
// ── monograph_impact ──────────────────────────────────────────────────────────
const monographImpactTool = {
    name: 'monograph_impact',
    description: 'Blast-radius analysis: find all files/modules that depend on (import) a given file or symbol, up to a configurable depth. Shows upstream (dependents) and downstream (dependencies) separately.',
    inputSchema: {
        type: 'object',
        properties: {
            target: { type: 'string', description: 'File path fragment or node name to analyze' },
            direction: { type: 'string', description: 'upstream (who depends on this), downstream (what this depends on), or both (default: both)' },
            maxDepth: { type: 'number', description: 'Max traversal depth (default 4, max 10)' },
        },
        required: ['target'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const target = input.target;
            const direction = input.direction ?? 'both';
            const maxDepth = Math.min(input.maxDepth ?? 4, 10);
            // Resolve node — try exact file_path match first, then name, then LIKE
            const node = db.prepare("SELECT * FROM nodes WHERE file_path = ? OR name = ? LIMIT 1").get(target, target)
                ?? db.prepare("SELECT * FROM nodes WHERE file_path LIKE ? OR name LIKE ? LIMIT 1").get(`%${target}%`, `%${target}%`);
            if (!node)
                return text(`Node not found for: ${target}`);
            function bfs(startId, followSource, depth) {
                const visited = new Map();
                let frontier = [startId];
                for (let d = 1; d <= depth && frontier.length > 0; d++) {
                    const next = [];
                    for (const id of frontier) {
                        const col = followSource ? 'source_id' : 'target_id';
                        const otherCol = followSource ? 'target_id' : 'source_id';
                        const edges = db.prepare(`SELECT ${otherCol} as other_id FROM edges WHERE ${col} = ? AND relation = 'IMPORTS'`).all(id);
                        for (const e of edges) {
                            if (!visited.has(e.other_id) && e.other_id !== startId) {
                                const n = db.prepare('SELECT * FROM nodes WHERE id = ?').get(e.other_id);
                                if (n) {
                                    visited.set(e.other_id, { node: n, depth: d });
                                    next.push(e.other_id);
                                }
                            }
                        }
                    }
                    frontier = next;
                }
                return visited;
            }
            const lines = [`Impact analysis for: [${node.label}] ${node.name}  ${node.file_path ?? ''}\n`];
            const upstreamMap = (direction === 'upstream' || direction === 'both') ? bfs(node.id, false, maxDepth) : new Map();
            const downstreamMap = (direction === 'downstream' || direction === 'both') ? bfs(node.id, true, maxDepth) : new Map();
            if (direction === 'upstream' || direction === 'both') {
                lines.push(`UPSTREAM (${upstreamMap.size} dependents — files that import this):`);
                if (upstreamMap.size === 0)
                    lines.push('  (none)');
                else
                    [...upstreamMap.values()].sort((a, b) => a.depth - b.depth).forEach(({ node: n, depth: d }) => lines.push(`  [depth ${d}] ${n.file_path ?? n.name}`));
            }
            if (direction === 'downstream' || direction === 'both') {
                lines.push(`\nDOWNSTREAM (${downstreamMap.size} dependencies — files this imports):`);
                if (downstreamMap.size === 0)
                    lines.push('  (none)');
                else
                    [...downstreamMap.values()].sort((a, b) => a.depth - b.depth).forEach(({ node: n, depth: d }) => lines.push(`  [depth ${d}] ${n.file_path ?? n.name}`));
            }
            // Build structured actions for all impacted nodes
            const allImpacted = [...upstreamMap.values(), ...downstreamMap.values()];
            const actions = allImpacted.map(({ node: n }) => ({
                type: 'review',
                file: n.file_path ?? undefined,
                description: `Impacted by change — verify still correct`,
                confidence: 'high',
            }));
            return text(lines.join('\n') + (actions.length > 0 ? '\n\n## Actions\n' + JSON.stringify(actions, null, 2) : ''));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_context ─────────────────────────────────────────────────────────
const monographContextTool = {
    name: 'monograph_context',
    description: '360-degree view of a file or symbol: its direct importers, its direct imports, community, and location in the containment tree.',
    inputSchema: {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'File path fragment or node name' },
        },
        required: ['id'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const target = input.id;
            const node = db.prepare("SELECT * FROM nodes WHERE file_path = ? OR name = ? LIMIT 1").get(target, target)
                ?? db.prepare("SELECT * FROM nodes WHERE file_path LIKE ? OR name LIKE ? LIMIT 1").get(`%${target}%`, `%${target}%`);
            if (!node)
                return text(`Node not found for: ${target}`);
            // Direct importers (upstream)
            const importers = db.prepare(`
        SELECT n.* FROM edges e JOIN nodes n ON n.id = e.source_id
        WHERE e.target_id = ? AND e.relation = 'IMPORTS'
      `).all(node.id);
            // Direct imports (downstream)
            const imports = db.prepare(`
        SELECT n.* FROM edges e JOIN nodes n ON n.id = e.target_id
        WHERE e.source_id = ? AND e.relation = 'IMPORTS'
      `).all(node.id);
            // Containment parent
            const parent = db.prepare(`
        SELECT n.* FROM edges e JOIN nodes n ON n.id = e.source_id
        WHERE e.target_id = ? AND e.relation = 'CONTAINS' LIMIT 1
      `).get(node.id);
            // Community siblings
            let siblings = [];
            if (node.community_id != null) {
                siblings = db.prepare(`
          SELECT * FROM nodes WHERE community_id = ? AND id != ? LIMIT 10
        `).all(node.community_id, node.id);
            }
            const lines = [
                `Context for: [${node.label}] ${node.name}`,
                `  File: ${node.file_path ?? '(none)'}  Lines: ${node.start_line ?? '?'}–${node.end_line ?? '?'}`,
                `  Community: ${node.community_id ?? 'none'}  Exported: ${node.is_exported ? 'yes' : 'no'}`,
                '',
                `Parent: ${parent ? `[${parent.label}] ${parent.name}` : '(root)'}`,
                '',
                `Imports (${imports.length}):`,
                ...imports.map((n) => `  → ${n.file_path ?? n.name}`),
                imports.length === 0 ? '  (none)' : '',
                `Imported by (${importers.length}):`,
                ...importers.map((n) => `  ← ${n.file_path ?? n.name}`),
                importers.length === 0 ? '  (none)' : '',
                `Community ${node.community_id} siblings (${siblings.length}):`,
                ...siblings.map((n) => `  ~ [${n.label}] ${n.file_path ?? n.name}`),
                siblings.length === 0 ? '  (none)' : '',
            ];
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_detect_changes ──────────────────────────────────────────────────
const monographDetectChangesTool = {
    name: 'monograph_detect_changes',
    description: 'Map current git changes (unstaged, staged, or since last indexed commit) to affected graph nodes and their dependents.',
    inputSchema: {
        type: 'object',
        properties: {
            scope: { type: 'string', description: 'unstaged (default), staged, all, or since-indexed' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { execSync } = await import('child_process');
        const db = openDb(getDbPath());
        try {
            const scope = input.scope ?? 'unstaged';
            const cwd = getProjectCwd();
            let changedFiles = [];
            if (scope === 'since-indexed') {
                const meta = db.prepare("SELECT value FROM index_meta WHERE key = 'lastCommit'").get();
                if (!meta?.value)
                    return text('No indexed commit found. Run monograph_build first.');
                try {
                    const out = execSync(`git diff --name-only ${meta.value}..HEAD`, { cwd, encoding: 'utf-8' });
                    changedFiles = out.trim().split('\n').filter(Boolean);
                }
                catch {
                    return text('git error while listing changes');
                }
            }
            else {
                const gitFlag = scope === 'staged' ? '--cached' : scope === 'all' ? '' : '';
                const extra = scope === 'all' ? 'HEAD' : '';
                try {
                    const cmd = scope === 'all' ? 'git diff HEAD --name-only' : `git diff ${scope === 'staged' ? '--cached' : ''} --name-only`;
                    changedFiles = execSync(cmd, { cwd, encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
                }
                catch {
                    return text('git error while listing changes');
                }
            }
            if (changedFiles.length === 0)
                return text('No changed files found.');
            const affectedNodes = [];
            const dependentPaths = new Set();
            for (const f of changedFiles) {
                const node = db.prepare("SELECT * FROM nodes WHERE file_path = ? OR file_path LIKE ?").get(f, `%${f}`)
                    ?? db.prepare("SELECT * FROM nodes WHERE file_path LIKE ?").get(`%${f}%`);
                if (node) {
                    affectedNodes.push({ node, changedFile: f });
                    // Find 1-level upstream dependents
                    const deps = db.prepare(`
            SELECT n.file_path FROM edges e JOIN nodes n ON n.id = e.source_id
            WHERE e.target_id = ? AND e.relation = 'IMPORTS'
          `).all(node.id);
                    deps.forEach((d) => { if (d.file_path)
                        dependentPaths.add(d.file_path); });
                }
            }
            const lines = [
                `Changed files (${changedFiles.length}):`,
                ...changedFiles.map(f => `  M ${f}`),
                '',
                `Matched graph nodes (${affectedNodes.length}):`,
                ...affectedNodes.map(({ node: n, changedFile: f }) => `  [${n.label}] ${n.name}  ${f}`),
                affectedNodes.length === 0 ? '  (none — files may not be indexed yet)' : '',
                '',
                `Files that import changed nodes (${dependentPaths.size} dependents):`,
                ...[...dependentPaths].map(p => `  → ${p}`),
                dependentPaths.size === 0 ? '  (none)' : '',
            ];
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_snapshot ────────────────────────────────────────────────────────
const monographSnapshotTool = {
    name: 'monograph_snapshot',
    description: 'Save current graph state to a named snapshot JSON file. Enables real before/after diffing with monograph_diff.',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Snapshot name (defaults to current git short SHA or timestamp)' },
            path: { type: 'string', description: 'Output path override (defaults to .monomind/graph/snapshots/<name>.json)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { writeFileSync, mkdirSync } = await import('fs');
        const { execSync } = await import('child_process');
        const pathMod = await import('path');
        const db = openDb(getDbPath());
        try {
            // Resolve snapshot name
            let snapshotName = input.name;
            if (!snapshotName) {
                try {
                    snapshotName = execSync('git rev-parse --short HEAD', { cwd: getProjectCwd(), encoding: 'utf-8' }).trim();
                }
                catch {
                    snapshotName = `snap-${Date.now()}`;
                }
            }
            const nodes = db.prepare('SELECT * FROM nodes').all();
            const edges = db.prepare('SELECT * FROM edges').all();
            const meta = db.prepare('SELECT key, value FROM index_meta').all();
            const metaMap = Object.fromEntries(meta.map(m => [m.key, m.value]));
            const snapshot = {
                name: snapshotName,
                builtAt: metaMap['builtAt'] ?? new Date().toISOString(),
                lastCommit: metaMap['lastCommit'] ?? null,
                capturedAt: new Date().toISOString(),
                nodeCount: nodes.length,
                edgeCount: edges.length,
                nodes,
                edges,
            };
            const snapshotsDir = pathMod.join(getProjectCwd(), '.monomind', 'graph', 'snapshots');
            mkdirSync(snapshotsDir, { recursive: true });
            const outPath = input.path ?? pathMod.join(snapshotsDir, `${snapshotName}.json`);
            writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
            return text(`Snapshot "${snapshotName}" saved to ${outPath}\n  nodes: ${nodes.length}  edges: ${edges.length}`);
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_diff ────────────────────────────────────────────────────────────
const monographDiffTool = {
    name: 'monograph_diff',
    description: 'Compare two named snapshots (or current live graph vs a saved snapshot). Shows added/removed nodes and edges with a summary.',
    inputSchema: {
        type: 'object',
        properties: {
            snapshot: { type: 'string', description: 'Name of the saved snapshot to compare against (without .json extension)' },
            current: { type: 'boolean', description: 'Compare the snapshot against the live graph (default: true). If false, requires a second snapshot name.' },
            snapshot2: { type: 'string', description: 'Second snapshot name for snapshot-to-snapshot comparison (only when current=false)' },
        },
        required: ['snapshot'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { readFileSync } = await import('fs');
        const pathMod = await import('path');
        const db = openDb(getDbPath());
        try {
            const snapshotsDir = pathMod.join(getProjectCwd(), '.monomind', 'graph', 'snapshots');
            const snapshotName = input.snapshot;
            const snapshotPath = pathMod.join(snapshotsDir, `${snapshotName}.json`);
            let oldSnap;
            try {
                oldSnap = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
            }
            catch {
                return text(`Snapshot not found: ${snapshotPath}\nRun monograph_snapshot first.`);
            }
            const useCurrent = input.current ?? true;
            let newNodes;
            let newEdges;
            let newLabel;
            if (useCurrent) {
                newNodes = db.prepare('SELECT * FROM nodes').all();
                newEdges = db.prepare('SELECT * FROM edges').all();
                newLabel = 'live graph';
            }
            else {
                const snap2Name = input.snapshot2;
                if (!snap2Name)
                    return text('Provide snapshot2 when current=false for snapshot-to-snapshot comparison.');
                const snap2Path = pathMod.join(snapshotsDir, `${snap2Name}.json`);
                let snap2;
                try {
                    snap2 = JSON.parse(readFileSync(snap2Path, 'utf-8'));
                }
                catch {
                    return text(`Second snapshot not found: ${snap2Path}`);
                }
                newNodes = snap2.nodes;
                newEdges = snap2.edges;
                newLabel = snap2Name;
            }
            // Diff nodes by id
            const oldNodeIds = new Set(oldSnap.nodes.map((n) => n.id));
            const newNodeIds = new Set(newNodes.map((n) => n.id));
            const addedNodes = newNodes.filter((n) => !oldNodeIds.has(n.id));
            const removedNodes = oldSnap.nodes.filter((n) => !newNodeIds.has(n.id));
            // Diff edges by (source_id|target_id|relation) key
            const edgeKey = (e) => `${e.source_id}|${e.target_id}|${e.relation}`;
            const oldEdgeKeys = new Set(oldSnap.edges.map(edgeKey));
            const newEdgeKeys = new Set(newEdges.map(edgeKey));
            const addedEdges = newEdges.filter((e) => !oldEdgeKeys.has(edgeKey(e)));
            const removedEdges = oldSnap.edges.filter((e) => !newEdgeKeys.has(edgeKey(e)));
            const summary = [
                `Graph diff: snapshot "${snapshotName}" → ${newLabel}`,
                `  ${addedNodes.length} new nodes, ${removedNodes.length} nodes removed`,
                `  ${addedEdges.length} new edges, ${removedEdges.length} edges removed`,
            ];
            if (addedNodes.length > 0) {
                summary.push('\nAdded nodes:');
                addedNodes.slice(0, 20).forEach((n) => summary.push(`  + [${n.label}] ${n.name}  ${n.file_path ?? ''}`));
                if (addedNodes.length > 20)
                    summary.push(`  ... and ${addedNodes.length - 20} more`);
            }
            if (removedNodes.length > 0) {
                summary.push('\nRemoved nodes:');
                removedNodes.slice(0, 20).forEach((n) => summary.push(`  - [${n.label}] ${n.name}  ${n.file_path ?? ''}`));
                if (removedNodes.length > 20)
                    summary.push(`  ... and ${removedNodes.length - 20} more`);
            }
            if (addedEdges.length > 0) {
                summary.push('\nAdded edges:');
                addedEdges.slice(0, 20).forEach((e) => summary.push(`  + ${e.source_id} --${e.relation}--> ${e.target_id}`));
                if (addedEdges.length > 20)
                    summary.push(`  ... and ${addedEdges.length - 20} more`);
            }
            if (removedEdges.length > 0) {
                summary.push('\nRemoved edges:');
                removedEdges.slice(0, 20).forEach((e) => summary.push(`  - ${e.source_id} --${e.relation}--> ${e.target_id}`));
                if (removedEdges.length > 20)
                    summary.push(`  ... and ${removedEdges.length - 20} more`);
            }
            return text(summary.join('\n'));
        }
        finally {
            closeDb(db);
        }
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
// ── monograph_rename ──────────────────────────────────────────────────────────
const monographRenameTool = {
    name: 'monograph_rename',
    description: 'Dry-run rename: find all files in the knowledge graph that import or reference a symbol, then scan for text occurrences. Returns an edit plan. Pass dryRun=false to apply edits.',
    inputSchema: {
        type: 'object',
        properties: {
            symbolName: { type: 'string', description: 'Current symbol name to rename' },
            newName: { type: 'string', description: 'New name for the symbol' },
            dryRun: { type: 'boolean', description: 'Preview only, do not write files (default: true)' },
        },
        required: ['symbolName', 'newName'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { readFileSync, writeFileSync } = await import('fs');
        const db = openDb(getDbPath());
        try {
            const symbolName = input.symbolName;
            const newName = input.newName;
            const dryRun = input.dryRun ?? true;
            // Find the target node
            const node = db.prepare("SELECT * FROM nodes WHERE name = ? LIMIT 1").get(symbolName)
                ?? db.prepare("SELECT * FROM nodes WHERE name LIKE ? LIMIT 1").get(`%${symbolName}%`);
            // Find all files that import the node's file
            const importerFiles = [];
            if (node?.file_path) {
                const importers = db.prepare(`
          SELECT DISTINCT n.file_path FROM edges e JOIN nodes n ON n.id = e.source_id
          WHERE e.target_id = ? AND e.relation = 'IMPORTS' AND n.file_path IS NOT NULL
        `).all(node.id);
                importerFiles.push(...importers.map((r) => r.file_path));
                // Also include the node's own file
                if (!importerFiles.includes(node.file_path))
                    importerFiles.unshift(node.file_path);
            }
            // Text search for symbolName in all indexed file paths
            const allFiles = db.prepare("SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL").all();
            const regex = new RegExp(`\\b${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
            const editPlan = [];
            const filesToCheck = new Set([...importerFiles, ...allFiles.map((r) => r.file_path)]);
            for (const filePath of filesToCheck) {
                try {
                    const content = readFileSync(filePath, 'utf-8');
                    const matches = content.match(regex);
                    if (matches && matches.length > 0) {
                        editPlan.push({ file: filePath, occurrences: matches.length, source: importerFiles.includes(filePath) ? 'graph' : 'text_search' });
                    }
                }
                catch { /* skip unreadable files */ }
            }
            if (editPlan.length === 0)
                return text(`No occurrences of "${symbolName}" found in the indexed codebase.`);
            if (!dryRun) {
                let applied = 0;
                for (const { file } of editPlan) {
                    try {
                        const content = readFileSync(file, 'utf-8');
                        const updated = content.replace(regex, newName);
                        writeFileSync(file, updated, 'utf-8');
                        applied++;
                    }
                    catch { /* skip */ }
                }
                return text(`Renamed "${symbolName}" → "${newName}" in ${applied} files.`);
            }
            const lines = [
                `DRY RUN: rename "${symbolName}" → "${newName}"`,
                `${editPlan.length} file(s) affected:\n`,
                ...editPlan.map(e => `  [${e.source}] ${e.file}  (${e.occurrences} occurrence${e.occurrences > 1 ? 's' : ''})`),
                '\nPass dryRun=false to apply these changes.',
            ];
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_cohesion ────────────────────────────────────────────────────────
const monographCohesionTool = {
    name: 'monograph_cohesion',
    description: 'Compute cohesion scores for all communities: ratio of actual intra-community edges to maximum possible. Score 1.0 = fully connected clique, 0.0 = no internal edges.',
    inputSchema: {
        type: 'object',
        properties: {
            limit: { type: 'number', description: 'Max communities to show (default 20)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const limit = input.limit ?? 20;
            const communities = db.prepare("SELECT DISTINCT community_id FROM nodes WHERE community_id IS NOT NULL").all();
            if (communities.length === 0)
                return text('No communities found. Run monograph_build first.');
            const scores = [];
            for (const { community_id } of communities) {
                const members = db.prepare("SELECT id FROM nodes WHERE community_id = ?").all(community_id);
                const n = members.length;
                if (n <= 1) {
                    scores.push({ id: community_id, size: n, score: 1.0, internalEdges: 0 });
                    continue;
                }
                const memberIds = new Set(members.map((m) => m.id));
                const internalEdges = db.prepare(`
          SELECT COUNT(*) as c FROM edges
          WHERE source_id IN (${members.map(() => '?').join(',')})
          AND target_id IN (${members.map(() => '?').join(',')})
        `).get(...members.map((m) => m.id), ...members.map((m) => m.id));
                const possible = n * (n - 1) / 2;
                const score = possible > 0 ? Math.round((internalEdges.c / possible) * 1000) / 1000 : 0;
                scores.push({ id: community_id, size: n, score, internalEdges: internalEdges.c });
            }
            scores.sort((a, b) => b.score - a.score);
            const lines = [
                `Community Cohesion Scores (${scores.length} communities):`,
                `Format: [community_id] size=N  cohesion=X.XXX  internal_edges=N\n`,
                ...scores.slice(0, limit).map(s => {
                    const bar = '█'.repeat(Math.round(s.score * 10)) + '░'.repeat(10 - Math.round(s.score * 10));
                    return `  [${s.id.toString().padStart(3)}] size=${s.size.toString().padStart(4)}  cohesion=${s.score.toFixed(3)}  [${bar}]  edges=${s.internalEdges}`;
                }),
            ];
            const avgCohesion = scores.reduce((s, c) => s + c.score, 0) / scores.length;
            lines.push(`\nAverage cohesion: ${avgCohesion.toFixed(3)}`);
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_bridge ──────────────────────────────────────────────────────────
const monographBridgeTool = {
    name: 'monograph_bridge',
    description: 'Find bridge nodes: files/modules that connect multiple communities. High cross-community connectivity = architectural coupling point. From graphify betweenness analysis.',
    inputSchema: {
        type: 'object',
        properties: {
            limit: { type: 'number', description: 'Max nodes to return (default 15)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const limit = input.limit ?? 15;
            const nodes = db.prepare(`
        SELECT n.id, n.name, n.label, n.file_path, n.community_id,
               COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) AS total_degree
        FROM nodes n
        LEFT JOIN edges e1 ON e1.source_id = n.id
        LEFT JOIN edges e2 ON e2.target_id = n.id
        WHERE n.community_id IS NOT NULL AND n.label NOT IN ('File','Folder','Community','Concept')
        GROUP BY n.id HAVING total_degree > 0
      `).all();
            if (nodes.length === 0)
                return text('No nodes with community assignments found. Run monograph_build first.');
            // Build community map
            const communityOf = new Map(nodes.map((n) => [n.id, n.community_id]));
            // For each node, count edges crossing into different communities
            const bridgeScores = [];
            for (const node of nodes) {
                const edges = db.prepare(`
          SELECT source_id, target_id FROM edges
          WHERE source_id = ? OR target_id = ?
        `).all(node.id, node.id);
                const foreignCommunities = new Set();
                let crossEdges = 0;
                for (const e of edges) {
                    const neighborId = e.source_id === node.id ? e.target_id : e.source_id;
                    const neighborComm = communityOf.get(neighborId);
                    if (neighborComm !== undefined && neighborComm !== node.community_id) {
                        foreignCommunities.add(neighborComm);
                        crossEdges++;
                    }
                }
                if (crossEdges > 0)
                    bridgeScores.push({ node, crossEdges, communities: foreignCommunities });
            }
            bridgeScores.sort((a, b) => b.crossEdges - a.crossEdges || b.communities.size - a.communities.size);
            const top = bridgeScores.slice(0, limit);
            if (top.length === 0)
                return text('No bridge nodes found (no cross-community edges).');
            const lines = [
                `Top ${top.length} Bridge Nodes (cross-community connectors):`,
                `Format: [label] name  home_community → N foreign communities (cross_edges)\n`,
                ...top.map(({ node: n, crossEdges, communities }) => `  [${n.label}] ${n.name}  comm=${n.community_id} → ${communities.size} communities  (${crossEdges} cross-edges)  ${n.file_path ?? ''}`),
            ];
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_cypher ──────────────────────────────────────────────────────────
const monographCypherTool = {
    name: 'monograph_cypher',
    description: 'Execute graph queries using Cypher-like syntax translated to SQL. Supports: MATCH (n:Label), MATCH (a)-[:RELATION]->(b), WHERE n.name CONTAINS/= "x", RETURN, LIMIT.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Cypher-like query, e.g. MATCH (n:Class) RETURN n.name, n.file_path LIMIT 10' },
        },
        required: ['query'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const query = input.query.trim();
            // Parse limit
            const limitMatch = query.match(/\bLIMIT\s+(\d+)/i);
            const limit = limitMatch ? Math.min(parseInt(limitMatch[1], 10), 200) : 50;
            // ── Pattern: MATCH (n:Label) WHERE ... RETURN ...
            const nodePattern = query.match(/MATCH\s+\((\w+)(?::(\w+))?\)/i);
            const edgePattern = query.match(/MATCH\s+\((\w+)(?::(\w+))?\)-\[:(\w+)\]->\((\w+)(?::(\w+))?\)/i);
            // Extract WHERE clause
            const whereMatch = query.match(/WHERE\s+(.*?)(?:\s+RETURN|\s+LIMIT|$)/is);
            const whereRaw = whereMatch?.[1]?.trim() ?? '';
            // Extract RETURN fields
            const returnMatch = query.match(/RETURN\s+(.*?)(?:\s+LIMIT|$)/is);
            const returnRaw = returnMatch?.[1]?.trim() ?? '*';
            function buildWhereSql(alias, raw) {
                if (!raw)
                    return '';
                // n.name CONTAINS 'x' → n.name LIKE '%x%'
                let sql = raw.replace(/(\w+)\.name\s+CONTAINS\s+"([^"]+)"/gi, `${alias}.name LIKE '%$2%'`);
                sql = sql.replace(/(\w+)\.name\s+CONTAINS\s+'([^']+)'/gi, `${alias}.name LIKE '%$2%'`);
                // n.name = 'x'
                sql = sql.replace(/(\w+)\.name\s*=\s*"([^"]+)"/gi, `${alias}.name = '$2'`);
                sql = sql.replace(/(\w+)\.name\s*=\s*'([^']+)'/gi, `${alias}.name = '$2'`);
                // n.file_path CONTAINS 'x'
                sql = sql.replace(/(\w+)\.file_path\s+CONTAINS\s+"([^"]+)"/gi, `${alias}.file_path LIKE '%$2%'`);
                sql = sql.replace(/(\w+)\.file_path\s+CONTAINS\s+'([^']+)'/gi, `${alias}.file_path LIKE '%$2%'`);
                // n.label = 'x'
                sql = sql.replace(/(\w+)\.label\s*=\s*"([^"]+)"/gi, `${alias}.label = '$2'`);
                sql = sql.replace(/(\w+)\.label\s*=\s*'([^']+)'/gi, `${alias}.label = '$2'`);
                return sql;
            }
            function resolveReturn(alias, raw) {
                if (raw === '*')
                    return `${alias}.id, ${alias}.label, ${alias}.name, ${alias}.file_path`;
                return raw.replace(/\b(\w+)\.([\w_]+)/g, `${alias}.$2`);
            }
            let rows;
            if (edgePattern) {
                const [, srcAlias, srcLabel, relation, tgtAlias, tgtLabel] = edgePattern;
                const whereParts = ['e.relation = ?'];
                const params = [relation.toUpperCase()];
                if (srcLabel) {
                    whereParts.push(`src.label = ?`);
                    params.push(srcLabel);
                }
                if (tgtLabel) {
                    whereParts.push(`tgt.label = ?`);
                    params.push(tgtLabel);
                }
                const w = buildWhereSql('src', whereRaw);
                if (w) {
                    whereParts.push(w);
                }
                const sql = `SELECT src.name as src_name, src.file_path as src_file, tgt.name as tgt_name, tgt.file_path as tgt_file, e.relation
          FROM edges e
          JOIN nodes src ON src.id = e.source_id
          JOIN nodes tgt ON tgt.id = e.target_id
          WHERE ${whereParts.join(' AND ')}
          LIMIT ?`;
                rows = db.prepare(sql).all(...params, limit);
            }
            else if (nodePattern) {
                const [, alias, label] = nodePattern;
                const whereParts = [];
                const params = [];
                if (label) {
                    whereParts.push(`n.label = ?`);
                    params.push(label);
                }
                const w = buildWhereSql('n', whereRaw);
                if (w)
                    whereParts.push(w);
                const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
                const ret = resolveReturn('n', returnRaw);
                const sql = `SELECT ${ret} FROM nodes n ${where} LIMIT ?`;
                rows = db.prepare(sql).all(...params, limit);
            }
            else {
                return text('Could not parse query. Supported patterns:\n  MATCH (n:Label) WHERE n.name CONTAINS "x" RETURN n.name, n.file_path\n  MATCH (a:Class)-[:IMPORTS]->(b) RETURN a.name, b.name LIMIT 10');
            }
            if (rows.length === 0)
                return text('No results.');
            const header = Object.keys(rows[0]).join(' | ');
            const sep = header.replace(/[^|]/g, '-');
            const dataRows = rows.map(r => Object.values(r).map(v => String(v ?? '')).join(' | '));
            return text([header, sep, ...dataRows].join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_neighbors ───────────────────────────────────────────────────────
const monographNeighborsTool = {
    name: 'monograph_neighbors',
    description: 'Get N-hop neighborhood of a node via BFS. Returns layered results: hop 1 nodes, hop 2 nodes, etc. Inspired by graphiti BFS center-node search.',
    inputSchema: {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'Node name or file path fragment to start BFS from' },
            hops: { type: 'number', description: 'Number of hops to traverse (default 2, max 5)' },
            relation: { type: 'string', description: 'Filter edges by relation: IMPORTS, CONTAINS, or all (default: all)' },
        },
        required: ['id'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const target = input.id;
            const maxHops = Math.min(input.hops ?? 2, 5);
            const relation = input.relation ?? 'all';
            // Resolve starting node
            const startNode = db.prepare("SELECT * FROM nodes WHERE file_path = ? OR name = ? LIMIT 1").get(target, target)
                ?? db.prepare("SELECT * FROM nodes WHERE file_path LIKE ? OR name LIKE ? LIMIT 1").get(`%${target}%`, `%${target}%`);
            if (!startNode)
                return text(`Node not found: ${target}`);
            // BFS traversal
            const discovered = new Map();
            let frontier = [startNode.id];
            discovered.set(startNode.id, { node: startNode, hop: 0 });
            for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
                const next = [];
                for (const nodeId of frontier) {
                    const relFilter = relation === 'all' ? '' : `AND e.relation = '${relation}'`;
                    // Outgoing edges
                    const outgoing = db.prepare(`
            SELECT e.target_id as neighbor_id FROM edges e
            WHERE e.source_id = ? ${relFilter}
          `).all(nodeId);
                    // Incoming edges
                    const incoming = db.prepare(`
            SELECT e.source_id as neighbor_id FROM edges e
            WHERE e.target_id = ? ${relFilter}
          `).all(nodeId);
                    for (const row of [...outgoing, ...incoming]) {
                        if (!discovered.has(row.neighbor_id)) {
                            const n = db.prepare('SELECT * FROM nodes WHERE id = ?').get(row.neighbor_id);
                            if (n) {
                                discovered.set(row.neighbor_id, { node: n, hop });
                                next.push(row.neighbor_id);
                            }
                        }
                    }
                }
                frontier = next;
            }
            // Group by hop level
            const byHop = new Map();
            for (const [, { node, hop }] of discovered) {
                if (hop === 0)
                    continue; // exclude the seed node itself
                if (!byHop.has(hop))
                    byHop.set(hop, []);
                byHop.get(hop).push(node);
            }
            const lines = [
                `Neighbors of: [${startNode.label}] ${startNode.name}  ${startNode.file_path ?? ''}`,
                `Hops: ${maxHops}  Relation filter: ${relation}  Total found: ${discovered.size - 1}`,
            ];
            for (let h = 1; h <= maxHops; h++) {
                const hopNodes = byHop.get(h) ?? [];
                lines.push(`\nHop ${h} (${hopNodes.length} nodes):`);
                if (hopNodes.length === 0) {
                    lines.push('  (none)');
                    break;
                }
                hopNodes.forEach((n) => lines.push(`  [${n.label}] ${n.name}  ${n.file_path ?? ''}`));
            }
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_add_fact ────────────────────────────────────────────────────────
const monographAddFactTool = {
    name: 'monograph_add_fact',
    description: 'Add a custom semantic edge (user/LLM annotation) to the code graph. Inspired by graphiti add_episode for semantic memory. Upserts Concept nodes if needed.',
    inputSchema: {
        type: 'object',
        properties: {
            source: { type: 'string', description: 'Source node name (existing node name or new Concept)' },
            relation: { type: 'string', description: 'Edge relation label, e.g. DEPENDS_ON, DOCUMENTS, CALLS, IMPLEMENTS' },
            target: { type: 'string', description: 'Target node name (existing node name or new Concept)' },
            confidence: { type: 'string', description: 'EXTRACTED (default), INFERRED, or AMBIGUOUS' },
            note: { type: 'string', description: 'Optional description stored in edge properties' },
        },
        required: ['source', 'relation', 'target'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const sourceName = input.source;
            const relation = input.relation.toUpperCase();
            const targetName = input.target;
            const confidence = (input.confidence ?? 'EXTRACTED').toUpperCase();
            const note = input.note ?? '';
            const confidenceScoreMap = { EXTRACTED: 1.0, INFERRED: 0.7, AMBIGUOUS: 0.4 };
            const confidenceScore = confidenceScoreMap[confidence] ?? 1.0;
            // Resolve or create source node
            let sourceNode = db.prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1').get(sourceName)
                ?? db.prepare('SELECT * FROM nodes WHERE file_path LIKE ? LIMIT 1').get(`%${sourceName}%`);
            if (!sourceNode) {
                const sourceId = `concept:${sourceName}`;
                db.prepare('INSERT OR IGNORE INTO nodes (id, label, name) VALUES (?, ?, ?)').run(sourceId, 'Concept', sourceName);
                sourceNode = db.prepare('SELECT * FROM nodes WHERE id = ?').get(sourceId);
            }
            // Resolve or create target node
            let targetNode = db.prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1').get(targetName)
                ?? db.prepare('SELECT * FROM nodes WHERE file_path LIKE ? LIMIT 1').get(`%${targetName}%`);
            if (!targetNode) {
                const targetId = `concept:${targetName}`;
                db.prepare('INSERT OR IGNORE INTO nodes (id, label, name) VALUES (?, ?, ?)').run(targetId, 'Concept', targetName);
                targetNode = db.prepare('SELECT * FROM nodes WHERE id = ?').get(targetId);
            }
            // Upsert the edge with a deterministic ID
            const edgeId = `fact:${sourceNode.id}|${relation}|${targetNode.id}`;
            const properties = note ? JSON.stringify({ note }) : null;
            db.prepare(`
        INSERT OR REPLACE INTO edges (id, source_id, target_id, relation, confidence, confidence_score, properties)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(edgeId, sourceNode.id, targetNode.id, relation, confidence, confidenceScore, properties);
            return text([
                `Fact added:`,
                `  [${sourceNode.label}] ${sourceNode.name}`,
                `  --${relation} (${confidence}, score=${confidenceScore})--> `,
                `  [${targetNode.label}] ${targetNode.name}`,
                note ? `  note: ${note}` : '',
            ].filter(Boolean).join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_clear ───────────────────────────────────────────────────────────
const monographClearTool = {
    name: 'monograph_clear',
    description: 'Wipe all graph data or just nodes of a specific label. Inspired by graphiti clear_graph. Requires confirm="yes".',
    inputSchema: {
        type: 'object',
        properties: {
            confirm: { type: 'string', description: 'Must be exactly "yes" to proceed' },
            label: { type: 'string', description: 'Optional: only delete nodes of this label (and their edges). Omit to wipe everything.' },
        },
        required: ['confirm'],
    },
    handler: async (input) => {
        if (input.confirm !== 'yes') {
            return text('Aborted: confirm must be exactly "yes" to clear the graph.');
        }
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const label = input.label;
            if (label) {
                // Delete edges touching nodes of this label first (avoid orphans)
                db.prepare(`
          DELETE FROM edges WHERE source_id IN (SELECT id FROM nodes WHERE label = ?)
            OR target_id IN (SELECT id FROM nodes WHERE label = ?)
        `).run(label, label);
                const { changes } = db.prepare('DELETE FROM nodes WHERE label = ?').run(label);
                return text(`Cleared all [${label}] nodes and their edges (${changes} nodes deleted).`);
            }
            else {
                // Full wipe: edges first, then nodes, then meta
                const edgeCount = db.prepare('SELECT COUNT(*) as c FROM edges').get().c;
                const nodeCount = db.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
                db.prepare('DELETE FROM edges').run();
                db.prepare('DELETE FROM nodes').run();
                db.prepare('DELETE FROM index_meta').run();
                return text(`Graph cleared: ${nodeCount} nodes and ${edgeCount} edges removed.`);
            }
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_unlinked_refs ───────────────────────────────────────────────────
const monographUnlinkedRefsTool = {
    name: 'monograph_unlinked_refs',
    description: 'Find nodes that mention a symbol by name but have no explicit import/call edge to it — surfaces latent coupling invisible to the graph.',
    inputSchema: {
        type: 'object',
        properties: {
            targetName: { type: 'string', description: 'Symbol name to search for (e.g. "UserService")' },
            limit: { type: 'number', description: 'Max results (default 50)' },
        },
        required: ['targetName'],
    },
    handler: async (input) => {
        const { openDb, closeDb, findUnlinkedReferences } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const targetName = input.targetName;
            const limit = input.limit ?? 50;
            const refs = findUnlinkedReferences(db, targetName, { limit });
            if (refs.length === 0) {
                return text(`No unlinked references to "${targetName}" found.`);
            }
            const lines = [
                `Unlinked references to "${targetName}" (${refs.length} found):`,
                `Format: [confidence] [label] name  file  | context\n`,
                ...refs.map(r => {
                    const ctx = r.mentionContext ? `  | "...${r.mentionContext}..."` : '';
                    return `  [${r.confidence}] [${r.sourceLabel}] ${r.sourceName}  ${r.sourceFilePath ?? '(no file)'}${ctx}`;
                }),
            ];
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_blast_radius ────────────────────────────────────────────────────
const monographBlastRadiusTool = {
    name: 'monograph_blast_radius',
    description: 'Compute bidirectional blast radius from a node — finds all nodes reachable via forward (what this affects) and backward (what affects this) edges, with optional include/exclude filters.',
    inputSchema: {
        type: 'object',
        properties: {
            nodeId: { type: 'string', description: 'ID of the starting node' },
            forward: { type: 'boolean', description: 'Walk forward edges (what this node affects). Defaults to true.' },
            backward: { type: 'boolean', description: 'Walk backward edges (what affects this node). Defaults to true.' },
            maxDepth: { type: 'number', description: 'Max hop depth (default 5)' },
            mustReferenceAll: {
                type: 'array',
                items: { type: 'string' },
                description: 'Only include nodes that also reference ALL of these node IDs',
            },
            excludeReferencing: {
                type: 'array',
                items: { type: 'string' },
                description: 'Exclude nodes that reference any of these node IDs',
            },
        },
        required: ['nodeId'],
    },
    handler: async (input) => {
        const { openDb, closeDb, effectiveBlastRadius } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const nodeId = input.nodeId;
            const results = effectiveBlastRadius(db, nodeId, {
                forward: input.forward,
                backward: input.backward,
                maxDepth: input.maxDepth,
                mustReferenceAll: input.mustReferenceAll,
                excludeReferencing: input.excludeReferencing,
            });
            if (results.length === 0) {
                return text(`No nodes reachable from ${nodeId} within the specified depth and filters.`);
            }
            const lines = [
                `Blast radius for node: ${nodeId}`,
                `Total reachable nodes: ${results.length}`,
                '',
            ];
            const forwardNodes = results.filter(r => r.direction === 'forward' || r.direction === 'both');
            const backwardNodes = results.filter(r => r.direction === 'backward' || r.direction === 'both');
            if (forwardNodes.length > 0) {
                lines.push(`FORWARD (${forwardNodes.length} — nodes this affects):`);
                forwardNodes.forEach(r => lines.push(`  [hop ${r.hops}] [${r.nodeLabel}] ${r.nodeName}  ${r.filePath ?? ''}  via: ${r.reachableVia.join(', ')}`));
                lines.push('');
            }
            if (backwardNodes.length > 0) {
                lines.push(`BACKWARD (${backwardNodes.length} — nodes that affect this):`);
                backwardNodes.forEach(r => lines.push(`  [hop ${r.hops}] [${r.nodeLabel}] ${r.nodeName}  ${r.filePath ?? ''}  via: ${r.reachableVia.join(', ')}`));
            }
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_hotspots ────────────────────────────────────────────────────────
const monographHotspotsTool = {
    name: 'monograph_hotspots',
    description: 'Find the riskiest files by combining recency-weighted git churn (exponential decay, half-life 90 days) with graph centrality. Files that change frequently AND are highly connected are the highest risk to modify. Returns trend (accelerating/stable/cooling) for each file. Use before major refactors to identify which files need the most care.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Repo root path (defaults to project cwd)' },
            windowDays: { type: 'number', description: 'Git history window in days (default 365)' },
            limit: { type: 'number', description: 'Max results to return (default 20)' },
            minCommits: { type: 'number', description: 'Minimum commit count to include a file (default 2)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb, computeHotspots } = await import('@monoes/monograph');
        const repoPath = input.path ?? getProjectCwd();
        const db = openDb(getDbPath());
        try {
            const results = computeHotspots(db, repoPath, {
                windowDays: input.windowDays,
                limit: input.limit,
                minCommits: input.minCommits,
            });
            if (results.length === 0) {
                return text('No hotspots found. Ensure monograph_build has been run and the path is a git repository with sufficient commit history.');
            }
            const limitVal = input.limit ?? 20;
            const lines = [
                `Hotspot Analysis — Top ${limitVal} risky files (churn × centrality)`,
                '',
                ' #  | Score  | Trend        | Commits | File',
                '----|--------|--------------|---------|----',
            ];
            results.forEach((r, i) => {
                const rank = String(i + 1).padStart(2);
                const score = r.hotspotScore.toFixed(2).padStart(6);
                const trend = r.trend.padEnd(12);
                const commits = String(r.rawCommitCount).padStart(7);
                lines.push(` ${rank} | ${score} | ${trend} | ${commits} | ${r.filePath}`);
            });
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_baseline_save ───────────────────────────────────────────────────
const monographBaselineSaveTool = {
    name: 'monograph_baseline_save',
    description: 'Save current monograph findings as a baseline. On future runs, monograph_baseline_compare will mark each finding as introduced:true (new) or introduced:false (pre-existing). Use before merging a PR to establish a clean baseline.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute path to the repo (defaults to project cwd)' },
            baselinePath: { type: 'string', description: 'Custom output path for baseline JSON (defaults to .monomind/baseline.json)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb, extractFindingsFromDb, saveBaseline, defaultBaselinePath } = await import('@monoes/monograph');
        const { mkdirSync } = await import('fs');
        const { dirname, join } = await import('path');
        const projectPath = input.path ?? getProjectCwd();
        const dbPath = join(projectPath, '.monomind', 'monograph.db');
        const outPath = input.baselinePath ?? defaultBaselinePath(projectPath);
        mkdirSync(dirname(outPath), { recursive: true });
        const db = openDb(dbPath);
        try {
            const findings = extractFindingsFromDb(db, projectPath);
            saveBaseline(outPath, findings, projectPath);
            const isolated = findings.filter(f => f.type === 'isolated_node').length;
            const gods = findings.filter(f => f.type === 'god_node').length;
            return text([
                `Baseline saved: ${outPath}`,
                `Total findings: ${findings.length}`,
                `  isolated_node: ${isolated}`,
                `  god_node: ${gods}`,
            ].join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_baseline_compare ────────────────────────────────────────────────
const monographBaselineCompareTool = {
    name: 'monograph_baseline_compare',
    description: 'Compare current graph findings against a saved baseline. Returns each finding annotated with introduced:true/false. Newly introduced findings are listed first. Use as a CI gate: fail if any introduced findings exist.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute path to the repo (defaults to project cwd)' },
            baselinePath: { type: 'string', description: 'Path to baseline JSON (defaults to .monomind/baseline.json)' },
            introducedOnly: { type: 'boolean', description: 'If true, only list introduced (new) findings' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb, extractFindingsFromDb, loadBaseline, compareWithBaseline, defaultBaselinePath } = await import('@monoes/monograph');
        const { join } = await import('path');
        const projectPath = input.path ?? getProjectCwd();
        const dbPath = join(projectPath, '.monomind', 'monograph.db');
        const bPath = input.baselinePath ?? defaultBaselinePath(projectPath);
        const introducedOnly = input.introducedOnly ?? false;
        const db = openDb(dbPath);
        try {
            const currentFindings = extractFindingsFromDb(db, projectPath);
            const baseline = loadBaseline(bPath);
            const compared = compareWithBaseline(currentFindings, baseline);
            const introduced = compared.filter(f => f.introduced);
            const inherited = compared.filter(f => !f.introduced);
            const lines = [
                `Baseline comparison: ${introduced.length} introduced, ${inherited.length} inherited (${compared.length} total)`,
                '',
            ];
            if (introduced.length > 0) {
                lines.push(`INTRODUCED (new since baseline):`);
                for (const f of introduced) {
                    lines.push(`  [${f.type}] ${f.filePath ?? f.nodeId} — ${f.nodeName}`);
                }
            }
            else {
                lines.push('INTRODUCED (new since baseline): none');
            }
            if (!introducedOnly) {
                lines.push('');
                if (inherited.length > 0) {
                    lines.push(`INHERITED (pre-existing):`);
                    for (const f of inherited) {
                        lines.push(`  [${f.type}] ${f.filePath ?? f.nodeId} — ${f.nodeName}`);
                    }
                }
                else {
                    lines.push('INHERITED (pre-existing): none');
                }
            }
            if (!baseline) {
                lines.push('');
                lines.push(`Note: no baseline found at ${bPath}. All findings treated as introduced.`);
            }
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_reachability ────────────────────────────────────────────────────
const monographReachabilityTool = {
    name: 'monograph_reachability',
    description: 'Classify all file nodes by reachability role: runtime (reachable from app entry points), test (only reachable from test files), support (config/scripts), or unreachable (no incoming edges from any entry point). Use to filter out false "dead code" positives — test utilities are not dead, they are test-reachable. Run after monograph_build.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Repo path (defaults to project cwd)' },
            role: { type: 'string', description: 'Filter results by role: runtime | test | support | unreachable. Omit to show counts summary.' },
            rerun: { type: 'boolean', description: 'Re-run classification even if cached results exist (default: false)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb, classifyReachability, getNodesByReachabilityRole } = await import('@monoes/monograph');
        const repoPath = input.path ?? getProjectCwd();
        const db = openDb(getDbPath());
        try {
            const role = input.role;
            const rerun = input.rerun ?? false;
            let hasCached = false;
            if (!rerun) {
                const check = db.prepare(`
          SELECT COUNT(*) as c FROM nodes
          WHERE label = 'File' AND json_extract(properties, '$.reachabilityRole') IS NOT NULL
        `).get();
                hasCached = check.c > 0;
            }
            let counts = null;
            if (!hasCached || rerun) {
                counts = classifyReachability(db, repoPath);
            }
            if (role) {
                const validRoles = ['runtime', 'test', 'support', 'unreachable'];
                if (!validRoles.includes(role)) {
                    return text(`Invalid role "${role}". Must be one of: ${validRoles.join(', ')}`);
                }
                const nodes = getNodesByReachabilityRole(db, role);
                if (nodes.length === 0) {
                    return text(`No ${role} files found. Run monograph_build first or try rerun=true.`);
                }
                const lines = [
                    `${role.toUpperCase()} files (${nodes.length}):`,
                    ...nodes.map(n => `  ${n.filePath ?? n.name}`),
                ];
                return text(lines.join('\n'));
            }
            if (!counts) {
                const rows = db.prepare(`
          SELECT json_extract(properties, '$.reachabilityRole') as role, COUNT(*) as c
          FROM nodes WHERE label = 'File' AND properties IS NOT NULL
          GROUP BY role
        `).all();
                const byRole = {};
                for (const r of rows) {
                    if (r.role)
                        byRole[r.role] = r.c;
                }
                counts = {
                    runtime: byRole['runtime'] ?? 0,
                    test: byRole['test'] ?? 0,
                    support: byRole['support'] ?? 0,
                    unreachable: byRole['unreachable'] ?? 0,
                };
            }
            const total = counts.runtime + counts.test + counts.support + counts.unreachable;
            const pct = (n) => total > 0 ? ` (${Math.round(n / total * 100)}%)` : '';
            const lines = [
                `Reachability classification${hasCached ? ' (cached)' : ''}:`,
                `  runtime    : ${counts.runtime}${pct(counts.runtime)} — reachable from app entry points`,
                `  test       : ${counts.test}${pct(counts.test)} — only reachable from test files`,
                `  support    : ${counts.support}${pct(counts.support)} — config/scripts/tooling`,
                `  unreachable: ${counts.unreachable}${pct(counts.unreachable)} — no entry-point path found`,
                `  total files: ${total}`,
                '',
                'Use role="unreachable" to list candidates for dead-code review.',
                'Use role="test" to confirm test utilities are not falsely flagged as dead code.',
            ];
            return text(lines.join('\n'));
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
    monographImpactTool,
    monographContextTool,
    monographDetectChangesTool,
    monographSnapshotTool,
    monographDiffTool,
    monographNeighborsTool,
    monographAddFactTool,
    monographClearTool,
    monographRenameTool,
    monographCohesionTool,
    monographBridgeTool,
    monographCypherTool,
    monographExportTool,
    monographUnlinkedRefsTool,
    monographBlastRadiusTool,
    monographHotspotsTool,
    monographBaselineSaveTool,
    monographBaselineCompareTool,
    monographReachabilityTool,
];
//# sourceMappingURL=monograph-tools.js.map