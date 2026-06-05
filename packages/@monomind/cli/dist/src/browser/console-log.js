const _consoleMessages = new Map();
const _pageErrors = new Map();
const _consoleListeners = new Map();
function messagesFor(sessionId) {
    if (!_consoleMessages.has(sessionId))
        _consoleMessages.set(sessionId, []);
    return _consoleMessages.get(sessionId);
}
function errorsFor(sessionId) {
    if (!_pageErrors.has(sessionId))
        _pageErrors.set(sessionId, []);
    return _pageErrors.get(sessionId);
}
export function setupConsoleCapture(client, sessionId) {
    // Remove stale listeners from any prior connection on this sessionId
    const prevOffs = _consoleListeners.get(sessionId);
    if (prevOffs) {
        for (const off of prevOffs)
            off();
        _consoleListeners.delete(sessionId);
    }
    _consoleMessages.set(sessionId, []);
    _pageErrors.set(sessionId, []);
    const off1 = client.on('Runtime.consoleAPICalled', (params, sid) => {
        if (sid !== sessionId)
            return;
        const args = params.args ?? [];
        const text = args.map((a) => a.description ?? String(a.value ?? '')).join(' ');
        const rawType = params.type === 'warning' ? 'warn' : params.type;
        messagesFor(sessionId).push({
            type: rawType ?? 'log',
            text,
            timestamp: Date.now(),
        });
    });
    const off2 = client.on('Log.entryAdded', (params, sid) => {
        if (sid !== sessionId)
            return;
        const entry = params.entry;
        // CDP uses 'warning' but ConsoleMessage type uses 'warn'
        const rawLevel = entry.level === 'warning' ? 'warn' : entry.level;
        messagesFor(sessionId).push({
            type: rawLevel ?? 'log',
            text: entry.text ?? '',
            timestamp: Date.now(),
            url: entry.url,
            lineNumber: entry.lineNumber,
        });
    });
    const off3 = client.on('Runtime.exceptionThrown', (params, sid) => {
        if (sid !== sessionId)
            return;
        const detail = params.exceptionDetails;
        const message = detail.exception?.description ?? detail.text ?? 'Unknown error';
        errorsFor(sessionId).push({
            text: message,
            url: detail.url,
            lineNumber: detail.lineNumber,
            columnNumber: detail.columnNumber,
            timestamp: Date.now(),
        });
    });
    _consoleListeners.set(sessionId, [off1, off2, off3]);
}
export async function enableConsoleCapture(client, sessionId) {
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Log.enable', {}, sessionId);
}
export function getConsoleMessages(sessionId) {
    if (sessionId)
        return [...(messagesFor(sessionId))];
    // Fallback: return all messages across all sessions (legacy callers)
    return [..._consoleMessages.values()].flat();
}
export function clearConsoleMessages(sessionId) {
    if (sessionId) {
        _consoleMessages.set(sessionId, []);
        return;
    }
    _consoleMessages.clear();
}
export function getPageErrors(sessionId) {
    if (sessionId)
        return [...(errorsFor(sessionId))];
    return [..._pageErrors.values()].flat();
}
export function clearPageErrors(sessionId) {
    if (sessionId) {
        _pageErrors.set(sessionId, []);
        return;
    }
    _pageErrors.clear();
}
export function teardownConsoleCapture(sessionId) {
    const offs = _consoleListeners.get(sessionId);
    if (offs) {
        for (const off of offs)
            off();
        _consoleListeners.delete(sessionId);
    }
    _consoleMessages.delete(sessionId);
    _pageErrors.delete(sessionId);
}
//# sourceMappingURL=console-log.js.map