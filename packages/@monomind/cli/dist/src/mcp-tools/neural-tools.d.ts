/**
 * Pattern Store MCP Tools
 *
 * Embed text as vectors, store patterns, search by cosine similarity.
 * Embeddings come from the shared memory/embedding-operations.ts pipeline
 * (LanceDB bridge -> ONNX -> deterministic hash fallback) — the same one used
 * by CLI `neural` commands and memory search, so MCP- and CLI-trained patterns
 * are embedded consistently.
 * Tools are registered under the "neural" namespace for backwards compatibility.
 */
import { type MCPTool } from './types.js';
export declare const neuralTools: MCPTool[];
//# sourceMappingURL=neural-tools.d.ts.map