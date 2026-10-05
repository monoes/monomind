// packages/@monomind/cli/__tests__/orgrt/documents/phase4-guidance-fingerprints.test.ts
//
// Org sections P4.11: the role text for the Phase 4 keys, through a real OrgDaemon and a scripted runner (no model).
// This is the new-fingerprint file of 13.2: the P3.12 pins (sections-on-fingerprints.test.ts, the tool lists) and the
// P4.0 pins (phase4-inert-pins.test.ts) are not touched, and this file proves it by running a Phase 3 sections-on org
// next to them and comparing its prompts with the P3.12 text byte for byte.
//
// What is pinned: the system prompt of every role of synthetic orgs, one per Phase 4 key set (writer, budget,
// rework, all three), in fixtures/phase4/prompts-phase4.json (normalised like the P3.0 goldens), and the sha256
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
import { KEY_SETS, ROLES, phase4Org } from '../support/phase4-guidance-defs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'fixtures', 'phase4', 'prompts-phase4.json');
const P312_PROMPTS = join(HERE, '..', 'fixtures', 'sections-on', 'prompts.json');
const RECAPTURE = process.env.PHASE4_GUIDANCE_RECAPTURE === 'P4.11';
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const README =
  'Phase 4 role text (org sections P4.11): the system prompt each role of five synthetic orgs is started with, one org per Phase 4 key set, captured through a real OrgDaemon and a scripted runner. Recapture only with PHASE4_GUIDANCE_RECAPTURE=P4.11 (see phase4-guidance-fingerprints.test.ts); review the diff line by line.';

const SETS = ['writer', 'budget', 'rework', 'all'] as const;
// Captured when P4.11 landed; re-captured by the sections-as-sub-orgs change (the `loop` set is gone, the observer is in
// section `watch` and is a lead, the budget sets give `watch` an allocation, the rework wording lost "loop"). One per role of each key set.
const PROMPT_SHAS: Record<string, string> = {
  'writer/boss': '50bfd18248aa50c2050269da0fb28d62a2d7a315080d1f7774828be998f7da21',
  'writer/dev-lead': '947b1ec119203066501ebeb1c6d9aecabc4f10e50dc362aab5062ac0748c0445',
  'writer/coder': '8b3c1795f1f6eae73e72b5efee047269f85215c89744e698ac89b4d40bae9591',
  'writer/qa-lead': '8efe9810522ed452f73dd2f5cec54e7977b654a2b25c308d70a13cc44023c049',
  'writer/observer': 'd3640b16ee860c926c74803d7b6ce20461ef640bcaf161b76b6822f29e27c44c',
  'budget/boss': 'dfe924dce6a11d42c1441762cd985c2940787ca687590a0cb9e25e8095fa6421',
  'budget/dev-lead': 'b10354fc3e6a3306d199b2ea11ab7bcb551fbd9a5917781ee4b27a6687995ae5',
  'budget/coder': '81e9c0710caf005891cefdf4279c1a761c48ab66a5928208d9f2eefc572ff9ae',
  'budget/qa-lead': 'a6f43c4d3390065f0bd2e41b6d0584fbb375126df42235ea3404192130236d70',
  'budget/observer': '221a2016a65dc07b9ec94081ca561b389e563102518b2dd0ee9170b7fbacf510',
  'rework/boss': '720cdb4b6c948ea064a049f8bd6efeba94f11d14103b6be281956366a7eb55de',
  'rework/dev-lead': '769489d4139ea472973e1bf55f73604c969f68f16ef67bdec0fab6110908bd95',
  'rework/coder': '1817dbab255e9bcbf18c543cbf9b128a7101d9ac75c6f631c9c5982e4ec366f0',
  'rework/qa-lead': '56f16248d0b27d744ae9e490f65b60b463454abadb365ecb32dcb085fc397e3f',
  'rework/observer': 'f991e353f0c9119d60ca20a76d8f04d001833b34b8240de3c521bedbfcd6b3d2',
  'all/boss': 'a484219cda6f2303711eb90d15ca1e4c4bf977aff97177cbcd76c7147a2d5909',
  'all/dev-lead': '73f960a413a754fa9607e17ac2d992f68d2611b8f1f1e9b1ca898cb4f2059425',
  'all/coder': 'b8c80e9692dfea0bc45dedd05f5c64ccf2c0b6856d97a2b464b5922103302a27',
  'all/qa-lead': '4ee507d5c1dae9295690b8f2ff0033c42e1910c3a9d0bf3084afc80f2ea863c5',
  'all/observer': '03d0dbcab2853198236b65d3481c4c05cde6c59a9ba79e3dc8fd7fc3f94e324c',
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
      rework: ROLES,
      all: ROLES,
    };
    for (const set of SETS)
      for (const r of ROLES) {
        const block = blockOf(set, r);
        expect(got[set][r], `${set}/${r}`).toContain(block);
        // A role is told something exactly when its block differs from the block of the keyless org.
        expect(block !== blockOf('none', r), `${set}/${r}`).toBe(told[set].includes(r));
        // The topology is the keyless org's: the only difference is the added lines, nothing else moved.
        expect(got[set][r].replace(block, blockOf('none', r)), `${set}/${r}`).toBe(got.none[r]);
      }
    // A role with no document to publish or decide is told only the lead rule of its own section (observer leads `watch`).
    expect(blockOf('rework', 'observer').slice(blockOf('none', 'observer').length + 1)).toMatch(/^As section lead/);
  });

  it('a Phase 3 sections-on org with no Phase 4 key starts with the P3.12 prompts, byte for byte', async () => {
    const p312 = JSON.parse(readFileSync(P312_PROMPTS, 'utf8')) as Record<string, string>;
    const got = await promptsOf(findingsOrg(), Object.keys(p312));
    expect(got).toEqual(p312);
    for (const r of Object.keys(p312)) expect(sha(got[r]), r).toBe(sha(p312[r]));
  });

  it('the prompts of an org without sections carry none of it, with every key present', async () => {
    const { sections, documents, requires, ...rest } = orgOf('all');
    const { experimental, completion, budget_usd, ...runConfig } = rest.run_config;
    const got = await promptsOf({ ...rest, run_config: runConfig }, ROLES, false);
    for (const r of ROLES) {
      expect(got[r], r).not.toContain('Documents between sections');
      expect(got[r], r).not.toMatch(/Rework cap|USD allocation|only writer|owns writes|As section lead/);
    }
  });
});
