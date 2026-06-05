/**
 * MonoVector Integration Module for Monomind CLI (lean)
 *
 * After the SONA / native / WASM teardown this module provides only the
 * lightweight surface:
 * - Capability probing: getCapabilities() — stubbed, always reports JS-only
 * - Initialization state: createInitState()
 * - Keyword-based task routing: createKeywordRouter()
 * - Route recommendation→outcome records: recordRoute(), joinOutcome(), accuracy
 * - AST diff classification: DiffClassifier
 *
 * @module @monomind/cli/monovector
 */

import { getCapabilities } from './capabilities.js';

export { getCapabilities, getCachedCapabilities, resetCapabilitiesCache, refreshCapabilities, type MonoesCapabilities } from './capabilities.js';

export { createInitState, type InitState, type InitStatus } from './init-state.js';

export {
  recordRoute,
  joinOutcome,
  joinLatestUnresolved,
  readOutcomes,
  computeRoutingAccuracy,
  computeAdherence,
  type RouteOutcomeRecord,
  type RoutingAccuracy,
} from './route-outcomes.js';

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
/** A single alternative route suggestion. */
export interface RouteAlternative { route: string; score?: number; }

/** Statistics surfaced by the keyword router (stub fields for CLI display). */
export interface KeywordRouterStats {
  updateCount: number;
  qTableSize: number;
  stepCount: number;
  epsilon: number;
  avgTDError: number;
  useNative: number;
  [key: string]: unknown;
}

export interface KeywordRouter {
  route: (task: string, useExploration?: boolean) => Promise<RouteDecision>;
  initialize: () => Promise<void>;
  getStats: () => KeywordRouterStats;
  /** Record feedback; returns the TD-error (0 in the lean keyword stub). */
  update: (task: string, agentId: string, reward: number, nextTask?: string) => number;
  reset: () => void;
  export: () => unknown;
  import: (data: unknown) => void;
}


export interface RouteDecision { agentType: string; confidence: number; reasoning?: string; route: string; qValues?: number[]; explored?: boolean; alternatives?: RouteAlternative[]; }

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
      return {
        agentType,
        confidence: 0.75,
        reasoning: 'keyword-based routing',
        route: agentType,
        qValues: [],
        explored: false,
        alternatives: agentTypes.filter(a => a !== agentType).slice(0, 3).map(a => ({ route: a, score: 0 })),
      };
    },
    async initialize() {},
    getStats(): KeywordRouterStats {
      return { updateCount: 0, qTableSize: 0, stepCount: 0, epsilon: 0, avgTDError: 0, useNative: 0 };
    },
    update() { return 0; },
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

