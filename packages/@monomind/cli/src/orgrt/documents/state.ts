// orgrt/documents/state.ts
//
// The derived view of the document store (R16: status is derived, never stored). `applyEvent` is the one
// reducer: the store applies it to every event it commits, and replay (from the log, or from a snapshot plus the
// later events) applies it to every event it reads, so the two cannot drift. It is deterministic and takes no
// input but the state and the event; an event that does not fit the state is a ReplayError (corruption).
import type { StoreEvent, VersionStatus } from './store-types.js';

export interface DecisionRecord {
  decision: 'accept' | 'reject';
  reason?: string;
  by: string;
  at: string;
  seq: number;
}

export interface VersionRecord {
  version: number;
  seq: number;
  at: string;
  by: string;
  contract_revision: string;
  body_sha256: string;
  bytes: number;
  supersedes?: number;
  note?: string;
  /** Consuming sections that decide this version, pinned at publish. */
  consumers: string[];
  decisions: Record<string, DecisionRecord>;
  /** Reads per role (work, review, audit and revision alike): count and the sequence of the first one. */
  reads: Record<string, { n: number; first_seq: number }>;
}

export interface DocRecord {
  id: string;
  type: string;
  section: string;
  producer: string;
  versions: VersionRecord[];
  /** Sequence of the latest state change (a publish or a decision): what `expected_state_seq` compares with. */
  last_seq: number;
  /** Committed rejections per consuming section: unique rounds, never duplicate calls. */
  rework: Record<string, number>;
}

export interface TypeCounters {
  /** Documents issued so far for the type (the next id is `<type>-<docs + 1>`). */
  docs: number;
  /** Counted publish refusals, by contract revision: a changed revision starts a fresh count. */
  attempts: Record<string, number>;
  /** Counted consistency refusals, by contract revision. */
  consistency: Record<string, number>;
}

export interface IdemEntry {
  sha: string;
  kind: 'publish' | 'decide';
  doc: string;
  version: number;
  seq: number;
  consumer?: string;
  decision?: 'accept' | 'reject';
  status?: VersionStatus;
  waiting_on?: string[];
}

export interface DocState {
  seq: number;
  types: Record<string, TypeCounters>;
  docs: Record<string, DocRecord>;
  /** `<op>` (`publish:<role>:<key>` or `decide:<role>:<key>`) to the committed outcome. */
  idem: Record<string, IdemEntry>;
}

export class ReplayError extends Error {
  constructor(
    readonly seq: number,
    message: string,
  ) {
    super(`event ${seq}: ${message}`);
    this.name = 'ReplayError';
  }
}

export const emptyState = (): DocState => ({ seq: 0, types: {}, docs: {}, idem: {} });

export const headOf = (d: DocRecord): VersionRecord => d.versions[d.versions.length - 1];

/** pending, accepted (every pinned consumer accepted), rejected (any consumer rejected) or superseded (not the head). */
export function versionStatus(d: DocRecord, v: VersionRecord): VersionStatus {
  const ds = Object.values(v.decisions);
  if (ds.some((x) => x.decision === 'reject')) return 'rejected';
  if (v.consumers.length > 0 && v.consumers.every((c) => v.decisions[c]?.decision === 'accept'))
    return 'accepted';
  return headOf(d) === v ? 'pending' : 'superseded';
}

/** Consuming sections that have not decided the version yet; empty once it is no longer pending. */
export const waitingOn = (d: DocRecord, v: VersionRecord): string[] =>
  versionStatus(d, v) === 'pending' ? v.consumers.filter((c) => !v.decisions[c]) : [];

const counters = (s: DocState, type: string): TypeCounters =>
  (s.types[type] ??= { docs: 0, attempts: {}, consistency: {} });

const need = (e: StoreEvent, cond: unknown, message: string): void => {
  if (!cond) throw new ReplayError(e.seq, message);
};

