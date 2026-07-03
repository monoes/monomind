import fs from 'fs';
import path from 'path';
import type { EnrichmentState, EnrichmentTier, FileEntry } from './types.js';
import type { CapabilityManager } from './manager.js';

export interface EnrichmentSummary {
  total: number;
  fullyEnriched: number;
  t0Done: number;
  t1Done: number;
  t2Done: number;
}

export interface EnrichmentStatusReport {
  paused: boolean;
  summary: EnrichmentSummary;
}

export class EnrichmentPipeline {
  private state: EnrichmentState = {};
  private _paused = false;
  private manager?: CapabilityManager;

  constructor(manager?: CapabilityManager) {
    this.manager = manager;
  }

  get isPaused(): boolean {
    return this._paused;
  }

  markDone(filePath: string, tier: EnrichmentTier): void {
    this.ensureEntry(filePath);
    this.state[filePath][tier] = 'done';
  }

  markQueued(filePath: string, tier: EnrichmentTier): void {
    this.ensureEntry(filePath);
    this.state[filePath][tier] = 'queued';
  }

  markFailed(filePath: string, tier: EnrichmentTier): void {
    this.ensureEntry(filePath);
    // Don't let a later module's failure overwrite an earlier module's success
    // for the same (file, tier) — status has no module dimension.
    if (this.state[filePath][tier] === 'done') return;
    this.state[filePath][tier] = 'failed';
  }

  markSkipped(filePath: string, tier: EnrichmentTier): void {
    this.ensureEntry(filePath);
    if (this.state[filePath][tier] === 'done') return;
    this.state[filePath][tier] = 'skipped';
  }

  getState(): EnrichmentState {
    return { ...this.state };
  }

  getSummary(): EnrichmentSummary {
    const entries = Object.values(this.state);
    return {
      total: entries.length,
      fullyEnriched: entries.filter(e => e.t0 === 'done' && e.t1 === 'done' && e.t2 === 'done').length,
      t0Done: entries.filter(e => e.t0 === 'done').length,
      t1Done: entries.filter(e => e.t1 === 'done').length,
      t2Done: entries.filter(e => e.t2 === 'done').length,
    };
  }

  getStatus(): EnrichmentStatusReport {
    return {
      paused: this._paused,
      summary: this.getSummary(),
    };
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
  }

  /**
   * Run a single enrichment tier over the given files using the active
   * capability modules from the CapabilityManager (if provided).
   *
   * - t0/t1: each active module's `index()` is invoked (T0 = metadata,
   *   T1 = content indexing; capability modules decide internally how to
   *   split the work between these tiers).
   * - t2: each active module's optional `enrich()` is invoked; modules
   *   without an `enrich()` implementation have their files marked skipped.
   */
  async runTier(tier: EnrichmentTier, files: FileEntry[], monomindDir?: string): Promise<void> {
    if (this._paused || files.length === 0) return;
    if (!this.manager) return;

    for (const file of files) {
      this.markQueued(file.path, tier);
    }

    const modules = this.manager.getActive();

    for (const module of modules) {
      if (this._paused) break;

      try {
        if (tier === 't2') {
          if (!module.enrich) {
            for (const file of files) this.markSkipped(file.path, tier);
            continue;
          }
          await module.enrich(files);
        } else {
          await module.index(files);
        }
        for (const file of files) this.markDone(file.path, tier);
      } catch {
        for (const file of files) this.markFailed(file.path, tier);
      }
      if (monomindDir) this.saveState(monomindDir);
    }
  }

  saveState(monomindDir: string): void {
    fs.mkdirSync(monomindDir, { recursive: true });
    const statePath = path.join(monomindDir, 'enrichment.json');
    const tmpPath = statePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify({ paused: this._paused, files: this.state }, null, 2));
    fs.renameSync(tmpPath, statePath);
  }

  loadState(monomindDir: string): void {
    const statePath = path.join(monomindDir, 'enrichment.json');
    try {
      const raw = fs.readFileSync(statePath, 'utf-8');
      const parsed = JSON.parse(raw);
      // Support legacy format (raw file-state map with no `paused`/`files` wrapper)
      if (parsed && typeof parsed === 'object' && 'files' in parsed) {
        this.state = parsed.files ?? {};
        this._paused = Boolean(parsed.paused);
      } else {
        this.state = parsed ?? {};
      }
    } catch {
      this.state = {};
    }
  }

  private ensureEntry(filePath: string): void {
    if (!this.state[filePath]) {
      this.state[filePath] = { t0: 'pending', t1: 'pending', t2: 'pending' };
    }
  }
}
