// tests/eval/org/pilot/prepare.ts
//
// One pilot trial (org sections spec 9.2): the smoke tier's phase2 trial of a scenario, which is
// Phase 2 without sections, in one of two arms.
//   baseline:  nothing added.
//   treatment: the same org definition plus the hand-off prototype: a placeholder tool provider and a
//              line of responsibilities on each sectioned role (pilotOrgDef), and, at run time, the
//              prototype's tools and the cross-section send refusal on that one daemon (run-org.ts).
// Either way the trial is isolated like a smoke trial and runs through the same in-process runner with
// native children disabled. The trial id says the arm: p<n>b or p<n>t.
//   npx tsx tests/eval/org/pilot/prepare.ts <scenario> <base dir> <baseline|treatment> <n>
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain .mjs module
import { prepareTrial } from '../smoke/prepare.mjs';
import { type PilotTrial, pilotOrgDef } from './harness.js';

const here = dirname(fileURLToPath(import.meta.url));
export type Arm = 'baseline' | 'treatment' | 'single';
const SUFFIX: Record<Arm, string> = { baseline: 'b', treatment: 't', single: 's' };

export async function preparePilotTrial(o: {
  scenario: string;
  base: string;
  arm: Arm;
  n: number;
  /** The nth redo of an interrupted trial of this arm and number: a new trial id, flagged in its record. */
  redo?: number;
  /** A per-trial profile, which the pilot manifest must list in `profiles`; its default is `profile`.
   *  A trial on a non-default profile carries an S marker in its id (p1bS), so ids stay unique. */
  profile?: string;
}): Promise<string> {
  const cfg = JSON.parse(readFileSync(join(here, `${o.scenario}.pilot.json`), 'utf8'));
  if (!cfg.arms.some((a: { id: string }) => a.id === o.arm))
    throw new Error(`the pilot manifest of ${o.scenario} does not list the arm "${o.arm}"`);
  const defaultProfile: string = cfg.profile ?? 'haiku';
  const profile = o.profile ?? defaultProfile;
  if (profile !== defaultProfile && !(cfg.profiles ?? []).includes(profile))
    throw new Error(`the pilot manifest of ${o.scenario} does not list the profile "${profile}"`);
  const root: string = await prepareTrial({
    scenario: o.scenario,
    base: o.base,
    // the single arm is the Phase 2 configuration with the root role alone; the other arms are Phase 2 as is
    contender: o.arm === 'single' ? 'single' : 'phase2',
    trial: `p${o.n}${SUFFIX[o.arm]}${profile === defaultProfile ? '' : 'S'}${o.redo ? `r${o.redo}` : ''}`,
    profile,
  });
  const trialFile = join(root, 'trial.json');
  const trial = JSON.parse(readFileSync(trialFile, 'utf8'));
  const pilot: PilotTrial = {
    runId: randomBytes(12).toString('hex'),
    dir: join(root, 'pilot-state'),
    routing: cfg.routing,
    contracts: cfg.contracts,
  };
  if (o.arm === 'treatment') {
    const orgFile = join(root, '.monomind/orgs', `${trial.name}.json`);
    writeFileSync(
      orgFile,
      `${JSON.stringify(pilotOrgDef(JSON.parse(readFileSync(orgFile, 'utf8')), pilot), null, 2)}\n`,
    );
  }
  trial.pilot = {
    id: cfg.id,
    arm: o.arm,
    ...(o.redo ? { redo: o.redo, redoOf: trial.name.replace(/r\d+$/, '') } : {}),
    nativeChildren: cfg.native_children,
    writerAuthority: cfg.writer_authority,
    ...pilot,
  };
  writeFileSync(trialFile, `${JSON.stringify(trial, null, 2)}\n`);
  return root;
}

if (process.argv[1]?.endsWith('pilot/prepare.ts')) {
  const [scenario, base, arm, n, redo, profile] = process.argv.slice(2);
  console.log(
    await preparePilotTrial({
      scenario,
      base,
      arm: arm as Arm,
      n: Number(n),
      ...(Number(redo) ? { redo: Number(redo) } : {}),
      ...(profile ? { profile } : {}),
    }),
  );
}
