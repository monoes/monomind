// tests/eval/org/pilot/harness.ts
//
// Attaches the document hand-off prototype to one in-process OrgDaemon for one
// authorized trial (org sections spec 9.2). Nothing here is reachable from
// `org run`, `org serve`, import, creation, resume or reload: the prototype
// exists only in the harness process that calls `attachPilot` with the trial's
// run token. It does two things, both by overriding a daemon method on that one
// instance: it gives each sectioned role the pilot tools through the tool
// provider hook, and it refuses a cross-section org_send before it is queued.
import type { OrgDaemon } from '../../../../packages/@monomind/cli/src/orgrt/daemon.js';
import { type FaultPlan, faultInjector } from './fault-injection.js';
import { crossSectionRefusal, type Routing, sectionOf } from './routing.js';
import { type DocContract, HandoffStore } from './store.js';
import { PILOT_PREFIX, pilotTools } from './tools.js';

export interface PilotTrial {
  /** The per-trial token the harness minted; `attachPilot` refuses any other. */
  runId: string;
  /** The trial's own directory; the store and its events log live here. */
  dir: string;
  routing: Routing;
  contracts: DocContract[];
  /** Harness-seeded faults for the published documents (parallel-sweep-3's treatment arm); absent elsewhere. */
  faults?: FaultPlan;
  /** Variant v2 (parallel-sweep-3): the producers' workspace, for the contracts' deliverable files. */
  workspace?: string;
  /** Variant v2: the producer relay is on; each rejection also gets a short copy to these roles. */
  relay?: { copy_to: string[] };
}

/** The sender of a relay message: not a role, so no section applies to it (the refusal still covers every role). */
export const RELAY_SENDER = 'pilot-relay';

/** The org definition a pilot trial runs: each sectioned role carries a placeholder tool
 *  provider, so the session asks the provider hook (which the harness answers) for tools.
 *  The definition itself stays an ordinary Phase 2 one: it never serializes `sections`. */
export function pilotOrgDef<D extends { roles: Record<string, any>[] }>(
  def: D,
  trial: PilotTrial,
): D {
  const d = def as unknown as Record<string, any>;
  if ('sections' in d)
    throw new Error(
      'a pilot org definition must not carry sections:; the routing map lives in the trial manifest',
    );
  if (d.run_config?.experimental)
    throw new Error('a pilot org definition must not set run_config.experimental');
  const placeholder = { kind: 'mcp-stdio', name: PILOT_PREFIX, command: 'true', args: [], env: {} };
  return {
    ...def,
    roles: def.roles.map((r) =>
      sectionOf(trial.routing, r.id)
        ? {
            ...r,
            tool_providers: [...(r.tool_providers ?? []), placeholder],
            responsibilities: [...(r.responsibilities ?? []), handoffLine(r.id, trial)],
          }
        : r,
    ),
  };
}

/** The line a sectioned role is given about the prototype: its documents and the one rule on mail. */
function handoffLine(role: string, trial: PilotTrial): string {
  const mine = (pick: (c: DocContract) => boolean) => trial.contracts.filter(pick);
  const describe = (c: DocContract) => `${c.id} (fields: ${JSON.stringify(c.schema)})`;
  const produces = mine((c) => c.producer === role).map(describe);
  const consumes = mine((c) => c.consumers.includes(role)).map(describe);
  const parts = ['Hand-offs between sections are documents, not messages.'];
  const v2 = trial.relay !== undefined;
  if (produces.length)
    parts.push(
      `You produce: ${produces.join(', ')}. Publish each as a JSON object with ${PILOT_PREFIX}__doc_publish (a document that does not match its contract${v2 ? ' or disagrees with your deliverable files' : ''} is refused with the problems named: fix it and publish again), then tell your lead it is published.${v2 ? ' When a consumer rejects a version, a message from pilot-relay tells you directly (document, version, reason, attempts left): fix the underlying files and publish a corrected version; your lead is not asked to relay it.' : ''}`,
    );
  if (consumes.length)
    parts.push(
      `You consume: ${consumes.join(', ')}. Read it with ${PILOT_PREFIX}__doc_read, ${v2 ? `run ${PILOT_PREFIX}__doc_check on it (a necessary check against the document's own evidence, not a sufficient one: spot-check what you rely on against the code), then ` : 'then '}${PILOT_PREFIX}__doc_decide accept or reject (a rejection needs a reason); a document counts as accepted only when every consumer accepts it.${v2 ? ' A rejection is delivered to the producer directly by the relay: you need not ask the lead to relay it. You are notified by a message from pilot-relay each time one of these documents is published (and once when all of them are available), so you need not poll: when a notice arrives, read, check and decide that document.' : ''}`,
    );
  parts.push(
    'A message to a role in another section is refused; raise cross-section needs with your section lead, or hand the work over as a document.',
  );
  return parts.join(' ');
}

export function attachPilot(daemon: OrgDaemon, trial: PilotTrial, token: string): HandoffStore {
  if (token !== trial.runId)
    throw new Error('pilot tools attach only to the trial that owns this run token');
  const store = new HandoffStore(
    trial.dir,
    trial.contracts,
    undefined,
    trial.faults ? faultInjector(trial.faults) : undefined,
    {
      ...(trial.workspace ? { workspace: trial.workspace } : {}),
      ...(trial.relay
        ? {
            copyTo: trial.relay.copy_to,
            consumerNotice: true,
            // the daemon's deliver at call time: the wrapped one below, so its refusal path is the one used
            relay: (m) =>
              daemon.deliver([...daemon.orgs.keys()][0], RELAY_SENDER, m.to, m.subject, m.body),
          }
        : {}),
    },
  );

  const hub = daemon.toolProviders as unknown as {
    buildRoleTools: (o: { ctx: { role: string } }) => Promise<unknown>;
  };
  hub.buildRoleTools = async ({ ctx }) => ({
    tools: sectionOf(trial.routing, ctx.role) ? pilotTools(store, ctx.role) : [],
    close: () => undefined,
    pids: () => ({}),
  });

  const deliver = daemon.deliver.bind(daemon);
  daemon.deliver = async (fromOrg, fromRole, to, subject, body) => {
    const refusal = crossSectionRefusal(trial.routing, fromRole, to);
    if (refusal) {
      store.record({ kind: 'send-refused', ok: false, role: fromRole, detail: `to ${to}` });
      return refusal;
    }
    return deliver(fromOrg, fromRole, to, subject, body);
  };
  return store;
}
