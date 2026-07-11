/**
 * Memory consolidation worker factory.
 * Ported from the deleted CLI worker-daemon (runConsolidateWorker) so the
 * .monomind/metrics/consolidation.json consumers (route-handler.cjs, doctor
 * metrics freshness) keep working.
 *
 * RAPTOR-style memory consolidation: cluster episodic entries by namespace,
 * generate a summary entry as 'contextual' type referencing source cluster.
 * Source: https://arxiv.org/abs/2401.18059 (RAPTOR — ICLR 2024)
 *
 * Output schema (unchanged): { timestamp, patternsConsolidated,
 * clustersCreated, memoryCleaned, duplicatesRemoved, mode }
 */

import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';

/**
 * Resolve the CLI memory bridge (bridgeSearchEntries/bridgeStoreEntry).
 * The bridge lives in @monomind/cli, which this package must not depend on —
 * try the compiled dist inside the project (dev repo / installed CLI layout)
 * and give up quietly otherwise. Consolidation then reports zeros, honestly.
 */
async function loadMemoryBridge(projectRoot: string): Promise<{
  bridgeSearchEntries: (o: Record<string, unknown>) => Promise<{ results?: Array<{ key: string }> } | null>;
  bridgeStoreEntry: (o: Record<string, unknown>) => Promise<unknown>;
} | null> {
  const candidates = [
    path.join(projectRoot, 'packages', '@monomind', 'cli', 'dist', 'src', 'memory', 'memory-bridge.js'),
    path.join(projectRoot, 'node_modules', '@monoes', 'monomindcli', 'dist', 'src', 'memory', 'memory-bridge.js'),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const mod = await import(pathToFileURL(candidate).href);
      if (typeof mod.bridgeSearchEntries === 'function' && typeof mod.bridgeStoreEntry === 'function') {
        return mod;
      }
    } catch { /* try next */ }
  }
  return null;
}

export function createConsolidateWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();
    const metricsDir = path.join(projectRoot, '.monomind', 'metrics');
    const consolidateFile = path.join(metricsDir, 'consolidation.json');

    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    let patternsConsolidated = 0;
    let clustersCreated = 0;

    const writeMetrics = (data: Record<string, unknown>) => {
      // Atomic write: tmp + rename, so readers never see a partial file.
      const tmp = consolidateFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, consolidateFile);
    };

    // Write the baseline result up-front: the memory bridge loads an embedding
    // model, which can outlive the caller's timeout budget (session-start hooks
    // abandon after 1.5s and the hook process force-exits at 5s). Writing first
    // guarantees the output file exists for freshness gating/doctor even when
    // clustering doesn't finish; it is atomically rewritten below when it does.
    const baseline = {
      timestamp: new Date().toISOString(),
      patternsConsolidated: 0,
      clustersCreated: 0,
      memoryCleaned: 0,
      duplicatesRemoved: 0,
      mode: 'raptor',
    };
    try { writeMetrics(baseline); } catch { /* fs failure — surfaced below */ }

    try {
      const bridge = await loadMemoryBridge(projectRoot);
      if (bridge) {
        // Retrieve recent episodic entries (short-term tier) for RAPTOR clustering
        const episodic = await bridge.bridgeSearchEntries({
          query: 'task outcome agent pattern',
          namespace: 'patterns',
          limit: 50,
          threshold: 0.0,
        });

        if (episodic?.results && episodic.results.length >= 3) {
          // Group into clusters of ~5 by simple sequential chunking
          const CLUSTER_SIZE = 5;
          for (let i = 0; i < episodic.results.length; i += CLUSTER_SIZE) {
            const cluster = episodic.results.slice(i, i + CLUSTER_SIZE);
            if (cluster.length < 2) continue;

            // Build cluster summary (lightweight abstraction without LLM)
            const keys = cluster.map(r => r.key).join(', ');
            const summary = `RAPTOR cluster [${Math.floor(i / CLUSTER_SIZE)}]: ` +
              `${cluster.length} patterns consolidated. Topics: ${keys.slice(0, 120)}`;

            await bridge.bridgeStoreEntry({
              key: `raptor_cluster:${Date.now()}_${i}`,
              value: summary,
              namespace: 'contextual',
              tags: ['raptor', 'cluster_summary'],
            });

            patternsConsolidated += cluster.length;
            clustersCreated++;
          }
        }
      }
    } catch { /* non-critical — bridge may be unavailable */ }

    const result = {
      timestamp: new Date().toISOString(),
      patternsConsolidated,
      clustersCreated,
      memoryCleaned: 0,
      duplicatesRemoved: 0,
      mode: 'raptor',
    };

    writeMetrics(result);

    return {
      worker: 'consolidate',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: result,
    };
  };
}
