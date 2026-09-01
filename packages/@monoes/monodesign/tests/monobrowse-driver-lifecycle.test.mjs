import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import fs from 'node:fs';

import { launchMonobrowseBrowser } from '../cli/engine/engines/browser/drivers.mjs';

async function reserveThenReleasePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const { port } = address;
  await new Promise(resolve => server.close(resolve));
  return port;
}

let monobrowseAvailable = false;
try {
  const { CHROME_EXECUTABLES } = await import('@monoes/monobrowse');
  monobrowseAvailable = CHROME_EXECUTABLES.some(candidate => fs.existsSync(candidate));
} catch {
  // The test is optional on hosts without a locally installed Chromium browser.
}

describe('monobrowse detection driver lifecycle', { skip: monobrowseAvailable ? false : 'no local Chrome/Chromium available' }, () => {
  it('releases a forced CDP port before the next browser launch', async () => {
    const previousPort = process.env.MONODESIGN_MONOBROWSE_PORT;
    process.env.MONODESIGN_MONOBROWSE_PORT = String(await reserveThenReleasePort());
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
