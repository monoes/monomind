/**
 * #666: monomind's own Chrome must not default to 9222, which mono-agent's
 * extension bridge owns. Covers the shared port constant and its env aliases,
 * and the bridge's fall-through from a dead relay endpoint to a live one.
 */
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { BridgeTransport } from '../browser/bridge.js';
import { CDP_PROBE_PORTS, DEFAULT_CDP_PORT, resolveCdpPort } from '../browser/cdp-port.js';

describe('resolveCdpPort', () => {
  it('defaults to 9422, not the bridge port', () => {
    expect(DEFAULT_CDP_PORT).toBe(9422);
    expect(resolveCdpPort({})).toBe(9422);
  });

  it('prefers MONOBROWSE_CDP_PORT over the deprecated aliases', () => {
    expect(
      resolveCdpPort({
        MONOBROWSE_CDP_PORT: '9500',
        MONOBROWSE_PORT: '9501',
        MONOMIND_CDP_PORT: '9502',
      }),
    ).toBe(9500);
    expect(resolveCdpPort({ MONOBROWSE_PORT: '9501', MONOMIND_CDP_PORT: '9502' })).toBe(9501);
    expect(resolveCdpPort({ MONOMIND_CDP_PORT: '9502' })).toBe(9502);
  });

  it('ignores a non-numeric value', () => {
    expect(resolveCdpPort({ MONOBROWSE_CDP_PORT: 'nope' })).toBe(9422);
  });

  it('probes 9422 first and keeps 9222 so a user-launched Chrome is still found', () => {
    expect(CDP_PROBE_PORTS).toEqual([9422, 9222, 9229]);
  });
});

describe('BridgeTransport endpoint fall-through', () => {
  let server: WebSocketServer | undefined;
  const saved = process.env.MONOAGENT_BRIDGE_URL;

  afterEach(async () => {
    if (saved === undefined) delete process.env.MONOAGENT_BRIDGE_URL;
    else process.env.MONOAGENT_BRIDGE_URL = saved;
    if (server) await new Promise((r) => server?.close(r));
    server = undefined;
  });

  it('moves past a refused endpoint to the next one', async () => {
    server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => server?.once('listening', r));
    const live = (server.address() as AddressInfo).port;
    server.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const env = JSON.parse(String(raw));
        ws.send(JSON.stringify({ id: env.id, success: true, data: { tabId: 7 } }));
      });
    });
    // Port 1 refuses connections; the live relay is second.
    process.env.MONOAGENT_BRIDGE_URL = `ws://127.0.0.1:1/monoagent/cdp, ws://127.0.0.1:${live}/monoagent/cdp`;

    const transport = new BridgeTransport({});
    await transport.open({ message: () => {}, close: () => {}, error: () => {} });
    expect(transport.attachedTabId).toBe(7);
    transport.close();
  });

  it('rejects when every endpoint is down', async () => {
    process.env.MONOAGENT_BRIDGE_URL = 'ws://127.0.0.1:1/monoagent/cdp';
    const transport = new BridgeTransport({});
    await expect(
      transport.open({ message: () => {}, close: () => {}, error: () => {} }),
    ).rejects.toThrow();
  });
});
