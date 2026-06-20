import { describe, it, expect } from 'vitest';
import { resolveExpression, resolveConfig } from '../browser/workflow/expression.js';
import type { Item } from '../browser/workflow/types.js';

const item: Item = { data: { url: 'https://linkedin.com/post/123', comment: 'Great post!' } };
const nodeOutputs: Record<string, Item[]> = {
  'trigger': [{ data: { url: 'https://linkedin.com/post/123' } }],
};
const params: Record<string, string> = { text: 'Hello world', post_url: 'https://linkedin.com/post/123' };

describe('resolveExpression', () => {
  it('resolves $json fields', () => {
    expect(resolveExpression('{{$json.url}}', item, nodeOutputs, params)).toBe('https://linkedin.com/post/123');
  });

  it('resolves $env variables', () => {
    process.env.TEST_VAR = 'test-value';
    expect(resolveExpression('{{$env.TEST_VAR}}', item, nodeOutputs, params)).toBe('test-value');
    delete process.env.TEST_VAR;
  });

  it('resolves params', () => {
    expect(resolveExpression('{{params.text}}', item, nodeOutputs, params)).toBe('Hello world');
  });

  it('resolves node output references', () => {
    expect(resolveExpression('{{$node.trigger.url}}', item, nodeOutputs, params)).toBe('https://linkedin.com/post/123');
  });

  it('resolves $node bracket notation', () => {
    expect(resolveExpression('{{$node["trigger"].url}}', item, nodeOutputs, params)).toBe('https://linkedin.com/post/123');
  });

  it('returns raw string if no template markers', () => {
    expect(resolveExpression('plain text', item, nodeOutputs, params)).toBe('plain text');
  });

  it('throws on unresolved expression', () => {
    expect(() => resolveExpression('{{$json.missing}}', item, nodeOutputs, params)).toThrow('Unresolved');
  });
});

describe('resolveConfig', () => {
  it('resolves all string values in a config object', () => {
    const config = { post_url: '{{$json.url}}', text: '{{params.text}}', count: 3 };
    const result = resolveConfig(config, item, nodeOutputs, params);
    expect(result.post_url).toBe('https://linkedin.com/post/123');
    expect(result.text).toBe('Hello world');
    expect(result.count).toBe(3);
  });
});
