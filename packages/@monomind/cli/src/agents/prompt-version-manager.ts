/**
 * PromptVersionManager - High-level prompt version lifecycle operations
 *
 * Provides publish-from-file, promote, rollback, and experiment
 * start/stop workflows on top of PromptVersionStore.
 *
 * @module @monobrain/cli/agents/prompt-version-manager
 */

import * as fs from 'node:fs';
import type {
  PromptVersionStore,
  PromptVersion,
  PromptExperiment,
} from '../../../memory/src/prompt-version-store.js';

export class PromptVersionManager {
  constructor(private readonly store: PromptVersionStore) {}

  publishFromFile(
    agentSlug: string,
    filePath: string,
    newVersion: string,
    changelog: string,
  ): PromptVersion {
    const prompt = fs.readFileSync(filePath, 'utf-8');
    const version: PromptVersion = {
      agentSlug,
      version: newVersion,
      prompt,
      changelog,
      activeFrom: new Date(),
      traceCount: 0,
      publishedBy: 'prompt-version-manager',
      createdAt: new Date(),
    };
    this.store.save(version);
    return version;
  }

  promote(agentSlug: string, version: string): void {
    this.store.setActive(agentSlug, version);
  }

  rollback(agentSlug: string, stepsBack: number = 1): void {
    const versions = this.store.listVersions(agentSlug);
    if (versions.length < stepsBack + 1) {
      throw new Error(
        `Cannot rollback ${stepsBack} step(s): only ${versions.length} version(s) exist for "${agentSlug}"`,
      );
    }
    // versions are sorted DESC by createdAt, so index 0 = newest
    const target = versions[stepsBack];
    this.store.setActive(agentSlug, target.version);
  }

  startExperiment(experiment: PromptExperiment): void {
    this.store.saveExperiment(experiment);
  }

  stopExperiment(agentSlug: string, promoteWinner?: boolean): void {
    const experiment = this.store.getExperiment(agentSlug);
    if (!experiment) {
      throw new Error(`No active experiment for "${agentSlug}"`);
    }
    // Default winner is control
    const winnerId = experiment.control;
    this.store.concludeExperiment(agentSlug, winnerId);
    if (promoteWinner) {
      this.store.setActive(agentSlug, winnerId);
    }
  }
}
