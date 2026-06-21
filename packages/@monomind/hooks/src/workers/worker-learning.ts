/**
 * Learning worker factory.
 * Extracted from workers/index.ts (ARCH-3b).
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';
import { safeJsonParse, safePathAsync } from './worker-utils.js';

export function createLearningWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();

    const patternsDbPath = path.join(projectRoot, '.monomind', 'learning', 'patterns.db');
    let learningData: Record<string, unknown> = {
      patternsDb: false,
      shortTerm: 0,
      longTerm: 0,
      avgQuality: 0,
    };

    try {
      await fs.access(patternsDbPath);
      learningData.patternsDb = true;

      const metricsPath = path.join(projectRoot, '.monomind', 'metrics', 'learning.json');
      try {
        const content = await fs.readFile(metricsPath, 'utf-8');
        const metrics = safeJsonParse<Record<string, unknown>>(content);
        const patterns = metrics.patterns as Record<string, unknown> | undefined;
        const routing = metrics.routing as Record<string, unknown> | undefined;
        const intelligence = metrics.intelligence as Record<string, unknown> | undefined;
        learningData = {
          ...learningData,
          shortTerm: (patterns?.shortTerm as number) ?? 0,
          longTerm: (patterns?.longTerm as number) ?? 0,
          avgQuality: (patterns?.avgQuality as number) ?? 0,
          routingAccuracy: (routing?.accuracy as number) ?? 0,
          intelligenceScore: (intelligence?.score as number) ?? 0,
        };

        // ERL heuristic extraction
        const trajectories = metrics.trajectories as Array<{
          id: string;
          taskDescription: string;
          steps: Array<{ step: number; action: string; outcome: string; error?: string }>;
          success: boolean;
          agentSlug?: string;
          completedAt: number;
        }> | undefined;

        if (Array.isArray(trajectories) && trajectories.length > 0) {
          const { ERLWorker } = await import('./erl-worker.js');
          const erlWorker = new ERLWorker();
          const allHeuristics: unknown[] = [];

          for (const traj of trajectories) {
            const erlResult = erlWorker.extract({
              ...traj,
              steps: traj.steps.map(s => ({
                ...s,
                outcome: s.outcome as 'success' | 'failure' | 'partial',
              })),
            });
            allHeuristics.push(...erlResult.extracted);
          }

          if (allHeuristics.length > 0) {
            const heuristicsPath = await safePathAsync(projectRoot, '.monomind', 'learning', 'heuristics.json');
            await fs.writeFile(
              heuristicsPath,
              JSON.stringify({ updatedAt: Date.now(), heuristics: allHeuristics }, null, 2),
              'utf-8',
            ).catch(() => { /* non-fatal */ });
            learningData.erl = { heuristicsExtracted: allHeuristics.length };
          }
        }

        // TextGrad backward pass
        const taskOutputs = metrics.taskOutputs as Array<{
          taskId: string;
          taskDescription: string;
          output: string;
          agentSlug: string;
          qualityScore?: number;
        }> | undefined;

        if (Array.isArray(taskOutputs) && taskOutputs.length > 0) {
          const { TextGradWorker } = await import('./textgrad-worker.js');
          const textgradWorker = new TextGradWorker();
          const allGradients: unknown[] = [];

          for (const task of taskOutputs) {
            const tgResult = textgradWorker.compute(task);
            allGradients.push(...tgResult.gradients);
          }

          if (allGradients.length > 0) {
            const gradientsPath = await safePathAsync(projectRoot, '.monomind', 'learning', 'textual-gradients.json');
            await fs.writeFile(
              gradientsPath,
              JSON.stringify({ updatedAt: Date.now(), gradients: allGradients }, null, 2),
              'utf-8',
            ).catch(() => { /* non-fatal */ });
            learningData.textgrad = { gradientsGenerated: allGradients.length };
          }
        }

        // FOREVER forgetting curve + RAPTOR cluster summarisation
        const cachedEntries = metrics.entries as Array<{
          id: string;
          importanceScore: number;
          lastAccessedAt: number;
          namespace?: string;
        }> | undefined;

        if (Array.isArray(cachedEntries) && cachedEntries.length > 0) {
          if (cachedEntries.length >= 3) {
            const { RaptorWorker } = await import('./raptor-worker.js');
            const raptorWorker = new RaptorWorker({ clusterSize: 5, minClusterSize: 3 });
            const raptorResult = raptorWorker.consolidate(
              cachedEntries.map(e => ({ id: e.id, content: String(e.importanceScore), namespace: e.namespace })),
              'consolidated',
            );

            if (raptorResult.summaryEntries.length > 0) {
              const raptorPath = await safePathAsync(projectRoot, '.monomind', 'learning', 'raptor-summaries.json');
              await fs.writeFile(
                raptorPath,
                JSON.stringify({ generatedAt: Date.now(), summaries: raptorResult.summaryEntries }, null, 2),
                'utf-8',
              ).catch(() => { /* non-fatal */ });
              learningData.raptor = {
                clusters: raptorResult.clusters.length,
                summaries: raptorResult.summaryEntries.length,
              };
            }
          }

          const { ForgettingCurveWorker } = await import('./forgetting-curve-worker.js');
          const forgettingWorker = new ForgettingCurveWorker();
          const decayResult = await forgettingWorker.execute({ entries: cachedEntries });

          learningData.forgettingCurve = {
            processedCount: decayResult.processedCount,
            replayCount: decayResult.replayCount,
            replayIds: decayResult.scheduledForReplay.map(e => e.id),
          };

          if (decayResult.replayCount > 0) {
            const replayPath = await safePathAsync(projectRoot, '.monomind', 'learning', 'replay-queue.json');
            await fs.writeFile(
              replayPath,
              JSON.stringify({ scheduledAt: Date.now(), entries: decayResult.scheduledForReplay }, null, 2),
              'utf-8',
            ).catch(() => { /* non-fatal */ });
          }
        }
      } catch {
        // No metrics file
      }
    } catch {
      // No patterns DB
    }

    return {
      worker: 'learning',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: learningData,
    };
  };
}