/** Apply one event to `s` in place. Throws ReplayError when the event contradicts the state. */
export function applyEvent(s: DocState, e: StoreEvent): void {
  need(e, e.seq === s.seq + 1, `sequence ${e.seq} after ${s.seq}`);
  switch (e.type) {
    case 'published': {
      const c = counters(s, e.doc_type);
      let d = s.docs[e.doc];
      if (e.supersedes === undefined) {
        need(e, !d && e.version === 1, `${e.doc} is already issued`);
        need(
          e,
          e.doc === `${e.doc_type}-${c.docs + 1}`,
          `${e.doc} is not the next ${e.doc_type} id`,
        );
        c.docs += 1;
        d = s.docs[e.doc] = {
          id: e.doc,
          type: e.doc_type,
          section: e.section,
          producer: e.by,
          versions: [],
          last_seq: 0,
          rework: {},
        };
      } else {
        need(e, d && d.type === e.doc_type, `${e.doc} is not an issued ${e.doc_type} document`);
        need(
          e,
          e.supersedes === d.versions.length,
          `${e.doc} supersedes v${e.supersedes} but its head is v${d.versions.length}`,
        );
        need(e, e.version === d.versions.length + 1, `${e.doc} v${e.version} is out of order`);
      }
      d.versions.push({
        version: e.version,
        seq: e.seq,
        at: e.at,
        by: e.by,
        contract_revision: e.contract_revision,
        body_sha256: e.body_sha256,
        bytes: e.bytes,
        ...(e.supersedes !== undefined ? { supersedes: e.supersedes } : {}),
        ...(e.note !== undefined ? { note: e.note } : {}),
        consumers: [...e.consumers],
        decisions: {},
        reads: {},
      });
      d.last_seq = e.seq;
      need(e, !s.idem[e.op], `operation ${e.op} is committed twice`);
      s.idem[e.op] = {
        sha: e.payload_sha256,
        kind: 'publish',
        doc: e.doc,
        version: e.version,
        seq: e.seq,
      };
      break;
    }
    case 'refused': {
      const c = counters(s, e.doc_type);
      const bag = e.counts === 'attempt' ? c.attempts : c.consistency;
      bag[e.contract_revision] = (bag[e.contract_revision] ?? 0) + 1;
      break;
    }
    case 'decided': {
      const d = s.docs[e.doc];
      const v = d?.versions[e.version - 1];
      need(e, v, `${e.doc} v${e.version} does not exist`);
      need(
        e,
        v.consumers.includes(e.consumer),
        `${e.consumer} is not a consumer of ${e.doc} v${e.version}`,
      );
      need(e, !v.decisions[e.consumer], `${e.consumer} already decided ${e.doc} v${e.version}`);
      v.decisions[e.consumer] = {
        decision: e.decision,
        ...(e.reason !== undefined ? { reason: e.reason } : {}),
        by: e.by,
        at: e.at,
        seq: e.seq,
      };
      if (e.decision === 'reject') d.rework[e.consumer] = (d.rework[e.consumer] ?? 0) + 1;
      d.last_seq = e.seq;
      need(e, !s.idem[e.op], `operation ${e.op} is committed twice`);
      s.idem[e.op] = {
        sha: e.payload_sha256,
        kind: 'decide',
        doc: e.doc,
        version: e.version,
        seq: e.seq,
        consumer: e.consumer,
        decision: e.decision,
        status: e.status_after,
        waiting_on: [...e.waiting_on],
      };
      break;
    }
    case 'read': {
      const v = s.docs[e.doc]?.versions[e.version - 1];
      need(e, v, `${e.doc} v${e.version} does not exist`);
      const r = (v.reads[e.by] ??= { n: 0, first_seq: e.seq });
      r.n += 1;
      break;
    }
    default:
      throw new ReplayError((e as { seq: number }).seq, 'unknown event type');
  }
  s.seq = e.seq;
}
