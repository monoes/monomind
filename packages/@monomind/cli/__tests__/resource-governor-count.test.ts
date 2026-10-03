// The governor counts each role session once. A role under the no-node /
// home-write-deny layers runs as `bwrap … -- <sdk>` (twice nested) plus the SDK
// binary; the old `pgrep -f "claude-agent-sdk.*--output-format"` matched all
// three, so the effective cap on a 24-CPU host was ~7 roles, not 22.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcEntry } from '../src/utils/resource-governor.js';

const execSyncMock = vi.fn();
vi.mock('node:child_process', () => ({ execSync: (...args: unknown[]) => execSyncMock(...args) }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, platform: () => 'darwin', cpus: () => new Array(24).fill({}) };
});

const SDK = '/opt/node_modules/@anthropic-ai/claude-agent-sdk/vendor/claude';
const SDK_ARGS = `${SDK} --output-format stream-json --verbose --input-format stream-json`;
const BWRAP = (inner: string) =>
  `/usr/bin/bwrap --ro-bind / / --bind /home/u/.claude /home/u/.claude --unshare-pid -- ${inner}`;

let nextPid = 1000;
/** One role session: `wrappers` bwrap layers around one SDK binary. */
function session(wrappers: number): ProcEntry[] {
  const rows: ProcEntry[] = [];
  let ppid = 1;
  for (let i = 0; i < wrappers; i++) {
    const pid = nextPid++;
    rows.push({ pid, ppid, cmd: BWRAP(i === wrappers - 1 ? SDK_ARGS : BWRAP(SDK_ARGS)) });
    ppid = pid;
  }
  rows.push({ pid: nextPid++, ppid, cmd: SDK_ARGS });
  return rows;
}
const psOutput = (rows: ProcEntry[]) =>
  rows.map((r) => `${r.pid} ${r.ppid} ${r.pgrp ?? r.pid} ${r.cmd}`).join('\n');

/** The pre-fix counter: every command line matching the pgrep pattern. */
const oldPgrepCount = (rows: ProcEntry[]) =>
  rows.filter((r) => /claude-agent-sdk.*--output-format/.test(r.cmd)).length;

function mockHost(rows: ProcEntry[]) {
  execSyncMock.mockImplementation((cmd: string) => {
    if (cmd.startsWith('vm_stat')) {
      return 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 1000000.\n';
    }
    if (cmd.startsWith('ps ')) return psOutput(rows);
    throw new Error(`unexpected command ${cmd}`);
  });
}

describe('countSdkSessions', () => {
  beforeEach(() => {
    nextPid = 1000;
    execSyncMock.mockReset();
    vi.resetModules();
    delete process.env.MONOMIND_MAX_SDK_PROCS;
  });

  it('counts a role session with two bwrap wrappers once', async () => {
    const { countSdkSessions } = await import('../src/utils/resource-governor.js');
    const rows = session(2);
    expect(rows).toHaveLength(3);
    expect(countSdkSessions(rows)).toBe(1);
  });

  it('counts a plain session without bwrap once', async () => {
    const { countSdkSessions } = await import('../src/utils/resource-governor.js');
    expect(countSdkSessions(session(0))).toBe(1);
  });

  it('counts a node-launched SDK cli once and ignores shells and unrelated processes', async () => {
    const { countSdkSessions } = await import('../src/utils/resource-governor.js');
    const rows: ProcEntry[] = [
      { pid: 1, ppid: 0, cmd: 'node /x/claude-agent-sdk/cli.js --output-format stream-json' },
      { pid: 2, ppid: 0, cmd: `/bin/sh -c ${SDK_ARGS}` },
      { pid: 3, ppid: 0, cmd: 'vim /x/claude-agent-sdk/README.md' },
    ];
    expect(countSdkSessions(rows)).toBe(1);
  });

  it('counts 10 no-node-layer sessions as 10 (old pattern said 30)', async () => {
    const { countSdkSessions } = await import('../src/utils/resource-governor.js');
    const rows = Array.from({ length: 10 }, () => session(2)).flat();
    expect(countSdkSessions(rows)).toBe(10);
    // Regression: the old whole-command-line pattern miscounts this table.
    expect(oldPgrepCount(rows)).toBe(30);
  });

  it('countSdkProcesses reads the ps table on non-Linux; 10 sessions are not deferred at cap 22', async () => {
    mockHost(Array.from({ length: 10 }, () => session(2)).flat());
    const gov = await import('../src/utils/resource-governor.js');
    gov.configureResourceLimits({ minFreeMemBytes: 0 });
    expect(gov.getResourceLimits().maxSdkProcesses).toBe(22);
    expect(gov.countSdkProcesses()).toBe(10);
    const check = gov.checkResources();
    expect(check.ok).toBe(true);
    expect(check.sdkProcesses).toBe(10);
  });

  it('defers when distinct sessions reach the cap, and the env override wins', async () => {
    mockHost(Array.from({ length: 10 }, () => session(2)).flat());
    process.env.MONOMIND_MAX_SDK_PROCS = '10';
    const gov = await import('../src/utils/resource-governor.js');
    gov.configureResourceLimits({ minFreeMemBytes: 0 });
    expect(gov.getResourceLimits().maxSdkProcesses).toBe(10);
    const check = gov.checkResources();
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('10/10');
    process.env.MONOMIND_MAX_SDK_PROCS = '11';
    expect(gov.checkResources().ok).toBe(true);
  });
});
