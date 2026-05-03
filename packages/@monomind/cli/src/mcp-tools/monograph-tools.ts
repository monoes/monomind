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
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    let progressLog = '';
    await buildAsync(repoPath, {
      codeOnly: (input.codeOnly as boolean | undefined) ?? false,
      force: (input.force as boolean | undefined) ?? false,
      llmMaxSections: (input.llmMaxSections as number | undefined) ?? 0,
      onProgress: (p) => { progressLog += `[${p.phase}] ${p.message ?? ''}\n`; },
    });
    return text(`Monograph build complete for ${repoPath}\n${progressLog}`);
  },
};

// ── monograph_query ───────────────────────────────────────────────────────────

const monographQueryTool: MCPTool = {
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
    const limit = (input.limit as number | undefined) ?? 20;
    const label = input.label as string | undefined;
    const mode = (input.mode as string | undefined) ?? 'bm25';
    try {
      if (mode === 'semantic') {
        const results = semanticSearch(db, input.query as string, limit, label);
        if (results.length === 0) return text('No results found.');
        const lines = results.map(r => `[${r.label}] ${r.name}  ${r.filePath ?? ''}  (score: ${r.score.toFixed(4)})`);
        return text(lines.join('\n'));
      }

      if (mode === 'hybrid') {
        const bm25 = ftsSearch(db, input.query as string, limit * 2, label);
        const sem = semanticSearch(db, input.query as string, limit * 2, label);

        // RRF merge: score = Σ 1/(60 + rank)
        const K = 60;
        const scores = new Map<string, number>();
        const meta = new Map<string, { label: string; name: string; filePath: string | null }>();

        bm25.forEach((r, i) => {
          scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (K + i + 1));
          meta.set(r.id, { label: r.label, name: r.name, filePath: r.filePath });
        });
        sem.forEach((r, i) => {
          scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (K + i + 1));
          if (!meta.has(r.id)) meta.set(r.id, { label: r.label, name: r.name, filePath: r.filePath });
        });

        const merged = [...scores.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit);

        if (merged.length === 0) return text('No results found.');
        const lines = merged.map(([id, score]) => {
          const m = meta.get(id)!;
          return `[${m.label}] ${m.name}  ${m.filePath ?? ''}  (rrf: ${score.toFixed(4)})`;
        });
        return text(lines.join('\n'));
      }

      // default: bm25
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
    const { openDb, closeDb, countNodes, countEdges, computeCouplingProfile } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const nodes = countNodes(db);
      const edges = countEdges(db);
      const meta = db.prepare('SELECT key, value FROM index_meta').all() as { key: string; value: string }[];
      const metaStr = meta.map(m => `  ${m.key}: ${m.value}`).join('\n');
      const cp = computeCouplingProfile(db);
      const couplingStr = [
        '\nCoupling Profile:',
        `  p95 fan-in: ${cp.p95FanIn} (${cp.couplingHighPct}% of files exceed this)`,
        `  Fan-in distribution: low ${cp.fanInProfile.lowPct}% | medium ${cp.fanInProfile.mediumPct}% | high ${cp.fanInProfile.highPct}% | critical ${cp.fanInProfile.criticalPct}%`,
        `  Fan-out distribution: low ${cp.fanOutProfile.lowPct}% | medium ${cp.fanOutProfile.mediumPct}% | high ${cp.fanOutProfile.highPct}% | critical ${cp.fanOutProfile.criticalPct}%`,
      ].join('\n');
      return text(`Monograph index stats:\n  nodes: ${nodes}\n  edges: ${edges}\n${metaStr}${couplingStr}`);
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
    const { openDb, closeDb, computeCouplingProfile } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const limit = (input.limit as number | undefined) ?? 20;
      const excluded = ['File', 'Folder', 'Community', 'Concept'];

      // Compute percentile thresholds from coupling profile
      const cp = computeCouplingProfile(db);
      const p95FanIn = cp.p95FanIn;
      const p75FanOut = cp.fanOutProfile
        ? (() => {
            // Recompute p75 fan-out from raw data
            const fanOutRows = db.prepare('SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id').all() as { source_id: string; c: number }[];
            const sorted = fanOutRows.map(r => r.c).sort((a: number, b: number) => a - b);
            if (sorted.length === 0) return 0;
            const idx = Math.floor(0.75 * sorted.length);
            return sorted[Math.min(idx, sorted.length - 1)];
          })()
        : 0;

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

      const thresholds = {
        p75FanIn: cp.p75FanIn,
        p90FanIn: cp.p90FanIn,
        p95FanIn: cp.p95FanIn,
        p75FanOut,
        p90FanOut: p75FanOut, // approximate
      };

      const lines = rows.map((r: any) => {
        const fanIn = r.in_degree;
        const fanOut = r.out_degree;
        const category = (fanIn > p95FanIn && fanOut > p75FanOut)
          ? 'BRIDGE_NODE'
          : 'HIGH_CENTRALITY';
        const factors: string[] = [];
        if (fanIn > p95FanIn) factors.push(`fanIn: ${fanIn} (threshold: p95=${p95FanIn})`);
        if (fanOut > p75FanOut) factors.push(`fanOut: ${fanOut} (threshold: p75=${p75FanOut})`);
        const factorStr = factors.length > 0 ? `  [${factors.join(', ')}]` : '';
        return `[${r.label}] ${r.name}  degree=${r.degree} (↑${r.out_degree} ↓${r.in_degree})  category: ${category}${factorStr}  ${r.file_path ?? ''}`;
      });

      const thresholdsStr = `\nThresholds: p75FanIn=${thresholds.p75FanIn} p90FanIn=${thresholds.p90FanIn} p95FanIn=${thresholds.p95FanIn} p75FanOut=${thresholds.p75FanOut}`;

      const actions = rows.map((r: any) => ({
        type: 'refactor',
        file: r.file_path ?? undefined,
        symbol: r.name,
        description: `High-centrality node (${r.degree} connections) — consider decomposing`,
        confidence: 'medium',
      }));
      return text(lines.join('\n') + thresholdsStr + '\n\n## Actions\n' + JSON.stringify(actions, null, 2));
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
      const mainText = rows.map((r: any) => `[${r.confidence}] ${r.src_name} --${r.relation}--> ${r.tgt_name} (score: ${r.confidence_score})`).join('\n');
      const actions = rows.map((r: any) => {
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
    } finally { closeDb(db); }
  },
};

// ── monograph_suggest ─────────────────────────────────────────────────────────

const monographSuggestTool: MCPTool = {
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
      const limit = (input.limit as number | undefined) ?? 10;
      const task = (input.task as string | undefined) ?? '';
      const questions: Array<{ type: string; q: string; why: string; relevance: number }> = [];

      // 1. AMBIGUOUS/INFERRED edges
      const ambiguousRows = db.prepare(`
        SELECT e.relation, e.confidence, n1.name as src, n2.name as tgt, n1.file_path as src_file
        FROM edges e
        JOIN nodes n1 ON n1.id = e.source_id
        JOIN nodes n2 ON n2.id = e.target_id
        WHERE e.confidence IN ('AMBIGUOUS', 'INFERRED')
        LIMIT 60
      `).all() as any[];
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
      `).all() as any[];
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
      `).all() as any[];
      for (const iso of isolated) {
        questions.push({
          type: 'isolated_node',
          q: `Is \`${iso.name}\` (${iso.label}) dead code or an entry point with no declared consumers?`,
          why: `Zero edges in the graph — either unused or not yet indexed.`,
          relevance: task ? taskRelevance(task, iso.name + ' ' + (iso.file_path ?? '')) : 0,
        });
      }

      // Sort by relevance if task given, otherwise keep type-balanced order
      if (task) questions.sort((a, b) => b.relevance - a.relevance);

      const topQuestions = questions.slice(0, limit);
      const out = topQuestions.map(q => `[${q.type}] ${q.q}\n  → ${q.why}`).join('\n\n');
      if (!out) return text('No suggestions. Run monograph_build first.');

      // Build structured actions from the raw DB rows we already have
      const actions: Array<Record<string, unknown>> = [];
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

// ── monograph_impact ──────────────────────────────────────────────────────────

