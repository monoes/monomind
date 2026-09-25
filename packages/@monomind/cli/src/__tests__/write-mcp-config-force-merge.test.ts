/**
 * `init --force` must refresh only monomind's own `.mcp.json` entry. It used
 * to replace the file wholesale, deleting every other MCP server the user had
 * registered and any env/fields they added to the monomind entry.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { writeMCPConfig } from '../init/write-claude.js';

function freshResult(): InitResult {
  return {
    success: true,
    platform: detectPlatform(),
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    removed: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

let targetDir: string;
beforeEach(() => {
  targetDir = mkdtempSync(join(tmpdir(), 'monomind-mcp-merge-'));
});
afterEach(() => rmSync(targetDir, { recursive: true, force: true }));

const run = (force: boolean, pin?: string) =>
  writeMCPConfig(
    targetDir,
    { ...DEFAULT_INIT_OPTIONS, targetDir, force, mcp: { ...DEFAULT_INIT_OPTIONS.mcp, pin } },
    freshResult(),
  );

describe('writeMCPConfig under --force', () => {
  it('keeps other servers and top-level keys, and the user fields on the monomind entry', async () => {
    const mcpPath = join(targetDir, '.mcp.json');
    writeFileSync(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          github: { command: 'gh-mcp', args: ['serve'] },
          monomind: {
            command: 'npx',
            args: ['-y', 'monomind@1.0.0', 'mcp', 'start'],
            env: { MY_TOKEN_ENV: 'x', npm_config_update_notifier: 'true' },
            disabled: false,
          },
        },
        customTopLevel: { keep: true },
      }),
    );

    await run(true, '9.9.9');

    const after = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    expect(after.mcpServers.github).toEqual({ command: 'gh-mcp', args: ['serve'] });
    expect(after.customTopLevel).toEqual({ keep: true });
    // monomind's own command is refreshed (the point of --force) …
    expect(after.mcpServers.monomind.args.join(' ')).toContain('@9.9.9');
    expect(after.mcpServers.monomind.args.join(' ')).not.toContain('monomind@1.0.0');
    // … while the user's additions survive, and a value they chose wins.
    expect(after.mcpServers.monomind.env.MY_TOKEN_ENV).toBe('x');
    expect(after.mcpServers.monomind.env.npm_config_update_notifier).toBe('true');
    expect(after.mcpServers.monomind.disabled).toBe(false);
  });

  it('leaves an unparseable .mcp.json untouched and reports it', async () => {
    const mcpPath = join(targetDir, '.mcp.json');
    writeFileSync(mcpPath, '{ not json');
    const result = freshResult();
    await writeMCPConfig(targetDir, { ...DEFAULT_INIT_OPTIONS, targetDir, force: true }, result);
    expect(readFileSync(mcpPath, 'utf-8')).toBe('{ not json');
    expect(result.errors.join('\n')).toMatch(/\.mcp\.json/);
  });

  it('still skips an existing file without --force', async () => {
    const mcpPath = join(targetDir, '.mcp.json');
    writeFileSync(mcpPath, '{"mcpServers":{}}');
    await run(false);
    expect(readFileSync(mcpPath, 'utf-8')).toBe('{"mcpServers":{}}');
  });
});
