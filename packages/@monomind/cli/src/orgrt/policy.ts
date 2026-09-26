// packages/@monomind/cli/src/orgrt/policy.ts
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDecisionFile } from './authority-mask.js';
import type { OrgBus } from './bus.js';
import { fileToolDenied, isDashboardCredential } from './file-roots.js';
import { checkGitPolicy } from './policy-git.js';
import { type RolePolicy, TOOL_RESULT_OUTPUT_MAX_CHARS } from './types.js';

export type Decision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

/** ADR-O001 D1: the four token quantities an Anthropic response bills for.
 *  They are SIBLINGS, not subsets — `input` is the uncached remainder only,
 *  while `cacheRead` (~0.1x input) and `cacheCreation` (~1.25x input) are
 *  billed on top of it. Summing only `input + output`, as this engine used
 *  to, reports ~0.3% of real consumption on a well-cached run. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

const zeroTokens = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });

const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
/** Harness messaging tools that bypass the org bus. Always denied: an agent
 *  that picks one gets the SDK's misleading "no agent named X is reachable"
 *  error, concludes its teammate is down, and deadlocks the run (observed in
 *  the field). org_send is the only inter-agent channel. */
const HARNESS_MESSAGING_TOOLS = new Set(['SendMessage']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch']);
/** Cap for inline content snapshots on 'asset' events (bytes, UTF-16 chars) — keeps
 *  bus.jsonl / the dashboard's per-session event log from bloating on large writes. */
const SNAPSHOT_MAX_CHARS = 20_000;
/** SEC: files whose content is never snapshotted onto the bus (bus.jsonl, SSE):
 *  dotfiles (.env*, .npmrc, .netrc, .git-credentials, ...), key/cert material,
 *  SSH keys, and anything named like a secret/credential store. */
const SENSITIVE_FILE =
  /(^|[/\\])(\.[^/\\]*|id_(rsa|dsa|ecdsa|ed25519)[^/\\]*|[^/\\]*(secret|credential)[^/\\]*|[^/\\]*\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|asc|gpg|kdbx))$/i;
/** SEC: secret shapes scrubbed from every bus payload — the argument summary on
 *  'tool' events and the content snapshot on 'asset' events. Prefix-keeping
 *  patterns ($1) leave the surrounding context readable; the rest are replaced
 *  whole. Deliberately loose: a false positive costs a readable value in an
 *  audit log, a false negative persists a live credential to disk. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED]'],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, '$1[REDACTED]'],
  [/\b(basic\s+)[A-Za-z0-9+/=]{16,}/gi, '$1[REDACTED]'],
  [/\b(sk|rk)-[A-Za-z0-9_-]{16,}/g, '[REDACTED]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[REDACTED]'],
  [/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED]'],
  // .env / shell: SOME_API_KEY=value, DB_PASSWORD="value"
  [
    /(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Z0-9_]*\s*=\s*)(["']?)[^\s"']+\2/g,
    '$1[REDACTED]',
  ],
  // json / yaml / cli: "apiKey": "value", password: value, api_key=value
  [
    /((?:api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key|client[_-]?secret|secret|password|passwd|token)["']?\s*[:=]\s*)(["']?)[^\s"',&]{6,}\2/gi,
    '$1[REDACTED]',
  ],
  // url credentials: scheme://user:password@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, '$1[REDACTED]@'],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  return out;
}

/** #289: the bounded, redacted slice of a tool's result body that goes on the
 *  bus. Redacts BEFORE truncating, so a cut-off credential can't leak the way
 *  a half-matched token would; keeps the head and states the truncation in
 *  structured fields rather than leaving a reader to infer it from an ellipsis. */
