/**
 * i-032a — a checked-in file arms shell execution.
 *
 * Reproduced end-to-end, not read: a project containing ONLY
 * `.monomind/enable-terminal.json` with `{"enabled": true}`, with
 * `MONOMIND_ENABLE_TERMINAL` unset, drove `terminal_execute` over the real
 * stdio MCP path and got `success: true, exitCode: 0` — the checked-in file
 * alone armed shell execution for anyone who opens the repo. That is a
 * secret a project file can grant on behalf of a user who never wrote it,
 * and monomind's own error text (terminal-tools.ts:247) concedes the
 * metacharacter denylist "cannot prevent exfiltration via direct binaries
 * (curl, aws, scp)" — the opt-in is the only line of defence, not a second
 * one alongside the denylist.
 *
 * Fix: the opt-in flag must live OUTSIDE the repository
 * (~/.monomind/enable-terminal.json) or in the env var
 * (MONOMIND_ENABLE_TERMINAL=1). An in-project `.monomind/enable-terminal.json`
 * is still DETECTED — to explain, in the refusal error, why a legitimate
 * user's old file stopped working — but never migrated and never honoured.
 * Migrating it to the home directory on first run would preserve the exact
 * same attack with one extra hop and a persistent grant; this file's "no
 * migration" test is the guard against that regression.
 *
 * Every test below drives the real `mcp start` stdio path (spawn the actual
 * bin entry, speak JSON-RPC over its real stdin/stdout) rather than calling
 * isExecuteEnabled()/callMCPTool() in-process — the vulnerability is in the
 * boundary a real MCP client crosses, and a unit test on the predicate alone
 * already passed while that boundary was broken (the plan's own framing).
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'cli.js');

/** Send newline-delimited JSON-RPC messages and collect parsed responses. */
function collectResponses(
  child: ChildProcessWithoutNullStreams,
  count: number,
  timeoutMs: number,
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const responses: any[] = [];
    let buffer = '';
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for ${count} response(s); got ${responses.length}: ${JSON.stringify(responses)}`,
        ),
      );
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          responses.push(JSON.parse(line));
        } catch {
          continue;
        }
        if (responses.length >= count) {
          clearTimeout(timer);
          resolve(responses);
          return;
        }
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Spawn the real CLI's `mcp start`, perform the standard handshake, and call
 * `terminal_execute` with the given command. Returns the parsed tool result
 * (the `{success, command, output, exitCode}` / `{success:false, error}`
 * shape `terminal-tools.ts` returns — mcp-server.ts's tools/call handler
 * wraps a non-MCP-shaped result as `{content:[{type:'text', text: JSON...}]}`,
 * so this unwraps that envelope).
 */
function runTerminalExecute(
  cwd: string,
  env: Record<string, string | undefined>,
  command: string,
): Promise<{ child: ChildProcessWithoutNullStreams; result: any }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_BIN, 'mcp', 'start'], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    collectResponses(child, 2, 20000)
      .then((responses) => {
        const callResponse = responses.find((r) => r.id === 2);
        if (!callResponse) {
          reject(new Error(`No tools/call response: ${JSON.stringify(responses)}`));
          return;
        }
        if (callResponse.error) {
          reject(new Error(`tools/call errored: ${JSON.stringify(callResponse.error)}`));
          return;
        }
        const text = callResponse.result?.content?.[0]?.text;
        let result: any;
        try {
          result = JSON.parse(text);
        } catch {
          reject(new Error(`tools/call result content wasn't JSON: ${text}`));
          return;
        }
        resolve({ child, result });
      })
      .catch(reject);

    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'terminal_execute', arguments: { command } },
      })}\n`,
    );
  });
}

describe('terminal_execute opt-in (i-032a, real stdio path)', () => {
  let projectDir: string;
  let homeDir: string;
  let child: ChildProcessWithoutNullStreams | null = null;

  afterEach(() => {
    if (child && !child.killed) child.kill();
    child = null;
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  function writeProjectFlag(): void {
    const dir = join(projectDir, '.monomind');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'enable-terminal.json'), JSON.stringify({ enabled: true }));
  }

  function writeHomeFlag(): void {
    const dir = join(homeDir, '.monomind');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'enable-terminal.json'), JSON.stringify({ enabled: true }));
  }

  function freshDirs(): void {
    projectDir = mkdtempSync(join(tmpdir(), 'monomind-i032a-project-'));
    homeDir = mkdtempSync(join(tmpdir(), 'monomind-i032a-home-'));
  }

  // AC-1 (and the RED-then-GREEN regression for the original bug): a
  // project-committed enable-terminal.json must no longer arm execution.
  it('a project-committed .monomind/enable-terminal.json does NOT arm terminal_execute', async () => {
    freshDirs();
    writeProjectFlag();

    const { child: c, result } = await runTerminalExecute(
      projectDir,
      { HOME: homeDir, MONOMIND_ENABLE_TERMINAL: undefined },
      'echo ARMED_BY_CHECKED_IN_FILE',
    );
    child = c;

    expect(result.success).toBe(false);
    // The command must genuinely not have run — not just a falsy flag.
    expect(result.output).toBeUndefined();
    expect(result.exitCode).toBeUndefined();
  }, 25000);

  // AC-2: the documented opt-in survives, by its new route — a flag file
  // under the user's OWN home directory, not the repository.
  it('~/.monomind/enable-terminal.json (outside the repo) DOES arm terminal_execute', async () => {
    freshDirs();
    writeHomeFlag();

    const { child: c, result } = await runTerminalExecute(
      projectDir,
      { HOME: homeDir, MONOMIND_ENABLE_TERMINAL: undefined },
      'echo ARMED_BY_HOME_FILE',
    );
    child = c;

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('ARMED_BY_HOME_FILE');
  }, 25000);

  // AC-3: the env var opt-in still works, with no project or home file at all.
  it('MONOMIND_ENABLE_TERMINAL=1 DOES arm terminal_execute with no flag file anywhere', async () => {
    freshDirs();

    const { child: c, result } = await runTerminalExecute(
      projectDir,
      { HOME: homeDir, MONOMIND_ENABLE_TERMINAL: '1' },
      'echo ARMED_BY_ENV_VAR',
    );
    child = c;

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('ARMED_BY_ENV_VAR');
  }, 25000);

  // AC-4 — the fatal-convenience guard: a project file must be IGNORED, not
  // migrated. A "helpful" first-run copy to ~/.monomind/ would preserve the
  // exact same attack with one extra hop and a now-persistent grant.
  it('does NOT migrate a project-committed flag file to the home directory', async () => {
    freshDirs();
    writeProjectFlag();
    const homeFlagPath = join(homeDir, '.monomind', 'enable-terminal.json');
    expect(existsSync(homeFlagPath)).toBe(false);

    const { child: c } = await runTerminalExecute(
      projectDir,
      { HOME: homeDir, MONOMIND_ENABLE_TERMINAL: undefined },
      'echo SHOULD_NOT_RUN',
    );
    child = c;

    expect(existsSync(homeFlagPath)).toBe(false);
  }, 25000);

  // AC-5: a legitimate user whose old project file stopped working must be
  // told why and how to fix it — not just refused silently.
  it('names the in-project file and the remedy when refusing a project-committed flag', async () => {
    freshDirs();
    writeProjectFlag();

    const { child: c, result } = await runTerminalExecute(
      projectDir,
      { HOME: homeDir, MONOMIND_ENABLE_TERMINAL: undefined },
      'echo unused',
    );
    child = c;

    expect(result.success).toBe(false);
    // Must name the mechanism that stopped working, distinctly from the
    // plain no-signal-anywhere refusal below — a legitimate user whose old
    // project file stopped working needs to know THAT is why, not just that
    // execution is disabled by default.
    expect(result.error).toMatch(
      /found.*\.monomind\/enable-terminal\.json.*project|project.*no longer/i,
    );
    expect(result.error).toMatch(/~\/\.monomind\/enable-terminal\.json|MONOMIND_ENABLE_TERMINAL/);
  }, 25000);

  // AC-7: the gate must not rely on the tool being unadvertised. Re-run the
  // AC-1 reproduction with MONOMIND_MCP_FULL=1, which advertises the full
  // tool roster (including terminal_execute) in tools/list.
  it('still refuses a project-committed flag with MONOMIND_MCP_FULL=1 (obscurity is not the gate)', async () => {
    freshDirs();
    writeProjectFlag();

    const { child: c, result } = await runTerminalExecute(
      projectDir,
      { HOME: homeDir, MONOMIND_ENABLE_TERMINAL: undefined, MONOMIND_MCP_FULL: '1' },
      'echo ARMED_BY_CHECKED_IN_FILE',
    );
    child = c;

    expect(result.success).toBe(false);
    expect(result.output).toBeUndefined();
  }, 25000);

  // Absence of BOTH signals: no flag file anywhere, no env var — the
  // original default-deny behaviour must be untouched by this fix.
  it('refuses with no opt-in signal anywhere (baseline, unchanged)', async () => {
    freshDirs();

    const { child: c, result } = await runTerminalExecute(
      projectDir,
      { HOME: homeDir, MONOMIND_ENABLE_TERMINAL: undefined },
      'echo unused',
    );
    child = c;

    expect(result.success).toBe(false);
    // No project file exists in this fixture — the project-specific hint
    // must NOT appear (it would be actively misleading: there's nothing to
    // find), distinguishing this from the previous test's assertion.
    expect(result.error).not.toMatch(/found.*\.monomind\/enable-terminal\.json/i);
  }, 25000);
});
