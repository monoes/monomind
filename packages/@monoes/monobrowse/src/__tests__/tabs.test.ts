/**
 * tabs.ts — target filtering and the CDP command sequences for
 * close/activate/frame-switch. Fake fetch + fake client; no browser.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { CdpClient } from '../browser/cdp.js';
import { listTabs, newTab, closeTab, activateTab, switchToFrame } from '../browser/tabs.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stubFetch(body: unknown, init: ResponseInit = { status: 200 }): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), init)));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** Client stub that records calls and answers from a per-method table. */
function stubClient(table: Record<string, unknown> = {}): {
  client: CdpClient;
  calls: Array<{ method: string; params: unknown; sid?: string }>;
} {
  const calls: Array<{ method: string; params: unknown; sid?: string }> = [];
  const client = {
    send: vi.fn(async (method: string, params: unknown, sid?: string) => {
      calls.push({ method, params, sid });
      const entry = table[method];
      if (entry instanceof Error) throw entry;
      return entry ?? {};
    }),
  } as unknown as CdpClient;
  return { client, calls };
}

describe('listTabs', () => {
  it('keeps only page targets, dropping service workers, iframes and extensions', async () => {
    stubFetch([
      { id: 'A', type: 'page', url: 'https://x.test' },
      { id: 'B', type: 'service_worker', url: 'https://x.test/sw.js' },
      { id: 'C', type: 'iframe', url: 'https://ads.test' },
      { id: 'D', type: 'background_page', url: 'chrome-extension://abc' },
      { id: 'E', type: 'page', url: 'about:blank' },
    ]);
    const tabs = await listTabs(9222);
    expect(tabs.map((t) => t.id)).toEqual(['A', 'E']);
  });

  it('returns [] when Chrome reports no targets at all', async () => {
    stubFetch([]);
    await expect(listTabs(9222)).resolves.toEqual([]);
  });

  it('propagates a failed /json/list', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response('', { status: 502, statusText: 'Bad Gateway' }))
    ) as unknown as typeof fetch;
    await expect(listTabs(9222)).rejects.toThrow('Failed to fetch targets: Bad Gateway');
  });
});

describe('newTab', () => {
  it('defaults to about:blank', async () => {
    const fn = stubFetch({ id: 'T1', type: 'page' });
    await newTab(9222);
    expect(fn.mock.calls[0]![0]).toBe(
      'http://127.0.0.1:9222/json/new?' + encodeURIComponent('about:blank')
    );
  });

  it('passes an explicit url through, encoded', async () => {
    const fn = stubFetch({ id: 'T1', type: 'page' });
    await newTab(9222, 'https://x.test/a b?q=1');
    expect(fn.mock.calls[0]![0]).toContain(encodeURIComponent('https://x.test/a b?q=1'));
  });
});

describe('closeTab', () => {
  it('sends Target.closeTarget for the given targetId', async () => {
    const { client, calls } = stubClient();
    await closeTab(client, 'S1', 'T9');
    expect(calls).toEqual([{ method: 'Target.closeTarget', params: { targetId: 'T9' }, sid: undefined }]);
  });
});

describe('activateTab', () => {
  it('detaches the old session, activates, then re-attaches flat and returns the new sessionId', async () => {
    const { client, calls } = stubClient({ 'Target.attachToTarget': { sessionId: 'S-NEW' } });
    await expect(activateTab(client, 'S-OLD', 'T9')).resolves.toBe('S-NEW');
    expect(calls.map((c) => c.method)).toEqual([
      'Target.detachFromTarget',
      'Target.activateTarget',
      'Target.attachToTarget',
    ]);
    expect(calls[0]!.params).toEqual({ sessionId: 'S-OLD' });
    expect(calls[2]!.params).toEqual({ targetId: 'T9', flatten: true });
  });

  it('skips the detach when there is no previous session', async () => {
    const { client, calls } = stubClient({ 'Target.attachToTarget': { sessionId: 'S-NEW' } });
    await activateTab(client, '', 'T9');
    expect(calls.map((c) => c.method)).toEqual(['Target.activateTarget', 'Target.attachToTarget']);
  });

  it('tolerates a detach failure on an already-dead session', async () => {
    const calls: string[] = [];
    const client = {
      send: vi.fn(async (method: string) => {
        calls.push(method);
        if (method === 'Target.detachFromTarget') throw new Error('No session with given id');
        if (method === 'Target.attachToTarget') return { sessionId: 'S-NEW' };
        return {};
      }),
    } as unknown as CdpClient;
    await expect(activateTab(client, 'S-STALE', 'T9')).resolves.toBe('S-NEW');
    expect(calls).toContain('Target.activateTarget');
  });
});

