// parallel-sweep-2 kit, part 2: check() on 33 units with the delivered count over the files present when the run ends,
// and the text every role receives agreeing with the hand-off contracts. (Part 1 is kit.test.ts.) No model is called.
// @ts-nocheck: plain .mjs modules and fixture scripts

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { referenceDeliverables } from '../../../fixtures/parallel-sweep-2/hidden/reference/write-answers.mjs';
import { preparePilotTrial } from '../../../pilot/prepare.js';
import { buildInputs as buildBase } from '../../prepare.mjs';
import { check, id, MODULES, OWNS, TASK } from './kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '../../../fixtures/parallel-sweep-2');
const _generatorDir = join(here, '../../../fixtures/parallel-sweep');
const _record = JSON.parse(readFileSync(join(fixtureDir, 'fixture.json'), 'utf8'));
const pilot = JSON.parse(
  readFileSync(join(here, '../../../pilot/parallel-sweep-2.pilot.json'), 'utf8'),
);
const scratch = (p: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), p)));
const walk = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, join(rel, e.name)) : [join(rel, e.name)],
  );
const _hashOf = (dir: string) => {
  const h = createHash('sha256');
  for (const f of walk(dir).sort())
    h.update(`${f}\0`)
      .update(readFileSync(join(dir, f)))
      .update('\0');
  return h.digest('hex');
};
let tmp: string;
let base: string;
beforeAll(async () => {
  tmp = scratch('sweep2-kit-');
  base = join(tmp, 'base');
  await buildBase({ scenario: id, base });
});
afterAll(() => {
  spawnSync('chmod', ['-R', 'u+w', tmp]);
  rmSync(tmp, { recursive: true, force: true });
});
const inputs = () => join(base, 'inputs', id);
type Arm = 'single' | 'baseline' | 'treatment';
const _ROSTER = ['lead', ...Array.from({ length: 8 }, (_, i) => `worker-${i + 1}`), 'synthesiser'];
const prepared: Record<string, any> = {};
const prep = async (arm: Arm, n: number) => {
  const key = `${arm}${n}`;
  if (!prepared[key]) {
    const root = await preparePilotTrial({ scenario: id, base, arm, n });
    const t = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
    prepared[key] = {
      root,
      t,
      def: JSON.parse(readFileSync(join(root, '.monomind/orgs', `${t.name}.json`), 'utf8')),
    };
  }
  return prepared[key];
};

describe('check: 33 units, the delivered count, the files present when the run ends', () => {
  const run = async (variant: string | null, edit?: (ws: string) => void) => {
    const dir = scratch('sweep2-check-');
    const ws = join(dir, 'workspace');
    mkdirSync(join(ws, 'out'), { recursive: true });
    if (variant) {
      const truth = JSON.parse(readFileSync(join(inputs(), 'truth.json'), 'utf8'));
      for (const [p, doc] of Object.entries(referenceDeliverables(truth, variant))) {
        mkdirSync(dirname(join(ws, 'out', p)), { recursive: true });
        writeFileSync(join(ws, 'out', p), JSON.stringify(doc));
      }
    }
    edit?.(ws);
    return check({ workspace: ws, inputs: inputs() });
  };
  const accepted = (u) => u.map((x) => x.accepted);

  it('the complete reference: 32 sheets then the synthesis, all accepted and exact, delivered 33 of 33, nothing critical', async () => {
    const u = await run('complete');
    expect(u).toHaveLength(33);
    expect(u.slice(0, 32).every((x) => x.unit === 'module-sheet')).toBe(true);
    expect(u[32].unit).toBe('synthesis');
    expect(accepted(u)).toEqual(Array(33).fill(true));
    expect(u.slice(0, 32).map((x) => x.evidence.module)).toEqual(MODULES);
    expect(u.slice(0, 32).every((x) => x.evidence.exact)).toBe(true);
    expect([u.delivered, u.total]).toEqual([33, 33]);
    expect(u.summary).toMatchObject({ sheets_exact: 32, synthesis_accepted: true });
    expect(u.critical).toEqual([]);
  });

  it('the partial reference (a prefix of 26 modules): delivered 26 of 33, below the 30 that would stop the pilot', async () => {
    const u = await run('partial');
    expect(accepted(u)).toEqual([...Array(26).fill(true), ...Array(7).fill(false)]);
    expect(u.delivered).toBe(26);
    expect(u[26].evidence.failures[0]).toBe('m27: file is missing');
    expect(u[32].evidence.failures[0]).toBe('synthesis: file is missing');
  });

  it('the wrong reference: all 33 written, none accepted, no expected value in the evidence; nothing written: delivered 0', async () => {
    const w = await run('wrong');
    expect(accepted(w)).toEqual(Array(33).fill(false));
    expect(w.delivered).toBe(0);
    expect(JSON.stringify(w)).not.toMatch(/expected/);
    expect((await run(null)).delivered).toBe(0);
  });

  it('11 of 12 exact accepts a sheet (and it is not exact), 10 of 12 does not', async () => {
    const tweak = (n: number) => (ws: string) => {
      const p = join(ws, 'out/m9/answers.json');
      const doc = JSON.parse(readFileSync(p, 'utf8'));
      for (let i = 0; i < n; i++) doc.answers[i].value += 1;
      writeFileSync(p, JSON.stringify(doc));
    };
    const one = await run('complete', tweak(1));
    expect(one[8]).toMatchObject({ accepted: true, evidence: { correct: 11, exact: false } });
    expect(one.delivered).toBe(33);
    expect((await run('complete', tweak(2)))[8].accepted).toBe(false);
  });

  it('a copied sheet and a fabricated question are critical and ride on their unit', async () => {
    const u = await run('complete', (ws) => {
      const m1 = JSON.parse(readFileSync(join(ws, 'out/m1/answers.json'), 'utf8'));
      writeFileSync(join(ws, 'out/m12/answers.json'), JSON.stringify({ ...m1, module: 'm12' }));
      const m3 = JSON.parse(readFileSync(join(ws, 'out/m3/answers.json'), 'utf8'));
      m3.answers.push({ q: 'q99', value: 1, files: ['m3/a.mjs'] });
      writeFileSync(join(ws, 'out/m3/answers.json'), JSON.stringify(m3));
    });
    expect(u.critical.join('\n')).toMatch(/m1 and m12 carry identical answer lists/);
    expect(u.critical.join('\n')).toMatch(/m3: an answer for q99/);
    expect(u[2].evidence.critical.join('\n')).toMatch(/q99/);
    expect(u[11].evidence.critical.join('\n')).toMatch(/m12/);
    expect(u[11].accepted).toBe(false);
  });

  it('scoring reads the module files only: a hand-off document without the files delivers nothing', async () => {
    const u = await run(null, (ws) => {
      mkdirSync(join(ws, '..', 'pilot-state'), { recursive: true });
      writeFileSync(
        join(ws, '..', 'pilot-state', 'module-sheets-w1.json'),
        JSON.stringify({ worker: 'worker-1', sheets: [] }),
      );
    });
    expect(u.delivered).toBe(0);
  });
});

