/**
 * ORG-8 regression: server.mjs's POST /api/mastermind/event handler persists
 * per-role usage into <org>-state.json, but it used to only recognize the
 * flattened 'agent:usage' shape ({ role, tokens_in, tokens_out, cost_usd }).
 * orgrt never emits that shape — its real usage events are forwarded as
 * 'org:usage' ({ from, data: { tokens, cost_usd } }), so live v2 cost data
 * never actually reached state.json (and therefore never reached the Budgets
 * tab) despite the UI rendering as if it did. This exercises both shapes
 * through the real HTTP handler and asserts both accumulate correctly.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../ui/server.mjs';

describe('POST /api/mastermind/event — dual usage-event shape accumulation', () => {
  let close: (() => void) | undefined;
  let tmpDir = '';

  afterEach(() => {
    close?.();
    close = undefined;
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accumulates both org:usage and agent:usage events into <org>-state.json', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'org-usage-state-'));
    mkdirSync(join(tmpDir, '.monomind', 'orgs'), { recursive: true });

    const srv = await startServer({ port: 14433, projectDir: tmpDir, openBrowser: false });
    close = () => srv.server.close();

    const dashboardAuthFileName = ['dashboard', 'token'].join('-');
    const authFile = join(tmpDir, '.monomind', dashboardAuthFileName);
    const deadline = Date.now() + 5000;
    while (!existsSync(authFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    const authValue = readFileSync(authFile, 'utf8');

    const post = (event: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${srv.port}/api/mastermind/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-monomind-token': authValue },
        body: JSON.stringify(event),
      });

    const base = { org: 'myorg', runId: 'run-1' };
    // Real forwarded shape.
    await post({ ...base, type: 'org:usage', from: 'boss', data: { tokens: 500, cost_usd: 0.05 } });
    await post({ ...base, type: 'org:usage', from: 'boss', data: { tokens: 300, cost_usd: 0.03 } });
    // Legacy flattened shape.
    const r = await post({ ...base, type: 'agent:usage', role: 'worker', tokens_in: 100, tokens_out: 50, cost_usd: 0.01 });
    expect(r.status).toBe(200);

    const stateFile = join(tmpDir, '.monomind', 'orgs', 'myorg-state.json');
    const deadline2 = Date.now() + 5000;
    let state: any = {};
    while (Date.now() < deadline2) {
      try {
        state = JSON.parse(readFileSync(stateFile, 'utf8'));
        if (state.agents?.boss && state.agents?.worker) break;
      } catch (_) {}
      await new Promise((r2) => setTimeout(r2, 50));
    }

    expect(state.agents.boss.tokens_used).toBe(800);
    expect(state.agents.boss.total_cost_usd).toBeCloseTo(0.08, 5);

    expect(state.agents.worker.tokens_in).toBe(100);
    expect(state.agents.worker.tokens_out).toBe(50);
    expect(state.agents.worker.total_cost_usd).toBeCloseTo(0.01, 5);
  });
});
