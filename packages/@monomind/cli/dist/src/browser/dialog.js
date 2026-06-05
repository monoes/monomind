const _pendingDialogs = new Map();
const _dialogListeners = new Map();
export function setupDialogAutoHandling(client, sessionId, autoAccept = true) {
    if (_pendingDialogs.has(sessionId))
        return;
    _pendingDialogs.set(sessionId, null);
    const off1 = client.on('Page.javascriptDialogOpening', async (params, sid) => {
        if (sid !== sessionId)
            return;
        const info = {
            type: params.type,
            message: params.message,
            defaultPrompt: params.defaultPrompt,
        };
        _pendingDialogs.set(sessionId, info);
        if (autoAccept) {
            try {
                await client.send('Page.handleJavaScriptDialog', { accept: true }, sessionId);
            }
            catch { /* dialog may have already been dismissed */ }
            _pendingDialogs.set(sessionId, null);
        }
    });
    const off2 = client.on('Page.javascriptDialogClosed', (_, sid) => {
        if (sid === sessionId)
            _pendingDialogs.set(sessionId, null);
    });
    _dialogListeners.set(sessionId, [off1, off2]);
}
export function teardownDialogHandling(sessionId) {
    const offs = _dialogListeners.get(sessionId);
    if (offs) {
        for (const off of offs)
            off();
        _dialogListeners.delete(sessionId);
    }
    _pendingDialogs.delete(sessionId);
}
export async function acceptDialog(client, sessionId, text) {
    await client.send('Page.handleJavaScriptDialog', {
        accept: true,
        promptText: text,
    }, sessionId);
    _pendingDialogs.set(sessionId, null);
}
export async function dismissDialog(client, sessionId) {
    await client.send('Page.handleJavaScriptDialog', { accept: false }, sessionId);
    _pendingDialogs.set(sessionId, null);
}
export function getDialogStatus(sessionId) {
    return _pendingDialogs.get(sessionId) ?? null;
}
//# sourceMappingURL=dialog.js.map