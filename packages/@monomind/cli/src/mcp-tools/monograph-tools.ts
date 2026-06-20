/**
 * Monograph MCP Tools
 *
 * Native TypeScript code intelligence — replaces Python graphify.
 * All monograph_* tools are backed by @monoes/monograph package.
 */

import { join, resolve, sep } from 'path';
import type { MCPTool } from './types.js';
import { getProjectCwd } from './types.js';

function getDbPath(): string {
  return join(getProjectCwd(), '.monomind', 'monograph.db');
}

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

// ── monograph_build ───────────────────────────────────────────────────────────

const monographBuildTool: MCPTool = {
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
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    let progressLog = '';
    await buildAsync(repoPath, {
      codeOnly: (input.codeOnly as boolean | undefined) ?? false,
      force: (input.force as boolean | undefined) ?? false,
      incremental: (input.incremental as boolean | undefined) ?? false,
      onProgress: (p) => { progressLog += `[${p.phase}] ${p.message ?? ''}\n`; },
    });
    const skipped = progressLog.includes('skipping rebuild');
    const summary = skipped ? `Index was already fresh — no rebuild needed for ${repoPath}` : `Monograph build complete for ${repoPath}`;
    return text(`${summary}\n${progressLog}`);
  },
};

// ── monograph_query ───────────────────────────────────────────────────────────

const monographQueryTool: MCPTool = {
  name: 'monograph_query',
  description: 'BM25 keyword search across the code knowledge graph. When MONOGRAPH_EMBEDDINGS=true uses hybrid BM25+vector ranking (RRF). Returns nodes with file path and line number.',
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
    const { hybridQuery } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      // Cap limit: passed directly to SQLite queries and hybridQuery; an
      // unlimited value saturates memory with rows.
      const MAX_QUERY_LIMIT = 1_000;
      const rawLimit = (input.limit as number | undefined) ?? 20;
      const limit = Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), MAX_QUERY_LIMIT)
        : 20;
      // Cap query: passed to FTS5 and hybridQuery; very long queries waste
      // parse time and can stress the FTS tokenizer.
      const MAX_MONOGRAPH_QUERY_LEN = 16 * 1024;
      const rawQuery = input.query as string;
      const query = typeof rawQuery === 'string' && rawQuery.length > MAX_MONOGRAPH_QUERY_LEN
        ? rawQuery.slice(0, MAX_MONOGRAPH_QUERY_LEN)
        : rawQuery;
      const label = input.label as string | undefined;

      if (process.env['MONOGRAPH_EMBEDDINGS'] === 'true') {
        const results = await hybridQuery(db, query, { limit, label });
        if (results.length === 0) return text('No results found.');
        const lines = results.map(r => {
          const loc = r.filePath ? (r.startLine != null ? `${r.filePath}:${r.startLine}` : r.filePath) : '';
          return `[${r.label ?? '?'}] ${r.name ?? r.id}  ${loc}  (score: ${r.score.toFixed(4)})`;
        });
        return text(lines.join('\n'));
      }

      const results = ftsSearch(db, query, limit, label);
      if (results.length === 0) return text('No results found.');
      const lines = results.map(r => {
        const loc = r.filePath ? (r.startLine != null ? `${r.filePath}:${r.startLine}` : r.filePath) : '';
        return `[${r.label}] ${r.name}  ${loc}  (score: ${r.rank.toFixed(3)})`;
      });
      return text(lines.join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_stats ───────────────────────────────────────────────────────────

const monographStatsTool: MCPTool = {
  name: 'monograph_stats',
  description: 'Show node/edge/community counts and index freshness.',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const { openDb, closeDb, countNodes, countEdges } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const nodes = countNodes(db);
      const edges = countEdges(db);
      const meta = db.prepare('SELECT key, value FROM index_meta').all() as { key: string; value: string }[];
      const metaStr = meta.map(m => `  ${m.key}: ${m.value}`).join('\n');
      return text(`Monograph index stats:\n  nodes: ${nodes}\n  edges: ${edges}\n${metaStr}`);
    } finally { closeDb(db); }
  },
};

// ── monograph_health ──────────────────────────────────────────────────────────

const monographHealthTool: MCPTool = {
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
      const meta = (
        db.prepare("SELECT value FROM index_meta WHERE key = 'last_commit_hash'").get() as { value: string } | undefined
      ) ?? (
        db.prepare("SELECT value FROM index_meta WHERE key = 'lastCommit'").get() as { value: string } | undefined
      );
      const lastCommit = meta?.value ?? null;
      if (!lastCommit) return text('Index has never been built. Run monograph_build first.');
      if (!/^[0-9a-f]{7,40}$/i.test(lastCommit)) {
        return text('Index metadata is corrupt: invalid commit SHA. Run monograph_build to re-index.');
      }

      let commitsBehind = 0;
      try {
        const out = execSync(`git rev-list --count ${lastCommit}..HEAD`, {
          cwd: getProjectCwd(), encoding: 'utf-8'
        }).trim();
        commitsBehind = parseInt(out, 10);
      } catch { return text('Cannot check staleness: git error'); }

      const status = commitsBehind === 0 ? 'FRESH' : `STALE (${commitsBehind} commits behind)`;
      return text(`Index status: ${status}\nLast indexed commit: ${lastCommit}`);
    } finally { closeDb(db); }
  },
};

// ── monograph_god_nodes ───────────────────────────────────────────────────────

