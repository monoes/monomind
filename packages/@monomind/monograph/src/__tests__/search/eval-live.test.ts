import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { type EvalCase, evaluateRetrieval } from '../../search/eval.js';

// Live-graph retrieval benchmark. Skipped unless MONOGRAPH_EVAL_DB points at a
// built monograph.db of this repository:
//   MONOGRAPH_EVAL_DB=.monomind/monograph.db pnpm vitest run eval-live
const dbPath = process.env.MONOGRAPH_EVAL_DB;

describe.skipIf(!dbPath)('live retrieval benchmark', () => {
  it('reports recall and MRR over eval/gold.json', () => {
    const cases = JSON.parse(readFileSync(join(__dirname, '../../../eval/gold.json'), 'utf8')) as EvalCase[];
    const db = new Database(dbPath as string, { readonly: true });
    const summarize = (search: { scope: 'all' | 'auto' }) => {
      const r = evaluateRetrieval(db, cases, { k: 10, search });
      const misses = r.results.filter((x) => x.rank === null).map((x) => `${x.kind}: ${x.query}`);
      return { recallAtK: r.recallAtK, mrr: r.mrr, byKind: r.byKind, misses };
    };
    const out = { relevanceOnly: summarize({ scope: 'all' }), scopeAuto: summarize({ scope: 'auto' }) };
    db.close();
    // MONOGRAPH_EVAL_OUT: where to write the comparison (stdout is swallowed by vitest).
    if (process.env.MONOGRAPH_EVAL_OUT) writeFileSync(process.env.MONOGRAPH_EVAL_OUT, JSON.stringify(out, null, 1));
    expect(out.scopeAuto.recallAtK).toBeGreaterThan(0);
  }, 120_000);
});
