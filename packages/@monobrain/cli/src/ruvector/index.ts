/**
 * RuVector Integration Module for Monobrain CLI
 *
 * Provides integration with @ruvector packages for:
 * - Diff classification
 * - Coverage-based routing
 * - WASM-based inference and agent runtime
 *
 * @module @monobrain/cli/ruvector
 */

export {
  DiffClassifier,
  createDiffClassifier,
  // MCP tool exports
  analyzeDiff,
  analyzeDiffSync,
  assessFileRisk,
  assessOverallRisk,
  classifyDiff,
  suggestReviewers,
  getGitDiffNumstat,
  getGitDiffNumstatAsync,
  // Cache control
  clearDiffCache,
  clearAllDiffCaches,
  // Types
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
    await import('@ruvector/core' as string);
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
    const ruvector = await import('@ruvector/core' as string);
    return (ruvector as any).version || '1.0.0';
  } catch {
    return null;
  }
}
