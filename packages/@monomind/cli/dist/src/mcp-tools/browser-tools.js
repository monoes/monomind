/**
 * Browser MCP Tools
 *
 * Uses @monoes/monobrowse CDP client directly — no external binary required.
 * Sessions are keyed by session ID; each maps to a persistent CDP connection
 * on the configured port (default: MONOBROWSE_CDP_PORT env var or 9222).
 */
const MAX_BROWSER_SESSIONS = 100;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
// Session registry for multi-session support (sessionId → connection)
const browserSessions = new Map();
const connectionCache = new Map();
function pruneExpiredSessions() {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, info] of browserSessions) {
        if (new Date(info.lastActivity).getTime() < cutoff) {
            browserSessions.delete(id);
            const conn = connectionCache.get(id);
            if (conn) {
                try {
                    conn.client.close();
                }
                catch { /* ignore */ }
            }
            connectionCache.delete(id);
        }
    }
}
function touchSession(sessionId) {
    const info = browserSessions.get(sessionId);
    if (info)
        info.lastActivity = new Date().toISOString();
}
async function getConnection(sessionId) {
    if (connectionCache.has(sessionId)) {
        const conn = connectionCache.get(sessionId);
        try {
            // Liveness check — evict stale CDP connections
            await conn.client.send('Runtime.evaluate', { expression: '1', returnByValue: true }, conn.cdpSessionId);
            return conn;
        }
        catch {
            connectionCache.delete(sessionId);
        }
    }
    const port = Number(process.env['MONOBROWSE_CDP_PORT'] ?? 9222);
    const { connectToTarget } = await import('@monoes/monobrowse');
    const { client, sessionId: cdpSessionId } = await connectToTarget(port);
    const conn = { client, cdpSessionId, refs: new Map() };
    connectionCache.set(sessionId, conn);
    return conn;
}
function releaseConnection(sessionId) {
    const conn = connectionCache.get(sessionId);
    if (conn) {
        try {
            conn.client.close();
        }
        catch { /* ignore */ }
    }
    connectionCache.delete(sessionId);
    browserSessions.delete(sessionId);
}
function ok(data = {}) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...data }, null, 2) }] };
}
function fail(message) {
    return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
    };
}
/** Validate a session ID against a strict allowlist. */
function validateSessionId(value) {
    if (value === undefined || value === null || value === '')
        return 'default';
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
        throw new Error('session: must match ^[A-Za-z0-9_-]{1,64}$');
    }
    return value;
}
/** Validate a URL against a scheme allowlist. */
const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:', 'about:']);
function validateUrl(value) {
    if (typeof value !== 'string')
        throw new Error('url: must be a string');
    if (value.length > 4096)
        throw new Error('url: too long (max 4096)');
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new Error(`url: not a valid URL: ${value}`);
    }
    if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
        throw new Error(`url: scheme "${parsed.protocol}" not allowed (only http/https/about)`);
    }
    return value;
}
/**
 * Validate a screenshot path. Resolved path must be within
 * `<projectRoot>/.monomind/screenshots` and must not already exist.
 */
async function validateScreenshotPath(value) {
    if (typeof value !== 'string' || value.length === 0)
        throw new Error('path: must be a non-empty string');
    if (value.startsWith('-'))
        throw new Error('path: must not start with "-"');
    const path = await import('node:path');
    const fs = await import('node:fs');
    const root = path.resolve(process.cwd(), '.monomind', 'screenshots');
    await fs.promises.mkdir(root, { recursive: true });
    const resolved = path.resolve(value);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        throw new Error(`path: must be within ${root}`);
    }
    if (fs.existsSync(resolved))
        throw new Error(`path: refuses to overwrite existing file at ${resolved}`);
    return resolved;
}
/** Reject strings starting with '-' (flag-injection defense). */
function rejectFlagLike(value, field) {
    if (typeof value !== 'string')
        throw new Error(`${field}: must be a string`);
    if (value.startsWith('-'))
        throw new Error(`${field}: must not start with '-' (flag-injection defense)`);
    return value;
}
/** Cap on browser_eval scripts. */
const MAX_BROWSER_EVAL_BYTES = 16 * 1024;
/**
 * Resolve an element target using monobrowse finders.
 * target: CSS selector string (e.g. "#id", ".class", "button")
 * locator: "selector" (default) | "role" | "text" | "label" | "placeholder"
 */
