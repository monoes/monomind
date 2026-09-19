// packages/@monomind/cli/src/orgrt/reporting.ts
// Read-side aggregation over an org run's bus.jsonl — powers `org report`,
// `org logs`, and the per-run summary line appended to <org>/history.jsonl.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BusEvent } from './types.js';
import { ORG_DIR } from './types.js';

export interface RoleStats {
  messagesSent: number;
  toolsAllowed: number;
  toolsDenied: number;
  tokens: number;
  costUsd: number;
  crashed: boolean;
}

export interface RunSummary {
  org: string;
  run: string;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  events: number;
  messages: number;
  xorgMessages: number;
  assets: string[];
  crashes: string[];
  /** Roles terminated by our own stop signal (exit 143), not real crashes. */
  cutShort: string[];
  /** #302: only ever set from a status event with reason 'org-complete' —
   *  i.e. only when a boss's org_complete call was actually ALLOWED (a
   *  refusal never emits that event). `status`/`summary` are the boss's own
   *  claim. */
  outcome: { status: string; summary: string; by: string } | null;
  /** #302: recorded TOP-LEVEL, a sibling of `outcome` rather than nested
   *  inside it — deliberately, per review: `outcome` is null on every
   *  non-org_complete stop path (idle watchdog, manual stop, a scheduled
   *  deadline, ...), the same way `crashes`/`cutShort` are top-level so they
   *  survive a stop that never produces an `outcome`. Only ever set alongside
   *  a genuine `outcome: 'partial'` (the only shape `blocker` accompanies —
   *  `checkCompletion` never lets a bare/invalid blocker through), so in
   *  practice it appears exactly when `outcome` does; the point is that a
   *  renderer must not have to reach INTO `outcome` to find it, and a future
   *  path that wants to record an attempted-but-refused blocker claim can
   *  populate this independently of whether `outcome` ever gets set. */
  blocker?: string;
  blockerDetail?: string;
  /** #302 truth gate: how the run actually ended, from the 'org-stopped'
   *  event `finishStop` always emits — the UNIVERSAL choke point every stop
   *  path funnels through (`stopOrg` → `finishStop`; `stopAll` fans out to
   *  `stopOrg`), so this is set correctly regardless of which of the many
   *  call sites triggered the stop: 'org-complete' for a boss's own,
   *  gate-checked call; 'idle-stop' | 'failed-start' | 'scheduled-deadline' |
   *  'boss-restart' | 'boss-restart-exhausted' for an automated path that
   *  ends the run without boss consent; undefined for a bare manual
   *  `org stop`/shutdown. (A process-level crash is recorded separately, in
   *  runtime.json only, by `persistCrashStateAll` — it never reaches this
   *  event at all, since the process has no time left for a graceful stop.
   *  KNOWN, REASONED GAP — an 11th path: `org mark-complete` (org.ts) also
   *  writes `closedBy: 'mark-complete'` directly to runtime.json, with a
   *  bare writeFileSync, and only runs once the daemon's pid is already
   *  gone. It never touches the bus or calls stopOrg/finishStop, so this
   *  RunSummary field — and `runnableTasksAtStop` — are simply absent for
   *  that run: there is no history.jsonl entry for it at all, since a
   *  SIGKILLed daemon never ran finishStop's history-append either. This is
   *  arguably correct (there is no stop to record if it never ran), but the
   *  absence is deliberate, not an oversight — a renderer must not assume
   *  every `closedBy` on runtime.json came from this truth gate.)
   *  Renderers MUST consult this before ever describing a run as
   *  "completed" — outcome alone is not enough, since a run that never
   *  called org_complete has a null outcome regardless of why it stopped. */
  closedBy?: string;
  /** #302: `org_tasks` entries still non-terminal at the moment this run
   *  stopped — 0 for a DAG-less run or one that finished every task. */
  runnableTasksAtStop: number;
  roles: Record<string, RoleStats>;
  totalTokens: number;
  totalCostUsd: number;
}

