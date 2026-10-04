// packages/@monomind/cli/__tests__/orgrt/documents/phase4-guidance-fingerprints.test.ts
//
// Org sections P4.11: the role text for the Phase 4 keys, through a real OrgDaemon and a scripted runner (no model).
// This is the new-fingerprint file of 13.2: the P3.12 pins (sections-on-fingerprints.test.ts, the tool lists) and the
// P4.0 pins (phase4-inert-pins.test.ts) are not touched, and this file proves it by running a Phase 3 sections-on org
// next to them and comparing its prompts with the P3.12 text byte for byte.
//
// What is pinned: the system prompt of every role of five synthetic orgs, one per Phase 4 key set (writer, budget,
// rework, loop, all four), in fixtures/phase4/prompts-phase4.json (normalised like the P3.0 goldens), and the sha256
// of each prompt below. The orgs are in support/phase4-guidance-defs.ts. An org that sets a Phase 4 key starts a new
// prompt prefix, so this is the one cache miss that org pays; an org without a key pays none.
//
// Deliberate recapture, only for an intentional change to the Phase 4 role text (guidance-phase4.ts):
//   PHASE4_GUIDANCE_RECAPTURE=P4.11 npx vitest run __tests__/orgrt/documents/phase4-guidance-fingerprints.test.ts
// rewrites the fixture and prints the new shas; re-pin PROMPT_SHAS below in the same commit, with the reason, and
// review the fixture diff line by line. Any other value is ignored. The P3.12 variable (SECTIONS_ON_GOLDEN_UPDATE)
// and the P4.0 one (PHASE4_INERT_GOLDEN_UPDATE) are not used here.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { documentGuidance } from '../../../src/orgrt/documents/guidance.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { findingsOrg } from '../support/doc-defs.js';
import { CaptureRunner } from '../support/doc-runner.js';
import { normalizeString } from '../support/normalize-golden.js';
import { KEY_SETS, ROLES, baseOf, phase4Org } from '../support/phase4-guidance-defs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'fixtures', 'phase4', 'prompts-phase4.json');
const P312_PROMPTS = join(HERE, '..', 'fixtures', 'sections-on', 'prompts.json');
const RECAPTURE = process.env.PHASE4_GUIDANCE_RECAPTURE === 'P4.11';
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const README =
  'Phase 4 role text (org sections P4.11): the system prompt each role of five synthetic orgs is started with, one org per Phase 4 key set, captured through a real OrgDaemon and a scripted runner. Recapture only with PHASE4_GUIDANCE_RECAPTURE=P4.11 (see phase4-guidance-fingerprints.test.ts); review the diff line by line.';

const SETS = ['writer', 'budget', 'rework', 'loop', 'all'] as const;
// Captured when P4.11 landed. One per role of each key set.
const PROMPT_SHAS: Record<string, string> = {
  'writer/boss': '50bfd18248aa50c2050269da0fb28d62a2d7a315080d1f7774828be998f7da21',
  'writer/dev-lead': 'f200aee7991b7c13d834f0e6e40a2feac406f058de3ee3739a81fe8f6953ae49',
  'writer/coder': '165052470299ec735a644a7eded74148ac2bf2c1251a315508daa126ece4e12e',
  'writer/qa-lead': '86a3c8d5b8f446e47208f6a4291710cc73f34c6071cd5f7983ce26106d64e9b4',
  'writer/observer': '1cf6a7e8b9708a3031a20e3b1065cc1d29024acf5f65464e8e2bdadfb7f048c2',
  'budget/boss': '9ae2764ba0196bd20dcce0247e90c9e26b1c5f86c80451a563b5eeed970c0cbf',
  'budget/dev-lead': '9136a22b83f456033a7fe4690646541d6c0cbc1ac51d02902f63fced6f02f9ac',
  'budget/coder': '58f0aeafadf58e4573ccf4e95e05751e7fe00284c7f8f645ce0b096c99b5b83e',
  'budget/qa-lead': '294e9e800a4bb0cadb036c1a3228bff272b3026f53de65161c7bfab469e7f725',
  'budget/observer': '57bcc8e4b0a8d898c3d32d7e99ca7b1ea9a401c8b0e8ae7c78a96233ecb6e658',
  'rework/boss': 'b456c0e4c09925d863036df5837fee7e3637fa9ae73f3369d3c994700499e76c',
  'rework/dev-lead': '15fa8e888c2c2b6e64f6dd3f4ad8b25877e23df180c9abf8e045c11bbd722f69',
  'rework/coder': 'dae4143091978202bd97c19f540a503a7b6f1bd5e10e9a53283ace8905b01a95',
  'rework/qa-lead': 'cb99178e302e1250a1f6e92917d455a2bd75d21a4b8e98737fcf4f7cccf99638',
  'rework/observer': 'a914d5ba794b78574cf7fb6128f50c28bc36cfc94e78ad940ff8ee447227f7d5',
  'loop/boss': 'b456c0e4c09925d863036df5837fee7e3637fa9ae73f3369d3c994700499e76c',
  'loop/dev-lead': '447778fb768c4e5b644cd97ea8b9e1e847152f998b28ffda6156259e7b6a6eff',
  'loop/coder': 'c8c6ed8b4a3e0e023ecca5d64e46df428bbe033f537f6c0b9a153a4762413591',
  'loop/qa-lead': '103dfd7d3a4d843f1fc0d7ddcfc06f69646856e60ccee83a10874d631d482b80',
  'loop/observer': 'a914d5ba794b78574cf7fb6128f50c28bc36cfc94e78ad940ff8ee447227f7d5',
  'all/boss': '02f1364049555364bf0dac43fca68407d339d85e0881d8cf9e3e36486dbb6073',
  'all/dev-lead': 'f9d4cbf9519f9e0e4f38be1606d7f4ba060d73715878a37f9f87afb2092df51f',
  'all/coder': 'c660125c1ea03e23f106194834521286ac6d373794c6db4e851bd00bf6cecc91',
  'all/qa-lead': 'c9d8de60616516c95b3020002bd561dd4ac8e53cc3f11d1b88326dc794c5034d',
  'all/observer': '9be95c9eec00b7c34427c95222d2feee0942e104b5bac93d2eb4c6c1cecf1259',
};

