#!/usr/bin/env node
// Smoke tier trial preparation (org sections spec 10).
//
//   prepare.mjs inputs --scenario <id> --base <dir>
//     Builds the scenario's immutable inputs once, read-only, under <base>/inputs/<id>.
//   prepare.mjs trial --scenario <id> --base <dir> --contender current-best|phase2 --trial <n>
//     Builds one isolated trial root: the kit's base definition, the contender's
//     configuration, the scenario's runner plan (lib.mjs RUNNER_PLANS), per-role soft caps, a private workspace and
//     the guard directories run-trial.sh fingerprints before and after.
import { chmodSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  applyCaps,
  applyContender,
  applyModel,
  effectiveDiff,
  isolate,
  newRoot,
  PRICE_SCALE,
  resolvePlan,
  runnersOf,
  SOLO,
  trialName,
  writeJson,
} from './lib.mjs';
import { applyNoExec, noExecProblems } from './no-exec.mjs';

function makeReadOnly(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) makeReadOnly(p);
    else if (e.isFile()) chmodSync(p, statSync(p).mode & 0o555);
  }
  chmodSync(dir, statSync(dir).mode & 0o555);
}

export async function loadKit(scenario) {
  const file = fileURLToPath(new URL(`./scenarios/${scenario}/kit.mjs`, import.meta.url));
  if (!existsSync(file)) throw new Error(`no kit for scenario "${scenario}"`);
  return import(file);
}

/** A kit's optional org-wide USD stop for run-trial.sh's spend watcher; undefined when absent. */
export function orgStopUsdOf(spec) {
  const v = spec.orgStopUsd;
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !(v > 0))
    throw new Error(`orgStopUsd must be a positive number, got ${v}`);
  return v;
}

export async function buildInputs({ scenario, base }) {
  const kit = await loadKit(scenario);
  const dir = join(resolve(base), 'inputs', scenario);
  if (existsSync(dir)) throw new Error(`${dir} exists; inputs are immutable, use a new --base`);
  await kit.buildInputs({ dir });
  makeReadOnly(dir);
  return dir;
}

/** A declared deadline variant: the kit's deadline replaced by `seconds`, in the wording the role reads too
 *  ("600 seconds (ten minutes)", "600 s"); refuses a text that still names the old deadline afterwards. */
const MINUTE_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];
function retime(text, from, to) {
  const min = to / 60;
  const words = Number.isInteger(min) ? (MINUTE_WORDS[min] ?? String(min)) : null;
  if (!words) throw new Error(`a deadline of ${to} s is not a whole number of minutes`);
  const out = text
    .replace(
      new RegExp(`\\b${from} seconds \\(\\w+ minutes\\)`, 'g'),
      `${to} seconds (${words} minutes)`,
    )
    .replace(new RegExp(`\\b${from} s\\b`, 'g'), `${to} s`);
  if (new RegExp(`\\b${from}\\b`).test(out))
    throw new Error(`the text still names ${from} after the retime`);
  return out;
}

