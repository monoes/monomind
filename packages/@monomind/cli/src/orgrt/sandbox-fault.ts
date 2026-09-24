// packages/@monomind/cli/src/orgrt/sandbox-fault.ts

import type { AgentMessage } from './agent-runner.js';
import type { OrgBus } from './bus.js';
import { Mailbox } from './mailbox.js';

/** The message families bubblewrap itself dies with while it sets the sandbox
 *  up, before it execs the command (bubblewrap 0.13 `die`/`die_with_error`). */
const BWRAP_SETUP_FAILURE =
  /^bwrap: (?:Can't |Creating |Failed to |No permissions to create |setting up |Unable to |Unexpected |execvp\b)/;

/** A Bash result that is bubblewrap's own error, not the command's: the OS
 *  sandbox failed to start (2.16.0 release run: 31 of these, and a QA role
 *  that silently lost Bash for ~7 minutes). A new runner process builds a new
 *  sandbox, so ending the process is the recovery. Only a setup failure that
 *  is the whole result counts — after the tool's own "Exit code N" line — so
 *  a command that runs bwrap itself and prints its errors among other output
 *  (2.16.2 release run: "bwrap: : No such file or directory" in a reaper
 *  repro) is the command's output, not a fault. */
export function isSandboxFault(m: Pick<AgentMessage, 'tool' | 'text'>): boolean {
  if (m.tool !== 'Bash') return false;
  const lines = (m.text ?? '').trim().split('\n');
  if (/^Exit code \d+$/.test(lines[0])) lines.shift();
  return lines.length === 1 && BWRAP_SETUP_FAILURE.test(lines[0]);
}

/** #331: a tool result that is the runner's tool-permission channel failing,
 *  not the tool: the CLI could not ask the SDK host whether the call may run,
 *  because the stdio stream it asks over is closed. Every later org tool,
 *  Read, and Bash call that needs a decision fails the same way, while Bash
 *  allowed by a static rule keeps working (2.16.1 release run). The stream
 *  never reopens in that process, so ending it is the recovery. */
export function isChannelFault(m: Pick<AgentMessage, 'tool' | 'text'>): boolean {
  return /^Tool permission request failed: (?:\w+: )?Stream closed/.test(m.text ?? '');
}

export type ProcessFault = 'sandbox' | 'channel';

/** Consecutive faulted Bash results in one process before it is ended. */
export const SANDBOX_FAULTS_BEFORE_RESTART = 2;
/** Process restarts per task session and fault kind before the coordinator
 *  is told instead. */
export const MAX_SANDBOX_RESTARTS = 2;

const FAULTS: Record<
  ProcessFault,
  {
    before: number;
    seen: string;
    restarted: string;
    exhausted: string;
    continuation: string;
    subject: string;
    body: (role: string, key: string) => string;
  }
> = {
  sandbox: {
    before: SANDBOX_FAULTS_BEFORE_RESTART,
    seen: 'Bash sandbox failed to start',
    restarted: 'Bash sandbox kept failing',
    exhausted: 'Bash sandbox still failing',
    continuation: `Your shell's sandbox failed to start ("bwrap: …") on consecutive Bash calls, so your process was restarted with a fresh one. Continue your in-progress task from where you left off, re-running the command that failed.`,
    subject: 'Bash sandbox keeps failing',
    body: (role, key) =>
      `The OS sandbox for "${role}"'s Bash tool failed to start on consecutive calls (${key}) and ${MAX_SANDBOX_RESTARTS} process restarts did not fix it, so its shell commands are not running. Reassign the work, or have an operator check the role's sandbox (policy.sandbox) before relying on its results.`,
  },
  // One is enough: the channel does not come back in the same process.
  channel: {
    before: 1,
    seen: 'tool permission channel closed',
    restarted: 'tool permission channel closed',
    exhausted: 'tool permission channel still closing',
    continuation: `Your tool permission channel closed ("Tool permission request failed: … Stream closed"), so your process was restarted with a fresh one. Continue your in-progress task from where you left off, re-running the tool call that failed — org tools such as org_send and org_task_done work again.`,
    subject: 'Tool permission channel keeps closing',
    body: (role, key) =>
      `The tool permission channel of "${role}" closed mid-task (${key}) and ${MAX_SANDBOX_RESTARTS} process restarts did not fix it, so its org tools (org_send, org_task_done, org_task_block) and permission-checked tool calls are failing. Reassign the work, or have an operator restart the role before relying on its results.`,
  },
};

/** Thrown out of the session's message loop to end the runner process. */
export class ProcessFaultError extends Error {
  constructor(
    readonly sessionId: string | undefined,
    readonly kind: ProcessFault = 'sandbox',
  ) {
    super(
      kind === 'sandbox'
        ? `sandbox failed to start on ${SANDBOX_FAULTS_BEFORE_RESTART} consecutive Bash calls`
        : 'tool permission channel closed',
    );
    this.name = 'ProcessFaultError';
  }
}

interface Surface {
  bus: OrgBus;
  roleId: string;
  /** Who hears about it once restarts are spent (the role's reports_to). */
  coordinator?: string;
  deliver: (from: string, to: string, subject: string, body: string) => Promise<string>;
}

/** Per role session loop: counts restarts per session key (task) and kind. */
export class FaultRestarts {
  private used = new Map<string, number>();
  private surfaced = new Set<string>();

  constructor(private readonly s: Surface) {}

  /** One runner process's watcher for `key`. */
  watch(key: string): { observe(m: AgentMessage, sessionId: string | undefined): void } {
    const consecutive: Record<ProcessFault, number> = { sandbox: 0, channel: 0 };
    return {
      observe: (m, sessionId) => {
        if (m.type !== 'tool_result') return;
        const kind: ProcessFault | undefined = isSandboxFault(m)
          ? 'sandbox'
          : isChannelFault(m)
            ? 'channel'
            : undefined;
        if (m.tool === 'Bash' && kind !== 'sandbox') consecutive.sandbox = 0;
        if (!kind) return;
        const n = ++consecutive[kind];
        this.s.bus.emit({
          type: 'audit',
          from: this.s.roleId,
          reason: `${kind}-fault`,
          msg: `${FAULTS[kind].seen}: ${(m.text ?? '').split('\n')[0].slice(0, 300)}`,
          data: {
            taskKey: key,
            consecutive: n,
            ...(m.tool ? { tool: m.tool } : {}),
            ...(m.tool_use_id ? { call_id: m.tool_use_id } : {}),
          },
        });
        if (n < FAULTS[kind].before) return;
        consecutive[kind] = 0;
        if ((this.used.get(`${kind}:${key}`) ?? 0) < MAX_SANDBOX_RESTARTS)
          throw new ProcessFaultError(sessionId, kind);
        this.surface(key, kind);
      },
    };
  }

  /** Called once the process is gone: records the restart and returns the
   *  message the restarted session opens with. */
  restarted(key: string, kind: ProcessFault = 'sandbox'): string {
    const n = (this.used.get(`${kind}:${key}`) ?? 0) + 1;
    this.used.set(`${kind}:${key}`, n);
    this.s.bus.emit({
      type: 'status',
      from: this.s.roleId,
      reason: `${kind}-restart`,
      msg: `${FAULTS[kind].restarted} — process restarted for ${key} (${n}/${MAX_SANDBOX_RESTARTS})`,
      data: { taskKey: key, restarts: n, max: MAX_SANDBOX_RESTARTS },
    });
    return `${Mailbox.CONTINUE_PREFIX} ${FAULTS[kind].continuation}`;
  }

  private surface(key: string, kind: ProcessFault): void {
    if (this.surfaced.has(`${kind}:${key}`)) return;
    this.surfaced.add(`${kind}:${key}`);
    const { bus, roleId, coordinator, deliver } = this.s;
    bus.emit({
      type: 'audit',
      from: roleId,
      reason: `${kind}-fault-exhausted`,
      msg: `${FAULTS[kind].exhausted} for ${key} after ${MAX_SANDBOX_RESTARTS} restarts${coordinator ? ` — told "${coordinator}"` : ''}`,
      data: {
        taskKey: key,
        restarts: MAX_SANDBOX_RESTARTS,
        ...(coordinator ? { coordinator } : {}),
      },
    });
    if (!coordinator) return;
    deliver(roleId, coordinator, FAULTS[kind].subject, FAULTS[kind].body(roleId, key)).catch(
      () => {},
    );
  }
}
