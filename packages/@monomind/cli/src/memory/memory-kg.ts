/**
 * Memory Knowledge Graph — entities, relations, and rules distilled from
 * agent sessions and org runs (cognee-concept port, Phase 2 of
 * docs/mastermind/2026-07-19-cognee-port-plan.md).
 *
 * Storage rides store A (memory-bridge) rather than a dedicated SQLite DB:
 * nodes live in namespace `kg:nodes`, edges in `kg:edges`, distilled rules
 * additionally in `rules` (so existing knowledge/injection surfaces find them).
 * That buys embeddings, upsert, sql.js fallback, and the Phase 1
 * feedback/frequency weighting for free — KG node ranking improves with use
 * automatically.
 *
 * Identity is deterministic (cognee's DataPoint.id_for): the entry KEY is
 * `n:<type>:<normalized-name>`, so the same entity extracted from any session
 * merges idempotently via upsert. Every write carries `origin_refs` so a bad
 * ingest can be rolled back per run/session.
 *
 * // monolean: graph traversal is in-process over a full kg:edges list —
 * // fine to ~10k edges; upgrade path is a real SQLite edges table with
 * // indexed src/dst columns if orgs outgrow that.
 *
 * @module v1/cli/memory/memory-kg
 */

import {
  bridgeStoreEntry,
  bridgeSearchEntries,
  bridgeListEntries,
  bridgeGetEntry,
  bridgeDeleteEntry,
} from './memory-bridge.js';

export const KG_NODES_NS = 'kg:nodes';
export const KG_EDGES_NS = 'kg:edges';
export const RULES_NS = 'rules';

const MAX_NAME_LEN = 200;
const MAX_DESC_LEN = 2000;
const MAX_LIST = 10_000;

export interface KgNodeInput {
  name: string;
  /** Basic type, cognee-style ("Person", "Tool", "Service") — not over-specific. */
  type?: string;
  description?: string;
  nodeSet?: string;
}
export interface KgEdgeInput {
  source: string;
  target: string;
  /** snake_case relation name. */
  relation: string;
  /** One-sentence concrete fact using the endpoint names. */
  description?: string;
  sourceType?: string;
  targetType?: string;
}

export interface KgIngestResult {
  success: boolean;
  nodesAdded: number;
  nodesMerged: number;
  edgesAdded: number;
  edgesMerged: number;
  error?: string;
}

