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
  private static readonly MAX_ENTRIES = 1_000;
  private static readonly MAX_CONTENT_BYTES = 64 * 1024;

  public entries: ScratchpadEntry[] = [];
  public iteration = 0;

  append(agentId: string, content: string): void {
    if (this.entries.length >= SharedScratchpad.MAX_ENTRIES) return;
    const safeContent = content.length > SharedScratchpad.MAX_CONTENT_BYTES
      ? content.slice(0, SharedScratchpad.MAX_CONTENT_BYTES)
      : content;
    this.entries.push({ agentId, content: safeContent, timestamp: new Date() });
    this.iteration++;
  }

  /**
   * Return a human-readable transcript of all entries,
   * separated by `---` dividers.
   */
  private static readonly MAX_READ_BYTES = 128 * 1024;

  read(): string {
    const full = this.entries
      .map(
        (e) =>
          `[${e.agentId} @ ${e.timestamp.toISOString()}]\n${e.content}`,
      )
      .join('\n---\n');
    if (full.length <= SharedScratchpad.MAX_READ_BYTES) return full;
    const suffix = full.slice(full.length - SharedScratchpad.MAX_READ_BYTES);
    const cutIdx = suffix.indexOf('\n---\n');
    return cutIdx === -1 ? suffix : suffix.slice(cutIdx + 5);
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
