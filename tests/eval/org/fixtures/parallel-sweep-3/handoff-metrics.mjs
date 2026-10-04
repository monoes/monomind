// The hand-off measures of parallel-sweep-3, computed from a finished treatment trial's own files: the store's
// events log and state (<root>/pilot-state/), the synthesis file, the hidden truth and the bus. Plain .mjs so
// that check.mjs (run with node, not a TypeScript runner) can call it. Nothing here reads a role's view.
//
// A "fault" is what the harness's injector recorded (a `fault` event); a decision is the synthesiser's accept
// or reject of one version of one document. Classification of a decision:
//   caught     a reject of a corrupted version (with a reason; the store refuses a reject without one)
//   missed     an accept of a corrupted version
//   undecided  no decision by the synthesiser on a corrupted version (superseded unread, or never decided)
//   false reject   a reject of a version that equals the truth in every sheet
//   natural reject a reject of an uncorrupted version that has an error of the producer's own
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { trialView } from '../../pilot/runtime-view.mjs';
import { deriveSynthesis } from '../parallel-sweep/synthesis.mjs';
import { v2Metrics } from './v2-metrics.mjs';

export const CONSUMER = 'synthesiser';
const N = 32;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
};
const lines = (p) =>
  existsSync(p)
    ? readFileSync(p, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l)];
          } catch {
            return [];
          }
        })
    : [];

/** All four sheets (every answer's value and ordered file list) equal the truth. */
function docCorrect(content, truth) {
  const sheets = content?.sheets;
  if (!Array.isArray(sheets) || sheets.length === 0) return false;
  return sheets.every((s) => {
    const t = truth.modules?.[s?.module];
    const qs = t ? Object.keys(t) : [];
    return (
      qs.length > 0 &&
      Array.isArray(s.answers) &&
      s.answers.length === qs.length &&
      qs.every((q) => {
        const a = s.answers.find((x) => x.q === q);
        return a && a.value === t[q].value && same(a.files, t[q].files);
      })
    );
  });
}

/** The synthesis the truth modules would give with the sheets of each of these documents replaced by their content. */
function poisoned(contents, truth) {
  const modules = structuredClone(truth.modules);
  for (const content of contents)
    for (const s of content?.sheets ?? [])
      modules[s.module] = Object.fromEntries(
        (s.answers ?? []).map((a) => [a.q, { value: a.value, files: a.files }]),
      );
  return deriveSynthesis(modules, { n: N });
}

/** A reason is plausible when it names the changed module or question, or the kind of fault (a heuristic;
 *  the reasons are reported verbatim so a reader can judge them). */
export function reasonPlausible(fault, reason) {
  const r = String(reason ?? '');
  if (!r.trim()) return false;
  const names = [fault.module, ...(fault.qs ?? [])].filter(Boolean);
  if (names.some((n) => new RegExp(`\\b${n}\\b`, 'i').test(r))) return true;
  const kind = {
    'wrong-value-q05': /value|wrong|incorrect|mismatch|recomput|trace|sum/i,
    'wrong-value-q07': /value|wrong|incorrect|mismatch|recomput|trace|sum/i,
    'files-order': /order|revers|entry|first file|sequence|backward/i,
    'duplicate-sheet': /duplicate|copy|copied|identical|same answers|another module|other module/i,
  }[fault.class];
  return !!kind && kind.test(r);
}

function busOf(root) {
  const base = join(root, '.monomind/orgs');
  if (!existsSync(base)) return [];
  for (const org of readdirSync(base)) {
    const runs = existsSync(join(base, org))
      ? readdirSync(join(base, org))
          .filter((d) => d.startsWith('run-'))
          .sort()
      : [];
    if (runs.length) return lines(join(base, org, runs[runs.length - 1], 'bus.jsonl'));
  }
  return [];
}

const tally = () => ({ ok: 0, refused: 0 });

