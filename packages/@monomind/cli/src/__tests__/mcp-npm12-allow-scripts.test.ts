/**
 * #853: npm 12 skips dependency install scripts unless allow-listed, so the
 * `npx`-launched MCP server never got better-sqlite3's native binary and every
 * monograph tool failed. Generated launches must carry the allow-scripts config.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateCodexConfig } from '../init/codex-generator.js';
import { generateKimiMcpConfig } from '../init/kimi-generator-mcp.js';
import { generateMCPConfig } from '../init/mcp-generator.js';
import { generateOpencodeConfig } from '../init/opencode-generator.js';
import { DEFAULT_INIT_OPTIONS, type InitOptions } from '../init/types.js';
import { MCP_NPM_ENV } from '../platform-adapters/renderers/mcp.js';

const options = (): InitOptions => ({
  ...DEFAULT_INIT_OPTIONS,
  targetDir: '/tmp/does-not-matter',
  mcp: { ...DEFAULT_INIT_OPTIONS.mcp, monomind: true },
});

describe('generated MCP launches allow the better-sqlite3 install script (#853)', () => {
  it('declares the npm 12 allow-scripts config, naming only better-sqlite3', () => {
    expect(MCP_NPM_ENV.npm_config_allow_scripts).toBe('better-sqlite3');
    expect(MCP_NPM_ENV.npm_config_update_notifier).toBe('false');
  });

  it('.mcp.json carries it in the monomind entry env', () => {
    const cfg = generateMCPConfig(options()) as {
      mcpServers: { monomind: { env: Record<string, string> } };
    };
    expect(cfg.mcpServers.monomind.env).toMatchObject(MCP_NPM_ENV);
  });

  it('kimi and opencode entries carry it', () => {
    const kimi = generateKimiMcpConfig(options()) as {
      mcpServers: { monomind: { env: Record<string, string> } };
    };
    expect(kimi.mcpServers.monomind.env).toMatchObject(MCP_NPM_ENV);
    const opencode = generateOpencodeConfig(options()) as {
      mcp: { monomind: { env: Record<string, string> } };
    };
    expect(opencode.mcp.monomind.env).toMatchObject(MCP_NPM_ENV);
  });

  it('codex config.toml carries it', () => {
    expect(generateCodexConfig(options())).toContain('npm_config_allow_scripts = "better-sqlite3"');
  });
});

// Guarded real-install check: needs network and npm 12. Run with
// MONOMIND_REAL_NPM12_TEST=1 (optionally MONOMIND_REAL_NPM12_SPEC=<pkg spec>).
describe.skipIf(!process.env.MONOMIND_REAL_NPM12_TEST)('npm 12 cold npx install (#853)', () => {
  it('builds better-sqlite3 when launched with the generated env', () => {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'mm853-'));
    const spec = process.env.MONOMIND_REAL_NPM12_SPEC ?? 'better-sqlite3@^13.2.0';
    const r = spawnSync(
      'npx',
      ['-y', `--package=${spec}`, 'node', '-e', "new (require('better-sqlite3'))(':memory:')"],
      {
        env: { ...process.env, ...MCP_NPM_ENV, npm_config_cache: path.join(dir, 'cache') },
        encoding: 'utf8',
        timeout: 280_000,
      },
    );
    expect(r.status, r.stderr).toBe(0);
  }, 290_000);
});
