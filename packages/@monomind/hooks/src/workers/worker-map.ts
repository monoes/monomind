/**
 * Codebase map worker factory.
 * Ported from the deleted CLI worker-daemon (runMapWorker) so the
 * .monomind/metrics/codebase-map.json consumers (route-handler.cjs,
 * statusline, doctor) keep working without a daemon process.
 *
 * Output schema (unchanged): { timestamp, structure, scannedAt, graph?,
 * topFiles?: [{ ref, degree }], graphStaleness?: { commitsBehind } }
 */

import * as path from 'path';
import * as fs from 'fs';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';

export function createMapWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();
    const metricsDir = path.join(projectRoot, '.monomind', 'metrics');
    const metricsFile = path.join(metricsDir, 'codebase-map.json');

    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    const map: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      structure: {
        hasPackageJson: fs.existsSync(path.join(projectRoot, 'package.json')),
        hasTsConfig: fs.existsSync(path.join(projectRoot, 'tsconfig.json')),
        hasClaudeConfig: fs.existsSync(path.join(projectRoot, '.claude')),
        hasMonomind: fs.existsSync(path.join(projectRoot, '.monomind')),
      },
      scannedAt: Date.now(),
    };

    // Enrich with monograph graph stats for LLM context injection.
    // @monoes/monograph is not a dependency of this package — resolve it
    // dynamically (works when hoisted to the repo root) and silently skip
    // on any error.
    try {
      const monographSpec = '@monoes/monograph';
      const { openDb, closeDb, countNodes, countEdges } = await import(monographSpec);
      const dbPath = path.join(projectRoot, '.monomind', 'monograph.db');
      if (fs.existsSync(dbPath)) {
        const db = openDb(dbPath);
        try {
          map['graph'] = {
            nodes: countNodes(db),
            edges: countEdges(db),
          };

          // Top 3 god nodes (high degree internal files) — same SQL as monograph_god_nodes tool
          const excluded = ['File', 'Folder', 'Community', 'Concept'];
          const rows = db.prepare(`
            SELECT n.name, n.file_path, n.start_line,
                   COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) AS degree
            FROM nodes n
            LEFT JOIN edges e1 ON e1.source_id = n.id
            LEFT JOIN edges e2 ON e2.target_id = n.id
            WHERE n.label NOT IN (${excluded.map(() => '?').join(',')})
            GROUP BY n.id HAVING degree > 0
            ORDER BY degree DESC LIMIT 3
          `).all(...excluded) as Array<{ name: string; file_path?: string; start_line?: number; degree: number }>;

          if (rows.length > 0) {
            map['topFiles'] = rows.map(r => ({
              ref: r.file_path
                ? (r.start_line != null ? `${r.file_path}:${r.start_line}` : r.file_path)
                : r.name,
              degree: r.degree,
            }));
          }

          // Index staleness via git — same approach as monograph_health tool
          try {
            const { execSync } = await import('child_process');
            const lastHash = (db.prepare(
              "SELECT value FROM meta WHERE key = 'last_commit_hash' LIMIT 1"
            ).get() as { value?: string } | undefined)?.value;
            if (lastHash) {
              const countOut = execSync(
                `git -C ${JSON.stringify(projectRoot)} rev-list --count ${lastHash}..HEAD`,
                { timeout: 5000 }
              ).toString().trim();
              const commitsBehind = parseInt(countOut, 10);
              if (!isNaN(commitsBehind)) {
                map['graphStaleness'] = { commitsBehind };
              }
            }
          } catch { /* git unavailable — skip staleness */ }
        } finally {
          closeDb(db);
        }
      }
    } catch { /* monograph unavailable — skip graph enrichment */ }

    // Atomic write: tmp + rename, so readers never see a partial file.
    const tmp = metricsFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2));
    fs.renameSync(tmp, metricsFile);

    return {
      worker: 'map',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: map,
    };
  };
}
