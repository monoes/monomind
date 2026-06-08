import { randomUUID } from 'crypto';
export function createJobRegistry() {
    const jobs = new Map();
    const progressMap = new Map();
    function now() { return new Date().toISOString(); }
    return {
        create(type, payload) {
            const job = {
                id: randomUUID(),
                type,
                status: 'queued',
                payload,
                createdAt: now(),
                updatedAt: now(),
            };
            jobs.set(job.id, job);
            progressMap.set(job.id, []);
            return { ...job };
        },
        get(id) {
            const j = jobs.get(id);
            return j ? { ...j } : undefined;
        },
        update(id, patch) {
            const j = jobs.get(id);
            if (!j)
                return false;
            if (j.status === 'done' || j.status === 'failed' || j.status === 'cancelled')
                return false;
            Object.assign(j, patch, { updatedAt: now() });
            return true;
        },
        cancel(id) {
            const j = jobs.get(id);
            if (!j)
                return false;
            if (j.status === 'done' || j.status === 'failed' || j.status === 'cancelled')
                return false;
            j.status = 'cancelled';
            j.updatedAt = now();
            return true;
        },
        purge(id) {
            const existed = jobs.has(id);
            jobs.delete(id);
            progressMap.delete(id);
            return existed;
        },
        list() {
            return [...jobs.values()].map(j => ({ ...j }));
        },
        emitProgress(id, event) {
            if (!jobs.has(id))
                return;
            const evts = progressMap.get(id) ?? [];
            evts.push({ ...event, timestamp: new Date().toISOString() });
            progressMap.set(id, evts);
        },
        getProgress(id) {
            return [...(progressMap.get(id) ?? [])];
        },
    };
}
export const globalJobRegistry = createJobRegistry();
//# sourceMappingURL=async-jobs.js.map