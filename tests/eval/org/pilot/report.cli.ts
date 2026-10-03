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
          ? `${r.delegated ? `delegated (${r.tasksCreated + r.tasksDispatched} tasks, ${r.activeWorkers.length} workers)` : 'did NOT delegate'}  ${r.ended}  $${r.usd.toFixed(2)}  ${r.seconds}s  handoff ${r.handoff.total} (pub ${r.handoff.publish.ok}/${r.handoff.publish.refused} read ${r.handoff.read.ok}/${r.handoff.read.refused} dec ${r.handoff.decide.ok}/${r.handoff.decide.refused}) sends refused ${r.handoff.sendRefused}${r.pendingReview.length ? `  review: ${r.pendingReview.join(',')}` : ''}`
          : 'missing';
      console.log(
        `  pair ${p.n}${p.confounded ? '  CONFOUNDED' : ''}${p.treatmentUnused ? '  (treatment never used the tools)' : ''}\n    baseline   ${f(p.baseline)}\n    treatment  ${f(p.treatment)}${p.single ? `\n    single     ${f(p.single)}` : ''}${p.reasons.length ? `\n    ${p.reasons.join('; ')}` : ''}`,
      );
    }
    console.log();
  }
}
