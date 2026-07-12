// packages/@monomind/cli/__tests__/orgrt/bus.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';

describe('OrgBus', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'orgbus-')); });

  it('appends events to bus.jsonl and notifies subscribers', async () => {
    const bus = new OrgBus('test-org', 'run-1', dir);
    const seen: string[] = [];
    bus.subscribe(e => seen.push(e.type));
    const ev = bus.emit({ type: 'message', from: 'boss', to: 'coder', msg: 'hi', subject: 'kick' });
    expect(ev.id).toMatch(/^run-1-/);
    expect(ev.org).toBe('test-org');
    await bus.flush();
    const lines = readFileSync(join(dir, 'bus.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(lines[0]).msg).toBe('hi');
    expect(seen).toEqual(['message']);
  });

  it('reads history back', async () => {
    const bus = new OrgBus('test-org', 'run-1', dir);
    bus.emit({ type: 'status', msg: 'started' });
    bus.emit({ type: 'asset', path: 'out/report.md' });
    await bus.flush();
    const hist = OrgBus.readHistory(dir);
    expect(hist).toHaveLength(2);
    expect(hist[1].path).toBe('out/report.md');
  });
});
