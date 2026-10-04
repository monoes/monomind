// P3.15: what a finished pilot trial's hand-off layer left behind, in ONE shape, whichever layer ran.
//   harness  <root>/pilot-state/pilot-events.jsonl + pilot-store.json (the prototype, HandoffStore)
//   runtime  <root>/.monomind/orgs/<org>/docs/<run>/ events.jsonl (the event-sourced store, hash-chained), notices.jsonl
//            (the notice and relay delivery journal), checks.jsonl (org_doc_check calls) and the bus's cross-section
//            refusals: the real `orgrt/documents` tools, the runtime switch (`::v2r`, see runtime-switch.mjs)
// `trialView(root)` returns {source, events, state, faultRecord}: `events` and `state.versions` have the shape of the
// prototype's, so report.ts, handoff-metrics.mjs (and the v2 measures) and stage-gate.mjs read either unchanged.
// P4.13: a runtime trial whose org used the Phase 4 keys also has `phase4` (counts, see phase4Of; absent when no such record
// exists). An exhaustion notice (rework cap, loop) is an `escalation` event, not a `relay`: the relay counts do not move.
// Plain .mjs: smoke/check.mjs runs it with node, not a TypeScript runner. Read-only; nothing here touches a role's view.
//
// What the runtime does not record, and so the view cannot show (every one is also a row of the parity table in
// handoff-runtime-mode.test.ts): a refused read or check (only counted publish/decide refusals are events), the
// harness's fault events (the runtime has no injector: `faultRecord` is true only when a test-only
// <root>/pilot-state/faults.jsonl of harness-style `fault` events is supplied), and the contract title. A document is
// keyed by its TYPE (the prototype's doc id = the contract id; the runtime's ids are <type>-<n>); a type with several
// documents falls back to the document id for those.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const lines = (p) =>
  existsSync(p)
    ? readFileSync(p, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l)];
          } catch {
            return []; // a torn final line
          }
        })
    : [];

/** `<root>/.monomind/orgs/<org>` of the (single) org of a trial, or undefined. */
function orgDirOf(root) {
  const base = join(root, '.monomind/orgs');
  if (!existsSync(base)) return undefined;
  const dirs = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(base, d.name));
  return dirs.find((d) => existsSync(join(d, 'docs'))) ?? dirs[0];
}

/** The runtime store's directory of a trial (the latest run's), or undefined when the trial ran no documents runtime. */
export function runtimeDocsDir(root) {
  const org = orgDirOf(root);
  const docs = org && join(org, 'docs');
  if (!docs || !existsSync(docs)) return undefined;
  const runs = readdirSync(docs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(docs, d.name, 'events.jsonl')))
    .map((d) => d.name)
    .sort();
  return runs.length ? join(docs, runs.at(-1)) : undefined;
}

const FILE = /[\w./-]+\.json/;
/** A version still pending when a later one exists is superseded (as the prototype's publish marks it); accepted and rejected stay. */
const status = (rec, later) =>
  !rec.status || rec.status === 'pending' ? (later ? 'superseded' : 'pending') : rec.status;