const monographGodNodesTool: MCPTool = {
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
      // Cap limit: passed directly to the SQL LIMIT clause.
      const MAX_GOD_NODES_LIMIT = 1_000;
      const rawGodLimit = (input.limit as number | undefined) ?? 20;
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
      `).all(...excluded, limit) as any[];

      if (rows.length === 0) return text('No god nodes found. Run monograph_build first.');
      const lines = rows.map(r => {
        const loc = r.file_path ? (r.start_line != null ? `${r.file_path}:${r.start_line}` : r.file_path) : '';
        return `[${r.label}] ${r.name}  degree=${r.degree} (↑${r.out_degree} ↓${r.in_degree})  ${loc}`;
      });
      return text(lines.join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_get_node ────────────────────────────────────────────────────────

const monographGetNodeTool: MCPTool = {
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
      let node = getNode(db, input.id as string);
      if (!node) {
        const row = db.prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1').get(input.id) as any;
        if (row) node = row;
      }
      if (!node) return text(`Node not found: ${input.id}`);
      return text(JSON.stringify(node, null, 2));
    } finally { closeDb(db); }
  },
};

// ── monograph_shortest_path ───────────────────────────────────────────────────

const monographShortestPathTool: MCPTool = {
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
      const path = getShortestPath(db, input.source as string, input.target as string, (input.maxDepth as number | undefined) ?? 6);
      if (!path) return text(`No path found between ${input.source} and ${input.target}`);
      // Enrich each node ID with file:line for direct LLM navigation
      const enriched = path.map(nodeId => {
        const row = db.prepare('SELECT label, name, file_path, start_line FROM nodes WHERE id = ? OR name = ? LIMIT 1').get(nodeId, nodeId) as any;
        if (!row) return nodeId;
        const loc = row.file_path ? (row.start_line != null ? `${row.file_path}:${row.start_line}` : row.file_path) : '';
        return loc ? `${row.name ?? nodeId}  [${loc}]` : (row.name ?? nodeId);
      });
      return text(`Path (${path.length - 1} hops):\n${enriched.join(' → ')}`);
    } finally { closeDb(db); }
  },
};

// ── monograph_community ───────────────────────────────────────────────────────

const monographCommunityTool: MCPTool = {
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
      const rows = db.prepare('SELECT id, label, name, file_path, start_line FROM nodes WHERE community_id = ?').all(communityId) as any[];
      if (rows.length === 0) return text(`No nodes in community ${communityId}`);
      return text(rows.map(r => {
        const loc = r.file_path ? (r.start_line != null ? `${r.file_path}:${r.start_line}` : r.file_path) : '';
        return `[${r.label}] ${r.name}  ${loc}`;
      }).join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_surprises ───────────────────────────────────────────────────────

const monographSurprisesTool: MCPTool = {
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
      const rawSurprisesLimit = (input.limit as number | undefined) ?? 20;
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
      `).all(limit) as any[];
      if (rows.length === 0) return text('No surprising connections found.');
      return text(rows.map(r => {
        const srcLoc = r.src_file ? (r.src_line != null ? `${r.src_file}:${r.src_line}` : r.src_file) : '';
        const tgtLoc = r.tgt_file ? (r.tgt_line != null ? `${r.tgt_file}:${r.tgt_line}` : r.tgt_file) : '';
        const locHint = srcLoc || tgtLoc ? `  [${srcLoc}${tgtLoc ? ` → ${tgtLoc}` : ''}]` : '';
        return `[${r.confidence}] ${r.src_name} --${r.relation}--> ${r.tgt_name} (score: ${r.confidence_score})${locHint}`;
      }).join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_suggest ─────────────────────────────────────────────────────────

const monographSuggestTool: MCPTool = {
  name: 'monograph_suggest',
  description: 'Get graph-topology-derived questions to explore the codebase. Pass task= to score by task relevance. When MONOGRAPH_EMBEDDINGS=true uses semantic search for task relevance.',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Optional task description for task-relevance scoring' },
      limit: { type: 'number', description: 'Max questions (default 10)' },
    },
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { hybridQuery } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      // Cap limit and task: limit is passed directly to SQL LIMIT clause;
      // task is forwarded to hybridQuery (embedding path) or FTS.
      const MAX_SUGGEST_LIMIT = 1_000;
      const MAX_SUGGEST_TASK_LEN = 16 * 1024;
      const rawSuggestLimit = (input.limit as number | undefined) ?? 10;
      const limit = Number.isFinite(rawSuggestLimit) && rawSuggestLimit > 0
        ? Math.min(Math.floor(rawSuggestLimit), MAX_SUGGEST_LIMIT)
        : 10;
      const rawTask = (input.task as string | undefined) ?? '';
      const task = typeof rawTask === 'string' && rawTask.length > MAX_SUGGEST_TASK_LEN
        ? rawTask.slice(0, MAX_SUGGEST_TASK_LEN)
        : rawTask;

      // Format a suggestion row as a navigable string for LLM consumption.
      // Includes file:line references so the LLM can jump directly to the code.
      const formatSuggestion = (r: any): string => {
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
          return text('No suggestions for this task. Run monograph_build first or try a different query.');
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
        `).all(...[...hitIds], ...[...hitIds]) as any[];

        const questions = rows.map(formatSuggestion);
        return text(questions.slice(0, limit).join('\n') || 'No suggestions for this task. Run monograph_build first.');
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
      `).all() as any[];

      let scored = rows.map(r => ({
        q: formatSuggestion(r),
        relevance: task ? taskRelevance(task, r.src + ' ' + r.tgt + ' ' + (r.src_file ?? '')) : 0,
      }));

      if (task) scored = scored.sort((a, b) => b.relevance - a.relevance);

      return text(scored.slice(0, limit).map(s => s.q).join('\n') || 'No suggestions. Run monograph_build first.');
    } finally { closeDb(db); }
  },
};

function taskRelevance(task: string, nodeText: string): number {
  const taskTerms = task.toLowerCase().split(/\s+/);
  const txt = nodeText.toLowerCase();
  return taskTerms.filter(t => txt.includes(t)).length / taskTerms.length;
}

// ── monograph_visualize ───────────────────────────────────────────────────────

const monographVisualizeTool: MCPTool = {
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
      // Cap maxNodes: passed to SQL LIMIT clause for both nodes (n) and edges
      // (n*3).  Without a cap an attacker requests all rows from both tables.
      const MAX_EXPORT_NODES = 10_000;
      const rawMaxNodes = (input.maxNodes as number | undefined) ?? 500;
      const limit = Number.isFinite(rawMaxNodes) && rawMaxNodes > 0
        ? Math.min(Math.floor(rawMaxNodes), MAX_EXPORT_NODES)
        : 500;
      const nodes = db.prepare('SELECT * FROM nodes LIMIT ?').all(limit) as any[];
      const edges = db.prepare('SELECT * FROM edges LIMIT ?').all(limit * 3) as any[];
      const fmt = (input.format as string | undefined) ?? 'html';
      if (fmt === 'json') return text(toJson(nodes as any, edges as any));
      if (fmt === 'svg') return text(toSvg(nodes as any, edges as any));
      return text(toHtml(nodes as any, edges as any));
    } finally { closeDb(db); }
  },
};

// ── monograph_watch ───────────────────────────────────────────────────────────

const monographWatchTool: MCPTool = {
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
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    const watcher = new MonographWatcher(repoPath);
    watcher.on('monograph:updated', (_paths: string[]) => {
      import('@monoes/monograph').then(({ buildAsync }) => buildAsync(repoPath)).catch(() => {});
    });
    await watcher.start();
    return text(`Monograph watcher started for ${repoPath}. Watching for file changes...`);
  },
};

