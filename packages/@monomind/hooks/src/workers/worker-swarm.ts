/**
 * Swarm worker factory.
 * Extracted from workers/index.ts (ARCH-3b).
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';
import { safeJsonParse } from './worker-utils.js';

export function createSwarmWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();

    const activityPath = path.join(projectRoot, '.monomind', 'metrics', 'swarm-activity.json');
    let swarmData: Record<string, unknown> = {};

    try {
      const content = await fs.readFile(activityPath, 'utf-8');
      swarmData = safeJsonParse(content);
    } catch {
      // No activity file
    }

    const queuePath = path.join(projectRoot, '.monomind', 'swarm', 'queue');
    let queueCount = 0;
    try {
      const files = await fs.readdir(queuePath);
      queueCount = files.filter(f => f.endsWith('.json')).length;
    } catch {
      // No queue dir
    }

    return {
      worker: 'swarm',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: {
        active: (swarmData as any)?.swarm?.active ?? false,
        agentCount: (swarmData as any)?.swarm?.agent_count ?? 0,
        queuePending: queueCount,
        lastUpdate: (swarmData as any)?.timestamp ?? null,
      },
    };
  };
}
