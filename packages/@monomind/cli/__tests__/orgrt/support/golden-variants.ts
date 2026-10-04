// packages/@monomind/cli/__tests__/orgrt/support/golden-variants.ts
//
// Org sections P3.0: the sections-off definition variants and the renderers
// the goldens use. A "variant" is a definition with no top-level `sections`
// key, plus one thing 13.1.3 names (a context key, a task scope, loadouts,
// an endpoint role, completion modes, ...). Renderers take a variant and
// return what a model is shown (tool list, system prompt) as small, stable
// records: names in order, one sha per tool, and one sha for the whole list.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeAgentRunner } from '../../../src/orgrt/agent-runner.js';
import type { OrgBus } from '../../../src/orgrt/bus.js';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { dagCreateTask } from '../../../src/orgrt/decisions.js';
import type { Mailbox } from '../../../src/orgrt/mailbox.js';
import type { PolicyEngine } from '../../../src/orgrt/policy.js';
import { buildOrgTools, type SessionOpts } from '../../../src/orgrt/session.js';
import { OrgDefSchema, type OrgDef, type OrgRole } from '../../../src/orgrt/types.js';

export const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

const NO_SANDBOX = { sandbox: { mode: 'off' } }; // keeps prompts host-independent (#339)

export interface Variant {
  name: string;
  /** The raw definition, before OrgDefSchema.parse. */
  raw: Record<string, unknown>;
  /** SessionOpts extras the daemon would wire for this definition. */
  opts?: Record<string, unknown>;
  /** The loadout the boss picks for the dev task, when the org has a catalog. */
  loadout?: string;
  /** False for a variant a real daemon run would have to spawn processes for. */
  daemon?: boolean;
}

function base(runConfig: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    name: 'acme',
    goal: 'ship the widget',
    run_config: { idle_minutes: 0, ...runConfig },
    roles: [
      { id: 'boss', title: 'Boss', type: 'coordinator', responsibilities: ['plan'], policy: NO_SANDBOX },
      {
        id: 'dev',
        title: 'Developer',
        type: 'specialist',
        reports_to: 'boss',
        responsibilities: ['write code', 'write tests'],
        policy: NO_SANDBOX,
      },
    ],
    ...extra,
  } as Record<string, unknown>;
}

const endpointRole = {
  id: 'hook',
  title: 'Publisher',
  kind: 'endpoint',
  type: 'automation',
  reports_to: 'boss',
  endpoint: { url: 'http://127.0.0.1:1/org-endpoint/ep_golden', input_hint: 'Send the text.' },
};

const withRoles = (extra: Record<string, unknown>[], patch: (r: Record<string, unknown>[]) => void = () => {}) => {
  const raw = base();
  (raw.roles as Record<string, unknown>[]).push(...extra);
  patch(raw.roles as Record<string, unknown>[]);
  return raw;
};

export const VARIANTS: Variant[] = [
  { name: 'plain', raw: base() },
  { name: 'task-scoped', raw: base({ session_scope: 'task' }) },
  {
    name: 'loadouts',
    raw: base({}, {
      loadouts: {
        impl: { description: 'implementation work', prompt: 'Write small, tested changes.' },
        review: { description: 'review work', prompt: 'Read the diff before commenting.' },
      },
    }),
    opts: { loadoutCatalog: [{ name: 'impl', description: 'implementation work' }, { name: 'review', description: 'review work' }] },
    loadout: 'impl',
  },
  { name: 'context-require-brief', raw: base({ context: { require_brief: true } }) },
  { name: 'context-notes', raw: base({ context: { notes: true } }), opts: { orgDir: '/work/.org' } },
  { name: 'context-session-cap', raw: base({ context: { session_cap: { tasks: 10 } } }) },
  { name: 'endpoint-role', raw: withRoles([endpointRole]) },
  {
    name: 'tool-providers',
    raw: withRoles([], (roles) => {
      (roles[1] as Record<string, unknown>).tool_providers = [
        { kind: 'mcp-stdio', name: 'fake-provider', command: 'node', args: ['-e', ''] },
      ];
    }),
    daemon: false,
  },
  { name: 'respawn-enabled', raw: base({ max_role_respawns: 1 }) },
  {
    name: 'artifact-reviewer',
    raw: withRoles([{ id: 'rev', title: 'Reviewer', type: 'specialist', reports_to: 'boss', review_input: 'artifact-only', policy: NO_SANDBOX }]),
  },
  { name: 'completion-dag', raw: base({ completion: 'dag' }) },
  { name: 'completion-evidence', raw: base({ completion_evidence: true }), opts: { requireTaskEvidence: true } },
  { name: 'verify-writes-off', raw: base({ verify_writes: false }) },
  { name: 'lead-watch-off', raw: base({ lead_watch: false }) },
  {
    name: 'everything-sections-off',
    raw: base({
      completion: 'dag',
      completion_evidence: true,
      verify_writes: false,
      lead_watch: { not_started_s: 30, silent_s: 60 },
      session_scope: 'task',
      notify_task_creator: true,
      context: { require_brief: true, notes: true, session_cap: { tasks: 5 } },
    }),
    opts: { requireTaskEvidence: true, orgDir: '/work/.org' },
  },
];

