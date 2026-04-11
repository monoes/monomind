/**
 * Graphify MCP Tools (compiled)
 *
 * Bridges @monobrain/graph's knowledge graph into monobrain's MCP tool surface.
 * Graph is built automatically on `monobrain init` and stored at
 * .monobrain/graph/graph.json (legacy: graphify-out/graph.json).
 */
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { getProjectCwd } from './types.js';

// ── Path helpers ──────────────────────────────────────────────────────────────

function getGraphPath(cwd) {
    const nativePath = resolve(join(cwd, '.monobrain', 'graph', 'graph.json'));
    const legacyPath = resolve(join(cwd, 'graphify-out', 'graph.json'));
    if (existsSync(nativePath)) return nativePath;
    if (existsSync(legacyPath)) return legacyPath;
    return nativePath;
}

function graphExists(cwd) {
    return existsSync(getGraphPath(cwd));
}

// ── Graph loading ─────────────────────────────────────────────────────────────

async function loadKnowledgeGraph(cwd) {
    const graphPath = getGraphPath(cwd);
    let rawNodes = [];
    let rawEdges = [];

    try {
        const { loadGraph } = await import('@monoes/graph');
        const loaded = loadGraph(graphPath);
        rawNodes = loaded.nodes;
        rawEdges = loaded.edges;
    } catch {
        const data = JSON.parse(readFileSync(graphPath, 'utf-8'));
        rawNodes = data.nodes || [];
        rawEdges = data.links || data.edges || [];
    }

    const nodes = new Map();
    for (const n of rawNodes) nodes.set(n.id, n);

    const adj = new Map();
    const radj = new Map();
    const degree = new Map();
    for (const n of rawNodes) {
        adj.set(n.id, []);
        radj.set(n.id, []);
        degree.set(n.id, 0);
    }
    for (const e of rawEdges) {
        adj.get(e.source)?.push(e.target);
        radj.get(e.target)?.push(e.source);
        degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
        degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }

    return { nodes, adj, radj, edges: rawEdges, degree, graphPath };
}

function nodeOut(g, id) {
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

function scoreNode(g, id, terms) {
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

export const graphifyBuildTool = {
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
            path: { type: 'string', description: 'Path to analyse (defaults to current project root)' },
            codeOnly: { type: 'boolean', description: 'Only re-extract changed code files — fast rebuild', default: false },
        },
    },
    handler: async (params) => {
        const cwd = getProjectCwd();
        const targetPath = params.path || cwd;
        try {
            const { buildGraph } = await import('@monoes/graph');
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
                hint: '@monoes/graph package not available — ensure it is installed and built.',
            };
        }
    },
};

