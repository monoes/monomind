import fs from 'fs';
import path from 'path';
import type { CapabilityModule, CapabilityName, DirectoryScan, HealthCheck, SearchResult } from './types.js';

const ACTIVATION_THRESHOLD = 0.1;
const CROSS_CUTTING: Set<CapabilityName> = new Set(['graph', 'timeline']);
const CONTENT_CAPS: Set<CapabilityName> = new Set(['code', 'documents', 'media', 'data']);

export class CapabilityManager {
  private registry = new Map<CapabilityName, CapabilityModule>();
  private active = new Map<CapabilityName, CapabilityModule>();

  register(module: CapabilityModule): void {
    this.registry.set(module.name, module);
  }

  async activateFromScan(scan: DirectoryScan, rootDir: string, save = true): Promise<void> {
    this.active.clear();

    // Activate content capabilities above threshold
    for (const [name, module] of this.registry) {
      if (CROSS_CUTTING.has(name)) continue;
      const confidence = module.detect(scan);
      if (confidence >= ACTIVATION_THRESHOLD) {
        await module.activate(rootDir);
        this.active.set(name, module);
      }
    }

    // Activate cross-cutting if 2+ content caps are active
    const activeContentCount = [...this.active.keys()].filter(n => CONTENT_CAPS.has(n)).length;
    if (activeContentCount >= 2) {
      for (const name of CROSS_CUTTING) {
        const module = this.registry.get(name);
        if (module) {
          await module.activate(rootDir);
          this.active.set(name, module);
        }
      }
    }

    if (save) {
      this.saveCapabilities(rootDir);
    }
  }

  private saveCapabilities(rootDir: string): void {
    const monomindDir = path.join(rootDir, '.monomind');
    const capsPath = path.join(monomindDir, 'capabilities.json');
    try {
      fs.mkdirSync(monomindDir, { recursive: true });
      const tmpPath = capsPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify({ active: [...this.active.keys()] }, null, 2));
      fs.renameSync(tmpPath, capsPath);
    } catch (e) {
      // best-effort persistence; activation state still holds in-memory
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[capabilities] failed to persist capabilities.json:', e);
    }
  }

  isActive(name: CapabilityName): boolean {
    return this.active.has(name);
  }

  getActive(): CapabilityModule[] {
    return [...this.active.values()];
  }

  async runHealthChecks(): Promise<HealthCheck[]> {
    const results: HealthCheck[] = [];
    for (const module of this.active.values()) {
      if (module.healthChecks) {
        results.push(...await module.healthChecks());
      }
    }
    return results;
  }

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    for (const module of this.active.values()) {
      if (module.search) {
        allResults.push(...await module.search(query, limit));
      }
    }
    return allResults.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