// ── monograph_watch_stop ──────────────────────────────────────────────────────

const monographWatchStopTool: MCPTool = {
  name: 'monograph_watch_stop',
  description: 'Stop the Monograph file watcher.',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    return text('Watcher stop requested. (Restart MCP server to fully clear watchers.)');
  },
};

// ── monograph_report ──────────────────────────────────────────────────────────

const monographReportTool: MCPTool = {
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
      `).all() as any[];

      const report = [
        '# Graph Report\n',
        `**Generated:** ${new Date().toISOString()}`,
        `**Nodes:** ${nodeCount}  **Edges:** ${edgeCount}\n`,
        '## Top 10 Most Connected Entities\n',
        ...topNodes.map((n: any, i: number) => {
          const loc = n.file_path ? (n.start_line != null ? `${n.file_path}:${n.start_line}` : n.file_path) : '';
          return `${i + 1}. **${n.name}** (${n.label}) — degree ${n.degree}${loc ? `  \`${loc}\`` : ''}`;
        }),
      ].join('\n');

      const outPath = resolve((input.path as string | undefined) ?? join(getProjectCwd(), '.monomind', 'GRAPH_REPORT.md'));
      const allowedRoot = resolve(getProjectCwd());
      if (outPath !== allowedRoot && !outPath.startsWith(allowedRoot + sep)) {
        return text(`Error: path must be within the project directory (${allowedRoot})`);
      }
      mkdirSync(join(outPath, '..'), { recursive: true });
      writeFileSync(outPath, report);
      return text(`${report}\n\nReport written to ${outPath}`);
    } finally { closeDb(db); }
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
async function computeCommitsBehind(repoPath: string): Promise<{ commitsBehind: number; lastCommit: string } | null> {
  const { openDb, closeDb } = await import('@monoes/monograph');
  const { execSync } = await import('child_process');
  const db = openDb(join(repoPath, '.monomind', 'monograph.db'));
  try {
    const meta = (
      db.prepare("SELECT value FROM index_meta WHERE key = 'last_commit_hash'").get() as { value: string } | undefined
    ) ?? (
      db.prepare("SELECT value FROM index_meta WHERE key = 'lastCommit'").get() as { value: string } | undefined
    );
    const lastCommit = meta?.value ?? null;
    if (!lastCommit || !/^[0-9a-f]{7,40}$/i.test(lastCommit)) return null;
    try {
      const out = execSync(`git rev-list --count ${lastCommit}..HEAD`, {
        cwd: repoPath, encoding: 'utf-8',
      }).trim();
      return { commitsBehind: parseInt(out, 10), lastCommit };
    } catch { return null; }
  } finally { closeDb(db); }
}

/**
 * Shared staleness threshold: both monograph_staleness and monograph_suggest_auto
 * trigger a background rebuild only when the index is more than this many commits behind HEAD.
 * Using a shared constant prevents conflicting rebuild pressure during active dev sessions.
 */
const STALENESS_THRESHOLD = 10;

/**
 * Fire-and-forget background rebuild. Uses a module-level guard so concurrent
 * MCP tool calls (e.g. repeated monograph_suggest_auto) don't pile up builds.
 * threshold: minimum commitsBehind to trigger (default STALENESS_THRESHOLD + 1).
 */
function triggerBackgroundBuildIfNeeded(repoPath: string, commitsBehind: number, threshold = STALENESS_THRESHOLD + 1): boolean {
  if (commitsBehind < threshold) return false;
  if (_buildInProgress) return false;
  _buildInProgress = true;
  void import('@monoes/monograph')
    .then(({ buildAsync }) => buildAsync(repoPath, { codeOnly: true }))
    .catch(() => {})
    .finally(() => { _buildInProgress = false; });
  return true;
}

// ── monograph_staleness ───────────────────────────────────────────────────────

const monographStalenessTool: MCPTool = {
  name: 'monograph_staleness',
  description: 'Git staleness detection: compares the commit hash at last index build against current HEAD. When the index is more than 10 commits behind HEAD it automatically triggers a background rebuild. Returns { commitsBehind, status, triggered }.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the repo (defaults to project cwd)' },
    },
  },
  handler: async (input) => {
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    const result = await computeCommitsBehind(repoPath);

    if (!result) {
      return text(JSON.stringify({ commitsBehind: 0, status: 'unknown', triggered: false }));
    }

    const { commitsBehind } = result;
    const triggered = triggerBackgroundBuildIfNeeded(repoPath, commitsBehind, STALENESS_THRESHOLD + 1);
    const status: 'fresh' | 'stale' | 'building' =
      triggered ? 'building' : commitsBehind === 0 ? 'fresh' : 'stale';

    return text(JSON.stringify({ commitsBehind, status, triggered }));
  },
};

// ── monograph_snapshot ────────────────────────────────────────────────────────

const monographSnapshotTool: MCPTool = {
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
      const rawName = (input.name as string | undefined) ?? new Date().toISOString().replace(/[:.]/g, '-');
      const SAFE_NAME_RE = /^[a-zA-Z0-9_.\-]+$/;
      if (!SAFE_NAME_RE.test(rawName)) return text(`Invalid snapshot name: ${rawName}`);
      const snapshotDir = resolvePath(join(getProjectCwd(), '.monomind', 'snapshots'));
      mkdirSync(snapshotDir, { recursive: true });
      const outPath = join(snapshotDir, `${rawName}.json`);
      if (!resolvePath(outPath).startsWith(snapshotDir)) return text(`Path traversal detected in snapshot name`);
      writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
      return text(`Snapshot saved: ${outPath}\n  nodes: ${snapshot.nodes.length}  edges: ${snapshot.edges.length}`);
    } finally { closeDb(db); }
  },
};

// ── monograph_diff ────────────────────────────────────────────────────────────

const monographDiffTool: MCPTool = {
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
    const beforeName = input.before as string;
    if (!SAFE_SNAPSHOT_NAME.test(beforeName)) return text(`Invalid snapshot name: ${beforeName}`);
    const beforePath = join(snapshotDir, `${beforeName}.json`);
    if (!resolvePath(beforePath).startsWith(snapshotDir)) return text(`Path traversal detected in snapshot name`);
    if (!existsSync(beforePath)) {
      return text(`Snapshot not found: ${beforePath}\nCreate one first with monograph_snapshot.`);
    }
    if (statSyncSnap(beforePath).size > MAX_SNAPSHOT_BYTES) {
      return text(`Snapshot too large to diff: ${beforePath}`);
    }
    const before = JSON.parse(readFileSync(beforePath, 'utf-8'));
    let after;
    if (input.after) {
      const afterName = input.after as string;
      if (!SAFE_SNAPSHOT_NAME.test(afterName)) return text(`Invalid snapshot name: ${afterName}`);
      const afterPath = join(snapshotDir, `${afterName}.json`);
      if (!resolvePath(afterPath).startsWith(snapshotDir)) return text(`Path traversal detected in snapshot name`);
      if (!existsSync(afterPath)) return text(`Snapshot not found: ${afterPath}`);
      if (statSyncSnap(afterPath).size > MAX_SNAPSHOT_BYTES) return text(`Snapshot too large to diff: ${afterPath}`);
      after = JSON.parse(readFileSync(afterPath, 'utf-8'));
    } else {
      const db = openDb(getDbPath());
      try { after = snapshotFromDb(db); } finally { closeDb(db); }
    }
    const diff = diffSnapshots(before, after);

    // Build id→{name,filePath,startLine} index from both snapshots so edge IDs can be
    // resolved to human-readable symbol names and file:line hints in the diff output.
    // The merged snapshot is the union of before+after nodes — covers all referenced IDs.
    type NodeRef = { name: string; filePath?: string | null; startLine?: number | null };
    const nodeById = new Map<string, NodeRef>();
    const indexNodes = (nodes: NodeRef & { id?: string }[]) => {
      for (const n of nodes) { if (n.id) nodeById.set(n.id as string, n); }
    };
    indexNodes(before.nodes as unknown as (NodeRef & { id?: string })[]);
    indexNodes(after.nodes as unknown as (NodeRef & { id?: string })[]);

    const resolveEdgeEnd = (id: string): string => {
      const ref = nodeById.get(id);
      if (!ref) return id; // fallback to raw id if not found
      const loc = ref.filePath ? (ref.startLine != null ? `${ref.filePath}:${ref.startLine}` : ref.filePath) : '';
      return loc ? `${ref.name}  [${loc}]` : ref.name;
    };

    const section = (label: string, items: string[]) =>
      items.length > 0 ? `\n${label} (${items.length}):\n${items.slice(0, 10).join('\n')}${items.length > 10 ? `\n  … ${items.length - 10} more` : ''}` : '';

    const formatNode = (n: { label?: string; name?: string; filePath?: string | null; startLine?: number | null }) => {
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

const monographExportTool: MCPTool = {
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
      const nodes = db.prepare('SELECT * FROM nodes').all() as any[];
      const edges = db.prepare('SELECT * FROM edges').all() as any[];
      const fmt = input.format as string;
      const requestedOut = (input.outputPath as string | undefined) ?? join(getProjectCwd(), '.monomind', 'export');
      const outDir = resolve(requestedOut);
      const allowedRoot = resolve(getProjectCwd());
      if (outDir !== allowedRoot && !outDir.startsWith(allowedRoot + sep)) {
        return text(`Error: outputPath must be within the project directory (${allowedRoot})`);
      }
      mkdirSync(outDir, { recursive: true });

      if (fmt === 'json') {
        const p = join(outDir, 'graph.json');
        writeFileSync(p, toJson(nodes as any, edges as any));
        return text(`Exported JSON to ${p}`);
      }
      if (fmt === 'svg') {
        const p = join(outDir, 'graph.svg');
        writeFileSync(p, toSvg(nodes as any, edges as any));
        return text(`Exported SVG to ${p}`);
      }
      if (fmt === 'graphml') {
        const p = join(outDir, 'graph.graphml');
        writeFileSync(p, toGraphml(nodes as any, edges as any));
        return text(`Exported GraphML to ${p}`);
      }
      if (fmt === 'cypher') {
        const p = join(outDir, 'graph.cypher');
        writeFileSync(p, toCypher(nodes as any, edges as any));
        return text(`Exported Cypher to ${p}`);
      }
      return text(`Format ${fmt} export written to ${outDir}`);
    } finally { closeDb(db); }
  },
};

// ── monograph_context ─────────────────────────────────────────────────────────

const monographContextTool: MCPTool = {
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
      const rawCtxName = input.name as string;
      const ctxName = typeof rawCtxName === 'string' && rawCtxName.length > MAX_CTX_NAME_LEN
        ? rawCtxName.slice(0, MAX_CTX_NAME_LEN) : rawCtxName;
      const rawCtxPath = input.filePath as string | undefined;
      const ctxPath = typeof rawCtxPath === 'string' && rawCtxPath.length > MAX_CTX_PATH_LEN
        ? rawCtxPath.slice(0, MAX_CTX_PATH_LEN) : rawCtxPath;
      const result = getMonographContext(db, {
        name: ctxName,
        filePath: ctxPath,
      });
      if (!result || !result.node) return text(`No symbol found: ${ctxName}`);

      // Format context as structured text for direct LLM consumption
      const n = result.node as any;
      const loc = n.filePath ? (n.startLine != null ? `${n.filePath}:${n.startLine}` : n.filePath) : '';
      const lines: string[] = [
        `[${n.label ?? '?'}] ${n.name}  ${loc}`,
        '',
      ];

      const formatNodes = (nodes: any[], label: string) => {
        if (!Array.isArray(nodes) || nodes.length === 0) return;
        lines.push(`${label} (${nodes.length}):`);
        for (const node of nodes.slice(0, 20)) {
          const fp = node.filePath ?? node.file_path ?? '';
          const ln = node.startLine ?? node.start_line;
          const nodeLoc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
          lines.push(`  [${node.label ?? '?'}] ${node.name ?? node.id}  ${nodeLoc}`);
        }
        if (nodes.length > 20) lines.push(`  … ${nodes.length - 20} more`);
        lines.push('');
      };

      formatNodes(result.callers as any, 'Callers');
      formatNodes(result.callees as any, 'Callees');
      formatNodes(result.imports as any, 'Imports');
      formatNodes(result.importedBy as any, 'ImportedBy');

      if (result.community != null) lines.push(`Community: ${result.community}`);
      if ((result as any).communityName) lines.push(`Community name: ${(result as any).communityName}`);

      return text(lines.join('\n').trim());
    } finally { closeDb(db); }
  },
};

// ── monograph_impact ──────────────────────────────────────────────────────────

const monographImpactTool: MCPTool = {
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
      const rawImpactName = input.name as string;
      const impactName = typeof rawImpactName === 'string' && rawImpactName.length > MAX_IMPACT_NAME_LEN
        ? rawImpactName.slice(0, MAX_IMPACT_NAME_LEN) : rawImpactName;
      const rawImpactPath = input.filePath as string | undefined;
      const impactPath = typeof rawImpactPath === 'string' && rawImpactPath.length > MAX_IMPACT_PATH_LEN
        ? rawImpactPath.slice(0, MAX_IMPACT_PATH_LEN) : rawImpactPath;
      const rawDepth = input.depth as number | undefined;
      const depth = typeof rawDepth === 'number' && Number.isFinite(rawDepth) && rawDepth > 0
        ? Math.min(Math.floor(rawDepth), 6) : rawDepth;
      const result = getMonographImpact(db, {
        name: impactName,
        filePath: impactPath,
        depth,
      });
      if (!result || !result.root) return text(`No symbol found: ${impactName}`);

      // Format impact as structured text for direct LLM consumption
      const root = result.root as any;
      const rootLoc = root.filePath ? (root.startLine != null ? `${root.filePath}:${root.startLine}` : root.filePath) : '';
      const lines: string[] = [
        `[${root.label ?? '?'}] ${root.name}  ${rootLoc}`,
        '',
        `Blast radius: ${result.totalAffected ?? 0} symbols affected`,
      ];

      if (result.riskScore != null) {
        const riskLabel = (result.riskScore as number) >= 0.8 ? 'HIGH' : (result.riskScore as number) >= 0.5 ? 'MEDIUM' : 'LOW';
        lines.push(`Risk score: ${(result.riskScore as number).toFixed(2)} (${riskLabel})`);
      }
      lines.push('');

      const affected = (result.affected ?? result.callers ?? []) as any[];
      if (affected.length > 0) {
        lines.push(`Affected callers (${affected.length}):`);
        for (const sym of affected.slice(0, 20)) {
          const fp = sym.filePath ?? sym.file_path ?? '';
          const ln = sym.startLine ?? sym.start_line;
          const symLoc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
          const depth_marker = sym.depth != null ? ` [depth ${sym.depth}]` : '';
          lines.push(`  [${sym.label ?? '?'}] ${sym.name ?? sym.id}  ${symLoc}${depth_marker}`);
        }
        if (affected.length > 20) lines.push(`  … ${affected.length - 20} more`);
      }

      return text(lines.join('\n').trim());
    } finally { closeDb(db); }
  },
};

// ── monograph_detect_changes ──────────────────────────────────────────────────

const monographDetectChangesTool: MCPTool = {
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
        baseBranch: input.baseBranch as string | undefined,
        includeTests: input.includeTests as boolean | undefined,
      }, getProjectCwd());

      // Format as structured text for direct LLM navigation instead of raw JSON
      const r = result as any;
      if (!r || (!r.changedFiles?.length && !r.affectedSymbols?.length)) {
        return text('No changed files found relative to the base branch.');
      }
      const lines: string[] = [];
      const base = r.baseBranch ?? 'main';
      const changedFiles: string[] = r.changedFiles ?? [];
      lines.push(`Changed files vs ${base}: ${changedFiles.length}`);
      if (changedFiles.length > 0) {
        for (const f of changedFiles.slice(0, 20)) lines.push(`  ${f}`);
        if (changedFiles.length > 20) lines.push(`  … ${changedFiles.length - 20} more`);
      }
      lines.push('');
      const affected: any[] = r.affectedSymbols ?? r.affected ?? [];
      if (affected.length > 0) {
        lines.push(`Affected symbols (${affected.length}):`);
        for (const sym of affected.slice(0, 30)) {
          const fp = sym.filePath ?? sym.file_path ?? '';
          const ln = sym.startLine ?? sym.start_line;
          const loc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
          lines.push(`  [${sym.label ?? '?'}] ${sym.name ?? sym.id}  ${loc}`);
        }
        if (affected.length > 30) lines.push(`  … ${affected.length - 30} more`);
      }
      return text(lines.join('\n').trim());
    } finally { closeDb(db); }
  },
};

// ── monograph_rename ──────────────────────────────────────────────────────────

const monographRenameTool: MCPTool = {
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
        oldName: input.oldName as string,
        newName: input.newName as string,
        filePath: input.filePath as string | undefined,
        dryRun: (input.dryRun as boolean | undefined) ?? true,
      });

      // Format as structured text for direct LLM navigation instead of raw JSON
      const rn = result as any;
      if (!rn) return text(`Symbol not found: ${input.oldName as string}`);
      const occurrences: any[] = rn.occurrences ?? rn.references ?? [];
      const lines: string[] = [
        `Rename: ${input.oldName as string} → ${input.newName as string}  (dry-run)`,
        `Occurrences: ${occurrences.length}`,
        '',
      ];
      for (const occ of occurrences.slice(0, 30)) {
        const fp = occ.filePath ?? occ.file_path ?? '';
        const ln = occ.line ?? occ.startLine ?? occ.start_line;
        const loc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
        lines.push(`  ${loc || occ}`);
      }
      if (occurrences.length > 30) lines.push(`  … ${occurrences.length - 30} more`);
      return text(lines.join('\n').trim());
    } finally { closeDb(db); }
  },
};

// ── monograph_route_map ───────────────────────────────────────────────────────

const monographRouteMapTool: MCPTool = {
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
        prefix: input.prefix as string | undefined,
        method: input.method as string | undefined,
        includeMiddleware: input.includeMiddleware as boolean | undefined,
      });
      if (result.routes.length === 0) return text('No routes found. Run monograph_build first or adjust your filters.');
      const lines = [`Routes (${result.total} total):`];
      for (const r of result.routes) {
        const loc = r.handlerFile
          ? (r.handlerLine != null ? `${r.handlerFile}:${r.handlerLine}` : r.handlerFile)
          : '';
        const mw = r.middlewareChain.length > 0 ? `  middleware: ${r.middlewareChain.join(' → ')}` : '';
        lines.push(`  ${r.method} ${r.path}${r.handlerName ? ` → ${r.handlerName}` : ''}${loc ? `  (${loc})` : ''}${mw}`);
      }
      return text(lines.join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_api_impact ──────────────────────────────────────────────────────

const monographApiImpactTool: MCPTool = {
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
        routePath: input.routePath as string,
        method: input.method as string | undefined,
      });
      if (!result.route) return text(`Route not found: ${input.routePath as string}. Run monograph_build or check the path.`);
      const riskLabel = result.riskScore >= 0.7 ? 'HIGH' : result.riskScore >= 0.4 ? 'MEDIUM' : 'LOW';
      const lines: string[] = [
        `Route: ${result.route.method} ${result.route.path}  risk=${riskLabel} (${result.riskScore.toFixed(2)})`,
      ];
      if (result.handler) {
        const hLoc = result.handler.filePath
          ? (result.handler.startLine != null ? `${result.handler.filePath}:${result.handler.startLine}` : result.handler.filePath)
          : '';
        lines.push(`Handler: ${result.handler.name}${hLoc ? `  ${hLoc}` : ''}`);
      }
      if (result.callees.length > 0) {
        lines.push(`Callees (${result.callees.length}):`)
        for (const c of result.callees.slice(0, 15)) {
          const loc = c.node.filePath
            ? (c.node.startLine != null ? `${c.node.filePath}:${c.node.startLine}` : c.node.filePath)
            : '';
          lines.push(`  ${'  '.repeat(c.depth)}→ ${c.node.name} [${c.node.label}]${loc ? `  ${loc}` : ''}`);
        }
        if (result.callees.length > 15) lines.push(`  … ${result.callees.length - 15} more`);
      }
      if (result.affectedProcesses.length > 0) {
        lines.push(`Affected processes: ${result.affectedProcesses.map(p => p.name).join(', ')}`);
      }
      return text(lines.join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_embed ───────────────────────────────────────────────────────────

const monographEmbedTool: MCPTool = {
  name: 'monograph_embed',
  description: 'Embed all symbol nodes using Snowflake/snowflake-arctic-embed-xs (384D). Requires @huggingface/transformers. Enables hybrid BM25+vector search via MONOGRAPH_EMBEDDINGS=true.',
  inputSchema: {
    type: 'object',
    properties: {
      codeOnly: { type: 'boolean', description: 'Only embed code symbol nodes (Functions, Classes, Methods), skip Document/Route/Tool nodes (default: false)' },
      force: { type: 'boolean', description: 'Re-embed all nodes even if embeddings already exist (default: false)' },
    },
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { runEmbed } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = await runEmbed(db, { codeOnly: (input.codeOnly as boolean | undefined) ?? false, force: (input.force as boolean | undefined) ?? false });
      return text(
        `Embedding complete.\n  model: ${result.model}\n  embedded: ${result.embedded}\n  skipped: ${result.skipped}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return text(`Embedding failed: ${msg}`);
    } finally { closeDb(db); }
  },
};

