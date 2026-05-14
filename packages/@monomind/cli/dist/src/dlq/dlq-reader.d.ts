/**
 * DLQ Reader (Task 37)
 *
 * Reads, filters, and purges DLQ entries from JSONL storage.
 */
import type { DLQEntry, DLQEntryStatus } from '../../../shared/src/types/dlq.js';
/** Options for listing DLQ entries */
export interface DLQListOptions {
    status?: DLQEntryStatus;
    toolName?: string;
    agentId?: string;
    olderThanDays?: number;
    limit?: number;
}
export declare class DLQReader {
    private readonly filePath;
    constructor(filePath: string);
    /** Read all entries from the JSONL file with a hard size cap.
     * The DLQ is append-only with no rotation — without this guard a long-running
     * process can grow the file to GBs and OOM on every list/get/purge call. */
    private readAll;
    /** Write all entries back (used for purge) — uses unique tmp filename to avoid concurrent writer collisions */
    private writeAll;
    /** List entries with optional filters (defaults to status='pending') */
    list(opts?: DLQListOptions): DLQEntry[];
    /** Get a single entry by messageId */
    get(messageId: string): DLQEntry | null;
    /** Purge old pending entries (mark as 'purged') */
    purge(olderThanDays: number): number;
}
//# sourceMappingURL=dlq-reader.d.ts.map