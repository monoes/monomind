/**
 * Graphify MCP Tools
 *
 * Bridges graphify's knowledge graph into monobrain's MCP tool surface.
 * Agents can query the codebase knowledge graph without reading files —
 * god_nodes(), query_graph(), shortest_path() give structural understanding
 * in milliseconds vs. reading dozens of source files.
 *
 * Graphify must be installed: pip install graphifyy[mcp]
 * Graph must be built first: python -m graphify <project-path>
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { type MCPTool, getProjectCwd } from './types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getGraphPath(cwd: string): string {
  return resolve(join(cwd, 'graphify-out', 'graph.json'));
}

function isGraphifyInstalled(): boolean {
  try {
    const result = spawnSync('python', ['-c', 'import graphify; print("ok")'], {
      timeout: 5000, encoding: 'utf-8',
    });
    return result.status === 0 && result.stdout.includes('ok');
  } catch {
    return false;
  }
}

function graphExists(cwd: string): boolean {
  return existsSync(getGraphPath(cwd));
}

/**
 * Run a Python snippet that loads graphify's graph.json and returns JSON.
 * The snippet receives `graph_path` as a variable and must print a single JSON line.
 */
function runGraphifyPython(snippet: string, cwd: string): unknown {
  const graphPath = getGraphPath(cwd);
  const script = `
import json, sys
sys.path.insert(0, '${cwd.replace(/'/g, "\\'")}')
graph_path = '${graphPath.replace(/'/g, "\\'")}'
${snippet}
`.trim();

  const result = spawnSync('python', ['-c', script], {
    timeout: 15000,
    encoding: 'utf-8',
    cwd,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'graphify python call failed');
  }

  const output = result.stdout?.trim();
  if (!output) throw new Error('No output from graphify');
  return JSON.parse(output);
}

