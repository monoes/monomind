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
}

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
  if (produces.length)
    parts.push(
      `You produce: ${produces.join(', ')}. Publish each as a JSON object with ${PILOT_PREFIX}__doc_publish (a document that does not match its contract is refused with the problems named: fix it and publish again), then tell your lead it is published.`,
    );
  if (consumes.length)
    parts.push(
      `You consume: ${consumes.join(', ')}. Read it with ${PILOT_PREFIX}__doc_read, then ${PILOT_PREFIX}__doc_decide accept or reject (a rejection needs a reason); a document counts as accepted only when every consumer accepts it.`,
    );
  parts.push(
    'A message to a role in another section is refused; raise cross-section needs with your section lead, or hand the work over as a document.',
  );
  return parts.join(' ');
}

export function attachPilot(daemon: OrgDaemon, trial: PilotTrial, token: string): HandoffStore {
  if (token !== trial.runId)
    throw new Error('pilot tools attach only to the trial that owns this run token');
  const store = new HandoffStore(trial.dir, trial.contracts);

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
