// packages/@monomind/cli/__tests__/orgrt/org-observe-replay.test.ts
//
// Regression test for #114: `org replay <name> <run>` validated the requested
// run id but then called daemon.resumeOrg(name), which resumes from whatever
// runtime.json's latest checkpoint happens to be — silently ignoring the
// requested run while claiming to have honored it. Fixed by calling
// daemon.replayFrom(name, run) instead.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { replayAction } from '../../src/commands/org-observe.js';
import type { CommandContext } from '../../src/types.js';

function fixture(root: string, name: string) {
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

function makeCtx(root: string, args: string[]): CommandContext {
  return { args, flags: { _: [] }, cwd: root, interactive: false };
}

describe('org replay CLI action — honors the requested run id (#114)', () => {
  it('replays from the OLDER requested run, not the latest checkpoint', async () => {
    const root = mkdtempSync(join(tmpdir(), 'org-observe-replay-'));
    try {
      fixture(root, 'alpha');
      const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });

      const first = await d.startOrg('alpha');
      const firstRun = first.run;
      await d.deliver('alpha', 'boss', 'coder', 'task', 'first task');
      await new Promise(r => setTimeout(r, 100));
      await d.stopOrg('alpha');

      const second = await d.startOrg('alpha');
      const secondRun = second.run;
      await d.deliver('alpha', 'boss', 'coder', 'task', 'second task');
      await new Promise(r => setTimeout(r, 100));
      await d.stopOrg('alpha');

      expect(firstRun).not.toBe(secondRun);

      // Ask specifically for the OLDER run — replayAction must not silently
      // resume from whatever is newest in runtime.json (that would be `secondRun`).
      const ctx = makeCtx(root, ['alpha', firstRun]);
      const result = await replayAction(ctx, 'alpha');

      expect(result.success).toBe(true);
      expect(result.message).toContain(firstRun);
    } finally {
      const { rmSync } = await import('node:fs');
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('returns a failure result for a nonexistent run instead of silently resuming latest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'org-observe-replay-missing-'));
    try {
      fixture(root, 'alpha');
      const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
      const run = await d.startOrg('alpha');
      await d.deliver('alpha', 'boss', 'coder', 'task', 'hello');
      await new Promise(r => setTimeout(r, 100));
      await d.stopOrg('alpha');
      void run;

      const ctx = makeCtx(root, ['alpha', 'run-nonexistent-0000']);
      const result = await replayAction(ctx, 'alpha');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    } finally {
      const { rmSync } = await import('node:fs');
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
});
