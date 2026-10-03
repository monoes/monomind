// packages/@monomind/cli/src/orgrt/types-policy.ts
import { z } from 'zod';

/** Per-role provider config. Default (absent) = subscription login of local Claude Code.
 *
 *  @deprecated kind: 'gemini' | 'openai' — these only set GEMINI_API_KEY /
 *  OPENAI_API_KEY on the child env (see provider.ts); no runtime actually
 *  reads them (daemon.ts's autoRuntimeFromProvider has no case for either),
 *  so the role silently falls through to the default ClaudeAgentRunner and
 *  runs on Claude regardless. daemon.ts#startOrg warns loudly at start time
 *  when this happens. Use kind: 'vercel-api-key' with vendor: 'google' or
 *  vendor: 'openai' instead — that path actually routes to the requested
 *  provider via VercelAgentRunner. */
export const ProviderSchema = z
  .object({
    kind: z
      .enum([
        'subscription',
        'api-key',
        'base-url',
        'bedrock',
        'vertex',
        'gemini', // @deprecated — env-var-only; falls through to Claude. See class doc above.
        'openai', // @deprecated — env-var-only; falls through to Claude. See class doc above.
        'vercel-api-key',
        'codex',
        'antigravity',
      ])
      .default('subscription'),
    /** Which Vercel AI SDK provider to use (only when kind='vercel-api-key'). */
    vendor: z
      .enum([
        'openai',
        'anthropic',
        'google',
        'xai',
        'deepseek',
        'glm',
        'mistral',
        'groq',
        'together',
        'fireworks',
        'cohere',
        'perplexity',
        'alibaba',
        'openrouter',
        'ollama',
        'openai-compatible',
      ])
      .optional(),
    /** env var NAME holding the API key (never the key itself) */
    apiKeyEnv: z.string().optional(),
    /** Direct API-key value. Populated programmatically from the named-provider
     *  config (`monomind providers configure`) — org JSON should keep using
     *  apiKeyEnv so secrets never land in org definition files. */
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    /** env var NAME holding the auth token for base-url providers */
    authTokenEnv: z.string().optional(),
    /** Direct auth-token value for base-url providers. Populated programmatically
     *  from the named-provider config (`monomind providers configure`) — org JSON
     *  should keep using authTokenEnv so secrets never land in org definition files. */
    authToken: z.string().optional(),
    /** Opt in to UsageProxyServer token accounting for runtimes whose CLI output
     *  doesn't self-report usage (currently just `runtime: 'crush'`). When true,
     *  `baseUrl` above is treated as the upstream the CLI's own provider config
     *  points at, and the runner routes its traffic through a local proxy that
     *  parses usage out of the relayed request/response bodies. No effect for
     *  runtimes that don't support it (usage-proxy.ts, crush-runner.ts). */
    usageProxy: z.boolean().optional(),
    /** Override the env var the proxied CLI reads for its base-URL override.
     *  Defaults to CrushAgentRunner's own guess (OPENAI_BASE_URL) when unset. */
    usageProxyEnvVar: z.string().optional(),
  })
  .strict();

const THREAT_TYPES = [
  'prompt_injection',
  'jailbreak',
  'pii_exposure',
  'instruction_override',
  'role_switching',
  'context_manipulation',
  'encoding_attack',
  'data_exfiltration',
  'unknown',
] as const;

export const FenceAllowlistRuleSchema = z.object({
  id: z.string().min(1),
  pattern: z.string().min(1),
  types: z.array(z.enum(THREAT_TYPES)).default([]),
  context: z.string().optional(),
  reason: z.string().optional(),
  source: z.string().optional(),
});

export const FenceConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    confidenceThreshold: z.number().min(0).max(1).optional(),
    enablePIIDetection: z.boolean().optional(),
    scanMessages: z.boolean().default(true),
    scanOutput: z.boolean().default(false),
    abortThreshold: z.number().min(0).max(1).default(0.8),
    allowlist: z.array(FenceAllowlistRuleSchema).default([]),
  })
  .partial()
  .passthrough();

export type FenceConfig = z.infer<typeof FenceConfigSchema>;
export type FenceAllowlistRule = z.infer<typeof FenceAllowlistRuleSchema>;