// ── monograph_cypher ──────────────────────────────────────────────────────────

const monographCypherTool: MCPTool = {
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
      const rawCypherQuery = input.query as string;
      const cypherQuery = typeof rawCypherQuery === 'string' && rawCypherQuery.length > MAX_CYPHER_QUERY_LEN
        ? rawCypherQuery.slice(0, MAX_CYPHER_QUERY_LEN)
        : rawCypherQuery;
      const result = getMonographCypher(db, cypherQuery);
      if (result.error) return text(`Error: ${result.error}`);
      if (result.rows.length === 0) return text('No results found.');
      const header = Object.keys(result.rows[0]).join('\t');
      const lines = result.rows.map(r => Object.values(r).join('\t'));
      return text([header, ...lines, `\n(${result.rows.length} rows, ${result.queryTime}ms)`].join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_group_list ──────────────────────────────────────────────────────

const monographGroupListTool: MCPTool = {
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
    const configPath = (input.configPath as string | undefined) ?? join(getProjectCwd(), 'group.yaml');
    const result = await getGroupList(configPath);
    if (!result.repos || result.repos.length === 0) {
      return text(`Group: ${result.group?.name ?? 'unknown'}\nNo repos configured. Check ${configPath}`);
    }
    const lines = [`Group: ${result.group?.name ?? 'unknown'}  (${result.repos.length} repos)`];
    for (const r of result.repos) {
      const indexed = r.indexedAt ? r.indexedAt.slice(0, 10) : 'never';
      lines.push(`  ${r.name}  nodes=${r.nodeCount}  indexed=${indexed}  ${r.path}`);
    }
    return text(lines.join('\n'));
  },
};

// ── monograph_group_query ─────────────────────────────────────────────────────

const monographGroupQueryTool: MCPTool = {
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
    const configPath = (input.configPath as string | undefined) ?? join(getProjectCwd(), 'group.yaml');
    // Cap query and limit forwarded to runGroupQuery.
    const MAX_GROUP_QUERY_LEN = 16 * 1024;
    const MAX_GROUP_LIMIT = 1_000;
    const rawGroupQuery = input.query as string;
    const groupQuery = typeof rawGroupQuery === 'string' && rawGroupQuery.length > MAX_GROUP_QUERY_LEN
      ? rawGroupQuery.slice(0, MAX_GROUP_QUERY_LEN)
      : rawGroupQuery;
    const rawGroupLimit = input.limit as number | undefined;
    const groupLimit = Number.isFinite(rawGroupLimit) && (rawGroupLimit ?? 0) > 0
      ? Math.min(Math.floor(rawGroupLimit!), MAX_GROUP_LIMIT)
      : rawGroupLimit;
    const results = await runGroupQuery(configPath, groupQuery, groupLimit);
    if (results.length === 0) return text('No results found.');
    const lines = results.map(r => `[${r.label}] ${r.name}  ${r.filePath ?? ''}  repo:${r.repo}  (score: ${r.score.toFixed(4)})`);
    return text(lines.join('\n'));
  },
};

