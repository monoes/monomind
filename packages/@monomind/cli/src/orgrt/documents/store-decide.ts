// orgrt/documents/store-decide.ts
//
// Decide (org sections spec 6.7, 6.2 mutation conflict rules). Acceptance is per consuming section: the calling
// role is resolved to the section it decides for (only declared deciders may), the decision applies to one
// pinned version, an identical repeat is a no-op, a reversal is refused (a rejection is repaired with a new
// version), a superseded version cannot be decided, and a rejection needs a reason. The idempotency table is
// checked first so a retry of a committed decision returns its receipt.
import { canonicalJson } from './canonical.js';
import { sha256 } from './events.js';
import { headOf, versionStatus, waitingOn } from './state.js';
import {
  fail,
  KEY_REFUSAL,
  own,
  ROLE_REFUSAL,
  type StoreCtx,
  validKey,
  validRole,
} from './store-common.js';
import type { DecideReceipt, DecideRequest, Refusal } from './store-types.js';

export function doDecide(ctx: StoreCtx, req: DecideRequest): DecideReceipt | Refusal {
  if (!validRole(req.role)) return ROLE_REFUSAL();
  if (!validKey(req.idempotency_key)) return KEY_REFUSAL();
  const d = own(ctx.state.docs, String(req.id));
  if (!d) return fail('UNKNOWN_DOCUMENT', `unknown document "${String(req.id)}"`);
  const v = Number.isInteger(req.version) ? d.versions[req.version - 1] : undefined;
  if (!v) return fail('UNKNOWN_VERSION', `no version ${String(req.version)} of "${d.id}"`);
  const x = ctx.bound.get(d.type);
  if (!x) return fail('UNKNOWN_TYPE', `document type "${d.type}" is not declared in this run`);
  const mine = x.binding.consumers.filter(
    (c) => c.deciders.includes(req.role) && v.consumers.includes(c.id),
  );
  const pick = req.consumer === undefined ? mine : mine.filter((c) => c.id === req.consumer);
  if (!pick.length)
    return fail(
      'NOT_DECIDER',
      `${req.role} is not a decision maker for "${d.type}"${req.consumer ? ` of ${req.consumer}` : ''}`,
    );
  if (pick.length > 1)
    return fail(
      'CONSUMER_AMBIGUOUS',
      `${req.role} decides for ${pick.map((c) => c.id).join(', ')}: name the consumer`,
    );
  const consumer = pick[0].id;
  const reason = req.reason?.trim() ? req.reason : undefined;
  const sha = sha256(
    canonicalJson({
      doc: d.id,
      version: v.version,
      consumer,
      decision: req.decision,
      reason: reason ?? null,
    }),
  );
  const op = `decide:${req.role}:${req.idempotency_key}`;
  const base = {
    ok: true,
    id: d.id,
    version: v.version,
    consumer,
    decision: req.decision,
  } as const;
  const prior = own(ctx.state.idem, op);
  if (prior) {
    if (prior.sha !== sha)
      return fail(
        'IDEMPOTENCY_CONFLICT',
        `idempotency_key "${req.idempotency_key}" was already used for a different decision`,
      );
    return {
      ...base,
      status: prior.status as DecideReceipt['status'],
      waiting_on: prior.waiting_on ?? [],
      seq: prior.seq,
      replayed: true,
    };
  }
  if (req.decision !== 'accept' && req.decision !== 'reject')
    return fail('DECISION_INVALID', 'decision must be accept or reject');
  const standing = v.decisions[consumer];
  if (standing) {
    if (standing.decision === req.decision)
      return {
        ...base,
        status: versionStatus(d, v),
        waiting_on: waitingOn(d, v),
        seq: standing.seq,
        noop: true,
      };
    return fail(
      'REVERSAL_REFUSED',
      `${consumer} already ${standing.decision}ed version ${v.version}; publish a revision instead`,
    );
  }
  const status = versionStatus(d, v);
  if (status === 'superseded')
    return fail(
      'SUPERSEDED',
      `version ${v.version} is superseded by version ${headOf(d).version}; decide on version ${headOf(d).version}`,
    );
  if (status !== 'pending')
    return fail('VERSION_CLOSED', `version ${v.version} is already ${status}`);
  if (req.decision === 'reject' && !reason)
    return fail('REASON_REQUIRED', 'a rejection needs a reason');
  if (req.expected_state_seq !== undefined && req.expected_state_seq !== d.last_seq)
    return fail(
      'STATE_SEQ_CONFLICT',
      `"${d.id}" changed since sequence ${req.expected_state_seq}: its state sequence is ${d.last_seq}; read it again`,
    );
  const read = ctx.peek(d.id, v.version);
  if (!read.ok) return read;
  for (const g of ctx.guards) {
    const r = g.decide?.({
      type: d.type,
      role: req.role,
      doc: d.id,
      version: v.version,
      consumer,
      decision: req.decision,
      contract: x.contract,
      body: read.body,
    });
    if (!r) continue;
    const pv = r.problems?.map((m) => ({ code: r.code, path: '$', message: m }));
    const at = { doc: d.id, version: v.version };
    if (r.counts)
      return ctx.counted(
        'decide',
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
  const others = v.consumers.filter((c) => c !== consumer);
  const after =
    req.decision === 'reject'
      ? 'rejected'
      : others.every((c) => v.decisions[c]?.decision === 'accept')
        ? 'accepted'
        : 'pending';
  const waiting = after === 'pending' ? others.filter((c) => !v.decisions[c]) : [];
  const ev = ctx.commit({
    type: 'decided',
    op,
    doc: d.id,
    version: v.version,
    consumer,
    by: req.role,
    decision: req.decision,
    ...(reason !== undefined ? { reason } : {}),
    payload_sha256: sha,
    contract_revision: v.contract_revision,
    status_after: after,
    waiting_on: waiting,
  });
  return { ...base, status: after, waiting_on: waiting, seq: ev.seq };
}
