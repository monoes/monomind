/**
 * i-312: `doctor -c mcp` must actually start the configured MCP server.
 *
 * The incident these tests encode: `.mcp.json` pinned
 * `npx -y @monoes/monomindcli@2.11.1 mcp start`, which dies instantly with
 * "npm error could not determine executable to run". doctor reported a pass
 * because it only looked for a `monomind` key, so nobody noticed the graph
 * tools were gone.
 *
 * Every server here is a local node script (no network, no npx) so the suite
 * measures the probe, not the registry.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MCP_PROBE_TIMEOUT_MS,
  probeMcpServer,
  summarizeStderr,
} from '../commands/doctor-mcp-probe.js';

// A well-behaved stdio MCP server: newline-delimited JSON-RPC, answers
// `initialize` and then stays up, exactly like `monomind mcp start`.
const GOOD_SERVER = `
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  const lines = buf.split('\\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { protocolVersion: '2024-11-05', serverInfo: { name: 'fake', version: '0' } },
        }) + '\\n',
      );
    }
  }
});
`;

// The failure mode from the issue, reproduced byte-for-byte on stderr.
const BROKEN_SERVER = `
process.stderr.write('npm error could not determine executable to run\\n');
process.stderr.write('npm error A complete log of this run can be found in: /tmp/log\\n');
process.exit(1);
`;

// Starts, never answers, never exits — the "wedges doctor forever" case.
const HANGING_SERVER = `
require('node:fs').writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);
`;

describe('probeMcpServer', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'doctor-mcp-probe-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeServer(name: string, source: string): string {
    const file = join(dir, name);
    writeFileSync(file, source);
    return file;
  }

  it('reports ok when the server answers initialize', async () => {
    const result = await probeMcpServer({
      command: process.execPath,
      args: [writeServer('good.cjs', GOOD_SERVER)],
      timeoutMs: 8000,
    });
    expect(result.outcome).toBe('ok');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('reports failed with the real stderr when the command cannot start', async () => {
    const result = await probeMcpServer({
      command: process.execPath,
      args: [writeServer('broken.cjs', BROKEN_SERVER)],
      timeoutMs: 8000,
    });
    expect(result.outcome).toBe('failed');
    expect(result.stderr).toContain('could not determine executable to run');
    expect(result.exitCode).toBe(1);
  });

  it('reports failed when the command does not exist at all', async () => {
    const result = await probeMcpServer({
      command: join(dir, 'definitely-not-a-binary'),
      args: [],
      timeoutMs: 8000,
    });
    expect(result.outcome).toBe('failed');
    expect(result.stderr).toMatch(/ENOENT|not found|spawn/i);
  });

  it('times out instead of hanging, and kills the server it started', async () => {
    const pidFile = join(dir, 'pid');
    const started = Date.now();
    const result = await probeMcpServer({
      command: process.execPath,
      args: [writeServer('hanging.cjs', HANGING_SERVER), pidFile],
      timeoutMs: 1200,
    });
    const elapsed = Date.now() - started;

    expect(result.outcome).toBe('timeout');
    // Never hangs: the probe returns close to its own budget, not later.
    expect(elapsed).toBeLessThan(6000);

    // Reaped (o-04): the child is gone, not left running in the background.
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('keeps the default timeout in the low single-digit seconds', () => {
    expect(MCP_PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(2000);
    expect(MCP_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});

describe('summarizeStderr', () => {
  it('keeps the first lines and drops the noise', () => {
    const summary = summarizeStderr(
      'npm warn deprecated foo\nnpm error could not determine executable to run\n\nnpm error log at /tmp/x\n',
    );
    expect(summary).toContain('could not determine executable to run');
    expect(summary).not.toContain('\n');
  });

  it('truncates long output instead of flooding the doctor line', () => {
    const summary = summarizeStderr('x'.repeat(5000), 100);
    expect(summary.length).toBeLessThanOrEqual(101);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('returns an empty string when the server said nothing', () => {
    expect(summarizeStderr('   \n\n  ')).toBe('');
  });
});
