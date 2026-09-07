// packages/@monomind/cli/src/__tests__/kg-eval-retrieval.test.ts
//
// K9 retrieval evaluation baseline (memory-KG next-steps handoff
// 2026-09-07, section 4). Synthetic-graph half of section 4.1 ONLY: small,
// deterministic fixtures with EXACT expected entities/claims/scope
// behavior. This is NOT the "representative task questions" half (realistic
// queries with reviewed human relevance labels) — the doc requires
// human-reviewed labels for that half ("ambiguous labels require review
// before becoming acceptance criteria"), which isn't available in an
// autonomous session. See the baseline report's final section for that
// explicit deferral.
//
// Runs against a REAL backend (SqlBackend, keyword mode — the traversal
// guard requires custom dbPaths under cwd, same as
// memory-retrieval-quality.test.ts) rather than a mocked bridge, so the
// numbers below reflect genuine kgIngest/kgSearch/kgRollback/kgIngestRules
// behavior, not a hand-simulated approximation. Every call below passes an
// explicit `dbPath: STORE` so this suite never touches the real project's
// own memory store. Embeddings are disabled
// (MONOMIND_NO_LOCAL_EMBEDDINGS=1) — this evaluates keyword-mode retrieval
// only; semantic-mode is explicitly NOT evaluated here (a skipped semantic
// test is not a semantic-quality pass, per the doc).
//
// Each fixture records the section 4.2 ground-truth shape (relevant ids,
// required source support, forbidden results, whether an answer exists,
// grade/rationale) as inline comments/assertions rather than a separate
// schema — the fixtures ARE the ground truth, checked directly against
// what the real functions return.

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { kgIngest, kgIngestRules, kgListRules, kgRollback, kgSearch } from '../memory/memory-kg.js';

const STORE = mkdtempSync(join(process.cwd(), '.tmp-kg-eval-'));

/** One row per measured fixture, printed as a summary table at the end —
 *  the "reproducible runner" output the handoff doc's stage-4 deliverable
 *  asks for (dataset + runner + baseline report, together). */
interface EvalRow {
  category: string;
  id: string;
  metric: string;
  value: number;
  note: string;
}
const RESULTS: EvalRow[] = [];
function record(category: string, id: string, metric: string, value: number, note: string): void {
  RESULTS.push({ category, id, metric, value, note });
}

afterAll(() => {
  rmSync(STORE, { recursive: true, force: true });
  // eslint-disable-next-line no-console
  console.log('\n=== K9 memory-KG retrieval evaluation baseline (keyword mode) ===');
  const byCategory = new Map<string, EvalRow[]>();
  for (const r of RESULTS) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }
  for (const [category, rows] of byCategory) {
    // eslint-disable-next-line no-console
    console.log(`\n${category}`);
    for (const r of rows) {
      // eslint-disable-next-line no-console
      console.log(`  ${r.id}: ${r.metric}=${r.value.toFixed(3)}  (${r.note})`);
    }
    const mean = rows.reduce((s, r) => s + r.value, 0) / rows.length;
    // eslint-disable-next-line no-console
    console.log(`  category mean: ${mean.toFixed(3)}`);
  }
});

