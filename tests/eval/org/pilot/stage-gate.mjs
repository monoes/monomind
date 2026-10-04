#!/usr/bin/env node
// The staged-plan gate of a pilot (pilot/<scenario>.pilot.json: staged_plan, stop_rule), called by run-all.sh
// before every trial of a scenario that has one. A pilot without a staged_plan is always allowed.
//   node stage-gate.mjs <scenario> <base dir> <arm> <trial number> [variant]
//   exit 0 = allowed, exit 1 = refused (the reason is on stdout)
// Stage 1 = the single arm, trial 1. Stage 2 = baseline or treatment, trial 1: allowed only once the stage 1
// single trial's units.json exists and its delivered count is at most stop_rule.thresholds.auto_continue_at_or_below;
// at or above stop_at_or_above the pilot stops (this design does not need a team); in the inconclusive band it needs
// the owner's decision, passed as PILOT_OWNER_DECISION=<text> (nothing auto-continues). Stage 3 = every other trial:
// a further owner approval, PILOT_STAGE3_APPROVED=yes. A declared variant (pilot manifest `variants`, optional 5th
// argument) is single x1 only and runs only with PILOT_OWNER_DECISION naming its phrase; it never counts as stage 1. The stage 1 count is the `delivered` field the kit's
// check() leaves in units.json (accepted units of 33 by the deadline).
// A pilot whose staged_plan.gate_kind is 'handoff-read' (parallel-sweep-3) has its own gate: see decideHandoffRead.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { phrasesOf, resolveVariant } from './runtime-switch.mjs';
import { trialView } from './runtime-view.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** {allowed, reason} for one trial. `delivered`: the stage 1 single trial's count, or undefined if none yet.
 *  `variant`: a declared variant of the manifest's `variants` (single x1 only), allowed only when
 *  PILOT_OWNER_DECISION names its owner_decision_phrase. */
