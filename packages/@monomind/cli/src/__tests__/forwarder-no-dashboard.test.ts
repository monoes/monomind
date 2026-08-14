import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgBus } from '../orgrt/bus.js';
import { attachForwarder } from '../orgrt/forwarder.js';

class StubBus {
  listeners = new Set<(e: Record<string, unknown>) => void>();
  subscribe(fn: (e: Record<string, unknown>) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e: Record<string, unknown>) {
    for (const fn of this.listeners) fn({ ts: Date.now(), org: 'alpha', run: 'run-1', ...e });
  }
}

describe('forwarder no-dashboard handling (#136)', () => {
  let tmpDir: string;
  let controlJson: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forwarder-nodash-'));
    controlJson = path.join(tmpDir, '.monomind', 'control.json');
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('warns exactly once when control.json is missing, and never posts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ body: { cancel: () => {} } });
    vi.stubGlobal('fetch', fetchMock);
    const bus = new StubBus();
    const fwd = attachForwarder(bus as unknown as OrgBus, controlJson);
    bus.emit({ type: 'status', msg: 'org started' });
    bus.emit({ type: 'chat', from: 'ceo', msg: 'hello' });
    await fwd.settle();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/No live dashboard/);
    expect(fetchMock).not.toHaveBeenCalled();
    fwd.unsubscribe();
  });

  it('treats a dead recorded pid as no dashboard (warns once)', async () => {
    fs.mkdirSync(path.dirname(controlJson), { recursive: true });
    fs.writeFileSync(
      controlJson,
      JSON.stringify({ pid: 999999999, port: 4242, url: 'http://localhost:4242' }),
    );
    const bus = new StubBus();
    const fwd = attachForwarder(bus as unknown as OrgBus, controlJson);
    bus.emit({ type: 'status', msg: 'org started' });
    await fwd.settle();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    fwd.unsubscribe();
  });

  it('posts translated events and does not warn when the dashboard is live', async () => {
    fs.mkdirSync(path.dirname(controlJson), { recursive: true });
    fs.writeFileSync(
      controlJson,
      JSON.stringify({ pid: process.pid, port: 4242, url: 'http://localhost:4242' }),
    );
    const fetchMock = vi.fn().mockResolvedValue({ body: { cancel: () => {} } });
    vi.stubGlobal('fetch', fetchMock);
    const bus = new StubBus();
    const fwd = attachForwarder(bus as unknown as OrgBus, controlJson);
    bus.emit({ type: 'status', msg: 'org started', data: { goal: 'ship it' } });
    await fwd.settle();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1].body);
    expect(body.type).toBe('org:start');
    expect(body.org).toBe('alpha');
    fwd.unsubscribe();
  });
});