const monographImpactTool: MCPTool = {
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
      const target = input.target as string;
      const direction = (input.direction as string | undefined) ?? 'both';
      const maxDepth = Math.min((input.maxDepth as number | undefined) ?? 4, 10);

      // Resolve node — try exact file_path match first, then name, then LIKE
      const node: any = db.prepare("SELECT * FROM nodes WHERE file_path = ? OR name = ? LIMIT 1").get(target, target)
        ?? db.prepare("SELECT * FROM nodes WHERE file_path LIKE ? OR name LIKE ? LIMIT 1").get(`%${target}%`, `%${target}%`);

      if (!node) return text(`Node not found for: ${target}`);

      function bfs(startId: string, followSource: boolean, depth: number): Map<string, { node: any; depth: number }> {
        const visited = new Map<string, { node: any; depth: number }>();
        let frontier = [startId];
        for (let d = 1; d <= depth && frontier.length > 0; d++) {
          const next: string[] = [];
          for (const id of frontier) {
            const col = followSource ? 'source_id' : 'target_id';
            const otherCol = followSource ? 'target_id' : 'source_id';
            const edges = db.prepare(`SELECT ${otherCol} as other_id FROM edges WHERE ${col} = ? AND relation = 'IMPORTS'`).all(id) as any[];
            for (const e of edges) {
              if (!visited.has(e.other_id) && e.other_id !== startId) {
                const n = db.prepare('SELECT * FROM nodes WHERE id = ?').get(e.other_id) as any;
                if (n) { visited.set(e.other_id, { node: n, depth: d }); next.push(e.other_id); }
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
        if (upstreamMap.size === 0) lines.push('  (none)');
        else [...upstreamMap.values()].sort((a, b) => a.depth - b.depth).forEach(({ node: n, depth: d }) =>
          lines.push(`  [depth ${d}] ${n.file_path ?? n.name}`)
        );
      }

      if (direction === 'downstream' || direction === 'both') {
        lines.push(`\nDOWNSTREAM (${downstreamMap.size} dependencies — files this imports):`);
        if (downstreamMap.size === 0) lines.push('  (none)');
        else [...downstreamMap.values()].sort((a, b) => a.depth - b.depth).forEach(({ node: n, depth: d }) =>
          lines.push(`  [depth ${d}] ${n.file_path ?? n.name}`)
        );
      }

      // Build structured actions for all impacted nodes
      const allImpacted = [...upstreamMap.values(), ...downstreamMap.values()];
      const actions = allImpacted.map(({ node: n }: { node: any; depth: number }) => ({
        type: 'review',
        file: n.file_path ?? undefined,
        description: `Impacted by change — verify still correct`,
        confidence: 'high',
      }));

      return text(lines.join('\n') + (actions.length > 0 ? '\n\n## Actions\n' + JSON.stringify(actions, null, 2) : ''));
    } finally { closeDb(db); }
  },
};

// ── monograph_context ─────────────────────────────────────────────────────────

const monographContextTool: MCPTool = {
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
      const target = input.id as string;
      const node: any = db.prepare("SELECT * FROM nodes WHERE file_path = ? OR name = ? LIMIT 1").get(target, target)
        ?? db.prepare("SELECT * FROM nodes WHERE file_path LIKE ? OR name LIKE ? LIMIT 1").get(`%${target}%`, `%${target}%`);
      if (!node) return text(`Node not found for: ${target}`);

      // Direct importers (upstream)
      const importers = db.prepare(`
        SELECT n.* FROM edges e JOIN nodes n ON n.id = e.source_id
        WHERE e.target_id = ? AND e.relation = 'IMPORTS'
      `).all(node.id) as any[];

      // Direct imports (downstream)
      const imports = db.prepare(`
        SELECT n.* FROM edges e JOIN nodes n ON n.id = e.target_id
        WHERE e.source_id = ? AND e.relation = 'IMPORTS'
      `).all(node.id) as any[];

      // Containment parent
      const parent: any = db.prepare(`
        SELECT n.* FROM edges e JOIN nodes n ON n.id = e.source_id
        WHERE e.target_id = ? AND e.relation = 'CONTAINS' LIMIT 1
      `).get(node.id);

      // Community siblings
      let siblings: any[] = [];
      if (node.community_id != null) {
        siblings = db.prepare(`
          SELECT * FROM nodes WHERE community_id = ? AND id != ? LIMIT 10
        `).all(node.community_id, node.id) as any[];
      }

      const lines = [
        `Context for: [${node.label}] ${node.name}`,
        `  File: ${node.file_path ?? '(none)'}  Lines: ${node.start_line ?? '?'}–${node.end_line ?? '?'}`,
        `  Community: ${node.community_id ?? 'none'}  Exported: ${node.is_exported ? 'yes' : 'no'}`,
        '',
        `Parent: ${parent ? `[${parent.label}] ${parent.name}` : '(root)'}`,
        '',
        `Imports (${imports.length}):`,
        ...imports.map((n: any) => `  → ${n.file_path ?? n.name}`),
        imports.length === 0 ? '  (none)' : '',
        `Imported by (${importers.length}):`,
        ...importers.map((n: any) => `  ← ${n.file_path ?? n.name}`),
        importers.length === 0 ? '  (none)' : '',
        `Community ${node.community_id} siblings (${siblings.length}):`,
        ...siblings.map((n: any) => `  ~ [${n.label}] ${n.file_path ?? n.name}`),
        siblings.length === 0 ? '  (none)' : '',
      ];

      return text(lines.join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_detect_changes ──────────────────────────────────────────────────

const monographDetectChangesTool: MCPTool = {
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
      const scope = (input.scope as string | undefined) ?? 'unstaged';
      const cwd = getProjectCwd();
      let changedFiles: string[] = [];

      if (scope === 'since-indexed') {
        const meta = db.prepare("SELECT value FROM index_meta WHERE key = 'lastCommit'").get() as { value: string } | undefined;
        if (!meta?.value) return text('No indexed commit found. Run monograph_build first.');
        try {
          const out = execSync(`git diff --name-only ${meta.value}..HEAD`, { cwd, encoding: 'utf-8' });
          changedFiles = out.trim().split('\n').filter(Boolean);
        } catch { return text('git error while listing changes'); }
      } else {
        const gitFlag = scope === 'staged' ? '--cached' : scope === 'all' ? '' : '';
        const extra = scope === 'all' ? 'HEAD' : '';
        try {
          const cmd = scope === 'all' ? 'git diff HEAD --name-only' : `git diff ${scope === 'staged' ? '--cached' : ''} --name-only`;
          changedFiles = execSync(cmd, { cwd, encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
        } catch { return text('git error while listing changes'); }
      }

      if (changedFiles.length === 0) return text('No changed files found.');

      const affectedNodes: any[] = [];
      const dependentPaths = new Set<string>();

      for (const f of changedFiles) {
        const node: any = db.prepare("SELECT * FROM nodes WHERE file_path = ? OR file_path LIKE ?").get(f, `%${f}`)
          ?? db.prepare("SELECT * FROM nodes WHERE file_path LIKE ?").get(`%${f}%`);
        if (node) {
          affectedNodes.push({ node, changedFile: f });
          // Find 1-level upstream dependents
          const deps = db.prepare(`
            SELECT n.file_path FROM edges e JOIN nodes n ON n.id = e.source_id
            WHERE e.target_id = ? AND e.relation = 'IMPORTS'
          `).all(node.id) as any[];
          deps.forEach((d: any) => { if (d.file_path) dependentPaths.add(d.file_path); });
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
    } finally { closeDb(db); }
  },
};

// ── monograph_snapshot ────────────────────────────────────────────────────────

const monographSnapshotTool: MCPTool = {
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
      let snapshotName = input.name as string | undefined;
      if (!snapshotName) {
        try {
          snapshotName = execSync('git rev-parse --short HEAD', { cwd: getProjectCwd(), encoding: 'utf-8' }).trim();
        } catch {
          snapshotName = `snap-${Date.now()}`;
        }
      }

      const nodes = db.prepare('SELECT * FROM nodes').all() as any[];
      const edges = db.prepare('SELECT * FROM edges').all() as any[];
      const meta = db.prepare('SELECT key, value FROM index_meta').all() as { key: string; value: string }[];
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
      const outPath = (input.path as string | undefined) ?? pathMod.join(snapshotsDir, `${snapshotName}.json`);
      writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

      return text(`Snapshot "${snapshotName}" saved to ${outPath}\n  nodes: ${nodes.length}  edges: ${edges.length}`);
    } finally { closeDb(db); }
  },
};

// ── monograph_diff ────────────────────────────────────────────────────────────

const monographDiffTool: MCPTool = {
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
      const snapshotName = input.snapshot as string;
      const snapshotPath = pathMod.join(snapshotsDir, `${snapshotName}.json`);

      let oldSnap: any;
      try {
        oldSnap = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
      } catch {
        return text(`Snapshot not found: ${snapshotPath}\nRun monograph_snapshot first.`);
      }

      const useCurrent = (input.current as boolean | undefined) ?? true;

      let newNodes: any[];
      let newEdges: any[];
      let newLabel: string;

      if (useCurrent) {
        newNodes = db.prepare('SELECT * FROM nodes').all() as any[];
        newEdges = db.prepare('SELECT * FROM edges').all() as any[];
        newLabel = 'live graph';
      } else {
        const snap2Name = input.snapshot2 as string | undefined;
        if (!snap2Name) return text('Provide snapshot2 when current=false for snapshot-to-snapshot comparison.');
        const snap2Path = pathMod.join(snapshotsDir, `${snap2Name}.json`);
        let snap2: any;
        try {
          snap2 = JSON.parse(readFileSync(snap2Path, 'utf-8'));
        } catch {
          return text(`Second snapshot not found: ${snap2Path}`);
        }
        newNodes = snap2.nodes;
        newEdges = snap2.edges;
        newLabel = snap2Name;
      }

      // Diff nodes by id
      const oldNodeIds = new Set<string>((oldSnap.nodes as any[]).map((n: any) => n.id));
      const newNodeIds = new Set<string>(newNodes.map((n: any) => n.id));

      const addedNodes = newNodes.filter((n: any) => !oldNodeIds.has(n.id));
      const removedNodes = (oldSnap.nodes as any[]).filter((n: any) => !newNodeIds.has(n.id));

      // Diff edges by (source_id|target_id|relation) key
      const edgeKey = (e: any) => `${e.source_id}|${e.target_id}|${e.relation}`;
      const oldEdgeKeys = new Set<string>((oldSnap.edges as any[]).map(edgeKey));
      const newEdgeKeys = new Set<string>(newEdges.map(edgeKey));

      const addedEdges = newEdges.filter((e: any) => !oldEdgeKeys.has(edgeKey(e)));
      const removedEdges = (oldSnap.edges as any[]).filter((e: any) => !newEdgeKeys.has(edgeKey(e)));

      const summary = [
        `Graph diff: snapshot "${snapshotName}" → ${newLabel}`,
        `  ${addedNodes.length} new nodes, ${removedNodes.length} nodes removed`,
        `  ${addedEdges.length} new edges, ${removedEdges.length} edges removed`,
      ];

      if (addedNodes.length > 0) {
        summary.push('\nAdded nodes:');
        addedNodes.slice(0, 20).forEach((n: any) => summary.push(`  + [${n.label}] ${n.name}  ${n.file_path ?? ''}`));
        if (addedNodes.length > 20) summary.push(`  ... and ${addedNodes.length - 20} more`);
      }
      if (removedNodes.length > 0) {
        summary.push('\nRemoved nodes:');
        removedNodes.slice(0, 20).forEach((n: any) => summary.push(`  - [${n.label}] ${n.name}  ${n.file_path ?? ''}`));
        if (removedNodes.length > 20) summary.push(`  ... and ${removedNodes.length - 20} more`);
      }
      if (addedEdges.length > 0) {
        summary.push('\nAdded edges:');
        addedEdges.slice(0, 20).forEach((e: any) => summary.push(`  + ${e.source_id} --${e.relation}--> ${e.target_id}`));
        if (addedEdges.length > 20) summary.push(`  ... and ${addedEdges.length - 20} more`);
      }
      if (removedEdges.length > 0) {
        summary.push('\nRemoved edges:');
        removedEdges.slice(0, 20).forEach((e: any) => summary.push(`  - ${e.source_id} --${e.relation}--> ${e.target_id}`));
        if (removedEdges.length > 20) summary.push(`  ... and ${removedEdges.length - 20} more`);
      }

      // ── Trend table ────────────────────────────────────────────────────────
      if (oldSnap.vitals && (useCurrent ? true : true)) {
        try {
          const { computeTrend } = await import('@monoes/monograph');
          const beforeVitals = { ...oldSnap, ...(oldSnap.vitals ?? {}) };
          const afterVitals = useCurrent
            ? {
                version: 1 as const,
                savedAt: new Date().toISOString(),
                projectPath: oldSnap.projectPath ?? getProjectCwd(),
                findings: [],
                nodeCount: newNodes.length,
                edgeCount: newEdges.length,
              }
            : { ...JSON.parse(readFileSync(pathMod.join(snapshotsDir, `${input.snapshot2 as string}.json`), 'utf-8')), ...((JSON.parse(readFileSync(pathMod.join(snapshotsDir, `${input.snapshot2 as string}.json`), 'utf-8')) as any).vitals ?? {}) };
          const trend = computeTrend(beforeVitals, afterVitals);
          summary.push('\nVital Signs Trend:');
          summary.push('  Metric                  Before  After   Delta  Direction');
          summary.push('  ----------------------  ------  ------  -----  ---------');
          for (const m of trend.metrics) {
            const metric = m.metric.padEnd(22);
            const prev = String(m.previous).padStart(6);
            const curr = String(m.current).padStart(6);
            const delta = (m.delta >= 0 ? '+' : '') + String(m.delta).padStart(5);
            summary.push(`  ${metric}  ${prev}  ${curr}  ${delta}  ${m.symbol} ${m.direction}`);
          }
          summary.push(`\nOverall trend: ${trend.overallDirection}`);
        } catch {
          // vitals not available — skip trend section
        }
      }

      return text(summary.join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_export ──────────────────────────────────────────────────────────

const monographExportTool: MCPTool = {
  name: 'monograph_export',
  description: 'Export the knowledge graph in various formats: obsidian, canvas, cypher, graphml, svg, json, sarif.',
  inputSchema: {
    type: 'object',
    properties: {
      format: { type: 'string', description: 'Format: obsidian, canvas, cypher, graphml, svg, json, sarif' },
      outputPath: { type: 'string', description: 'Output path' },
    },
    required: ['format'],
  },
  handler: async (input) => {
    const { openDb, closeDb, toJson, toSvg, toGraphml, toCypher, exportSarif } = await import('@monoes/monograph');
    const { writeFileSync, mkdirSync } = await import('fs');
    const db = openDb(getDbPath());
    try {
      const fmt = input.format as string;
      const projectPath = getProjectCwd();
      const outDir = (input.outputPath as string | undefined) ?? join(projectPath, '.monomind', 'export');
      mkdirSync(outDir, { recursive: true });

      if (fmt === 'sarif') {
        const sarifDoc = exportSarif(db, projectPath);
        const p = join(outDir, 'monograph.sarif');
        writeFileSync(p, JSON.stringify(sarifDoc, null, 2));
        return text(`Exported SARIF 2.1.0 to ${p}\n${sarifDoc.runs[0].results.length} findings`);
      }

      const nodes = db.prepare('SELECT * FROM nodes').all() as any[];
      const edges = db.prepare('SELECT * FROM edges').all() as any[];

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

// ── monograph_rename ──────────────────────────────────────────────────────────

const monographRenameTool: MCPTool = {
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
      const symbolName = input.symbolName as string;
      const newName = input.newName as string;
      const dryRun = (input.dryRun as boolean | undefined) ?? true;

      // Find the target node
      const node: any = db.prepare("SELECT * FROM nodes WHERE name = ? LIMIT 1").get(symbolName)
        ?? db.prepare("SELECT * FROM nodes WHERE name LIKE ? LIMIT 1").get(`%${symbolName}%`);

      // Find all files that import the node's file
      const importerFiles: string[] = [];
      if (node?.file_path) {
        const importers = db.prepare(`
          SELECT DISTINCT n.file_path FROM edges e JOIN nodes n ON n.id = e.source_id
          WHERE e.target_id = ? AND e.relation = 'IMPORTS' AND n.file_path IS NOT NULL
        `).all(node.id) as any[];
        importerFiles.push(...importers.map((r: any) => r.file_path));
        // Also include the node's own file
        if (!importerFiles.includes(node.file_path)) importerFiles.unshift(node.file_path);
      }

      // Text search for symbolName in all indexed file paths
      const allFiles = db.prepare("SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL").all() as any[];
      const regex = new RegExp(`\\b${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const editPlan: Array<{ file: string; occurrences: number; source: string }> = [];

      const filesToCheck = new Set([...importerFiles, ...allFiles.map((r: any) => r.file_path)]);
      for (const filePath of filesToCheck) {
        try {
          const content = readFileSync(filePath, 'utf-8');
          const matches = content.match(regex);
          if (matches && matches.length > 0) {
            editPlan.push({ file: filePath, occurrences: matches.length, source: importerFiles.includes(filePath) ? 'graph' : 'text_search' });
          }
        } catch { /* skip unreadable files */ }
      }

      if (editPlan.length === 0) return text(`No occurrences of "${symbolName}" found in the indexed codebase.`);

      if (!dryRun) {
        let applied = 0;
        for (const { file } of editPlan) {
          try {
            const content = readFileSync(file, 'utf-8');
            const updated = content.replace(regex, newName);
            writeFileSync(file, updated, 'utf-8');
            applied++;
          } catch { /* skip */ }
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
    } finally { closeDb(db); }
  },
};

// ── monograph_cohesion ────────────────────────────────────────────────────────

const monographCohesionTool: MCPTool = {
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
      const limit = (input.limit as number | undefined) ?? 20;
      const communities = db.prepare("SELECT DISTINCT community_id FROM nodes WHERE community_id IS NOT NULL").all() as any[];
      if (communities.length === 0) return text('No communities found. Run monograph_build first.');

      const scores: Array<{ id: number; size: number; score: number; internalEdges: number }> = [];
      for (const { community_id } of communities) {
        const members = db.prepare("SELECT id FROM nodes WHERE community_id = ?").all(community_id) as any[];
        const n = members.length;
        if (n <= 1) { scores.push({ id: community_id, size: n, score: 1.0, internalEdges: 0 }); continue; }
        const memberIds = new Set(members.map((m: any) => m.id));
        const internalEdges = db.prepare(`
          SELECT COUNT(*) as c FROM edges
          WHERE source_id IN (${members.map(() => '?').join(',')})
          AND target_id IN (${members.map(() => '?').join(',')})
        `).get(...members.map((m: any) => m.id), ...members.map((m: any) => m.id)) as { c: number };
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
    } finally { closeDb(db); }
  },
};

// ── monograph_bridge ──────────────────────────────────────────────────────────

const monographBridgeTool: MCPTool = {
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
      const limit = (input.limit as number | undefined) ?? 15;

      const nodes = db.prepare(`
        SELECT n.id, n.name, n.label, n.file_path, n.community_id,
               COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) AS total_degree
        FROM nodes n
        LEFT JOIN edges e1 ON e1.source_id = n.id
        LEFT JOIN edges e2 ON e2.target_id = n.id
        WHERE n.community_id IS NOT NULL AND n.label NOT IN ('File','Folder','Community','Concept')
        GROUP BY n.id HAVING total_degree > 0
      `).all() as any[];

      if (nodes.length === 0) return text('No nodes with community assignments found. Run monograph_build first.');

      // Build community map
      const communityOf = new Map<string, number>(nodes.map((n: any) => [n.id, n.community_id]));

      // For each node, count edges crossing into different communities
      const bridgeScores: Array<{ node: any; crossEdges: number; communities: Set<number> }> = [];

      for (const node of nodes) {
        const edges = db.prepare(`
          SELECT source_id, target_id FROM edges
          WHERE source_id = ? OR target_id = ?
        `).all(node.id, node.id) as any[];

        const foreignCommunities = new Set<number>();
        let crossEdges = 0;
        for (const e of edges) {
          const neighborId = e.source_id === node.id ? e.target_id : e.source_id;
          const neighborComm = communityOf.get(neighborId);
          if (neighborComm !== undefined && neighborComm !== node.community_id) {
            foreignCommunities.add(neighborComm);
            crossEdges++;
          }
        }
        if (crossEdges > 0) bridgeScores.push({ node, crossEdges, communities: foreignCommunities });
      }

      bridgeScores.sort((a, b) => b.crossEdges - a.crossEdges || b.communities.size - a.communities.size);
      const top = bridgeScores.slice(0, limit);

      if (top.length === 0) return text('No bridge nodes found (no cross-community edges).');

      const lines = [
        `Top ${top.length} Bridge Nodes (cross-community connectors):`,
        `Format: [label] name  home_community → N foreign communities (cross_edges)\n`,
        ...top.map(({ node: n, crossEdges, communities }) =>
          `  [${n.label}] ${n.name}  comm=${n.community_id} → ${communities.size} communities  (${crossEdges} cross-edges)  ${n.file_path ?? ''}`
        ),
      ];
      return text(lines.join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_cypher ──────────────────────────────────────────────────────────

const monographCypherTool: MCPTool = {
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
      const query = (input.query as string).trim();

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

      function buildWhereSql(alias: string, raw: string): string {
        if (!raw) return '';
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

      function resolveReturn(alias: string, raw: string): string {
        if (raw === '*') return `${alias}.id, ${alias}.label, ${alias}.name, ${alias}.file_path`;
        return raw.replace(/\b(\w+)\.([\w_]+)/g, `${alias}.$2`);
      }

      let rows: any[];
      if (edgePattern) {
        const [, srcAlias, srcLabel, relation, tgtAlias, tgtLabel] = edgePattern;
        const whereParts = ['e.relation = ?'];
        const params: any[] = [relation.toUpperCase()];
        if (srcLabel) { whereParts.push(`src.label = ?`); params.push(srcLabel); }
        if (tgtLabel) { whereParts.push(`tgt.label = ?`); params.push(tgtLabel); }
        const w = buildWhereSql('src', whereRaw);
        if (w) { whereParts.push(w); }
        const sql = `SELECT src.name as src_name, src.file_path as src_file, tgt.name as tgt_name, tgt.file_path as tgt_file, e.relation
          FROM edges e
          JOIN nodes src ON src.id = e.source_id
          JOIN nodes tgt ON tgt.id = e.target_id
          WHERE ${whereParts.join(' AND ')}
          LIMIT ?`;
        rows = db.prepare(sql).all(...params, limit) as any[];
      } else if (nodePattern) {
        const [, alias, label] = nodePattern;
        const whereParts: string[] = [];
        const params: any[] = [];
        if (label) { whereParts.push(`n.label = ?`); params.push(label); }
        const w = buildWhereSql('n', whereRaw);
        if (w) whereParts.push(w);
        const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
        const ret = resolveReturn('n', returnRaw);
        const sql = `SELECT ${ret} FROM nodes n ${where} LIMIT ?`;
        rows = db.prepare(sql).all(...params, limit) as any[];
      } else {
        return text('Could not parse query. Supported patterns:\n  MATCH (n:Label) WHERE n.name CONTAINS "x" RETURN n.name, n.file_path\n  MATCH (a:Class)-[:IMPORTS]->(b) RETURN a.name, b.name LIMIT 10');
      }

      if (rows.length === 0) return text('No results.');
      const header = Object.keys(rows[0]).join(' | ');
      const sep = header.replace(/[^|]/g, '-');
      const dataRows = rows.map(r => Object.values(r).map(v => String(v ?? '')).join(' | '));
      return text([header, sep, ...dataRows].join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_neighbors ───────────────────────────────────────────────────────

const monographNeighborsTool: MCPTool = {
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
      const target = input.id as string;
      const maxHops = Math.min((input.hops as number | undefined) ?? 2, 5);
      const relation = (input.relation as string | undefined) ?? 'all';

      // Resolve starting node
      const startNode: any = db.prepare("SELECT * FROM nodes WHERE file_path = ? OR name = ? LIMIT 1").get(target, target)
        ?? db.prepare("SELECT * FROM nodes WHERE file_path LIKE ? OR name LIKE ? LIMIT 1").get(`%${target}%`, `%${target}%`);
      if (!startNode) return text(`Node not found: ${target}`);

      // BFS traversal
      const discovered = new Map<string, { node: any; hop: number }>();
      let frontier = [startNode.id];
      discovered.set(startNode.id, { node: startNode, hop: 0 });

      for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
        const next: string[] = [];
        for (const nodeId of frontier) {
          const relFilter = relation === 'all' ? '' : `AND e.relation = '${relation}'`;
          // Outgoing edges
          const outgoing = db.prepare(`
            SELECT e.target_id as neighbor_id FROM edges e
            WHERE e.source_id = ? ${relFilter}
          `).all(nodeId) as any[];
          // Incoming edges
          const incoming = db.prepare(`
            SELECT e.source_id as neighbor_id FROM edges e
            WHERE e.target_id = ? ${relFilter}
          `).all(nodeId) as any[];

          for (const row of [...outgoing, ...incoming]) {
            if (!discovered.has(row.neighbor_id)) {
              const n = db.prepare('SELECT * FROM nodes WHERE id = ?').get(row.neighbor_id) as any;
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
      const byHop = new Map<number, any[]>();
      for (const [, { node, hop }] of discovered) {
        if (hop === 0) continue; // exclude the seed node itself
        if (!byHop.has(hop)) byHop.set(hop, []);
        byHop.get(hop)!.push(node);
      }

      const lines = [
        `Neighbors of: [${startNode.label}] ${startNode.name}  ${startNode.file_path ?? ''}`,
        `Hops: ${maxHops}  Relation filter: ${relation}  Total found: ${discovered.size - 1}`,
      ];
      for (let h = 1; h <= maxHops; h++) {
        const hopNodes = byHop.get(h) ?? [];
        lines.push(`\nHop ${h} (${hopNodes.length} nodes):`);
        if (hopNodes.length === 0) { lines.push('  (none)'); break; }
        hopNodes.forEach((n: any) => lines.push(`  [${n.label}] ${n.name}  ${n.file_path ?? ''}`));
      }
      return text(lines.join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_add_fact ────────────────────────────────────────────────────────

const monographAddFactTool: MCPTool = {
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
      const sourceName = input.source as string;
      const relation = (input.relation as string).toUpperCase();
      const targetName = input.target as string;
      const confidence = ((input.confidence as string | undefined) ?? 'EXTRACTED').toUpperCase() as 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
      const note = (input.note as string | undefined) ?? '';

      const confidenceScoreMap: Record<string, number> = { EXTRACTED: 1.0, INFERRED: 0.7, AMBIGUOUS: 0.4 };
      const confidenceScore = confidenceScoreMap[confidence] ?? 1.0;

      // Resolve or create source node
      let sourceNode: any = db.prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1').get(sourceName)
        ?? db.prepare('SELECT * FROM nodes WHERE file_path LIKE ? LIMIT 1').get(`%${sourceName}%`);
      if (!sourceNode) {
        const sourceId = `concept:${sourceName}`;
        db.prepare('INSERT OR IGNORE INTO nodes (id, label, name) VALUES (?, ?, ?)').run(sourceId, 'Concept', sourceName);
        sourceNode = db.prepare('SELECT * FROM nodes WHERE id = ?').get(sourceId) as any;
      }

      // Resolve or create target node
      let targetNode: any = db.prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1').get(targetName)
        ?? db.prepare('SELECT * FROM nodes WHERE file_path LIKE ? LIMIT 1').get(`%${targetName}%`);
      if (!targetNode) {
        const targetId = `concept:${targetName}`;
        db.prepare('INSERT OR IGNORE INTO nodes (id, label, name) VALUES (?, ?, ?)').run(targetId, 'Concept', targetName);
        targetNode = db.prepare('SELECT * FROM nodes WHERE id = ?').get(targetId) as any;
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
    } finally { closeDb(db); }
  },
};

// ── monograph_clear ───────────────────────────────────────────────────────────

const monographClearTool: MCPTool = {
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
    if ((input.confirm as string) !== 'yes') {
      return text('Aborted: confirm must be exactly "yes" to clear the graph.');
    }

    const { openDb, closeDb } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const label = input.label as string | undefined;

      if (label) {
        // Delete edges touching nodes of this label first (avoid orphans)
        db.prepare(`
          DELETE FROM edges WHERE source_id IN (SELECT id FROM nodes WHERE label = ?)
            OR target_id IN (SELECT id FROM nodes WHERE label = ?)
        `).run(label, label);
        const { changes } = db.prepare('DELETE FROM nodes WHERE label = ?').run(label);
        return text(`Cleared all [${label}] nodes and their edges (${changes} nodes deleted).`);
      } else {
        // Full wipe: edges first, then nodes, then meta
        const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
        const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number }).c;
        db.prepare('DELETE FROM edges').run();
        db.prepare('DELETE FROM nodes').run();
        db.prepare('DELETE FROM index_meta').run();
        return text(`Graph cleared: ${nodeCount} nodes and ${edgeCount} edges removed.`);
      }
    } finally { closeDb(db); }
  },
};

// ── monograph_unlinked_refs ───────────────────────────────────────────────────

const monographUnlinkedRefsTool: MCPTool = {
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
      const targetName = input.targetName as string;
      const limit = (input.limit as number | undefined) ?? 50;

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
    } finally { closeDb(db); }
  },
};

// ── monograph_blast_radius ────────────────────────────────────────────────────

const monographBlastRadiusTool: MCPTool = {
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
      const nodeId = input.nodeId as string;
      const results = effectiveBlastRadius(db, nodeId, {
        forward: input.forward as boolean | undefined,
        backward: input.backward as boolean | undefined,
        maxDepth: input.maxDepth as number | undefined,
        mustReferenceAll: input.mustReferenceAll as string[] | undefined,
        excludeReferencing: input.excludeReferencing as string[] | undefined,
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
        forwardNodes.forEach(r =>
          lines.push(`  [hop ${r.hops}] [${r.nodeLabel}] ${r.nodeName}  ${r.filePath ?? ''}  via: ${r.reachableVia.join(', ')}`)
        );
        lines.push('');
      }

      if (backwardNodes.length > 0) {
        lines.push(`BACKWARD (${backwardNodes.length} — nodes that affect this):`);
        backwardNodes.forEach(r =>
          lines.push(`  [hop ${r.hops}] [${r.nodeLabel}] ${r.nodeName}  ${r.filePath ?? ''}  via: ${r.reachableVia.join(', ')}`)
        );
      }

      return text(lines.join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_hotspots ────────────────────────────────────────────────────────

const monographHotspotsTool: MCPTool = {
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
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    const db = openDb(getDbPath());
    try {
      const results = computeHotspots(db, repoPath, {
        windowDays: input.windowDays as number | undefined,
        limit: input.limit as number | undefined,
        minCommits: input.minCommits as number | undefined,
      });

      if (results.length === 0) {
        return text('No hotspots found. Ensure monograph_build has been run and the path is a git repository with sufficient commit history.');
      }

      const limitVal = (input.limit as number | undefined) ?? 20;
      const lines: string[] = [
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
    } finally { closeDb(db); }
  },
};

// ── monograph_baseline_save ───────────────────────────────────────────────────

const monographBaselineSaveTool: MCPTool = {
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
    const projectPath = (input.path as string | undefined) ?? getProjectCwd();
    const dbPath = join(projectPath, '.monomind', 'monograph.db');
    const outPath = (input.baselinePath as string | undefined) ?? defaultBaselinePath(projectPath);
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
    } finally { closeDb(db); }
  },
};

// ── monograph_baseline_compare ────────────────────────────────────────────────

const monographBaselineCompareTool: MCPTool = {
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
    const projectPath = (input.path as string | undefined) ?? getProjectCwd();
    const dbPath = join(projectPath, '.monomind', 'monograph.db');
    const bPath = (input.baselinePath as string | undefined) ?? defaultBaselinePath(projectPath);
    const introducedOnly = (input.introducedOnly as boolean | undefined) ?? false;
    const db = openDb(dbPath);
    try {
      const currentFindings = extractFindingsFromDb(db, projectPath);
      const baseline = loadBaseline(bPath);
      const compared = compareWithBaseline(currentFindings, baseline);

      const introduced = compared.filter(f => f.introduced);
      const inherited = compared.filter(f => !f.introduced);

      const lines: string[] = [
        `Baseline comparison: ${introduced.length} introduced, ${inherited.length} inherited (${compared.length} total)`,
        '',
      ];

      if (introduced.length > 0) {
        lines.push(`INTRODUCED (new since baseline):`);
        for (const f of introduced) {
          lines.push(`  [${f.type}] ${f.filePath ?? f.nodeId} — ${f.nodeName}`);
        }
      } else {
        lines.push('INTRODUCED (new since baseline): none');
      }

      if (!introducedOnly) {
        lines.push('');
        if (inherited.length > 0) {
          lines.push(`INHERITED (pre-existing):`);
          for (const f of inherited) {
            lines.push(`  [${f.type}] ${f.filePath ?? f.nodeId} — ${f.nodeName}`);
          }
        } else {
          lines.push('INHERITED (pre-existing): none');
        }
      }

      if (!baseline) {
        lines.push('');
        lines.push(`Note: no baseline found at ${bPath}. All findings treated as introduced.`);
      }

      return text(lines.join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_health_score ────────────────────────────────────────────────────

const monographHealthScoreTool: MCPTool = {
  name: 'monograph_health_score',
  description: 'Compute a composite health score (0–100) with a letter grade (A–F) for the knowledge graph. Accounts for unreachable files, god nodes, circular edges, hotspot files, isolated nodes, and cross-community edges.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project root path (defaults to project cwd)' },
    },
  },
  handler: async (input) => {
    const { openDb, closeDb, computeHealthScore } = await import('@monoes/monograph');
    const { join } = await import('path');
    const projectPath = (input.path as string | undefined) ?? getProjectCwd();
    const dbPath = join(projectPath, '.monomind', 'monograph.db');
    const db = openDb(dbPath);
    try {
      const result = computeHealthScore(db);
      return text(result.summary);
    } finally { closeDb(db); }
  },
};

// ── monograph_reachability ────────────────────────────────────────────────────

const monographReachabilityTool: MCPTool = {
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
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    const db = openDb(getDbPath());
    try {
      const role = input.role as string | undefined;
      const rerun = (input.rerun as boolean | undefined) ?? false;

      // Check if classification already exists
      let hasCached = false;
      if (!rerun) {
        const check = db.prepare(`
          SELECT COUNT(*) as c FROM nodes
          WHERE label = 'File' AND json_extract(properties, '$.reachabilityRole') IS NOT NULL
        `).get() as { c: number };
        hasCached = check.c > 0;
      }

      let counts: { runtime: number; test: number; support: number; unreachable: number } | null = null;
      if (!hasCached || rerun) {
        counts = classifyReachability(db, repoPath);
      }

      if (role) {
        const validRoles = ['runtime', 'test', 'support', 'unreachable'];
        if (!validRoles.includes(role)) {
          return text(`Invalid role "${role}". Must be one of: ${validRoles.join(', ')}`);
        }
        const nodes = getNodesByReachabilityRole(db, role as 'runtime' | 'test' | 'support' | 'unreachable');
        if (nodes.length === 0) {
          return text(`No ${role} files found. Run monograph_build first or try rerun=true.`);
        }
        const lines = [
          `${role.toUpperCase()} files (${nodes.length}):`,
          ...nodes.map(n => `  ${n.filePath ?? n.name}`),
        ];
        return text(lines.join('\n'));
      }

      // Show summary counts
      if (!counts) {
        // Pull counts from cached properties
        const rows = db.prepare(`
          SELECT json_extract(properties, '$.reachabilityRole') as role, COUNT(*) as c
          FROM nodes WHERE label = 'File' AND properties IS NOT NULL
          GROUP BY role
        `).all() as { role: string | null; c: number }[];
        const byRole: Record<string, number> = {};
        for (const r of rows) {
          if (r.role) byRole[r.role] = r.c;
        }
        counts = {
          runtime: byRole['runtime'] ?? 0,
          test: byRole['test'] ?? 0,
          support: byRole['support'] ?? 0,
          unreachable: byRole['unreachable'] ?? 0,
        };
      }

      const total = counts.runtime + counts.test + counts.support + counts.unreachable;
      const pct = (n: number) => total > 0 ? ` (${Math.round(n / total * 100)}%)` : '';
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
    } finally { closeDb(db); }
  },
};

// ── monograph_boundary_check ──────────────────────────────────────────────────

const monographBoundaryCheckTool: MCPTool = {
  name: 'monograph_boundary_check',
  description: 'Check for boundary zone violations defined in .monographrc.json. Returns cross-zone import violations that are not in the allowedImports allowlist.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project root path (defaults to project cwd)' },
      fix: { type: 'boolean', description: 'Reserved for future use: auto-fix violations' },
    },
  },
  handler: async (input) => {
    const { openDb, closeDb, loadMonographConfig, detectBoundaryViolations } = await import('@monoes/monograph');
    const projectPath = (input.path as string | undefined) ?? getProjectCwd();
    const config = loadMonographConfig(projectPath);
    if (!config.zones || config.zones.length === 0) {
      return text('No .monographrc.json found or no zones defined. Create one to enable boundary checking.\nSee .monographrc.example.json for the expected format.');
    }
    const db = openDb(getDbPath());
    try {
      const violations = detectBoundaryViolations(db, projectPath);
      if (violations.length === 0) return text('No boundary violations found.');

      // Group violations by fromZone → toZone
      const groups = new Map<string, typeof violations>();
      for (const v of violations) {
        const key = `${v.fromZone} → ${v.toZone}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(v);
      }

      const lines: string[] = [`Boundary violations: ${violations.length} total\n`];
      for (const [key, vs] of groups) {
        lines.push(`[${key}] — ${vs.length} violation(s)`);
        vs.slice(0, 10).forEach(v => lines.push(`  ${v.fromPath}  --${v.edgeRelation}-->  ${v.toPath}`));
        if (vs.length > 10) lines.push(`  ... and ${vs.length - 10} more`);
      }
      return text(lines.join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_codeowners ──────────────────────────────────────────────────────

const monographCodeownersTool: MCPTool = {
  name: 'monograph_codeowners',
  description: 'CODEOWNERS-based file ownership. If filePath given: return owner(s) for that file. If unownedOnly: return all File nodes with no declared owner. Otherwise: return summary (total files, % owned, top owners by file count).',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project root (defaults to project cwd)' },
      filePath: { type: 'string', description: 'Look up owner(s) for a single file path (relative to project root)' },
      unownedOnly: { type: 'boolean', description: 'Return all File nodes with no declared owner' },
    },
  },
  handler: async (input) => {
    const { openDb, closeDb, parseCodeowners, resolveOwner, annotateOwnership } = await import('@monoes/monograph');
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    const db = openDb(getDbPath());
    try {
      const entries = parseCodeowners(repoPath);

      if (input.filePath) {
        const filePath = input.filePath as string;
        const owners = resolveOwner(entries, filePath);
        if (owners.length === 0) return text(`${filePath}: unowned`);
        return text(`${filePath}: ${owners.join(', ')}`);
      }

      if (input.unownedOnly) {
        annotateOwnership(db, repoPath);
        const rows = db.prepare(`
          SELECT file_path, properties FROM nodes
          WHERE label = 'File' AND file_path IS NOT NULL
        `).all() as { file_path: string; properties: string | null }[];

        const unownedFiles = rows.filter(r => {
          const props = r.properties ? JSON.parse(r.properties) : {};
          return !props.codeowners || props.codeowners.length === 0;
        });

        if (unownedFiles.length === 0) return text('All files have declared owners.');
        const lines = [`Unowned files (${unownedFiles.length}):`];
        for (const f of unownedFiles) lines.push(`  ${f.file_path}`);
        return text(lines.join('\n'));
      }

      // Summary mode
      const { annotated, unowned } = annotateOwnership(db, repoPath);
      const total = annotated + unowned;
      const pct = total > 0 ? Math.round(annotated / total * 100) : 0;

      const rows = db.prepare(`
        SELECT properties FROM nodes WHERE label = 'File' AND file_path IS NOT NULL AND properties IS NOT NULL
      `).all() as { properties: string }[];

      const ownerCount = new Map<string, number>();
      for (const r of rows) {
        const props = JSON.parse(r.properties);
        const owners: string[] = props.codeowners ?? [];
        for (const o of owners) {
          ownerCount.set(o, (ownerCount.get(o) ?? 0) + 1);
        }
      }

      const sorted = [...ownerCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      const lines = [
        `CODEOWNERS summary:`,
        `  total files : ${total}`,
        `  owned       : ${annotated} (${pct}%)`,
        `  unowned     : ${unowned}`,
        entries.length === 0 ? '  (no CODEOWNERS file found)' : `  entries     : ${entries.length}`,
        '',
        'Top owners by file count:',
        ...sorted.map(([o, c]) => `  ${o}: ${c} file${c !== 1 ? 's' : ''}`),
      ];
      return text(lines.join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_suppress ────────────────────────────────────────────────────────

const monographSuppressTool: MCPTool = {
  name: 'monograph_suppress',
  description: 'Manage finding suppressions. action=add: add suppression for filePath+line+rule. action=list: list all (or filtered) suppressions. action=remove: remove by id. action=stale: find suppressions where the file was deleted or the issue no longer exists.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project root (defaults to project cwd)' },
      action: { type: 'string', enum: ['add', 'list', 'remove', 'stale'], description: 'Action to perform' },
      filePath: { type: 'string', description: 'File path for add/list/stale' },
      line: { type: 'number', description: 'Line number (0 = file-wide, default 0)' },
      rule: { type: 'string', description: 'Rule name for add/list/stale (e.g. god_node, isolated_node)' },
      id: { type: 'string', description: 'Suppression ID for remove action' },
    },
    required: ['action'],
  },
  handler: async (input) => {
    const { openDb, closeDb, addSuppression, listSuppressions, removeSuppression, findStaleSuppressions, extractFindingsFromDb } = await import('@monoes/monograph');
    const projectPath = (input.path as string | undefined) ?? getProjectCwd();
    const { join } = await import('path');
    const dbPath = join(projectPath, '.monomind', 'monograph.db');
    const db = openDb(dbPath);
    try {
      const action = input.action as string;

      if (action === 'add') {
        const filePath = input.filePath as string | undefined;
        const rule = input.rule as string | undefined;
        if (!filePath || !rule) return text('add requires filePath and rule.');
        const line = (input.line as number | undefined) ?? 0;
        const sup = addSuppression(db, filePath, line, rule);
        return text(`Suppression added:\n  id: ${sup.id}\n  file: ${sup.filePath}  line: ${sup.line}  rule: ${sup.rule}`);
      }

      if (action === 'list') {
        const filePath = input.filePath as string | undefined;
        const rule = input.rule as string | undefined;
        const sups = listSuppressions(db, filePath, rule);
        if (sups.length === 0) return text('No suppressions found.');
        const lines = [`Suppressions (${sups.length}):`];
        for (const s of sups) {
          lines.push(`  [${s.id}] ${s.filePath}:${s.line}  rule=${s.rule}  added=${s.addedAt}`);
        }
        return text(lines.join('\n'));
      }

      if (action === 'remove') {
        const id = input.id as string | undefined;
        if (!id) return text('remove requires id.');
        removeSuppression(db, id);
        return text(`Suppression ${id} removed.`);
      }

      if (action === 'stale') {
        const findings = extractFindingsFromDb(db, projectPath);
        const activeFindings = findings.map(f => ({ filePath: f.filePath ?? '', rule: f.type }));
        const stale = findStaleSuppressions(db, activeFindings);
        if (stale.length === 0) return text('No stale suppressions found.');
        const lines = [`Stale suppressions (${stale.length}):`];
        for (const s of stale) {
          lines.push(`  [${s.id}] ${s.filePath}:${s.line}  rule=${s.rule}  reason=${s.reason}`);
        }
        return text(lines.join('\n'));
      }

      return text(`Unknown action: ${action}. Must be one of: add, list, remove, stale.`);
    } finally { closeDb(db); }
  },
};

// ── monograph_regression_check ────────────────────────────────────────────────

const monographRegressionCheckTool: MCPTool = {
  name: 'monograph_regression_check',
  description: 'Check for metric regressions by comparing the current graph state against a saved baseline. Returns PASSED/FAILED with a per-metric breakdown. Use as a CI gate after monograph_build.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the repo (defaults to project cwd)' },
      baselineName: { type: 'string', description: 'Name of the saved baseline (e.g. "main-2026-05-01")' },
      tolerance: { type: 'string', description: 'Default tolerance for all metrics, e.g. "5%" or "10"' },
      metricTolerances: { type: 'object', description: 'Per-metric tolerance overrides as a JSON object, e.g. {"godNodeCount":"2","surpriseCount":"10%"}' },
    },
    required: ['baselineName', 'tolerance'],
  },
  handler: async (input) => {
    const { openDb, closeDb, checkRegression, defaultBaselinePath } = await import('@monoes/monograph');
    const { join } = await import('path');
    const projectPath = (input.path as string | undefined) ?? getProjectCwd();
    const dbPath = join(projectPath, '.monomind', 'monograph.db');
    const baselineName = input.baselineName as string;
    const toleranceSpec = input.tolerance as string;
    const metricTolerances = input.metricTolerances as Record<string, string> | undefined;
    const baselinePath = defaultBaselinePath(projectPath, baselineName);
    const db = openDb(dbPath);
    try {
      const outcome = checkRegression(db, baselinePath, toleranceSpec, metricTolerances);

      const statusLine = outcome.passed
        ? `Regression Check: PASSED ✓`
        : `Regression Check: FAILED ✗`;

      const header = [
        statusLine,
        `Baseline: ${baselineName}  Tolerance: ${toleranceSpec}`,
        '',
        `${'Metric'.padEnd(28)} ${'Baseline'.padStart(8)} ${'Current'.padStart(8)} ${'Delta'.padStart(6)}  Status`,
        `${'-'.repeat(28)} ${'-'.repeat(8)} ${'-'.repeat(8)} ${'-'.repeat(6)}  ${'-'.repeat(20)}`,
      ];

      const rows = outcome.checkedMetrics.map(m => {
        const deltaStr = m.delta > 0 ? `+${m.delta}` : String(m.delta);
        let status: string;
        if (!m.violated) {
          const pctChange = m.baseline > 0 && m.delta > 0
            ? ` (+${((m.delta / m.baseline) * 100).toFixed(1)}%)`
            : '';
          status = m.delta > 0
            ? `OK (within ${m.tolerance}${pctChange})`
            : 'OK';
        } else {
          const pctChange = m.baseline > 0
            ? `+${((m.delta / m.baseline) * 100).toFixed(1)}%`
            : '∞';
          status = `VIOLATED (${pctChange})`;
        }
        return `${m.metric.padEnd(28)} ${String(m.baseline).padStart(8)} ${String(m.current).padStart(8)} ${deltaStr.padStart(6)}  ${status}`;
      });

      const lines = [...header, ...rows, '', outcome.summary];
      return text(lines.join('\n'));
    } finally { closeDb(db); }
  },
};

// ── monograph_clone_detect ────────────────────────────────────────────────────

const monographCloneDetectTool: MCPTool = {
  name: 'monograph_clone_detect',
  description: 'Detect structurally similar or duplicate files using token-normalized Jaccard similarity. Returns clone pairs with similarity scores and emits STRUCTURALLY_SIMILAR edges.',
  inputSchema: {
    type: 'object',
    properties: {
      minSimilarity: { type: 'number', description: 'Minimum Jaccard similarity threshold (0-1, default 0.8)' },
      minTokens: { type: 'number', description: 'Minimum shared token count (default 50)' },
    },
  },
  handler: async (input) => {
    const { openDb, closeDb, detectClones } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = detectClones(db, (input.minSimilarity as number | undefined) ?? 0.8, (input.minTokens as number | undefined) ?? 50);
      return text(JSON.stringify(result, null, 2));
    } finally { closeDb(db); }
  },
};

// ── monograph_similar_files ───────────────────────────────────────────────────

const monographSimilarFilesTool: MCPTool = {
  name: 'monograph_similar_files',
  description: 'Find files most similar to a given file using the MinHash shingle pre-filter. Fast approximate nearest-neighbor search for structural clones.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Target file path to find similar files for' },
      topK: { type: 'number', description: 'Number of similar files to return (default 10)' },
    },
    required: ['filePath'],
  },
  handler: async (input) => {
    const { openDb, closeDb, detectClones } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = detectClones(db, 0.5, 10);
      const filePath = input.filePath as string;
      const matches = result.pairs.filter(p => p.fileA === filePath || p.fileB === filePath);
      return text(JSON.stringify(matches.slice(0, (input.topK as number | undefined) ?? 10), null, 2));
    } finally { closeDb(db); }
  },
};

// ── monograph_maintainability ─────────────────────────────────────────────────

const monographMaintainabilityTool: MCPTool = {
  name: 'monograph_maintainability',
  description: 'Compute Halstead-based Maintainability Index (0-100) for all functions. A=excellent(>85), F=critical(<25). Identifies hardest-to-maintain code.',
  inputSchema: {
    type: 'object',
    properties: {
      maxResults: { type: 'number', description: 'Max results to return (default 50)' },
      minMi: { type: 'number', description: 'Filter to MI below this value (default 65 = B threshold)' },
    },
  },
  handler: async (args) => {
    const { openDb, closeDb, computeMaintainabilityIndex } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const report = computeMaintainabilityIndex(db);
      const filtered = report.results
        .filter(r => r.mi < ((args.minMi as number | undefined) ?? 65))
        .slice(0, (args.maxResults as number | undefined) ?? 50);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ...report, results: filtered }, null, 2) }] };
    } finally { closeDb(db); }
  },
};

