// parallel-sweep-3 (the hand-off decision variant). A dry run of both arms through the REAL org daemon with a scripted
// stand-in for the SDK's query(): no model, no spend. Every role of both arms must carry the no-node denial and the
// home write-deny as the runtime builds each session, and in the treatment arm the synthesiser's own launched
// process must see out/<module>/ empty (the hand-off layer is its only path) while the plan stays hidden from every role.
// @ts-nocheck: plain .mjs modules
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorityMaskAvailability } from '../../../../../../packages/@monomind/cli/src/orgrt/authority-mask.js';
import { setOrgSignatureEnforcement } from '../../../../../../packages/@monomind/cli/src/orgrt/org-signature-enforcement.js';
import { preparePilotTrial } from '../../../pilot/prepare.js';
import { runOrg } from '../../../pilot/run-org.js';
import { scriptedSdk } from '../../../support/scripted.js';
import { DENY_EXEC, HOME_WRITE_ALLOW } from '../../no-exec.mjs';
import { buildInputs as buildBase } from '../../prepare.mjs';
import { EVAL_DIR, id, MAX_CONCURRENT_AGENTS } from './kit.mjs';

const scratch = (p: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), p)));
let tmp: string;
let base: string;
beforeAll(async () => {
  tmp = scratch('sweep3-dry-');
  base = join(tmp, 'base');
  await buildBase({ scenario: id, base });
  setOrgSignatureEnforcement(false); // a fixture org, as in the package's own suites
});
afterAll(() => {
  spawnSync('chmod', ['-R', 'u+w', tmp]);
  rmSync(tmp, { recursive: true, force: true });
});

async function dryRun(arm: 'baseline' | 'treatment', n = 9) {
  const root = await preparePilotTrial({ scenario: id, base, arm, n });
  const t = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
  const roles: string[] = JSON.parse(
    readFileSync(join(root, '.monomind/orgs', `${t.name}.json`), 'utf8'),
  ).roles.map((r: any) => r.id);
  const boss = roles[0];
  const others = roles.slice(1);
  const sdk = scriptedSdk((role, turn) => {
    if (role === boss)
      return turn === 0
        ? {
            tools: others.map((to) => ({
              name: 'org_send',
              args: { to, subject: 'start', message: 'go' },
            })),
          }
        : turn >= others.length
          ? { tools: [{ name: 'org_complete', args: { outcome: 'achieved', summary: 'done' } }] }
          : {};
    return turn === 0
      ? { tools: [{ name: 'org_send', args: { to: boss, subject: 'ok', message: 'done' } }] }
      : {};
  });
  await runOrg({
    root,
    name: t.name,
    task: t.task,
    pilot:
      arm === 'treatment'
        ? {
            runId: t.pilot.runId,
            dir: t.pilot.dir,
            routing: t.pilot.routing,
            contracts: t.pilot.contracts,
            faults: t.pilot.faults,
          }
        : undefined,
    queryFn: sdk.queryFn,
    pollMs: 50,
  });
  const def = JSON.parse(readFileSync(join(root, '.monomind/orgs', `${t.name}.json`), 'utf8'));
  return { sdk, roles, t, def, root };
}

/** Run `cmd` as the SDK's own launcher runs the role's process, and return what it printed. */
const launch = (opts: any, cmd: string): Promise<string> =>
  new Promise((resolve) => {
    const child = opts.spawnClaudeCodeProcess({
      command: 'sh',
      args: ['-c', cmd],
      cwd: tmp,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      signal: new AbortController().signal,
    });
    let out = '';
    child.stdout?.on('data', (d: Buffer) => (out += d));
    child.on('close', () => resolve(out));
  });

