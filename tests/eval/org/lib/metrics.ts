// tests/eval/org/lib/metrics.ts
//
// Run metrics for the org eval (org sections spec, section 10), computed from
// the files a run leaves in its directory: `bus.jsonl` and `context.jsonl`.
// One definition of spend, interventions and failures for every contender, so
// two configurations are never compared on different arithmetic.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type RoleContextSummary,
  readContextLog,
  summarizeContextLog,
} from '../../../../packages/@monomind/cli/src/orgrt/context-log.js';
import type { ScenarioManifest } from './manifest.js';

interface BusLine {
  ts?: number;
  type?: string;
  from?: string;
  reason?: string;
  msg?: string;
  data?: Record<string, unknown>;
}

export interface RoleMetrics {
  usd: number;
  tokens: number;
}

export interface RunMetrics {
  events: number;
  wall_ms: number;
  /** Sum of the cost every usage event reported. */
  usd_reported: number;
  /** False when some usage reported no USD (unknown, not zero): usd_reported is then a lower bound. */
  cost_complete: boolean;
  tokens_total: number;
  cache_read_share: number;
  roles: Record<string, RoleMetrics>;
  crashes: number;
  budget_closures: { usd: number; tokens: number };
  /** Questions a person would have to answer; a tool approval is counted apart. */
  human_questions: number;
  tool_approvals: number;
  concurrency_deferrals: number;
  session_starts: number;
  idle_stopped: boolean;
  context: RoleContextSummary[];
}

function readBus(runDir: string): BusLine[] {
  const file = join(runDir, 'bus.jsonl');
  if (!existsSync(file)) return [];
  const out: BusLine[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as BusLine);
    } catch {
      /* a torn final line */
    }
  }
  return out;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function runMetrics(runDir: string): RunMetrics {
  const events = readBus(runDir);
  const m: RunMetrics = {
    events: events.length,
    wall_ms: 0,
    usd_reported: 0,
    cost_complete: true,
    tokens_total: 0,
    cache_read_share: 0,
    roles: {},
    crashes: 0,
    budget_closures: { usd: 0, tokens: 0 },
    human_questions: 0,
    tool_approvals: 0,
    concurrency_deferrals: 0,
    session_starts: 0,
    idle_stopped: false,
    context: summarizeContextLog(readContextLog(runDir)),
  };
  let cacheRead = 0;
  const stamps = events.map((e) => e.ts).filter((t): t is number => typeof t === 'number');
  if (stamps.length) m.wall_ms = Math.max(...stamps) - Math.min(...stamps);
  for (const e of events) {
    const d = e.data ?? {};
    if (e.type === 'usage') {
      const role = (m.roles[e.from ?? '?'] ??= { usd: 0, tokens: 0 });
      if (typeof d.cost_usd === 'number') {
        m.usd_reported += d.cost_usd;
        role.usd += d.cost_usd;
      } else m.cost_complete = false;
      m.tokens_total += num(d.tokens);
      role.tokens += num(d.tokens);
      cacheRead += num(d.cache_read);
    } else if (e.type === 'question') {
      if (typeof d.requestId === 'string') m.tool_approvals++;
      else m.human_questions++;
    } else if (e.reason === 'agent-restart' || e.reason === 'agent-fatal') m.crashes++;
    else if (e.reason === 'budget-exhausted') {
      if (/^USD/i.test(e.msg ?? '')) m.budget_closures.usd++;
      else m.budget_closures.tokens++;
    } else if (e.reason === 'concurrency-limit') m.concurrency_deferrals++;
    else if (e.reason === 'session-run') m.session_starts++;
    else if (e.reason === 'idle-stop') m.idle_stopped = true;
  }
  m.cache_read_share = m.tokens_total ? cacheRead / m.tokens_total : 0;
  return m;
}

/** Total spend over accepted units. With nothing accepted the run is a failure,
 *  not a free one. */
export function costPerAcceptedUnit(
  spend: number,
  accepted: number,
): { value: number | null; failed: boolean } {
  return accepted > 0 ? { value: spend / accepted, failed: false } : { value: null, failed: true };
}

export interface FixtureOutcome {
  required_units: number;
  accepted_units: number;
  /** accepted / required. */
  coverage: number;
  /** Every required count met. */
  completed: boolean;
  /** Ids of units that fell short. */
  missing: string[];
}

/** Judge a fixture from the accepted count per unit id. A unit counts at most
 *  its required number, so splitting an artifact into fragments adds nothing. */
export function fixtureOutcome(
  manifest: ScenarioManifest,
  acceptedByUnit: Record<string, number>,
): FixtureOutcome {
  let required = 0;
  let accepted = 0;
  const missing: string[] = [];
  for (const u of manifest.units) {
    const got = Math.min(acceptedByUnit[u.id] ?? 0, u.count);
    required += u.count;
    accepted += got;
    if (got < u.count) missing.push(u.id);
  }
  return {
    required_units: required,
    accepted_units: accepted,
    coverage: required ? accepted / required : 0,
    completed: missing.length === 0,
    missing,
  };
}
