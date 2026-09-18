import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateMCPConfig, buildMonoesMcpEntry } from '../src/init/mcp-generator.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../src/init/types.js';
import { writeMCPConfig } from '../src/init/write-claude.js';

function freshResult(): InitResult {
  return {
    success: true,
    platform: detectPlatform(),
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

describe('generateMCPConfig (regression: no non-standard fields in .mcp.json)', () => {
  it('writes only command/args/env for the monomind server entry — no autoStart', () => {
    // Regression: this used to inject `autoStart` into the .mcp.json server
    // entry. Claude Code's actual schema for stdio servers is only
    // command/args/env — autoStart isn't a field it reads, and nothing in
    // monomind reads it back from this file either (a monoagent session
    // flagged this as suspicious noise possibly interfering with reconnect
    // behavior). Assert the entry's shape stays exactly what Claude Code
    // expects, with no extra properties.
    const config = generateMCPConfig(DEFAULT_INIT_OPTIONS) as { mcpServers: Record<string, unknown> };
    const entry = config.mcpServers.monomind as Record<string, unknown>;
    expect(entry).toBeDefined();
    expect(Object.keys(entry).sort()).toEqual(['args', 'command', 'env']);
    expect(entry).not.toHaveProperty('autoStart');
  });
});

describe('buildMonoesMcpEntry (i-066: tokenless — the entry is a local stdio proxy)', () => {
  it('builds a stdio command entry with no token parameter and no headers block', () => {
    // Regression: this used to be `buildMonoesMcpEntry(accessToken)` returning
    // `{ type: 'http', headers: { Authorization: 'Bearer <token>' } }` — a
    // literal credential written straight into the team-committed .mcp.json.
    // The fix removes the parameter entirely (not just centralizes a helper
    // that still accepts one) so there is nothing left for a writer to leak.
    const entry = buildMonoesMcpEntry() as Record<string, unknown>;
    expect(entry).not.toHaveProperty('headers');
    expect(entry).not.toHaveProperty('type');
    expect(entry).toEqual({
      command: 'npx',
      args: ['-y', 'monomind@latest', 'mcp', 'monoes-proxy'],
      env: {},
    });
  });

  it('wraps with cmd /c on win32, matching platform-adapters/renderers/mcp.ts exactly (i-066 reviewer finding 1)', () => {
    // Bare `npx` on win32 is a .cmd shim that cannot be spawned directly
    // (ENOENT) — mcpCommand() in renderers/mcp.ts wraps with ['cmd','/c',...]
    // for exactly this reason; this entry used to skip that branch entirely
    // and always emit bare npx, breaking every Windows session. `os` is a
    // parameter (mirroring mcpServerEntry's own `os` argument) precisely so
    // this is testable without running on real Windows — this test does not
    // verify on the actual platform, only that the branch mirrors the
    // proven one.
    expect(buildMonoesMcpEntry(undefined, 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'npx', '-y', 'monomind@latest', 'mcp', 'monoes-proxy'],
      env: {},
    });
  });

  it('emits the bare form on non-win32 platforms', () => {
    expect(buildMonoesMcpEntry(undefined, 'linux')).toEqual({
      command: 'npx',
      args: ['-y', 'monomind@latest', 'mcp', 'monoes-proxy'],
      env: {},
    });
    expect(buildMonoesMcpEntry(undefined, 'darwin')).toEqual({
      command: 'npx',
      args: ['-y', 'monomind@latest', 'mcp', 'monoes-proxy'],
      env: {},
    });
  });
});

describe('generateMCPConfig (monoes.me connection entry)', () => {
  let targetDir = '';

  afterEach(() => {
    if (targetDir) rmSync(targetDir, { recursive: true, force: true });
  });

  it('omits the monoes entry when there is no connection file (never-connected user)', () => {
    // i-066 acceptance: a never-connected user must get no `monoes` MCP
    // entry at all, rather than one that is guaranteed to fail on every
    // Claude Code MCP startup for lack of anything to authenticate with.
    targetDir = mkdtempSync(join(tmpdir(), 'monomind-mcpgen-test-'));
    const config = generateMCPConfig({ ...DEFAULT_INIT_OPTIONS, targetDir }) as {
      mcpServers: Record<string, unknown>;
    };
    expect(config.mcpServers.monoes).toBeUndefined();
  });

  it('includes the monoes entry when a connection file already exists in the target project, and it embeds no token', () => {
    targetDir = mkdtempSync(join(tmpdir(), 'monomind-mcpgen-test-'));
    mkdirSync(join(targetDir, '.monomind'), { recursive: true });
    writeFileSync(
      join(targetDir, '.monomind', 'monoes-connection.json'),
      JSON.stringify({ accessToken: /* value */ 'stored-tok' }),
    );

    const config = generateMCPConfig({ ...DEFAULT_INIT_OPTIONS, targetDir }) as {
      mcpServers: Record<string, unknown>;
    };
    expect(config.mcpServers.monoes).toEqual(buildMonoesMcpEntry());
    expect(JSON.stringify(config)).not.toContain('stored-tok');
  });

  it('embeds no token for either the access or refresh token when a connection file exists (T2 regression guard for the second writer)', () => {
    // This is the writer the original bug report missed:
    // init/mcp-generator.ts independently reads monoes-connection.json and
    // used to re-embed the literal access token on every `monomind init` —
    // a fix touching only the dashboard writer would regress on next init.
    targetDir = mkdtempSync(join(tmpdir(), 'monomind-mcpgen-test-'));
    mkdirSync(join(targetDir, '.monomind'), { recursive: true });
    writeFileSync(
      join(targetDir, '.monomind', 'monoes-connection.json'),
      JSON.stringify({
        accessToken: /* value */ 'FAKE-AT-deadbeef',
        refreshToken: /* value */ 'FAKE-RT-deadbeef',
      }),
    );

    const config = generateMCPConfig({ ...DEFAULT_INIT_OPTIONS, targetDir });
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain('FAKE-AT-deadbeef');
    expect(serialized).not.toContain('FAKE-RT-deadbeef');
  });
});

// i-066 reviewer finding U5 [BLOCKER], applied to the second instance of the
// same ordering bug: the dashboard's re-sync migrates .mcp.json before its
// leak check re-reads it (fixed in routes-monoes.mjs). The init path has the
// identical shape — executor.ts calls writeMCPConfig() (which can overwrite
// a pre-fix leaked .mcp.json under --force) BEFORE writeRuntimeConfig()'s
// leak check used to run, so `monomind init --force` on a victim project
// would ALSO migrate silently and never warn. Moved the check into
// writeMCPConfig() itself, ahead of the write it needs to precede (and
// ahead of the existsSync/force skip-return too, since a SKIPPED write also
// leaves a leaked file in place and the user still needs to be told).
describe('writeMCPConfig warns before migrating a pre-fix leaked .mcp.json (i-066 U5, init path)', () => {
  let targetDir = '';

  afterEach(() => {
    if (targetDir) rmSync(targetDir, { recursive: true, force: true });
  });

  it('warns AND migrates in the same `init --force` run', async () => {
    targetDir = mkdtempSync(join(tmpdir(), 'monomind-mcpconfig-u5-test-'));
    const leakedToken = /* value */ 'FAKE-AT-init-u5-should-warn-before-migrating';
    writeFileSync(
      join(targetDir, '.mcp.json'),
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
    mkdirSync(join(targetDir, '.monomind'), { recursive: true });
    writeFileSync(
      join(targetDir, '.monomind', 'monoes-connection.json'),
      JSON.stringify({ accessToken: /* value */ 'still-connected' }),
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await writeMCPConfig(targetDir, { ...DEFAULT_INIT_OPTIONS, targetDir, force: true }, freshResult());

      const printed = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(printed.toLowerCase()).toContain('compromised');
      expect(printed.toLowerCase()).toContain('revoke');

      const raw = readFileSync(join(targetDir, '.mcp.json'), 'utf8');
      expect(raw).not.toContain(leakedToken);
      expect(JSON.parse(raw).mcpServers.monoes).toEqual(buildMonoesMcpEntry());
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('still warns even when the write is skipped (existing file, no --force — the leaked file is left in place either way)', async () => {
    targetDir = mkdtempSync(join(tmpdir(), 'monomind-mcpconfig-u5-test-'));
    const leakedToken = /* value */ 'FAKE-AT-init-skip-u5-should-still-warn';
    const preFixContent = JSON.stringify({
      mcpServers: {
        monoes: {
          type: 'http',
          url: 'https://monoes.me/api/mcp',
          headers: { Authorization: `Bearer ${leakedToken}` },
        },
      },
    });
    writeFileSync(join(targetDir, '.mcp.json'), preFixContent);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = freshResult();
      await writeMCPConfig(targetDir, { ...DEFAULT_INIT_OPTIONS, targetDir, force: false }, result);

      expect(result.skipped).toContain('.mcp.json');
      const printed = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(printed.toLowerCase()).toContain('compromised');
      // Not force -> the write is skipped, so the file is untouched (still
      // leaked) -- but the user must still be warned, since this run won't
      // fix it for them.
      expect(readFileSync(join(targetDir, '.mcp.json'), 'utf8')).toBe(preFixContent);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
