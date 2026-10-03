// The kit-level no-code-execution denial (no-exec.mjs): what it puts on a role's policy, and that the
// runtime's own permission gate (the PolicyEngine) refuses what it should with that policy. The real
// bubblewrap runs of the same policy are in scenarios/parallel-sweep/kit.test.ts.
// @ts-nocheck: plain .mjs module
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgBus } from '../../../../packages/@monomind/cli/src/orgrt/bus.js';
import { PolicyEngine } from '../../../../packages/@monomind/cli/src/orgrt/policy.js';
import { RolePolicySchema } from '../../../../packages/@monomind/cli/src/orgrt/types-policy.js';
import {
  ALLOW_TOOLS,
  applyNoExec,
  DENY_EXEC,
  DENY_TOOLS,
  HOME_WRITE_ALLOW,
  noExecProblems,
} from './no-exec.mjs';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const def = () => ({
  name: 'x',
  roles: [
    {
      id: 'a',
      reports_to: null,
      policy: { fileWrite: ['out/**'], sandbox: { denyWrite: ['/w/corpus'], allowWrite: ['/z'] } },
    },
    { id: 'b', reports_to: 'a' },
  ],
});

describe('what is denied', () => {
  it.each([
    'node',
    'nodejs',
    'deno',
    'bun',
    'npm',
    'npx',
    'pnpm',
    'yarn',
    'corepack',
    'tsx',
    'python*',
    'perl*',
    'ruby*',
    'php*',
    'lua*',
    'tclsh*',
    'java',
    'go',
    'gcc*',
    'busybox',
  ])('the program %s', (name) => {
    expect(DENY_EXEC).toContain(name);
  });
  it('the code-execution tools, and the allowlist holds no other tool', () => {
    for (const t of ['NotebookEdit', 'REPL', 'Task', 'Agent', 'Skill', 'WebFetch', 'WebSearch'])
      expect(DENY_TOOLS).toContain(t);
    expect(ALLOW_TOOLS.filter((t) => DENY_TOOLS.includes(t))).toEqual([]);
    expect(ALLOW_TOOLS).toContain('Bash');
  });
});

describe('applyNoExec', () => {
  const out = applyNoExec(def(), { denyRead: ['/i/truth.json'] });
  it('puts the denial on every role and keeps what the role already had', () => {
    expect(noExecProblems(out)).toEqual([]);
    for (const r of out.roles) {
      expect(r.policy.sandbox.denyExec).toEqual(DENY_EXEC);
      expect(r.policy.sandbox.denyRead).toEqual(['/i/truth.json']);
      expect(r.policy.sandbox.mode).toBe('required');
      expect(r.policy.sandbox.homeWriteAllow).toEqual(HOME_WRITE_ALLOW);
      expect(r.policy.sandbox.allowedDomains).toEqual(['localhost']);
      expect(r.policy.allowTools).toEqual(ALLOW_TOOLS);
      expect(r.policy.denyTools).toEqual(expect.arrayContaining(DENY_TOOLS));
      expect(() => RolePolicySchema.parse(r.policy)).not.toThrow();
    }
    expect(out.roles[0].policy.fileWrite).toEqual(['out/**']);
    expect(out.roles[0].policy.sandbox.denyWrite).toEqual(['/w/corpus']);
    expect(out.roles[0].policy.sandbox.allowWrite).toEqual(['/z']);
  });
  it('does not mutate its input and is idempotent', () => {
    const d = def();
    applyNoExec(d);
    expect(d.roles[1].policy).toBeUndefined();
    expect(applyNoExec(out)).toEqual(out);
  });
  it('noExecProblems names a role that lacks any part of it', () => {
    const bad = structuredClone(out);
    delete bad.roles[1].policy.sandbox.denyExec;
    bad.roles[0].policy.allowTools.push('NotebookEdit');
    bad.roles[0].policy.sandbox.mode = 'auto';
    const p = noExecProblems(bad).join('\n');
    expect(p).toMatch(/role b: no policy.sandbox.denyExec/);
    expect(p).toMatch(/role a: allowTools admits NotebookEdit/);
    expect(p).toMatch(/role a: sandbox mode is auto/);
  });
  it('the home write-deny is on every role, with exactly the documented allowlist', () => {
    expect(HOME_WRITE_ALLOW).toEqual(['.claude', '.codex', '.gemini']);
    const bad = structuredClone(out);
    delete bad.roles[0].policy.sandbox.homeWriteAllow;
    bad.roles[1].policy.sandbox.homeWriteAllow = ['.claude', '.ssh'];
    const p = noExecProblems(bad).join('\n');
    expect(p).toMatch(/role a: homeWriteAllow is null/);
    expect(p).toMatch(/role b: homeWriteAllow is \["\.claude","\.ssh"\]/);
  });
});

describe('the permission gate with that policy', () => {
  const engine = () => {
    const role = applyNoExec(def()).roles[0];
    const e = new PolicyEngine(
      role.id,
      role.policy,
      new OrgBus('o', 'r', scratch('ne-bus-')),
      scratch('ne-cwd-'),
    );
    e.setOsSandboxed(true);
    e.setToolContext?.({ providerPrefixes: () => ['pilot__'] });
    return e;
  };
  it.each([
    ['NotebookEdit', { notebook_path: 'x.ipynb' }],
    ['REPL', { code: '1' }],
    ['Task', { prompt: 'x' }],
    ['Agent', { prompt: 'x' }],
    ['Skill', { skill: 'x' }],
    ['WebFetch', { url: 'https://nodejs.org' }],
    ['mcp__some__run_code', { code: '1' }],
    ['mcp__ide__executeCode', { code: '1' }],
    ['Bash', { command: 'node -e 1' }],
    ['Bash', { command: 'python3 -c 1' }],
    ['Bash', { command: 'sh -c "env node x"' }],
  ])('refuses %s', async (tool, input) => {
    expect((await engine().decide(tool, input)).behavior).toBe('deny');
  });
  it.each([
    ['Bash', { command: 'ls corpus' }],
    ['Bash', { command: 'grep -rn node corpus/m1' }],
    ['mcp__org__org_send', { to: 'x', subject: 's', body: 'b' }],
    ['pilot__doc_publish', { doc: 'x' }],
  ])('still allows %s', async (tool, input) => {
    expect((await engine().decide(tool, input)).behavior).toBe('allow');
  });
});
