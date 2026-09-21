import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import fs from 'node:fs';

import { launchMonobrowseBrowser } from '../cli/engine/engines/browser/drivers.mjs';

// Pick a forced port from the same band the driver uses for its own picks
// (MONOBROWSE_PORT_MIN..+RANGE in drivers.mjs), NOT an OS-assigned ephemeral
// one. Binding :0 hands back a port out of the dynamic range, which the host
// is actively churning through for every outbound connection — so between
// releasing it here and Chrome binding it there, something else can take it.
// That window is widest on Windows, which is exactly where this test runs
// against the slowest teardown.
async function findFreeForcedPort() {
  for (let port = 9520; port < 9900; port++) {
    const free = await new Promise(resolve => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (free) return port;
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
    process.env.MONODESIGN_MONOBROWSE_PORT = String(await findFreeForcedPort());
    let browser;
    try {
      browser = await launchMonobrowseBrowser();
      await browser.close();
      browser = await launchMonobrowseBrowser();
      assert.equal(browser.driverName, 'monobrowse');
    } finally {
      await browser?.close().catch(() => {});
      if (previousPort === undefined) delete process.env.MONODESIGN_MONOBROWSE_PORT;
      else process.env.MONODESIGN_MONOBROWSE_PORT = previousPort;
    }
  });
});
