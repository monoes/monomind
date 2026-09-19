/**
 * `mcp monoes-proxy` is a long-lived stdio MCP server, like `mcp start`.
 * bin/cli.js force-exits every other command 5s after its action resolves,
 * and the proxy's action resolves as soon as its stdin reader is set up — so
 * the proxy died 5s after Claude Code connected, and `/mcp` showed monoes as
 * failed (owner testing, 2026-09-19). This spawns the real bin and checks the
 * process is still serving after that window.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const CLI_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'cli.js');
let home = '';

afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('mcp monoes-proxy process lifetime', () => {
  it('is still running 7s after startup while stdin stays open', async () => {
    home = mkdtempSync(join(tmpdir(), 'monoes-proxy-alive-'));
    mkdirSync(join(home, '.monomind'), { recursive: true });
    writeFileSync(
      join(home, '.monomind', 'monoes-connection.json'),
      JSON.stringify({
        accessToken: /* value */ 'FAKE-AT-alive',
        expiresAt: Date.now() + 10 * 60 * 1000,
      }),
    );
    const child = spawn(process.execPath, [CLI_BIN, 'mcp', 'monoes-proxy'], {
      cwd: home,
      env: {
        ...process.env,
        MONOMIND_HOME: home,
        MONOMIND_AUTO_UPDATE: 'false',
        MONOMIND_CRASH_REPORTING: 'off',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let exitCode: number | null | undefined;
    child.on('exit', (code) => {
      exitCode = code;
    });
    await new Promise((r) => setTimeout(r, 7000));
    const aliveAfterWindow = exitCode === undefined;
    child.stdin.end();
    child.kill('SIGTERM');
    expect(aliveAfterWindow, `proxy exited early with code ${exitCode}`).toBe(true);
  }, 20_000);
});
