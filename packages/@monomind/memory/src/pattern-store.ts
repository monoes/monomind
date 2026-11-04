/**
 * PatternStore - storage-agnostic contract for learned-pattern persistence.
 *
 * The CLI's JSON-file ReasoningBank (`LocalReasoningBank`) implements this
 * today without any change to its on-disk format; a SQLite-backed store can
 * implement the same interface later.
 */

/** A learned pattern as persisted by a PatternStore. */
export interface StoredPatternRecord {
  id: string;
  type: string;
  embedding: number[];
  content: string;
  confidence: number;
  usageCount: number;
  createdAt: number;
  lastUsedAt: number;
  metadata?: Record<string, unknown>;
}

export interface PatternStore {
  /** Insert or update a pattern; usage/created/lastUsed default when omitted. */
  store(
    pattern: Omit<StoredPatternRecord, 'usageCount' | 'createdAt' | 'lastUsedAt'> &
      Partial<StoredPatternRecord>,
  ): void;
  /** Cosine-similarity search; a pure read that does not touch usage metrics. */
  findSimilar(
    queryEmbedding: number[],
    options: { k?: number; threshold?: number; type?: string },
  ): StoredPatternRecord[];
  /** Record a usage hit for a pattern. */
  recordUsage(id: string): void;
  get(id: string): StoredPatternRecord | undefined;
  getAll(): StoredPatternRecord[];
  getByType(type: string): StoredPatternRecord[];
  delete(id: string): boolean;
  clear(): void;
  /** Write any pending changes to durable storage. */
  flushToDisk(): void;
}