/** The hand-off measures of one trial root; `{ present: false }` when the trial has no hand-off store (baseline). */
export function handoffMetrics({ root, truth }) {
  // The records of whichever hand-off layer ran: the harness store (the default) or the runtime's (the runtime switch).
  const view = trialView(root);
  if (
    view.source === 'none' ||
    (view.source === 'harness' &&
      view.events.length === 0 &&
      Object.keys(view.state.versions ?? {}).length === 0)
  )
    return { present: false };
  const { events, state } = view;
  const bus = busOf(root);
  const t0 = bus.find((e) => typeof e.ts === 'number')?.ts;
  const secs = (iso) =>
    t0 === undefined || !iso ? null : Math.round((Date.parse(iso) - t0) / 100) / 10;

  // calls per role
  const calls = {};
  const docsRead = {};
  const docsDecided = {};
  for (const e of events) {
    if (!['publish', 'read', 'decide'].includes(e.kind)) continue;
    ((calls[e.role] ??= {})[e.kind] ??= tally())[e.ok ? 'ok' : 'refused']++;
    if (e.ok && e.kind === 'read') (docsRead[e.role] ??= new Set()).add(e.doc);
    if (e.ok && e.kind === 'decide') (docsDecided[e.role] ??= new Set()).add(e.doc);
  }
  const synthFile = join(root, 'workspace/out/synthesis.json');
  const synthesis = readJson(synthFile);
  const synthAt = existsSync(synthFile) ? statSync(synthFile).mtimeMs : undefined;
  const synthAnswer = (q) => synthesis?.answers?.find((a) => a.q === q)?.value;
  const truthSynthesis = deriveSynthesis(truth.modules, { n: N });

  const faultEvents = events
    .filter((e) => e.kind === 'fault')
    .map((e) => ({ doc: e.doc, version: e.version, ...JSON.parse(e.detail ?? '{}') }));
  const injected = new Set(faultEvents.map((f) => `${f.doc}#${f.version}`));
  const versionOf = (doc, v) => (state.versions[doc] ?? []).find((x) => x.version === v);

  const outcomeOf = (f) => {
    const d = versionOf(f.doc, f.version)?.decisions?.[CONSUMER];
    return !d ? 'undecided' : d.decision === 'reject' ? 'caught' : 'missed';
  };
  const contentOf = (f) => versionOf(f.doc, f.version)?.content;
  // What the synthesis would say if it were built from the corrupted documents in play (accepted or never
  // decided) and, to see a rejected one used anyway, from every corrupted document. Exact-match attribution:
  // an answer that mixes in some other error matches neither and shows only as synthesis_exact false.
  const inPlay = poisoned(
    faultEvents.filter((f) => outcomeOf(f) !== 'caught').map(contentOf),
    truth,
  );
  const everything = poisoned(faultEvents.map(contentOf), truth);

  const faults = faultEvents.map((f) => {
    const v = versionOf(f.doc, f.version);
    const d = v?.decisions?.[CONSUMER];
    const p = poisoned([contentOf(f)], truth);
    const affects = Object.keys(truthSynthesis).filter((k) => !same(p[k], truthSynthesis[k]));
    const outcome = outcomeOf(f);
    const against = outcome === 'caught' ? everything : inPlay;
    const used =
      synthesis !== undefined &&
      affects.some(
        (k) => !same(synthAnswer(k), truthSynthesis[k]) && same(synthAnswer(k), against[k]),
      );
    return {
      doc: f.doc,
      version: f.version,
      class: f.class,
      module: f.module,
      changed: f.changed,
      outcome,
      status: v?.status,
      reason: d?.reason ?? null,
      reason_plausible: outcome === 'caught' ? reasonPlausible(f, d?.reason) : null,
      affects,
      used_in_synthesis: used,
      republished: (state.versions[f.doc] ?? []).some((x) => x.version > f.version),
      decided_after_s: d ? secs(d.at) : null,
    };
  });

  let falseRejects = 0;
  let naturalRejects = 0;
  let acceptedNatural = 0;
  const docs = {};
  for (const [doc, versions] of Object.entries(state.versions)) {
    const final = [...versions].reverse().find((v) => v.status === 'accepted');
    docs[doc] = {
      versions: versions.length,
      final_accepted_version: final?.version ?? null,
      final_accepted_correct: final ? docCorrect(final.content, truth) : null,
      final_accepted_corrupted: final ? injected.has(`${doc}#${final.version}`) : null,
      natural_errors: versions
        .filter((v) => !docCorrect(state.originals?.[`${doc}#${v.version}`] ?? v.content, truth))
        .map((v) => v.version),
    };
    for (const v of versions) {
      if (injected.has(`${doc}#${v.version}`)) continue;
      const d = v.decisions?.[CONSUMER];
      if (d?.decision === 'reject')
        docCorrect(v.content, truth) ? falseRejects++ : naturalRejects++;
      if (d?.decision === 'accept' && !docCorrect(v.content, truth)) acceptedNatural++;
    }
  }
  const publishes = events.filter((e) => e.kind === 'publish' && e.ok);
  const docIds = Object.keys(state.versions);
  const publishedCount = (doc) => publishes.filter((e) => e.doc === doc).length;
  const decisionTimes = events.filter((e) => e.kind === 'decide' && e.ok && e.role === CONSUMER);
  const reads = events.filter((e) => e.kind === 'read' && e.ok && e.role === CONSUMER);
  const undecidedAtSynthesis =
    synthAt === undefined
      ? null
      : docIds.filter(
          (doc) =>
            !(state.versions[doc] ?? []).some(
              (v) =>
                v.decisions?.[CONSUMER]?.decision === 'accept' &&
                // file times lag the clock by a few ms: 50 ms of slack
                Date.parse(v.decisions[CONSUMER].at) <= synthAt + 50,
            ),
        );

  const cost = {};
  for (const e of bus)
    if (e.type === 'usage' && typeof e.data?.cost_usd === 'number')
      cost[e.from] = (cost[e.from] ?? 0) + e.data.cost_usd;
  const sum = (pick) => Object.entries(cost).reduce((a, [r, c]) => a + (pick(r) ? c : 0), 0);
  const round = (x) => Math.round(x * 1000) / 1000;

  const caught = faults.filter((f) => f.outcome === 'caught');
  return annotate(view, {
    present: true,
    injected: faults.length,
    caught: caught.length,
    caught_plausible_reason: caught.filter((f) => f.reason_plausible).length,
    missed: faults.filter((f) => f.outcome === 'missed').length,
    undecided: faults.filter((f) => f.outcome === 'undecided').length,
    false_rejects: falseRejects,
    rejects_of_natural_errors: naturalRejects,
    accepted_natural_errors: acceptedNatural,
    faults,
    v2: v2Metrics(events, faultEvents, CONSUMER),
    // P4.13: the counts the Phase 4 keys' records give, present only when the runtime left such records
    ...(view.phase4 ? { phase4: view.phase4 } : {}),
    calls,
    docs_read: Object.fromEntries(Object.entries(docsRead).map(([r, s]) => [r, [...s].sort()])),
    docs_decided: Object.fromEntries(
      Object.entries(docsDecided).map(([r, s]) => [r, [...s].sort()]),
    ),
    republish_cycles: docIds.reduce((a, d) => a + Math.max(0, publishedCount(d) - 1), 0),
    republished_after_reject: faults.filter((f) => f.outcome === 'caught' && f.republished).length,
    docs,
    final_accepted_docs: Object.values(docs).filter((d) => d.final_accepted_version !== null)
      .length,
    final_accepted_correct: Object.values(docs).filter((d) => d.final_accepted_correct === true)
      .length,
    final_accepted_corrupted: Object.values(docs).filter((d) => d.final_accepted_corrupted === true)
      .length,
    synthesis_written: synthesis !== undefined,
    synthesis_exact:
      synthesis !== undefined &&
      Object.keys(truthSynthesis).every((k) => same(synthAnswer(k), truthSynthesis[k])),
    synthesis_used_corrupted: faults.some((f) => f.used_in_synthesis),
    synthesis_used_rejected: faults.some((f) => f.used_in_synthesis && f.status === 'rejected'),
    docs_without_accept_at_synthesis: undecidedAtSynthesis,
    seconds: {
      first_read: secs(reads[0]?.at),
      first_decide: secs(decisionTimes[0]?.at),
      last_decide: secs(decisionTimes.at(-1)?.at),
      last_publish: secs(publishes.at(-1)?.at),
      synthesis_file:
        t0 === undefined || synthAt === undefined ? null : Math.round((synthAt - t0) / 100) / 10,
    },
    cost_usd: {
      workers: round(sum((r) => r.startsWith('worker-'))),
      lead: round(sum((r) => r === 'lead')),
      synthesiser: round(sum((r) => r === CONSUMER)),
      total: round(sum(() => true)),
    },
  });
}

/** The layer that produced these records is named in the metrics; a runtime trial has no harness fault record (the runtime
 *  has no injector), so every measure that needs one is null ("n/a"), never zero, unless a test-only fault record was supplied. */
function annotate(view, m) {
  if (view.source !== 'runtime') return m;
  const out = { ...m, handoff_layer: 'runtime' };
  if (view.faultRecord) return out;
  const na = [
    'injected',
    'caught',
    'caught_plausible_reason',
    'missed',
    'undecided',
    'republished_after_reject',
    'final_accepted_corrupted',
    'synthesis_used_corrupted',
    'synthesis_used_rejected',
  ];
  for (const k of na) out[k] = null;
  out.faults = [];
  out.fault_record = 'n/a: the runtime has no fault injector';
  out.v2 = {
    ...out.v2,
    doc_check: {
      ...out.v2.doc_check,
      faults_flagged: null,
      faults_checked_unflagged: null,
      faults_never_checked: null,
    },
  };
  out.docs = Object.fromEntries(
    Object.entries(out.docs).map(([d, x]) => [d, { ...x, final_accepted_corrupted: null }]),
  );
  return out;
}
