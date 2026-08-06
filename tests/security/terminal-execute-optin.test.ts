/**
 * C2 — terminal_execute default-on exfiltration risk
 *
 * Before fix: terminal_execute is callable by default. A prompt-injected
 * agent that discovers it via monomind_tool_search can run arbitrary
 * single-binary commands (curl, wget, aws, scp, ...) since the metacharacter
 * denylist blocks shell chaining but NOT direct binary invocation. The
 * denylist can't be made tight enough to be safe (curl has hundreds of
 * useful flags containing only [a-zA-Z0-9 ._/-]).
 *
 * After fix: terminal_execute refuses to run unless the project (or env)
 * has explicitly opted in via MONOMIND_ENABLE_TERMINAL=1 or
 * .monomind/enable-terminal.json. Discovery still works; execution is gated.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { terminalTools } from '../../packages/@monomind/cli/src/mcp-tools/terminal-tools.js';

const ORIGINAL_ENV = { ...process.env };

describe('C2 — terminal_execute opt-in gate', () => {
  let tmpDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-term-gate-'));
    originalCwd = process.cwd;
    process.cwd = () => tmpDir;
    delete process.env.MONOMIND_ENABLE_TERMINAL;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  const setupProject = (enable = false) => {
    const monoDir = path.join(tmpDir, '.monomind');
    fs.mkdirSync(monoDir, { recursive: true });
    if (enable) {
      fs.writeFileSync(path.join(monoDir, 'enable-terminal.json'), JSON.stringify({ enabled: true }));
    }
  };

  it('REFUSES to execute by default (no opt-in file, no env var)', async () => {
    setupProject(false);
    const execute = terminalTools.find((t) => t.name === 'terminal_execute')!;
    const result = await execute.handler({ command: 'echo hello' });
    expect(result.success).toBe(false);
    expect(String(result.error || result.message || '')).toMatch(/opt-in|disabled|enable/i);
  });

  it('executes when MONOMIND_ENABLE_TERMINAL=1 is set', async () => {
    setupProject(false);
    process.env.MONOMIND_ENABLE_TERMINAL = '1';
    const execute = terminalTools.find((t) => t.name === 'terminal_execute')!;
    const result = await execute.handler({ command: 'echo hello' });
    expect(result.success !== false).toBe(true);
  });

  it('executes when .monomind/enable-terminal.json opts in', async () => {
    setupProject(true);
    const execute = terminalTools.find((t) => t.name === 'terminal_execute')!;
    const result = await execute.handler({ command: 'echo hello' });
    expect(result.success !== false).toBe(true);
  });

  it('terminal_create / terminal_list / terminal_history work WITHOUT opt-in', async () => {
    setupProject(false);
    // create should work — managing sessions isn't the dangerous op
    const create = terminalTools.find((t) => t.name === 'terminal_create')!;
    const created = await create.handler({ name: 'sess' });
    expect(created.success !== false).toBe(true);
    const list = terminalTools.find((t) => t.name === 'terminal_list')!;
    const listed = await list.handler({});
    expect(listed.success !== false).toBe(true);
  });
});