describe('K9 baseline: exact entity lookup and aliases', () => {
  it('e1: exact-name query recalls the entity at rank 1', async () => {
    await kgIngest({
      nodes: [{ name: 'Zylophone Gateway', type: 'Service', description: 'internal billing gateway' }],
      edges: [],
      originRef: 'eval:e1',
      dbPath: STORE,
    });
    const res = await kgSearch({ query: 'Zylophone Gateway', dbPath: STORE });
    const rank = res.seeds.findIndex((s) => s.name === 'Zylophone Gateway');
    expect(rank).toBe(0);
    record('exact entity lookup + aliases', 'e1-exact-name', 'MRR', rank === 0 ? 1 : 0, 'exact name query');
  });

  it('e2: partial/alias-ish query still recalls the entity within top-5', async () => {
    await kgIngest({
      nodes: [
        { name: 'Quorum Ledger Service', type: 'Service', description: 'distributed consensus ledger' },
      ],
      edges: [],
      originRef: 'eval:e2',
      dbPath: STORE,
    });
    // Not the full name — closer to how a caller might refer to it in passing.
    const res = await kgSearch({ query: 'Quorum Ledger', dbPath: STORE });
    const rank = res.seeds.findIndex((s) => s.name === 'Quorum Ledger Service');
    const recallAt5 = rank >= 0 && rank < 5 ? 1 : 0;
    record('exact entity lookup + aliases', 'e2-partial-name', 'recall@5', recallAt5, `rank=${rank}`);
    expect(recallAt5).toBe(1);
  });
});

describe('K9 baseline: relationships where the predicate matters', () => {
  it('r1: the correct relation is the top triplet for a two-relation pair', async () => {
    await kgIngest({
      nodes: [],
      edges: [
        { source: 'Cartographer', target: 'TileCache', relation: 'writes_to' },
        { source: 'Cartographer', target: 'TileCache', relation: 'reads_from' },
      ],
      originRef: 'eval:r1a',
      dbPath: STORE,
    });
    // Re-assert writes_to from a second origin so it has more support than
    // reads_from — the query names the relation explicitly.
    await kgIngest({
      nodes: [],
      edges: [{ source: 'Cartographer', target: 'TileCache', relation: 'writes_to' }],
      originRef: 'eval:r1b',
      dbPath: STORE,
    });
    const res = await kgSearch({ query: 'Cartographer TileCache', dbPath: STORE });
    const top = res.triplets[0];
    const correct = top?.relation === 'writes_to' ? 1 : 0;
    // Not asserted must-pass: kgSearch's ranking is seed-relevance-based, not
    // relation-aware (both edges share the same endpoints, hence the same
    // score) — re-assertion count does not influence relation-level ranking.
    // This is exactly what K9's own "still open" finding says ("ranking
    // deliberately does not evaluate the relation/fact against the query"),
    // so a low precision@1 HERE is the honest current baseline, not a test bug.
    record(
      'relationships (predicate matters)',
      'r1-two-relation-pair',
      'precision@1',
      correct,
      `top=${top?.relation} (both edges score identically — no relation-aware ranking yet)`,
    );
    expect(res.triplets.some((t) => t.relation === 'writes_to')).toBe(true);
    expect(res.triplets.some((t) => t.relation === 'reads_from')).toBe(true);
  });

  it('r2: a distinct relation between the same two entities is retrievable, not merged', async () => {
    await kgIngest({
      nodes: [],
      edges: [{ source: 'Sentinel', target: 'Vault', relation: 'authenticates_to' }],
      originRef: 'eval:r2',
      dbPath: STORE,
    });
    const res = await kgSearch({ query: 'Sentinel Vault', dbPath: STORE });
    const found = res.triplets.find((t) => t.source === 'Sentinel' && t.target === 'Vault');
    const correct = found?.relation === 'authenticates_to' ? 1 : 0;
    record(
      'relationships (predicate matters)',
      'r2-single-relation',
      'precision@1',
      correct,
      `found=${found?.relation}`,
    );
    expect(correct).toBe(1);
  });
});

describe('K9 baseline: questions requiring a particular fact/source', () => {
  it('f1: the asserted fact carries method=asserted (evidence quality)', async () => {
    await kgIngest({
      nodes: [],
      edges: [{ source: 'Beacon', target: 'Relay', relation: 'forwards_to' }],
      originRef: 'eval:f1',
      method: 'asserted',
      dbPath: STORE,
    });
    const res = await kgSearch({ query: 'Beacon Relay', dbPath: STORE });
    const t = res.triplets.find((x) => x.source === 'Beacon');
    const hasEvidence = t?.method === 'asserted' ? 1 : 0;
    record(
      'fact/source-specific',
      'f1-asserted-method',
      'evidence-quality-fraction',
      hasEvidence,
      `method=${t?.method}`,
    );
    expect(hasEvidence).toBe(1);
  });
});