// ── monograph_cache_status ────────────────────────────────────────────────────

const monographCacheStatusTool: MCPTool = {
  name: 'monograph_cache_status',
  description: 'Show incremental build cache statistics: total cached files, hit rate, and stale paths that need re-parsing.',
  inputSchema: { type: 'object', properties: {} },
  handler: async (_args) => {
    const { openDb, closeDb, getFileCacheStats } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const stats = getFileCacheStats(db);
      return { content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }] };
    } finally { closeDb(db); }
  },
};

// ── monograph_mirrored_dirs ───────────────────────────────────────────────────

const monographMirroredDirsTool: MCPTool = {
  name: 'monograph_mirrored_dirs',
  description: 'Detect directory subtrees that are structural mirrors of each other (same file basenames). Identifies copy-paste directory structures that could be consolidated.',
  inputSchema: {
    type: 'object',
    properties: {
      minSimilarity: { type: 'number', description: 'Minimum Jaccard similarity for basenames (default 0.7)' },
    },
  },
  handler: async (input) => {
    const { openDb, closeDb, detectMirroredDirs } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const report = detectMirroredDirs(db, (input.minSimilarity as number | undefined) ?? 0.7);
      return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    } finally { closeDb(db); }
  },
};

// ── monograph_cross_reference ─────────────────────────────────────────────────

