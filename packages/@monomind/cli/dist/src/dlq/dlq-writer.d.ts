/**
 * DLQ Writer (Task 37)
 *
 * JSONL append-only storage for dead-letter queue entries.
 */
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
export declare class DLQWriter {
    private readonly filePath;
    constructor(dataDir: string);
    /** Enqueue a failed message into the DLQ */
    enqueue(input: EnqueueInput): DLQEntry;
    /** Get the file path (for reader/replayer) */
    getFilePath(): string;
}
//# sourceMappingURL=dlq-writer.d.ts.map