import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callLLM } from '../../src/wiki/providers.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body };
}

beforeEach(() => mockFetch.mockReset());

describe('callLLM - anthropic', () => {
  it('returns text from response', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({
      content: [{ text: 'Hello from Claude' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
    const r = await callLLM('Say hi', { provider: 'anthropic', apiKey: 'sk-test' });
    expect(r.text).toBe('Hello from Claude');
    expect(r.inputTokens).toBe(10);
  });

  it('throws on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({}, false, 401));
    await expect(callLLM('hi', { provider: 'anthropic', apiKey: 'bad' })).rejects.toThrow('401');
  });
});

describe('callLLM - openai', () => {
  it('returns text from choices', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({
      choices: [{ message: { content: 'Hello from GPT' } }],
      usage: { prompt_tokens: 8, completion_tokens: 4 },
    }));
    const r = await callLLM('Say hi', { provider: 'openai', apiKey: 'sk-test' });
    expect(r.text).toBe('Hello from GPT');
    expect(r.outputTokens).toBe(4);
  });
});

describe('callLLM - ollama', () => {
  it('returns text from response field', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ response: 'Hello from Ollama' }));
    const r = await callLLM('Say hi', { provider: 'ollama' });
    expect(r.text).toBe('Hello from Ollama');
  });

  it('uses custom baseUrl', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ response: 'ok' }));
    await callLLM('hi', { provider: 'ollama', baseUrl: 'http://myhost:9999' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://myhost:9999/api/generate',
      expect.anything(),
    );
  });
});
