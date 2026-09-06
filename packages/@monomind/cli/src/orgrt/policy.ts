// packages/@monomind/cli/src/orgrt/policy.ts
import { realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
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

  addUsage(tokens: number): void {
    this.used += tokens;
  }
  get usage(): number {
    return this.used;
  }
  /** Set usage counter directly for checkpoint/resume - Pattern 3 */
  setUsage(tokens: number): void {
    this.used = tokens;
  }
  get overBudget(): boolean {
    return this.policy.maxTokens != null && this.used >= this.policy.maxTokens;
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

  async decide(tool: string, input: Record<string, unknown>): Promise<Decision> {
    const deny = (reason: string): Decision => {
      this.bus.emit({
        type: 'tool',
        from: this.role,
        tool,
        decision: 'deny',
        reason,
        data: { input: summarize(input) },
      });
      return { behavior: 'deny', message: `[org-policy] ${reason}` };
    };
    const allow = (): Decision => {
      this.bus.emit({
        type: 'tool',
        from: this.role,
        tool,
        decision: 'allow',
        data: { input: summarize(input) },
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
      return deny(`token budget exhausted (${this.used}/${this.policy.maxTokens})`);
    if (this.overBudgetUsd)
      return deny(`USD budget exhausted ($${this.usedUsd.toFixed(4)}/$${this.policy.maxUsd})`);
    if (this.policy.denyTools?.includes(tool))
      return deny(`tool ${tool} is denied for role ${this.role}`);
    if (
      this.policy.allowTools &&
      !this.policy.allowTools.includes(tool) &&
      !tool.startsWith('mcp__org__')
    )
      return deny(`tool ${tool} not in allowlist for role ${this.role}`);

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
          `${tool} has no path argument, but role ${this.role}'s ${WRITE_TOOLS.has(tool) ? 'write' : 'read'} scope is restricted — refusing an unscoped call`,
        );
      }
      if (p !== null) {
        // SEC: compare REAL paths — a symlink inside the scope pointing outside
        // the workdir (or at an out-of-scope file) passed the lexical check.
        const rel = relative(realPath(this.cwd), realPath(resolve(this.cwd, p)));
        if (rel.startsWith('..')) return deny(`path escapes org workdir: ${p}`);
        // fileWrite/fileRead globs are always authored with '/' separators (POSIX
        // convention, matches every example in types.ts and the skill docs) — but
        // path.relative()/path.resolve() return '\'-separated paths on Windows, and
        // globToRegExp treats '\' as a literal character, not a separator. Without
        // normalizing, every glob with a '/' in it silently fails to match on
        // Windows and a role with ANY fileWrite/fileRead scope narrower than the
        // unrestricted ['**'] default is denied on every single call.
        const relPosix = rel.split(sep).join('/');
        if (!globs.some((g) => globToRegExp(g).test(relPosix)))
          return deny(`path ${rel} outside ${WRITE_TOOLS.has(tool) ? 'write' : 'read'} scope`);
      }
    }

    if (tool === 'Bash') {
      const cmd = String(input.command ?? '');
      const gitLevel = this.policy.git ?? 'read';
      const gitDenied = checkGitPolicy(cmd, gitLevel);
      if (gitDenied) return deny(gitDenied);
    }

    if (WEB_TOOLS.has(tool) && this.policy.webAllow !== undefined) {
      if (this.policy.webAllow.length === 0)
        return deny(`web access disabled for role ${this.role}`);
      if (tool === 'WebFetch') {
        const host = safeHost(String(input.url ?? ''));
        if (!host || !this.policy.webAllow.some((d) => webDomainMatches(d, host)))
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
const GIT_READ_CMDS =
  /^(status|log|diff|show|branch|tag|remote|rev-parse|ls-files|ls-tree|blame|shortlog|describe|cat-file|for-each-ref|rev-list|grep|worktree)$/;
const GIT_COMMIT_CMDS =
  /^(add|commit|rm|mv|restore|reset|stash|cherry-pick|rebase|merge|revert|apply|checkout|switch|clean|gc|prune)$/;
const GIT_PUSH_CMDS = /^(push|fetch|pull|clone|remote-add|submodule)$/;

/** git options that swallow the NEXT token as their value, so the token after
 *  them is never the subcommand. `--git-dir=x` style needs no entry — the value
 *  rides in the same token. */
const GIT_OPTS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--config-env',
]);

/** `git`, `/usr/bin/git`, `git.exe` — but not `--foo=git` or `mygit`. */
const GIT_BIN = /(^|\/)git(\.exe)?$/;
/** A subcommand token the classifier can actually name. Anything else
 *  (`$SUB`, `$(echo push)`, `` `echo push` ``, `${x}`) is indirection. */
const GIT_SUBCOMMAND_SHAPE = /^[a-z][a-z0-9-]*$/;
/** Command words that run whatever their arguments say — a `git` inside
 *  their argument string is invisible to token classification. */
const INTERPRETERS =
  /^(sh|bash|zsh|dash|ksh|fish|eval|exec|python[0-9.]*|node|perl|ruby|php|xargs)$/;

/**
 * Minimal quote-aware split of a shell command into segments (one per
 * `;`, `|`, `&`, `(`, `)` or newline) of whitespace-separated tokens, with
 * quotes and backslash escapes REMOVED from token text. Not a shell parser:
 * it exists only so the classifier sees `sh -c "git push"` as the tokens
 * `sh`, `-c`, `git push`, sees `git pu""sh` as `git push`, and does NOT see
 * `git commit -m "fix: git push hook"` as a second git call.
 */
function shellSegments(cmd: string): string[][] {
  const segments: string[][] = [];
  let seg: string[] = [];
  let cur = '';
  let has = false; // current token has content (so `""` yields an empty token)
  let quote: '"' | "'" | null = null;
  const flush = () => {
    if (has) seg.push(cur);
    cur = '';
    has = false;
  };
  const endSegment = () => {
    flush();
    if (seg.length) segments.push(seg);
    seg = [];
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < cmd.length) cur += cmd[++i];
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < cmd.length) {
      cur += cmd[++i];
      has = true;
    } else if (c === '\n' || ';|&()'.includes(c)) endSegment();
    else if (/\s/.test(c)) flush();
    else {
      cur += c;
      has = true;
    }
  }
  endSegment();
  return segments;
}

/**
 * Subcommands of every `git` invocation in a shell command — or, when the
 * command hides git behind indirection the tokenizer can't see through, an
 * `opaque` reason so checkGitPolicy can FAIL CLOSED instead of concluding
 * "no git here". Each of these was once a live bypass:
 *
 *   git -C /repo push               → no regex match at all
 *   GIT_DIR=.git git push           → matched "git git", read as subcommand "git"
 *   g=git; $g push                  → `$g` isn't `git`, so no git call found
 *   git pu""sh / git 'push'         → subcommand token wasn't `push`
 *   sh -c "git push" / python -c …  → git lives inside a quoted argument
 *   git -c alias.p=push p           → `p` is an unknown (allowed) subcommand
 */
function gitSubcommands(cmd: string): { subs: string[]; opaque?: string } {
  const subs: string[] = [];
  for (const tokens of shellSegments(cmd)) {
    // leading VAR=value assignments aren't the command word
    let k = 0;
    while (k < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[k])) k++;
    const word = tokens[k];
    if (word === undefined) continue;
    if (/^[$`]/.test(word)) return { subs, opaque: `command word is a shell expansion (${word})` };
    if (INTERPRETERS.test(basename(word))) {
      const args = tokens.slice(k + 1);
      if (args.some((t) => /\bgit\b/.test(t)))
        return { subs, opaque: `${word} invokes git through an argument string` };
      if (args.some((t) => /[$`]/.test(t)))
        return { subs, opaque: `${word} runs an expanded argument the policy cannot inspect` };
    }
    for (let i = k; i < tokens.length; i++) {
      if (!GIT_BIN.test(tokens[i])) continue;
      let j = i + 1;
      while (j < tokens.length) {
        const t = tokens[j];
        if (!t.startsWith('-')) break; // found the subcommand
        if (GIT_OPTS_WITH_VALUE.has(t)) {
          j += 2;
          continue;
        } // `-C <path>`
        j += 1; // `--bare`, `--git-dir=x`
      }
      // An alias definition anywhere in the call (`-c alias.p=push`, `config
      // alias.p push`) makes some later subcommand unclassifiable.
      if (tokens.slice(i + 1).some((t) => /(^|=)alias\./.test(t)))
        return { subs, opaque: 'git alias definition' };
      // A `git` with no subcommand at all (`git`, `git --version`) mutates nothing.
      if (j >= tokens.length) continue;
      const sub = tokens[j];
      if (!GIT_SUBCOMMAND_SHAPE.test(sub))
        return { subs, opaque: `unparseable git subcommand (${sub})` };
      subs.push(sub);
    }
  }
  return { subs };
}

