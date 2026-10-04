// Usage: npx tsx tests/eval/org/pilot/report.cli.ts <trial root>... [--json]
import { pilotReport, pilotRow } from './report.js';

const args = process.argv.slice(2);
const rep = pilotReport(args.filter((a) => !a.startsWith('--')).map(pilotRow));
if (args.includes('--json')) console.log(JSON.stringify(rep, null, 2));
else {
  console.log(
    `${rep.note}\nspend $${rep.spendUsd.toFixed(2)} of $${rep.allocationUsd} allocated (soft); ${JSON.stringify(rep.summary)}\n`,
  );
  for (const r of rep.interrupted)
    console.log(`INTERRUPTED (no result, spend counted): ${r.name}  $${r.usd.toFixed(2)}`);
  for (const s of rep.scenarios) {
    console.log(`${s.scenario} (${s.profile})`);
    for (const p of s.pairs) {
      const f = (r?: (typeof p)['baseline']) =>
        r
          ? `${r.delegated ? `delegated (${r.tasksCreated + r.tasksDispatched} tasks, ${r.activeWorkers.length} workers)` : 'did NOT delegate'}  ${r.ended}  $${r.usd.toFixed(2)}  ${r.seconds}s  handoff ${r.handoff.total} (pub ${r.handoff.publish.ok}/${r.handoff.publish.refused} read ${r.handoff.read.ok}/${r.handoff.read.refused} dec ${r.handoff.decide.ok}/${r.handoff.decide.refused}) sends refused ${r.handoff.sendRefused}${r.handoff.phase4 ? `  phase4 ${JSON.stringify(r.handoff.phase4)}` : ''}${r.pendingReview.length ? `  review: ${r.pendingReview.join(',')}` : ''}`
          : 'missing';
      console.log(
        `  pair ${p.n}${p.confounded ? '  CONFOUNDED' : ''}${p.treatmentUnused ? '  (treatment never used the tools)' : ''}\n    baseline   ${f(p.baseline)}\n    treatment  ${f(p.treatment)}${p.single ? `\n    single     ${f(p.single)}` : ''}${p.reasons.length ? `\n    ${p.reasons.join('; ')}` : ''}`,
      );
      // a hand-off decision trial (parallel-sweep-3): the injected-fault record against the consumer's decisions
      const v2 = p.treatmentV2;
      if (v2)
        console.log(
          `    treatment v2  ${f(v2)}  doc_check ${v2.handoff.check?.ok ?? 0}/${v2.handoff.check?.refused ?? 0}  relays ${v2.handoff.relays ?? 0}`,
        );
      // the same variant on the runtime document tools (the `v2r` switch): the faults are n/a, the runtime has no injector
      const v2r = p.treatmentV2r;
      if (v2r) {
        console.log(
          `    treatment v2r (runtime tools)  ${f(v2r)}  doc_check ${v2r.handoff.check?.ok ?? 0}/${v2r.handoff.check?.refused ?? 0}  relays ${v2r.handoff.relays ?? 0}`,
        );
        const d = v2r.decisions;
        if (d)
          console.log(
            `    v2r decisions  faults n/a (no injector); false rejects ${d.false_rejects}; republish cycles ${d.republish_cycles}; final accepted docs ${d.final_accepted_docs}/8, correct ${d.final_accepted_correct}; synthesis ${d.synthesis_exact ? 'exact' : 'not exact'}; doc_check calls ${d.v2.doc_check.calls}; consistency refusals at publish ${d.v2.consistency_refusals_at_publish.count}; accepts refused for a changed file ${d.v2.accepts_refused_changed_deliverable.count}; relay messages to producers ${d.v2.producer_relay.sent_to_producer}, lead copies ${d.v2.producer_relay.copies_to_lead}; docs read by role ${JSON.stringify(d.docs_read)}; docs decided by role ${JSON.stringify(d.docs_decided)}`,
          );
      }
      const d = p.treatment?.decisions;
      if (d)
        console.log(
          `    decisions  faults ${d.injected}: caught ${d.caught} (plausible reason ${d.caught_plausible_reason}), missed ${d.missed}, undecided ${d.undecided}; false rejects ${d.false_rejects}; republish cycles ${d.republish_cycles}; final accepted docs ${d.final_accepted_docs}/8, correct ${d.final_accepted_correct}, corrupted ${d.final_accepted_corrupted}; synthesis ${d.synthesis_exact ? 'exact' : 'not exact'}, used a corrupted document ${d.synthesis_used_corrupted}; synthesis file at ${d.seconds.synthesis_file} s; cost workers/lead/synthesiser ${d.cost_usd.workers}/${d.cost_usd.lead}/${d.cost_usd.synthesiser}`,
        );
      const d2 = v2?.decisions;
      if (d2)
        console.log(
          `    v2 decisions  faults ${d2.injected}: caught ${d2.caught}, missed ${d2.missed}, undecided ${d2.undecided}; false rejects ${d2.false_rejects}; doc_check calls ${d2.v2.doc_check.calls} (flagged answers ${d2.v2.doc_check.flagged_answers}, faults flagged ${d2.v2.doc_check.faults_flagged}/${d2.injected}, flagged yet missed or never checked: see units.json); consistency refusals at publish ${d2.v2.consistency_refusals_at_publish.count} (${d2.v2.consistency_refusals_at_publish.files.join(', ') || 'none'}); accepts refused for a changed file ${d2.v2.accepts_refused_changed_deliverable.count}; relay messages to producers ${d2.v2.producer_relay.sent_to_producer}, lead copies ${d2.v2.producer_relay.copies_to_lead}; final accepted docs ${d2.final_accepted_docs}/8, correct ${d2.final_accepted_correct}, corrupted ${d2.final_accepted_corrupted}; synthesis ${d2.synthesis_exact ? 'exact' : 'not exact'}`,
        );
    }
    console.log();
  }
}
