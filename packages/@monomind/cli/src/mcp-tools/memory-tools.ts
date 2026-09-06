/**
 * Memory MCP Tools — Phase 6 of ADR-053
 *
 * Exposes Memory backend operations as MCP tools: pattern store/search,
 * usage-weighted feedback (EWMA), the conversation knowledge graph
 * (memory_kg_*), session records, weight-aware GC, and bridge health.
 *
 * Security: All handlers validate input types, enforce length bounds,
 * and sanitize error messages before returning to MCP callers.
 *
 * @module v1/cli/mcp-tools/memory-tools
 */

import {
  sanitizeError,
  validatePositiveInt,
  validateScore,
  validateMcpString as validateString,
} from '../utils/input-guards.js';
import type { MCPTool } from './types.js';

// ===== MCP-specific constants =====

const MAX_BATCH_SIZE = 500; // Max entries per batch operation
const MAX_TOP_K = 100; // Max results per query

// Lazy-cached bridge module
let bridgeModule: typeof import('../memory/memory-bridge.js') | null = null;
async function getBridge() {
  if (!bridgeModule) {
    bridgeModule = await import('../memory/memory-bridge.js');
  }
  return bridgeModule;
}

// ===== memory_health — Controller health check =====

export const memoryHealth: MCPTool = {
  name: 'memory_health',
  description: 'Get Memory backend health status including cache stats and attestation count',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    try {
      const bridge = await getBridge();
      const health = await bridge.bridgeHealthCheck();
      if (!health) return { available: false, error: 'Memory bridge not available' };
      return health;
    } catch (error) {
      return { available: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_controllers — List all controllers =====

export const memoryControllers: MCPTool = {
  name: 'memory_controllers',
  description: 'List all Memory backends and their initialization status',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    return {
      available: false,
      controllers: [],
      total: 0,
      active: 0,
      note: 'Memory operations use the SQLite bridge directly via memory_pattern-store/memory_pattern-search tools.',
    };
  },
};

// ===== memory_pattern_store — Store via ReasoningBank =====

export const memoryPatternStore: MCPTool = {
  name: 'memory_pattern-store',
  description:
    'Store a reusable pattern (embedded, semantically searchable) in the patterns namespace',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Pattern description' },
      type: { type: 'string', description: 'Pattern type (e.g., task-routing, error-recovery)' },
      confidence: { type: 'number', description: 'Confidence score (0-1)' },
    },
    required: ['pattern'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const pattern = validateString(params.pattern, 'pattern');
      if (!pattern)
        return { success: false, error: 'pattern is required (non-empty string, max 100KB)' };

      // validateExternalContent: guard against prompt injection in stored patterns.
      // This is a WRITE to persistent memory, so it fails CLOSED: if
      // validation throws, the write is blocked rather than silently
      // persisted unvalidated.
      {
        const { validateExternalContent } = await import('../utils/input-guards.js');
        const check = await validateExternalContent(pattern, 'memory_pattern-store pattern');
        if (!check.safe) {
          return {
            success: false,
            error: `Injection guard: ${check.reason}`,
            injectionDetected: true,
          };
        }
      }

      const bridge = await getBridge();
      const result = await bridge.bridgeStorePattern({
        pattern,
        taskType: validateString(params.type, 'type', 200) ?? 'general',
        confidence: validateScore(params.confidence, 0.8),
      });
      return (
        result ?? {
          success: false,
          error:
            'Memory bridge not available. Use memory_pattern-store/memory_pattern-search instead.',
        }
      );
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_pattern_search — Search via ReasoningBank =====

export const memoryPatternSearch: MCPTool = {
  name: 'memory_pattern-search',
  description:
    'Search stored patterns — semantic when the local embedding model is available, keyword otherwise',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      topK: { type: 'number', description: 'Number of results (default: 5)' },
      minConfidence: { type: 'number', description: 'Minimum score threshold (0-1)' },
    },
    required: ['query'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const query = validateString(params.query, 'query', 10_000);
      if (!query) return { results: [], error: 'query is required (non-empty string, max 10KB)' };

      // validateExternalContent: guard against prompt injection in search queries.
      {
        const { validateExternalContent } = await import('../utils/input-guards.js');
        const check = await validateExternalContent(query, 'memory_pattern-search query');
        if (!check.safe) {
          return {
            results: [],
            error: `Injection guard: ${check.reason}`,
            injectionDetected: true,
          };
        }
      }

      const bridge = await getBridge();
      const minConfidence = validateScore(params.minConfidence, 0.3);
      const result = await bridge.bridgeSearchPatterns({
        query,
        limit: validatePositiveInt(params.topK, 5, MAX_TOP_K),
      });
      if (!result) return { results: [], controller: 'unavailable' };
      const patterns = result.patterns.filter((p: { score: number }) => p.score >= minConfidence);
      // Usage tracking: every recall hit increments the entry's frequency_weight,
      // which feeds both the ranking blend and weight-aware GC protection.
      // Never let this block or fail the search response.
      if (patterns.length) {
        try {
          const ids = patterns
            .map((p: { id: string }) => p.id)
            .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
          if (ids.length) await bridge.bridgeRecordUsage({ entryIds: ids });
        } catch {
          /* non-fatal: usage tracking must never break search */
        }
      }
      return { ...result, patterns };
    } catch (error) {
      return { results: [], error: sanitizeError(error) };
    }
  },
};

// ===== memory_feedback — Record task feedback =====

export const memoryFeedback: MCPTool = {
  name: 'memory_feedback',
  description:
    'Rate memory entries used in an answer (pass entryIds from a prior search). Updates feedback_weight; idempotent per taskId.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description:
          'Task identifier (also the idempotency key — the same taskId never double-applies)',
      },
      entryIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Memory entry IDs (from search results) that were used for this task',
      },
      success: { type: 'boolean', description: 'Whether task succeeded' },
      quality: {
        type: 'number',
        description: 'Quality score (0-1); defaults from success (0.9/0.2)',
      },
      agent: { type: 'string', description: 'Agent that performed the task' },
    },
    required: ['taskId'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const taskId = validateString(params.taskId, 'taskId', 500);
      if (!taskId)
        return { success: false, error: 'taskId is required (non-empty string, max 500 chars)' };
      const bridge = await getBridge();

      // Closed loop: apply the rating to the entries that were actually used.
      const entryIds = Array.isArray(params.entryIds)
        ? (params.entryIds as unknown[])
            .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 500)
            .slice(0, 100)
        : [];
      let weighting: unknown = null;
      if (entryIds.length) {
        const score =
          typeof params.quality === 'number' && Number.isFinite(params.quality)
            ? Math.max(0, Math.min(1, params.quality))
            : params.success === true
              ? 0.9
              : 0.2;
        weighting = await bridge.bridgeApplyFeedback({ entryIds, score, ledgerKey: taskId });
      }

      // Keep the historical feedback-event record alongside the weighting.
      const result = await bridge.bridgeRecordFeedback({
        taskType: validateString(params.agent, 'agent', 200) ?? 'task',
        action: taskId,
        outcome: params.success === true ? 'success' : 'failure',
        confidence: validateScore(params.quality, 0.85),
        metadata: { taskId, entryIds },
      });
      if (!result)
        return {
          success: false,
          error:
            'Memory bridge not available. Use memory_pattern-store/memory_pattern-search instead.',
        };
      return { ...result, weighting };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_causal_edge — Record causal relationships =====

