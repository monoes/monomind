// Scorer of parallel-sweep-3: the parallel-sweep-2 scorer, unchanged (same corpus, same 33 units, same rules).
// The hand-off measures of this scenario are in handoff-metrics.mjs.
//   node score.mjs <deliverables dir> --truth <truth.json>
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDeliverables, summarize } from '../parallel-sweep-2/score.mjs';

export * from '../parallel-sweep-2/score.mjs';

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
