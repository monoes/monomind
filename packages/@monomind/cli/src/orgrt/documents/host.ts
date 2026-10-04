// packages/@monomind/cli/src/orgrt/documents/host.ts
//
// The document tool host of one role (plan P3.6): the four operations the org_doc_* tools call, bound to the
// session's role at construction, so the caller identity is never an argument. Each operation checks the
// static access rules (access.ts) first, then calls the store (store.ts), and returns a plain result object:
// `{ok:true, ...}` or a refusal `{ok:false, code, error, remedy, ...}` (tool-errors.ts). Nothing here throws to
// the model, and nothing here touches the store once the runtime is closed.
import { createHash } from 'node:crypto';
import type { DocAccess } from './access.js';
import { canonicalJson } from './canonical.js';
import { type ListArgs, listDocuments } from './host-list.js';
import { shapeRead } from './host-read.js';
import type { DocumentStore } from './store.js';
import type { ReadPurpose } from './store-types.js';
import { failure, fromRefusal } from './tool-errors.js';

export interface PublishArgs {
  type: string;
  body: unknown;
  idempotency_key?: string;
  supersedes?: string;
  evidence?: unknown[];
  inputs?: string[];
  note?: string;
}
export interface ReadArgs {
  id: string;
  version?: number;
  part?: number;
}
export interface DecideArgs {
  id: string;
  version: number;
  decision: 'accept' | 'reject';
  reason?: string;
  idempotency_key?: string;
  expected_state_seq?: number;
}
export type { ListArgs };

export type DocResult = { ok: boolean } & Record<string, unknown>;

export interface DocumentToolHost {
  readonly role: string;
  list(a: ListArgs): DocResult;
  read(a: ReadArgs): DocResult;
  publish(a: PublishArgs): DocResult;
  decide(a: DecideArgs): DocResult;
}

/** What a host needs of its runtime. */
export interface HostContext {
  store: DocumentStore;
  access: DocAccess;
  run: string;
  isClosed(): boolean;
}

/** The idempotency key used when the role gives none: a digest of the call's own content, so repeating the
 *  identical call is a retry (it returns the committed receipt) and any change is a different operation. */
const derivedKey = (kind: string, payload: unknown): string =>
  `auto-${createHash('sha256').update(canonicalJson({ kind, payload })).digest('hex').slice(0, 40)}`;

const READ_PURPOSE: Record<string, ReadPurpose> = {
  root: 'audit',
  producer: 'revision',
  'consumer-lead': 'review',
};

