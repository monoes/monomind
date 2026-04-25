/**
 * SharedScratchpad — a shared, append-only log that two or more agents
 * can use to exchange messages during a collaborate-mode iteration loop.
 */

export interface ScratchpadEntry {
  agentId: string;
  content: string;
  timestamp: Date;
}

export class SharedScratchpad {
  public entries: ScratchpadEntry[] = [];
  public iteration = 0;

  append(agentId: string, content: string): void {
    this.entries.push({ agentId, content, timestamp: new Date() });
    this.iteration++;
  }

  /**
   * Return a human-readable transcript of all entries,
   * separated by `---` dividers.
   */
  read(): string {
    return this.entries
      .map(
        (e) =>
          `[${e.agentId} @ ${e.timestamp.toISOString()}]\n${e.content}`,
      )
      .join('\n---\n');
  }

  readEntries(): Readonly<ScratchpadEntry[]> {
    return this.entries;
  }

  isConverged(predicate: (entries: ScratchpadEntry[]) => boolean): boolean {
    return predicate(this.entries);
  }

  reset(): void {
    this.entries = [];
    this.iteration = 0;
  }
}
