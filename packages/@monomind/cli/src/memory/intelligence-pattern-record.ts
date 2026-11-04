/**
 * V1 Intelligence Module — validation of persisted pattern records.
 *
 * Shared by both PatternStore implementations (the JSON-file
 * LocalReasoningBank and the SQLite SqlitePatternStore) so a record loaded
 * from either backend passes the same bounds checks.
 *
 * @module v1/cli/intelligence
 */

import type { StoredPattern } from './intelligence-types.js';

/** Top-level keys of a StoredPattern. Anything else on a raw record is "extra". */
export const CORE_PATTERN_KEYS: ReadonlySet<string> = new Set([
  'id',
  'type',
  'embedding',
  'content',
  'confidence',
  'usageCount',
  'createdAt',
  'lastUsedAt',
  'metadata',
]);

/**
 * Validate one persisted pattern and build a well-typed StoredPattern from it,
 * or return null when it must be skipped.
 *
 * A pattern store can be replaced or hand-edited outside the process (a
 * transferred/imported file, or direct tampering). Without bounds checks, a
 * malicious record can inject `confidence: 1e9` (deterministically wins every
 * routing decision) or `keywords: [10000 strings]` (DoS on every
 * findBestPatternMatch call). A missing embedding array would otherwise reach
 * cosineSim() as `undefined`.
 */
export function sanitizePatternRecord(pattern: unknown): StoredPattern | null {
  if (!pattern || typeof pattern !== 'object') return null;
  const rec = pattern as Record<string, unknown>;
  const id = rec.id;
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) return null;
  const conf = rec.confidence;
  if (
    conf !== undefined &&
    (typeof conf !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1)
  ) {
    return null;
  }
  const keywords = rec.keywords;
  if (keywords !== undefined && (!Array.isArray(keywords) || keywords.length > 64)) {
    return null;
  }
  const rawEmbedding = rec.embedding;
  const embedding =
    Array.isArray(rawEmbedding) &&
    rawEmbedding.every((v) => typeof v === 'number' && Number.isFinite(v))
      ? (rawEmbedding as number[])
      : [];
  const rawUsage = rec.usageCount;
  const rawCreated = rec.createdAt;
  const rawLastUsed = rec.lastUsedAt;
  return {
    id,
    type: typeof rec.type === 'string' ? rec.type : 'general',
    embedding,
    content: typeof rec.content === 'string' ? rec.content : '',
    confidence: typeof conf === 'number' ? conf : 0.5,
    usageCount: typeof rawUsage === 'number' && Number.isFinite(rawUsage) ? rawUsage : 0,
    createdAt:
      typeof rawCreated === 'number' && Number.isFinite(rawCreated) ? rawCreated : Date.now(),
    lastUsedAt:
      typeof rawLastUsed === 'number' && Number.isFinite(rawLastUsed) ? rawLastUsed : Date.now(),
    metadata:
      rec.metadata && typeof rec.metadata === 'object'
        ? (rec.metadata as Record<string, unknown>)
        : undefined,
  };
}

/** The non-core top-level fields of a raw record (e.g. an imported `trigger`/`action`), or null. */
export function extraPatternFields(
  pattern: Record<string, unknown>,
): Record<string, unknown> | null {
  let extra: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(pattern)) {
    if (CORE_PATTERN_KEYS.has(k) || v === undefined) continue;
    extra ??= {};
    extra[k] = v;
  }
  return extra;
}
