// orgrt/documents/store-types.ts
//
// Types of the event-sourced document store (org sections spec 6.2, plan P3.5): the persisted event schema,
// the requests and typed results of the operations, the type bindings the store is built from, and the two
// seams later pieces use (guards that refuse before a commit, listeners told after one).
import type { DocContract, DocContractInput } from './types.js';

export const STORE_FORMAT = 1;

/** Every refusal the store returns is one of these; codes are never renamed or reused, only added. */
export const STORE_ERROR_CODES = [
  'STORE_CORRUPT',
  'STORE_IO',
  'LOG_DIVERGED',
  'REENTRANT',
  'BODY_MISSING',
  'BODY_CORRUPT',
  'UNKNOWN_TYPE',
  'NOT_PRODUCER',
  'IDEMPOTENCY_KEY_INVALID',
  'IDEMPOTENCY_CONFLICT',
  'BODY_NOT_JSON',
  'PUBLISH_EXHAUSTED',
  'CONSISTENCY_EXHAUSTED',
  'SUPERSEDES_INVALID',
  'SUPERSEDES_CONFLICT',
  'TOO_LARGE',
  'CONTENT_INVALID',
  'GUARD_REFUSED',
  'UNKNOWN_DOCUMENT',
  'UNKNOWN_VERSION',
  'NOT_DECIDER',
  'CONSUMER_AMBIGUOUS',
  'REVERSAL_REFUSED',
  'SUPERSEDED',
  'VERSION_CLOSED',
  'REASON_REQUIRED',
  'DECISION_INVALID',
  'STATE_SEQ_CONFLICT',
  'ROLE_INVALID',
] as const;
export type StoreErrorCode = (typeof STORE_ERROR_CODES)[number];

export type VersionStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';
export type ReadPurpose = 'work' | 'review' | 'audit' | 'revision';

/** One reason a publish was refused (a schema path, an evidence kind, an input reference, a size). */
export interface ProblemView {
  code: string;
  path: string;
  message: string;
}

export interface Refusal {
  ok: false;
  code: StoreErrorCode;
  message: string;
  problems?: ProblemView[];
  /** Publish attempts left for the type under its current contract revision, after a counted refusal. */
  attempts_left?: number;
  /** After a counted consistency refusal: how many more the contract allows. */
  refusals_left?: number;
  /** SUPERSEDES_CONFLICT: the current head, `id@vN`. */
  head?: string;
  /** GUARD_REFUSED: the code the guard gave. */
  guard_code?: string;
}

export interface PublishReceipt {
  ok: true;
  /** `id@vN`. */
  ref: string;
  id: string;
  version: number;
  status: VersionStatus;
  contract_revision: string;
  supersedes?: string;
  seq: number;
  /** True when this is the committed receipt of an earlier call with the same key and payload. */
  replayed?: true;
}

export interface DecideReceipt {
  ok: true;
  id: string;
  version: number;
  consumer: string;
  decision: 'accept' | 'reject';
  /** The version's derived status after the decision. */
  status: VersionStatus;
  waiting_on: string[];
  seq: number;
  /** True when the committed receipt of the same key and payload is returned. */
  replayed?: true;
  /** True when an identical decision already stood (under another key): nothing was appended. */
  noop?: true;
}

export interface PublishRequest {
  role: string;
  type: string;
  body: unknown;
  idempotency_key: string;
  /** `id@vN`: the expected current head. Absent for the first publish of a document. */
  supersedes?: string;
  evidence?: unknown[];
  inputs?: string[];
  note?: string;
}

export interface DecideRequest {
  role: string;
  id: string;
  version: number;
  decision: 'accept' | 'reject';
  reason?: string;
  idempotency_key: string;
  /** Which consuming section the role decides for; needed only when the role decides for several. */
  consumer?: string;
  /** Compare-and-set on the document's state sequence (`state_seq` of a read, a listing or a receipt). */
  expected_state_seq?: number;
}

export interface ReadRequest {
  role: string;
  id: string;
  /** Absent: the latest accepted version, else the head. */
  version?: number;
  purpose?: ReadPurpose;
}

export interface DecisionView {
  decision: 'accept' | 'reject';
  reason?: string;
  by: string;
  at: string;
}

