/**
 * RuVector Integration Module for Monomind CLI
 *
 * Provides integration with @ruvector packages for:
 * - Q-Learning based task routing
 * - Mixture of Experts (MoE) routing
 * - AST code analysis
 * - Diff classification
 * - Coverage-based routing
 * - Graph boundary analysis
 * - Flash Attention for faster similarity computations
 *
 * @module @monomind/cli/ruvector
 */

export {
  DiffClassifier,
  createDiffClassifier,
  analyzeDiff,
  analyzeDiffSync,
  assessFileRisk,
  assessOverallRisk,
  classifyDiff,
  suggestReviewers,
  getGitDiffNumstat,
  getGitDiffNumstatAsync,
  clearDiffCache,
  clearAllDiffCaches,
  type DiffClassification,
  type DiffHunk,
  type DiffChange,
  type FileDiff,
  type DiffAnalysis,
  type DiffClassifierConfig,
  type DiffFile,
  type RiskLevel,
  type FileRisk,
  type OverallRisk,
  type DiffAnalysisResult,
} from './diff-classifier.js';

// Stub types for removed modules (q-learning-router, moe-router, etc. removed by minimal cleanup)
export interface QLearningRouter { route: (task: string) => Promise<RouteDecision>; }
export interface RouteDecision { agentType: string; confidence: number; reasoning?: string; }
export interface QLearningRouterConfig { learningRate?: number; discountFactor?: number; }
export interface MoERouter { route: (input: string) => Promise<RoutingResult>; }
export interface RoutingResult { expert: string; confidence: number; }
export interface MoERouterConfig { numExperts?: number; }
export interface LoadBalanceStats { [expert: string]: number; }
export type ExpertType = string;

// ── RuVector LLM WASM (inference utilities) ─────────────────
export {
  isRuvllmWasmAvailable,
  initRuvllmWasm,
  getRuvllmStatus,
  createHnswRouter,
  createSonaInstant,
  createMicroLora,
  formatChat,
  createKvCache,
  createGenerateConfig,
  createBufferPool,
  createInferenceArena,
  HNSW_MAX_SAFE_PATTERNS,
  type HnswRouterConfig,
  type HnswPattern,
  type HnswRouteResult,
  type SonaConfig,
  type MicroLoraConfig,
  type ChatMessage,
  type GenerateOptions,
  type RuvllmStatus,
} from './ruvllm-wasm.js';

// ── Agent WASM (sandboxed agent runtime) ────────────────────
export {
  isAgentWasmAvailable,
  initAgentWasm,
  createWasmAgent,
  promptWasmAgent,
  executeWasmTool,
  getWasmAgent,
  listWasmAgents,
  terminateWasmAgent,
  getWasmAgentState,
  getWasmAgentTools,
  getWasmAgentTodos,
  exportWasmState,
  createWasmMcpServer,
  listGalleryTemplates,
  getGalleryCount,
  getGalleryCategories,
  searchGalleryTemplates,
  getGalleryTemplate,
  createAgentFromTemplate,
  buildRvfContainer,
  buildRvfFromTemplate,
  type WasmAgentConfig,
  type WasmAgentInfo,
  type GalleryTemplate,
  type GalleryTemplateDetail,
  type ToolResult,
} from './agent-wasm.js';

/**
 * Check if ruvector packages are available
 */
export async function isRuvectorAvailable(): Promise<boolean> {
  try {
    // @ts-expect-error optional peer dependency
    await import('@ruvector/core');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if @ruvector/learning-wasm is available and loadable
 */
export async function isWasmBackendAvailable(): Promise<boolean> {
  try {
    const wasm = await import('@ruvector/learning-wasm');
    return typeof wasm.WasmMicroLoRA === 'function' && typeof wasm.initSync === 'function';
  } catch {
    return false;
  }
}

/**
 * Get ruvector version if available
 */
export async function getRuvectorVersion(): Promise<string | null> {
  try {
    // @ts-expect-error optional peer dependency
    const ruvector = await import('@ruvector/core');
    return (ruvector as any).version || '1.0.0';
  } catch {
    return null;
  }
}
