# Monomind — Project Milestones

A full-monorepo review, package by package: what's actually shipped ("Achieved Milestones," verified against the real source/docs/tests) and what's worth doing next ("Future Milestones," each carrying an impact score). This is an ideation stepping stone, not a committed roadmap — add, re-score, and prune freely.

**Revision 10 — org triage and claim-check (2026-09-18).** The `monomind-dev` org (run `run-20260918173821-ded9`, artefacts under `.monomind/orgs/monomind-dev/runs/`) triaged all 115 Future bullets against main at `4683f0cde`, claim-checked the highest-scored ones, and merged 8 changes: 3 items from this file plus 5 it found or caused itself. Its main finding: this file had gone partly stale. Many figures were measured on this dogfooded repo (non-default hooks, a cached embedding model) and then stated as what a default user experiences. Of the 13 top items claim-checked, 5 held, 7 were partly stale and 1 was stale. Three authored 9s collapsed: i-054 is now a 4, i-039 is now a 4, and i-090's fix already existed. This revision moves done items to Achieved and the 16 skips, 2 already-done items and 2 duplicates to Pruned. It rewrites every surviving bullet to the evaluator's corrected scope, adds the org's 16 discovered items, and moves work that needs a human into **Owner testing**. Scores are the evaluator's `value`, which already uses this file's 1–10 scale. Where `triage/RANKED-BACKLOG.md`'s `v` column differs from a batch verdict, the backlog wins. `(quick win)` means evaluator effort S. Items the org ledgered without a score are marked *provisional*; their score comes from this revision, using the table below. Earlier revisions are in git history: 1–8 (2026-09-15/16) were a ~45-agent, five-round review across every lens, and 9 (2026-09-16) landed the first fixes. **New claims should say what they were measured on** (fresh `init` with a scratch `MONOMIND_HOME` / this repo / version).

## Owner testing (do before the next org run)

These items need a human. An org in a headless Linux sandbox can't do them: they need another OS, a real TTY or browser, your monoes.me account, npm/GitHub, locally installed agent CLIs, or a product decision. Tick each box when it's done. On FAIL, or for a decision, write the result under the entry (date, command, output or choice); the next org run reads this section and turns failures into items.

```bash
REPO=/home/monoes/projects/monoes/monomind
CLI="node $REPO/packages/@monomind/cli/bin/cli.js"
T=/home/monoes/mdev-tmp                       # scratch root — never /tmp
RUN=$REPO/.monomind/orgs/monomind-dev/runs/run-20260918173821-ded9
```

- [x] **#1 — Build, then confirm the baseline outside the org sandbox (do first).** `cd $REPO && pnpm build && pnpm verify`. This comes first because when this revision was written, `packages/@monomind/cli/dist` didn't match main: it had no `mcp monoes-proxy`, and its `redact()` still leaked `Authorization: Bearer …`. **PASS:** all green, or only `checkSecondBrainModel` fails (it reads real machine state; known, i-127). The 17 tests exempted inside the org sandbox (cli `role-sandbox.test.ts`, monograph `hooks-marker`/`hooks-install`/`hooks-status`) must pass here; they failed only because the sandbox exports `GIT_CONFIG_KEY_*`.
  **Result 2026-09-19 (run by Claude, outside the sandbox): PASS.** `pnpm build` and `pnpm verify` exit 0. Root suite 641 files / 6,430 tests passed, 54 skipped, 0 failed; other packages all green. `checkSecondBrainModel` did not fail. Logs: `/home/monoes/mdev-tmp/owner-1-{build,verify}.log`.

