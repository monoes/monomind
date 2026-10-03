// The parallel-sweep-3 kit: the 10-role roster and its caps, the two task texts, the corpus shared with
// parallel-sweep-2, the no-node and home-write-deny sandbox on every role of both arms, what each role cannot read
// (the synthesiser's out/ in the treatment arm, the fault plan and the eval tree for everyone), the harness-seeded
// fault plan in the trial record (treatment only), and real bubblewrap on a sample. No model is called anywhere.
// The full-daemon dry run is in dryrun.test.ts, check() in check.test.ts.
// @ts-nocheck: plain .mjs modules and fixture scripts

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
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
import {
  authorityMaskAvailability,
  maskedCommand,
} from '../../../../../../packages/@monomind/cli/src/orgrt/authority-mask.js';
import { OrgBus } from '../../../../../../packages/@monomind/cli/src/orgrt/bus.js';
import { roleExecMask } from '../../../../../../packages/@monomind/cli/src/orgrt/exec-deny.js';
import { homeLayerAvailability } from '../../../../../../packages/@monomind/cli/src/orgrt/home-write-deny.js';
import { OrgDefSchema } from '../../../../../../packages/@monomind/cli/src/orgrt/types.js';
import { checklistFindings } from '../../../../../../packages/@monomind/cli/src/orgrt/validate-checklist.js';
import { FAULT_CLASSES, planFaults } from '../../../pilot/fault-injection.js';
import { pilotOrgDef } from '../../../pilot/harness.js';
import { preparePilotTrial } from '../../../pilot/prepare.js';
import { PRICE_SCALE, RUNNER_PLANS, resolvePlan } from '../../lib.mjs';
import { HOME_WRITE_ALLOW, noExecProblems } from '../../no-exec.mjs';
import { buildInputs as buildBase } from '../../prepare.mjs';
import * as sweep2 from '../parallel-sweep-2/kit.mjs';
import {
  ALLOCATION_USD,
  CAPS,
  DEADLINE_SECONDS,
  EVAL_DIR,
  id,
  MAX_CONCURRENT_AGENTS,
  MODULES,
  ORG_STOP_USD,
  OWNS,
  SESSION_CAP,
  TASK,
  TASK_DOCUMENTS,
} from './kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = JSON.parse(
  readFileSync(join(here, '../../../fixtures/parallel-sweep-3/fixture.json'), 'utf8'),
);
const record2 = JSON.parse(
  readFileSync(join(here, '../../../fixtures/parallel-sweep-2/fixture.json'), 'utf8'),
);
const pilot = JSON.parse(
  readFileSync(join(here, '../../../pilot/parallel-sweep-3.pilot.json'), 'utf8'),
);
const scratch = (p: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), p)));
const walk = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, join(rel, e.name)) : [join(rel, e.name)],
  );
let tmp: string;
let base: string;
beforeAll(async () => {
  tmp = scratch('sweep3-kit-');
  base = join(tmp, 'base');
  await buildBase({ scenario: id, base });
});
afterAll(() => {
  spawnSync('chmod', ['-R', 'u+w', tmp]);
  rmSync(tmp, { recursive: true, force: true });
});
const inputs = () => join(base, 'inputs', id);
type Arm = 'baseline' | 'treatment';
const ROSTER = ['lead', ...Array.from({ length: 8 }, (_, i) => `worker-${i + 1}`), 'synthesiser'];
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

