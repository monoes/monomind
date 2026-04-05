/**
 * PromptVersionStore - JSONL-based prompt version management
 *
 * Stores prompt versions and experiments as append-only JSONL files.
 * Supports versioning, A/B experiments, quality scoring, and line-level diffs.
 *
 * File layout:
 *   {dirPath}/versions.jsonl  - one PromptVersion JSON per line
 *   {dirPath}/experiments.jsonl - one PromptExperiment JSON per line
 *
 * @module @monobrain/memory/prompt-version-store
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ===== Types =====

export interface PromptVersion {
  agentSlug: string;
  version: string;
  prompt: string;
  changelog: string;
  activeFrom: Date;
  activeTo?: Date;
  qualityScore?: number;
  traceCount: number;
  publishedBy: string;
  createdAt: Date;
}

export interface PromptExperiment {
  agentSlug: string;
  control: string;
  candidate: string;
  trafficPct: number;
  startedAt: Date;
  endsAt?: Date;
  winnerId?: string;
}

export interface DiffResult {
  agentSlug: string;
  versionA: string;
  versionB: string;
  additions: number;
  deletions: number;
}

// ===== Serialisation helpers =====

interface VersionRecord {
  agentSlug: string;
  version: string;
  prompt: string;
  changelog: string;
  activeFrom: string;
  activeTo?: string | null;
  qualityScore?: number | null;
  traceCount: number;
  publishedBy: string;
  createdAt: string;
}

interface ExperimentRecord {
  agentSlug: string;
  control: string;
  candidate: string;
  trafficPct: number;
  startedAt: string;
  endsAt?: string | null;
  winnerId?: string | null;
}

function versionToRecord(v: PromptVersion): VersionRecord {
  return {
    agentSlug: v.agentSlug,
    version: v.version,
    prompt: v.prompt,
    changelog: v.changelog,
    activeFrom: v.activeFrom.toISOString(),
    activeTo: v.activeTo ? v.activeTo.toISOString() : null,
    qualityScore: v.qualityScore ?? null,
    traceCount: v.traceCount,
    publishedBy: v.publishedBy,
    createdAt: v.createdAt.toISOString(),
  };
}

function recordToVersion(r: VersionRecord): PromptVersion {
  return {
    agentSlug: r.agentSlug,
    version: r.version,
    prompt: r.prompt,
    changelog: r.changelog,
    activeFrom: new Date(r.activeFrom),
    activeTo: r.activeTo ? new Date(r.activeTo) : undefined,
    qualityScore: r.qualityScore ?? undefined,
    traceCount: r.traceCount,
    publishedBy: r.publishedBy,
    createdAt: new Date(r.createdAt),
  };
}

function experimentToRecord(e: PromptExperiment): ExperimentRecord {
  return {
    agentSlug: e.agentSlug,
    control: e.control,
    candidate: e.candidate,
    trafficPct: e.trafficPct,
    startedAt: e.startedAt.toISOString(),
    endsAt: e.endsAt ? e.endsAt.toISOString() : null,
    winnerId: e.winnerId ?? null,
  };
}

function recordToExperiment(r: ExperimentRecord): PromptExperiment {
  return {
    agentSlug: r.agentSlug,
    control: r.control,
    candidate: r.candidate,
    trafficPct: r.trafficPct,
    startedAt: new Date(r.startedAt),
    endsAt: r.endsAt ? new Date(r.endsAt) : undefined,
    winnerId: r.winnerId ?? undefined,
  };
}

// ===== Store =====

export class PromptVersionStore {
  private readonly versionsPath: string;
  private readonly experimentsPath: string;

  constructor(dirPath: string) {
    fs.mkdirSync(dirPath, { recursive: true });
    this.versionsPath = path.join(dirPath, 'versions.jsonl');
    this.experimentsPath = path.join(dirPath, 'experiments.jsonl');
  }

  // ---- versions ----

  save(version: PromptVersion): void {
    const line = JSON.stringify(versionToRecord(version)) + '\n';
    fs.appendFileSync(this.versionsPath, line, 'utf-8');
  }

  getActive(agentSlug: string): PromptVersion | null {
    const all = this.readVersions();
    return all.find((v) => v.agentSlug === agentSlug && v.activeTo === undefined) ?? null;
  }

  listVersions(agentSlug: string): PromptVersion[] {
    return this.readVersions()
      .filter((v) => v.agentSlug === agentSlug)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  setActive(agentSlug: string, version: string): void {
    const all = this.readVersions();
    const now = new Date();
    for (const v of all) {
      if (v.agentSlug === agentSlug && v.activeTo === undefined) {
        v.activeTo = now;
      }
      if (v.agentSlug === agentSlug && v.version === version) {
        v.activeTo = undefined;
        v.activeFrom = now;
      }
    }
    this.writeVersions(all);
  }

  diff(agentSlug: string, vA: string, vB: string): DiffResult {
    const all = this.readVersions();
    const a = all.find((v) => v.agentSlug === agentSlug && v.version === vA);
    const b = all.find((v) => v.agentSlug === agentSlug && v.version === vB);
    const linesA = a ? a.prompt.split('\n') : [];
    const linesB = b ? b.prompt.split('\n') : [];

    const setA = new Set(linesA);
    const setB = new Set(linesB);

    let additions = 0;
    let deletions = 0;
    for (const line of linesB) {
      if (!setA.has(line)) additions++;
    }
    for (const line of linesA) {
      if (!setB.has(line)) deletions++;
    }

    return { agentSlug, versionA: vA, versionB: vB, additions, deletions };
  }

  updateQualityScore(agentSlug: string, version: string, score: number): void {
    const all = this.readVersions();
    for (const v of all) {
      if (v.agentSlug === agentSlug && v.version === version) {
        v.qualityScore = score;
      }
    }
    this.writeVersions(all);
  }

  // ---- experiments ----

  saveExperiment(exp: PromptExperiment): void {
    const line = JSON.stringify(experimentToRecord(exp)) + '\n';
    fs.appendFileSync(this.experimentsPath, line, 'utf-8');
  }

  getExperiment(agentSlug: string): PromptExperiment | null {
    const all = this.readExperiments();
    return all.find((e) => e.agentSlug === agentSlug && e.winnerId === undefined) ?? null;
  }

  concludeExperiment(agentSlug: string, winnerId: string): void {
    const all = this.readExperiments();
    for (const e of all) {
      if (e.agentSlug === agentSlug && e.winnerId === undefined) {
        e.winnerId = winnerId;
      }
    }
    this.writeExperiments(all);
  }

  // ---- private I/O ----

  private readVersions(): PromptVersion[] {
    if (!fs.existsSync(this.versionsPath)) return [];
    const content = fs.readFileSync(this.versionsPath, 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').map((line) => recordToVersion(JSON.parse(line)));
  }

  private writeVersions(versions: PromptVersion[]): void {
    const data = versions.map((v) => JSON.stringify(versionToRecord(v))).join('\n') + '\n';
    fs.writeFileSync(this.versionsPath, data, 'utf-8');
  }

  private readExperiments(): PromptExperiment[] {
    if (!fs.existsSync(this.experimentsPath)) return [];
    const content = fs.readFileSync(this.experimentsPath, 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').map((line) => recordToExperiment(JSON.parse(line)));
  }

  private writeExperiments(experiments: PromptExperiment[]): void {
    const data = experiments.map((e) => JSON.stringify(experimentToRecord(e))).join('\n') + '\n';
    fs.writeFileSync(this.experimentsPath, data, 'utf-8');
  }
}