export function summarizeToolOutput(text: string): {
  output: string;
  truncated?: boolean;
  output_chars: number;
} {
  const clean = redactSecrets(text);
  if (clean.length <= TOOL_RESULT_OUTPUT_MAX_CHARS)
    return { output: clean, output_chars: text.length };
  return {
    output: `${clean.slice(0, TOOL_RESULT_OUTPUT_MAX_CHARS)}…[truncated]`,
    truncated: true,
    output_chars: text.length,
  };
}

const REGEX_METACHARS = new Set('.+^${}()|[]\\'.split(''));

/**
 * tiny glob→RegExp: `**\/` matches zero-or-more leading directories (so
 * `**\/*.md` matches both `README.md` and `docs/README.md`, standard glob
 * semantics), bare `**` matches any depth, `*` matches one path segment.
 */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    if (glob.startsWith('**/', i)) {
      out += '(?:.*/)?';
      i += 3;
      continue;
    }
    if (glob.startsWith('**', i)) {
      out += '.*';
      i += 2;
      continue;
    }
    const c = glob[i];
    if (c === '*') {
      out += '[^/]*';
      i++;
      continue;
    }
    if (REGEX_METACHARS.has(c)) {
      out += `\\${c}`;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return new RegExp(`^${out}$`);
}

/** Extra per-role context the daemon wires into a PolicyEngine (M1). */
export interface PolicyToolContext {
  /** `<prefix>__` of every tool provider of the role — exempt from allowTools
   *  like `mcp__org__` (fence/Vercel runners pass bare provider tool names). */
  providerPrefixes?: () => string[];
  /** The role's current chain trace; copied onto every `tool` event. */
  trace?: () => { chain_id: string; hop: number } | undefined;
}

const ORG_TOOL_NS = 'mcp__org__';

export class PolicyEngine {
  /** ADR-O001 D1: the four billable quantities, tracked separately. */
  private tokens: TokenUsage = zeroTokens();
  /** ORG-7: accumulated USD cost for this role, mirrors `used` (tokens). */
  private usedUsd = 0;
  private toolContext: PolicyToolContext = {};
  private osSandboxed = false;
  constructor(
    readonly role: string,
    public policy: RolePolicy,
    private bus: OrgBus,
    private cwd: string,
    /** #303: extra roots the file tools may touch beyond cwd — the role's
     *  temp dir, the org root, and any `policy.sandbox.allowWrite` entries
     *  (file-roots.ts's `fileToolRoots()`, computed by the daemon). Deny
     *  lists (file-roots.ts's `fileToolDenied()`) still apply inside every
     *  root, cwd included — see the deny pass below. */
    private roots: string[] = [],
  ) {}

  /** Whether this role's current session runs Bash inside the SDK's OS
   *  sandbox — set by session.ts from the runtime result of
   *  resolveRoleGitEnforcement, so it is false for mode 'off', an unavailable
   *  sandbox, push roles and non-Claude runtimes. Relaxes only checkGitPolicy's
   *  fail-closed rule for commands it can't read (policy-git.ts). */
  setOsSandboxed(on: boolean): void {
    this.osSandboxed = on;
  }

  /** Wire provider prefixes and trace source (daemon, M1). */
  setToolContext(ctx: PolicyToolContext): void {
    this.toolContext = ctx;
  }

  /** Hot reload (`org reload`): replace the role's policy. Budget ceilings the
   *  daemon derived at spawn (maxTokens/maxUsd) are kept unless the new policy
   *  sets them itself. */
  updatePolicy(next: RolePolicy): void {
    this.policy = {
      ...(this.policy.maxTokens != null ? { maxTokens: this.policy.maxTokens } : {}),
      ...(this.policy.maxUsd != null ? { maxUsd: this.policy.maxUsd } : {}),
      ...(next ?? {}),
    };
  }

  /** #343 hot reload of budget_tokens / budget_usd: replace the ceilings and
   *  keep what has been spent — the new cap applies to total spend. */
  setBudgetCaps(caps: { maxTokens?: number; maxUsd?: number }): void {
    this.policy = { ...this.policy, maxTokens: caps.maxTokens, maxUsd: caps.maxUsd };
  }

