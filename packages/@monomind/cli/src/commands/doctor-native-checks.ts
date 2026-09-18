/**
 * Doctor — native-addon health.
 *
 * Issue #231: `monograph build` died on a better-sqlite3 ABI mismatch and doctor
 * reported only "No monograph graph built yet". Doctor's graph-freshness check can
 * only see a native failure when a *detached* build already crashed and left a
 * build.log — a fresh install, or a failed interactive `monograph build` (which
 * writes no log), leaves it completely blind. This check doesn't infer the
 * condition from wreckage; it loads the binding and reports what happened.
 */

import { probeMonographSqliteBinding } from '../utils/native-binding.js';
import type { HealthCheck } from './doctor-env-checks.js';

export async function checkNativeBindings(): Promise<HealthCheck> {
  const diag = probeMonographSqliteBinding();
  const name = 'Native modules';

  if (diag.status === 'ok') {
    return {
      name,
      status: 'pass',
      message: `better-sqlite3 loads under Node ${diag.nodeVersion} (ABI ${diag.runtimeAbi})`,
    };
  }

  const where = diag.binaryPath ? ` — loaded from ${diag.binaryPath}` : '';
  return {
    name,
    // Hard fail, not a warning: with no working binding, monograph build,
    // monograph search and every graph-backed MCP tool are dead.
    status: 'fail',
    message: `${diag.summary}${where}`,
    fix: diag.fix,
  };
}
