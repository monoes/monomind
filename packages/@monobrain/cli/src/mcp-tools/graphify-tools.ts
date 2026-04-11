/**
 * Graphify MCP Tools
 *
 * Bridges @monobrain/graph's knowledge graph into monobrain's MCP tool surface.
 * Agents can query the codebase knowledge graph without reading files —
 * god_nodes(), query_graph(), shortest_path() give structural understanding
 * in milliseconds vs. reading dozens of source files.
 *
 * Graph is built automatically on `monobrain init` and stored at
 * .monobrain/graph/graph.json (legacy: graphify-out/graph.json).
 * Rebuild manually: call graphify_build via MCP.
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { type MCPTool, getProjectCwd } from './types.js';

// ── Path helpers ──────────────────────────────────────────────────────────────

/** Resolve graph path: prefer native monobrain path, fall back to legacy graphify path. */
function getGraphPath(cwd: string): string {
  const nativePath = resolve(join(cwd, '.monobrain', 'graph', 'graph.json'));
  const legacyPath = resolve(join(cwd, 'graphify-out', 'graph.json'));
  if (existsSync(nativePath)) return nativePath;
  if (existsSync(legacyPath)) return legacyPath;
  return nativePath; // return expected path even if not yet built
}

function graphExists(cwd: string): boolean {
  return existsSync(getGraphPath(cwd));
}

// ── Graph loading ─────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label?: string;
  source_file?: string;
  source_location?: string;
  community?: number | null;
  file_type?: string;
  [key: string]: unknown;
}

interface GraphEdge {
  source: string;
  target: string;
  relation?: string;
  confidence?: string;
  confidence_score?: number;
  [key: string]: unknown;
}

interface RawGraphData {
  nodes?: GraphNode[];
  links?: GraphEdge[];
  edges?: GraphEdge[];
}

interface LoadedGraph {
  nodes: Map<string, GraphNode>;
  /** adjacency: nodeId -> outgoing neighbor ids */
  adj: Map<string, string[]>;
  /** reverse adjacency: nodeId -> incoming neighbor ids */
  radj: Map<string, string[]>;
  edges: GraphEdge[];
  /** Degree (in + out) per node */
  degree: Map<string, number>;
  graphPath: string;
}

/**
 * Load the knowledge graph.
 * Tries @monobrain/graph's loadGraph first; falls back to parsing raw JSON.
 */
async function loadKnowledgeGraph(cwd: string): Promise<LoadedGraph> {
  const graphPath = getGraphPath(cwd);

  let rawNodes: GraphNode[] = [];
  let rawEdges: GraphEdge[] = [];

  try {
    // Prefer @monobrain/graph's loader which handles format normalization.
    const { loadGraph } = await import('@monobrain/graph') as unknown as {
      loadGraph: (p: string) => { nodes: GraphNode[]; edges: GraphEdge[] };
    };
    const loaded = loadGraph(graphPath);
    rawNodes = loaded.nodes;
    rawEdges = loaded.edges;
  } catch {
    // Fallback: parse JSON directly
    const data: RawGraphData = JSON.parse(readFileSync(graphPath, 'utf-8'));
    rawNodes = data.nodes || [];
    rawEdges = data.links || data.edges || [];
  }

  // Build in-memory graph structures
  const nodes = new Map<string, GraphNode>();
  for (const n of rawNodes) {
    nodes.set(n.id, n);
  }

  const adj = new Map<string, string[]>();
  const radj = new Map<string, string[]>();
  const degree = new Map<string, number>();

  for (const n of rawNodes) {
    adj.set(n.id, []);
    radj.set(n.id, []);
    degree.set(n.id, 0);
  }

  for (const e of rawEdges) {
    const src = e.source;
    const tgt = e.target;
    adj.get(src)?.push(tgt);
    radj.get(tgt)?.push(src);
    degree.set(src, (degree.get(src) ?? 0) + 1);
    degree.set(tgt, (degree.get(tgt) ?? 0) + 1);
  }

  return { nodes, adj, radj, edges: rawEdges, degree, graphPath };
}

