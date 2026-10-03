// tests/eval/org/pilot/tools.ts
//
// The pilot's prototype tools for one role: publish, read, decide and list,
// bound to that role so a role cannot act as another. They are ordinary
// OrgToolDef objects; the harness hands them to a session through the tool
// provider hook (harness.ts), so nothing in the runtime knows they exist.
// The tests tree has no zod of its own; the CLI package's copy is the one the runtime's tool schemas use.
import { z } from '../../../../packages/@monomind/cli/node_modules/zod/index.js';
import type { OrgToolDef } from '../../../../packages/@monomind/cli/src/orgrt/agent-runner.js';
import type { HandoffStore } from './store.js';

export const PILOT_PREFIX = 'pilot';

const json = (v: unknown) => ({ text: JSON.stringify(v) });

export function pilotTools(store: HandoffStore, role: string): OrgToolDef[] {
  const t = (
    name: string,
    description: string,
    schema: OrgToolDef['schema'],
    handler: OrgToolDef['handler'],
  ): OrgToolDef => ({
    name: `${PILOT_PREFIX}__${name}`,
    description,
    schema,
    handler,
  });
  const relayed = store.relayEnabled();
  const tools: OrgToolDef[] = [
    t(
      'doc_list',
      'List the documents you produce or consume, with the status of the latest version of each.',
      {},
      async () => json({ documents: store.list(role) }),
    ),
    t(
      'doc_publish',
      relayed
        ? `Publish a document you produce, as a JSON object that matches its contract. The publish is refused, with every problem named, if it does not match its contract or if it disagrees with your deliverable files; a revision replaces your earlier pending version. ${store.noticeEnabled() ? 'The consumer is notified of every publish by the harness; still tell your lead once it is published.' : 'Consumers are not notified of a publish: tell your lead once it is published.'} When a consumer rejects a version you are told directly. Optional note: a short remark that stays with the version (for example why you republished unchanged content).`
        : 'Publish a document you produce, as a JSON object that matches its contract. The publish is refused, with every problem named, if it does not match; refused attempts count against a cap. A revision replaces your earlier pending version. Consumers are not notified: tell your lead once it is published.',
      {
        doc_id: z.string(),
        content: z.record(z.string(), z.unknown()),
        ...(relayed ? { note: z.string().optional() } : {}),
      },
      async (a) =>
        json(
          store.publish(
            role,
            a.doc_id as string,
            a.content,
            relayed ? (a.note as string | undefined) : undefined,
          ),
        ),
    ),
    t(
      'doc_read',
      'Read a document you produce or consume: its latest accepted version, or the latest if none is accepted yet, or the version you name.',
      { doc_id: z.string(), version: z.number().int().positive().optional() },
      async (a) => json(store.read(role, a.doc_id as string, a.version as number | undefined)),
    ),
    t(
      'doc_decide',
      'Accept or reject a pending version of a document you consume. Each consumer decides for itself; a version is accepted only when every consumer accepts, and one rejection (with a reason) sends it back to its producer.',
      {
        doc_id: z.string(),
        version: z.number().int().positive(),
        decision: z.enum(['accept', 'reject']),
        reason: z.string().optional(),
      },
      async (a) =>
        json(
          store.decide(
            role,
            a.doc_id as string,
            a.version as number,
            a.decision as 'accept' | 'reject',
            a.reason as string | undefined,
          ),
        ),
    ),
  ];
  // variant v2 only: a role whose documents declare checks gets the checking tool
  if (store.hasChecks(role))
    tools.push(
      t(
        'doc_check',
        "Run the document's declared checks over a version (latest accepted, else the latest, or the version you name): they test the document against itself, per answer, with the failing check named. Nothing is run and no file is read. It is a necessary check, not a sufficient one: an answer that passes may still be wrong, so verify what you rely on against the code.",
        { doc_id: z.string(), version: z.number().int().positive().optional() },
        async (a) => json(store.check(role, a.doc_id as string, a.version as number | undefined)),
      ),
    );
  return tools;
}
