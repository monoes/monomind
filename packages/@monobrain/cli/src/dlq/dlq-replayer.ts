/**
 * DLQ Replayer (Task 37)
 *
 * Replays dead-letter queue entries by re-invoking the original tool call.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { DLQEntry, DLQReplayResult } from '../../../shared/src/types/dlq.js';

/** A function that attempts to call a tool with the original payload */
export type ToolCaller = (toolName: string, payload: unknown) => Promise<void>;

export class DLQReplayer {
  constructor(
    private readonly filePath: string,
    private readonly toolCaller: ToolCaller,
  ) {}

  /** Read all entries */
  private readAll(): DLQEntry[] {
    if (!existsSync(this.filePath)) return [];
    const raw = readFileSync(this.filePath, 'utf-8').trim();
    if (!raw) return [];
    return raw.split('\n').map((line) => JSON.parse(line) as DLQEntry);
  }

  /** Write all entries back */
  private writeAll(entries: DLQEntry[]): void {
    const content = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
    writeFileSync(this.filePath, content, 'utf-8');
  }

  /** Replay a single DLQ entry by messageId */
  async replay(messageId: string): Promise<DLQReplayResult> {
    const entries = this.readAll();
    const entry = entries.find((e) => e.messageId === messageId);

    if (!entry) {
      throw new Error(`DLQ entry not found: ${messageId}`);
    }
    if (entry.status !== 'pending') {
      throw new Error(`DLQ entry is not pending: ${messageId} (status=${entry.status})`);
    }

    const now = new Date().toISOString();

    try {
      await this.toolCaller(entry.toolName, entry.originalPayload);
      entry.status = 'replayed';
      entry.replayedAt = now;
      entry.replayResult = 'success';
      this.writeAll(entries);

      return { messageId, success: true, replayedAt: now };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      entry.replayResult = 'failed_again';
      // status stays 'pending'
      this.writeAll(entries);

      return { messageId, success: false, errorMessage, replayedAt: now };
    }
  }
}
