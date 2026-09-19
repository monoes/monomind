// packages/@monomind/cli/src/orgrt/policy-git.ts
import { basename } from 'node:path';
import { shellSegments } from './shell-scan.js';

// Anchored: these are matched against a single extracted subcommand token, so
// an unanchored /\b…\b/ would classify `git push-mirror` as a read because the
// word `show` etc. could appear anywhere in a longer name. `remote` is
// deliberately read-level only for inspection — `remote add`/`set-url` mutate
// config, but redirecting a remote is inert unless push is also permitted.
// The anchoring is also what makes `cherry` safe to list next to `cherry-pick`
// (#299): `^cherry$` cannot match the token `cherry-pick`.
const GIT_READ_CMDS =
  /^(status|log|diff|show|branch|tag|remote|rev-parse|ls-files|ls-tree|blame|shortlog|describe|cat-file|for-each-ref|rev-list|grep|worktree|merge-base|show-ref|name-rev|cherry|range-diff|check-ignore|check-attr|count-objects|var|ls-remote)$/;
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

/** Subcommands whose mode depends on their first positional, resolved at scan
 *  time into a `<sub>:read` token the way `config` already is (#299). An
 *  expansion may hide the verb, so any arg containing shell metacharacters is
 *  treated as the mutating form — same fail-closed rule as gitConfigIsWrite.
 *  Deliberately case-sensitive, matching git's own case-sensitive subcommand
 *  dispatch: `git stash sHoW` is not `show` to git either — it falls through
 *  to the default write (`stash push`), so leaving it unmatched by a
 *  lowercase-only pattern tracks git, not luck. */
const GIT_SUB_READ_ARGS: Record<string, RegExp> = {
  stash: /^(list|show)$/, // allowlist: bare `git stash` IS `stash push`
};

/** `git reflog` (git 2.55.0, `man git-reflog`) — the full verb set is show
 *  (default), list, exists, write, delete, drop, expire; read: show/list/
 *  exists, write: write/delete/drop/expire:
 *    usage: git reflog [show] [<log-options>] [<ref>]
 *       or: git reflog list
 *       or: git reflog exists <ref>
 *       or: git reflog write <ref> <old-oid> <new-oid> <message>
 *       or: git reflog delete [--rewrite] [--updateref] [--dry-run|-n] [--verbose] <ref>@{<specifier>}...
 *       or: git reflog drop [--all [--single-worktree] | <refs>...]
 *       or: git reflog expire [--expire=<time>] [--expire-unreachable=<time>] [--rewrite] [--updateref] [--stale-fix] [--dry-run|-n] [--verbose] [--all [--single-worktree] | <refs>...]
 *  (audited #299 review round 2, git 2.55.0 — re-audit against `man
 *  git-reflog` if this ever needs revisiting, but see below for why it
 *  shouldn't need to.)
 *
 *  This is an ALLOWLIST, not a deny-list of the four write verbs, and that
 *  is deliberate: a deny-list fails OPEN the day a git version a role
 *  actually runs adds or renames a verb we haven't enumerated — and we
 *  cannot validate an end user's installed git from our own CI. (A runtime
 *  `git reflog -h` guard was tried and rejected for the same reason: it
 *  would only ever validate the git that runs our tests, which is never the
 *  git whose version drift is the risk.) An allowlist fails CLOSED instead:
 *  any positional this function doesn't specifically recognize as read-safe
 *  is denied, regardless of which git produced it.
 *
 *  Accepted cost: `git reflog HEAD` / `git reflog my-branch` are denied here
 *  even though real git treats an unrecognized reflog argv[0] as a <ref> (an
 *  implicit `show`) — a small, bounded reintroduction of #299's own
 *  over-denial class. It is self-documenting (the deny message names the
 *  working form, `git reflog show <ref>`) and bounded, which is the trade a
 *  security boundary should take over an unbounded silent under-denial on a
 *  git version nobody here has run.
 *
 *  Round 2's first cut allowed as soon as args[0] started with '-', which
 *  reintroduced the exact dependency the allowlist exists to remove: it
 *  trusted THIS git's parser to keep ignoring everything after an unknown
 *  leading option, so `git reflog --all expire` went DENY→ALLOW even though
 *  no positional past args[0] was ever examined. reflogIsRead requires EVERY
 *  token to be option-shaped before falling back to the default `show`. */
