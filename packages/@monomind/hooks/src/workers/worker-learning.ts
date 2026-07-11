/**
 * Learning worker factory.
 * Extracted from workers/index.ts (ARCH-3b).
 *
 * NOTE: this worker previously ran speculative ERL/TextGrad/RAPTOR/
 * forgetting-curve passes over metrics.trajectories/taskOutputs/entries.
 * Those inputs were never produced by anything (.monomind/learning/ stayed
 * empty and .monomind/metrics/learning.json never existed), so the
 * arXiv-inspired workers were deleted; this worker now only reports basic
 * learning metrics.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';
import { safeJsonParse } from './worker-utils.js';

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
