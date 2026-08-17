/**
 * Unit tests for UsageProxyServer: the pure body-parsing function directly,
 * and an end-to-end request through a real loopback proxy in front of a
 * fake "upstream" http.Server fixture.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { parseUsageFromResponseBody, UsageProxyServer } from '../../src/orgrt/usage-proxy.js';

describe('parseUsageFromResponseBody', () => {
  it('extracts openai-style usage from a single JSON document', () => {
    const body = JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 20 } });
    expect(parseUsageFromResponseBody(body, 'openai')).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it('extracts anthropic-style usage from a single JSON document', () => {
    const body = JSON.stringify({ content: [], usage: { input_tokens: 7, output_tokens: 3 } });
    expect(parseUsageFromResponseBody(body, 'anthropic')).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it('extracts usage from the last data: chunk in an SSE stream', () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      '',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":4,"completion_tokens":9}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    expect(parseUsageFromResponseBody(body, 'openai')).toEqual({ inputTokens: 4, outputTokens: 9 });
  });

  it('returns undefined for a body with no usage field', () => {
    expect(parseUsageFromResponseBody(JSON.stringify({ choices: [] }), 'openai')).toBeUndefined();
  });

  it('returns undefined for malformed JSON without throwing', () => {
    expect(parseUsageFromResponseBody('{not json', 'openai')).toBeUndefined();
  });

  it('returns undefined for an empty body', () => {
    expect(parseUsageFromResponseBody('', 'openai')).toBeUndefined();
  });

  it('tolerates malformed SSE chunks mixed with valid ones', () => {
    const body = ['data: {not json', '', 'data: {"usage":{"prompt_tokens":1,"completion_tokens":2}}', ''].join('\n');
    expect(parseUsageFromResponseBody(body, 'openai')).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  it('finds anthropic input_tokens nested under message.usage on message_start, merged with output_tokens from a later message_delta chunk (regression: real Anthropic streaming shape — the two fields land in different chunks)', () => {
    const body = [
      'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":123,"output_tokens":1}}}',
      '',
      'data: {"type":"content_block_delta","delta":{"text":"hi"}}',
      '',
      'data: {"type":"message_delta","delta":{},"usage":{"output_tokens":45}}',
      '',
    ].join('\n');
    expect(parseUsageFromResponseBody(body, 'anthropic')).toEqual({ inputTokens: 123, outputTokens: 45 });
  });

  it('does not let a later chunk missing a field erase an earlier chunk\'s value for that field (openai style)', () => {
    const body = [
      'data: {"usage":{"prompt_tokens":50}}', // only input this chunk
      '',
      'data: {"usage":{"completion_tokens":30}}', // only output this chunk — must not zero out input
      '',
    ].join('\n');
    expect(parseUsageFromResponseBody(body, 'openai')).toEqual({ inputTokens: 50, outputTokens: 30 });
  });

  it('merges across full JSON-array bodies the same way as SSE chunks', () => {
    const body = JSON.stringify([
      { message: { usage: { input_tokens: 10 } } },
      { usage: { output_tokens: 5 } },
    ]);
    expect(parseUsageFromResponseBody(body, 'anthropic')).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});

describe('UsageProxyServer (end-to-end via loopback)', () => {
  let upstream: Server;
  let upstreamUrl: string;
  const proxies: UsageProxyServer[] = [];

  afterEach(async () => {
    await Promise.all(proxies.map((p) => p.stop()));
    proxies.length = 0;
    await new Promise<void>((resolve) => upstream?.close(() => resolve()));
  });

  async function startUpstream(handler: (body: string) => { status: number; body: string }): Promise<string> {
    upstream = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const { status, body } = handler(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(body);
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
    const addr = upstream.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return `http://127.0.0.1:${port}`;
  }

  it('relays the request/response unchanged and accumulates usage', async () => {
    upstreamUrl = await startUpstream(() => ({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 11, completion_tokens: 22 } }),
    }));

    const proxy = new UsageProxyServer({ upstreamBaseUrl: upstreamUrl, apiStyle: 'openai' });
    proxies.push(proxy);
    await proxy.start();

    const res = await fetch(`${proxy.url()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'x', messages: [] }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.choices[0].message.content).toBe('hello');
    // Usage parsing happens after the response stream ends — poll briefly.
    for (let i = 0; i < 20 && proxy.totals().inputTokens === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(proxy.totals()).toEqual({ inputTokens: 11, outputTokens: 22 });
  });

  it('accumulates across multiple requests until reset()', async () => {
    upstreamUrl = await startUpstream(() => ({
      status: 200,
      body: JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 5 } }),
    }));
    const proxy = new UsageProxyServer({ upstreamBaseUrl: upstreamUrl, apiStyle: 'openai' });
    proxies.push(proxy);
    await proxy.start();

    await fetch(`${proxy.url()}/a`, { method: 'POST', body: '{}' });
    await new Promise((r) => setTimeout(r, 50));
    await fetch(`${proxy.url()}/b`, { method: 'POST', body: '{}' });
    await new Promise((r) => setTimeout(r, 50));

    expect(proxy.totals()).toEqual({ inputTokens: 10, outputTokens: 10 });
    proxy.reset();
    expect(proxy.totals()).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('never breaks the proxied response when the body has no usage field', async () => {
    upstreamUrl = await startUpstream(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
    const proxy = new UsageProxyServer({ upstreamBaseUrl: upstreamUrl, apiStyle: 'openai' });
    proxies.push(proxy);
    await proxy.start();

    const res = await fetch(`${proxy.url()}/anything`, { method: 'GET' });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(proxy.totals()).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('surfaces the upstream status code unchanged', async () => {
    upstreamUrl = await startUpstream(() => ({ status: 404, body: JSON.stringify({ error: 'not found' }) }));
    const proxy = new UsageProxyServer({ upstreamBaseUrl: upstreamUrl, apiStyle: 'openai' });
    proxies.push(proxy);
    await proxy.start();

    const res = await fetch(`${proxy.url()}/missing`);
    expect(res.status).toBe(404);
  });

  it('strips accept-encoding before forwarding, so the upstream never compresses a response this proxy would otherwise fail to parse (regression: a gzipped body silently parsed as garbage → 0 usage forever)', async () => {
    let receivedAcceptEncoding: string | undefined = 'not-set';
    upstream = createServer((req, res) => {
      receivedAcceptEncoding = req.headers['accept-encoding'] as string | undefined;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
    const addr = upstream.address();
    upstreamUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

    const proxy = new UsageProxyServer({ upstreamBaseUrl: upstreamUrl, apiStyle: 'openai' });
    proxies.push(proxy);
    await proxy.start();

    await fetch(`${proxy.url()}/chat`, {
      method: 'POST',
      headers: { 'accept-encoding': 'gzip, deflate, br' },
      body: '{}',
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(receivedAcceptEncoding).toBeUndefined();
    expect(proxy.totals()).toEqual({ inputTokens: 1, outputTokens: 1 });
  });
});
