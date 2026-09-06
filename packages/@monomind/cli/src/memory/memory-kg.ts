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
 * OWNERSHIP is carried by `KgScope`, not by the store path. Every org under
 * one project root shares ONE org-memory store, so those three namespaces
 * would otherwise be a single pool that any org can read, merge into, and roll
 * back. A scope suffixes all three (`kg:nodes:org:<org>`, …) and stamps the
 * asserting org onto every origin ref, so an org's reads, writes, glossary and
 * rollback all resolve through `kgNamespaces()` and can only reach what that
 * org asserted. An absent scope means PROJECT-SHARED knowledge — a scope in
 * its own right, not "all scopes". Crossing from an org into the shared graph
 * is `kgPromote`, an explicit operation, never a side effect of learning.
 *
 * Identity is deterministic and NAME-ONLY (cognee's Entity.identity_fields):
 * the entry KEY is `n:<normalized-name>`, so the same entity extracted from
 * any session merges idempotently via upsert regardless of assigned type.
 * Name-only keys are why scope has to live in the NAMESPACE: two orgs
 * asserting different facts about the same name produce the same key, and
 * only separate namespaces keep them from overwriting each other.
 * Every write carries `origin_refs` so a bad ingest can be rolled back per
 * run/session.
 *
 * // monolean: graph traversal is in-process over a paged kg:edges scan. The
 * // bridge exposes no indexed adjacency (src/dst) or origin lookup, so every
 * // neighbourhood/provenance question is a namespace scan; the upgrade path is
 * // a real SQLite edges table with indexed src/dst/origin columns, which turns
 * // these O(namespace) scans into O(matches).
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

/** Rows per `bridgeListEntries` call while scanning a namespace.
 *
 *  A single list call cannot return more than the backend's own 10,000-row
 *  ceiling (`MAX_QUERY_LIMIT` in sql-backend.ts), so the old `limit: MAX_LIST`
 *  scans were not "large enough to be safe" — they were exactly the point past
 *  which the graph goes silently invisible. Everything below pages instead.
 *
 *  1,000 balances the two costs: one page is at most ~1 MB even at the bridge's
 *  16 KB value cap (typical KG entries are far smaller), and it takes a tenth
 *  of the round trips a 100-row page would. */
const SCAN_PAGE = 1_000;

/** Edge rows `kgSearch` will read before giving up and reporting `truncated`.
 *  Search is interactive and runs a full scan per query, so unlike rollback it
 *  keeps a ceiling — five times the old silent one, and now stated in the
 *  result rather than hidden. */
const SEARCH_EDGE_SCAN_MAX = 50_000;

type ScannedEntry = NonNullable<Awaited<ReturnType<typeof bridgeListEntries>>>['entries'][number];

/** Page through an entire namespace, handing each page to `onPage` so callers
 *  fold as they go instead of materializing the namespace.
 *
 *  `onPage` returning exactly `false` stops the scan early (only `kgSearch`
 *  does that); any other return value continues. Returns false when the backend
 *  was unavailable — an unreadable namespace must never be mistaken for an
 *  empty one.
 *
 *  Callers that MUTATE what they find must collect during the scan and mutate
 *  afterwards: the bridge's upsert writes a new row and drops the old one, so
 *  rewriting an entry moves it to the head of the backend's `created_at DESC`
 *  ordering and would shift rows past an advancing offset. */
async function scanNamespace(
  namespace: string,
  dbPath: string | undefined,
  onPage: (entries: ScannedEntry[]) => unknown,
): Promise<boolean> {
  for (let offset = 0; ; offset += SCAN_PAGE) {
    const res = await bridgeListEntries({ namespace, limit: SCAN_PAGE, offset, dbPath });
    if (!res) return false;
    if (res.entries.length && onPage(res.entries) === false) return true;
    if (res.entries.length < SCAN_PAGE) return true;
  }
}

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

// ── Scope (org ownership) ───────────────────────────────────────────

/** Who owns a set of graph facts. `org` absent = project-shared knowledge. */
export interface KgScope {
  org?: string;
}

export interface KgNamespaces {
  nodes: string;
  edges: string;
  rules: string;
}

/** The three namespaces a scope owns. Every read and write in this module
 *  resolves through here, which is what makes ownership enforced rather than
 *  advisory: there is no code path that reaches an org's facts without naming
 *  that org, and none that reaches every org at once. */
export function kgNamespaces(scope?: KgScope): KgNamespaces {
  const org = scope?.org?.trim();
  if (!org) return { nodes: KG_NODES_NS, edges: KG_EDGES_NS, rules: RULES_NS };
  const suffix = `:org:${normalizeName(org)}`;
  return { nodes: KG_NODES_NS + suffix, edges: KG_EDGES_NS + suffix, rules: RULES_NS + suffix };
}

/** Stamp the asserting org onto a provenance ref, so a claim's origin says WHO
 *  asserted it and not merely which run id — `run:m4x2` alone is ambiguous
 *  across orgs, and a promoted claim in the shared graph would otherwise carry
 *  an origin no one owns.
 *
 *  Applied by the ingest/rollback entry points rather than by callers: a
 *  caller that forgets is exactly how ownership stopped being enforced. */
export function kgQualifyOrigin(originRef: string, scope?: KgScope): string {
  const org = scope?.org?.trim();
  return org ? `org:${normalizeName(org)}/${originRef}` : originRef;
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
  /** Provenance: run id, session id, or doc hash this extraction came from.
   *  Stored qualified by `scope` — see `kgQualifyOrigin`. */
  originRef: string;
  /** Owner of these facts. Omit for project-shared knowledge. */
  scope?: KgScope;
  dbPath?: string;
}): Promise<KgIngestResult> {
  const { dbPath } = options;
  const ns = kgNamespaces(options.scope);
  const originRef = kgQualifyOrigin(options.originRef, options.scope);
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

      const existing = await bridgeGetEntry({ key, namespace: ns.nodes, dbPath });
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
          namespace: ns.nodes,
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
          namespace: ns.nodes,
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

      const existing = await bridgeGetEntry({ key, namespace: ns.edges, dbPath });
      if (existing?.found && existing.entry) {
        const md = existing.entry.metadata as Record<string, unknown>;
        const origins = Array.isArray(md.origin_refs) ? (md.origin_refs as string[]) : [];
        if (!origins.includes(originRef)) origins.push(originRef);
        const res = await bridgeStoreEntry({
          key,
          value: desc || `${e.source} ${e.relation} ${e.target}`,
          namespace: ns.edges,
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
          namespace: ns.edges,
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
  /** Owner of these rules. Omit for project-shared knowledge. */
  scope?: KgScope;
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
  const ns = kgNamespaces(options.scope);
  // Direct writes here store the qualified ref; nested kgIngest calls get the
  // RAW ref plus the scope and qualify it themselves, so it is stamped once.
  const originRef = kgQualifyOrigin(options.originRef, options.scope);
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
        namespace: ns.rules,
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
          options.scope,
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
        namespace: ns.rules,
        dbPath: options.dbPath,
        upsert: true,
        tags: ['rule'],
        metadata: {
          origin_refs: [originRef],
          derived_from: originRef,
          // Lets the dedup path reinforce the matching KG node without having
          // to re-derive the node name from the stored value (which may carry
          // an appended context block).
          rule: ruleName,
        },
      });
      const nodeRes = await kgIngest({
        nodes: [{ name: ruleName, type: 'Rule', description: rule, nodeSet: 'rules' }],
        originRef: options.originRef,
        scope: options.scope,
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
  /** RAW ref — qualified here for the rules entry, and passed on unqualified
   *  to `kgIngest`, which qualifies it once with the same scope. */
  originRef: string,
  scope: KgScope | undefined,
  dbPath: string | undefined,
  failures: FailureLog,
): Promise<void> {
  const ns = kgNamespaces(scope);
  const qualified = kgQualifyOrigin(originRef, scope);
  const existing = await bridgeGetEntry({ key: ruleKey, namespace: ns.rules, dbPath });
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

  if (!origins.includes(qualified)) {
    const res = await bridgeStoreEntry({
      key: entry.key,
      value: entry.content,
      namespace: ns.rules,
      dbPath,
      upsert: true,
      generateEmbeddingFlag: entry.hasEmbedding,
      tags: entry.tags,
      metadata: { ...md, rule: ruleName, origin_refs: [...origins, qualified].slice(-100) },
    });
    failures.add(res, `rule ${entry.key}`);
  }

  // The rule's KG node needs the same origin — rollback walks nodes separately.
  const nodeRes = await kgIngest({
    nodes: [{ name: ruleName, type: 'Rule', description: ruleName, nodeSet: 'rules' }],
    originRef,
    scope,
    dbPath,
  });
  if (nodeRes.failures?.length) for (const m of nodeRes.failures) failures.note(m);
}

/** List stored rules (for injection or review). */
export async function kgListRules(options?: {
  dbPath?: string;
  limit?: number;
  scope?: KgScope;
}): Promise<{ rule: string; key: string }[]> {
  const res = await bridgeListEntries({
    namespace: kgNamespaces(options?.scope).rules,
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
  /** True when the edge scan did NOT cover the whole namespace — the scan hit
   *  `SEARCH_EDGE_SCAN_MAX`, or the backend became unreadable partway. A
   *  relationship that exists may be missing from `triplets`; absence here is
   *  not evidence of absence in the graph. */
  truncated?: boolean;
  /** Edge rows actually read, so a caller can see how close it ran to the cap. */
  scannedEdges?: number;
  error?: string;
}

/** Vector-seed → neighborhood → triplet ranking (cognee's brute-force triplet
 *  search, scaled down). Seed scores already carry the Phase 1 feedback blend. */
export async function kgSearch(options: {
  query: string;
  dbPath?: string;
  limit?: number;
  nodeSet?: string;
  /** Whose graph to search. Omit for project-shared knowledge; a scoped search
   *  never reaches another org's facts, and never the shared graph either. */
  scope?: KgScope;
}): Promise<KgSearchResult> {
  try {
    const limit = options.limit ?? 8;
    const ns = kgNamespaces(options.scope);
    const seedsRes = await bridgeSearchEntries({
      query: options.query,
      namespace: ns.nodes,
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

    // Paged edge scan (see monolean note in module header). Each page is folded
    // into the running top-`limit` immediately, so memory stays at one page
    // regardless of how many edges the namespace holds.
    const triplets: KgSearchResult['triplets'] = [];
    let scannedEdges = 0;
    let truncated = false;
    const covered = await scanNamespace(ns.edges, options.dbPath, (page) => {
      for (const e of page) {
        scannedEdges++;
        const md = e.metadata as Record<string, unknown>;
        if (md?.kg !== 'edge' || md.valid_to != null) continue;
        const src = String(md.src ?? '');
        const dst = String(md.dst ?? '');
        const sSrc = seedScore.get(src) ?? 0;
        const sDst = seedScore.get(dst) ?? 0;
        if (sSrc === 0 && sDst === 0) continue;
        // Both endpoints seeded beats one; the unseeded endpoint contributes a
        // neutral 0.35 so bridging edges from a strong seed still surface.
        const score =
          (Math.max(sSrc, 0.35) + Math.max(sDst, 0.35)) / 2 + (sSrc > 0 && sDst > 0 ? 0.1 : 0);
        triplets.push({
          source: String(md.source_name ?? src),
          relation: String(md.relation ?? 'related_to'),
          target: String(md.target_name ?? dst),
          fact: e.content,
          score,
        });
      }
      // Scores are per-edge, so pruning to the running top-`limit` after each
      // page yields exactly the same result as sorting the whole set at the end.
      if (triplets.length > limit) {
        triplets.sort((a, b) => b.score - a.score);
        triplets.length = limit;
      }
      if (scannedEdges >= SEARCH_EDGE_SCAN_MAX) {
        truncated = true;
        return false;
      }
      return true;
    });
    // An unreadable namespace is an incomplete answer, not an empty graph.
    if (!covered) truncated = true;
    triplets.sort((a, b) => b.score - a.score);

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

    return {
      success: true,
      context,
      triplets,
      seeds,
      scannedEdges,
      ...(truncated && { truncated }),
    };
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

export async function kgGlossary(options?: {
  dbPath?: string;
  limit?: number;
  /** Whose entity names to offer. The coordinator glossary MUST be scoped:
   *  suggesting another org's entity names is how one org's claims get merged
   *  into another's graph under a shared name. */
  scope?: KgScope;
}): Promise<string[]> {
  const limit = options?.limit ?? 40;
  // Running top-`limit` by rank, deduplicated by normalized name. Folding each
  // page in and pruning keeps the whole node namespace in scope without ever
  // holding more than a page plus `limit` names.
  let top: { name: string; norm: string; rank: number }[] = [];

  await scanNamespace(kgNamespaces(options?.scope).nodes, options?.dbPath, (page) => {
    for (const e of page) {
      const md = e.metadata as Record<string, unknown>;
      // Glossary is for ENTITY name reuse — rule prose and extraction-source
      // Session nodes would drown it.
      const t = String(md?.type ?? '').toLowerCase();
      if (md?.node_set === 'rules' || t === 'rule' || t === 'session') continue;
      const fw = typeof md.feedback_weight === 'number' ? md.feedback_weight : 0.5;
      const freq = typeof md.frequency_weight === 'number' ? md.frequency_weight : 0;
      const version = typeof md.version === 'number' ? md.version : 1;
      const name = String(md.name ?? e.key);
      top.push({ name, norm: normalizeName(name), rank: version + freq + fw });
    }
    top.sort((a, b) => b.rank - a.rank);
    const seen = new Set<string>();
    const pruned: typeof top = [];
    for (const n of top) {
      if (seen.has(n.norm)) continue;
      seen.add(n.norm);
      pruned.push(n);
      if (pruned.length >= limit) break;
    }
    top = pruned;
  });

  return top.map((n) => n.name);
}

// ── Rollback (per-origin bad-ingest recovery) ───────────────────────

function originsOf(entry: ScannedEntry): string[] {
  const origins = ((entry.metadata ?? {}) as Record<string, unknown>).origin_refs;
  return Array.isArray(origins) ? (origins as string[]) : [];
}

/** Every entry in `namespace` that `originRef` supports, collected by an
 *  EXHAUSTIVE paged scan. `covered` is false when the backend became
 *  unreadable partway — an incomplete answer, never an empty one.
 *
 *  Collecting rather than streaming is required by the callers that mutate:
 *  the bridge's upsert re-inserts under a fresh `created_at`, and deleting a
 *  row pulls later rows back, so either would shift entries under an advancing
 *  offset. Only origin-carrying entries are retained, so memory tracks the
 *  operation's own footprint, not the namespace size. */
async function collectByOrigin(
  namespace: string,
  originRef: string,
  dbPath: string | undefined,
): Promise<{ entries: ScannedEntry[]; covered: boolean }> {
  const entries: ScannedEntry[] = [];
  const covered = await scanNamespace(namespace, dbPath, (page) => {
    for (const e of page) if (originsOf(e).includes(originRef)) entries.push(e);
  });
  return { entries, covered };
}

/** Withdraw `originRef`'s support from the graph: remove it from every
 *  node/edge/rule it backs, and delete the element once no origin remains.
 *
 *  The withdrawn ref is REWRITTEN out of the surviving elements' origin lists,
 *  not left behind. Retaining it (as this used to) meant a second rollback saw
 *  a two-entry list and retained again — so an element could outlive the
 *  withdrawal of every origin that ever supported it.
 *
 *  The scan is EXHAUSTIVE: it pages each namespace to the end rather than
 *  reading one capped list. A capped scan let an element past the cap keep a
 *  withdrawn origin while the caller was told the rollback succeeded.
 *
 *  Collect-then-mutate is deliberate. Mutating inside the page loop would be
 *  wrong in both directions: deleting a row pulls later rows back under an
 *  advancing offset (skipping them), and the bridge's upsert re-inserts the
 *  rewritten entry with a fresh `created_at`, moving it to the head of the
 *  backend's default ordering. Only origin-carrying entries are retained
 *  during the scan, so memory tracks the rollback's own footprint, not the
 *  namespace size. */
export async function kgRollback(options: {
  originRef: string;
  /** Whose knowledge to withdraw from. A rollback can only reach the named
   *  scope's namespaces — an org's rollback is an ownership boundary, not just
   *  a label on the output. */
  scope?: KgScope;
  dbPath?: string;
}): Promise<{
  success: boolean;
  deleted: number;
  retained: number;
  failures?: string[];
  error?: string;
}> {
  const failures = new FailureLog();
  const namespaces = kgNamespaces(options.scope);
  const originRef = kgQualifyOrigin(options.originRef, options.scope);
  let deleted = 0,
    retained = 0;
  try {
    for (const ns of [namespaces.nodes, namespaces.edges, namespaces.rules]) {
      const found = await collectByOrigin(ns, originRef, options.dbPath);
      // A partial scan cannot be reported as a completed withdrawal.
      if (!found.covered) {
        failures.note(`${ns}: memory backend unavailable`);
        continue;
      }
      const supported = found.entries.map((e) => ({
        entry: e,
        remaining: originsOf(e).filter((o) => o !== originRef),
      }));

      for (const { entry: e, remaining } of supported) {
        const md = (e.metadata ?? {}) as Record<string, unknown>;

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

// ── Promotion (org-owned → project-shared, explicit) ────────────────

export interface KgPromoteResult {
  success: boolean;
  nodes: number;
  edges: number;
  rules: number;
  /** Origin the shared copy carries, so the promotion can be withdrawn on its
   *  own and the shared graph records who shared the claim. */
  promotedAs: string;
  failures?: string[];
  error?: string;
}

/** Copy one origin's claims out of an org's scope into project-shared
 *  knowledge.
 *
 *  Sharing is deliberate, never a side effect of learning: `kgIngest` under a
 *  scope only ever writes that org's namespaces, and this is the one path a
 *  claim takes across the boundary. The org keeps its own copy untouched — the
 *  shared copy is an INDEPENDENT assertion under `promoted:<org-ref>`, so
 *  rolling back either side leaves the other standing, and a shared claim
 *  always names the org that vouched for it.
 *
 *  Like ingest, NOT atomic: the counters report what actually landed. */
export async function kgPromote(options: {
  /** The org-side ref to promote, unqualified (e.g. `run:m4x2`). */
  originRef: string;
  /** Owner the claims are promoted FROM. Promoting from the shared scope is a
   *  no-op and is refused rather than silently duplicating. */
  from: KgScope;
  dbPath?: string;
}): Promise<KgPromoteResult> {
  const empty = { nodes: 0, edges: 0, rules: 0 };
  if (!options.from?.org?.trim())
    return {
      success: false,
      ...empty,
      promotedAs: '',
      error: 'promotion needs an owning org to promote from',
    };

  const ns = kgNamespaces(options.from);
  const sourceRef = kgQualifyOrigin(options.originRef, options.from);
  const promotedAs = `promoted:${sourceRef}`;
  const failures = new FailureLog();

  try {
    const [nodeHits, edgeHits, ruleHits] = await Promise.all([
      collectByOrigin(ns.nodes, sourceRef, options.dbPath),
      collectByOrigin(ns.edges, sourceRef, options.dbPath),
      collectByOrigin(ns.rules, sourceRef, options.dbPath),
    ]);
    // A partial read would promote a partial claim set while reporting the
    // whole origin as shared.
    for (const [name, hit] of [
      ['nodes', nodeHits],
      ['edges', edgeHits],
      ['rules', ruleHits],
    ] as const)
      if (!hit.covered) failures.note(`${name}: memory backend unavailable`);
    if (failures.failed)
      return {
        success: false,
        ...empty,
        promotedAs,
        failures: failures.messages,
        error: failures.summary(),
      };

    // Rule NODES are re-created by kgIngestRules; promoting them again through
    // kgIngest would double-count and strip their rules-namespace entry.
    const nodes: KgNodeInput[] = nodeHits.entries
      .filter((e) => {
        const md = (e.metadata ?? {}) as Record<string, unknown>;
        return md.node_set !== 'rules' && String(md.type ?? '').toLowerCase() !== 'rule';
      })
      .map((e) => {
        const md = (e.metadata ?? {}) as Record<string, unknown>;
        return {
          name: String(md.name ?? e.key),
          type: String(md.type ?? 'entity'),
          description: String(md.description ?? ''),
          nodeSet: typeof md.node_set === 'string' ? md.node_set : undefined,
        };
      });
    const edges: KgEdgeInput[] = edgeHits.entries.map((e) => {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      return {
        source: String(md.source_name ?? md.src ?? ''),
        target: String(md.target_name ?? md.dst ?? ''),
        relation: String(md.relation ?? 'related_to'),
        description: String(md.description ?? ''),
      };
    });
    const rules = ruleHits.entries.map((e) => {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      return { rule: String(md.rule ?? e.content.split('\n')[0]) };
    });

    let promotedNodes = 0,
      promotedEdges = 0,
      promotedRules = 0;
    // kgIngest caps a call at 500 nodes / 1000 edges, so a large origin has to
    // be promoted in batches rather than silently truncated. Nodes go first so
    // every edge endpoint already exists when the edges land.
    for (let i = 0; i < nodes.length; i += 500) {
      const res = await kgIngest({
        nodes: nodes.slice(i, i + 500),
        originRef: promotedAs,
        dbPath: options.dbPath,
      });
      promotedNodes += res.nodesAdded + res.nodesMerged;
      if (res.failures?.length) for (const m of res.failures) failures.note(m);
    }
    for (let i = 0; i < edges.length; i += 1000) {
      const res = await kgIngest({
        nodes: [],
        edges: edges.slice(i, i + 1000),
        originRef: promotedAs,
        dbPath: options.dbPath,
      });
      promotedEdges += res.edgesAdded + res.edgesMerged;
      if (res.failures?.length) for (const m of res.failures) failures.note(m);
    }
    for (let i = 0; i < rules.length; i += 50) {
      const res = await kgIngestRules({
        rules: rules.slice(i, i + 50),
        originRef: promotedAs,
        dbPath: options.dbPath,
      });
      promotedRules += res.accepted;
      if (res.failures?.length) for (const m of res.failures) failures.note(m);
    }

    return {
      success: !failures.failed,
      nodes: promotedNodes,
      edges: promotedEdges,
      rules: promotedRules,
      promotedAs,
      ...(failures.failed ? { failures: failures.messages, error: failures.summary() } : {}),
    };
  } catch (err) {
    return {
      success: false,
      ...empty,
      promotedAs,
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
  scope?: KgScope;
}): Promise<ConsolidationCandidate[]> {
  const minEdges = options?.minEdges ?? 3;
  const limit = options?.limit ?? 10;
  const ns = kgNamespaces(options?.scope);

  // Degree index over the FULL edge namespace. Only the first 12 facts per node
  // are kept (that is all the result exposes), so the index costs a bounded
  // amount per node rather than one string per edge.
  const degree = new Map<string, { count: number; facts: string[] }>();
  await scanNamespace(ns.edges, options?.dbPath, (page) => {
    for (const e of page) {
      const md = e.metadata as Record<string, unknown>;
      for (const end of [String(md.src ?? ''), String(md.dst ?? '')]) {
        if (!end) continue;
        const slot = degree.get(end) ?? { count: 0, facts: [] };
        slot.count++;
        if (slot.facts.length < 12) slot.facts.push(e.content);
        degree.set(end, slot);
      }
    }
  });

  let candidates: ConsolidationCandidate[] = [];
  await scanNamespace(ns.nodes, options?.dbPath, (page) => {
    for (const n of page) {
      const md = n.metadata as Record<string, unknown>;
      const slot = degree.get(n.key);
      if (!slot || slot.count < minEdges) continue;
      const description = String(md.description ?? '');
      // Cap the growth target at MAX_DESC_LEN — a very-high-degree node whose
      // description is already at the cap can never "grow out" of candidacy and
      // would otherwise permanently occupy a slot.
      if (description.length >= Math.min(40 * slot.count, MAX_DESC_LEN)) continue;
      candidates.push({
        name: String(md.name ?? n.key),
        type: String(md.type ?? 'entity'),
        description,
        edgeCount: slot.count,
        neighborhood: slot.facts,
      });
    }
    // Ranking is per-node, so keeping only the running top-`limit` after each
    // page gives the same answer as ranking every node at the end.
    candidates.sort((a, b) => b.edgeCount - a.edgeCount);
    candidates = candidates.slice(0, limit);
  });
  return candidates;
}

// ── Stats ───────────────────────────────────────────────────────────

/** Real counts, not page lengths. `bridgeListEntries.total` reports how many
 *  rows that one call returned, so the old capped list made a 10,001-node graph
 *  report exactly 10,000 forever. Counting by paging costs one query per 1,000
 *  rows but is exact; an indexed `COUNT(*)` on the bridge would replace it. */
export async function kgStats(options?: {
  dbPath?: string;
  /** Whose graph to measure. Counting every org's facts under one org's name
   *  is what made `org memory <name> stats` a fiction. */
  scope?: KgScope;
}): Promise<{ nodes: number; edges: number; rules: number }> {
  const ns = kgNamespaces(options?.scope);
  const count = async (namespace: string) => {
    let n = 0;
    await scanNamespace(namespace, options?.dbPath, (page) => {
      n += page.length;
    });
    return n;
  };
  const [nodes, edges, rules] = await Promise.all([
    count(ns.nodes),
    count(ns.edges),
    count(ns.rules),
  ]);
  return { nodes, edges, rules };
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
