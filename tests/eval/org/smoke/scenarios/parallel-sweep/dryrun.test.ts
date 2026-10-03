// A dry run of every arm through the REAL org daemon with a scripted stand-in for the SDK's query(): no model,
// no spend. It shows that what prepare writes reaches each role's session the way the runtime builds it: the
// options each role's query() receives carry the sandbox with a localhost-only network, and the process
// launcher the runtime hands the SDK (spawnClaudeCodeProcess) runs a command inside the denial layer, so
// `node` fails there; the permission gate (canUseTool) refuses the code-execution tools and a Bash command
// naming a denied program. The role's own launch path, not a re-implementation of it.
// @ts-nocheck: plain .mjs modules
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorityMaskAvailability } from '../../../../../../packages/@monomind/cli/src/orgrt/authority-mask.js';
import { setOrgSignatureEnforcement } from '../../../../../../packages/@monomind/cli/src/orgrt/org-signature-enforcement.js';
import { preparePilotTrial } from '../../../pilot/prepare.js';
import { runOrg } from '../../../pilot/run-org.js';
import { scriptedSdk } from '../../../support/scripted.js';
import { buildInputs as buildBase } from '../../prepare.mjs';
import { id } from './kit.mjs';

const scratch = (p: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), p)));
let tmp: string;
let base: string;
beforeAll(async () => {
  tmp = scratch('sweep-dry-');
  base = join(tmp, 'base');
  await buildBase({ scenario: id, base });
  setOrgSignatureEnforcement(false); // a fixture org, as in the package's own suites
});
afterAll(() => {
  spawnSync('chmod', ['-R', 'u+w', tmp]);
  rmSync(tmp, { recursive: true, force: true });
});

async function dryRun(arm: 'single' | 'baseline' | 'treatment') {
  const root = await preparePilotTrial({ scenario: id, base, arm, n: 9 });
  const t = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
  const roles: string[] = JSON.parse(
    readFileSync(join(root, '.monomind/orgs', `${t.name}.json`), 'utf8'),
  ).roles.map((r: any) => r.id);
  const boss = roles[0];
  const others = roles.slice(1);
  const sdk = scriptedSdk((role, turn) => {
    if (role === boss && others.length === 0)
      return { tools: [{ name: 'org_complete', args: { outcome: 'achieved', summary: 'done' } }] };
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
          }
        : undefined,
    queryFn: sdk.queryFn,
    pollMs: 50,
  });
  return { sdk, roles, t };
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
  'the three arms through the real daemon, scripted',
  () => {
    it.each(['single', 'baseline', 'treatment'] as const)(
      "%s: every role's session carries the sandbox, the gate and the denial layer",
      async (arm) => {
        const { sdk, roles } = await dryRun(arm);
        expect([...sdk.options.keys()].sort()).toEqual([...roles].sort()); // every role really started
        const probe = join(tmp, 'probe.mjs');
        spawnSync('sh', ['-c', `echo 'console.log("PROGRAM-RAN")' > '${probe}'`]);
        for (const role of roles) {
          const o = sdk.options.get(role)![0];
          expect(o.sandbox?.enabled).toBe(true);
          expect(o.sandbox.network.allowedDomains).toEqual(['localhost']);
          expect(o.sandbox.network.strictAllowlist).toBe(true);
          expect(o.disallowedTools).toEqual(expect.arrayContaining(['Task', 'Agent']));
          // the process launcher: the Claude process (and so every command its Bash runs) is inside the mask
          expect(typeof o.spawnClaudeCodeProcess).toBe('function');
          const ran = await launch(
            o,
            `node '${probe}'; /usr/bin/node '${probe}' 2>&1; python3 -c 'print("PROGRAM-RAN")' 2>&1; echo alive`,
          );
          expect(ran).not.toContain('PROGRAM-RAN');
          expect(ran).toContain('alive'); // the launcher itself works
          // the permission gate with this role's policy
          const gate = (tool: string, input: object) =>
            o.canUseTool(tool, input, { toolUseID: 'x' });
          for (const [tool, input] of [
            ['NotebookEdit', { notebook_path: 'a.ipynb' }],
            ['REPL', { code: '1' }],
            ['Task', { prompt: 'x' }],
            ['Bash', { command: 'node -e 1' }],
            ['Bash', { command: 'sh -c "env python3 x"' }],
            ['WebFetch', { url: 'https://nodejs.org' }],
          ] as const)
            expect((await gate(tool, input)).behavior).toBe('deny');
          expect((await gate('Bash', { command: 'ls corpus' })).behavior).toBe('allow');
        }
      },
    );
  },
);
