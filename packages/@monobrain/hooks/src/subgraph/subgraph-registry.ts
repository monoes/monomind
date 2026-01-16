/**
 * SubGraphRegistry — Singleton registry for compiled subgraphs (Task 48)
 */

import type { CompiledSubGraph } from './types.js';

export class SubGraphRegistry {
  private static instance: SubGraphRegistry | null = null;

  /** Map of subGraphId -> version-sorted array of CompiledSubGraph */
  private store = new Map<string, CompiledSubGraph[]>();

  private constructor() {}

  static getInstance(): SubGraphRegistry {
    if (!SubGraphRegistry.instance) {
      SubGraphRegistry.instance = new SubGraphRegistry();
    }
    return SubGraphRegistry.instance;
  }

  /** Reset singleton (for testing) */
  static resetInstance(): void {
    SubGraphRegistry.instance = null;
  }

  /** Register a compiled subgraph */
  register(compiled: CompiledSubGraph): void {
    const existing = this.store.get(compiled.subGraphId) ?? [];
    existing.push(compiled);
    this.store.set(compiled.subGraphId, existing);
  }

  /** Get the latest version of a subgraph by id */
  getLatest(id: string): CompiledSubGraph | undefined {
    const versions = this.store.get(id);
    if (!versions || versions.length === 0) return undefined;
    return versions[versions.length - 1];
  }

  /** Get a specific version of a subgraph */
  getVersion(id: string, version: number): CompiledSubGraph | undefined {
    const versions = this.store.get(id);
    if (!versions) return undefined;
    return versions.find((c) => c.version === version);
  }

  /** List all latest compiled subgraphs */
  listAll(): CompiledSubGraph[] {
    const result: CompiledSubGraph[] = [];
    for (const versions of this.store.values()) {
      if (versions.length > 0) {
        result.push(versions[versions.length - 1]);
      }
    }
    return result;
  }

  /** List all versions for a given subgraph id */
  listVersions(id: string): CompiledSubGraph[] {
    return this.store.get(id) ?? [];
  }

  /** Check if a compiled subgraph differs from the latest registered version */
  hasChanged(compiled: CompiledSubGraph): boolean {
    const latest = this.getLatest(compiled.subGraphId);
    if (!latest) return true;
    return latest.checksum !== compiled.checksum;
  }
}
