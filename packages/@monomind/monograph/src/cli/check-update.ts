import type Database from 'better-sqlite3';

export interface CheckUpdateOptions {
  maxAgeMs?: number;
}

export interface CheckUpdateResult {
  needsUpdate: boolean;
  indexedAt: string | null;
  ageMs: number;
  reason: string;
}

export function checkUpdate(db: Database.Database, options: CheckUpdateOptions = {}): CheckUpdateResult {
  const maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60 * 1000; // 24h default

  let indexedAt: string | null = null;
  try {
    const row = db.prepare("SELECT value FROM index_meta WHERE key = 'indexed_at'").get() as { value: string } | undefined;
    indexedAt = row?.value ?? null;
  } catch {
    // table may not exist
  }

  if (!indexedAt) {
    return { needsUpdate: true, indexedAt: null, ageMs: Infinity, reason: 'No index found' };
  }

  const ageMs = Date.now() - new Date(indexedAt).getTime();
  const needsUpdate = ageMs > maxAgeMs;

  return {
    needsUpdate,
    indexedAt,
    ageMs,
    reason: needsUpdate
      ? `Index is ${Math.round(ageMs / 60000)}m old (max: ${Math.round(maxAgeMs / 60000)}m)`
      : 'Index is fresh',
  };
}