describe('K9 baseline: isolated entities', () => {
  it('i1: an entity with zero edges is still a seed result', async () => {
    await kgIngest({
      nodes: [{ name: 'Driftwood Console', type: 'Tool', description: 'standalone diagnostic console' }],
      edges: [],
      originRef: 'eval:i1',
      dbPath: STORE,
    });
    const res = await kgSearch({ query: 'Driftwood Console', dbPath: STORE });
    const found = res.seeds.some((s) => s.name === 'Driftwood Console') ? 1 : 0;
    record('isolated entities', 'i1-zero-edges', 'recall@k', found, `seeds=${res.seeds.length}`);
    expect(found).toBe(1);
  });
});

describe('K9 baseline: same-name entities in different scopes', () => {
  it('s1: two scopes with an identically-named entity stay independent', async () => {
    await kgIngest({
      nodes: [{ name: 'Redis', type: 'Service', description: 'org Alpha cache cluster' }],
      edges: [],
      originRef: 'eval:s1',
      scope: { org: 'eval-alpha' },
      dbPath: STORE,
    });
    await kgIngest({
      nodes: [{ name: 'Redis', type: 'Service', description: 'org Beta session store' }],
      edges: [],
      originRef: 'eval:s1',
      scope: { org: 'eval-beta' },
      dbPath: STORE,
    });
    const alpha = await kgSearch({ query: 'Redis', scope: { org: 'eval-alpha' }, dbPath: STORE });
    const beta = await kgSearch({ query: 'Redis', scope: { org: 'eval-beta' }, dbPath: STORE });
    const alphaSeed = alpha.seeds.find((s) => s.name === 'Redis');
    const betaSeed = beta.seeds.find((s) => s.name === 'Redis');
    const noLeak =
      alphaSeed?.description.includes('Alpha') && betaSeed?.description.includes('Beta') ? 1 : 0;
    record('same-name, different scopes', 's1-two-orgs', 'scope-correctness', noLeak, 'no cross-scope leak');
    expect(noLeak).toBe(1);
  });
});