  /** Legacy scalar accumulator. A caller with no breakdown to give (a
   *  pre-ADR-O001 checkpoint, a runner that reports one number) lands on the
   *  uncached `input` bucket — the basis such a number has always been on —
   *  so it counts toward both `usage` and `budgetedUsage` and nothing that
   *  used to bind stops binding. */
  addUsage(tokens: number): void {
    this.tokens.input += tokens;
  }
  /** ADR-O001 D1: add one turn's real usage, per quantity. */
  addTokenUsage(u: Partial<TokenUsage>): void {
    this.tokens.input += u.input ?? 0;
    this.tokens.output += u.output ?? 0;
    this.tokens.cacheRead += u.cacheRead ?? 0;
    this.tokens.cacheCreation += u.cacheCreation ?? 0;
  }
  /** The honest meter: every billable token this role has consumed, cache
   *  reads and cache writes included. Reporting, checkpoints and dashboards
   *  read this. */
  get usage(): number {
    return (
      this.tokens.input + this.tokens.output + this.tokens.cacheRead + this.tokens.cacheCreation
    );
  }
  /** The four quantities, for per-role persistence (checkpoint.ts). */
  get tokenUsage(): TokenUsage {
    return { ...this.tokens };
  }
  /** ADR-O001 D1: what `maxTokens` (role.budget_tokens / run_config.budget_tokens)
   *  is compared against.
   *
   *  It deliberately is NOT `usage`. Counting cache tokens multiplies the
   *  observed volume by ~100x on a well-cached run, so an existing
   *  `budget_tokens` — including the schema's 1M default, which every org
   *  gets whether or not it asked for one — would exhaust within a couple of
   *  turns and close every mailbox. The meter therefore becomes honest while
   *  the budget keeps the basis it was written against, unless a config opts
   *  in via `run_config.budget_tokens_basis: 'billable'`. USD budgets
   *  (`budget_usd`) are unaffected and are the control ADR-O001 recommends. */
  get budgetedUsage(): number {
    return this.policy.maxTokensBasis === 'billable'
      ? this.usage
      : this.tokens.input + this.tokens.output;
  }
  /** Set usage counter directly for checkpoint/resume - Pattern 3.
   *  Scalar form: a pre-ADR-O001 checkpoint has no breakdown to restore, so
   *  the value lands on the legacy (uncached) basis it was recorded on. */
  setUsage(tokens: number): void {
    this.tokens = { ...zeroTokens(), input: tokens };
  }
  /** Restore a persisted breakdown (checkpoint.ts's `tokenUsage`). */
  setTokenUsage(u: TokenUsage): void {
    this.tokens = { ...u };
  }
  get overBudget(): boolean {
    return this.policy.maxTokens != null && this.budgetedUsage >= this.policy.maxTokens;
  }

  /** ORG-7: accumulate real USD cost (from 'usage' bus events' data.cost_usd). */
  addUsageUsd(costUsd: number): void {
    this.usedUsd += costUsd;
  }
  get usageUsd(): number {
    return this.usedUsd;
  }
  /** Set USD usage counter directly for checkpoint/resume, mirrors setUsage(). */
  setUsageUsd(costUsd: number): void {
    this.usedUsd = costUsd;
  }
  /** ORG-7: parallel to overBudget (token), but for the role's USD spend cap
   *  (policy.maxUsd, from OrgRole.budget_usd). Unset maxUsd means no USD
   *  enforcement for this role — only overBudget (tokens) applies. */
  get overBudgetUsd(): boolean {
    return this.policy.maxUsd != null && this.usedUsd >= this.policy.maxUsd;
  }

