/**
 * Security worker factory.
 * Extracted from workers/index.ts (ARCH-3b).
 *
 * Reports only what it actually measured:
 * - `status` is 'clean' ONLY when every candidate file was read. If any path
 *   could not be read the verdict is 'incomplete' (never 'clean'), and
 *   `skippedCount` says how many paths were not examined.
 * - There is no CVE tracking here. A hardcoded `cves: { tracked: [...7 fake
 *   ids], remediated: 7 }` used to be written into scan-results.json; it was
 *   a constant, not a measurement, and nothing consumed it. Removed rather
 *   than left to be mistaken for real remediation data.
 * - `insecurePatterns` was likewise removed: it was always 0 because nothing
 *   ever incremented it. Insecure code patterns are counted in
 *   `vulnerabilities` via `vulnPatterns`.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';
import { scanDirectoryForPatterns } from './worker-utils.js';

export function createSecurityWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();

    const findings: Record<string, number> = {
      secrets: 0,
      vulnerabilities: 0,
    };

    let filesScanned = 0;
    const skippedPaths: string[] = [];

    const secretPatterns = [
      /password\s*[=:]\s*["'][^"']+["']/gi,
      /api[_-]?key\s*[=:]\s*["'][^"']+["']/gi,
      /secret\s*[=:]\s*["'][^"']+["']/gi,
      /token\s*[=:]\s*["'][^"']+["']/gi,
      /private[_-]?key/gi,
    ];

    const vulnPatterns = [
      /\beval\s*\([^)]*\buser/gi,
      /\beval\s*\([^)]*\breq\./gi,
      /new\s+Function\s*\([^)]*\+/gi,
      /innerHTML\s*=\s*[^"'`]/gi,
      /dangerouslySetInnerHTML/gi,
    ];

    const dirsToScan = [
      path.join(projectRoot, 'packages'),
      path.join(projectRoot, 'src'),
    ];

    for (const dir of dirsToScan) {
      try {
        await fs.access(dir);
      } catch {
        // Directory doesn't exist in this project — nothing to scan, not an error.
        continue;
      }

      try {
        const results = await scanDirectoryForPatterns(dir, secretPatterns, vulnPatterns);
        findings.secrets += results.secrets;
        findings.vulnerabilities += results.vulnerabilities;
        filesScanned += results.filesScanned;
        skippedPaths.push(...results.skipped);
      } catch (e) {
        // The scan of this directory failed outright: record it as skipped so
        // the verdict can never be reported as "clean" on unexamined code.
        skippedPaths.push(dir);
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG) {
          console.error('[worker-security] scan failed for', dir, e);
        }
      }
    }

    const totalIssues = findings.secrets + findings.vulnerabilities;
    const incomplete = skippedPaths.length > 0;
    const status = totalIssues > 10 ? 'critical' :
                   totalIssues > 0 ? 'warning' :
                   incomplete ? 'incomplete' : 'clean';

    try {
      const outputPath = path.join(projectRoot, '.monomind', 'security', 'scan-results.json');
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        status,
        findings,
        totalIssues,
        filesScanned,
        incomplete,
        skippedCount: skippedPaths.length,
        skippedPaths: skippedPaths.slice(0, 50),
      }, null, 2));
    } catch (e) {
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[worker-security] failed to write scan-results.json:', e);
    }

    return {
      worker: 'security',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: {
        status,
        secrets: findings.secrets,
        vulnerabilities: findings.vulnerabilities,
        totalIssues,
        filesScanned,
        incomplete,
        skippedCount: skippedPaths.length,
      },
    };
  };
}
