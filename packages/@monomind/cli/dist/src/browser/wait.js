import { getCurrentUrl } from './browser.js';
import { evaluateJs } from './actions.js';
const DEFAULT_TIMEOUT = 30_000;
const POLL_INTERVAL = 250;
export async function waitFor(client, sessionId, options) {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const deadline = Date.now() + timeout;
    if (options.load) {
        await waitForLoad(client, sessionId, options.load, timeout);
        return;
    }
    if (options.url) {
        await waitForUrl(client, sessionId, options.url, deadline);
        return;
    }
    if (options.text) {
        await waitForText(client, sessionId, options.text, deadline);
        return;
    }
    if (options.selector) {
        await waitForSelector(client, sessionId, options.selector, deadline);
        return;
    }
    // Just wait for timeout
    await sleep(timeout);
}
async function waitForLoad(client, sessionId, condition, timeout) {
    if (condition === 'networkidle') {
        await waitForNetworkIdle(client, sessionId, 500, timeout);
        return;
    }
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
}
async function waitForNetworkIdle(client, sessionId, idleMs, timeout) {
    return new Promise((resolve, reject) => {
        let pending = 0;
        const inflight = new Set();
        let idleTimer = null;
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
        };
        const killTimer = setTimeout(() => {
            cleanup();
            reject(new Error('Timeout waiting for networkidle'));
        }, timeout);
        const settle = () => { cleanup(); resolve(); };
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
        check();
    });
}
async function waitForUrl(client, sessionId, pattern, deadline) {
    const regex = globToRegex(pattern);
    while (Date.now() < deadline) {
        const url = await getCurrentUrl(client, sessionId);
        if (regex.test(url))
            return;
        await sleep(POLL_INTERVAL);
    }
    throw new Error(`Timeout waiting for URL matching: ${pattern}`);
}
async function waitForText(client, sessionId, text, deadline) {
    while (Date.now() < deadline) {
        const bodyText = await evaluateJs(client, sessionId, 'document.body?.innerText ?? ""');
        if (bodyText.includes(text))
            return;
        await sleep(POLL_INTERVAL);
    }
    throw new Error(`Timeout waiting for text: ${text}`);
}
async function waitForSelector(client, sessionId, selector, deadline) {
    while (Date.now() < deadline) {
        const found = await evaluateJs(client, sessionId, `!!document.querySelector(${JSON.stringify(selector)})`);
        if (found)
            return;
        await sleep(POLL_INTERVAL);
    }
    throw new Error(`Timeout waiting for selector: ${selector}`);
}
function globToRegex(pattern) {
    const escaped = pattern
        .replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}$`);
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
//# sourceMappingURL=wait.js.map