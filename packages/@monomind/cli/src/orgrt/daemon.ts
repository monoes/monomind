// packages/@monomind/cli/src/orgrt/daemon.ts
// monolean: single-process inter-org — upgrade path = daemon-to-daemon HTTP when multi-host is real
import { readFileSync, mkdirSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { OrgBus } from './bus.js';
import { PolicyEngine } from './policy.js';
import { Mailbox } from './mailbox.js';
import { runAgentSession } from './session.js';
import { attachForwarder } from './forwarder.js';
import { BrokerLease, lookupOrg } from './broker.js';
import { queueMessage, drainInbox } from './inbox.js';
import { OrgDefSchema, type OrgDef, type BusEvent, ORG_DIR } from './types.js';
import type { query } from '@anthropic-ai/claude-agent-sdk';

interface AgentRuntime {
  mailbox: Mailbox;
  policy: PolicyEngine;
  done: Promise<void>;
  /** 'running' until the session promise settles; 'crashed' if it rejected (see error). */
  status: 'running' | 'ended' | 'crashed';
  error?: string;
}

export interface RunningOrg {
  def: OrgDef;
  run: string;
  bus: OrgBus;
  agents: Map<string, AgentRuntime>;
  busEvents: () => BusEvent[];
}

export interface DaemonOpts {
  queryFn?: typeof query;
  forward?: boolean;           // POST events to control server (default true)
  controlJson?: string;
  /** Enables cross-process inter-org routing: on a local delivery miss, ask the
   *  machine-local broker whether another `monomind org` process (e.g. a
   *  different project directory) hosts the target org, and deliver over HTTP
   *  if so. Off by default — tests and single-process runs don't need it. */
  crossProcess?: boolean;
  /** Base URL at which OTHER processes can reach this daemon's inbox (see
   *  server.ts POST /api/xdeliver). Set this to make orgs hosted here
   *  discoverable; omit for outbound-only cross-process delivery. */
  inboxUrl?: string;
  /** Override the broker's file registry directory (tests only). */
  brokerDir?: string;
  /** Override how long stopOrg() waits for agent sessions before proceeding anyway (tests only; default 15000ms). */
  stopWaitMs?: number;
}

export class OrgDaemon {
  private orgs = new Map<string, RunningOrg>();
  private waking = new Set<string>();
  private globalSubscribers = new Set<(e: BusEvent) => void>();
  private leases = new Map<string, BrokerLease>();
  private forwarders = new Map<string, ReturnType<typeof attachForwarder>>();

  constructor(private root: string, private opts: DaemonOpts = {}) {}

  /** Publish this daemon's inbox so orgs started AFTER this call register with the broker. */
  setInboxUrl(url: string): void { this.opts.inboxUrl = url; }

  /** subscribe to events from ALL running orgs (dashboard server uses this) */
  subscribe(fn: (e: BusEvent) => void): () => void {
    this.globalSubscribers.add(fn);
    return () => this.globalSubscribers.delete(fn);
  }

  listOrgs(): RunningOrg[] { return [...this.orgs.values()]; }
  getOrg(name: string): RunningOrg | undefined { return this.orgs.get(name); }

  async startOrg(name: string, taskOverride?: string): Promise<RunningOrg> {
    if (this.orgs.has(name)) throw new Error(`org ${name} already running`);
    const defPath = join(this.root, ORG_DIR, `${name}.json`);
    const def = OrgDefSchema.parse(JSON.parse(readFileSync(defPath, 'utf8')));
    // random suffix: second-precision stamps collide across processes (two CLI
    // invocations in the same second would share a run dir and its bus.jsonl)
    const run = `run-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
    const dir = join(this.root, ORG_DIR, name, run);
    mkdirSync(dir, { recursive: true });
    const cwd = join(this.root, ORG_DIR, name, 'workspace');
    mkdirSync(cwd, { recursive: true });

    const bus = new OrgBus(name, run, dir);
    // Bounded in-memory tail: bus.jsonl on disk is the full durable record;
    // this buffer only backs busEvents() (test-loop, /api/history) and would
    // otherwise grow without limit for a long-running scheduled org — each
    // Write's captured content snapshot alone can be up to 200KB (policy.ts).
    const MAX_COLLECTED = 5000;
    const collected: BusEvent[] = [];
    bus.subscribe(e => {
      collected.push(e);
      if (collected.length > MAX_COLLECTED) collected.splice(0, collected.length - MAX_COLLECTED);
      for (const fn of this.globalSubscribers) fn(e);
    });
    if (this.opts.forward !== false)
      this.forwarders.set(name, attachForwarder(bus, this.opts.controlJson ?? join(this.root, '.monomind/control.json')));

    const running: RunningOrg = { def, run, bus, agents: new Map(), busEvents: () => [...collected] };
    this.orgs.set(name, running);

    const perRoleBudget = Math.floor((def.run_config.budget_tokens ?? 1_000_000) / def.roles.length);
    for (const role of def.roles) {
      const mailbox = new Mailbox();
      const policy = new PolicyEngine(role.id,
        { maxTokens: perRoleBudget, ...(role.policy ?? {}) }, bus, cwd);
      const runtime: AgentRuntime = { mailbox, policy, status: 'running', done: Promise.resolve() };
      runtime.done = runAgentSession({
        org: name, role, bus, policy, mailbox, cwd, def,
        maxTurns: def.run_config.max_turns_per_message,
        deliver: (from, to, subject, body) => this.deliver(name, from, to, subject, body),
        askHuman: (role, question) => this.askHuman(name, role, question),
        queryFn: this.opts.queryFn,
      }).then(() => { runtime.status = 'ended'; })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          runtime.status = 'crashed';
          runtime.error = message;
          // runAgentSession already emits a 'status' event for the raw error; emit an
          // 'audit' event too so dashboards/alerts that filter on actionable failures
          // (not routine status chatter) can surface a dead agent instead of a run that
          // silently never progresses.
          bus.emit({
            type: 'audit', from: role.id,
            msg: `agent "${role.id}" crashed: ${message}`,
            reason: 'agent-session-crash',
            data: { agentId: role.id, error: message },
          });
        });
      running.agents.set(role.id, runtime);
    }

    const boss = def.roles.find(r => r.type === 'boss' || r.reports_to === null) ?? def.roles[0];
    running.agents.get(boss.id)!.mailbox.push(
      `Org "${name}" started (run ${run}).\nGoal: ${taskOverride ?? def.goal}\n` +
      `Coordinate your team via org_send. Report completion by ending your turn.`);
    bus.emit({ type: 'status', msg: `org started (${def.roles.length} agents)`, data: { goal: taskOverride ?? def.goal } });
    this.persistState(name, 'running', run);

    if (this.opts.crossProcess && this.opts.inboxUrl) {
      const lease = new BrokerLease(name, this.opts.inboxUrl, this.opts.brokerDir);
      lease.start();
      this.leases.set(name, lease);
    }

    // Drain any messages that arrived while the org was offline
    const queued = drainInbox(this.root, name);
    for (const msg of queued) {
      const agent = running.agents.get(msg.toRole);
      if (agent && !agent.mailbox.isClosed) {
        bus.emit({ type: 'xorg', from: msg.fromQualified, to: `${name}:${msg.toRole}`, subject: msg.subject, msg: msg.body });
        agent.mailbox.push(`[message from ${msg.fromQualified}] subject: ${msg.subject}\n\n${msg.body}`);
      }
    }
    if (queued.length) bus.emit({ type: 'status', msg: `drained ${queued.length} queued message(s) from inbox` });

    return running;
  }

  /**
   * Resolves an org_send `to` address ("role" for same-org, "org:role" for
   * cross-org) into its parts. Centralizes the one addressing rule that
   * matters (an "own-org:role" self-prefix is intra-org, not cross-org) so
   * deliver()/deliverRemote() don't each re-derive it — the qualified `to`
   * string returned is always the canonical display form for that address.
   */
  private resolveAddress(fromOrg: string, to: string): { cross: boolean; orgName: string; role: string; qualified: string } {
    const cross = to.includes(':');
    if (!cross) return { cross: false, orgName: fromOrg, role: to, qualified: to };
    const [orgName, role] = to.split(':', 2);
    if (orgName === fromOrg) return { cross: false, orgName, role, qualified: role }; // self-prefixed — still intra-org
    return { cross: true, orgName, role, qualified: to };
  }

  /** Route a message. to = "role" (same org) or "org:role" (cross-org). Returns a receipt string. */
  async deliver(fromOrg: string, fromRole: string, to: string, subject: string, body: string): Promise<string> {
    const { cross, orgName: targetOrgName, role: targetRole, qualified: toQualified } = this.resolveAddress(fromOrg, to);
    const targetOrg = this.orgs.get(targetOrgName);
    const src = this.orgs.get(fromOrg);
    if (!targetOrg || !targetOrg.agents.has(targetRole)) {
      if (cross && this.opts.crossProcess) return this.deliverRemote(fromOrg, fromRole, targetOrgName, targetRole, toQualified, subject, body, src);
      // Queue + auto-wake: if the org definition exists locally but isn't running, spool the message and start it
      if (cross && this.hasOrgDef(targetOrgName)) {
        queueMessage(this.root, targetOrgName, { fromQualified: `${fromOrg}:${fromRole}`, toRole: targetRole, subject, body, ts: Date.now() });
        src?.bus.emit({ type: 'xorg', from: `${fromOrg}:${fromRole}`, to: toQualified, subject, msg: body, data: { queued: true } });
        this.autoWake(targetOrgName);
        return `queued for ${toQualified} (org starting)`;
      }
      src?.bus.emit({ type: 'audit', from: fromRole, to: toQualified, msg: `undeliverable: ${subject}`, reason: 'unknown recipient' });
      return `ERROR: unknown recipient "${toQualified}" (known: ${[...(targetOrg?.agents.keys() ?? this.orgs.keys())].join(', ')})`;
    }
    const targetAgent = targetOrg.agents.get(targetRole)!;
    if (targetAgent.mailbox.isClosed) {
      // The org is mid-shutdown: mailboxes close before the org is removed
      // from `this.orgs`, so a message can arrive in that window. push() would
      // silently no-op — report the real outcome instead of a false "delivered".
      src?.bus.emit({ type: 'audit', from: fromRole, to: toQualified, msg: `undeliverable: ${subject}`, reason: 'target mailbox closed (org shutting down)' });
      return `ERROR: recipient "${toQualified}" is shutting down — message not delivered`;
    }
    const evt = { from: cross ? `${fromOrg}:${fromRole}` : fromRole, to: toQualified, subject, msg: body };
    src?.bus.emit({ type: cross ? 'xorg' : 'message', ...evt });
    if (cross && targetOrg !== src) targetOrg.bus.emit({ type: 'xorg', ...evt });
    targetAgent.mailbox.push(`[message from ${evt.from}] subject: ${subject}\n\n${body}`);
    return `delivered to ${toQualified}`;
  }

  /** Cross-process leg of deliver(): ask the machine-local broker who hosts targetOrgName, then POST over HTTP.
   *  `to` here is always the fully-qualified "org:role" display form (resolveAddress already normalized it). */
  private async deliverRemote(
    fromOrg: string, fromRole: string, targetOrgName: string, targetRole: string,
    to: string, subject: string, body: string, src: RunningOrg | undefined,
  ): Promise<string> {
    const remote = lookupOrg(targetOrgName, this.opts.brokerDir);
    if (!remote) {
      // No remote host either — queue + auto-wake if the org def exists locally
      if (this.hasOrgDef(targetOrgName)) {
        queueMessage(this.root, targetOrgName, { fromQualified: `${fromOrg}:${fromRole}`, toRole: targetRole, subject, body, ts: Date.now() });
        src?.bus.emit({ type: 'xorg', from: `${fromOrg}:${fromRole}`, to, subject, msg: body, data: { queued: true } });
        this.autoWake(targetOrgName);
        return `queued for ${to} (org starting)`;
      }
      src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `undeliverable: ${subject}`, reason: 'unknown recipient' });
      return `ERROR: unknown recipient "${to}" (no local org, and no process on this machine has org "${targetOrgName}" registered)`;
    }
    try {
      const res = await fetch(`${remote.url}/api/xdeliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromOrg, fromRole, toOrg: targetOrgName, toRole: targetRole, subject, body }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; receipt?: string; error?: string };
      if (res.ok && data.ok) {
        src?.bus.emit({ type: 'xorg', from: `${fromOrg}:${fromRole}`, to, subject, msg: body });
        return data.receipt ?? `delivered to ${to} (remote)`;
      }
      src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `remote delivery rejected: ${data.error ?? res.status}`, reason: 'remote-delivery-rejected' });
      return `ERROR: remote org "${to}" rejected delivery: ${data.error ?? res.status}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `remote delivery failed: ${message}`, reason: 'remote-delivery-failed' });
      return `ERROR: remote org "${targetOrgName}" unreachable: ${message}`;
    }
  }

  /** Inbound handler for cross-process delivery — called by the server's POST /api/xdeliver route
   *  when ANOTHER process's deliverRemote() reaches this daemon. Pushes straight into the target
   *  agent's mailbox; the agent picks it up on its own next turn (see Mailbox — never interrupts). */
  receiveRemote(
    toOrg: string, toRole: string, fromQualified: string, subject: string, body: string,
  ): { ok: true; receipt: string } | { ok: false; error: string } {
    const org = this.orgs.get(toOrg);
    if (!org) {
      // Org not running — queue the message and auto-wake if the def exists
      if (this.hasOrgDef(toOrg)) {
        queueMessage(this.root, toOrg, { fromQualified, toRole, subject, body, ts: Date.now() });
        this.autoWake(toOrg);
        return { ok: true, receipt: `queued for ${toOrg}:${toRole} (org waking)` };
      }
      return { ok: false, error: `org "${toOrg}" not hosted here` };
    }
    const agent = org.agents.get(toRole);
    if (!agent) return { ok: false, error: `role "${toRole}" not found in org "${toOrg}"` };
    if (agent.mailbox.isClosed) return { ok: false, error: `role "${toRole}" in org "${toOrg}" is shutting down` };
    org.bus.emit({ type: 'xorg', from: fromQualified, to: `${toOrg}:${toRole}`, subject, msg: body });
    agent.mailbox.push(`[message from ${fromQualified}] subject: ${subject}\n\n${body}`);
    return { ok: true, receipt: `delivered to ${toOrg}:${toRole} (remote)` };
  }

  private hasOrgDef(name: string): boolean {
    return existsSync(join(this.root, ORG_DIR, `${name}.json`));
  }

  private questionsPath(org: string): string {
    return join(this.root, ORG_DIR, org, 'questions.json');
  }

  private readQuestions(org: string): { questions: Array<{ questionId: string; role: string; question: string; ts: number; answer: string | null; answeredAt: number | null }> } {
    try { return JSON.parse(readFileSync(this.questionsPath(org), 'utf8')); } catch { return { questions: [] }; }
  }

  private writeQuestions(org: string, data: ReturnType<OrgDaemon['readQuestions']>): void {
    const dest = this.questionsPath(org);
    mkdirSync(join(this.root, ORG_DIR, org), { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, dest);
  }

  /** Agent-initiated human question (ask_human tool). Persists to questions.json (survives
   *  process/dashboard restarts) and emits a 'question' BusEvent so the dashboard's SSE
   *  stream and global inbox pick it up in real time. Returns a receipt string for the tool call. */
  async askHuman(org: string, role: string, question: string): Promise<string> {
    const running = this.orgs.get(org);
    const questionId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const data = this.readQuestions(org);
    data.questions.push({ questionId, role, question, ts: Date.now(), answer: null, answeredAt: null });
    this.writeQuestions(org, data);
    running?.bus.emit({ type: 'question', from: role, data: { questionId, question } });
    return `Question recorded (id ${questionId}) — a human will answer it; you'll receive the answer as a new message.`;
  }

  /** Delivers a human's answer to a pending ask_human question. If the org is still
   *  running, pushes straight into the role's live mailbox (picked up on its very next
   *  generator tick — see Mailbox.stream()). If the org has since stopped, queues the
   *  answer via the same offline fallback deliver()/receiveRemote() already use
   *  (inbox.ts + autoWake) and it's delivered when the org next starts. */
  async answerQuestion(org: string, role: string, questionId: string, answer: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const data = this.readQuestions(org);
    const idx = data.questions.findIndex(q => q.questionId === questionId);
    if (idx === -1) return { ok: false, error: `question "${questionId}" not found for org "${org}"` };
    if (data.questions[idx].answer !== null) return { ok: false, error: `question "${questionId}" already answered` };
    data.questions[idx] = { ...data.questions[idx], answer, answeredAt: Date.now() };
    this.writeQuestions(org, data);

    const running = this.orgs.get(org);
    if (running) {
      // Org IS running — deliver or report a real error, but never fall through to the
      // offline queue+autoWake path below: autoWake() no-ops when this.orgs already has
      // the org (see its own guard), so a role-specific delivery failure here (mailbox
      // closed, role unknown) would otherwise queue the answer forever with no real error
      // and no delivery. Mirrors deliver()'s existing "shutting down" error for the same
      // mid-shutdown-mailbox-closed race.
      const agent = running.agents.get(role);
      if (!agent) return { ok: false, error: `role "${role}" not found in org "${org}"` };
      if (agent.mailbox.isClosed) return { ok: false, error: `role "${role}" in org "${org}" is shutting down — answer not delivered` };
      running.bus.emit({ type: 'status', from: role, msg: 'question answered', data: { questionId } });
      agent.mailbox.push(`[answer from human] question: ${data.questions[idx].question}\n\nanswer: ${answer}`);
      return { ok: true };
    }
    // Org not running at all — queue for delivery on next start, matching deliver()'s
    // existing offline fallback exactly (inbox.ts + autoWake).
    if (!this.hasOrgDef(org)) return { ok: false, error: `org "${org}" not found (no saved definition)` };
    queueMessage(this.root, org, {
      fromQualified: 'human', toRole: role,
      subject: `answer:${questionId}`, body: answer, ts: Date.now(),
    });
    this.autoWake(org);
    return { ok: true };
  }

  /** Start an offline org in the background so queued messages get drained.
   *  Fire-and-forget — errors are logged but don't propagate to the sender. */
  private autoWake(name: string): void {
    if (this.orgs.has(name) || this.waking.has(name)) return;
    this.waking.add(name);
    this.startOrg(name)
      .catch(err => { console.error(`auto-wake org "${name}" failed:`, err instanceof Error ? err.message : err); })
      .finally(() => { this.waking.delete(name); });
  }

  async stopOrg(name: string): Promise<void> {
    const org = this.orgs.get(name);
    if (!org) return; // already stopped, or another concurrent stopOrg() call is handling it
    // Remove immediately (not at the end) so a concurrent stopOrg(name) call —
    // e.g. stopAll() racing a scheduler-triggered stop on SIGINT — sees the org
    // is already gone and no-ops instead of re-running the whole shutdown and
    // double-emitting 'org stopped' (duplicate org:complete/session:complete).
    this.orgs.delete(name);
    this.leases.get(name)?.stop();
    this.leases.delete(name);
    for (const a of org.agents.values()) a.mailbox.close();
    // Bounded: a genuinely hung agent session (stuck mid-tool-call, not just
    // idle) must not make stopOrg() hang forever — callers like the scheduler
    // already race their own timeout around a run, and this wait re-blocking
    // unboundedly on the same never-resolving promises defeated that bound.
    const stopWaitMs = this.opts.stopWaitMs ?? 15_000;
    const allDone = Promise.allSettled([...org.agents.values()].map(a => a.done)).then(() => false);
    const timedOut = await Promise.race([allDone, new Promise<boolean>(r => setTimeout(() => r(true), stopWaitMs))]);
    if (timedOut) {
      org.bus.emit({
        type: 'audit', msg: `org stop timed out after ${stopWaitMs}ms waiting for agent sessions to finish — proceeding anyway`,
        reason: 'stop-timeout',
      });
    }
    org.bus.emit({ type: 'status', msg: 'org stopped' });
    await org.bus.flush();
    // the "org stopped" event above triggers the forwarder's final org:complete /
    // session:complete POST — without waiting for it here, the CLI process can exit
    // (and kill the in-flight fetch) before that last event reaches the dashboard,
    // leaving the run stuck showing "running" forever.
    const forwarder = this.forwarders.get(name);
    if (forwarder) { await forwarder.settle(); forwarder.unsubscribe(); this.forwarders.delete(name); }
    this.persistState(name, 'stopped', org.run);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.orgs.keys()].map(n => this.stopOrg(n)));
  }

  private persistState(name: string, status: string, run: string): void {
    const p = join(this.root, ORG_DIR, name, 'runtime.json');
    writeFileSync(p, JSON.stringify({ status, run, pid: process.pid, updated: new Date().toISOString() }, null, 2));
  }
}