// ── monograph_wiki ────────────────────────────────────────────────────────────

const monographWikiTool: MCPTool = {
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
      const result = getWikiToolResult(db, { communityId: input.communityId as string | undefined });
      if (result.pages.length === 0) {
        return text('No wiki pages found. Run monograph_wiki_build to generate community wiki pages.');
      }
      // Return pages as readable prose — content is already LLM-generated markdown.
      const sections = result.pages.map(p =>
        `--- Community ${p.communityId} ---\n${p.content}`
      );
      return text(sections.join('\n\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_wiki_build ──────────────────────────────────────────────────────

const monographWikiBuildTool: MCPTool = {
  name: 'monograph_wiki_build',
  description: 'Generate LLM-powered wiki pages for code communities using the Anthropic API. Requires ANTHROPIC_API_KEY environment variable.',
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
        communityId: input.communityId as string | undefined,
        force: input.force as boolean | undefined,
        model: input.model as string | undefined,
      });
      if (result.error) return text(`Wiki build failed: ${result.error}`);
      const parts: string[] = [];
      if (result.generated != null) parts.push(`${result.generated} page(s) generated`);
      if (result.skipped != null && result.skipped > 0) parts.push(`${result.skipped} skipped (already exist)`);
      if (result.errors != null && result.errors > 0) parts.push(`${result.errors} error(s)`);
      return text(`Wiki build complete: ${parts.join(', ') || 'nothing to do'}. Use monograph_wiki to read the pages.`);
    } finally { closeDb(db); }
  },
};