const monographCrossReferenceTool: MCPTool = {
  name: 'monograph_cross_reference',
  description: 'Cross-reference unreachable files with duplicated files. Files that are BOTH dead code AND structurally duplicated are the highest-confidence safe-delete candidates.',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const { openDb, closeDb, crossReferenceDuplicatesAndDeadCode } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const report = crossReferenceDuplicatesAndDeadCode(db);
      return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    } finally { closeDb(db); }
  },
};

// ── monograph_complexity ──────────────────────────────────────────────────────

const monographComplexityTool: MCPTool = {
  name: 'monograph_complexity',
  description: 'Compute cyclomatic and cognitive complexity for all functions/methods. Returns p50/p90/p95 CC percentiles and identifies high-complexity hotspots (CC > 10).',
  inputSchema: { type: 'object', properties: {} },
  handler: async (_input) => {
    const { openDb, closeDb, computeComplexity } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const report = computeComplexity(db);
      return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
    } finally { closeDb(db); }
  },
};

// ── monograph_crap_score ──────────────────────────────────────────────────────

const monographCrapScoreTool: MCPTool = {
  name: 'monograph_crap_score',
  description: 'Compute CRAP score (CC² × (1-coverage)³ + CC) for all functions. Functions with no test coverage get worst-case CRAP. Identifies change-risky untested code.',
  inputSchema: {
    type: 'object',
    properties: {
      threshold: { type: 'number', description: 'CRAP score threshold to filter results (default 30)' },
    },
  },
  handler: async (input) => {
    const { openDb, closeDb, computeComplexity } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const report = computeComplexity(db);
      const threshold = (input.threshold as number | undefined) ?? 30;
      const risky = report.functions
        .filter(f => f.crapScore >= threshold)
        .sort((a, b) => b.crapScore - a.crapScore);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ threshold, count: risky.length, functions: risky }, null, 2) }] };
    } finally { closeDb(db); }
  },
};

