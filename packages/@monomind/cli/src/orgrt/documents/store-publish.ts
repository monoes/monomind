// orgrt/documents/store-publish.ts
//
// Publish (org sections spec 6.2, 6.3, 13.1.2): the order of the checks is part of the contract. Cheap identity
// checks first, then the idempotency key (a retry returns the committed receipt even after the cap is used up),
// then the producer and the caps, then the compare-and-set on `supersedes`, then the content (size, schema,
// evidence, inputs, all reasons at once, counted against the attempt cap), then the guards, then the commit:
// body durable first, event second.
import { canonicalJson } from './canonical.js';
import { writeFileDurable } from './durable-fs.js';
import type { DocError } from './errors.js';
import { sha256 } from './events.js';
import { type DocRecord, versionStatus } from './state.js';
import {
  fail,
  KEY_REFUSAL,
  own,
  problemText,
  ROLE_REFUSAL,
  type StoreCtx,
  validKey,
  validRole,
} from './store-common.js';
import type { PublishReceipt, PublishRequest, Refusal } from './store-types.js';
import { contentProblems, DOC_REF, MAX_NOTE_CHARS } from './store-validate.js';

export function doPublish(ctx: StoreCtx, req: PublishRequest): PublishReceipt | Refusal {
  if (!validRole(req.role)) return ROLE_REFUSAL();
  if (!validKey(req.idempotency_key)) return KEY_REFUSAL();
  const note = req.note?.trim() ? req.note.trim().slice(0, MAX_NOTE_CHARS) : undefined;
  let sha: string;
  try {
    sha = sha256(
      canonicalJson({
        type: req.type,
        body: req.body,
        supersedes: req.supersedes ?? null,
        evidence: req.evidence ?? null,
        inputs: req.inputs ?? null,
        note: note ?? null,
      }),
    );
  } catch (err) {
    return fail('BODY_NOT_JSON', `the document is not JSON data: ${(err as DocError).message}`);
  }
  const op = `publish:${req.role}:${req.idempotency_key}`;
  const prior = own(ctx.state.idem, op);
  if (prior) {
    if (prior.sha !== sha)
      return fail(
        'IDEMPOTENCY_CONFLICT',
        `idempotency_key "${req.idempotency_key}" was already used for a different publish`,
      );
    const d = ctx.state.docs[prior.doc];
    const v = d.versions[prior.version - 1];
    return {
      ok: true,
      ref: `${d.id}@v${v.version}`,
      id: d.id,
      version: v.version,
      status: versionStatus(d, v),
      contract_revision: v.contract_revision,
      ...(v.supersedes !== undefined ? { supersedes: `${d.id}@v${v.supersedes}` } : {}),
      seq: prior.seq,
      replayed: true,
    };
  }
  const x = ctx.bound.get(req.type);
  if (!x)
    return fail(
      'UNKNOWN_TYPE',
      `unknown document type "${String(req.type)}"; known: ${[...ctx.bound.keys()].join(', ')}`,
    );
  const type = x.contract.type;
  if (!x.binding.producers.includes(req.role))
    return fail(
      'NOT_PRODUCER',
      `only ${x.binding.producers.join(', ')} publish${x.binding.producers.length === 1 ? 'es' : ''} "${type}"`,
    );
  const a = ctx.attempts(type) as NonNullable<ReturnType<StoreCtx['attempts']>>;
  if (a.left === 0)
    return fail(
      'PUBLISH_EXHAUSTED',
      `${x.contract.max_publish_attempts} publish attempts for "${type}" are used; report the blocker to your lead instead of publishing again`,
      { attempts_left: 0 },
    );
  if (a.refusals_left === 0)
    return fail(
      'CONSISTENCY_EXHAUSTED',
      `${x.contract.max_consistency_refusals} publishes of "${type}" were refused for disagreeing with your files; report the blocker to your lead instead of publishing again`,
      { refusals_left: 0 },
    );

  let doc: DocRecord | undefined;
  let supersedes: number | undefined;
  if (req.supersedes !== undefined) {
    const m = typeof req.supersedes === 'string' ? DOC_REF.exec(req.supersedes) : null;
    doc = m ? own(ctx.state.docs, m[1]) : undefined;
    if (!m || !doc || doc.type !== type)
      return fail(
        'SUPERSEDES_INVALID',
        `supersedes "${String(req.supersedes)}" is not a version of a "${type}" document`,
      );
    if (Number(m[2]) !== doc.versions.length)
      return fail(
        'SUPERSEDES_CONFLICT',
        `${req.supersedes} is not the current head: it is ${doc.id}@v${doc.versions.length}; revise that version`,
        { head: `${doc.id}@v${doc.versions.length}` },
      );
    const bad = ctx.badBodies.get(req.supersedes);
    if (bad)
      return fail(bad, `the head ${req.supersedes} has a committed event but no usable body`);
    supersedes = doc.versions.length;
    for (const g of ctx.guards) {
      const r = g.revise?.({ type, role: req.role, doc: doc.id, version: doc.versions.length + 1 });
      if (r) return fail('GUARD_REFUSED', r.message, { guard_code: r.code });
    }
  }
  const id = doc ? doc.id : `${type}-${(own(ctx.state.types, type)?.docs ?? 0) + 1}`;
  const version = doc ? doc.versions.length + 1 : 1;
  const file = JSON.stringify({
    id,
    version,
    type,
    section: x.binding.section,
    producer: req.role,
    contract_revision: x.revision,
    run: ctx.run,
    ...(supersedes !== undefined ? { supersedes: `${id}@v${supersedes}` } : {}),
    evidence: req.evidence ?? [],
    inputs: req.inputs ?? [],
    ...(note !== undefined ? { note } : {}),
    body: req.body,
  });
  const bytes = Buffer.byteLength(file);
  const at = doc ? { doc: doc.id, version } : {};
  if (bytes > x.contract.max_bytes) {
    const p = [
      {
        code: 'VALUE_TOO_LONG',
        path: '$',
        message: `${bytes} bytes, over the ${x.contract.max_bytes} limit`,
      },
    ];
    return ctx.counted(
      'publish',
      req.role,
      x,
      'TOO_LARGE',
      `"${type}" is ${bytes} bytes, over the ${x.contract.max_bytes} byte limit, so it was not published.`,
      'attempt',
      p,
      at,
    );
  }
  const problems = contentProblems(x.contract, req);
  if (problems.length)
    return ctx.counted(
      'publish',
      req.role,
      x,
      'CONTENT_INVALID',
      `"${type}" does not match its contract: ${problems.map(problemText).join('; ')}.`,
      'attempt',
      problems,
      at,
    );
  for (const g of ctx.guards) {
    const r = g.publish?.({
      type,
      role: req.role,
      section: x.binding.section,
      contract: x.contract,
      body: req.body,
      doc: doc?.id,
      version,
      ...(req.inputs !== undefined ? { inputs: req.inputs } : {}),
    });
    if (!r) continue;
    const pv = r.problems?.map((m) => ({ code: r.code, path: '$', message: m }));
    if (r.counts)
      return ctx.counted(
        'publish',
        req.role,
        x,
        'GUARD_REFUSED',
        r.message,
        r.counts,
        pv,
        at,
        r.code,
      );
    return fail('GUARD_REFUSED', r.message, {
      ...(pv ? { problems: pv } : {}),
      guard_code: r.code,
    });
  }
  writeFileDurable(ctx.bodyPath({ section: x.binding.section, type, id }, version), file);
  const ev = ctx.commit({
    type: 'published',
    op,
    doc: id,
    doc_type: type,
    section: x.binding.section,
    version,
    by: req.role,
    payload_sha256: sha,
    contract_revision: x.revision,
    body_sha256: sha256(file),
    bytes,
    ...(supersedes !== undefined ? { supersedes } : {}),
    ...(note !== undefined ? { note } : {}),
    consumers: x.binding.consumers.map((c) => c.id),
  });
  return {
    ok: true,
    ref: `${id}@v${version}`,
    id,
    version,
    status: 'pending',
    contract_revision: x.revision,
    ...(supersedes !== undefined ? { supersedes: `${id}@v${supersedes}` } : {}),
    seq: ev.seq,
  };
}
