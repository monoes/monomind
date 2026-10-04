// packages/@monomind/cli/src/orgrt/documents/host-list.ts
//
// org_doc_list (spec 6.1): what a role may see, bounded to RESULT_MAX characters with a continuation cursor.
// The cursor binds the caller, the run, the filter and a signature of the listing it was cut from; a cursor
// that does not match is refused instead of being restarted against live state. Listing is metadata only: it
// grants no read and records no read event.
import { createHash } from 'node:crypto';
import type { DocAccess, TypeRole } from './access.js';
import { RESULT_MAX } from './host-read.js';
import type { DocumentStore } from './store.js';
import type { DocSummary, ListFilter, VersionStatus } from './store-types.js';
import { failure } from './tool-errors.js';

export interface ListArgs {
  type?: string;
  section?: string;
  status?: VersionStatus;
  cursor?: string;
}

const SCHEMA_BUDGET = 5500;

interface Entry {
  id: string;
  type: string;
  section: string;
  head: { version: number; status: string; by: string; at: string; bytes: number };
  versions: { version: number; status: string }[];
  accepted: number | null;
  state_seq: number;
}

/** A role limited to accepted versions sees only those; one that sees all gets every version. */
function project(d: DocSummary, level: 'all' | 'accepted'): Entry | undefined {
  const accepted = [...d.versions].reverse().find((v) => v.status === 'accepted');
  if (level === 'accepted' && !accepted) return undefined;
  const head = level === 'accepted' ? (accepted as NonNullable<typeof accepted>) : d.head;
  return {
    id: d.id,
    type: d.type,
    section: d.section,
    head: {
      version: head.version,
      status: head.status,
      by: head.by,
      at: head.at,
      bytes: head.bytes,
    },
    versions: (level === 'accepted'
      ? d.versions.filter((v) => v.status === 'accepted')
      : d.versions
    ).map((v) => ({
      version: v.version,
      status: v.status,
    })),
    accepted: accepted ? accepted.version : null,
    state_seq: d.state_seq,
  };
}

const signature = (entries: Entry[]): string =>
  createHash('sha256')
    .update(
      entries.map((e) => `${e.id}:${e.state_seq}:${e.head.version}:${e.head.status}`).join('|'),
    )
    .digest('hex')
    .slice(0, 16);

const encode = (c: object): string => Buffer.from(JSON.stringify(c)).toString('base64url');
function decode(s: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function typesView(
  store: DocumentStore,
  access: DocAccess,
  role: string,
  type: string | undefined,
  withSchema: boolean,
): Record<string, unknown>[] {
  const info = new Map(store.contracts().map((c) => [c.type, c]));
  return access
    .typesFor(role)
    .filter((t) => !type || t.type === type)
    .map(({ type: name, role: how }: { type: string; role: TypeRole }) => {
      const c = info.get(name);
      if (!c) return { type: name, role: how };
      const base = {
        type: name,
        role: how,
        section: c.section,
        consumers: c.consumers.map((x) => x.id),
        contract_revision: c.revision,
      };
      if (how !== 'producer') return base;
      return {
        ...base,
        ...(withSchema ? { schema: c.contract.schema } : { schema_omitted: true }),
        evidence_required: c.contract.evidence,
        max_bytes: c.contract.max_bytes,
        attempts_left: store.attempts(name)?.left,
      };
    });
}

export function listDocuments(
  store: DocumentStore,
  access: DocAccess,
  run: string,
  role: string,
  a: ListArgs,
): Record<string, unknown> {
  const filter: ListFilter = {
    ...(a.type ? { type: a.type } : {}),
    ...(a.section ? { section: a.section } : {}),
  };
  const entries: Entry[] = [];
  for (const d of store.list(filter)) {
    const level = access.readLevel(role, d.type);
    const e = level ? project(d, level) : undefined;
    if (e && (!a.status || e.head.status === a.status)) entries.push(e);
  }
  const sig = signature(entries);
  const bound = {
    r: run,
    who: role,
    t: a.type ?? null,
    s: a.section ?? null,
    st: a.status ?? null,
  };
  let off = 0;
  if (a.cursor !== undefined) {
    const c = decode(a.cursor);
    const ok =
      c !== undefined &&
      c.sig === sig &&
      Object.entries(bound).every(([k, v]) => c[k] === v) &&
      Number.isInteger(c.off) &&
      (c.off as number) >= 0 &&
      (c.off as number) <= entries.length;
    if (!ok)
      return failure(
        'CURSOR_INVALID',
        'the cursor does not belong to this caller and filter, or the listing changed since it was issued',
      );
    off = c.off as number;
  }
  let types: Record<string, unknown>[] = [];
  if (a.cursor === undefined) {
    types = typesView(store, access, role, a.type, true);
    if (!a.type && JSON.stringify(types).length > SCHEMA_BUDGET)
      types = typesView(store, access, role, a.type, false);
  }
  const result: Record<string, unknown> = {
    ok: true,
    ...(a.cursor === undefined ? { types } : {}),
    documents: [],
  };
  const docs: Entry[] = [];
  let next: number | undefined;
  for (let i = off; i < entries.length; i++) {
    const probe = JSON.stringify({
      ...result,
      documents: [...docs, entries[i]],
      next_cursor: 'x'.repeat(200),
    });
    if (probe.length > RESULT_MAX && docs.length > 0) {
      next = i;
      break;
    }
    docs.push(entries[i]);
  }
  result.documents = docs;
  if (next !== undefined) result.next_cursor = encode({ ...bound, sig, off: next });
  return result;
}
