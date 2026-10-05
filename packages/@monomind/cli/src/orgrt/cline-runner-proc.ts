// packages/@monomind/cli/src/orgrt/cline-runner-proc.ts
/**
 * Spawn one cline process for a turn (json or ACP) with the shared plumbing:
 * process-group spawn (full access), turn timeout, abort kill ladder, the
 * per-turn marker env, and the hub-daemon reaper, which runs when the
 * process closes and again on abort (Stop) — see cline-runner-host.ts.
 *
 * Prompt delivery (json turns): cline 3.0.65 reads a piped prompt only when
 * fd 0 is a FIFO (verified live: a Node 'pipe' — a socketpair — and a
 * regular file are both ignored, and json mode then fails with "requires a
 * prompt argument or piped stdin"). So on POSIX the turn goes through
 * `/bin/sh`, which makes a private FIFO, feeds it from a 0600 prompt file
 * with `cat`, and `exec`s cline with the FIFO as stdin — cline keeps the
 * spawned pid (so `cline history`'s pid matches) and the prompt never
 * appears in argv. Windows passes it as the positional prompt.
 */

import { type ChildProcess, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRunArgs } from './agent-runner.js';
import { killOnAbort } from './agent-runner.js';
import { maskedCommand } from './authority-mask.js';
import {
  CLINE_TURN_ENV,
  type ClineSetup,
  reapHubDaemons,
  turnHubDaemons,
} from './cline-runner-host.js';
import type { ClineHost } from './cline-runner-types.js';
import { spawnRunnerProcess } from './process-group-spawn.js';
import { createRunnerInputDir, writeRunnerInput } from './runner-inputs.js';

export const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const KILL_GRACE_MS = 5000;
/** cline requires a positional prompt to contain whitespace ("quoted"); the
 *  real prompt follows it on stdin (cline joins them with a blank line). */
export const POSITIONAL_PROMPT = 'Complete the task below.';
const FIFO_SCRIPT = 'f=$1; shift; p="$f.fifo"; cat -- "$f" > "$p" & exec "$@" < "$p"';

export interface ClineLaunch {
  child: ChildProcess;
  /** Resolves with the exit code on 'close'; rejects on a spawn error. */
  exit: Promise<number>;
  stderr(): string;
  timedOut(): boolean;
  /** SIGTERM the cline process alone (used to end an idle ACP process). */
  interrupt(): void;
  /** SIGTERM→SIGKILL the whole target (the tracked tree under full access). */
  killChild(graceMs?: number): void;
  /** Idempotent: clear timers and the abort hook; kill the child if alive. */
  dispose(): void;
}

export function launchCline(
  setup: ClineSetup,
  cliArgs: string[],
  args: AgentRunArgs,
  host: ClineHost,
  opts: { stdinPrompt?: string; interactive?: boolean },
  plat: NodeJS.Platform = process.platform,
): ClineLaunch {
  const marker = randomUUID();
  const hubBefore = new Set(host.hubLockPids(setup.dataDir));
  let promptDir: string | undefined;
  let command = setup.bin;
  let argv = cliArgs;
  if (opts.stdinPrompt !== undefined) {
    if (plat === 'win32') {
      argv = [...cliArgs, `${POSITIONAL_PROMPT}\n\n${opts.stdinPrompt}`];
    } else {
      promptDir = createRunnerInputDir('cline', {
        cwd: args.cwd,
        env: { ...args.env, ...setup.env },
      });
      const promptFile = join(promptDir, 'prompt.txt');
      try {
        writeRunnerInput(promptFile, opts.stdinPrompt);
        // The child sees this directory read-only inside its authority mask.
        // FIFO I/O works on a read-only mount, but creating the inode does not.
        execFileSync('mkfifo', ['-m', '600', `${promptFile}.fifo`]);
      } catch (error) {
        rmSync(promptDir, { recursive: true, force: true });
        throw error;
      }
      command = '/bin/sh';
      argv = [
        '-c',
        FIFO_SCRIPT,
        'monomind-cline',
        promptFile,
        setup.bin,
        ...cliArgs,
        POSITIONAL_PROMPT,
      ];
    }
  }

  let proc: ReturnType<typeof spawnRunnerProcess>;
  try {
    proc = spawnRunnerProcess(
      ...maskedCommand(args.authorityMask, command, argv),
      {
        cwd: args.cwd,
        env: { ...setup.env, [CLINE_TURN_ENV]: marker },
        stdio: [opts.interactive ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      },
      args,
    );
  } catch (error) {
    if (promptDir) rmSync(promptDir, { recursive: true, force: true });
    throw error;
  }
  const child = proc.child;

  let stderrTail = '';
  child.stderr?.on('data', (c: Buffer) => {
    stderrTail = (stderrTail + c.toString()).slice(-8000);
  });

  const reap = () => reapHubDaemons(host, turnHubDaemons(host, marker, setup.dataDir, hubBefore));
  const cleanupPrompt = () => {
    if (promptDir) rmSync(promptDir, { recursive: true, force: true });
    promptDir = undefined;
  };
  child.once('close', () => {
    cleanupPrompt();
    reap();
  });
  child.once('error', cleanupPrompt);

  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const killChild = (graceMs = KILL_GRACE_MS): void => {
    proc.target.kill('SIGTERM');
    killTimer = setTimeout(() => proc.target.kill('SIGKILL'), graceMs);
    killTimer.unref?.();
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killChild();
  }, TURN_TIMEOUT_MS);
  const unsubscribeAbort = killOnAbort(args.signal, proc.target, KILL_GRACE_MS);
  const onAbort = () => reap();
  args.signal?.addEventListener('abort', onAbort, { once: true });

  const exit = new Promise<number>((res, rej) => {
    child.on('error', rej);
    child.on('close', (code) => res(code ?? 1));
  });
  exit.catch(() => {});

  let disposed = false;
  return {
    child,
    exit,
    stderr: () => stderrTail,
    timedOut: () => timedOut,
    interrupt: () => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    },
    killChild,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      unsubscribeAbort();
      args.signal?.removeEventListener('abort', onAbort);
      proc.stop();
      if (child.exitCode === null && child.signalCode === null) {
        // Abandoned mid-turn, or a kill still inside its grace: keep (or
        // start) the escalation so a CLI ignoring SIGTERM is not orphaned.
        if (!child.killed) killChild();
      } else {
        if (killTimer) clearTimeout(killTimer);
        cleanupPrompt();
      }
    },
  };
}
