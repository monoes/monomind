/**
 * C3 — Dashboard server binds to all network interfaces (unauthenticated)
 *
 * Before fix: `httpServer.listen(port)` with no host argument binds to
 * `::` / `0.0.0.0` on every Node version. The browse-workflow dashboard
 * has no auth on any endpoint, exposes POST /api/mastermind/event
 * (broadcasts arbitrary JSON to every WebSocket client), and the
 * org-runtime forwarder pushes file-content snapshots to it. Anyone on
 * the same LAN/VPN/Wi-Fi can read or inject.
 *
 * After fix: server binds to 127.0.0.1 only (mirrors src/ui/server.mjs:699
 * and mcp-server.ts:777).
 *
 * Verification: spawn the server on an ephemeral port and read back the
 * address() — must report 127.0.0.1, not :: or 0.0.0.0.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getDashboardServer } from '../../packages/@monomind/cli/src/browser/dashboard/server.js';

const spawned: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const s of spawned) {
    try { s.close(); } catch { /* best effort */ }
  }
  spawned.length = 0;
});

describe('C3 — browse dashboard binds to loopback only', () => {
  it('listens on 127.0.0.1 (not :: / 0.0.0.0)', async () => {
    // Use an ephemeral high port unlikely to collide with a real dashboard.
    const port = 50000 + Math.floor(Math.random() * 1000);
    const server = getDashboardServer(port);
    spawned.push(server);
    // Allow the socket to settle.
    await new Promise((r) => setTimeout(r, 50));
    const addr = (server as unknown as { address: () => { address: string; port: number } }).address?.();
    expect(addr, 'server.address() was missing — server shape changed').toBeDefined();
    const host = addr!.address;
    // Accept either IPv4 or IPv6 loopback. Bind to all interfaces reports
    // '::' / '0.0.0.0' / undefined.
    expect(['127.0.0.1', '::1']).toContain(host);
  });
});
