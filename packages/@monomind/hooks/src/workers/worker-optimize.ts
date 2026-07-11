/**
 * Optimize (performance snapshot) worker factory.
 * Ported from the deleted CLI worker-daemon (runOptimizeWorkerLocal) so the
 * .monomind/metrics/performance.json consumers (route-handler.cjs, doctor
 * metrics freshness) keep working.
 *
 * Output schema (unchanged): { timestamp, mode, memoryUsage, uptime,
 * optimizations: { cacheHitRate, avgResponseTime }, note }
 */

import * as path from 'path';
import * as fs from 'fs';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';

export function createOptimizeWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();
    const metricsDir = path.join(projectRoot, '.monomind', 'metrics');
    const optimizeFile = path.join(metricsDir, 'performance.json');

    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    const perf = {
      timestamp: new Date().toISOString(),
      mode: 'local',
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      optimizations: {
        cacheHitRate: null, // Not measured in local mode — requires AI-powered analysis
        avgResponseTime: null, // Not measured in local mode — requires AI-powered analysis
      },
      note: 'Install Claude Code CLI for AI-powered optimization suggestions',
    };

    // Atomic write: tmp + rename, so readers never see a partial file.
    const tmp = optimizeFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(perf, null, 2));
    fs.renameSync(tmp, optimizeFile);

    return {
      worker: 'optimize',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: perf as unknown as Record<string, unknown>,
    };
  };
}
