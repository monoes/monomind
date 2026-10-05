// packages/@monomind/cli/src/orgrt/documents/eval-gate.ts
/**
 * Org sections spec 9.2 (piece P3.3): the eval-mode start gate. A sections org
 * runs only through the experimental eval harness, which passes `evalGate: true`
 * on `startOrg`'s options. `assertEvalGate` is the ONE place that checks it; it
 * runs from `prepareOrgStart`, the path every start reaches (explicit start,
 * `org run`/`org serve`, the runfile poll, schedules, auto-wake, resume), so a
 * start that does not pass the gate is refused wherever it came from. An org
 * without the sections surface never reads the option.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sectionsSurface } from './surface.js';

/** The `startOrg` option the harness passes for a sections definition. */
export interface EvalGateOptions {
  evalGate?: boolean;
}

/** `closedBy` of a sections org whose coordinator crashed: the trial attempt
 *  ends as a failure instead of restarting (spec 9.2). */
export const EVAL_BOSS_CRASH_CLOSED_BY = 'eval-boss-crash';

export function evalGateRefusal(name: string): string {
  return (
    `org "${name}" uses sections, which are experimental and run only through the eval harness ` +
    `(run_config.experimental: "eval"); org run, org serve, schedules, auto-wake and resume cannot ` +
    `start it. Use the experimental eval path: tests/eval/org/pilot/run-org.ts`
  );
}

/** A sections org that still declares `run_config.experimental: "eval"`: the only kind the eval gate
 *  restricts. Since general availability a sections org without it starts like any other org. */
export function isEvalMode(def: { sections?: unknown; run_config?: unknown } | undefined): boolean {
  return (
    sectionsSurface(def).enabled &&
    (def?.run_config as { experimental?: unknown } | undefined)?.experimental === 'eval'
  );
}

/** Throws unless `def` is not an eval-mode org or the caller passed the gate. */
export function assertEvalGate(
  def: { sections?: unknown; run_config?: unknown },
  name: string,
  options: EvalGateOptions | undefined,
): void {
  if (!isEvalMode(def as { sections?: unknown; run_config?: unknown })) return;
  if (options?.evalGate === true) return;
  throw new Error(evalGateRefusal(name));
}

/** The refusal `org run` prints for a sections org, read from the definition
 *  file before it hands the start to a serve daemon or a local one; undefined
 *  for any other org (or an unreadable file, which later steps report). */
export function sectionsOrgRefusal(orgsDir: string, name: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(orgsDir, `${name}.json`), 'utf8'));
    return isEvalMode(raw) ? evalGateRefusal(name) : undefined;
  } catch {
    return undefined;
  }
}

/** The option fragment a harness spreads into `startOrg`'s options: the gate for
 *  a sections definition, nothing for any other. */
export function evalGateFor(def: { sections?: unknown } | undefined): EvalGateOptions {
  return sectionsSurface(def).enabled ? { evalGate: true } : {};
}
