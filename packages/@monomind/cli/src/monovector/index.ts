/**
 * MonoVector Integration Module for Monomind CLI (lean)
 *
 * After the SONA / native / WASM teardown this module provides:
 * - Initialization state: createInitState()
 * - Keyword-based task routing: createKeywordRouter()
 * - Route recommendation→outcome records: recordRoute(), joinOutcome(), accuracy
 * - AST diff classification: DiffClassifier
 *
 * @module @monomind/cli/monovector
 */

import { join } from 'node:path';
import {
  recordRoute,
  joinLatestUnresolved,
  readOutcomes,
  computeRoutingAccuracy,
  computeAdherence,
  type RouteOutcomeRecord,
} from './route-outcomes.js';

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

/** A single alternative route suggestion. */
export interface RouteAlternative { route: string; score?: number; }

/** Statistics from the route-outcomes store. */
export interface KeywordRouterStats {
  outcomeCount: number;
  accuracy: number | null;
  adherence: number | null;
  trend: number | null;
  byMode: { native: number | null; js: number | null };
}

export interface KeywordRouter {
  route: (task: string) => Promise<RouteDecision>;
  initialize: () => Promise<void>;
  getStats: () => Promise<KeywordRouterStats>;
  update: (task: string, agentId: string, reward: number, nextTask?: string) => Promise<void>;
  reset: () => Promise<void>;
  export: () => Promise<RouteOutcomeRecord[]>;
  import: (data: RouteOutcomeRecord[]) => Promise<void>;
}


export interface RouteDecision { agentType: string; confidence: number; reasoning?: string; route: string; alternatives?: RouteAlternative[]; }

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface KeywordRouterConfig { /* reserved for future use */ }



export function createKeywordRouter(_config?: KeywordRouterConfig): KeywordRouter {
  const agentTypes = ['coder', 'tester', 'reviewer', 'architect', 'researcher', 'optimizer', 'debugger', 'documenter'];
  const baseDir = join(process.cwd(), '.monomind');

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
        alternatives: agentTypes.filter(a => a !== agentType).slice(0, 3).map(a => ({ route: a, score: 0 })),
      };
    },
    async initialize() {},
    async getStats(): Promise<KeywordRouterStats> {
      const acc = await computeRoutingAccuracy(baseDir);
      const adh = await computeAdherence(baseDir);
      return {
        outcomeCount: acc.totalWithOutcome,
        accuracy: acc.accuracy,
        adherence: adh.adherence,
        trend: acc.recentVsPrior,
        byMode: acc.byMode,
      };
    },
    async update(task: string, agentId: string, reward: number) {
      const outcome = {
        agentActuallyUsed: agentId,
        measuredSuccess: reward > 0,
        quality: Math.max(-1, Math.min(1, reward)),
      };
      const joined = await joinLatestUnresolved(baseDir, outcome);
      if (!joined) {
        const { randomUUID } = await import('node:crypto');
        const rec: RouteOutcomeRecord = {
          routeId: randomUUID(),
          ts: Date.now(),
          task,
          recommendedAgent: agentId,
          routingMethod: 'manual-feedback',
          confidence: 1,
          learningMode: 'js',
          ...outcome,
        };
        await recordRoute(baseDir, rec);
      }
    },
    async reset() {
      const { promises: fsp } = await import('node:fs');
      await fsp.writeFile(join(baseDir, 'route-outcomes.jsonl'), '', 'utf8').catch(() => {});
    },
    async export(): Promise<RouteOutcomeRecord[]> {
      return readOutcomes(baseDir);
    },
    async import(data: RouteOutcomeRecord[]) {
      if (!Array.isArray(data)) return;
      const { promises: fsp } = await import('node:fs');
      await fsp.mkdir(baseDir, { recursive: true });
      const lines = data.map(r => JSON.stringify(r)).join('\n') + '\n';
      await fsp.writeFile(join(baseDir, 'route-outcomes.jsonl'), lines, 'utf8');
    },
  };
}



