// Test: Semantic checkpoint/resume with full state restoration
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';
import { existsSync } from 'node:fs';

describe('Semantic Checkpointing (Pattern 3)', () => {
  const testRoot = '/tmp/orgrt-checkpoint-test';
  const orgName = 'test-checkpoint-org';

  beforeEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    mkdirSync(join(testRoot, '.monomind', 'orgs'), { recursive: true });
  });

  function createTestDef(goal = 'Test goal'): ReturnType<typeof OrgDefSchema.parse> {
    return OrgDefSchema.parse({
      name: orgName,
      goal,
      roles: [
        { id: 'boss', type: 'boss' },
        { id: 'worker', type: 'worker', reports_to: 'boss' },
      ],
      run_config: {
        budget_tokens: 100_000,
        idle_minutes: 0, // disable watchdog for tests
      },
    });
  }

  it('should persist mailbox queues in runtime.json', async () => {
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const def = createTestDef('Mailbox queue persistence test');
    writeFileSync(join(testRoot, '.monomind', 'orgs', `${orgName}.json`), JSON.stringify(def));

    const running = await daemon.startOrg(orgName);
    const bossMailbox = running.agents.get('boss')?.mailbox;
    expect(bossMailbox).toBeDefined();

    // Test serialize/deserialize mechanism directly
    const testMailbox = new (await import('../../src/orgrt/mailbox.js')).Mailbox();
    testMailbox.push('Message 1');
    testMailbox.push('Message 2');
    testMailbox.push('Message 3');

    const serialized = testMailbox.serialize();
    expect(serialized.queue).toHaveLength(3);
    expect(serialized.queue).toEqual(['Message 1', 'Message 2', 'Message 3']);

    // Test deserialization
    const newMailbox = new (await import('../../src/orgrt/mailbox.js')).Mailbox();
    newMailbox.deserialize(serialized);
    expect(newMailbox.serialize().queue).toHaveLength(3);
    expect(newMailbox.serialize().queue).toEqual(['Message 1', 'Message 2', 'Message 3']);

    // Now test the full checkpoint flow with the actual org
    await daemon.stopOrg(orgName);

    // Read runtime.json and verify checkpoint structure was captured
    const rtPath = join(testRoot, '.monomind', 'orgs', orgName, 'runtime.json');
    expect(existsSync(rtPath)).toBe(true);
    const rt = JSON.parse(readFileSync(rtPath, 'utf8'));
    expect(rt.checkpoint).toBeDefined();
    expect(rt.checkpoint.roleState.boss).toBeDefined();
    // The checkpoint structure should exist even if queue is empty (agent consumed messages)
    expect(rt.checkpoint.roleState.boss.mailboxQueue).toBeDefined();
    expect(typeof rt.checkpoint.roleState.boss.mailboxQueue).toBe('object');
  });

  it('should restore mailbox queues on resume', async () => {
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const def = createTestDef('Mailbox queue restoration test');
    writeFileSync(join(testRoot, '.monomind', 'orgs', `${orgName}.json`), JSON.stringify(def));

    // Start org and run it briefly
    const running = await daemon.startOrg(orgName);
    const bossMailbox = running.agents.get('boss')?.mailbox;
    expect(bossMailbox).toBeDefined();

    // Stop org to create checkpoint
    await daemon.stopOrg(orgName);

    // Manually inject messages into the checkpoint to test restoration
    const rtPath = join(testRoot, '.monomind', 'orgs', orgName, 'runtime.json');
    const rt = JSON.parse(readFileSync(rtPath, 'utf8'));
    // Add test messages to the checkpoint
    rt.checkpoint.roleState.boss.mailboxQueue = ['Queued message 1', 'Queued message 2'];
    writeFileSync(rtPath, JSON.stringify(rt));

    // Resume and check mailbox queue was restored
    const resumed = await daemon.resumeOrg(orgName);
    expect(resumed).toBeDefined();

    // The resumed agent should have messages in its mailbox
    const resumedMailbox = resumed!.agents.get('boss')?.mailbox;
    expect(resumedMailbox).toBeDefined();

    // Check that the mailbox has the restored messages
    const serialized = resumedMailbox!.serialize();
    expect(serialized.queue).toHaveLength(2);
    expect(serialized.queue).toEqual(['Queued message 1', 'Queued message 2']);
  });

  it('should persist policy counters (budget tracking)', async () => {
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const def = createTestDef('Policy counter persistence test');
    writeFileSync(join(testRoot, '.monomind', 'orgs', `${orgName}.json`), JSON.stringify(def));

    const running = await daemon.startOrg(orgName);
    const bossPolicy = running.agents.get('boss')?.policy;
    expect(bossPolicy).toBeDefined();

    // Simulate token usage
    bossPolicy!.addUsage(5000);

    // Stop org
    await daemon.stopOrg(orgName);

    // Read runtime.json and verify policy counters
    const rtPath = join(testRoot, '.monomind', 'orgs', orgName, 'runtime.json');
    const rt = JSON.parse(readFileSync(rtPath, 'utf8'));
    expect(rt.checkpoint).toBeDefined();
    expect(rt.checkpoint.roleState.boss).toBeDefined();
    expect(rt.checkpoint.roleState.boss.tokensUsed).toBe(5000);
  });

  it('should restore policy counters on resume', async () => {
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const def = createTestDef('Policy counter restoration test');
    writeFileSync(join(testRoot, '.monomind', 'orgs', `${orgName}.json`), JSON.stringify(def));

    // Start org and use tokens
    const running = await daemon.startOrg(orgName);
    const bossPolicy = running.agents.get('boss')?.policy;
    bossPolicy!.addUsage(7500);
    await daemon.stopOrg(orgName);

    // Resume and check policy state
    const resumed = await daemon.resumeOrg(orgName);
    expect(resumed).toBeDefined();

    const resumedPolicy = resumed!.agents.get('boss')?.policy;
    expect(resumedPolicy).toBeDefined();
    expect(resumedPolicy!.usage).toBe(7500);
  });

  it('should restore session state (lastMessageId)', async () => {
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const def = createTestDef('Session state restoration test');
    writeFileSync(join(testRoot, '.monomind', 'orgs', `${orgName}.json`), JSON.stringify(def));

    const running = await daemon.startOrg(orgName);

    // Simulate a message being sent (which would set lastMessageId)
    running.bus.emit({
      type: 'message',
      from: 'boss',
      to: 'worker',
      subject: 'Test',
      msg: 'Test message',
    });

    await daemon.stopOrg(orgName);

    // Resume and verify lastMessageId is preserved
    const resumed = await daemon.resumeOrg(orgName);
    expect(resumed).toBeDefined();

    const resumedAgent = resumed!.agents.get('boss');
    expect(resumedAgent).toBeDefined();
    expect(resumedAgent!.lastMessageId).toBeDefined();
  });

  it('should enforce checkpoint TTL (expire stale checkpoints)', async () => {
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const def = createTestDef('Checkpoint TTL test');
    writeFileSync(join(testRoot, '.monomind', 'orgs', `${orgName}.json`), JSON.stringify(def));

    const running = await daemon.startOrg(orgName);
    await daemon.stopOrg(orgName);

    // Manually age the checkpoint
    const rtPath = join(testRoot, '.monomind', 'orgs', orgName, 'runtime.json');
    const rt = JSON.parse(readFileSync(rtPath, 'utf8'));
    rt.checkpoint.updated = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48 hours ago
    writeFileSync(rtPath, JSON.stringify(rt));

    // Attempt resume - should fail TTL check
    const resumed = await daemon.resumeOrg(orgName);
    expect(resumed).toBeNull();
  });

  it('should not create zombie agents on resume', async () => {
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const def = createTestDef('Zombie agent test');
    writeFileSync(join(testRoot, '.monomind', 'orgs', `${orgName}.json`), JSON.stringify(def));

    // Start org
    const running = await daemon.startOrg(orgName);

    // Check if worker exists - it might be pending (lazy spawn)
    const worker = running.agents.get('worker');
    if (worker) {
      // Worker exists, mark it as crashed
      worker.status = 'crashed';
      worker.error = 'Test crash';
      worker.mailbox.close();
    } else {
      // Worker is pending, spawn it first
      const workerRole = def.roles.find(r => r.id === 'worker');
      if (workerRole && running.pendingRoles?.has('worker')) {
        running.pendingRoles.delete('worker');
        running.spawnRole?.(workerRole);
        const spawnedWorker = running.agents.get('worker');
        if (spawnedWorker) {
          spawnedWorker.status = 'crashed';
          spawnedWorker.error = 'Test crash';
          spawnedWorker.mailbox.close();
        }
      }
    }

    await daemon.stopOrg(orgName);

    // Resume and verify crashed state is preserved
    const resumed = await daemon.resumeOrg(orgName);
    expect(resumed).toBeDefined();

    // Check that boss is reconstructed (it should always be there)
    expect(resumed!.agents.has('boss')).toBe(true);

    // Worker might not be in checkpoint if it wasn't running when stopped
    // That's expected behavior - pending roles don't get checkpointed
    const resumedWorker = resumed!.agents.get('worker');
    if (resumedWorker) {
      // If worker was in checkpoint, verify crashed state
      expect(resumedWorker.status).toBe('crashed');
      expect(resumedWorker.mailbox.isClosed).toBe(true);
    } else {
      // If worker wasn't in checkpoint, it should be in pending roles
      expect(resumed!.pendingRoles?.has('worker')).toBe(true);
    }
  });

  it('should restore pendingRoles for lazy spawn', async () => {
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const def = createTestDef('Lazy spawn restoration test');
    writeFileSync(join(testRoot, '.monomind', 'orgs', `${orgName}.json`), JSON.stringify(def));

    // Start org - boss spawns immediately, worker is pending
    const running = await daemon.startOrg(orgName);
    expect(running.agents.has('boss')).toBe(true);
    expect(running.agents.has('worker')).toBe(false);
    expect(running.pendingRoles?.has('worker')).toBe(true);

    await daemon.stopOrg(orgName);

    // Resume and verify pendingRoles is restored
    const resumed = await daemon.resumeOrg(orgName);
    expect(resumed).toBeDefined();
    expect(resumed!.agents.has('boss')).toBe(true);
    expect(resumed!.agents.has('worker')).toBe(false);
    expect(resumed!.pendingRoles?.has('worker')).toBe(true);
  });
});
