// The parallel-sweep-3 smoke kit (manifest parallel-sweep-3.json, fixture fixtures/parallel-sweep-3): the
// parallel-sweep-2 workload (32 modules, 8 workers, a lead and a synthesiser, 33 units, same corpus, truth,
// scorer, sandbox) reshaped so that the synthesiser MUST read and decide on the published module documents.
// Arms: baseline (the sweep-2 baseline at 720 s, no faults: a control) and treatment (the hand-off layer is the
// only path: the synthesiser cannot read out/<module>/ and decides accept or reject on each document; four
// documents are corrupted by the harness at their first publish, pilot/fault-injection.ts). The single arm is
// not part of this scenario. Everything shared with parallel-sweep-2 is imported from its kit.
//
// Every role of both arms: no node or interpreter, no write to the real $HOME (applyNoExec in prepare.mjs).
// Hidden from every role: the truth, the whole tests/eval/org tree (fixtures, the scorer, the injector, the pilot
// manifests) and the pilot design notes; in the treatment arm also the trial's pilot-state/ (the store and the
// event log that records the faults) and trial.json (the fault plan). Hidden from the synthesiser in the
// treatment arm: out/<module>/ for all 32 modules.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handoffMetrics } from '../../../fixtures/parallel-sweep-3/handoff-metrics.mjs';
import { readJson, writeJson } from '../../lib.mjs';
import * as sweep2 from '../parallel-sweep-2/kit.mjs';

export const id = 'parallel-sweep-3';

const dirOf = (rel) => fileURLToPath(new URL(rel, import.meta.url)).replace(/\/$/, '');
const fixtureDir = dirOf('../../../fixtures/parallel-sweep-3/');
/** Everything under tests/eval/org (the fixtures and their scorers, the injector, the manifests) is hidden from every role. */
export const EVAL_DIR = dirOf('../../../');
/** The design notes of the pilots (they describe the faults), hidden when the directory exists. */
export const PILOT_DOCS_DIR = dirOf('../../../../../../docs/mastermind/pilot/');
const fixture = readJson(join(fixtureDir, 'fixture.json')).fixture;
const ARM = (arm) => fixture.arms.find((a) => a.id === arm);

export const { MODULE_COUNT, MODULES, UNIT_COUNT, OWNS, SESSION_CAP } = sweep2;
const sweep2Check = sweep2.check;

/** Per-role USD soft stops, in Haiku-price units (prepare.mjs scales them by 2 on the production profile).
 *  Workers are parallel-sweep-2's (1.7 = $3.4 harness, observed $1.3 to $3.0). The lead relays rejections:
 *  0.7 ($1.4, sweep-2 rerun $0.4 to $0.9). The synthesiser reads eight documents, spot-checks against the code,
 *  decides, re-reads corrections: 1.5 ($3.0), against $0.4 when it only aggregated files. Sum on production:
 *  8 x 3.4 + 1.4 + 3.0 = $31.6, under the $34 org stop, so the stop is a backstop, not the usual limiter. */
export const CAPS = {
  lead: 0.7,
  ...Object.fromEntries(Object.keys(OWNS).map((w) => [w, 1.7])),
  synthesiser: 1.5,
};

export const ALLOCATION_USD = fixture.planning_allocation_usd_per_run;
export const ORG_STOP_USD = fixture.org_stop_usd;
export const DEADLINE_SECONDS = fixture.wall_deadline_seconds;
/** All 10 roles get a slot (the default of 4 queued the last workers in an earlier dry run). */
export const MAX_CONCURRENT_AGENTS = 10;

/** The baseline's task text (no hand-off layer) and the treatment's (documents, decisions, the lead's relay). */
export const TASK = `${fixture.tasks.common} ${fixture.tasks.multi_role}`;
export const TASK_DOCUMENTS = `${fixture.tasks.common} ${fixture.tasks.multi_role_documents}`;

/** The same corpus and truth as parallel-sweep-2 (its kit builds them), recorded under this scenario's id. */
export async function buildInputs({ dir }) {
  await sweep2.buildInputs({ dir });
  writeJson(join(dir, 'meta.json'), { fixture: id, pinnedHash: fixture.pinned_hash });
}

const LAYOUT =
  'Workspace: corpus/ is read-only (never edit it); deliverables go under out/ (out/<module>/answers.json, out/synthesis.json).';

function role(roleId, title, type, reports_to, duty, policy) {
  return { id: roleId, title, type, reports_to, responsibilities: [duty, LAYOUT], policy };
}

export async function baseDef({ inputs, workspace, root, contender, arm }) {
  if (contender === 'single')
    throw new Error('parallel-sweep-3 has no single arm (measured in parallel-sweep-2)');
  if (workspace.startsWith(`${EVAL_DIR}/`))
    throw new Error(`the trial must live outside ${EVAL_DIR}, which every role is denied reading`);
  const treatment = arm === 'treatment';
  const corpus = join(workspace, 'corpus');
  const outOf = (m) => join(workspace, 'out', m);
  const goal =
    'Answer 32 modules of call-chain questions by reading code, and the six cross-module questions, before the 720 s deadline; each sheet as soon as its module is done.';
  const resp = ARM(treatment ? 'treatment' : 'baseline').responsibilities;
  const hideFromAll = [
    join(inputs, 'truth.json'),
    EVAL_DIR,
    PILOT_DOCS_DIR,
    // the store, its event log (which records the faults) and the trial record (which holds the fault plan)
    ...(treatment ? [join(root, 'pilot-state'), join(root, 'trial.json')] : []),
  ];
  const roles = [
    role('lead', 'Lead', 'boss', null, resp.lead, {
      fileWrite: [],
      git: 'read',
      sandbox: { denyWrite: [workspace] },
    }),
    ...Object.entries(OWNS).map(([w, mods]) =>
      role(w, `Worker ${w.at(-1)}`, 'specialist', 'lead', resp[w], {
        fileWrite: mods.map((m) => `out/${m}/**`),
        git: 'read',
        sandbox: { denyWrite: [corpus, ...MODULES.filter((m) => !mods.includes(m)).map(outOf)] },
      }),
    ),
    role('synthesiser', 'Synthesiser', 'specialist', 'lead', resp.synthesiser, {
      fileWrite: ['out/synthesis.json'],
      git: 'read',
      sandbox: {
        denyWrite: [corpus, ...MODULES.map(outOf)],
        // the hand-off layer is its only path to the sheets (the module directories read as empty)
        ...(treatment ? { denyRead: MODULES.map(outOf) } : {}),
      },
    }),
  ];
  return {
    task: treatment ? TASK_DOCUMENTS : TASK,
    allocationUsd: ALLOCATION_USD,
    orgStopUsd: ORG_STOP_USD,
    sessionCap: SESSION_CAP,
    deadlineSeconds: DEADLINE_SECONDS,
    noExec: true,
    denyRead: hideFromAll,
    def: { name: id, goal, run_config: { max_concurrent_agents: MAX_CONCURRENT_AGENTS }, roles },
    caps: CAPS,
  };
}

/** The parallel-sweep-2 check (33 units, the files present when the run ends) plus, for a trial with a
 *  hand-off store, the decision measures (handoff-metrics.mjs) under `handoff`; check.mjs writes both to units.json. */
export async function check(ctx) {
  const units = await sweep2Check(ctx);
  units.handoff = ctx.root
    ? handoffMetrics({ root: ctx.root, truth: readJson(join(ctx.inputs, 'truth.json')) })
    : { present: false };
  return units;
}
