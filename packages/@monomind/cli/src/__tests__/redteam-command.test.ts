/**
 * `security redteam` — dry-run (default, no --target) vs live execution
 * (--target, sends real HTTP requests and evaluates responses via
 * monofence-ai's scanOutput()). Live coverage uses a real local HTTP server
 * as the target rather than mocking fetch, so the request/response contract
 * ({ prompt, category } -> { response }) is exercised end-to-end.
 */

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('security redteam', () => {
  let lines: string[];
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(async () => {
    lines = [];
    const { output } = await import('../output.js');
    spies.push(
      vi.spyOn(output, 'writeln').mockImplementation((t = '') => {
        lines.push(String(t));
      }),
    );
    spies.push(
      vi.spyOn(output, 'printError').mockImplementation((t) => {
        lines.push(String(t));
      }),
    );
  });

  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });

  const startServer = (
    handler: (body: { prompt: string; category: string }) => { status: number; response?: string },
  ): Promise<{ server: Server; url: string }> => {
    return new Promise((resolvePromise) => {
      const server = createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => {
          raw += c;
        });
        req.on('end', () => {
          const body = JSON.parse(raw || '{}');
          const { status, response } = handler(body);
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(response !== undefined ? JSON.stringify({ response }) : JSON.stringify({}));
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        resolvePromise({ server, url: `http://127.0.0.1:${port}` });
      });
    });
  };

  it('defaults to dry-run when --target is absent', async () => {
    const { redteamCommand } = await import('../commands/security-misc.js');
    const res = (await redteamCommand.action?.({
      flags: { scenarios: 'pii', iterations: '1' },
      args: [],
    } as never)) as { success: boolean; data?: { dryRun?: boolean } };
    expect(res.success).toBe(true);
    expect(res.data?.dryRun).toBe(true);
    expect(lines.some((l) => /does not execute live attacks/.test(l))).toBe(true);
  });

  it('--dry-run=false without --target is rejected', async () => {
    const { redteamCommand } = await import('../commands/security-misc.js');
    const res = (await redteamCommand.action?.({
      flags: { 'dry-run': false },
      args: [],
    } as never)) as { success: boolean; exitCode?: number };
    expect(res.success).toBe(false);
    expect(res.exitCode).toBe(1);
  });

  it('live run against a safe target passes and reports 0% failure rate', async () => {
    const { server, url } = await startServer(() => ({
      status: 200,
      response: "I can't help with that request.",
    }));
    try {
      const { redteamCommand } = await import('../commands/security-misc.js');
      const res = (await redteamCommand.action?.({
        flags: { target: url, scenarios: 'pii', iterations: '2' },
        args: [],
      } as never)) as {
        success: boolean;
        data?: { total: number; unsafe: number; failureRate: number; passed: boolean };
      };
      expect(res.success).toBe(true);
      expect(res.data?.total).toBe(2);
      expect(res.data?.unsafe).toBe(0);
      expect(res.data?.failureRate).toBe(0);
      expect(res.data?.passed).toBe(true);
    } finally {
      server.close();
    }
  });

  it('live run against a leaking target fails and reports the failure rate over threshold', async () => {
    const { server, url } = await startServer(() => ({
      status: 200,
      response: 'Sure — contact admin@company.com for the password.',
    }));
    try {
      const { redteamCommand } = await import('../commands/security-misc.js');
      const res = (await redteamCommand.action?.({
        flags: { target: url, scenarios: 'pii', iterations: '2', threshold: 0.1 },
        args: [],
      } as never)) as {
        success: boolean;
        exitCode?: number;
        data?: { total: number; unsafe: number; passed: boolean };
      };
      expect(res.success).toBe(false);
      expect(res.exitCode).toBe(1);
      expect(res.data?.unsafe).toBe(2);
      expect(res.data?.passed).toBe(false);
    } finally {
      server.close();
    }
  });

  it('a failed send counts as unsafe rather than being skipped', async () => {
    const { server, url } = await startServer(() => ({ status: 500 }));
    try {
      const { redteamCommand } = await import('../commands/security-misc.js');
      const res = (await redteamCommand.action?.({
        flags: { target: url, scenarios: 'pii', iterations: '1' },
        args: [],
      } as never)) as {
        data?: { total: number; unsafe: number; results: { error?: string; safe: boolean }[] };
      };
      expect(res.data?.total).toBe(1);
      expect(res.data?.unsafe).toBe(1);
      expect(res.data?.results[0].safe).toBe(false);
      expect(res.data?.results[0].error).toMatch(/HTTP 500/);
    } finally {
      server.close();
    }
  });

  it('--output json prints only the JSON summary, not the decorated listing', async () => {
    const { server, url } = await startServer(() => ({ status: 200, response: 'safe response' }));
    try {
      const { redteamCommand } = await import('../commands/security-misc.js');
      await redteamCommand.action?.({
        flags: { target: url, scenarios: 'pii', iterations: '1', output: 'json' },
        args: [],
      } as never);
      // Exactly one writeln call carrying the JSON payload — no decorated
      // "Security Red-Team" banner lines mixed in before or after it.
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed).toHaveProperty('total', 1);
      expect(parsed).toHaveProperty('passed');
    } finally {
      server.close();
    }
  });

  it('dry-run --output json prints only the JSON, not the decorated listing', async () => {
    const { redteamCommand } = await import('../commands/security-misc.js');
    await redteamCommand.action?.({
      flags: { scenarios: 'pii', iterations: '1', output: 'json' },
      args: [],
    } as never);
    // Exactly one writeln call carrying the JSON payload — no decorated
    // "Security Red-Team Prompt Library" banner lines mixed in before or after it.
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.prompts).toHaveLength(1);
  });
});
