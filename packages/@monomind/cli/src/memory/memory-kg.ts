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
 * Identity is deterministic and NAME-ONLY (cognee's Entity.identity_fields):
 * the entry KEY is `n:<normalized-name>`, so the same entity extracted from
 * any session merges idempotently via upsert regardless of assigned type.
 * Every write carries `origin_refs` so a bad ingest can be rolled back per
 * run/session.
 *
 * // monolean: graph traversal is in-process over a full kg:edges list —
 * // fine to ~10k edges; upgrade path is a real SQLite edges table with
 * // indexed src/dst columns if orgs outgrow that.
 *
 * @module v1/cli/memory/memory-kg
 */

import {
  bridgeDeleteEntry,
  bridgeGetEntry,
  bridgeListEntries,
  bridgeSearchEntries,
  bridgeStoreEntry,
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
  /** Writes the bridge refused, one message each (capped at MAX_FAILURES).
   *  Non-empty ⇒ `success` is false and the counters describe only what
   *  actually persisted. */
  failures?: string[];
  error?: string;
}

/** Cap on reported failure messages — a dead backend fails every write, and a
 *  500-entry failure list is noise, not signal. `error` carries the true count. */
const MAX_FAILURES = 20;

/** `bridgeStoreEntry` never throws: it returns `null` when no backend is
 *  reachable and `{ success: false, error }` when the write itself failed.
 *  Both look like success to an `await` that ignores the result, which is how
 *  the graph came to claim knowledge it had not persisted. Every write in this
 *  module goes through here.
 *
 *  @returns a failure message, or null when the write landed. */
function storeFailure(
  res: Awaited<ReturnType<typeof bridgeStoreEntry>>,
  what: string,
): string | null {
  if (!res) return `${what}: memory backend unavailable`;
  if (!res.success) return `${what}: ${res.error ?? 'store rejected'}`;
  return null;
}

/** Accumulates write failures across a multi-write operation. The memory
 *  bridge exposes no transaction primitive, so ingest CANNOT be atomic: some
 *  writes land and some do not. Rather than hide that, callers get exact
 *  counters for what persisted plus the failure list for what did not. */
class FailureLog {
  readonly messages: string[] = [];
  private count = 0;

  /** @returns true when the write failed (caller should not count it). */
  add(res: Awaited<ReturnType<typeof bridgeStoreEntry>>, what: string): boolean {
    const msg = storeFailure(res, what);
    if (!msg) return false;
    this.count++;
    if (this.messages.length < MAX_FAILURES) this.messages.push(msg);
    return true;
  }

  note(message: string): void {
    this.count++;
    if (this.messages.length < MAX_FAILURES) this.messages.push(message);
  }

  get failed(): boolean {
    return this.count > 0;
  }

  /** Summary for the result's `error` field; undefined when everything landed. */
  summary(): string | undefined {
    if (!this.count) return undefined;
    return `${this.count} bridge operation(s) failed; graph state is partial`;
  }
}

/** cognee DataPoint normalization: lowercase, spaces→_, strip apostrophes. */
export function normalizeName(name: string): string {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, MAX_NAME_LEN);
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
 *  so rollback can undo a single run's contribution.
 *
 *  NOT ATOMIC — the memory bridge has no transaction primitive, so a failure
 *  part-way through leaves earlier writes persisted. The counters therefore
 *  report only what actually landed, `failures` lists what did not, and
 *  `success` is false whenever anything was refused. A partial ingest is safe
 *  to retry: every write is a keyed upsert. */
export async function kgIngest(options: {
  nodes: KgNodeInput[];
  edges?: KgEdgeInput[];
  /** Provenance: run id, session id, or doc hash this extraction came from. */
  originRef: string;
  dbPath?: string;
}): Promise<KgIngestResult> {
  const { originRef, dbPath } = options;
  const failures = new FailureLog();
  let nodesAdded = 0,
    nodesMerged = 0,
    edgesAdded = 0,
    edgesMerged = 0;

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
        const res = await bridgeStoreEntry({
          key,
          value: `${n.name} — ${bestDesc || bestType}`,
          namespace: KG_NODES_NS,
          dbPath,
          upsert: true,
          tags: ['kg', normalizeName(bestType), ...(n.nodeSet ? [normalizeName(n.nodeSet)] : [])],
          metadata: {
            ...md,
            kg: 'node',
            type: bestType,
            name: n.name,
            description: bestDesc,
            node_set: n.nodeSet ?? md.node_set ?? null,
            origin_refs: origins.slice(-100),
            version: (typeof md.version === 'number' ? md.version : 1) + 1,
            valid_from: md.valid_from ?? Date.now(),
            valid_to: null,
          },
        });
        if (!failures.add(res, `node ${key}`)) nodesMerged++;
      } else {
        const res = await bridgeStoreEntry({
          key,
          value: `${n.name} — ${desc || type}`,
          namespace: KG_NODES_NS,
          dbPath,
          upsert: true,
          tags: ['kg', normalizeName(type), ...(n.nodeSet ? [normalizeName(n.nodeSet)] : [])],
          metadata: {
            kg: 'node',
            type,
            name: n.name,
            description: desc,
            node_set: n.nodeSet ?? null,
            origin_refs: [originRef],
            version: 1,
            valid_from: Date.now(),
            valid_to: null,
          },
        });
        if (!failures.add(res, `node ${key}`)) nodesAdded++;
      }
    }

    for (const e of (options.edges ?? []).slice(0, 1000)) {
      if (!e?.source?.trim() || !e?.target?.trim() || !e?.relation?.trim()) continue;
      const srcKey =
        keyByName.get(normalizeName(e.source)) ?? nodeKey(e.sourceType ?? 'entity', e.source);
      const dstKey =
        keyByName.get(normalizeName(e.target)) ?? nodeKey(e.targetType ?? 'entity', e.target);
      const key = edgeKey(srcKey, e.relation, dstKey);
      const desc = (e.description ?? '').slice(0, MAX_DESC_LEN);

      const existing = await bridgeGetEntry({ key, namespace: KG_EDGES_NS, dbPath });
      if (existing?.found && existing.entry) {
        const md = existing.entry.metadata as Record<string, unknown>;
        const origins = Array.isArray(md.origin_refs) ? (md.origin_refs as string[]) : [];
        if (!origins.includes(originRef)) origins.push(originRef);
        const res = await bridgeStoreEntry({
          key,
          value: desc || `${e.source} ${e.relation} ${e.target}`,
          namespace: KG_EDGES_NS,
          dbPath,
          upsert: true,
          generateEmbeddingFlag: false,
          tags: ['kg', normalizeName(e.relation)],
          metadata: { ...md, origin_refs: origins.slice(-100) },
        });
        if (!failures.add(res, `edge ${key}`)) edgesMerged++;
      } else {
        const res = await bridgeStoreEntry({
          key,
          value: desc || `${e.source} ${e.relation} ${e.target}`,
          namespace: KG_EDGES_NS,
          dbPath,
          upsert: true,
          generateEmbeddingFlag: false,
          tags: ['kg', normalizeName(e.relation)],
          metadata: {
            kg: 'edge',
            src: srcKey,
            dst: dstKey,
            relation: normalizeName(e.relation),
            source_name: e.source,
            target_name: e.target,
            description: desc,
            origin_refs: [originRef],
            valid_from: Date.now(),
            valid_to: null,
          },
        });
        if (!failures.add(res, `edge ${key}`)) edgesAdded++;
      }
    }

    return {
      success: !failures.failed,
      nodesAdded,
      nodesMerged,
      edgesAdded,
      edgesMerged,
      ...(failures.failed ? { failures: failures.messages, error: failures.summary() } : {}),
    };
  } catch (err) {
    return {
      success: false,
      nodesAdded,
      nodesMerged,
      edgesAdded,
      edgesMerged,
      ...(failures.messages.length ? { failures: failures.messages } : {}),
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
 *  injection/search surfaces pick them up with zero new plumbing.
 *
 *  A candidate that dedups against an existing rule still ADDS its origin to
 *  that rule's support set: two independent runs asserting the same rule mean
 *  the rule survives either one being rolled back. Dropping the second origin
 *  (as this used to) made rollback of the FIRST run delete knowledge the
 *  second run independently vouched for.
 *
 *  Like `kgIngest`, NOT atomic — see that function's note. */
export async function kgIngestRules(options: {
  rules: { rule: string; context?: string }[];
  originRef: string;
  dbPath?: string;
  /** Similarity above which a candidate is already_known (default 0.78 —
   *  MiniLM paraphrases of the same rule commonly land 0.78-0.9; cognee's
   *  equivalent control is prompt-injected LLM judgment, which we approximate). */
  dedupThreshold?: number;
}): Promise<{
  success: boolean;
  verdicts: RuleVerdict[];
  accepted: number;
  failures?: string[];
  error?: string;
}> {
  const verdicts: RuleVerdict[] = [];
  const threshold = options.dedupThreshold ?? 0.78;
  const failures = new FailureLog();
  let accepted = 0;

  try {
    for (const r of (options.rules ?? []).slice(0, 50)) {
      const rule = r?.rule?.trim();
      if (!rule || rule.length < 8) {
        verdicts.push({ rule: r?.rule ?? '', verdict: 'invalid' });
        continue;
      }

      const similar = await bridgeSearchEntries({
        query: rule,
        namespace: RULES_NS,
        limit: 1,
        threshold,
        dbPath: options.dbPath,
      });
      const top = similar?.results?.[0];
      // Issue #111: FTS5 keyword scores are min-max normalized per batch.
      // With limit:1, the sole result always scores 1.0 — any rule sharing
      // even one keyword was falsely marked as a duplicate.
      //
      // Only trust embedding-backed (semantic) cosine scores for dedup.
      // Keyword-only matches can't distinguish paraphrases from merely
      // overlapping vocabulary — fall back to exact-text comparison.
      // (Key-based upsert on store already handles identical keys.)
      const provenance = top?.provenance;
      let isDuplicate = false;
      if (top && provenance?.startsWith('semantic:')) {
        const rawCosine = parseFloat(provenance.slice('semantic:'.length));
        isDuplicate = rawCosine >= threshold;
      } else if (top) {
        // Keyword-only: only suppress true near-exact duplicates.
        const existing = (top.content || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const candidate = rule.replace(/\s+/g, ' ').trim().toLowerCase();
        isDuplicate = existing === candidate;
      }
      if (isDuplicate && top?.key) {
        await reinforceRuleOrigin(
          top.key,
          top.content,
          options.originRef,
          options.dbPath,
          failures,
        );
        verdicts.push({ rule, verdict: 'already_known', similarTo: top.key });
        continue;
      }

      const key = `rule:${normalizeName(rule).slice(0, 120)}`;
      const ruleName = rule.slice(0, MAX_NAME_LEN);
      const stored = await bridgeStoreEntry({
        key,
        value: rule + (r.context ? `\n(context: ${r.context.slice(0, 500)})` : ''),
        namespace: RULES_NS,
        dbPath: options.dbPath,
        upsert: true,
        tags: ['rule'],
        metadata: {
          origin_refs: [options.originRef],
          derived_from: options.originRef,
          // Lets the dedup path reinforce the matching KG node without having
          // to re-derive the node name from the stored value (which may carry
          // an appended context block).
          rule: ruleName,
        },
      });
      const nodeRes = await kgIngest({
        nodes: [{ name: ruleName, type: 'Rule', description: rule, nodeSet: 'rules' }],
        originRef: options.originRef,
        dbPath: options.dbPath,
      });
      const ruleFailed = failures.add(stored, `rule ${key}`);
      if (nodeRes.failures?.length) for (const m of nodeRes.failures) failures.note(m);
      // Only count a rule as accepted when BOTH of its writes landed; a rule
      // present in one namespace only is not the state the caller was told about.
      if (!ruleFailed && nodeRes.success) accepted++;
      verdicts.push({ rule, verdict: 'accepted' });
    }
    return {
      success: !failures.failed,
      verdicts,
      accepted,
      ...(failures.failed ? { failures: failures.messages, error: failures.summary() } : {}),
    };
  } catch (err) {
    return {
      success: false,
      verdicts,
      accepted,
      ...(failures.messages.length ? { failures: failures.messages } : {}),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Add `originRef` to an already-stored rule's support set — both the
 *  `rules`-namespace entry and its `node_set=rules` KG node. Idempotent in
 *  effect: re-asserting an origin the rule already carries leaves the support
 *  set unchanged. */
async function reinforceRuleOrigin(
  ruleKey: string,
  matchedContent: string,
  originRef: string,
  dbPath: string | undefined,
  failures: FailureLog,
): Promise<void> {
  const existing = await bridgeGetEntry({ key: ruleKey, namespace: RULES_NS, dbPath });
  if (!existing?.found || !existing.entry) {
    // The dedup hit came from search; if the entry can't be re-read by key the
    // support set cannot be updated, and silently proceeding is exactly the
    // provenance loss this function exists to prevent.
    failures.note(`rule ${ruleKey}: matched by dedup but not readable by key`);
    return;
  }
  const entry = existing.entry;
  const md = entry.metadata as Record<string, unknown>;
  const origins = Array.isArray(md.origin_refs) ? (md.origin_refs as string[]) : [];
  // The KG node's name: recorded at accept time, else the first line of the
  // stored value (any context block is appended after a newline).
  const ruleName = (
    typeof md.rule === 'string' && md.rule
      ? md.rule
      : (matchedContent || entry.content).split('\n')[0]
  ).slice(0, MAX_NAME_LEN);

  if (!origins.includes(originRef)) {
    const res = await bridgeStoreEntry({
      key: entry.key,
      value: entry.content,
      namespace: RULES_NS,
      dbPath,
      upsert: true,
      generateEmbeddingFlag: entry.hasEmbedding,
      tags: entry.tags,
      metadata: { ...md, rule: ruleName, origin_refs: [...origins, originRef].slice(-100) },
    });
    failures.add(res, `rule ${entry.key}`);
  }

  // The rule's KG node needs the same origin — rollback walks nodes separately.
  const nodeRes = await kgIngest({
    nodes: [{ name: ruleName, type: 'Rule', description: ruleName, nodeSet: 'rules' }],
    originRef,
    dbPath,
  });
  if (nodeRes.failures?.length) for (const m of nodeRes.failures) failures.note(m);
}

/** List stored rules (for injection or review). */
export async function kgListRules(options?: {
  dbPath?: string;
  limit?: number;
}): Promise<{ rule: string; key: string }[]> {
  const res = await bridgeListEntries({
    namespace: RULES_NS,
    limit: options?.limit ?? 50,
    dbPath: options?.dbPath,
  });
  return (res?.entries ?? []).map((e) => ({ rule: e.content, key: e.key }));
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
      query: options.query,
      namespace: KG_NODES_NS,
      limit: 15,
      threshold: 0.25,
      dbPath: options.dbPath,
    });
    let seedResults = seedsRes?.results ?? [];
    if (options.nodeSet) {
      const ns = normalizeName(options.nodeSet);
      seedResults = seedResults.filter((r) => (r.tags ?? []).includes(ns));
    }
    if (!seedResults.length) return { success: true, context: '', triplets: [], seeds: [] };

    const seedScore = new Map<string, number>();
    for (const s of seedResults) seedScore.set(s.key, s.score);

    // Full edge scan (see monolean note in module header).
    const edgesRes = await bridgeListEntries({
      namespace: KG_EDGES_NS,
      limit: MAX_LIST,
      dbPath: options.dbPath,
    });
    const edges = (edgesRes?.entries ?? []).filter((e) => {
      const md = e.metadata as Record<string, unknown>;
      return md?.kg === 'edge' && md.valid_to == null;
    });

    const triplets = edges
      .map((e) => {
        const md = e.metadata as Record<string, unknown>;
        const src = String(md.src ?? '');
        const dst = String(md.dst ?? '');
        const sSrc = seedScore.get(src) ?? 0;
        const sDst = seedScore.get(dst) ?? 0;
        if (sSrc === 0 && sDst === 0) return null;
        // Both endpoints seeded beats one; the unseeded endpoint contributes a
        // neutral 0.35 so bridging edges from a strong seed still surface.
        const score =
          (Math.max(sSrc, 0.35) + Math.max(sDst, 0.35)) / 2 + (sSrc > 0 && sDst > 0 ? 0.1 : 0);
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

    const seeds = seedResults.slice(0, limit).map((s) => {
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
      ...triplets.map(
        (t) =>
          `${t.source} —${t.relation}→ ${t.target}${t.fact && t.fact !== `${t.source} ${t.relation} ${t.target}` ? ` (${t.fact})` : ''}`,
      ),
      ...(triplets.length ? [] : seeds.map((s) => `${s.name}: ${s.description}`)),
    ].join('\n');

    return { success: true, context, triplets, seeds };
  } catch (err) {
    return {
      success: false,
      context: '',
      triplets: [],
      seeds: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Glossary (anti-duplicate-entity injection for extraction prompts) ──

export async function kgGlossary(options?: { dbPath?: string; limit?: number }): Promise<string[]> {
  const res = await bridgeListEntries({
    namespace: KG_NODES_NS,
    limit: MAX_LIST,
    dbPath: options?.dbPath,
  });
  const nodes = (res?.entries ?? [])
    // Glossary is for ENTITY name reuse — rule prose and extraction-source
    // Session nodes would drown it.
    .filter((e) => {
      const md = e.metadata as Record<string, unknown>;
      const t = String(md?.type ?? '').toLowerCase();
      return md?.node_set !== 'rules' && t !== 'rule' && t !== 'session';
    })
    .map((e) => {
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

/** Withdraw `originRef`'s support from the graph: remove it from every
 *  node/edge/rule it backs, and delete the element once no origin remains.
 *
 *  The withdrawn ref is REWRITTEN out of the surviving elements' origin lists,
 *  not left behind. Retaining it (as this used to) meant a second rollback saw
 *  a two-entry list and retained again — so an element could outlive the
 *  withdrawal of every origin that ever supported it. */
export async function kgRollback(options: { originRef: string; dbPath?: string }): Promise<{
  success: boolean;
  deleted: number;
  retained: number;
  failures?: string[];
  error?: string;
}> {
  const failures = new FailureLog();
  let deleted = 0,
    retained = 0;
  try {
    for (const ns of [KG_NODES_NS, KG_EDGES_NS, RULES_NS]) {
      const res = await bridgeListEntries({
        namespace: ns,
        limit: MAX_LIST,
        dbPath: options.dbPath,
      });
      if (!res) {
        failures.note(`${ns}: memory backend unavailable`);
        continue;
      }
      for (const e of res.entries) {
        const md = (e.metadata ?? {}) as Record<string, unknown>;
        const origins = md.origin_refs;
        if (!Array.isArray(origins) || !origins.includes(options.originRef)) continue;
        const remaining = (origins as string[]).filter((o) => o !== options.originRef);

        if (remaining.length === 0) {
          const del = await bridgeDeleteEntry({ id: e.id, namespace: ns, dbPath: options.dbPath });
          if (del?.deleted) deleted++;
          else failures.note(`${ns}/${e.key}: delete failed`);
          continue;
        }

        const store = await bridgeStoreEntry({
          key: e.key,
          value: e.content,
          namespace: ns,
          dbPath: options.dbPath,
          upsert: true,
          // Edges are stored without embeddings; re-deriving one here would
          // silently change how the entry behaves in search.
          generateEmbeddingFlag: e.hasEmbedding,
          tags: e.tags,
          metadata: { ...md, origin_refs: remaining },
        });
        if (!failures.add(store, `${ns}/${e.key}: origin withdrawal`)) retained++;
      }
    }
    return {
      success: !failures.failed,
      deleted,
      retained,
      ...(failures.failed ? { failures: failures.messages, error: failures.summary() } : {}),
    };
  } catch (err) {
    return {
      success: false,
      deleted,
      retained,
      ...(failures.messages.length ? { failures: failures.messages } : {}),
      error: err instanceof Error ? err.message : String(err),
    };
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
  return (
    (nodesRes?.entries ?? [])
      .map((n) => {
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
      .filter(
        (c) =>
          c.edgeCount >= minEdges &&
          c.description.length < Math.min(40 * c.edgeCount, MAX_DESC_LEN),
      )
      .sort((a, b) => b.edgeCount - a.edgeCount)
      .slice(0, options?.limit ?? 10)
  );
}

// ── Stats ───────────────────────────────────────────────────────────

export async function kgStats(options?: {
  dbPath?: string;
}): Promise<{ nodes: number; edges: number; rules: number }> {
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
export function heuristicExtract(
  text: string,
  opts?: { sourceName?: string },
): { nodes: KgNodeInput[]; edges: KgEdgeInput[] } {
  const nodes = new Map<string, KgNodeInput>();
  const edges: KgEdgeInput[] = [];
  const src = String(text || '').slice(0, 50_000);

  const sentences = src.split(/(?<=[.!?])\s+|\n+/).slice(0, 400);
  const STOPWORDS = new Set([
    'The',
    'This',
    'That',
    'These',
    'Those',
    'It',
    'A',
    'An',
    'If',
    'When',
    'While',
    'But',
    'And',
    'Or',
    'For',
    'Then',
    'Also',
    'Not',
    'No',
    'Yes',
    'I',
    'We',
    'You',
    'They',
    'He',
    'She',
    'Run',
    'Outcome',
    'Assets',
    'Goal',
    'Org',
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ]);

  for (const sentence of sentences) {
    const found: string[] = [];
    // Proper-noun phrases: consecutive Capitalized words (2-40 chars each).
    for (const m of sentence.matchAll(
      /\b([A-Z][a-zA-Z0-9_-]{1,40}(?:\s+[A-Z][a-zA-Z0-9_-]{1,40}){0,3})\b/g,
    )) {
      const phrase = m[1];
      if (STOPWORDS.has(phrase)) continue;
      found.push(phrase);
    }
    // Code identifiers in backticks or dotted/slashed paths.
    for (const m of sentence.matchAll(/`([^`\n]{2,80})`/g)) found.push(m[1]);

    const uniq = [...new Set(found)].slice(0, 8);
    for (const name of uniq) {
      if (!nodes.has(normalizeName(name))) {
        nodes.set(normalizeName(name), {
          name,
          type: /[./`(]/.test(name) ? 'CodeElement' : 'Entity',
          description: sentence.trim().slice(0, 300),
        });
      }
    }
    // Co-occurrence edges within a sentence (first mention chains to the rest).
    for (let i = 1; i < uniq.length && i < 4; i++) {
      edges.push({
        source: uniq[0],
        target: uniq[i],
        relation: 'relates_to',
        description: sentence.trim().slice(0, 300),
      });
    }
  }

  if (opts?.sourceName) {
    const srcNode: KgNodeInput = {
      name: opts.sourceName,
      type: 'Session',
      description: 'extraction source',
    };
    nodes.set(normalizeName(opts.sourceName), srcNode);
    for (const n of [...nodes.values()].slice(0, 30)) {
      if (n.name !== opts.sourceName)
        edges.push({
          source: n.name,
          target: opts.sourceName,
          relation: 'mentioned_in',
          sourceType: n.type,
          targetType: 'Session',
        });
    }
  }

  return { nodes: [...nodes.values()].slice(0, 100), edges: edges.slice(0, 200) };
}