function runtimeView(root, dir) {
  const log = lines(join(dir, 'events.jsonl'));
  const published = log.filter((e) => e.type === 'published');
  const typeOfId = new Map(published.map((e) => [e.doc, e.doc_type]));
  const perType = new Map();
  for (const [id, type] of typeOfId) perType.set(type, [...(perType.get(type) ?? []), id]);
  const key = (idOrType) => {
    const type = typeOfId.get(idOrType) ?? idOrType;
    return (perType.get(type)?.length ?? 0) > 1 ? idOrType : type;
  };
  const bySeq = new Map(log.map((e) => [e.seq, e]));

  const events = [];
  const versions = {};
  for (const e of log) {
    if (e.type === 'published') {
      const doc = key(e.doc);
      let content;
      try {
        content = JSON.parse(
          readFileSync(join(dir, e.section, e.doc_type, `${e.doc}@v${e.version}.json`), 'utf8'),
        ).body; // the file is {body, evidence, inputs, note}
      } catch {
        content = undefined; // a missing body: the metrics treat the version as having no content
      }
      (versions[doc] ??= []).push({
        version: e.version,
        at: e.at,
        by: e.by,
        content,
        ...(e.note ? { note: e.note } : {}),
        status: undefined,
        decisions: {},
      });
      events.push({ kind: 'publish', at: e.at, ok: true, role: e.by, doc, version: e.version });
    } else if (e.type === 'read') {
      events.push({
        kind: 'read',
        at: e.at,
        ok: true,
        role: e.by,
        doc: key(e.doc),
        version: e.version,
      });
    } else if (e.type === 'decided') {
      const v = versions[key(e.doc)]?.find((x) => x.version === e.version);
      if (v) {
        v.decisions[e.by] = {
          decision: e.decision,
          ...(e.reason ? { reason: e.reason } : {}),
          at: e.at,
        };
        v.status = e.status_after;
      }
      events.push({
        kind: 'decide',
        at: e.at,
        ok: true,
        role: e.by,
        doc: key(e.doc),
        version: e.version,
        detail: e.decision,
      });
    } else if (e.type === 'refused') {
      const consistency = e.counts === 'consistency';
      const reason = (e.reasons ?? []).join('; ');
      events.push({
        kind: e.op,
        at: e.at,
        ok: false,
        role: e.by,
        doc: key(e.doc ?? e.doc_type),
        ...(e.version !== undefined ? { version: e.version } : {}),
        detail: `${consistency ? 'consistency: ' : ''}${e.code}${reason ? `: ${reason}` : ''}`,
        ...(consistency
          ? {
              file: [
                ...new Set((e.reasons ?? []).map((r) => FILE.exec(r)?.[0]).filter(Boolean)),
              ].join(', '),
            }
          : {}),
      });
    }
  }
  for (const list of Object.values(versions))
    list.forEach((v, i) => {
      v.status = status(v, i < list.length - 1);
    });

  for (const r of lines(join(dir, 'checks.jsonl'))) {
    const ref = /^(.*)@v(\d+)$/.exec(r.ref ?? '');
    events.push({
      kind: 'check',
      at: r.at,
      ok: r.ok === true,
      role: r.by,
      ...(r.type ? { doc: key(ref?.[1] ?? r.type) } : {}),
      ...(ref ? { version: Number(ref[2]) } : {}),
      ...(r.ok
        ? {
            detail: JSON.stringify({
              answers: r.answers,
              flagged: (r.flagged ?? 0) + (r.doc_failures ?? 0),
              // the prototype's by_check lists the checks that failed; the journal lists every declared check, zeros included
              by_check: Object.fromEntries(
                Object.entries(r.per_check ?? {}).filter(([, n]) => n > 0),
              ),
            }),
          }
        : { detail: r.code }),
    });
  }

  const owed = new Map();
  const seen = new Set();
  // An accept the runtime refused because the producer's files changed commits no event (a refusal of the guard is no
  // counted refusal); the relay obligation journalled at that moment is its only trace, so one refused accept is read from it
  // (the decider and the files from the relay text).
  for (const o of lines(join(dir, 'notices.jsonl')))
    if (o.t === 'owed' && o.kind === 'deliverable-changed' && o.audience === 'producer')
      events.push({
        kind: 'decide',
        at: o.at,
        ok: false,
        role: /accepted by (\S+) \(/.exec(o.body)?.[1] ?? 'unknown',
        doc: key(o.doc),
        version: o.version,
        detail: 'consistency: DELIVERABLE_CHANGED',
        file: /published it: (.*?)\. First difference/.exec(o.body)?.[1] ?? '',
      });
  const journal = lines(join(dir, 'notices.jsonl'));
  for (const j of journal) if (j.t === 'owed') owed.set(j.key, j);
  for (const j of journal) {
    if (j.t === 'owed' || (j.t === 'delivered' && (j.again || seen.has(j.key)))) continue;
    if (j.t === 'delivered') seen.add(j.key);
    const ok = j.t === 'delivered';
    const base = { at: j.at, ok, role: 'org-docs' };
    const err = ok ? {} : { error: j.error };
    const parts = j.key.split(':');
    if (parts[0] === 'p' || parts[0] === 'a') {
      const pub = bySeq.get(Number(parts[1]));
      events.push({
        kind: 'notice',
        ...base,
        ...(pub?.doc ? { doc: key(pub.doc), version: pub.version } : {}),
        detail: JSON.stringify({
          to: parts[0] === 'p' ? parts[2] : parts[1],
          kind: parts[0] === 'p' ? 'published' : 'all-available',
          ...err,
        }),
      });
    } else if (parts[0] === 'x' || parts[0] === 'l') {
      // P4.13: a spent rework cap (x) or loop (l) escalation, to the root and the leads involved: not a producer relay
      events.push({
        kind: 'escalation',
        ...base,
        detail: JSON.stringify({
          kind: parts[0] === 'x' ? 'rework-exhausted' : 'loop-exhausted',
          to: j.key.slice(j.key.lastIndexOf(':') + 1),
          ...err,
        }),
      });
    } else {
      const o = owed.get(j.key);
      const dec = bySeq.get(Number(parts[1]));
      const audience = parts.at(-1);
      events.push({
        kind: 'relay',
        ...base,
        doc: key(o?.doc ?? dec?.doc),
        version: o?.version ?? dec?.version,
        detail: JSON.stringify({
          ...(o?.to ? { to: o.to } : {}),
          to_kind: audience,
          reason: o ? o.kind : 'rejected',
          ...(dec?.by ? { by: dec.by } : {}),
          ...err,
        }),
      });
    }
  }

  const org = orgDirOf(root);
  const runs = org
    ? readdirSync(org)
        .filter((d) => d.startsWith('run-'))
        .sort()
    : [];
  const bus = runs.length ? lines(join(org, runs.at(-1), 'bus.jsonl')) : [];
  for (const b of bus)
    if (b.reason === 'cross-section-refused')
      events.push({
        kind: 'send-refused',
        at: new Date(b.ts ?? 0).toISOString(),
        ok: false,
        role: b.from,
        detail: `to ${b.to}`,
      });

  const faults = lines(join(root, 'pilot-state/faults.jsonl'));
  events.push(...faults);
  events.sort((a, b) => String(a.at).localeCompare(String(b.at))); // stable: ties keep the source order
  const phase4 = phase4Of(dir, journal, bus);
  return {
    source: 'runtime',
    events,
    state: { versions },
    faultRecord: faults.length > 0,
    ...(phase4 ? { phase4 } : {}),
  };
}

/** P4.13: what the Phase 4 keys left, as counts: the section budget notice journal, the exhaustion notices in the delivery
 *  journal, the part-read journal and the bus audit events of the single writer, the unread watch and lead-watch. A family is
 *  present only when its records exist; with none of them there is no block at all (a Phase 3 trial reads as it always did). */
function phase4Of(dir, journal, bus) {
  const p = {};
  const budget = lines(join(dir, 'budget-notices.jsonl'));
  const owed = budget.filter((r) => r.t === 'owed');
  const keysOf = (rows) => new Set(rows.map((r) => r.key));
  const delivered = keysOf(budget.filter((r) => r.t === 'delivered'));
  const failed = [...keysOf(budget.filter((r) => r.t === 'failed'))].filter(
    (k) => !delivered.has(k),
  );
  if (owed.length || delivered.size || failed.length)
    p.budget_notices = {
      warnings: new Set(owed.filter((o) => o.kind === 'section-budget-warning').map((o) => o.doc))
        .size,
      closures: new Set(owed.filter((o) => o.kind === 'section-budget-closed').map((o) => o.doc))
        .size,
      delivered: delivered.size,
      failed: failed.length,
    };
  const exhausted = (prefix) => {
    const ks = [...keysOf(journal.filter((j) => j.key?.startsWith(`${prefix}:`)))];
    return { ks, groups: new Set(ks.map((k) => k.slice(0, k.lastIndexOf(':')))).size };
  };
  const rework = exhausted('x');
  if (rework.ks.length) p.rework_exhausted = { cycles: rework.groups, notices: rework.ks.length };
  const loop = exhausted('l');
  if (loop.ks.length) p.loop_exhausted = { loops: loop.groups, notices: loop.ks.length };
  const parts = lines(join(dir, 'part-reads.jsonl')).filter(
    (r) => typeof r.by === 'string' && typeof r.doc === 'string',
  );
  if (parts.length)
    p.part_reads = { calls: parts.length, documents: new Set(parts.map((r) => r.doc)).size };
  const audit = (reason) => bus.filter((b) => b.reason === reason);
  const refused = audit('writer-refused');
  if (refused.length) {
    const by_role = {};
    for (const b of refused) by_role[b.from] = (by_role[b.from] ?? 0) + 1;
    p.writer_refused = { total: refused.length, by_role };
  }
  const unread = audit('doc-unread');
  if (unread.length) p.doc_unread = unread.length;
  const lead = audit('lead-watch');
  if (lead.length)
    p.lead_notices = {
      total: lead.length,
      silent: lead.filter((b) => b.data?.kind === 'silent').length,
      not_started: lead.filter((b) => b.data?.kind === 'not-started').length,
    };
  return Object.keys(p).length ? p : undefined;
}

/** The hand-off records of a trial root, whichever layer ran. `{source: 'none'}` when it ran neither (a baseline trial). */
export function trialView(root) {
  const stateDir = join(root, 'pilot-state');
  const eventsFile = join(stateDir, 'pilot-events.jsonl');
  const storeFile = join(stateDir, 'pilot-store.json');
  if (existsSync(storeFile) || lines(eventsFile).length > 0) {
    let state = { versions: {} };
    try {
      state = JSON.parse(readFileSync(storeFile, 'utf8'));
    } catch {
      /* no store file: an events-only trial */
    }
    return { source: 'harness', events: lines(eventsFile), state, faultRecord: true };
  }
  const dir = runtimeDocsDir(root);
  return dir
    ? runtimeView(root, dir)
    : { source: 'none', events: [], state: { versions: {} }, faultRecord: false };
}
