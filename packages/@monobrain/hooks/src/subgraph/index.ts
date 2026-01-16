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
