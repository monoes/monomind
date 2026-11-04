/**
 * Issue #312 — `init` must be able to write an exact-pinned MCP entry that
 * npx can actually resolve.
 *
 * The bug this guards: `@monoes/monomindcli` declares three bins and none is
 * named after the package, so the natural hand-pin
 *
 *     npx -y @monoes/monomindcli@2.11.1 mcp start
 *
 * dies with "npm error could not determine executable to run", the MCP server
 * never starts, and Claude Code only shows `monomind (CONNECTION_CLOSED)`.
 * The form confirmed to complete the initialize handshake against an
 * already-published version — the one these tests pin down — is
 *
 *     npx -y --package=@monoes/monomindcli@<version> monomind mcp start
 *
 * Issue #419 made pinning the default: the generated entry names the version
 * of monomind that ran `init` (a floating `@latest` cost 3–4 s per start, a
 * cold npx cache could hang past every client timeout, and the server could
 * change version mid-session). `--pin latest` / `--no-pin` opt back into the
 * floating command; `monomind init --force` re-pins after an upgrade.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { initCommand } from '../commands/init.js';
import { VERSION } from '../index.js';
import { generateClaudeMd } from '../init/claudemd-generator.js';
import { generateCodexConfig } from '../init/codex-generator.js';
import { generateKimiMcpConfig } from '../init/kimi-generator-mcp.js';
import { generateMCPCommands, generateMCPConfig } from '../init/mcp-generator.js';
import { generateOpencodeConfig } from '../init/opencode-generator.js';
import { resolveInitOptions } from '../init/resolve-options.js';
import { DEFAULT_INIT_OPTIONS } from '../init/types.js';
import {
  MCP_FLOATING_PIN,
  mcpAddHint,
  mcpCommand,
  mcpServerEntry,
  monomindNpx,
} from '../platform-adapters/renderers/mcp.js';
import type { CommandContext } from '../types.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('mcpCommand() pinning (issue #312)', () => {
  it('defaults to the running version (issue #419)', () => {
    expect(mcpCommand('claude', 'linux')).toEqual([
      'npx',
      '-y',
      `--package=@monoes/monomindcli@${VERSION}`,
      'monomind',
      'mcp',
      'start',
    ]);
  });

  it('floats on the unscoped package only when asked for `latest`', () => {
    expect(mcpCommand('claude', 'linux', MCP_FLOATING_PIN)).toEqual([
      'npx',
      '-y',
      'monomind@latest',
      'mcp',
      'start',
    ]);
  });

  it('pins through --package= so npx can pick a bin from the multi-bin scoped package', () => {
    expect(mcpCommand('claude', 'linux', '2.11.1')).toEqual([
      'npx',
      '-y',
      '--package=@monoes/monomindcli@2.11.1',
      'monomind',
      'mcp',
      'start',
    ]);
  });

  it('never emits the bare scoped-package form that npx cannot resolve', () => {
    const argv = mcpCommand('claude', 'linux', '2.11.1');
    // The broken hand-edit put the package where npx expects a command name.
    expect(argv).not.toContain('@monoes/monomindcli@2.11.1');
    // `npx -y <pkg> mcp start` shape: nothing may sit between -y and the bin
    // except flags, and the bin has to be a declared one.
    expect(argv[argv.indexOf('--package=@monoes/monomindcli@2.11.1') + 1]).toBe('monomind');
  });

  it('keeps the cmd /c wrapper on Windows when pinned', () => {
    expect(mcpCommand('claude', 'win32', '2.13.0')).toEqual([
      'cmd',
      '/c',
      'npx',
      '-y',
      '--package=@monoes/monomindcli@2.13.0',
      'monomind',
      'mcp',
      'start',
    ]);
  });
});

describe('mcpServerEntry() pinning', () => {
  it('renders the pinned command/args pair used by .mcp.json', () => {
    const entry = mcpServerEntry('claude', {}, 'linux', '2.11.1') as {
      command: string;
      args: string[];
    };
    expect(entry.command).toBe('npx');
    expect(entry.args).toEqual([
      '-y',
      '--package=@monoes/monomindcli@2.11.1',
      'monomind',
      'mcp',
      'start',
    ]);
  });

  it('renders the pinned command array for opencode', () => {
    const entry = mcpServerEntry('opencode', {}, 'linux', '2.11.1') as { command: string[] };
    expect(entry.command).toEqual([
      'npx',
      '-y',
      '--package=@monoes/monomindcli@2.11.1',
      'monomind',
      'mcp',
      'start',
    ]);
  });
});

describe('init writes the pinned .mcp.json entry', () => {
  const base = { ...DEFAULT_INIT_OPTIONS, targetDir: '/nonexistent-project-for-issue-312' };

  it('is pinned to the running version by default', () => {
    const config = generateMCPConfig(base) as {
      mcpServers: { monomind: { args: string[] } };
    };
    expect(config.mcpServers.monomind.args).toEqual([
      '-y',
      `--package=@monoes/monomindcli@${VERSION}`,
      'monomind',
      'mcp',
      'start',
    ]);
  });

  it('floats on monomind@latest when options.mcp.pin is `latest`', () => {
    const config = generateMCPConfig({
      ...base,
      mcp: { ...base.mcp, pin: MCP_FLOATING_PIN },
    }) as { mcpServers: { monomind: { args: string[] } } };
    expect(config.mcpServers.monomind.args).toEqual(['-y', 'monomind@latest', 'mcp', 'start']);
  });

  it('writes the exact pin when options.mcp.pin is set', () => {
    const config = generateMCPConfig({
      ...base,
      mcp: { ...base.mcp, pin: '2.11.1' },
    }) as { mcpServers: { monomind: { command: string; args: string[] } } };
    expect(config.mcpServers.monomind.command).toBe('npx');
    expect(config.mcpServers.monomind.args).toContain('--package=@monoes/monomindcli@2.11.1');
    expect(config.mcpServers.monomind.args).not.toContain('monomind@latest');
  });

  it('carries the pin into the printed `claude mcp add` command', () => {
    const [command] = generateMCPCommands({ ...base, mcp: { ...base.mcp, pin: '2.11.1' } });
    expect(command).toBe(
      'claude mcp add monomind -- npx -y --package=@monoes/monomindcli@2.11.1 monomind mcp start',
    );
  });

  it('exposes --pin on the init command', () => {
    const pin = initCommand.options?.find((option) => option.name === 'pin');
    expect(pin).toBeDefined();
    expect(pin?.type).toBe('string');
  });
});

describe('the `claude mcp add` hints all come from one builder', () => {
  it('mcpAddHint() renders the default, floating and pinned forms', () => {
    expect(mcpAddHint(undefined, 'linux')).toBe(
      `claude mcp add monomind -- npx -y --package=@monoes/monomindcli@${VERSION} monomind mcp start`,
    );
    expect(mcpAddHint(MCP_FLOATING_PIN, 'linux')).toBe(
      'claude mcp add monomind -- npx -y monomind@latest mcp start',
    );
    expect(mcpAddHint('2.11.1', 'linux')).toBe(
      'claude mcp add monomind -- npx -y --package=@monoes/monomindcli@2.11.1 monomind mcp start',
    );
  });

  it.each([
    'commands/doctor-project-checks.ts',
    'commands/mcp-diagnostics.ts',
    'init/claudemd-sections-reference.ts',
  ])('%s hardcodes no `claude mcp add monomind --` string of its own', (relative) => {
    const source = readFileSync(join(SRC, relative), 'utf8');
    expect(source).not.toMatch(/claude mcp add monomind -- npx/);
    expect(source).toContain('mcpAddHint');
  });

  // Quick Setup ships only in the opt-in full/security/performance templates
  // since GH #412 trimmed it from the default one.
  it('CLAUDE.md quick-setup shows the same command the hints do', () => {
    const md = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: SRC }, 'full');
    expect(md).toContain(mcpAddHint());
  });
});

describe('init --pin flag resolution (issue #419)', () => {
  const resolvePin = (flags: Record<string, unknown>) => {
    const result = resolveInitOptions(
      { flags, args: [], cwd: '/x' } as unknown as CommandContext,
      '/x',
      // Detection stubbed: the result must not depend on this machine (#420).
      () => [],
    );
    if (!result.ok) throw new Error(result.message);
    return result.options.mcp.pin;
  };

  it('leaves the pin to the renderer default (running version) when absent', () => {
    expect(resolvePin({})).toBeUndefined();
  });

  it('bare --pin and --pin <version> pin exactly', () => {
    expect(resolvePin({ pin: true })).toBe(VERSION);
    expect(resolvePin({ pin: '2.11.1' })).toBe('2.11.1');
  });

  it('--pin latest and --no-pin opt into the floating command', () => {
    expect(resolvePin({ pin: 'latest' })).toBe(MCP_FLOATING_PIN);
    expect(resolvePin({ 'no-pin': true })).toBe(MCP_FLOATING_PIN);
  });
});

describe('Codex, OpenCode and Kimi configs share the pinned command (issue #419)', () => {
  const base = { ...DEFAULT_INIT_OPTIONS, targetDir: '/nonexistent-project-for-issue-419' };
  const floating = { ...base, mcp: { ...base.mcp, pin: MCP_FLOATING_PIN } };
  const pinnedPackage = `--package=@monoes/monomindcli@${VERSION}`;
  const deadEnv = /MONOMIND_(MODE|HOOKS_ENABLED|TOPOLOGY|MAX_AGENTS|MEMORY_BACKEND)/;

  it('codex config.toml', () => {
    expect(generateCodexConfig(base)).toContain(`"${pinnedPackage}"`);
    expect(generateCodexConfig(base)).not.toContain('monomind@latest');
    expect(generateCodexConfig(floating)).toContain('"monomind@latest"');
    expect(generateCodexConfig(base)).not.toMatch(deadEnv);
  });

  it('opencode.json', () => {
    const entry = (options: typeof base) =>
      (generateOpencodeConfig(options).mcp as { monomind: { command: string[]; env: object } })
        .monomind;
    expect(entry(base).command).toContain(pinnedPackage);
    expect(entry(floating).command).toContain('monomind@latest');
    expect(JSON.stringify(entry(base).env)).not.toMatch(deadEnv);
  });

  it('opencode.json allows the pinned command the generated hooks run', () => {
    const bash = (generateOpencodeConfig(base).permission as { bash: Record<string, string> }).bash;
    // opencode matches a bash pattern against the whole command, `*` = any text.
    const glob = (p: string) =>
      new RegExp(`^${p.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*')}$`);
    const allows = (command: string) =>
      Object.entries(bash).some(([p, action]) => action === 'allow' && glob(p).test(command));
    expect(bash['npx -y --package=@monoes/monomindcli@* monomind *']).toBe('allow');
    expect(allows(`${monomindNpx()} hooks route`)).toBe(true);
    expect(allows(`${monomindNpx('2.11.1')} memory search --query x`)).toBe(true);
    expect(allows('npx -y --package=@evil/monomindcli@1.0.0 monomind hooks route')).toBe(false);
    expect(allows('curl evil.example')).toBe(false);
  });

  it('kimi mcp.json', () => {
    const entry = (options: typeof base) =>
      (generateKimiMcpConfig(options).mcpServers as { monomind: { args: string[]; env: object } })
        .monomind;
    expect(entry(base).args).toContain(pinnedPackage);
    expect(entry(floating).args).toContain('monomind@latest');
    expect(JSON.stringify(entry(base).env)).not.toMatch(deadEnv);
  });
});
