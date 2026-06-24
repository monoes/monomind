import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readPlaybook, writePlaybookRun, listPlaybookRuns, readAction, clearRunStore } from '@monoes/monobrowse';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const TMP = join(tmpdir(), 'browse-store-test-' + Date.now());
beforeEach(() => {
    clearRunStore();
    mkdirSync(join(TMP, 'playbooks'), { recursive: true });
    mkdirSync(join(TMP, 'actions'), { recursive: true });
});
afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
});
describe('readPlaybook', () => {
    it('parses a valid playbook JSON file', async () => {
        const pb = {
            id: 'test-pb',
            name: 'Test Playbook',
            nodes: [{ id: 'trigger', type: 'trigger.manual', config: {} }],
            connections: [],
        };
        const p = join(TMP, 'playbooks', 'test.json');
        writeFileSync(p, JSON.stringify(pb));
        const result = await readPlaybook(p);
        expect(result.id).toBe('test-pb');
        expect(result.nodes).toHaveLength(1);
    });
    it('throws on missing file', async () => {
        await expect(readPlaybook(join(TMP, 'nonexistent.json'))).rejects.toThrow();
    });
    it('throws on invalid JSON', async () => {
        const p = join(TMP, 'playbooks', 'bad.json');
        writeFileSync(p, 'not json');
        await expect(readPlaybook(p)).rejects.toThrow();
    });
    it('throws if nodes array is missing', async () => {
        const p = join(TMP, 'playbooks', 'no-nodes.json');
        writeFileSync(p, JSON.stringify({ id: 'x', name: 'y', connections: [] }));
        await expect(readPlaybook(p)).rejects.toThrow('nodes');
    });
});
describe('readAction', () => {
    it('parses a valid action JSON file', async () => {
        const action = {
            id: 'linkedin:comment_post',
            platform: 'linkedin',
            name: 'Comment on Post',
            params: ['post_url', 'text'],
            steps: [],
        };
        const p = join(TMP, 'actions', 'comment.json');
        writeFileSync(p, JSON.stringify(action));
        const result = await readAction(p);
        expect(result.id).toBe('linkedin:comment_post');
        expect(result.params).toContain('post_url');
    });
    it('throws on missing action file', async () => {
        await expect(readAction(join(TMP, 'actions', 'nonexistent.json'))).rejects.toThrow();
    });
    it('throws on invalid action JSON', async () => {
        const p = join(TMP, 'actions', 'bad.json');
        writeFileSync(p, 'not json');
        await expect(readAction(p)).rejects.toThrow();
    });
    it('throws if action steps array is missing', async () => {
        const p = join(TMP, 'actions', 'no-steps.json');
        writeFileSync(p, JSON.stringify({ id: 'x', platform: 'y', name: 'z', params: [] }));
        await expect(readAction(p)).rejects.toThrow('steps');
    });
});
describe('writePlaybookRun + listPlaybookRuns', () => {
    it('stores and retrieves run records', async () => {
        const record = {
            id: 'run-1',
            playbookId: 'pb-1',
            playbookName: 'Test PB',
            status: 'completed',
            startedAt: Date.now(),
            completedAt: Date.now() + 1000,
            itemsProcessed: 5,
            itemsTotal: 5,
        };
        await writePlaybookRun(record);
        const runs = await listPlaybookRuns();
        const found = runs.find(r => r.id === 'run-1');
        expect(found).toBeDefined();
        expect(found?.status).toBe('completed');
    });
    it('filters runs by playbookId', async () => {
        const r1 = { id: 'r1', playbookId: 'pb-a', playbookName: 'A', status: 'completed', startedAt: 1, itemsProcessed: 1, itemsTotal: 1 };
        const r2 = { id: 'r2', playbookId: 'pb-b', playbookName: 'B', status: 'failed', startedAt: 2, itemsProcessed: 0, itemsTotal: 1 };
        await writePlaybookRun(r1);
        await writePlaybookRun(r2);
        const runs = await listPlaybookRuns('pb-a');
        expect(runs.every(r => r.playbookId === 'pb-a')).toBe(true);
    });
});
//# sourceMappingURL=browse-store.test.js.map