describe.runIf(authorityMaskAvailability().available)(
  'both arms through the real daemon, scripted',
  () => {
    it.each(['baseline', 'treatment'] as const)(
      "%s: all 10 roles start, and every role's session carries the sandbox, the gate, the denial layer and the home write-deny",
      async (arm) => {
        const { sdk, roles, def } = await dryRun(arm);
        expect([...sdk.options.keys()].sort()).toEqual([...roles].sort()); // every role really started
        expect(roles).toHaveLength(10);
        expect(def.run_config.max_concurrent_agents).toBeGreaterThanOrEqual(10);
        expect(MAX_CONCURRENT_AGENTS).toBeGreaterThanOrEqual(10);
        const probe = join(tmp, 'probe.mjs');
        spawnSync('sh', ['-c', `echo 'console.log("PROGRAM-RAN")' > '${probe}'`]);
        for (const role of roles) {
          const o = sdk.options.get(role)![0];
          const policy = def.roles.find((r: any) => r.id === role).policy;
          expect(policy.sandbox.homeWriteAllow).toEqual(HOME_WRITE_ALLOW);
          expect(policy.sandbox.denyExec).toEqual(DENY_EXEC);
          expect(o.sandbox?.enabled).toBe(true);
          expect(o.sandbox.network.allowedDomains).toEqual(['localhost']);
          expect(o.disallowedTools).toEqual(expect.arrayContaining(['Task', 'Agent']));
          const ran = await launch(
            o,
            `node '${probe}'; /usr/bin/node '${probe}' 2>&1; python3 -c 'print("PROGRAM-RAN")' 2>&1; echo alive`,
          );
          expect(ran).not.toContain('PROGRAM-RAN');
          expect(ran).toContain('alive');
          expect(o.sandbox.filesystem.allowWrite).toContain(process.env.HOME);
          const home = process.env.HOME as string;
          const wrote = await launch(o, `echo x > ~/f7-${role}.sh; touch ~/touched3; echo alive`);
          expect(wrote).toContain('alive');
          const gate = (tool: string, input: object) =>
            o.canUseTool(tool, input, { toolUseID: 'x' });
          for (const [tool, input] of [
            ['NotebookEdit', { notebook_path: 'a.ipynb' }],
            ['Task', { prompt: 'x' }],
            ['Bash', { command: 'node -e 1' }],
            ['WebFetch', { url: 'https://nodejs.org' }],
          ] as const)
            expect((await gate(tool, input)).behavior).toBe('deny');
          expect((await gate('Bash', { command: 'ls corpus' })).behavior).toBe('allow');
          void home;
        }
      },
    );

    it("treatment: the synthesiser's own launched process sees out/<module>/ empty, the lead's and a worker's do not, and nobody sees the plan", async () => {
      const { sdk, root, def } = await dryRun('treatment', 8);
      const ws = def.run_config.workspace;
      for (const m of ['m1', 'm32'])
        writeFileSync(join(ws, 'out', m, 'answers.json'), '{"module":"x"}');
      mkdirSync(join(root, 'pilot-state'), { recursive: true });
      writeFileSync(join(root, 'pilot-state/pilot-events.jsonl'), 'SECRET-FAULT\n');
      const as = (role: string, cmd: string) => launch(sdk.options.get(role)![0], cmd);
      expect(
        await as(
          'synthesiser',
          `cat '${ws}/out/m1/answers.json' '${ws}/out/m32/answers.json' 2>&1; echo end`,
        ),
      ).not.toContain('"module"');
      expect(await as('synthesiser', `ls '${ws}/corpus/m1' | head -1`)).toMatch(/\S/); // the corpus stays readable
      expect(await as('worker-1', `cat '${ws}/out/m1/answers.json'`)).toContain('"module"');
      expect(await as('lead', `cat '${ws}/out/m32/answers.json'`)).toContain('"module"');
      for (const role of def.roles.map((r: any) => r.id)) {
        expect(
          await as(role, `cat '${join(root, 'pilot-state/pilot-events.jsonl')}' 2>/dev/null`),
        ).not.toMatch(/SECRET-FAULT/);
        expect((await as(role, `ls '${EVAL_DIR}' 2>/dev/null`)).trim()).toBe('');
        expect(await as(role, `cat '${join(root, 'trial.json')}' 2>/dev/null`)).not.toMatch(
          /"faults"/,
        );
      }
    });
  },
);
