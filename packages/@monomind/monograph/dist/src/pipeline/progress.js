export class ProgressReporter {
    callbacks = [];
    startTime = Date.now();
    counts = new Map();
    subscribe(cb) {
        this.callbacks.push(cb);
        return () => {
            const idx = this.callbacks.indexOf(cb);
            if (idx !== -1)
                this.callbacks.splice(idx, 1);
        };
    }
    emit(phase, opts) {
        const event = {
            phase,
            elapsedMs: Date.now() - this.startTime,
            ...opts,
        };
        for (const cb of this.callbacks) {
            try {
                cb(event);
            }
            catch { /* don't let progress errors crash the pipeline */ }
        }
    }
    increment(phase) {
        this.counts.set(phase, (this.counts.get(phase) ?? 0) + 1);
    }
    getCount(phase) {
        return this.counts.get(phase) ?? 0;
    }
}
export function consoleProgressReporter(enabled) {
    return (event) => {
        if (!enabled)
            return;
        const pct = event.totalFiles && event.filesProcessed
            ? ` (${Math.round(event.filesProcessed / event.totalFiles * 100)}%)`
            : '';
        const msg = event.message ?? `phase: ${event.phase}`;
        process.stderr.write(`\r  ${msg}${pct}   `);
        if (event.phase === 'complete')
            process.stderr.write('\n');
    };
}
//# sourceMappingURL=progress.js.map