// ── monograph_author_analytics ────────────────────────────────────────────────

const monographAuthorAnalyticsTool: MCPTool = {
  name: 'monograph_author_analytics',
  description: 'Per-author ownership analytics: commit counts, file ownership, bot detection, and ChurnTrend (accelerating/stable/declining). Requires a git repository.',
  inputSchema: {
    type: 'object',
    properties: {
      repoPath: { type: 'string', description: 'Repository root path (default: inferred from db location)' },
    },
  },
  handler: async (args) => {
    const { openDb, closeDb, computeAuthorAnalytics } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const rp = (args.repoPath as string | undefined) ?? getProjectCwd();
      const report = computeAuthorAnalytics(rp, db);
      return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
    } finally { closeDb(db); }
  },
};

// ── monograph_risk_profile ────────────────────────────────────────────────────

const monographRiskProfileTool: MCPTool = {
  name: 'monograph_risk_profile',
  description: 'Risk profile distribution: function size histogram (LOC bins) and parameter count histogram. Shows p50/p90/p95 function size and counts of oversized/high-param functions.',
  inputSchema: { type: 'object', properties: {} },
  handler: async (_args) => {
    const { openDb, closeDb, computeRiskProfile } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const report = computeRiskProfile(db);
      return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
    } finally { closeDb(db); }
  },
};

