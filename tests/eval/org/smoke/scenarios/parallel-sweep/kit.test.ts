// The parallel-sweep kit: its inputs, its roster, the caps, the task text, where the hidden truth lives,
// the no-node sandbox on every role of all three arms (and through pilotOrgDef/attachPilot), the real
// bubblewrap runs that show a role cannot run the code, and check() on the reference and degraded answers.
// No model is called anywhere.
// @ts-nocheck: plain .mjs modules and fixture scripts

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../../../../setup/tmp-track.js';
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
import { referenceDeliverables } from '../../../fixtures/parallel-sweep/hidden/reference/write-answers.mjs';
import { attachPilot, pilotOrgDef } from '../../../pilot/harness.js';
import { preparePilotTrial } from '../../../pilot/prepare.js';
import { PRICE_SCALE, RUNNER_PLANS, resolvePlan } from '../../lib.mjs';
import { noExecProblems } from '../../no-exec.mjs';
import { buildInputs as buildBase } from '../../prepare.mjs';
import {
  ALLOCATION_USD,
  CAPS,
  check,
  DEADLINE_SECONDS,
  id,
  ORG_STOP_USD,
  OWNS,
  SESSION_CAP,
  SOLO_CAPS,
  SOLO_SESSION_CAP,
  SOLO_TASK,
  TASK,
} from './kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '../../../fixtures/parallel-sweep');
const record = JSON.parse(readFileSync(join(fixtureDir, 'fixture.json'), 'utf8'));
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
  tmp = scratch('sweep-kit-');
  base = join(tmp, 'base');
  await buildBase({ scenario: id, base });
});
afterAll(() => {
  spawnSync('chmod', ['-R', 'u+w', tmp]);
  rmSync(tmp, { recursive: true, force: true });
});
const inputs = () => join(base, 'inputs', id);

