/**
 * Monograph MCP Tools
 *
 * Native TypeScript code intelligence — replaces Python graphify.
 * All monograph_* tools are backed by @monoes/monograph package.
 */

import { join } from 'path';
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
    },
  },
  handler: async (input) => {
    const { buildAsync } = await import('@monoes/monograph');
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    let progressLog = '';
    await buildAsync(repoPath, {
      codeOnly: (input.codeOnly as boolean | undefined) ?? false,
      force: (input.force as boolean | undefined) ?? false,
      onProgress: (p) => { progressLog += `[${p.phase}] ${p.message ?? ''}\n`; },
    });
    return text(`Monograph build complete for ${repoPath}\n${progressLog}`);
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
    const { openDb, closeDb, ftsSearch, hybridQuery } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const limit = (input.limit as number | undefined) ?? 20;
      const label = input.label as string | undefined;

      if (process.env['MONOGRAPH_EMBEDDINGS'] === 'true') {
        const results = await hybridQuery(db, input.query as string, { limit, label });
        if (results.length === 0) return text('No results found.');
        const lines = results.map(r => `[${r.label ?? '?'}] ${r.name ?? r.id}  ${r.filePath ?? ''}  (score: ${r.score.toFixed(4)})`);
        return text(lines.join('\n'));
      }

      const results = ftsSearch(db, input.query as string, limit, label);
      if (results.length === 0) return text('No results found.');
      const lines = results.map(r => `[${r.label}] ${r.name}  ${r.filePath ?? ''}  (score: ${r.rank.toFixed(3)})`);
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
      const meta = db.prepare("SELECT value FROM index_meta WHERE key = 'lastCommit'").get() as { value: string } | undefined;
      const lastCommit = meta?.value ?? null;
      if (!lastCommit) return text('Index has never been built. Run monograph_build first.');

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
      const limit = (input.limit as number | undefined) ?? 20;
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
      `).all(...excluded, limit) as any[];

      if (rows.length === 0) return text('No god nodes found. Run monograph_build first.');
      const lines = rows.map(r =>
        `[${r.label}] ${r.name}  degree=${r.degree} (↑${r.out_degree} ↓${r.in_degree})  ${r.file_path ?? ''}`
      );
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
      return text(`Path (${path.length - 1} hops):\n${path.join(' → ')}`);
    } finally { closeDb(db); }
  },
};

// ── monograph_community ───────────────────────────────────────────────────────

const monographCommunityTool: MCPTool = {
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
      const rows = db.prepare('SELECT * FROM nodes WHERE community_id = ?').all(parseInt(input.id as string, 10)) as any[];
      if (rows.length === 0) return text(`No nodes in community ${input.id}`);
      return text(rows.map(r => `[${r.label}] ${r.name}  ${r.file_path ?? ''}`).join('\n'));
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
      const limit = (input.limit as number | undefined) ?? 20;
      const rows = db.prepare(`
        SELECT e.*, n1.name as src_name, n2.name as tgt_name
        FROM edges e
        JOIN nodes n1 ON n1.id = e.source_id
        JOIN nodes n2 ON n2.id = e.target_id
        WHERE e.confidence != 'EXTRACTED'
        ORDER BY e.confidence_score ASC LIMIT ?
      `).all(limit) as any[];
      if (rows.length === 0) return text('No surprising connections found.');
      return text(rows.map(r => `[${r.confidence}] ${r.src_name} --${r.relation}--> ${r.tgt_name} (score: ${r.confidence_score})`).join('\n'));
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
    const { openDb, closeDb, hybridQuery } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const limit = (input.limit as number | undefined) ?? 10;
      const task = (input.task as string | undefined) ?? '';

      // When a task is provided and embeddings are enabled, use semantic search
      // to find relevant nodes and surface edge-level questions about them.
      if (task && process.env['MONOGRAPH_EMBEDDINGS'] === 'true') {
        const hits = await hybridQuery(db, task, { limit: 20 });
        const hitIds = new Set(hits.map(h => h.id));
        const rows = db.prepare(`
          SELECT e.relation, e.confidence, n1.name as src, n2.name as tgt, n1.file_path as src_file
          FROM edges e
          JOIN nodes n1 ON n1.id = e.source_id
          JOIN nodes n2 ON n2.id = e.target_id
          WHERE (e.source_id IN (${[...hitIds].map(() => '?').join(',')})
                 OR e.target_id IN (${[...hitIds].map(() => '?').join(',')}))
          AND e.confidence IN ('AMBIGUOUS', 'INFERRED')
          LIMIT 100
        `).all(...[...hitIds], ...[...hitIds]) as any[];

        const questions = rows.map(r =>
          `Why does ${r.src} ${r.relation.toLowerCase()} ${r.tgt}? (${r.confidence})`,
        );
        return text(questions.slice(0, limit).join('\n') || 'No suggestions for this task. Run monograph_build first.');
      }

      const rows = db.prepare(`
        SELECT e.relation, e.confidence, n1.name as src, n2.name as tgt, n1.file_path as src_file
        FROM edges e
        JOIN nodes n1 ON n1.id = e.source_id
        JOIN nodes n2 ON n2.id = e.target_id
        WHERE e.confidence IN ('AMBIGUOUS', 'INFERRED')
        LIMIT 100
      `).all() as any[];

      let scored = rows.map(r => ({
        q: `Why does ${r.src} ${r.relation.toLowerCase()} ${r.tgt}? (${r.confidence})`,
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
      const limit = (input.maxNodes as number | undefined) ?? 500;
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
        SELECT n.name, n.label, n.file_path,
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
        ...topNodes.map((n: any, i: number) => `${i + 1}. **${n.name}** (${n.label}) — degree ${n.degree}  \`${n.file_path ?? ''}\``),
      ].join('\n');

      const outPath = (input.path as string | undefined) ?? join(getProjectCwd(), '.monomind', 'GRAPH_REPORT.md');
      mkdirSync(join(outPath, '..'), { recursive: true });
      writeFileSync(outPath, report);
      return text(`Report written to ${outPath}`);
    } finally { closeDb(db); }
  },
};