// ── monograph_explain ─────────────────────────────────────────────────────────

const monographExplainTool: MCPTool = {
  name: 'monograph_explain',
  description: 'Explain a monograph rule: description, rationale, and remediation steps. Use with a ruleId like "god-node", "unreachable-file", "circular-deps". Call with no ruleId to list all rules.',
  inputSchema: {
    type: 'object',
    properties: {
      ruleId: { type: 'string', description: 'Rule ID to explain (e.g. god-node, unreachable-file, circular-deps, high-coupling, isolated-node, boundary-violation, low-cohesion)' },
    },
  },
  handler: async (args) => {
    const { explainRule, listRules } = await import('@monoes/monograph');
    if (!args.ruleId) {
      return { content: [{ type: 'text' as const, text: JSON.stringify(listRules(), null, 2) }] };
    }
    const rule = explainRule(args.ruleId as string);
    if (!rule) {
      return { content: [{ type: 'text' as const, text: `Rule '${args.ruleId}' not found. Available: ${listRules().map(r => r.id).join(', ')}` }] };
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(rule, null, 2) }] };
  },
};

// ── monograph_dep_closure ─────────────────────────────────────────────────────

const monographDepClosureTool: MCPTool = {
  name: 'monograph_dep_closure',
  description: 'Compute full transitive dependency closure for files. Shows direct vs transitive deps, dependency chain depth, and highlights files with unusually deep dependency trees (depth > 5).',
  inputSchema: {
    type: 'object',
    properties: {
      maxNodes: { type: 'number', description: 'Max number of files to analyze (default 100, sorted by degree)' },
    },
  },
  handler: async (args) => {
    const { openDb, closeDb, computeDependencyClosure } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const report = computeDependencyClosure(db, (args.maxNodes as number | undefined) ?? 100);
      return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
    } finally { closeDb(db); }
  },
};

