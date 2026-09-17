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
  private used = 0;
  /** ORG-7: accumulated USD cost for this role, mirrors `used` (tokens). */
  private usedUsd = 0;
  private toolContext: PolicyToolContext = {};
  constructor(
    readonly role: string,
    public policy: RolePolicy,
    private bus: OrgBus,
    private cwd: string,
  ) {}

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
    const eventData = (): Record<string, unknown> => {
      const trace = this.toolContext.trace?.();
      return {
        input: summarize(input),
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
      return deny(`token budget exhausted (${this.used}/${this.policy.maxTokens})`);
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

/** `git config` writes change .git/config, which every worktree of the repo
 *  shares — `git config user.name x` rewrites the commit identity repo-wide
 *  (#250) — so they need policy.git 'push'. Reads stay inspection.
 *
 *  The args are walked the way git parses them, because matching flags
 *  anywhere in the line let writes through: git stops option parsing at the
 *  first positional (`config user.name x -l` WRITES — `-l` is a value-pattern),
 *  value options swallow the next token (`--comment -l user.name x` writes),
 *  and git accepts abbreviations (`--unset-a`). So only an allowlist of
 *  read-safe options is trusted; any other option is a write. An expansion
 *  (`$V`, `user.{name,x}`, a glob) may split into more arguments than the
 *  tokenizer sees — fail closed. */
const GIT_CONFIG_READ_VERBS =
  /^(--(get|get-all|get-regexp|get-urlmatch|get-color|get-colorbool|list)|-l)$/;
const GIT_CONFIG_READ_OPTS =
  /^(--(global|local|system|worktree|includes|no-includes|null|name-only|show-origin|show-scope|bool|int|bool-or-int|path|expiry-date)|-z)$/;
const GIT_CONFIG_VALUE_OPTS = /^(-f|--(file|blob|type|default|url))$/;
function gitConfigIsWrite(args: string[]): boolean {
  if (args.some((a) => /[$`{}*?[]/.test(a))) return true;
  let readVerb = false;
  let i = 0;
  for (; i < args.length && args[i].startsWith('-'); i++) {
    const a = args[i];
    if (a === '--') {
      i++;
      break;
    }
    if (GIT_CONFIG_READ_VERBS.test(a)) readVerb = true;
    else if (GIT_CONFIG_VALUE_OPTS.test(a))
      i++; // `-f <file>` — skip the value
    else if (!GIT_CONFIG_VALUE_OPTS.test(a.split('=')[0]) && !GIT_CONFIG_READ_OPTS.test(a))
      return true;
  }
  const positional = args.slice(i);
  // new-style `get`/`list` read; in legacy mode they are invalid keys (no write)
  if (readVerb || /^(get|list)$/.test(positional[0] ?? '')) return false;
  if (/^(set|unset|rename-section|remove-section|edit)$/.test(positional[0] ?? '')) return true;
  return positional.length !== 1; // a bare `name` reads; `name value` (or nothing parseable) writes
}

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

/** Every command segment of a shell command, at any nesting depth — or an
 *  `opaque` reason when the scan met a construct it cannot delimit the way
 *  the shell does, so checkGitPolicy can fail closed. */
interface ShellScan {
  segments: string[][];
  opaque?: string;
}

interface ScanCtx {
  /** inside `(`…`)`: stop at the matching `)` */
  close?: boolean;
  /** inside `$(`…`)` or `<(`…`)`, where a `case` pattern's `)` would end the scan early */
  inSub?: boolean;
  /** inside `$((`…`))` / `((`…`))`: quotes don't stop expansion and `<<` is a shift */
  arith?: boolean;
  /** not the outermost command string */
  nested?: boolean;
  depth: number;
}

const MAX_SHELL_NESTING = 32;

/**
 * Minimal quote-aware split of a shell command into segments (one per
 * `;`, `|`, `&`, `(`, `)` or newline) of whitespace-separated tokens, with
 * quotes and backslash escapes REMOVED from token text. Not a shell parser:
 * it exists only so the classifier sees `sh -c "git push"` as the tokens
 * `sh`, `-c`, `git push`, sees `git pu""sh` as `git push`, and does NOT see
 * `git commit -m "fix: git push hook"` as a second git call.
 *
 * The shell runs a command substitution wherever it appears, so `$(…)`,
 * backticks and `<(…)`/`>(…)` are scanned recursively — unquoted, inside
 * double quotes, in assignments, in `${…}` and in unquoted here-document
 * bodies — and their commands become segments of their own (#257: only an
 * unquoted `$(` used to be seen). The token keeps the raw substitution text,
 * so `git $(echo push)` stays unclassifiable. Only single quotes and quoted
 * here-documents are literal. Comments, here-document bodies and `$'…'` are
 * consumed the way the shell consumes them: a stray `'` in any of them used to
 * swallow every following line into one "quoted" token.
 */
function shellSegments(cmd: string): ShellScan {
  const out: ShellScan = { segments: [] };
  scanShell(cmd, 0, out, { depth: 0 });
  return out;
}

/** The backtick substitution opening at `cmd[at]`: its body with the escapes
 *  the shell removes there, and the index of the closing backtick (-1 when
 *  unterminated). The first unescaped backtick closes it, quotes or not. */
function backtickBody(cmd: string, at: number, inDq: boolean): { body: string; end: number } {
  let body = '';
  for (let j = at + 1; j < cmd.length; j++) {
    if (cmd[j] === '`') return { body, end: j };
    const next = cmd[j + 1];
    if (
      cmd[j] === '\\' &&
      next !== undefined &&
      ('$`\\'.includes(next) || (inDq && next === '"'))
    ) {
      body += next;
      j++;
    } else body += cmd[j];
  }
  return { body, end: -1 };
}

/** The here-document body starting at `from`, up to its delimiter line, and
 *  the index just past that line. An unterminated body runs to the end. */
function readHeredoc(
  cmd: string,
  from: number,
  delim: string,
  stripTabs: boolean,
): { body: string; end: number } {
  const lines: string[] = [];
  let pos = from;
  while (pos < cmd.length) {
    const nl = cmd.indexOf('\n', pos);
    const lineEnd = nl === -1 ? cmd.length : nl;
    const line = cmd.slice(pos, lineEnd);
    pos = lineEnd + 1;
    if ((stripTabs ? line.replace(/^\t+/, '') : line) === delim)
      return { body: lines.join('\n'), end: Math.min(pos, cmd.length) };
    lines.push(line);
  }
  return { body: lines.join('\n'), end: cmd.length };
}

/** An unquoted here-document body is expanded, and quotes in it are literal:
 *  `'$(git push)'` there still runs. */
function scanHeredocBody(body: string, out: ShellScan, depth: number): void {
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') i++;
    else if (body[i] === '$' && body[i + 1] === '(') {
      const arith = body[i + 2] === '(';
      i =
        scanShell(body, i + 2, out, {
          close: true,
          inSub: true,
          arith,
          nested: true,
          depth: depth + 1,
        }) - 1;
    } else if (body[i] === '`') {
      const { body: inner, end } = backtickBody(body, i, false);
      if (end < 0) {
        out.opaque ??= 'unterminated backtick substitution';
        return;
      }
      scanShell(inner, 0, out, { nested: true, depth: depth + 1 });
      i = end;
    }
  }
}

/** Scans `cmd` from `start` into `out`; returns the index just past the
 *  closing `)` when `ctx.close`, else `cmd.length`. */
function scanShell(cmd: string, start: number, out: ShellScan, ctx: ScanCtx): number {
  const fail = (why: string) => {
    out.opaque ??= why;
  };
  if (ctx.depth > MAX_SHELL_NESTING) {
    fail('shell constructs nested too deeply');
    return cmd.length;
  }
  let seg: string[] = [];
  let lineSegs: string[][] = [seg]; // segments begun on this line: a here-document body is their input
  let cur = '';
  let has = false; // current token has content (so `""` yields an empty token)
  let literal = false; // current token used quotes/escapes, so `"2">x` is a word, not an fd
  let redirectTarget = false; // next token is a redirection target, not an argument
  let quote: '"' | "'" | null = null;
  let braceDepth = 0; // inside an unquoted `${…}`: operators, `#` and `<<` are part of the word
  let dqBraceDepth = 0; // inside `${…}` within double quotes
  let bracketDepth = 0; // an unquoted `[` is open: `a[1<<2]=x` holds a shift, not a here-document
  let heredocStrip: boolean | null = null; // the next word is a here-document delimiter (`<<-` strips tabs)
  const heredocs: { delim: string; quoted: boolean; strip: boolean; owner: string[] }[] = [];
  const flush = () => {
    if (has && heredocStrip !== null) {
      heredocs.push({ delim: cur, quoted: literal, strip: heredocStrip, owner: seg });
      heredocStrip = null;
    } else if (has && !redirectTarget) {
      if (ctx.inSub && !literal && cur === 'case')
        fail('case statement inside a command substitution');
      seg.push(cur);
    }
    if (has) redirectTarget = false;
    cur = '';
    has = false;
    literal = false;
  };
  const endSegment = () => {
    flush();
    redirectTarget = false;
    bracketDepth = 0;
    if (seg.length) out.segments.push(seg);
    seg = [];
    lineSegs.push(seg);
  };
  const finish = (end: number): number => {
    endSegment();
    if (ctx.nested && (heredocs.length > 0 || heredocStrip !== null))
      fail('here-document left open inside a substitution');
    return end;
  };
  // `$(…)`, `<(…)` or `>(…)` at cmd[at]: its commands become segments, its raw text stays in the token
  const substitution = (at: number): number => {
    const arith = cmd[at] === '$' && cmd[at + 2] === '(';
    const end = scanShell(cmd, at + 2, out, {
      close: true,
      inSub: true,
      arith,
      nested: true,
      depth: ctx.depth + 1,
    });
    cur += cmd.slice(at, end);
    has = true;
    return end - 1;
  };
  const backtick = (at: number, inDq: boolean): number => {
    const { body, end } = backtickBody(cmd, at, inDq);
    if (end < 0) {
      fail('unterminated backtick substitution');
      return cmd.length;
    }
    scanShell(body, 0, out, { nested: true, depth: ctx.depth + 1 });
    cur += cmd.slice(at, end + 1);
    has = true;
    return end;
  };
  const newline = (at: number): number => {
    flush();
    if (heredocStrip !== null) {
      fail('here-document operator without a delimiter');
      heredocStrip = null;
    }
    let pos = at + 1;
    for (const h of heredocs) {
      const { body, end } = readHeredoc(cmd, pos, h.delim, h.strip);
      pos = end;
      if (!h.quoted) scanHeredocBody(body, out, ctx.depth);
      // the body is stdin for its line's pipeline: `sh <<EOF`, `cat <<EOF | sh`
      for (const s of lineSegs.slice(lineSegs.indexOf(h.owner))) if (s.length) s.push(body);
    }
    heredocs.length = 0;
    endSegment();
    lineSegs = [seg];
    return pos - 1;
  };
  for (let i = start; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote === "'" && !ctx.arith) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (quote) {
      // double quotes — and single quotes inside arithmetic, which still expand: `$(( '$(x)' ))`
      if (c === quote) {
        if (dqBraceDepth > 0) fail('quotes nested inside ${…} within double quotes');
        quote = null;
        dqBraceDepth = 0;
      } else if (c === '\\' && i + 1 < cmd.length) cur += cmd[++i];
      else if (c === '$' && cmd[i + 1] === '(') i = substitution(i);
      else if (c === '`') i = backtick(i, quote === '"');
      else {
        if (c === '$' && cmd[i + 1] === '{') dqBraceDepth++;
        else if (c === '}' && dqBraceDepth > 0) dqBraceDepth--;
        cur += c;
      }
      continue;
    }
    const procSub = (c === '<' || c === '>') && cmd[i + 1] === '(';
    if (braceDepth > 0 && !procSub && !'"\'\\$`'.includes(c)) {
      if (c === '}') braceDepth--;
      cur += c;
      has = true;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
      literal = true;
    } else if (c === '$' && cmd[i + 1] === "'" && !ctx.arith) {
      // ANSI-C quoting: `\'` does not close it
      let j = i + 2;
      while (j < cmd.length && cmd[j] !== "'") j += cmd[j] === '\\' ? 2 : 1;
      if (j >= cmd.length) fail('unterminated quote');
      cur += cmd.slice(i + 2, j);
      i = j;
      has = true;
      literal = true;
    } else if (c === '\\' && i + 1 < cmd.length) {
      cur += cmd[++i];
      has = true;
      literal = true;
    } else if (c === '$' && cmd[i + 1] === '(') i = substitution(i);
    else if (c === '`') i = backtick(i, false);
    else if (c === '$' && cmd[i + 1] === '{') {
      braceDepth++;
      cur += '${';
      has = true;
      i++;
    } else if (procSub) {
      // `<(…)` runs even inside `${x:-…}`
      if (braceDepth === 0) flush();
      i = substitution(i);
    } else if (c === '<' || c === '>') {
      // Redirection (`2>/dev/null`, `>out`, `2>&1`, `<in`): the fd number and
      // the target are not arguments, and counting them misclassifies a
      // `git config` read as a write. Unquoted only — `"2">x` passes "2".
      if (/^\d+$/.test(cur) && !literal) {
        cur = '';
        has = false;
      } else flush();
      let op: string = c;
      while (i + 1 < cmd.length && '<>&|'.includes(cmd[i + 1])) op += cmd[++i];
      if (op === '<<' && cmd[i + 1] === '-') op += cmd[++i];
      if (op !== '<<' && op !== '<<-') {
        // a here-string's word is content (`sh <<<"git push"`), keep it visible
        redirectTarget = !op.startsWith('<<<');
      } else if (ctx.arith || bracketDepth > 0) {
        // `$((1<<2))`, `a[1<<2]=x`: a shift. If a later line could be read as a
        // here-document body after all, the scan can't vouch for it.
        if (cmd.includes('\n', i)) fail('`<<` that may or may not start a here-document');
        redirectTarget = true;
      } else heredocStrip = op === '<<-';
    } else if (c === '#' && !has && (i === start || ' \t\n;&|()<>'.includes(cmd[i - 1]))) {
      if (ctx.arith) fail('`#` inside arithmetic');
      // A comment (a `#` starting a word after a blank or operator — not after
      // e.g. a no-break space) runs to the end of the line, and its quotes and
      // parens mean nothing to the shell. Its words stay visible to the classifier.
      const nl = cmd.indexOf('\n', i);
      const end = nl === -1 ? cmd.length : nl;
      const words = cmd
        .slice(i, end)
        .split(/[\s"'`$()<>;|&\\{}]+/)
        .filter(Boolean);
      if (words.length) out.segments.push(words);
      i = end - 1;
    } else if (c === '[' || c === ']') {
      bracketDepth = Math.max(0, bracketDepth + (c === '[' ? 1 : -1));
      cur += c;
      has = true;
    } else if (c === '\n') i = newline(i);
    else if (c === '(') {
      endSegment();
      const arith = ctx.arith || cmd[i + 1] === '(';
      i =
        scanShell(cmd, i + 1, out, {
          close: true,
          inSub: ctx.inSub,
          arith,
          nested: true,
          depth: ctx.depth + 1,
        }) - 1;
    } else if (c === ')') {
      if (ctx.close) return finish(i + 1);
      endSegment();
    } else if (';|&'.includes(c)) endSegment();
    else if (/\s/.test(c)) flush();
    else {
      cur += c;
      has = true;
    }
  }
  if (quote) fail('unterminated quote');
  if (braceDepth > 0) fail('unterminated ${…}');
  if (ctx.close) fail('unterminated command substitution or subshell');
  return finish(cmd.length);
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
 *   echo "$(git push)" / x=`git push` → git lives inside a quoted substitution (#257)
 */
function gitSubcommands(cmd: string): { subs: string[]; opaque?: string } {
  const subs: string[] = [];
  const { segments, opaque } = shellSegments(cmd);
  if (opaque) return { subs, opaque };
  for (const tokens of segments) {
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
      if (sub === 'config') {
        // `config:read` cannot collide with a real subcommand token (see GIT_SUBCOMMAND_SHAPE)
        subs.push(gitConfigIsWrite(tokens.slice(j + 1)) ? 'config' : 'config:read');
        continue;
      }
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
    if (GIT_READ_CMDS.test(sub) || sub === 'config:read') continue; // always allowed at 'read' and above

    if (sub === 'config') {
      return `git config write denied (policy.git: ${level} — .git/config is shared by every worktree; writes require policy.git: 'push'. Use \`git -c key=value <cmd>\` for a one-off setting)`;
    }

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
