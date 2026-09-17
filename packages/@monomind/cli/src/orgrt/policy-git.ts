// packages/@monomind/cli/src/orgrt/policy-git.ts
import { basename } from 'node:path';
import { shellSegments } from './shell-scan.js';

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
