/**
 * Unit tests for the Pi coding agent's `--mode json` event parser
 * (pi-runner), built from pi-mono's published RPC event vocabulary
 * (agent_start / message_update / message_end / tool_execution_*).
 */
import { describe, it, expect } from 'vitest';
import { parsePiEvents } from '../../src/orgrt/pi-runner.js';

describe('parsePiEvents', () => {
  it('extracts text from a message_end event content array', () => {
    const r = parsePiEvents([
      JSON.stringify({ type: 'agent_start' }),
      JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: 'final answer' }] } }),
    ]);
    expect(r.texts).toEqual(['final answer']);
  });

  it('joins multiple text blocks and ignores toolCall blocks', () => {
    const r = parsePiEvents([
      JSON.stringify({
        type: 'message_end',
        message: { content: [{ type: 'text', text: 'a' }, { type: 'toolCall', id: 'c1', name: 'bash' }, { type: 'text', text: 'b' }] },
      }),
    ]);
    expect(r.texts).toEqual(['a\nb']);
  });

  it('captures usage from message.usage using input/output field names', () => {
    const r = parsePiEvents([
      JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: 'x' }], usage: { input: 100, output: 42 } } }),
    ]);
    expect(r.inputTokens).toBe(100);
    expect(r.outputTokens).toBe(42);
  });

  it('captures usage from a top-level usage field too', () => {
    const r = parsePiEvents([JSON.stringify({ type: 'message_update', usage: { input: 5, output: 1 } })]);
    expect(r.inputTokens).toBe(5);
    expect(r.outputTokens).toBe(1);
  });

  it('keeps the last usage value seen across multiple events', () => {
    const r = parsePiEvents([
      JSON.stringify({ type: 'message_update', usage: { input: 5, output: 1 } }),
      JSON.stringify({ type: 'message_end', message: { content: [], usage: { input: 20, output: 8 } } }),
    ]);
    expect(r.inputTokens).toBe(20);
    expect(r.outputTokens).toBe(8);
  });

  it('ignores tool_execution_* and system-ish events without throwing', () => {
    const r = parsePiEvents([
      JSON.stringify({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash' }),
      JSON.stringify({ type: 'tool_execution_end', toolCallId: 'c1', isError: false }),
      JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: 'ok' }] } }),
    ]);
    expect(r.texts).toEqual(['ok']);
  });

  it('ignores blank/non-JSON lines and tolerates malformed JSON', () => {
    const r = parsePiEvents(['', 'not json', '{"type":"message_end"', JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: 'good' }] } })]);
    expect(r.texts).toEqual(['good']);
  });

  it('strips tool_call fences from yielded text but keeps raw text', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{}}\n```';
    const r = parsePiEvents([
      JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: `Sending.\n${fence}` }] } }),
    ]);
    expect(r.texts).toEqual(['Sending.']);
    expect(r.rawTexts[0]).toContain('tool_call');
  });
});
