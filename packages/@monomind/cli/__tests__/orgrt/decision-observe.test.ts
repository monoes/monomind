// #835 PR 9: org report / costs show a decision role as a decision role, not an empty agent row.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { costsAction, reportAction } from '../../src/commands/org-observe.js';
import { decisionRoleSummaries } from '../../src/commands/org-observe-shared.js';
import { type BusEvent, ORG_DIR } from '../../src/orgrt/types.js';

const RUN = 'run-20250130120000-abc';
const dirs: string[] = [];

function setup(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'org-decision-observe-'));
  dirs.push(cwd);
  mkdirSync(join(cwd, ORG_DIR, 'o', RUN), { recursive: true });
  writeFileSync(
    join(cwd, ORG_DIR, 'o.json'),
    JSON.stringify({
      name: 'o',
      roles: [
        { id: 'lead', reports_to: null },
        {
          id: 'triage',
          kind: 'decision',
          reports_to: 'lead',
          decision: {
            provider: 'local',
            question: 'choice',
            criteria: { approve: 'ok', deny: 'no' },
            threshold: 0.7,
            fallback_role: 'lead',
          },
        },
      ],
    }),
  );
  const ev = (e: Partial<BusEvent>): BusEvent =>
    ({ id: String(Math.random()), ts: 1, org: 'o', run: RUN, data: {}, ...e }) as BusEvent;
  const events = [
    ev({ type: 'message', from: 'lead', to: 'triage', subject: 's' }),
    ev({ type: 'message', from: 'triage', to: 'lead', subject: 'Re: s' }),
    ev({ type: 'usage', from: 'lead', data: { tokens: 10, cost_usd: 0.01 } }),
  ];
  writeFileSync(
    join(cwd, ORG_DIR, 'o', RUN, 'bus.jsonl'),
    `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
  );
  return cwd;
}

async function capture(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.join(' '));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('decision roles in org observe', () => {
  it('summarises kind, provider, threshold and fallback', () => {
    const cwd = setup();
    expect(decisionRoleSummaries(cwd, 'o').get('triage')).toBe(
      'decision role: choice via local, threshold 0.7, fallback lead',
    );
  });

  it('org report lists the decision role by its summary, not as an agent row', async () => {
    const cwd = setup();
    const out = await capture(() =>
      reportAction({ args: ['o'], flags: { run: RUN }, cwd, interactive: false } as never, 'o'),
    );
    expect(out).toContain('triage: decision role: choice via local, threshold 0.7, fallback lead');
    expect(out).not.toMatch(/triage: \d+ msgs/);
    expect(out).toMatch(/lead: \d+ msgs/);
  });

  it('org report --by-role leaves the decision role out of the cost table', async () => {
    const cwd = setup();
    const out = await capture(() =>
      reportAction(
        { args: ['o'], flags: { run: RUN, 'by-role': true }, cwd, interactive: false } as never,
        'o',
      ),
    );
    expect(out).toContain('lead');
    expect(out).not.toContain('triage');
  });

  it('org costs leaves the decision role out', async () => {
    const cwd = setup();
    writeFileSync(
      join(cwd, ORG_DIR, 'o', 'runtime.json'),
      JSON.stringify({
        run: RUN,
        roleMetrics: { lead: { tokens: 10, costUsd: 0.01 }, triage: { tokens: 0, costUsd: 0 } },
      }),
    );
    const out = await capture(() =>
      costsAction({ args: ['o'], flags: { run: RUN }, cwd, interactive: false } as never, 'o'),
    );
    expect(out).toContain('lead');
    expect(out).not.toContain('triage');
  });
});
