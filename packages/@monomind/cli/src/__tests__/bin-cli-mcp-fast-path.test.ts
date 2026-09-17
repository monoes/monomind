/**
 * Regression tests for two release-blocking QA findings, both traced to the
 * same root cause in bin/cli.js's `isExplicitMCP` fast path:
 *
 *  1. `monomind mcp start --help` / `-h` did not print help — it silently
 *     started a real MCP server instead (reproducible 2x).
 *  2. `monomind mcp start -t http -p <port>` ignored the transport/port
 *     flags entirely — always started stdio mode, contradicting `mcp
 *     --help`'s own documented HTTP example.
 *  3. `mcp status` / `mcp health` reported the server as NOT running while a
 *     genuinely-alive stdio server was confirmed via `ps` at the same
 *     instant (a separate false-negative bug, same root cause's blast
 *     radius — see below).
 *
 * Root cause: `isExplicitMCP` matched ANY `mcp start ...` invocation with
 * non-TTY stdin, regardless of what else was on the command line. Once
 * matched, the whole CLI parser/dispatcher (index.ts, where --help handling
 * and mcp.ts's real `startCommand` — the only place --transport/--port/
 * --daemon/--force/--tools are actually read — both live) was bypassed
 * entirely in favor of a raw, hardcoded, stdio-only JSON-RPC loop with none
 * of that logic. That fast path also never went through
 * MCPServerManager.start(), so it never wrote a PID file, which is what
 * `mcp status`/`mcp health` (run as a separate process) read to detect a
 * live server — hence finding 3's false negative on an entirely legitimate,
 * un-flagged `mcp start` invocation.
 *
 * Fix:
 *  - The fast path now only matches the truly bare invocation (`mcp` or
 *    `mcp start`, no further arguments) — which is also exactly what real
 *    MCP clients (Claude Desktop, etc.) actually spawn. Any additional
 *    argument (--help, -t, -p, ...) defers to the full CLI, so all of
 *    mcp.ts's flag handling (including --help) applies uniformly.
 *  - The fast path now writes/cleans up a PID file at the same path and in
 *    the same format as MCPServerManager.writePidFile(), so `mcp status`/
 *    `mcp health` can see it from a separate process.
 *
 * This file asserts both properties at the source level (like
 * bin-cli-exit-path.test.ts, for the same reason: the fast path only
 * activates with non-TTY stdin and dynamically imports compiled dist/
 * modules, so exercising it as a real subprocess would require a prior
 * build and isn't suitable for the unit suite). Full behavioral
 * verification — spawning a built binary and checking `mcp start --help`,
 * `mcp start -t http -p <port>`, and `mcp status` against a live bare
 * `mcp start` — was done manually against release 2.11.1 and is recorded in
 * the fix's commit message.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'cli.js');

function readBin(): string {
  return readFileSync(CLI_BIN, 'utf-8');
}

describe('bin/cli.js MCP fast-path gate', () => {
  it('only takes the fast path for a bare `mcp`/`mcp start`, not any extra args', () => {
    const src = readBin();

    // The old gate matched `mcp start --help`, `mcp start -t http -p 1234`,
    // etc. just as readily as a bare `mcp start` — length was never
    // checked beyond "at least 1". Guard against that shape reappearing:
    // any single boolean OR over cliArgs[0]/[1] with no length cap on the
    // 2-arg branch is exactly the old, broken condition.
    expect(src).not.toMatch(
      /cliArgs\.length >= 1 && cliArgs\[0\] === 'mcp' && \(cliArgs\.length === 1 \|\| cliArgs\[1\] === 'start'\)/,
    );

    // The fixed gate must reject a 3rd argument outright — assert the
    // exact-length shape is present for both the bare `mcp` and `mcp start`
    // cases (order-independent: written as a ternary in the real file).
    expect(src).toMatch(/cliArgs\.length === 1/);
    expect(src).toMatch(
      /cliArgs\.length === 2 && cliArgs\[0\] === 'mcp' && cliArgs\[1\] === 'start'/,
    );
  });

  it('writes a PID file compatible with MCPServerManager so `mcp status` can see the fast path', () => {
    const src = readBin();

    // Same directory/filename MCPServerManager.writePidFile() uses
    // (getDefaultStateDir() = join(os.homedir(), '.monomind'), file
    // 'mcp.pid') so a separate `mcp status`/`mcp health` process reads the
    // same file this path writes.
    expect(src).toMatch(/'\.monomind'/);
    expect(src).toMatch(/'mcp\.pid'/);

    // Same O_CREAT|O_EXCL ('wx') + stale-file replace-on-EEXIST shape as
    // MCPServerManager.writePidFile(), so this path can't be tricked into
    // writing through a pre-staged symlink either.
    expect(src).toMatch(/flag:\s*'wx'/);
    expect(src).toMatch(/EEXIST/);

    // Cleanup must be registered on the synchronous 'exit' event (not just
    // the SIGINT/SIGTERM handlers) so a fast path killed by any means still
    // removes its PID file before the process actually exits.
    expect(src).toMatch(/process\.on\('exit'/);
  });
});
