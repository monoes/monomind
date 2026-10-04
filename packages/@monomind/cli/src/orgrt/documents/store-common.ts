// orgrt/documents/store-common.ts
//
// Shared by the store and its operations: the bound form of a document type, the name checks, the refusal
// constructor, and the narrow view of the store (`StoreCtx`) that publish and decide work through. Nothing here
// touches the disk.
import { contractRevision, TYPE_NAME } from './contract.js';
import type { EventLog } from './events.js';
import type { DocRecord, DocState } from './state.js';
import type {
  ProblemView,
  ReadResult,
  Refusal,
  StoreErrorCode,
  StoreEvent,
  StoreGuard,
  TypeBinding,
} from './store-types.js';
import type { DocContract } from './types.js';

/** A document type as the store holds it: the binding, the resolved contract and its pinned revision. */
export interface Bound {
  binding: TypeBinding;
  contract: DocContract;
  revision: string;
}

export interface Attempts {
  used: number;
  left: number;
  refusals_used: number;
  refusals_left: number;
}

/** What publish and decide may use of the store. Internal: the class implements it, nothing else should. */
export interface StoreCtx {
  readonly run: string;
  readonly bound: Map<string, Bound>;
  readonly state: DocState;
  readonly guards: StoreGuard[];
  readonly badBodies: Map<string, StoreErrorCode>;
  bodyPath(d: Pick<DocRecord, 'section' | 'type' | 'id'>, version: number): string;
  commit(body: Parameters<EventLog['append']>[0]): StoreEvent;
  attempts(type: string): Attempts | undefined;
  peek(id: string, version?: number): ReadResult | Refusal;
  counted(
    op: 'publish' | 'decide',
    role: string,
    x: Bound,
    code: StoreErrorCode,
    message: string,
    counts: 'attempt' | 'consistency',
    problems?: ProblemView[],
    at?: { doc?: string; version?: number },
    guard_code?: string,
  ): Refusal;
}

const SECTION = /^[a-z][a-z0-9-]{0,39}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const validRole = (r: unknown): r is string =>
  typeof r === 'string' && r.length > 0 && r.length <= 200 && !FORBIDDEN_KEYS.has(r);
export const validKey = (k: unknown): k is string =>
  typeof k === 'string' && k.length > 0 && k.length <= 200 && !/[\r\n\0]/.test(k);
/** Own-property lookup, so an id such as `__proto__` is never found on the prototype. */
export const own = <T>(o: Record<string, T>, k: string): T | undefined =>
  Object.hasOwn(o, k) ? o[k] : undefined;
export const fail = (
  code: StoreErrorCode,
  message: string,
  extra: Partial<Refusal> = {},
): Refusal => ({ ok: false, code, message, ...extra });
export const problemText = (p: ProblemView): string => `${p.path}: ${p.message}`;

export const ROLE_REFUSAL = (): Refusal =>
  fail('ROLE_INVALID', 'the calling role is not a valid role name');
export const KEY_REFUSAL = (): Refusal =>
  fail(
    'IDEMPOTENCY_KEY_INVALID',
    'idempotency_key must be a non-empty string of at most 200 characters',
  );

/** Validate a binding and resolve its contract; throws (a configuration error, found at construction). */
export function bindType(b: TypeBinding, known: Map<string, Bound>): Bound {
  const { contract, revision } = contractRevision(b.contract);
  const bad = (m: string): never => {
    throw new Error(`document type ${contract.type}: ${m}`);
  };
  if (known.has(contract.type)) bad('declared twice');
  if (!SECTION.test(b.section)) bad(`section "${b.section}" is not a valid name`);
  if (!b.producers.length || !b.producers.every(validRole)) bad('needs at least one producer role');
  if (new Set(b.consumers.map((c) => c.id)).size !== b.consumers.length)
    bad('lists a consuming section twice');
  for (const c of b.consumers)
    if (!TYPE_NAME.test(c.id) || !c.deciders.length || !c.deciders.every(validRole))
      bad(`consumer "${c.id}" needs a valid name and at least one decider`);
  return { binding: b, contract, revision };
}
