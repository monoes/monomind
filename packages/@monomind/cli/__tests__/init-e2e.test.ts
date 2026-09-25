/**
 * End-to-end tests for `monomind init` against a real, writable temp directory.
 *
 * Unlike p1-commands.test.ts (which mocks fs entirely and can't exercise
 * executeInit's real file-writing pipeline), these tests let executeInit
 * write real files and assert on the actual resulting directory tree.
 *
 * child_process is mocked so init's best-effort side calls (npx daemon
 * start, npx doctor --install, npx memory store seeding, npm config get
 * prefix) fail fast instead of making real network/npx calls — they're
 * all wrapped in try/catch in production code and don't affect
 * result.success either way.
 *
 * All runs pass --no-start-all: the startAll block (npx swarm init, worker
 * metrics seeding) is by far the slowest part of init and none of the
 * assertions below cover it — under full-suite parallel load it alone pushed
 * these tests past even a 90s timeout. The watcher is gated by --watch, not
 * startAll, so watch behavior is still exercised where asserted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { initCommand } from '../src/commands/init.js';
import type { InitResult } from '../src/init/types.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

// Real output.js is used (not mocked) so init's actual code paths run
// unmodified — just quieted so the test log isn't flooded with init's UI output.
output.setVerbosity('quiet');

vi.mock('child_process', () => ({
  execSync: vi.fn(() => {
    throw new Error('mocked: no real process execution in tests');
  }),
  execFileSync: vi.fn(() => {
    throw new Error('mocked: no real process execution in tests');
  }),
  // i-035 round 2: write-capabilities.ts now imports doctorCommand, which
  // transitively pulls in doctor-env-checks.ts and services/crash-reporter.ts
  // — both wrap a child_process function with `promisify` at module load
  // time (`exec`/`execFile`, never called by anything this test exercises),
  // so this mock needs both exports to exist even though nothing here
  // invokes them.
  exec: vi.fn(() => {
    throw new Error('mocked: no real process execution in tests');
  }),
  execFile: vi.fn(() => {
    throw new Error('mocked: no real process execution in tests');
  }),
  spawn: vi.fn(() => {
    const proc = new EventEmitter() as EventEmitter & {
      unref: () => void;
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    proc.unref = () => {};
    proc.kill = () => {};
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    return proc;
  }),
}));

describe('Init Command E2E (real fs)', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-e2e-'));
    // executeInit's _registerMonomindProject() writes to
    // ~/.monomind-projects.json via os.homedir() (which reads $HOME on
    // Unix) — redirect it to a throwaway dir so real init runs don't get
    // this test's tmpdir permanently registered in the user's actual
    // project registry.
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-e2e-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
    ctx = {
      args: [],
      flags: { _: [], 'no-watch': true, 'no-start-all': true },
      cwd: tmpDir,
      interactive: false
    };
  });

  afterEach(async () => {
    try {
      // Close any SQLite backends init opened in this process so the tmpdir
      // rmSync below can't trip over live file handles. (The previous cleanup
      // called MemoryStore.closeAll — an API that does not exist — and
      // silently no-oped.)
      const bridge = await import('../src/memory/memory-bridge.js');
      await bridge.shutdownBridge();
    } catch {}
    process.env.HOME = realHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('should initialize with default configuration', async () => {
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'config.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'GEMINI.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'opencode.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.kimi-code', 'mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.codex', 'config.toml'))).toBe(true);
  }, 30000); // real-fs init under full-suite parallel load can exceed the 15s default (#33)

  it('indexes project and user-level (~/.claude) agents and skills, and says how many', async () => {
    const put = (file: string, text: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    };
    put(
      path.join(fakeHome, '.claude', 'agents', 'my-zorbler.md'),
      '---\nname: my-zorbler\ndescription: Tunes zorbling flux\n---\n',
    );
    put(
      path.join(fakeHome, '.claude', 'skills', 'my-zorb-skill', 'SKILL.md'),
      '---\nname: my-zorb-skill\ndescription: Zorbling skill\n---\n',
    );
    const info = vi.spyOn(output, 'printInfo');
    const result = await initCommand.action!(ctx);
    expect(result.success).toBe(true);

    const reg = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'registry.json'), 'utf8'));
    const mine = reg.agents.find((a: { slug: string }) => a.slug === 'my-zorbler');
    expect(mine).toMatchObject({ origin: 'user', filePath: '~/.claude/agents/my-zorbler.md' });
    expect(reg.agents.filter((a: { origin: string }) => a.origin === 'project').length).toBeGreaterThan(10);
    const index = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.claude', 'helpers', 'skill-registry.json'), 'utf8'),
    );
    expect(index.skills.find((s: { skill: string }) => s.skill === 'my-zorb-skill')?.origin).toBe('user');

    const indexes = (result.data as InitResult).indexes;
    expect(indexes?.agents).toEqual({ total: reg.agents.length, user: 1 });
    expect(indexes?.skills).toEqual({
      total: index.skills.length + index.orgSkills.length,
      user: 1,
    });
    expect(info).toHaveBeenCalledWith(
      `Indexed ${reg.agents.length} agents (1 from ~/.claude/agents) and ${indexes?.skills?.total} skills (1 from ~/.claude/skills)`,
    );
  }, 60000);

  it('writes one managed block per shared .agents/skills file, not one per platform', async () => {
    ctx.flags = { ...ctx.flags, yes: true, 'no-install': true };
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    const root = path.join(tmpDir, '.agents', 'skills');
    const files = fs
      .readdirSync(root, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(entry.parentPath, entry.name));
    // Non-Mastermind skills are copied unwrapped; no file may carry two blocks.
    const counts = files.map(
      (file) => (fs.readFileSync(file, 'utf8').match(/monomind:start \S+/g) ?? []).length,
    );
    expect(counts.filter((count) => count === 1).length).toBeGreaterThan(10);
    expect(files.filter((_, index) => counts[index]! > 1)).toEqual([]);
  }, 30000);

  it('suggests optional SheetJS installation without downloading it', async () => {
    const printInfo = vi.spyOn(output, 'printInfo');

    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(printInfo).toHaveBeenCalledWith(
      expect.stringContaining('pnpm add xlsx'),
    );
    expect(printInfo).toHaveBeenCalledWith(
      expect.stringContaining('npm install -g xlsx'),
    );
  }, 30000);

  it('should emit Codex project artifacts when requested', async () => {
    ctx.flags = { target: 'codex', _: [], 'no-watch': true, 'no-start-all': true };
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.codex', 'config.toml'))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, '.codex', 'config.toml'), 'utf8')).toContain('[mcp_servers.monomind]');
    // Native Codex hooks are on by default whenever the Codex target is selected
    // (2ece01c94 "fix(codex): enforce graph-first navigation") — no longer opt-in.
    expect(fs.readFileSync(path.join(tmpDir, '.codex', 'config.toml'), 'utf8')).toContain('[[hooks.PreToolUse]]');
    expect(fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8')).toContain('Monomind on Codex');
    expect(fs.existsSync(path.join(tmpDir, '.mcp.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'opencode.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.kimi-code'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'GEMINI.md'))).toBe(false);
  }, 30000);

  // i-066 follow-up finding 9 [MAJOR]: the leak check lived inside
  // writeMCPConfig (gated by options.components.mcp), and components.mcp is
  // false whenever the codex/opencode/kimicode-only or skipClaude paths are
  // selected (commands/init.ts:171/188) -- exactly the --target codex path
  // this file's own test above confirms never touches .mcp.json at all. On
  // that path the leak check silently never ran, even though a leaked
  // .mcp.json sits untouched in the project the whole time.
  it('warns about an already-leaked .mcp.json even when --target codex never touches that file (finding 9)', async () => {
    const leakedToken = /* value */ 'FAKE-AT-codex-target-should-still-warn';
    fs.writeFileSync(
      path.join(tmpDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          monoes: {
            type: 'http',
            url: 'https://monoes.me/api/mcp',
            headers: { Authorization: `Bearer ${leakedToken}` },
          },
        },
      }),
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      ctx.flags = { target: 'codex', _: [], 'no-watch': true, 'no-start-all': true };
      const result = await initCommand.action!(ctx);

      expect(result.success).toBe(true);
      const printed = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed.toLowerCase()).toContain('compromised');
      expect(printed.toLowerCase()).toContain('revoke');
      // The codex target never selects the mcp component, so this run
      // cannot migrate the file either -- it must be left exactly as
      // planted, still containing the leaked token, warning notwithstanding.
      expect(fs.readFileSync(path.join(tmpDir, '.mcp.json'), 'utf8')).toContain(leakedToken);
    } finally {
      errorSpy.mockRestore();
    }
  }, 30000);

  // Companion to the codex test above: on a target that DOES select the mcp
  // component (default/claude) with --force, the same run must both warn
  // AND actually migrate the file — the U5 property, now proven at its new
  // home (executor.ts hoists the check; write-claude.ts still does the
  // migration write, unchanged).
  it('warns AND migrates an already-leaked .mcp.json in the same `init --force` run (default target)', async () => {
    const leakedToken = /* value */ 'FAKE-AT-default-target-force-should-warn-and-migrate';
    fs.writeFileSync(
      path.join(tmpDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          monoes: {
            type: 'http',
            url: 'https://monoes.me/api/mcp',
            headers: { Authorization: `Bearer ${leakedToken}` },
          },
        },
      }),
    );
    // A still-connected victim -- without this, generateMCPConfig's
    // never-connected gate (i-066 round 1) omits the monoes entry entirely
    // on rewrite, rather than replacing it with the tokenless shape this
    // test means to prove.
    fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'monoes-connection.json'),
      JSON.stringify({ accessToken: /* value */ 'still-connected' }),
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      ctx.flags = { force: true, _: [], 'no-watch': true, 'no-start-all': true };
      const result = await initCommand.action!(ctx);

      expect(result.success).toBe(true);
      const printed = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed.toLowerCase()).toContain('compromised');
      expect(printed.toLowerCase()).toContain('revoke');

      const mcpJson = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mcp.json'), 'utf8'));
      expect(mcpJson.mcpServers.monoes).not.toHaveProperty('headers');
      expect(JSON.stringify(mcpJson)).not.toContain(leakedToken);
    } finally {
      errorSpy.mockRestore();
    }
  }, 30000);

  // Third companion to the two tests above, and the case the reviewer flagged
  // as the one that matters most: default flags, no --force, against a
  // victim project whose .mcp.json is already leaked. writeMCPConfig's
  // `existsSync(mcpPath) && !options.force` guard (write-claude.ts) fires and
  // returns before ever calling atomicWriteFile -- the warning the hoisted
  // executor.ts check just printed is the ONLY remedy available in this run,
  // because the code deliberately does not rewrite an existing .mcp.json
  // without --force. Both properties (warned, untouched) are independent and
  // have each been broken separately across this item's history (finding 9
  // dropped the warning on some paths; an earlier round's migration once ran
  // ahead of the warning and erased the evidence it read) -- so both are
  // asserted in this one run, mirroring AC-U5-R2.
  it('warns about an already-leaked .mcp.json and leaves it byte-identical when no --force is given (default target)', async () => {
    const leakedToken = /* value */ 'FAKE-AT-no-force-should-warn-and-leave-untouched';
    const plantedContent = JSON.stringify({
      mcpServers: {
        monoes: {
          type: 'http',
          url: 'https://monoes.me/api/mcp',
          headers: { Authorization: `Bearer ${leakedToken}` },
        },
      },
    });
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), plantedContent);
    // A still-connected victim, so this run has every opportunity to migrate
    // the file if the force-guard did not stop it -- proving the file is
    // untouched because of the guard, not merely because there was nothing
    // to change.
    fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'monoes-connection.json'),
      JSON.stringify({ accessToken: /* value */ 'still-connected' }),
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      ctx.flags = { _: [], 'no-watch': true, 'no-start-all': true };
      const result = await initCommand.action!(ctx);

      expect(result.success).toBe(true);
      const printed = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed.toLowerCase()).toContain('compromised');
      expect(printed.toLowerCase()).toContain('revoke');

      // result.data.skipped is writeMCPConfig's own record that it hit the
      // force-guard and returned without writing — the direct evidence
      // (not just an inference from file contents) that this run took the
      // skip path rather than, say, never reaching writeMCPConfig at all.
      const initResult = (result as { data?: InitResult }).data;
      expect(initResult?.skipped).toContain('.mcp.json');
      expect(fs.readFileSync(path.join(tmpDir, '.mcp.json'), 'utf8')).toBe(plantedContent);
    } finally {
      errorSpy.mockRestore();
    }
  }, 30000);

  it('accepts registry aliases through --platform without expanding legacy --target all', async () => {
    ctx.flags = { platform: 'kimicode,codex', _: [], 'no-watch': true, 'no-start-all': true };
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.codex', 'config.toml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.kimi-code', 'mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'opencode.json'))).toBe(false);
  }, 30000);

  it('keeps non-Claude legacy targets and adapter artifacts when --skip-claude is selected', async () => {
    ctx.flags = {
      target: 'all',
      'skip-claude': true,
      _: [],
      'no-watch': true,
      'no-start-all': true,
    };
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.codex', 'config.toml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'opencode.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.kimi-code', 'mcp.json'))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8')).toContain(
      'monomind:start instructions:codex',
    );
  }, 30000);

  it('should initialize with minimal configuration', async () => {
    ctx.flags = { minimal: true, _: [], 'no-watch': true, 'no-start-all': true };
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    // Minimal still writes settings and runtime config...
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'config.yaml'))).toBe(true);
    // ...but skips populating commands/agents (MINIMAL_INIT_OPTIONS.components) —
    // the directories are always created by createDirectories(), only their
    // contents are gated by the component flags.
    expect(fs.readdirSync(path.join(tmpDir, '.claude', 'commands'))).toHaveLength(0);
    expect(fs.readdirSync(path.join(tmpDir, '.claude', 'agents'))).toHaveLength(0);
  }, 30000); // #33

  it('should initialize with full configuration', async () => {
    ctx.flags = { full: true, _: [], 'no-watch': true, 'no-start-all': true };
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'agents'))).toBe(true);
  }, 60000); // #33 — full config copies the most; only test here without an explicit timeout

  it('should always write auto-memory-hook.mjs even when it is absent from the source helpers dir', async () => {
    // Regression test: writeHelpers() used to return early as soon as it copied
    // *any* file from the source .claude/helpers dir, skipping the fallback
    // generator for files missing from that source dir specifically. Since the
    // packaged source helpers dir has never actually shipped auto-memory-hook.mjs,
    // every real init wired SessionStart/SessionEnd/Stop hooks to a file that
    // was never written, crashing with MODULE_NOT_FOUND on every session end.
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    const hookPath = path.join(tmpDir, '.claude', 'helpers', 'auto-memory-hook.mjs');
    expect(fs.existsSync(hookPath)).toBe(true);
  });

  it('should reinitialize with force flag', async () => {
    // First init
    const first = await initCommand.action!(ctx);
    expect(first.success).toBe(true);

    // Re-run with --force --yes (yes skips the non-interactive "already initialized" error)
    ctx.flags = { force: true, yes: true, _: [], 'no-watch': true, 'no-start-all': true };
    const second = await initCommand.action!(ctx);

    expect(second.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
  }, 90000); // two real-fs init runs + first-use embedding-model load — #33
  // .gemini/helpers is read only by Antigravity's status bar
  // (.gemini/helpers/statusline.sh -> statusline.cjs). Kimi's statusline reads
  // .claude/helpers first, so no other platform needs the Gemini copy.
  describe('.gemini/helpers follows the Antigravity selection', () => {
    const geminiStatusline = () => path.join(tmpDir, '.gemini', 'helpers', 'statusline.cjs');
    const run = async (platform: string) => {
      ctx.flags = { platform, _: [], 'no-watch': true, 'no-start-all': true };
      const result = await initCommand.action!(ctx);
      expect(result.success).toBe(true);
    };

    it('is not written for claude alone', async () => {
      await run('claude');
      expect(fs.existsSync(path.join(tmpDir, '.claude', 'helpers', 'statusline.cjs'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.gemini', 'helpers'))).toBe(false);
      // upgrade refreshes .gemini/helpers only where it exists
      const { executeUpgrade } = await import('../src/init/upgrade.js');
      await executeUpgrade(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, '.gemini', 'helpers'))).toBe(false);
    }, 60000);

    it('is not written for claude + kimi or codex', async () => {
      await run('claude,kimi,codex');
      expect(fs.existsSync(path.join(tmpDir, '.gemini', 'helpers'))).toBe(false);
    }, 30000);

    it('is written when antigravity is selected', async () => {
      await run('claude,antigravity');
      expect(fs.existsSync(geminiStatusline())).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.gemini', 'helpers', 'statusline.sh'))).toBe(true);
    }, 30000);

    it('gives antigravity-only init a working status bar without Claude helpers', async () => {
      ctx.flags = { target: 'antigravity', _: [], 'no-watch': true, 'no-start-all': true };
      const result = await initCommand.action!(ctx);
      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.claude', 'helpers', 'statusline.cjs'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(false);

      const { spawnSync } =
        await vi.importActual<typeof import('child_process')>('child_process');
      const run = spawnSync(process.execPath, [geminiStatusline()], {
        cwd: tmpDir,
        env: { ...process.env, HOME: fakeHome, CLAUDE_PROJECT_DIR: tmpDir },
        encoding: 'utf8',
        timeout: 20000,
      });
      expect(run.stderr).toBe('');
      expect(run.status).toBe(0);
      expect(run.stdout.trim().length).toBeGreaterThan(0);
    }, 60000);

    it('leaves an existing .gemini/helpers alone when antigravity is not selected', async () => {
      fs.mkdirSync(path.dirname(geminiStatusline()), { recursive: true });
      fs.writeFileSync(geminiStatusline(), '// existing\n');
      await run('claude');
      expect(fs.readFileSync(geminiStatusline(), 'utf8')).toBe('// existing\n');
    }, 30000);
  });
});
