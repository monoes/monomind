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
  outcome: { status: string; summary: string; by: string } | null;
  roles: Record<string, RoleStats>;
  totalTokens: number;
  totalCostUsd: number;
}

const roleStats = (): RoleStats =>
  ({ messagesSent: 0, toolsAllowed: 0, toolsDenied: 0, tokens: 0, costUsd: 0, crashed: false });

/** Aggregate one run's bus events into a summary. */
export function summarizeRun(events: BusEvent[]): RunSummary {
  const s: RunSummary = {
    org: events[0]?.org ?? '', run: events[0]?.run ?? '',
    startedAt: events.length ? events[0].ts : null,
    endedAt: events.length ? events[events.length - 1].ts : null,
    durationMs: null, events: events.length,
    messages: 0, xorgMessages: 0, assets: [], crashes: [], outcome: null,
    roles: {}, totalTokens: 0, totalCostUsd: 0,
  };
  if (s.startedAt !== null && s.endedAt !== null) s.durationMs = s.endedAt - s.startedAt;
  const role = (id: string | undefined): RoleStats => {
    const key = id ?? '(system)';
    return (s.roles[key] ??= roleStats());
  };
  for (const e of events) {
    switch (e.type) {
      case 'message':
        s.messages++; role(e.from).messagesSent++; break;
      case 'xorg':
        s.xorgMessages++; role(e.from?.includes(':') ? e.from.split(':')[1] : e.from).messagesSent++; break;
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
        r.tokens += tokens; s.totalTokens += tokens;
        if (Number.isFinite(cost)) { r.costUsd += cost; s.totalCostUsd += cost; }
        break;
      }
      case 'audit':
        if (e.reason === 'agent-session-crash' && e.from) {
          s.crashes.push(e.from);
          role(e.from).crashed = true;
        }
        break;
      case 'status': {
        const d = e.data as { outcome?: string; summary?: string } | undefined;
        if (e.reason === 'org-complete' && d?.outcome)
          s.outcome = { status: d.outcome, summary: d.summary ?? '', by: e.from ?? '' };
        break;
      }
    }
  }
  return s;
}

/** run directories for an org, newest first (by name — run-YYYYMMDDHHMMSS-xxxx sorts naturally). */
export function listRunDirs(cwd: string, org: string): string[] {
  const base = join(cwd, ORG_DIR, org);
  if (!existsSync(base)) return [];
  return readdirSync(base).filter(d => d.startsWith('run-')).sort().reverse();
}

export function readRunEvents(cwd: string, org: string, run: string): BusEvent[] {
  const f = join(cwd, ORG_DIR, org, run, 'bus.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) as BusEvent; } catch { return null; } })
    .filter((e): e is BusEvent => e !== null);
}

/** history.jsonl — one RunSummary line per completed run, appended by the daemon at stopOrg. */
export function historyFile(cwd: string, org: string): string {
  return join(cwd, ORG_DIR, org, 'history.jsonl');
}

export function readHistory(cwd: string, org: string): RunSummary[] {
  const f = historyFile(cwd, org);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) as RunSummary; } catch { return null; } })
    .filter((s): s is RunSummary => s !== null);
}

/** One bus event as a compact human-readable log line. */
export function formatEvent(e: BusEvent): string {
  const t = new Date(e.ts).toISOString().slice(11, 19);
  const from = e.from ?? '·';
  switch (e.type) {
    case 'message':
    case 'xorg':
      return `${t} ${e.type === 'xorg' ? '⇄' : '→'} ${from} → ${e.to}: [${e.subject ?? ''}] ${trim(e.msg)}`;
    case 'chat': return `${t} 💬 ${from}: ${trim(e.msg)}`;
    case 'tool': return `${t} 🔧 ${from} ${e.tool} ${e.decision === 'deny' ? `DENIED (${e.reason})` : 'ok'}`;
    case 'asset': return `${t} 📄 ${from} wrote ${e.path}`;
    case 'usage': return `${t} 🪙 ${from} +${(e.data as { tokens?: number } | undefined)?.tokens ?? 0} tokens`;
    case 'audit': return `${t} ⚠️  ${from} ${e.msg ?? e.reason ?? ''}`;
    case 'question': return `${t} ❓ ${from}: ${trim(e.msg)}`;
    default: return `${t} ▪ ${from} ${e.type}: ${trim(e.msg ?? '')}`;
  }
}

// Newlines stripped BEFORE truncation — the truncated branch previously kept
// them, so long multi-line messages broke the one-line-per-event log format.
const trim = (s: string | undefined, n = 120): string => {
  if (!s) return '';
  const oneLine = s.replace(/\s*\n\s*/g, ' ');
  return oneLine.length > n ? `${oneLine.slice(0, n - 1)}…` : oneLine;
};