export const parseVariant = (v: Variant): OrgDef => OrgDefSchema.parse(v.raw);

// ---- tool list rendering (what the org MCP server's tools/list returns) ----

export interface ToolsRender {
  names: string[];
  toolShas: Record<string, string>;
  sha: string;
}

interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export function summariseTools(tools: ListedTool[]): ToolsRender {
  return {
    names: tools.map((t) => t.name),
    toolShas: Object.fromEntries(
      tools.map((t) => [t.name, sha(JSON.stringify({ description: t.description, schema: t.inputSchema }))]),
    ),
    // the same bytes org-loadouts-default-off.test.ts hashes
    sha: sha(JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, schema: t.inputSchema })))),
  };
}

/** The tools/list a runner's org MCP server answers, from `options.mcpServers.org`. */
export async function listServerTools(server: any): Promise<ListedTool[]> {
  const { tools } = await server.instance.server._requestHandlers.get('tools/list')(
    { method: 'tools/list', params: {} },
    { signal: new AbortController().signal },
  );
  return tools as ListedTool[];
}

/** Render an org tool list through ClaudeAgentRunner, as org-loadouts-default-off does. */
export async function renderTools(opts: SessionOpts, extra: unknown[] = []): Promise<ToolsRender> {
  let server: any;
  const fakeQuery = ({ options }: any) =>
    (async function* () {
      server = options.mcpServers.org;
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  const run = new ClaudeAgentRunner(fakeQuery as any).run({
    tools: [...buildOrgTools(opts), ...extra],
    prompt: (async function* () {})(),
    systemPrompt: '',
    cwd: '/work',
  } as any);
  for await (const _ of run) {
    // drain
  }
  return summariseTools(await listServerTools(server));
}

/** Every task/DAG callback wired, so every gated tool is present. */
export function allCallbacks(): Record<string, unknown> {
  return {
    deliver: async () => 'ok',
    askHuman: async () => 'ok',
    onComplete: () => null,
    onGate: async () => 'ok',
    recall: async () => 'ok',
    remember: async () => 'ok',
    searchKnowledge: async () => 'ok',
    createTask: () => 'ok',
    completeTask: () => 'ok',
    listTasks: () => 'ok',
    splitTask: () => 'ok',
    mergeTask: () => 'ok',
    cancelTask: () => 'ok',
    blockTask: () => 'ok',
    planGraph: () => 'ok',
    learn: async () => 'ok',
    requestReview: () => 'ok',
    onRespawnRole: async () => ({}),
    onListRuntimeOptions: async () => ({}),
    onSkillLoad: () => undefined,
  };
}

export function sessionOpts(def: OrgDef, role: OrgRole, extra: Record<string, unknown> = {}): SessionOpts {
  return {
    org: def.name,
    role,
    bus: {} as OrgBus,
    policy: {} as PolicyEngine,
    mailbox: {} as Mailbox,
    cwd: '/work',
    def,
    deliver: async () => 'ok',
    ...extra,
  } as unknown as SessionOpts;
}

// ---- a real OrgDaemon run per variant, capturing what each role session sees ----

export interface RoleCapture {
  tools: ToolsRender;
  systemPrompt: string;
}

const until = async (pred: () => boolean, ms = 20_000): Promise<void> => {
  for (let i = 0; i < ms / 10 && !pred(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!pred()) throw new Error('golden capture: condition not reached');
};

/** Start the variant in a real daemon, address the boss and the dev, and
 *  record each role's tool list and system prompt as its runner receives them. */
export async function captureVariantInDaemon(
  v: Variant,
  tmp: string,
): Promise<{ captures: Record<string, RoleCapture>; root: string }> {
  const root = mkdtempSync(join(tmp, 'golden-variant-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(join(root, '.monomind/orgs/acme.json'), JSON.stringify(v.raw));
  const captures: Record<string, RoleCapture> = {};
  const queryFn = ({ prompt, options }: any) =>
    (async function* () {
      const id = /You are agent "([^"]+)"/.exec(options.systemPrompt)?.[1] ?? 'unknown';
      if (!captures[id]) {
        captures[id] = {
          tools: summariseTools(await listServerTools(options.mcpServers.org)),
          systemPrompt: String(options.systemPrompt),
        };
      }
      for await (const _ of prompt) {
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      }
    })();
  const d = new OrgDaemon(root, { queryFn: queryFn as any, forward: false });
  await d.startOrg('acme');
  dagCreateTask(d, 'acme', 'boss', 'build it', 'dev', [], v.loadout, 'the brief');
  await until(() => Boolean(captures.boss && captures.dev));
  await d.stopAll();
  return { captures, root };
}
