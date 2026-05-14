/**
 * DLQ Replayer (Task 37)
 *
 * Replays dead-letter queue entries by re-invoking the original tool call.
 *
 * CONCURRENCY: Uses append-only status records to avoid racing with DLQWriter.enqueue().
 * A status record `{ _statusFor, status, replayedAt, replayResult }` is appended after
 * replay. readAll() merges status records into the base entries — the last status wins.
 * Compaction rewrites the file when status records exceed 20% of total lines.
 */
import type { DLQReplayResult } from '../../../shared/src/types/dlq.js';
/** A function that attempts to call a tool with the original payload */
export type ToolCaller = (toolName: string, payload: unknown) => Promise<void>;
export declare class DLQReplayer {
    private readonly filePath;
    private readonly toolCaller;
    constructor(filePath: string, toolCaller: ToolCaller);
    /** Read all lines, merge status records into entries. Last status wins. */
    private readAll;
    /** Append a status-change record — never touches existing lines, safe alongside DLQWriter. */
    private appendStatus;
    /** Compact: rewrite file with merged entries only, removing status records. */
    private compact;
    /** Replay a single DLQ entry by messageId */
    replay(messageId: string): Promise<DLQReplayResult>;
}
//# sourceMappingURL=dlq-replayer.d.ts.map