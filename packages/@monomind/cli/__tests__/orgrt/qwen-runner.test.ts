/**
 * Unit tests for the Qwen Code stream-json parser (qwen-runner), built from
 * Qwen Code's public "Headless Mode" documentation event schema.
 */
import { describe, it, expect } from 'vitest';
import { parseQwenEvents } from '../../src/orgrt/qwen-runner.js';

describe('parseQwenEvents', () => {
  it('parses an assistant message event with text content', () => {
    const r = parseQwenEvents([
      JSON.stringify({
        type: 'assistant',
        session_id: 'sess-1',
        role: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello from qwen' }] },
      }),
    ]);
    expect(r.texts).toEqual(['Hello from qwen']);
    expect(r.sessionId).toBe('sess-1');
  });

  it('joins multiple text blocks with newlines', () => {
    const r = parseQwenEvents([
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }),
    ]);
    expect(r.texts).toEqual(['a\nb']);
  });

  it('extracts usage tokens from a result event (flat, top-level — confirmed live, not nested under message.usage.tokens)', () => {
    const r = parseQwenEvents([
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 's', usage: { input_tokens: 12, output_tokens: 34 } }),
    ]);
    expect(r.inputTokens).toBe(12);
    expect(r.outputTokens).toBe(34);
  });

  it('captures an error from a result event with subtype error', () => {
    const r = parseQwenEvents([JSON.stringify({ type: 'result', subtype: 'error', error: { message: 'quota exceeded' } })]);
    expect(r.error).toBe('quota exceeded');
  });

  it('captures a string-shaped error too', () => {
    const r = parseQwenEvents([JSON.stringify({ type: 'result', subtype: 'error', error: 'boom' })]);
    expect(r.error).toBe('boom');
  });

  it('ignores system events (no text, no crash)', () => {
    const r = parseQwenEvents([JSON.stringify({ type: 'system', subtype: 'session_start', session_id: 'sid' })]);
    expect(r.texts).toEqual([]);
    expect(r.sessionId).toBe('sid');
  });

  it('ignores blank/non-JSON lines and tolerates malformed JSON', () => {
    const r = parseQwenEvents(['', 'not json', '{"type":"assistant","message":{"content":[{"type":"text","text":"x"}]}}']);
    expect(r.texts).toEqual(['x']);
  });

  it('strips tool_call fences from yielded text but keeps raw text', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{}}\n```';
    const r = parseQwenEvents([
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `Doing it.\n${fence}` }] } }),
    ]);
    expect(r.texts).toEqual(['Doing it.']);
    expect(r.rawTexts[0]).toContain('tool_call');
  });
});
