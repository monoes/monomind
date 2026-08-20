// packages/@monomind/cli/src/orgrt/policy.ts
import { relative, resolve, sep } from 'node:path';
import type { OrgBus } from './bus.js';
import type { RolePolicy } from './types.js';

export type Decision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

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
    if (glob.startsWith('**/', i)) { out += '(?:.*/)?'; i += 3; continue; }
    if (glob.startsWith('**', i)) { out += '.*'; i += 2; continue; }
    const c = glob[i];
    if (c === '*') { out += '[^/]*'; i++; continue; }
    if (REGEX_METACHARS.has(c)) { out += '\\' + c; i++; continue; }
    out += c; i++;
  }
  return new RegExp(`^${out}$`);
}

export class PolicyEngine {
  private used = 0;
  /** ORG-7: accumulated USD cost for this role, mirrors `used` (tokens). */
  private usedUsd = 0;
  constructor(
    readonly role: string,
    readonly policy: RolePolicy,
    private bus: OrgBus,
    private cwd: string,
  ) {}

  addUsage(tokens: number): void { this.used += tokens; }
  get usage(): number { return this.used; }
  /** Set usage counter directly for checkpoint/resume - Pattern 3 */
  setUsage(tokens: number): void { this.used = tokens; }
  get overBudget(): boolean {
    return this.policy.maxTokens != null && this.used >= this.policy.maxTokens;
  }

  /** ORG-7: accumulate real USD cost (from 'usage' bus events' data.cost_usd). */
  addUsageUsd(costUsd: number): void { this.usedUsd += costUsd; }
  get usageUsd(): number { return this.usedUsd; }
  /** Set USD usage counter directly for checkpoint/resume, mirrors setUsage(). */
  setUsageUsd(costUsd: number): void { this.usedUsd = costUsd; }
  /** ORG-7: parallel to overBudget (token), but for the role's USD spend cap
   *  (policy.maxUsd, from OrgRole.budget_usd). Unset maxUsd means no USD
   *  enforcement for this role — only overBudget (tokens) applies. */
  get overBudgetUsd(): boolean {
    return this.policy.maxUsd != null && this.usedUsd >= this.policy.maxUsd;
  }