export function createHost(ctx: HostContext, role: string): DocumentToolHost {
  const { store, access } = ctx;
  const closed = () =>
    failure(
      'RUNTIME_CLOSED',
      'the documents runtime of this run is closed: the run is stopping or has stopped',
    );
  const stateSeq = (id: string): number | undefined => store.list({ id })[0]?.state_seq;

  function publish(a: PublishArgs): DocResult {
    if (ctx.isClosed()) return closed();
    const type = String(a.type);
    if (!access.knows(type))
      return failure(
        'UNKNOWN_TYPE',
        `unknown document type "${type}"; you may publish: ${access.publishable(role).join(', ') || 'nothing'}`,
      );
    const why = access.publishRefusal(role, type);
    if (why) return failure('ACCESS_PUBLISH', why);
    let key = a.idempotency_key;
    if (key === undefined) {
      try {
        key = derivedKey('publish', {
          type,
          body: a.body,
          supersedes: a.supersedes ?? null,
          evidence: a.evidence ?? null,
          inputs: a.inputs ?? null,
          note: a.note ?? null,
        });
      } catch (err) {
        return failure('BODY_NOT_JSON', `the document is not JSON data: ${(err as Error).message}`);
      }
    }
    const r = store.publish({
      role,
      type,
      body: a.body,
      idempotency_key: key,
      ...(a.supersedes !== undefined ? { supersedes: a.supersedes } : {}),
      ...(a.evidence !== undefined ? { evidence: a.evidence } : {}),
      ...(a.inputs !== undefined ? { inputs: a.inputs } : {}),
      ...(a.note !== undefined ? { note: a.note } : {}),
    });
    if (!r.ok) return fromRefusal(r);
    const now = store.peek(r.id, r.version);
    const waiting =
      r.status === 'pending' && now.ok
        ? access.consumerIds(type).filter((c) => !now.decisions[c])
        : [];
    return {
      ok: true,
      ref: r.ref,
      id: r.id,
      version: r.version,
      status: r.status,
      contract_revision: r.contract_revision,
      ...(r.supersedes !== undefined ? { supersedes: r.supersedes } : {}),
      seq: r.seq,
      state_seq: stateSeq(r.id),
      waiting_on: waiting,
      attempts_left: store.attempts(type)?.left,
      ...(r.replayed ? { replayed: true } : {}),
    };
  }

  function read(a: ReadArgs): DocResult {
    if (ctx.isClosed()) return closed();
    const id = String(a.id);
    const d = store.list({ id })[0];
    if (!d) return failure('UNKNOWN_DOCUMENT', `unknown document "${id}"`);
    const level = access.readLevel(role, d.type);
    if (!level) return failure('ACCESS_READ', access.readRefusal(role, d.type) as string);
    const part = a.part ?? 1;
    if (part > 1 && a.version === undefined)
      return failure(
        'PART_NEEDS_VERSION',
        'part > 1 needs an explicit version, taken from part 1 of the same read',
      );
    let version = a.version;
    const accepted = [...d.versions].reverse().find((v) => v.status === 'accepted');
    if (version === undefined) {
      if (level === 'accepted' && !accepted)
        return failure('NOT_ACCEPTED_YET', `no version of "${id}" has been accepted yet`);
      version = accepted ? accepted.version : d.head.version;
    } else {
      const v = d.versions[version - 1];
      if (!v) return failure('UNKNOWN_VERSION', `no version ${version} of "${id}"`);
      if (level === 'accepted' && v.status !== 'accepted')
        return failure('ACCESS_READ', access.acceptedOnlyRefusal(role, d.type, version, v.status));
    }
    const how = access.roleFor(role, d.type) as string;
    const r =
      part === 1
        ? store.read({ role, id, version, purpose: READ_PURPOSE[how] ?? 'work' })
        : store.peek(id, version);
    if (!r.ok) return fromRefusal(r);
    const shaped = shapeRead(r, part);
    if ('outOfRange' in shaped)
      return failure(
        'PART_OUT_OF_RANGE',
        `${r.ref} has ${shaped.outOfRange} part${shaped.outOfRange === 1 ? '' : 's'}, not ${part}`,
      );
    return shaped as DocResult;
  }

  function decide(a: DecideArgs): DocResult {
    if (ctx.isClosed()) return closed();
    const id = String(a.id);
    const d = store.list({ id })[0];
    if (!d) return failure('UNKNOWN_DOCUMENT', `unknown document "${id}"`);
    const why = access.decideRefusal(role, d.type);
    if (why) return failure('ACCESS_DECIDE', why);
    const key =
      a.idempotency_key ??
      derivedKey('decide', {
        id,
        version: a.version,
        decision: a.decision,
        reason: a.reason ?? null,
      });
    const r = store.decide({
      role,
      id,
      version: a.version,
      decision: a.decision,
      idempotency_key: key,
      ...(a.reason !== undefined ? { reason: a.reason } : {}),
      ...(a.expected_state_seq !== undefined ? { expected_state_seq: a.expected_state_seq } : {}),
    });
    if (!r.ok) return fromRefusal(r);
    return {
      ok: true,
      id: r.id,
      version: r.version,
      consumer: r.consumer,
      decision: r.decision,
      status: r.status,
      waiting_on: r.waiting_on,
      seq: r.seq,
      state_seq: stateSeq(r.id),
      ...(r.replayed ? { replayed: true } : {}),
      ...(r.noop ? { noop: true } : {}),
    };
  }

  return {
    role,
    list: (a) =>
      ctx.isClosed() ? closed() : (listDocuments(store, access, ctx.run, role, a) as DocResult),
    read,
    publish,
    decide,
  };
}