export const graphifyQueryTool = {
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
            question: { type: 'string', description: 'Natural language question or keyword' },
            mode: { type: 'string', enum: ['bfs', 'dfs'], default: 'bfs' },
            depth: { type: 'integer', default: 3 },
            tokenBudget: { type: 'integer', default: 2000 },
        },
        required: ['question'],
    },
    handler: async (params) => {
        const cwd = getProjectCwd();
        if (!graphExists(cwd)) return { error: true, message: 'No graph found. Run graphify_build first.', hint: `Expected: ${getGraphPath(cwd)}` };
        const question = params.question;
        const mode = params.mode || 'bfs';
        const depth = params.depth || 3;
        try {
            const g = await loadKnowledgeGraph(cwd);
            const terms = question.toLowerCase().split(/\s+/).filter(t => t.length > 2);

            let startNodes = [];
            if (terms.length > 0) {
                const scored = [];
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

            const visited = new Set(startNodes);
            const edgesSeen = [];

            if (mode === 'bfs') {
                let frontier = new Set(startNodes);
                for (let d = 0; d < depth; d++) {
                    const next = new Set();
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
                const stack = startNodes.map(n => [n, 0]);
                while (stack.length > 0) {
                    const [node, d] = stack.pop();
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

            const edgeLookup = new Map();
            for (const e of g.edges) edgeLookup.set(`${e.source}__${e.target}`, e);

            const edgesOut = edgesSeen
                .filter(([u, v]) => visited.has(u) && visited.has(v))
                .slice(0, 80)
                .map(([u, v]) => {
                    const e = edgeLookup.get(`${u}__${v}`) ?? {};
                    return {
                        from: g.nodes.get(u)?.label ?? u,
                        to: g.nodes.get(v)?.label ?? v,
                        relation: e.relation ?? '',
                        confidence: e.confidence ?? '',
                    };
                });

            return { question, mode, depth, nodes: nodesOut, edges: edgesOut, total_nodes: visited.size, total_edges: edgesSeen.length };
        } catch (err) { return { error: true, message: String(err) }; }
    },
};

export const graphifyGodNodesTool = {
    name: 'graphify_god_nodes',
    description: 'Return the most connected nodes in the knowledge graph — the core abstractions ' +
        'and central concepts of the codebase. Use this at the start of any architectural analysis ' +
        'to understand what the most important components are before diving into details.',
    category: 'graphify',
    tags: ['knowledge-graph', 'architecture', 'abstractions', 'codebase'],
    inputSchema: { type: 'object', properties: { topN: { type: 'integer', default: 15 } } },
    handler: async (params) => {
        const cwd = getProjectCwd();
        if (!graphExists(cwd)) return { error: true, message: 'No graph found. Run graphify_build first.' };
        const topN = params.topN || 15;
        try {
            const g = await loadKnowledgeGraph(cwd);
            const sortedIds = [...g.nodes.keys()]
                .sort((a, b) => (g.degree.get(b) ?? 0) - (g.degree.get(a) ?? 0))
                .slice(0, topN);
            const godNodes = sortedIds.map(id => {
                const d = g.nodes.get(id) ?? { id };
                const neighbors = (g.adj.get(id) ?? []).slice(0, 8).map(nid => g.nodes.get(nid)?.label ?? nid);
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
        } catch (err) { return { error: true, message: String(err) }; }
    },
};

export const graphifyGetNodeTool = {
    name: 'graphify_get_node',
    description: 'Get all details for a specific concept/node in the knowledge graph: ' +
        'its source location, community, all relationships, and confidence levels.',
    category: 'graphify',
    tags: ['knowledge-graph', 'node', 'details'],
    inputSchema: { type: 'object', properties: { label: { type: 'string', description: 'Node label or ID (case-insensitive)' } }, required: ['label'] },
    handler: async (params) => {
        const cwd = getProjectCwd();
        if (!graphExists(cwd)) return { error: true, message: 'No graph found. Run graphify_build first.' };
        try {
            const g = await loadKnowledgeGraph(cwd);
            const term = params.label.toLowerCase();
            const matches = [...g.nodes.entries()]
                .filter(([id, d]) => (d.label ?? id).toLowerCase().includes(term) || id.toLowerCase() === term)
                .sort(([aId], [bId]) => (g.degree.get(bId) ?? 0) - (g.degree.get(aId) ?? 0))
                .map(([id]) => id);
            if (matches.length === 0) return { error: 'Node not found', searched: term };
            const id = matches[0];
            const d = g.nodes.get(id) ?? { id };
            const edgeLookup = new Map();
            for (const e of g.edges) edgeLookup.set(`${e.source}__${e.target}`, e);
            const outEdges = (g.adj.get(id) ?? []).slice(0, 40).map(tgt => {
                const e = edgeLookup.get(`${id}__${tgt}`) ?? {};
                return { direction: 'outgoing', to: g.nodes.get(tgt)?.label ?? tgt, relation: e.relation ?? '', confidence: e.confidence ?? '', confidence_score: e.confidence_score ?? null };
            });
            const inEdges = (g.radj.get(id) ?? []).slice(0, 40).map(src => {
                const e = edgeLookup.get(`${src}__${id}`) ?? {};
                return { direction: 'incoming', from: g.nodes.get(src)?.label ?? src, relation: e.relation ?? '', confidence: e.confidence ?? '' };
            });
            const knownKeys = new Set(['label', 'source_file', 'source_location', 'community', 'file_type', 'id']);
            const attributes = {};
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
        } catch (err) { return { error: true, message: String(err) }; }
    },
};

export const graphifyShortestPathTool = {
    name: 'graphify_shortest_path',
    description: 'Find the shortest relationship path between two concepts in the knowledge graph. ' +
        'Reveals coupling chains between any two components.',
    category: 'graphify',
    tags: ['knowledge-graph', 'path', 'dependencies', 'coupling'],
    inputSchema: {
        type: 'object',
        properties: {
            source: { type: 'string', description: 'Source concept label' },
            target: { type: 'string', description: 'Target concept label' },
            maxHops: { type: 'integer', default: 8 },
        },
        required: ['source', 'target'],
    },
    handler: async (params) => {
        const cwd = getProjectCwd();
        if (!graphExists(cwd)) return { error: true, message: 'No graph found. Run graphify_build first.' };
        try {
            const g = await loadKnowledgeGraph(cwd);
            const maxHops = params.maxHops || 8;

            function findNodes(term) {
                const t = term.toLowerCase();
                return [...g.nodes.entries()]
                    .filter(([id, d]) => (d.label ?? id).toLowerCase().includes(t) || id.toLowerCase() === t)
                    .sort(([aId], [bId]) => (g.degree.get(bId) ?? 0) - (g.degree.get(aId) ?? 0))
                    .map(([id]) => id);
            }

            const srcNodes = findNodes(params.source);
            const tgtNodes = findNodes(params.target);
            if (!srcNodes.length) return { error: true, message: `Source not found: ${params.source}` };
            if (!tgtNodes.length) return { error: true, message: `Target not found: ${params.target}` };

            function bfsPath(start, end) {
                const prev = new Map();
                const queue = [start];
                const visited = new Set([start]);
                while (queue.length > 0) {
                    const cur = queue.shift();
                    if (cur === end) {
                        const path = [];
                        let node = end;
                        while (node !== undefined) { path.unshift(node); node = prev.get(node); }
                        return path.length - 1 <= maxHops ? path : null;
                    }
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

            let bestPath = null;
            for (const src of srcNodes.slice(0, 3)) {
                for (const tgt of tgtNodes.slice(0, 3)) {
                    const p = bfsPath(src, tgt);
                    if (p && (!bestPath || p.length < bestPath.length)) bestPath = p;
                }
            }

            if (!bestPath) return { found: false, message: `No path within ${maxHops} hops between "${params.source}" and "${params.target}"` };

            const edgeLookup = new Map();
            for (const e of g.edges) {
                edgeLookup.set(`${e.source}__${e.target}`, e);
                edgeLookup.set(`${e.target}__${e.source}`, e);
            }

            const steps = bestPath.map((id, i) => {
                const d = g.nodes.get(id) ?? { id };
                const step = { label: d.label ?? id, file: d.source_file ?? '', location: d.source_location ?? '' };
                if (i < bestPath.length - 1) {
                    const nextId = bestPath[i + 1];
                    const e = edgeLookup.get(`${id}__${nextId}`) ?? edgeLookup.get(`${nextId}__${id}`) ?? {};
                    step.next_relation = e.relation ?? '';
                    step.confidence = e.confidence ?? '';
                }
                return step;
            });

            return { found: true, hops: bestPath.length - 1, path: steps };
        } catch (err) { return { error: true, message: String(err) }; }
    },
};

export const graphifyGetCommunityTool = {
    name: 'graphify_community',
    description: 'Get all nodes in a specific community cluster. Communities are groups of ' +
        'tightly related components detected by graph clustering. Use graphify_stats first to see community count.',
    category: 'graphify',
    tags: ['knowledge-graph', 'community', 'clusters', 'subsystems'],
    inputSchema: { type: 'object', properties: { communityId: { type: 'integer', description: 'Community ID (0 = largest)' } }, required: ['communityId'] },
    handler: async (params) => {
        const cwd = getProjectCwd();
        if (!graphExists(cwd)) return { error: true, message: 'No graph found. Run graphify_build first.' };
        try {
            const g = await loadKnowledgeGraph(cwd);
            const cid = params.communityId;
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
            const edgeLookup = new Map();
            for (const e of g.edges) edgeLookup.set(`${e.source}__${e.target}`, e);
            const externalEdges = [];
            for (const [id, d] of g.nodes.entries()) {
                if (d.community !== cid) continue;
                for (const nbr of g.adj.get(id) ?? []) {
                    const nbrD = g.nodes.get(nbr);
                    if (nbrD?.community !== cid) {
                        const e = edgeLookup.get(`${id}__${nbr}`) ?? {};
                        externalEdges.push({ from: d.label ?? id, to: nbrD?.label ?? nbr, to_community: nbrD?.community ?? null, relation: e.relation ?? '' });
                    }
                }
            }
            return { community_id: cid, member_count: members.length, members, external_connections: externalEdges.slice(0, 30) };
        } catch (err) { return { error: true, message: String(err) }; }
    },
};

export const graphifyStatsTool = {
    name: 'graphify_stats',
    description: 'Get summary statistics for the knowledge graph: node count, edge count, ' +
        'community count, confidence breakdown, and top god nodes. Use this first to understand graph size.',
    category: 'graphify',
    tags: ['knowledge-graph', 'stats', 'overview'],
    inputSchema: { type: 'object', properties: {} },
    handler: async (_params) => {
        const cwd = getProjectCwd();
        if (!graphExists(cwd)) return { error: true, message: 'No graph found. Run graphify_build first.', hint: `Expected: ${getGraphPath(cwd)}` };
        try {
            const g = await loadKnowledgeGraph(cwd);
            const communities = new Map();
            for (const d of g.nodes.values()) {
                if (d.community != null) communities.set(d.community, (communities.get(d.community) ?? 0) + 1);
            }
            const communitySizes = {};
            [...communities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
                .forEach(([cid, count]) => { communitySizes[String(cid)] = count; });
            const confidenceCounts = {};
            const relationCounts = {};
            const fileTypeCounts = {};
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
                .sort((a, b) => b[1] - a[1]).slice(0, 10)
                .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});
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
        } catch (err) { return { error: true, message: String(err) }; }
    },
};

export const graphifySurprisesTool = {
    name: 'graphify_surprises',
    description: 'Find surprising connections between components in different communities with strong relationships. ' +
        'These unexpected couplings often reveal hidden dependencies or important architectural patterns.',
    category: 'graphify',
    tags: ['knowledge-graph', 'architecture', 'coupling', 'surprises'],
    inputSchema: { type: 'object', properties: { topN: { type: 'integer', default: 10 } } },
    handler: async (params) => {
        const cwd = getProjectCwd();
        if (!graphExists(cwd)) return { error: true, message: 'No graph found. Run graphify_build first.' };
        try {
            const g = await loadKnowledgeGraph(cwd);
            const topN = params.topN || 10;
            const surprises = [];
            for (const e of g.edges) {
                const uD = g.nodes.get(e.source);
                const vD = g.nodes.get(e.target);
                const cu = uD?.community ?? null;
                const cv = vD?.community ?? null;
                if (cu != null && cv != null && cu !== cv) {
                    surprises.push({
                        score: (g.degree.get(e.source) ?? 0) * (g.degree.get(e.target) ?? 0),
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
            return { surprises: surprises.slice(0, topN), total_cross_community_edges: surprises.length };
        } catch (err) { return { error: true, message: String(err) }; }
    },
};

export const graphifyTools = [
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