export async function prepareTrial({
  scenario,
  base,
  contender,
  trial = '1',
  profile = 'haiku',
  deadlineSeconds,
  arm,
  variant,
}) {
  const kit = await loadKit(scenario);
  base = resolve(base);
  const inputs = join(base, 'inputs', scenario);
  if (!existsSync(inputs)) throw new Error(`no inputs at ${inputs}; run "inputs" first`);
  const name = trialName(scenario, contender, trial);
  const root = newRoot(base, name);
  const workspace = join(root, 'workspace');
  cpSync(join(inputs, 'workspace'), workspace, { recursive: true, mode: 0 });
  for (const d of [workspace])
    await import('node:child_process').then((c) => c.execFileSync('chmod', ['-R', 'u+w', d]));
  const spec = await kit.baseDef({ inputs, workspace, root, contender, arm, variant });
  if (deadlineSeconds && deadlineSeconds !== spec.deadlineSeconds) {
    const from = spec.deadlineSeconds;
    spec.task = retime(spec.task, from, deadlineSeconds);
    spec.def = { ...spec.def, goal: retime(spec.def.goal, from, deadlineSeconds) };
    spec.deadlineSeconds = deadlineSeconds;
  }
  // Declared change deadline-seconds-in-trials: the run's own deadline goes into the definition, so the runtime caps
  // a role's Bash call to a fraction of the time left (run_config.deadline_seconds). Set on the base definition, so
  // every contender and the 'current-best' comparison copy carry the same value and effectiveDiff is unchanged.
  if (spec.deadlineSeconds)
    spec.def = {
      ...spec.def,
      run_config: { ...(spec.def.run_config ?? {}), deadline_seconds: spec.deadlineSeconds },
    };
  const plan = resolvePlan(scenario, profile);
  let def = applyContender(spec.def, contender, { sessionCap: spec.sessionCap });
  def = applyModel(def, plan);
  // Per-role USD caps follow the model's price on the production profile; the single arm's one role
  // may spend up to the org-wide stop (or the allocation), the same ceiling the whole org has.
  const scale = plan.claudeModel ? PRICE_SCALE[profile] : 1;
  const caps =
    contender === SOLO
      ? { [def.roles[0].id]: spec.orgStopUsd ?? spec.allocationUsd }
      : Object.fromEntries(Object.entries(spec.caps).map(([r, usd]) => [r, usd * scale]));
  def = applyCaps(def, caps, spec.allocationUsd, { orgStopUsd: spec.orgStopUsd });
  // A kit that sets noExec gets the no-code-execution denial on every role of every arm.
  const noExec = (d) => (spec.noExec ? applyNoExec(d, { denyRead: spec.denyRead }) : d);
  def = isolate(noExec(def), { name, workspace, denyWrite: [inputs, ...(spec.denyWrite ?? [])] });
  if (spec.noExec) {
    const problems = noExecProblems(def);
    if (problems.length) throw new Error(`no-exec denial incomplete: ${problems.join('; ')}`);
  }
  const plain = isolate(
    noExec(
      applyCaps(
        applyModel(applyContender(spec.def, 'current-best'), plan),
        Object.fromEntries(Object.entries(spec.caps).map(([r, usd]) => [r, usd * scale])),
        spec.allocationUsd,
        { orgStopUsd: spec.orgStopUsd },
      ),
    ),
    { name, workspace, denyWrite: [inputs, ...(spec.denyWrite ?? [])] },
  );
  writeJson(join(root, '.monomind/orgs', `${name}.json`), def);
  writeJson(join(root, 'trial.json'), {
    name,
    scenario,
    contender,
    trial,
    profile,
    runners: runnersOf(def),
    task: spec.task,
    guard: [inputs, ...(spec.extraGuard ?? [])],
    driver: spec.driver ?? null,
    noExec: spec.noExec ? true : undefined,
    deadlineSeconds: spec.deadlineSeconds,
    allocationUsd: spec.allocationUsd,
    orgStopUsd: orgStopUsdOf(spec),
    effectiveDiffFromCurrentBest: effectiveDiff(plain, def),
    preparedAt: new Date().toISOString(),
  });
  return root;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values: a } = parseArgs({
    args: rest,
    options: {
      scenario: { type: 'string' },
      base: { type: 'string' },
      contender: { type: 'string' },
      trial: { type: 'string' },
      profile: { type: 'string' },
    },
  });
  if (!a.scenario || !a.base) throw new Error('--scenario and --base are required');
  if (cmd === 'inputs') console.log(await buildInputs(a));
  else if (cmd === 'trial') console.log(await prepareTrial(a));
  else {
    console.error(
      'usage: prepare.mjs inputs|trial --scenario <id> --base <dir> [--contender c --trial n --profile haiku|production]',
    );
    process.exit(2);
  }
}
