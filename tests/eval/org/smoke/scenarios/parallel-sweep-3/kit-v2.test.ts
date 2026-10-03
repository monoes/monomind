// The parallel-sweep-3 variant v2 as the pilot prepares it (declared change handoff-relay-consistency-check): the same
// roster, caps, deadline and fault placements as the treatment arm, plus the producer relay, the deliverable contracts,
// doc_check and the evidence field, in its own trial id (p1t-v2); the plain treatment and the baseline are unchanged.
// No model is called.
// @ts-nocheck: plain .mjs modules and fixture scripts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyContractTemplate } from '../../../pilot/contract-template.js';
import { planFaults } from '../../../pilot/fault-injection.js';
import { preparePilotTrial } from '../../../pilot/prepare.js';
import { buildInputs as buildBase } from '../../prepare.mjs';
import { CAPS, id, TASK_DOCUMENTS, TASK_DOCUMENTS_V2 } from './kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const load = (p: string) => JSON.parse(readFileSync(join(here, p), 'utf8'));
const record = load('../../../fixtures/parallel-sweep-3/fixture.json').fixture;
const pilot = load('../../../pilot/parallel-sweep-3.pilot.json');
const variant = pilot.variants[0];

let tmp: string;
let base: string;
beforeAll(async () => {
  tmp = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'sweep3-v2-')));
  base = join(tmp, 'base');
  await buildBase({ scenario: id, base });
});
afterAll(() => {
  spawnSync('chmod', ['-R', 'u+w', tmp]);
  rmSync(tmp, { recursive: true, force: true });
});
const prepared: Record<string, any> = {};
const prep = async (arm: string, n: number, v?: string) => {
  const key = `${arm}${n}${v ?? ''}`;
  if (!prepared[key]) {
    const root = await preparePilotTrial({
      scenario: id,
      base,
      arm,
      n,
      ...(v ? { variant: v } : {}),
    });
    const t = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
    prepared[key] = {
      root,
      t,
      def: JSON.parse(readFileSync(join(root, '.monomind/orgs', `${t.name}.json`), 'utf8')),
    };
  }
  return prepared[key];
};

