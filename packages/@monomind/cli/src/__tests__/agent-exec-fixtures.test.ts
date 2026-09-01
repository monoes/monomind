/**
 * Golden-fixture contract tests — validate the NDJSON transcripts published
 * at doc/agent-exec-protocol/fixtures/ (protocol §8.4). These fixtures are
 * the caller-side contract: mono-agent's Phase 1 gate builds its client
 * tests against them, so every shape invariant asserted here is one callers
 * can rely on without running monomind.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// __tests__ → src → cli → @monomind → packages → repo root → doc/
const FIXTURES = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'doc',
  'agent-exec-protocol',
  'fixtures',
);

type Ev = Record<string, unknown>;

function load(name: string): Ev[] {
  return readFileSync(join(FIXTURES, `${name}.ndjson`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Ev);
}

const KNOWN_EVENT_TYPES = new Set([
  'start',
  'session',
  'assistant',
  'tool_call',
  'tool_result',
  'usage',
  'result',
  'error',
  'done',
]);

describe('agent exec golden fixtures (§8.4)', () => {
  const files = ['success', 'tool-loop', 'fatal-auth', 'timeout', 'cancel', 'bad-frame'];

  it('every fixture line is v:1 JSON with a known type', () => {
    for (const f of files) {
      for (const ev of load(f)) {
        expect(ev.v, `${f}`).toBe(1);
        expect(KNOWN_EVENT_TYPES.has(String(ev.type)), `${f}:${ev.type}`).toBe(true);
      }
    }
  });

  it('every fixture starts with start and ends with exactly one done', () => {
    for (const f of files) {
      const evs = load(f);
      expect(evs[0].type, f).toBe('start');
      expect(evs[evs.length - 1].type, f).toBe('done');
      expect(
        evs.filter((e) => e.type === 'done'),
        f,
      ).toHaveLength(1);
    }
  });

  it('done.exit_code matches the documented exit-code contract', () => {
    expect(load('success').at(-1)).toMatchObject({ exit_code: 0 });
    expect(load('tool-loop').at(-1)).toMatchObject({ exit_code: 0 });
    expect(load('bad-frame').at(-1)).toMatchObject({ exit_code: 0 });
    expect(load('fatal-auth').at(-1)).toMatchObject({ exit_code: 1 });
    expect(load('timeout').at(-1)).toMatchObject({ exit_code: 124 });
    expect(load('cancel').at(-1)).toMatchObject({ exit_code: 130 });
  });

  it('success: assistant → usage → result(stop_reason end_turn) ordering', () => {
    const types = load('success').map((e) => e.type);
    expect(types).toEqual([
      'start',
      'session',
      'assistant',
      'assistant',
      'usage',
      'result',
      'done',
    ]);
    const result = load('success').find((e) => e.type === 'result')!;
    expect(result).toMatchObject({ subtype: 'success', is_error: false, stop_reason: 'end_turn' });
  });

  it('tool-loop: tool_call echoed by tool_result with matching id', () => {
    const evs = load('tool-loop');
    const call = evs.find((e) => e.type === 'tool_call')!;
    const res = evs.find((e) => e.type === 'tool_result')!;
    expect(call).toMatchObject({ name: 'create_nodes', args: { count: 2 } });
    expect(res.id).toBe(call.id);
    expect(res).toMatchObject({ ok: true, result: { text: 'created 2 nodes' } });
  });

  it('fatal-auth: fatal error with login hint, no result event', () => {
    const evs = load('fatal-auth');
    expect(evs.find((e) => e.type === 'error')).toMatchObject({ code: 'auth', fatal: true });
    expect(String(evs.find((e) => e.type === 'error')!.message)).toContain('codex login');
    expect(evs.some((e) => e.type === 'result')).toBe(false);
  });

  it('timeout/cancel: non-fatal errors, no result event', () => {
    for (const f of ['timeout', 'cancel']) {
      const evs = load(f);
      expect(
        evs.find((e) => e.type === 'error'),
        f,
      ).toMatchObject({ fatal: false });
      expect(
        evs.some((e) => e.type === 'result'),
        f,
      ).toBe(false);
    }
  });

  it('bad-frame: bad-frame error is non-fatal and the turn still succeeds', () => {
    const evs = load('bad-frame');
    expect(evs.find((e) => e.type === 'error')).toMatchObject({ code: 'bad-frame', fatal: false });
    expect(evs.at(-1)).toMatchObject({ exit_code: 0 });
  });
});
