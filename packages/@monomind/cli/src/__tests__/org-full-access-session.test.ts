// #365: session-run.ts/session-stream.ts wiring for `policy.access: 'full'`
// org roles — the runner options a full-access role's session gets, that a
// scoped sibling in the SAME org is byte-identical to before this issue, and
// the audit-log + tool_activity side effects.
import { readFileSync } from 'node:fs';
import { mkdtempSync } from '../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAccessAckHash } from '../orgrt/access-ack.js';
import { ensureFullAccessGrantKey, signAccessAck } from '../orgrt/access-grant-key.js';
import { fullAccessCanUseTool } from '../orgrt/agent-exec-access.js';
import type { AgentRunArgs, AgentRunner } from '../orgrt/agent-runner.js';
import { OrgBus } from '../orgrt/bus.js';
import { fullAccessAuditLogPath } from '../orgrt/full-access-audit.js';
import { Mailbox } from '../orgrt/mailbox.js';
import { PolicyEngine } from '../orgrt/policy.js';
import { runAgentSession } from '../orgrt/session.js';
import { type OrgDef, OrgDefSchema, type OrgRole } from '../orgrt/types.js';
import type { BusEvent } from '../orgrt/types-events.js';

// session-run.ts's resolveRoleAccess call has no test seam of its own — it
// always resolves the grant key from the real operator-dir default
// (defaultOperatorDir()), so exercising an 'active' grant through the full
// session stack means redirecting that default to a throwaway dir, exactly
// like a human's `org role set-access ... full` would populate it.
let operatorDir: string;

beforeEach(() => {
  operatorDir = mkdtempSync(join(tmpdir(), 'full-access-session-operator-'));
  vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', operatorDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function ackedFullAccessDef(): OrgDef {
  const raw = {
    name: 'o',
    roles: [
      { id: 'lead', title: 'Lead', reports_to: null },
      { id: 'builder', title: 'Builder', runtime: 'claude', reports_to: 'lead' },
    ],
  };
  const def = OrgDefSchema.parse(raw);
  const role = def.roles.find((r) => r.id === 'builder')!;
  const at = '2026-01-01T00:00:00.000Z';
  const by = 'human' as const;
  const hash = computeAccessAckHash(def, role);
  const key = ensureFullAccessGrantKey(operatorDir);
  const sig = signAccessAck({ org: def.name, role: role.id, hash, at, by, key });
  role.policy = { access: 'full', access_ack: { by, at, hash, sig } };
  return def;
}

async function captureRunArgs(
  def: OrgDef,
  roleId: string,
  opts: { events?: BusEvent[] } = {},
): Promise<AgentRunArgs> {
  const role = def.roles.find((r) => r.id === roleId) as OrgRole;
  const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'full-access-session-')));
  if (opts.events) bus.subscribe((ev) => opts.events!.push(ev));
  const mailbox = new Mailbox();
  mailbox.push('go');
  mailbox.close();
  let captured: AgentRunArgs | undefined;
  const runner: AgentRunner = {
    run(args: AgentRunArgs) {
      captured = args;
      return (async function* () {
        // Emit a tool_use/tool_result pair so tool_activity wiring is exercised.
        yield {
          type: 'tool_use',
          tool_use_id: 't1',
          tool: 'Bash',
          input: { command: 'echo hi' },
        } as any;
        yield {
          type: 'tool_result',
          tool_use_id: 't1',
          tool: 'Bash',
          is_error: false,
          text: 'hi',
        } as any;
        for await (const _ of args.prompt) break;
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      })();
    },
  };
  await runAgentSession({
    org: 'o',
    role,
    def,
    bus,
    policy: new PolicyEngine(role.id, {}, bus, '/work'),
    mailbox,
    cwd: '/work',
    deliver: async () => 'delivered',
    runner,
  });
  await bus.flush();
  return captured!;
}

describe('#365 full-access org roles: session-run wiring', () => {
  it('an active full-access role gets access:full, fullAccessCanUseTool, no claudeRestrictions/authorityMask', async () => {
    const def = ackedFullAccessDef();
    const args = await captureRunArgs(def, 'builder');
    expect(args.access).toBe('full');
    expect(args.canUseTool).toBe(fullAccessCanUseTool);
    expect(args.claudeRestrictions).toBeUndefined();
    expect(args.authorityMask).toBeUndefined();
  });

  it('a scoped sibling role in the same org is unaffected (no access field, gated canUseTool)', async () => {
    const def = ackedFullAccessDef();
    const args = await captureRunArgs(def, 'lead');
    expect(args.access).toBeUndefined();
    expect(args.canUseTool).not.toBe(fullAccessCanUseTool);
  });

  it('a declared-but-unacknowledged full-access role runs scoped this session', async () => {
    const def = OrgDefSchema.parse({
      name: 'o',
      roles: [{ id: 'builder', runtime: 'claude', policy: { access: 'full' } }],
    });
    const args = await captureRunArgs(def, 'builder');
    expect(args.access).toBeUndefined();
    expect(args.canUseTool).not.toBe(fullAccessCanUseTool);
  });

  it('emits tool_activity start/end bus events for the full-access role', async () => {
    const def = ackedFullAccessDef();
    const events: BusEvent[] = [];
    await captureRunArgs(def, 'builder', { events });
    const activity = events.filter((e) => e.type === 'tool_activity');
    expect(activity.map((e) => (e.data as any)?.phase)).toEqual(['start', 'end']);
    expect((activity[0].data as any).name).toBe('Bash');
  });

  it('does not emit tool_activity for a scoped role', async () => {
    const def = ackedFullAccessDef();
    const events: BusEvent[] = [];
    await captureRunArgs(def, 'lead', { events });
    expect(events.some((e) => e.type === 'tool_activity')).toBe(false);
  });

  it('appends one line to the full-access audit log for the session', async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), 'full-access-log-')), 'audit.log');
    const prevEnv = process.env.MONOMIND_FULL_ACCESS_LOG;
    process.env.MONOMIND_FULL_ACCESS_LOG = logPath;
    try {
      expect(fullAccessAuditLogPath()).toBe(logPath);
      const def = ackedFullAccessDef();
      await captureRunArgs(def, 'builder');
      const lines = readFileSync(logPath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
      const record = JSON.parse(lines[0]);
      expect(record.org).toBe('o');
      expect(record.role).toBe('builder');
      expect(record.exitCode).toBe(0);
      expect(record.toolCalls).toBe(1);
    } finally {
      if (prevEnv === undefined) delete process.env.MONOMIND_FULL_ACCESS_LOG;
      else process.env.MONOMIND_FULL_ACCESS_LOG = prevEnv;
    }
  });
});
