// packages/@monomind/cli/src/__tests__/memory-kg-origin-refs.test.ts
// K3 regression: rollback precision depends on origin refs being unique per
// operation. The producers used to hard-code one ref for every invocation
// (`hooks-post-task`, `causal-edge-tool`), so every task's causal edges shared
// a single provenance bucket: rolling back one task withdrew all of them, and
// there was no ref that named just the one you wanted gone.
//
// This exercises the real store with the refs the boundary now mints.

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { postTaskOriginRef } from '../mcp-tools/hooks-routing.js';
import { causalEdgeOriginRef } from '../mcp-tools/memory-tools.js';
import { bridgeGetEntry } from '../memory/memory-bridge.js';
import { KG_NODES_NS, kgIngest, kgRollback, nodeKey } from '../memory/memory-kg.js';

// The bridge's traversal guard only allows dbPaths under cwd.
const FIXTURE_DIR = mkdtempSync(join(process.cwd(), '.tmp-kg-origin-refs-'));

/** Exactly what hooks_post-task writes, minus the store it writes it to. */
async function recordTask(taskId: string) {
  return kgIngest({
    nodes: [{ name: taskId }, { name: `outcome-${taskId}` }],
    edges: [{ source: taskId, target: `outcome-${taskId}`, relation: 'succeeded' }],
    originRef: postTaskOriginRef(taskId),
    dbPath: FIXTURE_DIR,
  });
}

const outcomeStored = async (taskId: string) =>
  (
    await bridgeGetEntry({
      key: nodeKey('entity', `outcome-${taskId}`),
      namespace: KG_NODES_NS,
      dbPath: FIXTURE_DIR,
    })
  )?.found === true;

describe('per-operation origin refs keep rollback surgical (K3)', () => {
  afterAll(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it('rolls back one task without withdrawing another task’s work', async () => {
    expect((await recordTask('task-alpha')).success).toBe(true);
    expect((await recordTask('task-beta')).success).toBe(true);
    expect(await outcomeStored('task-alpha')).toBe(true);
    expect(await outcomeStored('task-beta')).toBe(true);

    const rolled = await kgRollback({
      originRef: postTaskOriginRef('task-alpha'),
      dbPath: FIXTURE_DIR,
    });
    expect(rolled.success).toBe(true);
    expect(rolled.deleted).toBeGreaterThan(0);

    // Alpha is withdrawn; beta — which the shared ref used to take down with
    // it — survives untouched.
    expect(await outcomeStored('task-alpha')).toBe(false);
    expect(await outcomeStored('task-beta')).toBe(true);
  });

  it('rolls back one causal-edge assertion without withdrawing another', async () => {
    const assert_ = (source: string, relation: string, target: string) =>
      kgIngest({
        nodes: [{ name: source }, { name: target }],
        edges: [{ source, target, relation }],
        originRef: causalEdgeOriginRef(source, relation, target),
        dbPath: FIXTURE_DIR,
      });

    expect((await assert_('flaky-test', 'causes', 'ci-timeout')).success).toBe(true);
    expect((await assert_('stale-cache', 'causes', 'build-failure')).success).toBe(true);

    const rolled = await kgRollback({
      originRef: causalEdgeOriginRef('flaky-test', 'causes', 'ci-timeout'),
      dbPath: FIXTURE_DIR,
    });
    expect(rolled.success).toBe(true);

    const stored = async (name: string) =>
      (
        await bridgeGetEntry({
          key: nodeKey('entity', name),
          namespace: KG_NODES_NS,
          dbPath: FIXTURE_DIR,
        })
      )?.found === true;

    expect(await stored('ci-timeout')).toBe(false);
    expect(await stored('build-failure')).toBe(true);
  });
});