export function decide({ pilot, arm, n, delivered, reads, checks, variant, env = {} }) {
  if (!pilot.staged_plan) return { allowed: true, reason: 'no staged plan' };
  if (pilot.staged_plan.gate_kind === 'handoff-read')
    return decideHandoffRead({ pilot, arm, n, reads, checks, variant, env });
  if (variant) {
    const v = resolveVariant(pilot, variant)?.variant;
    if (!v)
      return {
        allowed: false,
        reason: `the pilot manifest does not list the variant "${variant}"`,
      };
    if (arm !== v.arm || n !== 1)
      return { allowed: false, reason: `variant ${variant} is ${v.arm} x1 only, not ${arm} x${n}` };
    return phrasesOf(v).every((p) => String(env.PILOT_OWNER_DECISION ?? '').includes(p))
      ? {
          allowed: true,
          reason: `declared variant ${variant} (${v.deadline_seconds} s, ${v.arm} x1): owner decision recorded: ${env.PILOT_OWNER_DECISION}`,
        }
      : {
          allowed: false,
          reason: `variant ${variant} needs PILOT_OWNER_DECISION naming ${phrasesOf(v)
            .map((p) => `"${p}"`)
            .join(' and ')}; none is recorded`,
        };
  }
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

/** The mechanism gate of parallel-sweep-3 (staged_plan.gate_kind 'handoff-read', no single arm): stage 1 = treatment
 *  trial 1; stage 2 = treatment trial 2 or baseline trial 1, allowed only when, in the stage 1 treatment trial, the
 *  synthesiser made at least stop_rule.thresholds.stage1_min_synthesiser_doc_reads successful doc_read calls (else the
 *  mechanism failed: stop and report); stage 3 = anything else, a further owner approval. `reads`: that count, or
 *  undefined when no finished stage 1 trial exists. */
function decideHandoffRead({ pilot, arm, n, reads, checks, variant, env }) {
  if (variant) return decideHandoffVariant({ pilot, arm, n, reads, checks, variant, env });
  const need = pilot.stop_rule.thresholds.stage1_min_synthesiser_doc_reads;
  if (arm === 'treatment' && n === 1)
    return {
      allowed: true,
      reason: 'stage 1 (treatment x1, the mechanism gate) always runs first',
    };
  const stage2 = (arm === 'treatment' && n === 2) || (arm === 'baseline' && n === 1);
  if (!stage2)
    return env.PILOT_STAGE3_APPROVED === 'yes'
      ? { allowed: true, reason: 'stage 3, further owner approval given' }
      : {
          allowed: false,
          reason:
            'stage 3 needs a further owner approval (PILOT_STAGE3_APPROVED=yes); none is recorded',
        };
  if (reads === undefined)
    return {
      allowed: false,
      reason: 'stage 2 needs the stage 1 treatment trial first (no finished trial p1t found)',
    };
  if (reads < need)
    return {
      allowed: false,
      reason: `STOP: the synthesiser made ${reads} successful doc_read calls in the stage 1 treatment trial (the gate needs ${need}): the mechanism failed; report it and run no further trial`,
    };
  return {
    allowed: true,
    reason: `stage 2: the synthesiser made ${reads} successful doc_read calls in the stage 1 treatment trial (gate: ${need})`,
  };
}

/** A declared variant of a 'handoff-read' pilot (parallel-sweep-3's v2): treatment only, and only with PILOT_OWNER_DECISION
 *  naming its owner_decision_phrase. Stage 1 = the variant x1. The variant x2 is allowed only when, in the variant's
 *  stage 1 trial, the synthesiser made at least the thresholds' successful doc_read and doc_check calls (reads and checks:
 *  those counts, undefined when no finished variant stage 1 trial exists); any other number needs PILOT_STAGE3_APPROVED. */
function decideHandoffVariant({ pilot, arm, n, reads, checks, variant, env }) {
  const v = resolveVariant(pilot, variant)?.variant;
  if (!v) return { allowed: false, reason: `this pilot does not list the variant "${variant}"` };
  if (arm !== v.arm)
    return { allowed: false, reason: `variant ${variant} is the ${v.arm} arm only, not ${arm}` };
  if (!phrasesOf(v).every((p) => String(env.PILOT_OWNER_DECISION ?? '').includes(p)))
    return {
      allowed: false,
      reason: `variant ${variant} needs PILOT_OWNER_DECISION naming ${phrasesOf(v)
        .map((p) => `"${p}"`)
        .join(' and ')}; none is recorded`,
    };
  const t = v.staged_plan.stage_1_thresholds;
  if (n === 1)
    return {
      allowed: true,
      reason: `variant ${variant} stage 1 (${v.arm} x1, the mechanism gates: doc_read and doc_check): owner decision recorded: ${env.PILOT_OWNER_DECISION}`,
    };
  if (n !== 2)
    return env.PILOT_STAGE3_APPROVED === 'yes'
      ? { allowed: true, reason: `variant ${variant} stage 3, further owner approval given` }
      : {
          allowed: false,
          reason: `variant ${variant} x${n} needs a further owner approval (PILOT_STAGE3_APPROVED=yes); none is recorded`,
        };
  if (reads === undefined)
    return {
      allowed: false,
      reason: `variant ${variant} stage 2 needs the stage 1 variant trial first (no finished trial p1t-${variant} found)`,
    };
  if (reads < t.min_synthesiser_doc_reads)
    return {
      allowed: false,
      reason: `STOP: the synthesiser made ${reads} successful doc_read calls in the stage 1 variant trial (the gate needs ${t.min_synthesiser_doc_reads}): the mechanism failed; report it and run no further trial`,
    };
  if ((checks ?? 0) < t.min_synthesiser_doc_checks)
    return {
      allowed: false,
      reason: `STOP: the synthesiser made ${checks ?? 0} successful doc_check calls in the stage 1 variant trial (the gate needs ${t.min_synthesiser_doc_checks}): the verification aid was not used; report it and run no further trial`,
    };
  return {
    allowed: true,
    reason: `variant ${variant} stage 2: the synthesiser made ${reads} doc_read and ${checks} doc_check calls in the stage 1 variant trial (gates: ${t.min_synthesiser_doc_reads} and ${t.min_synthesiser_doc_checks})`,
  };
}

/** The synthesiser's successful doc_read calls in the stage 1 treatment trial of <base>/trials (the last of p1t, p1tr1, ...
 *  that has a result.json; a trial that never reached the hand-off store counts 0), or undefined when there is none. */
export function stageOneReads(base, scenario, variant) {
  return stageOneCalls(base, scenario, 'read', variant);
}

/** The same for the synthesiser's successful doc_check calls (variant v2 only: a plain treatment trial has none). */
export function stageOneChecks(base, scenario, variant) {
  return stageOneCalls(base, scenario, 'check', variant);
}

function stageOneCalls(base, scenario, kind, variant) {
  const dir = join(base, 'trials');
  if (!existsSync(dir)) return undefined;
  const suffix = variant ? `-${variant}` : '';
  const names = readdirSync(dir)
    .filter((d) => new RegExp(`^smoke-${scenario}-phase2-p1t(r\\d+)?${suffix}$`).test(d))
    .filter((d) => existsSync(join(dir, d, 'result.json')))
    .sort();
  if (names.length === 0) return undefined;
  // the records of whichever hand-off layer ran the trial (the harness store, or the runtime's under the switch)
  return trialView(join(dir, names.at(-1))).events.filter(
    (e) => e.kind === kind && e.ok && e.role === 'synthesiser',
  ).length;
}

/** The delivered count of the stage 1 single trial under <base>/trials (the last of p1s, p1sr1, ... that has one;
 *  a variant trial such as p1s-d480 is never it). */
export function stageOneDelivered(base, scenario) {
  const dir = join(base, 'trials');
  if (!existsSync(dir)) return undefined;
  const names = readdirSync(dir)
    .filter((d) => new RegExp(`^smoke-${scenario}-single-p1s(r\\d+)?$`).test(d))
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
  const [scenario, base, arm, n, variant] = process.argv.slice(2);
  const pilot = JSON.parse(readFileSync(join(here, `${scenario}.pilot.json`), 'utf8'));
  const r = decide({
    pilot,
    arm,
    n: Number(n),
    delivered: stageOneDelivered(base, scenario),
    reads: stageOneReads(base, scenario, variant || undefined),
    checks: stageOneChecks(base, scenario, variant || undefined),
    variant: variant || undefined,
    env: process.env,
  });
  console.log(r.reason);
  process.exit(r.allowed ? 0 : 1);
}