export interface ReadResult {
  ok: true;
  id: string;
  version: number;
  ref: string;
  type: string;
  section: string;
  by: string;
  at: string;
  status: VersionStatus;
  contract_revision: string;
  body: unknown;
  evidence: unknown[];
  inputs: string[];
  note?: string;
  body_sha256: string;
  decisions: Record<string, DecisionView>;
  /** Sequence of the document's latest state change: the value `expected_state_seq` is compared with. */
  state_seq: number;
}

export interface VersionSummary {
  version: number;
  status: VersionStatus;
  by: string;
  at: string;
  bytes: number;
  contract_revision: string;
  supersedes?: number;
}

export interface DocSummary {
  id: string;
  type: string;
  section: string;
  producer: string;
  head: VersionSummary;
  versions: VersionSummary[];
  /** Committed rejections per consuming section (rework rounds); recorded, never escalated here. */
  rework: Record<string, number>;
  state_seq: number;
}

export interface ListFilter {
  type?: string;
  section?: string;
  /** Matches the head version's status. */
  status?: VersionStatus;
  id?: string;
}

/** What the store is told about one document type; the runtime builds it from `sections` and `documents`. */
export interface TypeBinding {
  /** The contract as authored; the store resolves and hashes it (contract.ts). */
  contract: DocContractInput;
  /** The producing section (a directory name: `^[a-z][a-z0-9-]{0,39}$`). */
  section: string;
  /** Roles that may publish this type. */
  producers: string[];
  /** Consuming sections (names), each with the roles that may decide for it (acceptance `each`). */
  consumers: { id: string; deciders: string[] }[];
}

// ---------------------------------------------------------------- events (the persisted schema)

interface EventHead {
  /** 1, 2, 3, ...: contiguous; a gap or a repeat is corruption. */
  seq: number;
  /** sha-256 hex of the previous line's text, without its newline; 64 zeros for the first. */
  prev: string;
  /** Wall clock, ISO 8601. */
  at: string;
}

export interface PublishedEvent extends EventHead {
  type: 'published';
  /** Operation id: `publish:<role>:<idempotency key>`. */
  op: string;
  doc: string;
  doc_type: string;
  section: string;
  version: number;
  by: string;
  payload_sha256: string;
  contract_revision: string;
  body_sha256: string;
  bytes: number;
  /** The previous head's version number, when this version supersedes one. */
  supersedes?: number;
  note?: string;
  /** The consuming sections that decide this version, pinned at publish. */
  consumers: string[];
}

export interface RefusedEvent extends EventHead {
  type: 'refused';
  op: 'publish' | 'decide';
  by: string;
  doc_type: string;
  doc?: string;
  version?: number;
  code: string;
  counts: 'attempt' | 'consistency';
  contract_revision: string;
  reasons: string[];
}

export interface DecidedEvent extends EventHead {
  type: 'decided';
  /** Operation id: `decide:<role>:<idempotency key>`. */
  op: string;
  doc: string;
  version: number;
  consumer: string;
  by: string;
  decision: 'accept' | 'reject';
  reason?: string;
  payload_sha256: string;
  contract_revision: string;
  status_after: VersionStatus;
  waiting_on: string[];
}

export interface ReadEvent extends EventHead {
  type: 'read';
  doc: string;
  version: number;
  by: string;
  purpose: ReadPurpose;
}

export type StoreEvent = PublishedEvent | RefusedEvent | DecidedEvent | ReadEvent;

// ---------------------------------------------------------------- seams

export interface GuardRefusal {
  code: string;
  message: string;
  problems?: string[];
  /** `consistency`: counted against max_consistency_refusals; `attempt`: against max_publish_attempts. */
  counts?: 'attempt' | 'consistency';
}

export interface PublishGuardContext {
  type: string;
  role: string;
  section: string;
  contract: DocContract;
  body: unknown;
  /** The document being revised, when this is a revision. */
  doc?: string;
  version: number;
}

export interface DecideGuardContext {
  type: string;
  role: string;
  doc: string;
  version: number;
  consumer: string;
  decision: 'accept' | 'reject';
  contract: DocContract;
  body: unknown;
}

/** Checks that run after the store's own, before the commit; a refusal commits nothing. Plan P3.10 hangs here. */
export interface StoreGuard {
  publish?(ctx: PublishGuardContext): GuardRefusal | undefined;
  decide?(ctx: DecideGuardContext): GuardRefusal | undefined;
}

/** Told after every committed event, in order. A throwing listener never undoes a commit. Plans P3.8 to P3.11. */
export type StoreListener = (event: StoreEvent) => void;
