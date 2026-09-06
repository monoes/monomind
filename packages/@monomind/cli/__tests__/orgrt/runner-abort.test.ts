/**
 * The AgentRunArgs.signal abort hook across every subprocess runner.
 *
 * An async generator's return() queues behind its in-flight next(), so a
 * runner blocked in `for await (child.stdout)` / `await exitPromise` never
 * reaches its finally/kill on return() alone — agent-exec.ts's terminate()
 * and session.ts's silent-stream abort then orphan the CLI child. Aborting
 * args.signal must kill the child (so the blocked pull unblocks and the
 * turn fails) for every runner that owns one; the in-process Claude runner
 * forwards it to the SDK's abortController.
 *
 * codex / kimicode / pi-rpc / qwen-rpc have their own abort tests next to
 * their existing suites; this file covers the per-turn spawn runners (which
 * share one shape) and the Claude runner, via a mocked `spawn`.
 */
import * as cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AgentRunArgs,
  type AgentRunner,
  ClaudeAgentRunner,
  killOnAbort,
} from '../../src/orgrt/agent-runner.js';
import { AntigravityAgentRunner } from '../../src/orgrt/antigravity-runner.js';
import { CopilotAgentRunner } from '../../src/orgrt/copilot-runner.js';
import { CrushAgentRunner } from '../../src/orgrt/crush-runner.js';
import { GrokAgentRunner } from '../../src/orgrt/grok-runner.js';
import { PiAgentRunner } from '../../src/orgrt/pi-runner.js';
import { QwenAgentRunner } from '../../src/orgrt/qwen-runner.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

/** A "live" mock child whose stdout stays open until SIGTERM, which then
 *  closes stdout and ends the process with a signal (a CLI that dies on
 *  SIGTERM). Without the abort hook nothing ever kills it, so a runner
 *  blocked on its stdout stays blocked forever. */
function makeLiveMockChild(): cp.ChildProcess & { stdinData: string } {
  const child = new EventEmitter() as any;
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.stdinData = '';
  child.stdin = {
    on: vi.fn(),
    end: (d?: string) => {
      if (d) child.stdinData += d;
    },
    write: (d: string) => {
      child.stdinData += d;
    },
  };
  let endStdout: () => void = () => {};
  const blocked = new Promise<void>((r) => {
    endStdout = r;
  });
  child.stdout = new EventEmitter();
  child.stdout[Symbol.asyncIterator] = async function* () {
    await blocked;
  };
  child.stderr = new EventEmitter();
  child.kill = vi.fn((signal: string) => {
    child.killed = true;
    if (signal === 'SIGTERM') {
      child.signalCode = 'SIGTERM';
      endStdout();
      setTimeout(() => child.emit('close', null), 5);
    }
    return true;
  });
  return child;
}

function runArgs(signal: AbortSignal): AgentRunArgs {
  return {
    tools: [],
    prompt: (async function* () {
      yield 'do work';
    })(),
    systemPrompt: 'test role',
    cwd: '/tmp',
    env: {},
    maxTurns: 5,
    signal,
  };
}

/** Drain the runner; resolve with how it ended (bounded so a regression
 *  reads as 'hung' instead of a vitest timeout). */
async function drive(runner: AgentRunner, abort: AbortController): Promise<string> {
  const done = (async () => {
    for await (const _m of runner.run(runArgs(abort.signal))) {
      /* consume */
    }
  })();
  const outcome = done.then(
    () => 'resolved',
    (e) => `rejected: ${String(e)}`,
  );
  // Let the runner spawn and block on stdout, then abort.
  await new Promise((r) => setTimeout(r, 20));
  abort.abort();
  return Promise.race([outcome, new Promise<string>((r) => setTimeout(() => r('hung'), 3000))]);
}

describe('AgentRunArgs.signal — per-turn spawn runners kill their child on abort', () => {
  let child: ReturnType<typeof makeLiveMockChild>;

  beforeEach(() => {
    vi.clearAllMocks();
    child = makeLiveMockChild();
    vi.mocked(cp.spawn).mockReturnValue(child);
  });

  const cases: Array<[string, () => AgentRunner, RegExp]> = [
    ['PiAgentRunner', () => new PiAgentRunner('/usr/bin/pi'), /pi failed/],
    ['QwenAgentRunner', () => new QwenAgentRunner('/usr/bin/qwen'), /qwen/i],
    ['GrokAgentRunner', () => new GrokAgentRunner('/usr/bin/grok'), /grok/i],
    ['CopilotAgentRunner', () => new CopilotAgentRunner('/usr/bin/copilot'), /copilot/i],
    ['CrushAgentRunner', () => new CrushAgentRunner({ crushBin: '/usr/bin/crush' }), /crush/i],
    ['AntigravityAgentRunner', () => new AntigravityAgentRunner('/usr/bin/agy'), /agy|antigravity/i],
  ];

  for (const [name, make, errRe] of cases) {
    it(`${name}: abort sends SIGTERM to the child and the run fails instead of hanging`, async () => {
      const outcome = await drive(make(), new AbortController());
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(outcome).toMatch(/^rejected: /);
      expect(outcome).toMatch(errRe);
    }, 10000);
  }
});

/**
 * SIGTERM→SIGKILL ladder in the per-turn streaming runners (the same
 * finding as codex/kimi/antigravity): once a watchdog has sent SIGTERM, the
 * escalation must survive stdout ending; and an abandoned stream must
 * escalate rather than send a bare SIGTERM.
 */
