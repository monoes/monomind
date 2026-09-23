// packages/@monomind/cli/src/commands/org-run-end.ts
// The last line `org run` prints: how the run ended, how long it took and
// what it cost, so a detached run's log has an ending instead of just
// stopping.
import { summarizeRun } from '../orgrt/reporting.js';
import type { BusEvent } from '../orgrt/types.js';

export type RunEndKind = 'complete' | 'stopped' | 'error' | 'budget';

export interface RunEndInput {
  /** runtime.json's final record (status / closedBy / error). */
  final: { status?: string; closedBy?: string; error?: string };
  /** The run's bus events. */
  events: BusEvent[];
  /** `org stop` wrote the stopfile. */
  stoppedManually?: boolean;
  /** SIGINT/SIGTERM ended the wait. */
  signal?: boolean;
}

const BUDGET_REASONS = new Set(['org-budget-exhausted', 'budget-exhausted']);

export function classifyRunEnd(input: RunEndInput): { kind: RunEndKind; detail: string } {
  const { final, events } = input;
  if (final.closedBy === 'org-complete') {
    return { kind: 'complete', detail: summarizeRun(events).outcome?.status ?? 'org_complete' };
  }
  if (final.status === 'crashed') return { kind: 'error', detail: final.error ?? 'unknown error' };
  if (input.stoppedManually) return { kind: 'stopped', detail: 'org stop' };
  if (input.signal) return { kind: 'stopped', detail: 'signal' };
  const cause = final.closedBy ?? 'without org_complete';
  if (events.some((e) => e.type === 'status' && e.reason && BUDGET_REASONS.has(e.reason))) {
    return { kind: 'budget', detail: cause };
  }
  return { kind: 'stopped', detail: cause };
}

function formatWall(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h${m}m${s}s`;
  if (m) return `${m}m${s}s`;
  return `${s}s`;
}

export function runEndLine(
  input: RunEndInput & { name: string; run: string; wallMs: number },
): string {
  const { kind, detail } = classifyRunEnd(input);
  const cost = summarizeRun(input.events).totalCostUsd;
  return `org ${input.name} run ${input.run} ended — outcome: ${kind} (${detail}), wall time ${formatWall(input.wallMs)}, cost $${cost.toFixed(2)}`;
}
