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
 * Default behaviour is deliberately unchanged (floating `monomind@latest`):
 * pinning is opt-in via `monomind init --pin`, so upgrading monomind never
 * silently freezes an existing project on the version that ran `init`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { initCommand } from '../commands/init.js';
import { generateClaudeMd } from '../init/claudemd-generator.js';
import { generateMCPCommands, generateMCPConfig } from '../init/mcp-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../init/types.js';
import { mcpAddHint, mcpCommand, mcpServerEntry } from '../platform-adapters/renderers/mcp.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('mcpCommand() pinning (issue #312)', () => {
  it('still defaults to the floating unscoped package — pinning is opt-in', () => {
    expect(mcpCommand('claude', 'linux')).toEqual(['npx', '-y', 'monomind@latest', 'mcp', 'start']);
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

  it('is unpinned by default', () => {
    const config = generateMCPConfig(base) as {
      mcpServers: { monomind: { args: string[] } };
    };
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
  it('mcpAddHint() renders the default and pinned forms', () => {
    expect(mcpAddHint(undefined, 'linux')).toBe(
      'claude mcp add monomind -- npx -y monomind@latest mcp start',
    );
    expect(mcpAddHint('2.11.1', 'linux')).toBe(
      'claude mcp add monomind -- npx -y --package=@monoes/monomindcli@2.11.1 monomind mcp start',
    );
  });

  it.each(['commands/doctor-project-checks.ts', 'commands/mcp.ts', 'init/claudemd-generator.ts'])(
    '%s hardcodes no `claude mcp add monomind --` string of its own',
    (relative) => {
      const source = readFileSync(join(SRC, relative), 'utf8');
      expect(source).not.toMatch(/claude mcp add monomind -- npx/);
      expect(source).toContain('mcpAddHint');
    },
  );

  it('CLAUDE.md quick-setup shows the same command the hints do', () => {
    const md = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: SRC });
    expect(md).toContain(mcpAddHint());
  });
});
