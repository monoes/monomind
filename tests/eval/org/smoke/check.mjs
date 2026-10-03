#!/usr/bin/env node
// Runs a scenario's machine checks on a finished trial root and writes units.json:
// one entry per manifest unit instance, {unit, accepted, evidence}. A unit the kit
// cannot decide by machine is reported accepted:null for blind review, never guessed.
// Usage: check.mjs <trial root>
import { join, resolve } from 'node:path';
import { readJson, writeJson } from './lib.mjs';
import { loadKit } from './prepare.mjs';

export async function checkTrial(root) {
  root = resolve(root);
  const trial = readJson(join(root, 'trial.json'));
  const kit = await loadKit(trial.scenario);
  const units = await kit.check({
    root,
    workspace: join(root, 'workspace'),
    inputs: trial.guard[0],
    trial,
  });
  writeJson(join(root, 'units.json'), {
    scenario: trial.scenario,
    contender: trial.contender,
    units,
    // a kit that counts delivered units (parallel-sweep-2) also leaves its count and summary on the array
    ...(units.delivered === undefined
      ? {}
      : { delivered: units.delivered, total: units.total, summary: units.summary }),
    // a kit that measures a hand-off (parallel-sweep-3) leaves its decision metrics on the array too
    ...(units.handoff === undefined ? {} : { handoff: units.handoff }),
  });
  return units;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const units = await checkTrial(process.argv[2]);
  console.log(JSON.stringify(units, null, 2));
}
