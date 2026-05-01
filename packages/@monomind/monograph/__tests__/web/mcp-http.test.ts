import { describe, it, expect, afterEach } from 'vitest';
import { createMcpHttpServer } from '../../src/web/mcp-http.js';

const echoTool = {
  name: 'echo',
  description: 'Echo the input',
  handler: async (args: Record<string, unknown>) => ({ echoed: args['text'] }),
};

let server: ReturnType<typeof createMcpHttpServer>;

afterEach(async () => {
  if (server) await server.stop();
});

describe('McpHttpServer', () => {
  it('starts and exposes a port', async () => {
    server = createMcpHttpServer({ port: 0, tools: [echoTool] });
    await server.start();
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toMatch(/^http:\/\//);
  });

  it('GET /mcp/tools returns JSON', async () => {
    server = createMcpHttpServer({ port: 0, tools: [echoTool] });
    await server.start();
    const res = await fetch(`${server.url}/mcp/tools`);
    expect(res.ok).toBe(true);
    const body = await res.json() as { tools: unknown[] };
    expect(Array.isArray(body.tools) || body.tools !== undefined).toBe(true);
  });

  it('POST /mcp/call invokes a tool', async () => {
    server = createMcpHttpServer({ port: 0, tools: [echoTool] });
    await server.start();
    const res = await fetch(`${server.url}/mcp/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'echo', arguments: { text: 'hello' } }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json() as { echoed: string };
    expect(body.echoed).toBe('hello');
  });

  it('POST /mcp/call returns 404 for unknown tool', async () => {
    server = createMcpHttpServer({ port: 0, tools: [echoTool] });
    await server.start();
    const res = await fetch(`${server.url}/mcp/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'nonexistent', arguments: {} }),
    });
    expect(res.status).toBe(404);
  });

  it('GET /mcp/stream emits SSE events', async () => {
    server = createMcpHttpServer({ port: 0, tools: [echoTool] });
    await server.start();
    const args = encodeURIComponent(JSON.stringify({ text: 'world' }));
    const res = await fetch(`${server.url}/mcp/stream?name=echo&args=${args}`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('[DONE]');
    expect(text).toContain('world');
  });
});
