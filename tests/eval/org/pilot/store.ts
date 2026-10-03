// tests/eval/org/pilot/store.ts
//
// The pilot's harness-owned document store (org sections spec 9.2): publish,
// read and decide with schema checks and per-consumer acceptance, kept in a
// file under the trial's own directory. It has none of the release build's
// guarantees (no provenance, freshness, recovery or isolation), and the pilot
// is labelled that way. Every call, accepted or refused, is appended to
// `pilot-events.jsonl` so the report can count hand-offs and failures.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { assertSupportedSchema, checkAgainstSchema } from './schema.js';

/** A published document may not exceed this many characters of JSON. */
export const MAX_DOC_CHARS = 20_000;

export interface DocContract {
  id: string;
  title: string;
  producer: string;
  /** Every consumer must accept a version before it counts as accepted ("each"). */
  consumers: string[];
  /** Publish attempts allowed for this document, schema failures included. */
  max_attempts: number;
  schema: Record<string, unknown>;
}

export type VersionStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';

export interface DocVersion {
  version: number;
  at: string;
  by: string;
  content: unknown;
  status: VersionStatus;
  decisions: Record<string, { decision: 'accept' | 'reject'; reason?: string; at: string }>;
}

interface State {
  attempts: Record<string, number>;
  versions: Record<string, DocVersion[]>;
  /** Documents whose first accepted publish a fault injector changed (once per document). */
  injected?: Record<string, { version: number; class: string }>;
  /** What the producer sent, by "doc#version", for the versions the injector changed; only the metrics read it (doc_read returns versions, never this). */
  originals?: Record<string, unknown>;
}

/** A harness-side hook that may change a document's content at its first successful publish, so the
 *  version a consumer reads differs from what the producer sent. One scenario's treatment arm uses it
 *  (fault-injection.ts); the store applies it at most once per document and records it. */
export interface PublishInjector {
  apply(
    doc: string,
    content: unknown,
  ): { content: unknown; record: { class: string; [k: string]: unknown } } | undefined;
}

export interface PilotEvent {
  kind: 'publish' | 'read' | 'decide' | 'send-refused' | 'fault';
  at: string;
  ok: boolean;
  role: string;
  doc?: string;
  version?: number;
  detail?: string;
}

type Fail = { ok: false; error: string; problems?: string[] };

export class HandoffStore {
  private state: State;
  private readonly file: string;
  private readonly eventsFile: string;
  private readonly byId = new Map<string, DocContract>();