// ── monograph_serve ───────────────────────────────────────────────────────────

const monographServeTool: MCPTool = {
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
      port: (input.port as number | undefined) ?? 7374,
      open: (input.open as boolean | undefined) ?? false,
      db,
    });
    return text(`Monograph web UI ${result.status === 'already_running' ? 'already running' : 'started'} at ${result.url}`);
  },
};

// ── monograph_tool_map ────────────────────────────────────────────────────────

const monographToolMapTool: MCPTool = {
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
      const results = getToolMap(db, { tool: input.tool as string | undefined });
      if (results.length === 0) return text('No tools found. Run monograph_build first.');
      const lines = results.map(r => {
        const loc = r.handlerFile
          ? (r.handlerLine != null ? `${r.handlerFile}:${r.handlerLine}` : r.handlerFile)
          : (r.filePath ?? '');
        return `${r.name}${r.handlerName ? ` → ${r.handlerName}` : ''}${loc ? `  (${loc})` : ''}`;
      });
      return text(`Tools (${results.length}):\n${lines.join('\n')}`);
    } finally { closeDb(db); }
  },
};

// ── monograph_shape_check ─────────────────────────────────────────────────────

const monographShapeCheckTool: MCPTool = {
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
        route: input.route as string | undefined,
        file: input.file as string | undefined,
      });
      // Render as structured text so LLMs can act on it directly without parsing JSON.
      const lines: string[] = [];
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
    } finally { closeDb(db); }
  },
};

