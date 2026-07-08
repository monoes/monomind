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
  client: CdpClient,
  sessionId: string,
  frameSelector: string
): Promise<string | null> {
  const { result } = await client.send<{ result: { result: { value: string | null } } }>(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(frameSelector)});
        if (!el || el.tagName !== 'IFRAME') return null;
        return el.src || null;
      })()`,
      returnByValue: true,
    },
    sessionId
  );
  const frameSrc = result?.result?.value ?? null;

  const { frameTree } = await client.send<{
    frameTree: { childFrames?: Array<{ frame: { id: string; url: string; securityOrigin: string } }> };
  }>('Page.getFrameTree', {}, sessionId);

  const match = frameTree.childFrames?.find(
    (cf) => cf.frame.url === frameSrc || cf.frame.id === frameSelector
  );
  if (!match) return frameSrc;

  const targets = await client.send<{ targetInfos: Array<{ targetId: string; type: string; url: string }> }>(
    'Target.getTargets', {}
  );
  const oopif = targets.targetInfos.find(
    (t) => t.type === 'iframe' && t.url === match.frame.url
  );
  if (oopif) {
    await client.send('Target.attachToTarget', { targetId: oopif.targetId, flatten: true });
  }

  return frameSrc;
}
