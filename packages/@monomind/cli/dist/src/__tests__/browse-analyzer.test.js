import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
// Mock child_process.spawn so tests don't invoke the real claude CLI
vi.mock('child_process', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, spawn: vi.fn() };
});
async function makeSpawnMock(stdout, exitCode = 0) {
    const { spawn } = vi.mocked(await import('child_process'));
    spawn.mockImplementationOnce(() => {
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();
        setTimeout(() => {
            proc.stdout.emit('data', Buffer.from(stdout));
            proc.emit('close', exitCode);
        }, 0);
        return proc;
    });
}
const VALID_ACTION_DEF = {
    id: 'linkedin:comment_post',
    platform: 'linkedin',
    name: 'Comment on Post',
    params: ['post_url', 'text'],
    steps: [
        { type: 'navigate', url: '{{params.post_url}}' },
        { type: 'find', selectors: ['.comment-box'], as: 'box' },
        { type: 'click', target: '{{box}}' },
        { type: 'type', target: '{{box}}', text: '{{params.text}}', humanDelay: true },
        { type: 'wait', condition: 'network_idle', timeout: 3000 },
    ],
};
function mockPage(url = 'https://linkedin.com/feed', title = 'LinkedIn') {
    return {
        url: vi.fn().mockResolvedValue(url),
        evaluate: vi.fn().mockImplementation((expr) => {
            if (expr === 'document.title')
                return Promise.resolve(title);
            return Promise.resolve('[]');
        }),
    };
}
describe('analyzePageForAction', () => {
    let analyzePageForAction;
    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('@monoes/monobrowse');
        analyzePageForAction = mod.analyzePageForAction;
    });
    it('returns a valid ActionDef from mocked claude --print response', async () => {
        await makeSpawnMock(JSON.stringify(VALID_ACTION_DEF));
        const result = await analyzePageForAction(mockPage(), 'comment on a LinkedIn post');
        expect(result.id).toBe('linkedin:comment_post');
        expect(result.steps).toHaveLength(5);
        expect(result.params).toContain('text');
    });
    it('throws on invalid JSON from claude', async () => {
        await makeSpawnMock('not json at all');
        await expect(analyzePageForAction(mockPage(), 'test')).rejects.toThrow('invalid JSON');
    });
    it('throws when ActionDef is missing id', async () => {
        await makeSpawnMock(JSON.stringify({ steps: [] }));
        await expect(analyzePageForAction(mockPage(), 'test')).rejects.toThrow('invalid ActionDef');
    });
});
//# sourceMappingURL=browse-analyzer.test.js.map