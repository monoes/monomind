// The parallel-sweep-2 kit: inputs, the 10-role roster, caps and their arithmetic, task text, hidden truth, the no-node and
// home-write-deny sandbox on every role (real bubblewrap on a sample), check() on 33 units, and text/contract agreement.
// The full-daemon dry run of every role is in dryrun.test.ts. No model is called anywhere.
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
import { attachPilot, pilotOrgDef } from '../../../pilot/harness.js';
import { preparePilotTrial } from '../../../pilot/prepare.js';
import { PRICE_SCALE, RUNNER_PLANS, resolvePlan } from '../../lib.mjs';
import { HOME_WRITE_ALLOW, noExecProblems } from '../../no-exec.mjs';
import { buildInputs as buildBase } from '../../prepare.mjs';
import {
  ALLOCATION_USD,
  CAPS,
  DEADLINE_SECONDS,
  id,
  MAX_CONCURRENT_AGENTS,
  MODULES,
  ORG_STOP_USD,
  OWNS,
  SESSION_CAP,
  SOLO_CAPS,
  SOLO_SESSION_CAP,
  SOLO_TASK,
  TASK,
} from './kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '../../../fixtures/parallel-sweep-2');
const generatorDir = join(here, '../../../fixtures/parallel-sweep');
const record = JSON.parse(readFileSync(join(fixtureDir, 'fixture.json'), 'utf8'));
const pilot = JSON.parse(
  readFileSync(join(here, '../../../pilot/parallel-sweep-2.pilot.json'), 'utf8'),
);
const scratch = (p: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), p)));
const walk = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, join(rel, e.name)) : [join(rel, e.name)],
  );
