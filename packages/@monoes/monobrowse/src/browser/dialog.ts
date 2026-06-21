import type { CdpClient } from './cdp.js';

export interface DialogInfo {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
  defaultPrompt?: string;
}

const _pendingDialogs = new Map<string, DialogInfo | null>();
const _dialogListeners = new Map<string, Array<() => void>>();

export function setupDialogAutoHandling(client: CdpClient, sessionId: string, autoAccept = true): void {
  if (_pendingDialogs.has(sessionId)) return;
  _pendingDialogs.set(sessionId, null);

  const off1 = client.on('Page.javascriptDialogOpening', async (params, sid) => {
    if (sid !== sessionId) return;

    const info: DialogInfo = {
      type: params.type as DialogInfo['type'],
      message: params.message as string,
      defaultPrompt: params.defaultPrompt as string | undefined,
    };

    _pendingDialogs.set(sessionId, info);

    if (autoAccept) {
      try {
        await client.send('Page.handleJavaScriptDialog', { accept: true }, sessionId);
      } catch { /* dialog may have already been dismissed */ }
      _pendingDialogs.set(sessionId, null);
    }
  });

  const off2 = client.on('Page.javascriptDialogClosed', (_, sid) => {
    if (sid === sessionId) _pendingDialogs.set(sessionId, null);
  });

  _dialogListeners.set(sessionId, [off1, off2]);
}

export function teardownDialogHandling(sessionId: string): void {
  const offs = _dialogListeners.get(sessionId);
  if (offs) { for (const off of offs) off(); _dialogListeners.delete(sessionId); }
  _pendingDialogs.delete(sessionId);
}

export async function acceptDialog(client: CdpClient, sessionId: string, text?: string): Promise<void> {
  await client.send('Page.handleJavaScriptDialog', {
    accept: true,
    promptText: text,
  }, sessionId);
  _pendingDialogs.set(sessionId, null);
}

export async function dismissDialog(client: CdpClient, sessionId: string): Promise<void> {
  await client.send('Page.handleJavaScriptDialog', { accept: false }, sessionId);
  _pendingDialogs.set(sessionId, null);
}

export function getDialogStatus(sessionId: string): DialogInfo | null {
  return _pendingDialogs.get(sessionId) ?? null;
}
