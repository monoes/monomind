// ORG-8 regression: the Budgets tab's fallback scan must match BOTH real usage-event
// shapes emitted by orgrt — 'usage' events forwarded to the dashboard become
// 'org:usage' (nested { from, data: { tokens, cost_usd } }), and legacy direct writers
// may still emit the flattened 'agent:usage' { role, tokens_in, tokens_out, cost_usd }.
// Previously only 'agent:usage' was matched, so real v2 cost data (which only ever
// arrives as 'org:usage') never reached the UI.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleOrgRoutes } from '../ui/routes-org.mjs';

function makeRes() {
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(code: number, headers?: Record<string, string>) {
      res.statusCode = code;
      res.headers = headers || {};
    },
    end(chunk?: string) {
      if (chunk) res.body += chunk;
    },
  };
  return res;
}

describe('GET /api/org/:name/budgets — dual usage-event shape handling', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'org-budgets-usage-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('counts both org:usage (forwarded) and agent:usage (legacy) events toward the budget total', async () => {
    const orgDir = join(cwd, '.monomind', 'orgs', 'myorg');
    const runsDir = join(orgDir, 'runs');
    mkdirSync(runsDir, { recursive: true });

    const events = [
      // Real forwarded shape (attachForwarder's translate() default case for a raw
      // OrgBus 'usage' event): nested data.tokens / data.cost_usd, role under `from`.
      { type: 'org:usage', from: 'boss', data: { tokens: 500, cost_usd: 0.05 } },
      { type: 'org:usage', from: 'boss', data: { tokens: 300, cost_usd: 0.03 } },
      // Legacy/flattened shape, still supported for back-compat.
      { type: 'agent:usage', role: 'worker', tokens_in: 100, tokens_out: 50, cost_usd: 0.01 },
    ];
    writeFileSync(
      join(runsDir, 'run1.jsonl'),
      `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
    );

    const req = {
      method: 'GET',
      url: `/api/org/myorg/budgets?dir=${encodeURIComponent(cwd)}`,
    } as any;
    const res = makeRes();
    const handled = await handleOrgRoutes(req, res, '/api/org/myorg/budgets', null, {
      projectDir: cwd,
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    const boss = body.agents.find((a: any) => a.id === 'boss');
    expect(boss).toBeTruthy();
    expect(boss.tokens_used).toBe(800); // 500 + 300 from the two org:usage events
    expect(boss.total_cost_usd).toBeCloseTo(0.08, 5);

    const worker = body.agents.find((a: any) => a.id === 'worker');
    expect(worker).toBeTruthy();
    expect(worker.tokens_in).toBe(100);
    expect(worker.tokens_out).toBe(50);
    expect(worker.tokens_used).toBe(150);
    expect(worker.total_cost_usd).toBeCloseTo(0.01, 5);
  });
});
