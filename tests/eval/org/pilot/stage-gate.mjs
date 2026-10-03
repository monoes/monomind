#!/usr/bin/env node
// The staged-plan gate of a pilot (pilot/<scenario>.pilot.json: staged_plan, stop_rule), called by run-all.sh
// before every trial of a scenario that has one. A pilot without a staged_plan is always allowed.
//   node stage-gate.mjs <scenario> <base dir> <arm> <trial number>
//   exit 0 = allowed, exit 1 = refused (the reason is on stdout)
// Stage 1 = the single arm, trial 1. Stage 2 = baseline or treatment, trial 1: allowed only once the stage 1
// single trial's units.json exists and its delivered count is at most stop_rule.thresholds.auto_continue_at_or_below;
// at or above stop_at_or_above the pilot stops (this design does not need a team); in the inconclusive band it needs
// the owner's decision, passed as PILOT_OWNER_DECISION=<text> (nothing auto-continues). Stage 3 = every other trial:
// a further owner approval, PILOT_STAGE3_APPROVED=yes. The stage 1 count is the `delivered` field the kit's
// check() leaves in units.json (accepted units of 33 by the deadline).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** {allowed, reason} for one trial. `delivered`: the stage 1 single trial's count, or undefined if none yet. */
export function decide({ pilot, arm, n, delivered, env = {} }) {
  if (!pilot.staged_plan) return { allowed: true, reason: 'no staged plan' };
  const t = pilot.stop_rule.thresholds;
  const stage =
    arm === 'single' && n === 1
      ? 1
      : (arm === 'baseline' || arm === 'treatment') && n === 1
        ? 2
        : 3;
  if (stage === 1) return { allowed: true, reason: 'stage 1 (single x1) always runs first' };
  if (stage === 3)
    return env.PILOT_STAGE3_APPROVED === 'yes'
      ? { allowed: true, reason: 'stage 3, further owner approval given' }
      : {
          allowed: false,
          reason:
            'stage 3 needs a further owner approval (PILOT_STAGE3_APPROVED=yes); none is recorded',
        };
  if (delivered === undefined)
    return {
      allowed: false,
      reason:
        'stage 2 needs the stage 1 single trial first (no units.json with a delivered count found)',
    };
  if (delivered >= t.stop_at_or_above)
    return {
      allowed: false,
      reason: `STOP: single delivered ${delivered} of ${t.of} units by the deadline (>= ${t.stop_at_or_above}): this design does not need a team; record that and run no team arm`,
    };
  if (delivered <= t.auto_continue_at_or_below)
    return {
      allowed: true,
      reason: `single delivered ${delivered} of ${t.of} (<= ${t.auto_continue_at_or_below}): stage 2`,
    };
  return env.PILOT_OWNER_DECISION
    ? {
        allowed: true,
        reason: `single delivered ${delivered} of ${t.of} (inconclusive band): owner decision recorded: ${env.PILOT_OWNER_DECISION}`,
      }
    : {
        allowed: false,
        reason: `single delivered ${delivered} of ${t.of} (inconclusive band ${t.inconclusive_band.join(' to ')}): not auto-continued; the owner decides (PILOT_OWNER_DECISION=<text>)`,
      };
}

/** The delivered count of the stage 1 single trial under <base>/trials (the last of p1s, p1sr1, ... that has one). */
export function stageOneDelivered(base, scenario) {
  const dir = join(base, 'trials');
  if (!existsSync(dir)) return undefined;
  const names = readdirSync(dir)
    .filter((d) => d.startsWith(`smoke-${scenario}-single-p1s`))
    .sort();
  let found;
  for (const d of names) {
    const f = join(dir, d, 'units.json');
    if (!existsSync(f)) continue;
    const u = JSON.parse(readFileSync(f, 'utf8'));
    if (typeof u.delivered === 'number') found = u.delivered;
  }
  return found;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [scenario, base, arm, n] = process.argv.slice(2);
  const pilot = JSON.parse(readFileSync(join(here, `${scenario}.pilot.json`), 'utf8'));
  const r = decide({
    pilot,
    arm,
    n: Number(n),
    delivered: stageOneDelivered(base, scenario),
    env: process.env,
  });
  console.log(r.reason);
  process.exit(r.allowed ? 0 : 1);
}
