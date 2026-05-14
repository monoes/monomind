/**
 * DLQ Reader (Task 37)
 *
 * Reads, filters, and purges DLQ entries from JSONL storage.
 */
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, statSync, unlinkSync } from 'fs';
import { parseJsonl } from '../utils/parse-jsonl.js';
export class DLQReader {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    /** Read all entries from the JSONL file with a hard size cap.
     * The DLQ is append-only with no rotation — without this guard a long-running
     * process can grow the file to GBs and OOM on every list/get/purge call. */
    readAll() {
        if (!existsSync(this.filePath))
            return [];
        const stat = statSync(this.filePath);
        if (stat.size > 256 * 1024 * 1024) {
            throw new Error(`DLQ file exceeds 256MB (${stat.size} bytes). Run rotation/cleanup.`);
        }
        const raw = readFileSync(this.filePath, 'utf-8');
        return parseJsonl(raw);
    }
    /** Write all entries back (used for purge) — uses unique tmp filename to avoid concurrent writer collisions */
    writeAll(entries) {
        const content = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
        const tmp = `${this.filePath}.${randomUUID()}.tmp`;
        try {
            writeFileSync(tmp, content, 'utf-8');
            renameSync(tmp, this.filePath);
        }
        catch (err) {
            try {
                unlinkSync(tmp);
            }
            catch { /* ignore cleanup failure */ }
            throw err;
        }
    }
    /** List entries with optional filters (defaults to status='pending') */
    list(opts = {}) {
        const status = opts.status ?? 'pending';
        let entries = this.readAll().filter((e) => e.status === status);
        if (opts.toolName) {
            entries = entries.filter((e) => e.toolName === opts.toolName);
        }
        if (opts.agentId) {
            entries = entries.filter((e) => e.agentId === opts.agentId);
        }
        if (opts.olderThanDays !== undefined) {
            const cutoff = Date.now() - opts.olderThanDays * 24 * 60 * 60 * 1000;
            entries = entries.filter((e) => new Date(e.createdAt).getTime() < cutoff);
        }
        if (opts.limit !== undefined) {
            entries = entries.slice(0, opts.limit);
        }
        return entries;
    }
    /** Get a single entry by messageId */
    get(messageId) {
        return this.readAll().find((e) => e.messageId === messageId) ?? null;
    }
    /** Purge old pending entries (mark as 'purged') */
    purge(olderThanDays) {
        const entries = this.readAll();
        const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
        let count = 0;
        for (const entry of entries) {
            if (entry.status === 'pending' && new Date(entry.createdAt).getTime() < cutoff) {
                entry.status = 'purged';
                count++;
            }
        }
        this.writeAll(entries);
        return count;
    }
}
//# sourceMappingURL=dlq-reader.js.map