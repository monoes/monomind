// packages/@monomind/cli/__tests__/orgrt/stubs-holder.fixture.ts
// A process that holds sandbox stubs the way an org run does, for sandbox-stubs-signals.test.ts:
//   tsx stubs-holder.fixture.ts <ledger file> <json list of stub paths> [graceful]
// It prints "ready" once the stubs are held and then waits to be signalled. With "graceful" it also has a
// handler of its own for SIGTERM, as `org run`'s wait loop does: that handler stops the org (releases the stubs).
import { SandboxStubs } from '../../src/orgrt/sandbox-stubs.js';

const [, , ledger, paths, mode] = process.argv;
const stubs = new SandboxStubs(ledger);
stubs.hold('run-1', JSON.parse(paths));
if (mode === 'graceful')
  process.once('SIGTERM', () => {
    setTimeout(() => {
      stubs.releaseAll();
      process.exit(0);
    }, 50);
  });
console.log('ready');
setInterval(() => {}, 1000);
