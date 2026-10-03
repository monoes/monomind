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
import { assertSupportedChecks, type Check, type CheckResult, runChecks } from './checks.js';
import { assertDeliverables, type Deliverable, deliverableMismatches } from './deliverables.js';
import { type RelayReason, rejectionMessage, type StoreOptions, sendRelay } from './relay.js';
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
  /** Characters of JSON a version may hold, instead of MAX_DOC_CHARS (a document carrying evidence is longer). */
  max_chars?: number;
  /** Files in the producer's workspace each part of a document must equal (variant v2). A publish that
   *  disagrees with them is refused, and an accept is refused if a file changed since the publish. */
  deliverables?: Deliverable[];
  /** Consistency refusals allowed per document, separate from `max_attempts`; default 5. */
  max_refusals?: number;
  /** Checks `pilot__doc_check` runs over a version for its consumer (variant v2); see checks.ts. */
  checks?: Check[];
}

export const DEFAULT_MAX_REFUSALS = 5;

export type VersionStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';

export interface DocVersion {
  version: number;
  at: string;
  by: string;
  content: unknown;
  /** A short note the producer attached to the publish (it is not part of the content). */
  note?: string;
  status: VersionStatus;
  decisions: Record<string, { decision: 'accept' | 'reject'; reason?: string; at: string }>;
}

