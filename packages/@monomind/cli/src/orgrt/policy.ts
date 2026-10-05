// packages/@monomind/cli/src/orgrt/policy.ts
// File-size sweep: secret redaction/summarization lives in policy-secrets.ts,
// and glob/path/domain matching lives in policy-paths.ts — both re-exported
// below where other modules import them from here.
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { OrgBus } from './bus.js';
import { execDenyViolation } from './exec-deny.js';
import { fileToolDenied, isDashboardCredential } from './file-roots.js';
import { isOperatorProtected } from './operator-protected-paths.js';
import { isAuthorityFile } from './org-authority-files.js';
import { checkGitPolicy } from './policy-git.js';
import {
  gitWriteViolation,
  globToRegExp,
  grantWithin,
  isWithin,
  pathFolds,
  realPath,
  safeHost,
  uniq,
  webDomainMatches,
} from './policy-paths.js';
import {
  describeScope,
  isGlobScope,
  type ScopeSnapshot,
  scopeDrift,
  snapshotScopes,
} from './policy-scopes.js';
import { redactSecrets, summarize } from './policy-secrets.js';
import type { RolePolicy } from './types.js';

export { globToRegExp, webDomainMatches } from './policy-paths.js';
export { redactSecrets, summarizeToolInput, summarizeToolOutput } from './policy-secrets.js';

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

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
/** Every path a file-tool call names: `file_path`, `path`, NotebookEdit's
 *  `notebook_path`, and the `file_path` of each MultiEdit edit. */
