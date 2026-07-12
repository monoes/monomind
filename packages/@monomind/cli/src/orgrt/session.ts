// packages/@monomind/cli/src/orgrt/session.ts
import { z } from 'zod';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { OrgBus } from './bus.js';
import type { PolicyEngine } from './policy.js';
import type { Mailbox } from './mailbox.js';
import type { OrgDef, OrgRole } from './types.js';
import { resolveProviderEnv } from './provider.js';

export type DeliverFn = (from: string, to: string, subject: string, body: string) => Promise<string>;

export interface SessionOpts {
  org: string;
  role: OrgRole;
  bus: OrgBus;
  policy: PolicyEngine;
  mailbox: Mailbox;
  cwd: string;
  deliver: DeliverFn;
  def?: OrgDef;
  maxTurns?: number;
  queryFn?: typeof query; // injectable for tests
}

/** Role briefing given to each agent session (SDK systemPrompt option). */
export function buildRolePrompt(role: OrgRole, def: Pick<OrgDef, 'name' | 'goal'>, roster: string[]): string {
  return [
    `You are agent "${role.id}" (${role.title || role.type}) in the org "${def.name}".`,
    `Org goal: ${def.goal}`,
    role.reports_to ? `You report to "${role.reports_to}".` : `You are the coordinator of this org.`,
    role.responsibilities?.length ? `Your responsibilities:\n- ${role.responsibilities.join('\n- ')}` : '',
    `## Communication protocol`,
    `The ONLY way to communicate with other agents is the org_send tool.`,
    `Roster: ${roster.join(', ')}. Address another org's agent as "<org-name>:<role-id>".`,
    `When you receive a message, act on it, then org_send your result to the requester.`,
    `When your current work is complete and no reply is needed, end your turn without further tool calls.`,
  ].filter(Boolean).join('\n\n');
}

/** Runs one persistent agent session; resolves when the mailbox closes and the SDK stream ends. */
export async function runAgentSession(opts: SessionOpts): Promise<void> {
  const { org, role, bus, policy, mailbox, cwd, deliver } = opts;
  const queryFn = opts.queryFn ?? query;

  const orgServer = createSdkMcpServer({
    name: 'org',
    version: '1.0.0',
    tools: [
      tool(
        'org_send',
        'Send a message to another agent (role id) or another org ("org:role"). This is the only inter-agent channel.',
        { to: z.string(), subject: z.string(), message: z.string() },
        async (args) => {
          const receipt = await deliver(role.id, args.to, args.subject, args.message);
          return { content: [{ type: 'text' as const, text: receipt }] };
        },
      ),
    ],
  });

  bus.emit({ type: 'status', from: role.id, msg: 'session starting' });

  try {
    const stream = queryFn({
      prompt: mailbox.stream(),
      options: {
        systemPrompt: buildRolePrompt(role, (opts.def ?? { name: org, goal: '' }) as OrgDef,
          opts.def?.roles.map(r => r.id) ?? [role.id]),
        model: role.adapter_config?.model,
        cwd,
        env: resolveProviderEnv(role.provider),
        mcpServers: { org: orgServer },
        maxTurns: opts.maxTurns ?? 30,
        permissionMode: 'default',
        canUseTool: async (toolName: string, input: Record<string, unknown>) =>
          policy.decide(toolName, input),
        // test seam: lets the scripted fake SDK (test-loop.ts) drive org_send and
        // tool calls through the real deliver/policy paths; the real SDK ignores it
        _orgTest: {
          deliver: (to: string, subject: string, body: string) => deliver(role.id, to, subject, body),
          callTool: (name: string, input: Record<string, unknown>) => policy.decide(name, input),
        },
      } as any,
    });

    for await (const m of stream as AsyncIterable<any>) {
      if (m.type === 'assistant') {
        const text = (m.message?.content ?? [])
          .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
        if (text.trim()) bus.emit({ type: 'chat', from: role.id, msg: text });
      } else if (m.type === 'result') {
        const tokens = (m.usage?.input_tokens ?? 0) + (m.usage?.output_tokens ?? 0);
        policy.addUsage(tokens);
        bus.emit({ type: 'usage', from: role.id, data: { tokens, cost_usd: m.total_cost_usd, subtype: m.subtype } });
        if (policy.overBudget) {
          bus.emit({ type: 'status', from: role.id, msg: 'token budget exhausted — closing session' });
          mailbox.close();
        }
      }
    }
    bus.emit({ type: 'status', from: role.id, msg: 'session ended' });
  } catch (err) {
    bus.emit({ type: 'status', from: role.id, msg: `session error: ${(err as Error).message}` });
    throw err;
  }
}
