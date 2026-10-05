// packages/@monomind/cli/__tests__/orgrt/support/section-budget-org.ts
// Shared by the P4.5 tests: a valid sections org with section budgets, and a scripted runner that reports a USD
// cost for every message it is given (`cost=<usd>` in the text), so a real OrgDaemon records usage without a model.
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentMessage, AgentRunArgs, AgentRunner } from '../../../src/orgrt/agent-runner.js';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { findingsOrg } from './doc-defs.js';

/** The caps of `budgetedOrg`: research 30 (research-lead 10, researcher 20), development 30 (dev-lead 10, coder
 *  20), watch 10 (observer 10), reserve 40 (boss 20), org 110. */
export const CAPS: Record<string, number> = {
  boss: 20,
  observer: 10,
  'research-lead': 10,
  researcher: 20,
  'dev-lead': 10,
  coder: 20,
};

export function budgetedOrg(patch: (raw: Record<string, any>) => void = () => {}): Record<string, any> {
  const raw = findingsOrg();
  for (const r of raw.roles) r.budget_usd = CAPS[r.id];
  raw.run_config.budget_usd = 110;
  raw.sections.research.budget = { usd: 30 };
  raw.sections.development.budget = { usd: 30 };
  raw.sections.watch.budget = { usd: 10 };
  patch(raw);
  return raw;
}

/** Every `cost=<usd>` in a message is added to the session's cumulative total, as the SDK reports it. */
export class CostRunner implements AgentRunner {
  private sessions = 0;
  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const sid = `cost-${++this.sessions}`;
    let total = 0;
    for await (const m of args.prompt as AsyncIterable<{ message?: { content?: unknown } }>) {
      total += Number(/cost=([\d.]+)/.exec(String(m.message?.content ?? ''))?.[1] ?? 0);
      yield { type: 'assistant', text: 'ok', session_id: sid } as AgentMessage;
      yield {
        type: 'result',
        subtype: 'success',
        input_tokens: 1,
        output_tokens: 1,
        session_id: sid,
        cost_usd: total,
      } as AgentMessage;
    }
  }
}

export interface Started {
  root: string;
  daemon: OrgDaemon;
  write: (raw: Record<string, any>) => void;
  name: string;
}

/** A temp org root with `raw` written as `.monomind/orgs/<name>.json`, and a daemon driven by `runner`. */
export function newOrgRoot(raw: Record<string, any>, runner: AgentRunner = new CostRunner()): Started {
  const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'section-budget-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  const write = (def: Record<string, any>): void =>
    writeFileSync(join(root, '.monomind/orgs', `${def.name}.json`), JSON.stringify(def));
  write(raw);
  const daemon = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  return { root, daemon, write, name: raw.name };
}

export async function waitUntil(pred: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return pred();
}

export const ROLES = Object.keys(CAPS);

/** Start the org with the eval gate (a sections org needs it) and bring every lazy role up. */
export async function startAll(s: Started, options: { resume?: boolean } = {}) {
  const running = await s.daemon.startOrg(s.name, undefined, { evalGate: true, ...options });
  for (const id of ROLES)
    if (!running.agents.has(id)) await s.daemon.deliver(s.name, 'human', id, 'hello', 'hello');
  return running;
}
