/**
 * Neural MCP Tools for CLI
 *
 * V2 Compatibility - Neural network and ML tools
 *
 * ✅ HYBRID Implementation:
 * - Uses monovector ONNX embeddings when available
 * - Falls back to deterministic hash-based embeddings otherwise
 * - Pattern storage and search with cosine similarity (real math in all tiers)
 * - Training stores patterns as searchable embeddings (not simulated)
 *
 * Note: The lean build has no neural training. The full loop lives on monoes-full-loop.
 */
import { type MCPTool } from './types.js';
export declare const neuralTools: MCPTool[];
//# sourceMappingURL=neural-tools.d.ts.map