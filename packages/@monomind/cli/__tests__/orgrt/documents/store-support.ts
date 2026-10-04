// Shared fixtures for the document store tests (P3.5): a clock that ticks one second per call, temp directories
// under TMPDIR, and the bindings the tests use (one producing section, one consuming section with a decider, a
// second consuming section for per-consumer acceptance).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentStore, type StoreOptions } from '../../../src/orgrt/documents/store.js';
import type { PublishRequest, Refusal, TypeBinding } from '../../../src/orgrt/documents/store-types.js';

export const tmp = (name = 'p35-'): string => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), name));

export function tickingClock(): () => Date {
  let n = 0;
  return () => new Date(Date.UTC(2026, 9, 4, 12, 0, n++));
}

export const briefSchema = {
  type: 'object',
  required: ['topic', 'claims'],
  additionalProperties: false,
  properties: {
    topic: { type: 'string', minLength: 3 },
    claims: { type: 'array', minItems: 1, items: { type: 'string' } },
  },
};

export const good = { topic: 'Pricing page', claims: ['v2.22 ships sections'] };

/** `brief`: produced by `researcher` (section research), consumed by sections writing (lead `writer`) and review (lead `reviewer`). */
export const briefBinding = (over: Partial<TypeBinding['contract']> = {}, consumers?: TypeBinding['consumers']): TypeBinding => ({
  contract: { type: 'brief', schema: briefSchema, max_publish_attempts: 3, ...over },
  section: 'research',
  producers: ['researcher'],
  consumers: consumers ?? [
    { id: 'writing', deciders: ['writer'] },
    { id: 'review', deciders: ['reviewer'] },
  ],
});

export const open = (dir: string, over: Partial<StoreOptions> = {}): DocumentStore =>
  new DocumentStore({ dir, run: 'run-1', bindings: [briefBinding()], now: tickingClock(), ...over });

export const fresh = (over: Partial<StoreOptions> = {}) => {
  const dir = tmp();
  return { dir, store: open(dir, over) };
};

let n = 0;
/** A publish request with a new idempotency key unless one is given. */
export const pub = (over: Partial<PublishRequest> = {}): PublishRequest => ({
  role: 'researcher',
  type: 'brief',
  body: good,
  idempotency_key: `k${++n}`,
  ...over,
});

export const refusal = (r: unknown): Refusal => {
  const x = r as Refusal;
  if (x.ok !== false) throw new Error(`expected a refusal, got ${JSON.stringify(r)}`);
  return x;
};

export const must = <T extends { ok: true }>(r: T | Refusal): T => {
  if (!r.ok) throw new Error(`expected success, got ${r.code}: ${r.message}`);
  return r;
};
