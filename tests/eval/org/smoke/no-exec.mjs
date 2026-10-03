// The kit-level "nothing can run code" denial (owner decision 2026-10-03, parallel-sweep): applied to
// EVERY role of a def, whatever the arm, by prepare.mjs for a kit that sets `noExec`. It uses what the
// org runtime has: policy.sandbox.denyExec / denyRead (a bubblewrap layer around the role's whole process
// tree, exec-deny.ts), policy.allowTools / denyTools (the permission gate), and the sandbox's network list.
// What it cannot do is stated in fixtures/parallel-sweep/fixture.json (weaknesses).

/** Programs masked by real path. Names with `*` are globs. The shell, sed, awk and git stay: the role's own
 *  runtime needs them, so a role can still script in them (a stated weakness, not a hole this closes). */
export const DENY_EXEC = [
  // JavaScript runtimes, package runners and TypeScript runners
  'node',
  'nodejs',
  'deno',
  'bun',
  'bunx',
  'npm',
  'npx',
  'pnpm',
  'pnpx',
  'yarn',
  'yarnpkg',
  'corepack',
  'tsx',
  'ts-node',
  'electron',
  'qjs',
  'quickjs',
  'd8',
  'jsc',
  'rhino',
  'gjs',
  // general-purpose interpreters
  'python*',
  'pypy*',
  'ipython*',
  'perl*',
  'ruby*',
  'irb',
  'php*',
  'lua*',
  'luajit*',
  'tclsh*',
  'wish*',
  'julia',
  'R',
  'Rscript',
  'groovy',
  'jshell',
  'guile',
  'racket',
  'sbcl',
  'clisp',
  'emacs',
  'elixir',
  'erl',
  'escript',
  'runghc',
  'ghc',
  'ocaml*',
  'scala',
  'kotlin*',
  'dotnet',
  'mono',
  'swift*',
  'busybox',
  // compilers and toolchains that turn text into a program that runs
  'gcc*',
  'g++*',
  'cc',
  'c++',
  'clang*',
  'tcc',
  'go',
  'rustc',
  'cargo',
  'javac',
  'java',
  // engines in browsers
  'chrome*',
  'google-chrome*',
  'chromium*',
  'firefox*',
];

/** The only paths under the real $HOME a role's process tree can really write (policy.sandbox.homeWriteAllow,
 *  runtime home-write-deny.ts): the runners' own login and state directories, where the claude, codex and agy CLIs
 *  keep credentials, sessions and logs (`~/.claude`, `~/.codex`, `~/.gemini`). Everything else under the home,
 *  `~/.claude.json` and its `.claude.json.tmp.*` temp files included, is seen through a throwaway overlay: writes
 *  work inside the role's own view and never reach the real home (decided 2026-10-03 after a role created
 *  `~/f7.sh`). Exact names: a trial that needs another one is a design change, not an edit here. */
export const HOME_WRITE_ALLOW = ['.claude', '.codex', '.gemini'];

/** The only tools a role may call: files, shell, search. Everything else (NotebookEdit, REPL-style tools,
 *  MCP tools that run code, WebFetch, native children) is refused at the permission gate, except the org's
 *  own tools and a tool provider's (the runtime exempts those from allowTools). */
export const ALLOW_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'TodoWrite',
];

/** Named as well, so the refusal reads right and a future allowlist edit cannot readmit them quietly. */
export const DENY_TOOLS = [
  'NotebookEdit',
  'REPL',
  'Task',
  'Agent',
  'Skill',
  'WebFetch',
  'WebSearch',
  'CodeExecution',
  'code_execution',
  'ExecuteCode',
  'CodeInterpreter',
  'code_interpreter',
];

const uniq = (xs) => [...new Set(xs)];

/** `def` with the denial on every role. `denyRead`: absolute paths (the hidden truth, the fixture
 *  directory) that no role's shell can read. mode 'required': a role does not start without bubblewrap. */
export function applyNoExec(def, { denyRead = [] } = {}) {
  const out = structuredClone(def);
  for (const r of out.roles) {
    const p = (r.policy ??= {});
    p.allowTools = [...ALLOW_TOOLS];
    p.denyTools = uniq([...(p.denyTools ?? []), ...DENY_TOOLS]);
    p.sandbox = {
      ...(p.sandbox ?? {}),
      mode: 'required',
      allowedDomains: ['localhost'],
      denyExec: [...DENY_EXEC],
      denyRead: uniq([...(p.sandbox?.denyRead ?? []), ...denyRead]),
      homeWriteAllow: [...HOME_WRITE_ALLOW],
    };
  }
  return out;
}

/** What is missing from a def's denial, per role; empty when every role has all of it. */
export function noExecProblems(def) {
  const problems = [];
  for (const r of def.roles) {
    const p = r.policy ?? {};
    const s = p.sandbox ?? {};
    const miss = DENY_EXEC.filter((x) => !(s.denyExec ?? []).includes(x));
    if (!s.denyExec) problems.push(`role ${r.id}: no policy.sandbox.denyExec`);
    else if (miss.length) problems.push(`role ${r.id}: denyExec lacks ${miss.join(', ')}`);
    if (JSON.stringify(s.homeWriteAllow) !== JSON.stringify(HOME_WRITE_ALLOW))
      problems.push(
        `role ${r.id}: homeWriteAllow is ${JSON.stringify(s.homeWriteAllow ?? null)}, not ${JSON.stringify(HOME_WRITE_ALLOW)}: the real home is not write-protected as declared`,
      );
    if (s.mode !== 'required')
      problems.push(`role ${r.id}: sandbox mode is ${s.mode ?? 'unset'}, not required`);
    if (JSON.stringify(s.allowedDomains) !== '["localhost"]')
      problems.push(`role ${r.id}: network is not limited to localhost`);
    if (!Array.isArray(p.allowTools)) problems.push(`role ${r.id}: no allowTools`);
    else
      for (const t of p.allowTools)
        if (!ALLOW_TOOLS.includes(t)) problems.push(`role ${r.id}: allowTools admits ${t}`);
    for (const t of DENY_TOOLS)
      if (!(p.denyTools ?? []).includes(t)) problems.push(`role ${r.id}: denyTools lacks ${t}`);
  }
  return problems;
}