const roleStats = (): RoleStats => ({
  messagesSent: 0,
  toolsAllowed: 0,
  toolsDenied: 0,
  tokens: 0,
  costUsd: 0,
  crashed: false,
});

/** Aggregate one run's bus events into a summary. */
export function summarizeRun(events: BusEvent[]): RunSummary {
  const s: RunSummary = {
    org: events[0]?.org ?? '',
    run: events[0]?.run ?? '',
    startedAt: events.length ? events[0].ts : null,
    endedAt: events.length ? events[events.length - 1].ts : null,
    durationMs: null,
    events: events.length,
    messages: 0,
    xorgMessages: 0,
    assets: [],
    crashes: [],
    cutShort: [],
    outcome: null,
    runnableTasksAtStop: 0,
    roles: {},
    totalTokens: 0,
    totalCostUsd: 0,
  };
  if (s.startedAt !== null && s.endedAt !== null) s.durationMs = s.endedAt - s.startedAt;
  const role = (id: string | undefined): RoleStats => {
    const key = id ?? '(system)';
    return (s.roles[key] ??= roleStats());
  };
  for (const e of events) {
    switch (e.type) {
      case 'message':
        s.messages++;
        role(e.from).messagesSent++;
        break;
      case 'xorg':
        s.xorgMessages++;
        role(e.from?.includes(':') ? e.from.split(':')[1] : e.from).messagesSent++;
        break;
      case 'tool':
        if (e.decision === 'deny') role(e.from).toolsDenied++;
        else role(e.from).toolsAllowed++;
        break;
      case 'asset':
        if (e.path && !s.assets.includes(e.path)) s.assets.push(e.path);
        break;
      case 'usage': {
        const tokens = Number((e.data as { tokens?: number } | undefined)?.tokens ?? 0);
        const cost = Number((e.data as { cost_usd?: number } | undefined)?.cost_usd ?? 0);
        const r = role(e.from);
        r.tokens += tokens;
        s.totalTokens += tokens;
        if (Number.isFinite(cost)) {
          r.costUsd += cost;
          s.totalCostUsd += cost;
        }
        break;
      }
      case 'audit':
        if (e.reason === 'agent-session-crash' && e.from) {
          s.crashes.push(e.from);
          role(e.from).crashed = true;
        }
        break;
      case 'status': {
        if (e.reason === 'terminated-by-stop' && e.from) {
          s.cutShort.push(e.from);
        }
        if (e.reason === 'org-complete') {
          const d = e.data as
            | { outcome?: string; summary?: string; blocker?: string; blockerDetail?: string }
            | undefined;
          if (d?.outcome)
            s.outcome = { status: d.outcome, summary: d.summary ?? '', by: e.from ?? '' };
          // Top-level, not nested in `outcome` — see RunSummary's doc comment.
          if (d?.blocker) s.blocker = d.blocker;
          if (d?.blockerDetail) s.blockerDetail = d.blockerDetail;
        }
        // #302 truth gate: finishStop always emits exactly one of these per
        // run, regardless of which of the five stop paths fired — read it
        // unconditionally rather than only for a particular reason, so a
        // future stop path that forgets to set closedBy still shows up here
        // as undefined instead of silently vanishing.
        if (e.reason === 'org-stopped') {
          const d = e.data as { closedBy?: string; runnableTasks?: number } | undefined;
          s.closedBy = d?.closedBy;
          s.runnableTasksAtStop = d?.runnableTasks ?? 0;
        }
        break;
      }
    }
  }
  return s;
}