// ── Shared output helpers ─────────────────────────────────────────────────────

function nodeOut(g: LoadedGraph, id: string) {
  const d = g.nodes.get(id) ?? { id };
  return {
    id,
    label: d.label ?? id,
    file: d.source_file ?? '',
    location: d.source_location ?? '',
    community: d.community ?? null,
    degree: g.degree.get(id) ?? 0,
    file_type: d.file_type ?? '',
  };
}

/** Score a node against search terms. */
function scoreNode(g: LoadedGraph, id: string, terms: string[]): number {
  const d = g.nodes.get(id);
  if (!d) return 0;
  const label = (d.label ?? id).toLowerCase();
  const file = (d.source_file ?? '').toLowerCase();
  return terms.reduce((s, t) => {
    if (label.includes(t)) s += 1;
    if (file.includes(t)) s += 0.5;
    return s;
  }, 0);
}

// ── Tool Definitions ──────────────────────────────────────────────────────────

/**
 * Build or rebuild the knowledge graph for a directory.
 */
export const graphifyBuildTool: MCPTool = {
  name: 'graphify_build',
  description: 'Build (or rebuild) the knowledge graph for a project directory. ' +
    'Extracts AST structure from code files, semantic relationships from docs, ' +
    'and clusters them into communities. Run this first before using other graphify tools. ' +
    'Code-only changes are fast (tree-sitter, no LLM). Doc changes require an LLM call.',
  category: 'graphify',
  tags: ['knowledge-graph', 'codebase', 'architecture', 'analysis'],
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to analyse (defaults to current project root)',
      },
      codeOnly: {
        type: 'boolean',
        description: 'Only re-extract changed code files — no LLM, fast rebuild',
        default: false,
      },
    },
  },
  handler: async (params) => {
    const cwd = getProjectCwd();
    const targetPath = (params.path as string) || cwd;

    try {
      const { buildGraph } = await import('@monobrain/graph') as unknown as {
        buildGraph: (path: string, opts?: { codeOnly?: boolean; outputDir?: string }) => Promise<{
          filesProcessed: number;
          graphPath: string;
          analysis: { stats: { nodes: number; edges: number } };
        }>;
      };

      const outputDir = join(targetPath, '.monobrain', 'graph');
      const result = await buildGraph(targetPath, {
        codeOnly: Boolean(params.codeOnly),
        outputDir,
      });

      return {
        success: true,
        graphPath: result.graphPath,
        filesProcessed: result.filesProcessed,
        nodes: result.analysis.stats.nodes,
        edges: result.analysis.stats.edges,
        message: `Knowledge graph built at ${result.graphPath}`,
      };
    } catch (err) {
      return {
        error: true,
        message: String(err),
        hint: '@monobrain/graph package not available — ensure it is installed and built.',
      };
    }
  },
};

/**
 * Query the knowledge graph with natural language.
 */
