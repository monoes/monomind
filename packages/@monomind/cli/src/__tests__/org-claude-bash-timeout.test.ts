/**
 * 2.16.1 release run, finding 3: org roles on the Claude runtime hit Claude
 * Code's 2-minute default Bash timeout (runtime-qa three times) even when told
 * to run long commands in the foreground. Claude Code reads
 * BASH_DEFAULT_TIMEOUT_MS / BASH_MAX_TIMEOUT_MS from its environment (checked
 * against the bundled CLI binary of @anthropic-ai/claude-agent-sdk 0.3.226),
 * so a Claude role's session env now carries both — 600000 ms unless
 * run_config.bash_timeout_ms says otherwise. Other runtimes have their own
 * shell tools and never see these names.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunArgs, AgentRunner } from '../orgrt/agent-runner.js';
import { DEFAULT_CLAUDE_BASH_TIMEOUT_MS } from '../orgrt/bash-timeout.js';
import { OrgBus } from '../orgrt/bus.js';
import { Mailbox } from '../orgrt/mailbox.js';
import { PolicyEngine } from '../orgrt/policy.js';
import { runAgentSession } from '../orgrt/session.js';
import { type OrgDef, OrgDefSchema, type OrgRole } from '../orgrt/types.js';

const role = { id: 'qa', title: 'QA', type: 'specialist', reports_to: 'boss' } as OrgRole;
const def = (runConfig: Record<string, unknown> = {}): OrgDef =>
  OrgDefSchema.parse({ name: 'o', roles: [{ id: 'qa' }], run_config: runConfig });

async function sessionEnv(opts: {
  def?: OrgDef;
  runner?: AgentRunner;
}): Promise<Record<string, string | undefined>> {
  const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'bash-timeout-')));
  const mailbox = new Mailbox();
  mailbox.push('go');
  mailbox.close();
  let env: Record<string, string | undefined> = {};
  const fakeQuery = ({ prompt, options }: any) =>
    (async function* () {
      env = options.env;
      for await (const _ of prompt) break;
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  const runner: AgentRunner | undefined = opts.runner && {
    run(args: AgentRunArgs) {
      env = args.env;
      return opts.runner!.run(args);
    },
  };
  await runAgentSession({
    org: 'o',
    role,
    def: opts.def,
    bus,
    policy: new PolicyEngine(role.id, {}, bus, '/work'),
    mailbox,
    cwd: '/work',
    deliver: async () => 'delivered',
    ...(runner ? { runner } : { queryFn: fakeQuery as any }),
  });
  return env;
}

describe('Claude org roles get a sane Bash timeout', () => {
  // The session env starts from the parent's env (resolveProviderEnv), so a
  // runner that itself runs inside a Claude org role — which has both vars at
  // 600000 — would see them in every session env (#334). Clear them so each
  // case sees only what the session adds.
  beforeEach(() => {
    vi.stubEnv('BASH_DEFAULT_TIMEOUT_MS', undefined);
    vi.stubEnv('BASH_MAX_TIMEOUT_MS', undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('a Claude role session env carries both Bash timeout vars at 600000 ms', async () => {
    const env = await sessionEnv({ def: def() });
    expect(DEFAULT_CLAUDE_BASH_TIMEOUT_MS).toBe(600_000);
    expect(env.BASH_DEFAULT_TIMEOUT_MS).toBe('600000');
    expect(env.BASH_MAX_TIMEOUT_MS).toBe('600000');
  });

  it('run_config.bash_timeout_ms overrides both', async () => {
    const env = await sessionEnv({ def: def({ bash_timeout_ms: 900_000 }) });
    expect(env.BASH_DEFAULT_TIMEOUT_MS).toBe('900000');
    expect(env.BASH_MAX_TIMEOUT_MS).toBe('900000');
  });

  it('rejects a non-positive or over-an-hour bash_timeout_ms', () => {
    const parse = (v: unknown) =>
      OrgDefSchema.safeParse({
        name: 'o',
        roles: [{ id: 'qa' }],
        run_config: { bash_timeout_ms: v },
      });
    expect(parse(0).success).toBe(false);
    expect(parse(3_600_001).success).toBe(false);
    expect(parse(120_000).success).toBe(true);
  });

  it('a non-Claude runtime session env does not carry them', async () => {
    const other: AgentRunner = {
      async *run() {
        yield {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 1, output_tokens: 1 },
        } as any;
      },
    };
    const env = await sessionEnv({ def: def(), runner: other });
    expect(env.MONOMIND_ORG_ROLE).toBe('qa');
    expect(env.BASH_DEFAULT_TIMEOUT_MS).toBeUndefined();
    expect(env.BASH_MAX_TIMEOUT_MS).toBeUndefined();
  });
});
