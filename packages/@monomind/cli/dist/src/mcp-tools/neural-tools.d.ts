/**
 * Pattern Store MCP Tools — "neural" namespace (legacy name, kept for API compat)
 *
 * These tools embed text as vectors and search by cosine similarity.
 * No ML training, gradient descent, or neural network inference occurs.
 * The "train" tool embeds and stores; the "predict" tool finds similar stored
 * patterns. Embeddings come from the shared memory/embedding-operations.ts
 * pipeline (LanceDB bridge -> ONNX -> deterministic hash fallback).
 */
import { type MCPTool } from './types.js';
export declare const neuralTools: MCPTool[];
//# sourceMappingURL=neural-tools.d.ts.map