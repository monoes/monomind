import { join, resolve, sep } from 'path';
import type { MCPTool } from '../types.js';
import { getProjectCwd } from '../types.js';
import { getDbPath, text } from './shared.js';

// Columns needed to render/export the graph — deliberately excludes `embedding`,
// which can be several KB per node (384D vectors) and would otherwise bloat
// tool-result payloads and written files by many MB.
const NODE_RENDER_COLUMNS =
  'id, label, name, norm_label, file_path, start_line, end_line, community_id, is_exported, language, properties';

// ── monograph_visualize ───────────────────────────────────────────────────────

export const monographVisualizeTool: MCPTool = {
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
      const rawMaxNodes = (input.maxNodes as number | undefined) ?? 500;
      const limit = Number.isFinite(rawMaxNodes) && rawMaxNodes > 0
        ? Math.min(Math.floor(rawMaxNodes), MAX_EXPORT_NODES)
        : 500;
      const nodes = db.prepare(`SELECT ${NODE_RENDER_COLUMNS} FROM nodes LIMIT ?`).all(limit) as any[];
      // Only include edges where both endpoints are in the visible node set
      const edges = db.prepare(`
        SELECT e.* FROM edges e
        WHERE e.source_id IN (SELECT id FROM nodes LIMIT ?)
          AND e.target_id IN (SELECT id FROM nodes LIMIT ?)
        LIMIT ?
      `).all(limit, limit, limit * 3) as any[];
      const fmt = (input.format as string | undefined) ?? 'html';
      const rendered = fmt === 'json' ? toJson(nodes as any, edges as any)
        : fmt === 'svg' ? toSvg(nodes as any, edges as any)
        : toHtml(nodes as any, edges as any);
      const ext = fmt === 'json' ? 'json' : fmt === 'svg' ? 'svg' : 'html';
      const outDir = resolve(join(getProjectCwd(), '.monomind', 'visualize'));
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, `graph-${Date.now()}.${ext}`);
      writeFileSync(outPath, rendered);
      return text(`Visualization written to ${outPath} (${nodes.length} nodes, ${edges.length} edges)${ext === 'html' ? '\nNote: HTML uses the vis-network CDN script and requires network access to render.' : ''}`);
    } finally { closeDb(db); }
  },
};

// ── monograph_export ────────────────────────────────────────────────────────

export const monographExportTool: MCPTool = {
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
      const nodes = db.prepare(`SELECT ${NODE_RENDER_COLUMNS} FROM nodes`).all() as any[];
      const edges = db.prepare('SELECT * FROM edges').all() as any[];
      const fmt = input.format as string;
      const requestedOut = (input.outputPath as string | undefined) ?? join(getProjectCwd(), '.monomind', 'export');
      const outDir = resolve(getProjectCwd(), requestedOut);
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
      if (fmt === 'obsidian') {
        toObsidian(nodes as any, edges as any, outDir);
        return text(`Exported Obsidian vault to ${outDir}`);
      }
      if (fmt === 'canvas') {
        const p = join(outDir, 'graph.canvas');
        writeFileSync(p, toCanvas(nodes as any, edges as any));
        return text(`Exported Canvas to ${p}`);
      }
      return text(`Format ${fmt} export written to ${outDir}`);
    } finally { closeDb(db); }
  },
};

// ── monograph_snapshot ──────────────────────────────────────────────────────

export const monographSnapshotTool: MCPTool = {
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

// ── monograph_diff ──────────────────────────────────────────────────────────

export const monographDiffTool: MCPTool = {
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
    const indexNodes = (nodes: Array<NodeRef & { id?: string }>) => {
      for (const n of nodes) { if (n.id) nodeById.set(n.id as string, n); }
    };
    indexNodes(before.nodes as unknown as Array<NodeRef & { id?: string }>);
    indexNodes(after.nodes as unknown as Array<NodeRef & { id?: string }>);

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

// ── monograph_report ────────────────────────────────────────────────────────

export const monographReportTool: MCPTool = {
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

      const rawOutPath = (input.path as string | undefined) ?? join(getProjectCwd(), '.monomind', 'GRAPH_REPORT.md');
      const outPath = resolve(getProjectCwd(), rawOutPath);
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

// ── monograph_wiki ──────────────────────────────────────────────────────────

export const monographWikiTool: MCPTool = {
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

// ── monograph_wiki_build ────────────────────────────────────────────────────

export const monographWikiBuildTool: MCPTool = {
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

// ── monograph_serve ─────────────────────────────────────────────────────────

export const monographServeTool: MCPTool = {
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
