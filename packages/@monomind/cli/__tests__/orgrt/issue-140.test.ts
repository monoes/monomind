// packages/@monomind/cli/__tests__/orgrt/issue-140.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { OrgDefSchema, DEFAULT_MAX_TURNS_PER_MESSAGE } from '../../src/orgrt/types.js';
import { ORG_TEMPLATES, buildFromTemplate } from '../../src/orgrt/templates.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { runAgentSession, type SessionOpts } from '../../src/orgrt/session.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import type { AgentRunner, AgentRunArgs, AgentMessage } from '../../src/orgrt/agent-runner.js';

describe('Issue 140 Comprehensive Fixes', () => {
  const testRoot = '/tmp/orgrt-issue-140-test';
  const orgName = 'issue-140-org';

  beforeEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    mkdirSync(join(testRoot, '.monomind', 'orgs'), { recursive: true });
  });

  function createTestDef(goal = 'Issue 140 test goal'): ReturnType<typeof OrgDefSchema.parse> {
    return OrgDefSchema.parse({
      name: orgName,
      goal,
      roles: [
        { id: 'boss', type: 'boss', max_turns_per_message: 15 },
        { id: 'worker', type: 'worker', reports_to: 'boss', max_turns_per_message: 25 },
      ],
      run_config: {
        budget_tokens: 100_000,
        max_turns_per_message: 30,
        idle_minutes: 0,
      },
    });
  }

  describe('1. Max Turns Error Recovery (no crash, continuation granted)', () => {
    it('recovers from Reached maximum number of turns error with fresh session and continuation message', async () => {
      const bus = new OrgBus(orgName, 'run-1', join(testRoot, 'bus'));
      const mailbox = new Mailbox();
      const policy = new PolicyEngine('worker', { maxTokens: 50_000 }, bus, testRoot);
      const def = createTestDef();
      const events: any[] = [];
      bus.subscribe((e) => events.push(e));

      let callCount = 0;

      const mockRunner: AgentRunner = {
        async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
          callCount++;
          const it = args.prompt[Symbol.asyncIterator]();
          await it.next();
          if (callCount === 1) {
            // First turn yields turn limit error
            yield {
              type: 'result',
              session_id: 'session-exhausted-40',
              subtype: 'error_max_turns',
              is_error: true,
            };
          } else {
            // Continuation turn succeeds
            yield {
              type: 'result',
              session_id: 'session-fresh-continuation',
              subtype: 'success',
            };
          }
        },
      };

      mailbox.push('Process initial task');

      const sessionOpts: SessionOpts = {
        org: orgName,
        role: def.roles[1],
        bus,
        policy,
        mailbox,
        cwd: testRoot,
        def,
        runner: mockRunner,
        resumeSessionId: 'stale-resume-id',
      };

      // Start role session in background
      const sessionPromise = runAgentSession(sessionOpts);

      // Wait a tick for turn 1 to hit max-turns and turn 2 to continue
      await new Promise((r) => setTimeout(r, 50));

      // After continuation turn completes, close mailbox to end outer loop
      mailbox.close();
      await sessionPromise;

      expect(callCount).toBeGreaterThanOrEqual(2);
      expect(events.some((e) => e.reason === 'turn-limit-resume' || e.reason === 'turn-limit-recover')).toBe(true);
    });

    it('daemon handles Reached maximum number of turns error without crashing agent', async () => {
      let turnAttempts = 0;
      const mockRunner: AgentRunner = {
        async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
          turnAttempts++;
          const it = args.prompt[Symbol.asyncIterator]();
          await it.next();
          if (turnAttempts === 1) {
            throw new Error('Reached maximum number of turns (40)');
          } else {
            yield { type: 'result', subtype: 'success', session_id: 'fresh-id' };
          }
        },
      };

      const daemon = new OrgDaemon(testRoot, {
        stopWaitMs: 100,
        crossProcess: false,
        runner: mockRunner,
      });

      const def = createTestDef();
      writeFileSync(join(testRoot, '.monomind', 'orgs', `${orgName}.json`), JSON.stringify(def));

      const running = await daemon.startOrg(orgName);
      const boss = running.agents.get('boss');
      expect(boss).toBeDefined();

      await new Promise((r) => setTimeout(r, 100));

      expect(boss!.status).not.toBe('crashed');
      expect(boss!.mailbox.isClosed).toBe(false);

      await daemon.stopOrg(orgName);
    });
  });

  describe('2. Checkpoint Status Consistency', () => {
    it('sets checkpoint status to stopped when org is stopped', async () => {
      const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
      const def = createTestDef();
      writeFileSync(join(testRoot, '.monomind', 'orgs', `${orgName}.json`), JSON.stringify(def));

      await daemon.startOrg(orgName);
      await daemon.stopOrg(orgName);

      const rtPath = join(testRoot, '.monomind', 'orgs', orgName, 'runtime.json');
      expect(existsSync(rtPath)).toBe(true);
      const rt = JSON.parse(readFileSync(rtPath, 'utf8'));

      expect(rt.status).toBe('stopped');
      expect(rt.checkpoint).toBeDefined();
      expect(rt.checkpoint.status).toBe('stopped');
    });

    it('sets checkpoint status to crashed when org crashes', async () => {
      const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
      const def = createTestDef();
      writeFileSync(join(testRoot, '.monomind', 'orgs', `${orgName}.json`), JSON.stringify(def));

      const running = await daemon.startOrg(orgName);
      daemon.persistState(orgName, 'crashed', running.run, running);

      const rtPath = join(testRoot, '.monomind', 'orgs', orgName, 'runtime.json');
      const rt = JSON.parse(readFileSync(rtPath, 'utf8'));

      expect(rt.status).toBe('crashed');
      expect(rt.checkpoint).toBeDefined();
      expect(rt.checkpoint.status).toBe('crashed');

      await daemon.stopOrg(orgName);
    });
  });

  describe('4. Default Turn Limit Effectively Unlimited', () => {
    it('schema defaults max_turns_per_message to DEFAULT_MAX_TURNS_PER_MESSAGE', () => {
      const def = createTestDef();
      delete (def.run_config as Record<string, unknown>).max_turns_per_message;
      const parsed = OrgDefSchema.parse(def);
      expect(parsed.run_config.max_turns_per_message).toBe(DEFAULT_MAX_TURNS_PER_MESSAGE);
      expect(DEFAULT_MAX_TURNS_PER_MESSAGE).toBeGreaterThanOrEqual(100_000);
    });

    it('org templates bake the same effectively-unlimited default', () => {
      const templateName = Object.keys(ORG_TEMPLATES)[0];
      const built = buildFromTemplate(templateName, 'defaults-org');
      expect(built?.run_config.max_turns_per_message).toBe(DEFAULT_MAX_TURNS_PER_MESSAGE);
    });

    it('explicit low limits are preserved (users who want a cap keep it)', () => {
      const def = createTestDef();
      def.run_config.max_turns_per_message = 40;
      const parsed = OrgDefSchema.parse(def);
      expect(parsed.run_config.max_turns_per_message).toBe(40);
    });
  });

  describe('3. Checkpoint Resume with Live Execution', () => {
    it('startOrg with resume: true restores and executes live role sessions', async () => {
      const receivedMessages: string[] = [];
      const mockRunner: AgentRunner = {
        async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
          for await (const msg of args.prompt) {
            receivedMessages.push(typeof msg === 'string' ? msg : JSON.stringify(msg));
          }
          yield { type: 'result', subtype: 'success', session_id: 'resumed-session' };
        },
      };

      const daemon = new OrgDaemon(testRoot, {
        stopWaitMs: 100,
        crossProcess: false,
        runner: mockRunner,
      });

      const def = createTestDef();
      writeFileSync(join(testRoot, '.monomind', 'orgs', `${orgName}.json`), JSON.stringify(def));

      // Initial run
      const running = await daemon.startOrg(orgName);
      const bossMailbox = running.agents.get('boss')!.mailbox;
      bossMailbox.push('Work item before stop');

      await daemon.stopOrg(orgName);

      // Inject pending work into checkpoint
      const rtPath = join(testRoot, '.monomind', 'orgs', orgName, 'runtime.json');
      const rt = JSON.parse(readFileSync(rtPath, 'utf8'));
      rt.checkpoint.roleState.boss.mailboxQueue = ['Restored task A', 'Restored task B'];
      const { generateChecksum } = await import('../../src/orgrt/checkpoint.js');
      const { checksum: _, ...state } = rt.checkpoint;
      rt.checkpoint.checksum = generateChecksum(state);
      writeFileSync(rtPath, JSON.stringify(rt));

      // Resume org live
      const resumed = await daemon.startOrg(orgName, undefined, { resume: true });
      expect(resumed).toBeDefined();
      expect(resumed.agents.get('boss')).toBeDefined();

      await new Promise((r) => setTimeout(r, 100));

      expect(receivedMessages.some((m) => m.includes('Restored task A'))).toBe(true);
      expect(receivedMessages.some((m) => m.includes('Restored task B'))).toBe(true);

      await daemon.stopOrg(orgName);
    });
  });
});
