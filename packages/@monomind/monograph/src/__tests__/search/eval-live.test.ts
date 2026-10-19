import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createTransformersEmbedder } from '../../embeddings/transformers-embedder.js';
import { type EvalCase, evaluateRetrieval } from '../../search/eval.js';

// Live-graph retrieval benchmark. Skipped unless MONOGRAPH_EVAL_DB points at a
// built monograph.db of this repository (with vectors from `monomind monograph
// embed` for the semantic variant):
//   MONOGRAPH_EVAL_DB=.monomind/monograph.db \
//   MONOGRAPH_EVAL_HF=<path to @huggingface/transformers/dist/transformers.node.mjs> \
//   MONOGRAPH_EVAL_OUT=/tmp/eval.json  pnpm vitest run eval-live
// MONOGRAPH_EVAL_GOLD points at another gold file (eval/gold-monote.json is for a different repository).
const dbPath = process.env.MONOGRAPH_EVAL_DB;

describe.skipIf(!dbPath)('live retrieval benchmark', () => {
  it('reports recall and MRR: lexical only vs lexical + semantic', async () => {
    const cases = JSON.parse(
      readFileSync(
        process.env.MONOGRAPH_EVAL_GOLD ?? join(__dirname, '../../../eval/gold.json'),
        'utf8',
      ),
    ) as EvalCase[];
    const db = new Database(dbPath as string, { readonly: true });
    const hf = process.env.MONOGRAPH_EVAL_HF;
    const embedder = hf
      ? await createTransformersEmbedder(() => import(pathToFileURL(hf).href))
      : null;
    const summarize = async (e: typeof embedder) => {
      const r = await evaluateRetrieval(db, cases, { k: 10, embedder: e });
      const misses = r.results.filter((x) => x.rank === null).map((x) => `${x.kind}: ${x.query}`);
      return { recallAtK: r.recallAtK, mrr: r.mrr, byKind: r.byKind, misses };
    };
    const out = {
      lexical: await summarize(null),
      fused: embedder ? await summarize(embedder) : null,
    };
    db.close();
    // MONOGRAPH_EVAL_OUT: where to write the comparison (stdout is swallowed by vitest).
    if (process.env.MONOGRAPH_EVAL_OUT)
      writeFileSync(process.env.MONOGRAPH_EVAL_OUT, JSON.stringify(out, null, 1));
    expect(out.lexical.recallAtK).toBeGreaterThan(0);
  }, 600_000);
});
