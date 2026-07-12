// packages/@monomind/cli/src/orgrt/daemon.ts
// monolean: single-process inter-org — upgrade path = daemon-to-daemon HTTP when multi-host is real
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrgBus } from './bus.js';
import { PolicyEngine } from './policy.js';
import { Mailbox } from './mailbox.js';
import { runAgentSession } from './session.js';
import { attachForwarder } from './forwarder.js';
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
}

export class OrgDaemon {
  private orgs = new Map<string, RunningOrg>();
  private globalSubscribers = new Set<(e: BusEvent) => void>();

  constructor(private root: string, private opts: DaemonOpts = {}) {}

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
    const collected: BusEvent[] = [];
    bus.subscribe(e => { collected.push(e); for (const fn of this.globalSubscribers) fn(e); });
    if (this.opts.forward !== false)
      attachForwarder(bus, this.opts.controlJson ?? join(this.root, '.monomind/control.json'));

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
    return running;
  }

  /** Route a message. to = "role" (same org) or "org:role" (cross-org). Returns a receipt string. */
  async deliver(fromOrg: string, fromRole: string, to: string, subject: string, body: string): Promise<string> {
    let cross = to.includes(':');
    let [targetOrgName, targetRole] = cross ? to.split(':', 2) : [fromOrg, to];
    // "own-org:role" is intra-org — agents often self-prefix; don't tag it xorg
    if (cross && targetOrgName === fromOrg) { cross = false; to = targetRole; }
    const targetOrg = this.orgs.get(targetOrgName);
    const src = this.orgs.get(fromOrg);
    if (!targetOrg || !targetOrg.agents.has(targetRole)) {
      src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `undeliverable: ${subject}`, reason: 'unknown recipient' });
      return `ERROR: unknown recipient "${to}" (known: ${[...(targetOrg?.agents.keys() ?? this.orgs.keys())].join(', ')})`;
    }
    const evt = { from: cross ? `${fromOrg}:${fromRole}` : fromRole, to: cross ? to : targetRole, subject, msg: body };
    src?.bus.emit({ type: cross ? 'xorg' : 'message', ...evt });
    if (cross && targetOrg !== src) targetOrg.bus.emit({ type: 'xorg', ...evt });
    targetOrg.agents.get(targetRole)!.mailbox.push(
      `[message from ${evt.from}] subject: ${subject}\n\n${body}`);
    return `delivered to ${to}`;
  }

  async stopOrg(name: string): Promise<void> {
    const org = this.orgs.get(name);
    if (!org) return;
    for (const a of org.agents.values()) a.mailbox.close();
    await Promise.allSettled([...org.agents.values()].map(a => a.done));
    org.bus.emit({ type: 'status', msg: 'org stopped' });
    await org.bus.flush();
    this.persistState(name, 'stopped', org.run);
    this.orgs.delete(name);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.orgs.keys()].map(n => this.stopOrg(n)));
  }

  private persistState(name: string, status: string, run: string): void {
    const p = join(this.root, ORG_DIR, name, 'runtime.json');
    writeFileSync(p, JSON.stringify({ status, run, pid: process.pid, updated: new Date().toISOString() }, null, 2));
  }
}
