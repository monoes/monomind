// packages/@monomind/cli/src/orgrt/documents/tools-core.ts
//
// The four document tools (org sections spec 6.1, plan P3.6): `org_doc_list`, `org_doc_read`,
// `org_doc_publish`, `org_doc_decide`. Native org tools: buildOrgTools adds them when the session has a
// documents host (SessionOpts.documents), after every existing tool, and marks them strict like the rest.
// Arguments never name a role: the host is bound to the session's role. Results are JSON text. The role
// guidance (guidance.ts) and these descriptions (plan P3.12) are the text a role is told about them.
import { z } from 'zod';
import type { OrgToolDef } from '../agent-runner.js';
import type { DocumentToolHost } from './host.js';
import { failure } from './tool-errors.js';
import { checkTools } from './tools-check.js';

const KEY = z.string().min(1).max(200).optional();
const ref = z.string().min(1).max(120);

export function documentTools(host: DocumentToolHost): OrgToolDef[] {
  const run = (f: () => unknown): Promise<{ text: string }> => {
    try {
      return Promise.resolve({ text: JSON.stringify(f()) });
    } catch (err) {
      return Promise.resolve({
        text: JSON.stringify(
          failure('STORE_IO', `the document call failed: ${(err as Error).message}`),
        ),
      });
    }
  };
  return [
    {
      name: 'org_doc_list',
      description:
        'List the document types you may publish or read, with your role for each (producers also get the full schema), and the documents you may see: id, type, section, head version and status, state_seq. Use it to find what is pending for you and the id of a head version. Long listings continue with next_cursor.',
      schema: {
        type: z.string().max(80).optional(),
        section: z.string().max(80).optional(),
        status: z.enum(['pending', 'accepted', 'rejected', 'superseded']).optional(),
        cursor: z.string().max(2000).optional(),
      },
      handler: (a) => run(() => host.list(a as Parameters<DocumentToolHost['list']>[0])),
    },
    {
      name: 'org_doc_read',
      description:
        'Read a version of a document you may read (default: the latest accepted version, else the latest). Records the read: read a document before you decide on it. A long document comes in parts: part 1 gives the outline and the part count; pass version with part to read the rest.',
      schema: {
        id: ref,
        version: z.number().int().positive().optional(),
        part: z.number().int().positive().optional(),
      },
      handler: (a) => run(() => host.read(a as unknown as Parameters<DocumentToolHost['read']>[0])),
    },
    {
      name: 'org_doc_publish',
      description:
        'Publish a document of a type your section produces: body is a JSON object that must match the type contract, evidence the entries it requires. If the contract has deliverable files, write them first and verify them on disk (ls -l or Read) before publishing: a publish whose body disagrees with a file is refused, naming the file and the first field that differs. A refused publish names every problem at once and uses one of the limited attempts: fix all of them before you publish again. To revise (after a rejection, or when a file changed), pass supersedes with the id@vN of the current head. idempotency_key is optional: repeating an identical call is safe without it.',
      schema: {
        type: z.string().min(1).max(80),
        body: z.record(z.string(), z.unknown()),
        idempotency_key: KEY,
        supersedes: ref.optional(),
        evidence: z.array(z.record(z.string(), z.unknown())).max(256).optional(),
        inputs: z.array(z.string().max(120)).max(256).optional(),
        note: z.string().max(2000).optional(),
      },
      handler: (a) =>
        run(() => host.publish(a as unknown as Parameters<DocumentToolHost['publish']>[0])),
    },
    {
      name: 'org_doc_decide',
      description:
        'Accept or reject a pending version of a document your section consumes (the consuming lead only). Accept means you rely on that exact version; reject needs a reason the producer can act on, and it reaches the producer directly. A decision is per version: a corrected version supersedes the old one and needs its own decision. A version is accepted when every consuming section accepts it. Read it first (and check it, when org_doc_check is available); expected_state_seq, when given, must match the document state_seq you read.',
      schema: {
        id: ref,
        version: z.number().int().positive(),
        decision: z.enum(['accept', 'reject']),
        reason: z.string().max(4000).optional(),
        idempotency_key: KEY,
        expected_state_seq: z.number().int().nonnegative().optional(),
      },
      handler: (a) =>
        run(() => host.decide(a as unknown as Parameters<DocumentToolHost['decide']>[0])),
    },
    ...checkTools(host, run),
  ];
}
