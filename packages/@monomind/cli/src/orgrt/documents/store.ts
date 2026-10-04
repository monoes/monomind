// orgrt/documents/store.ts
//
// The event-sourced document store (org sections spec 6.2, plan P3.5). Nothing outside documents/ constructs it
// yet; the tools (P3.6), notices (P3.8), relay (P3.9), deliverable guards (P3.10) and checks (P3.11) are later
// pieces that use the seams in this class (`addGuard`, `onCommitted`).
//
// Layout under `<dir>` (the caller passes `<orgDir>/docs/<run>`):
//   events.jsonl                               append-only event log (events.ts): the authority
//   <section>/<type>/<id>@v<N>.json            immutable version bodies, no status field
//   contracts/<type>@<revision>.json           the canonical contract each revision was hashed from
//   snapshot.json                              derived state at an event and byte offset (snapshot.ts)
//
// A commit is: write the body (temp file, fsync, rename, directory fsync), then append and fsync the event; only
// then is the caller told. Every operation is synchronous and does no await, so operations in one process are
// serialised by construction; a guard or listener that calls back into a mutating operation is refused
// (REENTRANT). Two processes on one directory are the release build's single-owner lock; here a log that changed
// under the store is detected (LOG_DIVERGED) and stops it. State is rebuilt on open by replaying the log (after
// the snapshot, when it fits); a torn final line is discarded and cut off, anything else wrong is corruption.
// publish and decide live in store-publish.ts and store-decide.ts and reach the store through `StoreCtx`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contractRevision } from './contract.js';
import { writeFileDurable } from './durable-fs.js';
import { EventLog, GENESIS_HASH, parseLog, sha256 } from './events.js';
import { loadSnapshot, writeSnapshot } from './snapshot.js';
import {
  applyEvent,
  type DocRecord,
  type DocState,
  emptyState,
  headOf,
  ReplayError,
  versionStatus,
  type VersionRecord,
} from './state.js';
import {
  type Attempts,
  type Bound,
  bindType,
  fail,
  own,
  problemText,
  ROLE_REFUSAL,
  type StoreCtx,
  validRole,
} from './store-common.js';
import { doDecide } from './store-decide.js';
import { doPublish } from './store-publish.js';
import {
  type DecideReceipt,
  type DecideRequest,
  type DocSummary,
  type ListFilter,
  type ProblemView,
  type PublishReceipt,
  type PublishRequest,
  type ReadRequest,
  type ReadResult,
  type Refusal,
  STORE_FORMAT,
  type StoreErrorCode,
  type StoreEvent,
  type StoreGuard,
  type StoreListener,
  type TypeBinding,
  type VersionSummary,
} from './store-types.js';
import type { DocContract } from './types.js';

export interface StoreOptions {
  /** `<orgDir>/docs/<run>`. */
  dir: string;
  /** The run id (a snapshot written for another run is ignored). */
  run: string;
  bindings: TypeBinding[];
  now?: () => Date;
  /** Write a snapshot after every this many events; 0 disables the automatic one. Default 100. */
  snapshotEvery?: number;
  guards?: StoreGuard[];
}

export interface StoreInfo {
  run: string;
  seq: number;
  head_hash: string;
  /** Bytes of a torn final line cut off when the log was opened. */
  torn_bytes_repaired: number;
  snapshot: { used: boolean; reason?: string };
  corrupt?: { code: StoreErrorCode; message: string };
  /** Versions whose committed event has no usable body file: reading or deciding them is refused. */
  bad_bodies: { ref: string; code: StoreErrorCode }[];
}

export class DocumentStore implements StoreCtx {
  /** @internal (StoreCtx) */ readonly bound = new Map<string, Bound>();
  /** @internal (StoreCtx) */ state: DocState = emptyState();
  /** @internal (StoreCtx) */ readonly guards: StoreGuard[];
  /** @internal (StoreCtx) */ readonly badBodies = new Map<string, StoreErrorCode>();
  private readonly log: EventLog;
  private corrupt?: { code: StoreErrorCode; message: string };
  private readonly listeners: StoreListener[] = [];
  private readonly now: () => Date;
  private readonly snapEvery: number;
  private busy = false;
  private readonly tornRepaired: number;
  private snapInfo: { used: boolean; reason?: string } = { used: false, reason: 'none' };