// ── monograph_group_sync ──────────────────────────────────────────────────────

const monographGroupSyncTool: MCPTool = {
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
    const configPath = (input.configPath as string | undefined) ?? join(getProjectCwd(), 'group.yaml');
    try {
      const result = await runGroupSync(configPath);
      return text(JSON.stringify(result, null, 2));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return text(`Group sync failed: ${msg}`);
    }
  },
};

// ── monograph_augment ─────────────────────────────────────────────────────────

const monographAugmentTool: MCPTool = {
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
    const rawAugmentQuery = input.query as string;
    const augmentQuery = typeof rawAugmentQuery === 'string' && rawAugmentQuery.length > MAX_AUGMENT_QUERY_LEN
      ? rawAugmentQuery.slice(0, MAX_AUGMENT_QUERY_LEN) : rawAugmentQuery;
    const rawTopK = (input.topK as number | undefined) ?? 10;
    const topK = Number.isFinite(rawTopK) && rawTopK > 0
      ? Math.min(Math.floor(rawTopK), MAX_AUGMENT_TOP_K) : 10;
    const result = await augmentContext({
      query: augmentQuery,
      repoPath,
      topK,
      format: (input.format as 'markdown' | 'json' | undefined) ?? 'markdown',
    });
    return text(result);
  },
};

// ── monograph_inject_context ──────────────────────────────────────────────────

const monographInjectContextTool: MCPTool = {
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
      targets: input.targets as Array<'claude' | 'agents-md'> | undefined,
    });
    return text(`Injected context into: ${result.updated.join(', ') || 'none'}`);
  },
};

// ── monograph_skill_gen ───────────────────────────────────────────────────────

const monographSkillGenTool: MCPTool = {
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
      const outDir = resolve(input.outputDir as string);
      if (outDir !== allowedRoot && !outDir.startsWith(allowedRoot + sep)) {
        return text(`Error: outputDir must be within the project directory (${allowedRoot})`);
      }
    }
    const result = await generateSkillFiles(
      repoPath,
      input.outputDir ? resolve(input.outputDir as string) : undefined,
    );
    const dir = result.filesWritten.length > 0
      ? result.filesWritten[0].replace(/\/[^/]+$/, '/')
      : join(repoPath, '.monomind', 'skills') + '/';
    return text(`Generated ${result.communityCount} skill files in ${dir}`);
  },
};

// ── monograph_install_skills ──────────────────────────────────────────────────

