import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'cli.js');

// See docs/adrs/ADR-R001-onnxruntime-process-teardown.md.
//
// bin/cli.js used to call process.exit() the moment the action resolved. Any
// command that touched embeddings has onnxruntime-node's thread pool loaded
// in-process (memory-bridge -> @huggingface/transformers), and forcing exit out
// from under it aborts with SIGABRT:
//
//   libc++abi: terminating due to uncaught exception of type
//   std::__1::system_error: mutex lock failed: Invalid argument
//
// The command's output was correct; only the exit code was wrong (134), which
// is invisible interactively and fatal in CI. Shipped in v2.7.4, fixed in
// v2.7.5.
//
// This is a source assertion rather than a behavioural test on purpose:
// reproducing the abort requires actually loading onnxruntime and a real model,
// which is far too slow and network-dependent for the unit suite. The same
// approach guards session-restore-handler.cjs in helper-files-parity.test.ts.

function readBin(): string {
  return readFileSync(CLI_BIN, 'utf-8');
}

/** The `cli.run().then(...)` success handler — the block that must not force-exit.
 *  Comments are stripped: the block deliberately *describes* the process.exit()
 *  hazard in prose, and that must not trip the assertions below. */
function successHandler(src: string): string {
  const start = src.indexOf('cli.run().then(');
  expect(start, 'cli.run().then( not found — did the entrypoint get restructured?').toBeGreaterThan(
    -1,
  );
  const end = src.indexOf('.catch(', start);
  expect(end, '.catch( after cli.run().then( not found').toBeGreaterThan(start);
  return stripComments(src.slice(start, end));
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('bin/cli.js does not force-exit the main process', () => {
  it('the success path never calls process.exit() outside a deferred timer', () => {
    const handler = successHandler(readBin());

    // Strip the one legitimate use: an unref'd setTimeout that only fires if
    // the loop fails to drain. Anything left is a synchronous force-exit.
    const withoutDeferred = handler.replace(/setTimeout\([\s\S]*?\)\.unref\(\)/g, '');

    expect(
      withoutDeferred,
      'process.exit() on the success path aborts any command that loaded onnxruntime (ADR-R001). ' +
        'Set process.exitCode and let the event loop drain instead.',
    ).not.toMatch(/process\.exit\s*\(/);
  });

  it('publishes the exit code so a natural exit still reports failure', () => {
    // Dropping process.exit() only works if the code is handed to node some
    // other way — otherwise every failing command would silently exit 0.
    expect(successHandler(readBin())).toMatch(/process\.exitCode\s*=/);
  });

  it("keeps an unref'd timer as the never-hang backstop", () => {
    const handler = successHandler(readBin());
    // Must exist (the CLI must not hang forever on a stray handle)...
    expect(handler).toMatch(/setTimeout\([\s\S]*?\)\.unref\(\)/);
    // ...and must be unref'd, or it would itself hold the process open for the
    // full grace period and make every command that much slower to exit.
    expect(handler).not.toMatch(/setTimeout\((?![\s\S]*?\.unref\(\))/);
  });

  it('still exempts the daemon child, which must stay alive', () => {
    // `start --daemon --foreground-worker-internal` holds itself open on a
    // ref'd interval; exiting when the action resolves defeats the daemon.
    expect(successHandler(readBin())).toMatch(/isDaemonChild/);
  });
});
