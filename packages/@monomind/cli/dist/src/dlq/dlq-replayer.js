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
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
export class DLQReplayer {
    filePath;
    toolCaller;
    constructor(filePath, toolCaller) {
        this.filePath = filePath;
        this.toolCaller = toolCaller;
    }
    /** Read all lines, merge status records into entries. Last status wins. */
    readAll() {
        if (!existsSync(this.filePath))
            return { entries: [], rawLineCount: 0 };
        const stat = statSync(this.filePath);
        if (stat.size > 256 * 1024 * 1024) {
            throw new Error(`DLQ file exceeds 256MB (${stat.size} bytes). Run rotation/cleanup.`);
        }
        const raw = readFileSync(this.filePath, 'utf-8').trim();
        if (!raw)
            return { entries: [], rawLineCount: 0 };
        const lines = raw.split('\n').filter(Boolean);
        const statusMap = new Map();
        const baseEntries = [];
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line);
                if (parsed._statusFor) {
                    statusMap.set(parsed._statusFor, parsed);
                }
                else {
                    baseEntries.push(parsed);
                }
            }
            catch { /* skip malformed lines */ }
        }
        const entries = baseEntries.map((e) => {
            const s = statusMap.get(e.messageId);
            return s ? { ...e, status: s.status, replayedAt: s.replayedAt, replayResult: s.replayResult } : e;
        });
        return { entries, rawLineCount: lines.length };
    }
    /** Append a status-change record — never touches existing lines, safe alongside DLQWriter. */
    appendStatus(record) {
        appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf-8');
    }
    /** Compact: rewrite file with merged entries only, removing status records. */
    compact(entries) {
        const content = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
        const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(tmp, content, 'utf-8');
        renameSync(tmp, this.filePath);
    }
    /** Replay a single DLQ entry by messageId */
    async replay(messageId) {
        const { entries, rawLineCount } = this.readAll();
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
            this.appendStatus({ _statusFor: messageId, status: 'replayed', replayedAt: now, replayResult: 'success' });
            // Compact when status records inflate file by >20%
            if (rawLineCount > 0 && (rawLineCount - entries.length) / rawLineCount > 0.2) {
                const merged = entries.map((e) => e.messageId === messageId ? { ...e, status: 'replayed', replayedAt: now, replayResult: 'success' } : e);
                this.compact(merged);
            }
            return { messageId, success: true, replayedAt: now };
        }
        catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            this.appendStatus({ _statusFor: messageId, status: 'pending', replayedAt: now, replayResult: 'failed_again' });
            return { messageId, success: false, errorMessage, replayedAt: now };
        }
    }
}
//# sourceMappingURL=dlq-replayer.js.map