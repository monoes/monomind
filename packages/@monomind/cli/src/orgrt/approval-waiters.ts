// packages/@monomind/cli/src/orgrt/approval-waiters.ts
/**
 * #553: tool calls waiting inline on a queued approval request.
 *
 * checkApprovalEntry registers the waiter inside the per-org approvals lock,
 * and setApproval wakes it under the same lock, so a resolution can never
 * slip between "queued" and "waiting" (the call would then run and also be
 * told to repeat itself). A waiter ends on the verdict, on its timeout, or
 * when the org stops or the role's mailbox closes.
 */
import type { ApprovalEntry } from './approvals.js';

export interface ApprovalWaitResult {
  approved: boolean | null;
  /** The org stopped or the role closed while the call waited. */
  cancelled?: boolean;
}

/** How often a waiter checks whether its org/role is still alive. */
const LIVENESS_POLL_MS = 500;

const waiters = new WeakMap<ApprovalEntry, Set<(approved: boolean) => void>>();
/** How to end one waiter without a verdict (see abandonApprovalWaiters). */
const abandon = new WeakMap<(approved: boolean) => void, () => void>();

/** Registers a wait on `entry` synchronously and returns its outcome. */
export function registerApprovalWait(
  entry: ApprovalEntry,
  timeoutMs: number,
  stillLive: () => boolean,
): Promise<ApprovalWaitResult> {
  if (entry.approved !== null) return Promise.resolve({ approved: entry.approved });
  const set = waiters.get(entry) ?? new Set();
  waiters.set(entry, set);
  let waiter!: (approved: boolean) => void;
  const result = new Promise<ApprovalWaitResult>((resolve) => {
    const done = (r: ApprovalWaitResult) => {
      clearTimeout(timer);
      clearInterval(poll);
      set.delete(waiter);
      resolve(r);
    };
    waiter = (approved) => done({ approved });
    abandon.set(waiter, () => done({ approved: null }));
    const timer = setTimeout(() => done({ approved: null }), timeoutMs);
    const poll = setInterval(() => {
      if (!stillLive()) done({ approved: null, cancelled: true });
    }, LIVENESS_POLL_MS);
    timer.unref?.();
    poll.unref?.();
  });
  set.add(waiter);
  return result;
}

/** Wakes the calls waiting on `entry`; true when at least one was waiting. */
export function notifyApprovalWaiters(entry: ApprovalEntry, approved: boolean): boolean {
  const set = waiters.get(entry);
  if (!set?.size) return false;
  for (const w of [...set]) w(approved);
  waiters.delete(entry);
  return true;
}

/** #835 PR 7: ends the waits on `entry` with no verdict (the request stays pending), so a later
 *  resolution reaches the role through its mailbox like any human one. */
export function abandonApprovalWaiters(entry: ApprovalEntry): void {
  const set = waiters.get(entry);
  if (!set?.size) return;
  const gone = [...set];
  waiters.delete(entry);
  for (const w of gone) abandon.get(w)?.();
}

/** Who resolved a request, from its resolvedBy. mono-agent resolves as
 *  `rule` or `<decider kind>:<...>` (internal/orgdecide/service.go:341-345,
 *  398, 481-483; jev.go:82); anything else came from a person
 *  (`org approve --by <name>`, default `human`). */
export function resolverLabel(resolver: string | undefined): string {
  if (!resolver || resolver === 'human') return 'a human';
  if (resolver === 'rule') return "the org's autonomy rules";
  if (/^(model|jev|boss|parent):/.test(resolver)) return `the org's decider (${resolver})`;
  // #835 PR 7: written by monomind itself when a decision role resolves it.
  if (/^decision:/.test(resolver)) return `the org's decision role (${resolver})`;
  return `a human (${resolver})`;
}
