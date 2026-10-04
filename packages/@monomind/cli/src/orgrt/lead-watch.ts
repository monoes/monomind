// packages/@monomind/cli/src/orgrt/lead-watch.ts
/**
 * Lead watch. In parallel-sweep-2 the resource governor deferred two roles
 * forever and the lead never noticed that they had never started, so their
 * tasks were never reassigned to the idle workers. This watch tells the lead,
 * through its mailbox, when a role that holds an open task
 *   (i)  has not started a session `not_started_s` seconds after the task was
 *        dispatched (deferred by the governor, queued, crashed at start), or
 *   (ii) has produced no bus event for `silent_s` seconds.
 *
 * It only ever fires for a role with an open ('running') task, so a healthy
 * run, where every assignee starts and keeps emitting events, is untouched.
 * One message per role per episode: an episode ends the moment the role
 * starts or emits; inside an episode a reminder follows only after a doubling
 * gap, at most MAX_NOTICES in all. A lead that cancels the task, re-creates it
 * for another role, or messages the role (acknowledges) is not reminded again
 * about those tasks.
 *
 * Work handed out by org_send message instead of org_task (the sweep orgs)
 * counts too: a lead (or reports_to) message to a role that is an actionable
 * assignment (not an acknowledgement, see `isActionableAssignment`) is open work
 * for that role from the moment it was sent, with the same not-started and
 * silent clocks, episodes, backoff and cap. It ends when the role messages
 * anyone after it (a reply or a report), when the lead messages the role after
 * a notice (acknowledge), or when it is reassigned. A role hung in one long
 * Bash call emits no events and is exactly the silent case.
 *
 * Config: run_config.lead_watch = { not_started_s?: 90, silent_s?: 180 };
 * `false` turns it off. The decision is a pure function of a snapshot
 * (`LeadWatch.tick`), so it is table-testable without a daemon.
 */
import type { OrgDaemon } from './daemon.js';
import type { RunningOrg } from './daemon-types.js';
import { type AwaitFacts, awaitFacts, awaitingDocuments } from './documents/awaiting.js';
import { leadFor } from './documents/lead-rules.js';
import * as questionOps from './questions.js';
import { isTerminalStatus } from './task-dag.js';
import type { BusEvent } from './types.js';

export const DEFAULT_NOT_STARTED_S = 90;
export const DEFAULT_SILENT_S = 180;
/** Notices per episode, first one included. */
export const MAX_NOTICES = 3;

export interface LeadWatchConfig {
  notStartedMs: number;
  silentMs: number;
}

/** The effective config, or null when the org turned the watch off. */
export function leadWatchConfig(run: {
  lead_watch?: false | { not_started_s?: number; silent_s?: number };
}): LeadWatchConfig | null {
  const c = run.lead_watch;
  if (c === false) return null;
  return {
    notStartedMs: (c?.not_started_s ?? DEFAULT_NOT_STARTED_S) * 1000,
    silentMs: (c?.silent_s ?? DEFAULT_SILENT_S) * 1000,
  };
}

export interface WatchedTask {
  id: string;
  title: string;
  /** When it was dispatched (status 'running'), or when the assignment message was sent. */
  since: number;
  /** An assignment sent by org_send rather than an org_task. */
  via?: 'message';
}

export interface RoleSnapshot {
  id: string;
  /** The lead to tell, or undefined when there is nobody to tell. */
  lead?: string;
  /** A live session exists. */
  started: boolean;
  /** Last bus event the role emitted, 0 if none. */
  lastActivity: number;
  /** Legitimately waiting (pending approval/gate/blocking question). */
  waiting: boolean;
  /** Sections orgs (P3.16c): a consumer whose only open work is waiting for documents; never silent. Absent otherwise. */
  awaitingDocuments?: boolean;
  openTasks: WatchedTask[];
}

export interface Notice {
  lead: string;
  role: string;
  kind: 'not-started' | 'silent';
  taskIds: string[];
  text: string;
}

interface Episode {
  kind: Notice['kind'];
  notices: number;
  nextAt: number;
  /** Task ids the lead was told about. */
  told: Set<string>;
}

function span(ms: number): string {
  return ms < 120_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;
}

const ACK_WORD =
  '(?:hi|hello|hey|ok|okay|thanks?|thank you|got it|noted|ack|acknowledged|received|understood|roger|will do|great|good|done|perfect|nice)';
const ACK_ONLY = new RegExp(`^(?:${ACK_WORD}\\b[\\s.!,:;-]*)+$`, 'i');

/** A message that hands work over: not empty and not a bare acknowledgement or thanks. */
export function isActionableAssignment(
  _subject: string | undefined,
  body: string | undefined,
): boolean {
  const text = (body ?? '').replace(/^\[trace [^\]]*\]\s*/, '').trim();
  return text.split(/\s+/).length >= 2 && !ACK_ONLY.test(text);
}