- [x] **#2 — Crash-report consent prompt in a real terminal (`0ef431f`, `c644690`, `cf68658`).** Use a scratch `HOME` so your real `~/.monomind/crash-reporting.json` is untouched:
  ```bash
  H=$T/home-crash; mkdir -p $H
  HOME=$H $CLI crash-reporting status        # expect: unanswered
  HOME=$H $CLI report-crash --repo monoes/monomind --title "owner consent test" \
    --body "Authorization: Bearer FAKEFAKEFAKEFAKE1234 ghp_$(printf 'A%.0s' $(seq 36))"
  ```
  The prompt `Report this crash publicly to monoes/monomind? [y/N] (report: …/pending-reports/….md)` should appear. Press Enter. **Never answer `y` against `monoes/monomind`: that files a real public issue.** Then check:
  - `HOME=$H $CLI crash-reporting status` → disabled.
  - `grep -rl 'FAKEFAKE\|ghp_AAAA' $H/.monomind` → prints nothing.
  - `HOME=$H $CLI doctor -c crash-reporting` → shows the state.

  Non-TTY: `rm -rf $H/.monomind; echo | HOME=$H $CLI report-crash --repo monoes/monomind --title t2 --body b | cat` should print "only saved locally (no network call)" with no prompt, and the status should stay `unanswered`. Timeout: after `rm -rf $H/.monomind`, rerun the TTY command and don't answer; it should resolve to No after 15 s. **FAIL:** no prompt on a TTY, a prompt in non-TTY, a network call after No, or a fake secret in a saved report.
  **Result 2026-09-19: PASS.** A real TTY prompt appeared before any network call. "Yes" filed an issue with the fake bearer token redacted (`Authorization: [redacted]`; test issues #305/#306, closed). Enter (No) disabled reporting and saved locally only; non-TTY never prompted and left the state `unanswered`. **Bug found:** the update notice (`↑ … available → run: npm install …`) prints on the same line as the `[y/N]` prompt, so the owner answered `y` twice by mistake — see the CLI Future list.

- [x] **#3 — `redact()` (`6bcd64f`).** Run after #1:
  ```bash
  cd $REPO && node -e "import('./packages/@monomind/cli/dist/src/utils/redaction.js').then(m=>['Authorization: Bearer abcdefghijklmnopqrstuv','{\"accessToken\":\"abcdefghijklmnop1234\"}','token ghp_'+'A'.repeat(36),'xoxb-EXAMPLE-EXAMPLE-EXAMPLEONLY','sk_live_abcdefghijklmnop1234','call me at 555 123 4567'].forEach(s=>console.log(m.redact(s))))"
  ```
  **PASS** matches what current source prints: `Authorization: [redacted]`, `{"access[redacted]}` (the key name is partly eaten, which is cosmetic), `token [redacted]`, `[redacted]`, `[redacted]`, `call me at <phone>`. **FAIL:** any token characters survive.
  **Result 2026-09-19: PASS.** Output was exactly the six expected lines; no token characters survived.

- [x] **#4 — `doctor` additions (`c644690`).** `$CLI doctor --help | grep -o 'native\|crash-reporting'` should list both. `$CLI doctor -c native` should print ✓ (better-sqlite3 loads), `-c crash-reporting` the consent state, and `-c monoes-token` clean in a project with no leak. **PASS:** each prints a result without error.
  **Result 2026-09-19: PASS.** `doctor --help` lists `native` and `crash-reporting`. `-c native` → ✓ better-sqlite3 loads under Node v26.8.1 (ABI 147). `-c crash-reporting` → unanswered. `-c monoes-token` in this repo → ✗, correctly: this checkout's own `.mcp.json` still holds a literal monoes bearer token in the old `type: http` format (the file is gitignored and has no git history, so it was never committed). #5(b) replaces it; consider revoking that token at monoes.me afterwards.

- [x] **#5 — monoes.me token out of `.mcp.json` (`2c9bcec`, `54495b0`): leak fixture plus the real OAuth flow.**
  (a) Fixture:
  ```bash
  P=$T/leak; mkdir -p $P && cd $P && git init -q && $CLI init --yes --no-install
  node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('.mcp.json'));j.mcpServers.monoes={type:'http',url:'https://monoes.me/mcp',headers:{Authorization:'Bearer FAKE-AT-0123456789'}};fs.writeFileSync('.mcp.json',JSON.stringify(j,null,2))"
  $CLI doctor -c monoes-token                    # expect FAIL naming .mcp.json and "revoke"
  $CLI init --target codex --yes --no-install    # expect the "monoes.me token exposure detected" banner
  $CLI ui --port 4251 --project-dir $P           # open the printed URL once; the ui terminal prints the banner
  grep -c FAKE-AT $P/.mcp.json                   # expect 0 after the page has loaded
  ```
  (b) Real connect, using your monoes.me account:
  ```bash
  P2=$T/connect; mkdir -p $P2 && cd $P2 && git init -q && $CLI init --yes --no-install
  $CLI ui --port 4252 --project-dir $P2          # monoes.me panel → Connect, finish OAuth in the browser
  node -e "console.log(JSON.stringify(require('$P2/.mcp.json').mcpServers.monoes))"
  git -C $P2 check-ignore -v .monomind/monoes-connection.json
  ```
  **PASS:** the entry is `npx -y monomind@latest mcp monoes-proxy` with no `headers` and no `type: "http"`; the connection file is ignored; Disconnect removes the entry; and in Claude Code opened in `$P2`, `/mcp` shows `monoes` connected and a monoes tool call works. **Caveat:** `mcp monoes-proxy` was added this run (`028821dc3`), after the 2.11.8 release commit, so `npx monomind@latest` lacks it until the next publish. Until then, point the entry at the checkout: `"command": "node", "args": ["$REPO/packages/@monomind/cli/bin/cli.js", "mcp", "monoes-proxy"]`. **FAIL:** a token in `.mcp.json`, no banner in (a), or monoes tools unreachable.
  **Result 2026-09-19: PASS after two fixes.** (a) Fixture: `doctor -c monoes-token` and `init --target codex` flag the planted token; opening the dashboard migrated `.mcp.json` to the tokenless `mcp monoes-proxy` entry (0 `Authorization` left). (b) Real connect: `.mcp.json` has no token, `monoes-connection.json` is gitignored, Claude Code `/mcp` shows monoes connected and `get_feed` returns the real feed. Fixed on the way: the proxy did not speak MCP Streamable HTTP (`11503c35c`) and the CLI exit watchdog killed it after 5 s (`b32d1a4c5`). Filed: #307 (OAuth callback goes to the requested port, not the bound one / cached clientId not bound to its redirect_uri) and #308 (dashboard home ignores `--project-dir`).

- [x] **#6 — Dashboard controls in a visible browser (`4e5adfc`).** Run `cd $REPO && $CLI ui --port 4250`, open the printed URL with the DevTools console open, and click through: the Memory and Monograph sub-tabs (rebuild/watch/export), session bookmark/export/notes, the budget modal, loop create/stop, org config save, Human Input "Answer", the settings toggles, and the Orgs page's chat mode. **PASS:** no `ReferenceError`; every control either acts or shows an error; no failing request freezes the page. These failures are already ledgered and are not regressions: `/api/monograph-wiki-search` 404 (i-118), `/api/data` 500 (i-119), memory DELETE 500 (i-120/i-125), `/api/monograph-html` 404 (i-123), `/api/session-errors` 500 (i-124), Answer 401 (i-126), and Builder playbooks 404 (i-106). **FAIL:** anything else; note the control and the route.
  **Result 2026-09-19: PASS for i-065 (no `ReferenceError` anywhere).** Two new errors, now in the Dashboard Future list: the Monograph **Graph** tab shows `Unauthorized` (401 on `/api/monograph-html`), and `data/avatars/code-review-swarm.svg` is 404.

- [x] **#7 — Decide: push and publish.** As of 2026-09-19, local main (`cf686585c`) is 38 commits ahead of `origin/main`, which sits at the 2.11.8 publish commit (`7d20b5618`). Nothing from this run has been pushed or is on npm. Before publishing, do a clean install from a local tarball:
  ```bash
  cd $REPO/packages/@monomind/cli && pnpm pack --pack-destination $T/pkg
  mkdir -p $T/clean && cd $T/clean && npm init -y >/dev/null && npm install $T/pkg/monoes-monomindcli-*.tgz
  ./node_modules/.bin/monomind --version && ./node_modules/.bin/monomind mcp monoes-proxy --help
  mkdir -p proj && cd proj && git init -q && ../node_modules/.bin/monomind init --yes
  grep -c Authorization .mcp.json                # expect 0
  ```
  **Options:** (A) push main and publish the next patch through the usual release flow; (B) hold. **Recommendation:** A, once #1–#6 pass. The new monoes entry needs `mcp monoes-proxy` on npm, and the consent gate stops unasked public crash issues.
  **Decision 2026-09-19: A — publish.** #1–#6 passed. The `release-gate` org publishes local main (merging the 2.11.9 commit already on origin/main).

- [x] **#8 — Decide: monoswarm, enforce the claim or stop making it (i-035).** {i-035}
  **Facts:** the generator writes "MUST initialize the monoswarm…" into every user's CLAUDE.md (`claudemd-generator.ts:190,202`, plus 6 sites in `write-capabilities.ts` and the template variants), and this repo's own `CLAUDE.md:107` has it too. Monoswarm is JSON bookkeeping: `agent_spawn` starts no process, and nothing links its state to Claude Code's Task agents.
  **Options:** (A) honest-down — drop the MUST and its command block (the code lives in the CLAUDE.md group under Init); (B) enforce — link via `SubagentStart`/`SubagentStop` so live Task agents are the electorate, which brings back i-037. **Recommendation:** A, which is also the evaluator's pick: an afternoon's work, not a new subsystem.
  **Also decide the upgrade path.** `CLAUDE.md` and `.monomind/CAPABILITIES.md` are skip-if-exists (`write-claude.ts:462-465`, `write-capabilities.ts:20`), and `CAPABILITIES.md` has no managed block while holding 11 of the 18 mentions. The choices are (i) `init upgrade` rewrites both, or (ii) `doctor` warns and points at `init --force`. My recommendation: (i), because a generator-only fix reaches no existing project.
  **Decision 2026-09-19: A — honest-down, with upgrade path (i).** Remove the "MUST initialize the monoswarm" claim and its command block from the generators, the templates and this repo's own CLAUDE.md, and have `init upgrade` rewrite existing `CLAUDE.md` / `.monomind/CAPABILITIES.md` (add a managed block to CAPABILITIES.md). Do not build monoswarm enforcement. **Build item for the org.**

- [x] **#9 — Decide: the Node floor (i-090).** {i-090}
  **Facts (checked 2026-09-19):**
  - `engines.node` is `>=20.0.0` in root/cli/hooks/monograph, `>=18.0.0` in monobrowse/monofence-ai, and absent elsewhere.
  - The installed `ai` 7.0.59 needs `>=22` and `puppeteer` 25.3.0 needs `>=22.12.0`, while the root `.npmrc` sets `engine-strict=true`.
  - `publish-smoke-test.yml` still tests Node `['20','26']` plus two Node-20 install jobs; `tests.yml` uses 22.
  - `better-sqlite3` 12.11.1 supports 20–26. Rev 9 gave Node 20's EOL as 2026-04-30.
  - The #231 ABI half is already done (`native-binding.ts`, and `doctor -c native`).

  **Options:** (A) keep `>=20` and document that the AI providers and puppeteer need 22; (B) raise to `>=22.12` everywhere in one release with a CHANGELOG note, move the smoke jobs to 22/26, and then take better-sqlite3 13, commander 15, chokidar 5 and vitest 5; (C) defer. **Recommendation:** B — the declared floor already doesn't hold. If a wrong-ABI prebuild (#231) ever reproduces, paste `$CLI doctor -c native` output here; only then does a WASM-sqlite fallback return.
  **Decision 2026-09-19: B — require Node >=22.12 everywhere in one release.** Set `engines.node` to `>=22.12.0` in every package that declares or needs one; move `publish-smoke-test.yml` jobs off Node 20 (22 and 26); CHANGELOG entry marked breaking. Dependency majors (better-sqlite3 13, commander 15, chokidar 5, vitest 5) are separate follow-up items, one per PR. **Build item for the org.**

- [x] **#10 — Decide: should `init` copy shipped assets into the user's repo at all?** A default `init` wrote 1,845 files across six surfaces in a scratch dir, 529 of them for Claude Code alone. Platform gating (i-050) cuts about 70% for new installs. The rest is static agent/skill/command content copied into every project, which also drives tarball weight (i-007), README-as-command leaks (i-045), and the upgrade-path problems (the CLAUDE.md group, i-040). **Options:** (A) keep copying, gated by platform; (B) resolve that content from the installed package and reference it instead — feasible only if Claude Code and the other CLIs can read it from outside the repo. **Recommendation:** approve A now (it's in the backlog), and decide B in an ADR before any more footprint work.
  **Decision 2026-09-19: A — keep copying, gated by platform (i-050).** `init` only writes the files for the platforms the user selects or that are detected; resolving shipped content from the package instead of copying (option B) goes to an ADR, not code, in this cycle. **Build item for the org.**

- [ ] **#11 — Windows machine checks (needs Windows with Claude Code and Node ≥ 22).**
  - **(a) Which shell runs hooks.** In a scratch repo, run `npx monomind@<version> init --yes`, add a SessionStart hook `{"type":"command","command":"echo %COMSPEC% $0 > hookshell.txt"}` to `.claude/settings.json`, and start Claude Code. `C:\Windows\system32\cmd.exe $0` in the file means cmd.exe; `%COMSPEC% bash` means Git Bash. That fact decides whether the hook generator needs a win32 branch (theme 16d).
  - **(b)** Watch whether a console window flashes on every Edit/Write (theme 16a).
  - **(c)** End the session and run `tasklist /FI "IMAGENAME eq node.exe"`; theme 16b predicts the control server survives.
  - **(d)** Once i-108 lands, test `npx monomind browse open https://example.com` against a per-user Chrome install.

- [ ] **#12 — Real multi-platform agent CLIs (Codex, Gemini CLI, Kimi installed).**
  ```bash
  P=$T/multi; mkdir -p $P && cd $P && git init -q && touch .marker && $CLI init --yes --no-install
  find . -type f -newer .marker -not -path './.git/*' | wc -l    # org's scratch count: 1,845
  $CLI platforms doctor
  ```
  Then start each CLI in `$P`, have it list the monomind MCP tools, and call `monograph_query`. **PASS:** `platforms doctor` prints a per-platform report (the org saw 16 platforms with `next:` hints), and each CLI gets a tool result. The configs use `npx monomind@latest`, so this exercises the published version. Record which CLIs worked; this feeds i-050.

- [ ] **#13 — GitHub-side work only you can do.**
  - **(a)** Done 2026-09-19: the org-runtime problems from the run are filed as #297 (biome ignores worktrees under `.monomind/`), #298 (git-guard env breaks the host repo's git tests), #299 (`policy.git: read` denies read-only commands such as `ls-remote`/`merge-base`), #300 (`git stash` is shared across worktrees), #301 (sandboxed roles leave `.git/worktrees/*` behind; a plain `git worktree prune` outside the sandbox clears them), #302 (the boss can end a run as `partial` with the backlog full), #303 (file tools can't reach sandbox-writable scratch), #304 ("aborted by user" on a planned stop). The one-off tsgo SIGSEGV was not filed (never reproduced; upstream compiler). The next org run takes these issues as items.
  - **(b)** Decide the GitHub/publishing items the org skipped: CONTRIBUTING and issue template (i-004), coverage and license gates (i-005), Windows CI (i-008), publish/tag folding and Renovate (i-011), and the `mcp`/`claude-code` repo topics (from i-078).

  **PASS:** each is done, or declined here.

- [x] **#14 — Measure `browse` idle time (decides i-103).**
  ```bash
  $CLI browse -p 9333 open https://example.com
  time $CLI browse -p 9333 get title
  time $CLI browse -p 9333 screenshot
  $CLI browse -p 9333 close
  ```
  Rev 7 measured 5,132 ms for `get title`, but the org couldn't reproduce it. If both commands take ≲ 1 s, note "i-103 already done" here; if they take ~5 s, note the times and i-103 stays.
  **Result 2026-09-19: i-103 is NOT done.** `get title` took 5,097 ms and `screenshot` 5,162 ms (example.com, port 9333). The ~5 s idle before exit reproduces; i-103 stays open.

## How to read the scores

Every future item starts with `[N/10]`, which is **impact on users and on the project's core promise**, not effort. `(quick win)` = evaluator effort S (≈ under a day). `(provisional)` = discovered by the org but not scored by it. `{i-NNN}` = ledger id from the 2026-09-18 run (`ledger.json`, `triage/verdicts-batch-NN.md`); plain `i-NNN` in prose is a cross-reference.

| Score | Meaning |
|---|---|
| **10** | Fixes something currently broken or unsafe for most users, or unlocks the core promise |
| **8–9** | Major capability, reliability, or trust gain for a large share of users |
| **6–7** | Solid improvement with moderate reach, or high value at low effort |
| **4–5** | Nice-to-have, niche audience, or hygiene with some user-visible benefit |
| **1–3** | Cosmetic / internal tidiness, low user impact |
| **0** | Not worth doing or unsupported by evidence → removed |

## Top 10 for a real user of `npx monomind init` + Claude Code

1. **Hook enrichment never reaches the model**: 0 bytes of per-prompt advisories, tool-hook hints on a channel Claude Code doesn't feed to the model (i-038, 9).
2. **The MCP loop Claude Code actually runs is the unhardened copy**: `isError` is lost, so a rejected write reads as success; `mcp toggle --disable` hides nothing (i-025/i-030, 9).
3. **The npm description says "no data leaves your machine"** while `doctor` calls npm on every run (i-078, 9).
4. **The generated CLAUDE.md misinstructs**: `init --wizard`, inert env vars, "hooks unavailable" on every install, and the monoswarm MUST (i-041/i-117 plus Owner testing #8, 8).
5. **`config_set` deletes provider API keys** (i-026, 8).
6. **The Quickstart's first command, `/mastermind:autodev`, doesn't exist** (i-074, 8).
7. **Unknown subcommands and flags exit 0, and `--json` is silently ignored**, so agents "succeed" doing nothing (i-060/i-056, 8).
8. **Memory writes fail silently under monomind's own concurrency** (i-085, 8).
9. **The graph answers wrongly or not at all**: `monograph_suggest task=` says "run monograph_build" on a fresh index; caller lists show only tests (i-092, i-093, 8).
10. **`npx monomind@latest` in `.mcp.json`** means a registry round-trip on every session and no MCP server offline (i-044, 8).

## Build groups and binding order (from `triage/RANKED-BACKLOG.md`)

**Groups** (one worktree each):
- `i-grp-mcp-stdio` = i-025 + i-030 (plan exists), then i-029.
- `i-grp-claudemd-truth` = i-041 + i-117, plus i-035 per Owner testing #8. It alone owns `claudemd-generator.ts`; answer the upgrade-path question first.
- `i-grp-cli-dispatch` = i-060 **then** i-056, then i-059 on the same branch.
- `i-grp-graph-answers` = i-093 + i-094 + i-096 (one shared "prefer non-test, non-mirror path" ranker).
- `i-grp-statusline-truth` = i-038(c) + i-046, after i-038 (a)+(b).
- `i-grp-cli-pkg-hygiene` = i-003 + i-007.

**Binding order** (causal, not file overlap):
- i-040 → i-027: 395+ shipped references to the tools i-027 would hide.
- i-038 → i-099: routing output is invisible until i-038 lands.
- i-027 → i-080.
- i-057 → i-114: reuse the tokenisation.
- i-044 and the CLAUDE.md group serialize (both touch the init generators).
- i-054 must not run in parallel with anything touching `helpers/`.
- i-071's two layers ship together.

Resolved by this run's merges: i-055 → i-078, i-055 → i-103, i-116 → i-115/i-039. Dropped as unfounded: "i-070 must land with i-065" (no control calls that route).

**Upgrade-path rule:** items whose value is repairing state users already have (the CLAUDE.md group, i-040, i-044, i-039) need a pre-fix project fixture run with default flags. Acceptance must assert that the broken state is *gone*, not that the user was warned. i-050 is new-installs-only by design.

## Top priorities (open items scored ≥ 8; 7s are in their sections)

| Impact | Item | Section |
|---|---|---|
| **9** | Hook enrichment never reaches the model (i-038) | [Init](#init-system--multi-platform-integration-part-of-monoesmonomindcli) |
| **9** | One hardened MCP stdio loop; `isError` lost, `enabled` ignored (i-025/i-030) | [MCP](#mcp-tools--knowledge-graph-memory-part-of-monoesmonomindcli) |
| **9** | The privacy claim contradicts real egress (i-078, quick win) | [Docs](#documentation) |
| **8** | The generated CLAUDE.md tells the truth (i-041/i-117, #8) | [Init](#init-system--multi-platform-integration-part-of-monoesmonomindcli) |
| **8** | `@latest` in generated files; broken offline (i-044) | [Init](#init-system--multi-platform-integration-part-of-monoesmonomindcli) |
| **8** | `config_set` deletes provider keys (i-026, quick win) | [MCP](#mcp-tools--knowledge-graph-memory-part-of-monoesmonomindcli) |
| **8** | The Quickstart's first command doesn't exist (i-074, quick win) | [Docs](#documentation) |
| **8** | Unknown subcommands/flags exit 0; `--json` ignored (i-060/i-056) | [CLI](#cli-commands-diagnostics-security-hooks--ops-part-of-monoesmonomindcli) |
| **8** | Memory writes fail under concurrency (i-085) | [memory](#monoesmemory-monoesmemory-v1017) |
| **8** | `monograph_suggest task=` is dead for code tasks (i-092) | [monograph](#monoesmonograph-monoesmonograph-v165) |
| **8** | Test lambdas hide production callers (i-093, quick win) | [monograph](#monoesmonograph-monoesmonograph-v165) |
| **8** | Org stop→resume destroys role work (i-016) | [Org Runtime](#org-runtime-v2-part-of-monoesmonomindcli) |
| **8** | No install-smoke test for the packed tarball (i-002) | [umbrella](#monomind-umbrella-monomind-v2118) |

## Package Index

| Package | npm name | Version | Role |
|---|---|---|---|
| [monomind (umbrella)](#monomind-umbrella-monomind-v2118) | `monomind` | 2.11.8 | Thin shim entry point; repo tooling, build, CI, dependencies |
| [Org Runtime v2](#org-runtime-v2-part-of-monoesmonomindcli) | part of `@monoes/monomindcli` | — | Autonomous multi-agent "organizations" daemon; 14 runner backends |
| [MCP Tools & Knowledge Graph Memory](#mcp-tools--knowledge-graph-memory-part-of-monoesmonomindcli) | part of `@monoes/monomindcli` | — | MCP tool surface (25 modules, 3 stdio loops), memory knowledge graph, Second Brain docs |
| [Monoswarm & Agent/Task/Session Stores](#monoswarm--agenttasksession-stores-part-of-monoesmonomindcli) | part of `@monoes/monomindcli` | — | JSON-backed coordination/vote bookkeeping and agent/task/session registries |
| [Init System & Multi-Platform Integration](#init-system--multi-platform-integration-part-of-monoesmonomindcli) | part of `@monoes/monomindcli` | — | Project scaffolding; generated hooks, statusline, CLAUDE.md, `.gitignore`, and shipped content |
| [CLI Commands: Diagnostics, Security, Hooks & Ops](#cli-commands-diagnostics-security-hooks--ops-part-of-monoesmonomindcli) | part of `@monoes/monomindcli` | — | The command dispatcher, `doctor`, `security`, `tokens`, `hooks`, `memory`, `config`, gates, crash reporter |
| [Dashboard (Neural Control Room)](#dashboard-neural-control-room-part-of-monoesmonomindcli) | part of `@monoes/monomindcli` | — | `monomind ui` — ~122 API routes, 12 views, auto-started on SessionStart |
| [Documentation](#documentation) | `README.md`, `doc/`, generated templates | — | The deployed site, concept docs, env/tool references, privacy wording |
| [@monoes/hooks](#monoeshooks-monoeshooks-v107) | `@monoes/hooks` | 1.0.7 | Standalone hook registry/executor + background workers |
| [@monoes/memory](#monoesmemory-monoesmemory-v1017) | `@monoes/memory` | 1.0.17 | SQLite + embeddings memory backend, HNSW ANN, chunker |
| [@monoes/monograph](#monoesmonograph-monoesmonograph-v165) | `@monoes/monograph` | 1.6.5 | Tree-sitter code knowledge graph engine |
| [@monoes/routing](#monoesrouting-monoesrouting-v105) | `@monoes/routing` | 1.0.5 | Keyword + semantic task-to-agent routing |
| [@monoes/mcp](#monoesmcp-monoesmcp-v104) | `@monoes/mcp` | 1.0.4 | Standalone MCP protocol engine (stdio/HTTP/WS) |
| [@monoes/monobrowse](#monoesmonobrowse-monoesmonobrowse-v109) | `@monoes/monobrowse` | 1.0.9 | Native CDP browser automation |
| [@monoes/monodesign](#monoesmonodesign-monoesmonodesign-v126) | `@monoes/monodesign` | 1.2.6 | Frontend design anti-pattern detection + fixes |
| [monofence-ai](#monofence-ai-monofence-ai-v103) | `monofence-ai` | 1.0.3 | AI manipulation defense (prompt-injection detection) |

---

## monomind (umbrella) (`monomind` v2.11.8)

`monomind` is the umbrella package published on npm. It is a pure forwarding shim over `@monoes/monomindcli`, deliberately code-free after a ~27 MB double-publish incident. The repo root also hosts the pnpm workspace, the build and release scripts, CI workflows, the dependency policy, and the documentation (its own section). Figures from revisions ≤ 9 were measured against 2.10.30–2.11.0 in this repo; Revision 10's claim-check ran against main `4683f0cde` (2.11.8).

### Achieved Milestones
- Umbrella/CLI split with a resolution shim robust across nested, hoisted, global, and pnpm-linked layouts; lockstep version + double-publish prevention (`scripts/check-publish-versions.mjs`); doc-count drift automation for two counters; git hooks auto-activation in-repo.
- **Fixed (2026-09-16):** root `pnpm build` runs `pnpm -r run build` across all nine workspace packages (the CLI, `@monoes/monodesign` and `monofence-ai` were previously skipped); the orphan root `dist/packages/**` is gone; `pnpm verify` (build + typecheck + lint + every package's tests) is the single post-change command, and `lint`/`typecheck` run in `tests.yml`'s root job (typecheck ordered after the dependency build — verified from an empty `dist/`). `pnpm lint` went from 45 errors to 0.
- Build and test are fast on TypeScript 7 (native): CLI build 0.9 s, `tsc --noEmit` 0.25 s, full `pnpm verify` ~1m45s. **Run baseline (2026-09-18, final gate):** build 9/9, typecheck, lint 1,377 files / 0 errors, `docs:refs:check` 244 refs, root 1,184 passed / 0 failed / 1 skipped; routing 98, hooks 64, memory 125 (+46 skipped), mcp 106, monobrowse 251, monodesign 1,024 (+9), monofence 136.
- Three-workflow CI suite (`tests.yml` root + 9-package Linux + 5-package Windows matrix; `publish-smoke-test.yml` with a 4-case behaviour suite; `pages.yml`), with lint and typecheck in the root job. No coverage, link-check, snippet, license, or size gate.
- Dependency health: 0 deprecated direct deps (71 checked); `pnpm audit` 0 vulnerabilities across 542 deps; no copyleft blockers in the 293-package prod tree; all 23 CLI optional deps loaded lazily.
- Outbound egress audited: code, documents, memory, and prompts stay local unless the user configures a provider or clicks "Upload org". Default-on egress is the 24 h-throttled npm update check and `doctor`'s unconditional `npm view`; crash reports need consent since 2026-09-18 (CLI section).
- **Fixed (2026-09-18):** main's one lint failure (formatter, `orgrt/role-sandbox.ts`) — `3df0752`. {i-000a-lint}

### Future Milestones
- **[8/10]** A local tarball install-smoke test. No install-smoke test exists, and four "uninstallable release" incidents (#130/#148, #16–#21, #17/#46/#47) got past CI. `pnpm smoke:tarball` packs the CLI, installs it into a scratch dir, imports every `dist/src/commands/*.js` and `mcp-tools/**/*.js`, runs `initialize → tools/list` against the installed `mcp start`, repeats with `--omit=optional`, and asserts an unpacked-size budget. It must be runnable by hand (the GitHub Node matrix is dropped); breaking one import must fail it by name. {i-002}
- **[6/10]** (quick win) CLI `package.json` hygiene, as one change: `@monoes/monobrowse ^1.0.6` / `@monoes/monodesign ^1.2.2` resolve to registry copies (`node_modules/.pnpm/@monoes+monobrowse@1.0.6`), while the workspace has 1.0.9 / 1.2.6. Use `workspace:^` so this repo stops verifying against stale published code. `files` ships 1,068 `.map` files (`dist` is 21 MB) and `dist/tsconfig.tsbuildinfo`; exclude them. Drop the duplicated `.claude/skills/monodesign` only after proving it byte-identical to the dependency's `skill/` and that no code reads it. Document `--omit=optional`. {i-003}{i-007}
- **[4/10]** Test-home isolation + `doctor --prune-home`. Add a shared vitest setup that points `HOME`/`MONOMIND_HOME` at a per-run dir and removes it. Add `doctor --prune-home`: it lists `~/.monomind/projects/*` whose source project is gone, says how much space they hold, and removes them on confirmation. Only `--prune-home` reaches users. The test-side leak is real and larger than rev 9 said: 18,950 dirs / 8.4 GB in a redirected `TMPDIR` over one org run (`pol-*`, `role-sandbox-*`, `git-guard-*`, `bus-*`, …). {i-001}
- **[3/10]** (provisional) Tests that depend on the machine: `doctor-project-checks.test.ts` → `checkSecondBrainModel` reads the real `$HOME` HF cache and real project docs with no isolation, so it passes or fails by machine state (it fails on this machine on any commit). Give it a constructed fixture. `tests/hooks/monograph-utils.test.mjs:24-28` turns a failed `import('@monoes/monograph')` into 9 silently skipped tests whenever the sibling `dist/` isn't built. {i-127}

---

## Org Runtime v2 (part of `@monoes/monomindcli`)

A daemon-coordinated system for autonomous multi-agent "organizations": a boss plus specialist roles running as live, provider-backed sessions. Roles talk over async mailboxes, checkpoint resumable state, and run on 14 interchangeable backends, with an audit trail in `bus.jsonl`. Most items here affect only org-runtime users, and are scored accordingly.

### Achieved Milestones
- `OrgDaemon` lifecycle: start/stop/deliver/resume, lazy role spawning, atomic `spawning` guard; `respawnRole` and `Mailbox` push/shift verified race-free.
- 14 runtime ids over 14 files (Claude SDK + 13 subprocess/SDK runners). Per the round-2 matrix, `maxTurns` is honored by claude and vercel only, provider-session resume works for 8 runners, and usage/cost is real for 6 of 14.
- "Fence Protocol" (`tool-fence.ts`) for the 12 runners without native tool-calling; per-role provider/runtime resolution; mixed-runtime orgs.
- Checkpoint/resume keeps mailbox queues, usage, role overrides, the task DAG, gates and questions (not the in-flight message, worktrees, approvals, or state on 6 runners — see Future). Atomic `runtime.json`; v1→v2 migration tested.
- `PolicyEngine` enforced via the Claude SDK `canUseTool` hook. Bounded restarts, circuit breaker, idle watchdog, serve lock, orphan reaping. Sender verification on `xdeliver`; redacted `audit` events; SSH fails closed on unknown hosts.
- Tests: every runner has a dedicated (fake-child/fixture) test file; 60+ orgrt test files.
- **Fixed (2026-09-17):** a foreground `org run` now applies pending `org reload`s each tick (previously only `org serve` did, so a rotated automation-role endpoint silently kept the old URL); 5 tests.
- **Fixed (2026-09-18):** the role sandbox masked `/run/containerd/containerd.sock` inside a directory it cannot list (`drwx--x--x`), so bwrap failed every sandboxed Bash call. It now masks the whole directory when the parent isn't readable (`role-sandbox.ts` + test) — `4683f0c`.

### Future Milestones
- **[8/10]** Stop→resume must not destroy role work. (a) `finishStop` force-removes shared and per-role worktrees (`daemon.ts` ~:2400), and resume recreates them from HEAD. Keep them, record `worktreePath`, and re-attach. (b) `Mailbox.serialize()` (`mailbox.ts:202-204`) drops `inFlight`; capture it. Acceptance: an uncommitted file survives stop/resume, and a dequeued message is delivered exactly once. The approvals half is i-071. {i-016}
- **[7/10]** (quick win) SSH federation hands LLM text to a remote login shell. `remote.ts:64-68` builds ``cd ${JSON.stringify(host.cwd)} && npx monomind org inbox ${orgName} --json ${JSON.stringify(payload)}`` as a single argv element, and the remote shell expands `$(…)`, backticks and `$VAR` in it. Send the payload on stdin (`org inbox --json -`), single-quote `cwd`, check `orgName` against `SAFE_NAME`, and add an `ssh`-shim contract test. It scores 7 because federation is opt-in. {i-014}
- **[7/10]** Build the child environment from an allowlist. `provider.ts:14-17` seeds a runner's env from a full `process.env` copy, and `codex-runner.ts:404` spreads it again. A Codex role therefore gets `GITHUB_TOKEN`, `AWS_*`, and other vendors' keys, while `cli-sandbox.ts:69` still passes `--sandbox danger-full-access`. Allow only PATH/HOME/locale/TMPDIR plus the credentials that provider declares. `org validate` should name every role that launches with permission bypass, and `org run` should print them at start. Mapping policy onto native/OS sandboxes is dropped as a design decision for the owner. {i-015}
- **[6/10]** Abort/timeout kills only the direct child. This was reported with a fake `codex` and not re-reproduced. Spawn detached, kill the process group, destroy stdout on SIGKILL, and tag `err.aborted` so a timeout doesn't read as a crash. {i-019}
- **[6/10]** Build a runner contract harness first: a fake runner plus a parameterized per-runner test for the liveness invariants. An empty exit-0 turn must fail, timeouts must surface as timeouts, and unparsable stdout lines must be counted. It should be red today for the named divergences: only hermes treats `timedOut` as failure, Vercel has no timeout, and 12 runners ignore `maxTurns`. The `SubprocessTurn`/`runFenceLoop` extraction comes after. {i-021}
- **[6/10]** Six runners pass the whole prompt as one argv element, so `E2BIG` is thrown synchronously past the error handler (reported at 129 KiB). Pass the prompt on stdin or via a temp file, and cap fed-back tool results. A 512 KiB prompt must complete. {i-023}
- **[5/10]** (quick win) `org serve`'s signal handler (`org.ts:1493-1504`) calls `persistCrashStateAll()` + `process.exit`, so every Ctrl-C is recorded as a crash. Use `await daemon.stopAll({ drainMs })` with a hard-exit fallback. {i-017}
- **[5/10]** (quick win) Make `org validate` call `scanInstalled()` and print a per-runner ledger (configured / binary found / version), exiting non-zero and naming a missing runner. `org status` should show the checkpoint's age. Periodic checkpoints and bus rotation wait for i-016. {i-022}
- **[5/10]** Vercel roles yield one bus event per `text-delta`, and the forwarder does a token-file read plus a serialized POST per event. Accumulate deltas per step, batch the forwarder (250 ms or 50 events), and read the credential once. Not re-measured (confidence 0.7). {i-018}
- **[5/10]** Per-cwd session stores bleed across roles (pi/pi-rpc `--session-dir`, crush `--continue`). Key them by `<orgDir>/runners/<roleId>/` as vercel already does, and emit `resume-context-lost` when a runner resumes cold. {i-020}
- **[4/10]** (quick win) `classifyStderr` (shared by 8 runners) marks a turn FATAL on any `401`/`403` substring. Match a real auth-error shape instead: `GET /admin → 403 (expected)` followed by exit 0 must be a successful turn. {i-024}

---

## MCP Tools & Knowledge Graph Memory (part of `@monoes/monomindcli`)

This is the MCP surface `@monomind/cli` exposes to Claude Code and other clients (`mcp-tools/**`, 25 modules, three stdio request loops). It also fronts two knowledge stores: the memory knowledge graph (`memory-kg.ts`) and the Second Brain document index (`document-pipeline.ts`), fused by `query-router.ts` behind `knowledge_search` and `doc search`.

### Achieved Milestones
- `tools/list` advertises 67 tools by default (~7.5k tokens per session; measured again 2026-09-18 at 7,528) and 210 under `MONOMIND_MCP_FULL=1`. Rev ≤ 9 latency: `initialize` 20–23 ms; `monograph_query` 6.9 ms, `knowledge_search` 4.7 ms, `memory_kg_search` 0.9 ms medians. No hangs or crashes on 12 malformed calls.
- **Fixed (2026-09-16):** the 14 deprecated `graphify_*` MCP tool shims are deleted (`mcp-tools/graphify-tools.ts`, its test, and the `index.ts`/`mcp-client.ts` references); `init --force` rebuilds `monograph.db` unconditionally, so no migration was needed.
- Monograph reads during a build are sound: 214 `monograph_query` calls across a forced rebuild, 0 errors, p95 5 ms.
- Module verdicts: **real** — `system`, `platforms`, `terminal`, `browser`, `performance`, `analyze`, `transfer`, `claims`; **partial** — `config`, `guidance`, `github`, `embeddings`, `autopilot`.
- Second Brain: content-hash idempotent ingest (single writer), heading/fence-aware chunking on the cut side, multi-surface router with RRF; memory KG ingest/rollback/integrity verified, org-scoped via `KgScope`. Input validation through `input-guards.ts` on `knowledge_*`, `browser_*`, `config_import`.

### Future Milestones
- **[9/10]** One hardened stdio loop; build as `i-grp-mcp-stdio` (plan exists). **The problem:** `handleMCPMessage` (`src/mcp-server.ts:594-870`, prototype-pollution stripper at `:520-527`) is private and on neither shipped path. `mcp start`, which `.mcp.json` runs (`bin/cli.js:204-289`), and `monomind-mcp` (`bin/mcp-server.js:96-208`) each loop on their own and `JSON.stringify` every result (`cli.js:262`, `mcp-server.js:165`). **The effect:** `isError` is lost, so a rejected path traversal reads as success. `name: 42` gives "name.indexOf is not a function". Wrappers add 9–27% per result. Both `tools/list` mappings drop `enabled`, so `mcp toggle --disable` hides nothing, and `listChanged` is advertised but never emitted. **The fix:** export the handler, have both bins delegate to it, and delete the copies and `bin-cli-mcp-fast-path.test.ts`. Honour `enabled`, resolve `listChanged`, use one `getPackageVersion`, and add a stdio snapshot harness. Measure startup before and after. This has the highest blast radius on the board. {i-025}{i-030}
- **[8/10]** (quick win) `config_set` deletes the provider config. `config-tools.ts:53-94` reads and rewrites `.monomind/config.json` as `{values, scopes, version, updatedAt}`, while `commands/providers.ts:40-66` stores `agents.providers[].apiKey` in the same file. Read-modify-write through `configManager` (or preserve unknown keys), test that providers survive, and keep old-shape files loading. Keychain / `credentials.json` storage is a separate item. {i-026}
- **[7/10]** Degraded embeddings are silent and permanent, verified live in an isolated `MONOMIND_HOME`. With no model cached, `embedding-operations.ts:228-239` falls back to a 128-dim hash embedding that produces plausible, meaningless scores. `doc ingest` says nothing, and content-hash dedup never re-embeds. State the method and warn in `doc ingest`/`doc search`, fix the "Semantic search" claim at all three sites (`doc.ts:135,805,821`), and add `doc reindex --missing-embeddings`. `doctor` already reports the model; caching is i-088. {i-028}
- **[6/10]** Bad tool arguments produce opaque errors. Only 2 of 33 `mcp-tools/*.ts` call `validateInput`. `callMCPTool` enforces presence and only *warns* on a type mismatch (`mcp-client.ts:250-301`, whose own comment stages the plan), and `validateToolInput` is exported with zero callers. Reject mismatches, add `maxLength` to strings, report unknown keys, and return `{isError: true}` with an actionable message. Do this after the stdio group. {i-029}
- **[6/10]** Knowledge search display and routing: The excerpt shown is the situating blurb, not the match (`document-pipeline.ts:867-874`). The top score always shows 1.050. A confident single-surface route hides documents (`query-router.ts:189-218`). Do the display fixes first; the router change needs a before/after recall comparison. Not re-reproduced (confidence 0.7). {i-031}
- **[6/10]** (quick win) Two fixes in the system and terminal tools. `system_health` can never report healthy: `monoswarm`/`neural` are hardcoded `unknown` (`system-tools.ts:422-433`) against a 0.8 threshold (`:482`). Exclude permanently-unknown checks. `terminal_execute` is armed by a project-writable `.monomind/enable-terminal.json` (`terminal-tools.ts:98-108`; `execSync` behind a denylist at `:318-325`), so cloning a repo can enable it. Honour only `MONOMIND_ENABLE_TERMINAL` or `~/.monomind` config. {i-032}
- **[5/10]** Tools that mislead the model: `github_repo_analyze`/`github_metrics` return fabricated zeros (pipes are passed as literal argv). Fix or remove them. Three descriptions are wrong: `hooks_pre-task` "ADR-026 routing", `hooks_route` "native HNSW", and the `agent_terminate`/`agent_health` status claims. Fix them. Replace the 35 stub descriptions and add a description lint. {i-033}
- **[4/10]** (quick win) Trim the roster — only the free part. As measured on 2026-09-18, descriptions are 24.3% of roster bytes (not 68%). Shipped content references 4 of the 6 bookkeeping categories: agent 422 references (`agent_spawn` alone 395), task 63, system 28, session 2. Only `config` and `guidance` (≈ 900 of 7,528 tokens) can leave the default tier now; the rest waits for i-040. Reuse `CORE_TOOL_CATEGORIES`/`CORE_HIDDEN_TOOLS` (`mcp-client.ts:119-187`). {i-027}

---

## Monoswarm & Agent/Task/Session Stores (part of `@monoes/monomindcli`)

The "monoswarm" coordination feature: 13 `monoswarm_*` MCP tools, the `agent_*`/`task_*`/`session_*` tools, and the matching CLI groups. Every tool here is JSON bookkeeping. `agent_spawn` starts no process, votes are tallied in-process, and no code links monoswarm state to Claude Code's Agent/Task tool.

### Achieved Milestones
- 13 `monoswarm_*` tools over one `<dataRoot>/monoswarm/state.json` (`.git/monomind` in a git repo); honest "starts no process" descriptions; real vote math with deadlock detection, flip invalidation, duplicate check, divergence gate; HMAC-signed audit trail. `agent_spawn`/`task_*`/`session_*` persist JSON stores with corrupt-store refusal. 59 tests across 7 files.

### Future Milestones
- **[6/10]** (quick win) `session restore --latest` "restores" garbage. `session-tools.ts:271` sorts on an unguarded `savedAt` (undefined → NaN), and `:345` returns `restored: true` for any parseable JSON. Meanwhile the hook's `.claude/helpers/session.cjs:32` writes `current.json`, with a different schema and no `savedAt`, into the same `<dataRoot>/sessions`. Validate the shape, skip entries without `savedAt`, separate or namespace the directories, and return `restored: false` with a reason. (The generated CLAUDE.md does not tell sessions to run this.) {i-036}
- Whether monoswarm's "MUST" stays is **Owner testing #8**; the code work sits in Init's CLAUDE.md group.

---

## Init System & Multi-Platform Integration (part of `@monoes/monomindcli`)

`packages/@monomind/cli/src/init/` scaffolds a project for Claude Code and other agent CLIs. It generates the hooks, the statusline, CLAUDE.md, `.monomind/.gitignore`, and the agent/skill/command content. This section owns hook latency, safety and output, statusline truth, and the correctness of everything init generates.

### Achieved Milestones
- Five fully-wired platform targets; isolated per-platform directories; security-gate parity per platform; three presets + wizard; `init upgrade` with a manifest that gates deletion (`init/shared.ts:278-370`); forced Monograph rebuild on `init`/`--force`/`--wizard`.
- Generated hook scripts exit 0 on malformed stdin; 25–128 ms per handler, 75–80 ms for the statusline. SessionStart chain measured at ≈ 690 ms serialized, 523 ms of it `session-restore` (see Future).
- **Fixed (2026-09-16):** `capture-handler.cjs`'s `readStdin()` timer `.unref()`s (root + packaged), so it no longer outlives `resolve()` by 3 s (the subagent-spawn stall); its 12 tests run in 440 ms.
- **Fixed (2026-09-16):** `monograph-freshen.cjs`'s `resolveMonographEntry()` (all three copies) tries `npm root -g` only after the fast path candidates miss (`tests/hooks/monograph-freshen.test.mjs`).
- **Fixed (2026-09-16):** "graphify", another project's name, is gone from this product's own naming: `monograph-freshen.cjs`, `.monograph` config keys, `monographSection()`, `getMonographStats()`. Upstream attribution comments stay. Pre-rename projects migrate: `doctor` flags the obsolete helper, and `init --force` deletes it and strips its `settings.json` command; custom hooks survive.

### Future Milestones
- **[9/10]** Hook enrichment never reaches the model (plan exists). (a) `settings-generator.ts:59` ships `MONOMIND_HOOK_QUIET: '1'`, so all 28 advisory call sites in `route-handler.cjs:26-30` return early: per-prompt route output is 0 bytes in every init'd project. The advertised opt-back-in, `MONOMIND_HOOK_VERBOSE` (`:58`), is read by nothing. (b) `[MONOGRAPH_HINT]` (23 sites in `hook-handler.cjs`), `[AFFECTED_TESTS]`/`[SECURITY_EDIT]` (`edit-handler.cjs:47,61-62`) and `[COMPACT_GRAPH]` (`utils/monograph.cjs:559`) go to plain stdout on PreToolUse/PostToolUse/PreCompact. `hookSpecificOutput.additionalContext` is used nowhere; monodesign's `hook-lib.mjs:1774` shows the pattern. Emit one buffered `additionalContext` object per hook, and invert QUIET or make VERBOSE work. Confirm PreCompact support first, and add one test per tag. This item also owns the settings-generator env-block cleanup. {i-038}
- **[8/10]** Make the generated CLAUDE.md tell the truth; build as `i-grp-claudemd-truth` (plan exists). It tells users to run `init --wizard` (`claudemd-generator.ts:292`, `write-capabilities.ts:168,349`, `guidance-tools.ts:939`). That's not a flag — `init wizard` is a subcommand — and unknown flags are ignored, so it runs a plain init. It recommends the deprecated `hooks session-start` (`:329`) and hardcodes the 29/8 hook/worker counts (`:283,:321`). An env block (`:469-479`, plus `mcp-generator.ts:41-46`) advertises seven `MONOMIND_*` vars that nothing reads. `detectOptionalPackages()` (`:73-91`) resolves `@monoes/hooks`/`monofence-ai` through `createRequire().resolve`, but they export only `import`, so every CLAUDE.md says hooks are "(unavailable in this install)". Use `import.meta.resolve()`. Apply the monoswarm decision from Owner testing #8. "66+ tools" is true; keep it. There are six template variants. **The upgrade path is open:** `CLAUDE.md` and `CAPABILITIES.md` are skip-if-exists, and `CAPABILITIES.md` has no managed block. Acceptance asserts on a pre-fix project's files. {i-041}{i-117}
- **[8/10]** Generated files use `npx monomind@latest` — 278 times in 135 files, but the single point of change is `platform-adapters/renderers/mcp.ts:24`, plus the new `monoes-proxy` entry. That costs a registry round-trip on every MCP start and leaves no server offline; rev 9 measured a 70 s hang, then failure. Remove `@latest` from generated files and add `--prefer-offline`. Decide pin-to-installed vs. resolving the local binary (a pin goes stale on upgrade). Re-point, don't delete, the seven tests that pin `@latest` (`platform-adapters/mcp.test.ts`, `codex-generator.test.ts:49`, `doctor-project-checks.test.ts:271,278`). Test with a pre-fix-project fixture, and serialize with the CLAUDE.md group. {i-044}
- **[7/10]** Every session start blocks on work it throws away: `session-restore-handler.cjs:574` calls `quickSummaryData()` → `_computeQuickTotals()` synchronously, right after the cache-first `quickSummary()` (`:569`). The cost scales with the size of `~/.claude/projects`. `injectGodNodesContext()` (`utils/monograph.cjs:632-706`) queries the graph and spawns `git` twice, even under QUIET, where its output is discarded. `:310-339` awaits workers inline, even though `:196-208` already has a detached-spawn pattern. Let the detached child write `token-summary.json`, skip the query under QUIET, and spawn the workers detached. {i-043}
- **[7/10]** `init --force` must not be able to break a live session. `write-claude.ts:326,428` and `copy-assets.ts:206` `copyFileSync` straight over helpers a hook may be `require()`-ing, while `atomicWriteFile` (`shared.ts:43`) is used at eight other sites in the same file. Use it at these three sites, and add a smoke case that runs every generated hook under `sh -c` with a scrubbed PATH and a 5 s budget. That is the failure class behind #42, #58, #236 and #129. {i-047}
- **[7/10]** The graph gate blocks non-code searches (plan exists). `hook-handler.cjs:444-460` matches `\b(grep|rg|ag)\b` over the whole command, so `ps aux | grep` and `git grep` are blocked. `:711-725` also blocks any Grep/Glob, including `Glob **/*.md`. In rev 7's 8-task evaluation the graph lost 5 and gave 2 confident wrong answers. Block only bare-identifier patterns; exempt Glob, non-first pipeline segments and non-source paths; and don't judge the fix on the gate's own telemetry. {i-049}
- **[7/10]** A default `init` writes ~1,845 files across six surfaces (`.claude` 529, `.gemini` 302, `.agents` 254, `.opencode` 296, `.kimi-code` 397, `.codex` 2). `DEFAULT_INIT_OPTIONS` is a test fixture, not the runtime default. Write only the platforms the user has or asks for (Claude Code by default), and print the count before writing. `init --platform trae` renders nothing yet exits 0; make it fail. New installs only — never delete existing trees. `platforms doctor` works. See Owner testing #10 and #12. {i-050}
- **[7/10]** Phantom references need one lint. In the packaged tree, 43 of 103 referenced `mcp__monomind__*` names don't exist (`task_orchestrate`, `swarm_*`, `memory_usage`, `workflow_*`, `neural_*`, `hooks_pre_task`). 35 files call `monomind github|swarm|workflow|pair|hive-mind`, none of which exist, and those exit 0 (i-056). Extend `scripts/lint-skills.mjs`. Today it checks skills and CLI names only and exits 0 with 1,079 warnings. It should check agents and commands in both trees, and tool names against the live registry, and fail on anything unresolved. Fix what it flags, including 43 of 44 packaged `mastermind/*.md` commands that have no frontmatter or description. Test with a pre-fix-project fixture. {i-040}
- **[7/10]** Statusline truth; build as `i-grp-statusline-truth`, after i-038 (a)+(b). It credits hook heuristics as graph wins at a fixed 1,700 tokens each. `saved` and `wasted` use the identical expression (`utils/monograph.cjs:309,314`), and live counters read 2,131 heuristic assists vs 40 real `monograph_call`s, all shown as "💰 saved". No implementation reads Claude Code's stdin (`model.display_name`, `cost.total_cost_usd`, `context_window`). The cache is global and keyed only on mode (`statusline-generator.ts:1434-1458`), so two projects show each other's line. Count only real calls, read stdin (50 ms cap), and key the cache by cwd. {i-046}
- **[6/10]** (quick win) The dashboard writes its credential into other repos. `propagateDashboardToken` (`ui/server.mjs:1057-1076`) writes `dashboard-token` (0600) into every known project whose `control.json` points at this port and never clears it. The generated `.monomind/.gitignore` doesn't match `dashboard-token`, because `*.token` needs an extension. Stop doing this, or make it opt-in, clear the files on stop, and make sure they're ignored. {i-052}
- **[5/10]** (quick win) 12 `README.md` files land in `.claude/commands/**` as commands. `copy-assets.ts:193-212` copies category dirs without the `isLikelyUserFile` filter that `write-opencode.ts`/`write-kimicode.ts` use. Apply the filter, delete the tracked READMEs, and add an "init twice → identical tree" test. {i-045}
- **[5/10]** (quick win) 55 of 97 packaged agents have a `name:` that disagrees with their filename slug (`engineering-ai-engineer` → `AI Engineer`). Make `name:` kebab-case and equal to the filename, with an invariant test. {i-048}
- **[4/10]** (quick win) The event logger ships unwired: a fresh `init` registers `event-logger.cjs` zero times (this repo has 11) but copies it everywhere at 0644. Either stop shipping it, or make it safe: apply the fixed `redact()` before every append, drop `raw`, store `file_path` + hash instead of content, and write 0600. Accept on the files themselves: nothing redactable under `events/`, and no 0644. {i-039}
- **[4/10]** (quick win) Upgrade safety: add a property test that upgrade never removes a path absent from the manifest. `helpers-generator.ts:12-39` generates a `pre-commit` hook that nothing installs. Install it with consent, or stop generating it. {i-051}
- **[3/10]** (quick win) `mcp verify` (registry OK) followed by `mcp status` ("Stopped") reads as a contradiction; each should say what it checks and what to run next. Also fix init's garbled closing sentence. {i-053}

---

## CLI Commands: Diagnostics, Security, Hooks & Ops (part of `@monoes/monomindcli`)

The command dispatcher and parser (`index.ts`, `parser.ts`, `suggest.ts`) and the operational, diagnostic, and security command surface: `doctor`, `security`, `tokens`, `performance`, `hooks`, `memory`, `config`/`providers`, `status`, `guidance`, `completions`, the generated bash/write gates, the crash reporter, and `input-guards.ts`.

### Achieved Milestones
- Startup (rev ≤ 9): `--version` 60 ms, `status` ~250 ms, `--help` 322–432 ms; searches are ≥ 95 % CLI boot. MCP server RSS plateaus at 166 MB. Non-TTY output is clean (no ANSI, `NO_COLOR` honored).
- `doctor`: health checks via a `componentMap` dispatch table (now incl. `native`, `monoes-token`, `crash-reporting`) with `--fix` for helper files, gitignore, sidecars, shims; prints API-key *names* only.
- `security scan` (explicit `ScanCoverage`, SARIF), `security cve`, `security audit`, `security defend`, `security redteam --target`; generated `pre-bash`/`pre-write` gates; `input-guards.ts` typed validation, symlink-aware path guard, URL allowlist.
- Inbound surfaces verified: dashboard loopback + Host allowlist + 0o600 token; daemon Host/Origin + timing-safe credentials; remote MCP token-gated.
- Token accounting (`token-tracker.cjs`): walks `subagents/`, dedups by `message.id`, prices cache read/write separately. Pricing verified on 2026-09-18: fable-5/5.1 in all four tables, sonnet-5 priced correctly, `costIncomplete` lower-bound marker, `pricing-parity.test.ts` 6/6.
- **Fixed (2026-09-16):** `monomind status`'s System Resources table renders (an unbound `output.*` method reference threw inside a swallowing catch); regression-tested.
- **Fixed (2026-09-18):** crash reporting uses tri-state consent, and a new install starts `unanswered` (`~/.monomind/crash-reporting.json`). An interactive run shows the local report path and asks once (`[y/N]`; No on a 15 s timeout or EOF). Non-TTY runs save locally with no network call and stay unanswered. `MONOMIND_CRASH_REPORTING=off` and `monomind crash-reporting enable|disable|status` control it. The gate sits inside `reportCrash()`, so both entry points are covered: `bin/cli.js`'s handlers and the hidden `report-crash`. `prompt.ts` now resolves immediately on EOF (`0ef431f`). `doctor -c crash-reporting` is registered, `native` is listed in `doctor --help`, and two monoes-exposure messages are corrected (`c644690`). Root-suite crash-reporter tests were updated for the gate and now assert that the `gh` probe runs (`cf68658`). {i-055}{i-055-doctor-followup}{i-128}
- **Fixed (2026-09-18):** `redact()` (`utils/redaction.ts`, the scrubber `crash-reporter.ts` uses) now catches `Authorization: Bearer …`, quoted JSON keys (`"accessToken":`), and self-identifying prefixes (`gh[pousr]_`, `github_pat_`, `glpat-`, `xox[abprs]-`, `sk_live_`/`sk_test_`, widened `npm_`). Secret patterns now run before the phone/SSN pass, which used to split Slack tokens and leave the secret suffix. Measured: 7/7 realistic shapes leaked before, 0/7 after, 5/5 benign strings unchanged — `6bcd64f`. {i-116}

### Future Milestones
- **[6/10]** (quick win) The update notice (`↑ monomind vX available → run: npm install -g …`, `src/index.ts:495`) prints while an interactive prompt is waiting — it landed on the crash-consent `[y/N]` line and the owner answered `y` twice by mistake (owner testing #2, 2026-09-19). Suppress or defer the notice while any prompt is open, and never print it on stdout of `mcp` subcommands. {o-01}
- **[3/10]** (quick win) `ui` flag validation: `--project-dir` with no value crashes with `The "paths[0]" argument must be of type string. Received type boolean (true)`, and an invalid `--port` (`4260~`) silently falls back to scanning from 4242 and then fails with `MaxListenersExceededWarning` once 11 ports are busy. Reject bad values with a one-line message. {o-02}
- **[8/10]** Fix the CLI contract; build as `i-grp-cli-dispatch`, i-060 first. **Unknown subcommands exit 0.** `memory lisst` and `agent|hooks|session|doc|security|tokens|monograph bogus` print help and exit 0; only `org` exits 1. `findChild` (`index.ts:216-238`) stops at the first unmatched segment and falls through to help (`:280-283`). **Unknown flags pass.** `status --bogus-flag` runs because `parser.ts:782` sets `allowUnknownFlags: true`. **The fix:** exit 2 with a suggestion on stderr, using the uncalled `formatSuggestion` (`suggest.ts:108`; the same-named function in `monograph/query-tools.ts` is unrelated). Make unknown flags errors with per-command opt-in, add a dispatch test per group, and cover `memory search --mode keyword` (the real flag is `-t/--type`). **First:** make `--json` an alias of `--format json` everywhere, with a pure-JSON contract test. Today `memory|task|session list` and `mcp tools` ignore `--json`, `doctor` ignores both, and `platforms plan --json` exits 1 with empty stdout. Without this, a strict parser breaks everyone already passing `--json`. {i-060}{i-056}
- **[7/10]** The destructive-ops gate is wrong in both directions. `gates-handler.cjs:226-239` runs unanchored regexes that block `grep -rn "drop table"`, `git log --grep=…`, an `echo` that mentions `rm -rf`, and `git push --force-with-lease` (via `--force\b`). Meanwhile `find ./dist -delete` and `git branch -D main` pass. The block message (`:344`) says no confirm path exists, but `permissionDecision: "ask"` does; it's just unused. Tokenize the command, `ask` for destructive operations, `deny` only for the unrecoverable set, and add a table-driven test. {i-057}
- **[7/10]** The README's own examples fail: `doc search "…"` and `memory search "…"` fail with `Required option missing: --query`, while `route`/`search` accept positionals. `org status nonexistent` prints two differently-worded errors on two streams. A single required string option should accept the first positional, and errors should return `{message, hint}`. Add a test that runs every fenced `monomind …` snippet in README and `doc/` (shared runner with i-074). Build this in the dispatch lane, after the group. {i-059}
- **[6/10]** The write gate fails open in three places: stdin over `MAX_STDIN_BYTES` (1 MiB) resolves to `''` silently (`hook-handler.cjs:211,227-232`); a 500 ms stdin timer allows on partial data (`:218-222`); content is sliced at 512 KiB before scanning (`gates-handler.cjs:520-522`). Remove the timer for gates (keep the 5 s fail-closed bound), `ask` on truncation, and scan in chunks. {i-058}
- **[5/10]** (quick win) Six flags are declared and never read: `route -k/--keyword` (declared twice, `route.ts:125,1051`), `monoswarm --parallel`, `design palette --random`, `analyze --embedding-device`, `browse --account`, and `config init --v1` (used in its own help example). Remove or implement each one. A flag that stays as a no-op must say so, as `hooks --auto-configure`/`--restore-context` and `org events --ndjson` already do. Add a test that every declared flag is read or marked. {i-062}
- **[5/10]** (provisional) `prompt.ts` `input()` with `validate` and no default loops, then hangs on EOF (8 call sites). This is pre-existing: the EOF fix in `0ef431f` covers `confirm()` only. {i-122}
- **[4/10]** (quick win) The one surviving pricing gap: 1-hour cache writes are billed at the 5-minute rate. Add the 1 h rate to all four tables (`model-pricing.ts`, `collector.mjs`, `server.mjs`, `token-tracker.cjs` + its `.cjs` mirrors), and extend `pricing-parity.test.ts` to every rate field. This is not parallel-safe with `helpers/` work. {i-054}
- **[4/10]** (quick win) Bounded state: rotate or cap `build.log` and the watch log, and prune backups on a retention policy. {i-063}

---

## Dashboard (Neural Control Room) (part of `@monoes/monomindcli`)

`monomind ui` is a local web UI over projects, sessions, tokens, memory, orgs, the graph and human-input queues: ~28k lines plus a ~14k-line `dashboard.html`. `control-start.cjs` auto-starts it on every SessionStart.

### Achieved Milestones
- ~122 API routes, 3 SSE streams, debounced `fs.watch`. Auth verified live: default-deny `/api/*`, timing-safe compare, Host-header loopback allowlist, own-origin CORS, 0o600 token file, per-process token rotation. monoes.me OAuth uses random `state`, PKCE S256, 10-min TTL, fixed loopback `redirect_uri`.
- Measured: first 200 in ~500 ms; RSS plateaus at 281 MB; idle CPU 0.4 %; cheap routes 0–10 ms.
- **Fixed (2026-09-18):** 119 controls no longer throw `ReferenceError`: 113 in `dashboard.html`, 2 in `orgs.html`, 4 in `mastermind-diagram-fallback.html`. An `Object.assign(window, {…})` block per file maps the inline `on*="name("` handlers to their `_`-prefixed definitions (renamed in 9537930fb). A resolution guard test is shown failing on the old code. The route failures the fix made reachable are ledgered under Future — `4e5adfc`. {i-065}
- **Fixed (2026-09-18):** the monoes.me OAuth token is no longer written into `.mcp.json`. Both writers (`routes-monoes.mjs`, `init/mcp-generator.ts`) emit a local stdio proxy entry (`mcp monoes-proxy`) that resolves the header at request time via `getValidMonoesToken()`, wrapped in `cmd /c` on win32. A legacy literal-bearer entry is migrated on the dashboard's status poll and flagged loudly (revoke + reconnect) by the dashboard, by `init` on every target (including `--target codex`), and by `doctor -c monoes-token`. The generated `.monomind/.gitignore` covers `monoes-connection.json`, and init never narrows a user's blanket `.monomind/` ignore. This took four revision rounds and 13 findings — `2c9bcec`, `54495b0`. The refresh token still lives under the project's `.monomind/`. {i-066}{i-121}{i-066-followup}

### Future Milestones
- **[7/10]** (quick win) The Monograph **Graph** tab is unusable: its iframe (`dashboard.html:12101`) and Export → HTML (`:12892`) load `/api/monograph-html` without the auth token, so the server answers 401 `Unauthorized: missing or invalid auth token`. Append the page token (`?token=`) like other iframe/SSE routes, with a test that loads the tab. {o-03}
- **[6/10]** Dashboard servers are never reaped: on 2026-09-19 eleven servers held ports 4242–4252 (org forwarder self-heal spawns, test runs, one running the `dist` of a deleted worktree), so a new `ui` could not bind. Record every spawned server with its project, stop it with the org/session that started it, and have `ui` report "N stale dashboards, stop with …". {o-04}
- **[2/10]** (quick win) `data/avatars/code-review-swarm.svg` is 404 on the Orgs page — ship the avatar or fall back to a default. {o-05}
- **[7/10]** monoes.me connect: the OAuth `redirect_uri` uses the requested port instead of the bound one, and a cached `clientId` is reused for another port, so after Allow the browser lands on a dead port (#307); the dashboard home ignores `--project-dir` (#308). {o-06}
- **[7/10]** The Tokens and Sessions views overcount and re-parse. There is no `message.id` dedup (`collector.mjs:314-419`, `server.mjs:2135-2158`), `subagents/` is skipped (a flat read), and every call re-parses every session JSONL. Rev 8 measured ~142 ms CPU per request and RSS growing from 282 to 479 MB, not reclaimed. Build one `iterAssistantMessages()` with an mtime-keyed per-file cache, include subagents, surface `costIncomplete`, and test against a known-answer fixture. {i-067}
- **[7/10]** Duplicate dashboards. `control-start.cjs` auto-increments from 4242 and falls back to `npx monomind` (`:8,:91-93,:424`); rev 8 measured four live instances ≈ 1.03 GB RSS on one machine. `dashboard.html:11435,11445,11778,11851` hardcode `localhost:4243` for the monobrowse builder. Connect to an already-serving instance, degrading gracefully when it serves another project, with a deliberate second instance still possible. Read the builder port from `control.json`. {i-068}
- **[6/10]** (quick win) `/api/monograph` runs `execFileSync('sqlite3', …)` four times per request (`routes-monograph.mjs:1514-1560`) and returns `[]` on any machine without a `sqlite3` binary. The sibling `/api/monograph-html` (`:16-26`) already opens the DB in-process; reuse that, and cache counts on `index_meta.indexed_at`. {i-069}
- **[6/10]** (quick win) The server writes outside `.monomind`: `<project>/data/known-projects.json` (`server.mjs:1059,1218`). `data/unknown-events.jsonl` (`:1148`). `data/sessions/_index.json` (`:1468-1479`). `<cwd>/.claude/scheduled_tasks.lock` (`:3501`). `data/` collides with users' own directories. Move all of it under `.monomind/` (cross-project state to `~/.monomind/`) and migrate known-projects. {i-072}
- **[6/10]** Approve and Answer never reach the daemon. The Answer request (`routes-org.mjs:1696-1701`) sends only `Content-Type` to `/api/answer-question`, which `orgrt/server.ts:193` restricts to the operator credential, so it 401s by construction. Approve edits `<org>-approvals.json` directly, while the daemon rewrites that file from memory. The handler layer was fixed in `4e5adfc`. Route both through the daemon with the operator credential, and assert the daemon saw the action and that it survives a restart. {i-071}{i-126}
- **[4/10]** (quick win) Delete `/api/monograph-benchmark` (`routes-monograph.mjs:1472-1502`). It shells out to ``graphify benchmark ${gp}``, a binary that doesn't exist, so every call returns 500. No dashboard control calls it. Keep the `graphify-out/graph.json` legacy read. {i-070}
- **[4/10]** (quick win) `_checkAuth` (`server.mjs:1770-1782`) accepts `?token=` on any method. Refuse query tokens on state-changing requests, and add a `Sec-Fetch-Site` check. {i-073}
- **[4/10]** (provisional) `/api/monograph-wiki-search` is called (`dashboard.html:13231`) and defined nowhere, so it 404s. Implement the route or remove the caller. {i-118}
- **[4/10]** (provisional) `/api/data` 500s because `collectSwarm` reads an unbound `base` (`collector.mjs:212,214`). This is not a one-liner: it reads two roots (canonical, then legacy) via `readFirstJSON`, and binding `base` to one of them would give an empty panel with no error. Decide the canonical root and mirror the two-root pattern. {i-119}
- **[4/10]** (provisional) `DELETE /api/memory/entry` and `DELETE /api/memory-file` return 500 on an empty body (unguarded `JSON.parse`); one shared fix covers both. {i-120}{i-125}
- **[3/10]** (provisional) Two error paths should return clear messages instead of failing: `GET /api/monograph-html` 404s when no graph is built, and `GET /api/session-errors` 500s when the session dir is missing. {i-123}{i-124}

---

## Documentation

`README.md`, `doc/` (deployed raw to GitHub Pages by `pages.yml`), `docs/platforms/`, `doc/llms.txt`, and the generated `CLAUDE.md`/`GEMINI.md`/`AGENTS.md` templates.

### Achieved Milestones
- The README quickstart works end to end in a scratch project when `memory search`/`doc search` use `-q`; 158 of 160 documented command names exist; all `hooks` and `org` subcommands in the docs are real; `docs/platforms/compatibility.md` is generated from the registry.
- Promise audit (rev 7): not a different product. Orgs, Monograph, Second Brain, memory and the multi-platform init are real. **Under-sold:** `org`'s 35 subcommands and 14 backends, `doc eval`, `security redteam`, SARIF, monobrowse's 60+ subcommands, the dashboard's views, `doctor --fix`, `completions`.

### Future Milestones
- **[9/10]** (quick win) The privacy claim on npm is false (plan exists). `package.json:4` says "no data leaves your machine" and names 2 platforms, while the README lists five. `getting-started.md:112` calls the model download the only outbound request, two bullets after telling users to run `doctor`, which always runs `npm view` (`doctor-env-checks.ts:241`). `llms.txt:8` says no user data leaves the machine, yet crash reports carry stack traces. README:287's version is scoped to the Second Brain and is true; don't blanket-replace it. Write one canonical table of outbound requests and their triggers: update check, `doctor`, crash reports under consent, the monoes.me upload, and the model download. Then fix the other three claims, and delete monograph's dead `api.fallow.cloud` client (i-097). {i-078}
- **[8/10]** (quick win) The Quickstart's first command doesn't exist (plan exists). README :196, :200-234, :261, :382-387 and :397 cite `/mastermind:autodev`, `build`, `tdd`, `architect`, `approvev1` and `runorgv1`, and none of them exists in either 44-file `commands/mastermind/` tree. Retarget them to `/mastermind:improve --tillend`/`loops`; `runorgv1` is framed as retired, so reword that one. Fix :38/:258: "30+" is true, "49" is wrong, and the real count is 42. Add a check that every `/mastermind:<x>` in README and `doc/` resolves. `check-doc-refs.mjs` scans neither, so a green `pnpm verify` proves nothing here. {i-074}
- **[7/10]** (quick win) The README invents specifics: The L0→L3 memory tiers, `BM25 K1=1.5, B=0.75` and "Federated swarm reads" (:296-309) have no code behind them. :36 ("JSON pattern store") contradicts :295 (SQLite + vectors). The recall bar at :285 is `semantic ? 0.75 : 0.25` (`cognee-port-eval.test.mjs:102`), not 80%; CI does provision a model. :272's "~60 ms" is unmeasured. :101 says Claude Code "prompts you before executing anything sensitive", but the gates hard-deny without prompting and fail open (i-057, i-058). Replace the section with one true description, and restate :101. {i-075}
- **[6/10]** The docs site links to none of the docs: `doc/index.html` (a 2,428-line SPA) links to none of the 40 `.md` files under `doc/`. Only 2 of 432 links are truly missing (`documents-dashboard.md → ../adrs/…`, `routing.md:61`). But 252 are repo-root-relative, which `check-doc-refs.mjs` accepts and GitHub/Pages readers get as a 404. The CLI package README is a byte copy of the root one, so its links break on npm. Add a `doc/README.md` TOC, fix the 2, pick a link convention deliberately, and replace the CLI README with a pointer. {i-076}
- **[5/10]** There is no environment-variable reference. 67 `MONOMIND_*` vars are read in code, 12 appear in `doc/`, and 55 are undocumented — including `MONOMIND_ENABLE_TERMINAL`, `MONOMIND_ALLOW_BROWSER_EVAL`, `MONOMIND_MCP_ALLOW_REMOTE`, `MONOMIND_SESSION_SECRET` and `MONOMIND_MCP_TOKEN`. Add a lint that enumerates the reads, generate `doc/commands/environment.md` from it, and fail on an unregistered read. {i-079}
- **[5/10]** Tool counts and visibility: The default roster is 67; `MONOMIND_MCP_FULL=1` gives 210, or 237 with the advanced monograph tools. `CORE_HIDDEN_TOOLS` (`mcp-client.ts:153-183`) hides 26 tools without documentation. "88 tools" (`doc/concepts/antigravity.md:34`, `opencode.md:25`) matches nothing. `mcp tools --markdown` is silently ignored. Generate the counts, document the visibility model and how to reach a hidden tool, and generate a reference with a visibility column. Add one paragraph saying `@monoes/mcp` is HTTP/WS-only. Do this after i-027. {i-080}
- **[5/10]** Counts and the HNSW story: Extend `generate-doc-counts.mjs` to the org-subcommand and mastermind-command counts, and generate `llms.txt`. Drop the per-doc version headers (ten concept docs pinned 2.8.3–2.9.0; `memory.md` says "v3.0.0"). Make three sources agree with the size-gated ANN in `SqlBackend.search()`: `memory.md:118/135` (which cites the removed `getHNSWIndex()`), `hooks intelligence --enable-hnsw` ("dead fallback path"), and `doctor` ("HNSW search enabled"). `getting-started.md:102` cites a `monograph status` command that doesn't exist. {i-081}
- **[3/10]** (quick win) Make `check-publish-versions.mjs` require a CHANGELOG heading for the version being published, and backfill 2.10.21–2.10.26. {i-082}

---

## @monoes/hooks (`@monoes/hooks` v1.0.7)

A standalone library, not the live hook dispatcher. It holds hook definitions, an unused `HookRegistry`/`HookExecutor`, and a `WorkerManager` with 9 staleness-gated background workers that feed the statusline, the router and `doctor`.

### Future Milestones
- **[4/10]** Two sessions in one project double-run stale workers (`workers-state.json` is last-writer-wins). Each stale worker should run once under concurrent session starts; add worker tests for `progress` and `reflexion`. Inline awaiting is i-043. Unverified this run (confidence 0.7). {i-083}

---

## @monoes/memory (`@monoes/memory` v1.0.17)

The memory backend under the CLI: one `IMemoryBackend` over pluggable SQLite drivers (`better-sqlite3`, with a `sql.js` fallback), a pure-JS `HNSWIndex`, and the Second Brain's chunker. Embeddings are generated in the CLI and injected.

### Achieved Milestones
- Unified `SqlBackend` over a `SqlDriver` abstraction; WAL; size-gated HNSW inside `SqlBackend.search()` (threshold 5000, persisted next to the DB); `better-sqlite3 ^12` mandatory; LanceDB gone (the directory name survives). Content-hash idempotent ingest verified for a single writer; fences respected by the chunker.

### Future Milestones
- **[8/10]** Memory writes fail under monomind's own concurrency: `sql-driver.ts:125` (deferred `.transaction()`) and `:241` (plain `BEGIN`) carry every write in `sql-backend.ts`, with no `SQLITE_BUSY` retry. `busy_timeout` defaults to 0 (`sqlite-backend.ts:52-67`). ~12 `catch { return null }` sites swallow the error (`memory-bridge.ts:25-31`). In rev 9, 6/30 and 9/24 parallel stores failed, and `doc ingest` reported "partial store" but exited 0. A harness showed 25/200 failures deferred vs 0/200 with `.immediate()`. Use `BEGIN IMMEDIATE` with a bounded retry, a non-zero `busy_timeout`, and a non-zero exit on partial store, plus a two-process contention test (shared with i-089). {i-085}
- **[7/10]** (quick win) Natural-language keyword search returns nothing. The coverage gate (`memory-bridge.ts:1172-1173`, threshold 0.3 at `:898`) counts stopwords, since there is no stopword list at `:1016-1019`. So "how do we handle tokens" returns 0 results, while `threshold: 0` finds the entry at 1.0. Keyword mode is the default on a fresh install. Drop stopwords before computing coverage, and add a keyword-mode eval with a real floor that also asserts unrelated queries still return nothing. {i-086}
- **[7/10]** The embedding model caches inside `node_modules` (`routing/model-download.ts:28-48` puts it in the transformers package's `.cache`), so every fresh npx directory re-downloads ~90 MB, and `HF_HUB_OFFLINE` is unsupported. Move it to `~/.monomind/models`, as the reranker already does (`memory-bridge.ts:332-343`), and support offline loading. Also snap the chunker's overlap-side `startChar` (`document-chunker.ts:162-168`) to a newline outside a fence, never inside a table. This is the prerequisite for i-028's model half. {i-088}
- **[5/10]** ANN at CLI scale. `ANN_THRESHOLD` is 5000 (`sql-backend.ts:87-90`, overridable via `MONOMIND_HNSW_THRESHOLD`). The full rebuild (`hnsw-index.ts:456-462`, persisted as JSON) is triggered lazily by the next `search()` after a write (`getAnnIndex()`, `:794`), not by `store()`, so the stall lands on the query. Rev 9 measured a 6.5 s build at n=5k for a 0.9× query. Measure at n=1k/5k/20k, set the threshold where ANN actually wins, and move rebuilds off the query path or make them incremental. {i-087}
- **[5/10]** About 25 writers use a fixed `${file}.tmp` name, so concurrent writers can publish a corrupt file. Examples: `memory-crud.ts:244/429/581`, `memory-migrations.ts:84` (which exports a whole sql.js DB this way), `monograph/storage/db.ts:103`, and several `routes-org.mjs` sites. Route them through the pid-named `writeFileAtomic` (`cli/src/utils/json-file.ts:82`) and lint the literal. Separately, `embeddings_status` (`embeddings-tools.ts:959`, visible by default) advertises L1/minmax/zscore normalizations, but only L2 exists. {i-089}

---

## @monoes/monograph (`@monoes/monograph` v1.6.5)

An in-process, SQLite-backed code knowledge graph: tree-sitter WASM parsing, git-based freshness, and an LSP server. Rev 7 asked it 8 realistic agent questions: the graph won 2, tied 1 and lost 5, twice answering confidently and wrongly. Speed is fine; the problem is answer quality.

### Achieved Milestones
- 14 bundled tree-sitter WASM grammars plus a regex fallback for 5 languages; zero parse-recovery loss across 1,669 files; CALLS-edge precision ~100%.
- 18-phase pipeline with an `ExtractionCache`, one SQLite transaction per build, WAL + `busy_timeout=10000`; 5-state freshness model; FTS5; warm rebuild ≈ 8 s on this repo.
- Blast-radius analysis, Louvain + Leiden, 46 MCP tools (19 default / 27 advanced — 6 reach the default `tools/list`), chokidar watcher, standalone LSP server.
- Native-module resilience (#231): `native-binding.ts` classifies ABI mismatches and auto-rebuilds (pnpm-store aware), wired into `doctor` by default; `doctor -c native` passes on Node 26.8.1 (verified 2026-09-18); `native` listed in `doctor --help` since `c644690`. The Node floor is Owner testing #9.

### Future Milestones
- **[8/10]** `monograph_suggest task=` fails for code tasks. `query-tools.ts:274-302` uses the hits only to filter `AMBIGUOUS`/`INFERRED` edges (roughly doc→code REFERENCES). When that set is empty, `:305-307` returns "No suggestions for this task. Run monograph_build first." — even on a fresh index. This repo's root CLAUDE.md mandates the tool before every 3+ file task; check whether the generator emits the same instruction to users. Derive questions from the hits themselves (top symbols, caller/callee counts, `importedBy`), and say "run monograph_build" only when there are no nodes. {i-092}
- **[8/10]** (quick win) Test lambdas hide production callers. `impact-tools.ts:95` (`MAX_LISTED_CALLERS = 20`) slices in concatenation order with no sort. In rev 7 figures, `PolicyEngine.decide` listed 20 of 51 callers, all tests, hiding its 4 production callers. The query "MCP tool that handles config_set" ranks test lambdas above `[Tool] config_set`. List non-test paths first, collapse tests to a count, add an `includeTests` flag, and demote tests in hybrid ranking. Build with i-094/i-096 as `i-grp-graph-answers`. {i-093}
- **[7/10]** Dynamic imports produce no CALLS edges. `scope-resolution.ts:373-375` detects `import()` sites and then skips them (`skippedDynamic++`). Rev 7 measured 38% caller recall, and only 1 of 7 production caller files for `buildAsync`. RE_EXPORTS are already handled (`:406-450`). The fix: Record dynamic-import bindings, and add resolution counters to `build.log`. Add a fixture for callee attribution inside arrow-function arguments. `watcher.ts:58` has no dynamic import yet still misses; split the item if that turns out to be a separate cause. Report recall before and after for `buildAsync`, `decide` and `atomicWriteFile`. {i-091}
- **[7/10]** (quick win) `context`/`impact` resolve ambiguous names silently. `mcp-tools/context.ts:47-53` and `impact.ts:95-101` use `WHERE name = ? LIMIT 1`, so `decide` resolves to `fence.test.ts:169` and `writeFileAtomic` to a skill-mirror copy. `monograph_neighbors` (`query-tools.ts:431-436`) already lists candidates. Share its resolver, prefer non-test and non-mirror (`.claude`/`.agents`/`.gemini`/`.codex`) definitions, print the alternatives, and return candidates for a partial `filePath`. {i-094}
- **[7/10]** (quick win) Output defects: Every `monograph_context` result says `Community: [object Object]` (`query-tools.ts:381`). `monograph_impact` appends a JSON echo of its own prose (`impact-tools.ts:22-28`, ~14 KB for `decide`); gate it behind `format: 'json'`. `[Tool]` nodes get `startLine: 0` (`pipeline/phases/tools.ts:99-103`). {i-096}
- **[5/10]** (quick win) `churn-cache.ts:76` shell-interpolates `lastIndexedSha`, read unvalidated from `churn.json`, into `git merge-base`. Switch to `execFileSync` with SHA validation. Also delete the dead `https://api.fallow.cloud/v1` licence client (`license/manager.ts:95,111`, no callers); it contradicts the privacy claim. {i-097}
- **[3/10]** (quick win) Non-git projects always report `isStale: false`; use mtimes instead. Also label type aliases `TypeAlias`, not `Interface`. Unverified this run. {i-098}

---

## @monoes/routing (`@monoes/routing` v1.0.5)

A small, dependency-free package implementing the first two tiers of Monomind's task-to-agent routing cascade: a regex keyword pre-filter and cosine similarity over route centroids, plus an LLM-fallback classifier. The CLI injects a real embedding model in an isolated worker. 7 test files, 98 tests.

### Future Milestones
- **[6/10]** 24 of 52 `agentSlug`s have no agent file: game-dev, most of design and marketing, `security-architect`, `security-auditor`, `product-manager`. `route-layer.ts` never validates the slug, and `general-purpose` is used only when there are zero routes. Add a test that every slug resolves (it fails today), retarget the slugs, and fall back to `general-purpose`. Do this after i-038 (routing output is invisible until then) and after i-040's lint. {i-099}
- **[4/10]** (quick win) `hooks_route` silently uses the hash encoder when the worker is unavailable. Return `method: 'hash-fallback'` and show it wherever the decision is shown; throw on a centroid/query dimension mismatch. {i-100}

---

## @monoes/mcp (`@monoes/mcp` v1.0.4)

A self-contained MCP protocol engine (~7,800 lines; stdio/HTTP/WS transports, pooling, rate limiting, OAuth 2.1 client; each transport unit-tested). In practice HTTP/WS-only: the CLI's stdio path uses neither this package nor the CLI's own hardened loop.

### Future Milestones
- **[4/10]** (quick win) Remote MCP defaults to `corsOrigins: ['*']` with `corsEnabled: true` (`transport/index.ts:202-212`), and `http.ts:315-325` then allows any origin with `credentials: true`. Require an explicit allowlist and refuse `*` + credentials at startup. Also make a tool-registration failure fatal; today the server can start while advertising zero tools. {i-034}

---

## @monoes/monobrowse (`@monoes/monobrowse` v1.0.9)

A native Chrome DevTools Protocol client (no Puppeteer/Playwright): 60+ CLI subcommands, a ref-based accessibility model, 6 platform adapters, network interception and HAR, and an embedded dashboard. The CLI consumes it from npm at 1.0.6, not the workspace's 1.0.9 (see the umbrella item).

### Achieved Milestones
- Round 4 ran the full `browse` flow with Chromium, open through close: every step worked, bad refs error cleanly, and no Chromium was orphaned. `--help`'s 63 subcommands match the doc and the skill.
- **Fixed (2026-09-16):** `openUrl()` throws on `Page.navigate`'s `errorText`, so `browse open` on a refused connection exits 1 instead of reporting success on `chrome-error://`; regression-tested. `close-browser.test.ts`'s force-kill case timeout raised from 20 s to 60 s (it failed only under heavy host load).

### Future Milestones
- **[6/10]** (quick win) `browse` commands may idle ~5 s before exiting. `bin/cli.js:442-443` lets the event loop drain for up to `FORCE_EXIT_MS = 5000`, while the standalone bin hard-exits (monobrowse `src/cli.ts:203-204`); that difference is the whole 72 ms vs 5.1 s. `browse-platform.ts`/`browse.ts` also never dispose the CDP client. The org couldn't reproduce the 5.1 s, so measure first (Owner testing #14). Hard-exit or dispose; assert `get title` < 500 ms; replace the backstop at `bin-cli-exit-path.test.ts:70-77`. {i-103}
- **[6/10]** The shipped skill prescribes commands that can't work. `har.ts:27` keeps state in an in-memory Map, and `getConsoleMessages`/`getPageErrors` (`console-log.ts:94,105`) read in-memory arrays, so both are empty in a fresh process. `browse errors` therefore says "No page errors" on a page that throws, and `network --help` omits the implemented `capture`. `agent-browser-testing/SKILL.md:119,200-202,229-232,661-663` builds its QA loop on these commands. Make them say that capture needs a persistent session or `batch` mode, list `capture` in help, and rewrite the skill to use the mode that works. A capture sidecar would be a feature proposal, not part of this item. {i-104}
- **[6/10]** (quick win) Windows Chrome discovery: `browser/types.ts:150-154` lists only `C:\Program Files*`, missing `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`, and the PATH fallback (`browser.ts:56`) uses `which`. Add the candidates and use `where.exe` on win32. Unit-test with a mocked `process.platform`; end-to-end verification is Owner testing #11. {i-108}
- **[5/10]** (quick win) `/tmp/monomind-browser-<port>` profiles (121 MB each) survive `close`: `browser.ts:179` creates them and `closeBrowser()` (`:303-363`) has no cleanup. `/tmp` is often RAM-backed tmpfs. Screenshots, PDF, HAR, trace, profiler output and recordings all default to `tmpdir()` too. Purge the profile on close (`--keep-profile` to opt out), put artefacts under `.monomind/monobrowse/artifacts/`, and print where they went. {i-107}
- **[5/10]** (quick win) `fill` on a button reports "✓ Filled": `browser/actions.ts:55-98` does no role check and `cli/commands.ts:522-538` prints success regardless. The stale-ref warning prints on every command via `ensureConnected` (`:90-111,136-138`). Validate fillable roles (exit non-zero and suggest `click`), warn only for commands that take a ref, and add fixture tests for `detectAttentionNeeded`. {i-109}
- **[4/10]** (quick win) Remove the Builder's playbook UI. `ui.html` calls `/api/playbooks*` from seven places, and `browser/dashboard/server.ts:106-147` routes none of them. The printed `npx monomind browse playbook run <name>` command (`cli/platform.ts:171`) exists nowhere. {i-106}

---

## @monoes/monodesign (`@monoes/monodesign` v1.2.6)

Frontend design checks: 51 anti-pattern rules across four detection tiers (regex → static → live browser → visual contrast), `monodesign_fix` with a dry-run default, and an OKLCH palette. The CLI consumes it from npm at 1.2.2 (the workspace has 1.2.6).

### Achieved Milestones
- Round 4 end-to-end: correct hits in 148 ms; CLI/MCP parity on the `jsx-should-flag.jsx` fixture; `fix --dry-run` explains its skips; a deterministic, oklch-only palette; URL targets reach the browser tier.
- Contrast findings deduplicated per (fg, bg) and cadence rules run on script/style-stripped text (`regex/detect-text.mjs:582-591`, `:24-29`) — verified with a reproduction on 2026-09-18.

### Future Milestones
- **[6/10]** (quick win) `design detect` output and targeting: `--json` stdout starts with a banner, so `JSON.parse` fails. Findings go to stderr, so `| grep` finds nothing. Exit 2 on findings is undocumented. `design detect file.html` scans `.` instead of the file: the parser pre-fills `ctx.flags.target` with `'.'`, so `ctx.args[0]` is never reached (`design-detect.ts:124`, the same trap as i-059). Send the banner to stderr and findings/JSON to stdout, document the exit codes, and honour the positional. {i-110}
- **[5/10]** The CLI wrapper silently runs only part of the analysis. `design-detect.ts:100-112` exposes only `-t/--json`, so the engine's `--gpt/--gemini/--scope/--quiet/--no-config` are unreachable (the `gpt-tells.html` fixture gives 0 hits). File targets skip the browser and visual tiers without saying so. Pass flags through, and print which tiers ran, which were skipped, and why. {i-111}
- **[3/10]** (quick win) When `monodesign_fix` times out it returns nothing. Return the fixes completed so far, say it timed out, and report the budget. {i-113}

---

## monofence-ai (`monofence-ai` v1.0.3)

A regex/heuristic engine that detects prompt-injection attempts (instruction overrides, persona framing, evasion, multi-turn escalation) and PII, and scans LLM output for leakage. It has 50+ patterns, evasion normalization, output scanning and hook registration, with ~1,230 lines of tests.

### Future Milestones
- **[7/10]** The gate blocks security documentation and won't say why. `threat-detection-service.ts:39-45` scores `/ignore\s+(all\s+)?(previous\s+)?instructions/i` at 0.95, with no code-fence or meta-mention discount: `calculateConfidence` (`:463-495`) only ever boosts. It blocked this file (rev 9, at 99%), reviewers' greps, and the README's own `isSafe(…)` example (:364). The block messages (`security-hook.ts:107,122,168,183`) give only a category label. The fix: Add a meta-mention discount. Build a BENIGN corpus: this file, the security docs, the README examples. Put the matched snippet and an escape hatch in the block message. Assert both directions: benign text passes, real attacks are still caught. Reuse i-057's tokenisation. {i-114}
- **[5/10]** (quick win) `security redteam --target` fires live requests at any host after only a printed warning (`security-misc.ts:614-619`). Require `--yes` for non-loopback targets. Also reuse the corrected `redaction.ts` key/token patterns (`6bcd64f`) in `OutputScanner.PII_PATTERNS` (`output-scanner.ts:21-26`), which today covers only email/phone/ssn/card. {i-115}

---

## Cross-Cutting Themes (scored)

Score = the highest evaluator value among the open items each theme names.

1. **[9/10] Hooks must never break, slow, silently no-op, lie, or leak.** i-038, i-043, i-058, i-047, i-046, i-039. Every external bug report so far is a hook that broke a session.
2. **[8/10] Install and offline resilience.** i-002, i-044, i-088, i-028; the Node floor (Owner testing #9).
3. **[9/10] Documented control that isn't wired at runtime.** i-025, i-029, i-056, i-030, i-092, i-104, i-106, i-050, i-062, i-051. Often the capability exists and is only unreached, which was true for roughly one item in three this run. Before building X, check whether X is already there.
4. **[9/10] Privacy: claims vs egress and at rest.** i-078, i-097, i-052, i-072. Fixed 2026-09-18: crash-report consent, the OAuth token out of `.mcp.json`, and a real `redact()`.
5. **[7/10] Accounting honesty.** i-067, i-046, i-054. Rev 9's "3× understated" is refuted.
6. **[8/10] The CLI contract.** i-060/i-056, i-059, i-110. One dispatcher change plus contract tests.
7. **[8/10] Agent-facing content: correctness before budget.** i-041/i-117, i-040, i-099, i-048, i-045, i-027. Fixes must repair existing projects, not just new inits.
8. **[8/10] Concurrency and write atomicity.** i-085, i-089, i-083, i-071.
9. **[7/10] Gate precision.** i-114, i-057, i-049, i-024.
10. **[8/10] Org runtime: resumability, isolation, one contract.** i-016, i-014, i-015, i-019, i-021, i-023, i-020.
11. **[8/10] Quality gates and measurement.** i-002, i-127, i-001. Measure user claims on a fresh `init` with a scratch `MONOMIND_HOME`, not on this dogfooded repo.
12. **[8/10] Documentation as a product.** i-074, i-075, i-076, i-079, i-080, i-081.
13. **[7/10] Shell-string subprocess calls.** i-014, i-097, i-032, i-033, i-070. Use `execFile` with argv everywhere, plus a lint rule.
14. **[8/10] Silent failure.** i-085, i-028, i-100, i-104, i-109, i-111, i-036.
15. **[9/10] Unconsolidated copies.** i-025, i-054, i-046, i-068, i-007, i-076, i-003, and Owner testing #10. Needs an ADR.
16. **[7/10] Windows / macOS coverage.** Not triaged by the org; the sub-scores are the author's. Rev 7's static survey found the codebase mostly portable. The real breaks:
    - **(a) [7]** 18 of 21 `detached: true` spawns omit `windowsHide: true`. Four of them are hooks that fire on every Edit/Write (`edit-handler.cjs:112,120`, `utils/monograph.cjs:616`, `token-tracker.cjs:621`), so a console window flashes on every edit. Quick win.
    - **(b) [7]** The control server can't be stopped on Windows: `control-stop.cjs:26-36`, `cleanup.ts:502-515` and `ui/server.mjs:324-334` gate the kill on `ps -p`.
    - **(c) [6]** A bare `spawn('npx', …)` in `ui/routes-org.mjs:1682` throws `EINVAL` on Windows. Quick win.
    - **(d) [6]** `sh -c` in `statusline.cjs:182` and `monograph/src/init/agent-hooks.ts:71`. Which shell runs hooks is Owner testing #11.
    - **(e) [5]** `browse-workflow.ts:122` opens URLs with macOS-only `open`, and `ui/server.mjs:835-844`'s `start` call treats the URL as the window title. Quick win.
    - **(f) [4]** `0o600` modes are no-ops on NTFS; document it.
    - **(g) [3]** `graph-report.ts:409` hardcodes `'/tmp'`; three `startsWith(root)` checks lack `+ sep`. Quick win.

---

## Pruned (so they don't get re-added)

**Revision 10 — skipped, duplicate, or already done (org verdicts, 2026-09-18):**
- CONTRIBUTING/CODEOWNERS/`.editorconfig` and a CLI issue template: contributor-only and GitHub-side. The claim that root CLAUDE.md says `npm run build` is false; it says `pnpm run build`/`pnpm test`. The owner may still do it (#13). {i-004}
- Coverage and license gates in `tests.yml`: GitHub CI policy with no user-visible effect (#13). {i-005}
- The `onnxruntime-node`/`sharp` override theory (self-declared unmeasured) and the express 4→5 migration: cost without user gain. They come back if an embedding failure is observed. {i-006}
- Windows CI for cli/monograph/memory: needs a Windows runner the org doesn't have (#11, #13). {i-008}
- `.githooks/commit-msg`: repo-local, never ships, and fails benign. {i-009}
- `pnpm dev`/run-from-source: contributor-only. {i-010}
- Folding root publish/tagging into `publish.sh`, and a Renovate group: publishing and GitHub, outside the org (#13). {i-011}
- Clone weight: needs a history rewrite, which is excluded. Moving wasm to a download would break offline install, and `pnpm verify` already runs the packages `test:all` omits. {i-012}
- Dead-pin audit, `npm pack --json`, monobrowse shipping `src/__tests__`: near-zero user value; the tarball waste that matters is i-007. {i-013}
- Monoswarm CLI→tool wiring, empty registry `capabilities`, consensus tests: comes back only if #8 picks "enforce". {i-037}
- The per-tool-call `Bash|Write|Edit|MultiEdit` hook budgets: they exist only in this repo's and the packaged `settings.json`, not in generator output, so they reach no user. {i-042}
- `analyze diff --file /nonexistent.ts` TypeError: **already done** (`analyze-diff.ts:173-200`, comment at `:141-148`; reproduced). Its `--mode` half is in the dispatch group. {i-061}
- `--help` loads every command (432 ms): the fix, a generated manifest, trades an imperceptible saving for drift — the same defect class as i-040/i-041. {i-064}
- README snippets vs the gate: **duplicate**. The gate discount is i-114, positionals are i-059, and the snippet runner is i-074/i-059. {i-077}
- `HookRegistry`/`HookExecutor` "library-only" labelling and the empty `WORKER_ALIAS_MAP`: no user effect. Fix `@monoes/hooks`'s "8 workers" description whenever the file is next touched. {i-084}
- One build lock / one spawner: no duplicate build was ever reproduced. {i-095}
- `@monoes/mcp` ownership doc + express 5: the doc paragraph rides with i-080, and express is skipped as in i-006. {i-101}
- `@monoes/mcp` `version: '3.0.0'`, unpassed `connectionPool`, CORS: **duplicate** of i-034, which absorbed the non-fatal tool-registration sub-claim. {i-102}
- Browse flag position changing `snapshot` semantics: **not reproduced**. Both orders resolve identically (`parser.ts:214-233`). {i-105}
- Monodesign contrast flood and cadence false positives: **already done** (see its Achieved). {i-112}

**Revision 10 — refuted on current main (don't re-add):**
- **Pricing (i-054):** fable-5-1 is priced in all four tables; sonnet-5 is not priced at 4.6 rates (it's cheaper); `costIncomplete` exists; the parity test passes 6/6.
- **Native modules (i-090):** #231's remediation has shipped.
- **Init:** re-prefixed output and tracked duplicates are gone (i-045); the agent duplicate pairs are gone (i-048); the manifest gates deletion (i-051); the event logger isn't wired in a fresh init — 0 registrations, against 11 in this repo (i-039).
- **Monoswarm:** it's 284 bytes with ten readers, not 507 bytes with one (i-035).
- **Generated CLAUDE.md:** it contains no `session restore --latest` (i-036) and no `--train-neural` (i-035). It has one caller, not "× 5", and "66+ tools" is true (i-041).
- **Statusline:** there are no "679 lines of drift" (i-046).
- **`platforms doctor`** works (i-050).
- **Gates:** there is no 3 s/5 s mismatch (i-058).
- **CI:** it provisions an eval model (i-075).
- **Docs:** `hooks.md:281/285` is correct (i-079). "19 default monograph tools" is correct (i-080). The doc links are 2 broken plus 252 reader-hostile, not 274/521 (i-076). The env vars are 67/12/55, not 61/28/17 (i-079).
- **Memory:** there are 2 `describe.skip`s, not 46 skipped tests (i-089). HNSW rebuilds on search, not on store (i-087).
- **Roster:** descriptions are 24.3% of its bytes, not 68% (i-027).
- **Routing:** 24 of 52 slugs are unmatched, not 38 of 70 (i-099).

**Earlier revisions — verified sound or already pruned:**
- MCP RSS; bus append cost; dashboard static serving; `control-start`; the fd "leak" (it's keep-alive).
- Inner search 2 ms; the monobrowse open→close flow; the `browse --help`/doc/skill match.
- monodesign CLI/MCP parity and deterministic palette; graph latency.
- Cross-platform basics; MCP reads during a build; hook RMW counters; `Mailbox`/`respawnRole`/broker/`workers-state.json` writes; atomic graph-gate state.
- `@monoes/memory`'s `HNSWIndex` is real; there are 14 runner files; every runner has a test file.
- Automated CHANGELOG; a declarative invariants runner; "`org inbox` unregistered"; org-scoped KG (done); multi-hop query ranking; "16 platforms have no init path"; an OpenCode statusbar; a GEPA pipeline; hooks timer scheduling; `HookExecutor` security hooks; "no on-disk ANN cache"; the toy hash embedder; a bundled routing model; moving the outcome ledger into routing; `@monoes/mcp` external adoption; "Builder is UI-only"; "`browser_*` duplicates monobrowse"; framework-aware detection / severity weighting / palette hue audit (monodesign); Unicode confusables (monofence); "`isSafe` ~0.04 ms" (unverifiable).
