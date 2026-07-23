/**
 * MCP stdio integration test — real child-process JSON-RPC round trip.
 *
 * Regression coverage for issue #36: in 2.5.5, a malformed/edge-case stdin
 * line could return a `Parse error` (-32700) response that wedged the whole
 * MCP connection so `tools/list` never returned, breaking every client that
 * connects via `claude mcp add monomind -- npx -y monomind@latest mcp start`.
 * Every other test in this suite talks to `listMCPTools()`/`callMCPTool()`
 * in-process (mocked or not) — none of them spawn the actual bin entry point
 * and drive it over real stdio, so none of them would catch a regression in
 * the stdin framing/dispatch loop itself. This test does exactly that:
 * spawn `bin/cli.js mcp start`, speak newline-delimited JSON-RPC over its
 * real stdin/stdout, and assert `tools/list` comes back non-empty after a
 * standard `initialize` -> `notifications/initialized` -> `tools/list`
 * handshake.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_BIN = join(__dirname, '..', 'bin', 'cli.js');

/** Send newline-delimited JSON-RPC messages and collect parsed responses. */
function collectResponses(child: ChildProcessWithoutNullStreams, count: number, timeoutMs: number): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const responses: any[] = [];
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${count} response(s); got ${responses.length}: ${JSON.stringify(responses)}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          responses.push(JSON.parse(line));
        } catch {
          // Non-JSON stdout noise — ignore, keep waiting.
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

describe('MCP stdio integration (real child process, issue #36 regression)', () => {
  let child: ChildProcessWithoutNullStreams | null = null;

  afterEach(() => {
    if (child && !child.killed) {
      child.kill();
    }
    child = null;
  });

  it('returns a non-empty tools/list after initialize -> notifications/initialized -> tools/list over real stdio', async () => {
    child = spawn('node', [CLI_BIN, 'mcp', 'start'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Only `initialize` and `tools/list` produce responses;
    // `notifications/initialized` is a notification (no id -> no response).
    const responsesPromise = collectResponses(child, 2, 20000);

    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');

    const responses = await responsesPromise;

    const initResponse = responses.find((r) => r.id === 1);
    expect(initResponse).toBeDefined();
    expect(initResponse.error).toBeUndefined();
    expect(initResponse.result?.serverInfo?.name).toBe('monomind');

    const toolsResponse = responses.find((r) => r.id === 2);
    expect(toolsResponse).toBeDefined();
    expect(toolsResponse.error).toBeUndefined();
    expect(Array.isArray(toolsResponse.result?.tools)).toBe(true);
    expect(toolsResponse.result.tools.length).toBeGreaterThan(0);
    for (const tool of toolsResponse.result.tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
    }
  }, 25000);

  it('recovers from a malformed JSON-RPC line instead of wedging the connection (2.5.5 regression)', async () => {
    child = spawn('node', [CLI_BIN, 'mcp', 'start'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // A bad line should get a -32700 Parse error but must NOT prevent
    // subsequent valid requests on the same connection from being answered.
    const responsesPromise = collectResponses(child, 3, 20000);

    child.stdin.write('{not valid json\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');

    const responses = await responsesPromise;

    const parseError = responses.find((r) => r.error?.code === -32700);
    expect(parseError).toBeDefined();

    const toolsResponse = responses.find((r) => r.id === 2);
    expect(toolsResponse).toBeDefined();
    expect(Array.isArray(toolsResponse.result?.tools)).toBe(true);
    expect(toolsResponse.result.tools.length).toBeGreaterThan(0);
  }, 25000);
});
