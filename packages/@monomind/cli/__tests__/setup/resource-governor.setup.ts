// packages/@monomind/cli/__tests__/setup/resource-governor.setup.ts
// The org runtime's resource-governor gate (see src/utils/resource-governor.ts)
// checks the REAL host's free memory / running SDK process count before
// spawning each agent, and silently skips a role's spawn if the host stays
// under pressure. Org tests use a fake queryFn and never spawn real heavy
// processes, so gating them against actual dev-machine memory (which
// routinely sits in the 12-16% free band on a loaded box) made role spawns
// flaky and non-deterministic — a role could vanish from a run depending on
// what else happened to be running on the machine at test time. Neutralize
// the gate for the whole suite so it never observes real host state.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { configureResourceLimits } from '../../src/utils/resource-governor.js';

configureResourceLimits({ minFreeMemBytes: 0, maxSdkProcesses: Number.MAX_SAFE_INTEGER, spawnStaggerMs: 0 });

// Warn (not fail) when a live org daemon is running — contention causes phantom
// timeouts that look like real test failures (#56).
try {
  const hbPath = join(process.cwd(), '.monomind', 'serve-heartbeat.json');
  if (existsSync(hbPath)) {
    const hb = JSON.parse(readFileSync(hbPath, 'utf8')) as { pid?: number };
    if (typeof hb.pid === 'number') {
      try {
        process.kill(hb.pid, 0); // throws if pid is gone
        console.warn(
          `\n⚠️  An org daemon is running (pid ${hb.pid}). Test timeouts may be contention, not real failures.` +
          `\n   Pause it first: monomind org pause <name>\n`,
        );
      } catch { /* pid gone — stale heartbeat, no contention risk */ }
    }
  }
} catch { /* best effort — don't break tests if the check itself fails */ }
