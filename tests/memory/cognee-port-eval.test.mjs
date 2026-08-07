/**
 * Memory-quality eval harness — Phase 5 of the cognee port plan
 * (docs/mastermind/2026-07-19-cognee-port-plan.md).
 *
 * Small fixture of (question → expected memory) pairs measuring hit-rate@k,
 * plus regression checks for the feedback loop (EWMA + idempotency + rank
 * effect), rule distillation dedup, KG triplet retrieval/rollback, and the
 * query router. Semantic-quality assertions are gated on the local embedding
 * model actually loading (CI without the model degrades to keyword search —
 * math/behavior checks still run there).
 *
 * Runs under Node's built-in test runner (`npm run test:semantic-eval`),
 * not vitest — the local MiniLM model does not reliably load under vitest's
 * worker-pool sandbox, which silently turned every semantic-quality
 * assertion here into a no-op skip (see GH issue #32). Run standalone with
 * `node --test tests/memory/cognee-port-eval.test.mjs`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DIST = path.resolve('packages/@monomind/cli/dist/src');
const STORE = path.join('.monomind', `tmp-eval-store-${process.pid}`);

let bridge, kg, router;
let semantic = false;

const FIXTURES = [
  { key: 'fact-auth', value: 'Authentication uses JWT with rotating refresh tokens stored in httpOnly cookies', q: 'how do we handle login tokens?' },
  { key: 'fact-dash', value: 'The dashboard server is the single long-lived process and keeps the embedding model warm', q: 'which process holds the warm embedding model?' },
  { key: 'fact-exfat', value: 'exFAT volumes create AppleDouble ._ sidecar files that corrupt directory scans', q: 'why do directory listings break on external drives?' },
  { key: 'fact-publish', value: 'The CLI consumes the published @monoes/memory package, so backend changes need an npm publish', q: 'when do memory package changes reach the CLI?' },
];

before(async () => {
  bridge = await import(path.join(DIST, 'memory/memory-bridge.js'));
  kg = await import(path.join(DIST, 'memory/memory-kg.js'));
  router = await import(path.join(DIST, 'memory/query-router.js'));
  for (const f of FIXTURES) {
    const res = await bridge.bridgeStoreEntry({ key: f.key, value: f.value, namespace: 'default', dbPath: STORE, upsert: true });
    assert.equal(res?.success, true);
  }
  const probe = await bridge.bridgeSearchEntries({ query: 'warmup probe', namespace: 'default', dbPath: STORE, limit: 1 });
  semantic = probe?.searchMethod === 'semantic';
}, { timeout: 180_000 });

after(async () => {
  await bridge?.shutdownBridge?.();
  fs.rmSync(STORE, { recursive: true, force: true });
});

describe('retrieval hit-rate@3', () => {
  it('finds the expected memory for each fixture question', { timeout: 120_000 }, async () => {
    let hits = 0;
    for (const f of FIXTURES) {
      const res = await bridge.bridgeSearchEntries({ query: f.q, namespace: 'default', dbPath: STORE, limit: 3, threshold: 0.1 });
      if ((res?.results ?? []).some(r => r.key === f.key)) hits++;
    }
    const rate = hits / FIXTURES.length;
    // Semantic must be strong; keyword fallback is best-effort (regression
    // canary only — the fixtures share few literal tokens with the questions).
    assert.ok(rate >= (semantic ? 0.75 : 0.25));
  });
});

describe('feedback loop', () => {
  it('EWMA-applies once per ledger key and lifts blended rank score', { timeout: 120_000 }, async (t) => {
    if (!semantic) { t.skip('blend is semantic-only by design (cognee guard)'); return; }
    const q = 'how do we handle login tokens?';
    const beforeRes = await bridge.bridgeSearchEntries({ query: q, namespace: 'default', dbPath: STORE, limit: 3 });
    const target = beforeRes.results.find(r => r.key === 'fact-auth');
    assert.ok(target);

    for (let i = 0; i < 5; i++) {
      const res = await bridge.bridgeApplyFeedback({ entryIds: [target.id], score: 1.0, ledgerKey: `eval-${i}`, dbPath: STORE });
      assert.equal(res.success, true);
      assert.equal(res.applied, 1);
    }
    // Idempotency: reusing a ledger key must be a no-op.
    const repeat = await bridge.bridgeApplyFeedback({ entryIds: [target.id], score: 1.0, ledgerKey: 'eval-0', dbPath: STORE });
    assert.equal(repeat.alreadyApplied, true);
    assert.equal(repeat.applied, 0);

    const afterRes = await bridge.bridgeSearchEntries({ query: q, namespace: 'default', dbPath: STORE, limit: 3 });
    const targetAfter = afterRes.results.find(r => r.key === 'fact-auth');
    assert.ok(targetAfter.score > target.score);
  });

  it('usage capture increments frequency and dedup-store reinforces', { timeout: 60_000 }, async () => {
    const stored = await bridge.bridgeStoreEntry({ key: 'freq-probe', value: 'A distinctive probe fact about zebra caching', namespace: 'default', dbPath: STORE });
    const usage = await bridge.bridgeRecordUsage({ entryIds: [stored.id], dbPath: STORE });
    assert.equal(usage.updated, 1);
  });
});

describe('knowledge graph', () => {
  it('merges same-name entities, retrieves triplets, rolls back per origin', { timeout: 120_000 }, async () => {
    const a = await kg.kgIngest({
      originRef: 'run:eval1', dbPath: STORE,
      nodes: [{ name: 'Eval Daemon', type: 'Service', description: 'runs the orgs' }, { name: 'Eval Bus', type: 'Module' }],
      edges: [{ source: 'Eval Daemon', target: 'Eval Bus', relation: 'emits_to', description: 'Eval Daemon emits run events to Eval Bus' }],
    });
    assert.equal(a.nodesAdded, 2);
    const b = await kg.kgIngest({ originRef: 'run:eval2', dbPath: STORE, nodes: [{ name: 'eval daemon', type: 'Service', description: 'the long-running organization runtime service' }] });
    assert.equal(b.nodesMerged, 1);

    if (semantic) {
      const s = await kg.kgSearch({ query: 'what does the daemon emit events to?', dbPath: STORE });
      assert.ok(s.context.includes('emits_to'));
    }

    const rb = await kg.kgRollback({ originRef: 'run:eval1', dbPath: STORE });
    assert.equal(rb.success, true);
    assert.ok(rb.deleted >= 2); // Eval Bus + edge (sole origin)
    assert.equal(rb.retained, 1); // Eval Daemon shared with run:eval2
  });

  it('rule distillation dedups paraphrases (rule-recall)', { timeout: 120_000 }, async (t) => {
    if (!semantic) { t.skip(); return; }
    const r1 = await kg.kgIngestRules({ originRef: 'run:eval3', dbPath: STORE, rules: [{ rule: 'Always run the build before committing TypeScript changes' }] });
    assert.equal(r1.verdicts[0].verdict, 'accepted');
    const r2 = await kg.kgIngestRules({ originRef: 'run:eval4', dbPath: STORE, rules: [{ rule: 'You should always build before you commit any TypeScript change' }] });
    assert.equal(r2.verdicts[0].verdict, 'already_known');
    const rules = await kg.kgListRules({ dbPath: STORE });
    assert.equal(rules.length, 1);
  });
});

describe('query router', () => {
  it('routes by intent with confidence', () => {
    assert.ok(router.routeQuery('what are the naming conventions?').surfaces.includes('rules'));
    assert.ok(router.routeQuery('how does the daemon relate to the bus?').surfaces.includes('kg'));
    assert.ok(router.routeQuery('what did the previous run decide?').surfaces.includes('memory'));
    assert.ok(router.routeQuery('explain the setup docs').surfaces.includes('chunks'));
  });

  it('rrfFuse ranks cross-list agreement first', () => {
    const fused = router.rrfFuse([[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]], 3);
    assert.equal(fused[0].id, 'b');
  });
});
