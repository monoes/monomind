// The parallel-sweep smoke kit (approved scenario, manifest parallel-sweep.json, fixture
// fixtures/parallel-sweep): eight independent modules of call-chain questions plus a cross-module
// synthesis under a 35-minute wall deadline, answered by reading code. The task text, the roster and
// the arms come from fixtures/parallel-sweep/fixture.json; the scorer is the fixture's own score.mjs.
//
// No role of any arm can run node or any interpreter (owner decision 2026-10-03): the kit sets `noExec`,
// which prepare.mjs turns into the denial on every role (smoke/no-exec.mjs). The hidden truth file
// is written outside the role-visible workspace, and hidden from every role's shell on top of that.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from '../../lib.mjs';

export const id = 'parallel-sweep';

const fixtureDir = fileURLToPath(
  new URL('../../../fixtures/parallel-sweep/', import.meta.url),
).replace(/\/$/, '');
const fixture = readJson(join(fixtureDir, 'fixture.json')).fixture;
const MODULES = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
/** Worker ownership, as in the fixture's task text and the pilot manifest's contracts. */
export const OWNS = {
  'worker-1': ['m1', 'm2'],
  'worker-2': ['m3', 'm4'],
  'worker-3': ['m5', 'm6'],
  'worker-4': ['m7', 'm8'],
};
const ARM = (arm) => fixture.arms.find((a) => a.id === arm);

/** Per-role USD soft stops, in Haiku-price units: on the production profile prepare.mjs scales them by
 *  the model price ratio (PRICE_SCALE, 2 for Sonnet 5.5), so a cap keeps its token room. A worker reads
 *  two modules (about 56k tokens of corpus, 132 chain reads); the lead only assigns and reports; the
 *  synthesiser reads eight small sheets. The sum on production ($14.2) is above the org-wide stop; the
 *  stop is the worst case, the caps stop a runaway role early. Sized from the round 2 measurements and
 *  this fixture's workload (see the cost estimate given with the pilot request). */
export const CAPS = {
  lead: 0.5,
  'worker-1': 1.4,
  'worker-2': 1.4,
  'worker-3': 1.4,
  'worker-4': 1.4,
  synthesiser: 1.0,
};
/** The single arm's one role: on any profile it may spend up to the org-wide stop (prepare.mjs). */
export const SOLO_CAPS = { solver: 12 };

export const ALLOCATION_USD = 12;
export const ORG_STOP_USD = 12;
export const DEADLINE_SECONDS = fixture.wall_deadline_minutes * 60;

/** The session cap counts every token a response carries, cache reads included. A role re-reads its
 *  whole context on each model call, and a worker's context is the 56k-token share of the corpus plus
 *  its own work (about 60-100k tokens a call); 8M is some 80-130 calls before a session rotates, so a
 *  worker normally finishes its two modules in one session, and a looping role is still bounded. An
 *  assumption to calibrate in the pilot, not a measurement. */
export const SESSION_CAP = { tokens: 8_000_000 };

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
      join(fixtureDir, 'build-corpus.mjs'),
      join(workspace, 'corpus'),
      '--truth',
      join(dir, 'truth.json'),
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
    'Answer eight modules of call-chain questions by reading code, and the six cross-module questions that need all eight, before the deadline.';
  const common = {
    task: contender === 'single' ? SOLO_TASK : TASK,
    allocationUsd: ALLOCATION_USD,
    orgStopUsd: ORG_STOP_USD,
    sessionCap: SESSION_CAP,
    deadlineSeconds: DEADLINE_SECONDS,
    noExec: true,
    // The answers are hidden from every role's shell, and so is the fixture's own directory (its scorer
    // and generator); the file tools cannot reach either: they stop at the trial root.
    denyRead: [truth, fixtureDir],
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
  // The runtime runs at most max_concurrent_agents roles at a time (default 4) and holds the rest until a
  // slot frees: with the default, worker-4 and the synthesiser would wait behind the lead and three workers
  // and the arm would not be parallel at all (found in the scripted dry run). Every role gets a slot.
  return {
    ...common,
    def: { name: id, goal, run_config: { max_concurrent_agents: roles.length }, roles },
    caps: CAPS,
  };
}

// ---- check ---------------------------------------------------------------

/** Machine verdict per unit, from the fixture's scorer: 8 module sheets (accepted at 11 of 12 exact) and
 *  the synthesis (6 of 6). `critical` (fabricated answers, sheets copied between modules) rides on the
 *  unit it concerns (evidence.critical) and on the array's own `critical` property. */
export async function check({ workspace, inputs }) {
  const { checkDeliverables } = await import(join(fixtureDir, 'score.mjs'));
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
  out.critical = critical;
  return out;
}