// ── Shared Python loader snippet (injected into all calls) ────────────────────
const LOAD_GRAPH_SNIPPET = `
import json
from pathlib import Path
import networkx as nx
from networkx.readwrite import json_graph
data = json.loads(Path(graph_path).read_text())
try:
    G = json_graph.node_link_graph(data, edges='links')
except TypeError:
    G = json_graph.node_link_graph(data)
`;

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

    if (!isGraphifyInstalled()) {
      return {
        error: true,
        message: 'graphify not installed. Run: pip install graphifyy[mcp]',
        hint: 'After installing, call graphify_build again.',
      };
    }

    const args = ['python', '-m', 'graphify', targetPath];
    if (params.codeOnly) args.push('--update');

    try {
      const result = spawnSync('python', ['-m', 'graphify', targetPath, ...(params.codeOnly ? ['--update'] : [])], {
        timeout: 120000,
        encoding: 'utf-8',
        cwd,
      });

      const graphPath = getGraphPath(cwd);
      const built = existsSync(graphPath);

      return {
        success: result.status === 0,
        graphPath: built ? graphPath : null,
        output: result.stdout?.trim().slice(-500) || '',
        error: result.status !== 0 ? result.stderr?.trim().slice(-500) : undefined,
        message: built
          ? `Knowledge graph built at ${graphPath}`
          : 'Build may have failed — graph.json not found',
      };
    } catch (err) {
      return { error: true, message: String(err) };
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
    const tokenBudget = (params.tokenBudget as number) || 2000;

    try {
      const result = runGraphifyPython(`
${LOAD_GRAPH_SNIPPET}

question = ${JSON.stringify(question)}
terms = [t.lower() for t in question.split() if len(t) > 2]
mode = ${JSON.stringify(mode)}
depth = ${depth}
token_budget = ${tokenBudget}

# Score nodes by term match
scored = []
for nid, d in G.nodes(data=True):
    label = d.get('label', '').lower()
    source = d.get('source_file', '').lower()
    score = sum(1 for t in terms if t in label) + sum(0.5 for t in terms if t in source)
    if score > 0:
        scored.append((score, nid))
scored.sort(reverse=True)
start_nodes = [nid for _, nid in scored[:5]]

if not start_nodes:
    # Fallback: top 3 by degree
    start_nodes = sorted(G.nodes(), key=lambda n: G.degree(n), reverse=True)[:3]

# Traverse
visited = set(start_nodes)
frontier = set(start_nodes)
edges_seen = []

if mode == 'bfs':
    for _ in range(depth):
        next_frontier = set()
        for n in frontier:
            for nbr in G.neighbors(n):
                if nbr not in visited:
                    next_frontier.add(nbr)
                    edges_seen.append((n, nbr))
        visited.update(next_frontier)
        frontier = next_frontier
else:
    stack = [(n, 0) for n in reversed(start_nodes)]
    while stack:
        node, d = stack.pop()
        if node in visited or d > depth:
            continue
        visited.add(node)
        for nbr in G.neighbors(node):
            if nbr not in visited:
                stack.append((nbr, d + 1))
                edges_seen.append((node, nbr))

# Build output
nodes_out = []
for nid in sorted(visited, key=lambda n: G.degree(n), reverse=True):
    d = G.nodes[nid]
    nodes_out.append({
        'id': nid,
        'label': d.get('label', nid),
        'file': d.get('source_file', ''),
        'location': d.get('source_location', ''),
        'community': d.get('community'),
        'degree': G.degree(nid),
        'file_type': d.get('file_type', ''),
    })

edges_out = []
for u, v in edges_seen:
    if u in visited and v in visited:
        d = G.edges.get((u, v), {})
        edges_out.append({
            'from': G.nodes[u].get('label', u),
            'to': G.nodes[v].get('label', v),
            'relation': d.get('relation', ''),
            'confidence': d.get('confidence', ''),
        })

print(json.dumps({
    'question': question,
    'mode': mode,
    'depth': depth,
    'nodes': nodes_out[:60],
    'edges': edges_out[:80],
    'total_nodes': len(visited),
    'total_edges': len(edges_seen),
}))
`, cwd);
      return result;
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
      return runGraphifyPython(`
${LOAD_GRAPH_SNIPPET}

top_n = ${topN}
degree_map = dict(G.degree())
sorted_nodes = sorted(degree_map, key=degree_map.get, reverse=True)[:top_n]

nodes_out = []
for nid in sorted_nodes:
    d = G.nodes[nid]
    nodes_out.append({
        'label': d.get('label', nid),
        'degree': degree_map[nid],
        'file': d.get('source_file', ''),
        'location': d.get('source_location', ''),
        'community': d.get('community'),
        'file_type': d.get('file_type', ''),
        'neighbors': [G.nodes[n].get('label', n) for n in G.neighbors(nid)][:8],
    })

print(json.dumps({'god_nodes': nodes_out, 'total_nodes': G.number_of_nodes()}))
`, cwd);
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
      return runGraphifyPython(`
${LOAD_GRAPH_SNIPPET}

term = ${JSON.stringify((params.label as string).toLowerCase())}
matches = [nid for nid, d in G.nodes(data=True)
           if term in d.get('label', '').lower() or term == nid.lower()]

if not matches:
    print(json.dumps({'error': 'Node not found', 'searched': term}))
else:
    nid = matches[0]
    d = dict(G.nodes[nid])
    # Collect all edges
    edges = []
    for u, v, ed in G.edges(nid, data=True):
        edges.append({
            'direction': 'outgoing',
            'to': G.nodes[v].get('label', v),
            'relation': ed.get('relation', ''),
            'confidence': ed.get('confidence', ''),
            'confidence_score': ed.get('confidence_score'),
        })
    for u, v, ed in G.in_edges(nid, data=True) if G.is_directed() else []:
        edges.append({
            'direction': 'incoming',
            'from': G.nodes[u].get('label', u),
            'relation': ed.get('relation', ''),
            'confidence': ed.get('confidence', ''),
        })
    print(json.dumps({
        'id': nid,
        'label': d.get('label', nid),
        'file': d.get('source_file', ''),
        'location': d.get('source_location', ''),
        'community': d.get('community'),
        'file_type': d.get('file_type', ''),
        'degree': G.degree(nid),
        'attributes': {k: v for k, v in d.items() if k not in ('label', 'source_file', 'source_location', 'community', 'file_type')},
        'edges': edges[:40],
        'all_matches': [G.nodes[m].get('label', m) for m in matches[:10]],
    }))
`, cwd);
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
      return runGraphifyPython(`
${LOAD_GRAPH_SNIPPET}
import networkx as nx

def find_node(G, term):
    t = term.lower()
    matches = [nid for nid, d in G.nodes(data=True)
               if t in d.get('label', '').lower() or t == nid.lower()]
    return sorted(matches, key=lambda n: G.degree(n), reverse=True)

source_term = ${JSON.stringify(params.source as string)}
target_term = ${JSON.stringify(params.target as string)}
max_hops = ${(params.maxHops as number) || 8}

src_nodes = find_node(G, source_term)
tgt_nodes = find_node(G, target_term)

if not src_nodes:
    print(json.dumps({'error': f'Source not found: {source_term}'}))
elif not tgt_nodes:
    print(json.dumps({'error': f'Target not found: {target_term}'}))
else:
    # Try undirected for path finding
    UG = G.to_undirected() if G.is_directed() else G
    best_path = None
    best_len = max_hops + 1
    for src in src_nodes[:3]:
        for tgt in tgt_nodes[:3]:
            try:
                p = nx.shortest_path(UG, src, tgt)
                if len(p) < best_len:
                    best_len = len(p)
                    best_path = p
            except nx.NetworkXNoPath:
                pass

    if best_path is None:
        print(json.dumps({'found': False, 'message': f'No path within {max_hops} hops between {source_term!r} and {target_term!r}'}))
    else:
        steps = []
        for i, nid in enumerate(best_path):
            d = G.nodes[nid]
            step = {'label': d.get('label', nid), 'file': d.get('source_file', ''), 'location': d.get('source_location', '')}
            if i < len(best_path) - 1:
                edge = G.edges.get((nid, best_path[i+1]), G.edges.get((best_path[i+1], nid), {}))
                step['next_relation'] = edge.get('relation', '')
                step['confidence'] = edge.get('confidence', '')
            steps.append(step)
        print(json.dumps({'found': True, 'hops': len(best_path) - 1, 'path': steps}))
`, cwd);
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
      return runGraphifyPython(`
${LOAD_GRAPH_SNIPPET}

cid = ${params.communityId as number}
members = [
    {'label': d.get('label', nid), 'file': d.get('source_file', ''), 'location': d.get('source_location', ''), 'degree': G.degree(nid), 'file_type': d.get('file_type', '')}
    for nid, d in G.nodes(data=True) if d.get('community') == cid
]
members.sort(key=lambda x: x['degree'], reverse=True)

# Inter-community edges
external_edges = []
for nid, d in G.nodes(data=True):
    if d.get('community') == cid:
        for nbr in G.neighbors(nid):
            if G.nodes[nbr].get('community') != cid:
                ed = G.edges.get((nid, nbr), {})
                external_edges.append({
                    'from': d.get('label', nid),
                    'to': G.nodes[nbr].get('label', nbr),
                    'to_community': G.nodes[nbr].get('community'),
                    'relation': ed.get('relation', ''),
                })

print(json.dumps({
    'community_id': cid,
    'member_count': len(members),
    'members': members[:50],
    'external_connections': external_edges[:30],
}))
`, cwd);
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

    if (!isGraphifyInstalled()) {
      // Fall back to reading graph.json directly for basic stats
      try {
        const raw = JSON.parse(readFileSync(getGraphPath(cwd), 'utf-8'));
        const nodes = raw.nodes || [];
        const edges = raw.links || raw.edges || [];
        return {
          nodes: nodes.length,
          edges: edges.length,
          note: 'graphify Python package not installed — basic stats only',
          install: 'pip install graphifyy[mcp]',
        };
      } catch (err) {
        return { error: true, message: String(err) };
      }
    }

    try {
      return runGraphifyPython(`
${LOAD_GRAPH_SNIPPET}
from collections import Counter

communities = {}
for nid, d in G.nodes(data=True):
    c = d.get('community')
    if c is not None:
        communities.setdefault(int(c), []).append(nid)

confidence_counts = Counter()
for u, v, d in G.edges(data=True):
    confidence_counts[d.get('confidence', 'UNKNOWN')] += 1

relation_counts = Counter()
for u, v, d in G.edges(data=True):
    relation_counts[d.get('relation', 'unknown')] += 1

file_types = Counter()
for nid, d in G.nodes(data=True):
    file_types[d.get('file_type', 'unknown')] += 1

degree_map = dict(G.degree())
top_nodes = sorted(degree_map, key=degree_map.get, reverse=True)[:5]

print(json.dumps({
    'nodes': G.number_of_nodes(),
    'edges': G.number_of_edges(),
    'communities': len(communities),
    'community_sizes': {str(k): len(v) for k, v in sorted(communities.items(), key=lambda x: len(x[1]), reverse=True)[:10]},
    'confidence': dict(confidence_counts),
    'top_relations': dict(relation_counts.most_common(10)),
    'file_types': dict(file_types),
    'graph_path': graph_path,
    'top_god_nodes': [G.nodes[n].get('label', n) for n in top_nodes],
    'is_directed': G.is_directed(),
}))
`, cwd);
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
      return runGraphifyPython(`
${LOAD_GRAPH_SNIPPET}

top_n = ${(params.topN as number) || 10}

# Cross-community edges: source and target in different communities
surprises = []
for u, v, d in G.edges(data=True):
    cu = G.nodes[u].get('community')
    cv = G.nodes[v].get('community')
    if cu is not None and cv is not None and cu != cv:
        # Weighted by degree product (high-degree cross-community = more surprising)
        score = G.degree(u) * G.degree(v)
        surprises.append({
            'score': score,
            'from': G.nodes[u].get('label', u),
            'from_community': cu,
            'from_file': G.nodes[u].get('source_file', ''),
            'to': G.nodes[v].get('label', v),
            'to_community': cv,
            'to_file': G.nodes[v].get('source_file', ''),
            'relation': d.get('relation', ''),
            'confidence': d.get('confidence', ''),
        })

surprises.sort(key=lambda x: x['score'], reverse=True)
print(json.dumps({'surprises': surprises[:top_n], 'total_cross_community_edges': len(surprises)}))
`, cwd);
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
