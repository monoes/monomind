import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateMCPConfig, buildMonoesMcpEntry } from '../src/init/mcp-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

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

describe('buildMonoesMcpEntry', () => {
  it('builds a remote HTTP entry pointing at monoes.me with a bearer header', () => {
    expect(buildMonoesMcpEntry('tok-123')).toEqual({
      type: 'http',
      url: 'https://monoes.me/api/mcp',
      headers: { Authorization: 'Bearer tok-123' },
    });
  });
});

describe('generateMCPConfig (monoes.me connection entry)', () => {
  let targetDir = '';

  afterEach(() => {
    if (targetDir) rmSync(targetDir, { recursive: true, force: true });
  });

  it('omits the monoes entry when there is no connection file', () => {
    targetDir = mkdtempSync(join(tmpdir(), 'monomind-mcpgen-test-'));
    const config = generateMCPConfig({ ...DEFAULT_INIT_OPTIONS, targetDir }) as {
      mcpServers: Record<string, unknown>;
    };
    expect(config.mcpServers.monoes).toBeUndefined();
  });

  it('includes the monoes entry when a connection file already exists in the target project', () => {
    targetDir = mkdtempSync(join(tmpdir(), 'monomind-mcpgen-test-'));
    mkdirSync(join(targetDir, '.monomind'), { recursive: true });
    writeFileSync(
      join(targetDir, '.monomind', 'monoes-connection.json'),
      JSON.stringify({ accessToken: /* value */ 'stored-tok' }),
    );

    const config = generateMCPConfig({ ...DEFAULT_INIT_OPTIONS, targetDir }) as {
      mcpServers: Record<string, unknown>;
    };
    expect(config.mcpServers.monoes).toEqual(buildMonoesMcpEntry('stored-tok'));
  });
});
