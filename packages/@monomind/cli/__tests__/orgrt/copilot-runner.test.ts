/**
 * Unit tests for the GitHub Copilot CLI NDJSON parser (copilot-runner).
 */
import { describe, it, expect } from 'vitest';
import { parseCopilotEvents } from '../../src/orgrt/copilot-runner.js';

describe('parseCopilotEvents', () => {
  it('parses an assistant.message event with string content', () => {
    const r = parseCopilotEvents(['{"type":"assistant.message","content":"hi"}']);
    expect(r.texts).toEqual(['hi']);
  });

  it('parses an assistant.message event with block-form content', () => {
    const r = parseCopilotEvents([
      JSON.stringify({ type: 'assistant.message', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }),
    ]);
    expect(r.texts).toEqual(['a\nb']);
  });

  it('falls back to a nested message.text field', () => {
    const r = parseCopilotEvents([JSON.stringify({ kind: 'assistant', message: { text: 'nested' } })]);
    expect(r.texts).toEqual(['nested']);
  });

  it('falls back to role:assistant shape', () => {
    const r = parseCopilotEvents([JSON.stringify({ role: 'assistant', content: 'role-shaped' })]);
    expect(r.texts).toEqual(['role-shaped']);
  });

  it('ignores non-assistant events (tool/system) without throwing', () => {
    const r = parseCopilotEvents([
      JSON.stringify({ type: 'tool.execution', content: 'ls' }),
      JSON.stringify({ type: 'assistant.message', content: 'done' }),
    ]);
    expect(r.texts).toEqual(['done']);
  });

  it('ignores blank/non-JSON lines and tolerates malformed JSON', () => {
    const r = parseCopilotEvents(['', 'not json', '{"type":"assistant.message"', '{"type":"assistant.message","content":"ok"}']);
    expect(r.texts).toEqual(['ok']);
  });

  it('strips tool_call fences from yielded text but keeps raw text', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{}}\n```';
    const r = parseCopilotEvents([JSON.stringify({ type: 'assistant.message', content: `Working.\n${fence}` })]);
    expect(r.texts).toEqual(['Working.']);
    expect(r.rawTexts[0]).toContain('tool_call');
  });
});
