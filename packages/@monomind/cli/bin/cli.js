#!/usr/bin/env node
/**
 * @monomind/cli - CLI Entry Point
 *
 * Monomind Command Line Interface
 *
 * MCP mode requires explicit `mcp start` subcommand or MONOMIND_MCP_AUTODETECT=1.
 * Usage: npx @monomind/cli mcp start
 */

import { randomUUID } from 'crypto';

// Check if we should run in MCP server mode.
// SECURITY: only accept explicit `mcp start` plus piped stdin, OR the explicit
// `MONOMIND_MCP_AUTODETECT=1` opt-in for the legacy "no args + non-TTY" path.
// Previously any `monomind` invocation with redirected stdin (CI pipes, xargs,
// editor integrations) silently flipped into MCP server mode and accepted
// JSON-RPC tools/call — privilege escalation by environment.
//
// Only the *bare* invocation (`mcp` or `mcp start`, no further args) takes
// this fast path — which is also exactly what real MCP clients (Claude
// Desktop, etc.) actually spawn. Any additional argument defers to the full
// CLI (dist/src/index.js) instead. This fast path is a raw stdio JSON-RPC
// loop that does not implement --help, --transport/-t, --port/-p, --daemon,
// --force, or --tools at all — it used to swallow them silently and always
// behave the same way regardless of what was passed, including printing
// nothing for `mcp start --help` and starting a real server instead
// (release 2.11.1 QA repro). The full CLI's `mcp start` command (mcp.ts)
// is the only implementation of any of those flags.
const cliArgs = process.argv.slice(2);
const isBareMCPInvocation =
  cliArgs.length === 1 ? cliArgs[0] === 'mcp' : cliArgs.length === 2 && cliArgs[0] === 'mcp' && cliArgs[1] === 'start';
const allowAutoDetect = process.env.MONOMIND_MCP_AUTODETECT === '1';
const isMCPMode = !process.stdin.isTTY && (isBareMCPInvocation || (allowAutoDetect && process.argv.length === 2));

