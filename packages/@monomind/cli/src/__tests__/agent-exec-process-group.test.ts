/**
 * Integration tests for #359 (Coder mode: Stop/timeout/budget must kill the
 * whole agent process tree) through the REAL `runAgentExec` engine
 * (orgrt/agent-exec.ts) + the REAL `ClaudeAgentRunner` (orgrt/agent-runner.ts)
 * — only the SDK's `query()` is mocked (the standard injection seam every
 * other ClaudeAgentRunner test uses), so the whole chain this issue touches
 * runs for real: `runAgentExec`'s `terminate()` → `AgentRunArgs.signal` →
 * `agent-runner-claude.ts`'s group-kill ladder →
 * `agent-runner-claude-fullaccess.ts`'s `spawnClaudeCodeProcess` hook →
 * `process-tree.ts`'s `signalGroup`/`listGroupMembers`.
 *
 * The mock `queryFn` calls `options.spawnClaudeCodeProcess(...)` itself,
 * exactly like the real SDK would, spawning REAL short-lived `sh`/`sleep`
 * processes as a stand-in for "the claude CLI started a background job" —
 * never `pkill -f`; every assertion polls PIDs this test itself recorded.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AgentExecOptions, runAgentExec, type ToolSpec } from '../orgrt/agent-exec.js';
import { ClaudeAgentRunner } from '../orgrt/agent-runner.js';
import { loadClaudeSdk } from '../orgrt/agent-runner-claude.js';
import { listGroupMembers } from '../orgrt/process-tree.js';
import { psReadsProcessTable } from './ps-probe.js';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(fn: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition never became true');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** A stand-in tool spec so the stdio bridge starts and reads `cancel`
 *  frames from stdin — mirrors the existing cancellation tests in
 *  agent-exec.test.ts (`echoTool`); this scenario never actually calls it. */
const dummyTool: ToolSpec = {
  name: 'noop',
  description: 'unused',
  schema: { type: 'object', properties: {} },
};

/** A `queryFn` that behaves like the real SDK just enough for this test: it
 *  calls the runner's `spawnClaudeCodeProcess` hook itself (spawning a real
 *  detached group leader that immediately backgrounds two `sleep`s, mirroring
 *  a Bash tool call like `sleep 1000 &`), reports the pid out via `onPid`,
 *  yields one assistant message, then hangs on the runner's own
 *  `abortController` — the general "wedged/long-running turn" shape —
 *  UNLESS `resolveImmediately` is set, in which case it yields a `result`
 *  right after spawning (simulating a normal end_turn with a background
 *  survivor still running). */
function makeMockQueryFn(
  onPid: (pid: number) => void,
  opts: { resolveImmediately?: boolean } = {},
) {
  return (args: any) => {
    const o = args.options;
    return (async function* () {
      const child = o.spawnClaudeCodeProcess({
        command: 'sh',
        args: ['-c', 'sleep 1000 & sleep 1000 &'],
        cwd: undefined,
        env: process.env,
      });
      if (typeof child.pid === 'number') onPid(child.pid);
      yield {
        type: 'assistant',
        session_id: 's1',
        message: { content: [{ type: 'text', text: 'starting' }] },
      };
      if (opts.resolveImmediately) {
        // The real Claude CLI only reports its tool_result (and eventually
        // end_turn) once the Bash tool's shell has actually returned — by
        // which point a `cmd &` it ran has already forked (this is exactly
        // why the OTHER test below waits for `pids.length >= 2` before
        // acting: forking is not instantaneous with spawn()). This mock
        // skips the real SDK's IPC round-trip entirely, so without an
        // equivalent wait here it can (and on a loaded/sandboxed box,
        // reliably does) yield `result` before the backgrounded `sleep`s
        // exist in the process table — a mock-fidelity gap, not the
        // `done.background_pids` discovery it's meant to exercise.
        await waitFor(() => listGroupMembers(child.pid as number).pids.length >= 2, 3000);
        yield { type: 'result', session_id: 's1', subtype: 'success', is_error: false };
        return;
      }
      // Simulate a long-running/wedged turn: only the group-kill's abort
      // (via killOnAbort → abortController.abort()) ends it.
      await new Promise<void>((resolve) => {
        o.abortController.signal.addEventListener('abort', () => resolve());
      });
    })();
  };
}

