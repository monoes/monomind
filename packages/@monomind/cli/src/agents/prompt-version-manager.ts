/**
 * PromptVersionManager - High-level prompt version lifecycle operations
 *
 * Provides publish-from-file, promote, rollback, and experiment
 * start/stop workflows on top of PromptVersionStore.
 *
 * @module @monomind/cli/agents/prompt-version-manager
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PromptVersionStore = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PromptVersion = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PromptExperiment = any;

export class PromptVersionManager {
  constructor(private readonly store: PromptVersionStore) {}

  publishFromFile(
    agentSlug: string,
    filePath: string,
    newVersion: string,
    changelog: string,
  ): PromptVersion {
    // Symlink-aware containment: path.resolve does NOT follow symlinks, so
    // a symlink under cwd pointing at /etc/shadow would have passed the
    // prefix-check below. Use realpathSync on both sides and reject symlinks
    // at the leaf so the resolved file is provably inside the project.
    const allowedRoot = fs.realpathSync(process.cwd());
    const requested = path.resolve(filePath);
    if (!fs.existsSync(requested)) {
      throw new Error(`filePath does not exist: ${requested}`);
    }
    if (fs.lstatSync(requested).isSymbolicLink()) {
      throw new Error('filePath must not be a symlink');
    }
    const resolved = fs.realpathSync(requested);
    const rel = path.relative(allowedRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`filePath must be inside the project directory: ${allowedRoot}`);
    }
    const MAX_PROMPT_BYTES = 1 * 1024 * 1024;
    const fileSize = fs.statSync(resolved).size;
    if (fileSize > MAX_PROMPT_BYTES) {
      throw new Error(`filePath exceeds maximum allowed size (${MAX_PROMPT_BYTES} bytes): ${resolved}`);
    }
    const prompt = fs.readFileSync(resolved, 'utf-8');
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
    const winnerId = (experiment.winner ?? experiment.control) as string;
    this.store.concludeExperiment(agentSlug, winnerId);
    if (promoteWinner) {
      this.store.setActive(agentSlug, winnerId);
    }
  }
}
