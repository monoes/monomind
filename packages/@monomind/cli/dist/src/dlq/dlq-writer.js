/**
 * DLQ Writer (Task 37)
 *
 * JSONL append-only storage for dead-letter queue entries.
 */
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, resolve, sep } from 'path';
export class DLQWriter {
    filePath;
    constructor(dataDir) {
        const resolvedDataDir = resolve(dataDir);
        const allowedRoot = resolve(process.env.MONOMIND_DATA_DIR ?? process.cwd());
        if (resolvedDataDir !== allowedRoot && !resolvedDataDir.startsWith(allowedRoot + sep)) {
            throw new Error(`DLQ dataDir escapes allowed root: ${resolvedDataDir}`);
        }
        if (!existsSync(resolvedDataDir)) {
            mkdirSync(resolvedDataDir, { recursive: true });
        }
        this.filePath = join(resolvedDataDir, 'dead-letter-queue.jsonl');
    }
    /** Enqueue a failed message into the DLQ */
    enqueue(input) {
        const lastAttempt = input.deliveryAttempts[input.deliveryAttempts.length - 1];
        const firstAttempt = input.deliveryAttempts[0];
        const entry = {
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
        // JSON.stringify can throw on circular references, BigInt, and non-serializable
        // values. originalPayload is `unknown` (caller-controlled), so a malicious or
        // malformed input could otherwise crash the writer mid-flight. Fall back to
        // a sanitized record so the audit trail is preserved.
        let serialized;
        try {
            serialized = JSON.stringify(entry);
        }
        catch {
            serialized = JSON.stringify({
                messageId: entry.messageId,
                toolName: entry.toolName,
                archivedAt: entry.archivedAt,
                status: 'pending',
                finalError: 'serialize_failed',
            });
        }
        appendFileSync(this.filePath, serialized + '\n', 'utf-8');
        return entry;
    }
    /** Get the file path (for reader/replayer) */
    getFilePath() {
        return this.filePath;
    }
}
//# sourceMappingURL=dlq-writer.js.map