/**
 * Contract tests for the org observe JSON layer — the `org-json-v1` capability
 * of the Agent Exec Protocol (doc/agent-exec-protocol.md §7).
 *
 * Builds a synthetic .monomind/orgs/ tree in a temp dir (runtime.json,
 * bus.jsonl, questions.json, gates.json) and invokes the exported actions
 * with --format json — asserting ONE parseable JSON object on stdout, the
 * envelope/singleton shapes, and the org events NDJSON tail (§7.3).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventsAction,
  gatesAction,
  logsAction,
  questionsAction,
  reportAction,
} from '../commands/org-observe.js';
import type { CommandContext, ParsedFlags } from '../types.js';

let root: string;
let captured: string[];

function captureStdout(): void {
  captured = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    captured.push(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
    return true;
  }) as typeof process.stdout.write);
}

function stdoutJson(): unknown[] {
  return captured
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function ctx(flags: Record<string, unknown> = {}, args: string[] = []): CommandContext {
  return {
    args,
    flags: { ...flags } as ParsedFlags,
    cwd: root,
    interactive: false,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'monomind-orgjson-'));
  captureStdout();
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const ORG = 'acme';
const RUN = 'run-20260825090000-ab12';

function writeOrg(): void {
  mkdirSync(join(root, '.monomind', 'orgs', ORG, RUN), { recursive: true });
  writeFileSync(
    join(root, '.monomind', 'orgs', `${ORG}.json`),
    JSON.stringify({
      name: ORG,
      goal: 'test goal',
      roles: [
        { id: 'boss', type: 'boss', reports_to: null },
        { id: 'coder', type: 'specialist', reports_to: 'boss' },
      ],
    }),
  );
  writeFileSync(
    join(root, '.monomind', 'orgs', ORG, 'runtime.json'),
    JSON.stringify({
      status: 'stopped',
      run: RUN,
      pid: 12345,
      updated: '2026-08-25T09:05:00Z',
      closedBy: 'org-complete',
    }),
  );
  const bus = [
    {
      id: `${RUN}-1`,
      ts: Date.parse('2026-08-25T09:00:01Z'),
      org: ORG,
      run: RUN,
      type: 'message',
      from: 'boss',
      to: 'coder',
      subject: 'task',
      msg: 'do it',
    },
    {
      id: `${RUN}-2`,
      ts: Date.parse('2026-08-25T09:01:00Z'),
      org: ORG,
      run: RUN,
      type: 'tool',
      from: 'coder',
      tool: 'Write',
      decision: 'allow',
      path: 'out/report.md',
    },
    {
      id: `${RUN}-3`,
      ts: Date.parse('2026-08-25T09:02:00Z'),
      org: ORG,
      run: RUN,
      type: 'chat',
      from: 'coder',
      msg: 'Report written.',
    },
    {
      id: `${RUN}-4`,
      ts: Date.parse('2026-08-25T09:03:00Z'),
      org: ORG,
      run: RUN,
      type: 'usage',
      from: 'coder',
      data: { tokens: 10, cost_usd: 0.01 },
    },
    {
      id: `${RUN}-5`,
      ts: Date.parse('2026-08-25T09:04:00Z'),
      org: ORG,
      run: RUN,
      type: 'status',
      from: 'boss',
      reason: 'org-complete',
      msg: 'done',
    },
  ];
  writeFileSync(
    join(root, '.monomind', 'orgs', ORG, RUN, 'bus.jsonl'),
    `${bus.map((e) => JSON.stringify(e)).join('\n')}\n`,
  );
  writeFileSync(
    join(root, '.monomind', 'orgs', ORG, 'questions.json'),
    JSON.stringify({
      questions: [
        {
          questionId: 'q1',
          role: 'coder',
          question: 'Which DB?',
          ts: Date.parse('2026-08-25T09:01:30Z'),
          answer: null,
          answeredAt: null,
        },
      ],
    }),
  );
  writeFileSync(
    join(root, '.monomind', 'orgs', ORG, 'gates.json'),
    JSON.stringify({
      gates: [
        {
          id: 'g1',
          name: 'deploy',
          description: 'Deploy to prod?',
          roleId: 'boss',
          status: 'pending',
          createdAt: Date.parse('2026-08-25T09:02:30Z'),
        },
      ],
    }),
  );
}

describe('org --json contracts (§7)', () => {
  beforeEach(writeOrg);

  it('org logs --format json: one envelope object, raw BusEvent items', async () => {
    const r = await logsAction(ctx({ format: 'json' }), ORG);
    expect(r.success).toBe(true);
    const objs = stdoutJson();
    expect(objs).toHaveLength(1);
    const payload = objs[0] as { v: number; org: string; run: string; items: unknown[] };
    expect(payload).toMatchObject({ v: 1, org: ORG, run: RUN });
    expect(payload.items).toHaveLength(5);
  });

  it('org logs --format json respects --tools-only', async () => {
    await logsAction(ctx({ format: 'json', 'tools-only': true }), ORG);
    const payload = stdoutJson()[0] as { items: Array<{ type: string }> };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].type).toBe('tool');
  });

  it('org logs rejects --follow in json mode with an actionable message', async () => {
    const r = await logsAction(ctx({ format: 'json', follow: true }), ORG);
    expect(r.success).toBe(false);
    expect(r.message).toContain('org events --ndjson');
  });

  it('org report --format json: bare run-summary object', async () => {
    const r = await reportAction(ctx({ format: 'json' }), ORG);
    expect(r.success).toBe(true);
    const objs = stdoutJson();
    expect(objs).toHaveLength(1);
    const payload = objs[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ v: 1, org: ORG, run: RUN });
    expect(typeof payload.events).toBe('number');
    expect(typeof payload.messages).toBe('number');
    expect(typeof payload.roles).toBe('object');
    expect(payload.roles).toBeTruthy();
  });

  it('org questions --format json: envelope with pending items', async () => {
    await questionsAction(ctx({ format: 'json' }), ORG);
    const payload = stdoutJson()[0] as {
      v: number;
      org: string;
      items: Array<{ questionId: string }>;
    };
    expect(payload).toMatchObject({ v: 1, org: ORG });
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].questionId).toBe('q1');
  });

  it('org gates --format json: envelope with pending gates', async () => {
    await gatesAction(ctx({ format: 'json' }), ORG);
    const payload = stdoutJson()[0] as {
      v: number;
      org: string;
      items: Array<{ id: string; status: string }>;
    };
    expect(payload).toMatchObject({ v: 1, org: ORG });
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({ id: 'g1', status: 'pending' });
  });
});

describe('org events --ndjson (§7.3)', () => {
  beforeEach(writeOrg);

  it('emits one BusEvent per line, NDJSON only', async () => {
    const r = await eventsAction(ctx({}, [ORG]), ORG);
    expect(r.success).toBe(true);
    const lines = captured.join('').split('\n').filter(Boolean);
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect((JSON.parse(lines[0]) as { type: string }).type).toBe('message');
    expect((JSON.parse(lines[4]) as { reason: string }).reason).toBe('org-complete');
  });

  it('--since <eventId> replays everything strictly after the cursor', async () => {
    await eventsAction(ctx({ since: `${RUN}-2` }, [ORG]), ORG);
    const lines = captured.join('').split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    expect((JSON.parse(lines[0]) as { id: string }).id).toBe(`${RUN}-3`);
  });

  it('--since <iso> filters by timestamp', async () => {
    await eventsAction(ctx({ since: '2026-08-25T09:01:30Z' }, [ORG]), ORG);
    const lines = captured.join('').split('\n').filter(Boolean);
    expect(lines).toHaveLength(3); // events at 09:02, 09:03, 09:04
  });

  it('unknown org run → failure, no stdout garbage', async () => {
    const r = await eventsAction(ctx({}, ['ghost']), 'ghost');
    expect(r.success).toBe(false);
    expect(captured.join('')).toBe('');
  });
});