describe('switchToFrame', () => {
  const frameTreeWith = (url: string) => ({
    frameTree: { childFrames: [{ frame: { id: 'F1', url, securityOrigin: 'https://f.test' } }] },
  });

  it('returns null url when the selector does not resolve to an IFRAME', async () => {
    const { client, calls } = stubClient({
      'Runtime.evaluate': { result: { result: { value: null } } },
      'Page.getFrameTree': { frameTree: {} },
    });
    await expect(switchToFrame(client, 'S1', 'div.not-a-frame')).resolves.toEqual({ url: null, sessionId: null });
    // The selector is embedded as a JSON string literal, never interpolated raw.
    const expr = (calls[0]!.params as { expression: string }).expression;
    expect(expr).toContain('document.querySelector("div.not-a-frame")');
  });

  it('JSON-escapes a selector containing quotes rather than breaking the expression', async () => {
    const { client, calls } = stubClient({
      'Runtime.evaluate': { result: { result: { value: null } } },
      'Page.getFrameTree': { frameTree: {} },
    });
    await switchToFrame(client, 'S1', 'iframe[title="a\\"b"]');
    const expr = (calls[0]!.params as { expression: string }).expression;
    expect(expr).toContain(JSON.stringify('iframe[title="a\\"b"]'));
  });

  it('returns the frame src with null sessionId when no OOPIF target matches', async () => {
    const { client, calls } = stubClient({
      'Runtime.evaluate': { result: { result: { value: 'https://f.test/frame' } } },
      'Page.getFrameTree': frameTreeWith('https://f.test/frame'),
      'Target.getTargets': { targetInfos: [{ targetId: 'T1', type: 'page', url: 'https://x.test' }] },
    });
    await expect(switchToFrame(client, 'S1', 'iframe')).resolves.toEqual({ url: 'https://f.test/frame', sessionId: null });
    expect(calls.map((c) => c.method)).not.toContain('Target.attachToTarget');
  });

  it('attaches flat to a matching OOPIF target and returns its sessionId', async () => {
    const { client, calls } = stubClient({
      'Runtime.evaluate': { result: { result: { value: 'https://f.test/frame' } } },
      'Page.getFrameTree': frameTreeWith('https://f.test/frame'),
      'Target.getTargets': {
        targetInfos: [
          { targetId: 'T-PAGE', type: 'page', url: 'https://f.test/frame' },
          { targetId: 'T-OOPIF', type: 'iframe', url: 'https://f.test/frame' },
        ],
      },
      'Target.attachToTarget': { sessionId: 'S-FRAME' },
    });
    await expect(switchToFrame(client, 'S1', 'iframe')).resolves.toEqual({ url: 'https://f.test/frame', sessionId: 'S-FRAME' });
    const attach = calls.find((c) => c.method === 'Target.attachToTarget');
    expect(attach!.params).toEqual({ targetId: 'T-OOPIF', flatten: true });
  });

  it('returns the src with null sessionId when the frame tree has no match', async () => {
    const { client, calls } = stubClient({
      'Runtime.evaluate': { result: { result: { value: 'https://f.test/frame' } } },
      'Page.getFrameTree': frameTreeWith('https://other.test/elsewhere'),
    });
    await expect(switchToFrame(client, 'S1', 'iframe')).resolves.toEqual({ url: 'https://f.test/frame', sessionId: null });
    expect(calls.map((c) => c.method)).not.toContain('Target.getTargets');
  });
});
