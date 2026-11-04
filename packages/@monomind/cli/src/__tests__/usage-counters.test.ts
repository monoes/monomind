/**
 * Stage 0 of the surface-reduction plan
 * (docs/mastermind/plans/2026-11-surface-reduction.md): opt-in, local-only
 * counters of which CLI commands and MCP tools get used, so C9/C10/C11 can be
 * decided from data. Privacy contract pinned here:
 *
 *  - off by default: nothing is written unless the user opts in;
 *  - opt-in counts CLI commands (from the dispatcher) and MCP tools (from
 *    callMCPTool);
 *  - only names, counts and first/last-seen dates are stored, never arguments;
 *  - a failing write is swallowed and never breaks the command or tool;
 *  - the module imports nothing that can reach the network.
 *
 * Every test points MONOMIND_HOME at its own temp dir; the real $HOME is
 * never read or written.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../cli-startup.js', () => ({
  checkForUpdatesOnStartup: vi.fn(async () => {}),
  initCliSubsystems: vi.fn(async () => {}),
  loadCliConfig: vi.fn(async () => undefined),
  handleCliError: (error: Error) => {
    throw error;
  },
}));

import { checkUsageCounters } from '../commands/doctor-env-checks.js';
import { CLI } from '../index.js';
import { callMCPTool } from '../mcp-client.js';
import { registerTools } from '../mcp-client-registry.js';
import { commandParser } from '../parser.js';
import {
  MAX_USAGE_ENTRIES,
  readUsageCounters,
  recordUsage,
  resetUsageCountersCache,
  usageCountersEnabled,
  usageCountersIdle,
  usageCountersPath,
} from '../services/usage-counters.js';
import type { Command } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MARKER = 'zz-private-argument-0042';

let home: string;
let cwd: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'usage-counters-home-'));
  cwd = mkdtempSync(join(tmpdir(), 'usage-counters-cwd-'));
  process.env.MONOMIND_HOME = join(home, '.monomind');
  delete process.env.MONOMIND_USAGE_COUNTERS;
  resetUsageCountersCache();
});

afterEach(() => {
  process.env = { ...savedEnv };
  resetUsageCountersCache();
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  MONOMIND_HOME: join(home, '.monomind'),
  ...extra,
});

/** Waits for the fire-and-forget writes queued so far. */
async function flushed(): Promise<void> {
  await usageCountersIdle();
}

describe('usage counters: off by default', () => {
  it('is off with no env var and no config key', () => {
    expect(usageCountersEnabled({ env: env(), cwd })).toBe(false);
  });

  it('writes nothing when off', async () => {
    await recordUsage('cli', 'memory store', { env: env(), cwd });
    await recordUsage('mcp', 'memory_store', { env: env(), cwd });
    expect(existsSync(join(home, '.monomind'))).toBe(false);
  });

  it('an explicit off value in the env wins over an opted-in config', () => {
    writeFileSync(
      join(cwd, 'monomind.config.json'),
      JSON.stringify({ cli: { usageCounters: true } }),
    );
    expect(usageCountersEnabled({ env: env(), cwd })).toBe(true);
    expect(usageCountersEnabled({ env: env({ MONOMIND_USAGE_COUNTERS: '0' }), cwd })).toBe(false);
  });

  it('only the literal boolean true in config opts in', () => {
    expect(usageCountersEnabled({ env: env(), config: { cli: { usageCounters: 'yes' } } })).toBe(
      false,
    );
    expect(usageCountersEnabled({ env: env(), config: { cli: { usageCounters: true } } })).toBe(
      true,
    );
  });
});

