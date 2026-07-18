/**
 * Query Router + RRF fusion — Phase 4 of the cognee port plan.
 *
 * routeQuery: cognee's rule-based (non-LLM) recall router scaled to our four
 * retrieval surfaces — document chunks, knowledge-graph triplets, distilled
 * rules, and org/pattern memories. Weighted regex rules with a negation
 * window, a confidence gate (winner must be ≥2× runner-up), and an in-memory
 * misroute counter for debuggability.
 *
 * rrfFuse: Reciprocal Rank Fusion across result lists whose raw scores are
 * not comparable (cosine vs blended vs keyword) — `Σ 1/(rrf_k + rank + 1)`
 * with cognee's adaptive rrf_k = max(30, min(60, 20 + 2·top_k)).
 *
 * @module v1/cli/memory/query-router
 */

export type RetrievalSurface = 'chunks' | 'kg' | 'rules' | 'memory';

interface RouteRule {
  surface: RetrievalSurface;
  pattern: RegExp;
  weight: number;
}

// Order matters only for tie display; scoring is additive per surface.
const ROUTE_RULES: RouteRule[] = [
  // Rules: "how should I", conventions, policies, dos and don'ts.
  { surface: 'rules', pattern: /\b(rules?|conventions?|policy|policies|guidelines?|best practices?|should (i|we|you)|always|never|allowed|forbidden)\b/i, weight: 2 },
  // KG: relationships, structure, "how does X relate to / depend on Y", who/what connects.
  { surface: 'kg', pattern: /\b(relat(e|es|ed|ionship)|depend(s|ency|encies)?|connect(s|ed|ion)?|link(s|ed)?|between|structure|architecture|who (owns|maintains|uses)|what (uses|calls|imports))\b/i, weight: 2 },
  { surface: 'kg', pattern: /\b(entity|entities|graph|triplet)\b/i, weight: 1.5 },
  // Memory: past runs/decisions/outcomes/history.
  { surface: 'memory', pattern: /\b(last (run|time)|previous(ly)?|history|past|earlier|before|decision|decided|outcome|learned|remember)\b/i, weight: 2 },
  // Chunks: docs/specs/definitions/how-to content.
  { surface: 'chunks', pattern: /\b(doc(s|ument|umentation)?|spec|readme|guide|manual|note(s)?|wrote|written|what is|how (do|to)|explain|describe|definition)\b/i, weight: 1.5 },
];

/** Negated mentions must not vote: "not about the architecture" (cognee uses
 *  a 20-char pre-match negation window; same here). */
const NEGATION_RE = /\b(not?|without|except|ignore|don'?t|excluding)\b[^.!?]{0,20}$/i;

export interface RouteDecision {
  /** Surfaces to hit, best first. Always non-empty ('chunks' is the fallback). */
  surfaces: RetrievalSurface[];
  /** Winner's score ≥ 2× runner-up (cognee's confidence gate). Low-confidence
   *  routes should hit ALL surfaces and fuse. */
  confident: boolean;
  scores: Record<RetrievalSurface, number>;
}

const overrideCounts: Record<string, number> = {};

export function routeQuery(query: string): RouteDecision {
  const q = String(query ?? '').slice(0, 2000);
  const scores: Record<RetrievalSurface, number> = { chunks: 0.5, kg: 0, rules: 0, memory: 0 }; // chunks = weak prior

  for (const rule of ROUTE_RULES) {
    for (const m of q.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags + 'g'))) {
      const before = q.slice(Math.max(0, (m.index ?? 0) - 26), m.index ?? 0);
      if (NEGATION_RE.test(before)) continue;
      scores[rule.surface] += rule.weight;
    }
  }

  const ranked = (Object.entries(scores) as [RetrievalSurface, number][])
    .sort((a, b) => b[1] - a[1]);
  const [winner, runnerUp] = ranked;
  const confident = winner[1] >= 2 * Math.max(runnerUp[1], 0.25);

  const surfaces = confident
    ? [winner[0]]
    : ranked.filter(([, s]) => s > 0).map(([k]) => k);
  return { surfaces: surfaces.length ? surfaces : ['chunks'], confident, scores };
}

/** Call when a route proved wrong (caller retried another surface) — counts
 *  feed debugging, mirroring cognee's record_override telemetry. */
export function recordRouteOverride(from: RetrievalSurface, to: RetrievalSurface): void {
  const key = `${from}->${to}`;
  overrideCounts[key] = (overrideCounts[key] ?? 0) + 1;
}
export function getRouteOverrides(): Record<string, number> {
  return { ...overrideCounts };
}

// ── Reciprocal Rank Fusion ──────────────────────────────────────────

export interface FusableResult {
  /** Stable identity across lists (id or key). */
  id: string;
  /** Importance factor input in [0,1]; defaults 0.5. */
  importance?: number;
  [extra: string]: unknown;
}

/** Fuse ranked lists via RRF × importance factor (cognee hybrid/ranking.py).
 *  Input lists must each be ranked best-first; raw scores are ignored. */
export function rrfFuse<T extends FusableResult>(lists: T[][], topK: number): (T & { rrf: number })[] {
  const rrfK = Math.max(30, Math.min(60, 20 + 2 * topK));
  const byId = new Map<string, { item: T; rrf: number }>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const importance = typeof item.importance === 'number' ? item.importance : 0.5;
      const contribution = (1 / (rrfK + rank + 1)) * (0.75 + 0.5 * importance);
      const existing = byId.get(item.id);
      if (existing) existing.rrf += contribution;
      else byId.set(item.id, { item, rrf: contribution });
    });
  }
  return [...byId.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, topK)
    .map(({ item, rrf }) => ({ ...item, rrf }));
}
