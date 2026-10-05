/**
 * #502 security review, round 5 (PR #515): signing approves no path; only
 * `org approve-paths <path>…` does, from a terminal, outside a role; a
 * committed worktree `.mcp.json` that differs from the main checkout is
 * flagged; the first look says what it trusted.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confirmAnswer = vi.hoisted(() => ({ value: true, asked: 0 }));
vi.mock('../../src/prompt.js', () => ({
  confirm: async () => {
    confirmAnswer.asked++;
    return confirmAnswer.value;
  },
}));

import { approvePathsAction } from '../../src/commands/org-approve-paths.js';
import { signAction } from '../../src/commands/org-sign.js';
import { AGENT_CONTEXT_ENV_MARKERS } from '../../src/orgrt/agent-context.js';
import { approvalCandidates, approvePaths } from '../../src/orgrt/plant-approvals.js';
import {
  PlantWatch,
  quarantineMessage,
  readConfigRecord,
  strayClaudeConfigs,
  worktreeMcpPlants,
  writeConfigRecord,
} from '../../src/orgrt/planted-paths.js';
import { setOrgSignatureEnforcement } from '../../src/orgrt/org-signature.js';
import type { CommandContext } from '../../src/types.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
let op: string;
let home: string;
beforeEach(() => {
  setOrgSignatureEnforcement(true);
  for (const k of AGENT_CONTEXT_ENV_MARKERS) vi.stubEnv(k, undefined);
  op = scratch('osr5-op-');
  home = scratch('osr5-home-');
  vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', op);
  vi.stubEnv('HOME', home);
  confirmAnswer.value = true;
  confirmAnswer.asked = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  setOrgSignatureEnforcement(false);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const ctx = (cwd: string, args: string[], flags: Record<string, unknown> = {}, interactive = false) =>
  ({ args, flags: { _: [], ...flags }, cwd, interactive }) as CommandContext;
const logged = () =>
  (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join('\n');

/** A project whose baseline recorded `.mcp.json` missing, which now exists. */
function withCandidate(): string {
  const root = scratch('osr5-root-');
  mkdirSync(join(root, '.monomind', 'orgs'), { recursive: true });
  writeFileSync(join(root, '.monomind', 'orgs', 'o.json'), JSON.stringify({ name: 'o', roles: [{ id: 'boss' }] }));
  new PlantWatch(root, 'o', () => {}, op).add({ home, env: {}, orgRoot: root, cwd: root });
  writeFileSync(join(root, '.mcp.json'), '{"mcpServers":{}}');
  return root;
}

describe('signing approves nothing', () => {
  it('org sign leaves a candidate a candidate, and its review warns about it', async () => {
    const root = withCandidate();
    expect((await signAction(ctx(root, ['o'], { yes: true }))).success).toBe(true);
    expect(approvalCandidates({ root })).toEqual([join(root, '.mcp.json')]);
    expect(logged()).toMatch(/would be quarantined as possible plants: .*\.mcp\.json .*org approve-paths/);
  });
});

describe('org approve-paths', () => {
  it('with no arguments lists the candidates and approves nothing', async () => {
    const root = withCandidate();
    const r = await approvePathsAction(ctx(root, []));
    expect(r.success).toBe(true);
    expect(logged()).toContain(join(root, '.mcp.json'));
    expect(approvalCandidates({ root })).toHaveLength(1);
  });

  it('approves exactly the named paths after a TTY confirmation', async () => {
    const root = withCandidate();
    expect((await approvePathsAction(ctx(root, ['.mcp.json'], {}, true))).success).toBe(true);
    expect(confirmAnswer.asked).toBe(1);
    expect(approvalCandidates({ root })).toEqual([]);
    expect(await new PlantWatch(root, 'o', () => {}, op).check()).toEqual([]);
    expect(existsSync(join(root, '.mcp.json'))).toBe(true);
  });

  it('refuses without a TTY, inside a role process tree, and when declined', async () => {
    const root = withCandidate();
    expect((await approvePathsAction(ctx(root, ['.mcp.json']))).message).toMatch(/no TTY/);
    vi.stubEnv('MONOMIND_ORG_ROLE', 'dev');
    expect((await approvePathsAction(ctx(root, ['.mcp.json'], {}, true))).message).toMatch(/role context/);
    vi.stubEnv('MONOMIND_ORG_ROLE', undefined);
    confirmAnswer.value = false;
    expect((await approvePathsAction(ctx(root, ['.mcp.json'], {}, true))).success).toBe(false);
    expect(approvalCandidates({ root })).toHaveLength(1);
  });

  it('the quarantine message points at approve-paths, not org sign', () => {
    const msg = quarantineMessage('o', [{ path: '/p/.mcp.json', quarantined: '/q/0-.mcp.json' }]);
    expect(msg).toContain("mv '/q/0-.mcp.json' '/p/.mcp.json' && monomind org approve-paths '/p/.mcp.json'");
    expect(msg).not.toMatch(/org sign/);
  });
});

