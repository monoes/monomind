/**
 * Dead Letter Queue Types (Task 37)
 *
 * Types for DLQ entries, delivery attempts, replay results.
 */

/** A single delivery attempt record */
export interface DeliveryAttempt {
  attemptNumber: number;
  attemptedAt: string; // ISO string
  errorType: string;
  errorMessage: string;
  latencyMs: number;
}

/** Status of a DLQ entry */
export type DLQEntryStatus = 'pending' | 'replayed' | 'purged';

/** A dead-letter queue entry */
export interface DLQEntry {
  messageId: string;
  toolName: string;
  originalPayload: unknown;
  deliveryAttempts: DeliveryAttempt[];
  finalError: string;
  finalErrorType: string;
  agentId?: string;
  swarmId?: string;
  createdAt: string; // ISO string
  archivedAt: string; // ISO string
  replayedAt?: string;
  replayResult?: string;
  status: DLQEntryStatus;
  tags: string[];
}

/** Result of replaying a DLQ entry */
export interface DLQReplayResult {
  messageId: string;
  success: boolean;
  errorMessage?: string;
  replayedAt: string; // ISO string
}
