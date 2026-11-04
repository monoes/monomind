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

  it('has a tier column and labels tier 3 experimental', () => {
    const lines = renderCompatibilityMatrix(PLATFORM_REGISTRY).split('\n');
    expect(lines.find((line) => line.startsWith('Platform |'))).toMatch(/^Platform \| Tier \|/);
    expect(lines.find((line) => line.startsWith('Claude Code |'))).toMatch(/^Claude Code \| 1 \|/);
    expect(lines.find((line) => line.startsWith('Codex |'))).toMatch(/^Codex \| 2 \|/);
    expect(lines.find((line) => line.startsWith('GitHub Copilot |'))).toMatch(
      /^GitHub Copilot \| 3 \(experimental\) \|/,
    );
  });
});
