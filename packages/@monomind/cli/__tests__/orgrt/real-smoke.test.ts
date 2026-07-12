// packages/@monomind/cli/__tests__/orgrt/real-smoke.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { ORG_DIR } from '../../src/orgrt/types.js';

// Costs real subscription quota. Run explicitly:
//   MONOMIND_ORG_E2E=1 npx vitest run __tests__/orgrt/real-smoke.test.ts
const enabled = process.env.MONOMIND_ORG_E2E === '1';

describe.skipIf(!enabled)('real SDK smoke (subscription auth)', () => {
  it('a 1-agent org answers via the real engine and events hit the bus', async () => {
    const root = mkdtempSync(join(tmpdir(), 'real-'));
    mkdirSync(join(root, ORG_DIR), { recursive: true });
    writeFileSync(join(root, ORG_DIR, 'smoke.json'), JSON.stringify({
      name: 'smoke', goal: 'Reply with exactly the word PONG and end your turn.',
      run_config: { budget_tokens: 20000, max_turns_per_message: 2 },
      roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null,
                adapter_config: { model: 'claude-haiku-4-5-20251001' } }],
    }));
    const daemon = new OrgDaemon(root, { forward: false });
    const org = await daemon.startOrg('smoke');
    // wait for the boss session to finish its single turn (budget/turn capped)
    const t0 = Date.now();
    while (Date.now() - t0 < 120_000) {
      if (org.busEvents().some(e => e.type === 'chat' && /PONG/i.test(e.msg ?? ''))) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    await daemon.stopAll();
    const evs = org.busEvents();
    expect(evs.some(e => e.type === 'chat' && /PONG/i.test(e.msg ?? ''))).toBe(true);
    expect(evs.some(e => e.type === 'usage')).toBe(true);
  }, 180_000);
});
