/**
 * Unit tests for the Grok Build CLI NDJSON parser (grok-runner).
 *
 * These fixtures are built from grok-runner.ts's documented (not
 * live-captured) event-shape assumptions — see the runner's header comment
 * for why the parser tolerates multiple plausible shapes.
 */
import { describe, it, expect } from 'vitest';
import { parseGrokEvents } from '../../src/orgrt/grok-runner.js';

describe('parseGrokEvents', () => {
  it('parses a codex-style item.completed/agent_message event', () => {
    const r = parseGrokEvents([
      '{"type":"thread.started","thread_id":"th_123"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Hello"}}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}',
    ]);
    expect(r.texts).toEqual(['Hello']);
    expect(r.sessionId).toBe('th_123');
    expect(r.inputTokens).toBe(10);
    expect(r.outputTokens).toBe(5);
  });

  it('parses a flat role:assistant shape with string content', () => {
    const r = parseGrokEvents(['{"role":"assistant","content":"hi there","session_id":"s1"}']);
    expect(r.texts).toEqual(['hi there']);
    expect(r.sessionId).toBe('s1');
  });

  it('parses a flat role:assistant shape with block-form content', () => {
    const r = parseGrokEvents([
      '{"role":"assistant","content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}',
    ]);
    expect(r.texts).toEqual(['a\nb']);
  });

  it('parses a flat type:assistant shape', () => {
    const r = parseGrokEvents(['{"type":"assistant","text":"flat text","sessionId":"s2"}']);
    expect(r.texts).toEqual(['flat text']);
    expect(r.sessionId).toBe('s2');
  });

  it('falls back to prompt_tokens/completion_tokens usage naming', () => {
    const r = parseGrokEvents(['{"type":"result","usage":{"prompt_tokens":3,"completion_tokens":7}}']);
    expect(r.inputTokens).toBe(3);
    expect(r.outputTokens).toBe(7);
  });

  it('captures an error message from a turn.failed event', () => {
    const r = parseGrokEvents(['{"type":"turn.failed","error":{"message":"boom"}}']);
    expect(r.error).toBe('boom');
  });

  it('ignores non-JSON and blank lines without throwing', () => {
    const r = parseGrokEvents(['', 'not json', '{"role":"assistant","content":"ok"}']);
    expect(r.texts).toEqual(['ok']);
  });

  it('tolerates malformed JSON lines', () => {
    const r = parseGrokEvents(['{"role":"assistant"', '{"role":"assistant","content":"good"}']);
    expect(r.texts).toEqual(['good']);
  });

  it('strips tool_call fences from yielded text but keeps raw text', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{"to":"boss","subject":"s","message":"m"}}\n```';
    const r = parseGrokEvents([JSON.stringify({ role: 'assistant', content: `Sending now.\n${fence}` })]);
    expect(r.texts).toEqual(['Sending now.']);
    expect(r.rawTexts[0]).toContain('tool_call');
  });

  it('returns no session id and zero usage when nothing carries one', () => {
    const r = parseGrokEvents(['{"role":"assistant","content":"x"}']);
    expect(r.sessionId).toBeUndefined();
    expect(r.inputTokens).toBe(0);
    expect(r.outputTokens).toBe(0);
  });
});
