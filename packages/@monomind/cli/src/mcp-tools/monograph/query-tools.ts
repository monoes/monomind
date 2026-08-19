import type { MCPTool } from '../types.js';
import { getProjectCwd } from '../types.js';
import { getDbPath, _isValidDb, text, applyPprRerank, computeCommitsBehind, triggerBackgroundBuildIfNeeded, STALENESS_THRESHOLD, preferSymbolHits } from './shared.js';
import type { PprScoredNode } from './shared.js';

// ── monograph_query ───────────────────────────────────────────────────────────

export const monographQueryTool: MCPTool = {
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
      tokenBudget: { type: 'number', description: 'P2-9: Prune results to fit within this approximate token budget (drops lowest-scored results first)' },
    },
    required: ['query'],
  },
  handler: async (input) => {
    const dbPath = getDbPath();
    if (!_isValidDb(dbPath)) return text('Monograph index not built yet. Run monograph_build first.');
    const { openDb, closeDb, ftsSearch } = await import('@monoes/monograph');
    const { bm25Query } = await import('@monoes/monograph');
    const db = openDb(dbPath);
    try {
      // Cap limit: passed directly to SQLite queries and bm25Query; an
      // unlimited value saturates memory with rows.
      const MAX_QUERY_LIMIT = 1_000;
      const rawLimit = (input.limit as number | undefined) ?? 20;
      const limit = Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), MAX_QUERY_LIMIT)
        : 20;
      // Cap query: passed to FTS5 and bm25Query; very long queries waste
      // parse time and can stress the FTS tokenizer.
      const MAX_MONOGRAPH_QUERY_LEN = 16 * 1024;
      const rawQuery = input.query as string;
      const query = typeof rawQuery === 'string' && rawQuery.length > MAX_MONOGRAPH_QUERY_LEN
        ? rawQuery.slice(0, MAX_MONOGRAPH_QUERY_LEN)
        : rawQuery;
      const label = input.label as string | undefined;
      const rerank = (input.rerank as boolean | undefined) ?? true;
      const damping = (input.damping as number | undefined) ?? 0.5;
      const tokenBudget = input.tokenBudget as number | undefined;

      // P2-9/P2-10: Post-processing for token budget and reason annotations.
      // Applied after all search paths below via a shared helper.
      function annotateAndPrune(results: Array<{ label: string; name: string; filePath?: string; startLine?: number | null; score: number; boostedByNeighbors?: boolean }>): string[] {
        const lines = results.map(r => {
          const loc = r.filePath ? (r.startLine != null ? `${r.filePath}:${r.startLine}` : r.filePath) : '';
          const tag = r.boostedByNeighbors ? ' [PPR-boosted]' : '';
          // P2-10: Agentic reason field — deterministic template, no LLM call.
          const reasonParts: string[] = [];
          reasonParts.push(`score: ${r.score.toFixed(3)}`);
          if (r.boostedByNeighbors) reasonParts.push('boosted by graph neighbors');
          else reasonParts.push('direct BM25 match');
          const reason = `reason: ${reasonParts.join(', ')}`;
          return `[${r.label}] ${r.name}  ${loc}  (${reason})${tag}`;
        });
        // P2-9: Token-budget pruning — ~4 chars per token heuristic.
        if (tokenBudget && tokenBudget > 0) {
          let totalChars = 0;
          const pruned: string[] = [];
          for (const line of lines) { // already sorted by score desc
            const lineChars = line.length + 1; // +1 for newline
            if (totalChars + lineChars > tokenBudget * 4) break;
            totalChars += lineChars;
            pruned.push(line);
          }
          if (pruned.length < lines.length) {
            pruned.push(`(${lines.length - pruned.length} more results pruned to fit token budget of ${tokenBudget})`);
          }
          return pruned;
        }
        return lines;
      }

      const zeroResultHint = /\s/.test(query) && !/[A-Z]/.test(query.replace(/\s+/g, '').slice(1))
        ? ' Hint: monograph indexes identifiers and filenames — try camelCase/PascalCase (e.g. "AgentSpawn") or a filename instead of a phrase.'
        : '';

      // Lightweight staleness check — fire-and-forget background rebuild;
      // append warning to results so the agent knows data may be outdated.
      let stalenessNote = '';
      const repoPath = getProjectCwd();
      const staleness = await computeCommitsBehind(repoPath);
      if (staleness && staleness.commitsBehind > 0) {
        const triggered = triggerBackgroundBuildIfNeeded(repoPath, staleness.commitsBehind);
        stalenessNote = `\n⚠ Index is ${staleness.commitsBehind} commit(s) behind HEAD${triggered ? ' — rebuild triggered' : ''}.`;
      }

      if (process.env['MONOGRAPH_EMBEDDINGS'] === 'true') {
        const results = await bm25Query(db, query, { limit: rerank ? limit * 2 : limit, label });
        if (results.length === 0) return text('No results found.' + zeroResultHint + stalenessNote);

        if (rerank) {
          const seeds: PprScoredNode[] = results.map(r => ({
            id: r.id, name: r.name ?? r.id, label: r.label ?? '?',
            filePath: r.filePath ?? '', startLine: r.startLine ?? null,
            score: r.score,
          }));
          const reranked = applyPprRerank(db, seeds, damping, limit);
          const lines = annotateAndPrune(reranked);
          return text(lines.join('\n') + stalenessNote);
        }

        const lines = annotateAndPrune(results.map(r => ({
          id: r.id, label: r.label ?? '?', name: r.name ?? r.id,
          filePath: r.filePath ?? '', startLine: r.startLine ?? null,
          score: r.score, boostedByNeighbors: false,
        })));
        return text(lines.join('\n') + stalenessNote);
      }

      const results = ftsSearch(db, query, rerank ? limit * 2 : limit, label);
      if (results.length === 0) return text('No results found.' + zeroResultHint + stalenessNote);

      if (rerank) {
        const seeds: PprScoredNode[] = results.map(r => ({
          id: r.id, name: r.name, label: r.label,
          filePath: r.filePath ?? '', startLine: r.startLine ?? null,
          score: Math.abs(r.rank),
        }));
        const reranked = applyPprRerank(db, seeds, damping, limit);
        const lines = annotateAndPrune(reranked);
        return text(lines.join('\n') + stalenessNote);
      }

      const lines = annotateAndPrune(results.map(r => ({
        label: r.label, name: r.name,
        filePath: r.filePath ?? '', startLine: r.startLine ?? null,
        score: Math.abs(r.rank), boostedByNeighbors: false,
      })));
      return text(lines.join('\n') + stalenessNote);
    } finally { closeDb(db); }
  },
};