describe('usage counters: opt-in counts', () => {
  it('MONOMIND_USAGE_COUNTERS=1 counts names with first/last-seen dates', async () => {
    const on = { env: env({ MONOMIND_USAGE_COUNTERS: '1' }), cwd };
    await recordUsage('cli', 'memory store', { ...on, now: new Date('2026-11-01T10:00:00Z') });
    await recordUsage('cli', 'memory store', { ...on, now: new Date('2026-11-03T10:00:00Z') });
    await recordUsage('mcp', 'memory_store', { ...on, now: new Date('2026-11-02T10:00:00Z') });

    const data = readUsageCounters(on.env);
    expect(data.entries['cli:memory store']).toEqual({
      count: 2,
      firstSeen: '2026-11-01',
      lastSeen: '2026-11-03',
    });
    expect(data.entries['mcp:memory_store']).toEqual({
      count: 1,
      firstSeen: '2026-11-02',
      lastSeen: '2026-11-02',
    });
    expect(usageCountersPath(on.env)).toBe(join(home, '.monomind', 'usage-counters.json'));
  });

  it('the cli.usageCounters config key opts in', async () => {
    writeFileSync(
      join(cwd, 'monomind.config.json'),
      JSON.stringify({ cli: { usageCounters: true } }),
    );
    await recordUsage('cli', 'status', { env: env(), cwd });
    expect(readUsageCounters(env()).entries['cli:status']?.count).toBe(1);
  });

  it('the CLI dispatcher records the resolved command path once per run', async () => {
    process.env.MONOMIND_USAGE_COUNTERS = '1';
    const action = vi.fn(async () => ({ success: true }));
    const cmd: Command = {
      name: 'zzusage',
      description: 'test command',
      subcommands: [{ name: 'probe', description: 'test sub', action }],
    };
    commandParser.registerCommand(cmd);

    await new CLI({ interactive: false }).run([
      'zzusage',
      'probe',
      MARKER,
      `--path=/etc/${MARKER}`,
    ]);
    await flushed();

    expect(action).toHaveBeenCalledOnce();
    const data = readUsageCounters();
    expect(data.entries['cli:zzusage probe']?.count).toBe(1);
    expect(Object.keys(data.entries)).toEqual(['cli:zzusage probe']);
  });

  it('callMCPTool records the tool name for MCP-server calls (those carry a sessionId)', async () => {
    process.env.MONOMIND_USAGE_COUNTERS = '1';
    registerTools([
      {
        name: 'zzusage_echo',
        description: 'test tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async (input: Record<string, unknown>) => ({ echoed: input }),
      },
    ]);

    await callMCPTool('zzusage_echo', { prompt: MARKER }, { sessionId: 'mcp-1' });
    // In-process calls a CLI command makes are not MCP traffic: the command
    // itself is already counted by the dispatcher.
    await callMCPTool('zzusage_echo', { prompt: MARKER });
    await flushed();

    expect(readUsageCounters().entries['mcp:zzusage_echo']?.count).toBe(1);
  });
});

describe('usage counters: no arguments are ever stored', () => {
  it('the file holds only names, counts and dates', async () => {
    process.env.MONOMIND_USAGE_COUNTERS = '1';
    registerTools([
      {
        name: 'zzusage_args',
        description: 'test tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ ok: true }),
      },
    ]);
    commandParser.registerCommand({
      name: 'zzargs',
      description: 'test command',
      action: async () => ({ success: true }),
    });

    await new CLI({ interactive: false }).run(['zzargs', MARKER, '--prompt', MARKER]);
    await callMCPTool(
      'zzusage_args',
      { path: `/home/${MARKER}`, text: MARKER },
      { sessionId: 's' },
    );
    await flushed();

    const raw = readFileSync(usageCountersPath(), 'utf-8');
    expect(raw).not.toContain(MARKER);
    expect(raw).not.toContain('/home/');
    const data = JSON.parse(raw);
    expect(Object.keys(data).sort()).toEqual(['entries', 'version']);
    for (const entry of Object.values(data.entries)) {
      expect(Object.keys(entry as object).sort()).toEqual(['count', 'firstSeen', 'lastSeen']);
    }
  });

  it('rejects anything that does not look like a command or tool name', async () => {
    const on = { env: env({ MONOMIND_USAGE_COUNTERS: '1' }), cwd };
    for (const bad of [
      '/etc/passwd',
      'memory store --key=x',
      'memory store "a prompt"',
      'a b c d e f g',
      'x'.repeat(200),
      '',
      '../../evil',
    ]) {
      await recordUsage('cli', bad, on);
    }
    expect(existsSync(usageCountersPath(on.env))).toBe(false);
  });

  it('stays bounded: once the cap is reached no new names are added', async () => {
    const on = { env: env({ MONOMIND_USAGE_COUNTERS: '1' }), cwd };
    const entries: Record<string, unknown> = {};
    for (let i = 0; i < MAX_USAGE_ENTRIES; i++)
      entries[`mcp:t${i}`] = { count: 1, firstSeen: '2026-11-01', lastSeen: '2026-11-01' };
    mkdirSync(join(home, '.monomind'), { recursive: true });
    writeFileSync(usageCountersPath(on.env), JSON.stringify({ version: 1, entries }));

    await recordUsage('mcp', 'brand_new', on);
    await recordUsage('mcp', 't0', on);
    const data = readUsageCounters(on.env);
    expect(data.entries['mcp:brand_new']).toBeUndefined();
    expect((data.entries['mcp:t0'] as { count: number }).count).toBe(2);
  });
});

