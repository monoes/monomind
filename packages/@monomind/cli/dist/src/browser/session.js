import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { getCookies, setCookies, getLocalStorage, setLocalStorage, getSessionStorage, setSessionStorage } from './network.js';
const SESSION_DIR = join(homedir(), '.monomind', 'browser-sessions');
function validateSessionName(name) {
    if (!name || /[/\\\x00]/.test(name) || name === '..' || name === '.' || name.startsWith('..')) {
        throw new Error(`Invalid session name: ${JSON.stringify(name)}`);
    }
}
function validateFilePath(filePath) {
    if (!filePath || filePath.includes('\x00')) {
        throw new Error(`Invalid file path: ${JSON.stringify(filePath)}`);
    }
    if (filePath.includes('/../') || filePath.startsWith('../') || filePath.endsWith('/..') || filePath.includes('\\')) {
        throw new Error(`Invalid file path (traversal not allowed): ${JSON.stringify(filePath)}`);
    }
}
export async function saveSession(client, sessionId, targetId, name, url, title) {
    validateSessionName(name);
    await mkdir(SESSION_DIR, { recursive: true });
    const cookies = await getCookies(client, sessionId);
    const localStorage = await getLocalStorage(client, sessionId);
    const sessionStorage = await getSessionStorage(client, sessionId);
    const state = { targetId, sessionId, url, title, cookies, localStorage, sessionStorage };
    const filePath = join(SESSION_DIR, `${name}.json`);
    await writeFile(filePath, JSON.stringify(state, null, 2));
    return filePath;
}
export async function loadSession(client, sessionId, name) {
    validateSessionName(name);
    const filePath = join(SESSION_DIR, `${name}.json`);
    const raw = await readFile(filePath, 'utf8').catch((err) => {
        if (err.code === 'ENOENT')
            throw new Error(`Session not found: ${name}`);
        throw err;
    });
    const state = JSON.parse(raw);
    if (!Array.isArray(state.cookies))
        throw new Error(`Invalid session file: cookies is not an array`);
    await setCookies(client, sessionId, state.cookies);
    if (state.localStorage) {
        if (typeof state.localStorage !== 'object' || Array.isArray(state.localStorage))
            throw new Error('Invalid session file: localStorage is not a plain object');
        await setLocalStorage(client, sessionId, state.localStorage);
    }
    if (state.sessionStorage) {
        if (typeof state.sessionStorage !== 'object' || Array.isArray(state.sessionStorage))
            throw new Error('Invalid session file: sessionStorage is not a plain object');
        await setSessionStorage(client, sessionId, state.sessionStorage);
    }
    return state;
}
export async function saveStateFile(client, sessionId, targetId, filePath, url, title) {
    validateFilePath(filePath);
    await mkdir(dirname(filePath), { recursive: true });
    const cookies = await getCookies(client, sessionId);
    const localStorage = await getLocalStorage(client, sessionId);
    const sessionStorage = await getSessionStorage(client, sessionId);
    const state = { targetId, sessionId, url, title, cookies, localStorage, sessionStorage };
    await writeFile(filePath, JSON.stringify(state, null, 2));
}
export async function loadStateFile(client, sessionId, filePath) {
    validateFilePath(filePath);
    const raw = await readFile(filePath, 'utf8');
    const state = JSON.parse(raw);
    if (!Array.isArray(state.cookies))
        throw new Error(`Invalid state file: cookies is not an array`);
    await setCookies(client, sessionId, state.cookies);
    if (state.localStorage) {
        if (typeof state.localStorage !== 'object' || Array.isArray(state.localStorage))
            throw new Error('Invalid state file: localStorage is not a plain object');
        await setLocalStorage(client, sessionId, state.localStorage);
    }
    if (state.sessionStorage) {
        if (typeof state.sessionStorage !== 'object' || Array.isArray(state.sessionStorage))
            throw new Error('Invalid state file: sessionStorage is not a plain object');
        await setSessionStorage(client, sessionId, state.sessionStorage);
    }
    return state;
}
export async function listSessions() {
    const { readdir } = await import('fs/promises');
    const files = await readdir(SESSION_DIR).catch((err) => {
        if (err.code === 'ENOENT')
            return [];
        throw err;
    });
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}
//# sourceMappingURL=session.js.map