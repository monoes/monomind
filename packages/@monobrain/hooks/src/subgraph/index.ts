/**
 * SubGraph Composition — Modular Topology Design (Task 48)
 *
 * @packageDocumentation
 */

// Types
export type {
  StateKey,
  AgentNode,
  Edge,
  SubGraph,
  CompiledSubGraph,
  SubGraphManifest,
  ComposedTopology,
} from './types.js';

// Compiler
export { compile } from './subgraph-compiler.js';

// Registry
export { SubGraphRegistry } from './subgraph-registry.js';

// Composer
export { validateKeyContracts, compose } from './subgraph-composer.js';

// AFLOW — MCTS-guided workflow search (source: https://arxiv.org/abs/2410.10762)
export {
  AFLOWSearch,
  type AFLOWConfig,
  type AFLOWResult,
  type SequenceRewardFn,
} from './aflow-search.js';

// DAGLearner — Heterogeneous Swarms topology proposal (Tier 4)
export {
  DAGLearner,
  type DAGLearnerConfig,
  type DAGLearnerResult,
} from './dag-learner.js';
