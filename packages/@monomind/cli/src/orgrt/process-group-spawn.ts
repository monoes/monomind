// packages/@monomind/cli/src/orgrt/process-group-spawn.ts
/**
 * Coder mode on every runtime: the process-group spawn/kill helper every
 * subprocess runner uses, so `--access full` gets the same cancel semantics
 * and `background_pids` report as the Claude runner (#359) on any runtime.
 *
 * SIGNATURE (for runner authors):
 *
 *   spawnRunnerProcess(
 *     command: string,               // e.g. from maskedCommand(...)[0]
 *     argv: string[],                // e.g. from maskedCommand(...)[1]
 *     options: SpawnOptions,         // cwd, env, stdio — as today
 *     args: Pick<AgentRunArgs, 'access' | 'onProcessSpawned'>,
 *   ): RunnerProcess
 *
 *   interface RunnerProcess {
 *     child: ChildProcess;             // use exactly like spawn()'s return
 *     target: { kill(signal?) };      // pass to killOnAbort / your kill ladder
 *     sampleNow(): void;              // optional: call at tool start/end
 *     stop(): void;                   // call once in the turn's finally
 *   }
 *
 * Adoption is a drop-in for the usual runner shape:
 *
 *   const proc = spawnRunnerProcess(...maskedCommand(args.authorityMask, bin, cliArgs),
 *     { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }, args);
 *   const child = proc.child;
 *   const killChild = () => { proc.target.kill('SIGTERM'); ... proc.target.kill('SIGKILL') };
 *   const unsubscribeAbort = killOnAbort(args.signal, proc.target, KILL_GRACE_MS);
 *   try { ... } finally { unsubscribeAbort(); proc.stop(); }
 *
 * `access: 'full'`: the child becomes the leader of its own process group
 * (`detached: true` on POSIX), inherits a fresh `MONOMIND_EXEC_TREE` marker
 * (process-tree-marker.ts), and is tracked by `trackDescendants`
 * (process-tree.ts) from spawn on; `target.kill` signals the whole tracked
 * tree, and `args.onProcessSpawned` receives the pid plus the survivor
 * lookup agent-exec.ts reports as `background_pids`.
 *
 * Any other access: a plain `spawn()` — byte-identical to what the runners
 * did before — and `target` is the child itself. The org runtime's scoped
 * sessions keep their child in monomind's own group, so a Ctrl-C on the
 * daemon still reaches them.
 */

import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { AgentRunArgs } from './agent-runner-types.js';
import { type DescendantTracker, trackDescendants } from './process-tree.js';
import { EXEC_TREE_ENV } from './process-tree-marker.js';

export interface RunnerProcess {
  child: ChildProcess;
  /** Kill target: the whole tracked tree (full access) or the child alone. */
  target: { kill(signal?: NodeJS.Signals): void };
  /** Take an extra tree sample now (full access only; no-op otherwise). */
  sampleNow(): void;
  /** Stop periodic sampling. Idempotent; `target.kill` keeps working. */
  stop(): void;
}

export function spawnRunnerProcess(
  command: string,
  argv: string[],
  options: SpawnOptions,
  args: Pick<AgentRunArgs, 'access' | 'onProcessSpawned'>,
  plat: NodeJS.Platform = process.platform,
): RunnerProcess {
  if (args.access !== 'full') {
    const child = spawn(command, argv, options);
    return {
      child,
      target: {
        kill: (signal) => {
          try {
            child.kill(signal);
          } catch {
            /* already gone */
          }
        },
      },
      sampleNow: () => {},
      stop: () => {},
    };
  }

  const treeToken = randomUUID();
  const child = spawn(command, argv, {
    ...options,
    env: { ...(options.env ?? process.env), [EXEC_TREE_ENV]: treeToken },
    detached: plat !== 'win32',
  });
  let tracker: DescendantTracker | undefined;
  if (typeof child.pid === 'number') {
    tracker = trackDescendants(child.pid, { marker: treeToken, plat });
    const t = tracker;
    args.onProcessSpawned?.({
      pid: child.pid,
      ...(plat !== 'win32' ? { pgid: child.pid } : {}),
      execTree: treeToken,
      getBackgroundSurvivors: () => t.liveMembers(),
    });
  }
  return {
    child,
    target: {
      kill: (signal) => {
        if (tracker) {
          tracker.signal(signal ?? 'SIGTERM');
          return;
        }
        try {
          child.kill(signal);
        } catch {
          /* already gone */
        }
      },
    },
    sampleNow: () => tracker?.sampleNow(),
    stop: () => tracker?.stop(),
  };
}
