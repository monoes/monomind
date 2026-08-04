// packages/@monomind/cli/__tests__/orgrt/scrollback.test.ts
import { describe, it, expect } from 'vitest';
import { ScrollbackBuffer } from '../../src/orgrt/daemon.js';
import { captureCheckpoint } from '../../src/orgrt/checkpoint.js';
import type { RunningOrg, AgentRuntime } from '../../src/orgrt/daemon.js';

describe('ScrollbackBuffer', () => {
  it('starts empty', () => {
    const buf = new ScrollbackBuffer();
    expect(buf.snapshot()).toEqual([]);
  });

  it('pushes and snapshots lines', () => {
    const buf = new ScrollbackBuffer();
    buf.push('hello');
    buf.push('world');
    expect(buf.snapshot()).toEqual(['hello', 'world']);
  });

  it('snapshot returns a copy, not the internal array', () => {
    const buf = new ScrollbackBuffer();
    buf.push('a');
    const snap = buf.snapshot();
    snap.push('b');
    expect(buf.snapshot()).toEqual(['a']);
  });

  it('caps at maxLines, dropping oldest', () => {
    const buf = new ScrollbackBuffer(3);
    buf.push('1');
    buf.push('2');
    buf.push('3');
    buf.push('4');
    buf.push('5');
    expect(buf.snapshot()).toEqual(['3', '4', '5']);
  });

  it('clear empties the buffer', () => {
    const buf = new ScrollbackBuffer();
    buf.push('x');
    buf.push('y');
    buf.clear();
    expect(buf.snapshot()).toEqual([]);
  });

  it('respects default 500-line cap', () => {
    const buf = new ScrollbackBuffer();
    for (let i = 0; i < 510; i++) buf.push(`line-${i}`);
    const snap = buf.snapshot();
    expect(snap).toHaveLength(500);
    expect(snap[0]).toBe('line-10');
    expect(snap[499]).toBe('line-509');
  });
});

describe('scrollback in checkpoint', () => {
  function makeFakeRuntime(scrollbackLines: string[]): AgentRuntime {
    const buf = new ScrollbackBuffer();
    for (const line of scrollbackLines) buf.push(line);
    return {
      mailbox: { serialize: () => ({ queue: [] }), isClosed: false } as any,
      policy: { usage: 0 } as any,
      done: Promise.resolve(),
      status: 'running',
      metrics: { tokens: 0, costUsd: 0 },
      scrollback: buf,
    } as AgentRuntime;
  }

  it('captureCheckpoint includes scrollback lines', () => {
    const agents = new Map<string, AgentRuntime>();
    agents.set('analyst', makeFakeRuntime(['thinking...', 'result: 42']));
    const org: RunningOrg = {
      def: { name: 'test', goal: '', roles: [], run_config: {} } as any,
      run: 'run-1',
      agents,
      status: 'running',
    } as any;
    const cp = captureCheckpoint(org);
    expect(cp.roleState['analyst'].scrollback).toEqual(['thinking...', 'result: 42']);
  });

  it('captureCheckpoint handles empty scrollback', () => {
    const agents = new Map<string, AgentRuntime>();
    agents.set('coder', makeFakeRuntime([]));
    const org: RunningOrg = {
      def: { name: 'test', goal: '', roles: [], run_config: {} } as any,
      run: 'run-2',
      agents,
      status: 'running',
    } as any;
    const cp = captureCheckpoint(org);
    expect(cp.roleState['coder'].scrollback).toEqual([]);
  });
});
