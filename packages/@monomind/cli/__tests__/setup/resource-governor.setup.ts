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
import { configureResourceLimits } from '../../src/utils/resource-governor.js';

configureResourceLimits({ minFreeMemBytes: 0, maxSdkProcesses: Number.MAX_SAFE_INTEGER, spawnStaggerMs: 0 });
