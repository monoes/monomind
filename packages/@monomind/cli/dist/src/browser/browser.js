import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CdpClient, fetchTargets, fetchNewTarget } from './cdp.js';
import { CHROME_EXECUTABLES } from './types.js';
import { enableConsoleCapture, setupConsoleCapture } from './console-log.js';
import { setupDialogAutoHandling } from './dialog.js';
const DEFAULT_PORT = 9222;
const LAUNCH_TIMEOUT = 10_000;
const POLL_INTERVAL = 200;
function findChrome(executablePath) {
    if (executablePath) {
        if (existsSync(executablePath))
            return executablePath;
        throw new Error(`Chrome executable not found: ${executablePath}`);
    }
    for (const candidate of CHROME_EXECUTABLES) {
        if (existsSync(candidate))
            return candidate;
    }
    // Try PATH
    try {
        const result = execSync('which google-chrome chromium-browser chromium 2>/dev/null', { encoding: 'utf8' }).trim();
        const first = result.split('\n')[0];
        if (first)
            return first;
    }
    catch {
        // ignore
    }
    throw new Error('Chrome/Chromium not found. Install Google Chrome or pass executablePath in BrowserConfig.');
}
export async function isPortOpen(port) {
    try {
        await fetchTargets(port);
        return true;
    }
    catch {
        return false;
    }
}
export async function launchBrowser(config = {}) {
    const rawPort = config.port ?? DEFAULT_PORT;
    // Validate port is in a safe range for localhost CDP debugging
    if (!Number.isInteger(rawPort) || rawPort < 1024 || rawPort > 65535) {
        throw new Error(`Invalid port: ${rawPort}. Must be an integer between 1024 and 65535.`);
    }
    const port = rawPort;
    if (await isPortOpen(port)) {
        return port;
    }
    const chromePath = findChrome(config.executablePath);
    const userDataDir = config.userDataDir ?? join(tmpdir(), `monomind-browser-${port}`);
    const defaultArgs = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-client-side-phishing-detection',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-hang-monitor',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--safebrowsing-disable-auto-update',
        '--password-store=basic',
        '--use-mock-keychain',
    ];
    if (config.headless !== false) {
        defaultArgs.push('--headless=new');
    }
    // Cap caller-supplied args to prevent memory exhaustion via huge argument arrays
    const callerArgs = (config.args ?? []).slice(0, 50);
    const args = [...defaultArgs, ...callerArgs];
    const child = spawn(chromePath, args, {
        detached: true,
        stdio: 'ignore',
    });
    child.unref();
    const deadline = Date.now() + LAUNCH_TIMEOUT;
    while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL);
        if (await isPortOpen(port))
            return port;
    }
    throw new Error(`Chrome failed to start on port ${port} within ${LAUNCH_TIMEOUT}ms`);
}
export async function enableSessionDomains(client, sessionId) {
    await Promise.all([
        client.send('Page.enable', {}, sessionId),
        client.send('Runtime.enable', {}, sessionId),
        client.send('Network.enable', {}, sessionId),
        client.send('DOM.enable', {}, sessionId),
        client.send('Accessibility.enable', {}, sessionId),
    ]);
    setupConsoleCapture(client, sessionId);
    await enableConsoleCapture(client, sessionId);
    setupDialogAutoHandling(client, sessionId);
}
export async function connectToTarget(port, targetId) {
    const targets = await fetchTargets(port);
    const pageTargets = targets.filter((t) => t.type === 'page');
    let target;
    if (targetId) {
        const found = pageTargets.find((t) => t.id === targetId);
        if (!found)
            throw new Error(`Target ${targetId} not found`);
        target = found;
    }
    else if (pageTargets.length > 0) {
        target = pageTargets[0];
    }
    else {
        target = await fetchNewTarget(port, 'about:blank');
    }
    const wsUrl = target.webSocketDebuggerUrl ?? `ws://127.0.0.1:${port}/devtools/page/${target.id}`;
    const client = new CdpClient();
    await client.connect(wsUrl);
    const { sessionId } = await client.send('Target.attachToTarget', {
        targetId: target.id,
        flatten: true,
    });
    await enableSessionDomains(client, sessionId);
    return { client, target, sessionId };
}
export async function openUrl(client, sessionId, url) {
    // Cap to 2 MB to prevent OOM in CDP message serializer (e.g. data: URI attacks)
    if (url.length > 2_097_152)
        throw new Error('URL exceeds 2 MB limit');
    await client.send('Page.navigate', { url }, sessionId);
    await waitForNetworkIdle(client, sessionId, 500, 30_000);
}
export async function waitForLoad(client, sessionId, condition = 'load', timeout = 30_000) {
    if (condition === 'load' || condition === 'domcontentloaded') {
        // Guard against race where the page loads before the listener is registered
        const readyExpr = condition === 'load' ? 'document.readyState === "complete"' : 'document.readyState !== "loading"';
        const readyCheck = await client.send('Runtime.evaluate', {
            expression: readyExpr, returnByValue: true,
        }, sessionId).catch(() => ({ result: { value: false } }));
        if (readyCheck.result?.value)
            return;
        const event = condition === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired';
        const [eventPromise, cancelOnce] = client.onceWithOff(event, sessionId);
        let timedOut = false;
        let timeoutHandle;
        const timeoutPromise = new Promise((resolve) => {
            timeoutHandle = setTimeout(() => { timedOut = true; resolve(); }, timeout);
        });
        try {
            await Promise.race([eventPromise, timeoutPromise]);
            if (timedOut)
                throw new Error(`Timeout waiting for ${condition}`);
        }
        finally {
            cancelOnce();
            clearTimeout(timeoutHandle);
        }
        return;
    }
    // networkidle: no network requests for 500ms
    await waitForNetworkIdle(client, sessionId, 500, timeout);
}
async function waitForNetworkIdle(client, sessionId, idleMs, timeout) {
    return new Promise((resolve, reject) => {
        let pending = 0;
        const inflight = new Set();
        let idleTimer = null;
        const killTimer = setTimeout(() => {
            cleanup();
            reject(new Error('Timeout waiting for networkidle'));
        }, timeout);
        const cleanup = () => {
            if (idleTimer) {
                clearTimeout(idleTimer);
                idleTimer = null;
            }
            clearTimeout(killTimer);
            offReq();
            offResp();
            offFail();
            offCache();
            offResp2();
        };
        const settle = () => {
            cleanup();
            resolve();
        };
        const check = () => {
            if (pending === 0) {
                if (idleTimer)
                    clearTimeout(idleTimer);
                idleTimer = setTimeout(settle, idleMs);
            }
            else {
                if (idleTimer) {
                    clearTimeout(idleTimer);
                    idleTimer = null;
                }
            }
        };
        const offReq = client.on('Network.requestWillBeSent', (params, sid) => {
            if (sid !== sessionId)
                return;
            const id = params.requestId;
            if (!inflight.has(id)) {
                inflight.add(id);
                pending++;
                check();
            }
        });
        const decrement = (params, sid) => {
            if (sid !== sessionId)
                return;
            const id = params.requestId;
            if (inflight.delete(id)) {
                pending = Math.max(0, pending - 1);
                check();
            }
        };
        const offResp = client.on('Network.loadingFinished', decrement);
        const offFail = client.on('Network.loadingFailed', decrement);
        const offCache = client.on('Network.requestServedFromCache', decrement);
        // Guard against requests that never fire loadingFinished/loadingFailed (e.g. data: URLs)
        // Skip 3xx redirect responses — the request continues under the same requestId
        const offResp2 = client.on('Network.responseReceived', (params, sid) => {
            const p = params;
            if (p.response.status >= 300 && p.response.status < 400)
                return;
            decrement(params, sid);
        });
        check();
    });
}
export async function getCurrentUrl(client, sessionId) {
    const result = await client.send('Runtime.evaluate', {
        expression: 'location.href',
        returnByValue: true,
    }, sessionId);
    return result.result?.value ?? '';
}
export async function getCurrentTitle(client, sessionId) {
    const result = await client.send('Runtime.evaluate', {
        expression: 'document.title',
        returnByValue: true,
    }, sessionId);
    return result.result?.value ?? '';
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
//# sourceMappingURL=browser.js.map