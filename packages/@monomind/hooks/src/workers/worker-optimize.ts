/**
 * Optimize (performance snapshot) worker factory.
 * Ported from the deleted CLI worker-daemon (runOptimizeWorkerLocal) so the
 * .monomind/metrics/performance.json consumers (route-handler.cjs, doctor
 * metrics freshness) keep working.
 *
 * Output schema: { timestamp, mode, workerProcessMemoryUsage, uptime,
 * optimizations: { cacheHitRate, avgResponseTime }, note }
 *
 * P3-19: `workerProcessMemoryUsage` (previously `memoryUsage`) reflects only
 * this worker's own transient process — there is no persistent daemon to
 * measure. Consumers must not describe it as daemon RSS or suggest
 * "restarting the daemon". See route-handler.cjs:404-411, which still reads
 * the old `memoryUsage` field and prints
 * "[PERF] Daemon RSS ... Consider restarting daemon or reducing worker
 * concurrency" — needs updating to read `workerProcessMemoryUsage` and drop
 * the daemon-restart advice.
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
      // P3-19: this is the memory of whatever process happens to run this
      // worker (a one-shot `hooks worker run` CLI invocation, or the
      // session-start hook bridge) — NOT a persistent daemon, since the
      // daemon was removed. Named accordingly so downstream consumers don't
      // report it as ongoing daemon health.
      workerProcessMemoryUsage: process.memoryUsage(),
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
