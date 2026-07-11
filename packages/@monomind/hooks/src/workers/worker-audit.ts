/**
 * Security audit worker factory.
 * Ported from the deleted CLI worker-daemon (runAuditWorkerLocal) so the
 * .monomind/metrics/security-audit.json consumers (route-handler.cjs,
 * statusline, doctor checkSecurityAuditFindings) keep working.
 *
 * Output schema (unchanged): { timestamp, mode, checks, riskLevel,
 * recommendations, note, priorityScanTargets?, unexpectedCoupling? }
 */

import * as path from 'path';
import * as fs from 'fs';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';

export function createAuditWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();
    const metricsDir = path.join(projectRoot, '.monomind', 'metrics');
    const auditFile = path.join(metricsDir, 'security-audit.json');

    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    const audit: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      mode: 'local',
      checks: {
        envFilesProtected: !fs.existsSync(path.join(projectRoot, '.env.local')),
        gitIgnoreExists: fs.existsSync(path.join(projectRoot, '.gitignore')),
        noHardcodedSecrets: null, // Not checked in local mode — requires AI-powered scan
      },
      riskLevel: 'low',
      recommendations: [] as string[],
      note: 'Install Claude Code CLI for AI-powered security analysis',
    };

    // Enrich with monograph high-centrality files and surprising cross-community
    // edges. God-node files are high-value targets for security review: they are
    // imported by many consumers, so a vulnerability there has the largest blast
    // radius. Cross-community edges reveal unexpected coupling that may indicate
    // hidden attack surfaces. @monoes/monograph is resolved dynamically (hoisted
    // at the repo root, not a package dependency) — silently skip on any error.
    try {
      const monographSpec = '@monoes/monograph';
      const { openDb, closeDb } = await import(monographSpec);
      const dbPath = path.join(projectRoot, '.monomind', 'monograph.db');
      if (fs.existsSync(dbPath)) {
        const db = openDb(dbPath);
        try {
          // Top 5 high-centrality (god-node) files — largest security blast radius
          type GodFileRow = { file_path: string; degree: number };
          const godFileRows = db.prepare(`
            SELECT n.file_path,
                   COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) AS degree
            FROM nodes n
            LEFT JOIN edges e1 ON e1.source_id = n.id
            LEFT JOIN edges e2 ON e2.target_id = n.id
            WHERE n.label NOT IN ('File','Folder','Community','Concept')
              AND n.file_path IS NOT NULL
              AND n.file_path NOT LIKE '%node_modules%'
              AND n.file_path NOT LIKE '%/dist/%'
              AND n.file_path NOT LIKE '%.test.%'
              AND n.file_path NOT LIKE '%.spec.%'
            GROUP BY n.file_path
            ORDER BY degree DESC
            LIMIT 5
          `).all() as GodFileRow[];

          // Top 5 surprising cross-community edges — potential hidden coupling / attack surface
          type SurpriseRow = { src_name: string; tgt_name: string; relation: string; confidence_score: number; src_file: string | null; tgt_file: string | null };
          const surpriseRows = db.prepare(`
            SELECT n1.name as src_name, n2.name as tgt_name, e.relation, e.confidence_score,
                   n1.file_path as src_file, n2.file_path as tgt_file
            FROM edges e
            JOIN nodes n1 ON n1.id = e.source_id
            JOIN nodes n2 ON n2.id = e.target_id
            WHERE e.confidence != 'EXTRACTED'
              AND n1.community_id IS NOT NULL
              AND n2.community_id IS NOT NULL
              AND n1.community_id != n2.community_id
            ORDER BY e.confidence_score ASC
            LIMIT 5
          `).all() as SurpriseRow[];

          if (godFileRows.length > 0) {
            audit['priorityScanTargets'] = godFileRows.map(r => ({
              file: r.file_path.replace(projectRoot + '/', '').replace(projectRoot + '\\', ''),
              degree: r.degree,
              reason: 'high-centrality: vulnerability here affects the most consumers',
            }));
          }
          if (surpriseRows.length > 0) {
            audit['unexpectedCoupling'] = surpriseRows.map(r => ({
              edge: `${r.src_name} --${r.relation}--> ${r.tgt_name}`,
              srcFile: r.src_file ?? '(unknown)',
              tgtFile: r.tgt_file ?? '(unknown)',
              confidenceScore: r.confidence_score,
              reason: 'cross-community edge: may indicate hidden dependency or attack surface',
            }));
          }
        } finally {
          closeDb(db);
        }
      }
    } catch { /* monograph unavailable — skip graph enrichment */ }

    // Atomic write: tmp + rename, so readers never see a partial file.
    const tmp = auditFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(audit, null, 2));
    fs.renameSync(tmp, auditFile);

    return {
      worker: 'audit',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: audit,
    };
  };
}
