import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer } from 'http';
import { registerAnalyzeRoute } from '../../src/web/analyze-api.js';

// Mock buildAsync so tests don't need a real repo
vi.mock('../../src/pipeline/orchestrator.js', () => ({
  buildAsync: vi.fn().mockImplementation(async (_path: string, opts: { onProgress?: (p: { phase: string; message?: string }) => void }) => {
    opts.onProgress?.({ phase: 'scan', message: 'Scanning...' });
    opts.onProgress?.({ phase: 'parse', message: 'Parsing...' });
  }),
}));

vi.mock('../../src/storage/node-store.js', () => ({
  countNodes: vi.fn().mockReturnValue(42),
}));

vi.mock('../../src/storage/edge-store.js', () => ({
  countEdges: vi.fn().mockReturnValue(17),
}));

vi.mock('../../src/storage/db.js', () => ({
  openDb: vi.fn().mockReturnValue({}),
  closeDb: vi.fn(),
}));

let httpServer: ReturnType<typeof createServer>;

afterEach(() => {
  if (httpServer?.listening) httpServer.close();
});

describe('registerAnalyzeRoute', () => {
  it('returns SSE content-type', async () => {
    httpServer = createServer();
    registerAnalyzeRoute(httpServer);
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/analyze?repoPath=/tmp/test`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    await res.text(); // consume
  });

  it('emits progress and complete events', async () => {
    httpServer = createServer();
    registerAnalyzeRoute(httpServer);
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/analyze?repoPath=/tmp/test`);
    const body = await res.text();
    expect(body).toContain('"type":"progress"');
    expect(body).toContain('"type":"complete"');
    expect(body).toContain('"nodeCount":42');
  });

  it('returns 400 if repoPath is missing', async () => {
    httpServer = createServer();
    registerAnalyzeRoute(httpServer);
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/analyze`);
    expect(res.status).toBe(400);
  });
});