describe('K9 baseline: updated, contradicted, and withdrawn claims', () => {
  it('u1: the current description wins over a stale one after an update', async () => {
    await kgIngest({
      nodes: [{ name: 'Meridian', type: 'Service', description: 'legacy: routes to MySQL' }],
      edges: [],
      originRef: 'eval:u1a',
      dbPath: STORE,
    });
    await kgIngest({
      nodes: [{ name: 'Meridian', type: 'Service', description: 'current: routes to PostgreSQL' }],
      edges: [],
      originRef: 'eval:u1b',
      dbPath: STORE,
    });
    const res = await kgSearch({ query: 'Meridian', dbPath: STORE });
    // The canonical row merges correctly (both seed hits below share one id —
    // K5's stable-id-across-upserts fix holds), but bridgeSearchEntries
    // returned TWO seed hits for that one id: one with the stale description,
    // one with the current one. That's a genuine, distinct finding — see the
    // report — not something this fixture works around; `.some()` measures
    // "is the current fact discoverable at all", which is what the fixture
    // is actually checking.
    const meridianSeeds = res.seeds.filter((s) => s.name === 'Meridian');
    const duplicateSeedHit = meridianSeeds.length > 1 ? 1 : 0;
    record(
      'updated/contradicted/withdrawn',
      'u1b-duplicate-seed-hit-after-update',
      'anomaly-rate',
      duplicateSeedHit,
      `${meridianSeeds.length} seed hits for one entity id after upsert: ${meridianSeeds.map((s) => `"${s.description}"`).join(' / ')}`,
    );
    const current = meridianSeeds.some((s) => s.description.includes('PostgreSQL')) ? 1 : 0;
    record(
      'updated/contradicted/withdrawn',
      'u1-update-wins',
      'correctness',
      current,
      `descriptions=${meridianSeeds.map((s) => s.description).join(' | ')}`,
    );
    expect(current).toBe(1);
  });

  it('u2: two disagreeing live claims are flagged conflict', async () => {
    // Conflict requires two DIFFERING non-empty descriptions on live claims —
    // an omitted/empty description is "this edge exists", not a claim to
    // disagree with, and is excluded from the conflict check by design.
    await kgIngest({
      nodes: [],
      edges: [
        { source: 'Compass', target: 'Anchor', relation: 'primary_of', description: 'the primary anchor point' },
      ],
      originRef: 'eval:u2a',
      method: 'asserted',
      dbPath: STORE,
    });
    await kgIngest({
      nodes: [],
      edges: [
        {
          source: 'Compass',
          target: 'Anchor',
          relation: 'primary_of',
          description: 'DISPUTED: not primary anymore',
        },
      ],
      originRef: 'eval:u2b',
      method: 'asserted',
      dbPath: STORE,
    });
    const res = await kgSearch({ query: 'Compass Anchor', dbPath: STORE });
    const t = res.triplets.find((x) => x.source === 'Compass');
    const flagged = t?.conflict === true ? 1 : 0;
    record('updated/contradicted/withdrawn', 'u2-conflict-flag', 'correctness', flagged, `conflict=${t?.conflict}`);
    expect(flagged).toBe(1);
  });

  it('u3: a withdrawn claim does not reappear in search after rollback', async () => {
    await kgIngest({
      nodes: [{ name: 'Ephemeral Node', type: 'Service', description: 'temporary test service' }],
      edges: [],
      originRef: 'eval:u3',
      dbPath: STORE,
    });
    const before = await kgSearch({ query: 'Ephemeral Node', dbPath: STORE });
    expect(before.seeds.some((s) => s.name === 'Ephemeral Node')).toBe(true);

    const rollback = await kgRollback({ originRef: 'eval:u3', dbPath: STORE });
    expect(rollback.success).toBe(true);

    const after = await kgSearch({ query: 'Ephemeral Node', dbPath: STORE });
    const gone = after.seeds.some((s) => s.name === 'Ephemeral Node') ? 0 : 1;
    record(
      'updated/contradicted/withdrawn',
      'u3-withdrawal',
      'retraction-correctness',
      gone,
      `still-present=${!gone}`,
    );
    expect(gone).toBe(1);
  });
});

describe('K9 baseline: rules with conditions/exceptions', () => {
  it('ru1: a conditional rule is accepted and listed', async () => {
    const rule = 'Retry the deploy webhook up to 3 times unless the response is 4xx';
    const res = await kgIngestRules({ rules: [{ rule }], originRef: 'eval:ru1', dbPath: STORE });
    expect(res.success).toBe(true);
    expect(res.verdicts[0].verdict).toBe('accepted');
    const listed = await kgListRules({ limit: 50, dbPath: STORE });
    const found = listed.some((r) => r.rule.startsWith(rule)) ? 1 : 0;
    record('rules with conditions', 'ru1-conditional-rule', 'correctness', found, 'accepted + listed');
    expect(found).toBe(1);
  });
});

describe('K9 baseline: missing-answer questions', () => {
  it('m1: a query about something never ingested returns no false-positive match', async () => {
    const res = await kgSearch({ query: 'Nonexistent Quixotic Widget Factory 9182', dbPath: STORE });
    // Correct abstention: either no seeds at all, or seeds present but none
    // of them plausibly named this — either way, no triplet should exist.
    const abstained = res.triplets.length === 0 ? 1 : 0;
    record(
      'missing-answer questions',
      'm1-never-ingested',
      'abstention-correctness',
      abstained,
      `triplets=${res.triplets.length}`,
    );
    expect(res.triplets).toHaveLength(0);
  });
});