export const RolePolicySchema = z
  .object({
    allowTools: z.array(z.string()).optional(),
    denyTools: z.array(z.string()).default([]),
    /** glob patterns relative to org cwd */
    fileWrite: z.array(z.string().min(1)).default(['**']),
    fileRead: z.array(z.string().min(1)).default(['**']),
    /** allowed domains for WebFetch/WebSearch; empty array = no web.
     *  Entries: exact host, subdomain suffix ('example.com' also matches
     *  'api.example.com'), '*.example.com' wildcard, or '*' for any host. */
    webAllow: z.array(z.string()).optional(),
    maxTokens: z.number().int().positive().optional(),
    /** ADR-O001 D1: which token basis `maxTokens` is compared against.
     *  'uncached' (default) — input + output only, the basis every existing
     *  budget_tokens value was written against. 'billable' — also counts
     *  cache reads and cache writes, i.e. what is actually billed. Derived by
     *  the daemon from `run_config.budget_tokens_basis`; never set per role in
     *  a config. */
    maxTokensBasis: z.enum(['uncached', 'billable']).optional(),
    /** USD spend cap for this role (ORG-7). Enforced the same way maxTokens/overBudget
     *  is: PolicyEngine.decide() denies once accumulated cost meets or exceeds it. */
    maxUsd: z.number().positive().optional(),
    /** Git access level: 'none' blocks all git, 'read' allows status/log/diff,
     *  'commit' allows add/commit, 'push' allows push. Default: 'read'. */
    git: z.enum(['none', 'read', 'commit', 'push']).default('read'),
    /** OS sandbox for claude-runtime roles below git 'push' (#258, see
     *  role-sandbox.ts). mode: 'auto' (default) sandboxes when bubblewrap/socat
     *  or seatbelt are available and audits when not; 'required' refuses to
     *  run unsandboxed; 'off' opts out. allowedDomains defaults to ['*'];
     *  deniedDomains is an opt-in host deny list; allowWrite adds
     *  writable paths; denyWrite makes paths read-only for the role's shell
     *  and file tools (relative paths resolve against the org root, so
     *  `["."]` keeps a QA role from writing anywhere in the checkout);
     *  allowUnixSockets (default true — Chrome needs one) can be turned off
     *  to block every AF_UNIX socket. */
    sandbox: z
      .object({
        mode: z.enum(['auto', 'required', 'off']).optional(),
        allowedDomains: z.array(z.string()).optional(),
        deniedDomains: z.array(z.string()).optional(),
        allowWrite: z.array(z.string()).optional(),
        denyWrite: z.array(z.string()).optional(),
        /** Programs the role must not be able to run (names, `*` globs, absolute paths): masked
         *  in a bubblewrap layer around the role's process tree and refused in its Bash commands
         *  (exec-deny.ts). Fails closed without bubblewrap. */
        denyExec: z.array(z.string()).optional(),
        allowUnixSockets: z.boolean().optional(),
      })
      .strict()
      .optional(),
    fence: FenceConfigSchema.optional(),
    /** Tool/action names this role may use WITHOUT pausing for human approval,
     *  even when the action is on checkApproval's sensitive-actions list
     *  (Bash, WebFetch, WebSearch, org_complete). Still subject to allowTools/
     *  denyTools and the policy engine's own allow/deny decision — this only
     *  skips the "pause and wait for a human" step for a role the operator has
     *  already decided to trust for that specific action. */
    autoApproveTools: z.array(z.string()).optional(),
    /** Extra tool/action names that pause for approval exactly like the
     *  built-in sensitive list (Bash, WebFetch, WebSearch, org_complete).
     *  Bare form — `org_send`, `monoagent__automation_publish` — never the
     *  `mcp__org__` namespaced form. `autoApproveTools` still wins. */
    approvalTools: z.array(z.string()).optional(),
    /** #365 (Coder mode for org roles): 'scoped' (default) is every field
     *  above, unchanged. 'full' removes the remaining PolicyEngine checks —
     *  no allowTools/denyTools/fileWrite/fileRead/webAllow/sandbox, no OS
     *  sandbox, no authority mask, `git` behaves as 'push' regardless of its
     *  own value. Only takes effect when `access_ack` (below) is present AND
     *  its hash matches the role's current security-relevant config — see
     *  access-grant.ts's `resolveRoleAccess`, the runtime's ONLY source of
     *  truth for whether a role actually runs with full access this session.
     *  Setting this field alone, from any config-writing path, grants
     *  nothing. */
    access: z.enum(['scoped', 'full']).default('scoped'),
    /** Coder mode (#356) settings sources this role's sessions load, when
     *  `access: 'full'` is active: any of 'user'/'project'/'local'. Ignored
     *  for a scoped role. Unset/`[]` = today's isolated behavior even when
     *  full access is active. */
    settings: z.array(z.enum(['user', 'project', 'local'])).optional(),
    /** Human-only grant record for `access: 'full'`, written ONLY by
     *  `monomind org role set-access <org> <role> full` after an interactive
     *  confirmation or `--yes-i-understand`. `hash` covers the role's
     *  security-relevant config (see access-ack.ts); `sig` is an
     *  HMAC-SHA256 of `{org, role, hash, at, by}` under a machine-local
     *  secret key that lives in the operator-credential directory
     *  (authority-mask.ts's `authorityDirs`) — a directory every
     *  scoped/sandboxed role is denied Read/Edit on. `hash` alone is a
     *  PUBLIC drift check, not an authenticator: anything that can write the
     *  org JSON could recompute it, so `resolveRoleAccess`
     *  (access-grant.ts) — the runtime's ONLY source of truth for whether a
     *  role actually runs with full access this session — verifies `sig`
     *  against that key before it ever trusts `hash`. The runtime
     *  recomputes `hash` every session start and drops the role to scoped
     *  (`access_state: 'suspended'`) the instant `sig` doesn't verify or
     *  `hash` no longer matches — so a config-writing path that merely
     *  copies this object forward without going through the human CLI (and
     *  without the key, which it cannot read) grants nothing. Never set
     *  this by hand or from a program other than that command. */
    access_ack: z
      .object({
        by: z.literal('human'),
        at: z.string(),
        hash: z.string(),
        sig: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .partial()
  .passthrough();
