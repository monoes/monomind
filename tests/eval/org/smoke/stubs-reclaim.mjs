// tests/eval/org/smoke/stubs-reclaim.mjs
//
// After a trial's org process is gone, reclaims the sandbox mount-point stubs it left. The runtime releases its stubs
// itself at a clean end and on SIGTERM/SIGINT (sandbox-stubs.ts); a trial that outlives `timeout --kill-after` is
// SIGKILLed, which no handler can catch, and parallel-sweep-3's p1t left an empty 0444 ~/.mcp.json that way. A trial's
// ledger is <root>/.state/stubs (env.mjs MONOMIND_ORGRT_STUBS_DIR), so no later runtime ever reclaims it. This calls the
// runtime's own reclaim() on that ledger, under its own rule: only a path the dead runtime created itself (same inode, same
// ctime, still empty, a known stub name) is removed; a path that existed before the run, or that was filled or replaced,
// is not, and the entries are forgotten either way. Best effort: it never fails the trial.
//
//   node stubs-reclaim.mjs <trial root> <cli.js>     prints each path removed; the runtime is the built one next to cli.js
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The paths removed from the trial's ledger by `SandboxStubs` (the runtime's class, injected so a test can pass the source). */
export function reclaimTrialStubs(root, SandboxStubs) {
  const ledger = join(resolve(root), '.state', 'stubs', 'ledger.json');
  if (!existsSync(ledger)) return [];
  return new SandboxStubs(ledger).reclaim();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, cli] = process.argv.slice(2);
  try {
    const built = join(dirname(resolve(cli)), '..', 'dist', 'src', 'orgrt', 'sandbox-stubs.js');
    if (!existsSync(built))
      console.log(`stubs-reclaim: no built runtime at ${built}; nothing reclaimed`);
    else {
      const { SandboxStubs } = await import(pathToFileURL(built).href);
      for (const p of reclaimTrialStubs(root, SandboxStubs)) console.log(`reclaimed ${p}`);
    }
  } catch (e) {
    console.log(`stubs-reclaim: ${e instanceof Error ? e.message : e}`);
  }
}