  constructor(private readonly opts: StoreOptions) {
    this.now = opts.now ?? (() => new Date());
    this.snapEvery = opts.snapshotEvery ?? 100;
    this.guards = [...(opts.guards ?? [])];
    for (const b of opts.bindings) {
      const x = bindType(b, this.bound);
      this.bound.set(x.contract.type, x);
    }
    for (const [type, x] of this.bound) {
      const file = join(opts.dir, 'contracts', `${type}@${x.revision}.json`);
      const text = `${contractRevision(x.binding.contract).canonical}\n`;
      if (!existsSync(file)) writeFileDurable(file, text);
      else if (readFileSync(file, 'utf8') !== text)
        this.corrupt = {
          code: 'STORE_CORRUPT',
          message: `contract snapshot ${type}@${x.revision} differs from its revision`,
        };
    }
    const path = join(opts.dir, 'events.jsonl');
    const buf = EventLog.read(path);
    const snap = loadSnapshot(join(opts.dir, 'snapshot.json'), opts.run, buf);
    let from = { offset: 0, seq: 0, head_hash: GENESIS_HASH };
    if (snap.ok) {
      this.state = snap.snapshot.state;
      from = {
        offset: snap.snapshot.offset,
        seq: snap.snapshot.seq,
        head_hash: snap.snapshot.head_hash,
      };
      this.snapInfo = { used: true };
    } else this.snapInfo = { used: false, reason: snap.reason };
    const parsed = parseLog(buf, from);
    try {
      for (const e of parsed.events) applyEvent(this.state, e);
    } catch (err) {
      if (!(err instanceof ReplayError)) throw err;
      this.corrupt = { code: 'STORE_CORRUPT', message: err.message };
    }
    if (parsed.corruption)
      this.corrupt = {
        code: 'STORE_CORRUPT',
        message: `${parsed.corruption.message} (line ${parsed.corruption.seq}, byte ${parsed.corruption.offset})`,
      };
    this.tornRepaired = parsed.torn_bytes;
    if (parsed.torn_bytes > 0 && !this.corrupt) EventLog.truncate(path, parsed.offset);
    this.log = new EventLog(path, {
      offset: parsed.offset,
      seq: parsed.seq,
      head_hash: parsed.head_hash,
    });
    for (const d of Object.values(this.state.docs))
      for (const v of d.versions)
        if (!existsSync(this.bodyPath(d, v.version)))
          this.badBodies.set(`${d.id}@v${v.version}`, 'BODY_MISSING');
  }

  /** @internal (StoreCtx) */
  get run(): string {
    return this.opts.run;
  }

  /** @internal (StoreCtx) */
  bodyPath(d: Pick<DocRecord, 'section' | 'type' | 'id'>, version: number): string {
    return join(this.opts.dir, d.section, d.type, `${d.id}@v${version}.json`);
  }

  // ------------------------------------------------------------------ queries (no event)

  info(): StoreInfo {
    const p = this.log.position;
    return {
      run: this.opts.run,
      seq: p.seq,
      head_hash: p.head_hash,
      torn_bytes_repaired: this.tornRepaired,
      snapshot: { ...this.snapInfo },
      ...(this.corrupt ? { corrupt: this.corrupt } : {}),
      bad_bodies: [...this.badBodies].map(([ref, code]) => ({ ref, code })),
    };
  }

  /** The resolved contracts with the revision each is pinned to, and who produces and decides each type. */
  contracts(): {
    type: string;
    revision: string;
    section: string;
    contract: DocContract;
    producers: string[];
    consumers: TypeBinding['consumers'];
  }[] {
    return [...this.bound.values()].map((x) => ({
      type: x.contract.type,
      revision: x.revision,
      section: x.binding.section,
      contract: x.contract,
      producers: x.binding.producers,
      consumers: x.binding.consumers,
    }));
  }

