/**
 * `policy.git` is a security boundary — it is what stops an autonomous org from
 * committing to or pushing a repository on its own. It shipped with no tests,
 * and a naive subcommand regex let three commands straight through:
 *
 *   git -C /repo push               no regex match at all → allowed
 *   git -c user.name=x commit -m y  no regex match at all → allowed
 *   GIT_DIR=.git git push           matched as subcommand "git" → allowed at 'commit'
 *
 * Every case below that begins `git -C`, `git -c`, or with an env prefix exists
 * because it was once a live bypass.
 */
import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../../src/orgrt/policy.js';

type Level = 'none' | 'read' | 'commit' | 'push';

const noopBus = { emit: () => { /* assertions read decide()'s return, not the bus */ } };

async function allows(level: Level, command: string): Promise<boolean> {
  // Signature is (role, policy, bus, cwd) — maxTokens must be generous or every
  // decision short-circuits on the budget check before git is ever consulted.
  const p = new PolicyEngine('coder', { git: level, maxTokens: 1_000_000 } as never, noopBus as never, process.cwd());
  return (await p.decide('Bash', { command })).behavior === 'allow';
}

describe('policy.git', () => {
  it("'read' permits inspection", async () => {
    for (const c of ['git status', 'git log --oneline -5', 'git diff HEAD', 'git rev-parse HEAD']) {
      expect(await allows('read', c), c).toBe(true);
    }
  });

  it("'read' blocks mutation and publication", async () => {
    for (const c of ['git commit -m x', 'git add .', 'git push', 'git checkout main']) {
      expect(await allows('read', c), c).toBe(false);
    }
  });

  it("'commit' permits local mutation but still blocks publication", async () => {
    expect(await allows('commit', 'git commit -m x')).toBe(true);
    expect(await allows('commit', 'git add -A')).toBe(true);
    expect(await allows('commit', 'git push origin main')).toBe(false);
    expect(await allows('commit', 'git pull')).toBe(false);
  });

  // #250: `git config user.name x` at 'commit' rewrote the repo-wide identity
  // (worktrees share .git/config). Writes need 'push'; reads stay allowed.
  it("blocks git config writes below 'push' but allows reads", async () => {
    const writes = [
      'git config user.name "CLI QA Test"',
      'git config user.email qa@test.local',
      'git -C /repo config --local user.name x',
      'git config --add core.hooksPath /tmp/x',
      'git config --unset-all user.name',
      'git config --replace-all remote.origin.url https://evil',
      'git config --edit',
      'git config set user.name x',
      'git config unset user.name',
    ];
    for (const c of writes) {
      expect(await allows('commit', c), c).toBe(false);
      expect(await allows('read', c), c).toBe(false);
      expect(await allows('push', c), c).toBe(true);
    }
    const reads = [
      'git config user.name',
      'git config --get user.name',
      'git -C /repo config --local --get user.name',
      'git config --get-all remote.origin.url',
      'git config --list',
      'git config -l --show-origin',
      'git config get user.name',
      'git config list',
    ];
    for (const c of reads) {
      expect(await allows('read', c), c).toBe(true);
      expect(await allows('commit', c), c).toBe(true);
    }
    // per-command identity never persists — still a normal commit
    expect(await allows('commit', 'git -c user.name=qa -c user.email=qa@x commit -m y')).toBe(true);
  });

  // Each of these WROTE .git/config under real git while the first #250 fix
  // classified it as a read. git config parses options only up to the first
  // positional, lets value-taking options swallow the next token, accepts
  // abbreviated long options, and the shell may split one token into several.
  it('classifies git config writes the way git parses them', async () => {
    const writes = [
      // a trailing read flag after the name is a value-pattern, not an option
      'git config user.name EVIL -l',
      'git config user.email x@y --list',
      'git config user.name EVIL --get',
      // --comment consumes the next token as its value
      'git config --comment -l user.name EVIL1',
      'git config --comment --get user.name EVIL1',
      'git config --comment get user.name EVIL1',
      'git config --comment list user.name EVIL1',
      'git config --comm -l user.name EVIL1',
      'git config --file .git/config --comment -l user.name EVIL1',
      'git config -f -l user.name EVIL1', // -f swallows `-l` as its file name
      // shell expansion splits into name + value
      'git config $(echo user.name EVIL6)',
      'V="user.name EVIL7"; git config $V',
      'git config user.{name,EVIL9}',
      // a value starting with '-' is still a positional
      'git config -- user.name -EVIL5',
      'git config user.name -EVIL5',
      // abbreviated long options
      'git config --unset-a user.name',
      'git config --remove-s user',
      // a redirection between arguments, or a quoted/escaped digit before `>`
      'git config user.name >&2 EVIL',
      'git config user.name "2">/dev/null',
      'git config user.name \\2>/dev/null',
    ];
    for (const c of writes) {
      expect(await allows('read', c), c).toBe(false);
      expect(await allows('commit', c), c).toBe(false);
      expect(await allows('push', c), c).toBe(true);
    }
  });

  it('allows git config reads that use value options or redirections', async () => {
    for (const c of [
      'git config --type bool core.bare',
      'git config --type=bool core.bare',
      'git config --default zz user.foo',
      'git config -f .gitmodules submodule.x.path',
      'git config --file=.gitmodules --list',
      'git config --blob HEAD:.gitmodules submodule.x.path',
      'git config --get user.name EVIL', // value-pattern of a read
      'git config user.email 2>/dev/null',
      'git config user.email 2>/dev/null || echo none',
      'git config user.email > out.txt',
      'git config --list 2>&1 | head -5',
    ]) {
      expect(await allows('read', c), c).toBe(true);
      expect(await allows('commit', c), c).toBe(true);
    }
  });

  it('does not treat the internal config-read marker as a real subcommand', async () => {
    expect(await allows('read', 'git config-read')).toBe(false);
    expect(await allows('read', 'git config:read')).toBe(false);
  });

  it("'push' permits publication", async () => {
    expect(await allows('push', 'git push origin main')).toBe(true);
  });

  it("'none' blocks even a read", async () => {
    expect(await allows('none', 'git status')).toBe(false);
  });

  it('leaves non-git commands alone', async () => {
    for (const c of ['npm test', 'ls -la', 'node scripts/gitlab.js']) {
      expect(await allows('read', c), c).toBe(true);
    }
  });

  // ── the bypasses ────────────────────────────────────────────────────
  it('sees through global options placed before the subcommand', async () => {
    expect(await allows('commit', 'git -C /repo push')).toBe(false);
    expect(await allows('read', 'git -C /repo commit -m x')).toBe(false);
    expect(await allows('commit', 'git -c user.name=x commit -m y')).toBe(true); // commit allowed at 'commit'
    expect(await allows('commit', 'git -c user.name=x push')).toBe(false);       // ...push is not
    expect(await allows('commit', 'git --git-dir=/r/.git push')).toBe(false);
    expect(await allows('commit', 'git --work-tree /r -C /r push')).toBe(false);
  });

  it('sees through an env-var prefix', async () => {
    expect(await allows('commit', 'GIT_DIR=.git git push')).toBe(false);
    expect(await allows('read', 'GIT_AUTHOR_NAME=x git commit -m y')).toBe(false);
  });

  it('sees through an absolute path to the git binary', async () => {
    expect(await allows('commit', '/usr/bin/git push')).toBe(false);
  });

  it('checks every git call in a compound command, not just the first', async () => {
    expect(await allows('commit', 'git status && git push')).toBe(false);
    expect(await allows('commit', 'git add . ; git commit -m x ; git push')).toBe(false);
    expect(await allows('commit', 'git log | head -5')).toBe(true);
  });

  it('treats a bare `git` with no subcommand as harmless', async () => {
    expect(await allows('read', 'git')).toBe(true);
    expect(await allows('read', 'git --version')).toBe(true);
  });

  // ── indirection: fail closed ──────────────────────────────────────────
  // The tokenizer can only classify a git call it can SEE. Anything that hides
  // the binary or the subcommand behind an expansion, a quoted fragment, or an
  // interpreter used to slip through as "no git here" / "unknown subcommand".
  it('sees through quoting around the binary or the subcommand', async () => {
    expect(await allows('commit', 'git pu""sh')).toBe(false);
    expect(await allows('commit', "git 'push'")).toBe(false);
    expect(await allows('commit', '"git" push')).toBe(false);
    expect(await allows('commit', 'git pu\\sh')).toBe(false);
    expect(await allows('commit', 'sh -c "git push"')).toBe(false);
    expect(await allows('commit', "bash -c 'git push origin main'")).toBe(false);
  });

  it('fails closed on shell expansion in command or subcommand position', async () => {
    for (const c of [
      'g=git; $g push',
      'x=$(which git); $x push',
      'git $(echo push)',
      'git `echo push`',
      'git ${sub}',
      'git $SUB origin main',
      '`echo git` push',
    ]) {
      expect(await allows('commit', c), c).toBe(false);
      expect(await allows('read', c), c).toBe(false);
    }
  });

  it('fails closed on interpreters and eval that can reach git', async () => {
    for (const c of [
      'python3 -c "import subprocess; subprocess.run([\'git\', \'push\'])"',
      'node -e "require(\'child_process\').execSync(\'git push\')"',
      'eval "git push"',
      'eval $CMD',
      'echo push | xargs git',
      'sh -c "$CMD"',
      'sh <<<"git push"', // a here-string is content, not a redirection target to drop
      'python3 <<< "import os; os.system(\'git push\')"',
    ]) {
      expect(await allows('commit', c), c).toBe(false);
    }
  });

  it('fails closed on git aliases (a subcommand it cannot classify)', async () => {
    expect(await allows('commit', 'git -c alias.p=push p')).toBe(false);
    expect(await allows('commit', 'git config alias.p push && git p')).toBe(false);
  });

  it('keeps ordinary quoting, variables in argument position, and unrelated interpreters allowed', async () => {
    expect(await allows('commit', 'git commit -m "fix: git push hook"')).toBe(true); // a quoted message is one token
    expect(await allows('read', 'git log --format="%h %s" -n 5')).toBe(true);
    expect(await allows('read', 'echo "$HOME" && git status')).toBe(true);
    expect(await allows('read', 'cd "$DIR" && git status')).toBe(true);
    expect(await allows('commit', 'git commit -m "wip: $TICKET"')).toBe(true);
    expect(await allows('read', 'python3 -c "print(1)"')).toBe(true);
    expect(await allows('read', 'node scripts/build.js')).toBe(true);
    expect(await allows('read', 'find . -name "*.ts" | xargs wc -l')).toBe(true);
  });

  // #257: the shell runs a command substitution wherever it sits — inside
  // double quotes, in an assignment, in backticks, in a here-document body —
  // but the tokenizer only split on an unquoted `$(`, so every other form hid
  // the git call and was allowed at every level.
  it('classifies git calls inside command substitutions in argument position', async () => {
    for (const c of [
      'echo "$(git push origin main)"',
      'echo `git push origin main`',
      'x="$(git push)"',
      'true && echo "`git push`"',
      'x=$(git push)',
      'echo "$(echo "$(git push)")"',
      'echo "`echo \\`git push\\``"',
      'echo "${x:-$(git push)}"',
      'echo ${x:-`git push`}',
      'echo ${x:-<(git push)}', // process substitution still runs inside ${…}
      'cat <(git push)',
      'echo hi | tee >(git push)',
      'git -C $(pwd) push',
      'echo $(( $(git push) + 1 ))',
      "echo $(( '$(git push)' ))", // arithmetic expands inside single quotes
      'eval "$(echo git push)"',
      'bash -c "$(printf %s push)"',
    ]) {
      expect(await allows('read', c), c).toBe(false);
      expect(await allows('commit', c), c).toBe(false);
      expect(await allows('push', c), c).toBe(true);
    }
  });

  it('sees command substitutions and interpreters in here-document bodies', async () => {
    for (const c of [
      'cat <<EOF\n$(git push)\nEOF',
      "cat <<EOF\n'$(git push)'\nEOF", // quotes are literal in an unquoted heredoc body
      'cat <<EOF\n"`git push`"\nEOF',
      'cat <<-EOF\n\t$(git push)\n\tEOF',
      "python3 - <<'EOF'\nimport os; os.system('git push')\nEOF",
      "cat <<'EOF' | sh\ngit push\nEOF",
    ]) {
      expect(await allows('read', c), c).toBe(false);
      expect(await allows('commit', c), c).toBe(false);
      expect(await allows('push', c), c).toBe(true);
    }
  });

  // Each of these made the tokenizer's quote state disagree with bash's, so a
  // git call bash runs was swallowed into a "quoted" token.
  it('does not let comments, heredoc bodies or $\'…\' desynchronize quoting', async () => {
    for (const c of [
      "echo hi # it's\ngit push",
      "cat <<EOF\ndon't\nEOF\ngit push",
      "cat <<'EOF'\ndon't\nEOF\necho \"$(git push)\"",
      "echo $'\\''\necho \"$(git push)\"\n'",
      'x=$(echo hi # )\ngit push)',
      'echo "$(echo hi # )\ngit push)"',
      'echo ${x:-{a}; git push}', // a bare `{` does not nest inside ${…}
      // a `#` after a no-break space is not a comment, so `)` still closes the substitution
      'echo "$(echo a #)"; g\'\'it push\n)"',
    ]) {
      expect(await allows('read', c), c).toBe(false);
      expect(await allows('commit', c), c).toBe(false);
    }
  });

  it('fails closed on substitution forms it cannot delimit reliably', async () => {
    for (const c of [
      'echo "$(case a in a) git push;; esac)"', // a case pattern `)` is not the closing paren
      'echo "$(git push"', // unterminated
      'echo `git push',
      "echo '$(git push)", // unterminated quote
      'echo "${x:-"$(git push)"}"', // nested quotes inside ${…} within double quotes
      'echo $((1<<2))\ngit push\n2', // `<<` is a shift here, not a here-document
      'a[1<<2]=5\ngit push\n2',
      'echo $(cat <<EOF)\ngit push\nEOF',
    ]) {
      expect(await allows('read', c), c).toBe(false);
      expect(await allows('commit', c), c).toBe(false);
    }
  });

  it('keeps single-quoted text, quoted heredocs and non-git substitutions allowed', async () => {
    for (const c of [
      "echo '$(git push)'",
      "echo '`git push`'",
      "cat <<'EOF'\n$(git push)\nEOF",
      'echo "$(date)"',
      'x=$(pwd)',
      'x="$(pwd)"; echo "$x"',
      'echo `date`',
      'echo "$(git status --short)"',
      'x="$(git rev-parse HEAD)"',
      'cat <<EOF\nhello $(date) it\'s "fine"\nEOF',
      'diff <(ls a) <(ls b)',
      'echo $((1<<20))',
      'echo "${HOME}/x" && git status',
      "ls # it's fine",
      'echo "$(echo \')\')"',
    ]) {
      expect(await allows('read', c), c).toBe(true);
      expect(await allows('commit', c), c).toBe(true);
    }
    // the standard heredoc commit message — apostrophes, parens, even the words "git push"
    const commit = "git commit -m \"$(cat <<'EOF'\nfix(x): don't git push (yet)\n\nbody\nEOF\n)\"";
    expect(await allows('commit', commit)).toBe(true);
    expect(await allows('read', commit)).toBe(false);
  });

  it("'push' is unaffected — every git form is permitted there anyway", async () => {
    expect(await allows('push', 'g=git; $g push')).toBe(true);
    expect(await allows('push', 'sh -c "git push"')).toBe(true);
  });
});
