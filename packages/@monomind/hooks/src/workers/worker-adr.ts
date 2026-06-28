/**
 * ADR compliance worker factory.
 * Extracted from workers/index.ts (ARCH-3b).
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';
import { safeJsonParse } from './worker-utils.js';

export function createADRWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();

    const adrChecks: Record<string, { compliant: boolean; reason?: string }> = {};
    const packagesPath = path.join(projectRoot, 'packages');
    const dddDomains = ['agent-lifecycle', 'task-execution', 'memory-management', 'coordination'];

    const [
      adr002Results,
      adr005Result,
      adr006Result,
      adr008Result,
      adr011Result,
      adr012Result,
    ] = await Promise.all([
      // ADR-002: DDD domains (parallel check)
      Promise.allSettled(
        dddDomains.map(d => fs.access(path.join(packagesPath, '@monomind', d)))
      ),

      // ADR-005: MCP-first design
      fs.access(path.join(packagesPath, '@monomind', 'mcp'))
        .then(() => ({ compliant: true, reason: 'MCP package exists' }))
        .catch(() => ({ compliant: false, reason: 'No MCP package' })),

      // ADR-006: Memory unification
      fs.access(path.join(packagesPath, '@monomind', 'memory'))
        .then(() => ({ compliant: true, reason: 'Memory package exists' }))
        .catch(() => ({ compliant: false, reason: 'No memory package' })),

      // ADR-008: Vitest over Jest
      fs.readFile(path.join(projectRoot, 'package.json'), 'utf-8')
        .then(content => {
          const pkg = safeJsonParse<Record<string, unknown>>(content);
          const hasVitest = (pkg.devDependencies as Record<string, unknown>)?.vitest !== undefined;
          return { compliant: hasVitest, reason: hasVitest ? 'Vitest found' : 'No Vitest' };
        })
        .catch(() => ({ compliant: false, reason: 'Package not readable' })),

      // ADR-011: LLM Provider System
      fs.access(path.join(packagesPath, '@monomind', 'providers'))
        .then(() => ({ compliant: true, reason: 'Providers package exists' }))
        .catch(() => ({ compliant: false, reason: 'No providers package' })),

      // ADR-012: MCP Security
      fs.readFile(path.join(packagesPath, '@monomind', 'mcp', 'src', 'index.ts'), 'utf-8')
        .then(content => {
          const hasRateLimiter = content.includes('RateLimiter');
          const hasOAuth = content.includes('OAuth');
          const hasSchemaValidator = content.includes('validateSchema');
          return {
            compliant: hasRateLimiter && hasOAuth && hasSchemaValidator,
            reason: `Rate:${hasRateLimiter} OAuth:${hasOAuth} Schema:${hasSchemaValidator}`,
          };
        })
        .catch(() => ({ compliant: false, reason: 'MCP index not readable' })),
    ]);

    const dddCount = adr002Results.filter(r => r.status === 'fulfilled').length;
    adrChecks['ADR-002'] = {
      compliant: dddCount >= 2,
      reason: `${dddCount}/${dddDomains.length} domains`,
    };

    adrChecks['ADR-005'] = adr005Result;
    adrChecks['ADR-006'] = adr006Result;
    adrChecks['ADR-008'] = adr008Result;
    adrChecks['ADR-011'] = adr011Result;
    adrChecks['ADR-012'] = adr012Result;

    const compliantCount = Object.values(adrChecks).filter(c => c.compliant).length;
    const totalCount = Object.keys(adrChecks).length;

    try {
      const outputPath = path.join(projectRoot, '.monomind', 'metrics', 'adr-compliance.json');
      await fs.writeFile(outputPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        compliance: Math.round((compliantCount / totalCount) * 100),
        checks: adrChecks,
      }, null, 2));
    } catch {
      // Ignore write errors
    }

    return {
      worker: 'adr',
      success: true,
      duration: Date.now() - startTime,
      timestamp: new Date(),
      data: {
        compliance: Math.round((compliantCount / totalCount) * 100),
        compliant: compliantCount,
        total: totalCount,
        checks: adrChecks,
      },
    };
  };
}
