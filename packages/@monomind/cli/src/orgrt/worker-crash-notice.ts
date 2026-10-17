// packages/@monomind/cli/src/orgrt/worker-crash-notice.ts
/**
 * What the coordinator is told when a worker crashed for the rest of the run.
 * A worker pinned to a runtime (`runtime`, or a `provider.kind` that picks one)
 * is there for that runtime's own view: handing its work to another runtime or
 * model, or doing it yourself under its name, silently replaces the thing the
 * seat exists for (reputation-panel, 2026-10-17: two vendor scorers crashed and
 * Claude subagents filled both seats). It is reported as failed instead.
 */
import type { OrgRole } from './types.js';

export function workerCrashNotice(
  role: Pick<OrgRole, 'id' | 'runtime' | 'provider'>,
  message: string,
  guidance: string,
): string {
  const head = `[system] Worker "${role.id}" crashed and will not recover this run (${message}). It can no longer receive messages — stop messaging it.`;
  const pinned = role.runtime ?? role.provider?.kind;
  const advice = pinned
    ? ` This seat runs on ${pinned}. Do not give its work to an agent on another runtime or model, and do not do it yourself in its name: report the seat as failed in the final result and carry on without it.`
    : ' Reassign its outstanding work to another agent or take it on yourself.';
  return `${head}${advice}${guidance}`;
}
