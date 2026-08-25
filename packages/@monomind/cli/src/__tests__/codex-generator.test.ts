import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CODEX_STATUS_LINE_ITEMS,
  generateCodexAgentsMd,
  generateCodexConfig,
  generateCodexHookScript,
} from '../init/codex-generator.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { writeCodexFiles } from '../init/write-codex.js';

const temporaryDirs: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

function createResult(): InitResult {
  return {
    success: true,
    platform: detectPlatform(),
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    errors: [],
    summary: { agentsCount: 0, commandsCount: 0, hooksEnabled: 0, skillsCount: 0 },
  };
}

describe('Codex init artifacts', () => {
  it('generates a project-scoped MCP configuration', () => {
    const config = generateCodexConfig({ ...DEFAULT_INIT_OPTIONS, targetDir: '/tmp/project' });

    expect(config).toContain('[mcp_servers.monomind]');
    expect(config).toContain('[features]');
    expect(config).not.toContain('[[hooks.PreToolUse]]');
    expect(config).not.toContain('[[hooks.PostToolUse]]');
    expect(config).toContain('command = "npx"');
    expect(config).toContain('"monomind@latest"');
    expect(config).toContain('env = {');
    expect(config).toContain('MONOMIND_MAX_AGENTS = "15"');
    expect(config).toContain('[tui]');
    expect(config).toContain(
      `status_line = [${CODEX_STATUS_LINE_ITEMS.map((item) => `"${item}"`).join(', ')}]`,
    );
  });

  it('renders Codex hooks only after explicit opt-in', () => {
    const config = generateCodexConfig({
      ...DEFAULT_INIT_OPTIONS,
      targetDir: '/tmp/project',
      enablePlatformHooks: true,
    });

    expect(config).toContain('hooks = true');
    expect(config).toContain('[[hooks.PreToolUse]]');
    expect(config).toContain('[[hooks.PostToolUse]]');
    expect(config).toContain('.codex/hooks/monomind-hook.cjs');
  });

  it('generates a Codex hook adapter for the shared Monomind runtime', () => {
    const script = generateCodexHookScript();

    expect(script).toContain('hook_event_name');
    expect(script).toContain('pre-bash');
    expect(script).toContain('pre-write');
    expect(script).toContain('post-edit');
    expect(script).toContain('hook-handler.cjs');
  });

  it('repairs an incomplete native-hook marker in an existing Codex config', async () => {
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-codex-'));
    temporaryDirs.push(targetDir);
    const codexDir = path.join(targetDir, '.codex');
    fs.mkdirSync(codexDir);
    fs.writeFileSync(path.join(codexDir, 'config.toml'), '[tui]\n# monomind:start native-hooks\n');

    await writeCodexFiles(
      targetDir,
      { ...DEFAULT_INIT_OPTIONS, force: true, targetDir, enablePlatformHooks: true },
      createResult(),
    );

    const config = fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8');
    expect(config).toContain('[features]\nhooks = true');
    expect(config).toContain('[[hooks.PreToolUse]]');
    expect(config).toContain('# monomind:end native-hooks');
  });

  it('generates Codex instructions with Monomind workflows', () => {
    const agents = generateCodexAgentsMd();

    expect(agents).toContain('.codex/config.toml');
    expect(agents).toContain('monomind org run <name>');
    expect(agents).toContain('.agents/shared_instructions.md');
    expect(agents).toContain('native footer');
  });
});
