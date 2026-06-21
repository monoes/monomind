/**
 * Browse Command — Native browser automation via Chrome DevTools Protocol
 * Provides ref-based element model and token-efficient accessibility snapshots
 */
import { output } from '../output.js';
import { createWorkflowCommand } from './browse-workflow.js';
import { createActionCommand } from './browse-action.js';
import { createPlatformCommand } from './browse-platform.js';
// Runtime state (single session per CLI process)
let _client = null;
let _sessionId = '';
let _targetId = '';
let _port = 9222;
let _refs = new Map();
async function getBrowser() {
    return import('@monoes/monobrowse');
}
async function ensureConnected(port, targetId) {
    const browser = await getBrowser();
    if (!_client || !_client.isConnected()) {
        if (_client && _sessionId) {
            browser.teardownRouteInterception(_sessionId);
            browser.stopRequestCapture(_sessionId);
            browser.teardownDialogHandling(_sessionId);
            browser.teardownConsoleCapture(_sessionId);
            _client.close();
        }
        _port = await browser.launchBrowser({ port, headless: false });
        const conn = await browser.connectToTarget(_port, targetId);
        _client = conn.client;
        _sessionId = conn.sessionId;
        _targetId = conn.target.id;
        _refs = new Map();
    }
    return { client: _client, sessionId: _sessionId, targetId: _targetId };
}
function print(msg) {
    process.stdout.write(msg + '\n');
}
// ---------------------------------------------------------------------------
// Sub-commands
// ---------------------------------------------------------------------------
const openCommand = {
    name: 'open',
    description: 'Open a URL in the browser. Usage: monomind browse open <url>',
    options: [
        { name: 'port', short: 'p', type: 'number', description: 'CDP port', default: 9222 },
        { name: 'headless', type: 'boolean', description: 'Run in headless mode', default: false },
        { name: 'session', short: 's', type: 'string', description: 'Session name to restore' },
        { name: 'state', type: 'string', description: 'State file to load' },
    ],
    action: async (ctx) => {
        const url = ctx.args[0];
        if (!url)
            throw new Error('URL required. Usage: monomind browse open <url>');
        const port = ctx.flags.port ?? 9222;
        const browser = await getBrowser();
        if (_client) {
            const prevSid = _sessionId;
            const prevClient = _client;
            if (browser.getHarStatus(prevSid).recording) {
                try {
                    await browser.stopHarRecording(prevClient, prevSid);
                }
                catch { /* ignore */ }
            }
            if (browser.getTraceStatus(prevSid)) {
                try {
                    await browser.stopTrace(prevClient, prevSid);
                }
                catch { /* ignore */ }
            }
            if (browser.isProfilingActive(prevSid)) {
                try {
                    await browser.stopCpuProfile(prevClient, prevSid);
                }
                catch { /* ignore */ }
            }
            browser.teardownRouteInterception(prevSid);
            browser.stopRequestCapture(prevSid);
            browser.teardownDialogHandling(prevSid);
            browser.teardownConsoleCapture(prevSid);
            prevClient.close();
            _client = null;
            _sessionId = '';
            _targetId = '';
            _refs = new Map();
        }
        _port = await browser.launchBrowser({ port, headless: ctx.flags.headless });
        const conn = await browser.connectToTarget(_port);
        _client = conn.client;
        _sessionId = conn.sessionId;
        _targetId = conn.target.id;
        _refs = new Map();
        if (ctx.flags.state && ctx.flags.session) {
            output.printWarning('Both --state and --session provided; --state takes precedence');
        }
        if (ctx.flags.state) {
            await browser.loadStateFile(_client, _sessionId, ctx.flags.state);
        }
        else if (ctx.flags.session) {
            await browser.loadSession(_client, _sessionId, ctx.flags.session);
        }
        await browser.openUrl(_client, _sessionId, url);
        const currentUrl = await browser.getCurrentUrl(_client, _sessionId);
        const title = await browser.getCurrentTitle(_client, _sessionId);
        output.printSuccess(`Opened: ${title} (${currentUrl})`);
        return { success: true, data: { url: currentUrl, title } };
    },
};
const snapshotCommand = {
    name: 'snapshot',
    description: 'Capture accessibility snapshot with ref-based element handles (@e1, @e2, ...)',
    options: [
        { name: 'interactive', short: 'i', type: 'boolean', description: 'Interactive elements only (93% token reduction)', default: false },
        { name: 'compact', short: 'c', type: 'boolean', description: 'Compact output format', default: false },
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
        { name: 'depth', short: 'd', type: 'number', description: 'Max depth of AX tree to show' },
        { name: 'selector', short: 's', type: 'string', description: 'Scope snapshot to a CSS selector' },
        { name: 'save', type: 'string', description: 'Save snapshot text to file (baseline for --diff)' },
        { name: 'diff', type: 'string', description: 'Compare current snapshot against a saved baseline file' },
        { name: 'content-boundaries', type: 'boolean', description: 'Wrap output in sentinel markers to prevent page-content injection attacks', default: false },
        { name: 'max-output', type: 'number', description: 'Truncate output to N characters (prevents context window blowout on large pages)' },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const result = await browser.captureSnapshot(client, sessionId, {
            interactiveOnly: ctx.flags.interactive,
            compact: ctx.flags.compact,
            maxDepth: ctx.flags.depth,
            selector: ctx.flags.selector,
        });
        _refs = result.refs;
        const applyOutputLimits = (text) => {
            let out = text;
            const maxOutput = ctx.flags['max-output'];
            if (maxOutput && out.length > maxOutput) {
                out = out.slice(0, maxOutput) + `\n[... truncated at ${maxOutput} chars]`;
            }
            if (ctx.flags['content-boundaries']) {
                const nonce = Math.random().toString(36).slice(2, 10);
                out = `MONOMIND_PAGE_CONTENT nonce=${nonce} origin=${result.url}\n${out}\nEND_MONOMIND_PAGE_CONTENT nonce=${nonce}`;
            }
            return out;
        };
        // --save: write snapshot text to baseline file
        if (ctx.flags.save) {
            const { writeFile, mkdir } = await import('fs/promises');
            const { dirname } = await import('path');
            const savePath = ctx.flags.save;
            await mkdir(dirname(savePath), { recursive: true }).catch(() => { });
            await writeFile(savePath, result.text, 'utf8');
            output.printSuccess(`Snapshot saved to: ${savePath}`);
            return { success: true, data: { path: savePath } };
        }
        // --diff: compare against baseline file
        if (ctx.flags.diff) {
            const { readFile } = await import('fs/promises');
            const baselinePath = ctx.flags.diff;
            let baseline;
            try {
                baseline = await readFile(baselinePath, 'utf8');
            }
            catch {
                throw new Error(`Baseline not found: ${baselinePath}. Run snapshot --save first.`);
            }
            const currentLines = result.text.split('\n');
            const baselineLines = baseline.split('\n');
            const added = [], removed = [];
            const baseSet = new Set(baselineLines);
            const curSet = new Set(currentLines);
            for (const l of currentLines)
                if (!baseSet.has(l))
                    added.push(l);
            for (const l of baselineLines)
                if (!curSet.has(l))
                    removed.push(l);
            const changed = added.length > 0 || removed.length > 0;
            if (ctx.flags.json) {
                print(JSON.stringify({ changed, additions: added.length, removals: removed.length, added, removed }));
            }
            else {
                if (!changed) {
                    output.printSuccess('No snapshot changes detected');
                }
                else {
                    output.printWarning(`Snapshot changed: +${added.length} lines, -${removed.length} lines`);
                    for (const l of added)
                        print(`\x1b[32m+ ${l}\x1b[0m`);
                    for (const l of removed)
                        print(`\x1b[31m- ${l}\x1b[0m`);
                }
            }
            return { success: true, data: { changed, additions: added.length, removals: removed.length } };
        }
        if (ctx.flags.json) {
            const refsObj = Object.fromEntries([...result.refs.entries()].map(([k, v]) => [k, v]));
            print(JSON.stringify({ url: result.url, title: result.title, refs: refsObj, snapshot: result.text }));
        }
        else {
            print(`[${result.title}] ${result.url}\n`);
            print(applyOutputLimits(result.text));
        }
        return { success: true, data: result };
    },
};
const clickCommand = {
    name: 'click',
    description: 'Click an element by ref (@e1) or coordinates. Usage: monomind browse click @e1',
    options: [
        { name: 'right', type: 'boolean', description: 'Right-click', default: false },
        { name: 'double', type: 'boolean', description: 'Double-click', default: false },
        { name: 'x', type: 'number', description: 'X coordinate (for point click)' },
        { name: 'y', type: 'number', description: 'Y coordinate (for point click)' },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const refArg = ctx.args[0];
        if (!refArg && ctx.flags.x === undefined)
            throw new Error('Ref (@e1) or --x/--y required');
        if (ctx.flags.x !== undefined && ctx.flags.y !== undefined) {
            await browser.clickPoint(client, sessionId, ctx.flags.x, ctx.flags.y);
            output.printSuccess(`Clicked at (${ctx.flags.x}, ${ctx.flags.y})`);
            return { success: true };
        }
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
        await browser.clickElement(client, sessionId, ref, {
            button: ctx.flags.right ? 'right' : 'left',
            clickCount: ctx.flags.double ? 2 : 1,
        });
        output.printSuccess(`Clicked: ${ref.role} "${ref.name}"`);
        return { success: true };
    },
};
const fillCommand = {
    name: 'fill',
    description: 'Fill an input element. Usage: monomind browse fill @e1 "text value"',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const refArg = ctx.args[0];
        const value = ctx.args[1];
        if (!refArg || value === undefined)
            throw new Error('Usage: monomind browse fill @e1 "value"');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
        await browser.fillElement(client, sessionId, ref, value);
        output.printSuccess(`Filled: ${ref.role} "${ref.name}"`);
        return { success: true };
    },
};
const pressCommand = {
    name: 'press',
    description: 'Press a keyboard key. Usage: monomind browse press Enter',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const key = ctx.args[0];
        if (!key)
            throw new Error('Key required. E.g.: monomind browse press Enter');
        await browser.pressKey(client, sessionId, key);
        output.printSuccess(`Pressed: ${key}`);
        return { success: true };
    },
};
const waitCommand = {
    name: 'wait',
    description: 'Wait for a condition to be met before proceeding',
    options: [
        { name: 'url', type: 'string', description: 'Wait for URL matching glob pattern' },
        { name: 'text', type: 'string', description: 'Wait for text to appear in page' },
        { name: 'not-text', type: 'string', description: 'Wait for text to disappear from page' },
        { name: 'selector', type: 'string', description: 'Wait for CSS selector to appear' },
        { name: 'load', type: 'string', description: 'Wait for load event: load|networkidle|domcontentloaded' },
        { name: 'fn', type: 'string', description: 'Wait until JS expression returns truthy' },
        { name: 'ms', type: 'number', description: 'Wait N milliseconds' },
        { name: 'timeout', short: 't', type: 'number', description: 'Timeout in ms', default: 30000 },
        { name: 'download', type: 'string', description: 'Wait for a file download to complete and save to path (monitors Browser.downloadProgress events)' },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        if (ctx.flags.ms) {
            const rawMs = ctx.flags.ms;
            const waitMs = Number.isFinite(rawMs) ? Math.max(0, Math.min(rawMs, 60_000)) : 0; // cap at 60s
            await new Promise((r) => setTimeout(r, waitMs));
            output.printSuccess(`Waited ${ctx.flags.ms}ms`);
            return { success: true };
        }
        if (ctx.flags.fn) {
            const expr = ctx.flags.fn;
            const rawTimeout = ctx.flags.timeout ?? 30000;
            const timeout = Number.isFinite(rawTimeout) ? Math.max(100, Math.min(rawTimeout, 300_000)) : 30000; // cap at 5min
            const interval = 200;
            const deadline = Date.now() + timeout;
            while (Date.now() < deadline) {
                const result = await browser.evaluateJs(client, sessionId, expr);
                if (result) {
                    output.printSuccess('Wait function returned truthy');
                    return { success: true };
                }
                await new Promise((r) => setTimeout(r, interval));
            }
            throw new Error(`Timeout waiting for --fn: ${expr}`);
        }
        if (ctx.flags['not-text']) {
            const target = ctx.flags['not-text'];
            const timeout = ctx.flags.timeout ?? 30000;
            const interval = 200;
            const deadline = Date.now() + timeout;
            while (Date.now() < deadline) {
                const text = await browser.evaluateJs(client, sessionId, 'document.body?.innerText ?? ""');
                if (!text.includes(target)) {
                    output.printSuccess('Text disappeared');
                    return { success: true };
                }
                await new Promise((r) => setTimeout(r, interval));
            }
            throw new Error(`Timeout waiting for text to disappear: "${target}"`);
        }
        if (ctx.flags.download) {
            const savePath = ctx.flags.download;
            const { mkdir } = await import('fs/promises');
            const { dirname, join } = await import('path');
            const { tmpdir } = await import('os');
            const downloadDir = join(tmpdir(), `mm-dl-wait-${Date.now()}`);
            await mkdir(downloadDir, { recursive: true });
            await client.send('Browser.setDownloadBehavior', {
                behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true,
            }, undefined).catch(() => client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir }, sessionId).catch(() => { }));
            const MAX_DOWNLOAD_TIMEOUT = 5 * 60 * 1000; // I6: cap at 5 minutes
            const rawTimeout = Math.min(ctx.flags.timeout ?? 30000, MAX_DOWNLOAD_TIMEOUT);
            const finalPath = await new Promise((resolve, reject) => {
                const tid = setTimeout(() => reject(new Error('Download timed out')), rawTimeout);
                let guid = '';
                // C2: capture off() functions to avoid listener leaks
                const offBegin = client.on('Browser.downloadWillBegin', (params) => { guid = params.guid; });
                let offProgress;
                const cleanup = () => { clearTimeout(tid); offBegin?.(); offProgress?.(); };
                offProgress = client.on('Browser.downloadProgress', async (params) => {
                    if (params.guid === guid && params.state === 'completed') {
                        cleanup();
                        const { readdir, rename, rmdir } = await import('fs/promises');
                        const files = await readdir(downloadDir);
                        if (files.length > 0) {
                            const src = join(downloadDir, files[0]);
                            await mkdir(dirname(savePath), { recursive: true });
                            await rename(src, savePath);
                            await rmdir(downloadDir).catch(() => { }); // I1: cleanup temp dir
                            resolve(savePath);
                        }
                        else {
                            await rmdir(downloadDir).catch(() => { }); // I1: cleanup temp dir
                            reject(new Error('Download completed but no file found'));
                        }
                    }
                    else if (params.guid === guid && params.state === 'canceled') {
                        cleanup();
                        reject(new Error('Download was canceled'));
                    }
                });
            });
            output.printSuccess(`Download saved: ${finalPath}`);
            return { success: true, data: { path: finalPath } };
        }
        await browser.waitFor(client, sessionId, {
            url: ctx.flags.url,
            text: ctx.flags.text,
            selector: ctx.flags.selector,
            load: ctx.flags.load,
            timeout: ctx.flags.timeout,
        });
        output.printSuccess('Wait condition met');
        return { success: true };
    },
};
const screenshotCommand = {
    name: 'screenshot',
    description: 'Capture a screenshot. Usage: monomind browse screenshot [path] [--annotate] [--hide-scrollbars]',
    options: [
        { name: 'full', type: 'boolean', description: 'Full page screenshot', default: false },
        { name: 'format', type: 'string', description: 'Format: png|jpeg|webp', default: 'png' },
        { name: 'quality', type: 'number', description: 'Quality 0-100 for jpeg/webp', default: 80 },
        { name: 'annotate', type: 'boolean', description: 'Overlay numbered labels keyed to @eN refs from last snapshot (viewport-only; do not combine with --full)', default: false },
        { name: 'hide-scrollbars', type: 'boolean', description: 'Hide native scrollbars via CSS injection before capture', default: false },
        { name: 'json', type: 'boolean', description: 'Output JSON with path', default: false },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const hideScrollbars = ctx.flags['hide-scrollbars'];
        if (hideScrollbars) {
            await client.send('Runtime.evaluate', {
                expression: `(function(){var s=document.getElementById('__mm_noscroll__');if(s)return;var el=document.createElement('style');el.id='__mm_noscroll__';el.textContent='*::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important;-ms-overflow-style:none!important}';document.head.appendChild(el);})()`,
                returnByValue: false,
            }, sessionId).catch(() => { });
        }
        const annotate = ctx.flags.annotate;
        // eslint-disable-next-line prefer-const
        let result;
        try {
            result = await browser.captureScreenshot(client, sessionId, {
                path: ctx.args[0],
                fullPage: ctx.flags.full,
                format: ctx.flags.format,
                quality: ctx.flags.quality,
                annotate,
                refs: annotate ? _refs : undefined,
            });
        }
        finally {
            if (hideScrollbars) {
                await client.send('Runtime.evaluate', {
                    expression: `(function(){var s=document.getElementById('__mm_noscroll__');if(s)s.remove();})()`,
                    returnByValue: false,
                }, sessionId).catch(() => { });
            }
        }
        if (ctx.flags.json) {
            print(JSON.stringify({ data: { path: result.path } }));
        }
        else {
            output.printSuccess(`Screenshot saved: ${result.path}`);
        }
        return { success: true, data: result };
    },
};
const getCommand = {
    name: 'get',
    description: 'Get page info. Usage: monomind browse get url|title|text|html|value|attr|count|box|styles [@ref] [attrName]',
    options: [
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const what = ctx.args[0];
        if (!what)
            throw new Error('Usage: monomind browse get url|title|text|html|value|attr|count|box|styles');
        let value;
        switch (what) {
            case 'url':
                value = await browser.getCurrentUrl(client, sessionId);
                break;
            case 'title':
                value = await browser.getCurrentTitle(client, sessionId);
                break;
            case 'text': {
                const refArg = ctx.args[1];
                if (refArg) {
                    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
                    const ref = _refs.get(refKey);
                    if (!ref)
                        throw new Error(`Ref @${refKey} not found`);
                    const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
                    if (!objectId)
                        throw new Error('Element not in DOM');
                    const result = await client.send('Runtime.callFunctionOn', {
                        functionDeclaration: 'function() { return this.innerText || this.textContent || ""; }',
                        objectId,
                        returnByValue: true,
                    }, sessionId);
                    value = result.result?.value ?? '';
                }
                else {
                    value = (await browser.evaluateJs(client, sessionId, 'document.body?.innerText ?? ""'));
                }
                break;
            }
            case 'html':
                value = (await browser.evaluateJs(client, sessionId, 'document.documentElement.outerHTML'));
                break;
            case 'value': {
                const refArg = ctx.args[1];
                if (!refArg)
                    throw new Error('Usage: monomind browse get value @ref');
                const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
                const ref = _refs.get(refKey);
                if (!ref)
                    throw new Error(`Ref @${refKey} not found`);
                const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
                if (!objectId)
                    throw new Error('Element not in DOM');
                const r = await client.send('Runtime.callFunctionOn', {
                    functionDeclaration: 'function() { return this.value ?? null; }',
                    objectId, returnByValue: true,
                }, sessionId);
                value = r.result?.value ?? null;
                break;
            }
            case 'attr': {
                const refArg = ctx.args[1];
                const attrName = ctx.args[2];
                if (!refArg || !attrName)
                    throw new Error('Usage: monomind browse get attr @ref <attrName>');
                const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
                const ref = _refs.get(refKey);
                if (!ref)
                    throw new Error(`Ref @${refKey} not found`);
                const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
                if (!objectId)
                    throw new Error('Element not in DOM');
                const r = await client.send('Runtime.callFunctionOn', {
                    functionDeclaration: `function() { return this.getAttribute(${JSON.stringify(attrName)}); }`,
                    objectId, returnByValue: true,
                }, sessionId);
                value = r.result?.value ?? null;
                break;
            }
            case 'count': {
                const selector = ctx.args[1];
                if (!selector)
                    throw new Error('Usage: monomind browse get count <cssSelector>');
                value = await browser.evaluateJs(client, sessionId, `document.querySelectorAll(${JSON.stringify(selector)}).length`);
                break;
            }
            case 'box': {
                const refArg = ctx.args[1];
                if (!refArg)
                    throw new Error('Usage: monomind browse get box @ref');
                const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
                const ref = _refs.get(refKey);
                if (!ref)
                    throw new Error(`Ref @${refKey} not found`);
                value = await browser.getElementBox(client, sessionId, ref);
                break;
            }
            case 'styles': {
                const refArg = ctx.args[1];
                if (!refArg)
                    throw new Error('Usage: monomind browse get styles @ref');
                const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
                const ref = _refs.get(refKey);
                if (!ref)
                    throw new Error(`Ref @${refKey} not found`);
                const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
                if (!objectId)
                    throw new Error('Element not in DOM');
                const r = await client.send('Runtime.callFunctionOn', {
                    functionDeclaration: 'function() { const s = window.getComputedStyle(this); return JSON.stringify(Object.fromEntries([...s].map(k => [k, s.getPropertyValue(k)]))); }',
                    objectId, returnByValue: true,
                }, sessionId);
                try {
                    value = JSON.parse(r.result?.value ?? '{}');
                }
                catch {
                    value = {};
                }
                break;
            }
            default:
                throw new Error(`Unknown: ${what}. Use: url|title|text|html|value|attr|count|box|styles`);
        }
        if (ctx.flags.json) {
            print(JSON.stringify({ data: { [what]: value } }));
        }
        else {
            print(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? ''));
        }
        return { success: true, data: { [what]: value } };
    },
};
const scrollCommand = {
    name: 'scroll',
    description: 'Scroll the page. Usage: monomind browse scroll up|down|left|right [amount] [--selector ".sidebar"]',
    options: [
        { name: 'amount', short: 'a', type: 'number', description: 'Pixels to scroll', default: 300 },
        { name: 'ref', type: 'string', description: 'Element ref to scroll within' },
        { name: 'selector', short: 's', type: 'string', description: 'CSS selector of element to scroll within' },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const direction = ctx.args[0];
        if (!direction)
            throw new Error('Usage: monomind browse scroll up|down|left|right [amount]');
        // Support positional amount: scroll down 300
        const positionalAmount = ctx.args[1] !== undefined ? parseInt(ctx.args[1], 10) : undefined;
        const amount = (positionalAmount && Number.isFinite(positionalAmount)) ? positionalAmount : ctx.flags.amount ?? 300;
        if (ctx.flags.selector) {
            const sel = ctx.flags.selector;
            const dx = direction === 'right' ? amount : direction === 'left' ? -amount : 0;
            const dy = direction === 'down' ? amount : direction === 'up' ? -amount : 0;
            const posJson = await browser.evaluateJs(client, sessionId, `(function(){var el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;var r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`);
            if (!posJson)
                throw new Error(`Selector not found: ${sel}`);
            const pos = JSON.parse(posJson);
            await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pos.x, y: pos.y, deltaX: dx, deltaY: dy }, sessionId);
            output.printSuccess(`Scrolled ${direction} in ${sel}`);
            return { success: true };
        }
        let ref;
        if (ctx.flags.ref) {
            const refKey = ctx.flags.ref.startsWith('@')
                ? ctx.flags.ref.slice(1)
                : ctx.flags.ref;
            ref = _refs.get(refKey);
        }
        await browser.scrollElement(client, sessionId, direction, amount, ref);
        output.printSuccess(`Scrolled ${direction}`);
        return { success: true };
    },
};
const navigateCommand = {
    name: 'navigate',
    description: 'Navigate browser history. Usage: monomind browse navigate back|forward|reload',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const direction = ctx.args[0];
        if (!direction)
            throw new Error('Usage: monomind browse navigate back|forward|reload');
        if (direction === 'back' || direction === 'forward') {
            // Pre-register frame-start listener BEFORE JS navigation to avoid the race
            // where history.back/forward() returns before the browser issues any requests
            let offFrameStarted = () => { };
            const frameStartedPromise = new Promise((resolve) => {
                offFrameStarted = client.on('Page.frameStartedLoading', (_params, sid) => {
                    if (sid === sessionId) {
                        const off = offFrameStarted;
                        offFrameStarted = () => { };
                        off();
                        resolve();
                    }
                });
            });
            try {
                await client.send('Runtime.evaluate', {
                    expression: direction === 'back' ? 'history.back()' : 'history.forward()',
                }, sessionId);
                let fallbackHandle;
                const fallbackPromise = new Promise((r) => { fallbackHandle = setTimeout(r, 2000); });
                await Promise.race([frameStartedPromise, fallbackPromise]);
                if (fallbackHandle !== undefined)
                    clearTimeout(fallbackHandle);
            }
            finally {
                offFrameStarted();
            }
            await browser.waitForLoad(client, sessionId, 'networkidle');
        }
        else if (direction === 'reload') {
            await client.send('Page.reload', {}, sessionId);
            await browser.waitForLoad(client, sessionId, 'load');
        }
        else {
            throw new Error(`Unknown direction: ${direction}. Use: back|forward|reload`);
        }
        output.printSuccess(`Navigated: ${direction}`);
        return { success: true };
    },
};
const setCommand = {
    name: 'set',
    description: 'Configure browser settings. Usage: monomind browse set viewport|device|geo|offline|media|credentials|useragent <args>',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const setting = ctx.args[0];
        if (!setting)
            throw new Error('Usage: monomind browse set viewport|device|geo|offline|media|credentials|useragent <args>');
        switch (setting) {
            case 'viewport': {
                const width = parseInt(ctx.args[1], 10);
                const height = parseInt(ctx.args[2], 10);
                const dpr = parseFloat(ctx.args[3]) || undefined;
                if (isNaN(width) || isNaN(height))
                    throw new Error('Usage: set viewport <width> <height> [dpr]');
                await client.send('Emulation.setDeviceMetricsOverride', {
                    width, height, deviceScaleFactor: dpr ?? 1, mobile: false,
                }, sessionId);
                output.printSuccess(`Viewport set to ${width}x${height}${dpr ? ` @${dpr}x` : ''}`);
                break;
            }
            case 'device': {
                const deviceName = ctx.args[1];
                if (!deviceName)
                    throw new Error(`Usage: set device <name>. Available: ${browser.listDevices().join(', ')}`);
                await browser.emulateDevice(client, sessionId, deviceName);
                output.printSuccess(`Emulating device: ${deviceName}`);
                break;
            }
            case 'geo': {
                const lat = parseFloat(ctx.args[1]);
                const lon = parseFloat(ctx.args[2]);
                const acc = parseFloat(ctx.args[3]) || 100;
                if (isNaN(lat) || isNaN(lon))
                    throw new Error('Usage: set geo <latitude> <longitude> [accuracy]');
                await browser.setGeolocation(client, sessionId, lat, lon, acc);
                output.printSuccess(`Geolocation set: ${lat}, ${lon}`);
                break;
            }
            case 'offline': {
                const offlineArg = ctx.args[1];
                if (offlineArg === undefined)
                    throw new Error('Usage: set offline <true|false>');
                const enabled = offlineArg === 'true';
                await browser.setOfflineMode(client, sessionId, enabled);
                output.printSuccess(`Offline mode: ${enabled}`);
                break;
            }
            case 'media': {
                const scheme = ctx.args[1];
                if (!scheme)
                    throw new Error('Usage: set media dark|light|no-preference');
                await browser.setColorScheme(client, sessionId, scheme);
                output.printSuccess(`Color scheme: ${scheme}`);
                break;
            }
            case 'credentials': {
                const username = ctx.args[1];
                const password = ctx.args[2];
                if (!username || !password)
                    throw new Error('Usage: set credentials <username> <password>');
                await browser.setBasicAuth(client, sessionId, username, password);
                output.printSuccess('Basic auth credentials set');
                break;
            }
            case 'useragent': {
                const ua = ctx.args[1];
                if (!ua)
                    throw new Error('Usage: set useragent "<user-agent-string>"');
                await browser.setUserAgent(client, sessionId, ua);
                output.printSuccess('User agent set');
                break;
            }
            default:
                throw new Error(`Unknown setting: ${setting}. Use: viewport|device|geo|offline|media|credentials|useragent`);
        }
        return { success: true };
    },
};
const stateCommand = {
    name: 'state',
    description: 'Manage browser session state. Usage: monomind browse state save|load|list|rename|clean [name]',
    options: [
        { name: 'older-than', type: 'number', description: 'For state clean: remove sessions older than N days' },
    ],
    action: async (ctx) => {
        const browser = await getBrowser();
        const action = ctx.args[0];
        if (!action)
            throw new Error('Usage: monomind browse state save|load|list [name]');
        switch (action) {
            case 'list': {
                const sessions = await browser.listSessions();
                if (sessions.length === 0) {
                    output.printInfo('No saved sessions');
                }
                else {
                    output.printInfo('Saved sessions:');
                    for (const s of sessions)
                        print(`  ${s}`);
                }
                return { success: true, data: { sessions } };
            }
            case 'save': {
                const { client, sessionId } = await ensureConnected(_port);
                const target = ctx.args[1];
                if (!target)
                    throw new Error('Usage: monomind browse state save <name-or-file>');
                const url = await browser.getCurrentUrl(client, sessionId);
                const title = await browser.getCurrentTitle(client, sessionId);
                if (target.endsWith('.json')) {
                    await browser.saveStateFile(client, sessionId, _targetId, target, url, title);
                    output.printSuccess(`State saved to ${target}`);
                }
                else {
                    const path = await browser.saveSession(client, sessionId, _targetId, target, url, title);
                    output.printSuccess(`Session "${target}" saved to ${path}`);
                }
                return { success: true };
            }
            case 'load': {
                const { client, sessionId } = await ensureConnected(_port);
                const target = ctx.args[1];
                if (!target)
                    throw new Error('Usage: monomind browse state load <name-or-file>');
                if (target.endsWith('.json')) {
                    await browser.loadStateFile(client, sessionId, target);
                }
                else {
                    await browser.loadSession(client, sessionId, target);
                }
                output.printSuccess(`State loaded from ${target}`);
                return { success: true };
            }
            case 'show': {
                const { client: c, sessionId: sid } = await ensureConnected(_port);
                const url = await browser.getCurrentUrl(c, sid);
                const title = await browser.getCurrentTitle(c, sid);
                const cookies = await browser.getCookies(c, sid);
                const ls = await browser.getAllLocalStorage(c, sid);
                const info = { url, title, cookies: cookies.length, localStorage: Object.keys(ls).length, refs: _refs.size };
                print(JSON.stringify(info, null, 2));
                return { success: true, data: info };
            }
            case 'clear': {
                const { client: c, sessionId: sid } = await ensureConnected(_port);
                await browser.clearCookies(c, sid);
                await browser.clearLocalStorage(c, sid);
                await browser.clearSessionStorage(c, sid);
                _refs = new Map();
                output.printSuccess('Browser state cleared (cookies, localStorage, sessionStorage, refs)');
                return { success: true };
            }
            case 'rename': {
                const oldName = ctx.args[1];
                const newName = ctx.args[2];
                if (!oldName || !newName)
                    throw new Error('Usage: monomind browse state rename <old-name> <new-name>');
                const sessions = await browser.listSessions();
                if (!sessions.includes(oldName))
                    throw new Error(`Session not found: ${oldName}`);
                // W1: validate newName to prevent path traversal
                const { basename: basenameFn } = await import('path');
                const safeName = basenameFn(newName);
                if (safeName !== newName || safeName.startsWith('.') || safeName.includes('/')) {
                    throw new Error('Invalid session name — must not contain path separators or start with "."');
                }
                const { unlink: unlinkRename, readFile, writeFile, mkdir: mkdirRename } = await import('fs/promises');
                const { join: joinR } = await import('path');
                const { homedir } = await import('os');
                const sessionDir = joinR(homedir(), '.monomind', 'browser-sessions');
                const oldPath = joinR(sessionDir, `${oldName}.json`);
                const newPath = joinR(sessionDir, `${newName}.json`);
                const data = JSON.parse(await readFile(oldPath, 'utf8'));
                data.name = newName;
                await mkdirRename(sessionDir, { recursive: true });
                await writeFile(newPath, JSON.stringify(data, null, 2), 'utf8');
                await unlinkRename(oldPath).catch(() => { }); // C1: delete old file (not rename to /dev/null)
                output.printSuccess(`Session renamed: ${oldName} → ${newName}`);
                return { success: true };
            }
            case 'clean': {
                const days = ctx.flags['older-than'] ?? 7;
                const { unlink, stat } = await import('fs/promises');
                const { join: joinC } = await import('path');
                const { homedir: homedirC } = await import('os');
                const sessionDir = joinC(homedirC(), '.monomind', 'browser-sessions');
                const sessions = await browser.listSessions();
                const cutoff = Date.now() - days * 86400 * 1000;
                let removed = 0;
                for (const name of sessions) {
                    const p = joinC(sessionDir, `${name}.json`);
                    const s = await stat(p).catch(() => null);
                    if (s && s.mtimeMs < cutoff) {
                        await unlink(p).catch(() => { });
                        removed++;
                    }
                }
                output.printSuccess(`Cleaned ${removed} session(s) older than ${days} days`);
                return { success: true, data: { removed } };
            }
            default:
                throw new Error(`Unknown action: ${action}. Use: save|load|list|show|clear|rename|clean`);
        }
    },
};
const networkCommand = {
    name: 'network',
    description: 'Network interception and cookie management',
    options: [
        { name: 'pattern', type: 'string', description: 'URL pattern for route (glob)' },
        { name: 'abort', type: 'boolean', description: 'Abort matching requests' },
        { name: 'fulfill', type: 'string', description: 'JSON response body' },
        { name: 'status', type: 'number', description: 'HTTP status for fulfill', default: 200 },
        { name: 'headers', type: 'string', description: 'JSON headers object' },
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
        { name: 'filter', type: 'string', description: 'Filter requests by URL substring (for network requests)' },
        { name: 'method', type: 'string', description: 'Filter by HTTP method, e.g. GET, POST (for network requests)' },
        { name: 'status-code', type: 'number', description: 'Filter by HTTP status code (for network requests)' },
        { name: 'type', type: 'string', description: 'Filter by resource type: xhr|fetch|document|script|stylesheet|image (for network requests)' },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const action = ctx.args[0];
        if (!action)
            throw new Error('Usage: monomind browse network route|unroute|cookies|headers|requests');
        switch (action) {
            case 'route': {
                const pattern = ctx.flags.pattern;
                if (!pattern)
                    throw new Error('--pattern required for network route');
                const routes = [{
                        pattern,
                        action: ctx.flags.abort ? 'abort' : ctx.flags.fulfill ? 'fulfill' : 'continue',
                        response: ctx.flags.fulfill ? {
                            status: ctx.flags.status,
                            body: ctx.flags.fulfill,
                            headers: ctx.flags.headers ? JSON.parse(ctx.flags.headers) : {},
                        } : undefined,
                    }];
                await browser.setupRoutes(client, sessionId, routes);
                output.printSuccess(`Network route set: ${pattern}`);
                break;
            }
            case 'unroute':
                await browser.disableInterception(client, sessionId);
                output.printSuccess('Network interception disabled');
                break;
            case 'cookies': {
                const cookies = await browser.getCookies(client, sessionId);
                print(JSON.stringify(cookies, null, 2));
                return { success: true, data: { cookies } };
            }
            case 'headers': {
                const headers = ctx.flags.headers;
                if (!headers)
                    throw new Error('--headers required (JSON string)');
                await browser.setExtraHeaders(client, sessionId, JSON.parse(headers));
                output.printSuccess('Extra headers set');
                break;
            }
            case 'capture': {
                const subAction = ctx.args[1] ?? 'start';
                if (subAction === 'start') {
                    browser.startRequestCapture(client, sessionId);
                    output.printSuccess('Request capture started');
                }
                else if (subAction === 'stop') {
                    browser.stopRequestCapture(sessionId);
                    output.printSuccess('Request capture stopped');
                }
                else if (subAction === 'clear') {
                    browser.clearCapturedRequests(sessionId);
                    output.printSuccess('Captured requests cleared');
                }
                break;
            }
            case 'requests': {
                let reqs = browser.getCapturedRequests(sessionId);
                const filterUrl = ctx.flags.filter;
                const filterMethod = ctx.flags.method;
                const filterStatus = ctx.flags['status-code'];
                const filterType = ctx.flags.type;
                if (filterUrl)
                    reqs = reqs.filter((r) => r.url.includes(filterUrl));
                if (filterMethod)
                    reqs = reqs.filter((r) => (r.method ?? 'GET').toUpperCase() === filterMethod.toUpperCase());
                if (filterStatus)
                    reqs = reqs.filter((r) => r.status === filterStatus);
                if (filterType)
                    reqs = reqs.filter((r) => r.resourceType === filterType || r.type === filterType);
                if (ctx.flags.json)
                    print(JSON.stringify({ data: reqs }));
                else {
                    if (reqs.length === 0) {
                        output.printInfo('No captured requests. Run: network capture start');
                    }
                    else
                        for (const r of reqs)
                            print(`  ${r.method ?? 'GET'} ${r.status ?? '-'} ${r.url}`);
                }
                return { success: true, data: { requests: reqs } };
            }
            case 'request': {
                const reqId = ctx.args[1];
                if (!reqId)
                    throw new Error('Usage: monomind browse network request <requestId>');
                const reqs = browser.getCapturedRequests(sessionId);
                const req = reqs.find((r) => r.requestId === reqId || r.id === reqId);
                if (!req) {
                    output.printWarning(`Request not found: ${reqId}`);
                    return { success: false };
                }
                if (ctx.flags.json)
                    print(JSON.stringify({ data: req }));
                else
                    print(JSON.stringify(req, null, 2));
                return { success: true, data: { request: req } };
            }
            default:
                throw new Error(`Unknown: ${action}. Use: route|unroute|cookies|headers|capture|requests|request`);
        }
        return { success: true };
    },
};
const evalCommand = {
    name: 'eval',
    description: 'Evaluate JavaScript in page context. Usage: monomind browse eval "document.title"',
    options: [
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
        { name: 'stdin', type: 'boolean', description: 'Read JS expression from stdin (heredoc-friendly for multiline scripts)', default: false },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        let expr = ctx.args[0];
        if (ctx.flags.stdin) {
            const chunks = [];
            for await (const chunk of process.stdin)
                chunks.push(chunk);
            expr = Buffer.concat(chunks).toString('utf8').trim();
        }
        if (!expr)
            throw new Error('Usage: monomind browse eval "<expression>" (or pipe with --stdin)');
        const result = await browser.evaluateJs(client, sessionId, expr);
        if (ctx.flags.json) {
            print(JSON.stringify({ data: result }));
        }
        else {
            print(String(result ?? ''));
        }
        return { success: true, data: { result } };
    },
};
const closeCommand = {
    name: 'close',
    description: 'Close the active browser session',
    action: async (_ctx) => {
        if (_client) {
            const browser = await getBrowser();
            const sid = _sessionId;
            const client = _client;
            // Tear down per-session Maps and listeners before closing
            if (browser.getHarStatus(sid).recording) {
                try {
                    await browser.stopHarRecording(client, sid);
                }
                catch { /* ignore */ }
            }
            if (browser.getTraceStatus(sid)) {
                try {
                    await browser.stopTrace(client, sid);
                }
                catch { /* ignore */ }
            }
            if (browser.isProfilingActive(sid)) {
                try {
                    await browser.stopCpuProfile(client, sid);
                }
                catch { /* ignore */ }
            }
            browser.teardownRouteInterception(sid);
            browser.stopRequestCapture(sid);
            browser.teardownDialogHandling(sid);
            browser.teardownConsoleCapture(sid);
            client.close();
            _client = null;
            _sessionId = '';
            _targetId = '';
            _refs = new Map();
            output.printSuccess('Browser session closed');
        }
        else {
            output.printInfo('No active browser session');
        }
        return { success: true };
    },
};
// ---------------------------------------------------------------------------
// Additional subcommands
// ---------------------------------------------------------------------------
const dblclickCommand = {
    name: 'dblclick',
    description: 'Double-click an element. Usage: monomind browse dblclick @e1',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const refArg = ctx.args[0];
        if (!refArg)
            throw new Error('Usage: monomind browse dblclick @e1');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
        await browser.clickElement(client, sessionId, ref, { clickCount: 2 });
        output.printSuccess(`Double-clicked: ${ref.role} "${ref.name}"`);
        return { success: true };
    },
};
const focusCommand = {
    name: 'focus',
    description: 'Focus an element. Usage: monomind browse focus @e1',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const refArg = ctx.args[0];
        if (!refArg)
            throw new Error('Usage: monomind browse focus @e1');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
        await browser.focusElement(client, sessionId, ref);
        output.printSuccess(`Focused: ${ref.role} "${ref.name}"`);
        return { success: true };
    },
};
const typeCommand = {
    name: 'type',
    description: 'Type text into element (appends, does not clear). Usage: monomind browse type @e1 "text"',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const refArg = ctx.args[0];
        const value = ctx.args[1];
        if (!refArg || value === undefined)
            throw new Error('Usage: monomind browse type @e1 "value"');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
        await browser.typeIntoElement(client, sessionId, ref, value);
        output.printSuccess(`Typed into: ${ref.role} "${ref.name}"`);
        return { success: true };
    },
};
const keyboardCommand = {
    name: 'keyboard',
    description: 'Keyboard commands. Usage: monomind browse keyboard type "text" | inserttext "text"',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const action = ctx.args[0];
        const text = ctx.args[1];
        if (!action || !text)
            throw new Error('Usage: monomind browse keyboard type|inserttext "text"');
        await browser.typeText(client, sessionId, text);
        output.printSuccess(`Keyboard ${action}: ${text.length} chars`);
        return { success: true };
    },
};
const keydownCommand = {
    name: 'keydown',
    description: 'Hold key down. Usage: monomind browse keydown Shift',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const key = ctx.args[0];
        if (!key)
            throw new Error('Usage: monomind browse keydown <key>');
        await browser.keyDown(client, sessionId, key);
        output.printSuccess(`Key down: ${key}`);
        return { success: true };
    },
};
const keyupCommand = {
    name: 'keyup',
    description: 'Release held key. Usage: monomind browse keyup Shift',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const key = ctx.args[0];
        if (!key)
            throw new Error('Usage: monomind browse keyup <key>');
        await browser.keyUp(client, sessionId, key);
        output.printSuccess(`Key up: ${key}`);
        return { success: true };
    },
};
const hoverCommand = {
    name: 'hover',
    description: 'Hover over an element. Usage: monomind browse hover @e1',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const refArg = ctx.args[0];
        if (!refArg)
            throw new Error('Usage: monomind browse hover @e1');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
        await browser.hoverElement(client, sessionId, ref);
        output.printSuccess(`Hovered: ${ref.role} "${ref.name}"`);
        return { success: true };
    },
};
const selectCommand = {
    name: 'select',
    description: 'Select a dropdown option. Usage: monomind browse select @e1 "Option text"',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const refArg = ctx.args[0];
        const value = ctx.args[1];
        if (!refArg || !value)
            throw new Error('Usage: monomind browse select @e1 "value"');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
        await browser.selectOption(client, sessionId, ref, value);
        output.printSuccess(`Selected: "${value}"`);
        return { success: true };
    },
};
const checkCommand = {
    name: 'check',
    description: 'Check a checkbox. Usage: monomind browse check @e1',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const refArg = ctx.args[0];
        if (!refArg)
            throw new Error('Usage: monomind browse check @e1');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
        await browser.checkElement(client, sessionId, ref, true);
        output.printSuccess(`Checked: ${ref.role} "${ref.name}"`);
        return { success: true };
    },
};
const uncheckCommand = {
    name: 'uncheck',
    description: 'Uncheck a checkbox. Usage: monomind browse uncheck @e1',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const refArg = ctx.args[0];
        if (!refArg)
            throw new Error('Usage: monomind browse uncheck @e1');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
        await browser.checkElement(client, sessionId, ref, false);
        output.printSuccess(`Unchecked: ${ref.role} "${ref.name}"`);
        return { success: true };
    },
};
async function resolveElementObjectId(client, sessionId, refs, refOrSelector) {
    const browser = await getBrowser();
    if (refOrSelector.startsWith('@') || /^e\d+$/.test(refOrSelector)) {
        const key = refOrSelector.startsWith('@') ? refOrSelector.slice(1) : refOrSelector;
        const ref = await browser.resolveRef(client, sessionId, refs, key);
        const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
        if (!objectId)
            throw new Error(`Element @${key} not found in DOM`);
        return objectId;
    }
    // CSS selector path
    const res = await client.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(refOrSelector)})`,
        returnByValue: false,
    }, sessionId);
    if (!res.result?.objectId || res.result?.subtype === 'null')
        throw new Error(`Selector not found: ${refOrSelector}`);
    return res.result.objectId;
}
const isvisibleCommand = {
    name: 'isvisible',
    description: 'Check if element is visible. Usage: monomind browse isvisible @e1|"selector"',
    options: [{ name: 'json', type: 'boolean', description: 'Output as JSON', default: false }],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const arg = ctx.args[0];
        if (!arg)
            throw new Error('Usage: monomind browse isvisible @e1|".selector"');
        const objectId = await resolveElementObjectId(client, sessionId, _refs, arg);
        const r = await client.send('Runtime.callFunctionOn', {
            functionDeclaration: `function(){var r=this.getBoundingClientRect(),s=window.getComputedStyle(this);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&parseFloat(s.opacity)>0;}`,
            objectId,
            returnByValue: true,
        }, sessionId);
        const visible = r.result?.value ?? false;
        if (ctx.flags.json) {
            print(JSON.stringify({ visible }));
        }
        else {
            output.printSuccess(`isvisible: ${visible}`);
        }
        return { success: true, data: { visible } };
    },
};
const isenabledCommand = {
    name: 'isenabled',
    description: 'Check if element is enabled (not disabled). Usage: monomind browse isenabled @e1|"selector"',
    options: [{ name: 'json', type: 'boolean', description: 'Output as JSON', default: false }],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const arg = ctx.args[0];
        if (!arg)
            throw new Error('Usage: monomind browse isenabled @e1|".selector"');
        const objectId = await resolveElementObjectId(client, sessionId, _refs, arg);
        const r = await client.send('Runtime.callFunctionOn', {
            functionDeclaration: `function(){return !this.disabled;}`,
            objectId,
            returnByValue: true,
        }, sessionId);
        const enabled = r.result?.value ?? true;
        if (ctx.flags.json) {
            print(JSON.stringify({ enabled }));
        }
        else {
            output.printSuccess(`isenabled: ${enabled}`);
        }
        return { success: true, data: { enabled } };
    },
};
const ischeckedCommand = {
    name: 'ischecked',
    description: 'Check if checkbox/radio is checked. Usage: monomind browse ischecked @e1|"selector"',
    options: [{ name: 'json', type: 'boolean', description: 'Output as JSON', default: false }],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const arg = ctx.args[0];
        if (!arg)
            throw new Error('Usage: monomind browse ischecked @e1|".selector"');
        const objectId = await resolveElementObjectId(client, sessionId, _refs, arg);
        const r = await client.send('Runtime.callFunctionOn', {
            functionDeclaration: `function(){var el=this,tag=el.tagName&&el.tagName.toUpperCase();if(tag==='INPUT'&&(el.type==='checkbox'||el.type==='radio'))return el.checked;var role=el.getAttribute&&el.getAttribute('role');if(role&&['checkbox','radio','switch','menuitemcheckbox','menuitemradio','option','treeitem'].indexOf(role)!==-1)return el.getAttribute('aria-checked')==='true';var label=tag!=='LABEL'?el.closest&&el.closest('label'):el;if(label&&label.control&&(label.control.type==='checkbox'||label.control.type==='radio'))return label.control.checked;var inp=el.querySelector&&el.querySelector('input[type="checkbox"],input[type="radio"]');return inp?inp.checked:false;}`,
            objectId,
            returnByValue: true,
        }, sessionId);
        const checked = r.result?.value ?? false;
        if (ctx.flags.json) {
            print(JSON.stringify({ checked }));
        }
        else {
            output.printSuccess(`ischecked: ${checked}`);
        }
        return { success: true, data: { checked } };
    },
};
const tapCommand = {
    name: 'tap',
    description: 'Tap element with a touch event (mobile testing). Usage: monomind browse tap @e1|"selector"',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const arg = ctx.args[0];
        if (!arg)
            throw new Error('Usage: monomind browse tap @e1|".selector"');
        // Get element center position
        let x, y;
        if (arg.startsWith('@') || /^e\d+$/.test(arg)) {
            const key = arg.startsWith('@') ? arg.slice(1) : arg;
            const ref = await browser.resolveRef(client, sessionId, _refs, key);
            const box = await browser.getElementBox(client, sessionId, ref);
            if (!box)
                throw new Error(`Cannot get bounds for @${key}`);
            x = Math.round(box.x + box.width / 2);
            y = Math.round(box.y + box.height / 2);
        }
        else {
            const posJson = await browser.evaluateJs(client, sessionId, `(function(){var el=document.querySelector(${JSON.stringify(arg)});if(!el)return null;var r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`);
            if (!posJson)
                throw new Error(`Selector not found: ${arg}`);
            const pos = JSON.parse(posJson);
            x = Math.round(pos.x);
            y = Math.round(pos.y);
        }
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }, sessionId);
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
        output.printSuccess(`Tapped at (${x}, ${y})`);
        return { success: true, data: { x, y } };
    },
};
const swipeCommand = {
    name: 'swipe',
    description: 'Swipe gesture (mobile). Usage: monomind browse swipe up|down|left|right [distance] [--x N] [--y N]',
    options: [
        { name: 'x', type: 'number', description: 'Start X coordinate (default: center)', default: 200 },
        { name: 'y', type: 'number', description: 'Start Y coordinate (default: center)', default: 400 },
        { name: 'distance', short: 'd', type: 'number', description: 'Swipe distance in pixels', default: 300 },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const direction = ctx.args[0];
        if (!['up', 'down', 'left', 'right'].includes(direction)) {
            throw new Error('Usage: monomind browse swipe up|down|left|right [--x N] [--y N] [--distance N]');
        }
        const startX = ctx.flags.x ?? 200;
        const startY = ctx.flags.y ?? 400;
        const positionalDistance = ctx.args[1] !== undefined ? parseInt(ctx.args[1], 10) : undefined;
        const distance = (positionalDistance && Number.isFinite(positionalDistance)) ? positionalDistance : ctx.flags.distance ?? 300;
        const dx = direction === 'right' ? distance : direction === 'left' ? -distance : 0;
        const dy = direction === 'down' ? distance : direction === 'up' ? -distance : 0;
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY }] }, sessionId);
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
            const x = Math.round(startX + dx * i / steps);
            const y = Math.round(startY + dy * i / steps);
            await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }, sessionId);
            await new Promise((r) => setTimeout(r, 16));
        }
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
        output.printSuccess(`Swiped ${direction} ${distance}px from (${startX},${startY})`);
        return { success: true, data: { direction, distance, startX, startY } };
    },
};
const scrollIntoViewCommand = {
    name: 'scrollintoview',
    description: 'Scroll element into view. Usage: monomind browse scrollintoview @e1',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const refArg = ctx.args[0];
        if (!refArg)
            throw new Error('Usage: monomind browse scrollintoview @e1');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
        await browser.scrollIntoView(client, sessionId, ref);
        output.printSuccess(`Scrolled into view: ${ref.role} "${ref.name}"`);
        return { success: true };
    },
};
const dragCommand = {
    name: 'drag',
    description: 'Drag element to another element. Usage: monomind browse drag @e1 @e2',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const srcArg = ctx.args[0];
        const tgtArg = ctx.args[1];
        if (!srcArg || !tgtArg)
            throw new Error('Usage: monomind browse drag @e1 @e2');
        const srcKey = srcArg.startsWith('@') ? srcArg.slice(1) : srcArg;
        const tgtKey = tgtArg.startsWith('@') ? tgtArg.slice(1) : tgtArg;
        const src = await browser.resolveRef(client, sessionId, _refs, srcKey);
        const tgt = await browser.resolveRef(client, sessionId, _refs, tgtKey);
        await browser.dragAndDrop(client, sessionId, src, tgt);
        output.printSuccess(`Dragged @${srcKey} to @${tgtKey}`);
        return { success: true };
    },
};
const uploadCommand = {
    name: 'upload',
    description: 'Upload files to a file input. Usage: monomind browse upload @e1 ./file.pdf',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const refArg = ctx.args[0];
        const files = ctx.args.slice(1);
        if (!refArg || files.length === 0)
            throw new Error('Usage: monomind browse upload @e1 <file1> [file2...]');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
        await browser.uploadFile(client, sessionId, ref, files);
        output.printSuccess(`Uploaded ${files.length} file(s) to @${refKey}`);
        return { success: true };
    },
};
const downloadCommand = {
    name: 'download',
    description: 'Click an element and capture the triggered file download. Usage: monomind browse download @e1 ./output.pdf',
    options: [
        { name: 'timeout', short: 't', type: 'number', description: 'Max wait for download in ms', default: 30000 },
        { name: 'json', type: 'boolean', description: 'Output result as JSON', default: false },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const refOrSel = ctx.args[0];
        const savePath = ctx.args[1];
        if (!refOrSel || !savePath)
            throw new Error('Usage: monomind browse download @e1|selector <save-path>');
        const { mkdir } = await import('fs/promises');
        const { dirname } = await import('path');
        const { tmpdir } = await import('os');
        const { join } = await import('path');
        const downloadDir = join(tmpdir(), `mm-download-${Date.now()}`);
        await mkdir(downloadDir, { recursive: true });
        // Enable Page.downloadWillBegin / Page.downloadProgress events
        await client.send('Browser.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadDir,
            eventsEnabled: true,
        }, undefined).catch(() => {
            // Fallback: older Chrome API (session-scoped)
            return client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: downloadDir,
            }, sessionId).catch(() => { });
        });
        // Track when download completes
        const downloadPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Download timed out')), ctx.flags.timeout);
            let guid = '';
            // C2: capture off() functions to avoid listener leaks in batch mode
            const offBegin = client.on('Browser.downloadWillBegin', (params) => {
                guid = params.guid;
            });
            let offProgress;
            const cleanup = () => { clearTimeout(timeout); offBegin?.(); offProgress?.(); };
            offProgress = client.on('Browser.downloadProgress', async (params) => {
                if (params.guid === guid && params.state === 'completed') {
                    cleanup();
                    // Find the downloaded file in downloadDir
                    const { readdir, rename, rmdir } = await import('fs/promises');
                    const files = await readdir(downloadDir);
                    if (files.length > 0) {
                        const src = join(downloadDir, files[0]);
                        await mkdir(dirname(savePath), { recursive: true });
                        await rename(src, savePath);
                        await rmdir(downloadDir).catch(() => { }); // I1: cleanup temp dir
                        resolve(savePath);
                    }
                    else {
                        await rmdir(downloadDir).catch(() => { }); // I1: cleanup temp dir
                        reject(new Error('Download completed but no file found'));
                    }
                }
                else if (params.guid === guid && params.state === 'canceled') {
                    cleanup();
                    reject(new Error('Download was canceled'));
                }
            });
        });
        // Click the element to trigger download
        const objectId = await resolveElementObjectId(client, sessionId, _refs, refOrSel);
        await client.send('Runtime.callFunctionOn', {
            functionDeclaration: 'function(){ this.click(); }',
            objectId,
            returnByValue: true,
        }, sessionId);
        const finalPath = await downloadPromise;
        if (ctx.flags.json)
            print(JSON.stringify({ data: { path: finalPath } }));
        else
            output.printSuccess(`Downloaded: ${finalPath}`);
        return { success: true, data: { path: finalPath } };
    },
};
const mouseCommand = {
    name: 'mouse',
    description: 'Fine-grained mouse control. Usage: monomind browse mouse move|down|up|wheel <args>',
    options: [
        { name: 'button', type: 'string', description: 'Button: left|right|middle', default: 'left' },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const action = ctx.args[0];
        switch (action) {
            case 'move': {
                const x = parseFloat(ctx.args[1]);
                const y = parseFloat(ctx.args[2]);
                await browser.mouseMove(client, sessionId, x, y);
                output.printSuccess(`Mouse moved to (${x}, ${y})`);
                break;
            }
            case 'down': {
                const x = parseFloat(ctx.args[1]) || 0;
                const y = parseFloat(ctx.args[2]) || 0;
                const button = ctx.flags.button ?? 'left';
                await browser.mouseDown(client, sessionId, x, y, button);
                output.printSuccess(`Mouse down at (${x}, ${y})`);
                break;
            }
            case 'up': {
                const x = parseFloat(ctx.args[1]) || 0;
                const y = parseFloat(ctx.args[2]) || 0;
                const button = ctx.flags.button ?? 'left';
                await browser.mouseUp(client, sessionId, x, y, button);
                output.printSuccess(`Mouse up at (${x}, ${y})`);
                break;
            }
            case 'wheel': {
                const x = parseFloat(ctx.args[1]) || 0;
                const y = parseFloat(ctx.args[2]) || 0;
                const dy = parseFloat(ctx.args[3]) || 0;
                const dx = parseFloat(ctx.args[4]) || 0;
                await browser.mouseWheel(client, sessionId, x, y, dy, dx);
                output.printSuccess(`Mouse wheel (${dx}, ${dy})`);
                break;
            }
            default:
                throw new Error('Usage: monomind browse mouse move|down|up|wheel <args>');
        }
        return { success: true };
    },
};
const clipboardCommand = {
    name: 'clipboard',
    description: 'Clipboard operations. Usage: monomind browse clipboard read|write|copy|paste',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const action = ctx.args[0];
        switch (action) {
            case 'read': {
                const text = await browser.readClipboard(client, sessionId);
                print(text);
                return { success: true, data: { text } };
            }
            case 'write': {
                const text = ctx.args[1];
                if (!text)
                    throw new Error('Usage: monomind browse clipboard write "text"');
                await browser.writeClipboard(client, sessionId, text);
                output.printSuccess('Clipboard written');
                break;
            }
            case 'copy': {
                const mod = process.platform === 'darwin' ? 4 : 2; // Meta/Cmd on macOS, Ctrl elsewhere
                await browser.pressKeyCombo(client, sessionId, 'c', mod);
                output.printSuccess('Copy sent');
                break;
            }
            case 'paste': {
                const mod = process.platform === 'darwin' ? 4 : 2;
                await browser.pressKeyCombo(client, sessionId, 'v', mod);
                output.printSuccess('Paste sent');
                break;
            }
            default:
                throw new Error('Usage: monomind browse clipboard read|write|copy|paste');
        }
        return { success: true };
    },
};
const dialogCommand = {
    name: 'dialog',
    description: 'Handle browser dialogs. Usage: monomind browse dialog accept|dismiss|status',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const action = ctx.args[0];
        switch (action) {
            case 'accept': {
                const text = ctx.args[1];
                await browser.acceptDialog(client, sessionId, text);
                output.printSuccess('Dialog accepted');
                break;
            }
            case 'dismiss':
                await browser.dismissDialog(client, sessionId);
                output.printSuccess('Dialog dismissed');
                break;
            case 'status': {
                const info = browser.getDialogStatus(sessionId);
                if (info) {
                    print(`Dialog open: type=${info.type} message="${info.message}"`);
                }
                else {
                    print('No dialog open');
                }
                return { success: true, data: { dialog: info } };
            }
            default:
                throw new Error('Usage: monomind browse dialog accept|dismiss|status');
        }
        return { success: true };
    },
};
const frameCommand = {
    name: 'frame',
    description: 'Switch to iframe or back to main. Usage: monomind browse frame "#frame-id" | frame main',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const target = ctx.args[0];
        if (!target)
            throw new Error('Usage: monomind browse frame <selector>|main');
        if (target === 'main') {
            output.printSuccess('Switched to main frame');
        }
        else {
            const frameSrc = await browser.switchToFrame(client, sessionId, target);
            output.printSuccess(`Switched to frame: ${frameSrc ?? target}`);
        }
        return { success: true };
    },
};
const tabCommand = {
    name: 'tab',
    description: 'Tab management. Usage: monomind browse tab list|new|close [url]',
    options: [
        { name: 'label', type: 'string', description: 'Label for new tab' },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const action = ctx.args[0];
        switch (action ?? 'list') {
            case 'list': {
                const tabs = await browser.listTabs(_port);
                for (const t of tabs)
                    print(`  ${t.id}: ${t.title} (${t.url})`);
                return { success: true, data: { tabs } };
            }
            case 'new': {
                const url = ctx.args[1];
                const tab = await browser.newTab(_port, url);
                output.printSuccess(`New tab: ${tab.id} ${url ?? ''}`);
                return { success: true, data: { tab } };
            }
            case 'close': {
                const tabId = ctx.args[1];
                if (!tabId)
                    throw new Error('Usage: monomind browse tab close <tabId>');
                if (tabId === _targetId) {
                    const sid = _sessionId;
                    // Stop profiling before closing the tab so CDP commands still reach the live session
                    if (browser.getHarStatus(sid).recording) {
                        try {
                            await browser.stopHarRecording(client, sid);
                        }
                        catch { /* ignore */ }
                    }
                    if (browser.getTraceStatus(sid)) {
                        try {
                            await browser.stopTrace(client, sid);
                        }
                        catch { /* ignore */ }
                    }
                    if (browser.isProfilingActive(sid)) {
                        try {
                            await browser.stopCpuProfile(client, sid);
                        }
                        catch { /* ignore */ }
                    }
                    browser.teardownRouteInterception(sid);
                    browser.stopRequestCapture(sid);
                    browser.teardownDialogHandling(sid);
                    browser.teardownConsoleCapture(sid);
                    await browser.closeTab(client, sessionId, tabId);
                    client.close();
                    _client = null;
                    _sessionId = '';
                    _targetId = '';
                    _refs = new Map();
                }
                else {
                    await browser.closeTab(client, sessionId, tabId);
                }
                output.printSuccess(`Closed tab: ${tabId}`);
                break;
            }
            default: {
                // Attach to new tab FIRST — only tear down old session if that succeeds
                const newSid = await browser.activateTab(client, sessionId, action);
                const oldSid = _sessionId;
                if (browser.getHarStatus(oldSid).recording) {
                    try {
                        await browser.stopHarRecording(client, oldSid);
                    }
                    catch { /* ignore */ }
                }
                if (browser.getTraceStatus(oldSid)) {
                    try {
                        await browser.stopTrace(client, oldSid);
                    }
                    catch { /* ignore */ }
                }
                if (browser.isProfilingActive(oldSid)) {
                    try {
                        await browser.stopCpuProfile(client, oldSid);
                    }
                    catch { /* ignore */ }
                }
                await browser.disableInterception(client, oldSid).catch(() => { });
                browser.stopRequestCapture(oldSid);
                browser.teardownDialogHandling(oldSid);
                browser.teardownConsoleCapture(oldSid);
                _sessionId = newSid;
                _targetId = action;
                _refs = new Map();
                await browser.enableSessionDomains(client, _sessionId);
                output.printSuccess(`Switched to tab: ${action}`);
            }
        }
        return { success: true };
    },
};
const windowCommand = {
    name: 'window',
    description: 'Browser window management. Usage: monomind browse window new [url]',
    action: async (ctx) => {
        const { client, sessionId: _sid } = await ensureConnected(_port);
        const browser = await getBrowser();
        const action = ctx.args[0];
        if (!action || action === 'new') {
            // Create isolated browser context (incognito-like) with a fresh page
            const ctxResult = await client.send('Target.createBrowserContext', {}, undefined);
            const browserContextId = ctxResult.browserContextId;
            const url = ctx.args[1] || 'about:blank';
            const targetResult = await client.send('Target.createTarget', { url, browserContextId }, undefined);
            const targetId = targetResult.targetId;
            const attachResult = await client.send('Target.attachToTarget', { targetId, flatten: true }, undefined);
            const newSessionId = attachResult.sessionId;
            // W3: fully tear down old session before switching
            const oldSid = _sessionId;
            if (browser.getHarStatus(oldSid).recording) {
                try {
                    await browser.stopHarRecording(client, oldSid);
                }
                catch { /* ignore */ }
            }
            if (browser.getTraceStatus(oldSid)) {
                try {
                    await browser.stopTrace(client, oldSid);
                }
                catch { /* ignore */ }
            }
            if (browser.isProfilingActive(oldSid)) {
                try {
                    await browser.stopCpuProfile(client, oldSid);
                }
                catch { /* ignore */ }
            }
            browser.teardownRouteInterception(oldSid);
            browser.stopRequestCapture(oldSid);
            browser.teardownDialogHandling(oldSid);
            browser.teardownConsoleCapture(oldSid);
            _sessionId = newSessionId;
            _targetId = targetId;
            _refs = new Map();
            await browser.enableSessionDomains(client, _sessionId);
            output.printSuccess(`Opened new window (isolated context): ${targetId} [${url}]`);
            return { success: true, data: { targetId, browserContextId, sessionId: newSessionId } };
        }
        throw new Error(`Unknown window action: ${action}. Use: new`);
    },
};
const consoleLogCommand = {
    name: 'console',
    description: 'View captured console messages. Usage: monomind browse console [--clear] [--json]',
    options: [
        { name: 'clear', type: 'boolean', description: 'Clear console messages', default: false },
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
        { name: 'errors-only', type: 'boolean', description: 'Show only errors', default: false },
    ],
    action: async (ctx) => {
        const browser = await getBrowser();
        if (ctx.flags.clear) {
            browser.clearConsoleMessages(_sessionId);
            output.printSuccess('Console cleared');
            return { success: true };
        }
        const allMsgs = browser.getConsoleMessages(_sessionId);
        const msgs = ctx.flags['errors-only'] ? allMsgs.filter((m) => m.type === 'error') : allMsgs;
        if (ctx.flags.json) {
            print(JSON.stringify(msgs));
        }
        else {
            for (const m of msgs) {
                const prefix = m.type === 'error' ? '[ERROR]' : m.type === 'warn' ? '[WARN]' : '[LOG]';
                print(`${prefix} ${m.text}`);
            }
        }
        return { success: true, data: { messages: msgs } };
    },
};
const errorsCommand = {
    name: 'errors',
    description: 'View page errors (uncaught JS exceptions). Usage: monomind browse errors [--clear]',
    options: [
        { name: 'clear', type: 'boolean', description: 'Clear errors', default: false },
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    ],
    action: async (ctx) => {
        const browser = await getBrowser();
        if (ctx.flags.clear) {
            browser.clearPageErrors(_sessionId);
            output.printSuccess('Errors cleared');
            return { success: true };
        }
        const errs = browser.getPageErrors(_sessionId);
        if (ctx.flags.json) {
            print(JSON.stringify(errs));
        }
        else if (errs.length === 0) {
            output.printSuccess('No page errors');
        }
        else {
            for (const e of errs)
                print(`[ERROR] ${e.text} (${e.url}:${e.lineNumber})`);
        }
        return { success: true, data: { errors: errs } };
    },
};
const storageCommand = {
    name: 'storage',
    description: 'localStorage/sessionStorage management. Usage: monomind browse storage local|session [key] [--set val] [--clear]',
    options: [
        { name: 'set', type: 'string', description: 'Value to set for key' },
        { name: 'clear', type: 'boolean', description: 'Clear all storage', default: false },
        { name: 'remove', type: 'boolean', description: 'Remove a specific key', default: false },
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const storageType = ctx.args[0];
        const key = ctx.args[1];
        if (!storageType)
            throw new Error('Usage: monomind browse storage local|session [key]');
        const isLocal = storageType === 'local';
        if (ctx.flags.clear) {
            if (isLocal)
                await browser.clearLocalStorage(client, sessionId);
            else
                await browser.clearSessionStorage(client, sessionId);
            output.printSuccess(`${storageType}Storage cleared`);
            return { success: true };
        }
        if (key && ctx.flags.set !== undefined) {
            if (isLocal)
                await browser.setLocalStorageKey(client, sessionId, key, ctx.flags.set);
            else
                await browser.setSessionStorageKey(client, sessionId, key, ctx.flags.set);
            output.printSuccess(`Set ${key}`);
            return { success: true };
        }
        if (key && ctx.flags.remove) {
            if (isLocal)
                await browser.removeLocalStorageKey(client, sessionId, key);
            else
                await browser.removeSessionStorageKey(client, sessionId, key);
            output.printSuccess(`Removed ${key}`);
            return { success: true };
        }
        if (key) {
            const val = isLocal
                ? await browser.getLocalStorageKey(client, sessionId, key)
                : await browser.getSessionStorageKey(client, sessionId, key);
            if (ctx.flags.json)
                print(JSON.stringify({ data: val }));
            else
                print(val ?? '(null)');
            return { success: true, data: { value: val } };
        }
        const all = isLocal
            ? await browser.getAllLocalStorage(client, sessionId)
            : await browser.getAllSessionStorage(client, sessionId);
        if (ctx.flags.json)
            print(JSON.stringify(all));
        else {
            for (const [k, v] of Object.entries(all))
                print(`  ${k}: ${v}`);
        }
        return { success: true, data: { storage: all } };
    },
};
const cookiesCommand = {
    name: 'cookies',
    description: 'Cookie management. Usage: monomind browse cookies [list|set|clear]',
    options: [
        { name: 'name', type: 'string', description: 'Cookie name' },
        { name: 'value', type: 'string', description: 'Cookie value' },
        { name: 'domain', type: 'string', description: 'Cookie domain' },
        { name: 'curl', type: 'string', description: 'Import cookies from cURL dump file' },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const action = ctx.args[0] ?? 'list';
        switch (action) {
            case 'list': {
                const cookies = await browser.getCookies(client, sessionId);
                print(JSON.stringify(cookies, null, 2));
                return { success: true, data: { cookies } };
            }
            case 'set': {
                // Support both: cookies set --name n --value v  AND  cookies set <name> <value>
                const name = ctx.flags.name ?? ctx.args[1];
                const value = ctx.flags.value ?? ctx.args[2];
                if (!name || value === undefined) {
                    throw new Error('Usage: monomind browse cookies set <name> <value> [--domain <d>]');
                }
                await browser.setCookies(client, sessionId, [{
                        name,
                        value,
                        domain: ctx.flags.domain,
                    }]);
                output.printSuccess(`Cookie set: ${name}`);
                break;
            }
            case 'clear':
                await browser.clearCookies(client, sessionId);
                output.printSuccess('Cookies cleared');
                break;
            default:
                throw new Error('Usage: monomind browse cookies list|set|clear');
        }
        return { success: true };
    },
};
const pdfCommand = {
    name: 'pdf',
    description: 'Save page as PDF. Usage: monomind browse pdf [path]',
    options: [
        { name: 'landscape', type: 'boolean', description: 'Landscape orientation', default: false },
        { name: 'background', type: 'boolean', description: 'Print background', default: true },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const path = await browser.capturePdf(client, sessionId, {
            path: ctx.args[0],
            landscape: ctx.flags.landscape,
            printBackground: ctx.flags.background,
        });
        output.printSuccess(`PDF saved: ${path}`);
        return { success: true, data: { path } };
    },
};
const isCommand = {
    name: 'is',
    description: 'Check element state. Usage: monomind browse is visible|enabled|checked @e1',
    options: [
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const check = ctx.args[0];
        const refArg = ctx.args[1];
        if (!check || !refArg)
            throw new Error('Usage: monomind browse is visible|enabled|checked @e1');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
        let result;
        switch (check) {
            case 'visible':
                result = await browser.isVisible(client, sessionId, ref);
                break;
            case 'enabled':
                result = await browser.isEnabled(client, sessionId, ref);
                break;
            case 'checked':
                result = await browser.isChecked(client, sessionId, ref);
                break;
            default: throw new Error(`Unknown check: ${check}. Use: visible|enabled|checked`);
        }
        if (ctx.flags.json) {
            print(JSON.stringify({ data: { [check]: result } }));
        }
        else {
            print(result ? 'true' : 'false');
        }
        return { success: true, data: { [check]: result } };
    },
};
const findCommand = {
    name: 'find',
    description: 'Find elements by semantic locators. Usage: monomind browse find role|text|label|placeholder|testid|alttext|title|selector <value> [action]',
    options: [
        { name: 'name', type: 'string', description: 'Filter by accessible name' },
        { name: 'exact', type: 'boolean', description: 'Require exact match', default: false },
        { name: 'nth', type: 'number', description: 'Find nth match' },
        { name: 'last', type: 'boolean', description: 'Find last match', default: false },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const locator = ctx.args[0];
        const value = ctx.args[1];
        const action = ctx.args[2];
        if (!locator || !value)
            throw new Error('Usage: monomind browse find role|text|label|placeholder|testid|alttext|title|selector <value> [action]');
        const opts = {
            name: ctx.flags.name,
            exact: ctx.flags.exact,
            nth: ctx.flags.nth,
            last: ctx.flags.last,
        };
        // alttext: find element by alt attribute (images, icons)
        if (locator === 'alttext') {
            // I2: use JS attribute comparison to avoid broken CSS selectors for values with spaces/quotes
            const valJson = JSON.stringify(value);
            const found = await browser.evaluateJs(client, sessionId, `(function(v){var el=document.querySelector('img[alt]')||null;var all=document.querySelectorAll('[alt]');for(var i=0;i<all.length;i++){if(all[i].getAttribute('alt')===v){all[i].setAttribute('data-mm-located','true');return true;}}return false;})(${valJson})`);
            if (!found) {
                output.printWarning(`alttext not found: ${value}`);
                return { success: false };
            }
            output.printSuccess(`Found element with alt="${value}"`);
            return { success: true, data: { alttext: value } };
        }
        // title: find element by title attribute
        if (locator === 'title') {
            // I2: use JS attribute comparison to avoid broken CSS selectors for values with spaces/quotes
            const valJson = JSON.stringify(value);
            const found = await browser.evaluateJs(client, sessionId, `(function(v){var all=document.querySelectorAll('[title]');for(var i=0;i<all.length;i++){if(all[i].getAttribute('title')===v){all[i].setAttribute('data-mm-located','true');return true;}}return false;})(${valJson})`);
            if (!found) {
                output.printWarning(`title not found: ${value}`);
                return { success: false };
            }
            output.printSuccess(`Found element with title="${value}"`);
            return { success: true, data: { title: value } };
        }
        let ref = null;
        switch (locator) {
            case 'role':
                ref = await browser.findByRole(client, sessionId, _refs, value, opts);
                break;
            case 'text':
                ref = await browser.findByText(client, sessionId, _refs, value, opts);
                break;
            case 'label':
                ref = await browser.findByLabel(client, sessionId, _refs, value, opts);
                break;
            case 'placeholder':
                ref = await browser.findByPlaceholder(client, sessionId, _refs, value, opts);
                break;
            case 'selector':
                ref = await browser.findBySelector(client, sessionId, _refs, value, opts);
                break;
            case 'testid': {
                const sel = await browser.findByTestId(client, sessionId, value);
                if (!sel) {
                    output.printWarning(`testid not found: ${value}`);
                    return { success: false };
                }
                output.printSuccess(`Found testid selector: ${sel}`);
                return { success: true, data: { selector: sel } };
            }
            default:
                throw new Error(`Unknown locator: ${locator}. Use: role|text|label|placeholder|testid|alttext|title|selector`);
        }
        if (!ref) {
            output.printWarning(`No element found: ${locator}="${value}"`);
            return { success: false };
        }
        output.printSuccess(`Found: ${ref.role} "${ref.name}" [@${ref.ref}]`);
        if (action) {
            switch (action) {
                case 'click':
                    await browser.clickElement(client, sessionId, ref);
                    break;
                case 'fill': {
                    const fillValue = ctx.args[3];
                    await browser.fillElement(client, sessionId, ref, fillValue ?? '');
                    break;
                }
                case 'type': {
                    const typeValue = ctx.args[3];
                    await browser.typeIntoElement(client, sessionId, ref, typeValue ?? '');
                    break;
                }
                case 'hover':
                    await browser.hoverElement(client, sessionId, ref);
                    break;
                case 'focus':
                    await browser.focusElement(client, sessionId, ref);
                    break;
                case 'check':
                    await browser.checkElement(client, sessionId, ref, true);
                    break;
                case 'uncheck':
                    await browser.checkElement(client, sessionId, ref, false);
                    break;
                case 'text': {
                    const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
                    if (objectId) {
                        const r = await client.send('Runtime.callFunctionOn', {
                            functionDeclaration: 'function() { return this.innerText || this.textContent || ""; }',
                            objectId,
                            returnByValue: true,
                        }, sessionId);
                        print(r.result?.value ?? '');
                    }
                    break;
                }
            }
        }
        return { success: true, data: { ref } };
    },
};
const highlightCommand = {
    name: 'highlight',
    description: 'Highlight an element for 2 seconds. Usage: monomind browse highlight @e1',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const refArg = ctx.args[0];
        if (!refArg)
            throw new Error('Usage: monomind browse highlight @e1');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
        await browser.highlightElement(client, sessionId, ref);
        output.printSuccess(`Highlighted: ${ref.role} "${ref.name}"`);
        return { success: true };
    },
};
const diffCommand = {
    name: 'diff',
    description: 'Compare two URLs or snapshots. Usage: monomind browse diff url <url1> <url2> [--interactive] [--json]',
    options: [
        { name: 'interactive', short: 'i', type: 'boolean', description: 'Snapshot interactive elements only', default: false },
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const subAction = ctx.args[0];
        if (subAction === 'url') {
            const url1 = ctx.args[1];
            const url2 = ctx.args[2];
            if (!url1 || !url2)
                throw new Error('Usage: monomind browse diff url <url1> <url2>');
            // Capture snapshot at url1
            await browser.openUrl(client, sessionId, url1);
            await browser.waitFor(client, sessionId, { load: 'load', timeout: 15000 });
            const snap1 = await browser.captureSnapshot(client, sessionId, { interactiveOnly: ctx.flags.interactive });
            // Capture snapshot at url2
            await browser.openUrl(client, sessionId, url2);
            await browser.waitFor(client, sessionId, { load: 'load', timeout: 15000 });
            const snap2 = await browser.captureSnapshot(client, sessionId, { interactiveOnly: ctx.flags.interactive });
            _refs = snap2.refs;
            // Text diff
            const lines1 = snap1.text.split('\n');
            const lines2 = snap2.text.split('\n');
            const set1 = new Set(lines1);
            const set2 = new Set(lines2);
            const onlyIn1 = lines1.filter((l) => !set2.has(l));
            const onlyIn2 = lines2.filter((l) => !set1.has(l));
            const changed = onlyIn1.length > 0 || onlyIn2.length > 0;
            if (ctx.flags.json) {
                print(JSON.stringify({ changed, url1, url2, onlyIn1, onlyIn2, additions: onlyIn2.length, removals: onlyIn1.length }));
            }
            else {
                if (!changed) {
                    output.printSuccess(`No differences between ${url1} and ${url2}`);
                }
                else {
                    output.printWarning(`Diff: ${url1} vs ${url2} — +${onlyIn2.length} lines, -${onlyIn1.length} lines`);
                    for (const l of onlyIn1)
                        print(`\x1b[31m- ${l}\x1b[0m`);
                    for (const l of onlyIn2)
                        print(`\x1b[32m+ ${l}\x1b[0m`);
                }
            }
            return { success: true, data: { changed, url1, url2, additions: onlyIn2.length, removals: onlyIn1.length } };
        }
        throw new Error('Usage: monomind browse diff url <url1> <url2>');
    },
};
const pushstateCommand = {
    name: 'pushstate',
    description: 'SPA navigation via pushState. Usage: monomind browse pushstate /path',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const url = ctx.args[0];
        if (!url)
            throw new Error('Usage: monomind browse pushstate <url>');
        await browser.pushState(client, sessionId, url);
        output.printSuccess(`pushState: ${url}`);
        return { success: true };
    },
};
function tokenizeBatchCommand(input) {
    const tokens = [];
    let current = '';
    let inQuote = null;
    for (const ch of input.trim()) {
        if (inQuote) {
            if (ch === inQuote) {
                inQuote = null;
            }
            else {
                current += ch;
            }
        }
        else if (ch === '"' || ch === "'") {
            inQuote = ch;
        }
        else if (/\s/.test(ch)) {
            if (current) {
                tokens.push(current);
                current = '';
            }
        }
        else {
            current += ch;
        }
    }
    if (current)
        tokens.push(current);
    return tokens;
}
const batchCommand = {
    name: 'batch',
    description: 'Execute multiple commands. Usage: monomind browse batch "open url" "snapshot -i" "click @e1"',
    options: [
        { name: 'bail', type: 'boolean', description: 'Stop on first error', default: false },
        { name: 'json', type: 'boolean', description: 'Input from JSON stdin', default: false },
    ],
    action: async (ctx) => {
        const commands = ctx.args;
        if (commands.length === 0)
            throw new Error('Usage: monomind browse batch "cmd1" "cmd2" ...');
        const results = [];
        for (const cmdStr of commands) {
            const parts = tokenizeBatchCommand(cmdStr);
            const subName = parts[0];
            const subArgs = parts.slice(1);
            const subCmd = browseCommand.subcommands?.find((s) => s.name === subName);
            if (!subCmd?.action) {
                const err = `Unknown command: ${subName}`;
                results.push({ command: cmdStr, success: false, error: err });
                if (ctx.flags.bail)
                    break;
                continue;
            }
            try {
                const parsedFlags = { _: [] };
                const consumedIndices = new Set();
                // Parse --flags from subArgs, tracking which indices are flag names/values
                for (let i = 0; i < subArgs.length; i++) {
                    if (subArgs[i].startsWith('--')) {
                        consumedIndices.add(i);
                        const key = subArgs[i].slice(2);
                        const next = subArgs[i + 1];
                        const optDef = subCmd.options?.find((o) => o.name === key);
                        const isBooleanFlag = optDef?.type === 'boolean';
                        if (next && (!next.startsWith('-') || /^-\d/.test(next)) && !isBooleanFlag) {
                            // Non-boolean flags consume the next token as their value (allow negative numbers like -1)
                            consumedIndices.add(i + 1);
                            if (optDef?.type === 'number') {
                                parsedFlags[key] = Number(next);
                            }
                            else {
                                parsedFlags[key] = next;
                            }
                            i++;
                        }
                        else if (isBooleanFlag && (next === 'true' || next === 'false')) {
                            // Explicit boolean value token
                            consumedIndices.add(i + 1);
                            parsedFlags[key] = next !== 'false';
                            i++;
                        }
                        else {
                            parsedFlags[key] = true;
                        }
                    }
                    else if (subArgs[i].startsWith('-') && subArgs[i].length === 2 && /[a-zA-Z]/.test(subArgs[i][1])) {
                        consumedIndices.add(i);
                        const shortKey = subArgs[i][1];
                        const optDef = subCmd.options?.find((o) => o.short === shortKey);
                        if (optDef) {
                            const key = optDef.name;
                            const next = subArgs[i + 1];
                            const isBooleanFlag = optDef.type === 'boolean';
                            if (next && (!next.startsWith('-') || /^-\d/.test(next)) && !isBooleanFlag) {
                                consumedIndices.add(i + 1);
                                parsedFlags[key] = optDef.type === 'number' ? Number(next) : next;
                                i++;
                            }
                            else if (isBooleanFlag && (next === 'true' || next === 'false')) {
                                consumedIndices.add(i + 1);
                                parsedFlags[key] = next !== 'false';
                                i++;
                            }
                            else {
                                parsedFlags[key] = true;
                            }
                        }
                    }
                }
                const fakeCtx = {
                    args: subArgs.filter((_, i) => !consumedIndices.has(i)),
                    flags: parsedFlags,
                    cwd: ctx.cwd,
                    interactive: false,
                };
                const cmdResult = await subCmd.action(fakeCtx);
                const succeeded = cmdResult?.success !== false;
                results.push({ command: cmdStr, success: succeeded, error: succeeded ? undefined : 'Command returned failure' });
                if (!succeeded && ctx.flags.bail)
                    break;
            }
            catch (e) {
                const err = e instanceof Error ? e.message : String(e);
                results.push({ command: cmdStr, success: false, error: err });
                output.printWarning(`Batch error in "${cmdStr}": ${err}`);
                if (ctx.flags.bail)
                    break;
            }
        }
        const failed = results.filter((r) => !r.success).length;
        output.printInfo(`Batch: ${results.length - failed}/${results.length} succeeded`);
        return { success: failed === 0, data: { results } };
    },
};
const addinitscriptCommand = {
    name: 'addinitscript',
    description: 'Add script to run before page navigation. Usage: monomind browse addinitscript "window.x=1"',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const script = ctx.args[0];
        if (!script)
            throw new Error('Usage: monomind browse addinitscript "<js>"');
        const id = await browser.addInitScript(client, sessionId, script);
        output.printSuccess(`Init script added: ${id}`);
        return { success: true, data: { identifier: id } };
    },
};
const removeinitscriptCommand = {
    name: 'removeinitscript',
    description: 'Remove a previously added init script. Usage: monomind browse removeinitscript <id>',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const id = ctx.args[0];
        if (!id)
            throw new Error('Usage: monomind browse removeinitscript <identifier>');
        await browser.removeInitScript(client, sessionId, id);
        output.printSuccess(`Init script removed: ${id}`);
        return { success: true };
    },
};
const connectCommand = {
    name: 'connect',
    description: 'Connect to existing Chrome instance. Usage: monomind browse connect [--port 9222] [--target <id>] [--auto-connect]',
    options: [
        { name: 'port', short: 'p', type: 'number', description: 'CDP port', default: 9222 },
        { name: 'target', type: 'string', description: 'Target ID to attach to' },
        { name: 'auto-connect', type: 'boolean', description: 'Auto-discover running Chrome on ports 9222 and 9229', default: false },
    ],
    action: async (ctx) => {
        let port = ctx.flags.port ?? 9222;
        if (ctx.flags['auto-connect']) {
            const probePorts = [9222, 9229];
            let found = false;
            for (const p of probePorts) {
                try {
                    const r = await fetch(`http://127.0.0.1:${p}/json/version`);
                    if (r.ok) {
                        port = p;
                        found = true;
                        break;
                    }
                }
                catch { /* port not open */ }
            }
            if (!found)
                throw new Error('No running Chrome instance found. Launch Chrome with --remote-debugging-port or use --port.');
        }
        const browser = await getBrowser();
        if (_client) {
            const prevSid = _sessionId;
            const prevClient = _client;
            if (browser.getHarStatus(prevSid).recording) {
                try {
                    await browser.stopHarRecording(prevClient, prevSid);
                }
                catch { /* ignore */ }
            }
            if (browser.getTraceStatus(prevSid)) {
                try {
                    await browser.stopTrace(prevClient, prevSid);
                }
                catch { /* ignore */ }
            }
            if (browser.isProfilingActive(prevSid)) {
                try {
                    await browser.stopCpuProfile(prevClient, prevSid);
                }
                catch { /* ignore */ }
            }
            browser.teardownRouteInterception(prevSid);
            browser.stopRequestCapture(prevSid);
            browser.teardownDialogHandling(prevSid);
            browser.teardownConsoleCapture(prevSid);
            prevClient.close();
            _client = null;
            _sessionId = '';
            _targetId = '';
            _refs = new Map();
        }
        const conn = await browser.connectToTarget(port, ctx.flags.target);
        _client = conn.client;
        _sessionId = conn.sessionId;
        _targetId = conn.target.id;
        _port = port;
        _refs = new Map();
        const url = await browser.getCurrentUrl(_client, _sessionId);
        const title = await browser.getCurrentTitle(_client, _sessionId);
        output.printSuccess(`Connected: ${title} (${url})`);
        return { success: true, data: { targetId: _targetId, url, title } };
    },
};
const recordCommand = {
    name: 'record',
    description: 'Screen recording. Usage: monomind browse record start|stop|restart|status [path]',
    options: [
        { name: 'format', type: 'string', description: 'jpeg|png', default: 'jpeg' },
        { name: 'quality', type: 'number', description: 'Quality 0-100', default: 80 },
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const action = ctx.args[0];
        if (!action)
            throw new Error('Usage: monomind browse record start|stop|restart|status');
        switch (action) {
            case 'start':
                await browser.startRecording(client, sessionId, {
                    format: ctx.flags.format,
                    quality: ctx.flags.quality,
                });
                output.printSuccess('Recording started');
                return { success: true };
            case 'stop': {
                const path = await browser.stopRecording(client, sessionId, ctx.args[1]);
                if (ctx.flags.json)
                    print(JSON.stringify({ data: { path } }));
                else
                    output.printSuccess(`Recording saved: ${path}`);
                return { success: true, data: { path } };
            }
            case 'restart': {
                const prevStatus = browser.getRecordingStatus(sessionId);
                let prevPath;
                if (prevStatus.recording) {
                    prevPath = await browser.stopRecording(client, sessionId, ctx.args[1]);
                    output.printInfo(`Previous recording saved: ${prevPath}`);
                }
                await browser.startRecording(client, sessionId, {
                    format: ctx.flags.format,
                    quality: ctx.flags.quality,
                });
                output.printSuccess('Recording restarted');
                return { success: true, data: { previous: prevPath } };
            }
            case 'status': {
                const status = browser.getRecordingStatus(sessionId);
                if (ctx.flags.json)
                    print(JSON.stringify({ data: status }));
                else
                    print(`Recording: ${status.recording} | Frames: ${status.frames}`);
                return { success: true, data: status };
            }
            default:
                throw new Error('Usage: monomind browse record start|stop|restart|status [path]');
        }
    },
};
const traceCommand = {
    name: 'trace',
    description: 'CDP performance trace. Usage: monomind browse trace start|stop [path]',
    options: [
        { name: 'screenshots', type: 'boolean', description: 'Include screenshots', default: false },
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const action = ctx.args[0];
        if (!action)
            throw new Error('Usage: monomind browse trace start|stop [path]');
        switch (action) {
            case 'start':
                await browser.startTrace(client, sessionId, { screenshots: ctx.flags.screenshots });
                output.printSuccess('Trace started');
                return { success: true };
            case 'stop': {
                const path = await browser.stopTrace(client, sessionId, ctx.args[1]);
                if (ctx.flags.json)
                    print(JSON.stringify({ data: { path } }));
                else
                    output.printSuccess(`Trace saved: ${path}`);
                return { success: true, data: { path } };
            }
            case 'status':
                print(browser.getTraceStatus(sessionId) ? 'Tracing active' : 'Not tracing');
                return { success: true };
            default:
                throw new Error('Usage: monomind browse trace start|stop|status [path]');
        }
    },
};
const profilerCommand = {
    name: 'profiler',
    description: 'CPU profiler. Usage: monomind browse profiler start|stop|heap [path]',
    options: [
        { name: 'interval', type: 'number', description: 'Sampling interval µs', default: 1000 },
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const action = ctx.args[0];
        if (!action)
            throw new Error('Usage: monomind browse profiler start|stop|heap [path]');
        switch (action) {
            case 'start':
                await browser.startCpuProfile(client, sessionId, { samplingInterval: ctx.flags.interval });
                output.printSuccess('CPU profiler started');
                return { success: true };
            case 'stop': {
                const path = await browser.stopCpuProfile(client, sessionId, ctx.args[1]);
                if (ctx.flags.json)
                    print(JSON.stringify({ data: { path } }));
                else
                    output.printSuccess(`Profile saved: ${path}`);
                return { success: true, data: { path } };
            }
            case 'heap': {
                const path = await browser.startHeapSnapshot(client, sessionId, ctx.args[1]);
                if (ctx.flags.json)
                    print(JSON.stringify({ data: { path } }));
                else
                    output.printSuccess(`Heap snapshot saved: ${path}`);
                return { success: true, data: { path } };
            }
            default:
                throw new Error('Usage: monomind browse profiler start|stop|heap [path]');
        }
    },
};
const vitalsCommand = {
    name: 'vitals',
    description: 'Collect Core Web Vitals. Usage: monomind browse vitals [--wait 2000]',
    options: [
        { name: 'wait', type: 'number', description: 'Wait ms for observers', default: 2000 },
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const vitals = await browser.collectVitals(client, sessionId, ctx.flags.wait);
        if (ctx.flags.json) {
            print(JSON.stringify({ data: vitals }));
        }
        else {
            print(browser.formatVitals(vitals));
        }
        return { success: true, data: vitals };
    },
};
const harCommand = {
    name: 'har',
    description: 'HAR network recording. Usage: monomind browse har start|stop|status [path]',
    options: [
        { name: 'bodies', type: 'boolean', description: 'Capture response bodies', default: false },
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    ],
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const action = ctx.args[0];
        if (!action)
            throw new Error('Usage: monomind browse har start|stop|status [path]');
        switch (action) {
            case 'start':
                await browser.startHarRecording(client, sessionId);
                output.printSuccess('HAR recording started');
                return { success: true };
            case 'stop': {
                const path = await browser.stopHarRecording(client, sessionId, ctx.args[1], ctx.flags.bodies);
                if (ctx.flags.json)
                    print(JSON.stringify({ data: { path } }));
                else
                    output.printSuccess(`HAR saved: ${path}`);
                return { success: true, data: { path } };
            }
            case 'status': {
                const status = browser.getHarStatus(sessionId);
                if (ctx.flags.json)
                    print(JSON.stringify({ data: status }));
                else
                    print(`Recording: ${status.recording} | Requests: ${status.requestCount}`);
                return { success: true, data: status };
            }
            default:
                throw new Error('Usage: monomind browse har start|stop|status [path]');
        }
    },
};
const resizeCommand = {
    name: 'resize',
    description: 'Resize browser window. Usage: monomind browse resize <width> <height>',
    action: async (ctx) => {
        const { client, sessionId } = await ensureConnected(_port);
        const browser = await getBrowser();
        const width = parseInt(ctx.args[0], 10);
        const height = parseInt(ctx.args[1], 10);
        if (isNaN(width) || isNaN(height))
            throw new Error('Usage: monomind browse resize <width> <height>');
        await browser.setViewport(client, sessionId, width, height);
        output.printSuccess(`Resized to ${width}x${height}`);
        return { success: true, data: { width, height } };
    },
};
// ---------------------------------------------------------------------------
// Commander-to-internal adapter
// ---------------------------------------------------------------------------
/**
 * Wraps a commander.Command instance as an internal Command object so it can
 * participate in the browse command's subcommands array.  The adapter
 * reconstructs a raw argv string from the context that was parsed by the
 * internal CLI, then hands it off to commander's parseAsync.
 */
