/**
 * DLQ Writer (Task 37)
 *
 * JSONL append-only storage for dead-letter queue entries.
 */

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import type { DLQEntry, DeliveryAttempt } from '../../../shared/src/types/dlq.js';

/** Input for enqueue — caller provides these fields */
export interface EnqueueInput {
  toolName: string;
  originalPayload: unknown;
  deliveryAttempts: DeliveryAttempt[];
  agentId?: string;
  swarmId?: string;
  tags?: string[];
}

export class DLQWriter {
  private readonly filePath: string;

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.filePath = join(dataDir, 'dead-letter-queue.jsonl');
  }

  /** Enqueue a failed message into the DLQ */
  enqueue(input: EnqueueInput): DLQEntry {
    const lastAttempt = input.deliveryAttempts[input.deliveryAttempts.length - 1];
    const firstAttempt = input.deliveryAttempts[0];

    const entry: DLQEntry = {
      messageId: randomUUID(),
      toolName: input.toolName,
      originalPayload: input.originalPayload,
      deliveryAttempts: input.deliveryAttempts,
      finalError: lastAttempt?.errorMessage ?? 'unknown',
      finalErrorType: lastAttempt?.errorType ?? 'unknown',
      agentId: input.agentId,
      swarmId: input.swarmId,
      createdAt: firstAttempt?.attemptedAt ?? new Date().toISOString(),
      archivedAt: new Date().toISOString(),
      status: 'pending',
      tags: input.tags ?? [],
    };

    appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf-8');
    return entry;
  }

  /** Get the file path (for reader/replayer) */
  getFilePath(): string {
    return this.filePath;
  }
}