  constructor(
    dir: string,
    contracts: DocContract[],
    private readonly now: () => Date = () => new Date(),
    private readonly injector?: PublishInjector,
  ) {
    for (const c of contracts) {
      if (c.consumers.length === 0)
        throw new Error(`contract ${c.id}: at least one consumer is required`);
      assertSupportedSchema(c.schema, `contract ${c.id} $`);
      this.byId.set(c.id, c);
    }
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'pilot-store.json');
    this.eventsFile = join(dir, 'pilot-events.jsonl');
    this.state = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, 'utf8')) as State)
      : { attempts: {}, versions: {} };
  }

  contracts(): DocContract[] {
    return [...this.byId.values()];
  }

  attempts(doc: string): number {
    return this.state.attempts[doc] ?? 0;
  }

  /** Append an event of the harness's own, such as a refused cross-section send. */
  record(e: Omit<PilotEvent, 'at'>): void {
    appendFileSync(this.eventsFile, `${JSON.stringify({ at: this.now().toISOString(), ...e })}\n`);
  }

  events(): PilotEvent[] {
    return existsSync(this.eventsFile)
      ? readFileSync(this.eventsFile, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : [];
  }

  private save(): void {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state));
    renameSync(`${this.file}.tmp`, this.file);
  }

  private fail<T extends Omit<PilotEvent, 'at' | 'ok'>>(
    e: T,
    error: string,
    problems?: string[],
  ): Fail {
    this.record({ ...e, ok: false, detail: error });
    return { ok: false, error, ...(problems ? { problems } : {}) };
  }

  publish(
    role: string,
    doc: string,
    content: unknown,
  ): { ok: true; version: number; status: VersionStatus } | Fail {
    const ev = { kind: 'publish' as const, role, doc };
    const c = this.byId.get(doc);
    if (!c)
      return this.fail(ev, `unknown document "${doc}"; known: ${[...this.byId.keys()].join(', ')}`);
    if (role !== c.producer) return this.fail(ev, `only ${c.producer} publishes "${doc}"`);
    if (this.attempts(doc) >= c.max_attempts)
      return this.fail(
        ev,
        `${c.max_attempts} publish attempts for "${doc}" are used; report the blocker to your lead instead of publishing again`,
      );
    this.state.attempts[doc] = this.attempts(doc) + 1;
    const size = JSON.stringify(content ?? null).length;
    const problems =
      size > MAX_DOC_CHARS
        ? [`$: ${size} characters, over the ${MAX_DOC_CHARS} limit`]
        : checkAgainstSchema(c.schema, content);
    if (problems.length) {
      this.save();
      return this.fail(
        ev,
        size > MAX_DOC_CHARS
          ? problems[0]
          : `"${doc}" does not match its contract: ${problems.join('; ')}`,
        problems,
      );
    }
    const versions = (this.state.versions[doc] ??= []);
    for (const v of versions) if (v.status === 'pending') v.status = 'superseded';
    const version = versions.length + 1;
    const fault = this.state.injected?.[doc] ? undefined : this.injector?.apply(doc, content);
    if (fault) {
      (this.state.injected ??= {})[doc] = { version, class: fault.record.class };
      (this.state.originals ??= {})[`${doc}#${version}`] = content;
    }
    versions.push({
      version,
      at: this.now().toISOString(),
      by: role,
      content: fault ? fault.content : content,
      status: 'pending',
      decisions: {},
    });
    this.save();
    this.record({ ...ev, ok: true, version });
    // the harness's own record of what it changed; events are not a tool, so no role reads it
    if (fault)
      this.record({
        kind: 'fault',
        role: 'harness',
        doc,
        version,
        ok: true,
        detail: JSON.stringify(fault.record),
      });
    return { ok: true, version, status: 'pending' };
  }

  read(
    role: string,
    doc: string,
    version?: number,
  ): { ok: true; doc: DocVersion & { id: string } } | Fail {
    const ev = { kind: 'read' as const, role, doc };
    const c = this.byId.get(doc);
    if (!c) return this.fail(ev, `unknown document "${doc}"`);
    if (role !== c.producer && !c.consumers.includes(role))
      return this.fail(ev, `${role} is not a producer or consumer of "${doc}"`);
    const versions = this.state.versions[doc] ?? [];
    if (versions.length === 0) return this.fail(ev, `no version of "${doc}" has been published`);
    const found =
      version !== undefined
        ? versions.find((v) => v.version === version)
        : ([...versions].reverse().find((v) => v.status === 'accepted') ??
          versions[versions.length - 1]);
    if (!found) return this.fail(ev, `no version ${version} of "${doc}"`);
    this.record({ ...ev, ok: true, version: found.version });
    return { ok: true, doc: { id: doc, ...found } };
  }

  decide(
    role: string,
    doc: string,
    version: number,
    decision: 'accept' | 'reject',
    reason?: string,
  ): { ok: true; status: VersionStatus; waiting_on: string[] } | Fail {
    const ev = { kind: 'decide' as const, role, doc, version };
    const c = this.byId.get(doc);
    if (!c) return this.fail(ev, `unknown document "${doc}"`);
    if (!c.consumers.includes(role)) return this.fail(ev, `${role} is not a consumer of "${doc}"`);
    const versions = this.state.versions[doc] ?? [];
    const v = versions.find((x) => x.version === version);
    if (!v) return this.fail(ev, `no version ${version} of "${doc}"`);
    const prior = v.decisions[role];
    if (prior) {
      if (prior.decision === decision)
        return { ok: true, status: v.status, waiting_on: this.waitingOn(c, v) };
      return this.fail(
        ev,
        `${role} already ${prior.decision}ed version ${version}; publish a revision instead`,
      );
    }
    if (v.status === 'superseded') {
      const latest = versions[versions.length - 1].version;
      return this.fail(
        ev,
        `version ${version} is superseded by version ${latest}; decide on version ${latest}`,
      );
    }
    if (v.status !== 'pending') return this.fail(ev, `version ${version} is already ${v.status}`);
    if (decision === 'reject' && !reason?.trim())
      return this.fail(ev, 'a rejection needs a reason');
    v.decisions[role] = { decision, ...(reason ? { reason } : {}), at: this.now().toISOString() };
    if (decision === 'reject') v.status = 'rejected';
    else if (c.consumers.every((x) => v.decisions[x]?.decision === 'accept')) v.status = 'accepted';
    this.save();
    this.record({ ...ev, ok: true, detail: decision });
    return { ok: true, status: v.status, waiting_on: this.waitingOn(c, v) };
  }

  private waitingOn(c: DocContract, v: DocVersion): string[] {
    return v.status === 'pending' ? c.consumers.filter((x) => !v.decisions[x]) : [];
  }

  /** What `role` may see: the documents it produces or consumes, with their latest status. */
  list(role: string): {
    doc: string;
    title: string;
    role: 'producer' | 'consumer';
    /** The contract's fields, so a role does not spend publish attempts guessing them. */
    schema: Record<string, unknown>;
    latest?: { version: number; status: VersionStatus };
  }[] {
    return this.contracts()
      .filter((c) => c.producer === role || c.consumers.includes(role))
      .map((c) => {
        const last = (this.state.versions[c.id] ?? []).at(-1);
        return {
          doc: c.id,
          title: c.title,
          role: c.producer === role ? ('producer' as const) : ('consumer' as const),
          schema: c.schema,
          ...(last ? { latest: { version: last.version, status: last.status } } : {}),
        };
      });
  }
}