// ── monograph_suggest ─────────────────────────────────────────────────────────

export const monographSuggestTool: MCPTool = {
  name: 'monograph_suggest',
  description: 'Get graph-topology-derived questions to explore the codebase. Pass task= to score by task relevance via BM25/FTS5.',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Optional task description for task-relevance scoring' },
      limit: { type: 'number', description: 'Max questions (default 10)' },
      checkStaleness: { type: 'boolean', description: 'Check index staleness first and trigger a background rebuild when the index is behind HEAD. Appends a _staleness annotation to the result. (default true — pass false to skip the git check)' },
    },
  },
  handler: async (input) => {
    // Health-aware mode (formerly monograph_suggest_auto): check staleness and
    // trigger a background rebuild if the index is behind HEAD. Defaults on
    // (opt-out, not opt-in) — a caller that never checked was exactly how a
    // stale graph kept serving results silently.
    let stalenessAnnotation = '';
    if (input.checkStaleness !== false) {
      const repoPath = getProjectCwd();
      const stalenessResult = await computeCommitsBehind(repoPath);
      const commitsBehind = stalenessResult?.commitsBehind ?? 0;
      const triggered = triggerBackgroundBuildIfNeeded(repoPath, commitsBehind, STALENESS_THRESHOLD + 1);
      const status: 'fresh' | 'stale' | 'building' =
        triggered ? 'building' : commitsBehind === 0 ? 'fresh' : 'stale';
      stalenessAnnotation = `\n_staleness: ${JSON.stringify({ commitsBehind, status, triggered })}`;
    }
    const dbPath = getDbPath();
    if (!_isValidDb(dbPath)) return text('Monograph index not built yet. Run monograph_build first.' + stalenessAnnotation);
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { bm25Query } = await import('@monoes/monograph');
    const db = openDb(dbPath);
    try {
      // Cap limit and task: limit is passed directly to SQL LIMIT clause;
      // task is forwarded to bm25Query (embedding path) or FTS.
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

      // When a task is provided, use BM25/FTS5 (via bm25Query) to find
      // relevant nodes and restrict the edge-level questions to them. This
      // used to be gated behind MONOGRAPH_EMBEDDINGS=true, but bm25Query
      // is BM25-only now (the embeddings table stayed empty in practice —
      // see hybrid-query.ts) so the env var gated nothing and just left this
      // better-ranked path off unless a caller happened to know about it.
      let hitIds: string[] = [];
      if (task) {
        const hits = await bm25Query(db, task, { limit: 20 });
        const { SYMBOL_NODE_LABELS } = await import('@monoes/monograph');
        const relevantHits = preferSymbolHits(hits, SYMBOL_NODE_LABELS);
        hitIds = [...new Set(relevantHits.map(h => h.id))];
        if (hitIds.length === 0) {
          return text('No suggestions for this task. Run monograph_build first or try a different query.' + stalenessAnnotation);
        }
      }

      const taskFilter = hitIds.length
        ? `AND (e.source_id IN (${hitIds.map(() => '?').join(',')}) OR e.target_id IN (${hitIds.map(() => '?').join(',')}))`
        : '';
      const rows = db.prepare(`
        SELECT e.relation, e.confidence, n1.name as src, n2.name as tgt,
               n1.file_path as src_file, n1.start_line as src_line,
               n2.file_path as tgt_file, n2.start_line as tgt_line
        FROM edges e
        JOIN nodes n1 ON n1.id = e.source_id
        JOIN nodes n2 ON n2.id = e.target_id
        WHERE e.confidence IN ('AMBIGUOUS', 'INFERRED')
        ${taskFilter}
        LIMIT 100
      `).all(...hitIds, ...hitIds) as any[];

      const questions = rows.map(formatSuggestion);
      const fallback = task ? 'No suggestions for this task. Run monograph_build first.' : 'No suggestions. Run monograph_build first.';
      return text((questions.slice(0, limit).join('\n') || fallback) + stalenessAnnotation);
    } finally { closeDb(db); }
  },
};