describe('inputs: the parallel-sweep-2 corpus, byte for byte, truth outside the workspace', () => {
  it('has the same pinned hash as parallel-sweep-2, 32 empty out/ directories and no truth in the workspace', () => {
    const ws = join(inputs(), 'workspace');
    expect(id).toBe('parallel-sweep-3');
    expect(record.fixture.pinned_hash).toBe(record2.fixture.pinned_hash);
    const h = createHash('sha256');
    for (const f of walk(join(ws, 'corpus')).sort())
      h.update(`${f}\0`)
        .update(readFileSync(join(ws, 'corpus', f)))
        .update('\0');
    expect(h.digest('hex')).toBe(record.fixture.pinned_hash); // the corpus as built is the pinned one
    expect(existsSync(join(inputs(), 'truth.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(inputs(), 'meta.json'), 'utf8')).fixture).toBe(id);
    expect(walk(ws).filter((f) => /truth/.test(f))).toEqual([]);
    for (const m of MODULES) expect(readdirSync(join(ws, 'out', m))).toEqual([]);
    expect(MODULES).toHaveLength(32);
  });
});

describe('the text, the plan and the constants', () => {
  it('the baseline text is the sweep-2 multi-role text at 720 s; the treatment text adds the documents, the decision and the relay', () => {
    expect(TASK).toBe(`${record.fixture.tasks.common} ${record2.fixture.tasks.multi_role}`);
    expect(TASK).toMatch(/720 seconds \(twelve minutes\) of wall time/);
    expect(TASK).not.toMatch(/\b600\b/);
    expect(TASK_DOCUMENTS).toMatch(/720 seconds \(twelve minutes\) of wall time/);
    expect(TASK_DOCUMENTS).toMatch(/pilot__doc_read/);
    expect(TASK_DOCUMENTS).toMatch(/pilot__doc_decide/);
    expect(TASK_DOCUMENTS).toMatch(/may contain errors/);
    expect(TASK_DOCUMENTS).toMatch(/cannot read the workers' out\/ directories/);
    expect(TASK_DOCUMENTS).toMatch(/uses only accepted documents/);
    expect(TASK_DOCUMENTS).toMatch(
      /not notified automatically.*the lead tells the producing worker/,
    );
    expect(TASK_DOCUMENTS).toMatch(/at most four times/);
    expect(TASK_DOCUMENTS).toMatch(/660 seconds/);
    expect(TASK_DOCUMENTS).toMatch(/worker-1: m1 to m4, .*worker-8: m29 to m32/);
  });

  it('the treatment text says the documents may be wrong, but never which, how many, or what kind of error', () => {
    expect(TASK_DOCUMENTS).not.toMatch(
      /\b(corrupt\w*|inject\w*|fault\w*|seed\w*|harness|duplicate\w*|copied|reversed|swapped|four of)\b|some of the documents/i,
    );
    expect(
      JSON.stringify(record.fixture.arms.find((a) => a.id === 'treatment').responsibilities),
    ).not.toMatch(/\b(corrupt\w*|inject\w*|fault\w*|seed\w*)\b/i);
  });

  it("is on the production plan (native, Sonnet) with the fixture record's allocation, stop and 720 s deadline", () => {
    expect(RUNNER_PLANS[id]).toEqual({
      native: true,
      production: { native: true, claudeModel: 'claude-sonnet-5-5' },
    });
    expect(resolvePlan(id, 'production').claudeModel).toBe('claude-sonnet-5-5');
    expect([ALLOCATION_USD, ORG_STOP_USD, DEADLINE_SECONDS]).toEqual([34, 34, 720]);
    expect(pilot.deadline_seconds).toBe(DEADLINE_SECONDS);
    expect(pilot.org_stop_usd).toBe(ORG_STOP_USD);
    expect(pilot.per_run_allocation_usd).toBe(ALLOCATION_USD);
    expect(SESSION_CAP).toEqual(sweep2.SESSION_CAP);
  });

  it("caps: the workers are sweep-2's, the lead and the synthesiser are raised for the relays and the reads, the sum is under the stop", () => {
    expect(Object.keys(CAPS)).toEqual(ROSTER);
    const scale = PRICE_SCALE.production;
    for (const w of ROSTER.filter((r) => r.startsWith('worker')))
      expect(CAPS[w]).toBe(sweep2.CAPS[w]);
    expect(CAPS.lead * scale).toBeCloseTo(1.4, 6);
    expect(CAPS.synthesiser * scale).toBeCloseTo(3.0, 6);
    expect(CAPS.synthesiser).toBeGreaterThan(sweep2.CAPS.synthesiser);
    const sum = Object.values(CAPS).reduce((a, x) => a + x, 0) * scale;
    expect(sum).toBeCloseTo(31.6, 6); // 8 x 3.4 + 1.4 + 3.0
    expect(sum).toBeLessThanOrEqual(ORG_STOP_USD);
  });

  it('at least 10 roles may run at once', () => {
    expect(MAX_CONCURRENT_AGENTS).toBeGreaterThanOrEqual(10);
    expect(MAX_CONCURRENT_AGENTS).toBeGreaterThanOrEqual(ROSTER.length);
  });
});

describe('the two arms, prepared as the pilot prepares them (no single arm)', () => {
  it('the single arm is not part of this scenario', async () => {
    await expect(preparePilotTrial({ scenario: id, base, arm: 'single', n: 1 })).rejects.toThrow(
      /does not list the arm "single"/,
    );
    expect(record.fixture.arms.map((a) => a.id)).toEqual(['baseline', 'treatment']);
  });

  it('both are the lead, eight workers and the synthesiser (10 roles), valid org definitions with no sections serialized', async () => {
    for (const arm of ['baseline', 'treatment'] as Arm[]) {
      const x = await prep(arm, 1);
      expect(x.def.roles.map((r) => r.id)).toEqual(ROSTER);
      expect(x.def.roles.find((r) => r.id === 'lead').reports_to).toBeNull();
      expect(x.def.roles.filter((r) => r.reports_to === 'lead')).toHaveLength(9);
      expect(x.def.run_config.max_concurrent_agents).toBeGreaterThanOrEqual(10);
      expect(x.def.sections).toBeUndefined();
      expect(OrgDefSchema.parse(x.def)).toBeTruthy();
      expect(checklistFindings(OrgDefSchema.parse(x.def)).errors).toEqual([]);
      expect([
        x.t.noExec,
        x.t.deadlineSeconds,
        x.t.allocationUsd,
        x.t.orgStopUsd,
        x.t.profile,
      ]).toEqual([true, 720, 34, 34, 'production']);
      expect(x.def.run_config.context.session_cap).toEqual(SESSION_CAP);
      for (const r of Object.values(x.t.runners))
        expect(r).toEqual({ runtime: 'claude', model: 'claude-sonnet-5-5' });
      for (const r of x.def.roles)
        expect(r.budget_usd).toBeCloseTo(CAPS[r.id] * PRICE_SCALE.production, 6);
    }
    const b = await prep('baseline', 1);
    const t = await prep('treatment', 1);
    expect(b.t.task).toBe(TASK);
    expect(t.t.task).toBe(TASK_DOCUMENTS);
    expect(t.def.roles.some((r) => r.tool_providers?.some((p) => p.name === 'pilot'))).toBe(true);
    expect(b.def.roles.some((r) => r.tool_providers?.length)).toBe(false);
  });

  it("write scopes are sweep-2's: worker k only its four sheets, the lead nothing, the synthesiser only synthesis.json", async () => {
    const { def, t } = await prep('treatment', 1);
    const ws = def.run_config.workspace;
    const by = (r: string) => def.roles.find((x) => x.id === r);
    expect(Object.values(OWNS).flat()).toEqual(MODULES);
    for (const [w, mods] of Object.entries(OWNS)) {
      expect(by(w).policy.fileWrite).toEqual(mods.map((m) => `out/${m}/**`));
      const dw = by(w).policy.sandbox.denyWrite;
      expect(dw).toContain(join(ws, 'corpus'));
      for (const m of MODULES) expect(dw.includes(join(ws, 'out', m))).toBe(!mods.includes(m));
    }
    expect(by('lead').policy.fileWrite).toEqual([]);
    expect(by('synthesiser').policy.fileWrite).toEqual(['out/synthesis.json']);
    for (const r of def.roles) expect(r.policy.sandbox.denyWrite).toContain(t.guard[0]);
  });

  it("the arms differ by the prototype and the roles' duties and by the synthesiser's hidden out/ directories, nothing else", async () => {
    const b = await prep('baseline', 1);
    const t = await prep('treatment', 1);
    const norm = (x) =>
      JSON.parse(
        JSON.stringify(x)
          .split(/smoke-parallel-sweep-3-phase2-p1[bt]/)
          .join('T'),
      );
    for (const rb of b.def.roles) {
      const rt = t.def.roles.find((x) => x.id === rb.id);
      const { tool_providers, responsibilities, policy: pt, ...restT } = norm(rt);
      const { responsibilities: respB, policy: pb, ...restB } = norm(rb);
      expect(restT).toEqual(restB);
      expect(tool_providers?.[0]?.name).toBe(rb.id === 'lead' ? undefined : 'pilot'); // the lead is in no section
      // the duties differ (documents instead of files); the baseline's are sweep-2's baseline duties
      expect(respB[0]).toBe(
        record2.fixture.arms.find((a) => a.id === 'baseline').responsibilities[rb.id],
      );
      expect(responsibilities[0]).toBe(
        record.fixture.arms.find((a) => a.id === 'treatment').responsibilities[rb.id],
      );
      expect(pt.sandbox.denyRead.length).toBeGreaterThan(pb.sandbox.denyRead.length); // pilot-state and trial.json
      expect(pt.fileWrite).toEqual(pb.fileWrite);
      expect(pt.allowTools).toEqual(pb.allowTools);
    }
  });
});

describe('what each role cannot read', () => {
  it('every role of both arms: the truth and the whole tests/eval/org tree (fixtures, scorer, injector, manifests) are hidden', async () => {
    for (const arm of ['baseline', 'treatment'] as Arm[]) {
      const { def, t } = await prep(arm, 1);
      for (const r of def.roles) {
        const dr = r.policy.sandbox.denyRead;
        expect(dr).toContain(join(t.guard[0], 'truth.json'));
        expect(dr).toContain(EVAL_DIR);
        expect(dr.some((p) => p.endsWith('docs/mastermind/pilot'))).toBe(true);
      }
      expect(def.run_config.workspace.startsWith(`${EVAL_DIR}/`)).toBe(false);
    }
  });

  it('treatment: every role also loses pilot-state/ (the store and the log of faults) and trial.json (the plan); baseline has neither', async () => {
    const t = await prep('treatment', 1);
    for (const r of t.def.roles) {
      expect(r.policy.sandbox.denyRead).toContain(join(t.root, 'pilot-state'));
      expect(r.policy.sandbox.denyRead).toContain(join(t.root, 'trial.json'));
    }
    const b = await prep('baseline', 1);
    for (const r of b.def.roles)
      expect(
        r.policy.sandbox.denyRead.some(
          (p) => p.includes('pilot-state') || p.endsWith('trial.json'),
        ),
      ).toBe(false);
  });

  it('treatment: the synthesiser alone cannot read out/m1 .. out/m32; it keeps the corpus; in the baseline it reads the files', async () => {
    const t = await prep('treatment', 1);
    const outs = MODULES.map((m) => join(t.def.run_config.workspace, 'out', m));
    for (const r of t.def.roles) {
      const dr = r.policy.sandbox.denyRead;
      expect(outs.every((o) => dr.includes(o))).toBe(r.id === 'synthesiser');
      expect(dr).not.toContain(join(t.def.run_config.workspace, 'corpus'));
      expect(dr).not.toContain(t.def.run_config.workspace);
    }
    const b = await prep('baseline', 1);
    const bs = b.def.roles.find((r) => r.id === 'synthesiser');
    for (const o of MODULES.map((m) => join(b.def.run_config.workspace, 'out', m)))
      expect(bs.policy.sandbox.denyRead).not.toContain(o);
  });
});

describe('the harness-seeded fault plan lives in the treatment trial record only', () => {
  it('treatment: four faults, one per class, deterministic per trial number, different between trials 1 and 2', async () => {
    const a = (await prep('treatment', 1)).t.pilot.faults;
    const b = (await prep('treatment', 2)).t.pilot.faults;
    const ids = pilot.contracts.map((c) => c.id);
    expect(a).toEqual(planFaults(20261003 + 1, ids));
    expect(b).toEqual(planFaults(20261003 + 2, ids));
    expect(a.faults.map((f) => f.class)).toEqual([...FAULT_CLASSES]);
    expect(new Set(a.faults.map((f) => f.doc)).size).toBe(4);
    expect(a.faults.map((f) => f.doc)).not.toEqual(b.faults.map((f) => f.doc));
  });

  it('baseline carries none, and a scenario without fault_injection (parallel-sweep-2) never gets one', async () => {
    expect((await prep('baseline', 1)).t.pilot.faults).toBeUndefined();
    const sweep2Base = join(tmp, 'base2');
    await buildBase({ scenario: 'parallel-sweep-2', base: sweep2Base });
    const root = await preparePilotTrial({
      scenario: 'parallel-sweep-2',
      base: sweep2Base,
      arm: 'treatment',
      n: 1,
    });
    expect(JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8')).pilot.faults).toBeUndefined();
  });
});

describe('no node, no code-execution tool and no home write, on every role of both arms', () => {
  it.each(['baseline', 'treatment'] as Arm[])(
    '%s: denyExec, homeWriteAllow and the tool gate are on every role',
    async (arm) => {
      const { def } = await prep(arm, 2);
      expect(noExecProblems(def)).toEqual([]);
      for (const r of def.roles) {
        expect(r.policy.sandbox.denyExec).toEqual(
          expect.arrayContaining([
            'node',
            'nodejs',
            'deno',
            'bun',
            'npm',
            'npx',
            'python*',
            'perl*',
          ]),
        );
        expect(r.policy.sandbox.homeWriteAllow).toEqual(HOME_WRITE_ALLOW);
        expect(r.policy.sandbox.mode).toBe('required');
        expect(r.policy.allowTools).not.toContain('NotebookEdit');
        expect(r.policy.denyTools).toEqual(
          expect.arrayContaining(['NotebookEdit', 'REPL', 'Task', 'Agent']),
        );
      }
    },
  );

  it('survives pilotOrgDef unchanged (policy untouched; all eight workers and the synthesiser get the inert placeholder provider)', async () => {
    const b = await prep('baseline', 3);
    const trial = {
      runId: 'tok',
      dir: scratch('sweep3-pilot-'),
      routing: pilot.routing,
      contracts: pilot.contracts,
    };
    const treated = pilotOrgDef(structuredClone(b.def), trial);
    expect(noExecProblems(treated)).toEqual([]);
    for (const r of treated.roles)
      expect(r.policy).toEqual(b.def.roles.find((x) => x.id === r.id).policy);
    for (const r of ['synthesiser', ...Array.from({ length: 8 }, (_, k) => `worker-${k + 1}`)])
      expect(treated.roles.find((x) => x.id === r).tool_providers[0].command).toBe('true');
  });
});

/** A role's own shell, the way the runtime launches it: the role's policy through roleExecMask, then the command. */
const asRole = (def, roleId: string, cmd: string, home: string) => {
  const r = def.roles.find((x) => x.id === roleId);
  const mask = roleExecMask({
    bus: new OrgBus('o', 'r', scratch('sweep3-bus-')),
    roleId,
    authorityMask: undefined,
    denyExec: r.policy.sandbox.denyExec,
    denyRead: r.policy.sandbox.denyRead,
    homeWriteAllow: r.policy.sandbox.homeWriteAllow,
    writableRoots: [def.run_config.workspace],
    home,
    env: process.env,
  });
  const [bin, args] = maskedCommand(mask, 'sh', ['-c', cmd]);
  return spawnSync(bin, args, {
    cwd: def.run_config.workspace,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: home },
  });
};

describe.runIf(authorityMaskAvailability().available && homeLayerAvailability().available)(
  'real bubblewrap: the synthesiser sees empty out/ directories, the corpus, and writes its own file; the plan is unreadable',
  () => {
    const sheet = '{"module":"m1","answers":[]}';
    const setup = async (arm: Arm) => {
      const x = await prep(arm, 1);
      const ws = x.def.run_config.workspace;
      writeFileSync(join(ws, 'out/m1/answers.json'), sheet);
      writeFileSync(join(ws, 'out/m17/answers.json'), sheet);
      mkdirSync(join(x.root, 'pilot-state'), { recursive: true });
      writeFileSync(
        join(x.root, 'pilot-state/pilot-events.jsonl'),
        '{"kind":"fault","detail":"SECRET-FAULT"}\n',
      );
      return { ...x, ws, home: scratch('sweep3-home-') };
    };

    it('treatment / synthesiser: out/<module>/ read as empty, the files are really there for the worker', async () => {
      const x = await setup('treatment');
      const seen = asRole(
        x.def,
        'synthesiser',
        'ls out/m1 out/m17 | grep -c json; cat out/m1/answers.json out/m17/answers.json 2>&1',
        x.home,
      );
      expect(seen.stdout.split('\n')[0].trim()).toBe('0'); // no file name in either listing
      expect(seen.stdout).not.toMatch(/"module"/);
      const worker = asRole(x.def, 'worker-1', 'cat out/m1/answers.json', x.home);
      expect(worker.stdout).toContain('"module":"m1"');
      const lead = asRole(x.def, 'lead', 'cat out/m1/answers.json', x.home);
      expect(lead.stdout).toContain('"module":"m1"'); // the lead is not blocked (a stated weakness)
    });

    it('treatment / synthesiser: it still reads corpus/, and its write to out/synthesis.json lands on the real directory', async () => {
      const x = await setup('treatment');
      const r = asRole(
        x.def,
        'synthesiser',
        `head -c 20 corpus/m1/questions.json; echo; echo '{"answers":[]}' > out/synthesis.json; echo "[wrote]"`,
        x.home,
      );
      expect(r.stdout).toMatch(/\[wrote\]/);
      expect(readFileSync(join(x.ws, 'out/synthesis.json'), 'utf8')).toBe('{"answers":[]}\n');
      const corpus = asRole(x.def, 'synthesiser', 'ls corpus/m1 | head -3', x.home);
      expect(corpus.stdout.trim().length).toBeGreaterThan(0);
    });

    it.each([
      ['treatment', 'synthesiser'],
      ['treatment', 'worker-5'],
      ['treatment', 'lead'],
    ] as Array<[Arm, string]>)(
      '%s / %s: pilot-state, trial.json, the eval tree and the truth read as empty or absent',
      async (arm, roleId) => {
        const x = await setup(arm);
        const run = (cmd: string) => asRole(x.def, roleId, cmd, x.home).stdout;
        // the store's directory and the eval tree list as empty, the plan and the truth read as empty or are refused
        expect(run(`ls '${join(x.root, 'pilot-state')}'`).trim()).toBe('');
        expect(run(`ls '${EVAL_DIR}'`).trim()).toBe('');
        expect(
          run(`cat '${join(x.root, 'pilot-state/pilot-events.jsonl')}' 2>/dev/null`),
        ).not.toMatch(/SECRET-FAULT/);
        expect(run(`cat '${join(x.root, 'trial.json')}' 2>/dev/null`)).not.toMatch(
          /"faults"|"pilot"/,
        );
        expect(run(`cat '${join(x.t.guard[0], 'truth.json')}' 2>/dev/null`)).not.toMatch(
          /"modules"/,
        );
      },
    );

    it('baseline / synthesiser: out/ is readable (the files are its path), and no node runs in either arm', async () => {
      const x = await setup('baseline');
      expect(asRole(x.def, 'synthesiser', 'cat out/m1/answers.json', x.home).stdout).toContain(
        '"module":"m1"',
      );
      for (const arm of ['baseline', 'treatment'] as Arm[]) {
        const y = await setup(arm);
        writeFileSync(join(y.ws, 'out', 'probe.mjs'), 'console.log("PROGRAM-RAN");\n');
        for (const roleId of ['synthesiser', 'worker-2']) {
          const r = asRole(
            y.def,
            roleId,
            'node out/probe.mjs; python3 -c \'print("PROGRAM-RAN")\'',
            y.home,
          );
          expect(r.stdout.includes('PROGRAM-RAN')).toBe(false);
          asRole(y.def, roleId, 'echo x > ~/f7.sh', y.home);
          expect(existsSync(join(y.home, 'f7.sh'))).toBe(false);
        }
      }
    });
  },
);