export class LeadWatch {
  private episodes = new Map<string, Episode>();
  /** Assignment messages not yet answered, by role. */
  private msgWork = new Map<string, WatchedTask[]>();
  /** Tasks the lead has dealt with or acknowledged: never mentioned again. */
  private settled = new Set<string>();

  constructor(private cfg: LeadWatchConfig) {}

  /** The lead messaged `role`: acknowledge every task it was told about. True when there was one. */
  acknowledge(role: string): boolean {
    let any = false;
    for (const id of this.episodes.get(role)?.told ?? []) {
      if (!this.settled.has(id)) any = true;
      this.settled.add(id);
    }
    return any;
  }

  /** The lead sent `role` an assignment by message. */
  messageAssigned(role: string, work: WatchedTask): void {
    const list = this.msgWork.get(role) ?? [];
    if (list.some((w) => w.id === work.id)) return; // the same message seen twice
    list.push({ ...work, via: 'message' });
    this.msgWork.set(role, list);
  }

  /** `role` messaged someone after its assignment (a reply or a report): that work is answered. */
  messageReplied(role: string): void {
    this.msgWork.delete(role);
  }

  /** Roles that hold unanswered assignment messages. */
  messageRoles(): string[] {
    return [...this.msgWork.keys()];
  }

  /** A task was re-created for another role: its twin is settled. */
  reassigned(taskId: string): void {
    this.settled.add(taskId);
  }

  tick(roles: RoleSnapshot[], now: number): Notice[] {
    const out: Notice[] = [];
    const seen = new Set<string>();
    for (const r of roles) {
      const open = [...r.openTasks, ...(this.msgWork.get(r.id) ?? [])].filter(
        (t) => !this.settled.has(t.id),
      );
      if (!r.lead || open.length === 0 || (r.started && (r.waiting || r.awaitingDocuments)))
        continue;
      const first = Math.min(...open.map((t) => t.since));
      const kind: Notice['kind'] = r.started ? 'silent' : 'not-started';
      // A silent role is silent since its last event or since the work arrived.
      const clock = r.started ? Math.max(r.lastActivity, first) : first;
      const limit = r.started ? this.cfg.silentMs : this.cfg.notStartedMs;
      if (now - clock < limit) continue;
      seen.add(r.id);
      let ep = this.episodes.get(r.id);
      if (ep && ep.kind !== kind) ep = undefined;
      if (!ep) ep = { kind, notices: 0, nextAt: 0, told: new Set() };
      this.episodes.set(r.id, ep);
      if (ep.notices >= MAX_NOTICES || (ep.notices > 0 && now < ep.nextAt)) continue;
      for (const t of open) ep.told.add(t.id);
      ep.notices++;
      ep.nextAt = now + limit * 2 ** ep.notices;
      const ids = open.map((t) => t.id);
      out.push({
        lead: r.lead,
        role: r.id,
        kind,
        taskIds: ids,
        text: noticeText(r.id, kind, open, now - clock, ep.notices),
      });
    }
    // Episode over: the role started, emitted, or has no open task any more.
    for (const id of [...this.episodes.keys()]) if (!seen.has(id)) this.episodes.delete(id);
    return out;
  }
}

function noticeText(
  role: string,
  kind: Notice['kind'],
  open: WatchedTask[],
  ms: number,
  n: number,
): string {
  const ids = open
    .map((t) =>
      t.via === 'message' ? `the work from your message "${t.title}"` : `${t.id} ("${t.title}")`,
    )
    .join(', ');
  const what =
    kind === 'not-started'
      ? `has not started: it was assigned ${ids} ${span(ms)} ago and has no running session (queued or deferred by the resource governor, or it crashed at start)`
      : `has gone silent: it holds ${ids} and has produced no activity for ${span(ms)}`;
  return (
    `[watch] Role "${role}" ${what}. Options: (1) wait; ` +
    `(2) reassign its unfinished work to an idle role: create the task for that role with org_task, then org_task_cancel the old one(s); ` +
    `(3) acknowledge: org_send to "${role}" and you will not be reminded again about this work. ` +
    `${n >= MAX_NOTICES ? 'This is the last notice for this episode.' : 'If nothing changes you get one more reminder after a longer gap.'}`
  );
}