/** Provenance ref for one causal-edge assertion.
 *
 *  Every call used to ingest under the bare string `causal-edge-tool`, which
 *  made all of them one indivisible provenance bucket: a rollback aimed at one
 *  wrong edge withdrew every causal edge the tool had ever recorded. Keying on
 *  the asserted triple makes the ref unique per assertion and stable for it —
 *  re-asserting the same edge reinforces its existing support instead of
 *  minting a second ref that rollback would then have to chase separately.
 *
 *  Components are bounded like the graph's own name key (`normalizeName`
 *  slices at 200), so this inherits that identity resolution and adds no new
 *  collision class. */
export function causalEdgeOriginRef(source: string, relation: string, target: string): string {
  const part = (s: string, max: number) => s.trim().toLowerCase().slice(0, max);
  return `causal-edge:${part(source, 100)}|${part(relation, 50)}|${part(target, 100)}`;
}

export const memoryCausalEdge: MCPTool = {
  name: 'memory_causal-edge',
  description:
    'Record a causal relationship between two named things as a real knowledge-graph edge (traversable via memory_kg_search)',
  inputSchema: {
    type: 'object',
    properties: {
      sourceId: { type: 'string', description: 'Source entity name (or entry ID)' },
      targetId: { type: 'string', description: 'Target entity name (or entry ID)' },
      relation: {
        type: 'string',
        description: 'Relationship type — a snake_case label (e.g. causes, preceded, fixed_by)',
      },
      // `weight` used to be declared here and then dropped on the floor: the
      // graph's edge input has no weight field, so nothing could carry it.
      // Declaring an option the store cannot honour is the same boundary
      // dishonesty as declaring an unvalidated payload shape.
      description: { type: 'string', description: 'One-sentence concrete fact for this edge' },
    },
    required: ['sourceId', 'targetId', 'relation'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const sourceId = validateString(params.sourceId, 'sourceId', KG_MAX_NAME);
      const targetId = validateString(params.targetId, 'targetId', KG_MAX_NAME);
      const relation = validateString(params.relation, 'relation', KG_MAX_RELATION);
      if (!sourceId) return { success: false, error: 'sourceId is required (non-empty string)' };
      if (!targetId) return { success: false, error: 'targetId is required (non-empty string)' };
      if (!relation) return { success: false, error: 'relation is required (non-empty string)' };
      if (!KG_RELATION_RE.test(relation.trim()))
        return { success: false, error: relationReason(relation) };
      const kg = await import('../memory/memory-kg.js');
      const result = await kg.kgIngest({
        nodes: [{ name: sourceId }, { name: targetId }],
        edges: [
          {
            source: sourceId,
            target: targetId,
            relation,
            description:
              validateString(params.description, 'description', KG_MAX_TEXT) ?? undefined,
          },
        ],
        originRef: causalEdgeOriginRef(sourceId, relation, targetId),
      });
      return result;
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_kg_* — Conversation/org knowledge graph =====

// ── KG payload contract (K8) ────────────────────────────────────────
//
// This is the public write boundary of the knowledge graph. It used to declare
// nodes/edges/rules as bare `{type: 'object'}` arrays and cast them to `any[]`,
// which meant three things at once: a caller could not see the shape it was
// supposed to send, an item that the store rejected part-way through left the
// items ahead of it already persisted, and anything past the per-call caps was
// sliced off with the result reporting exactly as it would have for a payload
// that fit. Everything below exists so a caller can tell "all 40 nodes stored"
// from "20 stored, 20 dropped", and so a malformed payload never becomes a
// partial graph.

/** Per-call ceilings enforced by kgIngest/kgIngestRules. Mirrored here so an
 *  over-cap payload is reported as truncated instead of silently sliced.
 *  Keep in sync with the `.slice()` bounds in memory-kg.ts. */
const KG_MAX_NODES = 500;
const KG_MAX_EDGES = 1000;
const KG_MAX_RULES = 50;
const KG_MAX_NAME = 500;
const KG_MAX_TEXT = 2000;
const KG_MAX_RULE = 4000;
const KG_MAX_RELATION = 200;

/** A relation is a short label, not prose: alphanumeric words joined by `_`,
 *  `-` or single spaces. kgIngest normalizes whatever it gets into an edge KEY,
 *  so free text silently becomes a different relation than the caller wrote —
 *  and an unbounded one partitions the graph into unqueryable singletons. */
const KG_RELATION_RE = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/;

const relationReason = (v: string) =>
  `relation must be a label such as "causes" or "fixed_by", not ${JSON.stringify(v.slice(0, 60))}`;

/** One item the boundary refused. `index: -1` means the container itself
 *  (e.g. `nodes` was not an array) rather than an element of it. */
interface KgReject {
  field: 'nodes' | 'edges' | 'rules';
  index: number;
  reason: string;
}

const textReason = (field: string, max: number) =>
  `${field} must be a non-empty string of at most ${max} characters, without control characters`;

/** Optional string field: absent/null/'' is fine, anything else must be a
 *  clean bounded string. Returns a reason on failure, null when acceptable. */
function checkOptionalText(
  obj: Record<string, unknown>,
  field: string,
  max: number,
): string | null {
  const value = obj[field];
  if (value === undefined || value === null || value === '') return null;
  if (!validateString(value, field, max)) return textReason(field, max);
  return null;
}

function checkNode(item: unknown): string | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'must be an object';
  const o = item as Record<string, unknown>;
  if (!validateString(o.name, 'name', KG_MAX_NAME)) return textReason('name', KG_MAX_NAME);
  return (
    checkOptionalText(o, 'type', KG_MAX_NAME) ??
    checkOptionalText(o, 'description', KG_MAX_TEXT) ??
    checkOptionalText(o, 'nodeSet', KG_MAX_NAME)
  );
}

function checkEdge(item: unknown): string | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'must be an object';
  const o = item as Record<string, unknown>;
  if (!validateString(o.source, 'source', KG_MAX_NAME)) return textReason('source', KG_MAX_NAME);
  if (!validateString(o.target, 'target', KG_MAX_NAME)) return textReason('target', KG_MAX_NAME);
  const relation = validateString(o.relation, 'relation', KG_MAX_RELATION);
  if (!relation) return textReason('relation', KG_MAX_RELATION);
  if (!KG_RELATION_RE.test(relation.trim())) return relationReason(relation);
  return (
    checkOptionalText(o, 'description', KG_MAX_TEXT) ??
    checkOptionalText(o, 'sourceType', KG_MAX_NAME) ??
    checkOptionalText(o, 'targetType', KG_MAX_NAME)
  );
}

function checkRule(item: unknown): string | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'must be an object';
  const o = item as Record<string, unknown>;
  if (!validateString(o.rule, 'rule', KG_MAX_RULE)) return textReason('rule', KG_MAX_RULE);
  return checkOptionalText(o, 'context', KG_MAX_TEXT);
}

