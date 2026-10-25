/**
 * `monomind mesh who|send|inbox` — the Monomind Mesh from a shell, for agents that have no mesh
 * MCP tools (a one-shot `agent exec` runtime, a script). `agent exec` hands its child the
 * identity in MONOMIND_MESH_ADDR / MONOMIND_MESH_KEY, so `send` and `inbox` act as that agent.
 */

import { callWithHub, MeshOfflineError, type Reply } from '../mesh/client.js';
import { joinManaged, type ManagedPresence, sealMessages } from '../mesh/managed-presence.js';
import { projectIdFor } from '../mesh/project-id.js';
import { MESSAGE_KINDS, type MeshMessage } from '../mesh/protocol.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { getProjectCwd } from '../utils/paths.js';

type Call = (req: Record<string, unknown>) => Promise<Reply>;
type Join = (alias?: string) => Promise<ManagedPresence | undefined>;

export interface MeshCliDeps {
  call: Call;
  /** One-shot external registration, used when the caller has no identity of its own. */
  join: Join;
  env: NodeJS.ProcessEnv;
}

const defaultDeps = (): MeshCliDeps => ({
  call: (r) => callWithHub(r, { retries: 8 }),
  join: (alias) =>
    joinManaged({
      tier: 'external',
      runtime: 'cli',
      cwd: getProjectCwd(),
      ...(alias ? { alias } : {}),
    }),
  env: process.env,
});

const fail = (error: string): CommandResult => {
  output.printError(error);
  return { success: false, exitCode: 1 };
};
const offline = (): CommandResult =>
  fail('mesh hub is not reachable (is it running? agents join it when they start)');

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Identity from the environment `agent exec` sets; undefined when the caller is not a managed agent. */
function envAuth(env: NodeJS.ProcessEnv): { addr: string; key: string } | undefined {
  const addr = str(env.MONOMIND_MESH_ADDR);
  const key = str(env.MONOMIND_MESH_KEY);
  return addr && key ? { addr, key } : undefined;
}

export async function meshWho(
  flags: Record<string, unknown>,
  deps: MeshCliDeps,
): Promise<CommandResult> {
  const req: Record<string, unknown> = { op: 'who', id: `who-${Date.now()}` };
  const project =
    str(flags.project) ?? (flags['all-projects'] ? undefined : projectIdFor(getProjectCwd()));
  if (project) req.project = project;
  for (const k of ['tier', 'status', 'capability', 'tag', 'parent'] as const) {
    if (str(flags[k])) req[k] = flags[k];
  }
  if (flags['include-gone']) req.includeGone = true;
  try {
    const r = await deps.call(req);
    if (!r.ok) return fail(String(r.error));
    const agents = (r.agents ?? []) as Record<string, unknown>[];
    if (flags.json || flags.format === 'json') {
      output.printJson({ agents, truncated: r.truncated === true });
    } else if (agents.length === 0) {
      output.writeln(output.dim('No agents on the mesh.'));
    } else {
      output.printTable({
        columns: [
          { key: 'alias', header: 'Name', width: 34 },
          { key: 'tier', header: 'Tier', width: 10 },
          { key: 'status', header: 'Status', width: 8 },
          { key: 'runtime', header: 'Runtime', width: 14 },
          { key: 'task', header: 'Task', width: 40 },
        ],
        data: agents.map((a) => ({ ...a, alias: a.alias ?? a.addr, task: a.task ?? '' })),
      });
    }
    return { success: true, data: { agents } };
  } catch (e) {
    if (e instanceof MeshOfflineError) return offline();
    throw e;
  }
}

export async function meshSend(
  flags: Record<string, unknown>,
  deps: MeshCliDeps,
): Promise<CommandResult> {
  const to = str(flags.to);
  const body = str(flags.body);
  if (!to || !body) return fail('mesh send needs --to <name> and --body <text>');
  const kind = str(flags.kind) ?? 'say';
  if (!(MESSAGE_KINDS as readonly string[]).includes(kind)) {
    return fail(`--kind must be one of ${MESSAGE_KINDS.join(', ')}`);
  }
  const replyTo = flags['reply-to'] === undefined ? undefined : Number(flags['reply-to']);
  if (replyTo !== undefined && !(Number.isInteger(replyTo) && replyTo > 0)) {
    return fail('--reply-to must be a message number');
  }
  let temp: ManagedPresence | undefined;
  try {
    let auth = envAuth(deps.env);
    if (!auth) {
      // No identity of our own: register for the length of this one send.
      temp = await deps.join(str(flags.from));
      if (!temp) return offline();
      auth = { addr: temp.addr, key: temp.env.MONOMIND_MESH_KEY };
    }
    const r = await deps.call({
      op: 'send',
      id: `send-${Date.now()}`,
      ...auth,
      to,
      body,
      kind,
      ...(replyTo ? { replyTo } : {}),
    });
    if (!r.ok) return fail(String(r.error));
    output.writeln(`sent to ${String(r.to ?? to)} (message ${String(r.seq)})`);
    return { success: true, data: { sent: true, seq: r.seq, to: r.to } };
  } catch (e) {
    if (e instanceof MeshOfflineError) return offline();
    throw e;
  } finally {
    await temp?.leave();
  }
}

