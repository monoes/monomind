/**
 * EpisodicStore — JSON-lines file-based episodic memory.
 *
 * Stores episodes as one JSON object per line in a .jsonl file,
 * following the same pattern as CostTracker and SwarmCheckpointer.
 *
 * @module v1/memory/episodic-store
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Episode, EpisodicStoreConfig } from './types.js';

/** Default summarizer: first 500 chars + ellipsis */
function defaultSummarizer(content: string): Promise<string> {
  const trimmed = content.trim();
  if (trimmed.length <= 500) return Promise.resolve(trimmed);
  return Promise.resolve(trimmed.slice(0, 500) + '...');
}

/**
 * Accumulates agent runs into episodes and persists them as JSON-lines.
 */
export class EpisodicStore {
  private readonly filePath: string;
  private readonly maxRunsPerEpisode: number;
  private readonly summarizer: (content: string) => Promise<string>;

  // Current in-progress episode state
  private currentEpisodeId: string | null = null;
  private currentSessionId: string = '';
  private currentRunIds: string[] = [];
  private currentAgentSlugs: Set<string> = new Set();
  private currentTaskTypes: Set<string> = new Set();
  private currentContent: string[] = [];
  private currentStartedAt: number = 0;

  constructor(config: EpisodicStoreConfig) {
    this.filePath = config.filePath;
    this.maxRunsPerEpisode = config.maxRunsPerEpisode ?? 20;
    this.summarizer = config.summarizer ?? defaultSummarizer;

    // Ensure parent directory exists
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // ---------------------------------------------------------------------------
  // File helpers
  // ---------------------------------------------------------------------------

  /** Read all episodes from the JSONL file (oldest-first). */
  readAll(): Episode[] {
    if (!existsSync(this.filePath)) return [];
    const raw = readFileSync(this.filePath, 'utf-8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line: string) => JSON.parse(line) as Episode);
  }

  /** Append a single episode to the file. */
  private append(episode: Episode): void {
    appendFileSync(this.filePath, JSON.stringify(episode) + '\n', 'utf-8');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Add a run to the current episode. Starts a new episode if none is open.
   * Auto-closes the episode when maxRunsPerEpisode is reached.
   *
   * @returns The closed Episode if auto-close triggered, otherwise null.
   */
  async addRun(
    runId: string,
    agentSlug: string,
    taskType: string,
    content: string,
    sessionId?: string,
  ): Promise<Episode | null> {
    // Start new episode if needed
    if (this.currentEpisodeId === null) {
      this.currentEpisodeId = randomUUID();
      this.currentSessionId = sessionId ?? '';
      this.currentRunIds = [];
      this.currentAgentSlugs = new Set();
      this.currentTaskTypes = new Set();
      this.currentContent = [];
      this.currentStartedAt = Date.now();
    }

    // Update session if provided
    if (sessionId) {
      this.currentSessionId = sessionId;
    }

    this.currentRunIds.push(runId);
    this.currentAgentSlugs.add(agentSlug);
    this.currentTaskTypes.add(taskType);
    this.currentContent.push(content);

    // Auto-close when limit reached
    if (this.currentRunIds.length >= this.maxRunsPerEpisode) {
      return this.closeEpisode();
    }

    return null;
  }

  /**
   * Close the current episode, persist it, and return it.
   * Returns null if there is no open episode.
   */
  async closeEpisode(): Promise<Episode | null> {
    if (this.currentEpisodeId === null || this.currentRunIds.length === 0) {
      return null;
    }

    const combined = this.currentContent.join('\n');
    const summary = await this.summarizer(combined);

    const episode: Episode = {
      episodeId: this.currentEpisodeId,
      sessionId: this.currentSessionId,
      runIds: [...this.currentRunIds],
      summary,
      startedAt: this.currentStartedAt,
      endedAt: Date.now(),
      agentSlugs: [...this.currentAgentSlugs],
      taskTypes: [...this.currentTaskTypes],
      tokenEstimate: Math.ceil(combined.length / 4),
    };

    this.append(episode);

    // Reset state
    this.currentEpisodeId = null;
    this.currentRunIds = [];
    this.currentAgentSlugs = new Set();
    this.currentTaskTypes = new Set();
    this.currentContent = [];
    this.currentStartedAt = 0;
    this.currentSessionId = '';

    return episode;
  }

  /**
   * Simple substring search on episode summaries.
   */
  search(query: string, maxEpisodes: number = 10): Episode[] {
    const all = this.readAll();
    const lower = query.toLowerCase();
    return all
      .filter((ep) => ep.summary.toLowerCase().includes(lower))
      .slice(-maxEpisodes);
  }

  /**
   * Retrieve an episode by its ID.
   */
  getById(episodeId: string): Episode | undefined {
    const all = this.readAll();
    return all.find((ep) => ep.episodeId === episodeId);
  }

  /**
   * List all episodes for a given session.
   */
  listBySession(sessionId: string): Episode[] {
    const all = this.readAll();
    return all.filter((ep) => ep.sessionId === sessionId);
  }

  /**
   * Check whether an episode is currently open.
   */
  hasOpenEpisode(): boolean {
    return this.currentEpisodeId !== null && this.currentRunIds.length > 0;
  }
}
