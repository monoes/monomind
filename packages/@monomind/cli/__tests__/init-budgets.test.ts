/**
 * Budgets for what a real `init` writes (value-review 0.7 items 3, 5 and 6):
 *  - the generated CLAUDE.md stays under 4.5 KB;
 *  - the default skill + command listing stays under Claude Code's ~8,000-char budget;
 *  - `--minimal` is Claude Code plus core: no other detected platform is written;
 *  - `--full` warns, with the numbers, when it goes over the listing budget.
 * The default MCP roster schema budget is held by src/__tests__/mcp-roster-filter.test.ts.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../src/commands/init.js';
import { LISTING_BUDGET_CHARS, measureListing } from '../src/init/listing-size.js';
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

const CLAUDE_MD_BUDGET_BYTES = 4500;
const OTHER_PLATFORM_PATHS = [
  '.gemini',
  '.agents',
  '.codex',
  '.opencode',
  '.kimi-code',
  '.pi',
  '.github',
  'opencode.json',
  'GEMINI.md',
  'AGENTS.md',
];

describe('init budgets', () => {
  let tmp: string;
  let project: string;
  const saved = { HOME: process.env.HOME, PATH: process.env.PATH };

  const ctx = (flags: Record<string, unknown>): CommandContext =>
    ({
      args: [],
      flags: { _: [], 'no-watch': true, 'no-start-all': true, ...flags },
      cwd: project,
      interactive: false,
    }) as CommandContext;

  const countFiles = (dir: string): number =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .reduce(
        (n, e) =>
          e.name === '.git'
            ? n
            : n + (e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1),
        0,
      );

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-init-budgets-'));
    project = path.join(tmp, 'proj');
    const home = path.join(tmp, 'home');
    const bin = path.join(tmp, 'bin');
    // A machine with Claude, Codex and Gemini installed: detection would pick all three.
    for (const dir of [project, bin, path.join(home, '.claude'), path.join(home, '.codex')]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    for (const name of ['claude', 'codex', 'gemini']) {
      fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n', { mode: 0o755 });
    }
    process.env.HOME = home;
    process.env.PATH = bin;
  });

  afterEach(async () => {
    try {
      const bridge = await import('../src/memory/memory-bridge.js');
      await bridge.shutdownBridge();
    } catch {}
    process.env.HOME = saved.HOME;
    process.env.PATH = saved.PATH;
    fs.rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('default init: CLAUDE.md under 4.5 KB and skills + commands within the listing budget', async () => {
    const res = await initCommand.action!(ctx({ platforms: 'claude' }));
    expect(res.success, JSON.stringify(res)).toBe(true);
    const claudeMd = fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8');
    expect(Buffer.byteLength(claudeMd)).toBeLessThanOrEqual(CLAUDE_MD_BUDGET_BYTES);
    const listing = measureListing(path.join(project, '.claude'));
    expect(listing.skillsAndCommandsChars).toBeLessThanOrEqual(LISTING_BUDGET_CHARS);
  }, 180000);

  it('--minimal writes Claude Code and core only, even when other platforms are installed', async () => {
    const res = await initCommand.action!(ctx({ minimal: true }));
    expect(res.success, JSON.stringify(res)).toBe(true);
    for (const rel of OTHER_PLATFORM_PATHS) {
      expect(fs.existsSync(path.join(project, rel)), rel).toBe(false);
    }
    expect(fs.existsSync(path.join(project, 'CLAUDE.md'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.mcp.json'))).toBe(true);
    expect(countFiles(project)).toBeLessThan(300);
  }, 180000);

  it('--minimal --target keeps the named platform as the one primary platform', async () => {
    const res = await initCommand.action!(ctx({ minimal: true, target: 'codex' }));
    expect(res.success, JSON.stringify(res)).toBe(true);
    expect(fs.existsSync(path.join(project, '.codex', 'config.toml'))).toBe(true);
    for (const rel of ['.gemini', '.opencode', '.kimi-code', '.pi', '.github']) {
      expect(fs.existsSync(path.join(project, rel)), rel).toBe(false);
    }
  }, 180000);

  it('--full warns with the numbers when skills and commands exceed the listing budget', async () => {
    const warnings: string[] = [];
    vi.spyOn(output, 'printWarning').mockImplementation((m: string) => {
      warnings.push(String(m));
    });
    const res = await initCommand.action!(ctx({ full: true, platforms: 'claude' }));
    expect(res.success, JSON.stringify(res)).toBe(true);
    const chars = measureListing(path.join(project, '.claude')).skillsAndCommandsChars;
    expect(chars).toBeGreaterThan(LISTING_BUDGET_CHARS);
    expect(warnings.some((w) => w.includes(`${chars} chars`) && w.includes(`${LISTING_BUDGET_CHARS}`))).toBe(
      true,
    );
  }, 180000);
});
