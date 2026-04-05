/**
 * EntityCleanupWorker — Background worker that prunes expired entity facts (Task 10).
 *
 * @module v1/hooks/workers/entity-cleanup
 */

export interface EntityCleanupConfig {
  entityMemory: { pruneExpired(): number };
}

export class EntityCleanupWorker {
  constructor(private config: EntityCleanupConfig) {}

  /** Run cleanup pass — removes expired entity facts */
  async cleanup(): Promise<number> {
    try {
      return this.config.entityMemory.pruneExpired();
    } catch {
      return 0;
    }
  }
}
