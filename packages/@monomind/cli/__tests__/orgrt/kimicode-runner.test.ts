/**
 * Unit tests for the Kimi Code stream-json parser (kimicode-runner).
 *
 * These fixtures are the REAL event shapes captured from `kimi -p
 * --output-format stream-json` on kimi 0.29.2 (see the runner's header
 * comments). If a future kimi CLI changes the wire format, these tests fail
 * in CI instead of silently starving org agents at runtime.
 */
import { describe, it, expect } from 'vitest';
import { parseStreamJsonLines } from '../../src/orgrt/kimicode-runner.js';

// Captured verbatim from kimi 0.29.2: `kimi -p "Say the word OK and nothing
// else" --output-format stream-json`
const REAL_TURN = [
  '{"role":"assistant","content":"OK"}',
  '{"role":"meta","type":"session.resume_hint","session_id":"session_8168324e-d371-456e-b8a3-5457f710c941","command":"kimi -r session_8168324e-d371-456e-b8a3-5457f710c941","content":"To resume this session: kimi -r session_8168324e-d371-456e-b8a3-5457f710c941"}',
];

describe('parseStreamJsonLines', () => {
  it('parses the real 0.29.2 reply + resume_hint turn', () => {
    const r = parseStreamJsonLines(REAL_TURN);
    expect(r.texts).toEqual(['OK']);
    expect(r.sessionId).toBe('session_8168324e-d371-456e-b8a3-5457f710c941');
  });

  it('parses block-form assistant content', () => {
    const r = parseStreamJsonLines([
      '{"role":"assistant","content":[{"type":"text","text":"hello"},{"type":"text","text":"world"}]}',
    ]);
    expect(r.texts).toEqual(['hello\nworld']);
  });

  it('ignores tool-progress events', () => {
    const r = parseStreamJsonLines([
      '{"role":"tool","content":"Bash(ls)"}',
      '{"role":"assistant","content":"done"}',
    ]);
    expect(r.texts).toEqual(['done']);
  });

  it('ignores non-JSON lines and blank lines', () => {
    const r = parseStreamJsonLines(['', 'resuming session…', 'not json', '{"role":"assistant","content":"x"}']);
    expect(r.texts).toEqual(['x']);
  });

  it('tolerates malformed JSON lines', () => {
    const r = parseStreamJsonLines(['{"role":"assistant","content":"ok"', '{"role":"assistant","content":"good"}']);
    expect(r.texts).toEqual(['good']);
  });

  it('captures session id from camelCase variants too', () => {
    const r = parseStreamJsonLines(['{"role":"meta","sessionId":"abc"}']);
    expect(r.sessionId).toBe('abc');
  });

  it('returns no session id when no event carries one', () => {
    const r = parseStreamJsonLines(['{"role":"assistant","content":"x"}']);
    expect(r.sessionId).toBeUndefined();
  });

  it('strips tool_call fences from yielded text but keeps raw text', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{"to":"boss","subject":"s","message":"m"}}\n```';
    const r = parseStreamJsonLines([
      JSON.stringify({ role: 'assistant', content: `Sending now.\n${fence}` }),
    ]);
    expect(r.texts).toEqual(['Sending now.']);
    expect(r.rawTexts[0]).toContain('tool_call');
  });

  it('drops assistant messages whose entire content is a tool_call fence', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{}}\n```';
    const r = parseStreamJsonLines([JSON.stringify({ role: 'assistant', content: fence })]);
    expect(r.texts).toEqual([]);
    expect(r.rawTexts).toHaveLength(1);
  });
});