// ── Round 5 tools ─────────────────────────────────────────────────────────────

const monographVitalSignsSnapshotTool: MCPTool = {
  name: 'monograph_vital_signs_snapshot',
  description: 'Save or load VitalSigns+HealthScore timestamped snapshots for trend tracking',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: { type: 'string', enum: ['save', 'load', 'latest'], description: 'save: write snapshot; load: list all; latest: most recent' },
      dir: { type: 'string', description: 'Snapshot directory (default: .monograph/snapshots)' },
      vitalSigns: { type: 'object', description: 'For save: VitalSigns data' },
      healthScore: { type: 'object', description: 'For save: HealthScore data' },
    },
    required: ['action'],
  },
  handler: async (args) => {
    const { buildSnapshot, saveSnapshot, loadSnapshots, latestSnapshot } = await import('@monoes/monograph');
    const dir = (args.dir as string | undefined) ?? '.monograph/snapshots';
    if (args.action === 'save') {
      const snap = buildSnapshot(args.vitalSigns as Record<string, unknown>, args.healthScore as { value: number; grade: string; penalties: Record<string, number> });
      const path = saveSnapshot(dir, snap);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ saved: path, timestamp: snap.timestamp }) }] };
    }
    if (args.action === 'latest') {
      const snap = latestSnapshot(dir);
      return { content: [{ type: 'text' as const, text: JSON.stringify(snap ?? null, null, 2) }] };
    }
    const snaps = loadSnapshots(dir);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ count: snaps.length, snapshots: snaps.map(s => ({ timestamp: s.timestamp, healthScore: s.healthScore?.value })) }, null, 2) }] };
  },
};

const monographHealthTrendTool: MCPTool = {
  name: 'monograph_health_trend',
  description: 'Compare current VitalSigns against the most recent snapshot to produce per-metric trend directions',
  inputSchema: {
    type: 'object' as const,
    properties: {
      current: { type: 'object', description: 'Current metrics (keyed numeric values)' },
      snapshotDir: { type: 'string', description: 'Directory containing snapshots' },
    },
    required: ['current'],
  },
  handler: async (args) => {
    const { computeTrend, latestSnapshot, trendArrow } = await import('@monoes/monograph');
    const dir = (args.snapshotDir as string | undefined) ?? '.monograph/snapshots';
    const prev = latestSnapshot(dir);
    if (!prev) return { content: [{ type: 'text' as const, text: 'No previous snapshot found' }] };
    const trend = computeTrend(args.current as Record<string, number>, prev);
    const summary = Object.entries(trend).map(([k, v]: [string, unknown]) => {
      const t = v as { direction: string; delta: number; current: number; previous: number };
      return `${k}: ${trendArrow(t.direction as 'improving' | 'declining' | 'stable')} ${t.delta >= 0 ? '+' : ''}${t.delta.toFixed(2)} (${t.previous.toFixed(1)} → ${t.current.toFixed(1)})`;
    });
    return { content: [{ type: 'text' as const, text: summary.join('\n') }] };
  },
};

const monographHealthScoreComputeTool: MCPTool = {
  name: 'monograph_health_score_compute',
  description: 'Compute a 0–100 health score from VitalSigns with 11 weighted penalty components',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vitalSigns: { type: 'object', description: 'VitalSignsInput object with all metric fields' },
      totalFiles: { type: 'number', description: 'Total file count in the project' },
    },
    required: ['vitalSigns'],
  },
  handler: async (args) => {
    const { computeHealthScore } = await import('@monoes/monograph');
    const score = computeHealthScore(args.vitalSigns as Parameters<typeof computeHealthScore>[0], (args.totalFiles as number | undefined) ?? 1);
    return { content: [{ type: 'text' as const, text: JSON.stringify(score, null, 2) }] };
  },
};

const monographRiskProfileTool: MCPTool = {
  name: 'monograph_risk_profile',
  description: 'Compute function size and parameter-count risk profiles (low/medium/high/veryHigh bins)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      lineCounts: { type: 'array', items: { type: 'number' }, description: 'LOC per function for size profile' },
      paramCounts: { type: 'array', items: { type: 'number' }, description: 'Param count per function for interfacing profile' },
      fanInScores: { type: 'array', items: { type: 'number' }, description: 'Fan-in scores for coupling concentration' },
    },
  },
  handler: async (args) => {
    const { computeSizeRiskProfile, computeInterfacingRiskProfile, computeCouplingConcentration } = await import('@monoes/monograph');
    const result: Record<string, unknown> = {};
    if (args.lineCounts) result['sizeRiskProfile'] = computeSizeRiskProfile(args.lineCounts as number[]);
    if (args.paramCounts) result['interfacingRiskProfile'] = computeInterfacingRiskProfile(args.paramCounts as number[]);
    if (args.fanInScores) result['couplingConcentration'] = computeCouplingConcentration(args.fanInScores as number[]);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
};

const monographLargeFunctionsTool: MCPTool = {
  name: 'monograph_large_functions',
  description: 'Detect functions exceeding LOC threshold; reports when ≥3% of functions are very large',
  inputSchema: {
    type: 'object' as const,
    properties: {
      threshold: { type: 'number', description: 'LOC threshold (default 60)' },
    },
  },
  handler: async (args) => {
    const { detectLargeFunctions } = await import('@monoes/monograph');
    const { openDb, closeDb } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const entries = detectLargeFunctions(db, (args.threshold as number | undefined) ?? 60);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ count: entries.length, entries: entries.slice(0, 50) }, null, 2) }] };
    } finally { closeDb(db); }
  },
};

const monographOwnershipTool: MCPTool = {
  name: 'monograph_ownership',
  description: 'Compute bus factor and ownership metrics from git contributor data',
  inputSchema: {
    type: 'object' as const,
    properties: {
      contributors: { type: 'array', description: 'Array of ContributorEntry objects' },
      driftedCount: { type: 'number', description: 'Number of drifted hotspot files' },
    },
    required: ['contributors'],
  },
  handler: async (args) => {
    const { computeOwnershipMetrics } = await import('@monoes/monograph');
    const metrics = computeOwnershipMetrics(
      args.contributors as Parameters<typeof computeOwnershipMetrics>[0],
      (args.driftedCount as number | undefined) ?? 0,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(metrics, null, 2) }] };
  },
};

const monographChurnTool: MCPTool = {
  name: 'monograph_churn',
  description: 'Analyze git churn per file with exponential recency decay (90-day half-life)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      since: { type: 'string', description: 'Time range: 7d, 2w, 3m, 1y, or ISO date' },
      root: { type: 'string', description: 'Project root directory' },
    },
  },
  handler: async (args) => {
    const { analyzeChurn, parseSince } = await import('@monoes/monograph');
    const root = (args.root as string | undefined) ?? getProjectCwd();
    const since = parseSince((args.since as string | undefined) ?? '3m');
    const result = analyzeChurn(root, since);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ totalFiles: result.files.length, top20: result.files.slice(0, 20) }, null, 2) }] };
  },
};

const monographHotspotsComputeTool: MCPTool = {
  name: 'monograph_hotspots_compute',
  description: 'Score files by churn × complexity density to identify hotspots',
  inputSchema: {
    type: 'object' as const,
    properties: {
      inputs: { type: 'array', description: 'Array of {filePath, weightedCommits, complexityDensity}' },
      minCommits: { type: 'number', description: 'Minimum commits to include a file' },
    },
    required: ['inputs'],
  },
  handler: async (args) => {
    const { computeHotspots } = await import('@monoes/monograph');
    const { entries, summary } = computeHotspots(
      args.inputs as Parameters<typeof computeHotspots>[0],
      args.minCommits as number | undefined,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify({ summary, top20: entries.slice(0, 20) }, null, 2) }] };
  },
};

const monographRuntimeCoverageHealthTool: MCPTool = {
  name: 'monograph_runtime_coverage_health',
  description: 'Classify files by runtime coverage verdict + risk band + recommended action',
  inputSchema: {
    type: 'object' as const,
    properties: {
      files: { type: 'array', description: 'Array of {filePath, staticVerdict, runtimeVerdict}' },
    },
    required: ['files'],
  },
  handler: async (args) => {
    const { classifyRuntimeCoverageHealth } = await import('@monoes/monograph');
    const files = args.files as Array<{ filePath: string; staticVerdict: 'unused' | 'used' | 'unknown'; runtimeVerdict: string }>;
    const results = files.map(f => classifyRuntimeCoverageHealth(f.filePath, f.staticVerdict, f.runtimeVerdict as Parameters<typeof classifyRuntimeCoverageHealth>[2]));
    return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
  },
};

const monographHealthGroupTool: MCPTool = {
  name: 'monograph_health_group',
  description: 'Group files by directory/owner/package/section for per-team health dashboards',
  inputSchema: {
    type: 'object' as const,
    properties: {
      grouping: { type: 'string', enum: ['directory', 'owner', 'package', 'section'], description: 'Grouping dimension' },
    },
    required: ['grouping'],
  },
  handler: async (args) => {
    const { groupFilesByKey } = await import('@monoes/monograph');
    const { openDb, closeDb } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const rows = db.prepare(`SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL`).all() as { file_path: string }[];
      const filePaths = rows.map(r => r.file_path);
      const groups = groupFilesByKey(filePaths, args.grouping as Parameters<typeof groupFilesByKey>[1]);
      return { content: [{ type: 'text' as const, text: JSON.stringify(groups.slice(0, 50), null, 2) }] };
    } finally { closeDb(db); }
  },
};

