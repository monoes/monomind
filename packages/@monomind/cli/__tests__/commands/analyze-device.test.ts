import { describe, it, expect, vi } from 'vitest';

// Mock mcp-client to avoid @monoes/monograph resolution failure
vi.mock('../../src/mcp-client.js', () => ({
  callMCPTool: vi.fn(),
  MCPClientError: class MCPClientError extends Error {},
}));

import { analyzeCommand } from '../../src/commands/analyze.js';

describe('analyze --embedding-device', () => {
  it('has embedding-device option', () => {
    const allOptions = [
      ...(analyzeCommand.options ?? []),
      ...(analyzeCommand.subcommands?.flatMap((s: any) => s.options ?? []) ?? []),
    ];
    expect(allOptions.some((o: any) => o.name === 'embedding-device')).toBe(true);
  });

  it('embedding-device has valid choices', () => {
    const allOptions = [
      ...(analyzeCommand.options ?? []),
      ...(analyzeCommand.subcommands?.flatMap((s: any) => s.options ?? []) ?? []),
    ];
    const devOpt = allOptions.find((o: any) => o.name === 'embedding-device');
    expect(devOpt?.choices).toEqual(expect.arrayContaining(['auto', 'cpu', 'cuda', 'wasm']));
  });
});
