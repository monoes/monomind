/**
 * MonoVector Integration Module for Monomind CLI
 *
 * Provides integration with @monoes/* packages:
 * - Capability probing: getCapabilities(), getCachedCapabilities()
 * - Initialization state: createInitState()
 * - Keyword-based task routing: createKeywordRouter()
 * - AST diff classification: DiffClassifier
 * - Package loader: tryLoad() from ./pkg-loader
 *
 * @module @monomind/cli/monovector
 */

export { getCapabilities, getCachedCapabilities, resetCapabilitiesCache, type MonoesCapabilities } from './capabilities.js';

export { createInitState, type InitState, type InitStatus } from './init-state.js';

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
export interface KeywordRouter {
  route: (task: string, context?: unknown) => Promise<RouteDecision>;
  initialize?: () => Promise<void>;
  getStats?: () => Record<string, unknown>;
  update?: (feedback: unknown) => void;
  reset?: () => void;
  export?: () => unknown;
  import?: (data: unknown) => void;
}


export interface RouteDecision { agentType: string; confidence: number; reasoning?: string; route?: string; qValues?: number[]; explored?: boolean; alternatives?: string[]; }

export interface KeywordRouterConfig { learningRate?: number; discountFactor?: number; }



export function createKeywordRouter(_config?: KeywordRouterConfig): KeywordRouter {
  const agentTypes = ['coder', 'tester', 'reviewer', 'architect', 'researcher', 'optimizer', 'debugger', 'documenter'];
  return {
    async route(task: string): Promise<RouteDecision> {
      const lower = task.toLowerCase();
      let agentType = 'coder';
      if (lower.includes('test')) agentType = 'tester';
      else if (lower.includes('review') || lower.includes('security')) agentType = 'reviewer';
      else if (lower.includes('design') || lower.includes('architect')) agentType = 'architect';
      else if (lower.includes('research') || lower.includes('analyz')) agentType = 'researcher';
      else if (lower.includes('optim') || lower.includes('perform')) agentType = 'optimizer';
      else if (lower.includes('debug') || lower.includes('fix') || lower.includes('bug')) agentType = 'debugger';
      else if (lower.includes('doc')) agentType = 'documenter';
      return { agentType, confidence: 0.75, reasoning: 'keyword-based routing', route: agentType, qValues: [], explored: false, alternatives: agentTypes.filter(a => a !== agentType).slice(0, 3) };
    },
    async initialize() {},
    getStats() { return {}; },
    update() {},
    reset() {},
    export() { return {}; },
    import() {},
  };
}


/** @deprecated Use (await getCapabilities()).sona */
export async function isMonovectorAvailable(): Promise<boolean> {
  return (await getCapabilities()).sona;
}

/** @deprecated Use (await getCapabilities()).learningWasm */
export async function isWasmBackendAvailable(): Promise<boolean> {
  return (await getCapabilities()).learningWasm;
}

