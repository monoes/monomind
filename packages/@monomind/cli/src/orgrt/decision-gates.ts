// packages/@monomind/cli/src/orgrt/decision-gates.ts

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ownershipForClass, readOrgAutonomy } from './approval-decider.js';
import type { OrgDaemon } from './daemon.js';
import { consultDecisionRole } from './decision-decider.js';
import { type DecisionDeps, findDecisionRole } from './decision-roles.js';
import { type DecisionGate, type DecisionKind, ORG_DIR } from './types.js';

// ── Decision gates ──────────────────────────────────────────────────────

export function gatesPath(root: string, org: string): string {
  return join(root, ORG_DIR, org, 'gates.json');
}

export function readGates(root: string, org: string): { gates: DecisionGate[] } {
  try {
    return JSON.parse(readFileSync(gatesPath(root, org), 'utf8'));
  } catch {
    return { gates: [] };
  }
}

/** A RUNNING org's gates live in memory (loaded when it starts, written
 *  through on every change, flushed when it stops) and are never re-read from
 *  disk during the run: gates.json sits in a directory the org's own roles can
 *  write, so a role that rewrote it — directly, or by swapping the directory —
 *  could otherwise approve its own gate. A stopped org's gates are the file,
 *  which is how an offline resolution reaches the next run. */
export function gatesFor(daemon: OrgDaemon, org: string): { gates: DecisionGate[] } {
  const running = daemon.orgs.get(org);
  if (!running) return readGates(daemon.root, org);
  running.gates ??= readGates(daemon.root, org);
  return running.gates;
}

export function writeGates(root: string, org: string, data: { gates: DecisionGate[] }): void {
  const dest = gatesPath(root, org);
  mkdirSync(join(root, ORG_DIR, org), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, dest);
}

/** Serialize gate mutations per org (same pattern as withApprovalLock).
 *  createGate and resolveGate race on gates.json without this. */
function withGatesLock<T>(daemon: OrgDaemon, org: string, fn: () => Promise<T>): Promise<T> {
  const prev = daemon.gatesLocks.get(org) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  daemon.gatesLocks.set(
    org,
    next.catch(() => {
      /* slot stays usable for the next caller */
    }),
  );
  return next;
}

export async function createGate(
  daemon: OrgDaemon,
  org: string,
  role: string,
  name: string,
  description: string,
  /** Test seam for the decision role's provider. */
  deps: Pick<DecisionDeps, 'ask' | 'resolveProvider'> = {},
): Promise<string> {
  const created = await createPendingGate(daemon, org, role, name, description);
  const decided = await resolveViaDecisionRole(
    daemon,
    org,
    created.gateId,
    name,
    description,
    role,
    deps,
  );
  return decided ?? created.text;
}

/** #835 PR 7: when the org's autonomy hands gates to a `role` decider, put the gate to that
 *  decision role. A confident answer resolves it as `decision:<role>` (returns the reply text);
 *  anything else returns undefined and the gate stays pending for a human. */
async function resolveViaDecisionRole(
  daemon: OrgDaemon,
  org: string,
  gateId: string,
  name: string,
  description: string,
  from: string,
  deps: Pick<DecisionDeps, 'ask' | 'resolveProvider'>,
): Promise<string | undefined> {
  const def = daemon.orgs.get(org)?.def;
  const owner = ownershipForClass(
    readOrgAutonomy(daemon.root, org),
    'gate',
    Date.now(),
    def?.roles,
  );
  if (owner.owner !== 'decider' || !owner.role) return undefined;
  const target = findDecisionRole(def, owner.role);
  if (!target) return undefined;
  const verdict = await consultDecisionRole(
    target,
    `Decision gate from role "${from}": "${name}". ${description}`,
    deps,
  );
  if (verdict.approved === null) return undefined;
  const resolved = await resolveGate(
    daemon,
    org,
    gateId,
    verdict.approved,
    undefined,
    `decision:${owner.role}`,
  );
  if (!resolved.ok) return undefined;
  return `Decision gate "${name}" (id ${gateId}) was ${verdict.approved ? 'approved' : 'rejected'} by decision role ${owner.role}.`;
}

