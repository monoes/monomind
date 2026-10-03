// The parallel-sweep-2 smoke kit (approved staged plan, manifest parallel-sweep-2.json, fixture
// fixtures/parallel-sweep-2): 32 independent modules of call-chain questions plus a cross-module synthesis
// under a 600 s wall deadline, answered by reading code. 33 units. The task text, the roster and the arms come
// from fixtures/parallel-sweep-2/fixture.json; the corpus comes from parallel-sweep's generator with
// --modules 32; the scorer is fixtures/parallel-sweep-2/score.mjs.
//
// Arms: single (one role, the whole task, the same deadline), baseline (lead + 8 workers owning 4 modules each +
// synthesiser = 10 roles) and treatment (baseline plus the hand-off prototype, one contract per worker, set up by
// pilot/prepare.ts from pilot/parallel-sweep-2.pilot.json). Every arm's roles write out/<module>/answers.json;
// the scorer reads those files, never the hand-off documents.
//
// No role of any arm can run node or any interpreter, and none can write the real $HOME (owner decisions
// 2026-10-03): the kit sets `noExec`, which prepare.mjs turns into the denial (applyNoExec) on every role.
// The hidden truth file and both fixture directories (scorer, generator) are denyRead on every role.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from '../../lib.mjs';

export const id = 'parallel-sweep-2';

const dirOf = (rel) => fileURLToPath(new URL(rel, import.meta.url)).replace(/\/$/, '');
const fixtureDir = dirOf('../../../fixtures/parallel-sweep-2/');
/** The generator and the module-list-agnostic parts of the scorer live in parallel-sweep's directory. */
const generatorDir = dirOf('../../../fixtures/parallel-sweep/');
const fixture = readJson(join(fixtureDir, 'fixture.json')).fixture;
export const MODULE_COUNT = 32;
export const MODULES = Array.from({ length: MODULE_COUNT }, (_, i) => `m${i + 1}`);
export const UNIT_COUNT = MODULE_COUNT + 1;
/** Worker ownership, as in the fixture's task text and the pilot manifest's contracts: worker k owns m(4k-3)..m(4k). */
export const OWNS = Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => [`worker-${i + 1}`, MODULES.slice(4 * i, 4 * i + 4)]),
);
const ARM = (arm) => fixture.arms.find((a) => a.id === arm);

/** Per-role USD soft stops, in Haiku-price units: on the production profile prepare.mjs scales them by
 *  the model price ratio (PRICE_SCALE, 2 for Sonnet 5.5), so a cap keeps its token room.
 *
 *  Arithmetic (harness dollars, production profile). The parallel-sweep trio measured the team arms at about
 *  $0.72-0.79 per module plus about $1 fixed, of which the workers are 88%: about $0.60 a module for a worker
 *  and about $2.4 for four modules, plus its own tooling set-up. The old caps were $2.8 for a worker with two
 *  modules (1.4 x 2) against $0.96-2.40 spent. With four modules a worker needs about $2.4-3.0; the cap is
 *  3.4 ($1.7 x 2), about 25% above the middle of that and enough to finish all four. The lead assigns and
 *  reports to 9 roles: $1.0 (0.5 x 2). The synthesiser reads 8 documents (or 32 small sheets) and answers
 *  six questions: $1.2 (0.6 x 2). Sum on production: 8 x 3.4 + 1.0 + 1.2 = $29.4, under the $30 org-wide stop,
 *  so the stop is a backstop, not the usual limiter, and the caps cannot add up past it. The expected team
 *  cost from the trio's rates is $25-27 (high case $36-38, which the per-role caps cut off earlier: a role
 *  stopped at its cap leaves its modules undelivered, which is itself a result). */
export const CAPS = {
  lead: 0.5,
  'worker-1': 1.7,
  'worker-2': 1.7,
  'worker-3': 1.7,
  'worker-4': 1.7,
  'worker-5': 1.7,
  'worker-6': 1.7,
  'worker-7': 1.7,
  'worker-8': 1.7,
  synthesiser: 0.6,
};
/** The single arm's one role: on any profile it may spend up to the org-wide stop (prepare.mjs); the
 *  600 s deadline (about $4.5, $7 high, from the trio's per-module rate) cuts it long before. */
export const SOLO_CAPS = { solver: 30 };

export const ALLOCATION_USD = fixture.planning_allocation_usd_per_run;
export const ORG_STOP_USD = fixture.org_stop_usd;
export const DEADLINE_SECONDS = fixture.wall_deadline_seconds;
/** The runtime runs at most max_concurrent_agents roles at once (default 4) and queues the rest; the
 *  previous dry run showed the queueing. Every one of the 10 roles gets a slot. */
export const MAX_CONCURRENT_AGENTS = 10;

/** The session cap counts every token a response carries, cache reads included. A worker reads four
 *  modules (about 105k tokens of corpus) and re-reads its context on each model call (about 100-200k tokens
 *  a call by the end); 16M is some 100-160 calls before a session rotates, twice the parallel-sweep worker
 *  cap for twice the modules, so a worker normally finishes in one session, and a looping role is still
 *  bounded (and the USD cap bounds it first). An assumption to calibrate, not a measurement. */
export const SESSION_CAP = { tokens: 16_000_000 };
/** The single role carries all 32 modules (about 880k tokens of corpus, which it will not hold at once; the SDK
 *  may compact its context) in a 600 s window: at most some 150-200 calls of up to about 500k tokens each,
 *  so 96M (6x a worker) is a safety valve that never rotates the one role mid-run, which would make the null
 *  hypothesis re-read the corpus for no reason but the cap. An assumption to calibrate in stage 1. */
export const SOLO_SESSION_CAP = { tokens: 6 * SESSION_CAP.tokens };