describe('per-turn spawn runners — kill ladder survives stdout end and abandonment', () => {
  /** A live child whose fake CLI closes stdout on SIGTERM but only exits on
   *  SIGKILL (or ignores SIGTERM entirely when `ignoreTerm`). */
  function makeStubbornChild(ignoreTerm: boolean): cp.ChildProcess {
    const child = new EventEmitter() as any;
    child.exitCode = null;
    child.signalCode = null;
    child.killed = false;
    child.stdin = { on: vi.fn(), end: vi.fn(), write: vi.fn() };
    let endStdout: () => void = () => {};
    const blocked = new Promise<void>((r) => {
      endStdout = r;
    });
    child.stdout = new EventEmitter();
    child.stdout[Symbol.asyncIterator] = async function* () {
      await blocked;
    };
    child.stderr = new EventEmitter();
    child.kill = vi.fn((signal: string) => {
      child.killed = true;
      if (signal === 'SIGTERM' && !ignoreTerm) endStdout();
      if (signal === 'SIGKILL') {
        child.signalCode = 'SIGKILL';
        endStdout();
        child.emit('close', null);
      }
      return true;
    });
    return child as cp.ChildProcess;
  }

  const cases: Array<[string, () => AgentRunner]> = [
    ['PiAgentRunner', () => new PiAgentRunner('/usr/bin/pi')],
    ['QwenAgentRunner', () => new QwenAgentRunner('/usr/bin/qwen')],
    ['GrokAgentRunner', () => new GrokAgentRunner('/usr/bin/grok')],
    ['CopilotAgentRunner', () => new CopilotAgentRunner('/usr/bin/copilot')],
    ['CrushAgentRunner', () => new CrushAgentRunner({ crushBin: '/usr/bin/crush' })],
  ];

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  for (const [name, make] of cases) {
    it(`${name}: watchdog SIGTERM keeps its SIGKILL escalation armed after stdout ends`, async () => {
      vi.useFakeTimers();
      const child = makeStubbornChild(false);
      vi.mocked(cp.spawn).mockReturnValue(child);
      const abort = new AbortController();
      const gen = make().run(runArgs(abort.signal))[Symbol.asyncIterator]();
      await gen.next(); // liveness
      const pending = gen.next(); // blocked in stdout
      pending.catch(() => {});
      await vi.advanceTimersByTimeAsync(10);

      // The startup-hang watchdog (45s, no output yet) fires SIGTERM; the
      // fake CLI closes stdout but stays alive, so the runner's finally runs
      // while the SIGKILL escalation is still pending.
      await vi.advanceTimersByTimeAsync(45_000 + 10);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
      await vi.advanceTimersByTimeAsync(5000 + 10);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      await expect(pending).rejects.toThrow();
    });

    it(`${name}: iterator.return() mid-turn escalates SIGTERM→SIGKILL against a CLI that ignores SIGTERM`, async () => {
      vi.useFakeTimers();
      const child = makeStubbornChild(true);
      vi.mocked(cp.spawn).mockReturnValue(child);
      const abort = new AbortController();
      const gen = make().run(runArgs(abort.signal))[Symbol.asyncIterator]();
      await gen.next(); // liveness — parked at a yield
      const returned = gen.return(undefined as never);
      returned.catch(() => {});
      await vi.advanceTimersByTimeAsync(10);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');

      await vi.advanceTimersByTimeAsync(5000 + 10);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      await returned;
    });
  }
});

describe('AgentRunArgs.signal — ClaudeAgentRunner forwards it to the SDK abortController', () => {
  it('aborting args.signal aborts the controller handed to query(), which ends the in-process agent loop', async () => {
    let sdkSignal: AbortSignal | undefined;
    const fakeQuery = ({ options }: any) =>
      (async function* () {
        sdkSignal = options.abortController?.signal;
        // A real SDK stream ends (or throws) once its controller aborts.
        await new Promise<void>((resolve) => {
          sdkSignal?.addEventListener('abort', () => resolve(), { once: true });
        });
      })();
    const runner = new ClaudeAgentRunner(fakeQuery as any);
    const abort = new AbortController();

    const outcome = await drive(runner, abort);

    expect(sdkSignal).toBeDefined();
    expect(sdkSignal?.aborted).toBe(true);
    expect(outcome).toBe('resolved');
  });
});

describe('killOnAbort', () => {
  afterEach(() => vi.useRealTimers());

  it('is a no-op without a signal', () => {
    const kill = vi.fn();
    const unsubscribe = killOnAbort(undefined, { kill });
    unsubscribe();
    expect(kill).not.toHaveBeenCalled();
  });

  it('sends SIGTERM on abort and escalates to SIGKILL after the grace period', () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    const abort = new AbortController();
    killOnAbort(abort.signal, { kill }, 5000);
    abort.abort();
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    vi.advanceTimersByTime(4999);
    expect(kill).not.toHaveBeenCalledWith('SIGKILL');
    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('fires immediately when the signal is already aborted (turn spawned after the caller gave up)', () => {
    const kill = vi.fn();
    const abort = new AbortController();
    abort.abort();
    killOnAbort(abort.signal, { kill });
    expect(kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('unsubscribe detaches the listener so a later abort cannot kill a process that already finished', () => {
    const kill = vi.fn();
    const abort = new AbortController();
    const unsubscribe = killOnAbort(abort.signal, { kill });
    unsubscribe();
    abort.abort();
    expect(kill).not.toHaveBeenCalled();
  });
});
