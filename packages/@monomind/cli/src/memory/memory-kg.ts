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
 * one project root shares ONE org-memory store, so those namespaces would
 * otherwise be a single pool that any org can read, merge into, and roll back.
 * A scope suffixes every one of them (`kg:nodes:org:<org>`, …) and stamps the
 * asserting org onto every origin ref, so an org's reads, writes, glossary and
 * rollback all resolve through `kgNamespaces()` and can only reach what that
 * org asserted. An absent scope means PROJECT-SHARED knowledge — a scope in
 * its own right, not "all scopes". Crossing from an org into the shared graph
 * is `kgPromote`, an explicit operation, never a side effect of learning.
 *
 * IDENTITY is the (type, name) tuple, hashed length-prefixed so no component
 * can bleed into its neighbour and no distinction is truncated away — the same
 * injective-serialization discipline monograph's `symbolId`/`fileId` use, and
 * for the same reason. Name-only identity made `Person:Alex` and `Service:Alex`
 * one entity, and made two names that first differ at character 250 one entity
 * as well. Keys stay per-namespace, so scope still lives in the NAMESPACE: two
 * orgs asserting different facts about the same name produce the same id, and
 * only separate namespaces keep them from overwriting each other.
 *
 * Name-only merging did buy something real — it stopped the same entity forking
 * when the LLM said "Module" and the heuristic said "entity" — so that benefit
 * is kept by a NAME INDEX (`kg:names`) rather than by a lossy key. Resolution
 * goes through the index, never through a computed key: a generic assertion
 * adopts the single same-name entity if there is exactly one, a typed assertion
 * adopts a lone untyped one and promotes its type, and anything genuinely
 * ambiguous becomes a separate entity with the alternatives REPORTED as
 * candidates rather than silently merged.
 *
 * KNOWLEDGE IS CLAIMS, not a summary string. Each entity/edge/rule carries a
 * `claims` ledger of per-origin description contributions; the stored
 * `description` is DERIVED from it — the most recent contribution wins, because
 * description length measures verbosity and not truth. That is what makes a
 * correction expressible ("Now PostgreSQL" supersedes a longer MySQL blurb) and
 * what makes rollback reversible: withdrawing an origin drops its contribution
 * and RE-DERIVES the summary from the survivors, so the previous correct
 * description comes back instead of a bad one being frozen in place.
 * `origin_refs` remains, derived from the ledger, so provenance readers are
 * unaffected. Support is never silently truncated: past `MAX_CLAIMS` the entry
 * records `origins_dropped` and `provenance_complete:false`.
 *
 * MIGRATION: nothing is re-keyed, deleted, or orphaned. An entry written under
 * the old `n:<normalized-name>` scheme is still found — resolution falls back to
 * probing the legacy key — and is then adopted IN PLACE under its existing key
 * and registered in the name index. Legacy rows therefore keep working for
 * search, stats, glossary and rollback, and keep their edges (whose keys embed
 * the endpoint keys) intact. Only a genuinely NEW identity distinction — a
 * second type for a name, or a name that differs only past the old truncation
 * point — mints a new hashed id.
 *
 * // monolean: graph traversal is in-process over a paged kg:edges scan. The
 * // bridge exposes no indexed adjacency (src/dst) or origin lookup, so every
 * // neighbourhood/provenance question is a namespace scan; the upgrade path is
 * // a real SQLite edges table with indexed src/dst/origin columns, which turns
 * // these O(namespace) scans into O(matches).
 *
 * @module v1/cli/memory/memory-kg
 */

import { createHash } from 'node:crypto';
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
/** Name → entity index. Index rows are NOT claims, so they live outside the
 *  three claim namespaces: putting them in `kg:nodes` would make them seed
 *  candidates for `kgSearch` and rows in `kgStats`. */
export const KG_NAMES_NS = 'kg:names';

const MAX_NAME_LEN = 200;
const MAX_DESC_LEN = 2000;

/** Nodes/edges/rules accepted per call. Overflow is REPORTED, never sliced away
 *  in silence — see `KgIngestResult.nodesTruncated`. */
const MAX_NODES_PER_CALL = 500;
const MAX_EDGES_PER_CALL = 1000;
const MAX_RULES_PER_CALL = 50;

/** Per-origin description contributions retained on one element.
 *
 *  A cap has to exist — the bridge caps a stored value, and an element asserted
 *  by ten thousand runs would otherwise stop being writable. What must NOT
 *  happen is the old `origin_refs.slice(-100)`, which dropped the oldest
 *  provenance and left the entry claiming complete history. Past this cap the
 *  oldest contributions are dropped AND the entry records `origins_dropped`
 *  with `provenance_complete: false`, so a reader can tell that a rollback of an
 *  old origin may find nothing to withdraw. */
const MAX_CLAIMS = 200;

// ── Identity ────────────────────────────────────────────────────────

/**
 * Version of the identity scheme implemented by `entityId`/`edgeKey`/`ruleKey`.
 *
 * Bump when a derivation changes. Entries written under an older scheme are not
 * orphaned: resolution probes the previous key shape and adopts the row in
 * place (see `resolveEntity`), so a bump costs a second keyed lookup on the
 * miss path rather than a migration.
 *
 * Version 1 was the name-only scheme (`n:<normalized-name>`, truncated to 200
 * characters), under which `Person:Alex` and `Service:Alex` were one entity and
 * two names first differing at character 250 were one entity.
 */
export const KG_ID_VERSION = 2;

/** Identity-grade name normalization: the same folding as `normalizeName` but
 *  WITHOUT its 200-character truncation, which silently merged long names that
 *  differ only past the cut. `normalizeName` keeps truncating because it feeds
 *  tags and display, where length matters and collisions do not. */
