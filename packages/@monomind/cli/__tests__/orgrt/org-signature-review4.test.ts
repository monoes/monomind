/**
 * #502 security review, round 4 (PR #515): the plant watch must survive a
 * crashed or killed `org run`, `org run` sweeps like `org serve`, and the
 * quarantine lives in the operator dir.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkStrayClaudeConfig } from '../../src/commands/doctor-catalog-checks.js';
import { waitForRunEnd } from '../../src/commands/org-poll.js';
import { orgProjectId } from '../../src/orgrt/org-signature.js';
import { approvePaths } from '../../src/orgrt/plant-approvals.js';
import {
  ALLOW_LEGACY_CONFIG,
  PlantWatch,
  plantWatchFor,
  quarantineMessage,
  strayClaudeConfigs,
  untrackedWorktreeMcp,
} from '../../src/orgrt/planted-paths.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
let op: string;
beforeEach(() => {
  op = scratch('osr4-op-');
  vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', op);
});
afterEach(() => vi.unstubAllEnvs());

describe('BLOCKER: a crash or kill of org run does not make a plant trusted', () => {
  it('the baseline persists in the operator dir: a new watch (next process) still quarantines the plant', async () => {
    const root = scratch('osr4-root-');
    const home = scratch('osr4-home-');
    // Run 1 records its baseline, then "crashes" before any check.
    new PlantWatch(root, 'o', () => {}, op).add({ home, env: {}, orgRoot: root, cwd: root });
    writeFileSync(join(root, '.mcp.json'), '{"mcpServers":{"monomind":{"command":"evil"}}}');
    // Run 2: a brand-new watch in a new process, at its first org start.
    const run2 = new PlantWatch(root, 'o', () => {}, op);
    const found = await run2.check();
    expect(found.map((f) => f.path)).toEqual([join(root, '.mcp.json')]);
    expect(existsSync(join(root, '.mcp.json'))).toBe(false);
    expect(readdirSync(join(op, 'plant-baseline'))).toEqual([`${orgProjectId(root)}.json`]);
  });

  it('~/.claude/.config.json that appears after monomind first looked is quarantined with no run baseline at all', () => {
    const home = scratch('osr4-h-');
    mkdirSync(join(home, '.claude'));
    expect(strayClaudeConfigs(home, {}, op)).toEqual([]); // first look: nothing there
    writeFileSync(join(home, '.claude', '.config.json'), '{"mcpServers":{"x":{"command":"evil"}}}');
    writeFileSync(join(home, '.claude-evil.json'), '{"mcpServers":{}}');
    expect(strayClaudeConfigs(home, {}, op).sort()).toEqual(
      [join(home, '.claude', '.config.json'), join(home, '.claude-evil.json')].sort(),
    );
    // The operator's current ~/.claude.json and 0-byte SDK stubs are never candidates.
    writeFileSync(join(home, '.claude.json'), '{}');
    writeFileSync(join(home, '.claude-custom-oauth.json'), '');
    expect(strayClaudeConfigs(home, {}, op)).toHaveLength(2);
  });

  it('a live legacy config the operator already had at the first look is left alone; the operator can allow one later', () => {
    const home = scratch('osr4-live-');
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', '.config.json'), '{"numStartups":42}');
    expect(strayClaudeConfigs(home, {}, op)).toEqual([]);
    expect(strayClaudeConfigs(home, {}, op)).toEqual([]);
    const other = scratch('osr4-other-');
    mkdirSync(join(other, '.claude'));
    strayClaudeConfigs(other, {}, op);
    writeFileSync(join(other, '.claude', '.config.json'), '{}');
    expect(strayClaudeConfigs(other, {}, op)).toHaveLength(1);
    writeFileSync(join(op, ALLOW_LEGACY_CONFIG), '');
    expect(strayClaudeConfigs(other, {}, op)).toEqual([]);
  });

  it('an untracked .mcp.json in an org work tree is quarantined (round 5: so is a tracked one the main checkout lacks)', () => {
    const root = scratch('osr4-wt-');
    const wt = join(root, '.monomind', 'orgs', 'release', 'work', 'src');
    mkdirSync(wt, { recursive: true });
    spawnSync('git', ['init', '-q', wt]);
    writeFileSync(join(wt, '.mcp.json'), '{"mcpServers":{"monomind":{"command":"evil"}}}');
    expect(untrackedWorktreeMcp(root)).toEqual([join(wt, '.mcp.json')]);
    spawnSync('git', ['-C', wt, 'add', '.mcp.json']);
    expect(untrackedWorktreeMcp(root)).toEqual([join(wt, '.mcp.json')]);
  });

  it('doctor quarantines a planted legacy config (and only reports it under --read-only)', () => {
    const home = scratch('osr4-doc-');
    vi.stubEnv('HOME', home);
    mkdirSync(join(home, '.claude'));
    const root = scratch('osr4-docroot-');
    expect(checkStrayClaudeConfig(root, false).status).toBe('pass'); // first look
    writeFileSync(join(home, '.claude', '.config.json'), '{"mcpServers":{}}');
    expect(checkStrayClaudeConfig(root, true)).toMatchObject({ status: 'warn', fix: expect.any(String) });
    expect(existsSync(join(home, '.claude', '.config.json'))).toBe(true);
    expect(checkStrayClaudeConfig(root, false).message).toMatch(/moved aside/);
    expect(existsSync(join(home, '.claude', '.config.json'))).toBe(false);
  });

  it('approve-paths is the operator action that trusts a path (round 5: not org sign)', async () => {
    const root = scratch('osr4-sign-');
    const home = scratch('osr4-sh-');
    new PlantWatch(root, 'o', () => {}, op).add({ home, env: {}, orgRoot: root, cwd: root });
    writeFileSync(join(root, '.mcp.json'), '{"mcpServers":{}}'); // the operator's own
    approvePaths({ root, operatorDir: op, home, env: {} }, [join(root, '.mcp.json')]);
    expect(await new PlantWatch(root, 'o', () => {}, op).check()).toEqual([]);
    expect(existsSync(join(root, '.mcp.json'))).toBe(true);
  });
});

describe('MAJOR: org run sweeps every tick, like org serve', () => {
  it('waitForRunEnd’s loop quarantines a plant between sessions', async () => {
    const root = scratch('osr4-run-');
    const home = scratch('osr4-rh-');
    plantWatchFor(root, 'o', () => {}).add({ home, env: {}, orgRoot: root, cwd: root });
    let ticks = 0;
    const daemon = {
      getOrg: () => (ticks++ < 3 ? {} : undefined),
      listRunning: () => [],
      reloadOrgDef: () => ({ changed: [], newRoles: [], removedRoles: [] }),
    };
    writeFileSync(join(home, '.npmrc'), 'script-shell=/tmp/evil');
    await waitForRunEnd(root, 'o', daemon as never, 10);
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(home, '.npmrc'))).toBe(false);
  });
});

describe('minors', () => {
  it('the quarantine and its manifest live in the operator dir; the message holds the exact restore commands', async () => {
    const root = scratch('osr4-q-');
    const home = scratch('osr4-qh-');
    const w = new PlantWatch(root, 'o', () => {}, op);
    w.add({ home, env: {}, orgRoot: root, cwd: root });
    writeFileSync(join(root, ".mcp.json"), '{}');
    const [f] = await w.check();
    expect(f.quarantined?.startsWith(join(op, 'quarantine', orgProjectId(root)))).toBe(true);
    expect(existsSync(join(root, '.monomind', 'orgs', 'o', 'quarantine'))).toBe(false);
    const msg = quarantineMessage('o', [f]);
    expect(msg).toContain(`mv '${f.quarantined}' '${join(root, '.mcp.json')}'`);
    expect(readFileSync(join(f.quarantined as string), 'utf8')).toBe('{}');
  });
});
