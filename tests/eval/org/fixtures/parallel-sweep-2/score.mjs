// Scorer of parallel-sweep-2 (32 modules, 33 units). The rules are parallel-sweep's, which reads the module
// list from the truth it is given: a module-sheet unit per module (accepted at 11 of 12 exact answers; the
// evidence also carries `exact`, 12 of 12, the secondary accuracy metric), plus the synthesis unit (6 of 6).
// The score comes from the files present when the run ends: a trial is cut at the deadline, and a unit whose
// file was not written by then is simply not delivered (accepted: false, "file is missing").
//   node score.mjs <deliverables dir> --truth <truth.json>
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDeliverables } from '../parallel-sweep/score.mjs';

export * from '../parallel-sweep/score.mjs';

/** The headline numbers of a checkDeliverables result: accepted units of all units (the primary metric),
 *  sheets with 12 of 12 (secondary), and the sheets that were written at all. */
export function summarize(units) {
  const sheets = units.filter((u) => u.unit === 'module-sheet');
  return {
    accepted: units.filter((u) => u.accepted).length,
    total: units.length,
    sheets_accepted: sheets.filter((u) => u.accepted).length,
    sheets_exact: sheets.filter((u) => u.evidence.exact === true).length,
    sheets_written: sheets.filter(
      (u) => !u.evidence.failures.some((f) => /file is (missing|not valid JSON)/.test(f)),
    ).length,
    synthesis_accepted: units.some((u) => u.unit === 'synthesis' && u.accepted),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--truth');
  if (!dir || args.indexOf('--truth') < 0)
    throw new Error('usage: node score.mjs <deliverables dir> --truth <truth.json>');
  const r = checkDeliverables(
    dir,
    JSON.parse(readFileSync(args[args.indexOf('--truth') + 1], 'utf8')),
  );
  console.log(JSON.stringify({ ...r, summary: summarize(r.units) }, null, 2));
}
