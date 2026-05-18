import type { CdpClient } from './cdp.js';
import type { CdpTarget } from './types.js';
import { fetchTargets, fetchNewTarget } from './cdp.js';

export async function listTabs(port: number): Promise<CdpTarget[]> {
  const targets = await fetchTargets(port);
  return targets.filter((t) => t.type === 'page');
}

export async function newTab(port: number, url = 'about:blank'): Promise<CdpTarget> {
  return fetchNewTarget(port, url);
}

export async function closeTab(client: CdpClient, _sessionId: string, targetId: string): Promise<void> {
  await client.send('Target.closeTarget', { targetId });
}

export async function activateTab(client: CdpClient, oldSessionId: string, targetId: string): Promise<string> {
  if (oldSessionId) {
    await client.send('Target.detachFromTarget', { sessionId: oldSessionId }).catch(() => {});
  }
  await client.send('Target.activateTarget', { targetId });
  const result = await client.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
  return result.sessionId;
}

export async function switchToFrame(
  _client: CdpClient,
  _sessionId: string,
  _frameSelector: string
): Promise<string | null> {
  throw new Error(
    'switchToFrame is not yet implemented. ' +
    'For same-origin frames, CDP commands already apply to the whole page. ' +
    'For cross-origin (OOPIF) frames, call Target.attachToTarget with the frame target ID.'
  );
}
