import { describe, it, expect, vi } from 'vitest';
import { callLLM } from '../../wiki/providers.js';

describe('reasoning model support', () => {
  it('strips temperature for o1 model', async () => {
    let capturedBody: any;
    const mockFetch = vi.fn().mockImplementation((_url: any, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'result' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      });
    });
    global.fetch = mockFetch as any;

    await callLLM('test', { provider: 'openai', model: 'o1-mini', apiKey: 'test' });

    expect(capturedBody.temperature).toBeUndefined();
    expect(capturedBody.max_completion_tokens).toBeDefined();
    expect(capturedBody.max_tokens).toBeUndefined();
  });

  it('uses standard params for non-reasoning models', async () => {
    let capturedBody: any;
    const mockFetch = vi.fn().mockImplementation((_url: any, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'result' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      });
    });
    global.fetch = mockFetch as any;

    await callLLM('test', { provider: 'openai', model: 'gpt-4o', apiKey: 'test' });

    expect(capturedBody.temperature).toBeDefined();
    expect(capturedBody.max_tokens).toBeDefined();
    expect(capturedBody.max_completion_tokens).toBeUndefined();
  });
});
