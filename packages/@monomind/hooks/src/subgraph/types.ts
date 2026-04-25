/**
 * SubGraph Composition Types — Modular Topology Design (Task 48)
 */

/** State key for inter-subgraph data flow */
export type StateKey = string;

/** Agent node within a subgraph */
export interface AgentNode {
  id: string;
  agentSlug: string;
  role: 'coordinator' | 'specialist' | 'reviewer' | 'synthesizer';
  priority: 'low' | 'normal' | 'high';
  maxTokenBudget?: number;
}

/** Edge connecting two agent nodes */
export interface Edge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: 'sequential' | 'parallel' | 'conditional' | 'feedback';
  condition?: string;
  stateKeys?: StateKey[];
}

/** A modular subgraph of agents and edges */
export interface SubGraph {
  id: string;
  version: number;
  name: string;
  description: string;
  category: string;
  agents: AgentNode[];
  internalEdges: Edge[];
  inputKeys: StateKey[];
  outputKeys: StateKey[];
  defaultCoordinator: string;
  maxConcurrentAgents: number;
}

/** Compiled subgraph with checksum */
export interface CompiledSubGraph {
  subGraphId: string;
  version: number;
  category: string;
  agentCount: number;
  edgeCount: number;
  inputKeys: StateKey[];
  outputKeys: StateKey[];
  compiledAt: string;
  checksum: string;
  raw: SubGraph;
}

/** Manifest metadata for a subgraph */
export interface SubGraphManifest {
  id: string;
  version: number;
  name: string;
  description: string;
  inputKeys: StateKey[];
  outputKeys: StateKey[];
  defaultCoordinator: string;
  maxConcurrentAgents: number;
}

/** Composed topology connecting multiple subgraphs */
export interface ComposedTopology {
  topologyId: string;
  subGraphs: CompiledSubGraph[];
  connectionEdges: Edge[];
  topology: 'sequential' | 'parallel' | 'conditional';
  stateMergeStrategy: string;
  composedAt: string;
}
