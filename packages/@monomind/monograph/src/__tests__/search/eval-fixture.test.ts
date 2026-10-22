import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAsync } from '../../pipeline/orchestrator.js';
import { type EvalCase, type EvalReport, evaluateRetrieval } from '../../search/eval.js';

// Keyword-only retrieval regression gate (#682). Builds a graph of the checked-in
// fixture repository and scores eval/gold-fixture.json against thresholds. Needs
// no embedding model. The semantic variant runs in .github/workflows/graph-eval.yml.
const evalDir = join(__dirname, '../../../eval');

// Minimums per kind: exact names must always be found; the others leave a margin
// below the measured baseline for harmless drift.
const MIN_RECALL: Record<string, number> = { exact: 1, natural: 0.75, doc: 0.5 };
const MIN_OVERALL_MRR = 0.5;

describe('graph-search retrieval benchmark (keyword only)', () => {
  let dir: string;
  let db: Database.Database;
  let report: EvalReport;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mg-eval-'));
    cpSync(join(evalDir, 'fixture'), dir, { recursive: true });
    const result = await buildAsync(dir);
    expect(result.status).toBe('built');
    db = new Database(join(dir, '.monomind', 'monograph.db'), { readonly: true });
    const cases = JSON.parse(
      readFileSync(join(evalDir, 'gold-fixture.json'), 'utf8'),
    ) as EvalCase[];
    report = await evaluateRetrieval(db, cases, { k: 10, embedder: null });
    if (process.env.MONOGRAPH_EVAL_OUT) {
      writeFileSync(process.env.MONOGRAPH_EVAL_OUT, JSON.stringify(report, null, 1));
    }
  }, 120_000);

  afterAll(() => {
    db?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  for (const [kind, min] of Object.entries(MIN_RECALL)) {
    it(`recall@10 for ${kind} queries stays >= ${min}`, () => {
      const misses = report.results.filter((r) => r.kind === kind && r.rank === null);
      expect(report.byKind[kind]?.recallAtK ?? 0, JSON.stringify(misses)).toBeGreaterThanOrEqual(
        min,
      );
    });
  }

  it(`overall MRR stays >= ${MIN_OVERALL_MRR}`, () => {
    expect(report.mrr).toBeGreaterThanOrEqual(MIN_OVERALL_MRR);
  });
});