export async function meshInbox(
  flags: Record<string, unknown>,
  deps: MeshCliDeps,
): Promise<CommandResult> {
  const auth = envAuth(deps.env);
  if (!auth) {
    return fail(
      'mesh inbox reads the inbox of a managed agent; run it inside an `agent exec` run (it carries the identity)',
    );
  }
  const limit = flags.limit === undefined ? 20 : Number(flags.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return fail('--limit must be 1-100');
  try {
    const r = await deps.call({
      op: 'inbox',
      id: `inbox-${Date.now()}`,
      ...auth,
      limit,
      peek: flags.peek === true,
    });
    if (!r.ok) return fail(String(r.error));
    const messages = (r.messages ?? []) as MeshMessage[];
    if (flags.json || flags.format === 'json')
      output.printJson({ messages, more: r.more === true });
    else
      output.writeln(
        messages.length ? sealMessages(messages, r.more === true) : output.dim('No new messages.'),
      );
    return { success: true, data: { messages } };
  } catch (e) {
    if (e instanceof MeshOfflineError) return offline();
    throw e;
  }
}

const json = { name: 'json', description: 'Machine-readable output', type: 'boolean' } as const;

const whoCommand: Command = {
  name: 'who',
  description: "List live agents on this host (this project's by default)",
  options: [
    { name: 'all-projects', description: 'Every project on this host', type: 'boolean' },
    { name: 'project', description: 'Project id', type: 'string' },
    { name: 'tier', description: 'session | subagent | org-role | external', type: 'string' },
    { name: 'status', description: 'active | stale | gone', type: 'string' },
    { name: 'capability', description: 'Only agents with this capability', type: 'string' },
    { name: 'tag', description: 'Only agents with this tag', type: 'string' },
    { name: 'parent', description: 'Only children of this agent address', type: 'string' },
    { name: 'include-gone', description: 'Include agents that have left', type: 'boolean' },
    json,
  ],
  examples: [
    { command: 'monomind mesh who --all-projects', description: 'Every agent on this host' },
  ],
  action: (ctx: CommandContext) => meshWho(ctx.flags, defaultDeps()),
};

const sendCommand: Command = {
  name: 'send',
  description: 'Send a message to another agent by its mesh name',
  options: [
    { name: 'to', description: 'Recipient name (see mesh who) or full address', type: 'string' },
    { name: 'body', description: 'Message text', type: 'string' },
    {
      name: 'kind',
      description: 'say (default) | ask | reply',
      type: 'string',
      choices: [...MESSAGE_KINDS],
    },
    { name: 'reply-to', description: 'Message number being answered', type: 'number' },
    {
      name: 'from',
      description: 'Name to send as when this process has no mesh identity (one-shot registration)',
      type: 'string',
    },
  ],
  examples: [
    {
      command: 'monomind mesh send --to lead --body "tests are green"',
      description: 'Tell the agent named lead',
    },
  ],
  action: (ctx: CommandContext) => meshSend(ctx.flags, defaultDeps()),
};

const inboxCommand: Command = {
  name: 'inbox',
  description: "Read this agent's unread messages (inside an `agent exec` run)",
  options: [
    { name: 'limit', description: 'Max messages (default 20)', type: 'number' },
    { name: 'peek', description: 'Do not mark them read', type: 'boolean' },
    json,
  ],
  examples: [{ command: 'monomind mesh inbox', description: 'Show and mark read' }],
  action: (ctx: CommandContext) => meshInbox(ctx.flags, defaultDeps()),
};

/** Hidden: runs the mesh hub in the foreground, for hosts where only a non-MCP agent (Pi) is running. */
export const hubCommand: Command = {
  name: 'hub',
  description: 'Run the mesh hub in the foreground (started by agents that cannot spawn it)',
  hidden: true,
  action: async (): Promise<CommandResult> => {
    // hub-main starts the hub at import and exits the process itself when idle.
    await import('../mesh/hub-main.js');
    return new Promise<CommandResult>(() => {});
  },
};

export const meshCommand: Command = {
  name: 'mesh',
  description: 'Monomind Mesh: see and message the other agents running on this host',
  subcommands: [whoCommand, sendCommand, inboxCommand, hubCommand],
  examples: [{ command: 'monomind mesh who', description: 'Agents of this project' }],
  action: async (): Promise<CommandResult> => {
    output.writeln('Usage: monomind mesh <who|send|inbox> [options]');
    return { success: true };
  },
};

export default meshCommand;
