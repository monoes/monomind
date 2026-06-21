/**
 * DDD compliance worker factory.
 * Extracted from workers/index.ts (ARCH-3b).
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';
import { searchDDDPatterns } from './worker-utils.js';

export function createDDDWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();

    const packagesPath = path.join(projectRoot, 'packages');
    const dddMetrics: Record<string, Record<string, number>> = {};
    let totalScore = 0;
    let maxScore = 0;

    const modules = [
      '@monomind/hooks',
      '@monomind/mcp',
      '@monomind/memory',
      '@monomind/security',
    ];

    const moduleResults = await Promise.all(
      modules.map(async (mod) => {
        const modPath = path.join(packagesPath, mod);
        const modMetrics: Record<string, number> = {
          entities: 0,
          valueObjects: 0,
          aggregates: 0,
          repositories: 0,
          services: 0,
          domainEvents: 0,
        };

        try {
          await fs.access(modPath);

          const srcPath = path.join(modPath, 'src');
          const patterns = await searchDDDPatterns(srcPath);
          Object.assign(modMetrics, patterns);

          const modScore = patterns.entities * 2 + patterns.valueObjects +
                          patterns.aggregates * 3 + patterns.repositories * 2 +
                          patterns.services + patterns.domainEvents * 2;

          return { mod, modMetrics, modScore, exists: true };
        } catch {
          return { mod, modMetrics, modScore: 0, exists: false };
        }
      })
    );

    for (const result of moduleResults) {
      if (result.exists) {
        dddMetrics[result.mod] = result.modMetrics;
        totalScore += result.modScore;
        maxScore += 20;
      }
    }

    const progressPct = maxScore > 0 ? Math.min(100, Math.round((totalScore / maxScore) * 100)) : 0;

    try {
      const outputPath = path.join(projectRoot, '.monomind', 'metrics', 'ddd-progress.json');
      await fs.writeFile(outputPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        progress: progressPct,
        score: totalScore,
        maxScore,
        modules: dddMetrics,
      }, null, 2));
    } catch {
      // Ignore write errors
    }

    return {
      worker: 'ddd',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: {
        progress: progressPct,
        score: totalScore,
        maxScore,
        modulesTracked: Object.keys(dddMetrics).length,
        modules: dddMetrics,
      },
    };
  };
}