function toolPaths(input: Record<string, unknown>): string[] {
  const edits = Array.isArray(input.edits) ? (input.edits as Array<{ file_path?: unknown }>) : [];
  return [
    input.file_path,
    input.path,
    input.notebook_path,
    ...edits.map((e) => e?.file_path),
  ].filter((p): p is string => typeof p === 'string');
}
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
  /** #550: this role's runner refuses to start an exec below the budget
   *  floor, so a role under it is as good as out of budget. Set per session. */
  budgetFloorGated = false;
  /** #492: real paths of the non-glob fileWrite/fileRead entries, taken from
   *  the operator's config before the role runs (and again on `org reload`). */
  private scopeSnapshots: Map<string, ScopeSnapshot>;
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
    /** #498: the org root, whose `.monomind/orgs/` holds the authority files
     *  (org-authority-files.ts). Without it, cwd and every root count as one. */
    private orgRoot?: string,
  ) {
    // A caller may build an engine with no policy at all — treat it as {}.
    this.policy = policy ?? {};
    this.scopeSnapshots = snapshotScopes(this.policy, cwd);
  }

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
      ...(this.policy?.maxTokens != null ? { maxTokens: this.policy.maxTokens } : {}),
      ...(this.policy?.maxUsd != null ? { maxUsd: this.policy.maxUsd } : {}),
      ...(next ?? {}),
    };
    this.scopeSnapshots = snapshotScopes(this.policy, this.cwd);
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
      tool !== 'ToolSearch' && // loads deferred tool schemas, the org tools' among them
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
      // m1 (#498): every path argument the call carries is checked, so a
      // NotebookEdit naming both file_path and notebook_path, or a MultiEdit
      // whose edits name their own files, is refused if any of them is.
      const paths = toolPaths(input);
      if (paths.length === 0 && !unrestricted) {
        // Grep/Glob's `path` argument is optional in the SDK (defaults to cwd,
        // i.e. searches everything) — without this check, a path-less call
        // sailed straight through to allow() and bypassed fileRead/fileWrite
        // scoping entirely. Deny rather than guess which files it would touch.
        return deny(
          `${tool} has no path argument, but role ${this.role}'s ${WRITE_TOOLS.has(tool) ? 'write' : 'read'} scope is restricted — refusing an unscoped call; pass a path inside ${globs.map(describeScope).join(', ')} (relative to org workdir ${this.cwd})`,
        );
      }
      for (const p of paths) {
        const reason = this.filePathDenial(tool, p, globs);
        if (reason) return deny(reason);
      }
    }

    if (tool === 'Bash') {
      const cmd = String(input.command ?? '');
      const gitLevel = this.policy.git ?? 'read';
      const gitDenied = checkGitPolicy(cmd, gitLevel, { osSandboxed: this.osSandboxed });
      if (gitDenied) return deny(gitDenied);
      const execDenied = execDenyViolation(cmd, this.policy.sandbox?.denyExec);
      if (execDenied) return deny(execDenied);
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

  /** Session ids this role's runner has reported (and resumed). The runner saves a tool result that is
   *  too large under `<config dir>/projects/<slug>/<sessionId>/tool-results/` and tells the model to
   *  Read it; those files, of these sessions only, are readable (see isOwnToolOutput). */
  private ownSessions = new Set<string>();

  noteSessionId(id: string | undefined): void {
    if (id) this.ownSessions.add(id);
  }

  /** `real` is a path under `<config dir>/projects/<slug>/<own session id>/tool-results`. Nothing else of a
   *  session directory (the transcript, other files) and no other session's directory qualifies. */
  private isOwnToolOutput(real: string): boolean {
    if (this.ownSessions.size === 0) return false;
    const cfg = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const rel = relative(realPath(join(cfg, 'projects')), real);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false;
    const [, session, dir] = rel.split(sep);
    return dir === 'tool-results' && session !== undefined && this.ownSessions.has(session);
  }

  /** Why a file-tool call on `p` is refused, or null when it may proceed. */
  private filePathDenial(tool: string, p: string, globs: string[]): string | null {
    // SEC: compare REAL paths — a symlink inside the scope pointing outside
    // the workdir (or at an out-of-scope file) passed the lexical check.
    // Resolved once and reused below: the root check, the deny pass and
    // the .git check (#258) all key off the same real path.
    const real = realPath(resolve(this.cwd, p));
    const realCwd = realPath(this.cwd);
    // The runner's own saved copy of this role's large tool output: readable, never writable.
    if (READ_TOOLS.has(tool) && this.isOwnToolOutput(real)) return null;
    // #496: on a case-insensitive filesystem `.SSH`, `.GIT` and `Site` are
    // `.ssh`, `.git` and `site`. Deny checks compare with `fold.deny`
    // (always fully folded — policy-paths.ts's SegmentFold). Grants compare
    // on-disk spellings exactly and fold only a not-yet-existing tail, only
    // on darwin/win32 where the filesystem is probed case-insensitive
    // (grantWithin); globs never fold.
    const fold = pathFolds(real);
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
    // #492: an entry with no glob characters is a path — it grants that
    // path AND everything beneath it (a relative one resolves against the
    // org workdir). Matched on REAL paths via isWithin, so a symlink out of
    // the directory and a shared-prefix sibling (`site-old` vs `site`) both
    // miss. Glob entries keep their glob semantics.
    // B1: a directory entry matches against its SNAPSHOT, never a fresh
    // realpath — the role can't widen it by swapping it for a symlink. An
    // entry that no longer resolves to its snapshot refuses the call.
    const snaps = globs.map((g) => [g, this.scopeSnapshots.get(g)] as const);
    for (const [g, s] of snaps) {
      const drift = s && scopeDrift(g, s);
      if (drift) return drift;
    }
    const inScope = (g: string): boolean => {
      if (isGlobScope(g)) return globToRegExp(g).test(isAbsolute(g) ? realPosix : relPosix);
      const s = this.scopeSnapshots.get(g);
      return !!s && !s.refused && grantWithin(s.real, real, fold.allow);
    };
    const refusedNote = snaps
      .map(([, s]) => s?.refused)
      .filter(Boolean)
      .map((r) => `; ${r}`)
      .join('');
    // #303: an absolute fileRead/fileWrite entry is an explicit, author-
    // written grant — it authorizes a path on its own, independent of
    // cwd/roots, the same way `policy.sandbox.allowWrite` does for Bash.
    const grantedByAbsoluteScope = globs.some((g) => isAbsolute(g) && inScope(g));
    if (!grantedByAbsoluteScope) {
      // #303: beyond cwd, a role may also reach $TMPDIR, the org root, and
      // any operator-granted policy.sandbox.allowWrite entries — the same
      // roots the Bash sandbox already treats as writable (file-roots.ts).
      // $HOME is deliberately never one of them; see file-roots.ts's doc
      // comment.
      const realRoots = uniq([realCwd, ...this.roots.map(realPath)]);
      // #291: naming only the rejected path leaves the role guessing another
      // absolute path — it never learns the roots it is confined to. Name
      // the boundary and how paths resolve so the next turn can be correct.
      // #492: an absolute scope entry is a grant of its own — name it too,
      // with how it matches, or the role never learns it exists.
      const absGrants = globs.filter((g) => isAbsolute(g));
      if (!realRoots.some((root) => grantWithin(root, real, fold.allow)))
        return `path escapes every root this role may use: ${p} (roots: ${realRoots.join(', ')}${absGrants.length ? `; ${WRITE_TOOLS.has(tool) ? 'write' : 'read'} scope also grants ${absGrants.map(describeScope).join(', ')}` : ''} — paths are resolved relative to org workdir ${this.cwd}; retry with a path inside one of them)${refusedNote}`;
    }
    // #303: a widened root must not make credential stores, guard-undoing
    // config, sockets, or the XDG runtime dir reachable — today they are
    // unreachable purely because they sit outside cwd, an accident that
    // vanishes the moment another root admits them (e.g. allowWrite:
    // [$HOME]). Runs for READ_TOOLS too, unlike the .git check below,
    // which is write-only.
    const deniedHit = fileToolDenied(homedir(), process.env).find((d) =>
      isWithin(realPath(d), real, fold.deny),
    );
    if (deniedHit)
      return `path ${p} resolves inside ${deniedHit}, which no role may touch regardless of scope, root, or allowWrite (credential store, guard config, socket, or runtime dir)`;
    // #498: the org definitions (each role's own policy), the decision,
    // state and control files under the org root's .monomind/orgs/
    // (org-authority-files.ts). Both the resolved and the as-written path
    // are classified, so a symlink to one of them, or one of them that is
    // a symlink, is refused too. Without a known org root, every root the
    // role may use is treated as one.
    if (
      WRITE_TOOLS.has(tool) &&
      isAuthorityFile(
        { real, lexical: resolve(this.cwd, p) },
        this.orgRoot ? [this.orgRoot] : uniq([this.cwd, ...this.roots]),
        process.platform,
        fold.deny,
      )
    )
      return `path ${p} is org authority state (an org definition, a human's decisions, or runtime state under .monomind/orgs/) — no role may write it, regardless of scope, root, or allowWrite; only the operator and the org daemon do`;
    // #502 review: what the operator's own processes run or trust (the org
    // root's .claude/, the skill libraries, ~/.monomind, npx's cache, …).
    if (WRITE_TOOLS.has(tool)) {
      const ctx = {
        home: homedir(),
        env: process.env,
        orgRoot: this.orgRoot,
        cwd: this.cwd,
        allowWrite: this.policy.sandbox?.allowWrite,
      };
      // #517: through deny folding, like every other deny here.
      const denyWithin = (c: string, t: string) => isWithin(c, t, fold.deny);
      const protectedHit =
        isOperatorProtected(real, ctx, realPath, denyWithin) ??
        isOperatorProtected(resolve(this.cwd, p), ctx, realPath, denyWithin);
      if (protectedHit)
        return `path ${p} is inside ${protectedHit}, which the operator's own sessions run or trust — no role may write it unless policy.sandbox.allowWrite names it (a signed change)`;
    }
    if (isDashboardCredential(real, fold.deny))
      return `path ${p} is a dashboard credential, which no role may touch regardless of scope, root, or allowWrite`;
    if (!grantedByAbsoluteScope && !globs.some((g) => !isAbsolute(g) && inScope(g)))
      return `path ${rel} outside ${WRITE_TOOLS.has(tool) ? 'write' : 'read'} scope — role ${this.role} may use ${globs.map(describeScope).join(', ')} (relative to org workdir ${this.cwd})${refusedNote}`;
    // #258: Write/Edit run in-process, so the OS sandbox never sees them —
    // without this a 'read' role could write refs and objects straight into
    // .git, and a 'commit' role could rewrite the shared identity (#250) or
    // the hooks that enforce its own level. Still fires for a path admitted
    // via a root other than cwd (#303) — it does not depend on `rel`.
    if (WRITE_TOOLS.has(tool)) {
      const gitLevel = this.policy.git ?? 'read';
      const inGit = gitWriteViolation(real, gitLevel, process.platform, fold.deny);
      if (inGit) return `writes into ${inGit} are not allowed (policy.git: ${gitLevel})`;
    }
    return null;
  }
}