export const graphifyQueryTool: MCPTool = {
  name: 'graphify_query',
  description: 'Search the knowledge graph with a natural language question or keywords. ' +
    'Returns relevant nodes and edges as structured context — use this instead of reading ' +
    'many files when you want to understand how components relate. ' +
    'BFS mode gives broad context; DFS traces a specific call path.',
  category: 'graphify',
  tags: ['knowledge-graph', 'search', 'architecture', 'codebase'],
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Natural language question or keyword (e.g. "authentication flow", "how does caching work")',
      },
      mode: {
        type: 'string',
        enum: ['bfs', 'dfs'],
        default: 'bfs',
        description: 'bfs = broad context, dfs = trace specific path',
      },
      depth: {
        type: 'integer',
        default: 3,
        description: 'Traversal depth (1–6)',
      },
      tokenBudget: {
        type: 'integer',
        default: 2000,
        description: 'Approximate max output tokens',
      },
    },
    required: ['question'],
  },
  handler: async (params) => {
    const cwd = getProjectCwd();

    if (!graphExists(cwd)) {
      return {
        error: true,
        message: 'No graph found. Run graphify_build first.',
        hint: `Expected: ${getGraphPath(cwd)}`,
      };
    }

    const question = params.question as string;
    const mode = (params.mode as string) || 'bfs';
    const depth = (params.depth as number) || 3;

    try {
      const g = await loadKnowledgeGraph(cwd);
      const terms = question.toLowerCase().split(/\s+/).filter(t => t.length > 2);

      // Score nodes; fall back to highest-degree nodes if no match
      let startNodes: string[] = [];
      if (terms.length > 0) {
        const scored: Array<[number, string]> = [];
        for (const id of g.nodes.keys()) {
          const s = scoreNode(g, id, terms);
          if (s > 0) scored.push([s, id]);
        }
        scored.sort((a, b) => b[0] - a[0]);
        startNodes = scored.slice(0, 5).map(([, id]) => id);
      }
      if (startNodes.length === 0) {
        startNodes = [...g.nodes.keys()]
          .sort((a, b) => (g.degree.get(b) ?? 0) - (g.degree.get(a) ?? 0))
          .slice(0, 3);
      }

      const visited = new Set<string>(startNodes);
      const edgesSeen: Array<[string, string]> = [];

      if (mode === 'bfs') {
        let frontier = new Set<string>(startNodes);
        for (let d = 0; d < depth; d++) {
          const next = new Set<string>();
          for (const n of frontier) {
            for (const nbr of g.adj.get(n) ?? []) {
              if (!visited.has(nbr)) {
                next.add(nbr);
                edgesSeen.push([n, nbr]);
              }
            }
          }
          for (const n of next) visited.add(n);
          frontier = next;
        }
      } else {
        // DFS
        const stack: Array<[string, number]> = startNodes.map(n => [n, 0]);
        while (stack.length > 0) {
          const [node, d] = stack.pop()!;
          if (visited.has(node) && d > 0) continue;
          if (d > depth) continue;
          visited.add(node);
          for (const nbr of g.adj.get(node) ?? []) {
            if (!visited.has(nbr)) {
              stack.push([nbr, d + 1]);
              edgesSeen.push([node, nbr]);
            }
          }
        }
      }

      const nodesOut = [...visited]
        .sort((a, b) => (g.degree.get(b) ?? 0) - (g.degree.get(a) ?? 0))
        .slice(0, 60)
        .map(id => nodeOut(g, id));

      // Build edge lookup for attribute access
      const edgeLookup = new Map<string, GraphEdge>();
      for (const e of g.edges) {
        edgeLookup.set(`${e.source}__${e.target}`, e);
      }

      const edgesOut = edgesSeen
        .filter(([u, v]) => visited.has(u) && visited.has(v))
        .slice(0, 80)
        .map(([u, v]) => {
          const e = edgeLookup.get(`${u}__${v}`) ?? {};
          return {
            from: (g.nodes.get(u)?.label ?? u),
            to: (g.nodes.get(v)?.label ?? v),
            relation: (e as GraphEdge).relation ?? '',
            confidence: (e as GraphEdge).confidence ?? '',
          };
        });

      return {
        question,
        mode,
        depth,
        nodes: nodesOut,
        edges: edgesOut,
        total_nodes: visited.size,
        total_edges: edgesSeen.length,
      };
    } catch (err) {
      return { error: true, message: String(err) };
    }
  },
};

/**
 * Get the most connected (god) nodes — the core abstractions.
 */
