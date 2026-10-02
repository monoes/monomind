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

export async function buildInputs({ scenario, base }) {
  const kit = await loadKit(scenario);
  const dir = join(resolve(base), 'inputs', scenario);
  if (existsSync(dir)) throw new Error(`${dir} exists; inputs are immutable, use a new --base`);
  await kit.buildInputs({ dir });
  makeReadOnly(dir);
  return dir;
}

export async function prepareTrial({ scenario, base, contender, trial = '1', profile = 'haiku' }) {
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
  const spec = await kit.baseDef({ inputs, workspace, root, contender });
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
  def = isolate(def, { name, workspace, denyWrite: [inputs, ...(spec.denyWrite ?? [])] });
  const plain = isolate(
    applyCaps(
      applyModel(applyContender(spec.def, 'current-best'), plan),
      Object.fromEntries(Object.entries(spec.caps).map(([r, usd]) => [r, usd * scale])),
      spec.allocationUsd,
      { orgStopUsd: spec.orgStopUsd },
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
    deadlineSeconds: spec.deadlineSeconds,
    allocationUsd: spec.allocationUsd,
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
