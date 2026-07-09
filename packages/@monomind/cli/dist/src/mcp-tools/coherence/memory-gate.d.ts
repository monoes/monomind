/**
 * Memory Gate Tool - pr_memory_gate
 *
 * Pre-storage coherence gate for memory entries.
 * Validates that new entries are coherent with existing context before storage.
 * Uses cosine similarity on vectors to compute coherence energy.
 * When no pre-computed embeddings are supplied, falls back to a deterministic
 * hash-based vector (structural proxy, not semantic similarity).
 */
import type { MCPTool } from './types.js';
/**
 * pr_memory_gate MCP Tool Definition
 */
export declare const memoryGateTool: MCPTool;
export default memoryGateTool;
//# sourceMappingURL=memory-gate.d.ts.map