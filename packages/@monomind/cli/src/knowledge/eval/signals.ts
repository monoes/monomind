/**
 * Pre-registered signals and the persistent regression suite.
 *
 * TWO DEFECTS IN THE SCOREBOARD THAT THIS FILE EXISTS TO FIX.
 *
 * 1. The scoreboard could only report NOVELTY, never REGRESSION. Every row was
 *    a point measurement of a different item, and nothing was ever re-measured.
 *    If item 1 caused item 4's win to evaporate, or an unguarded ingest path
 *    quietly refilled the store, no row in an append-only table would ever show
 *    it. Here, every row re-runs EVERY prior item's signal, so a win that decays
 *    is visible on the next row rather than never.
 *
 * 2. Claims could be fitted after the fact. An item that shipped against
 *    Recall@5 could be defended with "but MRR improved" once Recall@5 came in
 *    flat. A signal must be declared BEFORE the run, with its direction and
 *    magnitude, and `declaredAt` is what makes that checkable.
 *
 * The sealed dev/test split stops us fitting the DATA. This stops us fitting
 * the CLAIM. They are different failure modes and need different machinery.
 *
 * @module v1/cli/knowledge/eval/signals
 */

import type { StoreProfile } from './harness.js';

export interface PreRegisteredSignal {
  /** Stable id, referenced by the scoreboard row that shipped the item. */
  id: string;
  /** Backlog item this signal belongs to. */
  item: string;
  /** ISO date the prediction was recorded. MUST predate the run that tests it —
   *  a magnitude written down after seeing the number is not a prediction. */
  declaredAt: string;
  /** One sentence, in words, of what is claimed. */
  claim: string;
  /** Dotted path into the eval report, e.g.
   *  'results.dense-only (gte-modernbert-base).scoreboard.recallAt5'. */
  metric: string;
  direction: 'increase' | 'decrease' | 'no-worse-than';
  /** Declared before measuring. Compared against the CI half-width at scoring
   *  time: a prediction smaller than the noise floor is not testable. */
  expectedMagnitude: number;
  /**
   * Store profiles in which this signal is VISIBLE AT ALL. Item 4's superseded
   * rows do not exist in a 'fresh' corpus, so scoring it there yields a flat
   * number that means "cannot see", not "no effect". Getting this wrong is how
   * a working item gets dropped.
   */
  visibleIn: StoreProfile[];
  /** What would make this win decay. This is what populates the regression
   *  suite — declared up front, not reconstructed later from a plan. */
  decayCondition: string;
  /** Value when the item shipped. Written ONCE, never edited. */
  shipValue?: number;
  /** Value before the item shipped. Written ONCE, never edited. */
  baselineValue?: number;
  /**
   * The regime the reference value was measured under: corpus hash, golden-set
   * version and split scheme. If the current run does not match, the reference
   * describes a world that no longer exists and comparing against it is
   * meaningless — the signal reports `stale-baseline`, NOT `DECAYED`.
   *
   * This exists because it fired on its first run: the item-1 gate's 0.500
   * baseline was measured on the rank-based split, and the stability fix
   * changed DEV membership. The suite dutifully reported DECAYED for a number
   * that had not regressed at all — it had been re-measured over a different
   * set. A false alarm is not harmless: it teaches people to ignore the alarm.
   */
  measuredUnder?: { corpusHash?: string; goldenSetVersion?: string; splitScheme?: string };
}

/**
 * Why a delta came out flat. Three different situations produce an identical
 * null row and only one of them justifies dropping an item, so a null must say
 * which it is. `cannot-see-mechanism` is the DEFAULT: claiming "no effect"
 * requires first showing the harness could have seen an effect.
 */
export type NullVerdict =
  | 'no-effect'             // the harness could see the mechanism; there was none
  | 'cannot-see-mechanism'  // wrong store profile / fixture lacked the phenomenon
  | 'redundant'             // real, but already delivered by another shipped item
  | 'undetermined';         // below the noise floor; n too small to say anything

export interface SignalResult {
  id: string;
  item: string;
  claim: string;
  metric: string;
  declaredAt: string;
  currentValue: number | null;
  shipValue: number | null;
  baselineValue: number | null;
  /** Movement since ship time. Negative for a signal declared 'increase' is decay. */
  deltaSinceShip: number | null;
  verdict: 'holding' | 'DECAYED' | 'cannot-see' | 'not-yet-shipped' | 'below-noise-floor' | 'stale-baseline';
  nullVerdict?: NullVerdict;
  note: string;
}