describe('usage counters: a write failure is swallowed', () => {
  it('recordUsage resolves when the state dir cannot be created', async () => {
    const blocker = join(home, 'not-a-dir');
    writeFileSync(blocker, 'x');
    const bad = { env: { MONOMIND_HOME: join(blocker, 'sub'), MONOMIND_USAGE_COUNTERS: '1' } };
    await expect(recordUsage('cli', 'status', bad)).resolves.toBeUndefined();
  });

  it('a corrupt counters file is replaced, not thrown on', async () => {
    const on = { env: env({ MONOMIND_USAGE_COUNTERS: '1' }), cwd };
    mkdirSync(join(home, '.monomind'), { recursive: true });
    writeFileSync(usageCountersPath(on.env), '{not json');
    await expect(recordUsage('cli', 'status', on)).resolves.toBeUndefined();
    expect(readUsageCounters(on.env).entries['cli:status']?.count).toBe(1);
  });

  it('a tool call still succeeds when the counter write fails', async () => {
    const blocker = join(home, 'not-a-dir');
    writeFileSync(blocker, 'x');
    process.env.MONOMIND_HOME = join(blocker, 'sub');
    process.env.MONOMIND_USAGE_COUNTERS = '1';
    registerTools([
      {
        name: 'zzusage_fail',
        description: 'test tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ ok: true }),
      },
    ]);
    await expect(callMCPTool('zzusage_fail', {}, { sessionId: 's' })).resolves.toEqual({
      ok: true,
    });
    await flushed();
  });
});

describe('usage counters: no network modules', () => {
  const NETWORK =
    /\bfrom\s+['"](node:)?(http|https|http2|net|tls|dgram|dns|child_process|worker_threads)['"]|import\(\s*['"](node:)?(http|https|http2|net|tls|dgram|dns|child_process)['"]|\bfetch\s*\(|undici|XMLHttpRequest|WebSocket|https?:\/\//;

  it('the counter module and the config reader it uses import nothing that can reach the network', () => {
    for (const rel of ['../services/usage-counters.ts', '../services/config-file-manager.ts']) {
      const src = readFileSync(join(__dirname, rel), 'utf-8');
      expect(src, rel).not.toMatch(NETWORK);
    }
  });

  it('the counter module imports only fs, os, path and the local config reader', () => {
    const src = readFileSync(join(__dirname, '../services/usage-counters.ts'), 'utf-8');
    const specifiers = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
      (m) => m[1],
    );
    expect(new Set(specifiers)).toEqual(
      new Set(['node:fs', 'node:fs/promises', 'node:os', 'node:path', './config-file-manager.js']),
    );
  });
});

describe('usage counters: doctor line', () => {
  it('reports off with the opt-in instructions', async () => {
    const r = await checkUsageCounters({ env: env(), cwd });
    expect(r.name).toBe('Usage Counters');
    expect(r.message).toMatch(/^off/);
    expect(r.message).toContain('MONOMIND_USAGE_COUNTERS=1');
  });

  it('reports on with the entry count and the local file', async () => {
    const on = { env: env({ MONOMIND_USAGE_COUNTERS: '1' }), cwd };
    await recordUsage('cli', 'status', on);
    await recordUsage('mcp', 'memory_store', on);
    const r = await checkUsageCounters(on);
    expect(r.message).toMatch(/^on, 2 entries/);
    expect(r.message).toContain(usageCountersPath(on.env));
  });
});