function canonicalName(name: string): string {
  return String(name).trim().toLowerCase().replace(/['’]/g, '').replace(/\s+/g, '_');
}

/** Types that assert nothing. A generic label must not fork an entity away from
 *  its typed self, so it maps to the empty discriminator and is resolved by
 *  name (see `resolveEntity`). */
const GENERIC_TYPES = new Set(['', 'entity', 'unknown']);

/** The identity-bearing part of a type: '' when the caller told us nothing. */
function typeBucket(type: string | undefined): string {
  const t = canonicalName(type ?? '');
  return GENERIC_TYPES.has(t) ? '' : t;
}

/** Hash a tuple injectively: every component is length-prefixed, so no
 *  component's content can masquerade as a delimiter or bleed into its
 *  neighbour, and no two distinct tuples share an input string. Same discipline
 *  as monograph's `symbolId`/`fileId` (packages/@monomind/monograph/src/types.ts),
 *  and adopted here for the same reason — the previous scheme lost distinctions
 *  to truncation and to an unescaped separator. */
function hashTuple(components: string[]): string {
  const canonical = components.map((c) => `${Buffer.byteLength(c, 'utf8')}:${c}`).join('');
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}

/** Mint an entity id from the full identity tuple.
 *
 *  This MINTS; it does not RESOLVE. A caller that computes an id and writes to
 *  it bypasses the name index and re-forks the entities the index exists to
 *  keep together — every ingest path goes through `resolveEntity` instead. */
export function nodeKey(type: string, name: string): string {
  return `n:${hashTuple([String(KG_ID_VERSION), typeBucket(type), canonicalName(name)])}`;
}

/** The pre-`KG_ID_VERSION` key for a name: name-only, truncated at 200. Probed
 *  on a miss so existing graphs keep working without being re-keyed. */
function legacyNodeKey(name: string): string {
  return `n:${normalizeName(name)}`;
}

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
 *  afterwards: deleting a row pulls every later row back one position, so under
 *  an advancing offset the row that slid into the gap is never read. (The
 *  bridge's upsert no longer reorders — it reuses the existing entry id and
 *  preserves `createdAt` — so rewrites alone are safe; deletes are not, and
 *  both callers here delete.) */
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
  /** Items the payload asked for that this call refused. Present only when
   *  non-zero, so a caller who sent a clean payload sees a clean result. */
  nodesRejected?: number;
  edgesRejected?: number;
  /** Items dropped because the payload exceeded the per-call cap. The cap has
   *  not changed; what has changed is that it is now REPORTED instead of being
   *  a silent `.slice()`. */
  nodesTruncated?: number;
  edgesTruncated?: number;
  /** Why items were rejected, one message each (capped at MAX_FAILURES). */
  rejections?: string[];
  /** Endpoint entities created because an edge named them and they did not
   *  exist. Edge-only ingestion used to succeed with zero nodes and one edge,
   *  leaving a fact unreachable through both of its own endpoints. */
  placeholders?: number;
  /** Same-name entities this call did NOT merge with, one message each. A
   *  same-name match is a CANDIDATE, not a merge. */
  ambiguities?: string[];
  /** Elements whose support ledger hit `MAX_CLAIMS` on this call, so their
   *  oldest provenance was dropped. Never silent. */
  provenanceTruncated?: number;
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

/** Edge identity: the endpoint IDs (already collision-free) plus the relation,
 *  hashed injectively so a relation containing the old `|` separator can no
 *  longer forge a different edge's key. */
function edgeKey(srcKey: string, relation: string, dstKey: string): string {
  return `e:${hashTuple([String(KG_ID_VERSION), srcKey, canonicalName(relation), dstKey])}`;
}

/** The pre-`KG_ID_VERSION` edge key, for the same in-place adoption as
 *  `legacyNodeKey`. Composed from the RESOLVED endpoint keys, so it names the
 *  legacy edge exactly when both endpoints are themselves legacy rows. */
function legacyEdgeKey(srcKey: string, relation: string, dstKey: string): string {
  return `e:${srcKey}|${normalizeName(relation)}|${dstKey}`;
}

/** Rule identity: the full rule text. The old key truncated the normalized rule
 *  at 120 characters, so two rules sharing a long preamble were one rule. */
function ruleKey(rule: string): string {
  return `rule:${hashTuple([String(KG_ID_VERSION), canonicalName(rule)])}`;
}

function legacyRuleKey(rule: string): string {
  return `rule:${normalizeName(rule).slice(0, 120)}`;
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
  /** Name → entity index backing `resolveEntity`. Holds no claims. */
  names: string;
}

/** The namespaces a scope owns. Every read and write in this module resolves
 *  through here, which is what makes ownership enforced rather than advisory:
 *  there is no code path that reaches an org's facts without naming that org,
 *  and none that reaches every org at once. */
export function kgNamespaces(scope?: KgScope): KgNamespaces {
  const org = scope?.org?.trim();
  if (!org) return { nodes: KG_NODES_NS, edges: KG_EDGES_NS, rules: RULES_NS, names: KG_NAMES_NS };
  const suffix = `:org:${normalizeName(org)}`;
  return {
    nodes: KG_NODES_NS + suffix,
    edges: KG_EDGES_NS + suffix,
    rules: RULES_NS + suffix,
    names: KG_NAMES_NS + suffix,
  };
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

// ── Claims (per-origin support, from which summaries are derived) ────

/** One origin's assertion about an element. An origin re-asserting replaces its
 *  own contribution — a run stands behind its latest word, not its first. */
export interface KgClaim {
  origin: string;
  description: string;
  /** Assertion time, and the ordering that decides which claim is current. */
  at: number;
}

/** The stored fields derived from a claim ledger. `description` is DERIVED, so
 *  no caller can set it directly and no merge rule has to guess which of two
 *  strings is truer. */
interface DerivedClaims {
  claims: KgClaim[];
  description: string;
  origin_refs: string[];
  provenance_complete: boolean;
  origins_dropped: number;
  /** Two or more live origins assert materially different descriptions. The
   *  summary is still the latest one; this says the graph knows it is disputed
   *  rather than settled. */
  conflict: boolean;
}

function claimsOf(md: Record<string, unknown>): KgClaim[] {
  const raw = md.claims;
  if (Array.isArray(raw))
    return (raw as KgClaim[])
      .filter((c) => c && typeof c.origin === 'string')
      .map((c) => ({
        origin: c.origin,
        description: typeof c.description === 'string' ? c.description : '',
        at: typeof c.at === 'number' ? c.at : 0,
      }));
  // Pre-ledger row (including every entry written before KG_ID_VERSION 2):
  // seed one contribution per recorded origin, all carrying the one description
  // the merge left behind. That is the honest reconstruction — the old merge
  // destroyed which origin said what — and it preserves current rollback
  // behaviour exactly: withdrawing one of several origins leaves the summary
  // unchanged, withdrawing the last deletes the element.
  const origins = Array.isArray(md.origin_refs) ? (md.origin_refs as string[]) : [];
  const description = typeof md.description === 'string' ? md.description : '';
  const at = typeof md.valid_from === 'number' ? md.valid_from : 0;
  return origins.map((origin) => ({ origin, description, at }));
}

/** Add or replace `origin`'s contribution and re-derive everything that hangs
 *  off the ledger. */
function applyClaim(
  md: Record<string, unknown>,
  origin: string,
  description: string,
  now: number,
): DerivedClaims {
  const existing = claimsOf(md);
  const dropped = typeof md.origins_dropped === 'number' ? md.origins_dropped : 0;

  // An EMPTY description is support without content — "this entity exists",
  // which is what naming an edge endpoint asserts. It must never overwrite what
  // the same origin already said, or an edge listing a node the same payload
  // described would blank that description out.
  const prior = existing.find((c) => c.origin === origin);
  if (!description.trim() && prior?.description.trim()) return deriveClaims(existing, dropped);

  const claims = existing.filter((c) => c.origin !== origin);
  claims.push({ origin, description, at: now });
  return deriveClaims(claims, dropped);
}

function deriveClaims(claims: KgClaim[], alreadyDropped: number): DerivedClaims {
  let dropped = alreadyDropped;
  if (claims.length > MAX_CLAIMS) {
    // Oldest support goes first, and the loss is RECORDED. The scheme this
    // replaced did the same drop silently and left the entry claiming a
    // complete history it no longer had.
    dropped += claims.length - MAX_CLAIMS;
    claims = claims.slice(-MAX_CLAIMS);
  }
  return {
    claims,
    description: currentDescription(claims),
    origin_refs: claims.map((c) => c.origin),
    provenance_complete: dropped === 0,
    origins_dropped: dropped,
    conflict: new Set(claims.map((c) => c.description.trim()).filter(Boolean)).size > 1,
  };
}

/** The current summary: the most recent contribution that actually says
 *  something. LATEST wins, not longest — length measures verbosity, and
 *  "longest wins" is why re-ingesting a corrected "Now PostgreSQL" left the
 *  stale MySQL blurb in place. */
function currentDescription(claims: KgClaim[]): string {
  let best: KgClaim | undefined;
  for (const c of claims) {
    if (!c.description.trim()) continue;
    if (!best || c.at >= best.at) best = c;
  }
  return best?.description ?? '';
}

/** Withdraw one origin. Returns null when nothing supports the element any
 *  more (the caller deletes it); otherwise the RE-DERIVED state, which is what
 *  restores a previous correct description after a bad update is rolled back. */
function withoutOrigin(md: Record<string, unknown>, origin: string): DerivedClaims | null {
  const remaining = claimsOf(md).filter((c) => c.origin !== origin);
  if (!remaining.length) return null;
  return deriveClaims(remaining, typeof md.origins_dropped === 'number' ? md.origins_dropped : 0);
}

// ── Name index (same-name candidates, without name-only identity) ────

/** An entity the name index knows about. */
export interface KgNameCandidate {
  id: string;
  /** Identity-bearing type bucket; '' for an entity asserted without a type. */
  type: string;
}

function nameIndexKey(name: string): string {
  return `nm:${hashTuple([String(KG_ID_VERSION), canonicalName(name)])}`;
}

/** @returns the indexed entities, or null when the backend could not be read.
 *
 *  The null is load-bearing: an unreadable index looks exactly like an empty
 *  one, and treating a read failure as "no entities with this name" would make
 *  the next write REPLACE the row with a single entry, erasing every other
 *  same-name entity from the index. A later generic assertion would then see one
 *  candidate and adopt it — a silent wrong merge caused by a read hiccup. */
async function readNameIndex(
  name: string,
  ns: KgNamespaces,
  dbPath: string | undefined,
): Promise<KgNameCandidate[] | null> {
  const res = await bridgeGetEntry({ key: nameIndexKey(name), namespace: ns.names, dbPath });
  if (!res) return null;
  const raw = (res.entry?.metadata as Record<string, unknown> | undefined)?.entities;
  if (!Array.isArray(raw)) return [];
  return (raw as KgNameCandidate[]).filter((c) => c && typeof c.id === 'string');
}

/** Persist (or clear) the index row for one name.
 *
 *  The index is a HINT, not a source of truth: it is written after the entity
 *  write lands, and a row that goes stale — pointing at an entity a rollback
 *  removed — self-heals, because resolving onto a missing id makes the next
 *  ingest create that entity fresh with an empty claim ledger, which is exactly
 *  what a new entity is. Nothing reads the index to decide what the graph
 *  contains; `kgStats`, `kgSearch` and `kgRollback` all read the claim
 *  namespaces. */
async function writeNameIndex(
  name: string,
  entities: KgNameCandidate[],
  ns: KgNamespaces,
  dbPath: string | undefined,
  failures: FailureLog,
): Promise<void> {
  const key = nameIndexKey(name);
  if (!entities.length) {
    await bridgeDeleteEntry({ key, namespace: ns.names, dbPath });
    return;
  }
  const res = await bridgeStoreEntry({
    key,
    value: name,
    namespace: ns.names,
    dbPath,
    upsert: true,
    generateEmbeddingFlag: false,
    tags: ['kg', 'name-index'],
    metadata: { kg: 'name', name, entities },
  });
  failures.add(res, `name index ${key}`);
}

/** What resolving a name against the index produced. */
interface ResolvedEntity {
  id: string;
  /** Same-name entities this assertion did NOT merge with. Reported, never
   *  merged away — "Alex the person" and "Alex the service" are candidates for
   *  a human or a consolidation pass to judge, not a merge the graph may do on
   *  its own. */
  candidates: KgNameCandidate[];
  /** Index content to persist for this name, or null when it is already
   *  correct. Written only after the entity write lands, so a refused write
   *  never leaves the index pointing at an entity that does not exist. */
  index: KgNameCandidate[] | null;
}

/**
 * Resolve (type, name) to the entity that should carry the assertion.
 *
 * Identity is the (type, name) tuple, so distinct types are distinct entities.
 * The one thing name-only identity got right — a generic label must not fork an
 * entity away from its typed self — is preserved here instead of in the key:
 *
 *  - exact type-bucket match  → that entity
 *  - generic assertion, exactly one same-name entity → adopt it
 *  - typed assertion, exactly one same-name entity and it is untyped → adopt it
 *    and promote its type (its ID does not change, so references stay valid)
 *  - anything else            → a new entity, with the alternatives as candidates
 *
 * @returns null when the name index could not be read — the caller must refuse
 * the assertion rather than resolve it against an index it could not see.
 */
async function resolveEntity(
  name: string,
  type: string,
  ns: KgNamespaces,
  dbPath: string | undefined,
): Promise<ResolvedEntity | null> {
  const bucket = typeBucket(type);
  let known = await readNameIndex(name, ns, dbPath);
  if (known === null) return null;
  /** True when the index row already holds exactly `known` — the only case in
   *  which an unchanged resolution needs no index write. */
  let indexed = known.length > 0;

  if (!indexed) {
    // Nothing indexed. Before minting, probe the pre-KG_ID_VERSION key: an
    // existing graph's rows are adopted IN PLACE (keeping their key, and so
    // keeping the edges whose keys embed it) rather than re-keyed or orphaned.
    const legacyKey = legacyNodeKey(name);
    const legacy = await bridgeGetEntry({ key: legacyKey, namespace: ns.nodes, dbPath });
    if (legacy?.found && legacy.entry) {
      const md = legacy.entry.metadata as Record<string, unknown>;
      known = [{ id: legacyKey, type: typeBucket(typeof md.type === 'string' ? md.type : '') }];
      indexed = false;
    }
  }

  const exact = known.find((c) => c.type === bucket);
  if (exact)
    return { id: exact.id, candidates: others(known, exact.id), index: indexed ? null : known };

  // A generic assertion adopts the one entity that bears this name; a typed
  // assertion adopts a lone UNTYPED entity and PROMOTES it — same id, so every
  // edge and returned reference to it stays valid. A typed assertion never
  // absorbs a differently-typed entity, and neither adopts when the name is
  // already ambiguous.
  if (known.length === 1 && (!bucket || !known[0].type)) {
    const only = known[0];
    const promoted = { id: only.id, type: bucket || only.type };
    return { id: only.id, candidates: [], index: [promoted] };
  }

  const minted = { id: mintEntityId(type, name, known), type: bucket };
  return { id: minted.id, candidates: known, index: [...known, minted] };
}

/** An ID for a new entity that no entity under this name already uses.
 *
 *  `nodeKey(type, name)` alone is not sufficient, because promotion decouples
 *  an entity's ID from its current type: an entity minted untyped keeps the
 *  `''`-bucket ID after a typed assertion promotes it, so a LATER untyped
 *  assertion would re-derive that same ID and write its claims into the
 *  promoted entity — while simultaneously reporting that entity as one it had
 *  "kept separate from". The discriminator is bumped only on collision, so the
 *  first entity of a (type, name) still gets exactly `nodeKey(type, name)`. */
function mintEntityId(type: string, name: string, known: KgNameCandidate[]): string {
  const taken = new Set(known.map((c) => c.id));
  let id = nodeKey(type, name);
  for (let n = 1; taken.has(id); n++)
    id = `n:${hashTuple([String(KG_ID_VERSION), typeBucket(type), canonicalName(name), String(n)])}`;
  return id;
}

function others(known: KgNameCandidate[], id: string): KgNameCandidate[] {
  return known.filter((c) => c.id !== id);
}

// ── Ingest ──────────────────────────────────────────────────────────

/** Merge extracted nodes/edges into the KG.
 *
 *  Identity is the (type, name) tuple resolved through the name index, so an
 *  entity is idempotent under re-extraction but two different things sharing a
 *  name stay two things. Each write adds this origin's CONTRIBUTION to the
 *  element's claim ledger, from which the description and `origin_refs` are
 *  derived — which is what lets a later ingest correct an earlier one and lets
 *  rollback put the earlier one back.
 *
 *  The COMPLETE payload is validated before anything is written, and every edge
 *  endpoint is made to exist (as a placeholder entity when the caller named one
 *  that does not) before the edge lands. An edge whose endpoint could not be
 *  created is rejected rather than written: retrieval is seeded from nodes, so
 *  an edge with a missing endpoint is a fact that cannot be found through
 *  either of the things it is about.
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
  const report = new IngestReport();
  let nodesAdded = 0,
    nodesMerged = 0,
    edgesAdded = 0,
    edgesMerged = 0;

  try {
    // ── Validate the COMPLETE payload before mutating anything ──
    // An invalid item that surfaces halfway through leaves the graph holding
    // part of a payload the caller was told was rejected.
    const allNodes = options.nodes ?? [];
    const allEdges = options.edges ?? [];
    const nodes = allNodes.slice(0, MAX_NODES_PER_CALL);
    const edges = allEdges.slice(0, MAX_EDGES_PER_CALL);
    report.nodesTruncated = allNodes.length - nodes.length;
    report.edgesTruncated = allEdges.length - edges.length;

    const validNodes: { input: KgNodeInput; type: string; desc: string }[] = [];
    nodes.forEach((n, i) => {
      if (!n?.name?.trim()) return report.rejectNode(`node[${i}]: missing name`);
      validNodes.push({
        input: n,
        type: n.type?.trim() || 'entity',
        desc: (n.description ?? '').slice(0, MAX_DESC_LEN),
      });
    });
    const validEdges: KgEdgeInput[] = [];
    edges.forEach((e, i) => {
      const missing = !e?.source?.trim()
        ? 'source'
        : !e?.target?.trim()
          ? 'target'
          : !e?.relation?.trim()
            ? 'relation'
            : '';
      if (missing) return report.rejectEdge(`edge[${i}]: missing ${missing}`);
      validEdges.push(e);
    });

    /** Entity IDs this call has already resolved AND confirmed to exist, so an
     *  edge does not re-resolve an endpoint the node loop just wrote. */
    const resolved = new Map<string, string>();
    const memoKey = (name: string, type: string) => `${typeBucket(type)} ${canonicalName(name)}`;

    for (const { input: n, type, desc } of validNodes) {
      const target = await resolveEntity(n.name, type, ns, dbPath);
      if (!target) {
        failures.note(`node ${n.name}: name index unreadable`);
        continue;
      }
      report.noteAmbiguity(n.name, target.candidates);
      const wrote = await writeEntity({
        id: target.id,
        name: n.name,
        type,
        description: desc,
        nodeSet: n.nodeSet,
        originRef,
        ns,
        dbPath,
        failures,
        report,
      });
      if (wrote === null) continue;
      if (wrote) nodesAdded++;
      else nodesMerged++;
      resolved.set(memoKey(n.name, type), target.id);
      if (target.index) await writeNameIndex(n.name, target.index, ns, dbPath, failures);
    }

    /** Resolve an edge endpoint, creating an explicit placeholder entity when
     *  the caller named something that does not exist. Returns null when the
     *  endpoint could not be made to exist — the edge is then rejected rather
     *  than written without it. */
    const endpoint = async (name: string, type: string | undefined): Promise<string | null> => {
      const memo = memoKey(name, type ?? 'entity');
      const hit = resolved.get(memo);
      if (hit) return hit;
      const target = await resolveEntity(name, type ?? 'entity', ns, dbPath);
      if (!target) {
        failures.note(`endpoint ${name}: name index unreadable`);
        return null;
      }
      report.noteAmbiguity(name, target.candidates);
      // Always write: naming an endpoint IS an assertion that it exists, so
      // this origin joins the entity's support either way. A write that CREATES
      // the entity is the placeholder case worth reporting.
      const wrote = await writeEntity({
        id: target.id,
        name,
        type: type ?? 'entity',
        description: '',
        placeholder: true,
        originRef,
        ns,
        dbPath,
        failures,
        report,
      });
      if (wrote === null) return null;
      if (wrote) report.placeholders++;
      if (target.index) await writeNameIndex(name, target.index, ns, dbPath, failures);
      resolved.set(memo, target.id);
      return target.id;
    };

    for (const e of validEdges) {
      const srcKey = await endpoint(e.source, e.sourceType);
      const dstKey = await endpoint(e.target, e.targetType);
      if (!srcKey || !dstKey) {
        report.rejectEdge(`edge ${e.source}-${e.relation}->${e.target}: endpoint not persisted`);
        continue;
      }
      const desc = (e.description ?? '').slice(0, MAX_DESC_LEN);
      const fallbackFact = `${e.source} ${e.relation} ${e.target}`;

      // New key first, then the pre-KG_ID_VERSION shape: a legacy edge between
      // two adopted legacy endpoints keeps its own key rather than being
      // duplicated under a new one.
      let key = edgeKey(srcKey, e.relation, dstKey);
      let existing = await bridgeGetEntry({ key, namespace: ns.edges, dbPath });
      if (!existing?.found) {
        const legacy = legacyEdgeKey(srcKey, e.relation, dstKey);
        const hit = await bridgeGetEntry({ key: legacy, namespace: ns.edges, dbPath });
        if (hit?.found && hit.entry) {
          key = legacy;
          existing = hit;
        }
      }

      const isNew = !(existing?.found && existing.entry);
      const md = (existing?.entry?.metadata ?? {}) as Record<string, unknown>;
      const derived = applyClaim(md, originRef, desc, Date.now());
      const res = await bridgeStoreEntry({
        key,
        value: derived.description || fallbackFact,
        namespace: ns.edges,
        dbPath,
        upsert: true,
        generateEmbeddingFlag: false,
        tags: ['kg', normalizeName(e.relation)],
        metadata: {
          ...md,
          kg: 'edge',
          id_version: KG_ID_VERSION,
          src: srcKey,
          dst: dstKey,
          relation: normalizeName(e.relation),
          source_name: e.source,
          target_name: e.target,
          ...derived,
          valid_from: md.valid_from ?? Date.now(),
          valid_to: null,
        },
      });
      if (failures.add(res, `edge ${key}`)) continue;
      report.noteProvenanceLoss(md, derived);
      if (isNew) edgesAdded++;
      else edgesMerged++;
    }

    return {
      success: !failures.failed,
      nodesAdded,
      nodesMerged,
      edgesAdded,
      edgesMerged,
      ...(failures.failed ? { failures: failures.messages, error: failures.summary() } : {}),
      ...report.fields(),
    };
  } catch (err) {
    return {
      success: false,
      nodesAdded,
      nodesMerged,
      edgesAdded,
      edgesMerged,
      ...(failures.messages.length ? { failures: failures.messages } : {}),
      ...report.fields(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Write one entity's claim contribution.
 *
 *  @returns true when the entity was created, false when an existing one was
 *  merged into, and null when the bridge refused the write (the caller must not
 *  count it, and must not treat the entity as existing). */
async function writeEntity(o: {
  id: string;
  name: string;
  type: string;
  description: string;
  nodeSet?: string;
  placeholder?: boolean;
  originRef: string;
  ns: KgNamespaces;
  dbPath: string | undefined;
  failures: FailureLog;
  report: IngestReport;
}): Promise<boolean | null> {
  const existing = await bridgeGetEntry({ key: o.id, namespace: o.ns.nodes, dbPath: o.dbPath });
  const isNew = !(existing?.found && existing.entry);
  const md = (existing?.entry?.metadata ?? {}) as Record<string, unknown>;
  const derived = applyClaim(md, o.originRef, o.description, Date.now());

  // Keep the most specific type: a generic heuristic 'entity' never overwrites
  // an LLM-assigned one, and a specific one promotes an untyped entity.
  const prevType = typeof md.type === 'string' ? md.type : '';
  const bestType = typeBucket(prevType) ? prevType : o.type;
  const nodeSet = o.nodeSet ?? (typeof md.node_set === 'string' ? md.node_set : null);

  const res = await bridgeStoreEntry({
    key: o.id,
    value: `${o.name} — ${derived.description || bestType}`,
    namespace: o.ns.nodes,
    dbPath: o.dbPath,
    upsert: true,
    tags: ['kg', normalizeName(bestType), ...(nodeSet ? [normalizeName(nodeSet)] : [])],
    metadata: {
      ...md,
      kg: 'node',
      id_version: KG_ID_VERSION,
      type: bestType,
      name: o.name,
      node_set: nodeSet,
      ...derived,
      // A placeholder stops being one the moment a real assertion describes it.
      placeholder: o.placeholder === true && !derived.description ? true : undefined,
      version: (typeof md.version === 'number' ? md.version : 0) + 1,
      valid_from: md.valid_from ?? Date.now(),
      valid_to: null,
    },
  });
  // Name first: the ID is a digest, and a failure message a human cannot map
  // back to the thing that failed is not a diagnosis.
  if (o.failures.add(res, `node ${o.name} (${o.id})`)) return null;
  // Only after the write landed: a refused write dropped no provenance, because
  // it changed nothing.
  o.report.noteProvenanceLoss(md, derived);
  return isNew;
}

/** The accepted/rejected/truncated bookkeeping a caller needs in order to know
 *  that what it sent is what the graph holds. */
class IngestReport {
  nodesRejected = 0;
  edgesRejected = 0;
  nodesTruncated = 0;
  edgesTruncated = 0;
  placeholders = 0;
  provenanceTruncated = 0;
  readonly rejections: string[] = [];
  readonly ambiguities: string[] = [];

  rejectNode(message: string): void {
    this.nodesRejected++;
    if (this.rejections.length < MAX_FAILURES) this.rejections.push(message);
  }

  rejectEdge(message: string): void {
    this.edgesRejected++;
    if (this.rejections.length < MAX_FAILURES) this.rejections.push(message);
  }

  noteAmbiguity(name: string, candidates: KgNameCandidate[]): void {
    if (!candidates.length || this.ambiguities.length >= MAX_FAILURES) return;
    const types = candidates.map((c) => c.type || 'untyped').join(', ');
    this.ambiguities.push(`${name}: kept separate from ${candidates.length} same-name (${types})`);
  }

  noteProvenanceLoss(md: Record<string, unknown>, derived: DerivedClaims): void {
    const before = typeof md.origins_dropped === 'number' ? md.origins_dropped : 0;
    if (derived.origins_dropped > before) this.provenanceTruncated++;
  }

  /** Only non-zero counters are emitted, so a clean payload yields a clean
   *  result and the existing `KgIngestResult` shape is unchanged for callers
   *  that construct it themselves. */
  fields(): Partial<KgIngestResult> {
    return {
      ...(this.nodesRejected ? { nodesRejected: this.nodesRejected } : {}),
      ...(this.edgesRejected ? { edgesRejected: this.edgesRejected } : {}),
      ...(this.nodesTruncated ? { nodesTruncated: this.nodesTruncated } : {}),
      ...(this.edgesTruncated ? { edgesTruncated: this.edgesTruncated } : {}),
      ...(this.rejections.length ? { rejections: this.rejections } : {}),
      ...(this.placeholders ? { placeholders: this.placeholders } : {}),
      ...(this.ambiguities.length ? { ambiguities: this.ambiguities } : {}),
      ...(this.provenanceTruncated ? { provenanceTruncated: this.provenanceTruncated } : {}),
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
  /** Candidates dropped by the per-call cap, reported rather than sliced away
   *  in silence. */
  rulesTruncated?: number;
}> {
  const verdicts: RuleVerdict[] = [];
  const threshold = options.dedupThreshold ?? 0.78;
  const failures = new FailureLog();
  const ns = kgNamespaces(options.scope);
  // Direct writes here store the qualified ref; nested kgIngest calls get the
  // RAW ref plus the scope and qualify it themselves, so it is stamped once.
  const originRef = kgQualifyOrigin(options.originRef, options.scope);
  let accepted = 0;
  const all = options.rules ?? [];
  const batch = all.slice(0, MAX_RULES_PER_CALL);
  const rulesTruncated = all.length - batch.length;

  try {
    for (const r of batch) {
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

      // Identity is the full rule text. The old key truncated at 120 normalized
      // characters, so two rules sharing a long preamble were the same rule.
      // A rule stored under that scheme is adopted in place rather than
      // duplicated under the new key.
      let key = ruleKey(rule);
      let priorMd: Record<string, unknown> = {};
      const current = await bridgeGetEntry({ key, namespace: ns.rules, dbPath: options.dbPath });
      if (current?.found && current.entry) priorMd = current.entry.metadata as typeof priorMd;
      else {
        const legacy = legacyRuleKey(rule);
        const hit = await bridgeGetEntry({
          key: legacy,
          namespace: ns.rules,
          dbPath: options.dbPath,
        });
        if (hit?.found && hit.entry) {
          key = legacy;
          priorMd = hit.entry.metadata as typeof priorMd;
        }
      }
      // The mirrored KG node is named by the FULL rule text. Truncating it to
      // 200 characters put two rules sharing a long preamble on one node — the
      // same collision `ruleKey` was just widened to prevent, reintroduced one
      // namespace over.
      const ruleName = rule;
      const stored = await bridgeStoreEntry({
        key,
        value: rule + (r.context ? `\n(context: ${r.context.slice(0, 500)})` : ''),
        namespace: ns.rules,
        dbPath: options.dbPath,
        upsert: true,
        tags: ['rule'],
        metadata: {
          ...priorMd,
          ...applyClaim(priorMd, originRef, rule, Date.now()),
          id_version: KG_ID_VERSION,
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
      ...(rulesTruncated ? { rulesTruncated } : {}),
    };
  } catch (err) {
    return {
      success: false,
      verdicts,
      accepted,
      ...(failures.messages.length ? { failures: failures.messages } : {}),
      ...(rulesTruncated ? { rulesTruncated } : {}),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Add `originRef` to an already-stored rule's support set — both the
 *  `rules`-namespace entry and its `node_set=rules` KG node. Idempotent in
 *  effect: re-asserting an origin the rule already carries leaves the support
 *  set unchanged. */
async function reinforceRuleOrigin(
  matchedKey: string,
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
  const existing = await bridgeGetEntry({ key: matchedKey, namespace: ns.rules, dbPath });
  if (!existing?.found || !existing.entry) {
    // The dedup hit came from search; if the entry can't be re-read by key the
    // support set cannot be updated, and silently proceeding is exactly the
    // provenance loss this function exists to prevent.
    failures.note(`rule ${matchedKey}: matched by dedup but not readable by key`);
    return;
  }
  const entry = existing.entry;
  const md = entry.metadata as Record<string, unknown>;
  const origins = Array.isArray(md.origin_refs) ? (md.origin_refs as string[]) : [];
  // The KG node's name: recorded at accept time, else the first line of the
  // stored value (any context block is appended after a newline).
  const ruleName =
    typeof md.rule === 'string' && md.rule
      ? md.rule
      : (matchedContent || entry.content).split('\n')[0];

  if (!origins.includes(qualified)) {
    const res = await bridgeStoreEntry({
      key: entry.key,
      value: entry.content,
      namespace: ns.rules,
      dbPath,
      upsert: true,
      generateEmbeddingFlag: entry.hasEmbedding,
      tags: entry.tags,
      metadata: {
        ...md,
        rule: ruleName,
        // A dedup hit is SUPPORT, not a correction: the candidate asserts the
        // rule the entry already holds. Its contribution therefore carries no
        // description of its own — passing one here (the truncated `rule` name,
        // as this did) made the newest claim disagree with the stored text and
        // flagged the rule as conflicted with a truncation of itself.
        ...applyClaim(md, qualified, '', Date.now()),
      },
    });
    failures.add(res, `rule ${entry.key}`);
  }

  // The rule's KG node needs the same origin — rollback walks nodes separately.
  const nodeRes = await kgIngest({
    nodes: [{ name: ruleName, type: 'Rule', description: '', nodeSet: 'rules' }],
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
        // Tags carry the stored type (`['kg', <type>, …]`). The key never did:
        // reading `key.split(':')[1]` reported the type of `n:shared_service`
        // as `shared_service`, and under hashed IDs would report a digest.
        type: (s.tags ?? [])[1] ?? 'entity',
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
 *  deleting a row pulls later rows back, so an advancing offset would skip
 *  whatever slid into the gap. Only origin-carrying entries are retained, so
 *  memory tracks the operation's own footprint, not the namespace size. */
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
 *  Collect-then-mutate is deliberate: deleting a row pulls every later row back
 *  one position, so a delete inside the page loop would make an advancing
 *  offset skip whatever slid into the gap. (Rewrites are no longer a hazard —
 *  the bridge's upsert reuses the existing entry id and preserves `createdAt`
 *  rather than re-inserting at the head of the default ordering — but this
 *  function deletes as well as rewrites.) Only origin-carrying entries are
 *  retained during the scan, so memory tracks the rollback's own footprint, not
 *  the namespace size. */
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
  /** Edges deleted because this rollback removed an endpoint they name. A
   *  relation between two things is not a fact once one of them is gone, and
   *  retrieval is node-seeded, so leaving them behind left unreachable rows
   *  claiming a graph that no longer exists. */
  danglingEdgesRemoved?: number;
}> {
  const failures = new FailureLog();
  const namespaces = kgNamespaces(options.scope);
  const originRef = kgQualifyOrigin(options.originRef, options.scope);
  let deleted = 0,
    retained = 0;
  /** Entity IDs this rollback removed, and the names that pointed at them. */
  const removedIds = new Set<string>();
  const removedNames = new Set<string>();
  try {
    for (const ns of [namespaces.nodes, namespaces.edges, namespaces.rules]) {
      const found = await collectByOrigin(ns, originRef, options.dbPath);
      // A partial scan cannot be reported as a completed withdrawal.
      if (!found.covered) {
        failures.note(`${ns}: memory backend unavailable`);
        continue;
      }
      const withdrawn = found.entries.map((e) => ({
        entry: e,
        // Re-derive from the claim ledger rather than editing an origin list:
        // this is what puts back the description a withdrawn origin overwrote.
        remaining: withoutOrigin((e.metadata ?? {}) as Record<string, unknown>, originRef),
      }));

      for (const { entry: e, remaining } of withdrawn) {
        const md = (e.metadata ?? {}) as Record<string, unknown>;

        if (remaining === null) {
          const del = await bridgeDeleteEntry({ id: e.id, namespace: ns, dbPath: options.dbPath });
          if (del?.deleted) deleted++;
          else failures.note(`${ns}/${e.key}: delete failed`);
          if (ns === namespaces.nodes && del?.deleted) {
            removedIds.add(e.key);
            if (typeof md.name === 'string') removedNames.add(md.name);
          }
          continue;
        }

        const store = await bridgeStoreEntry({
          key: e.key,
          value: rerender(e.content, md, remaining.description, ns === namespaces.rules),
          namespace: ns,
          dbPath: options.dbPath,
          upsert: true,
          // Edges are stored without embeddings; re-deriving one here would
          // silently change how the entry behaves in search.
          generateEmbeddingFlag: e.hasEmbedding,
          tags: e.tags,
          metadata: { ...md, ...remaining },
        });
        if (!failures.add(store, `${ns}/${e.key}: origin withdrawal`)) retained++;
      }
    }

    // Drop the removed entities out of the name index, so a later ingest of the
    // same name does not resolve onto an entity that no longer exists.
    for (const name of removedNames) {
      const known = await readNameIndex(name, namespaces, options.dbPath);
      if (known === null) {
        // An unreadable index must not be rewritten from a guess — doing so
        // would erase every same-name entity this rollback did NOT remove.
        failures.note(`${namespaces.names}: name index unreadable for ${name}`);
        continue;
      }
      const survivors = known.filter((c) => !removedIds.has(c.id));
      if (survivors.length !== known.length)
        await writeNameIndex(name, survivors, namespaces, options.dbPath, failures);
    }

    const danglingEdgesRemoved = removedIds.size
      ? await removeEdgesMissingEndpoints(namespaces, removedIds, options.dbPath, failures)
      : 0;

    return {
      success: !failures.failed,
      deleted,
      retained,
      ...(failures.failed ? { failures: failures.messages, error: failures.summary() } : {}),
      ...(danglingEdgesRemoved ? { danglingEdgesRemoved } : {}),
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

/** Re-render a stored value after its derived description changed.
 *
 *  Rules are left alone: their value is the rule text plus an optional context
 *  block, not a rendering of a description. */
function rerender(
  content: string,
  md: Record<string, unknown>,
  description: string,
  isRule: boolean,
): string {
  if (isRule || description === md.description) return content;
  if (md.kg === 'edge') return description || `${md.source_name} ${md.relation} ${md.target_name}`;
  return `${md.name} — ${description || md.type}`;
}

/** Delete every edge incident to one of `removedIds`. Collect-then-mutate for
 *  the same reason `kgRollback` does. */
async function removeEdgesMissingEndpoints(
  ns: KgNamespaces,
  removedIds: Set<string>,
  dbPath: string | undefined,
  failures: FailureLog,
): Promise<number> {
  const doomed: ScannedEntry[] = [];
  const covered = await scanNamespace(ns.edges, dbPath, (page) => {
    for (const e of page) {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      if (removedIds.has(String(md.src)) || removedIds.has(String(md.dst))) doomed.push(e);
    }
  });
  if (!covered) {
    failures.note(`${ns.edges}: memory backend unavailable during dangling-edge sweep`);
    return 0;
  }
  let removed = 0;
  for (const e of doomed) {
    const del = await bridgeDeleteEntry({ id: e.id, namespace: ns.edges, dbPath });
    if (del?.deleted) removed++;
    else failures.note(`${ns.edges}/${e.key}: dangling-edge delete failed`);
  }
  return removed;
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
    /** A batch that REJECTED part of what it was handed did not promote the
     *  whole origin, so it cannot be reported as a clean share. Rejections are
     *  not in `failures` — they are the caller's payload being refused, not the
     *  bridge failing — so they have to be carried across explicitly. */
    const carry = (res: KgIngestResult, what: string) => {
      if (res.failures?.length) for (const m of res.failures) failures.note(m);
      const rejected = (res.nodesRejected ?? 0) + (res.edgesRejected ?? 0);
      if (rejected) failures.note(`${what}: ${rejected} item(s) rejected — ${res.rejections?.[0]}`);
    };
    // kgIngest caps a call at 500 nodes / 1000 edges, so a large origin has to
    // be promoted in batches rather than silently truncated. Nodes go first so
    // every edge endpoint already exists when the edges land.
    for (let i = 0; i < nodes.length; i += MAX_NODES_PER_CALL) {
      const res = await kgIngest({
        nodes: nodes.slice(i, i + MAX_NODES_PER_CALL),
        originRef: promotedAs,
        dbPath: options.dbPath,
      });
      promotedNodes += res.nodesAdded + res.nodesMerged;
      carry(res, 'promoted nodes');
    }
    for (let i = 0; i < edges.length; i += MAX_EDGES_PER_CALL) {
      const res = await kgIngest({
        nodes: [],
        edges: edges.slice(i, i + MAX_EDGES_PER_CALL),
        originRef: promotedAs,
        dbPath: options.dbPath,
      });
      promotedEdges += res.edgesAdded + res.edgesMerged;
      carry(res, 'promoted edges');
    }
    for (let i = 0; i < rules.length; i += MAX_RULES_PER_CALL) {
      const res = await kgIngestRules({
        rules: rules.slice(i, i + MAX_RULES_PER_CALL),
        originRef: promotedAs,
        dbPath: options.dbPath,
      });
      promotedRules += res.accepted;
      if (res.failures?.length) for (const m of res.failures) failures.note(m);
      const invalid = res.verdicts.filter((v) => v.verdict === 'invalid').length;
      if (invalid) failures.note(`promoted rules: ${invalid} rejected as invalid`);
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
 *  description from the neighborhood facts and resubmits via memory_kg_ingest.
 *  A resubmission is a NEW contribution and therefore the current one, so a
 *  shorter but better-supported summary now wins; under "longest description
 *  wins" a consolidation that tightened the prose was silently discarded.
 *  No LLM here (fully local constraint). */
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

// ── Integrity ───────────────────────────────────────────────────────

export interface KgIntegrityResult {
  success: boolean;
  edges: number;
  /** Edges naming an endpoint that does not exist. Retrieval is node-seeded,
   *  so such an edge is a fact unreachable through either of the things it is
   *  about — it can only be found by a check like this one. */
  dangling: { key: string; missing: string[] }[];
  /** True when the edge scan did not cover the namespace: absence of a dangling
   *  edge here is then not evidence that there is none. */
  truncated?: boolean;
  error?: string;
}

/** Verify that every edge's endpoints exist.
 *
 *  `kgIngest` now creates missing endpoints before writing an edge and
 *  `kgRollback` removes edges whose endpoints it deleted, so a healthy graph
 *  reports nothing. This exists for graphs written before either rule, and as
 *  the check that says so rather than assuming it. */
export async function kgIntegrityCheck(options?: {
  dbPath?: string;
  scope?: KgScope;
  /** Dangling edges to report before stopping (default 100). */
  limit?: number;
}): Promise<KgIntegrityResult> {
  const ns = kgNamespaces(options?.scope);
  const limit = options?.limit ?? 100;
  const dangling: KgIntegrityResult['dangling'] = [];
  let edges = 0;
  try {
    /** Endpoint id → exists. One keyed lookup per DISTINCT endpoint. */
    const seen = new Map<string, boolean>();
    const exists = async (id: string): Promise<boolean> => {
      const hit = seen.get(id);
      if (hit !== undefined) return hit;
      const res = await bridgeGetEntry({ key: id, namespace: ns.nodes, dbPath: options?.dbPath });
      const found = Boolean(res?.found && res.entry);
      seen.set(id, found);
      return found;
    };

    // Collect first, then probe: the probes are reads, but interleaving many
    // per page would hold the page open far longer than the scan needs.
    const rows: { key: string; src: string; dst: string }[] = [];
    const covered = await scanNamespace(ns.edges, options?.dbPath, (page) => {
      for (const e of page) {
        const md = (e.metadata ?? {}) as Record<string, unknown>;
        if (md.kg !== 'edge') continue;
        edges++;
        rows.push({ key: e.key, src: String(md.src ?? ''), dst: String(md.dst ?? '') });
      }
    });

    for (const row of rows) {
      if (dangling.length >= limit) break;
      const missing: string[] = [];
      if (!row.src || !(await exists(row.src))) missing.push(row.src || '<no src>');
      if (!row.dst || !(await exists(row.dst))) missing.push(row.dst || '<no dst>');
      if (missing.length) dangling.push({ key: row.key, missing });
    }

    return {
      success: true,
      edges,
      dangling,
      ...(covered && dangling.length < limit ? {} : { truncated: true }),
    };
  } catch (err) {
    return {
      success: false,
      edges,
      dangling,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
