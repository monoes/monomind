import { describe, it, expect } from 'vitest';
import { generateMCPConfig } from '../src/init/mcp-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

describe('generateMCPConfig (regression: no non-standard fields in .mcp.json)', () => {
  it('writes only command/args/env for the monomind server entry — no autoStart', () => {
    // Regression: this used to inject `autoStart` into the .mcp.json server
    // entry. Claude Code's actual schema for stdio servers is only
    // command/args/env — autoStart isn't a field it reads, and nothing in
    // monomind reads it back from this file either (a monoagent session
    // flagged this as suspicious noise possibly interfering with reconnect
    // behavior). Assert the entry's shape stays exactly what Claude Code
    // expects, with no extra properties.
    const config = generateMCPConfig(DEFAULT_INIT_OPTIONS) as { mcpServers: Record<string, unknown> };
    const entry = config.mcpServers.monomind as Record<string, unknown>;
    expect(entry).toBeDefined();
    expect(Object.keys(entry).sort()).toEqual(['args', 'command', 'env']);
    expect(entry).not.toHaveProperty('autoStart');
  });
});
