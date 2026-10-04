// orgrt/documents/unread-watch-run.ts
//
// Runs the unread-document watch (P3.13) for one org: builds the snapshot of unread-watch.ts from the documents
// runtime (the P3.8 notice facts, the P3.5 store and its `decided` events), sends each notice to the lead's
// mailbox and records it on the bus as an audit event `doc-unread`. It persists nothing of its own: the state is
// the committed event log, the notice journal and the bus. An org without a documents runtime gets nothing.
//
// Resume: the episode table starts empty and is seeded from the run's bus history (the `doc-unread` events of the
// same run), so a version never gets more than MAX_NOTICES notices in all and the gap since the last one holds;
// the clock of every open version starts no earlier than the resume, so a resume raises nothing at once.
import { join } from 'node:path';
import { OrgBus } from '../bus.js';
import type { OrgDaemon } from '../daemon.js';
import type { RunningOrg } from '../daemon-types.js';
import * as questionOps from '../questions.js';
import { RUNTIME_SENDER } from './deliver.js';
import { EventLog, parseLog } from './events.js';
import { leadFor } from './lead-rules.js';
import type { DocumentsRuntime } from './runtime.js';
import { type UnreadVersion, UnreadWatch, unreadIntervalMs } from './unread-watch.js';

/** Who decided what, from the committed `decided` events (the store summary only has per-version status). */
function decisions(docs: DocumentsRuntime): {
  has(doc: string, version: number, by: string): boolean;
  stop(): void;
} {
  const seen = new Set<string>();
  const key = (doc: string, version: number, by: string): string => `${doc}@${version}:${by}`;
  for (const e of parseLog(EventLog.read(join(docs.dir, 'events.jsonl'))).events)
    if (e.type === 'decided') seen.add(key(e.doc, e.version, e.by));
  const off = docs.store.onCommitted((e) => {
    if (e.type === 'decided') seen.add(key(e.doc, e.version, e.by));
  });
  return { has: (d, v, b) => seen.has(key(d, v, b)), stop: off };
}

/** Start the watch for one org; returns a stop function, or undefined when there is nothing to watch. */
export function startUnreadWatch(
  daemon: OrgDaemon,
  name: string,
  running: RunningOrg,
): (() => void) | undefined {
  const docs = running.documents;
  const notices = docs?.notices;
  if (!docs || !notices) return undefined;
  const intervalMs = unreadIntervalMs(running.def.run_config);
  if (intervalMs === null) return undefined;
  const { bus } = running;
  const watch = new UnreadWatch(intervalMs);
  const startedAt = Date.now();
  const sent = new Map<string, { n: number; at: number }>();
  try {
    for (const e of OrgBus.readHistory(bus.dir))
      if (e.reason === 'doc-unread' && typeof e.data?.key === 'string') {
        const prev = sent.get(e.data.key);
        const n = Number(e.data.n) || 0;
        if (!prev || n >= prev.n) sent.set(e.data.key, { n, at: e.ts ?? 0 });
      }
  } catch {
    /* no history: a fresh run */
  }
  for (const [k, s] of sent) watch.seed(k, s.n, s.at);
  const decided = decisions(docs);
  const boss = running.bossRoleId;
  const live = (id: string): boolean => {
    const a = running.agents.get(id);
    return !!a && a.status === 'running' && !a.mailbox.isClosed;
  };
  const leadOf = (role: string): string | undefined => {
    if (role === boss) return undefined;
    const parent = leadFor(running.def, role, boss);
    const lead = running.agents.has(parent) ? parent : boss;
    return lead !== role && live(lead) ? lead : undefined;
  };
  const tick = (): void => {
    if (daemon.orgs.get(name) !== running || docs.closed) {
      stop();
      return;
    }
    const now = Date.now();
    const facts = notices.facts();
    // a notice the runtime has not delivered yet is retried on every tick (P3.8)
    if (facts.some((f) => f.notices.some((n) => n.state === 'pending'))) void notices.retry();
    const summaries = new Map(docs.store.list().map((d) => [d.id, d]));
    const versions: UnreadVersion[] = facts.map((f) => {
      const v = summaries.get(f.doc)?.versions.find((x) => x.version === f.version);
      const published = Math.max(Date.parse(f.published_at), startedAt);
      return {
        doc: f.doc,
        version: f.version,
        type: f.type,
        producer: v?.by ?? '',
        open: v?.status === 'pending',
        deciders: f.notices.map((n) => ({
          role: n.role,
          lead: leadOf(n.role),
          notice: n.state,
          failures: n.failures,
          since: n.delivered_at ? Math.max(published, Date.parse(n.delivered_at)) : published,
          done: !!f.first_read_at[n.role] || decided.has(f.doc, f.version, n.role),
        })),
      };
    });
    const waiting =
      daemon.listGates(name, 'pending').length > 0 ||
      (daemon.approvals.get(name) ?? []).some((a) => a.approved === null) ||
      questionOps.pendingBlockingQuestions(daemon.root, name).length > 0;
    for (const n of watch.tick(versions, now, waiting)) {
      running.agents.get(n.lead)?.mailbox.push(n.text);
      bus.emit({
        type: 'audit',
        from: RUNTIME_SENDER,
        reason: 'doc-unread',
        msg: `told "${n.lead}": document ${n.doc} v${n.version} unread by ${n.unread.join(', ')} for ${Math.round(n.ageMs / 1000)}s (${n.cause})`,
        data: {
          key: n.key,
          doc: n.doc,
          version: n.version,
          type: n.type,
          producer: n.producer,
          to: n.lead,
          unread: n.unread,
          cause: n.cause,
          n: n.n,
          age_s: Math.round(n.ageMs / 1000),
        },
      });
    }
  };
  const timer = setInterval(tick, Math.min(10_000, Math.max(50, intervalMs / 3)));
  (timer as { unref?: () => void }).unref?.();
  const stop = (): void => {
    clearInterval(timer);
    decided.stop();
  };
  return stop;
}
