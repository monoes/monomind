/**
 * Checkpointer interface stub — bridges the registry to @monobrain/memory.
 * The real implementation is SwarmCheckpointer from @monobrain/memory.
 */
export interface Checkpointer {
  save(swarmId: string, step: number, metadata?: Record<string, unknown>): Promise<string>;
  restore(checkpointId: string): Promise<Record<string, unknown> | undefined>;
}