/** Read a dotted path, tolerating keys that themselves contain dots. */
export function readMetric(report: unknown, dotted: string): number | null {
  const tryPath = (obj: any, parts: string[]): unknown => {
    let cur = obj;
    for (const p of parts) {
      if (cur === null || typeof cur !== 'object' || !(p in cur)) return undefined;
      cur = cur[p];
    }
    return cur;
  };
  const parts = dotted.split('.');
  // Greedy re-join: metric keys like "dense-only (gte-modernbert-base)" contain no dots
  // today, but model names routinely do (e.g. all-MiniLM-L6-v2.1).
  for (let join = 1; join <= parts.length; join++) {
    for (let start = 0; start + join <= parts.length; start++) {
      const candidate = [
        ...parts.slice(0, start),
        parts.slice(start, start + join).join('.'),
        ...parts.slice(start + join),
      ];
      const v = tryPath(report, candidate);
      if (typeof v === 'number') return v;
    }
  }
  return null;
}

/**
 * THE PERSISTENT REGRESSION SUITE.
 *
 * Append one entry per shipped item, with `shipValue` and `baselineValue`
 * frozen at ship time. Never edit an existing entry: an edited prediction is
 * not a prediction. Every future scoreboard row re-scores all of them.
 */
export const SIGNAL_REGISTRY: PreRegisteredSignal[] = [
  // Item 0 is the instrument itself. Its signal is that the instrument keeps
  // discriminating: if the weak-baseline gap collapses, the golden set has
  // stopped being able to tell systems apart and every later row is worthless.
  {
    id: 'item-0-discriminative-power',
    item: '0',
    declaredAt: '2026-07-28',
    claim: 'The golden set can still tell a real retriever apart from a random one. If the ' +
           'random floor ever approaches the real stack, the eval has gone vacuous and no ' +
           'row measured after that point means anything.',
    metric: 'headline.randomFloorRecallAt5',
    direction: 'no-worse-than',
    expectedMagnitude: 0.05,
    visibleIn: ['fresh', 'polluted-live', 'eval-fixture'],
    decayCondition:
      'Corpus shrinks, top_k grows toward corpus size, or golden pairs are added whose ' +
      'relevant sets are so broad that a random draw hits one.',
    shipValue: 0.0,
    baselineValue: 0.0,
  },
  {
    id: 'item-0b-model-provisioned-never-fetched',
    item: '0b',
    declaredAt: '2026-07-28',
    claim: 'The eval NEVER fetches the embedding model. Weights are provisioned by an explicit, ' +
           'non-query-time step (`doc eval --provision-model`); the eval asserts their presence ' +
           'and refuses to run without them. Scores 1 only when the weights were on disk before ' +
           'any query AND the query phase was network-blocked AND nothing was fetched.',
    metric: 'method.provisioningIntact',
    direction: 'no-worse-than',
    expectedMagnitude: 0,
    // Not profile-dependent: a hub fetch is a hub fetch in any store.
    visibleIn: ['fresh', 'polluted-live', 'eval-fixture'],
    decayCondition:
      'ANY change to the embedding model, its version, or its resolution path reintroduces a hub ' +
      'fetch. This explicitly includes item 2 (EmbeddingGemma / Qwen3), whose weights travel the ' +
      'same path with a far larger payload — so 0b is a hard precondition on item 2, and this ' +
      'signal is the thing that will notice if item 2 quietly undoes it.',
    // Pre-fix behaviour was demonstrated FAILING before the fix existed: a
    // cold-cache run downloaded ~91MB while its report said "0 attempts".
    baselineValue: 0,
    shipValue: 1,
  },
  {
    id: 'item-4b-i-no-ghost-entries',
    item: '4b-i',
    declaredAt: '2026-07-28',
    claim: 'The live store contains zero entries whose source file no longer exists. ' +
           'Reconciliation removes ghosts; the count stays at zero across sessions.',
    metric: 'liveStore.ghostCount',
    direction: 'no-worse-than',
    expectedMagnitude: 0,
    // NOT 'fresh' — fresh stores have no ghosts by construction.
    visibleIn: ['polluted-live'],
    decayCondition:
      'Any ingest path that writes to the store without checking source-file existence. ' +
      'Four paths were identified in cycle 1 (CLI doc ingest, MCP knowledge_ingest, live watcher, ' +
      'eval harness). If a fifth path is added without the guard, ghosts return.',
    baselineValue: 111,
    shipValue: 0,
  },
  {
    id: 'item-6a-chunk-enrichment-low-overlap',
    item: '6a',
    declaredAt: '2026-07-28',
    claim: 'Contextual chunk enrichment (doc title + full heading path + doc summary) improves ' +
           'Recall@5 in the low-overlap tercile where dense retrieval is our only working arm. ' +
           'The enrichment gives chunks vocabulary a forgetful user\'s query might match — ' +
           '"Code Implementation Agent" surfaces when the user asks about "the coder" even if ' +
           'the chunk text only says "Memory Coordination".',
    metric: 'results.dense-only (gte-modernbert-base).terciles.low.recallAt5',
    direction: 'increase',
    // Conservative: literature reports ~35% failure reduction with LLM-generated context;
    // our zero-LLM version is weaker, but 75.8% of chunks get meaningfully different
    // content. At n≈20 low-overlap pairs on DEV, noise floor is large (~0.10).
    expectedMagnitude: 0.05,
    // Enrichment changes what gets EMBEDDED, so it is visible in any store built after
    // the change — including the eval's 'fresh' corpus rebuild.
    visibleIn: ['fresh', 'eval-fixture'],
    decayCondition:
      'Any change that bypasses enrichChunks in the ingest path: a new ingest caller that ' +
      'stores raw chunks, a chunker that pre-applies its own incompatible prefix, or an ' +
      'embedding model change that is insensitive to contextual prefixes. Also decays if ' +
      'the enrichment format is changed to produce less discriminative text (e.g. dropping ' +
      'the doc title or flattening the heading hierarchy back to a single leaf).',
  },
  {
    id: 'item-1-low-overlap-tercile-not-damaged',
    item: '1',
    declaredAt: '2026-07-28',
    claim: 'Hybrid BM25+dense fusion must NOT reduce Recall@5 in the low-overlap tercile. ' +
           'That tercile is the only place dense retrieval currently beats BM25 (0.500 vs ' +
           '0.182 at baseline), and it is the closest proxy we have to real user queries. ' +
           'A fusion that raises the aggregate by flattening it is a regression sold as a win.',
    metric: 'results.dense-only (gte-modernbert-base).terciles.low.recallAt5',
    direction: 'no-worse-than',
    expectedMagnitude: 0.0,
    visibleIn: ['fresh', 'eval-fixture'],
    decayCondition:
      'Fusion weighting drifts toward the lexical component, or a reranker trained on ' +
      'lexical overlap is placed after fusion.',
    baselineValue: 0.5,
    measuredUnder: {
      corpusHash: '03eb078dcb6c2cc7',
      goldenSetVersion: 'v1 (2026-07-28)',
      // Rank-within-tag-group. Replaced by stable hash-threshold assignment
      // because the rank scheme silently reassigned pairs as the set grew.
      splitScheme: 'rank-v1',
    },
  },
  {
    id: 'item-2-embedding-swap-quality',
    item: '2',
    declaredAt: '2026-07-30',
    claim: 'Swapping the embedding model from all-MiniLM-L6-v2 (384d) to gte-modernbert-base ' +
           '(768d, q8 quantised) improves Recall@5 on the dev split. The bigger model captures ' +
           'more semantic nuance, especially for low-overlap paraphrase queries.',
    metric: 'results.dense-only (gte-modernbert-base).scoreboard.recallAt5',
    direction: 'increase',
    // Row 3 (MiniLM, un-enriched): R@5 0.364.  Row 5 (gte-modernbert-base): R@5 0.492.
    // Delta = +0.128. Declared conservatively at the observed magnitude.
    expectedMagnitude: 0.10,
    // The embedding model determines what gets stored in the vector index, so
    // this is visible in any store built after the swap — including the eval's
    // rebuilt corpus.
    visibleIn: ['fresh', 'eval-fixture'],
    decayCondition:
      'Any change that replaces or quantises the embedding model to a weaker representation: ' +
      'a model swap to a smaller variant, a broken ONNX export that silently degrades vectors, ' +
      'or a dtype change from q8 to a more aggressive quantisation that loses retrieval quality. ' +
      'Also decays if the enrichment that was co-validated in row 5 is removed, since the ' +
      'measured +0.128 includes both the model swap and the enrichment from item 6a.',
    baselineValue: 0.364,
    shipValue: 0.492,
  },
];

