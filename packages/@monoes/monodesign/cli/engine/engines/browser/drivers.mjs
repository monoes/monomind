// Pattern adapted from impeccable (Apache-2.0) — rebranded for monomind
//
// Browser driver seam for URL detection.
//
// The detection engine (detect-url.mjs) and the visual-contrast fallback
// (engines/visual/screenshot-contrast.mjs) only need a tiny, puppeteer-shaped
// page surface:
//
//   browser: { driverName, newPage(): Promise<page>, close(): Promise<void> }
//   page:    {
//     setViewport({ width, height })
//     goto(url, { waitUntil, timeout })
//     evaluate(fnOrExpressionString, ...serializableArgs) -> serializable value
//     screenshot({ encoding: 'base64', clip?, captureBeyondViewport? }) -> base64 string
//     close()
//   }
//
// Two drivers implement it:
//   - monobrowse (preferred): @monoes/monobrowse, the monorepo's native CDP
//     client. Drives a locally installed Chrome/Edge/Chromium — no bundled
//     Chromium download needed. Supports the full surface including clip
//     screenshots (Page.captureScreenshot) and evaluate roundtrips
//     (Runtime.evaluate), so the visual-contrast pixel fallback runs under it.
//   - puppeteer (fallback): the original optionalDependency path, kept for
//     environments that have puppeteer + its downloaded Chrome but no system
//     browser. A raw puppeteer Page already satisfies the page surface, so the
//     puppeteer driver returns real puppeteer pages untouched.
//
// Selection: MONODESIGN_BROWSER_DRIVER=monobrowse|puppeteer forces one;
// otherwise monobrowse is tried first and puppeteer is the fallback.

const DRIVER_ENV = 'MONODESIGN_BROWSER_DRIVER';

// Ports we launch headless Chrome on for detection runs. Deliberately away
// from 9222 (the default `monomind browse` port): we must never attach to a
// browser we did not launch, because browser.close() issues Browser.close.
const MONOBROWSE_PORT_MIN = 9520;
const MONOBROWSE_PORT_RANGE = 380;

function serializeEvalArg(arg) {
  const json = JSON.stringify(arg);
  return json === undefined ? 'undefined' : json;
}

function mapWaitUntil(waitUntil) {
  if (waitUntil === 'domcontentloaded') return 'domcontentloaded';
  if (waitUntil === 'networkidle0' || waitUntil === 'networkidle2' || waitUntil === 'networkidle') return 'networkidle';
  return 'load';
}

