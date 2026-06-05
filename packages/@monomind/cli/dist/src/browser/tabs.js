import { fetchTargets, fetchNewTarget } from './cdp.js';
export async function listTabs(port) {
    const targets = await fetchTargets(port);
    return targets.filter((t) => t.type === 'page');
}
export async function newTab(port, url = 'about:blank') {
    return fetchNewTarget(port, url);
}
export async function closeTab(client, _sessionId, targetId) {
    await client.send('Target.closeTarget', { targetId });
}
export async function activateTab(client, oldSessionId, targetId) {
    if (oldSessionId) {
        await client.send('Target.detachFromTarget', { sessionId: oldSessionId }).catch(() => { });
    }
    await client.send('Target.activateTarget', { targetId });
    const result = await client.send('Target.attachToTarget', { targetId, flatten: true });
    return result.sessionId;
}
export async function switchToFrame(_client, _sessionId, _frameSelector) {
    throw new Error('switchToFrame is not yet implemented. ' +
        'For same-origin frames, CDP commands already apply to the whole page. ' +
        'For cross-origin (OOPIF) frames, call Target.attachToTarget with the frame target ID.');
}
//# sourceMappingURL=tabs.js.map