if (isMCPMode) {
  // Run MCP server mode
  const { listMCPTools, callMCPTool, hasTool } = await import('../dist/src/mcp-client.js');

  // Read version from package.json instead of hardcoding (prevents stale
  // version drift between bin entry and the published package).
  let VERSION = '0.0.0';
  try {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (typeof pkg.version === 'string') VERSION = pkg.version;
  } catch { /* fall back to 0.0.0 */ }
  const sessionId = `mcp-${Date.now()}-${randomUUID().slice(0, 8)}`;

  // Don't leak nodeVersion/platform/arch/pid to stderr by default; gate behind
  // MONOMIND_LOG_LEVEL=debug to reduce fingerprinting in shared log aggregators.
  if (process.env.MONOMIND_LOG_LEVEL === 'debug') {
    console.error(
      `[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) Starting in stdio mode (node=${process.version} platform=${process.platform} arch=${process.arch})`
    );
  } else {
    console.error(
      `[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) Starting in stdio mode`
    );
  }

  // Mirror the PID-file mechanism `mcp status`/`mcp health` read from a
  // separate process (see MCPServerManager.writePidFile()/getStatus() in
  // mcp-server.ts). Without this, this fast path was invisible to `mcp
  // status`: it never goes through MCPServerManager.start(), so no PID file
  // was ever written and status/health always reported "not running" even
  // while a live stdio server was up (confirmed via `ps` at the same instant
  // — release 2.11.1 QA repro). Same path/format/flags as
  // MCPServerManager.writePidFile(): O_CREAT|O_EXCL so a pre-existing path
  // (including a symlinked one) is never followed, with a stale-PID-file
  // replace fallback on EEXIST.
  try {
    const { mkdirSync, writeFileSync, unlinkSync } = await import('fs');
    const { homedir } = await import('os');
    const { join: pathJoin } = await import('path');
    const stateDir = pathJoin(homedir(), '.monomind');
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const pidFilePath = pathJoin(stateDir, 'mcp.pid');
    try {
      writeFileSync(pidFilePath, String(process.pid), { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if (e && e.code === 'EEXIST') {
        unlinkSync(pidFilePath);
        writeFileSync(pidFilePath, String(process.pid), { flag: 'wx', mode: 0o600 });
      } else {
        throw e;
      }
    }
    // 'exit' handlers must finish synchronously, so this uses unlinkSync
    // rather than the fs.promises API used elsewhere in this file.
    process.on('exit', () => {
      try {
        unlinkSync(pidFilePath);
      } catch {
        /* already gone, or never successfully written */
      }
    });
  } catch (e) {
    // Best-effort: `mcp status` falling back to "not running" is far better
    // than refusing to start the server over a PID-file write error.
    if (process.env.MONOMIND_LOG_LEVEL === 'debug') {
      console.error(
        `[${new Date().toISOString()}] WARN [monomind-mcp] (${sessionId}) could not write PID file: ${e && e.message ? e.message : e}`
      );
    }
  }

  // Top-level safety nets — without these, an unhandled async error in a tool
  // handler crashes the process with no observable cleanup.
  process.on('uncaughtException', (err) => {
    console.error(`[${new Date().toISOString()}] FATAL [monomind-mcp] uncaughtException: ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error(`[${new Date().toISOString()}] FATAL [monomind-mcp] unhandledRejection: ${msg}`);
    process.exit(1);
  });
  const shutdown = (sig) => {
    console.error(`[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) ${sig} received, shutting down`);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Cap on accumulated input buffer so a peer pumping a single multi-GB line
  // (or a slow trickle without newlines) cannot OOM-kill the process.
  const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
  let buffer = '';
  // Tracks handleMessage() calls still in flight when stdin closes — without
  // this, 'end' calling process.exit(0) unconditionally could kill the process
  // mid-handler and silently drop the response a client is still waiting on
  // (issue #39).
  let inFlight = 0;
  let stdinEnded = false;
  process.stdin.setEncoding('utf8');
  // process.stdout.write() to a pipe is NOT guaranteed synchronous — for a
  // large payload (e.g. a full tools/list response) the OS write can still be
  // in flight when the call returns. console.log() doesn't expose that, so
  // calling process.exit() right after it can truncate/drop the very response
  // being protected. Wait for the actual flush callback before allowing exit.
  function writeLine(str) {
    return new Promise((resolve) => process.stdout.write(str + '\n', resolve));
  }

  process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_BUFFER_BYTES) {
      console.error(`[${new Date().toISOString()}] FATAL [monomind-mcp] input exceeds ${MAX_BUFFER_BYTES} bytes`);
      process.exit(1);
    }
    let lines = buffer.split('\n');
    buffer = lines.pop() || '';
    const toProcess = lines.filter((line) => line.trim());
    // Reserve the WHOLE batch synchronously, before any `await` yields control —
    // otherwise 'end' can fire in the gap between two lines of the same chunk
    // (inFlight transiently reads 0 after line 1 finishes but before line 2's
    // own increment runs), exiting mid-batch and dropping the rest silently.
    inFlight += toProcess.length;

    for (const line of toProcess) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        await writeLine(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        }));
        inFlight--;
        if (stdinEnded && inFlight === 0) process.exit(0);
        continue;
      }
      try {
        const response = await handleMessage(parsed);
        if (response) {
          await writeLine(JSON.stringify(response));
        }
      } catch (error) {
        await writeLine(JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id ?? null,
          error: { code: -32603, message: error instanceof Error ? error.message : 'Internal error' },
        }));
      } finally {
        inFlight--;
        if (stdinEnded && inFlight === 0) process.exit(0);
      }
    }
  });

  process.stdin.on('end', () => {
    stdinEnded = true;
    if (inFlight === 0) { process.exit(0); return; }
    // Bounded safety net: don't hang forever if a handler is genuinely stuck.
    const EXIT_GRACE_MS = 30000;
    setTimeout(() => process.exit(0), EXIT_GRACE_MS).unref();
  });

  async function handleMessage(message) {
    if (!message.method) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32600, message: 'Invalid Request: missing method' },
      };
    }

    const params = message.params || {};

    switch (message.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'monomind', version: VERSION },
            capabilities: {
              tools: { listChanged: true },
              // No server-initiated notifications on this stdio loop, so
              // subscribe/listChanged are advertised as what they are.
              resources: { subscribe: false, listChanged: false },
            },
          },
        };

      case 'tools/list': {
        const tools = await listMCPTools();
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: tools.map(tool => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          },
        };
      }

      case 'tools/call': {
        const toolName = params.name;
        const toolParams = params.arguments || {};

        if (!await hasTool(toolName)) {
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `Tool not found: ${toolName}` },
          };
        }

        try {
          const result = await callMCPTool(toolName, toolParams, { sessionId });
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
          };
        } catch (error) {
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : 'Tool execution failed',
            },
          };
        }
      }

      case 'resources/list':
      case 'resources/templates/list':
      case 'resources/read': {
        // GLU-07: the resource surface (the code graph AND the capture
        // library) has ONE implementation, in mcp-tools/resource-router.ts.
        // This loop is what a client spawning a bare `monomind mcp start`
        // runs, so without this delegation it advertised resources and then
        // answered "Method not found" to every one of them.
        const { handleResourceMethod } = await import('../dist/src/mcp-tools/resource-router.js');
        const handled = await handleResourceMethod(message.method, params);
        if (handled) return { jsonrpc: '2.0', id: message.id, ...handled };
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `Method not found: ${message.method}` },
        };
      }

      case 'notifications/initialized':
        return null;

      case 'ping':
        return { jsonrpc: '2.0', id: message.id, result: {} };

      default:
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `Method not found: ${message.method}` },
        };
    }
  }
} else {
  // Run normal CLI mode.
  // Install top-level handlers so an asynchronous error fired from an event-
  // loop callback does not bypass the synchronous .catch below. Default Node
  // handler prints the full stack to stderr — which on this codebase includes
  // attacker-influenced bytes from registry/config error messages and full
  // filesystem paths. Sanitize before logging and exit non-zero.
  const safeMsg = (m) =>
    String(m == null ? '' : m).replace(/[\x00-\x1f\x7f-\x9f]/g, '?').slice(0, 1000);
  // Crash reporting: asks once whether to file a GitHub issue on
  // monoes/monomind for an interactive crash (`monomind crash-reporting
  // disable`/`enable` to change your answer); a non-interactive crash (CI,
  // agents) always saves locally only and never asks.
  // Bounded so a crash handler can't hang the process indefinitely on a
  // stalled network call or an unanswered prompt — best-effort only, never
  // blocks exit past 10s. Raised to 30s only when stdin is a TTY, so the
  // consent prompt (itself bounded at 15s, see crash-reporter.ts) has room
  // to be answered; the non-TTY path never prompts, so it keeps the
  // original 10s bound untouched.
  const reportAndExit = async (title, stack) => {
    try {
      const { reportCrash } = await import('../dist/src/services/crash-reporter.js');
      const { getCrashRaceTimeoutMs } = await import('../dist/src/services/crash-race-timeout.js');
      const body = [
        `Uncaught crash in \`monomind\` CLI.`,
        ``,
        `Node ${process.version}, ${process.platform}/${process.arch}`,
        ``,
        '```',
        stack || title,
        '```',
      ].join('\n');
      const crashRaceTimeoutMs = getCrashRaceTimeoutMs(Boolean(process.stdin.isTTY));
      const result = await Promise.race([
        reportCrash({ repo: 'monoes/monomind', title: `crash: ${title}`, body }),
        new Promise((resolve) => setTimeout(() => resolve({ status: 'error', message: `crash report timed out after ${crashRaceTimeoutMs / 1000}s` }), crashRaceTimeoutMs)),
      ]);
      if (result && result.message) console.error(`[${new Date().toISOString()}] INFO [monomind] crash-report: ${result.message}`);
    } catch {
      // never let crash reporting itself crash the crash handler
    }
    process.exit(1);
  };
  // Not every uncaught error is a bug in monomind, and filing a PUBLIC GitHub
  // issue for one that isn't is worse than useless — it leaks the user's paths
  // into a tracker and buries real crashes in noise. Two classes are user
  // environment or normal usage, never a product defect:
  //
  //   EPIPE / ERR_STREAM_DESTROYED — the reader closed the pipe first. This is
  //     what `monomind hooks worker list | head` does every single time, and
  //     what `| less` does when you quit early. Completely normal (issue #41).
  //
  //   ERR_MODULE_NOT_FOUND — a dependency is missing from the install: a
  //     partial/corrupt node_modules, or the CLI being run straight out of an
  //     extracted tarball. The user needs an actionable message, not a bug
  //     report filed on their behalf (issues #46, #47).
  //
  // Anything else still reports as before.
  const classifyFault = (err) => {
    const code = err && err.code;
    if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') return 'broken-pipe';
    if (code === 'ERR_MODULE_NOT_FOUND') return 'missing-dependency';
    return 'crash';
  };

  /** Handles the non-bug classes. Returns true if it fully handled the error. */
  const handleExpectedFault = (err) => {
    switch (classifyFault(err)) {
      case 'broken-pipe':
        // Downstream went away — there is nothing left to say and nowhere to
        // say it. Exiting 0 keeps `monomind ... | head` from looking failed.
        process.exit(0);
        return true;
      case 'missing-dependency': {
        const pkg = /Cannot find package '([^']+)'/.exec(safeMsg(err && err.message))?.[1];
        console.error(
          pkg
            ? `[monomind] Missing dependency: ${pkg}\n` +
                `  This is an install problem, not a crash — nothing was reported.\n` +
                `  Try: npm install ${pkg}   (or reinstall monomind: npm i -g monomind@latest)`
            : `[monomind] A dependency could not be resolved: ${safeMsg(err && err.message)}\n` +
                `  This is an install problem, not a crash — nothing was reported.`,
        );
        if (process.env.DEBUG) console.error(err && err.stack);
        process.exit(1);
        return true;
      }
      default:
        return false;
    }
  };

  // Belt and braces for the pipe case: handling 'error' on the streams keeps a
  // mid-write EPIPE from becoming an uncaughtException at all.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (err) => {
      if (classifyFault(err) === 'broken-pipe') process.exit(0);
    });
  }

  process.on('uncaughtException', (err) => {
    if (handleExpectedFault(err)) return;
    console.error(`[${new Date().toISOString()}] FATAL [monomind] uncaughtException: ${safeMsg(err && err.message)}`);
    if (process.env.DEBUG) console.error(err && err.stack);
    reportAndExit(safeMsg(err && err.message) || 'uncaughtException', err && err.stack);
    return;
  });
  process.on('unhandledRejection', (reason) => {
    if (reason instanceof Error && handleExpectedFault(reason)) return;
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error(`[${new Date().toISOString()}] FATAL [monomind] unhandledRejection: ${safeMsg(msg)}`);
    if (process.env.DEBUG && reason instanceof Error) console.error(reason.stack);
    reportAndExit(safeMsg(msg) || 'unhandledRejection', reason instanceof Error ? reason.stack : undefined);
  });

  const { CLI } = await import('../dist/src/index.js');
  const cli = new CLI();
  // A detached daemon child (`start --daemon --foreground-worker-internal`,
  // see src/commands/start.ts) intentionally keeps a ref'd setInterval alive
  // after its action resolves — that's what holds the process open as a real
  // daemon. Unconditionally calling process.exit() here would kill it the
  // instant the action's promise resolves, defeating the whole point.
  const isDaemonChild = cliArgs.includes('--foreground-worker-internal');
  // `mcp start` (without --daemon) hosts the MCP server inside THIS process:
  // its HTTP/WS listener — or, for stdio, its stdin reader — is what keeps the
  // event loop alive, on purpose. The watchdog below is unref'd, which stops it
  // from *holding* the loop open but not from *firing* once something else
  // does, so it force-exited every MCP server exactly 5 seconds after it
  // printed "MCP Server started", the detached `--daemon` child included
  // (issue #267). The `-d` parent is excluded: it only spawns that child and
  // must hand the terminal straight back. `mcp monoes-proxy` is a stdio MCP
  // server too: without it here, Claude Code saw monoes connect and then fail
  // 5 seconds later.
  const isMcpServerHost =
    cliArgs[0] === 'mcp' &&
    ((cliArgs[1] === 'start' && !cliArgs.includes('-d') && !cliArgs.includes('--daemon')) ||
      cliArgs[1] === 'monoes-proxy');
  cli.run().then(() => {
    if (!isDaemonChild && !isMcpServerHost) {
      // Do NOT call process.exit() here. See
      // docs/adrs/ADR-R001-onnxruntime-process-teardown.md.
      //
      // Any command that touched embeddings has onnxruntime-node's thread pool
      // loaded in-process (memory-bridge -> @huggingface/transformers), and
      // forcing exit out from under it aborts:
      //   libc++abi: terminating due to uncaught exception of type
      //   std::__1::system_error: mutex lock failed: Invalid argument
      // — exit code 134 on `doctor`, `memory store`, `memory search` etc.,
      // despite the command itself having succeeded. Disposing the pipeline
      // first does NOT help; only letting the loop drain does. (v2.7.4 bug,
      // fixed 2.7.5. Guarded by src/__tests__/bin-cli-exit-path.test.ts.)
      //
      // NOTE the rule inverts for short-lived worker children, where onnx
      // instead keeps the loop alive forever and you MUST force-exit — see
      // src/routing/embed-worker.ts. Do not "unify" the two.
      //
      // So: publish the exit code and let node exit on its own once the loop
      // empties. The unref'd timer below still fires if something lingers
      // (it does not itself hold the process open), preserving the original
      // guarantee that the CLI never hangs forever on a stray handle.
      process.exitCode = process.exitCode ?? 0;
      const FORCE_EXIT_MS = 5000;
      setTimeout(() => process.exit(process.exitCode ?? 0), FORCE_EXIT_MS).unref();
    }
    // Daemon child: let the event loop stay alive on its own ref'd interval.
  }).catch((error) => {
    console.error('Fatal error:', safeMsg(error && error.message));
    process.exit(1);
  });
}