/** #302 truth gate: the one-word-ish outcome label a renderer may print for a
 *  run, honest about how it actually ended. A run with a genuine outcome (an
 *  ALLOWED org_complete call) reports that claim's status. Otherwise, a real
 *  crash wins (unchanged from before this item); otherwise an automated stop
 *  path's own recorded cause is reported, with the runnable-task count if any
 *  work was left outstanding — NEVER a plain "completed" for those, which is
 *  the exact misreading #302 exists to close (an idle-stopped run with a full
 *  backlog previously rendered identically to one whose boss finished
 *  cleanly). Only a bare manual stop with no crash and no automated cause
 *  falls back to "completed", same as before this item. */
export function describeRunOutcome(s: RunSummary): string {
  if (s.outcome) return s.outcome.status;
  if (s.crashes.length) return 'crashed';
  if (s.closedBy && s.closedBy !== 'org-complete') {
    const pending = s.runnableTasksAtStop > 0 ? ` (${s.runnableTasksAtStop} task(s) left)` : '';
    return `${s.closedBy}${pending}`;
  }
  return 'completed';
}

/** run directories for an org, newest first (by name — run-YYYYMMDDHHMMSS-xxxx sorts naturally). */
export function listRunDirs(cwd: string, org: string): string[] {
  const base = join(cwd, ORG_DIR, org);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((d) => d.startsWith('run-'))
    .sort()
    .reverse();
}

export function readRunEvents(cwd: string, org: string, run: string): BusEvent[] {
  const f = join(cwd, ORG_DIR, org, run, 'bus.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as BusEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is BusEvent => e !== null);
}

/** history.jsonl — one RunSummary line per completed run, appended by the daemon at stopOrg. */
export function historyFile(cwd: string, org: string): string {
  return join(cwd, ORG_DIR, org, 'history.jsonl');
}

export function readHistory(cwd: string, org: string): RunSummary[] {
  const f = historyFile(cwd, org);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as RunSummary;
      } catch {
        return null;
      }
    })
    .filter((s): s is RunSummary => s !== null);
}

// Human-facing times are rendered in UTC; the trailing Z says so, so operators
// and agents on other zones don't read them as local time (#253).
/** `HH:MM:SSZ` */
export function utcTime(ts: number): string {
  return `${new Date(ts).toISOString().slice(11, 19)}Z`;
}

/** `YYYY-MM-DD HH:MMZ` */
export function utcDateMinute(ts: number): string {
  return `${new Date(ts).toISOString().replace('T', ' ').slice(0, 16)}Z`;
}

/** One bus event as a compact human-readable log line. */
export function formatEvent(e: BusEvent): string {
  const t = utcTime(e.ts);
  const from = e.from ?? '·';
  switch (e.type) {
    case 'message':
    case 'xorg':
      return `${t} ${e.type === 'xorg' ? '⇄' : '→'} ${from} → ${e.to}: [${e.subject ?? ''}] ${trim(e.msg)}`;
    case 'chat':
      return `${t} 💬 ${from}: ${trim(e.msg)}`;
    case 'tool':
      return `${t} 🔧 ${from} ${e.tool} ${e.decision === 'deny' ? `DENIED (${e.reason})` : 'ok'}`;
    case 'asset':
      return `${t} 📄 ${from} wrote ${e.path}`;
    case 'usage':
      return `${t} 🪙 ${from} +${(e.data as { tokens?: number } | undefined)?.tokens ?? 0} tokens`;
    case 'audit':
      return `${t} ⚠️  ${from} ${e.msg ?? e.reason ?? ''}`;
    case 'question':
      return `${t} ❓ ${from}: ${trim(e.msg)}`;
    default:
      return `${t} ▪ ${from} ${e.type}: ${trim(e.msg ?? '')}`;
  }
}

// Newlines stripped BEFORE truncation — the truncated branch previously kept
// them, so long multi-line messages broke the one-line-per-event log format.
const trim = (s: string | undefined, n = 120): string => {
  if (!s) return '';
  const oneLine = s.replace(/\s*\n\s*/g, ' ');
  return oneLine.length > n ? `${oneLine.slice(0, n - 1)}…` : oneLine;
};
