/**
 * ADR-O001 "What this does NOT apply to": an org can declare a role
 * `deliberative`, and the runtime then does not apply the execution-work rules
 * that would damage deliberation — the completion-evidence gate and its retry
 * cap (D5/D4: the absence of an oracle is the point; a debate round is not a
 * retry), and the artifact-only reviewer restriction (D6: the synthesiser must
 * see every position).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildOrgTools } from '../../src/orgrt/session.js';
import { OrgDefSchema, RoleSchema } from '../../src/orgrt/types.js';

const hangingQuery = ({ options }: any) =>
  (async function* () {
    const signal: AbortSignal | undefined = options?.abortController?.signal;
    await new Promise<void>((r) => {
      if (signal?.aborted) r();
      signal?.addEventListener('abort', () => r(), { once: true });
    });
  })();

let daemon: OrgDaemon | undefined;
afterEach(async () => {
  await daemon?.stopOrg('alpha').catch(() => {});
  daemon = undefined;
});

function org(runConfig: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'deliberative-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(
    join(root, '.monomind/orgs/alpha.json'),
    JSON.stringify({
      name: 'alpha',
      goal: 'g',
      run_config: runConfig,
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        { id: 'dev', title: 'Dev', type: 'coder', reports_to: 'boss' },
        { id: 'critic', title: 'Critic', type: 'critic', reports_to: 'boss', deliberative: true },
      ],
    }),
  );
  return root;
}

describe('deliberative roles — schema', () => {
  it('is absent unless declared', () => {
    expect('deliberative' in RoleSchema.parse({ id: 'dev' })).toBe(false);
    expect(RoleSchema.parse({ id: 'c', deliberative: true }).deliberative).toBe(true);
  });

  it('cannot also be an artifact-only reviewer', () => {
    expect(() => RoleSchema.parse({ id: 'c', deliberative: true, review_input: 'artifact-only' })).toThrow(
      /deliberative/,
    );
  });
});

describe('deliberative roles — the evidence gate does not apply', () => {
  it("closes a deliberative role's task without evidence, while an execution role is still refused", async () => {
    daemon = new OrgDaemon(org({ completion_evidence: true }), { queryFn: hangingQuery as any, forward: false });
    await daemon.startOrg('alpha');
    const dev = JSON.parse((daemon as any).dagCreateTask('alpha', 'boss', 'build it', 'dev', []));
    const critic = JSON.parse((daemon as any).dagCreateTask('alpha', 'boss', 'argue against it', 'critic', []));
    expect((daemon as any).dagCompleteTask('alpha', 'dev', dev.id, 'done')).toMatch(/refused/);
    const out = JSON.parse((daemon as any).dagCompleteTask('alpha', 'critic', critic.id, 'my position: ...'));
    expect(out.done).toBe(critic.id);
  });

  it("a deliberative role's own tool list does not demand evidence", () => {
    const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'delib-tools-')));
    const base = {
      org: 'o',
      bus,
      policy: new PolicyEngine('critic', {}, bus, '/w'),
      mailbox: new Mailbox(),
      cwd: '/w',
      deliver: async () => 'ok',
      completeTask: () => 'ok',
    };
    const desc = (role: any, require: boolean) =>
      buildOrgTools({ ...base, role, requireTaskEvidence: require } as any).find((t) => t.name === 'org_task_done')!
        .description;
    // The daemon passes requireTaskEvidence per role; this pins what each sees.
    expect(desc({ id: 'critic', reports_to: 'boss', deliberative: true }, false)).not.toMatch(/EVIDENCE/);
    expect(desc({ id: 'dev', reports_to: 'boss' }, true)).toMatch(/EVIDENCE/);
  });
});

describe('orgs with task-scoped roles tell senders how to address a task', () => {
  const bus = () => new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'delib-send-')));
  const tools = (def: any) => {
    const b = bus();
    return buildOrgTools({
      org: 'o',
      role: { id: 'boss', reports_to: null } as any,
      bus: b,
      policy: new PolicyEngine('boss', {}, b, '/w'),
      mailbox: new Mailbox(),
      cwd: '/w',
      deliver: async () => 'ok',
      def,
    } as any).find((t) => t.name === 'org_send')!.description;
  };
  const roles = [{ id: 'boss', title: 'B', type: 'b' }, { id: 'dev', title: 'D', type: 'd', reports_to: 'boss' }];

  it('is unchanged for an org without task scope', () => {
    expect(tools(OrgDefSchema.parse({ name: 'o', goal: 'g', roles }))).toBe(
      'Send a message to another agent (role id) or another org ("org:role"). This is the only inter-agent channel.',
    );
  });

  it('asks for a [task:<id>] subject when some role is task-scoped', () => {
    const d = OrgDefSchema.parse({ name: 'o', goal: 'g', roles, run_config: { session_scope: 'task' } });
    expect(tools(d)).toMatch(/\[task:<id>\]/);
  });
});