/** cognee DataPoint normalization: lowercase, spaces→_, strip apostrophes. */
export function normalizeName(name: string): string {
  return String(name).trim().toLowerCase().replace(/['’]/g, '').replace(/\s+/g, '_').slice(0, MAX_NAME_LEN);
}

/** Identity is NAME-ONLY (cognee's Entity.identity_fields = ["name"]) — type
 *  lives in metadata. Including type in the key forked the same entity when
 *  the LLM said "Module" and the heuristic said "entity". */
export function nodeKey(_type: string, name: string): string {
  return `n:${normalizeName(name)}`;
}

function edgeKey(srcKey: string, relation: string, dstKey: string): string {
  return `e:${srcKey}|${normalizeName(relation)}|${dstKey}`;
}

// ── Ingest ──────────────────────────────────────────────────────────

/** Idempotently merge extracted nodes/edges into the KG. Same-name entities
 *  collapse onto one node (deterministic key + upsert); origin_refs accumulate
 *  so rollback can undo a single run's contribution. */
export async function kgIngest(options: {
  nodes: KgNodeInput[];
  edges?: KgEdgeInput[];
  /** Provenance: run id, session id, or doc hash this extraction came from. */
  originRef: string;
  dbPath?: string;
}): Promise<KgIngestResult> {
  const { originRef, dbPath } = options;
  let nodesAdded = 0, nodesMerged = 0, edgesAdded = 0, edgesMerged = 0;

  try {
    const keyByName = new Map<string, string>();
    for (const n of (options.nodes ?? []).slice(0, 500)) {
      if (!n?.name?.trim()) continue;
      const type = n.type?.trim() || 'entity';
      const key = nodeKey(type, n.name);
      keyByName.set(normalizeName(n.name), key);
      const desc = (n.description ?? '').slice(0, MAX_DESC_LEN);

      const existing = await bridgeGetEntry({ key, namespace: KG_NODES_NS, dbPath });
      if (existing?.found && existing.entry) {
        const md = existing.entry.metadata as Record<string, unknown>;
        const origins = Array.isArray(md.origin_refs) ? (md.origin_refs as string[]) : [];
        if (!origins.includes(originRef)) origins.push(originRef);
        // Prefer the richer description; never let a terse re-extraction erase detail.
        const prevDesc = typeof md.description === 'string' ? md.description : '';
        const bestDesc = desc.length > prevDesc.length ? desc : prevDesc;
        // Keep the most specific type: a generic heuristic 'entity' never
        // overwrites an LLM-assigned type.
        const prevType = typeof md.type === 'string' ? md.type : 'entity';
        const bestType = prevType.toLowerCase() !== 'entity' ? prevType : type;
        await bridgeStoreEntry({
          key,
          value: `${n.name} — ${bestDesc || bestType}`,
          namespace: KG_NODES_NS,
          dbPath,
          upsert: true,
          tags: ['kg', normalizeName(bestType), ...(n.nodeSet ? [normalizeName(n.nodeSet)] : [])],
          metadata: {
            ...md,
            kg: 'node', type: bestType, name: n.name, description: bestDesc,
            node_set: n.nodeSet ?? md.node_set ?? null,
            origin_refs: origins.slice(-100),
            version: (typeof md.version === 'number' ? md.version : 1) + 1,
            valid_from: md.valid_from ?? Date.now(),
            valid_to: null,
          },
        });
        nodesMerged++;
      } else {
        await bridgeStoreEntry({
          key,
          value: `${n.name} — ${desc || type}`,
          namespace: KG_NODES_NS,
          dbPath,
          upsert: true,
          tags: ['kg', normalizeName(type), ...(n.nodeSet ? [normalizeName(n.nodeSet)] : [])],
          metadata: {
            kg: 'node', type, name: n.name, description: desc,
            node_set: n.nodeSet ?? null,
            origin_refs: [originRef],
            version: 1,
            valid_from: Date.now(),
            valid_to: null,
          },
        });
        nodesAdded++;
      }
    }

    for (const e of (options.edges ?? []).slice(0, 1000)) {
      if (!e?.source?.trim() || !e?.target?.trim() || !e?.relation?.trim()) continue;
      const srcKey = keyByName.get(normalizeName(e.source)) ?? nodeKey(e.sourceType ?? 'entity', e.source);
      const dstKey = keyByName.get(normalizeName(e.target)) ?? nodeKey(e.targetType ?? 'entity', e.target);
      const key = edgeKey(srcKey, e.relation, dstKey);
      const desc = (e.description ?? '').slice(0, MAX_DESC_LEN);

      const existing = await bridgeGetEntry({ key, namespace: KG_EDGES_NS, dbPath });
      if (existing?.found && existing.entry) {
        const md = existing.entry.metadata as Record<string, unknown>;
        const origins = Array.isArray(md.origin_refs) ? (md.origin_refs as string[]) : [];
        if (!origins.includes(originRef)) origins.push(originRef);
        await bridgeStoreEntry({
          key,
          value: desc || `${e.source} ${e.relation} ${e.target}`,
          namespace: KG_EDGES_NS,
          dbPath,
          upsert: true,
          generateEmbeddingFlag: false,
          tags: ['kg', normalizeName(e.relation)],
          metadata: { ...md, origin_refs: origins.slice(-100) },
        });
        edgesMerged++;
      } else {
        await bridgeStoreEntry({
          key,
          value: desc || `${e.source} ${e.relation} ${e.target}`,
          namespace: KG_EDGES_NS,
          dbPath,
          upsert: true,
          generateEmbeddingFlag: false,
          tags: ['kg', normalizeName(e.relation)],
          metadata: {
            kg: 'edge', src: srcKey, dst: dstKey,
            relation: normalizeName(e.relation),
            source_name: e.source, target_name: e.target,
            description: desc,
            origin_refs: [originRef],
            valid_from: Date.now(),
            valid_to: null,
          },
        });
        edgesAdded++;
      }
    }

    return { success: true, nodesAdded, nodesMerged, edgesAdded, edgesMerged };
  } catch (err) {
    return {
      success: false, nodesAdded, nodesMerged, edgesAdded, edgesMerged,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Rules (two-stage distillation support) ──────────────────────────

export interface RuleVerdict {
  rule: string;
  verdict: 'accepted' | 'already_known' | 'invalid';
  similarTo?: string;
}

/** Stage-2 of cognee's curator/writer distillation: the CALLER (an LLM agent)
 *  proposes candidate rules; this accepts each unless a semantically
 *  near-identical rule exists (embedding dedup — deterministic keys can't
 *  collapse paraphrases). Accepted rules are stored both as KG nodes
 *  (node_set=rules) and as plain `rules`-namespace entries so the existing
 *  injection/search surfaces pick them up with zero new plumbing. */
export async function kgIngestRules(options: {
  rules: { rule: string; context?: string }[];
  originRef: string;
  dbPath?: string;
  /** Similarity above which a candidate is already_known (default 0.78 —
   *  MiniLM paraphrases of the same rule commonly land 0.78-0.9; cognee's
   *  equivalent control is prompt-injected LLM judgment, which we approximate). */
  dedupThreshold?: number;
}): Promise<{ success: boolean; verdicts: RuleVerdict[]; accepted: number; error?: string }> {
  const verdicts: RuleVerdict[] = [];
  const threshold = options.dedupThreshold ?? 0.78;
  let accepted = 0;

  try {
    for (const r of (options.rules ?? []).slice(0, 50)) {
      const rule = r?.rule?.trim();
      if (!rule || rule.length < 8) { verdicts.push({ rule: r?.rule ?? '', verdict: 'invalid' }); continue; }

      const similar = await bridgeSearchEntries({
        query: rule, namespace: RULES_NS, limit: 1, threshold, dbPath: options.dbPath,
      });
      const top = similar?.results?.[0];
      // Dedup on the RAW cosine (from provenance), not the blended rank score —
      // the Phase 1 feedback blend shifts scores and would corrupt the gate.
      const rawScore = top?.provenance?.startsWith('semantic:')
        ? parseFloat(top.provenance.slice('semantic:'.length)) : top?.score ?? 0;
      if (top && rawScore >= threshold) {
        verdicts.push({ rule, verdict: 'already_known', similarTo: top.key });
        continue;
      }

      const key = `rule:${normalizeName(rule).slice(0, 120)}`;
      await bridgeStoreEntry({
        key, value: rule + (r.context ? `\n(context: ${r.context.slice(0, 500)})` : ''),
        namespace: RULES_NS, dbPath: options.dbPath, upsert: true,
        tags: ['rule'],
        metadata: { origin_refs: [options.originRef], derived_from: options.originRef },
      });
      await kgIngest({
        nodes: [{ name: rule.slice(0, MAX_NAME_LEN), type: 'Rule', description: rule, nodeSet: 'rules' }],
        originRef: options.originRef,
        dbPath: options.dbPath,
      });
      verdicts.push({ rule, verdict: 'accepted' });
      accepted++;
    }
    return { success: true, verdicts, accepted };
  } catch (err) {
    return { success: false, verdicts, accepted, error: err instanceof Error ? err.message : String(err) };
  }
}

/** List stored rules (for injection or review). */
export async function kgListRules(options?: { dbPath?: string; limit?: number }): Promise<{ rule: string; key: string }[]> {
  const res = await bridgeListEntries({ namespace: RULES_NS, limit: options?.limit ?? 50, dbPath: options?.dbPath });
  return (res?.entries ?? []).map(e => ({ rule: e.content, key: e.key }));
}

// ── Search ──────────────────────────────────────────────────────────

export interface KgSearchResult {
  success: boolean;
  /** Rendered triplet lines, best first. */
  context: string;
  triplets: { source: string; relation: string; target: string; fact: string; score: number }[];
  seeds: { name: string; type: string; description: string; score: number; id: string }[];
  error?: string;
}

/** Vector-seed → neighborhood → triplet ranking (cognee's brute-force triplet
 *  search, scaled down). Seed scores already carry the Phase 1 feedback blend. */
export async function kgSearch(options: {
  query: string;
  dbPath?: string;
  limit?: number;
  nodeSet?: string;
}): Promise<KgSearchResult> {
  try {
    const limit = options.limit ?? 8;
    const seedsRes = await bridgeSearchEntries({
      query: options.query, namespace: KG_NODES_NS, limit: 15, threshold: 0.25, dbPath: options.dbPath,
    });
    let seedResults = seedsRes?.results ?? [];
    if (options.nodeSet) {
      const ns = normalizeName(options.nodeSet);
      seedResults = seedResults.filter(r => (r.tags ?? []).includes(ns));
    }
    if (!seedResults.length) return { success: true, context: '', triplets: [], seeds: [] };

    const seedScore = new Map<string, number>();
    for (const s of seedResults) seedScore.set(s.key, s.score);

    // Full edge scan (see monolean note in module header).
    const edgesRes = await bridgeListEntries({ namespace: KG_EDGES_NS, limit: MAX_LIST, dbPath: options.dbPath });
    const edges = (edgesRes?.entries ?? []).filter(e => {
      const md = e.metadata as Record<string, unknown>;
      return md?.kg === 'edge' && md.valid_to == null;
    });

    const triplets = edges
      .map(e => {
        const md = e.metadata as Record<string, unknown>;
        const src = String(md.src ?? ''); const dst = String(md.dst ?? '');
        const sSrc = seedScore.get(src) ?? 0; const sDst = seedScore.get(dst) ?? 0;
        if (sSrc === 0 && sDst === 0) return null;
        // Both endpoints seeded beats one; the unseeded endpoint contributes a
        // neutral 0.35 so bridging edges from a strong seed still surface.
        const score = (Math.max(sSrc, 0.35) + Math.max(sDst, 0.35)) / 2 + (sSrc > 0 && sDst > 0 ? 0.1 : 0);
        return {
          source: String(md.source_name ?? src),
          relation: String(md.relation ?? 'related_to'),
          target: String(md.target_name ?? dst),
          fact: e.content,
          score,
        };
      })
      .filter((t): t is NonNullable<typeof t> => !!t)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const seeds = seedResults.slice(0, limit).map(s => {
      // metadata is not in search results; parse from rendered content "name — description"
      const dash = s.content.indexOf(' — ');
      return {
        name: dash > 0 ? s.content.slice(0, dash) : s.key,
        type: s.key.split(':')[1] ?? 'entity',
        description: dash > 0 ? s.content.slice(dash + 3) : s.content,
        score: s.score,
        id: s.id,
      };
    });

    const context = [
      ...triplets.map(t => `${t.source} —${t.relation}→ ${t.target}${t.fact && t.fact !== `${t.source} ${t.relation} ${t.target}` ? ` (${t.fact})` : ''}`),
      ...(triplets.length ? [] : seeds.map(s => `${s.name}: ${s.description}`)),
    ].join('\n');

    return { success: true, context, triplets, seeds };
  } catch (err) {
    return { success: false, context: '', triplets: [], seeds: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Glossary (anti-duplicate-entity injection for extraction prompts) ──

export async function kgGlossary(options?: { dbPath?: string; limit?: number }): Promise<string[]> {
  const res = await bridgeListEntries({ namespace: KG_NODES_NS, limit: MAX_LIST, dbPath: options?.dbPath });
  const nodes = (res?.entries ?? [])
    // Glossary is for ENTITY name reuse — rule prose and extraction-source
    // Session nodes would drown it.
    .filter(e => {
      const md = e.metadata as Record<string, unknown>;
      const t = String(md?.type ?? '').toLowerCase();
      return md?.node_set !== 'rules' && t !== 'rule' && t !== 'session';
    })
    .map(e => {
      const md = e.metadata as Record<string, unknown>;
      const fw = typeof md.feedback_weight === 'number' ? md.feedback_weight : 0.5;
      const freq = typeof md.frequency_weight === 'number' ? md.frequency_weight : 0;
      const version = typeof md.version === 'number' ? md.version : 1;
      return { name: String(md.name ?? e.key), rank: version + freq + fw };
    })
    .sort((a, b) => b.rank - a.rank);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of nodes) {
    const norm = normalizeName(n.name);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(n.name);
    if (out.length >= (options?.limit ?? 40)) break;
  }
  return out;
}

// ── Rollback (per-origin bad-ingest recovery) ───────────────────────

/** Delete every node/edge/rule whose ONLY origin is `originRef`. Elements with
 *  other origins survive (shared knowledge isn't destroyed by one bad run);
 *  their origin lists retain the ref — acceptable residue.
 *  // monolean: no origin-list rewrite — needs an update-by-id bridge API */
export async function kgRollback(options: {
  originRef: string;
  dbPath?: string;
}): Promise<{ success: boolean; deleted: number; retained: number; error?: string }> {
  let deleted = 0, retained = 0;
  try {
    for (const ns of [KG_NODES_NS, KG_EDGES_NS, RULES_NS]) {
      const res = await bridgeListEntries({ namespace: ns, limit: MAX_LIST, dbPath: options.dbPath });
      for (const e of res?.entries ?? []) {
        const origins = (e.metadata as Record<string, unknown>)?.origin_refs;
        if (!Array.isArray(origins) || !origins.includes(options.originRef)) continue;
        if (origins.length <= 1) {
          const del = await bridgeDeleteEntry({ id: e.id, namespace: ns, dbPath: options.dbPath });
          if (del?.deleted) deleted++;
        } else {
          retained++;
        }
      }
    }
    return { success: true, deleted, retained };
  } catch (err) {
    return { success: false, deleted, retained, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Consolidation candidates (cognee consolidate_entity_descriptions) ──

export interface ConsolidationCandidate {
  name: string;
  type: string;
  description: string;
  edgeCount: number;
  /** Neighborhood facts to merge into one canonical description. */
  neighborhood: string[];
}

/** Entities whose descriptions are stale relative to their connectivity —
 *  the LLM half runs in the LIVE agent: it rewrites each candidate's
 *  description from the neighborhood facts and resubmits via memory_kg_ingest
 *  (longer descriptions win on merge). No LLM here (fully local constraint). */
export async function kgConsolidateCandidates(options?: {
  dbPath?: string;
  /** Minimum edges for a node to qualify (default 3). */
  minEdges?: number;
  limit?: number;
}): Promise<ConsolidationCandidate[]> {
  const minEdges = options?.minEdges ?? 3;
  const [nodesRes, edgesRes] = await Promise.all([
    bridgeListEntries({ namespace: KG_NODES_NS, limit: MAX_LIST, dbPath: options?.dbPath }),
    bridgeListEntries({ namespace: KG_EDGES_NS, limit: MAX_LIST, dbPath: options?.dbPath }),
  ]);
  const edgesByNode = new Map<string, string[]>();
  for (const e of edgesRes?.entries ?? []) {
    const md = e.metadata as Record<string, unknown>;
    for (const end of [String(md.src ?? ''), String(md.dst ?? '')]) {
      if (!end) continue;
      const list = edgesByNode.get(end) ?? [];
      list.push(e.content);
      edgesByNode.set(end, list);
    }
  }
  return (nodesRes?.entries ?? [])
    .map(n => {
      const md = n.metadata as Record<string, unknown>;
      const facts = edgesByNode.get(n.key) ?? [];
      return {
        name: String(md.name ?? n.key),
        type: String(md.type ?? 'entity'),
        description: String(md.description ?? ''),
        edgeCount: facts.length,
        neighborhood: facts.slice(0, 12),
      };
    })
    // Cap the growth target at MAX_DESC_LEN — a very-high-degree node whose
    // description is already at the cap can never "grow out" of candidacy and
    // would otherwise permanently occupy a slot.
    .filter(c => c.edgeCount >= minEdges && c.description.length < Math.min(40 * c.edgeCount, MAX_DESC_LEN))
    .sort((a, b) => b.edgeCount - a.edgeCount)
    .slice(0, options?.limit ?? 10);
}

// ── Stats ───────────────────────────────────────────────────────────

export async function kgStats(options?: { dbPath?: string }): Promise<{ nodes: number; edges: number; rules: number }> {
  const [n, e, r] = await Promise.all([
    bridgeListEntries({ namespace: KG_NODES_NS, limit: MAX_LIST, dbPath: options?.dbPath }),
    bridgeListEntries({ namespace: KG_EDGES_NS, limit: MAX_LIST, dbPath: options?.dbPath }),
    bridgeListEntries({ namespace: RULES_NS, limit: MAX_LIST, dbPath: options?.dbPath }),
  ]);
  return { nodes: n?.total ?? 0, edges: e?.total ?? 0, rules: r?.total ?? 0 };
}

// ── Heuristic extraction (LLM-less fallback) ────────────────────────

/** Regex extraction for when no LLM is in the loop (memory-palace lineage):
 *  proper-noun phrases and `code identifiers` become entities, sentence
 *  co-occurrence becomes relates_to edges. Lower-trust by design — real
 *  entity/relation quality comes from the LLM path (memory_kg_ingest called
 *  by the live agent, or the org coordinator's org_learn tool). */
export function heuristicExtract(text: string, opts?: { sourceName?: string }): { nodes: KgNodeInput[]; edges: KgEdgeInput[] } {
  const nodes = new Map<string, KgNodeInput>();
  const edges: KgEdgeInput[] = [];
  const src = String(text || '').slice(0, 50_000);

  const sentences = src.split(/(?<=[.!?])\s+|\n+/).slice(0, 400);
  const STOPWORDS = new Set(['The', 'This', 'That', 'These', 'Those', 'It', 'A', 'An', 'If', 'When', 'While', 'But', 'And', 'Or', 'For', 'Then', 'Also', 'Not', 'No', 'Yes', 'I', 'We', 'You', 'They', 'He', 'She', 'Run', 'Outcome', 'Assets', 'Goal', 'Org',
    'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);

  for (const sentence of sentences) {
    const found: string[] = [];
    // Proper-noun phrases: consecutive Capitalized words (2-40 chars each).
    for (const m of sentence.matchAll(/\b([A-Z][a-zA-Z0-9_-]{1,40}(?:\s+[A-Z][a-zA-Z0-9_-]{1,40}){0,3})\b/g)) {
      const phrase = m[1];
      if (STOPWORDS.has(phrase)) continue;
      found.push(phrase);
    }
    // Code identifiers in backticks or dotted/slashed paths.
    for (const m of sentence.matchAll(/`([^`\n]{2,80})`/g)) found.push(m[1]);

    const uniq = [...new Set(found)].slice(0, 8);
    for (const name of uniq) {
      if (!nodes.has(normalizeName(name))) {
        nodes.set(normalizeName(name), { name, type: /[./`(]/.test(name) ? 'CodeElement' : 'Entity', description: sentence.trim().slice(0, 300) });
      }
    }
    // Co-occurrence edges within a sentence (first mention chains to the rest).
    for (let i = 1; i < uniq.length && i < 4; i++) {
      edges.push({ source: uniq[0], target: uniq[i], relation: 'relates_to', description: sentence.trim().slice(0, 300) });
    }
  }

  if (opts?.sourceName) {
    const srcNode: KgNodeInput = { name: opts.sourceName, type: 'Session', description: 'extraction source' };
    nodes.set(normalizeName(opts.sourceName), srcNode);
    for (const n of [...nodes.values()].slice(0, 30)) {
      if (n.name !== opts.sourceName) edges.push({ source: n.name, target: opts.sourceName, relation: 'mentioned_in', sourceType: n.type, targetType: 'Session' });
    }
  }

  return { nodes: [...nodes.values()].slice(0, 100), edges: edges.slice(0, 200) };
}
