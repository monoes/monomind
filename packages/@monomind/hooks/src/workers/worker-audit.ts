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

/**
 * A barrel file (index.*) re-exporting modules is the intended public-API
 * pattern, not hidden coupling — community detection routinely places a
 * barrel in a different cluster than the modules it fronts, so these edges
 * are pure noise in a security audit. Exported for tests.
 */
export function isBarrelReExport(r: { relation: string; src_file: string | null }): boolean {
  return r.relation === 'RE_EXPORTS' && /(^|[/\\])index\.[cm]?[jt]sx?$/.test(r.src_file ?? '');
}

export function createAuditWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();
    const metricsDir = path.join(projectRoot, '.monomind', 'metrics');
    const auditFile = path.join(metricsDir, 'security-audit.json');

    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    type Finding = { id: string; severity: 'high' | 'medium' | 'low'; message: string; source: string };
    const findings: Finding[] = [];
    const recommendations: string[] = [];

    const envFileExists = fs.existsSync(path.join(projectRoot, '.env.local'));
    const gitIgnoreExists = fs.existsSync(path.join(projectRoot, '.gitignore'));

    const checks = {
      envFilesProtected: !envFileExists,
      gitIgnoreExists,
      noHardcodedSecrets: null as boolean | null, // Not checked in local mode — requires AI-powered scan
    };

    if (envFileExists) {
      // A tracked/present .env.local without a .gitignore entry is a real risk
      // of committing secrets; with a .gitignore present it's still worth a
      // recommendation but not a hard finding.
      if (!gitIgnoreExists) {
        findings.push({
          id: 'env-file-no-gitignore',
          severity: 'high',
          message: '.env.local exists and there is no .gitignore to protect it from being committed',
          source: 'checks.envFilesProtected',
        });
        recommendations.push('Add a .gitignore that excludes .env.local before committing');
      } else {
        findings.push({
          id: 'env-file-present',
          severity: 'low',
          message: '.env.local exists — verify it is listed in .gitignore and never committed',
          source: 'checks.envFilesProtected',
        });
      }
    }

    if (!gitIgnoreExists) {
      findings.push({
        id: 'no-gitignore',
        severity: 'medium',
        message: 'No .gitignore file found — build artifacts, secrets, or local config may be committed accidentally',
        source: 'checks.gitIgnoreExists',
      });
      recommendations.push('Add a .gitignore file');
    }

    const audit: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      mode: 'local',
      checks,
      riskLevel: 'low',
      recommendations,
      findings,
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
          const surpriseRows = (db.prepare(`
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
            LIMIT 15
          `).all() as SurpriseRow[])
            .filter(r => !isBarrelReExport(r))
            .slice(0, 5);

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
            // Low-confidence cross-community coupling is informational, not a
            // hard vulnerability — surface as low-severity findings so the
            // route-handler.cjs reader and riskLevel computation see them.
            for (const r of surpriseRows) {
              findings.push({
                id: 'unexpected-coupling',
                severity: 'low',
                message: `Cross-community edge ${r.src_name} --${r.relation}--> ${r.tgt_name} may indicate hidden coupling`,
                source: 'unexpectedCoupling',
              });
            }
          }
        } finally {
          closeDb(db);
        }
      }
    } catch { /* monograph unavailable — skip graph enrichment */ }

    // Compute a real riskLevel from what was actually found, rather than a
    // hardcoded constant: any high-severity finding escalates the whole
    // audit, medium if none but some medium findings exist, else low.
    const riskLevel: 'high' | 'medium' | 'low' = findings.some(f => f.severity === 'high')
      ? 'high'
      : findings.some(f => f.severity === 'medium')
        ? 'medium'
        : 'low';
    audit['riskLevel'] = riskLevel;
    audit['findings'] = findings;

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
