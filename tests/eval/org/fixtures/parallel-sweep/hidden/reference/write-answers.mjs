// Reference flows: writes deliverables from truth.json, for testing the scorer and showing the task is solvable.
//   node write-answers.mjs <out dir> --truth <truth.json> --variant complete|partial|wrong
//   complete  every module sheet and the synthesis, correct
//   partial   only m1..m3 answered (what a time-limited single agent would reach); the synthesis is not written
//   wrong     every sheet and the synthesis written, with values shifted by one and the file lists reversed
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MODULE_IDS } from '../../synthesis.mjs';

export function referenceDeliverables(truth, variant) {
  const modules = variant === 'partial' ? MODULE_IDS.slice(0, 3) : MODULE_IDS;
  const out = {};
  for (const m of modules)
    out[`${m}/answers.json`] = {
      module: m,
      answers: Object.entries(truth.modules[m]).map(([q, t]) => ({
        q,
        value: variant === 'wrong' ? t.value + 1 : t.value,
        files: variant === 'wrong' ? [...t.files].reverse() : t.files,
      })),
    };
  if (variant !== 'partial')
    out['synthesis.json'] = {
      answers: Object.entries(truth.synthesis).map(([q, s]) => ({
        q,
        value: variant === 'wrong' ? (typeof s.value === 'number' ? s.value + 1 : 'm0') : s.value,
      })),
    };
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const flag = (n) => args[args.indexOf(n) + 1];
  const out = args.find(
    (a, i) => !a.startsWith('--') && !['--truth', '--variant'].includes(args[i - 1]),
  );
  if (!out || args.indexOf('--truth') < 0 || args.indexOf('--variant') < 0)
    throw new Error(
      'usage: node write-answers.mjs <out dir> --truth <truth.json> --variant complete|partial|wrong',
    );
  const truth = JSON.parse(readFileSync(flag('--truth'), 'utf8'));
  for (const [path, doc] of Object.entries(referenceDeliverables(truth, flag('--variant')))) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), `${JSON.stringify(doc, null, 2)}\n`);
  }
}

if (process.argv[1]?.endsWith('write-answers.mjs')) main();