export const graphifyGodNodesTool: MCPTool = {
  name: 'graphify_god_nodes',
  description: 'Return the most connected nodes in the knowledge graph — the core abstractions ' +
    'and central concepts of the codebase. Use this at the start of any architectural analysis ' +
    'to understand what the most important components are before diving into details.',
  category: 'graphify',
  tags: ['knowledge-graph', 'architecture', 'abstractions', 'codebase'],
  inputSchema: {
    type: 'object',
    properties: {
      topN: {
        type: 'integer',
        default: 15,
        description: 'Number of god nodes to return',
      },
    },
  },
  handler: async (params) => {
    const cwd = getProjectCwd();

    if (!graphExists(cwd)) {
      return {
        error: true,
        message: 'No graph found. Run graphify_build first.',
      };
    }

    const topN = (params.topN as number) || 15;

    try {
      const g = await loadKnowledgeGraph(cwd);

      const sortedIds = [...g.nodes.keys()]
        .sort((a, b) => (g.degree.get(b) ?? 0) - (g.degree.get(a) ?? 0))
        .slice(0, topN);

      const godNodes = sortedIds.map(id => {
        const d = g.nodes.get(id) ?? { id };
        const neighbors = (g.adj.get(id) ?? [])
          .slice(0, 8)
          .map(nid => g.nodes.get(nid)?.label ?? nid);
        return {
          label: d.label ?? id,
          degree: g.degree.get(id) ?? 0,
          file: d.source_file ?? '',
          location: d.source_location ?? '',
          community: d.community ?? null,
          file_type: d.file_type ?? '',
          neighbors,
        };
      });

      return { god_nodes: godNodes, total_nodes: g.nodes.size };
    } catch (err) {
      return { error: true, message: String(err) };
    }
  },
};

/**
 * Get full details for a specific node.
 */
export const graphifyGetNodeTool: MCPTool = {
  name: 'graphify_get_node',
  description: 'Get all details for a specific concept/node in the knowledge graph: ' +
    'its source location, community, all relationships, and confidence levels. ' +
    'Use this when you need to deeply understand one specific component.',
  category: 'graphify',
  tags: ['knowledge-graph', 'node', 'details'],
  inputSchema: {
    type: 'object',
    properties: {
      label: {
        type: 'string',
        description: 'Node label or ID to look up (case-insensitive)',
      },
    },
    required: ['label'],
  },
  handler: async (params) => {
    const cwd = getProjectCwd();

    if (!graphExists(cwd)) {
      return { error: true, message: 'No graph found. Run graphify_build first.' };
    }

    try {
      const g = await loadKnowledgeGraph(cwd);
      const term = (params.label as string).toLowerCase();

      const matches = [...g.nodes.entries()]
        .filter(([id, d]) => (d.label ?? id).toLowerCase().includes(term) || id.toLowerCase() === term)
        .sort(([aId], [bId]) => (g.degree.get(bId) ?? 0) - (g.degree.get(aId) ?? 0))
        .map(([id]) => id);

      if (matches.length === 0) {
        return { error: 'Node not found', searched: term };
      }

      const id = matches[0];
      const d = g.nodes.get(id) ?? { id };

      // Build edge lookup
      const edgeLookup = new Map<string, GraphEdge>();
      for (const e of g.edges) {
        edgeLookup.set(`${e.source}__${e.target}`, e);
      }

      const outEdges = (g.adj.get(id) ?? []).slice(0, 40).map(tgt => {
        const e = edgeLookup.get(`${id}__${tgt}`) ?? {};
        return {
          direction: 'outgoing',
          to: g.nodes.get(tgt)?.label ?? tgt,
          relation: (e as GraphEdge).relation ?? '',
          confidence: (e as GraphEdge).confidence ?? '',
          confidence_score: (e as GraphEdge).confidence_score ?? null,
        };
      });

      const inEdges = (g.radj.get(id) ?? []).slice(0, 40).map(src => {
        const e = edgeLookup.get(`${src}__${id}`) ?? {};
        return {
          direction: 'incoming',
          from: g.nodes.get(src)?.label ?? src,
          relation: (e as GraphEdge).relation ?? '',
          confidence: (e as GraphEdge).confidence ?? '',
        };
      });

      // Strip well-known fields from attributes output to avoid duplication
      const knownKeys = new Set(['label', 'source_file', 'source_location', 'community', 'file_type', 'id']);
      const attributes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(d)) {
        if (!knownKeys.has(k)) attributes[k] = v;
      }

      return {
        id,
        label: d.label ?? id,
        file: d.source_file ?? '',
        location: d.source_location ?? '',
        community: d.community ?? null,
        file_type: d.file_type ?? '',
        degree: g.degree.get(id) ?? 0,
        attributes,
        edges: [...outEdges, ...inEdges],
        all_matches: matches.slice(0, 10).map(m => g.nodes.get(m)?.label ?? m),
      };
    } catch (err) {
      return { error: true, message: String(err) };
    }
  },
};