async function createPendingGate(
  daemon: OrgDaemon,
  org: string,
  role: string,
  name: string,
  description: string,
): Promise<{ gateId: string; text: string }> {
  return withGatesLock(daemon, org, async () => {
    const running = daemon.orgs.get(org);
    const gateId = `gate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const gate: DecisionGate = {
      id: gateId,
      name,
      description,
      roleId: role,
      status: 'pending',
      createdAt: Date.now(),
    };
    const data = gatesFor(daemon, org);
    data.gates.push(gate);
    writeGates(daemon.root, org, data);
    running?.bus.emit({ type: 'gate', from: role, data: { gateId, name, description } });
    return {
      gateId,
      text: `Decision gate "${name}" created (id ${gateId}) — a human must approve or reject it before you proceed. End your turn and wait for the resolution.`,
    };
  });
}

export async function resolveGate(
  daemon: OrgDaemon,
  org: string,
  gateId: string,
  approved: boolean,
  resolution?: string,
  resolvedBy?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withGatesLock(daemon, org, async () => {
    const data = gatesFor(daemon, org);
    const idx = data.gates.findIndex((g) => g.id === gateId);
    if (idx === -1) return { ok: false, error: `gate "${gateId}" not found for org "${org}"` };
    if (data.gates[idx].status !== 'pending')
      return { ok: false, error: `gate "${gateId}" already resolved (${data.gates[idx].status})` };

    data.gates[idx].status = approved ? 'approved' : 'rejected';
    data.gates[idx].resolvedAt = Date.now();
    data.gates[idx].resolvedBy = resolvedBy ?? 'human';
    data.gates[idx].resolution = resolution;
    writeGates(daemon.root, org, data);

    const running = daemon.orgs.get(org);
    const roleId = data.gates[idx].roleId;
    if (running) {
      running.bus.emit({
        type: 'gate',
        from: roleId,
        reason: approved ? 'gate-approved' : 'gate-rejected',
        data: { gateId, approved, resolution, resolvedBy: data.gates[idx].resolvedBy },
      });
      // M5: who decided.
      running.bus.emit({
        type: 'audit',
        reason: 'decision-resolved',
        from: roleId,
        data: {
          kind: 'gate',
          ref: gateId,
          resolver: data.gates[idx].resolvedBy,
          verdict: approved ? 'approved' : 'denied',
        },
      });
      const agent = running.agents.get(roleId);
      if (agent && !agent.mailbox.isClosed) {
        const verb = approved ? 'approved' : 'rejected';
        const detail =
          resolution ?? (approved ? 'approved — proceed' : 'rejected — do not proceed');
        agent.mailbox.push(`[gate ${verb}] "${data.gates[idx].name}": ${detail}`);
      }
    }
    return { ok: true };
  });
}

export function listGates(
  daemon: OrgDaemon,
  org: string,
  status?: 'pending' | 'approved' | 'rejected',
): DecisionGate[] {
  const data = gatesFor(daemon, org);
  return status ? data.gates.filter((g) => g.status === status) : data.gates;
}

// ── Decision trace ──────────────────────────────────────────────────────

/** Record a structured decision trace for Rifft-style debugging */
export function recordDecision(
  daemon: OrgDaemon,
  org: string,
  role: string,
  decision: {
    type: 'tool' | 'handoff' | 'approval' | 'routing';
    /** #290: structured cause — required so every emitter populates it and no
     *  consumer ever has to pattern-match the prose in context/reasoning. */
    kind: DecisionKind;
    context: string;
    reasoning: string;
    alternatives?: Array<{ choice: string; score: number; reason: string }>;
    outcome: string;
  },
): void {
  const running = daemon.orgs.get(org);
  if (!running) return;

  running.bus.emit({
    type: 'audit',
    from: role,
    reason: 'decision-trace',
    data: {
      decisionType: decision.type,
      kind: decision.kind,
      context: decision.context,
      reasoning: decision.reasoning,
      alternatives: decision.alternatives,
      outcome: decision.outcome,
      ts: new Date().toISOString(),
    },
  });
}