function wrapCommanderCommand(factory) {
    // Lazily instantiate so we don't pay import cost at startup
    let _cmd = null;
    const getCmd = () => {
        if (!_cmd)
            _cmd = factory();
        return _cmd;
    };
    const cmd = getCmd();
    const subcommandDefs = cmd.commands.map((sub) => ({
        name: sub.name(),
        description: sub.description(),
        action: async (ctx) => {
            // Rebuild argv: node <cmd> <sub> [positional args] [--flag [value] ...]
            const argv = ['node', cmd.name(), sub.name(), ...ctx.args];
            for (const [key, val] of Object.entries(ctx.flags)) {
                if (key === '_')
                    continue;
                if (typeof val === 'boolean') {
                    if (val)
                        argv.push(`--${key}`);
                }
                else if (val !== undefined && val !== null) {
                    argv.push(`--${key}`, String(val));
                }
            }
            // Re-use the same commander instance to keep state (e.g. option defaults)
            await getCmd().parseAsync(argv, { from: 'user' });
            return { success: true };
        },
    }));
    return {
        name: cmd.name(),
        description: cmd.description(),
        subcommands: subcommandDefs,
        action: async (ctx) => {
            // No subcommand provided — show commander help
            const argv = ['node', cmd.name(), ...ctx.args];
            for (const [key, val] of Object.entries(ctx.flags)) {
                if (key === '_')
                    continue;
                if (typeof val === 'boolean') {
                    if (val)
                        argv.push(`--${key}`);
                }
                else if (val !== undefined && val !== null) {
                    argv.push(`--${key}`, String(val));
                }
            }
            await getCmd().parseAsync(argv, { from: 'user' });
            return { success: true };
        },
    };
}
const workflowSubcommand = wrapCommanderCommand(createWorkflowCommand);
// Expose both "playbook" (canonical) and "workflow" (backward-compat alias) in the internal dispatch table.
// Commander's .alias() only applies at Commander's own parse layer; the internal Command[] table
// routes by name, so we register both names pointing at the same underlying Commander instance.
const workflowAliasSubcommand = { ...workflowSubcommand, name: 'workflow' };
const actionSubcommand = wrapCommanderCommand(createActionCommand);
const platformSubcommand = wrapCommanderCommand(createPlatformCommand);
// ---------------------------------------------------------------------------
// Root browse command
// ---------------------------------------------------------------------------
const browseCommand = {
    name: 'browse',
    description: 'Native browser automation via Chrome DevTools Protocol',
    subcommands: [
        openCommand,
        snapshotCommand,
        clickCommand,
        dblclickCommand,
        fillCommand,
        typeCommand,
        pressCommand,
        keyboardCommand,
        keydownCommand,
        keyupCommand,
        hoverCommand,
        focusCommand,
        selectCommand,
        checkCommand,
        uncheckCommand,
        isvisibleCommand,
        isenabledCommand,
        ischeckedCommand,
        tapCommand,
        swipeCommand,
        scrollIntoViewCommand,
        dragCommand,
        uploadCommand,
        downloadCommand,
        mouseCommand,
        clipboardCommand,
        waitCommand,
        screenshotCommand,
        getCommand,
        scrollCommand,
        navigateCommand,
        setCommand,
        stateCommand,
        networkCommand,
        evalCommand,
        dialogCommand,
        frameCommand,
        tabCommand,
        windowCommand,
        consoleLogCommand,
        errorsCommand,
        storageCommand,
        cookiesCommand,
        pdfCommand,
        isCommand,
        findCommand,
        highlightCommand,
        diffCommand,
        pushstateCommand,
        batchCommand,
        addinitscriptCommand,
        removeinitscriptCommand,
        connectCommand,
        recordCommand,
        traceCommand,
        profilerCommand,
        vitalsCommand,
        harCommand,
        resizeCommand,
        closeCommand,
        workflowSubcommand,
        workflowAliasSubcommand,
        actionSubcommand,
        platformSubcommand,
    ],
    options: [
        { name: 'port', short: 'p', type: 'number', description: 'CDP debug port', default: 9222 },
        { name: 'session', short: 's', type: 'string', description: 'Named session to use' },
    ],
    examples: [
        { command: 'monomind browse open https://example.com', description: 'Open a URL' },
        { command: 'monomind browse snapshot -i', description: 'Interactive-only snapshot (93% token reduction)' },
        { command: 'monomind browse click @e3', description: 'Click element by ref' },
        { command: 'monomind browse fill @e1 "user@example.com"', description: 'Fill an input' },
        { command: 'monomind browse press Enter', description: 'Press Enter key' },
        { command: 'monomind browse wait --url "**/dashboard"', description: 'Wait for URL pattern' },
        { command: 'monomind browse wait --text "Success"', description: 'Wait for text' },
        { command: 'monomind browse wait --load networkidle', description: 'Wait for network idle' },
        { command: 'monomind browse screenshot ./output.png', description: 'Take screenshot' },
        { command: 'monomind browse get url', description: 'Get current URL' },
        { command: 'monomind browse scroll down', description: 'Scroll down 300px' },
        { command: 'monomind browse set viewport 375 812', description: 'Set mobile viewport' },
        { command: 'monomind browse state save my-session', description: 'Save session state' },
        { command: 'monomind browse navigate back', description: 'Navigate back' },
        { command: 'monomind browse eval "document.title"', description: 'Evaluate JavaScript' },
        { command: 'monomind browse network route --pattern "https://api.*" --abort', description: 'Abort API calls' },
        { command: 'monomind browse close', description: 'Close browser session' },
    ],
    action: async (_ctx) => {
        output.printInfo('Native browser automation via Chrome DevTools Protocol.');
        output.printInfo('');
        output.printInfo('Usage: monomind browse <subcommand> [options]');
        output.printInfo('');
        output.printInfo('Subcommands:');
        output.printInfo('  open           Open a URL');
        output.printInfo('  snapshot       Capture accessibility snapshot with refs');
        output.printInfo('  click          Click an element by ref');
        output.printInfo('  dblclick       Double-click an element');
        output.printInfo('  fill           Fill an input (clears first)');
        output.printInfo('  type           Type into element (appends)');
        output.printInfo('  press          Press a keyboard key');
        output.printInfo('  keyboard       Insert text directly');
        output.printInfo('  keydown        Hold a key down');
        output.printInfo('  keyup          Release a held key');
        output.printInfo('  hover          Hover over element');
        output.printInfo('  focus          Focus an element');
        output.printInfo('  select         Select a dropdown option');
        output.printInfo('  check          Check a checkbox');
        output.printInfo('  uncheck        Uncheck a checkbox');
        output.printInfo('  isvisible      Check if element is visible');
        output.printInfo('  isenabled      Check if element is enabled');
        output.printInfo('  ischecked      Check if checkbox/radio is checked');
        output.printInfo('  tap            Tap element with touch event (mobile)');
        output.printInfo('  scrollintoview Scroll element into view');
        output.printInfo('  drag           Drag element to another element');
        output.printInfo('  upload         Upload file(s) to file input');
        output.printInfo('  mouse          Fine-grained mouse control');
        output.printInfo('  clipboard      Read/write clipboard');
        output.printInfo('  wait           Wait for a condition');
        output.printInfo('  screenshot     Take a screenshot');
        output.printInfo('  get            Get page info (url, title, text, html)');
        output.printInfo('  scroll         Scroll the page');
        output.printInfo('  navigate       Navigate history (back/forward/reload)');
        output.printInfo('  set            Configure viewport, device, user agent');
        output.printInfo('  state          Save/load/list session state');
        output.printInfo('  network        Network interception and cookies');
        output.printInfo('  eval           Evaluate JavaScript');
        output.printInfo('  dialog         Handle browser dialogs');
        output.printInfo('  frame          Switch to iframe');
        output.printInfo('  tab            Tab management');
        output.printInfo('  console        View captured console messages');
        output.printInfo('  errors         View page JS errors');
        output.printInfo('  storage        localStorage/sessionStorage management');
        output.printInfo('  cookies        Cookie management');
        output.printInfo('  pdf            Save page as PDF');
        output.printInfo('  is             Check element state (visible/enabled/checked)');
        output.printInfo('  find           Find elements by semantic locators');
        output.printInfo('  highlight      Highlight an element visually');
        output.printInfo('  pushstate      SPA navigation via pushState');
        output.printInfo('  batch          Execute multiple commands');
        output.printInfo('  addinitscript  Add script to run before page navigation');
        output.printInfo('  removeinitscript Remove a previously added init script');
        output.printInfo('  close          Close the browser session');
        return { success: true };
    },
};
export default browseCommand;
//# sourceMappingURL=browse.js.map