  /** Attempts used and left for a type under its current revision (publish, then consistency refusals). */
  attempts(type: string): Attempts | undefined {
    const x = this.bound.get(type);
    if (!x) return undefined;
    const c = own(this.state.types, type);
    const used = c?.attempts[x.revision] ?? 0;
    const refusals = c?.consistency[x.revision] ?? 0;
    return {
      used,
      left: Math.max(0, x.contract.max_publish_attempts - used),
      refusals_used: refusals,
      refusals_left: Math.max(0, x.contract.max_consistency_refusals - refusals),
    };
  }

  private summary(v: VersionRecord, d: DocRecord): VersionSummary {
    return {
      version: v.version,
      status: versionStatus(d, v),
      by: v.by,
      at: v.at,
      bytes: v.bytes,
      contract_revision: v.contract_revision,
      ...(v.supersedes !== undefined ? { supersedes: v.supersedes } : {}),
    };
  }

  list(filter: ListFilter = {}): DocSummary[] {
    return Object.values(this.state.docs)
      .filter(
        (d) =>
          (!filter.type || d.type === filter.type) &&
          (!filter.section || d.section === filter.section) &&
          (!filter.id || d.id === filter.id),
      )
      .map((d) => ({
        id: d.id,
        type: d.type,
        section: d.section,
        producer: d.producer,
        head: this.summary(headOf(d), d),
        versions: d.versions.map((v) => this.summary(v, d)),
        rework: { ...d.rework },
        state_seq: d.last_seq,
      }))
      .filter((d) => !filter.status || d.head.status === filter.status);
  }

  /** A version with its body, read from disk and checked against the hash its event recorded; records nothing. */
  peek(id: string, version?: number): ReadResult | Refusal {
    const d = own(this.state.docs, id);
    if (!d) return fail('UNKNOWN_DOCUMENT', `unknown document "${id}"`);
    let v: VersionRecord | undefined;
    if (version === undefined)
      v = [...d.versions].reverse().find((x) => versionStatus(d, x) === 'accepted') ?? headOf(d);
    else v = Number.isInteger(version) ? d.versions[version - 1] : undefined;
    if (!v) return fail('UNKNOWN_VERSION', `no version ${String(version)} of "${id}"`);
    const ref = `${d.id}@v${v.version}`;
    const bad = this.badBodies.get(ref);
    if (bad)
      return fail(
        bad,
        `the body of ${ref} is missing or corrupt: it has a committed event but no usable file`,
      );
    let text: string;
    try {
      text = readFileSync(this.bodyPath(d, v.version), 'utf8');
    } catch {
      this.badBodies.set(ref, 'BODY_MISSING');
      return fail(
        'BODY_MISSING',
        `the body of ${ref} is missing: it has a committed event but no file`,
      );
    }
    if (sha256(text) !== v.body_sha256) {
      this.badBodies.set(ref, 'BODY_CORRUPT');
      return fail('BODY_CORRUPT', `the body of ${ref} does not match the hash its event recorded`);
    }
    const f = JSON.parse(text) as {
      body: unknown;
      evidence: unknown[];
      inputs: string[];
      note?: string;
    };
    return {
      ok: true,
      id: d.id,
      version: v.version,
      ref,
      type: d.type,
      section: d.section,
      by: v.by,
      at: v.at,
      status: versionStatus(d, v),
      contract_revision: v.contract_revision,
      body: f.body,
      evidence: f.evidence,
      inputs: f.inputs,
      ...(f.note !== undefined ? { note: f.note } : {}),
      body_sha256: v.body_sha256,
      decisions: Object.fromEntries(
        Object.entries(v.decisions).map(([c, x]) => [
          c,
          {
            decision: x.decision,
            ...(x.reason !== undefined ? { reason: x.reason } : {}),
            by: x.by,
            at: x.at,
          },
        ]),
      ),
      state_seq: d.last_seq,
    };
  }

  // ------------------------------------------------------------------ seams

  /** Add a check that runs after the store's own, before a commit (plan P3.10). */
  addGuard(g: StoreGuard): void {
    this.guards.push(g);
  }

