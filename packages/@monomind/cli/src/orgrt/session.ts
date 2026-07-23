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
  askHuman?: (role: string, question: string) => Promise<string>;
  /** Coordinator-only: records the run's outcome (daemon persists it to run history). */
  onComplete?: (role: string, outcome: 'achieved' | 'partial' | 'failed', summary: string) => void;
  /** Search the org's accumulated cross-run memory (memory_namespace). */
  recall?: (role: string, query: string) => Promise<string>;
  /** Write a memory deliberately: scope 'org' (shared, default) or 'agent' (private to this role). */
  remember?: (role: string, content: string, scope: 'org' | 'agent') => Promise<string>;
  /** Persist extracted entities/relations/rules into the org's knowledge graph. */
  learn?: (role: string, payload: {
    nodes?: { name: string; type?: string; description?: string }[];
    edges?: { source: string; target: string; relation: string; description?: string }[];
    rules?: { rule: string; context?: string }[];
  }) => Promise<string>;
  /** Top existing KG entity names — injected into the coordinator prompt so
   *  extraction reuses canonical names instead of minting near-duplicates. */
  glossary?: string[];
  /** Search the user's Second Brain (project documents + personal global brain). */
  searchKnowledge?: (role: string, query: string) => Promise<string>;
  def?: OrgDef;
  maxTurns?: number;
  queryFn?: typeof query; // injectable for tests
}

