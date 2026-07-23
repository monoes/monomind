// packages/@monomind/cli/__tests__/orgrt/daemon-resource-retry.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Regression: a non-boss role that failed its resource-gate check at boot used
// to be dropped with a plain `continue` — permanently gone for the org's whole
// life, with only an easy-to-miss audit log line. Real dev machines routinely
// sit right at the 15% memory threshold (see resource-governor.test.ts), so
// this silently ran orgs shorthanded. The fix must keep retrying in the
// background and spawn the role once capacity actually recovers.
let ok = true;
vi.mock('../../src/utils/resource-governor.js', () => ({
  checkResources: vi.fn(() => ({
    ok, freeMemMB: ok ? 2000 : 100, freeMemPct: ok ? 80 : 5,
    sdkProcesses: 0, maxSdkProcesses: 10,
    reason: ok ? undefined : 'low memory: simulated pressure',
  })),
  waitForCapacity: vi.fn(async () => ({
    ok, freeMemMB: ok ? 2000 : 100, freeMemPct: ok ? 80 : 5,
    sdkProcesses: 0, maxSdkProcesses: 10,
    reason: ok ? undefined : 'low memory: simulated pressure',
  })),
  getResourceLimits: vi.fn(() => ({ minFreeMemBytes: 0, maxSdkProcesses: 10, spawnStaggerMs: 0 })),
}));

const { OrgDaemon } = await import('../../src/orgrt/daemon.js');

function fixture(root: string, name: string): void {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(join(root, '.monomind/orgs', `${name}.json`), JSON.stringify({
    name, goal: `goal of ${name}`,
    roles: [
      { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
      { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' },
    ],
  }));
}

const echoQuery = ({ prompt }: any) => (async function* () {
  for await (const m of prompt) {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
    yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
  }
})();

async function waitUntil(pred: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await new Promise(r => setTimeout(r, 20));
  }
  return pred();
}

describe('OrgDaemon — deferred role spawn under resource pressure', () => {
  it('retries a role that failed its resource gate at boot instead of dropping it forever', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-resretry-'));
    fixture(root, 'alpha');

    ok = false; // boss always spawns; coder's gate will fail at boot
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const running = await d.startOrg('alpha');

    // Boss is up; coder was deferred, not dropped silently with no trace.
    expect(running.agents.has('boss')).toBe(true);
    expect(running.agents.has('coder')).toBe(false);
    expect(running.busEvents().some(e => e.from === 'coder' &&
      (e.reason === 'resource-pressure' || e.reason === 'resource-skip'))).toBe(true);

    // Resources recover — coder must spawn WITHOUT restarting the org.
    ok = true;
    const spawned = await waitUntil(() => running.agents.has('coder'));
    expect(spawned).toBe(true);
    expect(running.busEvents().some(e => e.from === 'coder' && e.reason === 'resource-recovered')).toBe(true);

    await d.stopAll();
  }, 20_000);
});
