import { describe, it, expect, vi, beforeEach } from 'vitest';

// callAnthropic routes through the local Claude Code CLI (claudeCliCall), not
// fetch — it reuses the host's existing auth instead of an ANTHROPIC_API_KEY.
// Mock that call directly rather than fetch, or these tests spawn the real
// `claude` CLI (slow, and dependent on this machine's Claude Code install).
const mockClaudeCliCall = vi.fn();
vi.mock('../../src/claude-cli.js', () => ({
  claudeCliCall: mockClaudeCliCall,
}));

import { callLLM } from '../../src/wiki/providers.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockClaudeCliCall.mockReset();
});

describe('callLLM - anthropic', () => {
  it('returns text from response', async () => {
    mockClaudeCliCall.mockResolvedValueOnce('Hello from Claude');
    const r = await callLLM('Say hi', { provider: 'anthropic', apiKey: 'sk-test' });
    expect(r.text).toBe('Hello from Claude');
    expect(mockClaudeCliCall).toHaveBeenCalledWith('Say hi');
  });

  it('throws when the claude CLI call fails', async () => {
    mockClaudeCliCall.mockRejectedValueOnce(new Error('claude exited with code 1'));
    await expect(callLLM('hi', { provider: 'anthropic', apiKey: 'bad' })).rejects.toThrow(
      'claude exited with code 1',
    );
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