const KG_CHECKS: Record<KgReject['field'], { check: (i: unknown) => string | null; cap: number }> =
  {
    nodes: { check: checkNode, cap: KG_MAX_NODES },
    edges: { check: checkEdge, cap: KG_MAX_EDGES },
    rules: { check: checkRule, cap: KG_MAX_RULES },
  };

interface KgPayload {
  nodes: unknown[];
  edges: unknown[];
  rules: unknown[];
  /** Items dropped for exceeding a per-call cap, by field. Only present when
   *  something was actually dropped. */
  truncated?: Partial<Record<KgReject['field'], number>>;
}

/** Validate the WHOLE nested payload up front. Any bad item rejects the entire
 *  call — including one past a cap that would have been dropped anyway, since
 *  a caller sending malformed items deserves to hear about them rather than
 *  have them quietly vanish. Nothing here writes; the first mutation only
 *  happens once this returns `ok`. */
function validateKgPayload(params: Record<string, unknown>): KgPayload & { rejected: KgReject[] } {
  const rejected: KgReject[] = [];
  const accepted: Record<KgReject['field'], unknown[]> = { nodes: [], edges: [], rules: [] };
  const truncated: Partial<Record<KgReject['field'], number>> = {};

  for (const field of ['nodes', 'edges', 'rules'] as const) {
    const raw = params[field];
    if (raw === undefined || raw === null) continue;
    if (!Array.isArray(raw)) {
      rejected.push({ field, index: -1, reason: `${field} must be an array` });
      continue;
    }
    const { check, cap } = KG_CHECKS[field];
    for (let i = 0; i < raw.length; i++) {
      const reason = check(raw[i]);
      if (reason) rejected.push({ field, index: i, reason });
    }
    accepted[field] = raw.slice(0, cap);
    if (raw.length > cap) truncated[field] = raw.length - cap;
  }

  return {
    ...accepted,
    ...(Object.keys(truncated).length ? { truncated } : {}),
    rejected,
  };
}