  /** @param callId #289: the harness's tool-use id for THIS call, stamped onto
   *  the emitted 'tool' event as `call_id` so the later 'tool_result' event can
   *  be joined back to it — by id, since a role can run the same tool twice
   *  concurrently and the tool name alone does not identify a call. */
  async decide(tool: string, input: Record<string, unknown>, callId?: string): Promise<Decision> {
    const eventData = (): Record<string, unknown> => {
      const trace = this.toolContext.trace?.();
      return {
        input: summarize(input),
        ...(callId ? { call_id: callId } : {}),
        ...(trace ? { chain_id: trace.chain_id, hop: trace.hop } : {}),
      };
    };
    const deny = (reason: string): Decision => {
      this.bus.emit({
        type: 'tool',
        from: this.role,
        tool,
        decision: 'deny',
        reason,
        data: eventData(),
      });
      return { behavior: 'deny', message: `[org-policy] ${reason}` };
    };
    const allow = (): Decision => {
      this.bus.emit({
        type: 'tool',
        from: this.role,
        tool,
        decision: 'allow',
        data: eventData(),
      });
      if (WRITE_TOOLS.has(tool) && typeof input.file_path === 'string') {
        // Snapshot the full resulting content when we actually have it at decide()
        // time. Write's `content` param IS the complete post-write file — capture
        // it inline on the event so the dashboard can diff this version against a
        // later one without re-reading disk (which only ever holds the CURRENT
        // version). Edit only carries old_string/new_string fragments, not the
        // resulting whole file, so there is nothing accurate to snapshot there —
        // the event still records the write (path, from), just without content.
        const content =
          tool === 'Write' &&
          typeof input.content === 'string' &&
          input.content.length <= SNAPSHOT_MAX_CHARS &&
          !SENSITIVE_FILE.test(String(input.file_path))
            ? redactSecrets(input.content)
            : undefined;
        this.bus.emit({
          type: 'asset',
          from: this.role,
          path: String(input.file_path),
          ...(content !== undefined ? { data: { content } } : {}),
        });
      }
      return { behavior: 'allow', updatedInput: input };
    };

    if (HARNESS_MESSAGING_TOOLS.has(tool))
      return deny(
        `${tool} does not reach org agents — inter-agent messaging goes through the org_send tool only; resend via org_send (to, subject, message)`,
      );
    if (this.overBudget)
      return deny(`token budget exhausted (${this.budgetedUsage}/${this.policy.maxTokens})`);
    if (this.overBudgetUsd)
      return deny(`USD budget exhausted ($${this.usedUsd.toFixed(4)}/$${this.policy.maxUsd})`);
    // denyTools entries use the bare name (`org_send`, `monoagent__x`), the
    // same form approvals use — match the namespaced Claude form too.
    const bare = tool.startsWith(ORG_TOOL_NS) ? tool.slice(ORG_TOOL_NS.length) : tool;
    if (this.policy.denyTools?.includes(tool) || this.policy.denyTools?.includes(bare))
      return deny(`tool ${tool} is denied for role ${this.role}`);
    if (
      this.policy.allowTools &&
      !this.policy.allowTools.includes(tool) &&
      !tool.startsWith(ORG_TOOL_NS) &&
      !(this.toolContext.providerPrefixes?.() ?? []).some((p) => tool.startsWith(p))
    )
      return deny(
        `tool ${tool} not in allowlist for role ${this.role} — allowed: ${this.policy.allowTools.join(', ')}`,
      );

    if (WRITE_TOOLS.has(tool) || READ_TOOLS.has(tool)) {
      const globs = WRITE_TOOLS.has(tool)
        ? (this.policy.fileWrite ?? ['**'])
        : (this.policy.fileRead ?? ['**']);
      const unrestricted = globs.length === 1 && globs[0] === '**';
      const p =
        typeof input.file_path === 'string'
          ? input.file_path
          : typeof input.path === 'string'
            ? input.path
            : null;
      if (p === null && !unrestricted) {
        // Grep/Glob's `path` argument is optional in the SDK (defaults to cwd,
        // i.e. searches everything) — without this check, a path-less call
        // sailed straight through to allow() and bypassed fileRead/fileWrite
        // scoping entirely. Deny rather than guess which files it would touch.
        return deny(
          `${tool} has no path argument, but role ${this.role}'s ${WRITE_TOOLS.has(tool) ? 'write' : 'read'} scope is restricted — refusing an unscoped call; pass a path inside ${globs.join(', ')} (relative to org workdir ${this.cwd})`,
        );
      }
      if (p !== null) {
        // SEC: compare REAL paths — a symlink inside the scope pointing outside
        // the workdir (or at an out-of-scope file) passed the lexical check.
        // Resolved once and reused below: the root check, the deny pass and
        // the .git check (#258) all key off the same real path.
        const real = realPath(resolve(this.cwd, p));
        const realCwd = realPath(this.cwd);
        // fileWrite/fileRead globs are always authored with '/' separators (POSIX
        // convention, matches every example in types.ts and the skill docs) — but
        // path.relative()/path.resolve() return '\'-separated paths on Windows, and
        // globToRegExp treats '\' as a literal character, not a separator. Without
        // normalizing, every glob with a '/' in it silently fails to match on
        // Windows and a role with ANY fileWrite/fileRead scope narrower than the
        // unrestricted ['**'] default is denied on every single call.
        const rel = relative(realCwd, real);
        const relPosix = rel.split(sep).join('/');
        const realPosix = real.split(sep).join('/');
        // #303: an absolute fileRead/fileWrite glob is an explicit, author-
        // written grant — it authorizes a path on its own, independent of
        // cwd/roots, the same way `policy.sandbox.allowWrite` does for Bash.
        const grantedByAbsoluteGlob = globs.some(
          (g) => isAbsolute(g) && globToRegExp(g).test(realPosix),
        );
        if (!grantedByAbsoluteGlob) {
          // #303: beyond cwd, a role may also reach $TMPDIR, the org root, and
          // any operator-granted policy.sandbox.allowWrite entries — the same
          // roots the Bash sandbox already treats as writable (file-roots.ts).
          // $HOME is deliberately never one of them; see file-roots.ts's doc
          // comment.
          const realRoots = uniq([realCwd, ...this.roots.map(realPath)]);
          // #291: naming only the rejected path leaves the role guessing another
          // absolute path — it never learns the roots it is confined to. Name
          // the boundary and how paths resolve so the next turn can be correct.
          if (!realRoots.some((root) => isWithin(root, real)))
            return deny(
              `path escapes every root this role may use: ${p} (roots: ${realRoots.join(', ')} — paths are resolved relative to org workdir ${this.cwd}; retry with a path inside one of them)`,
            );
        }
        // #303: a widened root must not make credential stores, guard-undoing
        // config, sockets, or the XDG runtime dir reachable — today they are
        // unreachable purely because they sit outside cwd, an accident that
        // vanishes the moment another root admits them (e.g. allowWrite:
        // [$HOME]). Runs for READ_TOOLS too, unlike the .git check below,
        // which is write-only.
        const deniedHit = fileToolDenied(homedir(), process.env).find((d) =>
          isWithin(realPath(d), real),
        );
        if (deniedHit)
          return deny(
            `path ${p} resolves inside ${deniedHit}, which no role may touch regardless of scope, root, or allowWrite (credential store, guard config, socket, or runtime dir)`,
          );
        if (WRITE_TOOLS.has(tool) && isDecisionFile(real))
          return deny(
            `path ${p} records a human's decisions (gates, approvals, questions, inbox) — only the org daemon writes it`,
          );
        if (isDashboardCredential(real))
          return deny(
            `path ${p} is a dashboard credential, which no role may touch regardless of scope, root, or allowWrite`,
          );
        if (
          !grantedByAbsoluteGlob &&
          !globs.some((g) => !isAbsolute(g) && globToRegExp(g).test(relPosix))
        )
          return deny(
            `path ${rel} outside ${WRITE_TOOLS.has(tool) ? 'write' : 'read'} scope — role ${this.role} may use ${globs.join(', ')} (relative to org workdir ${this.cwd})`,
          );
        // #258: Write/Edit run in-process, so the OS sandbox never sees them —
        // without this a 'read' role could write refs and objects straight into
        // .git, and a 'commit' role could rewrite the shared identity (#250) or
        // the hooks that enforce its own level. Still fires for a path admitted
        // via a root other than cwd (#303) — it does not depend on `rel`.
        if (WRITE_TOOLS.has(tool)) {
          const gitLevel = this.policy.git ?? 'read';
          const segments = real.split(sep);
          const at = segments.lastIndexOf('.git');
          const inGit = segments[at + 1];
          if (
            gitLevel !== 'push' &&
            at !== -1 &&
            (gitLevel !== 'commit' || inGit === 'config' || inGit === 'hooks')
          )
            return deny(
              `writes into ${segments.slice(at).join('/')} are not allowed (policy.git: ${gitLevel})`,
            );
        }
      }
    }

    if (tool === 'Bash') {
      const cmd = String(input.command ?? '');
      const gitLevel = this.policy.git ?? 'read';
      const gitDenied = checkGitPolicy(cmd, gitLevel, { osSandboxed: this.osSandboxed });
      if (gitDenied) return deny(gitDenied);
    }

    if (WEB_TOOLS.has(tool) && this.policy.webAllow !== undefined) {
      if (this.policy.webAllow.length === 0)
        return deny(`web access disabled for role ${this.role}`);
      if (tool === 'WebFetch') {
        const host = safeHost(String(input.url ?? ''));
        if (!host || !this.policy.webAllow.some((d) => webDomainMatches(d, host)))
          return deny(
            `domain ${host ?? '?'} not in research allowlist — allowed: ${this.policy.webAllow.join(', ')}`,
          );
      }
      // WebSearch has no URL up front; allowed if webAllow is non-empty
    }

    return allow();
  }
}