describe('K9 baseline: paraphrases with low lexical overlap (keyword mode)', () => {
  it('p1: a genuine paraphrase is NOT expected to be found under keyword-only search', async () => {
    await kgIngest({
      nodes: [
        {
          name: 'Thermal Runaway Guard',
          type: 'Component',
          description: 'shuts down the battery pack before it overheats catastrophically',
        },
      ],
      edges: [],
      originRef: 'eval:p1',
      dbPath: STORE,
    });
    // Zero shared tokens with the stored name/description — a real paraphrase,
    // not a synonym-of-one-word case.
    const res = await kgSearch({ query: 'what stops the cells from catching fire', dbPath: STORE });
    const found = res.seeds.some((s) => s.name === 'Thermal Runaway Guard') ? 1 : 0;
    record(
      'paraphrases (keyword mode)',
      'p1-paraphrase',
      'recall@k (expected low)',
      found,
      'keyword search has no semantic model here — this is the honest baseline, not a bug',
    );
    // Deliberately not asserted as must-pass: this documents current
    // keyword-mode behavior. Embedding-mode recall on the same fixture is
    // explicitly out of scope for this pass (see report).
  });
});

describe('K9 baseline: hard negatives', () => {
  it('h1: a topically-related but wrong-relation edge does not get reported as the asked-about one', async () => {
    await kgIngest({
      nodes: [],
      edges: [
        { source: 'Falcon', target: 'Nest', relation: 'monitors' },
        { source: 'Falcon', target: 'Nest', relation: 'was_deprecated_by' },
      ],
      originRef: 'eval:h1',
      dbPath: STORE,
    });
    const res = await kgSearch({ query: 'Falcon Nest monitors', dbPath: STORE });
    const relations = res.triplets.filter((t) => t.source === 'Falcon').map((t) => t.relation);
    // Both are legitimately retrievable (this is retrieval, not an oracle
    // that reads intent) — the negative property under test is that the
    // deprecation edge is present and DISTINGUISHABLE by its own relation
    // label, not silently merged into or mislabeled as "monitors".
    const distinguishable =
      relations.includes('monitors') && relations.includes('was_deprecated_by') ? 1 : 0;
    record(
      'hard negatives',
      'h1-two-relations-one-pair',
      'precision (no mislabeling)',
      distinguishable,
      `relations=${relations.join(',')}`,
    );
    expect(distinguishable).toBe(1);
  });
});

describe('K9 baseline: facts below the normal top-15 seed cutoff', () => {
  it('c1: a fact on the 20th-most-relevant seed for a broad query may be missed (documents SEARCH_SEED_LIMIT=15)', async () => {
    // 20 entities all matching "Widget" broadly; only the 20th (least
    // relevant by insertion/scoring order) carries the target edge.
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      name: `Widget Variant ${i}`,
      type: 'Component',
      description: i === 19 ? 'Widget Variant 19 is the one with the special edge' : `Widget Variant ${i}`,
    }));
    await kgIngest({ nodes, edges: [], originRef: 'eval:c1', dbPath: STORE });
    await kgIngest({
      nodes: [],
      edges: [{ source: 'Widget Variant 19', target: 'SpecialCase', relation: 'triggers' }],
      originRef: 'eval:c1',
      dbPath: STORE,
    });
    const res = await kgSearch({ query: 'Widget Variant', dbPath: STORE });
    const found = res.triplets.some((t) => t.source === 'Widget Variant 19') ? 1 : 0;
    record(
      'below top-15 cutoff',
      'c1-rank-20-of-20',
      'recall@k (cutoff-sensitive)',
      found,
      `seedCount=${res.seeds.length}, found=${found === 1}`,
    );
    // Not asserted must-pass: this measures the real behavior of the
    // documented SEARCH_SEED_LIMIT cutoff, not a bug being fixed here.
  });
});
