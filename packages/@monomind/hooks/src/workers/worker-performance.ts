/**
 * Performance worker factory.
 * Extracted from workers/index.ts (ARCH-3b).
 */

import * as os from 'os';
import * as path from 'path';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';
import { countLines } from './worker-utils.js';

export function createPerformanceWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();

    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memPct = Math.round((1 - freeMem / totalMem) * 100);

    const cpus = os.cpus();
    const loadAvg = os.loadavg()[0];

    let pkgLines = 0;
    try {
      const packagesPath = path.join(projectRoot, 'packages');
      pkgLines = await countLines(packagesPath, '.ts');
    } catch {
      // dir may not exist
    }

    return {
      worker: 'performance',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: {
        memory: {
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
          systemPct: memPct,
        },
        cpu: {
          cores: cpus.length,
          loadAvg: loadAvg.toFixed(2),
        },
        codebase: {
          pkgLines,
        },
        speedup: '1.0x',
      },
    };
  };
}
