import { describe, it, expect, vi } from 'vitest';
import { runPlaybook } from '@monoes/monobrowse';
const triggerNode = { id: 'trigger', type: 'trigger.manual', config: {} };
describe('runPlaybook', () => {
    it('runs a single-node trigger workflow', async () => {
        const def = {
            id: 'wf-1', name: 'Test', nodes: [triggerNode], connections: [],
        };
        const record = await runPlaybook(def);
        expect(record.status).toBe('completed');
        expect(record.playbookId).toBe('wf-1');
    });
    it('rejects cyclic workflow', async () => {
        const def = {
            id: 'cyclic', name: 'Cyclic',
            nodes: [
                { id: 'a', type: 'core.set', config: {} },
                { id: 'b', type: 'core.set', config: {} },
            ],
            connections: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
        };
        await expect(runPlaybook(def)).rejects.toThrow('cycle');
    });
    it('calls node handlers for action nodes', async () => {
        const handler = vi.fn().mockResolvedValue([{ data: { result: 'ok' } }]);
        const def = {
            id: 'wf-2', name: 'Action Test',
            nodes: [
                triggerNode,
                { id: 'act', type: 'action.linkedin.comment_post', config: { text: 'hi' } },
            ],
            connections: [{ from: 'trigger', to: 'act' }],
        };
        const handlers = new Map([['action.linkedin.comment_post', handler]]);
        const record = await runPlaybook(def, { handlers });
        expect(handler).toHaveBeenCalled();
        expect(record.status).toBe('completed');
    });
    it('emits step events in order', async () => {
        const events = [];
        const def = { id: 'wf-3', name: 'Events', nodes: [triggerNode], connections: [] };
        await runPlaybook(def, { onEvent: e => events.push(e.eventType) });
        expect(events[0]).toBe('run_started');
        expect(events[events.length - 1]).toBe('run_completed');
    });
    it('skips failed node when onError is skip', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('fail'));
        const def = {
            id: 'wf-4', name: 'Skip',
            nodes: [
                triggerNode,
                { id: 'bad', type: 'action.x.fail', config: {}, onError: 'skip' },
            ],
            connections: [{ from: 'trigger', to: 'bad' }],
        };
        const handlers = new Map([['action.x.fail', handler]]);
        const record = await runPlaybook(def, { handlers });
        expect(record.status).toBe('completed');
    });
    it('stops on node failure when onError is stop (default)', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('boom'));
        const def = {
            id: 'wf-5', name: 'Stop',
            nodes: [
                triggerNode,
                { id: 'bad', type: 'action.x.fail', config: {} },
            ],
            connections: [{ from: 'trigger', to: 'bad' }],
        };
        const handlers = new Map([['action.x.fail', handler]]);
        const record = await runPlaybook(def, { handlers });
        expect(record.status).toBe('failed');
        expect(record.error).toContain('boom');
    });
    it('stops when AbortSignal is aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const def = { id: 'wf-6', name: 'Abort', nodes: [triggerNode], connections: [] };
        const record = await runPlaybook(def, { signal: controller.signal });
        expect(record.status).toBe('stopped');
    });
    it('core.set transforms item fields', async () => {
        const def = {
            id: 'wf-7', name: 'Set',
            nodes: [
                { id: 'trigger', type: 'trigger.manual', config: { items: [{ data: { x: 1 } }] } },
                { id: 'setNode', type: 'core.set', config: { y: 'hardcoded' } },
            ],
            connections: [{ from: 'trigger', to: 'setNode' }],
        };
        const events = [];
        const record = await runPlaybook(def, { onEvent: e => events.push(e) });
        expect(record.status).toBe('completed');
    });
    it('throws for unregistered action handler', async () => {
        const def = {
            id: 'wf-8', name: 'NoHandler',
            nodes: [
                triggerNode,
                { id: 'act', type: 'action.missing.thing', config: {} },
            ],
            connections: [{ from: 'trigger', to: 'act' }],
        };
        const record = await runPlaybook(def);
        expect(record.status).toBe('failed');
        expect(record.error).toContain('No handler registered');
    });
    it('core.filter keeps matching items', async () => {
        const def = {
            id: 'wf-filter', name: 'Filter',
            nodes: [
                { id: 'trigger', type: 'trigger.manual', config: { items: [{ data: { x: 1 } }, { data: { x: 2 } }, { data: { x: 3 } }] } },
                { id: 'filter', type: 'core.filter', config: { expression: '{{$json.x}}' } },
            ],
            connections: [{ from: 'trigger', to: 'filter' }],
        };
        const record = await runPlaybook(def);
        expect(record.status).toBe('completed');
        expect(record.itemsProcessed).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=browse-engine.test.js.map