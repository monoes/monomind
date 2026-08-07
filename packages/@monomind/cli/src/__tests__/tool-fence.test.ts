/**
 * Tests for the tool-fence parser (orgrt/tool-fence.ts).
 *
 * Load-bearing behaviors:
 *   1. well-formed ```tool_call fences parse into ToolCall objects;
 *   2. trailing junk after the JSON object (observed live with kimi k3:
 *      an extra closing brace, `...}}}`) does NOT kill the call — only the
 *      first balanced JSON object is parsed;
 *   3. a truly unparseable fence is skipped but reported via onMalformed
 *      (before this, malformed fences were silently swallowed and the org
 *      bus never saw the message the model tried to send);
 *   4. multiple fences in one text all parse, in order.
 */

import { describe, it, expect, vi } from 'vitest';
import { parseToolCalls } from '../orgrt/tool-fence.js';

const fence = (body: string) => '```tool_call\n' + body + '\n```';

describe('parseToolCalls', () => {
  it('parses a well-formed fence', () => {
    const text = fence('{"name": "org_send", "arguments": {"to": "boss", "message": "hi"}}');
    expect(parseToolCalls([text])).toEqual([
      { name: 'org_send', arguments: { to: 'boss', message: 'hi' } },
    ]);
  });

  it('tolerates trailing junk after the JSON object (extra closing brace)', () => {
    // Exact shape observed from kimi k3 in the daily-roast live run.
    const text = fence('{"name": "org_send", "arguments": {"to": "editor-in-chief", "message": "a joke}"}}');
    const onMalformed = vi.fn();
    const calls = parseToolCalls([text], onMalformed);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('org_send');
    expect((calls[0].arguments as { to: string }).to).toBe('editor-in-chief');
    expect(onMalformed).not.toHaveBeenCalled();
  });

  it('skips a truly malformed fence and reports it via onMalformed', () => {
    const text = fence('{"name": "org_send", "arguments": {unterminated');
    const onMalformed = vi.fn();
    const calls = parseToolCalls([text], onMalformed);
    expect(calls).toEqual([]);
    expect(onMalformed).toHaveBeenCalledTimes(1);
    const [raw, err] = onMalformed.mock.calls[0] as [string, string];
    expect(raw).toContain('org_send');
    expect(typeof err).toBe('string');
    expect(err.length).toBeGreaterThan(0);
  });

  it('parses multiple fences in one text, in order', () => {
    const text =
      'some prose\n' +
      fence('{"name": "org_send", "arguments": {"to": "a", "message": "1"}}') +
      '\nbetween\n' +
      fence('{"name": "ask_human", "arguments": {"question": "q?"}}');
    const calls = parseToolCalls([text]);
    expect(calls.map((c) => c.name)).toEqual(['org_send', 'ask_human']);
    expect((calls[1].arguments as { question: string }).question).toBe('q?');
  });

  it('parses across multiple input texts', () => {
    const calls = parseToolCalls([
      fence('{"name": "a", "arguments": {}}'),
      fence('{"name": "b", "arguments": {}}'),
    ]);
    expect(calls.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('defaults missing arguments to an empty object', () => {
    expect(parseToolCalls([fence('{"name": "org_complete"}')])).toEqual([
      { name: 'org_complete', arguments: {} },
    ]);
  });

  it('skips a fence without a string name without reporting', () => {
    const onMalformed = vi.fn();
    expect(parseToolCalls([fence('{"arguments": {}}')], onMalformed)).toEqual([]);
    expect(onMalformed).not.toHaveBeenCalled();
  });

  it('returns no calls and reports nothing when there are no fences', () => {
    const onMalformed = vi.fn();
    expect(parseToolCalls(['plain assistant text'], onMalformed)).toEqual([]);
    expect(onMalformed).not.toHaveBeenCalled();
  });

  it('respects braces inside string literals when balancing', () => {
    const text = fence('{"name": "org_send", "arguments": {"message": "use { and }"}} trailing');
    const calls = parseToolCalls([text]);
    expect(calls).toHaveLength(1);
    expect((calls[0].arguments as { message: string }).message).toBe('use { and }');
  });
});
