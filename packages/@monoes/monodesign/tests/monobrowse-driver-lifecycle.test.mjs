import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import fs from 'node:fs';

import { launchMonobrowseBrowser } from '../cli/engine/engines/browser/drivers.mjs';

function listen(port, host) {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', error => resolve({ error }));
    server.listen({ port, host, ipv6Only: host === '::1' }, () => resolve({ server }));
  });
}

// Pick a forced port from a fixed band (9520-9899), NOT an OS-assigned
// ephemeral one. Binding :0 hands back a port out of the dynamic range, which the host
// is actively churning through for every outbound connection — so between
// releasing it here and Chrome binding it there, something else can take it.
// That window is widest on Windows, which is exactly where this test runs
// against the slowest teardown.
//
// A probe alone does not reserve the port: several copies of this suite on one
// machine (parallel worktrees/sessions) all probed 9520, all found it free, and
// all forced it. Every copy after the first then attached to the first copy's
// Chrome (monobrowse attaches to a Chrome already on the exact requested port)
// and closed it under its owner: "CDP connection closed". So the port is
// claimed, for the whole test, by holding a listener on [::1]:<port>. Chrome's
// DevTools server binds 127.0.0.1, so the claim does not get in its way, but a
// second copy cannot bind [::1]:<port> and moves on — the kernel arbitrates,
// and the claim dies with the process. (It also stops a Chrome that finds
// 127.0.0.1:<port> taken from silently falling back to [::1]:<port>.) Hosts
// without IPv6 loopback cannot claim this way; they keep the bare probe.
async function claimFreeForcedPort() {
  for (let port = 9520; port < 9900; port++) {
    const claim = await listen(port, '::1');
    if (claim.error?.code === 'EADDRINUSE') continue;
    const probe = await listen(port, '127.0.0.1');
    if (probe.server) {
      await new Promise(resolve => probe.server.close(resolve));
      return { port, release: () => new Promise(resolve => claim.server ? claim.server.close(resolve) : resolve()) };
    }
    if (claim.server) await new Promise(resolve => claim.server.close(resolve));
  }
  throw new Error('No free port in 9520-9899 to force the CDP endpoint onto');
}

let monobrowseAvailable = false;
try {
  const { CHROME_EXECUTABLES } = await import('@monoes/monobrowse');
  monobrowseAvailable = CHROME_EXECUTABLES.some(candidate => fs.existsSync(candidate));
} catch {
  // The test is optional on hosts without a locally installed Chromium browser.
}

// #314: this used to also skip under process.env.CI. The launch path had two
// promises that could be left pending forever once Chrome failed to start —
// spawn() had no 'error' listener (an uncaught EACCES/ENOENT crashed the
// process instead of rejecting), and closeBrowser()'s waitForProcessExit poll
// used an unref'd timer that never fires once nothing else pins the event
// loop (reproducible locally with a real Chrome: launch, close, and the close
// call hangs forever). Both are fixed in monobrowse's browser.ts, so this now
// runs on CI too.
const skipReason = !monobrowseAvailable ? 'no local Chrome/Chromium available' : false;

describe('monobrowse detection driver lifecycle', { skip: skipReason }, () => {
  it('releases a forced CDP port before the next browser launch', async () => {
    const previousPort = process.env.MONODESIGN_MONOBROWSE_PORT;
    const forced = await claimFreeForcedPort();
    process.env.MONODESIGN_MONOBROWSE_PORT = String(forced.port);
    let browser;
    try {
      browser = await launchMonobrowseBrowser();
      await browser.close();
      browser = await launchMonobrowseBrowser();
      assert.equal(browser.driverName, 'monobrowse');
    } finally {
      await browser?.close().catch(() => {});
      await forced.release();
      if (previousPort === undefined) delete process.env.MONODESIGN_MONOBROWSE_PORT;
      else process.env.MONODESIGN_MONOBROWSE_PORT = previousPort;
    }
  });

  // node --test runs test files in parallel, and every detection launch used
  // to pick its CDP port itself (random in 9520-9899, "free" per a probe made
  // before Chrome bound it). Two launches landing on the same port did not
  // fail: the loser's Chrome cannot bind 127.0.0.1:<port>, silently listens on
  // [::1]:<port> instead, and the launcher — polling 127.0.0.1 — accepted the
  // winner's Chrome as its own. When the winner closed it, the other launch
  // died with "CDP connection closed". Pin every pick to one port to force
  // that collision deterministically: each launch must still own its browser.
  it('concurrent launches never share a browser, even when their port picks collide', async () => {
    const previousPort = process.env.MONODESIGN_MONOBROWSE_PORT;
    delete process.env.MONODESIGN_MONOBROWSE_PORT;
    const random = Math.random;
    Math.random = () => 0.5;
    const launches = [];
    try {
      launches.push(launchMonobrowseBrowser(), launchMonobrowseBrowser());
      const [a, b] = await Promise.all(launches);
      await a.close();
      const page = await b.newPage();
      assert.equal(await page.evaluate(() => 1 + 1), 2);
      await page.close();
    } finally {
      Math.random = random;
      await Promise.allSettled(launches.map(p => p.then(browser => browser.close())));
      if (previousPort !== undefined) process.env.MONODESIGN_MONOBROWSE_PORT = previousPort;
    }
  });
});
