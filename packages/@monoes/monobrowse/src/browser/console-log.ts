import type { CdpClient } from './cdp.js';

export interface ConsoleMessage {
  type: 'log' | 'error' | 'warn' | 'info' | 'debug' | 'verbose';
  text: string;
  timestamp: number;
  url?: string;
  lineNumber?: number;
}

export interface PageError {
  text: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  timestamp: number;
}

const _consoleMessages = new Map<string, ConsoleMessage[]>();
const _pageErrors = new Map<string, PageError[]>();
const _consoleListeners = new Map<string, Array<() => void>>();

function messagesFor(sessionId: string): ConsoleMessage[] {
  if (!_consoleMessages.has(sessionId)) _consoleMessages.set(sessionId, []);
  return _consoleMessages.get(sessionId)!;
}

function errorsFor(sessionId: string): PageError[] {
  if (!_pageErrors.has(sessionId)) _pageErrors.set(sessionId, []);
  return _pageErrors.get(sessionId)!;
}

export function setupConsoleCapture(client: CdpClient, sessionId: string): void {
  // Remove stale listeners from any prior connection on this sessionId
  const prevOffs = _consoleListeners.get(sessionId);
  if (prevOffs) { for (const off of prevOffs) off(); _consoleListeners.delete(sessionId); }

  _consoleMessages.set(sessionId, []);
  _pageErrors.set(sessionId, []);

  const off1 = client.on('Runtime.consoleAPICalled', (params, sid) => {
    if (sid !== sessionId) return;
    const args = (params.args as Array<{ value?: unknown; description?: string }>) ?? [];
    const text = args.map((a) => a.description ?? String(a.value ?? '')).join(' ');
    const rawType = (params.type as string) === 'warning' ? 'warn' : (params.type as string);
    messagesFor(sessionId).push({
      type: (rawType as ConsoleMessage['type']) ?? 'log',
      text,
      timestamp: Date.now(),
    });
  });

  const off2 = client.on('Log.entryAdded', (params, sid) => {
    if (sid !== sessionId) return;
    const entry = params.entry as { level?: string; text?: string; url?: string; lineNumber?: number };
    // CDP uses 'warning' but ConsoleMessage type uses 'warn'
    const rawLevel = entry.level === 'warning' ? 'warn' : entry.level;
    messagesFor(sessionId).push({
      type: (rawLevel as ConsoleMessage['type']) ?? 'log',
      text: entry.text ?? '',
      timestamp: Date.now(),
      url: entry.url,
      lineNumber: entry.lineNumber,
    });
  });

  const off3 = client.on('Runtime.exceptionThrown', (params, sid) => {
    if (sid !== sessionId) return;
    const detail = params.exceptionDetails as {
      text?: string;
      url?: string;
      lineNumber?: number;
      columnNumber?: number;
      exception?: { description?: string; value?: unknown };
    };
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

export async function enableConsoleCapture(client: CdpClient, sessionId: string): Promise<void> {
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Log.enable', {}, sessionId);
}

export function getConsoleMessages(sessionId?: string): ConsoleMessage[] {
  if (sessionId) return [...(messagesFor(sessionId))];
  // Fallback: return all messages across all sessions (legacy callers)
  return [..._consoleMessages.values()].flat();
}

export function clearConsoleMessages(sessionId?: string): void {
  if (sessionId) { _consoleMessages.set(sessionId, []); return; }
  _consoleMessages.clear();
}

export function getPageErrors(sessionId?: string): PageError[] {
  if (sessionId) return [...(errorsFor(sessionId))];
  return [..._pageErrors.values()].flat();
}

export function clearPageErrors(sessionId?: string): void {
  if (sessionId) { _pageErrors.set(sessionId, []); return; }
  _pageErrors.clear();
}

export function teardownConsoleCapture(sessionId: string): void {
  const offs = _consoleListeners.get(sessionId);
  if (offs) { for (const off of offs) off(); _consoleListeners.delete(sessionId); }
  _consoleMessages.delete(sessionId);
  _pageErrors.delete(sessionId);
}
