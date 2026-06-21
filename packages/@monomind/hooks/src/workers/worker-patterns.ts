/**
 * Patterns worker factory.
 * Extracted from workers/index.ts (ARCH-3b).
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';
import { safeJsonParse, calculateAvgQuality } from './worker-utils.js';

export function createPatternsWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();

    const learningDir = path.join(projectRoot, '.monomind', 'learning');
    let patternsData: Record<string, unknown> = {
      shortTerm: 0,
      longTerm: 0,
      duplicates: 0,
      consolidated: 0,
    };

    try {
      const patternsFile = path.join(learningDir, 'patterns.json');
      const content = await fs.readFile(patternsFile, 'utf-8');
      const patterns = safeJsonParse<Record<string, unknown>>(content);

      const shortTerm = (patterns.shortTerm as Array<{ strategy?: string; quality?: number }>) || [];
      const longTerm = (patterns.longTerm as Array<{ strategy?: string; quality?: number }>) || [];

      const seenStrategies = new Set<string>();
      let duplicates = 0;

      for (const pattern of [...shortTerm, ...longTerm]) {
        const strategy = pattern?.strategy;
        if (strategy && seenStrategies.has(strategy)) {
          duplicates++;
        } else if (strategy) {
          seenStrategies.add(strategy);
        }
      }

      patternsData = {
        shortTerm: shortTerm.length,
        longTerm: longTerm.length,
        duplicates,
        uniqueStrategies: seenStrategies.size,
        avgQuality: calculateAvgQuality([...shortTerm, ...longTerm]),
      };

      const metricsPath = path.join(projectRoot, '.monomind', 'metrics', 'patterns.json');
      await fs.writeFile(metricsPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        ...patternsData,
      }, null, 2));

    } catch {
      // No patterns file
    }

    return {
      worker: 'patterns',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: patternsData,
    };
  };
}