function checkGitPolicy(cmd: string, level: 'none' | 'read' | 'commit' | 'push'): string | null {
  if (level === 'push') return null; // every git form is permitted — nothing to classify
  const { subs: gitCalls, opaque } = gitSubcommands(cmd);
  // SEC: fail closed. If the command reaches git in a way the tokenizer can't
  // classify, the policy can't vouch for it — deny rather than let it through
  // as "no git subcommand found".
  if (opaque)
    return `command denied: ${opaque} — policy.git: ${level} cannot verify git usage; write the git call out literally`;
  if (gitCalls.length === 0) return null; // no git subcommand in this command

  if (level === 'none') return `git commands are not allowed for this role (policy.git: none)`;

  for (const sub of gitCalls) {
    if (GIT_READ_CMDS.test(sub)) continue; // always allowed at 'read' and above

    if (GIT_PUSH_CMDS.test(sub)) {
      return `git ${sub} denied (policy.git: ${level} — push-level commands require policy.git: 'push')`;
    }
    if (GIT_COMMIT_CMDS.test(sub)) {
      if (level === 'read')
        return `git ${sub} denied (policy.git: read — mutating commands require policy.git: 'commit' or 'push')`;
      continue;
    }
    // Unknown git subcommand — allow at 'commit' and above, deny at 'read'
    if (level === 'read')
      return `git ${sub} denied (unrecognized git subcommand, policy.git: read)`;
  }
  return null;
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
