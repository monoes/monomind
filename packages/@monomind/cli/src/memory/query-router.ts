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

import fs from 'node:fs';
import path from 'node:path';

export type RetrievalSurface = 'chunks' | 'kg' | 'rules' | 'memory';

// ── Retrieval contract (graph-boundaries review B3) ──────────────────
//
// `knowledge_search` is a retrieval INTERFACE, not a store: the same tool name
// is served by different implementations (MCP fuses four surfaces; the org
// runtime's tool searches documents only). A caller could not tell which one
// answered. Every retrieval result now names the surfaces it asked for, ran,
// failed on, and cannot serve — using one vocabulary across implementations.

/** A retrieval surface by its real identity, not by the tool that fronts it.
 *  `code_graph` is Monograph (parsed code) and is never served by knowledge
 *  search — it appears in a report precisely so its absence is stated. */
export type KnowledgeSurface =
  | 'documents' // Second Brain document index
  | 'memory_graph' // memory knowledge graph — remembered claims, not code
  | 'rules' // distilled rules
  | 'memory' // flat memories / patterns
  | 'code_graph'; // Monograph code graph

/** Router surface names → contract names. The router's vocabulary predates the
 *  contract and is still what `--surfaces` / `surfaces:[]` accept. */
export const SURFACE_IDS: Record<RetrievalSurface, KnowledgeSurface> = {
  chunks: 'documents',
  kg: 'memory_graph',
  rules: 'rules',
  memory: 'memory',
};

export type SurfaceStatus =
  /** Ran and returned something. */
  | 'executed'
  /** Ran and legitimately had nothing — distinct from unavailable. */
  | 'empty'
  /** Attempted and errored; absence here is not evidence of absence. */
  | 'failed'
  /** This implementation cannot search it at all. */
  | 'unsupported'
  /** Not part of this query's route. */
  | 'not_requested';

export interface SurfaceOutcome {
  surface: KnowledgeSurface;
  status: SurfaceStatus;
  /** Which store/graph was actually read. */
  scope?: { store?: 'project' | 'global' | 'all'; org?: string };
  /** What retrieval actually ran — never what was requested. Propagated from
   *  the memory bridge (`semantic` / `keyword` / `keyword-fallback`) so a
   *  keyword fallback can never be presented as vector-seeded search. */
  method?: string;
  /** Why the vector path did not serve these results, when it did not. */
  fallbackReason?: string;
  results?: number;
  /** The surface did not cover its whole namespace; results are incomplete. */
  truncated?: boolean;
  detail?: string;
}

export interface RetrievalReport {
  requested: KnowledgeSurface[];
  executed: KnowledgeSurface[];
  failed: KnowledgeSurface[];
  unsupported: KnowledgeSurface[];
  surfaces: SurfaceOutcome[];
}

/** Roll per-surface outcomes into the four lists callers actually branch on.
 *  `executed` covers 'empty' too: the surface answered, the answer was none. */
export function buildRetrievalReport(outcomes: SurfaceOutcome[]): RetrievalReport {
  const of = (...s: SurfaceStatus[]): KnowledgeSurface[] =>
    outcomes.filter((o) => s.includes(o.status)).map((o) => o.surface);
  return {
    requested: of('executed', 'empty', 'failed', 'unsupported'),
    executed: of('executed', 'empty'),
    failed: of('failed'),
    unsupported: of('unsupported'),
    surfaces: outcomes,
  };
}

interface RouteRule {
  surface: RetrievalSurface;
  pattern: RegExp;
  weight: number;
}

// Order matters only for tie display; scoring is additive per surface.
const ROUTE_RULES: RouteRule[] = [
  // Rules: "how should I", conventions, policies, dos and don'ts.
  {
    surface: 'rules',
    pattern:
      /\b(rules?|conventions?|policy|policies|guidelines?|best practices?|should (i|we|you)|always|never|allowed|forbidden)\b/i,
    weight: 2,
  },
  // KG: relationships, structure, "how does X relate to / depend on Y", who/what connects.
  // NOTE: "what calls/imports/uses" is deliberately NOT here — see CODE_QUERY_RE.
  {
    surface: 'kg',
    pattern:
      /\b(relat(e|es|ed|ionship)|depend(s|ency|encies)?|connect(s|ed|ion)?|link(s|ed)?|between|structure|architecture|who (owns|maintains))\b/i,
    weight: 2,
  },
  { surface: 'kg', pattern: /\b(entity|entities|graph|triplet)\b/i, weight: 1.5 },
  // Memory: past runs/decisions/outcomes/history.
  {
    surface: 'memory',
    pattern:
      /\b(last (run|time)|previous(ly)?|history|past|earlier|before|decision|decided|outcome|learned|remember)\b/i,
    weight: 2,
  },
  // Chunks: docs/specs/definitions/how-to content.
  {
    surface: 'chunks',
    pattern:
      /\b(doc(s|ument|umentation)?|spec|readme|guide|manual|note(s)?|wrote|written|what is|how (do|to)|explain|describe|definition)\b/i,
    weight: 1.5,
  },
];