const hashOf = (dir: string) => {
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

describe('buildInputs', () => {
  it('builds the pinned 32-module corpus, empty out/ directories and the truth OUTSIDE the workspace', () => {
    const ws = join(inputs(), 'workspace');
    expect(id).toBe('parallel-sweep-2');
    expect(hashOf(join(ws, 'corpus'))).toBe(record.fixture.pinned_hash);
    expect(existsSync(join(inputs(), 'truth.json'))).toBe(true);
    expect(walk(ws).filter((f) => /truth/.test(f))).toEqual([]);
    expect(MODULES).toHaveLength(32);
    for (const m of MODULES) {
      expect(existsSync(join(ws, 'corpus', m, 'questions.json'))).toBe(true);
      expect(readdirSync(join(ws, 'out', m))).toEqual([]);
    }
    expect(existsSync(join(ws, 'corpus/synthesis-questions.json'))).toBe(true);
    const text = walk(ws)
      .map((f) => readFileSync(join(ws, f), 'utf8'))
      .join('\n');
    expect(text).not.toMatch(/"expected"|"files":\s*\[/);
  });
});

describe('the task text, the plan and the constants', () => {
  it('multi-role text: common + the lead coordinates and answers nothing + the 600 s deadline + no interpreter + the eight assignments', () => {
    expect(TASK).toBe(`${record.fixture.tasks.common} ${record.fixture.tasks.multi_role}`);
    expect(TASK).toMatch(/lead coordinates and does not answer any question itself/);
    expect(TASK).toMatch(/600 seconds \(ten minutes\) of wall time/);
    expect(TASK).toMatch(/no node or other interpreter is available to any role/);
    expect(TASK).toMatch(/worker-1: m1 to m4, .*worker-8: m29 to m32/);
    expect(SOLO_TASK).toBe(`${record.fixture.tasks.common} ${record.fixture.tasks.single}`);
    expect(SOLO_TASK).toMatch(/You are the only role/);
    expect(SOLO_TASK).toMatch(/600 seconds/);
    expect(SOLO_TASK).not.toMatch(/lead coordinates/);
  });

  it("is on the production plan (native, Sonnet) with the fixture record's allocation, stop and deadline", () => {
    expect(RUNNER_PLANS[id]).toEqual({
      native: true,
      production: { native: true, claudeModel: 'claude-sonnet-5-5' },
    });
    expect(resolvePlan(id, 'production').claudeModel).toBe('claude-sonnet-5-5');
    expect([ALLOCATION_USD, ORG_STOP_USD, DEADLINE_SECONDS]).toEqual([30, 30, 600]);
    expect(pilot.deadline_seconds).toBe(DEADLINE_SECONDS);
    expect(pilot.org_stop_usd).toBe(ORG_STOP_USD);
    expect(pilot.per_run_allocation_usd).toBe(ALLOCATION_USD);
  });

  it('caps: workers about 2x the old 2-module cap, the sum under the $30 stop, the single role up to the stop', () => {
    expect(Object.keys(CAPS)).toEqual(ROSTER);
    const scale = PRICE_SCALE.production;
    for (const w of ROSTER.filter((r) => r.startsWith('worker')))
      expect(CAPS[w] * scale).toBeCloseTo(3.4, 6);
    const sum = Object.values(CAPS).reduce((a, x) => a + x, 0) * scale;
    expect(sum).toBeCloseTo(29.4, 6); // 8 x 3.4 + 1.0 + 1.2
    expect(sum).toBeLessThanOrEqual(ORG_STOP_USD);
    expect(sum).toBeGreaterThan(0.9 * ORG_STOP_USD);
    expect(SOLO_CAPS).toEqual({ solver: 30 });
  });

  it('session caps: 16M for a role; the single role, which carries up to 32 modules, 96M (more than the old 32M)', () => {
    expect(SESSION_CAP.tokens).toBe(16_000_000);
    expect(SOLO_SESSION_CAP.tokens).toBe(96_000_000);
    expect(SOLO_SESSION_CAP.tokens).toBeGreaterThanOrEqual(32_000_000);
  });

  it('at least 10 roles may run at once (the default of 4 queued the last workers in the previous dry run)', () => {
    expect(MAX_CONCURRENT_AGENTS).toBeGreaterThanOrEqual(10);
    expect(MAX_CONCURRENT_AGENTS).toBeGreaterThanOrEqual(ROSTER.length);
  });
});

describe('the three arms, prepared as the pilot prepares them', () => {
  it('single is the solver alone; baseline and treatment are the lead, eight workers and the synthesiser (10 roles)', async () => {
    const s = await prep('single', 1);
    const b = await prep('baseline', 1);
    const t = await prep('treatment', 1);
    expect(s.def.roles.map((r) => r.id)).toEqual(['solver']);
    expect(b.def.roles.map((r) => r.id)).toEqual(ROSTER);
    expect(t.def.roles.map((r) => r.id)).toEqual(ROSTER);
    expect(record.fixture.arms.map((a) => a.roster)).toEqual([['solver'], ROSTER, ROSTER]);
    expect(b.def.roles.find((r) => r.id === 'lead').reports_to).toBeNull();
    expect(b.def.roles.filter((r) => r.reports_to === 'lead')).toHaveLength(9);
    expect(b.def.run_config.max_concurrent_agents).toBeGreaterThanOrEqual(10);
    expect(t.def.run_config.max_concurrent_agents).toBeGreaterThanOrEqual(10);
    expect(b.def.sections).toBeUndefined();
    expect(t.def.sections).toBeUndefined();
    for (const x of [s, b, t]) {
      expect(OrgDefSchema.parse(x.def)).toBeTruthy();
      expect(checklistFindings(OrgDefSchema.parse(x.def)).errors).toEqual([]);
      expect(x.t.noExec).toBe(true);
      expect(x.t.deadlineSeconds).toBe(600);
      expect(x.t.allocationUsd).toBe(30);
      expect(x.t.orgStopUsd).toBe(30);
      expect(x.t.profile).toBe('production');
      expect(x.def.run_config.context.session_cap).toEqual(
        x === s ? SOLO_SESSION_CAP : SESSION_CAP,
      );
      for (const r of Object.values(x.t.runners))
        expect(r).toEqual({ runtime: 'claude', model: 'claude-sonnet-5-5' });
    }
    expect(s.t.task).toBe(SOLO_TASK);
    expect(b.t.task).toBe(TASK);
    expect(t.t.task).toBe(TASK);
    expect(s.def.roles[0].budget_usd).toBe(ORG_STOP_USD);
    for (const r of b.def.roles)
      expect(r.budget_usd).toBeCloseTo(CAPS[r.id] * PRICE_SCALE.production, 6);
    expect(t.def.roles.some((r) => r.tool_providers?.some((p) => p.name === 'pilot'))).toBe(true);
    expect(b.def.roles.some((r) => r.tool_providers?.length)).toBe(false);
  });

  it('worker k owns m(4k-3)..m(4k) and may write only their sheets; the lead writes nothing; the synthesiser only synthesis.json', async () => {
    const { def, t } = await prep('baseline', 1);
    const ws = def.run_config.workspace;
    const by = (r: string) => def.roles.find((x) => x.id === r);
    expect(Object.keys(OWNS)).toEqual(ROSTER.slice(1, 9));
    expect(Object.values(OWNS).flat()).toEqual(MODULES);
    for (const [w, mods] of Object.entries(OWNS)) {
      const k = Number(w.split('-')[1]);
      expect(mods).toEqual([4 * k - 3, 4 * k - 2, 4 * k - 1, 4 * k].map((i) => `m${i}`));
      expect(by(w).policy.fileWrite).toEqual(mods.map((m) => `out/${m}/**`));
      const dw = by(w).policy.sandbox.denyWrite;
      expect(dw).toContain(join(ws, 'corpus'));
      for (const m of MODULES) expect(dw.includes(join(ws, 'out', m))).toBe(!mods.includes(m));
      expect(by(w).responsibilities.join(' ')).toContain(`${mods[0]} to ${mods[3]}`);
    }
    expect(by('lead').policy.fileWrite).toEqual([]);
    expect(by('lead').policy.sandbox.denyWrite).toContain(ws);
    expect(by('synthesiser').policy.fileWrite).toEqual(['out/synthesis.json']);
    for (const r of def.roles) expect(r.policy.sandbox.denyWrite).toContain(t.guard[0]);
  });

  it('baseline and treatment differ only by the prototype (a placeholder provider and one responsibilities line per sectioned role)', async () => {
    const b = await prep('baseline', 1);
    const t = await prep('treatment', 1);
    const norm = (r) =>
      JSON.parse(
        JSON.stringify(r)
          .split(/\/trials\/smoke-parallel-sweep-2-phase2-p1[bt]\//)
          .join('/T/'),
      );
    for (const rb of b.def.roles) {
      const rt = t.def.roles.find((x) => x.id === rb.id);
      const { tool_providers, responsibilities, ...restT } = norm(rt);
      const { responsibilities: respB, ...restB } = norm(rb);
      expect(restT).toEqual(restB);
      expect(!!tool_providers).toBe(!!rt.tool_providers);
      expect(responsibilities.slice(0, respB.length)).toEqual(respB);
      expect(norm(rt).policy).toEqual(norm(rb).policy);
    }
  });
});

describe('the truth is hidden from every role', () => {
  it('truth.json and both fixture directories are denyRead on every role of every arm; the inputs and corpus are denyWrite', async () => {
    for (const arm of ['single', 'baseline', 'treatment'] as Arm[]) {
      const { def, t } = await prep(arm, 1);
      for (const r of def.roles) {
        expect(r.policy.sandbox.denyRead).toEqual([
          join(t.guard[0], 'truth.json'),
          fixtureDir,
          generatorDir,
        ]);
        const dw = r.policy.sandbox.denyWrite;
        expect(dw).toContain(t.guard[0]);
        expect(
          dw.includes(join(def.run_config.workspace, 'corpus')) ||
            dw.includes(def.run_config.workspace),
        ).toBe(true);
      }
      expect(def.run_config.workspace.startsWith(t.guard[0])).toBe(false);
      expect(existsSync(join(def.run_config.workspace, 'truth.json'))).toBe(false);
    }
  });
});

describe('no node, no code-execution tool and no home write, on every role of every arm', () => {
  it.each(['single', 'baseline', 'treatment'] as Arm[])(
    '%s: the denial and homeWriteAllow are on every role',
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

  it('survives pilotOrgDef and attachPilot unchanged (all eight workers get the inert placeholder provider)', async () => {
    const b = await prep('baseline', 3);
    const trial = {
      runId: 'tok',
      dir: scratch('sweep2-pilot-'),
      routing: pilot.routing,
      contracts: pilot.contracts,
    };
    const treated = pilotOrgDef(structuredClone(b.def), trial);
    expect(noExecProblems(treated)).toEqual([]);
    for (const r of treated.roles)
      expect(r.policy).toEqual(b.def.roles.find((x) => x.id === r.id).policy);
    attachPilot(
      { toolProviders: { buildRoleTools: async () => ({}) }, deliver: async () => 'ok' } as any,
      trial,
      'tok',
    );
    for (let k = 1; k <= 8; k++)
      expect(treated.roles.find((r) => r.id === `worker-${k}`).tool_providers[0].command).toBe(
        'true',
      );
    expect(noExecProblems(treated)).toEqual([]);
  });
});

/** A role's own shell, the way the runtime launches it: the role's policy through roleExecMask, then the command. */
const asRole = (def, roleId: string, cmd: string, home: string) => {
  const r = def.roles.find((x) => x.id === roleId);
  const mask = roleExecMask({
    bus: new OrgBus('o', 'r', scratch('sweep2-bus-')),
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
  'real bubblewrap on a sample of roles of every arm: no node, no write to the home, the truth unreadable',
  () => {
    const sample: Array<[Arm, string]> = [
      ['single', 'solver'],
      ['baseline', 'lead'],
      ['baseline', 'worker-1'],
      ['baseline', 'worker-8'],
      ['baseline', 'synthesiser'],
      ['treatment', 'worker-5'],
      ['treatment', 'synthesiser'],
    ];
    it.each(sample)('%s / %s', async (arm, roleId) => {
      const { def, t } = await prep(arm, 1);
      const home = scratch('sweep2-home-');
      mkdirSync(join(home, '.codex'), { recursive: true });
      writeFileSync(join(home, '.bashrc'), '# rc\n');
      const ws = def.run_config.workspace;
      writeFileSync(join(ws, 'out', 'probe.mjs'), 'console.log("PROGRAM-RAN");\n');
      for (const cmd of [
        'node out/probe.mjs',
        'env node out/probe.mjs',
        `'${process.execPath}' out/probe.mjs`,
        'python3 -c \'print("PROGRAM-RAN")\'',
      ]) {
        const r = asRole(def, roleId, cmd, home);
        expect([cmd, r.stdout.includes('PROGRAM-RAN')]).toEqual([cmd, false]);
        expect([cmd, r.status === 0]).toEqual([cmd, false]);
      }
      const before = readdirSync(home).sort().join(',');
      for (const cmd of ['echo x > ~/f7.sh', 'touch ~/x; mkdir ~/d; mv ~/.bashrc ~/.bashrc.old'])
        asRole(def, roleId, cmd, home);
      expect(readdirSync(home).sort().join(',')).toBe(before);
      expect(existsSync(join(home, 'f7.sh'))).toBe(false);
      asRole(
        def,
        roleId,
        `echo s > ~/.codex/session.jsonl; echo w > '${ws}/out/home-probe.txt'`,
        home,
      );
      expect(readFileSync(join(home, '.codex/session.jsonl'), 'utf8')).toBe('s\n'); // control: the runner dir is writable
      expect(readFileSync(join(ws, 'out/home-probe.txt'), 'utf8')).toBe('w\n');
      const hidden = asRole(
        def,
        roleId,
        `cat '${join(t.guard[0], 'truth.json')}' 2>&1; ls '${fixtureDir}' '${generatorDir}' 2>&1`,
        home,
      );
      expect(hidden.stdout).not.toMatch(/"modules"|"synthesis"|score\.mjs|build-corpus/);
    });
  },
);
