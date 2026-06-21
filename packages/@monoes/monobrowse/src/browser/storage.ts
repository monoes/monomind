import type { CdpClient } from './cdp.js';
import { evaluateJs } from './actions.js';

export async function getLocalStorageKey(client: CdpClient, sessionId: string, key: string): Promise<string | null> {
  const result = await evaluateJs(client, sessionId, `localStorage.getItem(${JSON.stringify(key)})`);
  return result as string | null;
}

export async function setLocalStorageKey(client: CdpClient, sessionId: string, key: string, value: string): Promise<void> {
  await evaluateJs(client, sessionId, `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
}

export async function removeLocalStorageKey(client: CdpClient, sessionId: string, key: string): Promise<void> {
  await evaluateJs(client, sessionId, `localStorage.removeItem(${JSON.stringify(key)})`);
}

export async function clearLocalStorage(client: CdpClient, sessionId: string): Promise<void> {
  await evaluateJs(client, sessionId, 'localStorage.clear()');
}

export async function getAllLocalStorage(client: CdpClient, sessionId: string): Promise<Record<string, string>> {
  const result = await evaluateJs(
    client,
    sessionId,
    'JSON.stringify(Object.fromEntries(Object.entries(localStorage)))'
  );
  try { return JSON.parse(result as string); } catch { return {}; }
}

export async function getSessionStorageKey(client: CdpClient, sessionId: string, key: string): Promise<string | null> {
  const result = await evaluateJs(client, sessionId, `sessionStorage.getItem(${JSON.stringify(key)})`);
  return result as string | null;
}

export async function setSessionStorageKey(client: CdpClient, sessionId: string, key: string, value: string): Promise<void> {
  await evaluateJs(client, sessionId, `sessionStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
}

export async function removeSessionStorageKey(client: CdpClient, sessionId: string, key: string): Promise<void> {
  await evaluateJs(client, sessionId, `sessionStorage.removeItem(${JSON.stringify(key)})`);
}

export async function clearSessionStorage(client: CdpClient, sessionId: string): Promise<void> {
  await evaluateJs(client, sessionId, 'sessionStorage.clear()');
}

export async function getAllSessionStorage(client: CdpClient, sessionId: string): Promise<Record<string, string>> {
  const result = await evaluateJs(
    client,
    sessionId,
    'JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))'
  );
  try { return JSON.parse(result as string); } catch { return {}; }
}
