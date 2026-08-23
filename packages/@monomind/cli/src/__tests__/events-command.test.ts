import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventsCommand } from '../commands/events.js';
import type { CommandContext } from '../types.js';

describe('monomind events — headless JSONL tail of /api/mastermind-stream', () => {
  let cwd: string;
  let server: http.Server;
  let baseUrl: string;
  let receivedAuthHeader: string | undefined;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'events-cmd-'));
    mkdirSync(join(cwd, '.monomind'), { recursive: true });
    receivedAuthHeader = undefined;

    server = http.createServer((req, res) => {
      receivedAuthHeader = req.headers['x-monomind-token'] as string | undefined;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': connected\n\n');
      res.write(`data: ${JSON.stringify({ type: 'status', msg: 'hello' })}\n\n`);
      res.write(': ping\n\n');
      res.write(`data: ${JSON.stringify({ type: 'status', msg: 'world' })}\n\n`);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    writeFileSync(join(cwd, '.monomind', 'control.json'), JSON.stringify({ url: baseUrl }));
    writeFileSync(join(cwd, '.monomind', 'dashboard-token'), 'test-token-xyz');
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(cwd, { recursive: true, force: true });
  });

  function ctx(): CommandContext {
    return { args: [], flags: { _: [] }, cwd, interactive: false };
  }

  it('prints each SSE data frame as one JSONL line to stdout, skipping comments/pings', async () => {
    const lines: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      lines.push(String(chunk));
      return true;
    });

    const result = await eventsCommand.action?.(ctx());

    writeSpy.mockRestore();

    expect(result?.success).toBe(true);
    const joined = lines.join('');
    expect(joined).toContain(JSON.stringify({ type: 'status', msg: 'hello' }));
    expect(joined).toContain(JSON.stringify({ type: 'status', msg: 'world' }));
    expect(joined).not.toContain('connected');
    expect(joined).not.toContain('ping');
  });

  it('sends the dashboard-token as x-monomind-token', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await eventsCommand.action?.(ctx());
    vi.restoreAllMocks();
    expect(receivedAuthHeader).toBe('test-token-xyz');
  });

  it('fails cleanly with a clear error when the dashboard is unreachable', async () => {
    await server.close();
    const result = await eventsCommand.action?.(ctx());
    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
  });
});
