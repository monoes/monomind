/**
 * Doctor — MCP server start-up probe (i-312)
 *
 * Runs a configured MCP server exactly as its client would (spawn `command`
 * + `args`, speak newline-delimited JSON-RPC on stdio) and waits for it to
 * answer `initialize`. The incident that motivated this: a `.mcp.json` pinned
 * `npx -y @monoes/monomindcli@2.11.1 mcp start`, which dies immediately with
 * "npm error could not determine executable to run". Every static check
 * passed, Claude Code showed CONNECTION_CLOSED, and the graph tools were
 * silently gone.
 *
 * Three outcomes, deliberately distinct:
 *   ok      — answered `initialize`
 *   failed  — exited (or never spawned) before answering; `stderr` says why
 *   timeout — still running, still silent. NOT the same as broken: a cold
 *             `npx` fetch of this package takes 20-30s on this machine
 *             (measured), far beyond any timeout doctor can afford, so the
 *             caller reports it as "unknown", never as "cannot start".
 */

import { spawn } from 'node:child_process';

/**
 * Probe budget. doctor is interactive and runs in CI, so it cannot wait on a
 * package download; a locally-installed server answers in well under a second
 * and the broken `npx` form in the issue fails in ~0.8s once npm has the
 * package cached. 3s covers both with room to spare.
 */
export const MCP_PROBE_TIMEOUT_MS = 3000;

/** How long a SIGTERM'd server gets to exit before it is SIGKILLed. */
const TERM_GRACE_MS = 300;
/** Hard cap on waiting for the kill to land, so the probe itself cannot hang. */
const KILL_GRACE_MS = 1000;
/** Cap captured output — a chatty server must not grow doctor's heap. */
const MAX_CAPTURE_BYTES = 64 * 1024;

const PROBE_ID = 1;

export type McpProbeOutcome = 'ok' | 'failed' | 'timeout';

export interface McpProbeResult {
  outcome: McpProbeOutcome;
  /** Condensed stderr (or the spawn error), '' when the server said nothing. */
  stderr: string;
  exitCode: number | null;
  elapsedMs: number;
}

export interface McpProbeOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}

/**
 * Condense a server's stderr into one line a doctor result can carry: drop
 * blanks, keep the first few lines (npm puts the real cause first), truncate.
 */
export function summarizeStderr(raw: string, max = 240): string {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const joined = lines.slice(0, 3).join('; ');
  return joined.length > max ? `${joined.slice(0, max)}…` : joined;
}

export async function probeMcpServer(options: McpProbeOptions): Promise<McpProbeResult> {
  const { command, args = [], env, cwd, timeoutMs = MCP_PROBE_TIMEOUT_MS } = options;
  const startedAt = Date.now();

  // Own process group on POSIX so the whole tree dies with one signal — an
  // `npx` wrapper that has already forked node would otherwise survive and
  // leak (o-04: processes never reaped). The cost is that a Ctrl-C aimed at
  // doctor no longer reaches the child; the probe kills it on every return
  // path and the window is at most `timeoutMs`.
  const useProcessGroup = process.platform !== 'win32';
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
      cwd,
      detached: useProcessGroup,
      windowsHide: true,
    });
  } catch (err) {
    return {
      outcome: 'failed',
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: null,
      elapsedMs: Date.now() - startedAt,
    };
  }

  let exited = false;
  let exitCode: number | null = null;
  let stderrRaw = '';
  let stdoutBuf = '';
  let spawnError = '';

  const exitWaiters: (() => void)[] = [];
  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
    for (const resolve of exitWaiters.splice(0)) resolve();
  });

  const capture = (current: string, chunk: unknown): string =>
    current.length >= MAX_CAPTURE_BYTES
      ? current
      : (current + String(chunk)).slice(0, MAX_CAPTURE_BYTES);

  child.stderr?.on('data', (chunk) => {
    stderrRaw = capture(stderrRaw, chunk);
  });

  const outcome = await new Promise<McpProbeOutcome>((resolve) => {
    let settled = false;
    const settle = (value: McpProbeOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => settle('timeout'), timeoutMs);
    timer.unref?.();
    const done = (value: McpProbeOutcome): void => {
      clearTimeout(timer);
      settle(value);
    };

    child.stdout?.on('data', (chunk) => {
      stdoutBuf = capture(stdoutBuf, chunk);
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: { id?: unknown; result?: unknown; error?: unknown };
        try {
          message = JSON.parse(line);
        } catch {
          continue; // banner/log noise on stdout — not our answer
        }
        if (message.id !== PROBE_ID) continue;
        if ('result' in message) return done('ok');
        if ('error' in message) return done('failed');
      }
    });

    child.on('error', (err) => {
      spawnError = err.message;
      done('failed');
    });
    child.on('exit', () => done('failed'));

    try {
      child.stdin?.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: PROBE_ID,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'monomind-doctor', version: '1' },
          },
        })}\n`,
      );
    } catch {
      // Broken pipe: the server is already gone; the exit/error handler decides.
    }
  });

  await shutdown();

  return {
    outcome,
    stderr: spawnError || summarizeStderr(stderrRaw),
    exitCode,
    elapsedMs: Date.now() - startedAt,
  };

  function signalTree(signal: NodeJS.Signals): void {
    if (exited) return;
    try {
      if (useProcessGroup && typeof child.pid === 'number') process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  }

  function waitForExit(ms: number): Promise<void> {
    if (exited) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
      exitWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async function shutdown(): Promise<void> {
    try {
      child.stdin?.end();
    } catch {
      /* already closed */
    }
    if (exited) return;
    signalTree('SIGTERM');
    await waitForExit(TERM_GRACE_MS);
    if (exited) return;
    signalTree('SIGKILL');
    // Bounded: if the process is unkillable (uninterruptible sleep), doctor
    // still returns rather than waiting on it forever.
    await waitForExit(KILL_GRACE_MS);
  }
}