interface State {
  attempts: Record<string, number>;
  /** Publishes refused for disagreeing with a deliverable file, per document (not publish attempts). */
  refusals?: Record<string, number>;
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
  kind: 'publish' | 'read' | 'decide' | 'send-refused' | 'fault' | 'check' | 'relay';
  at: string;
  ok: boolean;
  role: string;
  doc?: string;
  version?: number;
  detail?: string;
  /** The deliverable file(s) a consistency refusal names. */
  file?: string;
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
    private readonly opts: StoreOptions = {},
  ) {
    for (const c of contracts) {
      if (c.consumers.length === 0)
        throw new Error(`contract ${c.id}: at least one consumer is required`);
      assertSupportedSchema(c.schema, `contract ${c.id} $`);
      if (c.checks) assertSupportedChecks(c.checks, `contract ${c.id} checks`);
      if (c.deliverables) {
        assertDeliverables(c.deliverables, `contract ${c.id} deliverables`);
        if (!opts.workspace)
          throw new Error(`contract ${c.id}: deliverables need the store's workspace option`);
      }
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
    detailPrefix = '',
  ): Fail {
    this.record({ ...e, ok: false, detail: `${detailPrefix}${error}` });
    return { ok: false, error, ...(problems ? { problems } : {}) };
  }

  publish(
    role: string,
    doc: string,
    content: unknown,
    note?: string,
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
    const maxRefusals = c.max_refusals ?? DEFAULT_MAX_REFUSALS;
    if (c.deliverables && this.refusals(doc) >= maxRefusals)
      return this.fail(
        ev,
        `${maxRefusals} publishes of "${doc}" were refused for disagreeing with your files; report the blocker to your lead instead of publishing again`,
      );
    const limit = c.max_chars ?? MAX_DOC_CHARS;
    const size = JSON.stringify(content ?? null).length;
    const problems =
      size > limit
        ? [`$: ${size} characters, over the ${limit} limit`]
        : checkAgainstSchema(c.schema, content);
    if (problems.length) {
      this.state.attempts[doc] = this.attempts(doc) + 1;
      this.save();
      return this.fail(
        ev,
        size > limit ? problems[0] : `"${doc}" does not match its contract: ${problems.join('; ')}`,
        problems,
      );
    }
    // consistency with the producer's own files, on what the producer sent (never on an injected copy)
    if (c.deliverables) {
      const bad = deliverableMismatches(this.opts.workspace as string, c.deliverables, content);
      if (bad.length) {
        this.state.refusals = { ...this.state.refusals, [doc]: this.refusals(doc) + 1 };
        this.save();
        const left = maxRefusals - this.refusals(doc);
        return this.fail(
          { ...ev, file: bad.map((b) => b.file).join(', ') },
          `"${doc}" disagrees with your deliverable files, so it was not published: ${bad
            .slice(0, 4)
            .map((b) => b.problem)
            .join(
              '; ',
            )}. Fix the file or the document so they agree, then publish again (this refusal does not use a publish attempt; ${left} such refusal${left === 1 ? '' : 's'} left)`,
          bad.map((b) => b.problem),
          'consistency: ',
        );
      }
    }
    this.state.attempts[doc] = this.attempts(doc) + 1;
    const versions = (this.state.versions[doc] ??= []);
    for (const v of versions) if (v.status === 'pending') v.status = 'superseded';
    const version = versions.length + 1;
    const fault = this.state.injected?.[doc] ? undefined : this.injector?.apply(doc, content);
    if (fault) {
      (this.state.injected ??= {})[doc] = { version, class: fault.record.class };
      (this.state.originals ??= {})[`${doc}#${version}`] = content;
    }
    const cleanNote = note?.trim() ? note.trim().slice(0, 400) : undefined;
    versions.push({
      version,
      at: this.now().toISOString(),
      by: role,
      content: fault ? fault.content : content,
      ...(cleanNote ? { note: cleanNote } : {}),
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

  refusals(doc: string): number {
    return this.state.refusals?.[doc] ?? 0;
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
    // an accepted document must certify the files as they are now: compare them with what the producer
    // sent (the original when the injector changed the copy a consumer reads)
    if (decision === 'accept' && c.deliverables) {
      const sent = this.state.originals?.[`${doc}#${version}`] ?? v.content;
      const bad = deliverableMismatches(this.opts.workspace as string, c.deliverables, sent);
      if (bad.length) {
        const why = bad.map((b) => b.problem).join('; ');
        this.relay(
          c,
          version,
          'deliverable-changed',
          `Version ${version} of "${doc}" could not be accepted because your deliverable files changed after you published it: ${why}. Publish a corrected version so the document and the files agree.`,
          role,
        );
        return this.fail(
          { ...ev, file: bad.map((b) => b.file).join(', ') },
          `version ${version} cannot be accepted: the producer's deliverable files changed after it was published (${why}). The producer has been told to publish a corrected version; decide on that one`,
          undefined,
          'consistency: ',
        );
      }
    }
    v.decisions[role] = { decision, ...(reason ? { reason } : {}), at: this.now().toISOString() };
    if (decision === 'reject') v.status = 'rejected';
    else if (c.consumers.every((x) => v.decisions[x]?.decision === 'accept')) v.status = 'accepted';
    this.save();
    this.record({ ...ev, ok: true, detail: decision });
    if (decision === 'reject') this.relayRejection(c, version, role, reason as string);
    return { ok: true, status: v.status, waiting_on: this.waitingOn(c, v) };
  }

  /** Tells the producer, directly, that a consumer rejected a version, and what to do; the lead gets a short copy. */
  private relayRejection(c: DocContract, version: number, by: string, reason: string): void {
    const m = rejectionMessage(c, version, by, reason, this.attempts(c.id));
    this.relay(c, version, 'rejected', m.body, by, m.copy);
  }

  private relay(
    c: DocContract,
    version: number,
    reason: RelayReason,
    body: string,
    by: string,
    copy?: string,
  ): void {
    sendRelay(this.opts, (e) => this.record(e), c, version, reason, body, by, copy);
  }

  /** True when the store was built with a producer relay (variant v2). */
  relayEnabled(): boolean {
    return this.opts.relay !== undefined;
  }

  /** The checks a role may run: the documents it produces or consumes whose contract declares any. */
  hasChecks(role: string): boolean {
    return this.contracts().some(
      (c) => c.checks?.length && (c.producer === role || c.consumers.includes(role)),
    );
  }

  /** Runs a document's declared checks over a version (the one `read` returns by default, or the one named). */
  check(
    role: string,
    doc: string,
    version?: number,
  ):
    | ({ ok: true; doc: string; version: number; status: VersionStatus } & Omit<
        CheckResult,
        'by_check'
      > & {
          passed: number;
          note: string;
        })
    | Fail {
    const ev = { kind: 'check' as const, role, doc };
    const c = this.byId.get(doc);
    if (!c) return this.fail(ev, `unknown document "${doc}"`);
    if (role !== c.producer && !c.consumers.includes(role))
      return this.fail(ev, `${role} is not a producer or consumer of "${doc}"`);
    if (!c.checks?.length) return this.fail(ev, `"${doc}" declares no checks`);
    const versions = this.state.versions[doc] ?? [];
    if (versions.length === 0) return this.fail(ev, `no version of "${doc}" has been published`);
    const found =
      version !== undefined
        ? versions.find((v) => v.version === version)
        : ([...versions].reverse().find((v) => v.status === 'accepted') ??
          versions[versions.length - 1]);
    if (!found) return this.fail(ev, `no version ${version} of "${doc}"`);
    const r = runChecks(c.checks, found.content);
    this.record({
      ...ev,
      ok: true,
      version: found.version,
      detail: JSON.stringify({
        answers: r.answers,
        flagged: r.flagged.length + r.doc_level.length,
        by_check: r.by_check,
      }),
    });
    const { by_check: _by, ...rest } = r;
    return {
      ok: true,
      doc,
      version: found.version,
      status: found.status,
      ...rest,
      passed: r.answers - r.flagged.length,
      note: 'Answers not listed under flagged pass every check. The checks only test the document against itself (its evidence): they do not prove it right, so spot-check what you rely on against the code.',
    };
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
          ...(c.producer === role && c.deliverables
            ? { files_must_match: c.deliverables.map((d) => d.file) }
            : {}),
          ...(last ? { latest: { version: last.version, status: last.status } } : {}),
        };
      });
  }
}