describe('the deliverable shapes are in the text every role receives, and the text agrees with the contracts', () => {
  const roleTexts = async (arm: Arm) => {
    const { t, def } = await prep(arm, 1);
    return def.roles.map((r) => ({
      id: r.id as string,
      text: `${t.task}\n${(r.responsibilities ?? []).join('\n')}`,
      resp: (r.responsibilities ?? []).join('\n') as string,
    }));
  };
  const SHAPE = [
    /answers\.json/,
    /synthesis\.json/,
    /"module"/,
    /"answers"/,
    /"q"/,
    /"value"/,
    /"files"/,
  ];

  for (const arm of ['single', 'baseline', 'treatment'] as Arm[])
    it(`${arm}: every role's text carries the sheet and synthesis shapes, a worked example and the 600 s cut`, async () => {
      for (const { id: roleId, text } of await roleTexts(arm)) {
        for (const re of SHAPE) expect(text, `${arm}/${roleId} ${re}`).toMatch(re);
        expect(text).toMatch(/q01 to q12/);
        expect(text).toMatch(/s1 to s6/);
        expect(text).toMatch(/"q99"/);
        expect(text).toMatch(/no other keys/);
        expect(text).toMatch(/600 seconds/);
      }
    });

  it('every worker (all arms) is told to write one out/<module>/answers.json per module; the synthesiser is pointed at the shape', async () => {
    for (const arm of ['baseline', 'treatment'] as Arm[])
      for (const { id: roleId, resp } of await roleTexts(arm)) {
        if (roleId.startsWith('worker')) {
          const [first, last] = [OWNS[roleId][0], OWNS[roleId][3]];
          expect(resp, `${arm}/${roleId}`).toContain(
            `out/${first}/answers.json .. out/${last}/answers.json`,
          );
          expect(resp).toMatch(/one file per module/);
          expect(resp).toMatch(/shape given in the task text/);
        }
        if (roleId === 'synthesiser') expect(resp).toMatch(/shape given in the task text/);
      }
  });

  it('treatment workers are also given their contract (module-sheets-w<k>), whose sheets have exactly the module-sheet shape', async () => {
    const t = await roleTexts('treatment');
    for (let k = 1; k <= 8; k++) {
      const r = t.find((x) => x.id === `worker-${k}`)!;
      expect(r.resp).toContain(`module-sheets-w${k}`);
      expect(r.resp).toContain(`out/${OWNS[`worker-${k}`][0]}/answers.json`); // the files stay the deliverable
    }
    expect(t.find((x) => x.id === 'synthesiser')!.resp).toMatch(
      /module-sheets-w1.*module-sheets-w8/s,
    );
    for (const c of pilot.contracts) {
      expect(c.schema.required).toEqual(['worker', 'sheets']);
      expect(c.schema.additionalProperties).toBe(false);
      const sheet = c.schema.properties.sheets.items;
      expect(sheet.required).toEqual(['module', 'answers']);
      expect(sheet.properties.answers.items.required).toEqual(['q', 'value', 'files']);
      expect(sheet.properties.answers.items.properties.value.type).toBe('integer');
    }
    expect(TASK).toMatch(/value is an integer/);
    expect(TASK).toMatch(/files is a list of strings/);
  });

  it('the worked example is made up: no module m99 and no value 12345 in the truth', () => {
    const truth = JSON.parse(readFileSync(join(inputs(), 'truth.json'), 'utf8'));
    expect(truth.modules.m99).toBeUndefined();
    const values = Object.values(truth.modules).flatMap((m: any) =>
      Object.values(m).map((x: any) => x.value),
    );
    expect(values).not.toContain(12345);
  });
});