const monographInstallSkillsTool: MCPTool = {
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
    const rawRepoPath = (input.repoPath as string | undefined) ?? getProjectCwd();
    const repoPath = resolve(rawRepoPath);
    const allowedRoot = resolve(getProjectCwd());
    if (repoPath !== allowedRoot && !repoPath.startsWith(allowedRoot + sep)) {
      return text(`Error: repoPath must be within the project directory (${allowedRoot})`);
    }
    const platform = input.platform as string;

    const validPlatforms = ['claude', 'cursor', 'vscode', 'zed'];
    if (!validPlatforms.includes(platform)) {
      return text(`Invalid platform "${platform}". Must be one of: ${validPlatforms.join(', ')}`);
    }

    // Load community data from graph
    const dbPath = join(repoPath, '.monomind', 'monograph.db');
    let db: ReturnType<typeof openDb>;
    try {
      db = openDb(dbPath);
    } catch {
      return text('Graph not built yet. Run monograph_build first.');
    }

    let communities: Array<{ name: string; symbols: string[] }>;
    try {
      // Query distinct community IDs with exported symbols
      const communityIds = db.prepare(`
        SELECT DISTINCT community_id
        FROM nodes
        WHERE community_id IS NOT NULL
          AND label NOT IN ('File', 'Folder', 'Community', 'Concept')
        ORDER BY community_id
      `).all() as Array<{ community_id: number }>;

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
        `).all(community_id) as Array<{ file_path: string }>;

        let name = `community-${community_id}`;
        const folderCounts = new Map<string, number>();
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
          if (count > bestCount) { bestCount = count; name = folder; }
        }

        // Collect exported symbol names
        const symbolRows = db.prepare(`
          SELECT name FROM nodes
          WHERE community_id = ? AND is_exported = 1
            AND label NOT IN ('File', 'Folder', 'Community', 'Concept')
          ORDER BY name
          LIMIT 50
        `).all(community_id) as Array<{ name: string }>;

        return { name, symbols: symbolRows.map(r => r.name) };
      });
    } catch (err: unknown) {
      closeDb(db);
      const msg = err instanceof Error ? err.message : String(err);
      return text(`Failed to query graph: ${msg}`);
    }
    closeDb(db);

    const result = await installSkillsForPlatform(repoPath, communities, {
      platform: platform as 'claude' | 'cursor' | 'vscode' | 'zed',
    });
    return text(`Installed ${result.filesWritten.length} skill files for ${result.platform} in ${result.outputDir}`);
  },
};

// ── monograph_doctor ──────────────────────────────────────────────────────────

const monographDoctorTool: MCPTool = {
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
    if (!result.healthy) lines.push('\nSome checks failed. Run monograph build to fix.');
    return text(lines.join('\n'));
  },
};

// ── monograph_list_repos ──────────────────────────────────────────────────────

const monographListReposTool: MCPTool = {
  name: 'monograph_list_repos',
  description: 'List all repositories tracked in the global monograph registry (~/.monograph/registry.json).',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_input) => {
    const { listRepos } = await import('@monoes/monograph');
    const repos = listRepos();
    if (repos.length === 0) return text('No repositories registered. Run monograph build in a repo to register it.');
    const lines = repos.map(r =>
      `${r.name} — ${r.path}${r.lastIndexed ? ` (indexed ${r.lastIndexed.slice(0, 10)})` : ''}${r.nodeCount != null ? ` [${r.nodeCount} nodes, ${r.edgeCount ?? 0} edges]` : ''}`
    );
    return text(lines.join('\n'));
  },
};

// ── monograph_group_contracts ─────────────────────────────────────────────────

const monographGroupContractsTool: MCPTool = {
  name: 'monograph_group_contracts',
  description: 'List public API contracts (exported symbols, interfaces, and types) for all groups defined in .monograph/groups.json.',
  inputSchema: {
    type: 'object',
    properties: {
      repoPath: { type: 'string', description: 'Absolute path to the repository (defaults to cwd).' },
    },
  },
  handler: async (input) => {
    const { getGroupContracts } = await import('./monograph-compat.js');
    const { join } = await import('path');
    const repoPath = (input as { repoPath?: string }).repoPath ?? getProjectCwd();
    const configPath = join(repoPath, '.monograph', 'groups.json');
    const contracts = await getGroupContracts(configPath);
    if (contracts.length === 0) return text('No contracts found. Ensure groups are defined in .monograph/groups.json.');
    const lines = contracts.map(c => `[${c.groupName}] ${c.symbol} — ${c.filePath}:${c.line}`);
    return text(lines.join('\n'));
  },
};

// ── monograph_group_status ────────────────────────────────────────────────────

const monographGroupStatusTool: MCPTool = {
  name: 'monograph_group_status',
  description: 'Show health status for all groups: whether each group is indexed, has contracts, and was recently synced.',
  inputSchema: {
    type: 'object',
    properties: {
      repoPath: { type: 'string', description: 'Absolute path to the repository (defaults to cwd).' },
    },
  },
  handler: async (input) => {
    const { getGroupStatus } = await import('./monograph-compat.js');
    const { join } = await import('path');
    const repoPath = (input as { repoPath?: string }).repoPath ?? getProjectCwd();
    const configPath = join(repoPath, '.monograph', 'groups.json');
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

const monographNeighborsTool: MCPTool = {
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
        name: input.name as string,
        relationFilter: input.relationFilter as string | undefined,
        includeInbound: (input.includeInbound as boolean | undefined) ?? false,
      });
      if (!result.node) return text(`No node found with name: ${input.name as string}`);
      const nodeFilePath = (result.node as any).filePath ?? '';
      const nodeStartLine = (result.node as any).startLine ?? (result.node as any).start_line;
      const nodeLoc = nodeFilePath ? (nodeStartLine != null ? `${nodeFilePath}:${nodeStartLine}` : nodeFilePath) : '';
      const lines = [
        `[${result.node.label}] ${result.node.name}  ${nodeLoc}`,
        `Neighbors: ${result.neighbors.length}`,
        '',
        ...result.neighbors.map(n => {
          const fp = (n.node as any).filePath ?? (n.node as any).file_path ?? '';
          const ln = (n.node as any).startLine ?? (n.node as any).start_line;
          const loc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
          return `  ${n.direction === 'inbound' ? '←' : '→'} [${n.node.label}] ${n.node.name}  (${n.relation})  ${loc}`;
        }),
      ];
      return text(lines.join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_suggest_auto ────────────────────────────────────────────────────

const monographSuggestAutoTool: MCPTool = {
  name: 'monograph_suggest_auto',
  description: 'Like monograph_suggest but health-aware: checks staleness first and triggers a background rebuild when the index is behind HEAD before returning suggestions. Result includes a _staleness annotation.',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Optional task description for task-relevance scoring' },
      limit: { type: 'number', description: 'Max questions (default 10)' },
    },
  },
  handler: async (input) => {
    const repoPath = getProjectCwd();

    // Check staleness and trigger rebuild if needed (threshold: STALENESS_THRESHOLD commits).
    const stalenessResult = await computeCommitsBehind(repoPath);
    const commitsBehind = stalenessResult?.commitsBehind ?? 0;
    const triggered = triggerBackgroundBuildIfNeeded(repoPath, commitsBehind, STALENESS_THRESHOLD + 1);
    const stalenessStatus: 'fresh' | 'stale' | 'building' =
      triggered ? 'building' : commitsBehind === 0 ? 'fresh' : 'stale';

    // Delegate to the base suggest tool — no logic duplication.
    const baseResult = await monographSuggestTool.handler(input);

    // Append staleness annotation to the text content.
    const stalenessAnnotation = `\n_staleness: ${JSON.stringify({ commitsBehind, status: stalenessStatus, triggered })}`;
    if (baseResult && Array.isArray((baseResult as any).content)) {
      const content = (baseResult as any).content as Array<{ type: string; text: string }>;
      if (content.length > 0 && content[0].type === 'text') {
        content[0].text += stalenessAnnotation;
      }
      return baseResult;
    }
    return baseResult;
  },
};

// ── Export all tools ──────────────────────────────────────────────────────────

export const monographTools: MCPTool[] = [
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
  monographSuggestAutoTool,
  monographVisualizeTool,
  monographWatchTool,
  monographWatchStopTool,
  monographReportTool,
  monographStalenessTool,
  monographSnapshotTool,
  monographDiffTool,
  monographNeighborsTool,
  monographExportTool,
  monographContextTool,
  monographImpactTool,
  monographDetectChangesTool,
  monographRenameTool,
  monographRouteMapTool,
  monographApiImpactTool,
  monographCypherTool,
  monographEmbedTool,
  monographGroupListTool,
  monographGroupQueryTool,
  monographWikiTool,
  monographWikiBuildTool,
  monographServeTool,
  monographToolMapTool,
  monographShapeCheckTool,
  monographGroupSyncTool,
  monographAugmentTool,
  monographInjectContextTool,
  monographSkillGenTool,
  monographInstallSkillsTool,
  monographDoctorTool,
  monographListReposTool,
  monographGroupContractsTool,
  monographGroupStatusTool,
];