describe('buildInputs', () => {
  it('builds the pinned corpus, empty out/ directories and the truth OUTSIDE the workspace', () => {
    const ws = join(inputs(), 'workspace');
    expect(id).toBe('parallel-sweep');
    expect(hashOf(join(ws, 'corpus'))).toBe(record.fixture.pinned_hash);
    expect(existsSync(join(inputs(), 'truth.json'))).toBe(true);
    expect(walk(ws).filter((f) => /truth/.test(f))).toEqual([]);
    for (let i = 1; i <= 8; i++) {
      expect(existsSync(join(ws, 'corpus', `m${i}`, 'questions.json'))).toBe(true);
      expect(readdirSync(join(ws, 'out', `m${i}`))).toEqual([]);
    }
    expect(existsSync(join(ws, 'corpus/synthesis-questions.json'))).toBe(true);
    // nothing in the workspace carries an answer: no answer file, no expected value field
    const text = walk(ws)
      .map((f) => readFileSync(join(ws, f), 'utf8'))
      .join('\n');
    expect(text).not.toMatch(/"expected"|"files":\s*\[/);
  });
});

describe('the task text and the plan', () => {
  it('multi-role text: common + the lead coordinates and answers nothing + the deadline + no interpreter', () => {
    expect(TASK).toBe(`${record.fixture.tasks.common} ${record.fixture.tasks.multi_role}`);
    expect(TASK).toMatch(/lead coordinates and does not answer any question itself/);
    expect(TASK).toMatch(/35 minutes of wall time/);
    expect(TASK).toMatch(/no node or other interpreter is available to any role/);
    expect(TASK).toMatch(/out\/synthesis\.json/);
    expect(TASK).toMatch(
      /worker-1: m1 and m2, worker-2: m3 and m4, worker-3: m5 and m6, worker-4: m7 and m8/,
    );
    expect(SOLO_TASK).toBe(`${record.fixture.tasks.common} ${record.fixture.tasks.single}`);
    expect(SOLO_TASK).toMatch(/You are the only role/);
    expect(SOLO_TASK).toMatch(/35 minutes of wall time/);
    expect(SOLO_TASK).not.toMatch(/lead coordinates/);
  });
  it("is on the production plan (native, Sonnet), with the fixture record's allocation, stop and deadline", () => {
    expect(RUNNER_PLANS[id]).toEqual({
      native: true,
      production: { native: true, claudeModel: 'claude-sonnet-5-5' },
    });
    expect(resolvePlan(id, 'production').claudeModel).toBe('claude-sonnet-5-5');
    expect([ALLOCATION_USD, ORG_STOP_USD, DEADLINE_SECONDS]).toEqual([12, 12, 2100]);
    expect(ALLOCATION_USD).toBe(record.fixture.planning_allocation_usd_per_run);
    expect(ORG_STOP_USD).toBe(record.fixture.org_stop_usd);
    expect(SESSION_CAP.tokens).toBeGreaterThan(0);
    expect(SOLO_SESSION_CAP.tokens).toBe(4 * SESSION_CAP.tokens);
  });
});

type Arm = 'single' | 'baseline' | 'treatment';
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

describe('the three arms, prepared as the pilot prepares them', () => {
  it('single is the solver alone; baseline and treatment are the lead, four workers and the synthesiser', async () => {
    const s = await prep('single', 1);
    const b = await prep('baseline', 1);
    const t = await prep('treatment', 1);
    expect(s.def.roles.map((r) => r.id)).toEqual(['solver']);
    const roster = ['lead', 'worker-1', 'worker-2', 'worker-3', 'worker-4', 'synthesiser'];
    expect(b.def.roles.map((r) => r.id)).toEqual(roster);
    expect(t.def.roles.map((r) => r.id)).toEqual(roster);
    expect(record.fixture.arms.map((a) => a.roster)).toEqual([['solver'], roster, roster]);
    expect(b.def.roles.find((r) => r.id === 'lead').reports_to).toBeNull();
    expect(b.def.roles.filter((r) => r.reports_to === 'lead')).toHaveLength(5);
    // all six roles can run at once (the runtime default of 4 would queue worker-4 and the synthesiser)
    expect(b.def.run_config.max_concurrent_agents).toBe(6);
    expect(t.def.run_config.max_concurrent_agents).toBe(6);
    expect(b.def.sections).toBeUndefined();
    expect(t.def.sections).toBeUndefined();
    for (const x of [s, b, t]) {
      expect(OrgDefSchema.parse(x.def)).toBeTruthy();
      expect(checklistFindings(OrgDefSchema.parse(x.def)).errors).toEqual([]);
      expect(x.t.noExec).toBe(true);
      expect(x.t.deadlineSeconds).toBe(2100);
      expect(x.t.allocationUsd).toBe(12);
      expect(x.t.orgStopUsd).toBe(12);
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
    expect(t.def.roles.some((r) => r.tool_providers?.some((p) => p.name === 'pilot'))).toBe(true);
    expect(b.def.roles.some((r) => r.tool_providers?.length)).toBe(false);
  });

  it('each worker owns two modules and may write only their sheets; the lead writes nothing; the synthesiser only synthesis.json', async () => {
    const { def, t } = await prep('baseline', 1);
    const ws = def.run_config.workspace;
    const by = (r: string) => def.roles.find((x) => x.id === r);
    for (const [w, mods] of Object.entries(OWNS)) {
      expect(by(w).policy.fileWrite).toEqual(mods.map((m) => `out/${m}/**`));
      const dw = by(w).policy.sandbox.denyWrite;
      expect(dw).toContain(join(ws, 'corpus'));
      for (const m of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'])
        expect(dw.includes(join(ws, 'out', m))).toBe(!mods.includes(m));
      expect(by(w).responsibilities.join(' ')).toMatch(new RegExp(`${mods[0]} and ${mods[1]}`));
    }
    expect(by('lead').policy.fileWrite).toEqual([]);
    expect(by('lead').policy.sandbox.denyWrite).toContain(ws);
    expect(by('synthesiser').policy.fileWrite).toEqual(['out/synthesis.json']);
    for (const r of def.roles) expect(r.policy.sandbox.denyWrite).toContain(t.guard[0]); // the immutable inputs
  });

  it('caps: the six role caps (twice on production), the single role up to the org-wide stop', async () => {
    const b = await prep('baseline', 1);
    for (const r of b.def.roles)
      expect(r.budget_usd).toBeCloseTo(CAPS[r.id] * PRICE_SCALE.production, 6);
    const s = await prep('single', 1);
    expect(s.def.roles[0].budget_usd).toBe(ORG_STOP_USD);
    expect(SOLO_CAPS).toEqual({ solver: 12 });
    expect(Object.keys(CAPS)).toEqual(b.def.roles.map((r) => r.id));
    const sum = Object.values(CAPS).reduce((a, x) => a + x, 0) * PRICE_SCALE.production;
    expect(sum).toBeGreaterThan(ORG_STOP_USD); // the org-wide stop is the worst case, not the sum of caps
  });

  it('baseline and treatment differ only by the prototype (a placeholder provider and one responsibilities line per sectioned role)', async () => {
    const b = await prep('baseline', 1);
    const t = await prep('treatment', 1);
    for (const rb of b.def.roles) {
      const rt = t.def.roles.find((x) => x.id === rb.id);
      // (the trial's own workspace path is plumbing: it differs per trial)
      const norm = (r) =>
        JSON.parse(
          JSON.stringify(r)
            .split(/\/trials\/smoke-parallel-sweep-phase2-p1[bt]\//)
            .join('/T/'),
        );
      const { tool_providers, responsibilities, ...restT } = norm(rt);
      const { responsibilities: respB, ...restB } = norm(rb);
      expect(restT).toEqual(restB);
      expect(!!tool_providers).toBe(!!rt.tool_providers);
      expect(norm(rt).policy).toEqual(norm(rb).policy); // the denial included
    }
  });
});

describe('the truth is hidden from every role', () => {
  it('truth.json and the fixture directory are denyRead on every role of every arm; the inputs and corpus are denyWrite', async () => {
    for (const arm of ['single', 'baseline', 'treatment'] as Arm[]) {
      const { def, t } = await prep(arm, 1);
      for (const r of def.roles) {
        expect(r.policy.sandbox.denyRead).toEqual([join(t.guard[0], 'truth.json'), fixtureDir]);
        const dw = r.policy.sandbox.denyWrite;
        expect(dw).toContain(t.guard[0]);
        expect(
          dw.includes(join(def.run_config.workspace, 'corpus')) ||
            dw.includes(def.run_config.workspace),
        ).toBe(true);
      }
      expect(def.run_config.workspace.startsWith(t.guard[0])).toBe(false); // the workspace is not inside the inputs
      expect(existsSync(join(def.run_config.workspace, 'truth.json'))).toBe(false);
    }
  });
});

describe('no node and no code-execution tool, on every role of every arm', () => {
  it.each(['single', 'baseline', 'treatment'] as Arm[])(
    '%s: the denial is on every role, including the lead and the synthesiser',
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
        expect(r.policy.allowTools).not.toContain('NotebookEdit');
        expect(r.policy.denyTools).toEqual(
          expect.arrayContaining(['NotebookEdit', 'REPL', 'Task', 'Agent']),
        );
      }
    },
  );

  it('survives pilotOrgDef and attachPilot unchanged', async () => {
    const b = await prep('baseline', 3);
    const pilot = JSON.parse(
      readFileSync(join(here, '../../../pilot/parallel-sweep.pilot.json'), 'utf8'),
    );
    const trial = {
      runId: 'tok',
      dir: scratch('sweep-pilot-'),
      routing: pilot.routing,
      contracts: pilot.contracts,
    };
    const treated = pilotOrgDef(structuredClone(b.def), trial);
    expect(noExecProblems(treated)).toEqual([]);
    for (const r of treated.roles)
      expect(r.policy).toEqual(b.def.roles.find((x) => x.id === r.id).policy);
    const daemon: any = {
      toolProviders: { buildRoleTools: async () => ({}) },
      deliver: async () => 'ok',
    };
    attachPilot(daemon, trial, 'tok');
    expect(noExecProblems(treated)).toEqual([]);
    expect(treated.roles.find((r) => r.id === 'worker-1').tool_providers[0].command).toBe('true'); // inert, and `true` is not masked
  });
});

/** A role's own shell, the way the runtime launches it: the role's policy through roleExecMask (the code
 *  session-run.ts calls), then the command in that mask, in the role's workspace. */
const asRole = (def, roleId: string, cmd: string, home: string) => {
  const r = def.roles.find((x) => x.id === roleId);
  const mask = roleExecMask({
    bus: new OrgBus('o', 'r', scratch('sweep-bus-')),
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
const which = (b: string) => {
  const r = spawnSync('sh', ['-c', `command -v ${b}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : undefined;
};

describe.runIf(authorityMaskAvailability().available && homeLayerAvailability().available)(
  'a role cannot change the home (real bubblewrap, every role of every arm)',
  () => {
    const arms: Array<[Arm, string]> = [
      ['single', 'solver'],
      ['baseline', 'lead'],
      ['baseline', 'worker-1'],
      ['baseline', 'worker-4'],
      ['baseline', 'synthesiser'],
      ['treatment', 'lead'],
      ['treatment', 'worker-2'],
      ['treatment', 'worker-3'],
      ['treatment', 'synthesiser'],
    ];
    it.each(arms)(
      '%s / %s: ~/f7.sh and every other way of writing in ~ never reach it',
      async (arm, roleId) => {
        const { def } = await prep(arm, 1);
        const home = scratch('sweep-home-');
        for (const d of ['.claude', '.codex', '.gemini', 'Documents'])
          mkdirSync(join(home, d), { recursive: true });
        writeFileSync(join(home, '.bashrc'), '# rc\n');
        const top = () => readdirSync(home).sort().join(',');
        const before = top();
        const ws = def.run_config.workspace;
        const attempts = [
          'echo x > ~/f7.sh',
          'cd "$TMPDIR" && cat > ~/f7.sh <<EOF\necho hi\nEOF',
          'touch ~/x; mkdir ~/d; ln -s /etc/hostname ~/l; cp ~/.bashrc ~/c; mv ~/.bashrc ~/.bashrc.old; rmdir ~/Documents',
          'echo {} > ~/.claude.json.tmp.1.abc; mv ~/.claude.json.tmp.1.abc ~/.claude.json',
        ];
        for (const cmd of attempts) asRole(def, roleId, cmd, home);
        expect(top()).toBe(before);
        expect(readFileSync(join(home, '.bashrc'), 'utf8')).toBe('# rc\n');
        expect(existsSync(join(home, 'f7.sh'))).toBe(false);
        // control: the runner's own directory and the role's workspace are really writable
        asRole(
          def,
          roleId,
          `echo s > ~/.codex/session.jsonl; echo w > '${ws}/out/home-probe.txt'`,
          home,
        );
        expect(readFileSync(join(home, '.codex/session.jsonl'), 'utf8')).toBe('s\n');
        expect(readFileSync(join(ws, 'out/home-probe.txt'), 'utf8')).toBe('w\n');
      },
    );
  },
);

describe.runIf(authorityMaskAvailability().available)(
  'a role cannot run the code (real bubblewrap, every role of every arm)',
  () => {
    const real = realpathSync(process.execPath);
    const nodes = [
      ...new Set([process.execPath, which('node'), '/usr/bin/node', real].filter(Boolean)),
    ].filter((p) => spawnSync('test', ['-x', p]).status === 0);
    const SENTINEL = /PROGRAM-RAN|^\d+\.\d+\.\d+/m;
    const arms: Array<[Arm, string]> = [
      ['single', 'solver'],
      ['baseline', 'lead'],
      ['baseline', 'worker-1'],
      ['baseline', 'worker-4'],
      ['baseline', 'synthesiser'],
      ['treatment', 'lead'],
      ['treatment', 'worker-2'],
      ['treatment', 'worker-3'],
      ['treatment', 'synthesiser'],
    ];

    it.each(arms)(
      '%s / %s: node, the corpus files, the absolute paths, env, sh -c, xargs, find -exec, copies, symlinks, python, perl, npm, npx all fail',
      async (arm, roleId) => {
        const { def, t } = await prep(arm, 1);
        const home = scratch('sweep-home-');
        const ws = def.run_config.workspace;
        const file = `corpus/m1/${readdirSync(join(ws, 'corpus/m1')).find((f) => f.endsWith('.mjs') && f !== 'config.mjs')}`;
        writeFileSync(join(ws, 'out', 'probe.mjs'), 'console.log("PROGRAM-RAN");\n');
        const attempts = [
          'node -e \'console.log("PROGRAM-RAN")\'',
          `node ${file}`,
          'node out/probe.mjs',
          'nodejs out/probe.mjs',
          'env node out/probe.mjs',
          "sh -c 'node out/probe.mjs'",
          `bash -c 'exec node out/probe.mjs'`,
          'echo out/probe.mjs | xargs node',
          'find out -name probe.mjs -exec node {} \\;',
          '"$(command -v node)" out/probe.mjs',
          ...nodes.flatMap((p) => [
            `'${p}' out/probe.mjs`,
            `'${p}' -e 'console.log("PROGRAM-RAN")'`,
          ]),
          `cp '${real}' out/n-copy; chmod +x out/n-copy; ./out/n-copy out/probe.mjs`,
          `cat '${real}' > out/n-cat; chmod +x out/n-cat; ./out/n-cat out/probe.mjs`,
          `ln -sf '${real}' out/n-link; ./out/n-link out/probe.mjs`,
          `cp /proc/${process.pid}/exe out/n-proc 2>/dev/null; chmod +x out/n-proc 2>/dev/null; ./out/n-proc out/probe.mjs`,
          'npm --version',
          'npx --version',
          'pnpm --version',
          'python3 -c \'print("PROGRAM-RAN")\'',
          'perl -e \'print "PROGRAM-RAN\\n"\'',
          'ruby -e \'puts "PROGRAM-RAN"\'',
        ];
        for (const cmd of attempts) {
          const r = asRole(def, roleId, cmd, home);
          expect([cmd, r.stdout.match(SENTINEL)?.[0]]).toEqual([cmd, undefined]);
          // (find -exec reports 0 whatever the command did, and an empty copy "runs" as an empty script: for those the
          // output above and the empty files below are the evidence)
          if (!/^(find |cp |cat )/.test(cmd) && !cmd.includes('2>/dev/null'))
            expect([cmd, r.status === 0]).toEqual([cmd, false]);
        }
        // the copies hold no program
        for (const f of ['n-copy', 'n-cat', 'n-proc'])
          expect(existsSync(join(ws, 'out', f)) ? readFileSync(join(ws, 'out', f)).length : 0).toBe(
            0,
          );
        // control: the same role's shell still works, and the program does run without the mask
        const ok = asRole(
          def,
          roleId,
          `ls corpus | head -3; cat ${file} | head -3; echo done`,
          home,
        );
        expect(ok.status).toBe(0);
        expect(ok.stdout).toContain('done');
        expect(
          spawnSync(process.execPath, [join(ws, 'out/probe.mjs')], { encoding: 'utf8' }).stdout,
        ).toContain('PROGRAM-RAN');
        // and the hidden truth and the fixture directory cannot be read by that role's shell
        const truth = asRole(
          def,
          roleId,
          `cat '${join(t.guard[0], 'truth.json')}' 2>&1; ls '${fixtureDir}' 2>&1; grep -rl '"synthesis"' '${t.guard[0]}' 2>/dev/null | head -2`,
          home,
        );
        expect(truth.stdout).not.toMatch(/"modules"|"synthesis"|score\.mjs|build-corpus/);
        // (the control: outside the mask both are readable)
        expect(readFileSync(join(t.guard[0], 'truth.json'), 'utf8')).toMatch(/"modules"/);
        expect(readdirSync(fixtureDir)).toContain('score.mjs');
      },
    );
  },
);

describe('check', () => {
  const run = async (variant: string | null, edit?: (ws: string) => void) => {
    const dir = scratch('sweep-check-');
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
    const units = await check({ workspace: ws, inputs: inputs() });
    return units;
  };
  const accepted = (u) => u.map((x) => x.accepted);

  it('the complete reference: 8 module sheets and the synthesis accepted, nothing critical', async () => {
    const u = await run('complete');
    expect(u).toHaveLength(9);
    expect(u.slice(0, 8).every((x) => x.unit === 'module-sheet')).toBe(true);
    expect(u[8].unit).toBe('synthesis');
    expect(accepted(u)).toEqual(Array(9).fill(true));
    expect(u.critical).toEqual([]);
    expect(u.map((x) => x.evidence.module)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
      'm6',
      'm7',
      'm8',
      undefined,
    ]);
  });
  it('the partial reference (what a time-limited single agent reaches): m1-m3 accepted, the rest and the synthesis not', async () => {
    const u = await run('partial');
    expect(accepted(u)).toEqual([true, true, true, false, false, false, false, false, false]);
    expect(u[3].evidence.failures[0]).toMatch(/m4: file is missing/);
    expect(u.critical).toEqual([]);
  });
  it('the wrong reference: all nine written, none accepted, and the evidence names no expected value', async () => {
    const u = await run('wrong');
    expect(accepted(u)).toEqual(Array(9).fill(false));
    expect(JSON.stringify(u)).not.toMatch(/expected/);
  });
  it('nothing written: nothing accepted', async () => {
    expect(accepted(await run(null))).toEqual(Array(9).fill(false));
  });
  it('11 of 12 exact accepts a sheet, 10 of 12 does not', async () => {
    const tweak = (n: number) => (ws: string) => {
      const p = join(ws, 'out/m1/answers.json');
      const doc = JSON.parse(readFileSync(p, 'utf8'));
      for (let i = 0; i < n; i++) doc.answers[i].value += 1;
      writeFileSync(p, JSON.stringify(doc));
    };
    expect((await run('complete', tweak(1)))[0].accepted).toBe(true);
    expect((await run('complete', tweak(2)))[0].accepted).toBe(false);
  });
  it('a sheet copied from another module, and an answer for a question that does not exist, are critical and ride on the unit', async () => {
    const u = await run('complete', (ws) => {
      const m1 = JSON.parse(readFileSync(join(ws, 'out/m1/answers.json'), 'utf8'));
      writeFileSync(join(ws, 'out/m2/answers.json'), JSON.stringify({ ...m1, module: 'm2' }));
      const m3 = JSON.parse(readFileSync(join(ws, 'out/m3/answers.json'), 'utf8'));
      m3.answers.push({ q: 'q99', value: 1, files: ['m3/a.mjs'] });
      writeFileSync(join(ws, 'out/m3/answers.json'), JSON.stringify(m3));
    });
    expect(u.critical.join('\n')).toMatch(/m1 and m2 carry identical answer lists|m1.*m2/);
    expect(u.critical.join('\n')).toMatch(/q99.*not a question/);
    expect(u[2].evidence.critical.join('\n')).toMatch(/q99/);
    expect(u[1].accepted).toBe(false);
  });
});

describe('the deliverable shapes are in the text every role receives', () => {
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
    it(`${arm}: every role's text carries the module-sheet and synthesis shapes and a worked example`, async () => {
      for (const { id: roleId, text } of await roleTexts(arm)) {
        for (const re of SHAPE) expect(text, `${arm}/${roleId} ${re}`).toMatch(re);
        expect(text).toMatch(/q01.*q12/);
        expect(text).toMatch(/s1.*s6/);
        expect(text).toMatch(/"q99"/);
        expect(text).toMatch(/no other keys/);
      }
    });

  it('baseline and treatment workers and the synthesiser are pointed at the shape in their own duty', async () => {
    for (const arm of ['baseline', 'treatment'] as Arm[])
      for (const { id: roleId, resp } of await roleTexts(arm))
        if (roleId.startsWith('worker') || roleId === 'synthesiser')
          expect(resp, `${arm}/${roleId}`).toMatch(/shape given in the task text/);
  });

  it('the worked example uses a made-up module and question and a fake value', () => {
    expect(TASK).toMatch(/"module":"m99"/);
    expect(TASK).toMatch(/"q":"q99","value":12345/);
    const truth = JSON.parse(readFileSync(join(inputs(), 'truth.json'), 'utf8'));
    expect(truth.modules.m99).toBeUndefined();
    const values = Object.values(truth.modules).flatMap((m: any) =>
      Object.values(m).map((x: any) => x.value),
    );
    expect(values).not.toContain(12345);
  });

  it('the text agrees with the treatment contracts (same keys, no extra keys, integer value)', () => {
    const pilot = JSON.parse(
      readFileSync(join(here, '../../../pilot/parallel-sweep.pilot.json'), 'utf8'),
    );
    for (const c of pilot.contracts) {
      expect(c.schema.required).toEqual(['module', 'answers']);
      expect(c.schema.properties.answers.items.required).toEqual(['q', 'value', 'files']);
      expect(c.schema.properties.answers.items.properties.value.type).toBe('integer');
      expect(c.schema.additionalProperties).toBe(false);
    }
    expect(TASK).toMatch(/value is an integer/);
    expect(TASK).toMatch(/files is a list of strings/);
  });

  describe("a sheet written per the text is accepted by the scorer, the failed trial's form is not", () => {
    const load = async () => {
      const { scoreModule, scoreSynthesis } = await import(join(fixtureDir, 'score.mjs'));
      const truth = JSON.parse(readFileSync(join(inputs(), 'truth.json'), 'utf8'));
      return { scoreModule, scoreSynthesis, truth };
    };
    it('{module, answers:[{q, value, files}]} and {answers:[{q, value}]} with real values are accepted', async () => {
      const { scoreModule, scoreSynthesis, truth } = await load();
      const sheet = {
        module: 'm1',
        answers: Object.entries(truth.modules.m1).map(([q, x]: [string, any]) => ({
          q,
          value: x.value,
          files: x.files,
        })),
      };
      expect(sheet.answers).toHaveLength(12);
      expect(scoreModule(sheet, truth, 'm1')).toMatchObject({ accepted: true, correct: 12 });
      const syn = {
        answers: Object.entries(truth.synthesis).map(([q, x]: [string, any]) => ({
          q,
          value: x.value,
        })),
      };
      expect(syn.answers.map((a) => a.q)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
      expect(scoreSynthesis(syn, truth)).toMatchObject({ accepted: true, correct: 6 });
    });
    it('a bare array is rejected', async () => {
      const { scoreModule, scoreSynthesis, truth } = await load();
      const bare = Object.entries(truth.modules.m1).map(([q, x]: [string, any]) => ({
        q,
        answer: x.value,
        files: x.files,
      }));
      expect(scoreModule(bare, truth, 'm1').accepted).toBe(false);
      const bareSyn = Object.entries(truth.synthesis).map(([q, x]: [string, any]) => ({
        q,
        value: x.value,
      }));
      expect(scoreSynthesis(bareSyn, truth).accepted).toBe(false);
    });
  });
});
