/**
 * Unit tests for the Crush CLI plain-text output parser (crush-runner).
 */
import { describe, it, expect } from 'vitest';
import { parseCrushOutput } from '../../src/orgrt/crush-runner.js';

describe('parseCrushOutput', () => {
  it('trims surrounding whitespace', () => {
    const r = parseCrushOutput('\n\n  hello world  \n\n');
    expect(r.text).toBe('hello world');
    expect(r.rawText).toBe('hello world');
  });

  it('strips tool_call fences from text but keeps rawText', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{"to":"boss","subject":"s","message":"m"}}\n```';
    const r = parseCrushOutput(`Sending now.\n${fence}`);
    expect(r.text).toBe('Sending now.');
    expect(r.rawText).toContain('tool_call');
  });

  it('returns empty text when output is entirely a tool_call fence', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{}}\n```';
    const r = parseCrushOutput(fence);
    expect(r.text).toBe('');
    expect(r.rawText).toContain('tool_call');
  });

  it('handles empty output without throwing', () => {
    const r = parseCrushOutput('');
    expect(r.text).toBe('');
    expect(r.rawText).toBe('');
  });
});