describe('minor 1: a committed worktree .mcp.json', () => {
  it('is flagged when it differs from the main checkout’s HEAD:.mcp.json, or the main checkout has none', () => {
    const root = scratch('osr5-main-');
    const g = (cwd: string, ...a: string[]) =>
      spawnSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
    spawnSync('git', ['init', '-q', root]);
    writeFileSync(join(root, 'README'), 'x');
    g(root, 'add', 'README');
    g(root, 'commit', '-qm', 'init');
    const wt = join(root, '.monomind', 'orgs', 'o', 'work', 'src');
    g(root, 'worktree', 'add', '-q', wt);
    writeFileSync(join(wt, '.mcp.json'), '{"mcpServers":{"monomind":{"command":"evil"}}}');
    g(wt, 'add', '.mcp.json');
    g(wt, 'commit', '-qm', 'plant');
    expect(worktreeMcpPlants(root)).toEqual([join(wt, '.mcp.json')]); // main has none
    writeFileSync(join(root, '.mcp.json'), '{"mcpServers":{}}');
    g(root, 'add', '.mcp.json');
    g(root, 'commit', '-qm', 'mcp');
    expect(worktreeMcpPlants(root)).toEqual([join(wt, '.mcp.json')]); // differs
    writeFileSync(join(wt, '.mcp.json'), '{"mcpServers":{}}');
    g(wt, 'commit', '-qam', 'same');
    expect(worktreeMcpPlants(root)).toEqual([]);
  });
});

describe('minor 2: the first look says what it trusted', () => {
  it('on stderr and through the audit callback', () => {
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', '.config.json'), '{"numStartups":3}');
    const seen: string[][] = [];
    strayClaudeConfigs(home, {}, op, { onFirstLook: (_m, t) => seen.push(t) });
    expect(seen).toEqual([[join(home, '.claude', '.config.json')]]);
    const warned = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join('\n');
    expect(warned).toMatch(/first look .* trusting .*\.config\.json/);
    strayClaudeConfigs(home, {}, op, { onFirstLook: (_m, t) => seen.push(t) });
    expect(seen).toHaveLength(1); // once
  });
});

describe('merge with #517: operator-protected paths fold like every other deny', () => {
  it('.Claude/, .MCP.json and ~/.MONOMIND/org-skills are refused however they are spelled', async () => {
    const { OrgBus } = await import('../../src/orgrt/bus.js');
    const { PolicyEngine } = await import('../../src/orgrt/policy.js');
    const root = scratch('osr5-fold-');
    mkdirSync(join(home, '.monomind', 'org-skills'), { recursive: true });
    const bus = () => new OrgBus('o', 'r', scratch('osr5-bus-'));
    const p = new PolicyEngine('dev', {} as never, bus(), root, [root, home], root);
    for (const f of [
      join(root, '.Claude', 'settings.json'),
      join(root, '.MCP.json'),
      join(root, '.mcp.JSON'),
      join(home, '.MONOMIND', 'org-skills', 'x', 'SKILL.md'),
    ]) {
      expect((await p.decide('Write', { file_path: f, content: 'x' })).behavior, f).toBe('deny');
    }
    const plain = await p.decide('Write', { file_path: join(root, 'src', 'a.ts'), content: 'x' });
    expect(plain.behavior).toBe('allow');
    // A signed opt-in still opens only its own subtree, compared exactly.
    const optIn = new PolicyEngine(
      'dev',
      { sandbox: { allowWrite: ['.claude/skills'] } } as never,
      bus(),
      root,
      [root],
      root,
    );
    const ok = await optIn.decide('Write', { file_path: join(root, '.claude/skills/a.md'), content: 'x' });
    expect(ok.behavior).toBe('allow');
    const no = await optIn.decide('Write', { file_path: join(root, '.CLAUDE/settings.json'), content: 'x' });
    expect(no.behavior).toBe('deny');
  });
});

describe('#548: a Claude config before monomind’s first look', () => {
  const cfg = () => join(home, '.claude', '.config.json');
  const approval = (root: string) => ({ root, operatorDir: op, home, env: {} });
  beforeEach(() => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(cfg(), '{"numStartups":3}');
  });

  it('no record: not a candidate, cannot be approved, and org sign says it will be trusted', async () => {
    const root = scratch('osr5-548-');
    expect(approvalCandidates(approval(root))).toEqual([]);
    expect(approvePaths(approval(root), [cfg()])).toEqual({ approved: [], notCandidates: [cfg()] });
    expect(readConfigRecord(op)).toBeUndefined();
    mkdirSync(join(root, '.monomind', 'orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind', 'orgs', 'o.json'), JSON.stringify({ name: 'o', roles: [{ id: 'boss' }] }));
    expect((await signAction(ctx(root, ['o'], { yes: true }))).success).toBe(true);
    expect(logged()).not.toMatch(/would be quarantined/);
    expect(logged()).toContain(`will be trusted at monomind's first look: ${cfg()}`);
  });

  it('a record without the file: a candidate', () => {
    writeConfigRecord(op, { [home]: [] });
    expect(approvalCandidates(approval(scratch('osr5-548-')))).toEqual([cfg()]);
  });

  it('a record with the file: not a candidate', () => {
    writeConfigRecord(op, { [home]: [cfg()] });
    expect(approvalCandidates(approval(scratch('osr5-548-')))).toEqual([]);
  });
});