  async decide(tool: string, input: Record<string, unknown>): Promise<Decision> {
    const deny = (reason: string): Decision => {
      this.bus.emit({ type: 'tool', from: this.role, tool, decision: 'deny', reason, data: { input: summarize(input) } });
      return { behavior: 'deny', message: `[org-policy] ${reason}` };
    };
    const allow = (): Decision => {
      this.bus.emit({ type: 'tool', from: this.role, tool, decision: 'allow', data: { input: summarize(input) } });
      if (WRITE_TOOLS.has(tool) && typeof input.file_path === 'string') {
        // Snapshot the full resulting content when we actually have it at decide()
        // time. Write's `content` param IS the complete post-write file — capture
        // it inline on the event so the dashboard can diff this version against a
        // later one without re-reading disk (which only ever holds the CURRENT
        // version). Edit only carries old_string/new_string fragments, not the
        // resulting whole file, so there is nothing accurate to snapshot there —
        // the event still records the write (path, from), just without content.
        const content = tool === 'Write' && typeof input.content === 'string'
          && input.content.length <= SNAPSHOT_MAX_CHARS ? input.content : undefined;
        this.bus.emit({
          type: 'asset', from: this.role, path: String(input.file_path),
          ...(content !== undefined ? { data: { content } } : {}),
        });
      }
      return { behavior: 'allow', updatedInput: input };
    };

    if (HARNESS_MESSAGING_TOOLS.has(tool))
      return deny(`${tool} does not reach org agents — inter-agent messaging goes through the org_send tool only; resend via org_send (to, subject, message)`);
    if (this.overBudget) return deny(`token budget exhausted (${this.used}/${this.policy.maxTokens})`);
    if (this.overBudgetUsd) return deny(`USD budget exhausted ($${this.usedUsd.toFixed(4)}/$${this.policy.maxUsd})`);
    if (this.policy.denyTools?.includes(tool)) return deny(`tool ${tool} is denied for role ${this.role}`);
    if (this.policy.allowTools && !this.policy.allowTools.includes(tool) && !tool.startsWith('mcp__org__'))
      return deny(`tool ${tool} not in allowlist for role ${this.role}`);

    if (WRITE_TOOLS.has(tool) || READ_TOOLS.has(tool)) {
      const globs = WRITE_TOOLS.has(tool) ? (this.policy.fileWrite ?? ['**']) : (this.policy.fileRead ?? ['**']);
      const unrestricted = globs.length === 1 && globs[0] === '**';
      const p = typeof input.file_path === 'string' ? input.file_path
        : typeof input.path === 'string' ? input.path : null;
      if (p === null && !unrestricted) {
        // Grep/Glob's `path` argument is optional in the SDK (defaults to cwd,
        // i.e. searches everything) — without this check, a path-less call
        // sailed straight through to allow() and bypassed fileRead/fileWrite
        // scoping entirely. Deny rather than guess which files it would touch.
        return deny(`${tool} has no path argument, but role ${this.role}'s ${WRITE_TOOLS.has(tool) ? 'write' : 'read'} scope is restricted — refusing an unscoped call`);
      }
      if (p !== null) {
        const rel = relative(this.cwd, resolve(this.cwd, p));
        if (rel.startsWith('..')) return deny(`path escapes org workdir: ${p}`);
        // fileWrite/fileRead globs are always authored with '/' separators (POSIX
        // convention, matches every example in types.ts and the skill docs) — but
        // path.relative()/path.resolve() return '\'-separated paths on Windows, and
        // globToRegExp treats '\' as a literal character, not a separator. Without
        // normalizing, every glob with a '/' in it silently fails to match on
        // Windows and a role with ANY fileWrite/fileRead scope narrower than the
        // unrestricted ['**'] default is denied on every single call.
        const relPosix = rel.split(sep).join('/');
        if (!globs.some(g => globToRegExp(g).test(relPosix))) return deny(`path ${rel} outside ${WRITE_TOOLS.has(tool) ? 'write' : 'read'} scope`);
      }
    }

    if (tool === 'Bash') {
      const cmd = String(input.command ?? '');
      const gitLevel = this.policy.git ?? 'read';
      const gitDenied = checkGitPolicy(cmd, gitLevel);
      if (gitDenied) return deny(gitDenied);
    }

    if (WEB_TOOLS.has(tool) && this.policy.webAllow !== undefined) {
      if (this.policy.webAllow.length === 0) return deny(`web access disabled for role ${this.role}`);
      if (tool === 'WebFetch') {
        const host = safeHost(String(input.url ?? ''));
        if (!host || !this.policy.webAllow.some(d => webDomainMatches(d, host)))
          return deny(`domain ${host ?? '?'} not in research allowlist`);
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

// Anchored: these are matched against a single extracted subcommand token, so
// an unanchored /\b…\b/ would classify `git push-mirror` as a read because the
// word `show` etc. could appear anywhere in a longer name. `remote` is
// deliberately read-level only for inspection — `remote add`/`set-url` mutate
// config, but redirecting a remote is inert unless push is also permitted.
const GIT_READ_CMDS = /^(status|log|diff|show|branch|tag|remote|rev-parse|ls-files|ls-tree|blame|shortlog|describe|cat-file|for-each-ref|rev-list|grep|worktree)$/;
const GIT_COMMIT_CMDS = /^(add|commit|rm|mv|restore|reset|stash|cherry-pick|rebase|merge|revert|apply|checkout|switch|clean|gc|prune)$/;
const GIT_PUSH_CMDS = /^(push|fetch|pull|clone|remote-add|submodule)$/;

/** git options that swallow the NEXT token as their value, so the token after
 *  them is never the subcommand. `--git-dir=x` style needs no entry — the value
 *  rides in the same token. */
const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);

/**
 * Subcommands of every `git` invocation in a shell command.
 *
 * A naive "git followed by a lowercase word" regex missed anything with a
 * global option in front of the subcommand, and "no match" meant "no git",
 * i.e. allowed. All three of these slipped past a policy whose entire job is
 * to stop them:
 *
 *   git -C /repo push               → no match at all
 *   git -c user.name=x commit -m y  → no match at all
 *   GIT_DIR=.git git push           → matched "git git", read as subcommand "git"
 *
 * So: tokenize, find each `git` (bare or path-suffixed, and never as another
 * command's argument value), then walk forward past global options to the first
 * non-option token.
 */
function gitSubcommands(cmd: string): string[] {
  const tokens = cmd.split(/[\s;|&()]+/).filter(Boolean);
  const subs: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    // `git`, `/usr/bin/git`, `git.exe` — but not `--foo=git` or `mygit`
    if (!/(^|\/)git(\.exe)?$/.test(tokens[i])) continue;
    let j = i + 1;
    while (j < tokens.length) {
      const t = tokens[j];
      if (!t.startsWith('-')) break;                       // found the subcommand
      if (GIT_OPTS_WITH_VALUE.has(t)) { j += 2; continue; } // `-C <path>`
      j += 1;                                              // `--bare`, `--git-dir=x`
    }
    // A `git` with no subcommand at all (`git`, `git --version`) mutates nothing.
    if (j < tokens.length) subs.push(tokens[j]);
  }
  return subs;
}

function checkGitPolicy(cmd: string, level: 'none' | 'read' | 'commit' | 'push'): string | null {
  const gitCalls = gitSubcommands(cmd);
  if (gitCalls.length === 0) return null; // no git subcommand in this command

  if (level === 'none') return `git commands are not allowed for this role (policy.git: none)`;

  for (const sub of gitCalls) {
    if (GIT_READ_CMDS.test(sub)) continue; // always allowed at 'read' and above

    if (GIT_PUSH_CMDS.test(sub)) {
      if (level !== 'push') return `git ${sub} denied (policy.git: ${level} — push-level commands require policy.git: 'push')`;
      continue;
    }
    if (GIT_COMMIT_CMDS.test(sub)) {
      if (level === 'read') return `git ${sub} denied (policy.git: read — mutating commands require policy.git: 'commit' or 'push')`;
      continue;
    }
    // Unknown git subcommand — allow at 'commit' and above, deny at 'read'
    if (level === 'read') return `git ${sub} denied (unrecognized git subcommand, policy.git: read)`;
  }
  return null;
}

function safeHost(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}
function summarize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input))
    out[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
  return out;
}