// reason: counts the group's members with `ps`, which a macOS Seatbelt sandbox denies (#798)
describe.skipIf(!psReadsProcessTable('agent-exec-process-group'))(
  '#359: --access full kills the whole process group on cancel/timeout, and reports survivors on a normal end_turn',
  () => {
    let scratchDir: string;
    let spawnedPid: number | undefined;
    let recordedMembers: number[] = [];

    // The first SDK load in a process hashes the Claude binary against its pin
    // (#526), which takes longer than the 80 ms --timeout below; load it once
    // up front so the timeout measures the run.
    beforeAll(async () => {
      await loadClaudeSdk();
    }, 60_000);

    beforeEach(() => {
      scratchDir = mkdtempSync(join(tmpdir(), 'monomind-359-'));
      spawnedPid = undefined;
      recordedMembers = [];
    });

    afterEach(async () => {
      // Safety net: kill anything this test's own assertions didn't already
      // clean up, using ONLY pids recorded during the test — never pkill -f.
      if (spawnedPid !== undefined) {
        const { pids } = listGroupMembers(spawnedPid);
        for (const p of [spawnedPid, ...pids, ...recordedMembers]) {
          try {
            process.kill(p, 'SIGKILL');
          } catch {
            /* already gone */
          }
        }
      }
      rmSync(scratchDir, { recursive: true, force: true });
    });

    function baseOptions(over: Partial<AgentExecOptions> = {}): AgentExecOptions {
      return {
        runtime: 'claude',
        prompt: 'do the thing',
        maxTurns: 5,
        toolTimeoutMs: 60_000,
        access: 'full',
        cwd: scratchDir,
        returnGraceMs: 50,
        emit: () => {},
        ...over,
      } as AgentExecOptions;
    }

    it('overall --timeout kills the leader AND its backgrounded jobs — zero descendants left', async () => {
      const events: Record<string, unknown>[] = [];
      const runner = new ClaudeAgentRunner(makeMockQueryFn((pid) => (spawnedPid = pid)) as any);
      const code = await runAgentExec(
        baseOptions({
          timeoutMs: 80,
          emit: (ev) => events.push(ev),
          runnerOverride: runner,
        }),
      );

      expect(code).toBe(124);
      expect(events.some((e) => e.type === 'error' && (e as any).code === 'timeout')).toBe(true);
      expect(spawnedPid).toBeDefined();

      await waitFor(() => !isAlive(spawnedPid as number), 3000);
      await waitFor(() => listGroupMembers(spawnedPid as number).pids.length === 0, 3000);
      expect(listGroupMembers(spawnedPid as number).pids).toHaveLength(0);
    }, 10_000);

    it('a cancel frame kills the leader AND its backgrounded jobs — zero descendants left', async () => {
      const { PassThrough } = await import('node:stream');
      const stdin = new PassThrough();
      const events: Record<string, unknown>[] = [];
      const runner = new ClaudeAgentRunner(makeMockQueryFn((pid) => (spawnedPid = pid)) as any);

      const execDone = runAgentExec(
        baseOptions({
          toolSpecs: [dummyTool],
          stdin,
          emit: (ev) => events.push(ev),
          runnerOverride: runner,
        }),
      );

      await waitFor(() => spawnedPid !== undefined, 3000);
      // Give the two backgrounded `sleep`s a moment to fork before cancelling.
      await waitFor(() => listGroupMembers(spawnedPid as number).pids.length >= 2, 3000);

      stdin.write(`${JSON.stringify({ v: 1, type: 'cancel' })}\n`);
      const code = await execDone;

      expect(code).toBe(130);
      expect(events.some((e) => e.type === 'error' && (e as any).code === 'cancelled')).toBe(true);

      await waitFor(() => !isAlive(spawnedPid as number), 3000);
      await waitFor(() => listGroupMembers(spawnedPid as number).pids.length === 0, 3000);
      expect(listGroupMembers(spawnedPid as number).pids).toHaveLength(0);
    }, 10_000);

    it('a normal end_turn does NOT kill background survivors, and lists them in done.background_pids', async () => {
      const events: Record<string, unknown>[] = [];
      const runner = new ClaudeAgentRunner(
        makeMockQueryFn((pid) => (spawnedPid = pid), { resolveImmediately: true }) as any,
      );
      const code = await runAgentExec(
        baseOptions({
          emit: (ev) => events.push(ev),
          runnerOverride: runner,
        }),
      );

      expect(code).toBe(0);
      expect(spawnedPid).toBeDefined();

      // Survivors are recorded here (not just re-derived) so afterEach can
      // clean them up even if an assertion below throws.
      recordedMembers = listGroupMembers(spawnedPid as number).pids;

      const done = events.find((e) => e.type === 'done') as { background_pids?: number[] };
      expect(done?.background_pids).toBeDefined();
      expect(done!.background_pids!.length).toBeGreaterThanOrEqual(2);
      for (const p of done!.background_pids!) expect(isAlive(p)).toBe(true);
    }, 10_000);
  },
);
