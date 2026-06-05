import { evaluateJs } from './actions.js';
export async function getLocalStorageKey(client, sessionId, key) {
    const result = await evaluateJs(client, sessionId, `localStorage.getItem(${JSON.stringify(key)})`);
    return result;
}
export async function setLocalStorageKey(client, sessionId, key, value) {
    await evaluateJs(client, sessionId, `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
}
export async function removeLocalStorageKey(client, sessionId, key) {
    await evaluateJs(client, sessionId, `localStorage.removeItem(${JSON.stringify(key)})`);
}
export async function clearLocalStorage(client, sessionId) {
    await evaluateJs(client, sessionId, 'localStorage.clear()');
}
export async function getAllLocalStorage(client, sessionId) {
    const result = await evaluateJs(client, sessionId, 'JSON.stringify(Object.fromEntries(Object.entries(localStorage)))');
    try {
        return JSON.parse(result);
    }
    catch {
        return {};
    }
}
export async function getSessionStorageKey(client, sessionId, key) {
    const result = await evaluateJs(client, sessionId, `sessionStorage.getItem(${JSON.stringify(key)})`);
    return result;
}
export async function setSessionStorageKey(client, sessionId, key, value) {
    await evaluateJs(client, sessionId, `sessionStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
}
export async function removeSessionStorageKey(client, sessionId, key) {
    await evaluateJs(client, sessionId, `sessionStorage.removeItem(${JSON.stringify(key)})`);
}
export async function clearSessionStorage(client, sessionId) {
    await evaluateJs(client, sessionId, 'sessionStorage.clear()');
}
export async function getAllSessionStorage(client, sessionId) {
    const result = await evaluateJs(client, sessionId, 'JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))');
    try {
        return JSON.parse(result);
    }
    catch {
        return {};
    }
}
//# sourceMappingURL=storage.js.map