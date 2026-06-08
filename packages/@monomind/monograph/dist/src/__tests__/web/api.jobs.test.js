import { describe, it, expect, beforeEach } from 'vitest';
import { createJobRegistry } from '../../web/async-jobs.js';
describe('JobRegistry', () => {
    let registry;
    beforeEach(() => {
        registry = createJobRegistry();
    });
    it('creates a job and returns an id', () => {
        const job = registry.create('analyze', { repoPath: '/tmp/repo' });
        expect(job.id).toBeDefined();
        expect(job.status).toBe('queued');
        expect(job.type).toBe('analyze');
    });
    it('retrieves a job by id', () => {
        const job = registry.create('analyze', { repoPath: '/tmp/repo' });
        const found = registry.get(job.id);
        expect(found).toBeDefined();
        expect(found?.id).toBe(job.id);
    });
    it('updates job status to running and done', () => {
        const job = registry.create('analyze', { repoPath: '/tmp/repo' });
        registry.update(job.id, { status: 'running' });
        expect(registry.get(job.id)?.status).toBe('running');
        registry.update(job.id, { status: 'done', result: { nodes: 42 } });
        expect(registry.get(job.id)?.status).toBe('done');
        expect(registry.get(job.id)?.result?.nodes).toBe(42);
    });
    it('cancels a job', () => {
        const job = registry.create('analyze', { repoPath: '/tmp/repo' });
        registry.cancel(job.id);
        expect(registry.get(job.id)?.status).toBe('cancelled');
    });
    it('returns undefined for unknown job', () => {
        expect(registry.get('nonexistent')).toBeUndefined();
    });
    it('cancel returns false for unknown job', () => {
        expect(registry.cancel('nonexistent')).toBe(false);
    });
});
//# sourceMappingURL=api.jobs.test.js.map