/** Questions about what the CODE does — callers, imports, references. These
 *  read like graph questions and used to score for `kg`, which is the MEMORY
 *  knowledge graph: the query got answered from what someone once asserted
 *  rather than from parsed code, and a non-empty result meant the chunks
 *  fallback never corrected it. Monograph is the surface that can answer them;
 *  knowledge search cannot, and must say so. */
const CODE_QUERY_RE =
  /\b(?:what|which|who|where)\s+(?:code\s+)?(?:calls?|imports?|references?|uses|requires?)\b|\bcall(?:ers?|ees?|[-\s]graph)\b|\b(?:imported|referenced|called)\s+by\b|\b(?:dependents?|dependencies|references?|callers?|usages?)\s+of\b|\bimpact\s+of\s+(?:changing|renaming)\b/i;

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
  /** The query asks about code structure (callers/imports/references). No
   *  knowledge-search surface can answer it — Monograph can. Callers must
   *  either route to Monograph or report `code_graph` as not searched. */
  codeQuery: boolean;
}

const overrideCounts: Record<string, number> = {};

/** Overrides persist across processes (the CLI is one-shot — an in-memory
 *  counter alone evaporates before doctor/debugging can read it). Best-effort
 *  read-merge-write of a tiny JSON file; never throws into the caller. */
const OVERRIDES_FILE = ['.monomind', 'metrics', 'route-overrides.json'];
function persistOverride(key: string): void {
  try {
    const file = path.join(process.cwd(), ...OVERRIDES_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let disk: Record<string, number> = {};
    try {
      disk = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, number>;
    } catch {
      /* fresh file */
    }
    disk[key] = (typeof disk[key] === 'number' ? disk[key] : 0) + 1;
    fs.writeFileSync(file, JSON.stringify(disk, null, 2));
  } catch {
    /* telemetry must never block or throw */
  }
}

export function routeQuery(query: string): RouteDecision {
  const q = String(query ?? '').slice(0, 2000);
  const scores: Record<RetrievalSurface, number> = { chunks: 0.5, kg: 0, rules: 0, memory: 0 }; // chunks = weak prior

  for (const rule of ROUTE_RULES) {
    for (const m of q.matchAll(new RegExp(rule.pattern.source, `${rule.pattern.flags}g`))) {
      const before = q.slice(Math.max(0, (m.index ?? 0) - 26), m.index ?? 0);
      if (NEGATION_RE.test(before)) continue;
      scores[rule.surface] += rule.weight;
    }
  }

  const ranked = (Object.entries(scores) as [RetrievalSurface, number][]).sort(
    (a, b) => b[1] - a[1],
  );
  const [winner, runnerUp] = ranked;
  const confident = winner[1] >= 2 * Math.max(runnerUp[1], 0.25);

  const surfaces = confident ? [winner[0]] : ranked.filter(([, s]) => s > 0).map(([k]) => k);

  let codeQuery = false;
  for (const m of q.matchAll(new RegExp(CODE_QUERY_RE.source, `${CODE_QUERY_RE.flags}g`))) {
    const before = q.slice(Math.max(0, (m.index ?? 0) - 26), m.index ?? 0);
    if (NEGATION_RE.test(before)) continue;
    codeQuery = true;
    break;
  }

  return { surfaces: surfaces.length ? surfaces : ['chunks'], confident, scores, codeQuery };
}

/** Call when a route proved wrong (caller retried another surface) — counts
 *  feed debugging, mirroring cognee's record_override telemetry. */
export function recordRouteOverride(from: RetrievalSurface, to: RetrievalSurface): void {
  const key = `${from}->${to}`;
  overrideCounts[key] = (overrideCounts[key] ?? 0) + 1;
  persistOverride(key);
}
/** In-memory counts from this process only; pass merged=true to include the
 *  persisted cross-process counts from .monomind/metrics/route-overrides.json. */
export function getRouteOverrides(merged = false): Record<string, number> {
  if (!merged) return { ...overrideCounts };
  try {
    const disk = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), ...OVERRIDES_FILE), 'utf-8'),
    ) as Record<string, number>;
    return { ...disk }; // disk already includes this process's persisted increments
  } catch {
    return { ...overrideCounts };
  }
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
export function rrfFuse<T extends FusableResult>(
  lists: T[][],
  topK: number,
): (T & { rrf: number })[] {
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
