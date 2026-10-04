// packages/@monomind/cli/src/orgrt/documents/tools-check.ts
//
// The consumer-side check tool (org sections plan P3.11): `org_doc_check`. It is listed exactly when the
// session's host can check, that is when at least one document contract of the org declares `checks` (the host
// carries `check` then, host.ts); an org with no declared checks, and every sections-off org, has no such tool.
// Same arguments as org_doc_read, same access (who may check a version may read it), same result bound and
// paging. The description (plan P3.12) says what the tool is not: a pass shows the document is consistent
// with its own evidence, nothing more.
import { z } from 'zod';
import type { OrgToolDef } from '../agent-runner.js';
import type { DocumentToolHost } from './host.js';

export function checkTools(
  host: DocumentToolHost,
  run: (f: () => unknown) => Promise<{ text: string }>,
): OrgToolDef[] {
  const check = host.check?.bind(host);
  if (!check) return [];
  return [
    {
      name: 'org_doc_check',
      description:
        'Run the checks the contract declares over a version of a document you may read (default: the latest accepted version, else the latest): per answer, the failing check is named. The checks look at the document alone: nothing is executed and no file is read, so a pass shows it is consistent with its own evidence, not that it is true. A pass is necessary, not sufficient: spot-check what you rely on against the source before you accept. A long result comes in parts: pass version with part to read the rest.',
      schema: {
        id: z.string().min(1).max(120),
        version: z.number().int().positive().optional(),
        part: z.number().int().positive().optional(),
      },
      handler: (a) => run(() => check(a as unknown as Parameters<typeof check>[0])),
    },
  ];
}
