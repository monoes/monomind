import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { SessionState, CdpCookie } from './types.js';
import type { CdpClient } from './cdp.js';
import { getCookiesForUrls, setCookies, getLocalStorage, setLocalStorage, getSessionStorage, setSessionStorage } from './network.js';

// Session state files contain cookies/localStorage — treat as secrets:
// owner-only read/write on the file (0600) and owner-only access on the
// containing directory (0700) so other local users can't read session tokens.
const SESSION_FILE_MODE = 0o600;
const SESSION_DIR_MODE = 0o700;

const SESSION_DIR = join(homedir(), '.monomind', 'browser-sessions');

function validateSessionName(name: string): void {
  if (!name || /[/\\\x00]/.test(name) || name === '..' || name === '.' || name.startsWith('..')) {
    throw new Error(`Invalid session name: ${JSON.stringify(name)}`);
  }
}

function validateFilePath(filePath: string): void {
  if (!filePath || filePath.includes('\x00')) {
    throw new Error(`Invalid file path: ${JSON.stringify(filePath)}`);
  }
  if (filePath.includes('/../') || filePath.startsWith('../') || filePath.endsWith('/..') || filePath.includes('\\')) {
    throw new Error(`Invalid file path (traversal not allowed): ${JSON.stringify(filePath)}`);
  }
}

export async function saveSession(
  client: CdpClient,
  sessionId: string,
  targetId: string,
  name: string,
  url: string,
  title: string
): Promise<string> {
  validateSessionName(name);
  await mkdir(SESSION_DIR, { recursive: true, mode: SESSION_DIR_MODE });

  const cookies = await getCookiesForUrls(client, sessionId, [url]);
  const localStorage = await getLocalStorage(client, sessionId);
  const sessionStorage = await getSessionStorage(client, sessionId);

  const state: SessionState = { targetId, sessionId, url, title, cookies, localStorage, sessionStorage };
  const filePath = join(SESSION_DIR, `${name}.json`);
  await writeFile(filePath, JSON.stringify(state, null, 2), { mode: SESSION_FILE_MODE });
  return filePath;
}

export async function loadSession(
  client: CdpClient,
  sessionId: string,
  name: string
): Promise<SessionState> {
  validateSessionName(name);
  const filePath = join(SESSION_DIR, `${name}.json`);
  const raw = await readFile(filePath, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') throw new Error(`Session not found: ${name}`);
    throw err;
  });
  const state: SessionState = JSON.parse(raw);
  if (!Array.isArray(state.cookies)) throw new Error(`Invalid session file: cookies is not an array`);

  await setCookies(client, sessionId, state.cookies);
  if (state.localStorage) {
    if (typeof state.localStorage !== 'object' || Array.isArray(state.localStorage)) throw new Error('Invalid session file: localStorage is not a plain object');
    await setLocalStorage(client, sessionId, state.localStorage);
  }
  if (state.sessionStorage) {
    if (typeof state.sessionStorage !== 'object' || Array.isArray(state.sessionStorage)) throw new Error('Invalid session file: sessionStorage is not a plain object');
    await setSessionStorage(client, sessionId, state.sessionStorage);
  }

  return state;
}

export async function saveStateFile(
  client: CdpClient,
  sessionId: string,
  targetId: string,
  filePath: string,
  url: string,
  title: string
): Promise<void> {
  validateFilePath(filePath);
  await mkdir(dirname(filePath), { recursive: true, mode: SESSION_DIR_MODE });
  const cookies = await getCookiesForUrls(client, sessionId, [url]);
  const localStorage = await getLocalStorage(client, sessionId);
  const sessionStorage = await getSessionStorage(client, sessionId);
  const state: SessionState = { targetId, sessionId, url, title, cookies, localStorage, sessionStorage };
  await writeFile(filePath, JSON.stringify(state, null, 2), { mode: SESSION_FILE_MODE });
}

export async function loadStateFile(
  client: CdpClient,
  sessionId: string,
  filePath: string
): Promise<SessionState> {
  validateFilePath(filePath);
  const raw = await readFile(filePath, 'utf8');
  const state: SessionState = JSON.parse(raw);
  if (!Array.isArray(state.cookies)) throw new Error(`Invalid state file: cookies is not an array`);
  await setCookies(client, sessionId, state.cookies);
  if (state.localStorage) {
    if (typeof state.localStorage !== 'object' || Array.isArray(state.localStorage)) throw new Error('Invalid state file: localStorage is not a plain object');
    await setLocalStorage(client, sessionId, state.localStorage);
  }
  if (state.sessionStorage) {
    if (typeof state.sessionStorage !== 'object' || Array.isArray(state.sessionStorage)) throw new Error('Invalid state file: sessionStorage is not a plain object');
    await setSessionStorage(client, sessionId, state.sessionStorage);
  }
  return state;
}

export async function listSessions(): Promise<string[]> {
  const { readdir } = await import('fs/promises');
  const files = await readdir(SESSION_DIR).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return [] as string[];
    throw err;
  });
  return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}
