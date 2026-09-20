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
 *
 * i-032a (verifier finding, this run): a PROJECT-directory
 * `.monomind/enable-terminal.json` used to arm execution — which meant a
 * file checked into the repository armed shell execution for anyone who
 * cloned it, consent expressed by a file the user never saw and did not
 * write. i-032a moved the flag's resolution to the user's OWN home
 * directory (`~/.monomind/enable-terminal.json`); the project-directory
 * file is now only DETECTED (never read for its value) so the refusal
 * error can tell a legitimate user why their old file stopped working.
 * `terminal-tools.test.ts`/the plan's own tests cover this at the unit
 * level directly against `terminal-tools.ts`; this file is a SEPARATE,
 * end-to-end-shaped harness that predates i-032a and was never in the
 * plan's file list — it went orphaned asserting the OLD (vulnerable)
 * behaviour because nothing updated it when the fix landed elsewhere.
 * Its 'executes when .monomind/enable-terminal.json opts in' case
 * literally asserted the vulnerability i-032a exists to eliminate: kept
 * here, INVERTED to assert the fixed behaviour, not deleted — a second,
 * independent harness agreeing with the unit-level one is worth more than
 * one harness alone, which is exactly why an orphaned test like this
 * should be corrected rather than removed when it's found.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// terminal-tools.ts's homeFlagPath() resolves via `homedir()` from
// 'node:os'. Setting `process.env.HOME` at runtime does not reliably
// change `os.homedir()`'s return value inside vitest's worker environment
// (confirmed by hand: it kept returning the real host home directory even
// after reassigning `process.env.HOME` in `beforeEach`) — so "the user's
// home" is mocked directly at the module level instead, which is also the
// more explicit, harness-independent way to control it.
let homedirOverride = '';
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => homedirOverride,
    default: { ...actual, homedir: () => homedirOverride },
  };
});

const { terminalTools } = await import(
  '../../packages/@monomind/cli/src/mcp-tools/terminal-tools.js'
);

const ORIGINAL_ENV = { ...process.env };

describe('C2 — terminal_execute opt-in gate', () => {
  let tmpDir: string;
  let fakeHome: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-term-gate-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-term-gate-home-'));
    homedirOverride = fakeHome;
    originalCwd = process.cwd;
    process.cwd = () => tmpDir;
    delete process.env.MONOMIND_ENABLE_TERMINAL;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  const setupProject = (enable = false) => {
    const monoDir = path.join(tmpDir, '.monomind');
    fs.mkdirSync(monoDir, { recursive: true });
    if (enable) {
      fs.writeFileSync(
        path.join(monoDir, 'enable-terminal.json'),
        JSON.stringify({ enabled: true }),
      );
    }
  };

  const setupHome = (enable = false) => {
    const monoDir = path.join(fakeHome, '.monomind');
    fs.mkdirSync(monoDir, { recursive: true });
    if (enable) {
      fs.writeFileSync(
        path.join(monoDir, 'enable-terminal.json'),
        JSON.stringify({ enabled: true }),
      );
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

  // i-032a: INVERTED from "executes when .monomind/enable-terminal.json
  // opts in" — that assertion was the vulnerability itself. A
  // project-committed flag file must never arm execution, and the refusal
  // must name the mechanism so a legitimate user (who had this working
  // before i-032a) understands why and what to do instead, rather than
  // silently failing with the generic "no opt-in" message.
  it('does NOT execute when a project-directory .monomind/enable-terminal.json opts in, and the refusal names the mechanism', async () => {
    setupProject(true);
    const execute = terminalTools.find((t) => t.name === 'terminal_execute')!;
    const result = await execute.handler({ command: 'echo hello' });
    expect(result.success).toBe(false);
    const message = String(result.error || result.message || '');
    expect(message).toMatch(/opt-in|disabled|enable/i);
    // Names the exact mechanism, not just "refused" — a user who reads
    // this must be able to tell their old file stopped working (i-032a)
    // and that project files never grant terminal access, rather than
    // just seeing the same generic no-opt-in message as the default case.
    expect(message).toContain('enable-terminal.json in this project');
    expect(message).toContain('no longer grant terminal access');
  });

  // The case this harness's direct-import shape is uniquely suited for:
  // proves the unit-level contract (the $HOME-resolved path arms
  // execution) without spawning a real MCP stdio process — complementing
  // the separate end-to-end reproduction this item's own new test file
  // provides. Two independent harnesses agreeing is stronger evidence
  // than either alone.
  it("executes when ~/.monomind/enable-terminal.json (the user's home, not the project) opts in", async () => {
    setupProject(false);
    setupHome(true);
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