const monographChurnTraceTool: MCPTool = {
  name: 'monograph_trace',
  description: 'Trace why an export is used/unused, show file import/export map, or trace a package dependency',
  inputSchema: {
    type: 'object' as const,
    properties: {
      kind: { type: 'string', enum: ['export', 'file', 'dependency'], description: 'Trace type' },
      target: { type: 'string', description: 'File path (for export/file) or package name (for dependency)' },
      exportName: { type: 'string', description: 'Export name (for export trace)' },
    },
    required: ['kind', 'target'],
  },
  handler: async (args) => {
    const { traceExport, traceFile, traceDependency } = await import('@monoes/monograph');
    const { openDb, closeDb } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      let result: unknown;
      if (args.kind === 'export') result = traceExport(db, args.target as string, (args.exportName as string | undefined) ?? '');
      else if (args.kind === 'file') result = traceFile(db, args.target as string);
      else result = traceDependency(db, args.target as string);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } finally { closeDb(db); }
  },
};

const monographChangedFilesTool: MCPTool = {
  name: 'monograph_changed_files',
  description: 'Get files changed since a git ref (validates ref to prevent injection)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      sinceRef: { type: 'string', description: 'Git ref (branch, tag, commit SHA)' },
      root: { type: 'string', description: 'Project root directory' },
    },
    required: ['sinceRef'],
  },
  handler: async (args) => {
    const { getChangedFiles } = await import('@monoes/monograph');
    const root = (args.root as string | undefined) ?? getProjectCwd();
    const files = getChangedFiles(root, args.sinceRef as string);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ count: files.size, files: [...files].sort() }, null, 2) }] };
  },
};

const monographSuppressionsCheckTool: MCPTool = {
  name: 'monograph_suppressions_check',
  description: 'Find stale suppression comments that no longer match any real finding',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
  handler: async (_args) => {
    return { content: [{ type: 'text' as const, text: 'Stale suppression detection requires active analysis results. Pass suppressions via the API.' }] };
  },
};

const monographHealthBaselineTool: MCPTool = {
  name: 'monograph_health_baseline',
  description: 'Save health findings baseline and filter to show only new regressions',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: { type: 'string', enum: ['save', 'filter'], description: 'save: build baseline from findings; filter: return only new findings' },
      findings: { type: 'array', description: 'Array of HealthFinding objects' },
      root: { type: 'string', description: 'Project root for relative path keys' },
    },
    required: ['action', 'findings'],
  },
  handler: async (args) => {
    const { buildHealthBaseline } = await import('@monoes/monograph');
    const root = (args.root as string | undefined) ?? getProjectCwd();
    const baseline = buildHealthBaseline(args.findings as Parameters<typeof buildHealthBaseline>[0], root);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ fileCount: baseline.counts.size }, null, 2) }] };
  },
};

const monographRegressionConfigTool: MCPTool = {
  name: 'monograph_regression_config',
  description: 'Parse tolerance strings (5 or 2%) and persist baseline counts to config file',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: { type: 'string', enum: ['parse', 'save', 'check'] },
      tolerance: { type: 'string', description: 'For parse/check: tolerance string like "5" or "2%"' },
      baseline: { type: 'number', description: 'For check: baseline count' },
      current: { type: 'number', description: 'For check: current count' },
      configPath: { type: 'string', description: 'For save: config file path' },
      counts: { type: 'object', description: 'For save: counts to persist' },
    },
    required: ['action'],
  },
  handler: async (args) => {
    const { parseTolerance, toleranceExceeded, saveBaselineToConfig } = await import('@monoes/monograph');
    if (args.action === 'parse') {
      return { content: [{ type: 'text' as const, text: JSON.stringify(parseTolerance(args.tolerance as string)) }] };
    }
    if (args.action === 'check') {
      const tol = parseTolerance(args.tolerance as string);
      const exceeded = toleranceExceeded(tol, args.baseline as number, args.current as number);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ exceeded, tolerance: tol }) }] };
    }
    saveBaselineToConfig(args.configPath as string, args.counts as Record<string, number>);
    return { content: [{ type: 'text' as const, text: 'Baseline saved to config' }] };
  },
};

const monographEnumMemberFixTool: MCPTool = {
  name: 'monograph_fix_enum_members',
  description: 'Auto-remove unused enum members; promotes to whole-enum deletion when body becomes empty',
  inputSchema: {
    type: 'object' as const,
    properties: {
      fixes: { type: 'array', description: 'Array of {filePath, enumName, memberName} fix targets' },
    },
    required: ['fixes'],
  },
  handler: async (args) => {
    const { fixEnumMembers } = await import('@monoes/monograph');
    const result = fixEnumMembers(args.fixes as Parameters<typeof fixEnumMembers>[0]);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
};

const monographCodeownersGitlabTool: MCPTool = {
  name: 'monograph_codeowners_gitlab',
  description: 'Parse GitLab-style CODEOWNERS with sections, optional sections, negation patterns, and per-section defaults',
  inputSchema: {
    type: 'object' as const,
    properties: {
      content: { type: 'string', description: 'CODEOWNERS file content' },
      filePath: { type: 'string', description: 'File path to look up owner/section for' },
    },
    required: ['content'],
  },
  handler: async (args) => {
    const { parseCodeownersWithSections, matchOwners, hasSections } = await import('@monoes/monograph');
    const entries = parseCodeownersWithSections(args.content as string);
    if (args.filePath) {
      const { owners, section } = matchOwners(entries, args.filePath as string);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ owners, section, hasSections: hasSections(entries) }, null, 2) }] };
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify({ entryCount: entries.length, hasSections: hasSections(entries) }, null, 2) }] };
  },
};

const monographCodeLensTool: MCPTool = {
  name: 'monograph_code_lens',
  description: 'Build LSP CodeLens items showing reference counts above export declarations',
  inputSchema: {
    type: 'object' as const,
    properties: {
      usages: { type: 'array', description: 'Array of ExportUsage objects with line, col, exportName, referenceLocations' },
      documentUri: { type: 'string', description: 'LSP document URI' },
    },
    required: ['usages', 'documentUri'],
  },
  handler: async (args) => {
    const { buildCodeLenses } = await import('@monoes/monograph');
    const lenses = buildCodeLenses(args.usages as Parameters<typeof buildCodeLenses>[0], args.documentUri as string);
    return { content: [{ type: 'text' as const, text: JSON.stringify(lenses, null, 2) }] };
  },
};

const monographLspHoverTool: MCPTool = {
  name: 'monograph_lsp_hover',
  description: 'Build LSP Hover content for unused exports and duplication at a cursor position',
  inputSchema: {
    type: 'object' as const,
    properties: {
      unusedExports: { type: 'array', description: 'UnusedExportInfo array for the file' },
      duplication: { type: 'array', description: 'DuplicationInfo array for the file' },
      line: { type: 'number', description: 'Cursor line (0-based LSP)' },
      character: { type: 'number', description: 'Cursor character (0-based LSP)' },
      filePath: { type: 'string', description: 'File path' },
    },
    required: ['line', 'character', 'filePath'],
  },
  handler: async (args) => {
    const { buildHover } = await import('@monoes/monograph');
    const hover = buildHover(
      (args.unusedExports as Parameters<typeof buildHover>[0]) ?? [],
      (args.duplication as Parameters<typeof buildHover>[1]) ?? [],
      { line: args.line as number, character: args.character as number },
      args.filePath as string,
    );
    return { content: [{ type: 'text' as const, text: hover ? hover.contents : '(no hover)' }] };
  },
};

const monographLspDiagnosticsExtTool: MCPTool = {
  name: 'monograph_lsp_diagnostics_ext',
  description: 'Build LSP diagnostics for duplicate exports (with relatedInformation) and stale suppressions (tagged Unnecessary)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      duplicateExportGroups: { type: 'array', description: 'DuplicateExportGroup array' },
      staleSuppressions: { type: 'array', description: 'StaleSuppressionInfo array' },
    },
  },
  handler: async (args) => {
    const { buildDuplicateExportDiagnostics, buildStaleSuppressionDiagnostics } = await import('@monoes/monograph');
    const result: Record<string, unknown> = {};
    if (args.duplicateExportGroups) {
      const map = buildDuplicateExportDiagnostics(args.duplicateExportGroups as Parameters<typeof buildDuplicateExportDiagnostics>[0]);
      result['duplicateExports'] = Object.fromEntries(map);
    }
    if (args.staleSuppressions) {
      const map = buildStaleSuppressionDiagnostics(args.staleSuppressions as Parameters<typeof buildStaleSuppressionDiagnostics>[0]);
      result['staleSuppressions'] = Object.fromEntries(map);
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
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
  monographHealthScoreTool,
  monographBoundaryCheckTool,
  monographCodeownersTool,
  monographSuppressTool,
  monographRegressionCheckTool,
  monographCloneDetectTool,
  monographSimilarFilesTool,
  monographMaintainabilityTool,
  monographCacheStatusTool,
  monographComplexityTool,
  monographCrapScoreTool,
  monographMirroredDirsTool,
  monographCrossReferenceTool,
  monographAuthorAnalyticsTool,
  monographRiskProfileTool,
  monographExplainTool,
  monographDepClosureTool,
  monographCyclesTool,
  monographCoverageGapsTool,
  monographDuplicateExportsTool,
  monographRefactoringTargetsTool,
  monographAuditTool,
  monographPrivateTypeLeaksTool,
  monographFixExportsTool,
  monographFixDepsTool,
  monographClassifyDepsTool,
  monographBadgeTool,
  monographCodeClimateTool,
  monographCompactTool,
  monographMarkdownTool,
  monographRuntimeCoverageTool,
  monographCiTemplateTool,
  monographMigrateKnipTool,
  monographMigrateJscpdTool,
  monographLspDiagnosticsTool,
  monographVitalSignsSnapshotTool,
  monographHealthTrendTool,
  monographHealthScoreComputeTool,
  monographRiskProfileTool,
  monographLargeFunctionsTool,
  monographOwnershipTool,
  monographChurnTool,
  monographHotspotsComputeTool,
  monographRuntimeCoverageHealthTool,
  monographHealthGroupTool,
  monographChurnTraceTool,
  monographChangedFilesTool,
  monographSuppressionsCheckTool,
  monographHealthBaselineTool,
  monographRegressionConfigTool,
  monographEnumMemberFixTool,
  monographCodeownersGitlabTool,
  monographCodeLensTool,
  monographLspHoverTool,
  monographLspDiagnosticsExtTool,
];
