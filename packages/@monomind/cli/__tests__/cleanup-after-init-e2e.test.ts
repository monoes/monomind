/**
 * GH #401: a default `init` followed by `cleanup --force --purge-data` left
 * .claude/settings.json running 17 hooks from the deleted .claude/helpers/
 * (every prompt and tool call then failed), plus monomind MCP entries and
 * ~280 converted agent/command files the init manifest did not record.
 *
 * Real init into a temp git repo, then real cleanup. child_process is mocked
 * like init-e2e.test.ts, except `git`, which cleanup needs to find tracked files.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupCommand } from '../src/commands/cleanup.js';
import { helperRefs } from '../src/commands/cleanup-config-edits.js';
import type { CleanupPlanEntry } from '../src/commands/cleanup-plan.js';
import { initCommand } from '../src/commands/init.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

output.setVerbosity('quiet');

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const refuse = () => {
    throw new Error('mocked: no real process execution in tests');
  };
  return {
    execSync: vi.fn(refuse),
    execFileSync: vi.fn((cmd: string, args: string[], opts: object) =>
      cmd === 'git' ? actual.execFileSync(cmd, args, opts) : refuse(),
    ),
    exec: vi.fn(refuse),
    execFile: vi.fn(refuse),
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
      proc.unref = () => {};
      proc.kill = () => {};
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      return proc;
    }),
  };
});

const USER_HOOK = 'node .claude/helpers/my-own-tool.cjs';

describe('cleanup after init leaves no config pointing at removed monomind files (#401)', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;

  const ctx = (flags: Record<string, unknown>): CommandContext =>
    ({ args: [], flags: { _: [], ...flags }, cwd: tmpDir, interactive: false }) as CommandContext;
  const abs = (rel: string) => path.join(tmpDir, ...rel.split('/'));
  const read = (rel: string) => fs.readFileSync(abs(rel), 'utf8');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-cleanup-e2e-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-cleanup-e2e-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
    const { execFileSync } = await vi.importActual<typeof import('node:child_process')>(
      'node:child_process',
    );
    execFileSync('git', ['init', '-q'], { cwd: tmpDir });
    // The user's own settings and helper, there before init.
    fs.mkdirSync(abs('.claude/helpers'), { recursive: true });
    fs.writeFileSync(abs('.claude/helpers/my-own-tool.cjs'), '// mine\n');
    fs.writeFileSync(
      abs('.claude/settings.json'),
      JSON.stringify({
        myTeamSetting: 'keep-me',
        hooks: { Stop: [{ hooks: [{ type: 'command', command: USER_HOOK }] }] },
      }),
    );
  });

  afterEach(async () => {
    try {
      const bridge = await import('../src/memory/memory-bridge.js');
      await bridge.shutdownBridge();
    } catch {}
    process.env.HOME = realHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('strips dangling hooks, statusLines and MCP entries; keeps user hooks and keys', async () => {
    // --force merges monomind's hooks into the existing settings.json (a plain
    // re-run only backfills hooks when there are none).
    const init = await initCommand.action!(
      ctx({ force: true, 'no-watch': true, 'no-start-all': true, 'all-platforms': true }),
    );
    expect(init.success, JSON.stringify(init)).toBe(true);
    expect(read('.claude/settings.json')).toContain('.claude/helpers/hook-handler.cjs');
    for (const dir of ['.opencode/agent', '.opencode/command', '.kimi-code/agents']) {
      expect(fs.readdirSync(abs(dir)).length).toBeGreaterThan(0);
    }

    // Dry run: the same plan, listing the settings edit, touching nothing.
    const before = read('.claude/settings.json');
    const preview = await cleanupCommand.action!(ctx({ 'purge-data': true }));
    const plan = (preview.data as { plan: CleanupPlanEntry[] }).plan;
    const planned = (rel: string) => plan.find((e) => e.path === rel)?.action;
    expect(planned('.claude/settings.json')).toBe('strip');
    // init wrote .codex/config.toml and nobody edited it: removed whole.
    expect(plan.find((e) => e.path === '.codex' || e.path === '.codex/config.toml')?.action).toBe(
      'remove',
    );
    expect(planned('.kimi-code/mcp.json')).toBe('remove');
    expect(read('.claude/settings.json')).toBe(before);

    const res = await cleanupCommand.action!(ctx({ force: true, 'purge-data': true }));
    expect(res.success).toBe(true);

    // No surviving settings/config file runs a helper that is no longer there.
    const isConfig = (rel: string) =>
      /(^|\/)(settings(\.local)?\.json|mcp\.json|\.mcp\.json|opencode\.json|[^/]*\.plugin\.json|[^/]*\.toml)$/.test(
        rel,
      );
    const remaining: string[] = [];
    const walk = (rel: string) => {
      for (const e of fs.readdirSync(abs(rel), { withFileTypes: true })) {
        const child = rel === '.' ? e.name : `${rel}/${e.name}`;
        if (e.name === '.git') continue;
        if (e.isDirectory()) walk(child);
        else if (isConfig(child)) remaining.push(child);
      }
    };
    walk('.');
    expect(remaining).toContain('.claude/settings.json');
    for (const rel of remaining) {
      for (const ref of helperRefs(read(rel))) {
        expect(fs.existsSync(abs(ref)), `${rel} runs missing ${ref}`).toBe(true);
      }
    }

    // User content survives.
    const settings = JSON.parse(read('.claude/settings.json'));
    expect(settings.myTeamSetting).toBe('keep-me');
    expect(settings.hooks).toEqual({
      Stop: [{ hooks: [{ type: 'command', command: USER_HOOK }] }],
    });
    expect(settings.statusLine).toBeUndefined();
    expect(fs.existsSync(abs('.claude/helpers/my-own-tool.cjs'))).toBe(true);

    // No monomind MCP server entry remains anywhere.
    for (const rel of ['.mcp.json', '.kimi-code/mcp.json']) {
      if (fs.existsSync(abs(rel))) expect(JSON.parse(read(rel)).mcpServers?.monomind).toBeUndefined();
    }
    if (fs.existsSync(abs('opencode.json'))) {
      const oc = JSON.parse(read('opencode.json'));
      expect(oc.mcp?.monomind).toBeUndefined();
      expect(Object.keys(oc.permission?.bash ?? {}).filter((k) => k.includes('monomind'))).toEqual(
        [],
      );
    }
    if (fs.existsSync(abs('.codex/config.toml'))) {
      expect(read('.codex/config.toml')).not.toMatch(/mcp_servers\.monomind|monomind-hook/);
    }
    expect(fs.existsSync(abs('.gemini/settings.json'))).toBe(false);

    // Converted mirrors are recorded by init, so cleanup could prove they were ours.
    for (const dir of ['.opencode/agent', '.opencode/command', '.kimi-code/agents']) {
      expect(fs.existsSync(abs(dir)), dir).toBe(false);
    }
  }, 120000);

  it('keeps the helpers a git-tracked settings.json runs, with the manual edit (#448)', async () => {
    const init = await initCommand.action!(
      ctx({ force: true, 'no-watch': true, 'no-start-all': true, 'all-platforms': true }),
    );
    expect(init.success, JSON.stringify(init)).toBe(true);
    const { execFileSync } = await vi.importActual<typeof import('node:child_process')>(
      'node:child_process',
    );
    const git = (...args: string[]) => execFileSync('git', args, { cwd: tmpDir });
    git('add', '.claude/settings.json');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'settings');
    const before = read('.claude/settings.json');
    const refs = helperRefs(before);
    expect(refs).toContain('.claude/helpers/hook-handler.cjs');

    // The dry run already shows what is kept and the edit left to the user.
    const lines: string[] = [];
    const spy = vi.spyOn(output, 'writeln').mockImplementation((t?: string) => {
      lines.push(String(t ?? ''));
    });
    const preview = await cleanupCommand.action!(ctx({ 'purge-data': true }));
    spy.mockRestore();
    const plan = (preview.data as { plan: CleanupPlanEntry[] }).plan;
    expect(plan.find((e) => e.path === '.claude/settings.json')).toMatchObject({
      action: 'skip',
      reason: 'tracked by git',
    });
    const notice = plan.find((e) => e.path === '.claude/settings.json')?.notice ?? '';
    expect(notice).toContain('.claude/helpers');
    expect(notice).toContain('.claude/helpers/hook-handler.cjs');
    expect(lines.join('\n')).toContain(notice);
    const covering = (ref: string) =>
      plan.filter((e) => ref === e.path || ref.startsWith(`${e.path}/`));
    for (const ref of refs) {
      expect(covering(ref).every((e) => e.action === 'skip'), ref).toBe(true);
    }

    const res = await cleanupCommand.action!(ctx({ force: true, 'purge-data': true }));
    expect(res.success).toBe(true);
    expect(read('.claude/settings.json')).toBe(before);
    for (const ref of refs) {
      expect(fs.existsSync(abs(ref)), `settings.json runs missing ${ref}`).toBe(true);
    }
    // Everything else monomind installed is still removed.
    expect(fs.existsSync(abs('.monomind'))).toBe(false);
  }, 120000);
});

describe('cleanup after init leaves nothing behind (value-review 0.7 #3)', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;
  const ctx = (flags: Record<string, unknown>): CommandContext =>
    ({ args: [], flags: { _: [], ...flags }, cwd: tmpDir, interactive: false }) as CommandContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-cleanup-zero-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-cleanup-zero-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
    const { execFileSync } = await vi.importActual<typeof import('node:child_process')>(
      'node:child_process',
    );
    execFileSync('git', ['init', '-q'], { cwd: tmpDir });
  });

  afterEach(async () => {
    try {
      const bridge = await import('../src/memory/memory-bridge.js');
      await bridge.shutdownBridge();
    } catch {}
    process.env.HOME = realHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  const listFiles = (rel = ''): string[] => {
    const out: string[] = [];
    for (const e of fs.readdirSync(path.join(tmpDir, rel), { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...listFiles(child));
      else out.push(child);
    }
    return out;
  };

  it('--all-platforms init then cleanup --force --purge-data removes every file init wrote', async () => {
    const init = await initCommand.action!(
      ctx({ force: true, 'no-watch': true, 'no-start-all': true, 'all-platforms': true }),
    );
    expect(init.success, JSON.stringify(init)).toBe(true);
    expect(listFiles().length).toBeGreaterThan(50);
    const res = await cleanupCommand.action!(ctx({ force: true, 'purge-data': true }));
    expect(res.success).toBe(true);
    expect(listFiles()).toEqual([]);
    expect(fs.readdirSync(tmpDir)).toEqual(['.git']);
  }, 120000);
});
