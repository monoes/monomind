// packages/@monomind/cli/src/orgrt/sandbox-fault.ts

import type { AgentMessage } from './agent-runner.js';
import type { OrgBus } from './bus.js';
import { Mailbox } from './mailbox.js';

/** A Bash result that is bubblewrap's own error, not the command's: the OS
 *  sandbox failed to start (2.16.0 release run: 31 of these, and a QA role
 *  that silently lost Bash for ~7 minutes). A new runner process builds a new
 *  sandbox, so ending the process is the recovery. */
export function isSandboxFault(m: Pick<AgentMessage, 'tool' | 'text'>): boolean {
  return m.tool === 'Bash' && (m.text ?? '').startsWith('bwrap: ');
}

/** Consecutive faulted Bash results in one process before it is ended. */
export const SANDBOX_FAULTS_BEFORE_RESTART = 2;
/** Process restarts per task session before the coordinator is told instead. */
export const MAX_SANDBOX_RESTARTS = 2;

/** Thrown out of the session's message loop to end the runner process. */
export class SandboxFaultError extends Error {
  constructor(readonly sessionId: string | undefined) {
    super(`sandbox failed to start on ${SANDBOX_FAULTS_BEFORE_RESTART} consecutive Bash calls`);
    this.name = 'SandboxFaultError';
  }
}

interface Surface {
  bus: OrgBus;
  roleId: string;
  /** Who hears about it once restarts are spent (the role's reports_to). */
  coordinator?: string;
  deliver: (from: string, to: string, subject: string, body: string) => Promise<string>;
}

/** Per role session loop: counts restarts per session key (task). */
export class SandboxRestarts {
  private used = new Map<string, number>();
  private surfaced = new Set<string>();

  constructor(private readonly s: Surface) {}

  /** One runner process's watcher for `key`. */
  watch(key: string): { observe(m: AgentMessage, sessionId: string | undefined): void } {
    let consecutive = 0;
    return {
      observe: (m, sessionId) => {
        if (m.type !== 'tool_result' || m.tool !== 'Bash') return;
        if (!isSandboxFault(m)) {
          consecutive = 0;
          return;
        }
        consecutive++;
        this.s.bus.emit({
          type: 'audit',
          from: this.s.roleId,
          reason: 'sandbox-fault',
          msg: `Bash sandbox failed to start: ${(m.text ?? '').split('\n')[0].slice(0, 300)}`,
          data: { taskKey: key, consecutive, ...(m.tool_use_id ? { call_id: m.tool_use_id } : {}) },
        });
        if (consecutive < SANDBOX_FAULTS_BEFORE_RESTART) return;
        consecutive = 0;
        if ((this.used.get(key) ?? 0) < MAX_SANDBOX_RESTARTS)
          throw new SandboxFaultError(sessionId);
        this.surface(key);
      },
    };
  }

  /** Called once the process is gone: records the restart and returns the
   *  message the restarted session opens with. */
  restarted(key: string): string {
    const n = (this.used.get(key) ?? 0) + 1;
    this.used.set(key, n);
    this.s.bus.emit({
      type: 'status',
      from: this.s.roleId,
      reason: 'sandbox-restart',
      msg: `Bash sandbox kept failing — process restarted for ${key} (${n}/${MAX_SANDBOX_RESTARTS})`,
      data: { taskKey: key, restarts: n, max: MAX_SANDBOX_RESTARTS },
    });
    return `${Mailbox.CONTINUE_PREFIX} Your shell's sandbox failed to start ("bwrap: …") on consecutive Bash calls, so your process was restarted with a fresh one. Continue your in-progress task from where you left off, re-running the command that failed.`;
  }

  private surface(key: string): void {
    if (this.surfaced.has(key)) return;
    this.surfaced.add(key);
    const { bus, roleId, coordinator, deliver } = this.s;
    bus.emit({
      type: 'audit',
      from: roleId,
      reason: 'sandbox-fault-exhausted',
      msg: `Bash sandbox still failing for ${key} after ${MAX_SANDBOX_RESTARTS} restarts${coordinator ? ` — told "${coordinator}"` : ''}`,
      data: {
        taskKey: key,
        restarts: MAX_SANDBOX_RESTARTS,
        ...(coordinator ? { coordinator } : {}),
      },
    });
    if (!coordinator) return;
    deliver(
      roleId,
      coordinator,
      'Bash sandbox keeps failing',
      `The OS sandbox for "${roleId}"'s Bash tool failed to start on consecutive calls (${key}) and ${MAX_SANDBOX_RESTARTS} process restarts did not fix it, so its shell commands are not running. Reassign the work, or have an operator check the role's sandbox (policy.sandbox) before relying on its results.`,
    ).catch(() => {});
  }
}