let root: string;
const daemons: OrgDaemon[] = [];
const saved = { ...process.env };
beforeEach(() => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
});
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  if (root) rmSync(root, { recursive: true, force: true });
  for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

/** Start `raw` in a fresh org root and return the normalised system prompt of each of `roles`. */
async function promptsOf(raw: Record<string, any>, roles: readonly string[], evalGate = true): Promise<Record<string, string>> {
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'phase4-guidance-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const runner = new CaptureRunner();
  const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  daemons.push(d);
  await d.startOrg(raw.name, undefined, evalGate ? { evalGate: true } : {});
  const out: Record<string, string> = {};
  for (const r of roles) {
    await runner.toolsOf(d, raw.name, r);
    out[r] = normalizeString(runner.systemPrompts.get(r) as string, { roots: [root] });
  }
  await d.stopAll();
  rmSync(root, { recursive: true, force: true });
  return out;
}

/** The synthetic org of a key set, under one org name so only the keys differ between sets. */
const orgOf = (set: string): Record<string, any> => ({ ...phase4Org(KEY_SETS[set]), name: 'p4-org' });
const blockOf = (set: string, role: string): string => documentGuidance(OrgDefSchema.parse(orgOf(set)), role) as string;

async function allPrompts(): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = { none: await promptsOf(orgOf('none'), ROLES) };
  for (const set of SETS) out[set] = await promptsOf(orgOf(set), ROLES);
  return out;
}

describe('Phase 4 system prompts (real daemon, scripted runner)', () => {
  it('the prompt of every role of every key set is pinned by text and by sha', async () => {
    const got = await allPrompts();
    const fixture: Record<string, unknown> = { _readme: README };
    for (const set of SETS) fixture[set] = got[set];
    if (RECAPTURE) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
      const shas = Object.fromEntries(SETS.flatMap((s) => ROLES.map((r) => [`${s}/${r}`, sha(got[s][r])])));
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(shas, null, 2));
      return;
    }
    if (!existsSync(FIXTURE)) throw new Error('phase4 prompts fixture is missing; fixtures are committed');
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    for (const set of SETS) for (const r of ROLES) expect(sha(got[set][r]), `${set}/${r}`).toBe(PROMPT_SHAS[`${set}/${r}`]);
  });

  it('the lines reach the right roles and only them: a role with nothing to be told starts with the bytes it had', async () => {
    const got = await allPrompts();
    const told: Record<string, string[]> = {
      writer: ROLES,
      budget: ROLES,
      rework: ['boss', 'dev-lead', 'coder', 'qa-lead'],
      loop: ['boss', 'dev-lead', 'coder', 'qa-lead'],
      all: ROLES,
    };
    for (const set of SETS)
      for (const r of ROLES) {
        const block = blockOf(set, r);
        expect(got[set][r], `${set}/${r}`).toContain(block);
        // A role is told something exactly when its block differs from the block of the same topology without keys.
        expect(block !== blockOf(baseOf(set), r), `${set}/${r}`).toBe(told[set].includes(r));
        // Without a loop the topology is the keyless org's: the only difference is the added lines, nothing else moved.
        if (baseOf(set) === 'none') expect(got[set][r].replace(block, blockOf('none', r)), `${set}/${r}`).toBe(got.none[r]);
      }
    // Roles outside every key's reach keep their exact prompt.
    expect(got.rework.observer).toBe(got.none.observer);
    expect(got.loop.observer).toBe(got.none.observer);
  });

  it('a Phase 3 sections-on org with no Phase 4 key starts with the P3.12 prompts, byte for byte', async () => {
    const p312 = JSON.parse(readFileSync(P312_PROMPTS, 'utf8')) as Record<string, string>;
    const got = await promptsOf(findingsOrg(), Object.keys(p312));
    expect(got).toEqual(p312);
    for (const r of Object.keys(p312)) expect(sha(got[r]), r).toBe(sha(p312[r]));
  });

  it('the prompts of an org without sections carry none of it, with every key present', async () => {
    const { sections, documents, requires, loops, ...rest } = orgOf('all');
    const { experimental, completion, budget_usd, ...runConfig } = rest.run_config;
    const got = await promptsOf({ ...rest, run_config: runConfig }, ROLES, false);
    for (const r of ROLES) {
      expect(got[r], r).not.toContain('Documents between sections');
      expect(got[r], r).not.toMatch(/Rework cap|Loop with|USD allocation|only writer|owns writes|As section lead/);
    }
  });
});