function withTimeout(promise, ms, label) {
  let handle;
  const timeout = new Promise((_, reject) => {
    handle = setTimeout(() => reject(new Error(`Timeout waiting for ${label} after ${ms}ms`)), ms);
    handle.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(handle));
}

// ---------------------------------------------------------------------------
// monobrowse driver
// ---------------------------------------------------------------------------

function createMonobrowsePage(mb, client, sessionId, targetId, port) {
  return {
    async setViewport({ width, height }) {
      await mb.setViewport(client, sessionId, width, height);
    },
    async goto(url, { waitUntil = 'load', timeout = 30000 } = {}) {
      const condition = mapWaitUntil(waitUntil);
      if (condition === 'networkidle') {
        const nav = await client.send('Page.navigate', { url }, sessionId);
        if (nav?.errorText) throw new Error(`Navigation to ${url} failed: ${nav.errorText}`);
        await mb.waitForLoad(client, sessionId, 'networkidle', timeout);
        return;
      }
      // Register the lifecycle listener BEFORE navigating so a fast page load
      // cannot slip past it (waitForLoad's readyState pre-check would otherwise
      // race against the previous document's readyState).
      const event = condition === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired';
      const [eventPromise, cancel] = client.onceWithOff(event, sessionId);
      try {
        const nav = await client.send('Page.navigate', { url }, sessionId);
        if (nav?.errorText) throw new Error(`Navigation to ${url} failed: ${nav.errorText}`);
        await withTimeout(eventPromise, timeout, condition);
      } finally {
        cancel();
      }
    },
    async evaluate(fnOrExpression, ...args) {
      const expression = typeof fnOrExpression === 'function'
        ? `(${String(fnOrExpression)})(${args.map(serializeEvalArg).join(', ')})`
        : String(fnOrExpression);
      const result = await client.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }, sessionId);
      if (result?.exceptionDetails) {
        const details = result.exceptionDetails;
        throw new Error(details.exception?.description || details.exception?.value || details.text || 'Evaluation failed');
      }
      return result?.result?.value;
    },
    // Always returns a base64 string (the only mode the engine uses).
    async screenshot({ clip } = {}) {
      const params = { format: 'png' };
      if (clip) {
        params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 };
        params.captureBeyondViewport = true;
      }
      const result = await client.send('Page.captureScreenshot', params, sessionId);
      return result?.data;
    },
    async close() {
      // HTTP endpoint works regardless of which domains the ws connection has.
      try {
        await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(targetId)}`);
      } catch {
        // Tab may already be gone; browser close cleans up anything left.
      }
      client.close();
    },
  };
}

async function launchMonobrowseBrowser(options = {}) {
  const mb = await import('@monoes/monobrowse');
  const headless = options.headless ?? true;
  const launchArgs = options.launchArgs || (process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : []);

  const forcedPort = Number(process.env.MONODESIGN_MONOBROWSE_PORT);
  let port = null;
  if (Number.isInteger(forcedPort) && forcedPort > 0) {
    port = forcedPort;
  } else {
    // Pick a free-looking port; skip ports where a CDP endpoint already
    // listens so we never take over (and later Browser.close) someone
    // else's browser session.
    for (let attempt = 0; attempt < 5 && port === null; attempt++) {
      const candidate = MONOBROWSE_PORT_MIN + Math.floor(Math.random() * MONOBROWSE_PORT_RANGE);
      if (!(await mb.isPortOpen(candidate))) port = candidate;
    }
    if (port === null) throw new Error('Could not find a free CDP port for monobrowse');
  }

  const launchedPort = await mb.launchBrowser({ port, headless, args: launchArgs });
  // Control connection (to the initial about:blank tab) — used for lifecycle
  // commands; detection pages get their own dedicated connections.
  const control = await mb.connectToTarget(launchedPort);

  async function openPage() {
    const target = await mb.fetchNewTarget(launchedPort, 'about:blank');
    const wsUrl = target.webSocketDebuggerUrl || `ws://127.0.0.1:${launchedPort}/devtools/page/${target.id}`;
    const client = new mb.CdpClient();
    await client.connect(wsUrl);
    const { sessionId } = await client.send('Target.attachToTarget', { targetId: target.id, flatten: true });
    await Promise.all([
      client.send('Page.enable', {}, sessionId),
      client.send('Runtime.enable', {}, sessionId),
      client.send('Network.enable', {}, sessionId),
    ]);
    return createMonobrowsePage(mb, client, sessionId, target.id, launchedPort);
  }

  return {
    driverName: 'monobrowse',
    newPage: openPage,
    async close() {
      try {
        if (typeof mb.closeBrowser === 'function') {
          // Newer monobrowse: graceful Browser.close with PID-kill fallback.
          await mb.closeBrowser(control.client, launchedPort);
        } else {
          // Published 1.0.3 has no closeBrowser export — send the CDP
          // Browser.close command directly (best effort, short timeout).
          await withTimeout(control.client.send('Browser.close', {}), 3000, 'Browser.close').catch(() => {});
        }
      } finally {
        control.client.close();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// puppeteer driver (original behavior, kept as fallback)
// ---------------------------------------------------------------------------

function wrapPuppeteerBrowser(browser) {
  return {
    driverName: 'puppeteer',
    raw: browser,
    newPage: () => browser.newPage(),
    close: () => browser.close(),
  };
}

async function launchPuppeteerBrowser(options = {}) {
  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    throw new Error('puppeteer is required for URL scanning. Install: npm install puppeteer');
  }
  // CI runners (GitHub Actions Ubuntu) block unprivileged user namespaces, so
  // Chrome can't initialize its sandbox there. Disable the sandbox only when
  // running in CI; local users keep the default hardened launch.
  const launchArgs = options.launchArgs || (process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : []);
  const browser = await puppeteer.default.launch({
    headless: options.headless ?? true,
    args: launchArgs,
  });
  return wrapPuppeteerBrowser(browser);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Accepts either a driver browser handle or a raw puppeteer Browser. */
function normalizeBrowserHandle(browser) {
  if (!browser) return null;
  if (browser.driverName && typeof browser.newPage === 'function') return browser;
  if (typeof browser.newPage === 'function') return wrapPuppeteerBrowser(browser);
  throw new Error('Unsupported browser handle passed to detectUrl (expected a driver handle or puppeteer Browser)');
}

async function launchDetectionBrowser(options = {}) {
  const forced = (process.env[DRIVER_ENV] || '').trim().toLowerCase();
  if (forced && forced !== 'monobrowse' && forced !== 'puppeteer') {
    throw new Error(`Invalid ${DRIVER_ENV}=${forced} (expected "monobrowse" or "puppeteer")`);
  }
  const order = forced ? [forced] : ['monobrowse', 'puppeteer'];
  const errors = [];
  for (const name of order) {
    try {
      return name === 'monobrowse'
        ? await launchMonobrowseBrowser(options)
        : await launchPuppeteerBrowser(options);
    } catch (error) {
      errors.push(`${name}: ${error?.message || error}`);
    }
  }
  throw new Error(
    'A browser is required for URL scanning and no driver could start one ' +
    `(${errors.join(' | ')}). ` +
    'Install Google Chrome/Chromium/Edge for the native @monoes/monobrowse driver, ' +
    'or puppeteer is required for URL scanning. Install: npm install puppeteer'
  );
}

export {
  launchDetectionBrowser,
  launchMonobrowseBrowser,
  launchPuppeteerBrowser,
  normalizeBrowserHandle,
  wrapPuppeteerBrowser,
};