/**
 * Find shortest path between two concepts.
 */
export const graphifyShortestPathTool: MCPTool = {
  name: 'graphify_shortest_path',
  description: 'Find the shortest relationship path between two concepts in the knowledge graph. ' +
    'Use this to trace how component A depends on or relates to component B, ' +
    'revealing hidden coupling chains (e.g. "how does the router connect to the database?").',
  category: 'graphify',
  tags: ['knowledge-graph', 'path', 'dependencies', 'coupling'],
  inputSchema: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Source concept label' },
      target: { type: 'string', description: 'Target concept label' },
      maxHops: { type: 'integer', default: 8, description: 'Maximum hops to search' },
    },
    required: ['source', 'target'],
  },
  handler: async (params) => {
    const cwd = getProjectCwd();

    if (!graphExists(cwd)) {
      return { error: true, message: 'No graph found. Run graphify_build first.' };
    }

    try {
      const g = await loadKnowledgeGraph(cwd);
      const maxHops = (params.maxHops as number) || 8;

      /** Find node ids matching a search term, sorted by degree descending. */
      function findNodes(term: string): string[] {
        const t = term.toLowerCase();
        return [...g.nodes.entries()]
          .filter(([id, d]) => (d.label ?? id).toLowerCase().includes(t) || id.toLowerCase() === t)
          .sort(([aId], [bId]) => (g.degree.get(bId) ?? 0) - (g.degree.get(aId) ?? 0))
          .map(([id]) => id);
      }

      const srcNodes = findNodes(params.source as string);
      const tgtNodes = findNodes(params.target as string);

      if (srcNodes.length === 0) {
        return { error: true, message: `Source not found: ${params.source}` };
      }
      if (tgtNodes.length === 0) {
        return { error: true, message: `Target not found: ${params.target}` };
      }

      // BFS on undirected graph (use both adj and radj as neighbours)
      function bfsPath(start: string, end: string): string[] | null {
        const prev = new Map<string, string>();
        const queue: string[] = [start];
        const visited = new Set<string>([start]);

        while (queue.length > 0) {
          const cur = queue.shift()!;
          if (cur === end) {
            // Reconstruct path
            const path: string[] = [];
            let node: string | undefined = end;
            while (node !== undefined) {
              path.unshift(node);
              node = prev.get(node);
            }
            return path.length - 1 <= maxHops ? path : null;
          }
          // Treat edges as undirected
          const nbrs = [...(g.adj.get(cur) ?? []), ...(g.radj.get(cur) ?? [])];
          for (const nbr of nbrs) {
            if (!visited.has(nbr)) {
              visited.add(nbr);
              prev.set(nbr, cur);
              if (queue.length < 100000) queue.push(nbr);
            }
          }
        }
        return null;
      }

      let bestPath: string[] | null = null;
      for (const src of srcNodes.slice(0, 3)) {
        for (const tgt of tgtNodes.slice(0, 3)) {
          const p = bfsPath(src, tgt);
          if (p && (!bestPath || p.length < bestPath.length)) {
            bestPath = p;
          }
        }
      }

      if (!bestPath) {
        return {
          found: false,
          message: `No path within ${maxHops} hops between "${params.source}" and "${params.target}"`,
        };
      }

      // Build edge lookup
      const edgeLookup = new Map<string, GraphEdge>();
      for (const e of g.edges) {
        edgeLookup.set(`${e.source}__${e.target}`, e);
        edgeLookup.set(`${e.target}__${e.source}`, e); // bidirectional lookup
      }

      const steps = bestPath.map((id, i) => {
        const d = g.nodes.get(id) ?? { id };
        const step: Record<string, unknown> = {
          label: d.label ?? id,
          file: d.source_file ?? '',
          location: d.source_location ?? '',
        };
        if (i < bestPath!.length - 1) {
          const nextId = bestPath![i + 1];
          const e = edgeLookup.get(`${id}__${nextId}`) ?? edgeLookup.get(`${nextId}__${id}`) ?? {};
          step.next_relation = (e as GraphEdge).relation ?? '';
          step.confidence = (e as GraphEdge).confidence ?? '';
        }
        return step;
      });

      return { found: true, hops: bestPath.length - 1, path: steps };
    } catch (err) {
      return { error: true, message: String(err) };
    }
  },
};