/** webAllow entry matcher. `*` allows any host (the intuitive "no
 *  restriction" value); `*.example.com` matches the bare domain and every
 *  subdomain; anything else is an exact host or subdomain suffix match. */
export function webDomainMatches(pattern: string, host: string): boolean {
  if (pattern === '*') return true;
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === pattern || host.endsWith(`.${pattern}`);
}

const uniq = (xs: string[]): string[] => [...new Set(xs)];

/** #303: is `target` equal to, or nested under, `container`? Both must
 *  already be `realPath()`-resolved — this is a plain string comparison, not
 *  a filesystem check, so a symlink escape must be resolved before this
 *  runs, never lexically. */
function isWithin(container: string, target: string): boolean {
  if (container === target) return true;
  const withSep = container.endsWith(sep) ? container : container + sep;
  return target.startsWith(withSep);
}

/** realpath of `p`, resolving through the nearest EXISTING ancestor when the
 *  target itself doesn't exist yet (a Write into a symlinked directory), and
 *  falling back to the lexical path when nothing on it exists. */
function realPath(p: string): string {
  const rest: string[] = [];
  let cur = p;
  for (;;) {
    try {
      return join(realpathSync(cur), ...rest);
    } catch {
      /* not there — try the parent */
    }
    const parent = dirname(cur);
    if (parent === cur) return p;
    rest.unshift(basename(cur));
    cur = parent;
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
/** Redacted, truncated argument summary — the form `tool` events log (and,
 *  since M5, approval requests carry). */
export function summarizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  return summarize(input);
}
function summarize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v !== 'string') {
      out[k] = v;
      continue;
    }
    const clean = redactSecrets(v); // redact BEFORE truncating so a cut-off token can't leak
    out[k] = clean.length > 200 ? `${clean.slice(0, 200)}…` : clean;
  }
  return out;
}
