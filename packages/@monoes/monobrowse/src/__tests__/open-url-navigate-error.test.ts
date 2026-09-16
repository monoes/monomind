/**
 * openUrl() (browser.ts) previously ignored Page.navigate's own response and
 * always fell through to waitForNetworkIdle, so a protocol-level navigation
 * failure (e.g. a refused connection) settled on the chrome-error://
 * chromewebdata/ page and `browse open` reported success with exit 0. CDP's
 * Page.navigate response carries errorText when navigation itself failed —
 * this checks that response before doing anything else.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CdpClient } from '../browser/cdp.js';
import { openUrl } from '../browser/browser.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Client stub that records calls and answers from a per-method table. */
function stubClient(table: Record<string, unknown> = {}): {
  client: CdpClient;
  calls: Array<{ method: string; params: unknown }>;
} {
  const calls: Array<{ method: string; params: unknown }> = [];
  const client = {
    send: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params });
      const entry = table[method];
      if (entry instanceof Error) throw entry;
      return entry ?? {};
    }),
    on: vi.fn(() => {
      throw new Error('waitForNetworkIdle should not run once Page.navigate reports errorText');
    }),
  } as unknown as CdpClient;
  return { client, calls };
}

describe('openUrl navigation-failure detection', () => {
  it('throws when Page.navigate reports errorText, without waiting for network idle', async () => {
    const { client, calls } = stubClient({
      'Page.navigate': { frameId: 'f1', errorText: 'net::ERR_CONNECTION_REFUSED' },
    });

    await expect(openUrl(client, 'sess-1', 'http://127.0.0.1:1/')).rejects.toThrow(
      /net::ERR_CONNECTION_REFUSED/,
    );
    expect(calls).toEqual([
      { method: 'Page.navigate', params: { url: 'http://127.0.0.1:1/' } },
    ]);
  });

  it('rejects the 2 MB URL guard before ever calling Page.navigate', async () => {
    const { client, calls } = stubClient();
    const hugeUrl = `http://x/${'a'.repeat(2_097_152)}`;

    await expect(openUrl(client, 'sess-1', hugeUrl)).rejects.toThrow(/2 MB/);
    expect(calls).toHaveLength(0);
  });
});