export interface Regime { corpusHash: string; goldenSetVersion: string; splitScheme: string }

export function scoreSignals(
  report: unknown,
  storeProfile: StoreProfile,
  noiseFloor: number,
  regime?: Regime,
): SignalResult[] {
  return SIGNAL_REGISTRY.map((s): SignalResult => {
    const base = {
      id: s.id, item: s.item, claim: s.claim, metric: s.metric, declaredAt: s.declaredAt,
      shipValue: s.shipValue ?? null, baselineValue: s.baselineValue ?? null,
    };

    if (!s.visibleIn.includes(storeProfile)) {
      return {
        ...base, currentValue: null, deltaSinceShip: null,
        verdict: 'cannot-see', nullVerdict: 'cannot-see-mechanism',
        note: `Signal is invisible in a '${storeProfile}' store; it needs one of: ` +
              `${s.visibleIn.join(', ')}. A flat number here means the harness could not ` +
              `see the mechanism, NOT that the item had no effect.`,
      };
    }

    const current = readMetric(report, s.metric);
    if (current === null) {
      return {
        ...base, currentValue: null, deltaSinceShip: null,
        verdict: 'cannot-see', nullVerdict: 'cannot-see-mechanism',
        note: `Metric path "${s.metric}" is absent from this report — the instrument changed ` +
              `shape and this signal is no longer being measured.`,
      };
    }

    const ref = s.shipValue ?? s.baselineValue;
    if (ref === undefined || ref === null) {
      return { ...base, currentValue: current, deltaSinceShip: null, verdict: 'not-yet-shipped',
        note: 'No ship value recorded yet; nothing to regress against.' };
    }

    // A reference measured under a different corpus, golden set or split
    // scheme is not a reference. Report it stale rather than manufacturing a
    // regression out of a discontinuity.
    const mu = s.measuredUnder;
    if (regime && mu) {
      const drift: string[] = [];
      if (mu.corpusHash && mu.corpusHash !== regime.corpusHash) drift.push(`corpus ${mu.corpusHash} -> ${regime.corpusHash}`);
      if (mu.goldenSetVersion && mu.goldenSetVersion !== regime.goldenSetVersion) drift.push(`golden set ${mu.goldenSetVersion} -> ${regime.goldenSetVersion}`);
      if (mu.splitScheme && mu.splitScheme !== regime.splitScheme) drift.push(`split scheme ${mu.splitScheme} -> ${regime.splitScheme}`);
      if (drift.length > 0) {
        return { ...base, currentValue: current, deltaSinceShip: null, verdict: 'stale-baseline',
          nullVerdict: 'undetermined',
          note: `Reference was measured under a regime that no longer exists (${drift.join('; ')}). ` +
                `Current value ${current.toFixed(3)} is NOT comparable to it. Re-baseline before ` +
                `treating any movement here as signal.` };
      }
    }

    const delta = current - ref;
    const wanted = s.direction === 'decrease' ? -delta : delta;

    // A movement smaller than the noise floor is not evidence in EITHER
    // direction — it cannot confirm the win and it cannot condemn it.
    if (Math.abs(delta) < noiseFloor) {
      return { ...base, currentValue: current, deltaSinceShip: delta, verdict: 'holding',
        note: `Within the noise floor (${noiseFloor.toFixed(3)}); no detectable movement.` };
    }
    if (wanted < 0) {
      return { ...base, currentValue: current, deltaSinceShip: delta, verdict: 'DECAYED',
        note: `Moved ${delta.toFixed(3)} against its declared direction (${s.direction}), ` +
              `beyond the ${noiseFloor.toFixed(3)} noise floor. Declared decay condition: ` +
              `${s.decayCondition}` };
    }
    return { ...base, currentValue: current, deltaSinceShip: delta, verdict: 'holding',
      note: `Moved ${delta.toFixed(3)} in its declared direction.` };
  });
}
