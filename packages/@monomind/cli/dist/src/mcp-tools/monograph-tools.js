/**
 * Monograph MCP Tools
 *
 * Native TypeScript code intelligence — replaces Python graphify.
 * All monograph_* tools are backed by @monoes/monograph package.
 */
import { join, resolve, sep } from 'path';
import { execSync } from 'child_process';
import { statSync } from 'fs';
import { randomUUID } from 'crypto';
import { getProjectCwd } from './types.js';
let _cachedDbPath;
let _cachedCwd;
function _isValidDb(p) {
    try {
        return statSync(p).size >= 100;
    }
    catch {
        return false;
    }
}
/**
 * Resolve the monograph DB path for a given repo root (defaults to project cwd).
 * Falls back to searching up to the git root when the DB isn't directly under
 * `<cwd>/.monomind` — e.g. when called from a subdirectory of the repo. Only
 * the no-arg (project cwd) form is cached; explicit `repoPath` overrides are
 * cheap one-off lookups (staleness checks with a user-supplied path) so caching
 * them isn't worth the invalidation complexity.
 */
function getDbPath(repoPathOverride) {
    const cwd = repoPathOverride ?? getProjectCwd();
    const useCache = repoPathOverride === undefined;
    // Invalidate cache when project root changes (e.g. MONOMIND_CWD set after initialize)
    if (useCache && _cachedDbPath && _cachedCwd === cwd)
        return _cachedDbPath;
    if (useCache) {
        _cachedCwd = cwd;
        _cachedDbPath = undefined;
    }
    const direct = join(cwd, '.monomind', 'monograph.db');
    if (_isValidDb(direct)) {
        if (useCache)
            _cachedDbPath = direct;
        return direct;
    }
    try {
        const root = execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8' }).trim();
        const candidate = join(root, '.monomind', 'monograph.db');
        if (_isValidDb(candidate)) {
            if (useCache)
                _cachedDbPath = candidate;
            return candidate;
        }
    }
    catch { /* not in a git repo */ }
    // Don't cache failures — the DB may be created by a subsequent build
    return direct;
}
function text(t) {
    return { content: [{ type: 'text', text: t }] };
}
// ── Active watcher registry ──────────────────────────────────────────────────
const _activeWatchers = new Map();
function applyPprRerank(db, seedNodes, damping, maxResults) {
    const propagated = new Map();
    for (const r of seedNodes) {
        propagated.set(r.id, r.score);
    }
    const neighborStmt = db.prepare('SELECT target_id FROM edges WHERE source_id = @id');
    for (const r of seedNodes) {
        const neighbors = neighborStmt.all({ id: r.id });
        for (const n of neighbors) {
            const boost = r.score * damping;
            const current = propagated.get(n.target_id) ?? 0;
            propagated.set(n.target_id, Math.max(current, boost));
        }
    }
    const seedIds = new Set(seedNodes.map(r => r.id));
    const ranked = seedNodes.map(r => ({
        ...r,
        combinedScore: Math.max(r.score, propagated.get(r.id) ?? 0),
        boostedByNeighbors: false,
    }));
    for (const [id, score] of propagated) {
        if (!seedIds.has(id)) {
            const node = db.prepare('SELECT id, name, label, file_path, start_line FROM nodes WHERE id = @id').get({ id });
            if (node) {
                ranked.push({
                    id: node.id, name: node.name, label: node.label,
                    filePath: node.file_path, startLine: node.start_line,
                    score: 0, combinedScore: score, boostedByNeighbors: true,
                });
            }
        }
    }
    ranked.sort((a, b) => b.combinedScore - a.combinedScore);
    return ranked.slice(0, maxResults).map(r => ({
        id: r.id, name: r.name, label: r.label,
        filePath: r.filePath, startLine: r.startLine,
        score: r.combinedScore, boostedByNeighbors: r.boostedByNeighbors,
    }));
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
            incremental: { type: 'boolean', description: 'Skip rebuild when index already matches HEAD (default false). Use when you want a no-op if the graph is fresh.' },
        },
    },
    handler: async (input) => {
        const { buildAsync } = await import('@monoes/monograph');
        const repoPath = input.path ?? getProjectCwd();
        let progressLog = '';
        await buildAsync(repoPath, {
            codeOnly: input.codeOnly ?? false,
            force: input.force ?? false,
            incremental: input.incremental ?? false,
            onProgress: (p) => { progressLog += `[${p.phase}] ${p.message ?? ''}\n`; },
        });
        const skipped = progressLog.includes('skipping rebuild');
        const summary = skipped ? `Index was already fresh — no rebuild needed for ${repoPath}` : `Monograph build complete for ${repoPath}`;
        return text(`${summary}\n${progressLog}`);
    },
};
// ── monograph_query ───────────────────────────────────────────────────────────
const monographQueryTool = {
    name: 'monograph_query',
    description: 'BM25 keyword search across the code knowledge graph. When MONOGRAPH_EMBEDDINGS=true uses hybrid BM25+vector ranking (RRF). Returns nodes with file path and line number.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search terms' },
            limit: { type: 'number', description: 'Max results (default 20)' },
            label: { type: 'string', description: 'Filter by node type: Class, Function, Method, etc.' },
            rerank: { type: 'boolean', description: 'Apply HippoRAG-style PPR graph reranking to boost neighbors of top hits (default: true)' },
            damping: { type: 'number', description: 'PPR damping factor when rerank=true (0-1, default 0.5)' },
        },
        required: ['query'],
    },
    handler: async (input) => {
        const dbPath = getDbPath();
        if (!_isValidDb(dbPath))
            return text('Monograph index not built yet. Run monograph_build first.');
        const { openDb, closeDb, ftsSearch } = await import('@monoes/monograph');
        const { hybridQuery } = await import('@monoes/monograph');
        const db = openDb(dbPath);
        try {
            // Cap limit: passed directly to SQLite queries and hybridQuery; an
            // unlimited value saturates memory with rows.
            const MAX_QUERY_LIMIT = 1_000;
            const rawLimit = input.limit ?? 20;
            const limit = Number.isFinite(rawLimit) && rawLimit > 0
                ? Math.min(Math.floor(rawLimit), MAX_QUERY_LIMIT)
                : 20;
            // Cap query: passed to FTS5 and hybridQuery; very long queries waste
            // parse time and can stress the FTS tokenizer.
            const MAX_MONOGRAPH_QUERY_LEN = 16 * 1024;
            const rawQuery = input.query;
            const query = typeof rawQuery === 'string' && rawQuery.length > MAX_MONOGRAPH_QUERY_LEN
                ? rawQuery.slice(0, MAX_MONOGRAPH_QUERY_LEN)
                : rawQuery;
            const label = input.label;
            const rerank = input.rerank ?? true;
            const damping = input.damping ?? 0.5;
            if (process.env['MONOGRAPH_EMBEDDINGS'] === 'true') {
                const results = await hybridQuery(db, query, { limit: rerank ? limit * 2 : limit, label });
                if (results.length === 0)
                    return text('No results found.');
                if (rerank) {
                    const seeds = results.map(r => ({
                        id: r.id, name: r.name ?? r.id, label: r.label ?? '?',
                        filePath: r.filePath ?? '', startLine: r.startLine ?? null,
                        score: r.score,
                    }));
                    const reranked = applyPprRerank(db, seeds, damping, limit);
                    const lines = reranked.map(r => {
                        const loc = r.filePath ? (r.startLine != null ? `${r.filePath}:${r.startLine}` : r.filePath) : '';
                        const tag = r.boostedByNeighbors ? ' [PPR-boosted]' : '';
                        return `[${r.label}] ${r.name}  ${loc}  (score: ${r.score.toFixed(4)})${tag}`;
                    });
                    return text(lines.join('\n'));
                }
                const lines = results.map(r => {
                    const loc = r.filePath ? (r.startLine != null ? `${r.filePath}:${r.startLine}` : r.filePath) : '';
                    return `[${r.label ?? '?'}] ${r.name ?? r.id}  ${loc}  (score: ${r.score.toFixed(4)})`;
                });
                return text(lines.join('\n'));
            }
            const results = ftsSearch(db, query, rerank ? limit * 2 : limit, label);
            if (results.length === 0)
                return text('No results found.');
            if (rerank) {
                const seeds = results.map(r => ({
                    id: r.id, name: r.name, label: r.label,
                    filePath: r.filePath ?? '', startLine: r.startLine ?? null,
                    score: Math.abs(r.rank),
                }));
                const reranked = applyPprRerank(db, seeds, damping, limit);
                const lines = reranked.map(r => {
                    const loc = r.filePath ? (r.startLine != null ? `${r.filePath}:${r.startLine}` : r.filePath) : '';
                    const tag = r.boostedByNeighbors ? ' [PPR-boosted]' : '';
                    return `[${r.label}] ${r.name}  ${loc}  (score: ${r.score.toFixed(3)})${tag}`;
                });
                return text(lines.join('\n'));
            }
            const lines = results.map(r => {
                const loc = r.filePath ? (r.startLine != null ? `${r.filePath}:${r.startLine}` : r.filePath) : '';
                return `[${r.label}] ${r.name}  ${loc}  (score: ${r.rank.toFixed(3)})`;
            });
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
        const dbPath = getDbPath();
        if (!_isValidDb(dbPath))
            return text('Monograph index not built yet. Run monograph_build first.');
        const { openDb, closeDb, countNodes, countEdges } = await import('@monoes/monograph');
        const db = openDb(dbPath);
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
            // The orchestrator writes the key as 'last_commit_hash' (orchestrator.ts:68).
            // Fall back to legacy 'lastCommit' for indexes built with older versions.
            const meta = db.prepare("SELECT value FROM index_meta WHERE key = 'last_commit_hash'").get() ?? db.prepare("SELECT value FROM index_meta WHERE key = 'lastCommit'").get();
            const lastCommit = meta?.value ?? null;
            if (!lastCommit) {
                // last_commit_hash can be missing even when the index is populated
                // (e.g. git rev-parse failed during build). Check actual data before
                // claiming "never built".
                const nodeCount = db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
                if (nodeCount > 0) {
                    const indexedAt = db.prepare("SELECT value FROM index_meta WHERE key = 'indexed_at'").get()?.value;
                    return text(`Index is built (${nodeCount} nodes${indexedAt ? `, indexed at ${indexedAt}` : ''}) but no commit hash was recorded — staleness tracking unavailable.\n` +
                        'Run monograph_build to fix commit tracking.');
                }
                return text('Index has never been built. Run monograph_build first.');
            }
            if (!/^[0-9a-f]{7,40}$/i.test(lastCommit)) {
                return text('Index metadata is corrupt: invalid commit SHA. Run monograph_build to re-index.');
            }
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
        const dbPath = getDbPath();
        if (!_isValidDb(dbPath))
            return text('Monograph index not built yet. Run monograph_build first.');
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(dbPath);
        try {
            // Cap limit: passed directly to the SQL LIMIT clause.
            const MAX_GOD_NODES_LIMIT = 1_000;
            const rawGodLimit = input.limit ?? 20;
            const limit = Number.isFinite(rawGodLimit) && rawGodLimit > 0
                ? Math.min(Math.floor(rawGodLimit), MAX_GOD_NODES_LIMIT)
                : 20;
            const excluded = ['File', 'Folder', 'Community', 'Concept'];
            const rows = db.prepare(`
        SELECT n.id, n.label, n.name, n.file_path, n.start_line,
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
            const lines = rows.map(r => {
                const loc = r.file_path ? (r.start_line != null ? `${r.file_path}:${r.start_line}` : r.file_path) : '';
                return `[${r.label}] ${r.name}  degree=${r.degree} (↑${r.out_degree} ↓${r.in_degree})  ${loc}`;
            });
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
            // Enrich each node ID with file:line for direct LLM navigation
            const enriched = path.map(nodeId => {
                const row = db.prepare('SELECT label, name, file_path, start_line FROM nodes WHERE id = ? OR name = ? LIMIT 1').get(nodeId, nodeId);
                if (!row)
                    return nodeId;
                const loc = row.file_path ? (row.start_line != null ? `${row.file_path}:${row.start_line}` : row.file_path) : '';
                return loc ? `${row.name ?? nodeId}  [${loc}]` : (row.name ?? nodeId);
            });
            return text(`Path (${path.length - 1} hops):\n${enriched.join(' → ')}`);
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_community ───────────────────────────────────────────────────────
const monographCommunityTool = {
    name: 'monograph_community',
    description: 'Get all nodes belonging to a community (by numeric community ID).',
    inputSchema: {
        type: 'object',
        properties: {
            id: { type: 'number', description: 'Community ID' },
        },
        required: ['id'],
    },
    handler: async (input) => {
        // Validate community ID — must be a finite integer. parseInt(NaN) or a float
        // would silently become 0 in SQLite (NaN → NULL → 0 coercion), which would
        // return all nodes in community 0 instead of an error.
        const rawId = typeof input.id === 'number' ? input.id : parseInt(String(input.id), 10);
        if (!Number.isFinite(rawId) || rawId !== Math.floor(rawId)) {
            return text(`Invalid community ID: ${input.id} (must be an integer)`);
        }
        const communityId = rawId;
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const rows = db.prepare('SELECT id, label, name, file_path, start_line FROM nodes WHERE community_id = ?').all(communityId);
            if (rows.length === 0)
                return text(`No nodes in community ${communityId}`);
            return text(rows.map(r => {
                const loc = r.file_path ? (r.start_line != null ? `${r.file_path}:${r.start_line}` : r.file_path) : '';
                return `[${r.label}] ${r.name}  ${loc}`;
            }).join('\n'));
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
            // Cap limit: passed directly to the SQL LIMIT clause.
            const MAX_SURPRISES_LIMIT = 1_000;
            const rawSurprisesLimit = input.limit ?? 20;
            const limit = Number.isFinite(rawSurprisesLimit) && rawSurprisesLimit > 0
                ? Math.min(Math.floor(rawSurprisesLimit), MAX_SURPRISES_LIMIT)
                : 20;
            const rows = db.prepare(`
        SELECT e.confidence, e.confidence_score, e.relation,
               n1.name as src_name, n1.file_path as src_file, n1.start_line as src_line,
               n2.name as tgt_name, n2.file_path as tgt_file, n2.start_line as tgt_line
        FROM edges e
        JOIN nodes n1 ON n1.id = e.source_id
        JOIN nodes n2 ON n2.id = e.target_id
        WHERE e.confidence != 'EXTRACTED'
        ORDER BY e.confidence_score ASC LIMIT ?
      `).all(limit);
            if (rows.length === 0)
                return text('No surprising connections found.');
            return text(rows.map(r => {
                const srcLoc = r.src_file ? (r.src_line != null ? `${r.src_file}:${r.src_line}` : r.src_file) : '';
                const tgtLoc = r.tgt_file ? (r.tgt_line != null ? `${r.tgt_file}:${r.tgt_line}` : r.tgt_file) : '';
                const locHint = srcLoc || tgtLoc ? `  [${srcLoc}${tgtLoc ? ` → ${tgtLoc}` : ''}]` : '';
                return `[${r.confidence}] ${r.src_name} --${r.relation}--> ${r.tgt_name} (score: ${r.confidence_score})${locHint}`;
            }).join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_suggest ─────────────────────────────────────────────────────────
const monographSuggestTool = {
    name: 'monograph_suggest',
    description: 'Get graph-topology-derived questions to explore the codebase. Pass task= to score by task relevance. When MONOGRAPH_EMBEDDINGS=true uses semantic search for task relevance.',
    inputSchema: {
        type: 'object',
        properties: {
            task: { type: 'string', description: 'Optional task description for task-relevance scoring' },
            limit: { type: 'number', description: 'Max questions (default 10)' },
            checkStaleness: { type: 'boolean', description: 'Check index staleness first and trigger a background rebuild when the index is behind HEAD. Appends a _staleness annotation to the result. (default false)' },
        },
    },
    handler: async (input) => {
        // Health-aware mode (formerly monograph_suggest_auto): check staleness and
        // trigger a background rebuild if the index is behind HEAD.
        let stalenessAnnotation = '';
        if (input.checkStaleness === true) {
            const repoPath = getProjectCwd();
            const stalenessResult = await computeCommitsBehind(repoPath);
            const commitsBehind = stalenessResult?.commitsBehind ?? 0;
            const triggered = triggerBackgroundBuildIfNeeded(repoPath, commitsBehind, STALENESS_THRESHOLD + 1);
            const status = triggered ? 'building' : commitsBehind === 0 ? 'fresh' : 'stale';
            stalenessAnnotation = `\n_staleness: ${JSON.stringify({ commitsBehind, status, triggered })}`;
        }
        const dbPath = getDbPath();
        if (!_isValidDb(dbPath))
            return text('Monograph index not built yet. Run monograph_build first.' + stalenessAnnotation);
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { hybridQuery } = await import('@monoes/monograph');
        const db = openDb(dbPath);
        try {
            // Cap limit and task: limit is passed directly to SQL LIMIT clause;
            // task is forwarded to hybridQuery (embedding path) or FTS.
            const MAX_SUGGEST_LIMIT = 1_000;
            const MAX_SUGGEST_TASK_LEN = 16 * 1024;
            const rawSuggestLimit = input.limit ?? 10;
            const limit = Number.isFinite(rawSuggestLimit) && rawSuggestLimit > 0
                ? Math.min(Math.floor(rawSuggestLimit), MAX_SUGGEST_LIMIT)
                : 10;
            const rawTask = input.task ?? '';
            const task = typeof rawTask === 'string' && rawTask.length > MAX_SUGGEST_TASK_LEN
                ? rawTask.slice(0, MAX_SUGGEST_TASK_LEN)
                : rawTask;
            // Format a suggestion row as a navigable string for LLM consumption.
            // Includes file:line references so the LLM can jump directly to the code.
            const formatSuggestion = (r) => {
                const srcLoc = r.src_file ? (r.src_line != null ? `${r.src_file}:${r.src_line}` : r.src_file) : '';
                const tgtLoc = r.tgt_file ? (r.tgt_line != null ? `${r.tgt_file}:${r.tgt_line}` : r.tgt_file) : '';
                const locHint = srcLoc ? `  [${srcLoc}${tgtLoc ? ` → ${tgtLoc}` : ''}]` : '';
                return `Why does ${r.src} ${r.relation.toLowerCase()} ${r.tgt}? (${r.confidence})${locHint}`;
            };
            // When a task is provided and embeddings are enabled, use semantic search
            // to find relevant nodes and surface edge-level questions about them.
            if (task && process.env['MONOGRAPH_EMBEDDINGS'] === 'true') {
                const hits = await hybridQuery(db, task, { limit: 20 });
                const hitIds = new Set(hits.map(h => h.id));
                if (hitIds.size === 0) {
                    return text('No suggestions for this task. Run monograph_build first or try a different query.' + stalenessAnnotation);
                }
                const rows = db.prepare(`
          SELECT e.relation, e.confidence, n1.name as src, n2.name as tgt,
                 n1.file_path as src_file, n1.start_line as src_line,
                 n2.file_path as tgt_file, n2.start_line as tgt_line
          FROM edges e
          JOIN nodes n1 ON n1.id = e.source_id
          JOIN nodes n2 ON n2.id = e.target_id
          WHERE (e.source_id IN (${[...hitIds].map(() => '?').join(',')})
                 OR e.target_id IN (${[...hitIds].map(() => '?').join(',')}))
          AND e.confidence IN ('AMBIGUOUS', 'INFERRED')
          LIMIT 100
        `).all(...[...hitIds], ...[...hitIds]);
                const questions = rows.map(formatSuggestion);
                return text((questions.slice(0, limit).join('\n') || 'No suggestions for this task. Run monograph_build first.') + stalenessAnnotation);
            }
            const rows = db.prepare(`
        SELECT e.relation, e.confidence, n1.name as src, n2.name as tgt,
               n1.file_path as src_file, n1.start_line as src_line,
               n2.file_path as tgt_file, n2.start_line as tgt_line
        FROM edges e
        JOIN nodes n1 ON n1.id = e.source_id
        JOIN nodes n2 ON n2.id = e.target_id
        WHERE e.confidence IN ('AMBIGUOUS', 'INFERRED')
        LIMIT 100
      `).all();
            let scored = rows.map(r => ({
                q: formatSuggestion(r),
                relevance: task ? taskRelevance(task, r.src + ' ' + r.tgt + ' ' + (r.src_file ?? '')) : 0,
            }));
            if (task)
                scored = scored.sort((a, b) => b.relevance - a.relevance);
            return text((scored.slice(0, limit).map(s => s.q).join('\n') || 'No suggestions. Run monograph_build first.') + stalenessAnnotation);
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
// Columns needed to render/export the graph — deliberately excludes `embedding`,
// which can be several KB per node (384D vectors) and would otherwise bloat
// tool-result payloads and written files by many MB.
const NODE_RENDER_COLUMNS = 'id, label, name, norm_label, file_path, start_line, end_line, community_id, is_exported, language, properties';
const monographVisualizeTool = {
    name: 'monograph_visualize',
    description: 'Render the knowledge graph as HTML (default), SVG, or JSON. Writes output to a file under .monomind/visualize/ and returns the file path (output can be multi-MB at the max node count, too large to return inline).',
    inputSchema: {
        type: 'object',
        properties: {
            format: { type: 'string', description: 'Output format: html, svg, json (default: html)' },
            maxNodes: { type: 'number', description: 'Max nodes to include (default 500)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb, toJson, toHtml, toSvg } = await import('@monoes/monograph');
        const { writeFileSync, mkdirSync } = await import('fs');
        const db = openDb(getDbPath());
        try {
            // Cap maxNodes: passed to SQL LIMIT clause for both nodes (n) and edges
            // (n*3).  Without a cap an attacker requests all rows from both tables.
            const MAX_EXPORT_NODES = 10_000;
            const rawMaxNodes = input.maxNodes ?? 500;
            const limit = Number.isFinite(rawMaxNodes) && rawMaxNodes > 0
                ? Math.min(Math.floor(rawMaxNodes), MAX_EXPORT_NODES)
                : 500;
            const nodes = db.prepare(`SELECT ${NODE_RENDER_COLUMNS} FROM nodes LIMIT ?`).all(limit);
            // Only include edges where both endpoints are in the visible node set
            const edges = db.prepare(`
        SELECT e.* FROM edges e
        WHERE e.source_id IN (SELECT id FROM nodes LIMIT ?)
          AND e.target_id IN (SELECT id FROM nodes LIMIT ?)
        LIMIT ?
      `).all(limit, limit, limit * 3);
            const fmt = input.format ?? 'html';
            const rendered = fmt === 'json' ? toJson(nodes, edges)
                : fmt === 'svg' ? toSvg(nodes, edges)
                    : toHtml(nodes, edges);
            const ext = fmt === 'json' ? 'json' : fmt === 'svg' ? 'svg' : 'html';
            const outDir = resolve(join(getProjectCwd(), '.monomind', 'visualize'));
            mkdirSync(outDir, { recursive: true });
            const outPath = join(outDir, `graph-${Date.now()}.${ext}`);
            writeFileSync(outPath, rendered);
            return text(`Visualization written to ${outPath} (${nodes.length} nodes, ${edges.length} edges)${ext === 'html' ? '\nNote: HTML uses the vis-network CDN script and requires network access to render.' : ''}`);
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
        if (_activeWatchers.has(repoPath)) {
            return text(`Monograph watcher already running for ${repoPath}.`);
        }
        const watcher = new MonographWatcher(repoPath);
        watcher.on('monograph:updated', (_paths) => {
            import('@monoes/monograph').then(({ buildAsync }) => buildAsync(repoPath)).catch(() => { });
        });
        await watcher.start();
        _activeWatchers.set(repoPath, watcher);
        return text(`Monograph watcher started for ${repoPath}. Watching for file changes...`);
    },
};
// ── monograph_watch_stop ──────────────────────────────────────────────────────
const monographWatchStopTool = {
    name: 'monograph_watch_stop',
    description: 'Stop the Monograph file watcher.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Repo path whose watcher to stop (defaults to project cwd)' },
        },
    },
    handler: async (input) => {
        const repoPath = input.path ?? getProjectCwd();
        const watcher = _activeWatchers.get(repoPath);
        if (!watcher) {
            return text(`No active watcher found for ${repoPath}.`);
        }
        await watcher.stop();
        _activeWatchers.delete(repoPath);
        return text(`Monograph watcher stopped for ${repoPath}.`);
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
        SELECT n.name, n.label, n.file_path, n.start_line,
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
                ...topNodes.map((n, i) => {
                    const loc = n.file_path ? (n.start_line != null ? `${n.file_path}:${n.start_line}` : n.file_path) : '';
                    return `${i + 1}. **${n.name}** (${n.label}) — degree ${n.degree}${loc ? `  \`${loc}\`` : ''}`;
                }),
            ].join('\n');
            const rawOutPath = input.path ?? join(getProjectCwd(), '.monomind', 'GRAPH_REPORT.md');
            const outPath = resolve(getProjectCwd(), rawOutPath);
            const allowedRoot = resolve(getProjectCwd());
            if (outPath !== allowedRoot && !outPath.startsWith(allowedRoot + sep)) {
                return text(`Error: path must be within the project directory (${allowedRoot})`);
            }
            mkdirSync(join(outPath, '..'), { recursive: true });
            writeFileSync(outPath, report);
            return text(`${report}\n\nReport written to ${outPath}`);
        }
        finally {
            closeDb(db);
        }
    },
};
// ── Shared staleness helper ───────────────────────────────────────────────────
/** Guard against concurrent background buildAsync calls on the same DB. */
let _buildInProgress = false;
/**
 * Compute how many commits the index is behind HEAD.
 * Returns { commitsBehind, lastCommit } — or null if the index has never been
 * built or git is unavailable.
 */
async function computeCommitsBehind(repoPath) {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { execSync } = await import('child_process');
    const dbPath = getDbPath(repoPath);
    if (!_isValidDb(dbPath))
        return null;
    // openDb's fileMustExist option isn't in the currently-published
    // @monoes/monograph release this CLI depends on — _isValidDb above is the
    // real guard against openDb silently creating an empty DB at a missing path.
    const db = openDb(dbPath);
    try {
        const meta = db.prepare("SELECT value FROM index_meta WHERE key = 'last_commit_hash'").get() ?? db.prepare("SELECT value FROM index_meta WHERE key = 'lastCommit'").get();
        const lastCommit = meta?.value ?? null;
        if (!lastCommit || !/^[0-9a-f]{7,40}$/i.test(lastCommit))
            return null;
        try {
            const out = execSync(`git rev-list --count ${lastCommit}..HEAD`, {
                cwd: repoPath, encoding: 'utf-8',
            }).trim();
            return { commitsBehind: parseInt(out, 10), lastCommit };
        }
        catch {
            return null;
        }
    }
    finally {
        closeDb(db);
    }
}
/**
 * Shared staleness threshold: both monograph_staleness and monograph_suggest (checkStaleness)
 * trigger a background rebuild only when the index is more than this many commits behind HEAD.
 * Using a shared constant prevents conflicting rebuild pressure during active dev sessions.
 */
const STALENESS_THRESHOLD = 10;
/**
 * Fire-and-forget background rebuild. Uses a module-level guard so concurrent
 * MCP tool calls (e.g. repeated monograph_suggest checkStaleness) don't pile up builds.
 * threshold: minimum commitsBehind to trigger (default STALENESS_THRESHOLD + 1).
 */
function triggerBackgroundBuildIfNeeded(repoPath, commitsBehind, threshold = STALENESS_THRESHOLD + 1) {
    if (commitsBehind < threshold)
        return false;
    if (_buildInProgress)
        return false;
    _buildInProgress = true;
    void import('@monoes/monograph')
        .then(({ buildAsync }) => buildAsync(repoPath, { codeOnly: true }))
        .catch(() => { })
        .finally(() => { _buildInProgress = false; });
    return true;
}
// ── monograph_staleness ───────────────────────────────────────────────────────
const monographStalenessTool = {
    name: 'monograph_staleness',
    description: 'Git staleness detection: compares the commit hash at last index build against current HEAD. When the index is more than 10 commits behind HEAD it automatically triggers a background rebuild. Returns { commitsBehind, status, triggered }.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute path to the repo (defaults to project cwd)' },
        },
    },
    handler: async (input) => {
        const repoPath = input.path ?? getProjectCwd();
        const result = await computeCommitsBehind(repoPath);
        if (!result) {
            return text(JSON.stringify({ commitsBehind: 0, status: 'unknown', triggered: false }));
        }
        const { commitsBehind } = result;
        const triggered = triggerBackgroundBuildIfNeeded(repoPath, commitsBehind, STALENESS_THRESHOLD + 1);
        const status = triggered ? 'building' : commitsBehind === 0 ? 'fresh' : 'stale';
        return text(JSON.stringify({ commitsBehind, status, triggered }));
    },
};
// ── monograph_snapshot ────────────────────────────────────────────────────────
const monographSnapshotTool = {
    name: 'monograph_snapshot',
    description: 'Save current graph state to a named JSON snapshot. Use with monograph_diff to compare before/after changes.',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Snapshot name (default: ISO timestamp). Used as the filename.' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb, snapshotFromDb } = await import('@monoes/monograph');
        const { writeFileSync, mkdirSync } = await import('fs');
        const { resolve: resolvePath } = await import('path');
        const db = openDb(getDbPath());
        try {
            const snapshot = snapshotFromDb(db);
            const rawName = input.name ?? new Date().toISOString().replace(/[:.]/g, '-');
            const SAFE_NAME_RE = /^[a-zA-Z0-9_.\-]+$/;
            if (!SAFE_NAME_RE.test(rawName))
                return text(`Invalid snapshot name: ${rawName}`);
            const snapshotDir = resolvePath(join(getProjectCwd(), '.monomind', 'snapshots'));
            mkdirSync(snapshotDir, { recursive: true });
            const outPath = join(snapshotDir, `${rawName}.json`);
            if (!resolvePath(outPath).startsWith(snapshotDir))
                return text(`Path traversal detected in snapshot name`);
            writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
            return text(`Snapshot saved: ${outPath}\n  nodes: ${snapshot.nodes.length}  edges: ${snapshot.edges.length}`);
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_diff ────────────────────────────────────────────────────────────
const monographDiffTool = {
    name: 'monograph_diff',
    description: 'Compare two named graph snapshots (saved via monograph_snapshot). Omit "after" to diff the "before" snapshot against the live graph.',
    inputSchema: {
        type: 'object',
        properties: {
            before: { type: 'string', description: 'Name of the before snapshot (without .json extension)' },
            after: { type: 'string', description: 'Name of the after snapshot, or omit to compare against the live graph' },
        },
        required: ['before'],
    },
    handler: async (input) => {
        const { openDb, closeDb, snapshotFromDb, diffSnapshots } = await import('@monoes/monograph');
        const { readFileSync, existsSync, statSync: statSyncSnap } = await import('fs');
        const { resolve: resolvePath } = await import('path');
        const MAX_SNAPSHOT_BYTES = 100 * 1024 * 1024; // 100 MB
        const snapshotDir = resolvePath(join(getProjectCwd(), '.monomind', 'snapshots'));
        // Reject snapshot names containing path separators or traversal sequences
        const SAFE_SNAPSHOT_NAME = /^[a-zA-Z0-9_.\-]+$/;
        const beforeName = input.before;
        if (!SAFE_SNAPSHOT_NAME.test(beforeName))
            return text(`Invalid snapshot name: ${beforeName}`);
        const beforePath = join(snapshotDir, `${beforeName}.json`);
        if (!resolvePath(beforePath).startsWith(snapshotDir))
            return text(`Path traversal detected in snapshot name`);
        if (!existsSync(beforePath)) {
            return text(`Snapshot not found: ${beforePath}\nCreate one first with monograph_snapshot.`);
        }
        if (statSyncSnap(beforePath).size > MAX_SNAPSHOT_BYTES) {
            return text(`Snapshot too large to diff: ${beforePath}`);
        }
        const before = JSON.parse(readFileSync(beforePath, 'utf-8'));
        let after;
        if (input.after) {
            const afterName = input.after;
            if (!SAFE_SNAPSHOT_NAME.test(afterName))
                return text(`Invalid snapshot name: ${afterName}`);
            const afterPath = join(snapshotDir, `${afterName}.json`);
            if (!resolvePath(afterPath).startsWith(snapshotDir))
                return text(`Path traversal detected in snapshot name`);
            if (!existsSync(afterPath))
                return text(`Snapshot not found: ${afterPath}`);
            if (statSyncSnap(afterPath).size > MAX_SNAPSHOT_BYTES)
                return text(`Snapshot too large to diff: ${afterPath}`);
            after = JSON.parse(readFileSync(afterPath, 'utf-8'));
        }
        else {
            const db = openDb(getDbPath());
            try {
                after = snapshotFromDb(db);
            }
            finally {
                closeDb(db);
            }
        }
        const diff = diffSnapshots(before, after);
        const nodeById = new Map();
        const indexNodes = (nodes) => {
            for (const n of nodes) {
                if (n.id)
                    nodeById.set(n.id, n);
            }
        };
        indexNodes(before.nodes);
        indexNodes(after.nodes);
        const resolveEdgeEnd = (id) => {
            const ref = nodeById.get(id);
            if (!ref)
                return id; // fallback to raw id if not found
            const loc = ref.filePath ? (ref.startLine != null ? `${ref.filePath}:${ref.startLine}` : ref.filePath) : '';
            return loc ? `${ref.name}  [${loc}]` : ref.name;
        };
        const section = (label, items) => items.length > 0 ? `\n${label} (${items.length}):\n${items.slice(0, 10).join('\n')}${items.length > 10 ? `\n  … ${items.length - 10} more` : ''}` : '';
        const formatNode = (n) => {
            const loc = n.filePath ? (n.startLine != null ? `${n.filePath}:${n.startLine}` : n.filePath) : '';
            return `  [${n.label ?? '?'}] ${n.name ?? '?'}${loc ? `  ${loc}` : ''}`;
        };
        const lines = [
            `Diff: ${diff.summary}`,
            section('New nodes', diff.newNodes.map(n => `  + ${formatNode(n)}`)),
            section('Removed nodes', diff.removedNodes.map(n => `  - ${formatNode(n)}`)),
            section('New edges', diff.newEdges.map(e => `  + ${resolveEdgeEnd(e.sourceId)} --[${e.relation}]--> ${resolveEdgeEnd(e.targetId)}`)),
            section('Removed edges', diff.removedEdges.map(e => `  - ${resolveEdgeEnd(e.sourceId)} --[${e.relation}]--> ${resolveEdgeEnd(e.targetId)}`)),
        ].join('');
        return text(lines);
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
        const { openDb, closeDb, toJson, toSvg, toGraphml, toCypher, toObsidian, toCanvas } = await import('@monoes/monograph');
        const { writeFileSync, mkdirSync } = await import('fs');
        const db = openDb(getDbPath());
        try {
            // Exclude `embedding` — a several-KB-per-node vector column that would
            // otherwise bloat exported files by many MB for no rendering benefit.
            const nodes = db.prepare(`SELECT ${NODE_RENDER_COLUMNS} FROM nodes`).all();
            const edges = db.prepare('SELECT * FROM edges').all();
            const fmt = input.format;
            const requestedOut = input.outputPath ?? join(getProjectCwd(), '.monomind', 'export');
            const outDir = resolve(getProjectCwd(), requestedOut);
            const allowedRoot = resolve(getProjectCwd());
            if (outDir !== allowedRoot && !outDir.startsWith(allowedRoot + sep)) {
                return text(`Error: outputPath must be within the project directory (${allowedRoot})`);
            }
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
            if (fmt === 'obsidian') {
                toObsidian(nodes, edges, outDir);
                return text(`Exported Obsidian vault to ${outDir}`);
            }
            if (fmt === 'canvas') {
                const p = join(outDir, 'graph.canvas');
                writeFileSync(p, toCanvas(nodes, edges));
                return text(`Exported Canvas to ${p}`);
            }
            return text(`Format ${fmt} export written to ${outDir}`);
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_context ─────────────────────────────────────────────────────────
const monographContextTool = {
    name: 'monograph_context',
    description: '360° symbol view: callers, callees, imports, importedBy, community, and containing processes for a symbol.',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Symbol name to look up' },
            filePath: { type: 'string', description: 'Optional file path to disambiguate' },
        },
        required: ['name'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { getMonographContext } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            // Cap name and filePath: forwarded to parameterized SQL via getMonographContext.
            // Very long strings waste memory before the query even executes.
            const MAX_CTX_NAME_LEN = 512;
            const MAX_CTX_PATH_LEN = 4 * 1024;
            const rawCtxName = input.name;
            const ctxName = typeof rawCtxName === 'string' && rawCtxName.length > MAX_CTX_NAME_LEN
                ? rawCtxName.slice(0, MAX_CTX_NAME_LEN) : rawCtxName;
            const rawCtxPath = input.filePath;
            const ctxPath = typeof rawCtxPath === 'string' && rawCtxPath.length > MAX_CTX_PATH_LEN
                ? rawCtxPath.slice(0, MAX_CTX_PATH_LEN) : rawCtxPath;
            const result = getMonographContext(db, {
                name: ctxName,
                filePath: ctxPath,
            });
            if (!result || !result.node)
                return text(`No symbol found: ${ctxName}`);
            // Format context as structured text for direct LLM consumption
            const n = result.node;
            const loc = n.filePath ? (n.startLine != null ? `${n.filePath}:${n.startLine}` : n.filePath) : '';
            const lines = [
                `[${n.label ?? '?'}] ${n.name}  ${loc}`,
                '',
            ];
            const formatNodes = (nodes, label) => {
                if (!Array.isArray(nodes) || nodes.length === 0)
                    return;
                lines.push(`${label} (${nodes.length}):`);
                for (const node of nodes.slice(0, 20)) {
                    const fp = node.filePath ?? node.file_path ?? '';
                    const ln = node.startLine ?? node.start_line;
                    const nodeLoc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
                    lines.push(`  [${node.label ?? '?'}] ${node.name ?? node.id}  ${nodeLoc}`);
                }
                if (nodes.length > 20)
                    lines.push(`  … ${nodes.length - 20} more`);
                lines.push('');
            };
            formatNodes(result.callers, 'Callers');
            formatNodes(result.callees, 'Callees');
            formatNodes(result.imports, 'Imports');
            formatNodes(result.importedBy, 'ImportedBy');
            if (result.community != null)
                lines.push(`Community: ${result.community}`);
            if (result.communityName)
                lines.push(`Community name: ${result.communityName}`);
            return text(lines.join('\n').trim());
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_impact ──────────────────────────────────────────────────────────
const monographImpactTool = {
    name: 'monograph_impact',
    description: 'Blast radius analysis: finds all direct and transitive callers of a symbol and computes a risk score.',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Symbol name to analyze' },
            filePath: { type: 'string', description: 'Optional file path to disambiguate' },
            depth: { type: 'number', description: 'Max BFS depth (default 3, max 6)' },
        },
        required: ['name'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { getMonographImpact } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            // Cap name/filePath; enforce depth ≤ 6 as documented in the schema description.
            const MAX_IMPACT_NAME_LEN = 512;
            const MAX_IMPACT_PATH_LEN = 4 * 1024;
            const rawImpactName = input.name;
            const impactName = typeof rawImpactName === 'string' && rawImpactName.length > MAX_IMPACT_NAME_LEN
                ? rawImpactName.slice(0, MAX_IMPACT_NAME_LEN) : rawImpactName;
            const rawImpactPath = input.filePath;
            const impactPath = typeof rawImpactPath === 'string' && rawImpactPath.length > MAX_IMPACT_PATH_LEN
                ? rawImpactPath.slice(0, MAX_IMPACT_PATH_LEN) : rawImpactPath;
            const rawDepth = input.depth;
            const depth = rawDepth === undefined
                ? undefined
                : (typeof rawDepth === 'number' && Number.isFinite(rawDepth) && rawDepth > 0
                    ? Math.min(Math.floor(rawDepth), 6) : 3);
            const result = getMonographImpact(db, {
                name: impactName,
                filePath: impactPath,
                depth,
            });
            if (!result || !result.node)
                return text(`No symbol found: ${impactName}`);
            // Format impact as structured text for direct LLM consumption
            const root = result.node;
            const rootLoc = root.filePath ? (root.startLine != null ? `${root.filePath}:${root.startLine}` : root.filePath) : '';
            const lines = [
                `[${root.label ?? '?'}] ${root.name}  ${rootLoc}`,
                '',
                `Blast radius: ${result.affectedFiles?.length ?? 0} symbols affected`,
            ];
            if (result.riskScore != null) {
                const riskLabel = result.riskScore >= 0.8 ? 'HIGH' : result.riskScore >= 0.5 ? 'MEDIUM' : 'LOW';
                lines.push(`Risk score: ${result.riskScore.toFixed(2)} (${riskLabel})`);
            }
            lines.push('');
            const affected = [
                ...(result.directCallers ?? []),
                ...(result.transitiveCallers ?? []).flatMap(t => t.nodes ?? []),
            ];
            if (affected.length > 0) {
                lines.push(`Affected callers (${affected.length}):`);
                for (const sym of affected.slice(0, 20)) {
                    const fp = sym.filePath ?? sym.file_path ?? '';
                    const ln = sym.startLine ?? sym.start_line;
                    const symLoc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
                    const depth_marker = sym.depth != null ? ` [depth ${sym.depth}]` : '';
                    lines.push(`  [${sym.label ?? '?'}] ${sym.name ?? sym.id}  ${symLoc}${depth_marker}`);
                }
                if (affected.length > 20)
                    lines.push(`  … ${affected.length - 20} more`);
            }
            return text(lines.join('\n').trim());
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_detect_changes ──────────────────────────────────────────────────
const monographDetectChangesTool = {
    name: 'monograph_detect_changes',
    description: 'Git diff → affected symbols: identifies which indexed symbols live in files changed since the base branch.',
    inputSchema: {
        type: 'object',
        properties: {
            baseBranch: { type: 'string', description: 'Base branch to diff against (default: main)' },
            includeTests: { type: 'boolean', description: 'Include test files (default: true)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { detectMonographChanges } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const result = detectMonographChanges(db, {
                baseBranch: input.baseBranch,
                includeTests: input.includeTests,
            }, getProjectCwd());
            // Format as structured text for direct LLM navigation instead of raw JSON
            const r = result;
            if (!r || (!r.changedFiles?.length && !r.affectedSymbols?.length)) {
                return text('No changed files found relative to the base branch.');
            }
            const lines = [];
            const base = r.baseBranch ?? 'main';
            const changedFiles = r.changedFiles ?? [];
            lines.push(`Changed files vs ${base}: ${changedFiles.length}`);
            if (changedFiles.length > 0) {
                for (const f of changedFiles.slice(0, 20))
                    lines.push(`  ${f}`);
                if (changedFiles.length > 20)
                    lines.push(`  … ${changedFiles.length - 20} more`);
            }
            lines.push('');
            const affected = r.affectedSymbols ?? r.affected ?? [];
            if (affected.length > 0) {
                lines.push(`Affected symbols (${affected.length}):`);
                for (const sym of affected.slice(0, 30)) {
                    const fp = sym.filePath ?? sym.file_path ?? '';
                    const ln = sym.startLine ?? sym.start_line;
                    const loc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
                    lines.push(`  [${sym.label ?? '?'}] ${sym.name ?? sym.id}  ${loc}`);
                }
                if (affected.length > 30)
                    lines.push(`  … ${affected.length - 30} more`);
            }
            return text(lines.join('\n').trim());
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_rename ──────────────────────────────────────────────────────────
const monographRenameTool = {
    name: 'monograph_rename',
    description: 'Dry-run multi-file rename: finds all references to a symbol and shows before/after diffs without writing files.',
    inputSchema: {
        type: 'object',
        properties: {
            oldName: { type: 'string', description: 'Current symbol name' },
            newName: { type: 'string', description: 'New symbol name' },
            filePath: { type: 'string', description: 'Optional file path to disambiguate the symbol' },
            dryRun: { type: 'boolean', description: 'Always true — files are never modified (default: true)' },
        },
        required: ['oldName', 'newName'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { getMonographRename } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const result = getMonographRename(db, {
                oldName: input.oldName,
                newName: input.newName,
                filePath: input.filePath,
                dryRun: input.dryRun ?? true,
            });
            // Format as structured text for direct LLM navigation instead of raw JSON
            const rn = result;
            if (!rn)
                return text(`Symbol not found: ${input.oldName}`);
            const occurrences = rn.occurrences ?? rn.references ?? [];
            const lines = [
                `Rename: ${input.oldName} → ${input.newName}  (dry-run)`,
                `Occurrences: ${occurrences.length}`,
                '',
            ];
            for (const occ of occurrences.slice(0, 30)) {
                const fp = occ.filePath ?? occ.file_path ?? '';
                const ln = occ.line ?? occ.startLine ?? occ.start_line;
                const loc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
                lines.push(`  ${loc || occ}`);
            }
            if (occurrences.length > 30)
                lines.push(`  … ${occurrences.length - 30} more`);
            return text(lines.join('\n').trim());
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_route_map ───────────────────────────────────────────────────────
const monographRouteMapTool = {
    name: 'monograph_route_map',
    description: 'List all HTTP routes in the codebase with their handler info. Supports filtering by URL prefix or HTTP method.',
    inputSchema: {
        type: 'object',
        properties: {
            prefix: { type: 'string', description: 'Filter routes whose path contains this prefix (e.g. /api)' },
            method: { type: 'string', description: 'Filter by HTTP method: GET, POST, PUT, DELETE, PATCH, ANY' },
            includeMiddleware: { type: 'boolean', description: 'Include middleware/use routes (default: false)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { getMonographRouteMap } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const result = getMonographRouteMap(db, {
                prefix: input.prefix,
                method: input.method,
                includeMiddleware: input.includeMiddleware,
            });
            if (result.routes.length === 0)
                return text('No routes found. Run monograph_build first or adjust your filters.');
            const lines = [`Routes (${result.total} total):`];
            for (const r of result.routes) {
                const loc = r.handlerFile
                    ? (r.handlerLine != null ? `${r.handlerFile}:${r.handlerLine}` : r.handlerFile)
                    : '';
                const mw = r.middlewareChain.length > 0 ? `  middleware: ${r.middlewareChain.join(' → ')}` : '';
                lines.push(`  ${r.method} ${r.path}${r.handlerName ? ` → ${r.handlerName}` : ''}${loc ? `  (${loc})` : ''}${mw}`);
            }
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_api_impact ──────────────────────────────────────────────────────
const monographApiImpactTool = {
    name: 'monograph_api_impact',
    description: 'Analyze the blast radius of an API route: finds the handler, performs forward BFS through CALLS edges, and computes a risk score.',
    inputSchema: {
        type: 'object',
        properties: {
            routePath: { type: 'string', description: 'Route path to analyze (e.g. /api/users)' },
            method: { type: 'string', description: 'Optional HTTP method filter: GET, POST, etc.' },
        },
        required: ['routePath'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { getMonographApiImpact } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const result = getMonographApiImpact(db, {
                routePath: input.routePath,
                method: input.method,
            });
            if (!result.route)
                return text(`Route not found: ${input.routePath}. Run monograph_build or check the path.`);
            const riskLabel = result.riskScore >= 0.7 ? 'HIGH' : result.riskScore >= 0.4 ? 'MEDIUM' : 'LOW';
            const lines = [
                `Route: ${result.route.method} ${result.route.path}  risk=${riskLabel} (${result.riskScore.toFixed(2)})`,
            ];
            if (result.handler) {
                const hLoc = result.handler.filePath
                    ? (result.handler.startLine != null ? `${result.handler.filePath}:${result.handler.startLine}` : result.handler.filePath)
                    : '';
                lines.push(`Handler: ${result.handler.name}${hLoc ? `  ${hLoc}` : ''}`);
            }
            if (result.callees.length > 0) {
                lines.push(`Callees (${result.callees.length}):`);
                for (const c of result.callees.slice(0, 15)) {
                    const loc = c.node.filePath
                        ? (c.node.startLine != null ? `${c.node.filePath}:${c.node.startLine}` : c.node.filePath)
                        : '';
                    lines.push(`  ${'  '.repeat(c.depth)}→ ${c.node.name} [${c.node.label}]${loc ? `  ${loc}` : ''}`);
                }
                if (result.callees.length > 15)
                    lines.push(`  … ${result.callees.length - 15} more`);
            }
            if (result.affectedProcesses.length > 0) {
                lines.push(`Affected processes: ${result.affectedProcesses.map(p => p.name).join(', ')}`);
            }
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
    description: 'Execute a restricted read-only Cypher-style MATCH query against the Monograph knowledge graph. Supports node and relationship patterns. Write operations (CREATE, MERGE, SET, DELETE, REMOVE, DROP) are blocked.',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Cypher MATCH query. Example: MATCH (a:Function)-[:CALLS]->(b:Function {name: "authenticate"}) RETURN a.name, a.filePath',
            },
        },
        required: ['query'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { getMonographCypher } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            // Cap query: forwarded to the Cypher query engine; very long strings
            // waste parse time and can stress the query compiler.
            const MAX_CYPHER_QUERY_LEN = 16 * 1024;
            const rawCypherQuery = input.query;
            const cypherQuery = typeof rawCypherQuery === 'string' && rawCypherQuery.length > MAX_CYPHER_QUERY_LEN
                ? rawCypherQuery.slice(0, MAX_CYPHER_QUERY_LEN)
                : rawCypherQuery;
            const result = getMonographCypher(db, cypherQuery);
            if (result.error)
                return text(`Error: ${result.error}`);
            if (result.rows.length === 0)
                return text('No results found.');
            const header = Object.keys(result.rows[0]).join('\t');
            const lines = result.rows.map(r => Object.values(r).join('\t'));
            return text([header, ...lines, `\n(${result.rows.length} rows, ${result.queryTime}ms)`].join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_group_list ──────────────────────────────────────────────────────
const monographGroupListTool = {
    name: 'monograph_group_list',
    description: 'List repos in a group.yaml with index metadata (node count and indexed_at timestamp). Useful for checking which repos have been indexed.',
    inputSchema: {
        type: 'object',
        properties: {
            configPath: { type: 'string', description: 'Path to group.yaml (defaults to group.yaml in project cwd)' },
        },
    },
    handler: async (input) => {
        const { getGroupList } = await import('@monoes/monograph');
        const configPath = input.configPath ?? join(getProjectCwd(), 'group.yaml');
        const result = await getGroupList(configPath);
        const firstGroup = result.groups?.[0];
        const allRepos = result.groups?.flatMap((g) => g.repos ?? []) ?? [];
        if (!allRepos.length) {
            return text(`Group: ${firstGroup?.name ?? 'unknown'}\nNo repos configured. Check ${configPath}`);
        }
        const lines = [`Group: ${firstGroup?.name ?? 'unknown'}  (${allRepos.length} repos)`];
        for (const r of allRepos) {
            const indexed = r.indexedAt ? r.indexedAt.slice(0, 10) : 'never';
            lines.push(`  ${r.name}  nodes=${r.nodeCount}  indexed=${indexed}  ${r.path}`);
        }
        return text(lines.join('\n'));
    },
};
// ── monograph_group_query ─────────────────────────────────────────────────────
const monographGroupQueryTool = {
    name: 'monograph_group_query',
    description: 'BM25 keyword search merged across all repos in a group.yaml using Reciprocal Rank Fusion (RRF). Returns results tagged with which repo they came from.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search terms' },
            configPath: { type: 'string', description: 'Path to group.yaml (defaults to group.yaml in project cwd)' },
            limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['query'],
    },
    handler: async (input) => {
        const { runGroupQuery } = await import('@monoes/monograph');
        const configPath = input.configPath ?? join(getProjectCwd(), 'group.yaml');
        // Cap query and limit forwarded to runGroupQuery.
        const MAX_GROUP_QUERY_LEN = 16 * 1024;
        const MAX_GROUP_LIMIT = 1_000;
        const rawGroupQuery = input.query;
        const groupQuery = typeof rawGroupQuery === 'string' && rawGroupQuery.length > MAX_GROUP_QUERY_LEN
            ? rawGroupQuery.slice(0, MAX_GROUP_QUERY_LEN)
            : rawGroupQuery;
        const rawGroupLimit = input.limit;
        const groupLimit = Number.isFinite(rawGroupLimit) && (rawGroupLimit ?? 0) > 0
            ? Math.min(Math.floor(rawGroupLimit), MAX_GROUP_LIMIT)
            : rawGroupLimit;
        const results = await runGroupQuery(configPath, groupQuery, groupLimit);
        if (results.length === 0)
            return text('No results found.');
        const lines = results.map(r => `[${r.label}] ${r.name}  ${r.filePath ?? ''}  repo:${r.repo}  (score: ${r.score.toFixed(4)})`);
        return text(lines.join('\n'));
    },
};
// ── monograph_wiki ────────────────────────────────────────────────────────────
const monographWikiTool = {
    name: 'monograph_wiki',
    description: 'Retrieve LLM-generated wiki pages for code communities. Returns one page by communityId or all pages if no filter provided.',
    inputSchema: {
        type: 'object',
        properties: {
            communityId: { type: 'string', description: 'Community ID to retrieve (omit to list all pages)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { getWikiToolResult } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const result = getWikiToolResult(db, { communityId: input.communityId });
            if (result.pages.length === 0) {
                return text('No wiki pages found. Run monograph_wiki_build to generate community wiki pages.');
            }
            // Return pages as readable prose — content is already LLM-generated markdown.
            const sections = result.pages.map(p => `--- Community ${p.communityId} ---\n${p.content}`);
            return text(sections.join('\n\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_wiki_build ──────────────────────────────────────────────────────
const monographWikiBuildTool = {
    name: 'monograph_wiki_build',
    description: 'Generate wiki pages for code communities using Claude Code CLI (no API key needed — reuses Claude Code auth).',
    inputSchema: {
        type: 'object',
        properties: {
            communityId: { type: 'string', description: 'Only generate for this community ID (omit for all communities)' },
            force: { type: 'boolean', description: 'Regenerate even if page already exists (default false)' },
            model: { type: 'string', description: 'Anthropic model to use (default: claude-haiku-4-5-20251001)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { runWikiBuildTool } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const result = await runWikiBuildTool(db, {
                communityId: input.communityId,
                force: input.force,
                model: input.model,
            });
            if (result.error)
                return text(`Wiki build failed: ${result.error}`);
            const parts = [];
            if (result.generated != null)
                parts.push(`${result.generated} page(s) generated`);
            if (result.skipped != null && result.skipped > 0)
                parts.push(`${result.skipped} skipped (already exist)`);
            if (result.errors != null && result.errors > 0)
                parts.push(`${result.errors} error(s)`);
            return text(`Wiki build complete: ${parts.join(', ') || 'nothing to do'}. Use monograph_wiki to read the pages.`);
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_serve ───────────────────────────────────────────────────────────
const monographServeTool = {
    name: 'monograph_serve',
    description: 'Start a web UI server that visualizes the knowledge graph interactively using Sigma.js. Returns the URL where the dashboard is accessible.',
    inputSchema: {
        type: 'object',
        properties: {
            port: { type: 'number', description: 'Port to listen on (default 7374)' },
            open: { type: 'boolean', description: 'Open the URL in the default browser after starting (default false)' },
        },
    },
    handler: async (input) => {
        const { openDb } = await import('@monoes/monograph');
        const { serveMonograph } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        const result = await serveMonograph({
            port: input.port ?? 7374,
            open: input.open ?? false,
            db,
        });
        return text(`Monograph web UI ${result.status === 'already_running' ? 'already running' : 'started'} at ${result.url}`);
    },
};
// ── monograph_tool_map ────────────────────────────────────────────────────────
const monographToolMapTool = {
    name: 'monograph_tool_map',
    description: 'List MCP/RPC tool definitions in the knowledge graph with handler associations. Shows which functions handle each tool.',
    inputSchema: {
        type: 'object',
        properties: {
            tool: { type: 'string', description: 'Filter by tool name substring' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { getToolMap } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const results = getToolMap(db, { tool: input.tool });
            if (results.length === 0)
                return text('No tools found. Run monograph_build first.');
            const lines = results.map(r => {
                const loc = r.handlerFile
                    ? (r.handlerLine != null ? `${r.handlerFile}:${r.handlerLine}` : r.handlerFile)
                    : (r.filePath ?? '');
                return `${r.name}${r.handlerName ? ` → ${r.handlerName}` : ''}${loc ? `  (${loc})` : ''}`;
            });
            return text(`Tools (${results.length}):\n${lines.join('\n')}`);
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_shape_check ─────────────────────────────────────────────────────
const monographShapeCheckTool = {
    name: 'monograph_shape_check',
    description: 'Validate API route response shapes: checks that handler return keys match consumer property accesses. Detects shape mismatches between producer and consumer.',
    inputSchema: {
        type: 'object',
        properties: {
            route: { type: 'string', description: 'Filter by route path substring (e.g. /api/users)' },
            file: { type: 'string', description: 'Filter by source file path substring' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { getShapeCheck } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        const repoPath = getProjectCwd();
        try {
            const result = getShapeCheck(db, repoPath, {
                route: input.route,
                file: input.file,
            });
            // Render as structured text so LLMs can act on it directly without parsing JSON.
            const lines = [];
            lines.push(`Shape check: ${result.message}`);
            if (result.route) {
                const handlerLoc = result.route.handlerFile
                    ? `  Handler: ${result.route.handlerName}  [${result.route.handlerFile}]`
                    : `  Handler: ${result.route.handlerName}`;
                lines.push(`Route: ${result.route.method} ${result.route.path}`);
                lines.push(handlerLoc);
            }
            if (result.shape.returnedKeys.length > 0) {
                lines.push(`  Returned keys: ${result.shape.returnedKeys.join(', ')}`);
            }
            if (result.shape.accessedKeys.length > 0) {
                lines.push(`  Accessed keys: ${result.shape.accessedKeys.join(', ')}`);
            }
            if (result.shape.mismatches.length > 0) {
                lines.push(`  Mismatches (accessed but not returned): ${result.shape.mismatches.join(', ')}`);
            }
            if (result.shape.extra.length > 0) {
                lines.push(`  Unused returned keys: ${result.shape.extra.join(', ')}`);
            }
            if (result.consumers.length > 0) {
                lines.push(`  Consumers (${result.consumers.length}):`);
                for (const c of result.consumers.slice(0, 10)) {
                    lines.push(`    - ${c.name}  [${c.filePath}]`);
                }
                if (result.consumers.length > 10) {
                    lines.push(`    … ${result.consumers.length - 10} more`);
                }
            }
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_group_sync ──────────────────────────────────────────────────────
const monographGroupSyncTool = {
    name: 'monograph_group_sync',
    description: 'Scan all repos in a group.yaml for Route nodes, detect shared HTTP contracts across repos, and persist the Contract Registry to disk.',
    inputSchema: {
        type: 'object',
        properties: {
            configPath: { type: 'string', description: 'Path to group.yaml (defaults to group.yaml in project cwd)' },
        },
    },
    handler: async (input) => {
        const { runGroupSync } = await import('@monoes/monograph');
        const configPath = input.configPath ?? join(getProjectCwd(), 'group.yaml');
        try {
            const result = await runGroupSync(configPath);
            return text(JSON.stringify(result, null, 2));
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return text(`Group sync failed: ${msg}`);
        }
    },
};
// ── monograph_augment ─────────────────────────────────────────────────────────
const monographAugmentTool = {
    name: 'monograph_augment',
    description: 'Retrieve relevant code context for a query using graph-RAG. Returns formatted context block for injection into AI prompts.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'The search query or task description' },
            topK: { type: 'number', description: 'Number of results (default: 10)' },
            format: { type: 'string', enum: ['markdown', 'json'], description: 'Output format (default: markdown)' },
        },
        required: ['query'],
    },
    handler: async (input) => {
        const { augmentContext } = await import('@monoes/monograph');
        const repoPath = getProjectCwd();
        // Cap query (forwarded to FTS/embedding in augmentContext) and topK
        // (controls how many context nodes are retrieved).
        const MAX_AUGMENT_QUERY_LEN = 16 * 1024;
        const MAX_AUGMENT_TOP_K = 100;
        const rawAugmentQuery = input.query;
        const augmentQuery = typeof rawAugmentQuery === 'string' && rawAugmentQuery.length > MAX_AUGMENT_QUERY_LEN
            ? rawAugmentQuery.slice(0, MAX_AUGMENT_QUERY_LEN) : rawAugmentQuery;
        const rawTopK = input.topK ?? 10;
        const topK = Number.isFinite(rawTopK) && rawTopK > 0
            ? Math.min(Math.floor(rawTopK), MAX_AUGMENT_TOP_K) : 10;
        const result = await augmentContext({
            query: augmentQuery,
            repoPath,
            topK,
            format: input.format ?? 'markdown',
        });
        return text(result);
    },
};
// ── monograph_inject_context ──────────────────────────────────────────────────
const monographInjectContextTool = {
    name: 'monograph_inject_context',
    description: 'Inject monograph capabilities description into AGENTS.md or CLAUDE.md for AI agent discovery.',
    inputSchema: {
        type: 'object',
        properties: {
            targets: {
                type: 'array',
                items: { type: 'string', enum: ['claude', 'agents-md'] },
                description: 'Which files to update (default: both)',
            },
        },
    },
    handler: async (input) => {
        const { injectAiContext } = await import('@monoes/monograph');
        const repoPath = getProjectCwd();
        const result = await injectAiContext({
            repoPath,
            targets: input.targets,
        });
        return text(`Injected context into: ${result.updated.join(', ') || 'none'}`);
    },
};
// ── monograph_skill_gen ───────────────────────────────────────────────────────
const monographSkillGenTool = {
    name: 'monograph_skill_gen',
    description: 'Generate per-community skill files summarizing code structure for AI navigation.',
    inputSchema: {
        type: 'object',
        properties: {
            outputDir: { type: 'string', description: 'Output directory for skill files (default: .monomind/skills/)' },
        },
    },
    handler: async (input) => {
        const { generateSkillFiles } = await import('@monoes/monograph');
        const repoPath = getProjectCwd();
        const allowedRoot = resolve(repoPath);
        if (input.outputDir) {
            const outDir = resolve(input.outputDir);
            if (outDir !== allowedRoot && !outDir.startsWith(allowedRoot + sep)) {
                return text(`Error: outputDir must be within the project directory (${allowedRoot})`);
            }
        }
        const result = await generateSkillFiles(repoPath, input.outputDir ? resolve(input.outputDir) : undefined);
        const dir = result.filesWritten.length > 0
            ? result.filesWritten[0].replace(/\/[^/]+$/, '/')
            : join(repoPath, '.monomind', 'skills') + '/';
        return text(`Generated ${result.communityCount} skill files in ${dir}`);
    },
};
// ── monograph_install_skills ──────────────────────────────────────────────────
const monographInstallSkillsTool = {
    name: 'monograph_install_skills',
    description: 'Install monograph skill files for a specific IDE/platform (claude, cursor, vscode, zed).',
    inputSchema: {
        type: 'object',
        properties: {
            platform: {
                type: 'string',
                description: 'Target platform: claude, cursor, vscode, or zed',
            },
            repoPath: {
                type: 'string',
                description: 'Absolute path to the repository (defaults to cwd)',
            },
        },
        required: ['platform'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const { installSkillsForPlatform } = await import('@monoes/monograph');
        const rawRepoPath = input.repoPath ?? getProjectCwd();
        const repoPath = resolve(rawRepoPath);
        const allowedRoot = resolve(getProjectCwd());
        if (repoPath !== allowedRoot && !repoPath.startsWith(allowedRoot + sep)) {
            return text(`Error: repoPath must be within the project directory (${allowedRoot})`);
        }
        const platform = input.platform;
        const validPlatforms = ['claude', 'cursor', 'vscode', 'zed'];
        if (!validPlatforms.includes(platform)) {
            return text(`Invalid platform "${platform}". Must be one of: ${validPlatforms.join(', ')}`);
        }
        // Load community data from graph
        const dbPath = getDbPath(repoPath);
        // openDb's fileMustExist option isn't in the currently-published
        // @monoes/monograph release this CLI depends on — check validity
        // ourselves so a missing DB doesn't get silently auto-created empty.
        if (!_isValidDb(dbPath)) {
            return text('Graph not built yet. Run monograph_build first.');
        }
        let db;
        try {
            db = openDb(dbPath);
        }
        catch {
            return text('Graph not built yet. Run monograph_build first.');
        }
        let communities;
        try {
            // Query distinct community IDs with exported symbols
            const communityIds = db.prepare(`
        SELECT DISTINCT community_id
        FROM nodes
        WHERE community_id IS NOT NULL
          AND label NOT IN ('File', 'Folder', 'Community', 'Concept')
        ORDER BY community_id
      `).all();
            if (communityIds.length === 0) {
                closeDb(db);
                return text('No communities found in graph. Run monograph_build first.');
            }
            communities = communityIds.map(({ community_id }) => {
                // Derive a readable name from folder paths
                const pathRows = db.prepare(`
          SELECT file_path FROM nodes
          WHERE community_id = ? AND file_path IS NOT NULL
            AND label NOT IN ('File', 'Folder', 'Community', 'Concept')
          LIMIT 20
        `).all(community_id);
                let name = `community-${community_id}`;
                const folderCounts = new Map();
                for (const row of pathRows) {
                    const parts = row.file_path.replace(/\\/g, '/').split('/').filter(Boolean);
                    if (parts.length >= 2) {
                        const folder = parts[parts.length - 2].toLowerCase();
                        if (!['src', 'lib', 'core', 'utils', 'common', 'shared', 'helpers', 'dist'].includes(folder)) {
                            folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
                        }
                    }
                }
                let bestCount = 0;
                for (const [folder, count] of folderCounts) {
                    if (count > bestCount) {
                        bestCount = count;
                        name = folder;
                    }
                }
                // Collect exported symbol names
                const symbolRows = db.prepare(`
          SELECT name FROM nodes
          WHERE community_id = ? AND is_exported = 1
            AND label NOT IN ('File', 'Folder', 'Community', 'Concept')
          ORDER BY name
          LIMIT 50
        `).all(community_id);
                return { name, symbols: symbolRows.map(r => r.name) };
            });
        }
        catch (err) {
            closeDb(db);
            const msg = err instanceof Error ? err.message : String(err);
            return text(`Failed to query graph: ${msg}`);
        }
        closeDb(db);
        const result = await installSkillsForPlatform(repoPath, communities, {
            platform: platform,
        });
        return text(`Installed ${result.filesWritten.length} skill files for ${result.platform} in ${result.outputDir}`);
    },
};
// ── monograph_doctor ──────────────────────────────────────────────────────────
const monographDoctorTool = {
    name: 'monograph_doctor',
    description: 'Run platform diagnostics — checks Node version, SQLite DB health, node count, disk space.',
    inputSchema: {
        type: 'object',
        properties: {},
    },
    handler: async (_input) => {
        const { runDoctor } = await import('@monoes/monograph');
        const repoPath = getProjectCwd();
        const result = await runDoctor(repoPath);
        const lines = result.checks.map(c => `${c.status === 'ok' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'} ${c.name}: ${c.message}`);
        if (!result.healthy)
            lines.push('\nSome checks failed. Run monograph build to fix.');
        return text(lines.join('\n'));
    },
};
// ── monograph_list_repos ──────────────────────────────────────────────────────
const monographListReposTool = {
    name: 'monograph_list_repos',
    description: 'List all repositories tracked in the global monograph registry (~/.monograph/registry.json).',
    inputSchema: {
        type: 'object',
        properties: {},
    },
    handler: async (_input) => {
        const { listRepos } = await import('@monoes/monograph');
        const repos = listRepos();
        if (repos.length === 0)
            return text('No repositories registered. Run monograph build in a repo to register it.');
        const lines = repos.map(r => `${r.name} — ${r.path}${r.lastIndexed ? ` (indexed ${r.lastIndexed.slice(0, 10)})` : ''}${r.nodeCount != null ? ` [${r.nodeCount} nodes, ${r.edgeCount ?? 0} edges]` : ''}`);
        return text(lines.join('\n'));
    },
};
// ── monograph_group_contracts ─────────────────────────────────────────────────
const monographGroupContractsTool = {
    name: 'monograph_group_contracts',
    description: 'List public API contracts (exported symbols, interfaces, and types) for all groups defined in group.yaml.',
    inputSchema: {
        type: 'object',
        properties: {
            configPath: { type: 'string', description: 'Path to group.yaml (defaults to group.yaml in project cwd)' },
        },
    },
    handler: async (input) => {
        const { getGroupContracts } = await import('./monograph-compat.js');
        const configPath = input.configPath ?? join(getProjectCwd(), 'group.yaml');
        const contracts = await getGroupContracts(configPath);
        if (contracts.length === 0)
            return text(`No contracts found. Ensure groups are defined in ${configPath}.`);
        const lines = contracts.map(c => `[${c.groupName}] ${c.symbol} — ${c.filePath}:${c.line}`);
        return text(lines.join('\n'));
    },
};
// ── monograph_group_status ────────────────────────────────────────────────────
const monographGroupStatusTool = {
    name: 'monograph_group_status',
    description: 'Show health status for all groups: whether each group is indexed, has contracts, and was recently synced.',
    inputSchema: {
        type: 'object',
        properties: {
            configPath: { type: 'string', description: 'Path to group.yaml (defaults to group.yaml in project cwd)' },
        },
    },
    handler: async (input) => {
        const { getGroupStatus } = await import('./monograph-compat.js');
        const configPath = input.configPath ?? join(getProjectCwd(), 'group.yaml');
        const status = await getGroupStatus(configPath);
        const lines = [`Groups: ${status.totalGroups} (${status.indexedGroups} indexed, ${status.stalledGroups} stalled)`];
        for (const g of status.groups) {
            const icon = g.indexed ? (g.stale ? '⚠️' : '✅') : '❌';
            lines.push(`${icon} ${g.name} — ${g.contractCount} contracts${g.lastSync ? ` (synced ${g.lastSync.slice(0, 10)})` : ''}`);
        }
        return text(lines.join('\n'));
    },
};
// ── monograph_neighbors ───────────────────────────────────────────────────────
const monographNeighborsTool = {
    name: 'monograph_neighbors',
    description: 'Show all directly connected nodes for a given symbol — outbound and optionally inbound edges, with relation types.',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Symbol name to look up' },
            relationFilter: { type: 'string', description: 'Filter by relation type, e.g. IMPORTS, CALLS' },
            includeInbound: { type: 'boolean', description: 'Include inbound edges (default: false)' },
        },
        required: ['name'],
    },
    handler: async (input) => {
        const { openDb, closeDb, getMonographNeighbors } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const result = getMonographNeighbors(db, {
                name: input.name,
                relationFilter: input.relationFilter,
                includeInbound: input.includeInbound ?? false,
            });
            if (!result.node)
                return text(`No node found with name: ${input.name}`);
            const nodeFilePath = result.node.filePath ?? '';
            const nodeStartLine = result.node.startLine ?? result.node.start_line;
            const nodeLoc = nodeFilePath ? (nodeStartLine != null ? `${nodeFilePath}:${nodeStartLine}` : nodeFilePath) : '';
            const lines = [
                `[${result.node.label}] ${result.node.name}  ${nodeLoc}`,
                `Neighbors: ${result.neighbors.length}`,
                '',
                ...result.neighbors.map(n => {
                    const fp = n.node.filePath ?? n.node.file_path ?? '';
                    const ln = n.node.startLine ?? n.node.start_line;
                    const loc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
                    return `  ${n.direction === 'inbound' ? '←' : '→'} [${n.node.label}] ${n.node.name}  (${n.relation})  ${loc}`;
                }),
            ];
            return text(lines.join('\n'));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_dead_code ──────────────────────────────────────────────────────
const monographDeadCodeTool = {
    name: 'monograph_dead_code',
    description: 'Detect dead code: exported functions with zero inbound references, files with no importers, and stale dist build artifacts. Returns structured JSON with candidates grouped by category. Always verify candidates with grep before deleting.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute path to the repo (defaults to project cwd)' },
            categories: {
                type: 'array',
                items: { type: 'string', enum: ['dead-functions', 'orphan-files', 'stale-dist'] },
                description: 'Which categories to check (default: all three)',
            },
        },
    },
    handler: async (input) => {
        const { openDb } = await import('@monoes/monograph');
        const repoPath = input.path ?? getProjectCwd();
        const cats = input.categories ?? ['dead-functions', 'orphan-files', 'stale-dist'];
        const result = {};
        const dbPath = getDbPath(repoPath);
        // openDb's fileMustExist option isn't in the currently-published
        // @monoes/monograph release this CLI depends on — check validity
        // ourselves so a missing DB doesn't get silently auto-created empty.
        if (!_isValidDb(dbPath)) {
            return text(JSON.stringify({ error: 'No monograph index found. Run monograph_build first.' }));
        }
        let db = null;
        try {
            db = openDb(dbPath);
            // _isValidDb's size check can't distinguish a real index from an
            // empty-but-schema-migrated DB (better-sqlite3 auto-creates + migrates
            // on open, and other unguarded openDb() call sites in this file can
            // create exactly that as a side effect of an unrelated tool call before
            // monograph_build ever runs). Verify actual content post-open so this
            // reports "never built" instead of a misleading "0 dead functions found".
            const { count } = db.prepare('SELECT COUNT(*) as count FROM nodes').get();
            if (count === 0) {
                return text(JSON.stringify({ error: 'No monograph index found. Run monograph_build first.' }));
            }
        }
        catch {
            return text(JSON.stringify({ error: 'No monograph index found. Run monograph_build first.' }));
        }
        try {
            if (cats.includes('dead-functions')) {
                const { detectDeadCodeNodes } = await import('@monoes/monograph');
                const { readFileSync } = await import('fs');
                const nodes = detectDeadCodeNodes(db);
                // Filter out stale graph nodes: verify the function name actually appears in the source file
                const verified = nodes.filter(n => {
                    if (!n.filePath)
                        return false;
                    try {
                        const content = readFileSync(join(repoPath, n.filePath), 'utf-8');
                        return content.includes(n.name);
                    }
                    catch {
                        return false;
                    }
                });
                const staleCount = nodes.length - verified.length;
                result['dead-functions'] = {
                    count: verified.length,
                    candidates: verified.map(n => ({
                        name: n.name,
                        location: n.filePath ? (n.startLine ? `${n.filePath}:${n.startLine}` : n.filePath) : null,
                    })),
                    ...(staleCount > 0 ? { staleIndexEntries: staleCount, note: 'Some graph entries reference deleted functions. Rebuild the index with monograph_build to clean up.' } : {}),
                };
            }
            if (cats.includes('orphan-files')) {
                const rows = db.prepare(`
          SELECT n.name, n.file_path,
            (SELECT COUNT(*) FROM edges e WHERE e.source_id = n.id AND e.relation = 'IMPORTS') as imports_out,
            (SELECT COUNT(*) FROM edges e WHERE e.target_id = n.id AND e.relation = 'IMPORTS') as imported_by
          FROM nodes n
          WHERE n.label = 'File'
            AND (SELECT COUNT(*) FROM edges e WHERE e.target_id = n.id AND e.relation = 'IMPORTS') = 0
            AND n.file_path NOT LIKE '%/test/%'
            AND n.file_path NOT LIKE '%/tests/%'
            AND n.file_path NOT LIKE '%.test.%'
            AND n.file_path NOT LIKE '%__tests__%'
            AND n.file_path NOT LIKE '%/spec/%'
            AND n.file_path NOT LIKE '%.spec.%'
            AND n.file_path NOT LIKE '%/index.%'
            AND n.file_path NOT LIKE 'bin/%'
            AND n.file_path NOT LIKE 'scripts/%'
            AND n.file_path NOT LIKE '%/cli.ts'
            AND n.file_path NOT LIKE '%/cli.js'
            AND n.file_path NOT LIKE '%/main.ts'
            AND n.file_path NOT LIKE '%/main.js'
            AND n.file_path NOT LIKE '%/dist/%'
            AND n.file_path NOT LIKE '%node_modules%'
          ORDER BY n.file_path
        `).all();
                const withOutbound = rows.filter((r) => r.imports_out > 0);
                const isolated = rows.filter((r) => r.imports_out === 0);
                result['orphan-files'] = {
                    count: withOutbound.length,
                    note: 'Files that import other modules but nothing imports them. May be lazy-loaded or dynamically imported — verify with grep.',
                    candidates: withOutbound.map((r) => ({ file: r.file_path, outboundImports: r.imports_out })),
                    ...(isolated.length > 0 ? {
                        isolated: {
                            count: isolated.length,
                            note: 'Files with zero edges in either direction — likely standalone scripts or entry points.',
                            files: isolated.map((r) => r.file_path),
                        },
                    } : {}),
                };
            }
            if (cats.includes('stale-dist')) {
                result['stale-dist'] = findStaleDist(repoPath);
            }
            return text(JSON.stringify(result, null, 2));
        }
        finally {
            db.close();
        }
    },
};
function findStaleDist(repoPath) {
    const { readdirSync, existsSync } = require('fs');
    const distSrc = join(repoPath, 'dist', 'src');
    const src = join(repoPath, 'src');
    // Scan a single package for stale dist artifacts
    const scanPkg = (pkgPath, pkgName) => {
        const pkgDistSrc = join(pkgPath, 'dist', 'src');
        const pkgSrc = join(pkgPath, 'src');
        if (!existsSync(pkgDistSrc) || !existsSync(pkgSrc))
            return null;
        const staleDirs = [];
        const staleFiles = [];
        let resourceForks = 0;
        try {
            const distDirs = readdirSync(pkgDistSrc, { withFileTypes: true })
                .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('._'));
            const srcDirs = new Set(readdirSync(pkgSrc, { withFileTypes: true })
                .filter(d => d.isDirectory() && !d.name.startsWith('.'))
                .map(d => d.name));
            for (const d of distDirs) {
                if (!srcDirs.has(d.name))
                    staleDirs.push(d.name);
            }
        }
        catch { /* skip */ }
        try {
            const distFiles = readdirSync(pkgDistSrc)
                .filter(f => f.endsWith('.js') && !f.startsWith('.') && !f.startsWith('._'));
            for (const f of distFiles) {
                const tsName = f.replace(/\.js$/, '.ts');
                if (!existsSync(join(pkgSrc, tsName)))
                    staleFiles.push(f);
            }
        }
        catch { /* skip */ }
        // Count macOS resource fork files
        const countRF = (dir) => {
            try {
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                    if (entry.name.startsWith('._'))
                        resourceForks++;
                    else if (entry.isDirectory())
                        countRF(join(dir, entry.name));
                }
            }
            catch { /* skip */ }
        };
        countRF(pkgDistSrc);
        if (staleDirs.length === 0 && staleFiles.length === 0 && resourceForks === 0)
            return null;
        return {
            package: pkgName,
            staleDirs,
            staleFiles,
            ...(resourceForks > 0 ? { macosResourceForks: resourceForks } : {}),
        };
    };
    // Single-package repo
    if (existsSync(distSrc) && existsSync(src)) {
        const finding = scanPkg(repoPath, '.');
        return {
            count: finding ? finding.staleDirs.length + finding.staleFiles.length : 0,
            note: 'Directories/files in dist/src/ with no corresponding source. Fix: rm -rf dist && npm run build.',
            ...(finding ? { findings: [finding] } : {}),
        };
    }
    // Monorepo: scan all packages
    const packagesDir = join(repoPath, 'packages');
    if (!existsSync(packagesDir))
        return { count: 0, note: 'No dist/src or packages/ found' };
    const findings = [];
    try {
        for (const scope of readdirSync(packagesDir, { withFileTypes: true })) {
            if (!scope.isDirectory())
                continue;
            const scopeDir = join(packagesDir, scope.name);
            if (scope.name.startsWith('@')) {
                for (const pkg of readdirSync(scopeDir, { withFileTypes: true })) {
                    if (!pkg.isDirectory())
                        continue;
                    const f = scanPkg(join(scopeDir, pkg.name), `${scope.name}/${pkg.name}`);
                    if (f)
                        findings.push(f);
                }
            }
            else {
                const f = scanPkg(scopeDir, scope.name);
                if (f)
                    findings.push(f);
            }
        }
    }
    catch { /* skip */ }
    return {
        count: findings.reduce((s, f) => s + (f.staleDirs?.length ?? 0) + (f.staleFiles?.length ?? 0), 0),
        note: 'Directories/files in dist/src/ with no corresponding source. Fix: rm -rf dist && npm run build.',
        findings,
    };
}
// ── monograph_agent_history ───────────────────────────────────────────────────
const monographAgentHistoryTool = {
    name: 'monograph_agent_history',
    description: 'Query past agent interactions by org, type, session, or time range. Returns rows ordered by timestamp descending.',
    inputSchema: {
        type: 'object',
        properties: {
            org_name: { type: 'string', description: 'Filter by org name' },
            agent_type: { type: 'string', description: 'Filter by agent type' },
            session_id: { type: 'string', description: 'Filter by session id' },
            since: { type: 'number', description: 'Unix timestamp (ms) — only interactions after this time' },
            limit: { type: 'number', description: 'Max rows to return (default 50)' },
        },
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const conditions = [];
            const params = {};
            if (typeof input.org_name === 'string') {
                conditions.push('org_name = @org_name');
                params.org_name = input.org_name;
            }
            if (typeof input.agent_type === 'string') {
                conditions.push('agent_type = @agent_type');
                params.agent_type = input.agent_type;
            }
            if (typeof input.session_id === 'string') {
                conditions.push('session_id = @session_id');
                params.session_id = input.session_id;
            }
            if (typeof input.since === 'number') {
                conditions.push('timestamp >= @since');
                params.since = input.since;
            }
            const MAX_LIMIT = 1_000;
            const rawLimit = input.limit ?? 50;
            const limit = Number.isFinite(rawLimit) && rawLimit > 0
                ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
                : 50;
            params.limit = limit;
            const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
            const sql = `SELECT * FROM agent_interactions ${where} ORDER BY timestamp DESC LIMIT @limit`;
            const rows = db.prepare(sql).all(params);
            if (rows.length === 0)
                return text('No agent interactions found.');
            return text(JSON.stringify(rows, null, 2));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_agent_patterns ──────────────────────────────────────────────────
const monographAgentPatternsTool = {
    name: 'monograph_agent_patterns',
    description: 'Aggregate agent interaction patterns: success rates, costs, and token usage grouped by agent type, org, or session.',
    inputSchema: {
        type: 'object',
        properties: {
            group_by: {
                type: 'string',
                description: "Column to group by: 'agent_type' | 'org_name' | 'session_id'",
            },
            since: { type: 'number', description: 'Unix timestamp (ms) — only interactions after this time' },
            min_count: { type: 'number', description: 'Minimum interaction count to include in results (default 2)' },
        },
        required: ['group_by'],
    },
    handler: async (input) => {
        const groupBy = input.group_by;
        const ALLOWED_GROUP_COLUMNS = new Set(['agent_type', 'org_name', 'session_id']);
        if (!ALLOWED_GROUP_COLUMNS.has(groupBy)) {
            return text(`Invalid group_by: ${groupBy}. Must be one of: agent_type, org_name, session_id`);
        }
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const params = {};
            const conditions = [];
            if (typeof input.since === 'number') {
                conditions.push('timestamp >= @since');
                params.since = input.since;
            }
            const minCount = typeof input.min_count === 'number' && input.min_count > 0
                ? Math.floor(input.min_count)
                : 2;
            params.min_count = minCount;
            const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
            const sql = `
        SELECT
          ${groupBy} AS group_key,
          COUNT(*) AS interaction_count,
          AVG(success) AS success_rate,
          SUM(tokens_in) AS total_tokens_in,
          SUM(tokens_out) AS total_tokens_out,
          SUM(cost_usd) AS total_cost_usd,
          AVG(duration_ms) AS avg_duration_ms
        FROM agent_interactions
        ${where}
        GROUP BY ${groupBy}
        HAVING COUNT(*) >= @min_count
        ORDER BY interaction_count DESC
      `;
            const rows = db.prepare(sql).all(params);
            if (rows.length === 0)
                return text('No agent interaction patterns found.');
            return text(JSON.stringify(rows, null, 2));
        }
        finally {
            closeDb(db);
        }
    },
};
// ── monograph_agent_record ────────────────────────────────────────────────────
const monographAgentRecordTool = {
    name: 'monograph_agent_record',
    description: 'Record an agent interaction (called by capture hooks).',
    inputSchema: {
        type: 'object',
        properties: {
            session_id: { type: 'string', description: 'Session id' },
            agent_type: { type: 'string', description: 'Agent type' },
            org_name: { type: 'string', description: 'Org name' },
            parent_agent: { type: 'string', description: 'Parent agent name/type, if spawned by another agent' },
            prompt_summary: { type: 'string', description: 'Short summary of the prompt given to the agent' },
            result_summary: { type: 'string', description: 'Short summary of the agent result' },
            tokens_in: { type: 'number', description: 'Input tokens consumed (default 0)' },
            tokens_out: { type: 'number', description: 'Output tokens produced (default 0)' },
            cost_usd: { type: 'number', description: 'Cost in USD (default 0)' },
            success: { type: 'boolean', description: 'Whether the interaction succeeded (default true)' },
            duration_ms: { type: 'number', description: 'Duration in milliseconds (default 0)' },
        },
        required: ['session_id', 'agent_type'],
    },
    handler: async (input) => {
        const { openDb, closeDb } = await import('@monoes/monograph');
        const db = openDb(getDbPath());
        try {
            const id = randomUUID();
            const timestamp = Date.now();
            db.prepare(`
        INSERT INTO agent_interactions (
          id, session_id, org_name, agent_type, parent_agent,
          prompt_summary, result_summary, tokens_in, tokens_out,
          cost_usd, success, duration_ms, timestamp
        ) VALUES (
          @id, @session_id, @org_name, @agent_type, @parent_agent,
          @prompt_summary, @result_summary, @tokens_in, @tokens_out,
          @cost_usd, @success, @duration_ms, @timestamp
        )
      `).run({
                id,
                session_id: input.session_id,
                org_name: input.org_name ?? null,
                agent_type: input.agent_type,
                parent_agent: input.parent_agent ?? null,
                prompt_summary: input.prompt_summary ?? null,
                result_summary: input.result_summary ?? null,
                tokens_in: input.tokens_in ?? 0,
                tokens_out: input.tokens_out ?? 0,
                cost_usd: input.cost_usd ?? 0,
                success: input.success === false ? 0 : 1,
                duration_ms: input.duration_ms ?? 0,
                timestamp,
            });
            return text(`Recorded agent interaction ${id} for ${input.agent_type} at ${timestamp}`);
        }
        finally {
            closeDb(db);
        }
    },
};
// Advanced tools are only exposed over MCP when MONOGRAPH_MCP_ADVANCED=1.
const ADVANCED = process.env['MONOGRAPH_MCP_ADVANCED'] === '1';
/** Default-exposed core tools (19). */
const coreMonographTools = [
    monographBuildTool,
    monographQueryTool,
    monographSuggestTool,
    monographImpactTool,
    monographContextTool,
    monographNeighborsTool,
    monographDeadCodeTool,
    monographStatsTool,
    monographHealthTool,
    monographAugmentTool,
    monographGodNodesTool,
    monographDetectChangesTool,
    monographGetNodeTool,
    monographApiImpactTool,
    monographRouteMapTool,
    monographStalenessTool,
    monographWatchTool,
    monographWatchStopTool,
    monographDoctorTool,
];
/** Advanced tools — gated behind MONOGRAPH_MCP_ADVANCED=1. */
const advancedMonographTools = [
    monographCypherTool,
    monographShortestPathTool,
    monographCommunityTool,
    monographSurprisesTool,
    monographShapeCheckTool,
    monographRenameTool,
    monographToolMapTool,
    monographServeTool,
    monographVisualizeTool,
    monographSnapshotTool,
    monographDiffTool,
    monographReportTool,
    monographExportTool,
    monographWikiTool,
    monographWikiBuildTool,
    monographSkillGenTool,
    monographInstallSkillsTool,
    monographInjectContextTool,
    monographGroupListTool,
    monographGroupQueryTool,
    monographGroupSyncTool,
    monographGroupContractsTool,
    monographGroupStatusTool,
    monographListReposTool,
    monographAgentHistoryTool,
    monographAgentPatternsTool,
    monographAgentRecordTool,
];
/**
 * Full tool list regardless of gating — used by the graphify compat shims,
 * which must resolve targets (e.g. monograph_community) even when the
 * advanced set is not exposed over MCP.
 */
export const allMonographTools = [...coreMonographTools, ...advancedMonographTools];
export const monographTools = ADVANCED ? allMonographTools : coreMonographTools;
//# sourceMappingURL=monograph-tools.js.map