export const memoryKgIngest: MCPTool = {
  name: 'memory_kg_ingest',
  description:
    'Merge LLM-extracted entities/relations/rules into the persistent knowledge graph; same-name entities merge idempotently. The whole payload is validated before anything is written, and the result reports accepted/rejected/truncated counts.',
  inputSchema: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        maxItems: KG_MAX_NODES,
        description: `Entities (max ${KG_MAX_NODES} per call; the excess is reported as truncated)`,
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Entity name — this IS the identity; same name merges',
            },
            type: { type: 'string', description: "Basic type: 'Person', 'Service', 'Tool'" },
            description: { type: 'string', description: 'One-sentence concrete fact' },
            nodeSet: { type: 'string', description: "Optional grouping, e.g. 'rules'" },
          },
          required: ['name'],
        },
      },
      edges: {
        type: 'array',
        maxItems: KG_MAX_EDGES,
        description: `Relations (max ${KG_MAX_EDGES} per call; the excess is reported as truncated)`,
        items: {
          type: 'object',
          properties: {
            source: { type: 'string', description: 'Source entity name' },
            target: { type: 'string', description: 'Target entity name' },
            relation: {
              type: 'string',
              description: "snake_case label, e.g. 'causes', 'fixed_by' — not free text",
            },
            description: {
              type: 'string',
              description: 'One-sentence concrete fact using the endpoint names',
            },
            sourceType: { type: 'string' },
            targetType: { type: 'string' },
          },
          required: ['source', 'target', 'relation'],
        },
      },
      rules: {
        type: 'array',
        maxItems: KG_MAX_RULES,
        description: `Distilled durable rules, deduped semantically against existing rules (max ${KG_MAX_RULES} per call)`,
        items: {
          type: 'object',
          properties: {
            rule: { type: 'string', description: 'The durable rule, in one sentence' },
            context: { type: 'string', description: 'When the rule applies' },
          },
          required: ['rule'],
        },
      },
      rawText: {
        type: 'string',
        description: 'Fallback: raw text for regex-based extraction (no LLM)',
      },
      originRef: {
        type: 'string',
        description:
          'Provenance ref (session/run/doc id) — enables memory_kg_rollback. Use a ref unique to this operation so a rollback withdraws only its work.',
      },
    },
    required: ['originRef'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const originRef = validateString(params.originRef, 'originRef', KG_MAX_NAME);
      if (!originRef)
        return { success: false, error: textReason('originRef', KG_MAX_NAME), rejected: [] };

      const payload = validateKgPayload(params);
      if (payload.rejected.length)
        return {
          success: false,
          error: `payload rejected before any write: ${payload.rejected.length} invalid item(s)`,
          rejected: payload.rejected,
        };

      const kg = await import('../memory/memory-kg.js');
      let { nodes, edges } = payload;
      if (
        !nodes.length &&
        !edges.length &&
        typeof params.rawText === 'string' &&
        params.rawText.trim()
      ) {
        const extracted = kg.heuristicExtract(params.rawText, { sourceName: originRef });
        nodes = extracted.nodes.slice(0, KG_MAX_NODES);
        edges = extracted.edges.slice(0, KG_MAX_EDGES);
      }

      const graph =
        nodes.length || edges.length
          ? await kg.kgIngest({ nodes: nodes as any[], edges: edges as any[], originRef })
          : { success: true, nodesAdded: 0, nodesMerged: 0, edgesAdded: 0, edgesMerged: 0 };
      const rules = payload.rules.length
        ? await kg.kgIngestRules({ rules: payload.rules as any[], originRef })
        : null;

      // Honesty over the whole call, not just the entity half: a refused rule
      // write must not be flattened into a graph-only `success: true`, and the
      // caller gets the rule verdicts and aggregate `accepted` count alongside
      // them so an `accepted` verdict with `accepted: 0` is visible.
      const rulesFailed = rules ? !rules.success : false;
      return {
        ...graph,
        success: graph.success && !rulesFailed,
        ...(graph.error || rulesFailed
          ? { error: graph.error ?? rules?.error ?? 'rule ingestion failed' }
          : {}),
        rules,
        /** How many items passed validation and were submitted to the store.
         *  Compare against nodesAdded+nodesMerged to see what actually landed. */
        accepted: { nodes: nodes.length, edges: edges.length, rules: payload.rules.length },
        ...(payload.truncated ? { truncated: payload.truncated } : {}),
      };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

export const memoryKgSearch: MCPTool = {
  name: 'memory_kg_search',
  description:
    'Search the memory knowledge graph (remembered entities and relations — not the Monograph code graph): entities are seeded via the memory bridge (semantic when embeddings are available, keyword otherwise) and expanded to ranked relationship triplets. Returns rendered context lines plus seed entry ids (rate them via memory_feedback).',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language query' },
      limit: { type: 'number', description: 'Max triplets (default 8)' },
      nodeSet: { type: 'string', description: "Filter to a node set (e.g. 'rules')" },
    },
    required: ['query'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const query = validateString(params.query, 'query', 2000);
      if (!query) return { success: false, error: 'query is required' };
      const kg = await import('../memory/memory-kg.js');
      return await kg.kgSearch({
        query,
        limit: validatePositiveInt(params.limit, 8, 50),
        nodeSet: validateString(params.nodeSet, 'nodeSet', 100) ?? undefined,
      });
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

export const memoryKgRollback: MCPTool = {
  name: 'memory_kg_rollback',
  description:
    'Delete all knowledge-graph nodes/edges/rules whose only provenance is the given originRef (bad-ingest recovery). Elements shared with other origins are retained.',
  inputSchema: {
    type: 'object',
    properties: {
      originRef: {
        type: 'string',
        description: 'The provenance ref to roll back (session/run/doc id)',
      },
    },
    required: ['originRef'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const originRef = validateString(params.originRef, 'originRef', 500);
      if (!originRef) return { success: false, error: 'originRef is required' };
      const kg = await import('../memory/memory-kg.js');
      return await kg.kgRollback({ originRef });
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

export const memoryKgConsolidate: MCPTool = {
  name: 'memory_kg_consolidate',
  description:
    "List knowledge-graph entities whose descriptions lag their connectivity, with neighborhood facts. YOU do the consolidation: rewrite each candidate's description as one canonical paragraph merging the facts, then resubmit via memory_kg_ingest (richer descriptions win on merge).",
  inputSchema: {
    type: 'object',
    properties: {
      minEdges: { type: 'number', description: 'Minimum relations for a candidate (default 3)' },
      limit: { type: 'number', description: 'Max candidates (default 10)' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const kg = await import('../memory/memory-kg.js');
      const candidates = await kg.kgConsolidateCandidates({
        minEdges: validatePositiveInt(params.minEdges, 3, 100),
        limit: validatePositiveInt(params.limit, 10, 50),
      });
      return { success: true, candidates };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

export const memoryKgStats: MCPTool = {
  name: 'memory_kg_stats',
  description:
    'Knowledge graph size: node, edge, and rule counts (plus the entity glossary for extraction prompts)',
  inputSchema: {
    type: 'object',
    properties: {
      glossary: { type: 'boolean', description: 'Include top entity names (default false)' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const kg = await import('../memory/memory-kg.js');
      const stats = await kg.kgStats();
      const glossary = params.glossary === true ? await kg.kgGlossary() : undefined;
      return { success: true, ...stats, ...(glossary ? { glossary } : {}) };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_route — Route via SemanticRouter =====

export const memoryRoute: MCPTool = {
  name: 'memory_route',
  description: 'Suggest agent routing for a task by searching past routing patterns',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task description to route' },
      context: { type: 'string', description: 'Additional context' },
    },
    required: ['task'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const task = validateString(params.task, 'task', 10_000);
      if (!task)
        return {
          route: 'general',
          confidence: 0.5,
          agents: ['coder'],
          controller: 'error',
          error: 'task is required (non-empty string)',
        };
      const bridge = await getBridge();
      const result = await bridge.bridgeRouteTask({ task });
      return (
        result ?? { route: 'general', confidence: 0.5, agents: ['coder'], controller: 'fallback' }
      );
    } catch (error) {
      return {
        route: 'general',
        confidence: 0.5,
        agents: ['coder'],
        controller: 'error',
        error: sanitizeError(error),
      };
    }
  },
};

// ===== memory_session_start — Session with ReflexionMemory =====

export const memorySessionStart: MCPTool = {
  name: 'memory_session-start',
  description: 'Record a session start in the sessions namespace',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session identifier' },
      context: { type: 'string', description: 'Session context for pattern retrieval' },
    },
    required: ['sessionId'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const sessionId = validateString(params.sessionId, 'sessionId', 500);
      if (!sessionId) return { success: false, error: 'sessionId is required (non-empty string)' };
      const bridge = await getBridge();
      const result = await bridge.bridgeSessionStart({
        sessionId,
        metadata: { context: validateString(params.context, 'context', 10_000) ?? undefined },
      });
      return (
        result ?? {
          success: false,
          error:
            'Memory bridge not available. Use memory_pattern-store/memory_pattern-search instead.',
        }
      );
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_session_end — End session + NightlyLearner =====

export const memorySessionEnd: MCPTool = {
  name: 'memory_session-end',
  description: 'Record session end with summary and metrics in the sessions namespace',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session identifier' },
      summary: { type: 'string', description: 'Session summary' },
      tasksCompleted: { type: 'number', description: 'Number of tasks completed' },
    },
    required: ['sessionId'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const sessionId = validateString(params.sessionId, 'sessionId', 500);
      if (!sessionId) return { success: false, error: 'sessionId is required (non-empty string)' };
      const bridge = await getBridge();
      const result = await bridge.bridgeSessionEnd({
        sessionId,
        summary: validateString(params.summary, 'summary', 50_000) ?? undefined,
        metrics: { tasksCompleted: validatePositiveInt(params.tasksCompleted, 0, 10_000) },
      });
      return (
        result ?? {
          success: false,
          error:
            'Memory bridge not available. Use memory_pattern-store/memory_pattern-search instead.',
        }
      );
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_hierarchical_store — Store to hierarchical memory =====

export const memoryHierarchicalStore: MCPTool = {
  name: 'memory_hierarchical-store',
  description:
    'Store into a tier-labeled namespace (tier_working/episodic/semantic). Note: tiers are labels, not automatic promotion',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Memory entry key' },
      value: { type: 'string', description: 'Memory entry value' },
      tier: {
        type: 'string',
        description: 'Memory tier (working, episodic, semantic)',
        enum: ['working', 'episodic', 'semantic'],
        default: 'working',
      },
    },
    required: ['key', 'value'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const key = validateString(params.key, 'key', 1000);
      const value = validateString(params.value, 'value');
      if (!key) return { success: false, error: 'key is required (non-empty string, max 1KB)' };
      if (!value)
        return { success: false, error: 'value is required (non-empty string, max 100KB)' };
      const tier = validateString(params.tier, 'tier', 20) ?? 'working';
      if (!['working', 'episodic', 'semantic'].includes(tier)) {
        return {
          success: false,
          error: `Invalid tier: ${tier}. Must be working, episodic, or semantic`,
        };
      }
      const bridge = await getBridge();
      const result = await bridge.bridgeHierarchicalStore({ key, value, tier });
      return (
        result ?? {
          success: false,
          error:
            'Memory bridge not available. Use memory_pattern-store/memory_pattern-search instead.',
        }
      );
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_hierarchical_recall — Recall from hierarchical memory =====

export const memoryHierarchicalRecall: MCPTool = {
  name: 'memory_hierarchical-recall',
  description:
    'Search tier-labeled namespaces (tier_working/episodic/semantic), or all when no tier given',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Recall query' },
      tier: { type: 'string', description: 'Filter by tier (working, episodic, semantic)' },
      topK: { type: 'number', description: 'Number of results (default: 5)' },
    },
    required: ['query'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const query = validateString(params.query, 'query', 10_000);
      if (!query) return { results: [], error: 'query is required (non-empty string, max 10KB)' };
      const tier = validateString(params.tier, 'tier', 20);
      if (tier && !['working', 'episodic', 'semantic'].includes(tier)) {
        return {
          results: [],
          error: `Invalid tier: ${tier}. Must be working, episodic, or semantic`,
        };
      }
      const bridge = await getBridge();
      const result = await bridge.bridgeHierarchicalRecall({
        query,
        tier: tier ?? undefined,
        topK: validatePositiveInt(params.topK, 5, MAX_TOP_K),
      });
      // Usage tracking: every recall hit increments the entry's frequency_weight,
      // which feeds both the ranking blend and weight-aware GC protection.
      // Never let this block or fail the recall response.
      if (result?.results?.length) {
        try {
          const ids = result.results
            .map((r: { id: string }) => r.id)
            .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
          if (ids.length) await bridge.bridgeRecordUsage({ entryIds: ids });
        } catch {
          /* non-fatal: usage tracking must never break recall */
        }
      }
      return (
        result ?? {
          results: [],
          error: 'Memory bridge not available. Use memory_pattern-search instead.',
        }
      );
    } catch (error) {
      return { results: [], error: sanitizeError(error) };
    }
  },
};

// ===== memory_consolidate — Run memory consolidation =====

export const memoryConsolidate: MCPTool = {
  name: 'memory_consolidate',
  description:
    'Garbage-collect stale, unused memory entries. Weight-aware: entries with high feedback_weight or repeated usage are never collected.',
  inputSchema: {
    type: 'object',
    properties: {
      minAge: {
        type: 'number',
        description: 'Minimum age in hours since last update (optional, default 168 = 7 days)',
      },
      maxEntries: { type: 'number', description: 'Maximum entries to scan (optional)' },
      namespace: {
        type: 'string',
        description: "Namespace to GC, or 'all' for every non-protected namespace (optional)",
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const bridge = await getBridge();
      // Reject NaN and Infinity. typeof === 'number' returns true for both.
      // NaN propagates through arithmetic and corrupts consolidation accounting;
      // Infinity makes `entry.age >= minAge` always false, silently no-op.
      // The bridge expects MILLISECONDS; this param is documented in hours —
      // convert here (previously passed through raw, so 720 hours became 720ms).
      const minAge =
        typeof params.minAge === 'number' && Number.isFinite(params.minAge)
          ? Math.max(0, Math.min(params.minAge, 24 * 365 * 10)) * 3600 * 1000
          : undefined;
      const result = await bridge.bridgeConsolidate({
        minAge,
        maxEntries:
          params.maxEntries !== undefined
            ? validatePositiveInt(params.maxEntries, 1000, 10_000)
            : undefined,
        namespace: validateString(params.namespace, 'namespace', 128) ?? undefined,
      });
      return (
        result ?? {
          success: false,
          error:
            'Memory bridge not available. Use memory_pattern-store/memory_pattern-search instead.',
        }
      );
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_batch — Batch operations (insert, update, delete) =====

export const memoryBatch: MCPTool = {
  name: 'memory_batch',
  description: 'Batch operations on memory entries (insert, update, delete)',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'Batch operation type',
        enum: ['insert', 'update', 'delete'],
      },
      entries: {
        type: 'array',
        description: 'Array of {key, value} entries to operate on',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['key'],
        },
      },
    },
    required: ['operation', 'entries'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const operation = validateString(params.operation, 'operation', 20);
      if (!operation) return { success: false, error: 'operation is required (string)' };
      if (!['insert', 'update', 'delete'].includes(operation)) {
        return {
          success: false,
          error: `Invalid operation: ${operation}. Must be insert, update, or delete`,
        };
      }
      if (!Array.isArray(params.entries) || params.entries.length === 0) {
        return { success: false, error: 'entries is required (non-empty array)' };
      }
      if (params.entries.length > MAX_BATCH_SIZE) {
        return {
          success: false,
          error: `Too many entries: ${params.entries.length}. Max is ${MAX_BATCH_SIZE}`,
        };
      }
      // Validate each entry. Aggregate-byte cap prevents 500 entries × 100KB
      // values = 50MB single-call payloads from spiking Node heap to ~200MB
      // (UTF-16 doubling + downstream copies in the bridge layer).
      const MAX_BATCH_BYTES = 1_048_576; // 1 MiB total
      let totalBytes = 0;
      const validatedEntries: Array<{
        key: string;
        value?: string;
        metadata?: Record<string, unknown>;
      }> = [];
      for (let i = 0; i < params.entries.length; i++) {
        const entry = params.entries[i];
        if (!entry || typeof entry !== 'object') {
          return { success: false, error: `entries[${i}] must be an object` };
        }
        const key = validateString((entry as any).key, `entries[${i}].key`, 1000);
        if (!key)
          return { success: false, error: `entries[${i}].key is required (non-empty string)` };
        const value = validateString((entry as any).value, `entries[${i}].value`);
        totalBytes += key.length + (value?.length ?? 0);
        if (totalBytes > MAX_BATCH_BYTES) {
          return { success: false, error: `Batch payload exceeds ${MAX_BATCH_BYTES} bytes` };
        }
        validatedEntries.push({ key, value: value ?? undefined });
      }
      const bridge = await getBridge();
      const result = await bridge.bridgeBatchOperation({
        operation,
        entries: validatedEntries,
      });
      return (
        result ?? {
          success: false,
          error:
            'Memory bridge not available. Use memory_pattern-store/memory_pattern-search instead.',
        }
      );
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_context_synthesize — Synthesize context from memories =====

export const memoryContextSynthesize: MCPTool = {
  name: 'memory_context-synthesize',
  description:
    'Concatenate top matching memories into a context block for a query (no summarization)',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Query to synthesize context for' },
      maxEntries: { type: 'number', description: 'Maximum entries to include (default: 10)' },
    },
    required: ['query'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const query = validateString(params.query, 'query', 10_000);
      if (!query)
        return { success: false, error: 'query is required (non-empty string, max 10KB)' };

      // validateExternalContent: guard against prompt injection in synthesized context
      // Source: https://arxiv.org/abs/2302.12173, https://arxiv.org/abs/2310.12815
      {
        const { validateExternalContent } = await import('../utils/input-guards.js');
        const check = await validateExternalContent(query, 'memory_context-synthesize query');
        if (!check.safe) {
          return {
            success: false,
            error: `Injection guard: ${check.reason}`,
            injectionDetected: true,
          };
        }
      }

      const bridge = await getBridge();
      const result = await bridge.bridgeContextSynthesize({
        query,
        maxEntries: validatePositiveInt(params.maxEntries, 10, MAX_TOP_K),
      });
      return (
        result ?? {
          success: false,
          error:
            'Memory bridge not available. Use memory_pattern-store/memory_pattern-search instead.',
        }
      );
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  },
};

// ===== memory_semantic_route — Route via SemanticRouter =====

export const memorySemanticRoute: MCPTool = {
  name: 'memory_semantic-route',
  description: 'Route an input via SemanticRouter for intent classification',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input text to route' },
    },
    required: ['input'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const input = validateString(params.input, 'input', 10_000);
      if (!input) return { route: null, error: 'input is required (non-empty string, max 10KB)' };
      const bridge = await getBridge();
      const result = await bridge.bridgeSemanticRoute({ input });
      return (
        result ?? { route: null, error: 'Memory bridge not available. Use hooks route instead.' }
      );
    } catch (error) {
      return { route: null, error: sanitizeError(error) };
    }
  },
};

// ===== Export all tools =====

export const memoryTools: MCPTool[] = [
  memoryHealth,
  memoryControllers,
  memoryPatternStore,
  memoryPatternSearch,
  memoryFeedback,
  memoryCausalEdge,
  memoryKgIngest,
  memoryKgSearch,
  memoryKgRollback,
  memoryKgConsolidate,
  memoryKgStats,
  memoryRoute,
  memorySessionStart,
  memorySessionEnd,
  memoryHierarchicalStore,
  memoryHierarchicalRecall,
  memoryConsolidate,
  memoryBatch,
  memoryContextSynthesize,
  memorySemanticRoute,
];
