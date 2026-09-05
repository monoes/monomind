/**
 * Follow-up to #205: the idle watchdog tells an operator to "raise the
 * role's budget_tokens ... and resume from checkpoint" for a budget-
 * exhausted boss. That remedy only works if resume actually leaves the
 * mailbox usable — mergeCheckpoint() used to unconditionally re-close a
 * mailbox that was checkpointed as closed, with no way to ever reopen it,
 * making the suggested remedy a silent no-op. mergeCheckpoint() must leave
 * a recoverably-closed mailbox (token-budget / usd-budget) OPEN on resume,
 * while still re-closing a mailbox that was closed for any other reason
 * (crash, terminal stop) — resuming a genuinely dead role's mailbox should
 * not spring back to life.
 */
import { describe, it, expect } from 'vitest';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { mergeCheckpoint, type OrgCheckpoint, type RoleCheckpoint } from '../../src/orgrt/checkpoint.js';
import type { RunningOrg, AgentRuntime } from '../../src/orgrt/daemon.js';

function stubOrg(mailbox: Mailbox): RunningOrg {
  const runtime = {
    mailbox,
    policy: { usage: 0, addUsage: () => {} },
    metrics: { costUsd: 0 },
    lastMessageId: undefined,
    status: 'running',
    error: undefined,
  } as unknown as AgentRuntime;
  return { agents: new Map([['boss', runtime]]) } as unknown as RunningOrg;
}

function roleCheckpoint(overrides: Partial<RoleCheckpoint>): RoleCheckpoint {
  return {
    mailboxQueue: [],
    mailboxClosed: true,
    tokensUsed: 0,
    costUsd: 0,
    status: 'running',
    ...overrides,
  };
}

function checkpoint(roleState: RoleCheckpoint): OrgCheckpoint {
  return {
    version: 1,
    status: 'stopped',
    run: 'run-1',
    pid: 1,
    updated: new Date(0).toISOString(),
    roleState: { boss: roleState },
    pendingRoles: [],
    checksum: 'unused-in-this-test',
  };
}

describe('mergeCheckpoint — recoverable vs. terminal mailbox close on resume', () => {
  it('leaves the mailbox OPEN when checkpointed closed for token-budget', () => {
    const mailbox = new Mailbox();
    const org = stubOrg(mailbox);
    mergeCheckpoint(org, checkpoint(roleCheckpoint({ mailboxCloseReason: 'token-budget' })));
    expect(mailbox.isClosed).toBe(false);
  });

  it('leaves the mailbox OPEN when checkpointed closed for usd-budget', () => {
    const mailbox = new Mailbox();
    const org = stubOrg(mailbox);
    mergeCheckpoint(org, checkpoint(roleCheckpoint({ mailboxCloseReason: 'usd-budget' })));
    expect(mailbox.isClosed).toBe(false);
  });

  it('still re-closes the mailbox for a plain (reasonless) close — a genuine crash/terminal stop', () => {
    const mailbox = new Mailbox();
    const org = stubOrg(mailbox);
    mergeCheckpoint(org, checkpoint(roleCheckpoint({ mailboxCloseReason: undefined })));
    expect(mailbox.isClosed).toBe(true);
  });

  it('does not touch an already-closed mailbox (no double-close)', () => {
    const mailbox = new Mailbox();
    mailbox.close('some-other-reason');
    const org = stubOrg(mailbox);
    mergeCheckpoint(org, checkpoint(roleCheckpoint({ mailboxCloseReason: 'token-budget' })));
    // Already closed before merge ran — merge's `!runtime.mailbox.isClosed`
    // guard means it's untouched either way; still closed either way.
    expect(mailbox.isClosed).toBe(true);
  });

  it('does not close the mailbox at all when the checkpoint says it was open', () => {
    const mailbox = new Mailbox();
    const org = stubOrg(mailbox);
    mergeCheckpoint(org, checkpoint(roleCheckpoint({ mailboxClosed: false })));
    expect(mailbox.isClosed).toBe(false);
  });
});