/**
 * Get all nodes in a community (cluster of related components).
 */
export const graphifyGetCommunityTool: MCPTool = {
  name: 'graphify_community',
  description: 'Get all nodes in a specific community cluster. Communities are groups of ' +
    'tightly related components detected by graph clustering. Use graph_stats first to ' +
    'see community count, then explore communities to understand subsystem boundaries.',
  category: 'graphify',
  tags: ['knowledge-graph', 'community', 'clusters', 'subsystems'],
  inputSchema: {
    type: 'object',
    properties: {
      communityId: {
        type: 'integer',
        description: 'Community ID (0 = largest community)',
      },
    },
    required: ['communityId'],
  },
  handler: async (params) => {
    const cwd = getProjectCwd();

    if (!graphExists(cwd)) {
      return { error: true, message: 'No graph found. Run graphify_build first.' };
    }

    try {
      const g = await loadKnowledgeGraph(cwd);
      const cid = params.communityId as number;

      const members = [...g.nodes.entries()]
        .filter(([, d]) => d.community === cid)
        .sort(([aId], [bId]) => (g.degree.get(bId) ?? 0) - (g.degree.get(aId) ?? 0))
        .slice(0, 50)
        .map(([id, d]) => ({
          label: d.label ?? id,
          file: d.source_file ?? '',
          location: d.source_location ?? '',
          degree: g.degree.get(id) ?? 0,
          file_type: d.file_type ?? '',
        }));

      // Build edge lookup
      const edgeLookup = new Map<string, GraphEdge>();
      for (const e of g.edges) {
        edgeLookup.set(`${e.source}__${e.target}`, e);
      }

      const externalEdges: unknown[] = [];
      for (const [id, d] of g.nodes.entries()) {
        if (d.community !== cid) continue;
        for (const nbr of g.adj.get(id) ?? []) {
          const nbrD = g.nodes.get(nbr);
          if (nbrD?.community !== cid) {
            const e = edgeLookup.get(`${id}__${nbr}`) ?? {};
            externalEdges.push({
              from: d.label ?? id,
              to: nbrD?.label ?? nbr,
              to_community: nbrD?.community ?? null,
              relation: (e as GraphEdge).relation ?? '',
            });
          }
        }
      }

      return {
        community_id: cid,
        member_count: members.length,
        members,
        external_connections: externalEdges.slice(0, 30),
      };
    } catch (err) {
      return { error: true, message: String(err) };
    }
  },
};

/**
 * Get graph statistics: node/edge counts, communities, confidence breakdown.
 */
