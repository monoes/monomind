import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Mock fs/promises before importing the module under test
vi.mock('node:fs/promises', () => ({
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockRejectedValue(new Error('no file')),
    mkdir: vi.fn().mockResolvedValue(undefined),
    chmod: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('node:fs', () => ({
    existsSync: vi.fn().mockReturnValue(false),
}));
// Mock the browser module so gemini_image CDP path returns null immediately
vi.mock('../browser/index.js', () => ({
    connectToTarget: vi.fn().mockRejectedValue(new Error('no browser')),
    setCookies: vi.fn(),
    openUrl: vi.fn(),
    findByRole: vi.fn(),
    findBySelector: vi.fn(),
    clickElement: vi.fn(),
    fillElement: vi.fn(),
    pressKey: vi.fn(),
    evaluateJs: vi.fn(),
    getCookies: vi.fn().mockResolvedValue([]),
    getCurrentUrl: vi.fn().mockResolvedValue(''),
    captureScreenshot: vi.fn().mockResolvedValue(null),
}));
import { createBuiltinHandlers } from '@monoes/monobrowse';
import * as fsMock from 'node:fs/promises';
function makeItem(data = {}) {
    return { data };
}
describe('createBuiltinHandlers', () => {
    it('returns a Map with the expected handler keys', () => {
        const handlers = createBuiltinHandlers();
        expect(handlers).toBeInstanceOf(Map);
        expect(handlers.has('action.http')).toBe(true);
        expect(handlers.has('action.save_file')).toBe(true);
        expect(handlers.has('action.log')).toBe(true);
        expect(handlers.has('action.gemini_image')).toBe(true);
    });
});
describe('action.save_file', () => {
    let handlers;
    beforeEach(() => {
        vi.clearAllMocks();
        // existsSync stays false — no sessions file
        handlers = createBuiltinHandlers();
    });
    it('writes a file for a safe relative path', async () => {
        const handler = handlers.get('action.save_file');
        const items = [makeItem({ hello: 'world' })];
        const result = await handler(items, { path: 'output.txt' });
        expect(fsMock.writeFile).toHaveBeenCalled();
        expect(result[0].data.savedPath).toMatch(/output\.txt$/);
    });
    it('throws "Path traversal blocked" for a path that escapes cwd', async () => {
        const handler = handlers.get('action.save_file');
        const items = [makeItem()];
        await expect(handler(items, { path: '../../etc/passwd' })).rejects.toThrow('Path traversal blocked');
    });
    it('writes binary content when item.binaryBase64 is set', async () => {
        const handler = handlers.get('action.save_file');
        const binaryItem = { data: {}, binaryBase64: Buffer.from('abc').toString('base64') };
        const result = await handler([binaryItem], { path: 'img.png' });
        expect(fsMock.writeFile).toHaveBeenCalled();
        const [, content] = vi.mocked(fsMock.writeFile).mock.calls[0];
        expect(Buffer.isBuffer(content)).toBe(true);
        expect(result[0].data.savedPath).toMatch(/img\.png$/);
    });
    it('uses config.content when no field is provided', async () => {
        const handler = handlers.get('action.save_file');
        const items = [makeItem()];
        const result = await handler(items, { path: 'out.txt', content: 'hello content' });
        const [, written] = vi.mocked(fsMock.writeFile).mock.calls[0];
        expect(written).toBe('hello content');
        expect(result[0].data.savedPath).toMatch(/out\.txt$/);
    });
});
describe('action.gemini_image', () => {
    let handlers;
    beforeEach(() => {
        vi.clearAllMocks();
        handlers = createBuiltinHandlers();
    });
    it('falls back to mock mode when browser and API key are unavailable', async () => {
        const handler = handlers.get('action.gemini_image');
        // No GEMINI_API_KEY set, browser import throws — mock mode
        delete process.env['GEMINI_API_KEY'];
        delete process.env['GOOGLE_API_KEY'];
        const items = [makeItem({ prompt: 'a beautiful sunset' })];
        const result = await handler(items, { prompt: 'a beautiful sunset', cdpPort: 19999 });
        expect(result[0].data.mockMode).toBe(true);
        expect(result[0].data.prompt).toBe('a beautiful sunset');
    });
    it('throws "Path traversal blocked" for outputPath outside cwd', async () => {
        const handler = handlers.get('action.gemini_image');
        delete process.env['GEMINI_API_KEY'];
        delete process.env['GOOGLE_API_KEY'];
        const items = [makeItem()];
        await expect(handler(items, { prompt: 'test', outputPath: '../../evil.png', cdpPort: 19999 })).rejects.toThrow('Path traversal blocked');
    });
});
describe('action.http', () => {
    let handlers;
    const originalFetch = globalThis.fetch;
    beforeEach(() => {
        handlers = createBuiltinHandlers();
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
    it('fetches a URL and stores response in item.data.response', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ success: true }),
        });
        globalThis.fetch = mockFetch;
        const handler = handlers.get('action.http');
        const items = [makeItem()];
        const result = await handler(items, { url: 'https://example.com/api', method: 'GET' });
        expect(mockFetch).toHaveBeenCalledWith('https://example.com/api', expect.objectContaining({ method: 'GET' }));
        expect(result[0].data.response.statusCode).toBe(200);
        expect(result[0].data.response.json).toEqual({ success: true });
    });
    it('uses a custom responseField when specified', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 201,
            text: async () => 'created',
        });
        const handler = handlers.get('action.http');
        const items = [makeItem()];
        const result = await handler(items, { url: 'https://example.com', responseField: 'myResult' });
        expect(result[0].data.myResult).toBeDefined();
        expect(result[0].data.myResult.statusCode).toBe(201);
    });
});
//# sourceMappingURL=browse-builtin-handlers.test.js.map