/** Role briefing given to each agent session (SDK systemPrompt option). */
export function buildRolePrompt(role: OrgRole, def: Pick<OrgDef, 'name' | 'goal'>, roster: string[], glossary?: string[]): string {
  const isCoordinator = role.reports_to == null;
  return [
    `You are agent "${role.id}" (${role.title || role.type}) in the org "${def.name}".`,
    `Org goal: ${def.goal}`,
    isCoordinator ? `You are the coordinator of this org.` : `You report to "${role.reports_to}".`,
    role.responsibilities?.length ? `Your responsibilities:\n- ${role.responsibilities.join('\n- ')}` : '',
    `## Communication protocol`,
    `The ONLY way to communicate with other agents is the org_send tool.`,
    `Roster: ${roster.join(', ')}. Address another org's agent as "<org-name>:<role-id>".`,
    `If you need a human decision, call ask_human with your question, then end your turn — you'll receive the human's answer as a new message when it arrives. Do not call ask_human for anything you can resolve yourself.`,
    `Before starting substantial work, call org_recall to check what previous runs already learned or delivered — do not redo finished work.`,
    `The user's documents (notes, handbooks, specs) are searchable with knowledge_search — ground your work in them instead of guessing; results labeled [global] come from the user's personal cross-project brain.`,
    `When you receive a message, act on it, then org_send your result to the requester.`,
    isCoordinator
      ? `When the org's goal for this run is achieved (or clearly can't be): first call org_learn ONCE with the durable knowledge this run produced — key entities (basic types, fullest names), their relationships (snake_case, one-sentence facts), and any reusable rules ("when X, do Y") worth keeping. Then call org_complete exactly once with the outcome and a concise summary. Then end your turn.`
      : `When your current work is complete and no reply is needed, end your turn without further tool calls.`,
    isCoordinator && glossary?.length
      ? `Known entities (reuse these EXACT names in org_learn instead of near-duplicates): ${glossary.slice(0, 40).join(', ')}`
      : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * Runs a role for the life of the org, transparently restarting the
 * underlying SDK session whenever it ends on its own (`maxTurns` reached)
 * while the mailbox is still open. `maxTurns` bounds a single SDK query()
 * call's TOTAL turns, not "turns per incoming message" — since one query()
 * call stays open across every mailbox message for as long as the mailbox
 * itself stays open, without a restart the role would go permanently silent
 * (no crash, no alert) once its lifetime turn count crossed the limit, while
 * deliver() kept queuing new messages into a mailbox nobody was reading.
 */
export async function runAgentSession(opts: SessionOpts): Promise<void> {
  const { mailbox } = opts;
  // Carries the SDK's own session_id across a maxTurns restart so the next
  // query() call resumes the prior conversation instead of starting cold —
  // without this, a restart silently discarded all in-progress reasoning.
  let resumeSessionId: string | undefined;
  // Always run at least once: a mailbox can be closed with queued items still
  // pending (stream() drains the queue before honoring `closed`), which is a
  // normal, valid starting state — checking isClosed before the first run
  // would skip that drain entirely.
  while (true) {
    resumeSessionId = await runOneSession(opts, resumeSessionId);
    // The dead session's generator may still hold the waker — drop it so a
    // push() before the next stream() starts only queues instead of being
    // consumed by the abandoned generator (silent message loss).
    mailbox.detach();
    if (mailbox.isClosed) return;
    opts.bus.emit({ type: 'status', from: opts.role.id, msg: 'session restarting (turn limit reached, mailbox still open)' });
  }
}

/** One bounded SDK session for a role; resolves with the SDK's session_id (for resuming on restart) when the stream ends (mailbox closed or maxTurns reached). */
async function runOneSession(opts: SessionOpts, resume?: string): Promise<string | undefined> {
  const { org, role, bus, policy, mailbox, cwd, deliver } = opts;
  const queryFn = opts.queryFn ?? query;

  const orgServer = createSdkMcpServer({
    name: 'org',
    version: '1.0.0',
    tools: [
      ...(opts.searchKnowledge ? [tool(
        'knowledge_search',
        'Semantic search over the user\'s Second Brain: this project\'s indexed documents plus their personal cross-project global brain. Use to ground work in the user\'s actual notes, handbooks, and documents.',
        { query: z.string() },
        async (args) => {
          const text = await opts.searchKnowledge!(role.id, args.query);
          return { content: [{ type: 'text' as const, text }] };
        },
      )] : []),
      ...(opts.recall ? [tool(
        'org_recall',
        'Search this org\'s accumulated memory from previous runs (outcomes, decisions, learnings). Use before starting work that may already have been done.',
        { query: z.string() },
        async (args) => {
          const text = await opts.recall!(role.id, args.query);
          return { content: [{ type: 'text' as const, text }] };
        },
      )] : []),
      ...(opts.remember ? [tool(
        'org_remember',
        'Save a memory for future runs. scope "org" (default) shares it with the whole org; scope "agent" keeps it private to your role. Use for decisions, findings, and state worth recalling later — org_recall searches both.',
        { content: z.string(), scope: z.enum(['org', 'agent']).optional() },
        async (args) => {
          const text = await opts.remember!(role.id, args.content, args.scope ?? 'org');
          return { content: [{ type: 'text' as const, text }] };
        },
      )] : []),
      ...(opts.learn ? [tool(
        'org_learn',
        'Persist durable knowledge from this run into the org\'s knowledge graph: entities ({name, type?, description?}), relationships ({source, target, relation, description?}) and reusable rules ({rule, context?}). Entities merge by name across runs — reuse the exact names listed in your briefing. Call once, before org_complete.',
        {
          nodes: z.array(z.object({ name: z.string(), type: z.string().optional(), description: z.string().optional() })).optional(),
          edges: z.array(z.object({ source: z.string(), target: z.string(), relation: z.string(), description: z.string().optional() })).optional(),
          rules: z.array(z.object({ rule: z.string(), context: z.string().optional() })).optional(),
        },
        async (args) => {
          const text = await opts.learn!(role.id, args);
          return { content: [{ type: 'text' as const, text }] };
        },
      )] : []),
      // Gate purely on onComplete: the daemon passes it only to the role its
      // boss-selection rule picked, so tool availability always matches the
      // kickoff instruction (reports_to may be non-null for a fallback boss).
      ...(opts.onComplete ? [tool(
        'org_complete',
        'Record the outcome of this run. Call exactly once, when the goal is achieved or clearly cannot be. The outcome and summary are persisted to the org run history and briefed to the next run.',
        { outcome: z.enum(['achieved', 'partial', 'failed']), summary: z.string() },
        async (args) => {
          opts.onComplete!(role.id, args.outcome, args.summary);
          return { content: [{ type: 'text' as const, text: `outcome "${args.outcome}" recorded` }] };
        },
      )] : []),
      tool(
        'org_send',
        'Send a message to another agent (role id) or another org ("org:role"). This is the only inter-agent channel.',
        { to: z.string(), subject: z.string(), message: z.string() },
        async (args) => {
          const receipt = await deliver(role.id, args.to, args.subject, args.message);
          return { content: [{ type: 'text' as const, text: receipt }] };
        },
      ),
      tool(
        'ask_human',
        'Ask a human a free-form question and pause for their answer. Use only when you genuinely need human judgment.',
        { question: z.string() },
        async (args) => {
          if (!opts.askHuman) {
            return { content: [{ type: 'text' as const, text: 'ask_human is not available in this session' }] };
          }
          const receipt = await opts.askHuman(role.id, args.question);
          return { content: [{ type: 'text' as const, text: receipt }] };
        },
      ),
    ],
  });

  bus.emit({ type: 'status', from: role.id, msg: 'session starting' });

  let sessionId: string | undefined = resume;
  try {
    const stream = queryFn({
      prompt: mailbox.stream(),
      options: {
        systemPrompt: buildRolePrompt(role, (opts.def ?? { name: org, goal: '' }) as OrgDef,
          opts.def?.roles.map(r => r.id) ?? [role.id], opts.glossary),
        model: role.adapter_config?.model,
        cwd,
        env: resolveProviderEnv(role.provider),
        mcpServers: { org: orgServer },
        maxTurns: opts.maxTurns ?? 30,
        permissionMode: 'default',
        resume,
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
      if (m.session_id) sessionId = m.session_id;
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
    return sessionId;
  } catch (err) {
    bus.emit({ type: 'status', from: role.id, msg: `session error: ${(err as Error).message}` });
    throw err;
  }
}
