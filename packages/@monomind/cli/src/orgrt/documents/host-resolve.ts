// packages/@monomind/cli/src/orgrt/documents/host-resolve.ts
//
// Which version of a document a role may read, and which one a call that names none means: shared by
// org_doc_read and org_doc_check (who may check a version is who may read it). Pure over the store's listing
// and the static access rules; a refusal is the tool result the caller returns as is.
import type { DocAccess } from './access.js';
import type { DocumentStore } from './store.js';
import type { DocSummary } from './store-types.js';
import { type DocFailure, failure } from './tool-errors.js';

export interface Resolved {
  ok: true;
  doc: DocSummary;
  version: number;
}

/** The document and version `role` may read, or the refusal. `part` > 1 needs an explicit version. */
export function resolveReadable(
  store: DocumentStore,
  access: DocAccess,
  role: string,
  id: string,
  requested: number | undefined,
  part = 1,
): Resolved | DocFailure {
  const d = store.list({ id })[0];
  if (!d) return failure('UNKNOWN_DOCUMENT', `unknown document "${id}"`);
  const level = access.readLevel(role, d.type);
  if (!level) return failure('ACCESS_READ', access.readRefusal(role, d.type) as string);
  if (part > 1 && requested === undefined)
    return failure(
      'PART_NEEDS_VERSION',
      'part > 1 needs an explicit version, taken from part 1 of the same read',
    );
  const accepted = [...d.versions].reverse().find((v) => v.status === 'accepted');
  if (requested === undefined) {
    if (level === 'accepted' && !accepted)
      return failure('NOT_ACCEPTED_YET', `no version of "${id}" has been accepted yet`);
    return { ok: true, doc: d, version: accepted ? accepted.version : d.head.version };
  }
  const v = d.versions[requested - 1];
  if (!v) return failure('UNKNOWN_VERSION', `no version ${requested} of "${id}"`);
  if (level === 'accepted' && v.status !== 'accepted')
    return failure('ACCESS_READ', access.acceptedOnlyRefusal(role, d.type, requested, v.status));
  return { ok: true, doc: d, version: requested };
}
