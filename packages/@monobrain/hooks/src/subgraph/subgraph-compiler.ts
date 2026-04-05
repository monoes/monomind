/**
 * SubGraphCompiler — Compiles agent slugs into a CompiledSubGraph (Task 48)
 */

import { createHash } from 'node:crypto';
import type { AgentNode, CompiledSubGraph, Edge, SubGraph, SubGraphManifest } from './types.js';

/**
 * Compile an array of agent slugs into a CompiledSubGraph.
 *
 * Auto-generates a star topology: coordinator -> all specialists (parallel edges).
 * Coordinator is auto-detected from slugs containing 'architect' or 'coordinator'.
 */
export function compile(agentSlugs: string[], manifest?: Partial<SubGraphManifest>): CompiledSubGraph {
  if (agentSlugs.length === 0) {
    throw new Error('At least one agent slug is required');
  }

  // Detect coordinator
  const coordinatorSlug = agentSlugs.find(
    (s) => s.includes('architect') || s.includes('coordinator'),
  ) ?? agentSlugs[0];

  // Build agent nodes
  const agents: AgentNode[] = agentSlugs.map((slug, i) => ({
    id: `node-${i}`,
    agentSlug: slug,
    role: slug === coordinatorSlug ? 'coordinator' as const : 'specialist' as const,
    priority: slug === coordinatorSlug ? 'high' as const : 'normal' as const,
  }));

  const coordinatorNode = agents.find((a) => a.agentSlug === coordinatorSlug)!;

  // Star topology: coordinator -> every specialist (parallel)
  const specialistNodes = agents.filter((a) => a.id !== coordinatorNode.id);
  const edges: Edge[] = specialistNodes.map((spec, i) => ({
    id: `edge-${i}`,
    sourceNodeId: coordinatorNode.id,
    targetNodeId: spec.id,
    type: 'parallel' as const,
  }));

  const subGraphId = manifest?.id ?? `sg-${Date.now()}`;
  const version = manifest?.version ?? 1;

  const subGraph: SubGraph = {
    id: subGraphId,
    version,
    name: manifest?.name ?? 'auto-compiled',
    description: manifest?.description ?? `Auto-compiled subgraph from ${agentSlugs.length} agents`,
    category: 'auto',
    agents,
    internalEdges: edges,
    inputKeys: manifest?.inputKeys ?? [],
    outputKeys: manifest?.outputKeys ?? [],
    defaultCoordinator: coordinatorNode.id,
    maxConcurrentAgents: manifest?.maxConcurrentAgents ?? agentSlugs.length,
  };

  // Compute SHA-256 checksum of canonical JSON
  const canonical = JSON.stringify(subGraph, Object.keys(subGraph).sort());
  const checksum = createHash('sha256').update(canonical).digest('hex');

  return {
    subGraphId,
    version,
    category: subGraph.category,
    agentCount: agents.length,
    edgeCount: edges.length,
    inputKeys: subGraph.inputKeys,
    outputKeys: subGraph.outputKeys,
    compiledAt: new Date().toISOString(),
    checksum,
    raw: subGraph,
  };
}