async function findElement(conn, target, locator = 'selector') {
    const { findBySelector, findByRole, findByText, findByLabel, findByPlaceholder, } = await import('@monoes/monobrowse');
    let ref = null;
    switch (locator) {
        case 'selector':
            ref = await findBySelector(conn.client, conn.cdpSessionId, conn.refs, target);
            break;
        case 'role':
            ref = await findByRole(conn.client, conn.cdpSessionId, conn.refs, target);
            break;
        case 'text':
            ref = await findByText(conn.client, conn.cdpSessionId, conn.refs, target);
            break;
        case 'label':
            ref = await findByLabel(conn.client, conn.cdpSessionId, conn.refs, target);
            break;
        case 'placeholder':
            ref = await findByPlaceholder(conn.client, conn.cdpSessionId, conn.refs, target);
            break;
        default: throw new Error(`Unknown locator "${locator}". Use: selector|role|text|label|placeholder`);
    }
    if (!ref)
        throw new Error(`Element not found: ${locator}="${target}"`);
    return ref;
}
// ---------------------------------------------------------------------------
// Exported tool list
// ---------------------------------------------------------------------------
export const browserTools = [
    // ==========================================================================
    // Navigation Tools
    // ==========================================================================
    {
        name: 'browser_open',
        description: 'Navigate browser to a URL via Chrome CDP (port set by MONOBROWSE_CDP_PORT, default 9222). Chrome must already be running with --remote-debugging-port.',
        category: 'browser',
        tags: ['navigation', 'web'],
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL to navigate to (http/https/about only)' },
                session: { type: 'string', description: 'Session ID (default: "default")' },
                waitUntil: {
                    type: 'string',
                    enum: ['load', 'domcontentloaded', 'networkidle'],
                    description: 'Wait condition after navigation',
                },
            },
            required: ['url'],
        },
        handler: async (input) => {
            const raw = input;
            let url;
            let sessionId;
            try {
                url = validateUrl(raw.url);
                sessionId = validateSessionId(raw.session);
            }
            catch (e) {
                return fail(e.message);
            }
            pruneExpiredSessions();
            if (!browserSessions.has(sessionId)) {
                if (browserSessions.size >= MAX_BROWSER_SESSIONS) {
                    const oldest = [...browserSessions.entries()]
                        .sort((a, b) => a[1].lastActivity.localeCompare(b[1].lastActivity))[0];
                    if (oldest)
                        releaseConnection(oldest[0]);
                }
                browserSessions.set(sessionId, {
                    sessionId,
                    createdAt: new Date().toISOString(),
                    lastActivity: new Date().toISOString(),
                });
            }
            try {
                const { openUrl, waitForLoad, getCurrentUrl, getCurrentTitle } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                await openUrl(conn.client, conn.cdpSessionId, url);
                const condition = raw.waitUntil ?? 'load';
                await waitForLoad(conn.client, conn.cdpSessionId, condition, 30000);
                touchSession(sessionId);
                return ok({
                    url: await getCurrentUrl(conn.client, conn.cdpSessionId),
                    title: await getCurrentTitle(conn.client, conn.cdpSessionId),
                    session: sessionId,
                });
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_back',
        description: 'Navigate back in browser history',
        category: 'browser',
        tags: ['navigation'],
        inputSchema: {
            type: 'object',
            properties: { session: { type: 'string', description: 'Session ID' } },
        },
        handler: async (input) => {
            const { session } = input;
            let sessionId;
            try {
                sessionId = validateSessionId(session);
            }
            catch (e) {
                return fail(e.message);
            }
            try {
                const conn = await getConnection(sessionId);
                await conn.client.send('Page.goBack', {}, conn.cdpSessionId);
                touchSession(sessionId);
                return ok();
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_forward',
        description: 'Navigate forward in browser history',
        category: 'browser',
        tags: ['navigation'],
        inputSchema: {
            type: 'object',
            properties: { session: { type: 'string', description: 'Session ID' } },
        },
        handler: async (input) => {
            const { session } = input;
            let sessionId;
            try {
                sessionId = validateSessionId(session);
            }
            catch (e) {
                return fail(e.message);
            }
            try {
                const conn = await getConnection(sessionId);
                await conn.client.send('Page.goForward', {}, conn.cdpSessionId);
                touchSession(sessionId);
                return ok();
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_reload',
        description: 'Reload the current page',
        category: 'browser',
        tags: ['navigation'],
        inputSchema: {
            type: 'object',
            properties: { session: { type: 'string', description: 'Session ID' } },
        },
        handler: async (input) => {
            const { session } = input;
            let sessionId;
            try {
                sessionId = validateSessionId(session);
            }
            catch (e) {
                return fail(e.message);
            }
            try {
                const conn = await getConnection(sessionId);
                await conn.client.send('Page.reload', {}, conn.cdpSessionId);
                touchSession(sessionId);
                return ok();
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_close',
        description: 'Close the browser session (releases CDP connection)',
        category: 'browser',
        tags: ['navigation'],
        inputSchema: {
            type: 'object',
            properties: { session: { type: 'string', description: 'Session ID' } },
        },
        handler: async (input) => {
            const { session } = input;
            let sessionId;
            try {
                sessionId = validateSessionId(session);
            }
            catch (e) {
                return fail(e.message);
            }
            releaseConnection(sessionId);
            return ok({ session: sessionId });
        },
    },
    // ==========================================================================
    // Snapshot Tools (AI-Optimized)
    // ==========================================================================
    {
        name: 'browser_snapshot',
        description: 'Get accessibility tree snapshot of the current page. Use element roles, names, and text from the output to target elements in subsequent interaction tools.',
        category: 'browser',
        tags: ['snapshot', 'ai'],
        inputSchema: {
            type: 'object',
            properties: {
                session: { type: 'string', description: 'Session ID' },
                interactive: { type: 'boolean', description: 'Only include interactive elements' },
                compact: { type: 'boolean', description: 'Remove empty structural elements' },
                depth: { type: 'number', description: 'Limit tree depth' },
                selector: { type: 'string', description: 'Scope snapshot to CSS selector' },
            },
        },
        handler: async (input) => {
            const raw = input;
            let sessionId;
            try {
                sessionId = validateSessionId(raw.session);
            }
            catch (e) {
                return fail(e.message);
            }
            try {
                const { captureSnapshot } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                let safeSel;
                if (raw.selector !== undefined)
                    safeSel = rejectFlagLike(raw.selector, 'selector');
                const result = await captureSnapshot(conn.client, conn.cdpSessionId, {
                    selector: safeSel,
                    interactiveOnly: raw.interactive ?? false,
                    compact: raw.compact ?? true,
                    maxDepth: raw.depth,
                });
                touchSession(sessionId);
                return ok({ snapshot: result });
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_screenshot',
        description: 'Capture a screenshot of the current page',
        category: 'browser',
        tags: ['snapshot', 'screenshot'],
        inputSchema: {
            type: 'object',
            properties: {
                session: { type: 'string', description: 'Session ID' },
                path: { type: 'string', description: 'Save path within .monomind/screenshots/ (returns dataUrl if omitted)' },
                fullPage: { type: 'boolean', description: 'Capture full scrollable page' },
            },
        },
        handler: async (input) => {
            const raw = input;
            let sessionId;
            let safePath;
            try {
                sessionId = validateSessionId(raw.session);
                if (raw.path !== undefined)
                    safePath = await validateScreenshotPath(raw.path);
            }
            catch (e) {
                return fail(e.message);
            }
            try {
                const { captureScreenshot } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                const { path: savedPath, dataUrl } = await captureScreenshot(conn.client, conn.cdpSessionId, {
                    path: safePath,
                    fullPage: raw.fullPage === true,
                    format: 'png',
                });
                touchSession(sessionId);
                return ok(safePath ? { path: savedPath } : { dataUrl });
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    // ==========================================================================
    // Interaction Tools
    // ==========================================================================
    {
        name: 'browser_click',
        description: 'Click an element. Use locator="selector" (CSS selector), "role", "text", "label", or "placeholder".',
        category: 'browser',
        tags: ['interaction'],
        inputSchema: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'CSS selector, role name, visible text, label text, or placeholder text' },
                locator: { type: 'string', enum: ['selector', 'role', 'text', 'label', 'placeholder'], description: 'How to find the element (default: selector)' },
                session: { type: 'string', description: 'Session ID' },
            },
            required: ['target'],
        },
        handler: async (input) => {
            const raw = input;
            let sessionId;
            let target;
            try {
                sessionId = validateSessionId(raw.session);
                target = rejectFlagLike(raw.target, 'target');
            }
            catch (e) {
                return fail(e.message);
            }
            const locator = typeof raw.locator === 'string' ? raw.locator : 'selector';
            try {
                const { clickElement } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                const ref = await findElement(conn, target, locator);
                await clickElement(conn.client, conn.cdpSessionId, ref);
                touchSession(sessionId);
                return ok();
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_fill',
        description: 'Clear and fill an input element with a value',
        category: 'browser',
        tags: ['interaction', 'form'],
        inputSchema: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'CSS selector, role, text, label, or placeholder' },
                value: { type: 'string', description: 'Value to fill' },
                locator: { type: 'string', enum: ['selector', 'role', 'text', 'label', 'placeholder'], description: 'How to find the element (default: selector)' },
                session: { type: 'string', description: 'Session ID' },
            },
            required: ['target', 'value'],
        },
        handler: async (input) => {
            const raw = input;
            let sessionId;
            let target;
            try {
                sessionId = validateSessionId(raw.session);
                target = rejectFlagLike(raw.target, 'target');
            }
            catch (e) {
                return fail(e.message);
            }
            if (typeof raw.value !== 'string')
                return fail('value: must be a string');
            const locator = typeof raw.locator === 'string' ? raw.locator : 'selector';
            try {
                const { fillElement } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                const ref = await findElement(conn, target, locator);
                await fillElement(conn.client, conn.cdpSessionId, ref, raw.value);
                touchSession(sessionId);
                return ok();
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_type',
        description: 'Type text character-by-character (useful for autocomplete, live-search, etc.)',
        category: 'browser',
        tags: ['interaction', 'form'],
        inputSchema: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'CSS selector, role, text, label, or placeholder' },
                text: { type: 'string', description: 'Text to type' },
                locator: { type: 'string', enum: ['selector', 'role', 'text', 'label', 'placeholder'], description: 'How to find the element (default: selector)' },
                session: { type: 'string', description: 'Session ID' },
            },
            required: ['target', 'text'],
        },
        handler: async (input) => {
            const raw = input;
            let sessionId;
            let target;
            try {
                sessionId = validateSessionId(raw.session);
                target = rejectFlagLike(raw.target, 'target');
            }
            catch (e) {
                return fail(e.message);
            }
            if (typeof raw.text !== 'string')
                return fail('text: must be a string');
            const locator = typeof raw.locator === 'string' ? raw.locator : 'selector';
            try {
                const { typeText, fillElement } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                const ref = await findElement(conn, target, locator);
                // Focus by clicking (filling with empty string focuses without clearing for type)
                await fillElement(conn.client, conn.cdpSessionId, ref, '');
                await typeText(conn.client, conn.cdpSessionId, raw.text);
                touchSession(sessionId);
                return ok();
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_press',
        description: 'Press a keyboard key or combo (e.g. "Enter", "Tab", "Escape", "Ctrl+A", "Shift+Tab")',
        category: 'browser',
        tags: ['interaction'],
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key name or combo (Enter, Tab, Escape, Ctrl+A, Shift+Tab, etc.)' },
                session: { type: 'string', description: 'Session ID' },
            },
            required: ['key'],
        },
        handler: async (input) => {
            const raw = input;
            let sessionId;
            let key;
            try {
                sessionId = validateSessionId(raw.session);
                key = rejectFlagLike(raw.key, 'key');
            }
            catch (e) {
                return fail(e.message);
            }
            try {
                const { pressKey, pressKeyCombo } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                if (key.includes('+')) {
                    const parts = key.split('+').map(k => k.trim());
                    const mainKey = parts[parts.length - 1];
                    let bits = 0;
                    for (const m of parts.slice(0, -1)) {
                        switch (m.toLowerCase()) {
                            case 'alt':
                                bits |= 1;
                                break;
                            case 'ctrl':
                            case 'control':
                                bits |= 2;
                                break;
                            case 'meta':
                            case 'cmd':
                                bits |= 4;
                                break;
                            case 'shift':
                                bits |= 8;
                                break;
                        }
                    }
                    await pressKeyCombo(conn.client, conn.cdpSessionId, mainKey, bits);
                }
                else {
                    await pressKey(conn.client, conn.cdpSessionId, key);
                }
                touchSession(sessionId);
                return ok();
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_hover',
        description: 'Hover the mouse over an element',
        category: 'browser',
        tags: ['interaction'],
        inputSchema: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'CSS selector, role, text, label, or placeholder' },
                locator: { type: 'string', enum: ['selector', 'role', 'text', 'label', 'placeholder'], description: 'How to find the element (default: selector)' },
                session: { type: 'string', description: 'Session ID' },
            },
            required: ['target'],
        },
        handler: async (input) => {
            const raw = input;
            let sessionId;
            let target;
            try {
                sessionId = validateSessionId(raw.session);
                target = rejectFlagLike(raw.target, 'target');
            }
            catch (e) {
                return fail(e.message);
            }
            const locator = typeof raw.locator === 'string' ? raw.locator : 'selector';
            try {
                const { hoverElement } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                const ref = await findElement(conn, target, locator);
                await hoverElement(conn.client, conn.cdpSessionId, ref);
                touchSession(sessionId);
                return ok();
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_select',
        description: 'Select an option from a <select> dropdown by value or label',
        category: 'browser',
        tags: ['interaction', 'form'],
        inputSchema: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'CSS selector, role, text, label, or placeholder for the <select>' },
                value: { type: 'string', description: 'Option value or visible text to select' },
                locator: { type: 'string', enum: ['selector', 'role', 'text', 'label', 'placeholder'], description: 'How to find the element (default: selector)' },
                session: { type: 'string', description: 'Session ID' },
            },
            required: ['target', 'value'],
        },
        handler: async (input) => {
            const raw = input;
            let sessionId;
            let target;
            try {
                sessionId = validateSessionId(raw.session);
                target = rejectFlagLike(raw.target, 'target');
            }
            catch (e) {
                return fail(e.message);
            }
            if (typeof raw.value !== 'string')
                return fail('value: must be a string');
            const locator = typeof raw.locator === 'string' ? raw.locator : 'selector';
            try {
                const { selectOption } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                const ref = await findElement(conn, target, locator);
                await selectOption(conn.client, conn.cdpSessionId, ref, raw.value);
                touchSession(sessionId);
                return ok();
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_check',
        description: 'Check a checkbox or radio button',
        category: 'browser',
        tags: ['interaction', 'form'],
        inputSchema: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'CSS selector, role, text, label, or placeholder' },
                locator: { type: 'string', enum: ['selector', 'role', 'text', 'label', 'placeholder'], description: 'How to find the element (default: selector)' },
                session: { type: 'string', description: 'Session ID' },
            },
            required: ['target'],
        },
        handler: async (input) => {
            const raw = input;
            let sessionId;
            let target;
            try {
                sessionId = validateSessionId(raw.session);
                target = rejectFlagLike(raw.target, 'target');
            }
            catch (e) {
                return fail(e.message);
            }
            const locator = typeof raw.locator === 'string' ? raw.locator : 'selector';
            try {
                const { checkElement } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                const ref = await findElement(conn, target, locator);
                await checkElement(conn.client, conn.cdpSessionId, ref, true);
                touchSession(sessionId);
                return ok();
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_uncheck',
        description: 'Uncheck a checkbox',
        category: 'browser',
        tags: ['interaction', 'form'],
        inputSchema: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'CSS selector, role, text, label, or placeholder' },
                locator: { type: 'string', enum: ['selector', 'role', 'text', 'label', 'placeholder'], description: 'How to find the element (default: selector)' },
                session: { type: 'string', description: 'Session ID' },
            },
            required: ['target'],
        },
        handler: async (input) => {
            const raw = input;
            let sessionId;
            let target;
            try {
                sessionId = validateSessionId(raw.session);
                target = rejectFlagLike(raw.target, 'target');
            }
            catch (e) {
                return fail(e.message);
            }
            const locator = typeof raw.locator === 'string' ? raw.locator : 'selector';
            try {
                const { checkElement } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                const ref = await findElement(conn, target, locator);
                await checkElement(conn.client, conn.cdpSessionId, ref, false);
                touchSession(sessionId);
                return ok();
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_scroll',
        description: 'Scroll the page or a specific element',
        category: 'browser',
        tags: ['interaction'],
        inputSchema: {
            type: 'object',
            properties: {
                direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
                amount: { type: 'number', description: 'Scroll amount in pixels (default 300)' },
                target: { type: 'string', description: 'Optional CSS selector to scroll a specific element' },
                session: { type: 'string', description: 'Session ID' },
            },
            required: ['direction'],
        },
        handler: async (input) => {
            const raw = input;
            let sessionId;
            try {
                sessionId = validateSessionId(raw.session);
            }
            catch (e) {
                return fail(e.message);
            }
            const direction = raw.direction ?? 'down';
            const amount = raw.amount ?? 300;
            try {
                const { scrollElement } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                if (raw.target !== undefined) {
                    const ref = await findElement(conn, rejectFlagLike(raw.target, 'target'), 'selector');
                    await scrollElement(conn.client, conn.cdpSessionId, direction, amount, ref);
                }
                else {
                    await scrollElement(conn.client, conn.cdpSessionId, direction, amount);
                }
                touchSession(sessionId);
                return ok();
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    // ==========================================================================
    // Information Retrieval Tools
    // ==========================================================================
    {
        name: 'browser_get-text',
        description: 'Get inner text of an element',
        category: 'browser',
        tags: ['info'],
        inputSchema: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'CSS selector, role, text, label, or placeholder' },
                locator: { type: 'string', enum: ['selector', 'role', 'text', 'label', 'placeholder'], description: 'How to find the element (default: selector)' },
                session: { type: 'string', description: 'Session ID' },
            },
            required: ['target'],
        },
        handler: async (input) => {
            const raw = input;
            let sessionId;
            let target;
            try {
                sessionId = validateSessionId(raw.session);
                target = rejectFlagLike(raw.target, 'target');
            }
            catch (e) {
                return fail(e.message);
            }
            const locator = typeof raw.locator === 'string' ? raw.locator : 'selector';
            try {
                const conn = await getConnection(sessionId);
                const ref = await findElement(conn, target, locator);
                const res = await conn.client.send('Runtime.callFunctionOn', { objectId: ref.objectId, functionDeclaration: 'function(){return this.innerText??this.textContent??""}', returnByValue: true }, conn.cdpSessionId);
                touchSession(sessionId);
                return ok({ text: res.result.value });
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_get-value',
        description: 'Get value of an input element',
        category: 'browser',
        tags: ['info', 'form'],
        inputSchema: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'CSS selector, role, text, label, or placeholder' },
                locator: { type: 'string', enum: ['selector', 'role', 'text', 'label', 'placeholder'], description: 'How to find the element (default: selector)' },
                session: { type: 'string', description: 'Session ID' },
            },
            required: ['target'],
        },
        handler: async (input) => {
            const raw = input;
            let sessionId;
            let target;
            try {
                sessionId = validateSessionId(raw.session);
                target = rejectFlagLike(raw.target, 'target');
            }
            catch (e) {
                return fail(e.message);
            }
            const locator = typeof raw.locator === 'string' ? raw.locator : 'selector';
            try {
                const conn = await getConnection(sessionId);
                const ref = await findElement(conn, target, locator);
                const res = await conn.client.send('Runtime.callFunctionOn', { objectId: ref.objectId, functionDeclaration: 'function(){return this.value??""}', returnByValue: true }, conn.cdpSessionId);
                touchSession(sessionId);
                return ok({ value: res.result.value });
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_get-title',
        description: 'Get the current page title',
        category: 'browser',
        tags: ['info'],
        inputSchema: {
            type: 'object',
            properties: { session: { type: 'string', description: 'Session ID' } },
        },
        handler: async (input) => {
            const { session } = input;
            let sessionId;
            try {
                sessionId = validateSessionId(session);
            }
            catch (e) {
                return fail(e.message);
            }
            try {
                const { getCurrentTitle } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                const title = await getCurrentTitle(conn.client, conn.cdpSessionId);
                touchSession(sessionId);
                return ok({ title });
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    {
        name: 'browser_get-url',
        description: 'Get the current page URL',
        category: 'browser',
        tags: ['info'],
        inputSchema: {
            type: 'object',
            properties: { session: { type: 'string', description: 'Session ID' } },
        },
        handler: async (input) => {
            const { session } = input;
            let sessionId;
            try {
                sessionId = validateSessionId(session);
            }
            catch (e) {
                return fail(e.message);
            }
            try {
                const { getCurrentUrl } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                const url = await getCurrentUrl(conn.client, conn.cdpSessionId);
                touchSession(sessionId);
                return ok({ url });
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    // ==========================================================================
    // Wait Tools
    // ==========================================================================
    {
        name: 'browser_wait',
        description: 'Wait for a CSS selector to appear, a URL pattern, page load, or a fixed duration',
        category: 'browser',
        tags: ['wait'],
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector to wait for' },
                url: { type: 'string', description: 'URL substring to wait for in current URL' },
                load: { type: 'boolean', description: 'Wait for page load event' },
                duration: { type: 'number', description: 'Wait a fixed number of milliseconds (max 60000)' },
                timeout: { type: 'number', description: 'Timeout in ms for selector/url/load conditions (default 30000)' },
                session: { type: 'string', description: 'Session ID' },
            },
        },
        handler: async (input) => {
            const raw = input;
            let sessionId;
            try {
                sessionId = validateSessionId(raw.session);
            }
            catch (e) {
                return fail(e.message);
            }
            const timeout = Math.min(Math.max(Number(raw.timeout ?? 30000), 0), 60000);
            try {
                const { waitFor, waitForLoad } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                if (raw.duration !== undefined) {
                    const ms = Math.min(Math.max(Number(raw.duration), 0), 60000);
                    await new Promise(r => setTimeout(r, ms));
                }
                else if (raw.selector !== undefined) {
                    await waitFor(conn.client, conn.cdpSessionId, { selector: rejectFlagLike(raw.selector, 'selector'), timeout });
                }
                else if (raw.url !== undefined) {
                    await waitFor(conn.client, conn.cdpSessionId, { url: validateUrl(raw.url), timeout });
                }
                else if (raw.load) {
                    await waitForLoad(conn.client, conn.cdpSessionId, 'load', timeout);
                }
                else {
                    return fail('browser_wait: provide selector, url, load:true, or duration');
                }
                touchSession(sessionId);
                return ok();
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    // ==========================================================================
    // JavaScript Execution
    // ==========================================================================
    {
        name: 'browser_eval',
        description: 'Execute JavaScript in page context. Requires MONOMIND_ALLOW_BROWSER_EVAL=1 env var.',
        category: 'browser',
        tags: ['eval', 'js'],
        inputSchema: {
            type: 'object',
            properties: {
                script: { type: 'string', description: 'JavaScript expression to evaluate' },
                session: { type: 'string', description: 'Session ID' },
            },
            required: ['script'],
        },
        handler: async (input) => {
            // SECURITY: browser_eval runs arbitrary JS with the browser's session cookies.
            // Require explicit operator opt-in via env var to prevent SSRF / credential theft.
            if (process.env['MONOMIND_ALLOW_BROWSER_EVAL'] !== '1') {
                return fail('browser_eval is disabled by default. Set MONOMIND_ALLOW_BROWSER_EVAL=1 to enable.');
            }
            const raw = input;
            if (typeof raw.script !== 'string')
                return fail('script: must be a string');
            if (raw.script.length > MAX_BROWSER_EVAL_BYTES)
                return fail(`script: too long (max ${MAX_BROWSER_EVAL_BYTES})`);
            let sessionId;
            try {
                sessionId = validateSessionId(raw.session);
            }
            catch (e) {
                return fail(e.message);
            }
            // Audit log every eval call
            try {
                const crypto = await import('node:crypto');
                const hash = crypto.createHash('sha256').update(raw.script).digest('hex').slice(0, 16);
                console.error(`[${new Date().toISOString()}] AUDIT browser_eval session=${sessionId} script_sha256_16=${hash}`);
            }
            catch { /* best-effort */ }
            try {
                const { evaluateJs } = await import('@monoes/monobrowse');
                const conn = await getConnection(sessionId);
                const result = await evaluateJs(conn.client, conn.cdpSessionId, raw.script);
                touchSession(sessionId);
                return ok({ result });
            }
            catch (e) {
                return fail(e.message);
            }
        },
    },
    // ==========================================================================
    // Session Management
    // ==========================================================================
    {
        name: 'browser_session-list',
        description: 'List active browser sessions',
        category: 'browser',
        tags: ['session'],
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
            pruneExpiredSessions();
            const sessions = Array.from(browserSessions.values());
            return ok({ sessions, count: sessions.length });
        },
    },
];
export default browserTools;
//# sourceMappingURL=browser-tools.js.map