// The measures of parallel-sweep-3's variant v2 (declared change handoff-relay-consistency-check), computed from the
// store's event log: how often doc_check was called and what it flagged, the publishes refused for disagreeing with a
// deliverable file (and the files named), the accepts refused because a file changed after the publish, and the
// messages the producer relay sent. Called by handoff-metrics.mjs; on a v1 trial (no such events) every count is 0.
const parse = (s) => {
  try {
    return JSON.parse(s ?? '{}');
  } catch {
    return {};
  }
};
const files = (events) =>
  [
    ...new Set(
      events.flatMap((e) =>
        String(e.file ?? '')
          .split(', ')
          .filter(Boolean),
      ),
    ),
  ].sort();
const consistency = (e) => String(e.detail ?? '').startsWith('consistency:');

/** `faultEvents`: the injector's records as handoff-metrics builds them ({ doc, version, ... }). */
export function v2Metrics(events, faultEvents, consumer) {
  const checks = events.filter((e) => e.kind === 'check');
  const okChecks = checks.filter((e) => e.ok);
  const detail = okChecks.map((e) => ({ e, d: parse(e.detail) }));
  const byCheck = {};
  for (const { d } of detail)
    for (const [k, n] of Object.entries(d.by_check ?? {})) byCheck[k] = (byCheck[k] ?? 0) + n;
  const flaggedOn = (doc, version) =>
    detail.some(({ e, d }) => e.doc === doc && e.version === version && (d.flagged ?? 0) > 0);
  const checkedOn = (doc, version) => okChecks.some((e) => e.doc === doc && e.version === version);
  const refusedPublish = events.filter((e) => e.kind === 'publish' && !e.ok && consistency(e));
  const refusedAccept = events.filter((e) => e.kind === 'decide' && !e.ok && consistency(e));
  const relays = events.filter((e) => e.kind === 'relay').map((e) => ({ e, d: parse(e.detail) }));
  const sent = relays.filter(({ e }) => e.ok);
  return {
    doc_check: {
      calls: okChecks.length,
      refused: checks.length - okChecks.length,
      by_consumer: okChecks.filter((e) => e.role === consumer).length,
      docs_checked: [...new Set(okChecks.map((e) => e.doc))].sort(),
      /** Answers named by a call, summed over calls (a re-check of a version counts again) and, for doc-level failures, sheets. */
      flagged_answers: detail.reduce((a, { d }) => a + (d.flagged ?? 0), 0),
      flagged_by_check: byCheck,
      versions_flagged: [
        ...new Set(
          detail.filter(({ d }) => (d.flagged ?? 0) > 0).map(({ e }) => `${e.doc}#${e.version}`),
        ),
      ].sort(),
      /** Injected faults whose version doc_check flagged, and those it was run on without flagging anything. */
      faults_flagged: faultEvents.filter((f) => flaggedOn(f.doc, f.version)).length,
      faults_checked_unflagged: faultEvents.filter(
        (f) => checkedOn(f.doc, f.version) && !flaggedOn(f.doc, f.version),
      ).length,
      faults_never_checked: faultEvents.filter((f) => !checkedOn(f.doc, f.version)).length,
    },
    consistency_refusals_at_publish: { count: refusedPublish.length, files: files(refusedPublish) },
    accepts_refused_changed_deliverable: {
      count: refusedAccept.length,
      files: files(refusedAccept),
    },
    producer_relay: {
      sent_to_producer: sent.filter(({ d }) => d.to_kind === 'producer').length,
      copies_to_lead: sent.filter(({ d }) => d.to_kind === 'lead').length,
      failed: relays.length - sent.length,
      by_reason: Object.fromEntries(
        [...new Set(sent.map(({ d }) => d.reason))]
          .sort()
          .map((r) => [
            r,
            sent.filter(({ d }) => d.reason === r && d.to_kind === 'producer').length,
          ]),
      ),
    },
    /** Per fault: flagged by doc_check (null when never checked). */
    fault_flags: Object.fromEntries(
      faultEvents.map((f) => [
        `${f.doc}#${f.version}`,
        checkedOn(f.doc, f.version) ? flaggedOn(f.doc, f.version) : null,
      ]),
    ),
  };
}