export const graphifyStatsTool: MCPTool = {
  name: 'graphify_stats',
  description: 'Get summary statistics for the knowledge graph: node count, edge count, ' +
    'community count, confidence breakdown (EXTRACTED/INFERRED/AMBIGUOUS), ' +
    'and top god nodes. Use this first to understand graph size and structure.',
  category: 'graphify',
  tags: ['knowledge-graph', 'stats', 'overview'],
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_params) => {
    const cwd = getProjectCwd();

    if (!graphExists(cwd)) {
      return {
        error: true,
        message: 'No graph found. Run graphify_build first.',
        hint: `Expected: ${getGraphPath(cwd)}`,
      };
    }

    try {
      const g = await loadKnowledgeGraph(cwd);

      // Community sizes
      const communities = new Map<number, number>();
      for (const d of g.nodes.values()) {
        if (d.community != null) {
          communities.set(d.community, (communities.get(d.community) ?? 0) + 1);
        }
      }

      const communitySizes: Record<string, number> = {};
      [...communities.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([cid, count]) => { communitySizes[String(cid)] = count; });

      // Confidence and relation counts
      const confidenceCounts: Record<string, number> = {};
      const relationCounts: Record<string, number> = {};
      const fileTypeCounts: Record<string, number> = {};

      for (const e of g.edges) {
        const conf = e.confidence ?? 'UNKNOWN';
        confidenceCounts[conf] = (confidenceCounts[conf] ?? 0) + 1;
        const rel = e.relation ?? 'unknown';
        relationCounts[rel] = (relationCounts[rel] ?? 0) + 1;
      }

      for (const d of g.nodes.values()) {
        const ft = d.file_type ?? 'unknown';
        fileTypeCounts[ft] = (fileTypeCounts[ft] ?? 0) + 1;
      }

      const topRelations = Object.entries(relationCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .reduce<Record<string, number>>((acc, [k, v]) => { acc[k] = v; return acc; }, {});

      const topGodNodes = [...g.nodes.keys()]
        .sort((a, b) => (g.degree.get(b) ?? 0) - (g.degree.get(a) ?? 0))
        .slice(0, 5)
        .map(id => g.nodes.get(id)?.label ?? id);

      return {
        nodes: g.nodes.size,
        edges: g.edges.length,
        communities: communities.size,
        community_sizes: communitySizes,
        confidence: confidenceCounts,
        top_relations: topRelations,
        file_types: fileTypeCounts,
        graph_path: g.graphPath,
        top_god_nodes: topGodNodes,
        is_directed: true,
      };
    } catch (err) {
      return { error: true, message: String(err) };
    }
  },
};

/**
 * Find surprising cross-community connections (architectural insights).
 */
export const graphifySurprisesTool: MCPTool = {
  name: 'graphify_surprises',
  description: 'Find surprising connections between components that are in different communities ' +
    'but have strong relationships. These unexpected couplings often reveal hidden dependencies, ' +
    'design smells, or important architectural patterns worth understanding.',
  category: 'graphify',
  tags: ['knowledge-graph', 'architecture', 'coupling', 'surprises'],
  inputSchema: {
    type: 'object',
    properties: {
      topN: {
        type: 'integer',
        default: 10,
        description: 'Number of surprising connections to return',
      },
    },
  },
  handler: async (params) => {
    const cwd = getProjectCwd();

    if (!graphExists(cwd)) {
      return { error: true, message: 'No graph found. Run graphify_build first.' };
    }

    try {
      const g = await loadKnowledgeGraph(cwd);
      const topN = (params.topN as number) || 10;

      const surprises: Array<{
        score: number;
        from: string;
        from_community: number | null;
        from_file: string;
        to: string;
        to_community: number | null;
        to_file: string;
        relation: string;
        confidence: string;
      }> = [];

      for (const e of g.edges) {
        const uD = g.nodes.get(e.source);
        const vD = g.nodes.get(e.target);
        const cu = uD?.community ?? null;
        const cv = vD?.community ?? null;
        if (cu != null && cv != null && cu !== cv) {
          const score = (g.degree.get(e.source) ?? 0) * (g.degree.get(e.target) ?? 0);
          surprises.push({
            score,
            from: uD?.label ?? e.source,
            from_community: cu,
            from_file: uD?.source_file ?? '',
            to: vD?.label ?? e.target,
            to_community: cv,
            to_file: vD?.source_file ?? '',
            relation: e.relation ?? '',
            confidence: e.confidence ?? '',
          });
        }
      }

      surprises.sort((a, b) => b.score - a.score);

      return {
        surprises: surprises.slice(0, topN),
        total_cross_community_edges: surprises.length,
      };
    } catch (err) {
      return { error: true, message: String(err) };
    }
  },
};

// ── Exports ───────────────────────────────────────────────────────────────────

export const graphifyTools: MCPTool[] = [
  graphifyBuildTool,
  graphifyQueryTool,
  graphifyGodNodesTool,
  graphifyGetNodeTool,
  graphifyShortestPathTool,
  graphifyGetCommunityTool,
  graphifyStatsTool,
  graphifySurprisesTool,
];

export default graphifyTools;
