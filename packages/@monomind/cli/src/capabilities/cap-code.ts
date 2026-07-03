import type { CapabilityModule, DirectoryScan, FileEntry, IndexResult, HealthCheck } from './types.js';

export const codeCapability: CapabilityModule = {
  name: 'code',

  detect(scan: DirectoryScan): number {
    return scan.capabilities.code.confidence;
  },

  async activate(_rootDir: string): Promise<void> {
    // monolean: no-op — existing init/monograph handles code projects
    // This module exists so the manager can track code as a capability
  },

  async index(_files: FileEntry[]): Promise<IndexResult> {
    // monolean: existing monograph handles code indexing
    return { indexed: 0, skipped: 0, errors: [] };
  },

  async healthChecks(): Promise<HealthCheck[]> {
    // monolean: delegates to existing doctor checks when cap/code is active
    // The doctor command checks isActive('code') to decide which checks to run
    return [];
  },
};
