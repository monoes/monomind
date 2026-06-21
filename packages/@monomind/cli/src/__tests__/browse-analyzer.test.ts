import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AnalyzerPage } from '@monoes/monobrowse';

// Shared mock instance so tests can override `create` per-test
const mockCreate = vi.fn().mockResolvedValue({
  content: [{
    type: 'text',
    text: JSON.stringify({
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
    }),
  }],
});

// Mock Anthropic SDK before importing analyzer
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(function (this: any) {
    this.messages = { create: mockCreate };
  });
  return { default: MockAnthropic };
});

function mockPage(url = 'https://linkedin.com/feed', title = 'LinkedIn'): AnalyzerPage {
  return {
    url: vi.fn().mockResolvedValue(url),
    evaluate: vi.fn().mockImplementation((expr: string) => {
      if (expr === 'document.title') return Promise.resolve(title);
      return Promise.resolve('[]'); // empty elements for DOM capture
    }),
  };
}

describe('analyzePageForAction', () => {
  let analyzePageForAction: typeof import('@monoes/monobrowse')['analyzePageForAction'];

  beforeEach(async () => {
    mockCreate.mockClear();
    const mod = await import('@monoes/monobrowse');
    analyzePageForAction = mod.analyzePageForAction;
  });

  it('returns a valid ActionDef from mocked Claude response', async () => {
    const page = mockPage();
    // Pass a dummy key via options (Anthropic SDK is mocked — no real call is made)
    const result = await analyzePageForAction(page, 'comment on a LinkedIn post', { apiKey: 'sk-test' });
    expect(result.id).toBe('linkedin:comment_post');
    expect(result.steps).toHaveLength(5);
    expect(result.params).toContain('text');
  });

  it('throws on invalid JSON from Claude', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json at all' }],
    });
    const page = mockPage();
    await expect(analyzePageForAction(page, 'test', { apiKey: 'sk-test' })).rejects.toThrow('invalid JSON');
  });

  it('throws when ActionDef is missing id', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ steps: [] }) }],
    });
    const page = mockPage();
    await expect(analyzePageForAction(page, 'test', { apiKey: 'sk-test' })).rejects.toThrow('invalid ActionDef');
  });
});
