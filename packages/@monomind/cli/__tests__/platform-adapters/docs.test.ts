import { describe, expect, it } from 'vitest';
import { renderCompatibilityMatrix } from '../../src/platform-adapters/docs.js';
import { PLATFORM_REGISTRY } from '../../src/platform-adapters/registry.js';

describe('platform compatibility documentation', () => {
  it('is generated from every adapter and capability', () => {
    const matrix = renderCompatibilityMatrix(PLATFORM_REGISTRY);
    expect(matrix).toContain('Codex');
    expect(matrix).toContain('instructions');
    expect(matrix).toContain('mcp');
  });
});