const COMMON = fixture.tasks.common;
export const TASK = `${COMMON} ${fixture.tasks.multi_role}`;
/** The single-agent arm (the null hypothesis, spec R18): one role does the whole task alone. */
export const SOLO_TASK = `${COMMON} ${fixture.tasks.single}`;

/** `<dir>/workspace` holds corpus/ (read-only to every role) and an empty out/<module>/ per module; the
 *  truth is `<dir>/truth.json`, beside the workspace, never in it. */
export async function buildInputs({ dir }) {
  const workspace = join(dir, 'workspace');
  mkdirSync(workspace, { recursive: true });
  execFileSync(
    process.execPath,
    [
      join(generatorDir, 'build-corpus.mjs'),
      join(workspace, 'corpus'),
      '--truth',
      join(dir, 'truth.json'),
      '--modules',
      String(MODULE_COUNT),
    ],
    { encoding: 'utf8' },
  );
  for (const m of MODULES) mkdirSync(join(workspace, 'out', m), { recursive: true });
  writeJson(join(dir, 'meta.json'), { fixture: id, pinnedHash: fixture.pinned_hash });
}

const LAYOUT =
  'Workspace: corpus/ is read-only (never edit it); deliverables go under out/ (out/<module>/answers.json, out/synthesis.json).';

function role(roleId, title, type, reports_to, duty, policy) {
  return { id: roleId, title, type, reports_to, responsibilities: [duty, LAYOUT], policy };
}

export async function baseDef({ inputs, workspace, contender }) {
  const corpus = join(workspace, 'corpus');
  const outOf = (m) => join(workspace, 'out', m);
  const truth = join(inputs, 'truth.json');
  const goal =
    'Answer 32 modules of call-chain questions by reading code, and the six cross-module questions, before the 600 s deadline; each sheet as soon as its module is done.';
  const common = {
    task: contender === 'single' ? SOLO_TASK : TASK,
    allocationUsd: ALLOCATION_USD,
    orgStopUsd: ORG_STOP_USD,
    sessionCap: contender === 'single' ? SOLO_SESSION_CAP : SESSION_CAP,
    deadlineSeconds: DEADLINE_SECONDS,
    noExec: true,
    // The answers are hidden from every role's shell, and so are the fixture's own directory and the
    // generator's (the scorer and the generator); the file tools cannot reach either: they stop at the trial root.
    denyRead: [truth, fixtureDir, generatorDir],
  };
  if (contender === 'single') {
    const solver = role('solver', 'Solver', 'boss', null, ARM('single').responsibilities.solver, {
      fileWrite: ['out/**'],
      git: 'read',
      sandbox: { denyWrite: [corpus] },
    });
    return { ...common, def: { name: id, goal, roles: [solver] }, caps: SOLO_CAPS };
  }
  const resp = ARM('baseline').responsibilities;
  const roles = [
    // The lead coordinates and answers nothing: it writes nothing anywhere in the workspace.
    role('lead', 'Lead', 'boss', null, resp.lead, {
      fileWrite: [],
      git: 'read',
      sandbox: { denyWrite: [workspace] },
    }),
    ...Object.entries(OWNS).map(([w, mods]) =>
      role(w, `Worker ${w.at(-1)}`, 'specialist', 'lead', resp[w], {
        fileWrite: mods.map((m) => `out/${m}/**`),
        git: 'read',
        // Bash can write only the worker's own modules' sheets (the other modules' out/ directories and
        // the corpus are read-only to its shell; out/synthesis.json is the synthesiser's and is held
        // by the file-tool scope, since a file that does not exist yet cannot be bound read-only).
        sandbox: { denyWrite: [corpus, ...MODULES.filter((m) => !mods.includes(m)).map(outOf)] },
      }),
    ),
    role('synthesiser', 'Synthesiser', 'specialist', 'lead', resp.synthesiser, {
      fileWrite: ['out/synthesis.json'],
      git: 'read',
      sandbox: { denyWrite: [corpus, ...MODULES.map(outOf)] },
    }),
  ];
  return {
    ...common,
    def: { name: id, goal, run_config: { max_concurrent_agents: MAX_CONCURRENT_AGENTS }, roles },
    caps: CAPS,
  };
}

// ---- check ---------------------------------------------------------------

/** Machine verdict per unit, from the fixture's scorer, over the files present when the run ends (the trial
 *  is cut at the deadline: a unit whose file was not written counts as not delivered): 32 module sheets
 *  (accepted at 11 of 12 exact, with evidence.exact for 12 of 12) and the synthesis (6 of 6). `critical`
 *  (fabricated answers, sheets copied between modules) rides on the unit it concerns (evidence.critical)
 *  and on the array's own `critical` property; the array also carries `delivered` (accepted units of
 *  `total` = 33) and `summary` (accepted, exact sheets, sheets written at all, synthesis accepted). */
export async function check({ workspace, inputs }) {
  const { checkDeliverables, summarize } = await import(join(fixtureDir, 'score.mjs'));
  const truth = readJson(join(inputs, 'truth.json'));
  const { units, critical } = checkDeliverables(join(workspace, 'out'), truth);
  const concerns = (u, line) =>
    u.module ? new RegExp(`\\b${u.module}\\b`).test(line) : line.startsWith('synthesis');
  const out = units.map((u) => ({
    unit: u.unit,
    accepted: u.accepted,
    evidence: {
      ...(u.module ? { module: u.module } : {}),
      ...u.evidence,
      critical: critical.filter((c) => concerns(u, c)),
    },
  }));
  const summary = summarize(units);
  out.critical = critical;
  out.delivered = summary.accepted;
  out.total = summary.total;
  out.summary = summary;
  return out;
}
