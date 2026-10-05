import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultMcpPaths } from '../mcp-server.js';
import { mcpStatusTool } from '../mcp-tools/system-tools-misc.js';

const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

beforeEach(() => {
  vi.stubEnv('MONOMIND_MCP_TRANSPORT', undefined);
  mkdirSync(dirname(getDefaultMcpPaths().pidFile), { recursive: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (ttyDescriptor) Object.defineProperty(process.stdin, 'isTTY', ttyDescriptor);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
  const { pidFile } = getDefaultMcpPaths();
  rmSync(pidFile, { force: true });
  rmSync(pidFile.replace(/\.pid$/, '.json'), { force: true });
});

describe('mcp_status reports server state', () => {
  it.each([false, undefined, true])(
    'does not infer a running server from stdin.isTTY=%s',
    async (isTTY) => {
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: isTTY });
      expect(await mcpStatusTool.handler({})).toMatchObject({ running: false });
    },
  );

  it('does not treat a configured stdio transport as a running server', async () => {
    vi.stubEnv('MONOMIND_MCP_TRANSPORT', 'stdio');
    expect(await mcpStatusTool.handler({})).toMatchObject({ running: false });
  });

  it('reports the transport and address recorded by a live server', async () => {
    const { pidFile } = getDefaultMcpPaths();
    writeFileSync(pidFile, String(process.pid));
    writeFileSync(
      pidFile.replace(/\.pid$/, '.json'),
      JSON.stringify({
        pid: process.pid,
        transport: 'websocket',
        host: '127.0.0.1',
        port: 41873,
        startedAt: new Date().toISOString(),
      }),
    );
    expect(await mcpStatusTool.handler({})).toMatchObject({
      running: true,
      pid: process.pid,
      transport: 'websocket',
      host: '127.0.0.1',
      port: 41873,
    });
  });

  it.each(['missing', 'stale', 'live'])(
    'reports the standalone server when the managed PID file is %s',
    async (record) => {
      if (record !== 'missing') {
        const { pidFile } = getDefaultMcpPaths();
        const pid = record === 'stale' ? 2147483647 : process.pid;
        writeFileSync(pidFile, String(pid));
        writeFileSync(
          pidFile.replace(/\.pid$/, '.json'),
          JSON.stringify({
            pid,
            transport: 'http',
            host: '127.0.0.1',
            port: 41873,
            startedAt: new Date().toISOString(),
          }),
        );
      }
      const dir = mkdtempSync(join(tmpdir(), 'monomind-stdio-status-'));
      mkdirSync(join(dir, 'bin'));
      mkdirSync(join(dir, 'dist/src'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
      copyFileSync(
        new URL('../../bin/mcp-server.js', import.meta.url),
        join(dir, 'bin/mcp-server.js'),
      );
      // Substitute the registry boundary so this exercises the real entry loop
      // and status implementation without loading unrelated optional tools.
      writeFileSync(
        join(dir, 'dist/src/mcp-server.js'),
        `export * from ${JSON.stringify(new URL('../mcp-server.ts', import.meta.url).href)};`,
      );
      writeFileSync(
        join(dir, 'dist/src/mcp-client.js'),
        `
      import { mcpStatusTool } from ${JSON.stringify(new URL('../mcp-tools/system-tools-misc.ts', import.meta.url).href)};
      export const hasTool = async () => true;
      export const listMCPTools = async () => [mcpStatusTool];
      export const callMCPTool = async (name, input) => mcpStatusTool.handler(input);
    `,
      );
      const require = createRequire(import.meta.url);
      const child = spawn(
        process.execPath,
        ['--import', require.resolve('tsx'), join(dir, 'bin/mcp-server.js')],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      try {
        const response = new Promise<string>((resolve, reject) => {
          let stdout = '';
          let stderr = '';
          child.stderr.on('data', (chunk) => {
            stderr += chunk;
          });
          child.stdout.on('data', (chunk) => {
            stdout += chunk;
            if (stdout.includes('\n')) resolve(stdout.split('\n')[0]);
          });
          child.on('error', reject);
          child.on('exit', (code) => reject(new Error(`MCP child exited ${code}: ${stderr}`)));
        });
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'mcp_status', arguments: {} } })}\n`,
        );
        const result = JSON.parse(await response);
        expect(JSON.parse(result.result.content[0].text)).toMatchObject({
          running: true,
          pid: child.pid,
          transport: 'stdio',
          port: null,
          host: null,
        });
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
          child.kill();
          await exited;
        }
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