// ── monograph_context ─────────────────────────────────────────────────────────

export const monographContextTool: MCPTool = {
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

// ── monograph_neighbors ───────────────────────────────────────────────────────

export const monographNeighborsTool: MCPTool = {
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

// ── monograph_get_node ────────────────────────────────────────────────────────

export const monographGetNodeTool: MCPTool = {
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

// ── monograph_god_nodes ───────────────────────────────────────────────────────

export const monographGodNodesTool: MCPTool = {
  name: 'monograph_god_nodes',
  description: 'Return the top-N most connected real code entities (excludes File/Folder/Community nodes).',
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'number', description: 'Max nodes to return (default 20)' } },
  },
  handler: async (input) => {
    const dbPath = getDbPath();
    if (!_isValidDb(dbPath)) return text('Monograph index not built yet. Run monograph_build first.');
    const { openDb, closeDb } = await import('@monoes/monograph');
    const db = openDb(dbPath);
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

// ── monograph_augment ─────────────────────────────────────────────────────────

export const monographAugmentTool: MCPTool = {
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

// ── monograph_cypher ──────────────────────────────────────────────────────────

export const monographCypherTool: MCPTool = {
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

// ── monograph_shortest_path ───────────────────────────────────────────────────

export const monographShortestPathTool: MCPTool = {
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