  /** Be told after each committed event, in order (plans P3.8 to P3.11). Returns the unsubscribe function. */
  onCommitted(l: StoreListener): () => void {
    this.listeners.push(l);
    return () => {
      const i = this.listeners.indexOf(l);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  // ------------------------------------------------------------------ mutation plumbing

  private guarded<T>(fn: () => T | Refusal): T | Refusal {
    if (this.corrupt)
      return fail(
        'STORE_CORRUPT',
        `the document store is corrupt and refuses work: ${this.corrupt.message}`,
      );
    if (this.busy)
      return fail('REENTRANT', 'a document store operation was started from inside a commit');
    if (!this.log.intact()) {
      this.corrupt = { code: 'LOG_DIVERGED', message: 'the event log changed under the store' };
      return fail(
        'LOG_DIVERGED',
        'the event log changed under the store (another writer, or a failed write)',
      );
    }
    this.busy = true;
    try {
      return fn();
    } catch (err) {
      return fail('STORE_IO', `the document store could not write: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  /** @internal (StoreCtx) */
  commit(body: Parameters<EventLog['append']>[0]): StoreEvent {
    const ev = this.log.append(body, this.now().toISOString());
    try {
      applyEvent(this.state, ev);
    } catch (err) {
      this.corrupt = { code: 'STORE_CORRUPT', message: (err as Error).message };
      throw err;
    }
    for (const l of [...this.listeners]) {
      try {
        l(ev);
      } catch {
        /* a listener never undoes a commit */
      }
    }
    if (this.snapEvery > 0 && ev.seq % this.snapEvery === 0) {
      try {
        this.snapshot();
      } catch {
        /* a snapshot is a cache of the log */
      }
    }
    return ev;
  }

  /** Write the derived state at the current event; the log stays the authority. */
  snapshot(): void {
    const p = this.log.position;
    if (p.seq === 0) return;
    writeSnapshot(join(this.opts.dir, 'snapshot.json'), {
      format: STORE_FORMAT,
      run: this.opts.run,
      seq: p.seq,
      offset: p.offset,
      head_hash: p.head_hash,
      state: this.state,
    });
  }

  /** @internal (StoreCtx): record a refusal that counts against a cap, and say how much of the cap is left. */
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
  ): Refusal {
    this.commit({
      type: 'refused',
      op,
      by: role,
      doc_type: x.contract.type,
      ...(at?.doc ? { doc: at.doc } : {}),
      ...(at?.version ? { version: at.version } : {}),
      code: guard_code ?? code,
      counts,
      contract_revision: x.revision,
      reasons: (problems ? problems.map(problemText) : [message]).slice(0, 8),
    });
    const a = this.attempts(x.contract.type) as Attempts;
    const type = x.contract.type;
    const tail =
      counts === 'attempt'
        ? a.left === 0
          ? ` No publish attempts for "${type}" are left: report the blocker to your lead instead of publishing again.`
          : ` ${a.left} publish attempt${a.left === 1 ? '' : 's'} left.`
        : a.refusals_left === 0
          ? ` No consistency refusals for "${type}" are left: report the blocker to your lead instead of publishing again.`
          : ` This does not use a publish attempt; ${a.refusals_left} consistency refusal${a.refusals_left === 1 ? '' : 's'} left.`;
    return fail(code, message + tail, {
      ...(problems ? { problems } : {}),
      ...(counts === 'attempt' ? { attempts_left: a.left } : { refusals_left: a.refusals_left }),
      ...(guard_code ? { guard_code } : {}),
    });
  }

  // ------------------------------------------------------------------ operations

  publish(req: PublishRequest): PublishReceipt | Refusal {
    return this.guarded(() => doPublish(this, req));
  }

  /** `override`: the consuming section the root decides for on a thread whose rework cap is spent (P4.7). */
  decide(req: DecideRequest, override?: string): DecideReceipt | Refusal {
    return this.guarded(() => doDecide(this, req, override));
  }

  /** Read a version and record the read (`read` event: who, which version, why). */
  read(req: ReadRequest): ReadResult | Refusal {
    return this.guarded(() => {
      if (!validRole(req.role)) return ROLE_REFUSAL();
      const r = this.peek(req.id, req.version);
      if (!r.ok) return r;
      this.commit({
        type: 'read',
        doc: r.id,
        version: r.version,
        by: req.role,
        purpose: req.purpose ?? 'work',
      });
      return r;
    });
  }
}