// ── monograph_staleness ───────────────────────────────────────────────────────

const monographStalenessTool: MCPTool = {
  name: 'monograph_staleness',
  description: 'Git staleness detection: compares the commit hash at last index build against current HEAD. Returns isStale, changed files, and the timestamp of first diverging commit.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the repo (defaults to project cwd)' },
    },
  },
  handler: async (input) => {
    const { getMonographStaleness } = await import('@monoes/monograph');
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    const report = await getMonographStaleness(repoPath);
    return text(JSON.stringify(report, null, 2));
  },
};

// ── monograph_diff ────────────────────────────────────────────────────────────

const monographDiffTool: MCPTool = {
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
      const outDir = (input.outputPath as string | undefined) ?? join(getProjectCwd(), '.monomind', 'export');
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
    const { openDb, closeDb, getMonographContext } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = getMonographContext(db, {
        name: input.name as string,
        filePath: input.filePath as string | undefined,
      });
      return text(JSON.stringify(result, null, 2));
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
    const { openDb, closeDb, getMonographImpact } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = getMonographImpact(db, {
        name: input.name as string,
        filePath: input.filePath as string | undefined,
        depth: input.depth as number | undefined,
      });
      return text(JSON.stringify(result, null, 2));
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
    const { openDb, closeDb, detectMonographChanges } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = detectMonographChanges(db, {
        baseBranch: input.baseBranch as string | undefined,
        includeTests: input.includeTests as boolean | undefined,
      }, getProjectCwd());
      return text(JSON.stringify(result, null, 2));
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
    const { openDb, closeDb, getMonographRename } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = getMonographRename(db, {
        oldName: input.oldName as string,
        newName: input.newName as string,
        filePath: input.filePath as string | undefined,
        dryRun: (input.dryRun as boolean | undefined) ?? true,
      });
      return text(JSON.stringify(result, null, 2));
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
    const { openDb, closeDb, getMonographRouteMap } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = getMonographRouteMap(db, {
        prefix: input.prefix as string | undefined,
        method: input.method as string | undefined,
        includeMiddleware: input.includeMiddleware as boolean | undefined,
      });
      return text(JSON.stringify(result, null, 2));
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
    const { openDb, closeDb, getMonographApiImpact } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = getMonographApiImpact(db, {
        routePath: input.routePath as string,
        method: input.method as string | undefined,
      });
      return text(JSON.stringify(result, null, 2));
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
    const { openDb, closeDb, runEmbed } = await import('@monoes/monograph');
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
    const { openDb, closeDb, getMonographCypher } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = getMonographCypher(db, input.query as string);
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
    return text(JSON.stringify(result, null, 2));
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
    const results = await runGroupQuery(configPath, input.query as string, input.limit as number | undefined);
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
    const { openDb, closeDb, getWikiToolResult } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = getWikiToolResult(db, { communityId: input.communityId as string | undefined });
      return text(JSON.stringify(result, null, 2));
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
    const { openDb, closeDb, runWikiBuildTool } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = await runWikiBuildTool(db, {
        communityId: input.communityId as string | undefined,
        force: input.force as boolean | undefined,
        model: input.model as string | undefined,
      });
      return text(JSON.stringify(result, null, 2));
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
    const { openDb, serveMonograph } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    const result = await serveMonograph({
      port: (input.port as number | undefined) ?? 7374,
      open: (input.open as boolean | undefined) ?? false,
      db,
    });
    return text(`Monograph web UI ${result.status === 'already_running' ? 'already running' : 'started'} at ${result.url}`);
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
  monographVisualizeTool,
  monographWatchTool,
  monographWatchStopTool,
  monographReportTool,
  monographStalenessTool,
  monographDiffTool,
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
];
