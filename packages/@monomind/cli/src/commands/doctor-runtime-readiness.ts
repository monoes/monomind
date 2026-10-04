import { locateBinary, RUNNER_SPECS, resolveBinary } from '../orgrt/runner-registry.js';
import { versionFromInstall } from '../orgrt/version-probe.js';
import type { HealthCheck } from './doctor-env-checks.js';

/** Read-only presence check: never runs a vendor CLI or accesses its login. */
export async function checkRuntimeReadiness(): Promise<HealthCheck> {
  const unavailable = RUNNER_SPECS.flatMap((spec) => {
    const binary = resolveBinary(spec, process.env);
    const path = binary ? locateBinary(binary, process.env) : null;
    if (!path) return [];
    const reason =
      spec.executionUnsupportedReason ??
      spec.executionPrerequisite?.(versionFromInstall(path)?.version ?? null);
    return reason ? [{ id: spec.id, reason }] : [];
  });
  return {
    name: 'Agent runtime readiness',
    status: unavailable.length ? 'info' : 'pass',
    message: unavailable.length
      ? unavailable
          .map((spec) => `${spec.id} is installed but automation is unavailable: ${spec.reason}`)
          .join(' ')
      : 'No installed runtimes have unverified execution transports.',
  };
}