function reflogIsRead(args: string[]): boolean {
  if (args.some((a) => /[$`{}*?[]/.test(a))) return false; // fail closed
  // EVERY token must be option-shaped, not just the first — cmd_reflog only
  // ever honours the verb at argv[0] (OPT_SUBCOMMAND), so `git reflog --all
  // expire` parses as `show --all expire` on git 2.55.0, not `expire --all`.
  // A prefix check (allow as soon as args[0] starts with '-') let `--all
  // expire`, `-n drop --all` and `-- expire` all through as false reads
  // (#299 review round 2) — exactly the "trust this git's parser" dependency
  // this allowlist exists to remove. `[].every(...)` is vacuously true, so
  // this also covers the bare `git reflog` case with no separate branch.
  if (args.every((a) => a.startsWith('-'))) return true; // options only (or none) -> targets the default `show`
  return /^(show|list|exists)$/.test(args[0]);
}

function refineSub(sub: string, args: string[]): string {
  if (sub === 'reflog') return reflogIsRead(args) ? 'reflog:read' : 'reflog';
  const readPattern = GIT_SUB_READ_ARGS[sub];
  if (!readPattern) return sub;
  if (args.some((a) => /[$`{}*?[]/.test(a))) return sub; // fail closed
  // ALLOWLIST direction (stash): git's cmd_stash dispatches on argv[0] ONLY
  // (see `man git-stash`'s SYNOPSIS) — it does NOT skip leading options to
  // find its subcommand. `git stash -- list` and `git stash -k list` are
  // `stash push` (a WRITE) with "list" as a pathspec/value, not
  // `stash list`. Skipping leading options here previously let both through
  // as false reads onto the stash stack shared across every worktree (#299
  // review round 1 — this is the exact mistake i-300 exists to guard
  // against, so getting it right here matters doubly).
  return readPattern.test(args[0] ?? '') ? `${sub}:read` : sub;
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

/** Config keys that switch off the git guard a role session runs under (#258:
 *  core.hooksPath hooks, the transport allow list, and the credential/askpass/
 *  ssh settings that withhold push credentials). `include`/`includeIf` can pull
 *  a file that sets any of them. A `-c`/`--config-env` override of one of these
 *  IS the bypass, so the command cannot be classified as safe. */
const GIT_GUARD_CONFIG_KEY =
  /^(core\.(hookspath|sshcommand|askpass)|credential\.|protocol\.|include\.|includeif\.)/i;

/** Env the guard and its withheld credentials live in (#258). A command that
 *  sets, clears or wipes these is tampering with the guard, whether or not the
 *  same command mentions git. GIT_AUTHOR_NAME, GIT_DIR and friends are not here:
 *  `GIT_AUTHOR_NAME=x git commit` is ordinary work. */
const GIT_GUARD_ENV =
  /^(GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS|GLOBAL|SYSTEM|NOSYSTEM)|GIT_SSH|GIT_SSH_COMMAND|GIT_ASKPASS|SSH_ASKPASS|GIT_TERMINAL_PROMPT|SSH_AUTH_SOCK|GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN)$/;
/** Words that change another command's environment: `env`, and the shell
 *  builtins that assign or clear variables. */
const ENV_SETTERS = /^(env|unset|export|declare|typeset|readonly|set)$/;

/** The guard variable a token touches, if any — covering `VAR=…` assignments,
 *  bare `unset VAR` names, and env's `-u VAR` / `-uVAR` / `--unset=VAR`. */
function guardEnvName(token: string): boolean {
  const name = token.replace(/^(--unset=|-u)/, '').split('=')[0];
  return GIT_GUARD_ENV.test(name);
}
const CLEARS_ENV = /^(-i|--ignore-environment|-)$/;

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
    if (tokens.slice(0, k).some(guardEnvName))
      return { subs, opaque: "the command reassigns the role's git guard environment" };
    const word = tokens[k];
    if (word === undefined) continue;
    if (/^[$`]/.test(word)) return { subs, opaque: `command word is a shell expansion (${word})` };
    if (ENV_SETTERS.test(basename(word))) {
      const args = tokens.slice(k + 1);
      if (args.some(guardEnvName))
        return { subs, opaque: `${word} changes the role's git guard environment` };
      if (basename(word) === 'env' && args.some((t) => CLEARS_ENV.test(t)))
        return { subs, opaque: "env clears the environment the role's git guard lives in" };
    }
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
        const override =
          t === '-c' || t === '--config-env'
            ? tokens[j + 1]
            : t.startsWith('--config-env=')
              ? t.slice('--config-env='.length)
              : undefined;
        if (override !== undefined && GIT_GUARD_CONFIG_KEY.test(override.split('=')[0]))
          return {
            subs,
            opaque: `git ${t} ${override.split('=')[0]} overrides the role's git guard`,
          };
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
      subs.push(refineSub(sub, tokens.slice(j + 1)));
    }
  }
  return { subs };
}

export function checkGitPolicy(
  cmd: string,
  level: 'none' | 'read' | 'commit' | 'push',
): string | null {
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
    // `<sub>:read` tokens are minted by the scanner for args-aware subcommands
    // (config, stash, reflog) and can never collide with a real subcommand
    // token — GIT_SUBCOMMAND_SHAPE forbids ':'.
    if (GIT_READ_CMDS.test(sub) || sub.endsWith(':read')) continue; // always allowed at 'read' and above

    if (sub === 'config') {
      return `git config write denied (policy.git: ${level} — .git/config is shared by every worktree; writes require policy.git: 'push'. Use \`git -c key=value <cmd>\` for a one-off setting)`;
    }

    if (sub === 'reflog') {
      // Unrefined 'reflog' means reflogIsRead() rejected it — either an
      // explicit write verb (write/delete/drop/expire) or a positional this
      // allowlist doesn't recognize (see reflogIsRead's comment for why an
      // unrecognized positional is denied rather than treated as a <ref>).
      // Not in GIT_COMMIT_CMDS, so — same as any unrecognized subcommand —
      // this only denies at 'read'; 'commit' and 'push' fall through below.
      if (level === 'read') {
        return `git reflog denied (policy.git: read — only \`git reflog\` (bare, or with log options like \`-5\`/\`--all\`), \`show\`, \`list\` and \`exists\` are read; write a specific ref explicitly, e.g. \`git reflog show <ref>\`, or use policy.git: 'commit' or 'push' for write/delete/drop/expire)`;
      }
      continue;
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
