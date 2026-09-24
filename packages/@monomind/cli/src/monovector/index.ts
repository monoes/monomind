/**
 * MonoVector Integration Module for Monomind CLI (lean)
 *
 * After the SONA / native / WASM teardown this module provides:
 * - Initialization state: createInitState()
 * - Task routing: createKeywordRouter() (delegates to the central picker)
 * - Route recommendation→outcome records: recordRoute(), joinOutcome(), accuracy
 * - AST diff classification: DiffClassifier
 *
 * @module @monomind/cli/monovector
 */

import { join } from 'node:path';
import {
  computeAdherence,
  computeRoutingAccuracy,
  joinLatestUnresolved,
  type RouteOutcomeRecord,
  readOutcomes,
  recordRoute,
} from './route-outcomes.js';

export {
  analyzeDiff,
  analyzeDiffSync,
  assessFileRisk,
  assessOverallRisk,
  classifyDiff,
  clearAllDiffCaches,
  clearDiffCache,
  createDiffClassifier,
  type DiffAnalysis,
  type DiffAnalysisResult,
  type DiffChange,
  type DiffClassification,
  DiffClassifier,
  type DiffClassifierConfig,
  type DiffFile,
  type DiffHunk,
  type FileDiff,
  type FileRisk,
  getGitDiffNumstat,
  getGitDiffNumstatAsync,
  type OverallRisk,
  type RiskLevel,
  suggestReviewers,
} from './diff-classifier.js';
export { createInitState, type InitState, type InitStatus } from './init-state.js';
export {
  computeAdherence,
  computeRoutingAccuracy,
  joinLatestUnresolved,
  joinOutcome,
  type RouteOutcomeRecord,
  type RoutingAccuracy,
  readOutcomes,
  recordRoute,
} from './route-outcomes.js';

/** A single alternative route suggestion. */
export interface RouteAlternative {
  route: string;
  score?: number;
}

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

export interface RouteDecision {
  agentType: string;
  confidence: number;
  reasoning?: string;
  route: string;
  alternatives?: RouteAlternative[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export type KeywordRouterConfig = {};

export function createKeywordRouter(_config?: KeywordRouterConfig): KeywordRouter {
  const baseDir = join(process.cwd(), '.monomind');

  return {
    // Delegates to the central picker so `route task` agrees with `monomind
    // pick`, the `pick` MCP tool and `hooks route`; routes are spawnable names.
    async route(task: string): Promise<RouteDecision> {
      const { pickAgents } = await import('../routing/agent-pick.js');
      const pick = await pickAgents(task, 4, process.cwd());
      const [primary, ...rest] = pick.agents;
      return {
        agentType: primary.type,
        confidence: primary.confidence,
        reasoning: `${pick.method} pick: ${primary.reason}`,
        route: primary.type,
        alternatives: rest.map((a) => ({ route: a.type, score: a.confidence })),
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
      const lines = `${data.map((r) => JSON.stringify(r)).join('\n')}\n`;
      await fsp.writeFile(join(baseDir, 'route-outcomes.jsonl'), lines, 'utf8');
    },
  };
}
