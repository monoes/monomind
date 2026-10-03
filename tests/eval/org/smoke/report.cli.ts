// Usage: npx tsx tests/eval/org/smoke/report.cli.ts <trial root>... [--json]
import { smokeReport, trialRow } from './report.js';

const args = process.argv.slice(2);
const rep = smokeReport(args.filter((a) => !a.startsWith('--')).map(trialRow));
if (args.includes('--json')) console.log(JSON.stringify(rep, null, 2));
else {
  console.log(
    `${rep.note}\nspend $${rep.spendUsd.toFixed(2)} of $${rep.allocationUsd} allocated (soft)\n`,
  );
  for (const s of rep.scenarios) {
    const line = (r?: (typeof s)['currentBest']) =>
      r
        ? `${r.completed ? 'complete' : `missing ${r.missing.join(',') || '-'}`}  $${r.usd.toFixed(2)}  ${r.tokens} tok (${Math.round(r.cacheReadShare * 100)}% cache)  ${r.rotations} rot  ${r.seconds}s${r.pendingReview.length ? `  review: ${r.pendingReview.join(',')}` : ''}${r.voided ? `  VOID (${r.voidReasons.join('; ')})` : ''}${r.timedOut ? '  TIMED OUT' : ''}${r.spendStopped ? '  SPEND-STOPPED' : ''}`
        : 'none';
    console.log(
      `${s.scenario}\n  current-best  ${line(s.currentBest)}\n  phase2       ${line(s.phase2)}\n  regressions  ${s.regressions.join('; ') || 'none'}\n`,
    );
  }
}