describe('the v2 text and duties', () => {
  it('is the v1 documents text with three changes: the relay, evidence with the file rule, doc_check; the common text and deadline are unchanged', () => {
    expect(TASK_DOCUMENTS_V2.startsWith(record.tasks.common)).toBe(true);
    expect(TASK_DOCUMENTS_V2).toMatch(/720 seconds \(twelve minutes\) of wall time/);
    expect(TASK_DOCUMENTS_V2).toMatch(/660 seconds/);
    expect(TASK_DOCUMENTS_V2).toMatch(/the relay sends the producing worker a message at once/);
    expect(TASK_DOCUMENTS_V2).toMatch(
      /neither the synthesiser nor the lead needs to relay anything/,
    );
    expect(TASK_DOCUMENTS_V2).not.toMatch(
      /the lead tells the producing worker|not notified automatically/,
    );
    expect(TASK_DOCUMENTS_V2).toMatch(/is not asked to relay rejections/);
    expect(TASK_DOCUMENTS_V2).toMatch(
      /A publish is refused, naming the file and the first field that differs/,
    );
    expect(TASK_DOCUMENTS_V2).toMatch(/without evidence/);
    expect(TASK_DOCUMENTS_V2).toMatch(
      /Worked example with made-up data.*"evidence":\[\{"file":"m99\/x\.mjs","in":7,"out":12345\}/,
    );
    expect(TASK_DOCUMENTS_V2).toMatch(/pilot__doc_check/);
    expect(TASK_DOCUMENTS_V2).toMatch(/necessary check, not a sufficient one/);
    expect(TASK_DOCUMENTS_V2).toMatch(
      /spot-checking what the synthesiser relies on against the code/,
    );
    expect(TASK_DOCUMENTS_V2).toMatch(
      /at most four times; a publish refused for disagreeing with the out\/ files does not count as one of them, but at most five such refusals/,
    );
    expect(TASK_DOCUMENTS_V2).toMatch(/the six cross-module questions from the accepted documents/);
    expect(TASK_DOCUMENTS_V2).not.toBe(TASK_DOCUMENTS);
  });

  it('still never says which documents are wrong, how many, or what kind of error; the duties of every role agree with the text', () => {
    const lint =
      /\b(corrupt\w*|inject\w*|fault\w*|seed\w*|harness|duplicate\w*|copied|reversed|swapped|four of)\b|some of the documents/i;
    expect(TASK_DOCUMENTS_V2).not.toMatch(lint);
    const r = record.variants.v2.responsibilities;
    expect(JSON.stringify(r)).not.toMatch(lint);
    expect(Object.keys(r)).toEqual(
      Object.keys(record.arms.find((a) => a.id === 'treatment').responsibilities),
    );
    expect(r.lead).toMatch(/is not asked to relay rejections/);
    expect(r.lead).not.toMatch(/relays the synthesiser's rejections/);
    expect(r['worker-1']).toMatch(/document-only evidence/);
    expect(r['worker-1']).not.toMatch(/when the lead relays a rejection/);
    expect(r.synthesiser).toMatch(/pilot__doc_check/);
    expect(r.synthesiser).not.toMatch(/tells the lead which documents it rejected/);
  });
});

describe('prepared as p1t-v2', () => {
  it('is the treatment arm with its own id, the v2 text and duties, and the same roster, caps and deadline', async () => {
    const v = await prep('treatment', 1, 'v2');
    const t = await prep('treatment', 1);
    expect(v.t.name).toBe('smoke-parallel-sweep-3-phase2-p1t-v2');
    expect(v.t.pilot).toMatchObject({
      arm: 'treatment',
      variant: {
        id: 'v2',
        deadlineSeconds: 720,
        declaredChange: 'handoff-relay-consistency-check',
      },
    });
    expect(v.t.task).toBe(TASK_DOCUMENTS_V2);
    expect(t.t.task).toBe(TASK_DOCUMENTS); // the measured v1 is unchanged
    expect(v.t.deadlineSeconds).toBe(t.t.deadlineSeconds);
    expect(v.t.allocationUsd).toBe(t.t.allocationUsd);
    expect(v.def.roles.map((r) => r.id)).toEqual(t.def.roles.map((r) => r.id));
    for (const r of v.def.roles) {
      expect(r.budget_usd).toBe(t.def.roles.find((x) => x.id === r.id).budget_usd);
      expect(r.budget_tokens).toBe(t.def.roles.find((x) => x.id === r.id).budget_tokens);
      expect(r.budget_usd).toBeCloseTo(CAPS[r.id] * 2, 6);
    }
    const w = v.def.roles.find((r) => r.id === 'worker-1');
    expect(w.responsibilities[0]).toBe(record.variants.v2.responsibilities['worker-1']);
    expect(w.responsibilities.join(' ')).toMatch(/a message from pilot-relay tells you directly/);
    expect(w.responsibilities.join(' ')).toMatch(/disagrees with your deliverable files/);
    const s = v.def.roles.find((r) => r.id === 'synthesiser');
    expect(s.responsibilities.join(' ')).toMatch(/pilot__doc_check on it \(a necessary check/);
    expect(JSON.stringify(v.def)).not.toMatch(/inject|harness-seeded/);
    expect(v.def.sections).toBeUndefined();
  });

  it('has the same fault placements as p1t and p2t, the relay and workspace in the record, and contracts with deliverables and checks', async () => {
    const ids = pilot.contracts.map((c) => c.id);
    for (const n of [1, 2]) {
      const v = await prep('treatment', n, 'v2');
      expect(v.t.pilot.faults).toEqual(planFaults(20261003 + n, ids));
      expect(v.t.pilot.faults).toEqual((await prep('treatment', n)).t.pilot.faults);
    }
    const v = await prep('treatment', 1, 'v2');
    expect(v.t.pilot.relay).toEqual({ copy_to: ['lead'] });
    expect(v.t.pilot.workspace).toBe(join(v.root, 'workspace'));
    expect(v.t.pilot.contracts).toEqual(
      applyContractTemplate(pilot.contracts, variant.contract_template),
    );
    expect(v.t.pilot.contracts[0].deliverables).toHaveLength(4);
    expect((await prep('treatment', 1)).t.pilot.contracts).toEqual(pilot.contracts);
    expect((await prep('treatment', 1)).t.pilot.relay).toBeUndefined();
  });

  it('hides the store, the event log and the trial record from every role, as the treatment does', async () => {
    const v = await prep('treatment', 1, 'v2');
    for (const r of v.def.roles)
      expect(r.policy.sandbox.denyRead).toEqual(
        expect.arrayContaining([join(v.root, 'pilot-state'), join(v.root, 'trial.json')]),
      );
  });

  it('is the treatment arm only: the baseline refuses it, an unlisted variant is refused', async () => {
    await expect(
      preparePilotTrial({ scenario: id, base, arm: 'baseline', n: 1, variant: 'v2' }),
    ).rejects.toThrow(/variant v2 is the treatment arm only, not baseline/);
    await expect(
      preparePilotTrial({ scenario: id, base, arm: 'treatment', n: 1, variant: 'v3' }),
    ).rejects.toThrow(/does not list the variant "v3"/);
  });
});
