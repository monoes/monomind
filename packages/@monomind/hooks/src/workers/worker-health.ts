/**
 * Health worker factory.
 * Extracted from workers/index.ts (ARCH-3b).
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';

export function createHealthWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memPct = Math.round((1 - freeMem / totalMem) * 100);

    // A sandbox can deny the boot-time read (macOS Seatbelt: "uv_uptime returned
    // EPERM", #798); report the rest instead of failing the whole check.
    let uptime: number | null = null;
    try {
      uptime = os.uptime();
    } catch {
      // unreadable here
    }
    const loadAvg = os.loadavg();

    let diskPct = 0;
    let diskFree = 'N/A';
    try {
      const stats = await fs.statfs(projectRoot);
      diskPct = Math.round((1 - stats.bavail / stats.blocks) * 100);
      diskFree = `${Math.round((stats.bavail * stats.bsize) / 1024 / 1024 / 1024)}GB`;
    } catch {
      // statfs may not be available on all platforms
    }

    const status =
      memPct > 90 || diskPct > 90
        ? 'critical'
        : memPct > 80 || diskPct > 80
          ? 'warning'
          : 'healthy';

    return {
      worker: 'health',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: {
        status,
        memory: { usedPct: memPct, freeMB: Math.round(freeMem / 1024 / 1024) },
        disk: { usedPct: diskPct, free: diskFree },
        system: {
          uptime: uptime === null ? null : Math.round(uptime / 3600),
          loadAvg: loadAvg.map((l) => l.toFixed(2)),
          platform: os.platform(),
          arch: os.arch(),
        },
      },
    };
  };
}