/** Snapshot the live org into the pure tick's input. */
function snapshot(
  daemon: OrgDaemon,
  name: string,
  running: RunningOrg,
  roleActivity: Map<string, number>,
  firstSeen: Map<string, number>,
  now: number,
  messageRoles: string[] = [],
): RoleSnapshot[] {
  const isStarted = (id: string): boolean =>
    running.agents.get(id)?.status === 'running' && !running.respawning.has(id);
  const byRole = new Map<string, WatchedTask[]>();
  for (const t of running.taskDag?.all() ?? []) {
    // 'ready' is a dispatched-nowhere task: a role that is deferred or never
    // spawned leaves its tasks there (dag-dispatch.ts). Only for a role that
    // is not up; for a live role 'ready' is the instant before dispatch.
    const open = t.status === 'running' || (t.status === 'ready' && !isStarted(t.assignee));
    if (!open) continue;
    if (!firstSeen.has(t.id)) firstSeen.set(t.id, now);
    const since =
      t.status === 'running' ? (t.startedAt ?? firstSeen.get(t.id)!) : firstSeen.get(t.id)!;
    const list = byRole.get(t.assignee) ?? [];
    list.push({ id: t.id, title: t.title, since });
    byRole.set(t.assignee, list);
  }
  for (const id of messageRoles) if (!byRole.has(id)) byRole.set(id, []);
  const waitingHuman =
    daemon.listGates(name, 'pending').length > 0 ||
    (daemon.approvals.get(name) ?? []).some((a) => a.approved === null) ||
    questionOps.pendingBlockingQuestions(daemon.root, name).length > 0;
  const boss = running.bossRoleId;
  let facts: AwaitFacts | undefined; // built once per snapshot, and only when a started role asks
  const awaiting = (id: string): boolean =>
    awaitingDocuments(
      id,
      (facts ??= awaitFacts(running.documents as NonNullable<typeof running.documents>)),
    );
  return [...byRole].flatMap(([id, openTasks]) => {
    if (id === boss) return [];
    const parent = leadFor(running.def, id, boss);
    const leadRt = running.agents.get(parent) ?? running.agents.get(boss);
    const lead = running.agents.get(parent) ? parent : boss;
    return [
      {
        id,
        lead: leadRt && leadRt.status === 'running' && !leadRt.mailbox.isClosed ? lead : undefined,
        started: isStarted(id),
        lastActivity: roleActivity.get(id) ?? 0,
        waiting: waitingHuman,
        ...(running.documents && isStarted(id) ? { awaitingDocuments: awaiting(id) } : {}),
        openTasks,
      },
    ];
  });
}

/** Start the watch for one org; returns a stop function. */
export function startLeadWatch(
  daemon: OrgDaemon,
  name: string,
  running: RunningOrg,
  roleActivity: Map<string, number>,
): (() => void) | undefined {
  const cfg = leadWatchConfig(running.def.run_config);
  if (!cfg) return undefined;
  const watch = new LeadWatch(cfg);
  const { bus } = running;
  const leadOf = (id: string): string => leadFor(running.def, id, running.bossRoleId);
  bus.subscribe((e: BusEvent) => {
    // 'message-queued': the same message when the recipient has no session yet (cross-org-deliver.ts).
    if (e.type !== 'message' && !(e.type === 'audit' && e.reason === 'message-queued')) return;
    // An answer: a role that messages anyone after its assignment has reported on it.
    if (e.from) watch.messageReplied(e.from);
    if (e.from !== running.bossRoleId && !(e.to && e.from === leadOf(e.to))) return;
    if (!e.to || e.to === running.bossRoleId || !running.def.roles.some((r) => r.id === e.to))
      return;
    // The lead reacting to a notice acknowledges it; otherwise an actionable message is new work.
    if (watch.acknowledge(e.to)) return;
    if (isActionableAssignment(e.subject, e.msg))
      watch.messageAssigned(e.to, {
        id: String(e.data?.messageId ?? e.id),
        title: e.subject ?? 'message',
        since: e.ts ?? Date.now(),
      });
  });
  const known = new Set<string>();
  const firstSeen = new Map<string, number>();
  const tick = (): void => {
    if (daemon.orgs.get(name) !== running) {
      stop();
      return;
    }
    const now = Date.now();
    // A task the lead re-created for another role settles its twin.
    for (const t of running.taskDag?.all() ?? []) {
      if (known.has(t.id) || t.createdBy !== running.bossRoleId) continue;
      known.add(t.id);
      const twin = running.taskDag
        ?.all()
        .find(
          (o) =>
            o.id !== t.id &&
            o.assignee !== t.assignee &&
            o.title.trim().toLowerCase() === t.title.trim().toLowerCase() &&
            !isTerminalStatus(o.status) &&
            o.createdAt < t.createdAt,
        );
      if (twin) watch.reassigned(twin.id);
    }
    for (const n of watch.tick(
      snapshot(daemon, name, running, roleActivity, firstSeen, now, watch.messageRoles()),
      now,
    )) {
      const lead = running.agents.get(n.lead);
      if (!lead || lead.mailbox.isClosed) continue;
      lead.mailbox.push(n.text);
      bus.emit({
        type: 'audit',
        reason: 'lead-watch',
        msg: `told "${n.lead}": role "${n.role}" ${n.kind === 'silent' ? 'is silent' : 'never started'} with open work ${n.taskIds.join(', ')}`,
        data: { role: n.role, kind: n.kind, taskIds: n.taskIds },
      });
    }
  };
  const timer = setInterval(
    tick,
    Math.min(10_000, Math.max(50, Math.min(cfg.notStartedMs, cfg.silentMs) / 3)),
  );
  (timer as { unref?: () => void }).unref?.();
  const stop = (): void => clearInterval(timer);
  return stop;
}
