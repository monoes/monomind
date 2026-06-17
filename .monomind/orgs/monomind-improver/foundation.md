# monomind-improver foundation log

- 12963ce7 — feat(dashboard): expose all hidden org tabs; 21 tabs had full render functions and pane divs but NO tab buttons — Live, Agents, Heartbeats, Members, Goals, Board, Tasks, Costs, Routines, Settings, Secrets, Threads, Invites, Access, Environments, Issues, My Issues, Charts, Skills, Projects, Workspaces, Join Reqs, Plugins were all inaccessible; also made tab bar horizontally scrollable with hidden scrollbar

- 3d15cd3c — fix(dashboard): guard org chat session loader against org-switch race condition; _odtLoadChatSessions snapshotted _v2SelOrg before any await and checked it after each fetch — prevents stale org's sessions from overwriting the current org's session list when the user switches orgs while a fetch is in-flight

- 8f1bc061 — fix(dashboard): re-render agents-full tab on SSE agent status changes; org:agent:online and org:complete/run:complete events updated _v2OrgData._agents in memory but never re-rendered the agents-full tab — users saw stale statuses until they switched away and back

- 5fec78cb — fix(dashboard): prevent global chat event duplication on SSE reconnect and strengthen dedup key; removed chatVSeenKeys reset from connectChatViewSSE (it was cleared on every reconnect, causing server's 50-event replay to duplicate all events); also strengthened dedup key from ts|type|(from||role||session) to ts|type|from|session|msg[:20] matching the fix applied to org chat in rep 13

- 0d425cc4 — fix(dashboard): guard org chat lazy-load against session-switch race condition; if the user selected a different session while the run-events fetch was in-flight, old session events were rendered into the new session's feed

- 1e5ef65e — fix(dashboard): strengthen SSE dedup keys in org chat and live tab; added |from|msg[:20] to ts|type|runId key so same-millisecond org:comms events from different agents are no longer silently dropped

- 2b3316e5 — fix(dashboard): deduplicate org Activity tab events; server-polled _activity and SSE-buffered _v2OrgEventLog both contained the same events, causing every entry to show twice in the Activity tab

- e18c1464 — fix(dashboard): prevent org chat event duplication on SSE reconnect; moved _odtChatSeenKeys reset to v2RenderOrgChat (org-change) instead of _odtConnectChatSSE so server's last-50-event replay on reconnect no longer re-appends events to the feed

- 5675e92e — fix(dashboard): show session prompt + metadata header in Chat tab; selector shows goal text + event count instead of raw truncated ID; selected session injects header with full ID, status, start time, agent names, event count
- d5a92328 — fix(dashboard): v2RenderOrgLive activity feed reads e.msg fallback so message text is shown in Live tab (was always blank because server events use msg not message)
- ea781cbc — fix(dashboard): clear chatVCurrentId in chatVSelectOrgRun so org:comms replay events are not filtered by session guard mismatch
- 3919aeee — fix(dashboard): add org run history to Chat tab; fix sessions array shape; fix runorg.md activity echo safety (echo→jq -cn)
- 6f398d41 — fix(dashboard): render org:comms as intercom, agent:online/checkpoint as sys in Chat tab; fix findCliPath global npm path
- 1c6e00cb — fix(dashboard): surface budget usage and 7d success rate in org health tab so run_success_rate_7d, total_runs_7d, budget_used_pct, and token progress bar are rendered (fields were fetched but silently discarded)
- 629a3f80 — fix(server): add claude-opus-4-8 and claude-haiku-4 to _SJ_PRICING table so sessions using those models report non-zero cost in the session cost tracker
- a88121a1 — fix(dashboard): count org:checkpoint as cycle in live SSE handler so running-org cycleCount increments in real time (was always 0 because SSE handler only tracked run:cycle:complete which orgs never emit)
- d3b08999 — fix(server): DELETE /api/orgs/:name removes orgs/<name>/ subdirectory so run history files (.jsonl) don't leak after org deletion
- 7b9e48df — fix(dashboard): fetch supplemental org tab data in parallel (Promise.all) instead of sequentially so org detail load time is max(response) not sum
- 01ef876a — fix(server): strip underscore-prefixed runtime fields (_activity/_agents/_budgets/_members/_issues) from org config before writing to disk so POST /api/orgs does not pollute saved JSON
- 5d818617 — fix(dashboard): read l.maxReps (not l.capReps) in tillend progress bar so safety cap number is shown
- 11049558 — fix(server): include description in /api/org/:name/issues response so board and full-issues views show issue text when title is absent
- 3af1aedc — fix(dashboard): read _l.wait (not _l.interval regex) in loop command reconstruction so --wait N appears in expanded loop row
- 595dc368 — fix(server): POST /api/org/:name/approvals/:id writes org:approval:resolved event to ?dir= project path so boss agent unblocks in the correct project
- de83fc52 — fix(dashboard): read l.type (not l.loopType) in isTillend check so tillend loops show /∞ instead of the safety cap number
- cbbf3f68 — fix(server): /api/org/:name/search also matches goals by text/goal fields (not just title) so goal search works regardless of field name used
- 82f82a06 — fix(server): POST /api/orgs reads dir from request body when ?dir= query param absent so org import writes to the correct project directory
- 4e865cdb — fix(server): classify routines sidecar as 'routines' type in /api/org/:name/files so ROUTINES section in Files tab shows data
- a380defa — fix(agent-graph): exclude tool-result messages from turn count in /api/graph parser
- 7e1d1987 — fix(agent-graph): count agent spawns in sessions exceeding size cap (lightweight line-filter scan)
- da7b42b8 — fix(update): replace semver import with inline shim in src/checker.ts; add gt() to shim; remove 'semver' from package.json dependencies
- 1a635132 — fix(dashboard): fix v2RenderOrgBudgets to read agent data from budgets endpoint (snake_case keys) and org limits from org_budget.limit_tokens/limit_usd
- 2f507250 — fix(server): add assignee field to /api/org/:name/issues response so dashboard Issues tab shows assignee name
- aecf391d — fix(dashboard): use adapterType/adapterModel in agents-full tab so Type and Adapter columns show real data
- aecf391d — fix(dashboard): read adapterType/adapterModel fields in v2RenderOrgAgentsFull (was reading a.type/a.adapter which don't exist in API response)
- efa06639 — fix(server): normalise authorName/authorId and messageCount in /api/org/:name/threads response so dashboard Threads tab shows author and message count
- 349da223 — fix(server): add updated_at and ts fields to /api/org/:name/my-issues response so dashboard My Issues tab shows timestamps
- 1b6c4020 — fix(dashboard): read data.requests (not data.joinRequests) and r.requesterName in join-requests tab so requests are shown and names display correctly
- 0a91b3d7 — fix(server): include expiresAt in /api/org/:name/invites response so dashboard Invites tab Expires column shows real data
- 0a91b3d7 — fix(server): add expiresAt field to /api/org/:name/invites response so dashboard Invites tab shows expiry column
- 88b84adf — fix(dashboard): use adapterModel field in v2RenderOrgLive so running agent adapter/model name is shown (was reading a.adapter which is always undefined)
- 88b84adf — fix(dashboard): v2RenderOrgLive reads a.adapterModel (not a.adapter) so running agent model name shows in Live tab
- 72e5c9d2 — fix(server): read adapter_config.model in /api/org/:name/agents so adapterModel is populated from actual org config field (was reading r.adapter.model which is always null)
- 72e5c9d2 — fix(server): /api/org/:name/agents reads adapter_config.model for adapterModel (not r.adapter.model which was always undefined)
- 3d530492 — fix(server): add join-requests to _sidecarSuffixRe in /api/orgs so join-requests.json sidecar files are not parsed as org configs
- 45b83170 — fix(dashboard): v2RenderOrgRoutines reads r.last_run (not r.lastRun) and derives status from r.enabled when r.status absent
- 4668a03d — fix(server): add description field to /api/org/:name/my-issues response so title fallback renders correctly in dashboard
- 632de5e3 — fix(dashboard): Live tab activity feed reads e.msg fallback (server returns msg not message field)
- ebe8f016 — fix(orgs): appendLiveFeedRow reads ev.msg fallback so live strip shows event text (orgs.html was still reading ev.message which is always undefined)
- ed71d00e — fix(dashboard): v2RenderOrgBudgets aggregates tokens/usd from per-agent data when top-level b.tokens/b.usd are absent (server never returns those fields)
- 5dea48e6 — fix(collector): include web_search_requests cost in _tokCost
- 313ed105 — fix(server): populate org tasks from .monomind/tasks/store.json
- a36a5b66 — fix(dashboard): fmtInterval correctly parses string suffixes (1h, 30m, 45s)
- d51e2954 — fix(collector): add claude-haiku-4 to token price table so haiku-4 sessions are costed correctly instead of falling back to sonnet rate
- 0bdb685b — fix(update): inline semver shim in index.ts — remove external semver import that would throw MODULE_NOT_FOUND in standalone installs
- 7f25b297 — fix(update): inline semver shim in validator.ts — remove external semver import
- bf0f6372 — fix(server): include purpose and maskedRef in /api/org/:name/secrets response
- cc3d9612 — fix(server): /api/org/:name/members reads ?dir= query param
- d2fedbf6 — fix(orgs): connectSSE uses /api/mastermind-stream not /api/events
- 217f1f67 — fix(server): /api/org/:name/agents respects ?dir= query param
- d1761103 — fix(server): POST /api/loops/create reads ?dir= query param so loops are written to correct project dir
- da6b9685 — fix(server): /api/org/:name/issues reads ?dir= query param so issues are loaded from the correct project directory
- 79db7dbc — fix(server): /api/org/:name/invites reads ?dir= query param so invites are loaded from the correct project directory
- 364eb6a9 — fix(server): /api/org/:name/budgets — honour ?dir= query param
- 3fd3517f — fix(server): /api/org/:name/threads — honour ?dir= query param
- b9af09c0 — fix(server): /api/org/:name/my-issues and /api/org/:name/approvals honour ?dir= param
- 9f79c3cd — fix(server): /api/org/:name/secrets — add ?dir= param support
- ad0b04e8 — fix(server): honour ?dir= in environments, workspaces, plugins, goals, routines endpoints
- 8b89bc39 — fix(server): honour ?dir= in join-requests and POST approvals endpoints
- 19fcb388 — fix(server): honour ?dir= in orgs/:name, projects, adapters, skills, search, DELETE orgs/:name
- f1f65f96 — fix(server): add /api/org/:name/files endpoint (Files tab always showed empty); fix stop/copy ?dir= params
- e1879710 — fix(server): add GET /api/file-content endpoint (Files tab view was broken)
- fbc0a0ae — fix(server): add POST /api/orgs/:name/import endpoint (org import was 404ing)
- 95997aba — fix(server): /api/org/:name/search always returned empty (used stripped url, lost ?q= and ?dir=)
- 53a7aa28 — fix(server): DELETE /api/orgs/:name left 7 sidecar file types undeleted (-budgets/-threads/-secrets/-join-requests/-bootstrap/-project-workspaces/-approval-comments/-skills)
- 8d01dd5f — fix(collector): add claude-opus-4-8 to token price table so opus-4-8 sessions are costed at $5/$25 instead of falling back to the old opus-4 rate ($15/$75)
- 5debcfd2 — fix(dashboard): add ?dir= to POST approvals/:id, orgs/:name/stop, and orgs/:name/copy so actions apply to the selected project instead of the server's cwd
- 6f801d3d — fix(server): add skills to _sidecarSuffixRe in GET /api/orgs so ${orgName}-skills.json is not listed as an org config
- ca25560e — fix(server): DELETE /api/orgs/:name now also removes git-safe run dir (.git/monomind/orgs/<name>/) so run files from feat 880f034e are cleaned up on delete
- ed34d1f4 — fix(server): /api/org/:name/search now includes issues in search results (title/description/slug) so issue search returns hits instead of always returning empty
- 8da114f0 — fix(dashboard): deduplicate live SSE events so chat feed does not show repeated events on SSE reconnect
- 96d5dd9a — fix(dashboard): remove double ellipsis in invites token display
- 6d89fc5e — fix(dashboard): command palette orgtab falls back to v2SwitchOrgTab for hidden tabs so roles/members/goals/board/live/secrets/settings/routines/myissues/heartbeats/tasks/costs are reachable from the palette
- f225e323 — fix(dashboard): normalize completed/failed/cancelled task status to 'done' in v2RenderOrgTasks so done-column tasks sort correctly and render with green pill (was rank[undefined]=1, same as pending)
- 4ab34e4d — fix(dashboard): read ev.summary in org:checkpoint handler so Activity and Chat tabs show checkpoint text (boss agents use summary field; fmtOrgEvDetail read ev.progress which was always undefined)
- 00897411 — fix(dashboard): re-apply parallel fetch for 4 supplemental org tab requests (agentsR/budgetsR/membersR/issuesR) so org selection load time is max(response) not sum (~3x speedup)
- a20e1bb8 — fix(dashboard): v2StopOrg adds ?dir= param; v2RenderOrgRoutines reads r.last_run fallback; v2RenderOrgAgentsFull reads adapterType/adapterModel (not a.type/a.adapter which are always undefined)
- 215c2714 — fix(dashboard): add ?dir= to orgApprovalAction so approve/reject targets correct project dir; read a.adapterModel in Live tab running-agent row (a.adapter is always undefined)
- 8b2ebc91 — fix(dashboard): v2OrgSSE handler pushes incoming org events into _v2OrgData._activity and re-renders Live tab so org:comms appear in real-time without waiting for the 5s poll
- 8b72b39d — fix(dashboard): v2RenderOrgBudgets reads org_budget.limit_tokens/limit_usd and uses b.agents[].total_cost_usd so Budgets tab shows real token/USD usage and per-agent cost (was reading b.tokens/b.tokenLimit which server never returns, and a.cost which is always 0)
- 60ec4245 — fix(server): /api/org/:name running detection also checks activeOrgRuns in-memory map so orgs show LIVE immediately after launch instead of IDLE until the state file is updated by the boss agent
- 269a9a1f — fix(dashboard): sort and timestamp sessions by s.ts fallback in loadChatViewSessions so Chat tab session dropdown shows chronological order and timestamps (server stores ts not startedAt)
- 2d59601b — fix(dashboard): update _v2OrgData._agents status on org:agent:online/org:complete SSE events so Live tab running-agents section reflects reality; also refresh agents in 5s poll alongside activity
- a83e7974 — fix(control-start): poll actual port after spawn and update control.json so CTRL_URL is correct when port 4242 is already in use and server.mjs auto-increments
- a0a776f3 — fix(dashboard): v2DoCopyOrg calls /api/orgs/:name/copy (plural) not /api/org/:name/copy so Copy Org button no longer 404s
- ad2b21a4 — fix(dashboard): restore run_success_rate_7d / total_runs_7d / budget_used_pct + token progress bar in v2RenderOrgHealth so health tab shows real org performance data (fields exist in server response but were clobbered in a past file rewrite)
- dc7a19b9 — fix(dashboard): remove duplicate org-copy-dialog HTML block so Copy Org button targets correct dialog (duplicate IDs org-copy-dialog and org-copy-dest caused getElementById to always hit the first copy, making the second stale input unreadable)
- 5e822666 — fix(server): honour ?dir= in GET /api/orgs/:name/runs/current so run events load from the selected project instead of always the server cwd
- 7522c6fb — fix(server): restore session caps 50→500 and 100→500 on improve/auto (regressed from main's 2fbe3669 fix; both mastermind-sessions.json write and GET /api/mastermind/sessions response were silently truncating session history)
- 92a9d313 — fix(dashboard): replace l.loopType with l.type in renderLoops/mmRenderLoops so tillend badge (∞) shows correctly; replace l.capReps with l.maxReps in progress bar label (loop files store type/maxReps fields, not loopType/capReps)
- 97a13ee1 — fix(control-start): add __dirname-relative and npm root -g server resolution to package helper so monomind dashboard starts correctly on fresh global npm installs (npm install -g monomind); add port-confirmation polling to detect auto-incremented port
- 4aa8cb3d — fix(dashboard): read ev.summary in org:checkpoint for v2 org Chat tab (_odtAppendEvent) and _cvExcerptText so checkpoint text is shown instead of blank (ev.progress is undefined for boss-agent checkpoints); also persist org:comms to .convs.jsonl sidecar per run
- b8f23ad8 — fix(dashboard): replace _evType with ev.type in v2OrgSSE handler so agent online/idle status updates in Live tab and org list dot pulses on org:comms/org:checkpoint events (_evType was undefined in this scope — all three SSE-driven status updates were silently no-ops)
- cbd5f1d1 — fix(dashboard): preserve SSE-tracked agent running status in v2RenderOrgLive 5s refresh (merge not replace), so agents stay RUNNING during active runs instead of flickering back to idle
- cbd5f1d1 — fix(dashboard): v2RenderOrgActivity now calls fmtOrgEvDetail(ev) instead of ignoring it; checkpoint summary and org:comms from→to:msg now appear in Activity tab
- cbd5f1d1 — fix(dashboard): v2SelectOrg clears _orgLiveInterval on org switch; prevents stale interval from running for new org without creating a new one
- cbd5f1d1 — fix(dashboard): v2RenderOrgLive running-agent row shows title (role name) with [adapterType] badge; a.type was always undefined for SSE-pushed agents
- cbd5f1d1 — fix(server): GET /api/orgs list checks activeOrgRuns in-memory map so org list shows LIVE immediately matching detail view (was lag-behind on disk scan only)
- 9eceece5 — fix(dashboard): clear stale org chat sessions on org switch (_odtLoadChatSessions now resets _odtChatSessions=[] before fetching so previous org's sessions don't bleed through when both fetches throw)
- 9eceece5 — fix(dashboard): deduplicate global chat SSE replays via chatVSeenKeys Set (server replays last 50 events on every reconnect; global chat lacked the guard that org chat has since 8da114f0; set is reset on each new SSE connection)
- 87f56ffc — fix(dashboard): deduplicate SSE replays in _odtHandleLiveEvent via _odtChatSeenKeys (org chat feed showed duplicate events on reconnect; reset on each new connection)
- 87f56ffc — fix(dashboard): deduplicate SSE replays in v2OrgSSE via closure seenKeys (org activity log accumulated duplicate events on reconnect; set reset in connect())
- 78c531fb — fix(dashboard): hoist fmtOrgEvDetail to module scope so Live tab activity feed can use it (was local to v2RenderOrgActivity; Live tab read e.msg||e.message only, missing org:checkpoint summary and org:comms routing text)
- 5705604a — fix(dashboard): normalize completed/failed/cancelled task status to 'done' in v2RenderOrgTasks (server keeps original status string in done column; pill renderer only checked ===done so those tasks showed gray + sorted to middle instead of bottom)
- 815af02c — fix(dashboard): read r.enabled (not r.active) in v2RenderOrgRoutines pill; derive status text from r.enabled boolean (r.active was never set by server; enabled routines showed gray pill with '—' text)
- 5b74372c — fix(dashboard): use DIR (not window._orgDir) in global chat org run loader; window._orgDir is never set so loadChatViewOrgRuns and chatVSelectOrgRun always fetched from server cwd ignoring user's selected project
- a25cc890 — fix(dashboard): v2SaveOrgConfig strips runtime fields (state/goals/routines/approvals/running/tasks/config-copy) before POST; spreading _v2OrgData was writing runtime data into the org .json config file, corrupting it on next load
- 40327721 — fix(dashboard): guard supplemental org fetch against org-switch race condition — agents/budgets/members/issues from wrong org silently overwrote current org's _v2OrgData (no guard after second Promise.all in v2SelectOrg)
- 4c63b149 — fix(dashboard): add org-switch staleness guards to all 11 async tab renders — approvals/secrets/routines/my-issues/plugins/projects/files/workspaces/invites/environments/join-requests/threads all missing _rendOrg snapshot + guard after await
- 226d95db — fix(dashboard): stop live-tab interval on view-switch; guard _orgLiveInterval org-switch race; guard v2OpenAgent agent-drawer stale fetch
- 5eefc084 — fix(dashboard): render org:error, org:agent:offline, loop:tick, loop:hil in org chat feed — these event types were silently dropped by _odtAppendEvent while the global chat rendered them; org errors were completely invisible in org detail Chat tab
- 7418f8a8 — fix(dashboard): include org:error/checkpoint/offline and loop events in structural set of _odtChatAgentMatches — these events were hidden when user filtered by a specific agent since they are not agent-scoped; org:error in particular must always be visible
- 0eda585f — fix(dashboard): pass run:start/run:complete through v2OrgSSE filter so LIVE badge and stop button update in real-time — boss emits run:start/run:complete (not org:start/org:stop); the type.startsWith('org:') filter blocked them so the org detail header and org list never showed LIVE when a run began or IDLE when it ended
- 4c47a625 — fix(dashboard): show agent message counts on chat pills; dim silent agents; improve empty-filter message
- 5ab290f1 — fix(dashboard): preserve chat session across tab switches — only reset on org-change
- 0ad94b7d — fix(dashboard): preserve session event cache across chat tab refreshes
- 33188257 — fix(dashboard): raise chat msg truncation 200→800 chars; visually group secondary org tabs
- 072ad998 — fix(dashboard): auto-switch chat to new run on run:start so live comms are always visible
- b8593387 — fix(dashboard): refresh agent bar pills live for org-run SSE events
- 0af4ee63 — fix(dashboard): prevent duplicate chat messages during org-run lazy-load
- 4dcac9d7 — fix(dashboard): close SSE source before nulling to prevent zombie connections
- de6691ec — fix(dashboard): preserve SSE-injected sessions during chat load async window
- 77753319 — fix(dashboard): add domain:dispatch/complete to agent filter structural set
- 32be08b7 — fix(dashboard): preserve scroll position when user has scrolled up in chat feed
- c5451cb2 — fix(dashboard): harden v2OrgSSE reconnect — close zombie, prevent timer stacking

- e3ced99a — fix(dashboard): show empty-state message when selected run has no renderable events; odtChatSelectSession hid emptyEl unconditionally but never restored it when events=[] or all events were unknown type, leaving a blank feed; now checks feed.querySelector('.cv-msg') after forEach and shows contextual message

- 93160c5c — fix(dashboard): cap _odtChatSeenKeys Set at 2000 entries to prevent memory leak; Set only reset on org-change so long-running repeat loops accumulated thousands of entries indefinitely; pruning drops oldest 1000 when exceeded, safe because server replays only last ~50 events on reconnect

- f8070fbb — fix(dashboard): guard run-selector dropdown rebuild when focused; SSE-triggered _odtPopulateChatSel collapsed the open dropdown mid-interaction; added document.activeElement===sel early-return. Also removed dead hasAnyMsg variable that was computed but never used.

- e8a43943 — fix(dashboard): collapse loop:tick entries — each rep emitted a loop:tick to chat causing feed flooding in long-running loops; added data-ev-type=loop:tick tagging + lastElementChild collapse so only the most recent tick shows; improved label to show rep N→N+1 countdown

- 0c768fd9 — fix(dashboard): XSS: escape ev.pending in run:cycle:complete handler; mkCVSys injects raw HTML so callers must esc() all server-sourced values; ev.pending was raw-concatenated. Also hardened loop:tick label numeric fields with defensive esc(String()) wrappers.

- 2f5323ca — fix(dashboard): repair mkCVResult Expand button; JSON.stringify(text) in onclick attribute closed the HTML attribute at the first outer quote, making the button silently broken for all non-empty agent result messages; fixed with data-full/data-uid attributes read via b.dataset

- aceab788 — fix(dashboard): repair mkCVFileCard View button; same JSON.stringify-in-onclick XSS/broken-attribute bug as rep 42; fixed with data-fp/data-fn attributes matching the already-correct pattern used in the file table at lines 7201/7205

- 08edd482 — fix(dashboard): v2OrgSSE seenKeys reset on reconnect caused duplicate activity entries; removed Set reset from connect(), persists across reconnects like _odtChatSeenKeys; added same cap-at-2000 pruning from rep 38; Live tab activity feed no longer shows repeat events after SSE reconnect

- f6af765e — fix(dashboard): cap chatVSeenKeys Set at 2000 entries (same leak as reps 38+44, third SSE dedup Set without pruning); add run:start and run:cycle:complete handlers to appendChatViewEvent so org run events show formatted messages instead of raw type names in main Chat view

- 21836b79 — fix(dashboard): buffer org run SSE events when Chat tab opens mid-run; _odtHandleLiveEvent only created a session for run:start — any org:comms/org:agent:online arriving for unknown runId during the _odtLoadChatSessions in-flight fetch was silently dropped; fixed by creating a placeholder session for ANY unknown runId (with _eventsLoaded:false so lazy-load runs on select); the existing _sseDuringFetch infra in _odtLoadChatSessions enriches the placeholder when fetch completes

- 1113428e — fix(dashboard): replace all JSON.stringify-in-onclick with data-attr pattern (XSS/broken-attribute); JSON.stringify(str) wraps values in double-quotes which terminates the HTML attribute early, breaking the handler; fixed 6 remaining occurrences: Approvals approve/reject buttons, Loop expand prompt/command copy, Memory edit/delete buttons, Org palette select, Skill name copy button, Loop stop button — all now use data-* attributes read via this.dataset in the onclick handler

- 3f84a30c — fix(dashboard): two org chat event-routing bugs that silently drop live events; (1) placeholder sessions created for non-run:start events (mid-run chat tab open) were never added to the dropdown because _odtPopulateChatSel() was only called for run:start — fixed by calling it for ALL placeholder creations; also initialises _runMeta.eventCount:1 to count the buffered event; (2) session-based events (intercom, agent:message) were silently dropped for sessions already in _odtChatSessions because _odtOrgSessionMatch was checked against a stub with only the single incoming event — these events don't carry ev.org so the check always failed; fixed by looking up existing session first and skipping the org check when session is already known

- 8267f04e — fix(dashboard): three org chat state-management bugs causing data loss and cross-org contamination; (1) _odtChatSessions not cleared on org switch — old org's sessions contaminated _prevSessions snapshot; if _odtLoadChatSessions threw, old sessions remained visible for new org; fixed by resetting _odtChatSessions=[] in org-change guard; (2) SSE events during lazy-load fetch were overwritten — sess._loading blocked rendering but not sess.events pushes; sess.events was then overwritten by API response losing those events; fixed by snapshotting pre-load events and merging SSE-during-load delta after fetch; (3) events cleared to [] on lazy-load failure instead of preserving buffered events; fixed by skipping the overwrite on error

- 22ea3e8d — fix(dashboard): main chat view loop event rendering — collapse ticks, richer labels, missing handlers; (1) loop:tick flooded feed — no collapsing behavior unlike org chat view; fixed by tagging elements with dataset.evType and removing last child when also a tick; (2) loop:tick showed no rep info — 'Loop tick: cmd' replaced with '◷ rep N done → next in Xs'; (3) run:complete/org:complete used generic '[type] msg' labels — split into named handlers with ■ prefix and status; (4) loop:hil:waiting and loop:hil:resolved had no handlers — fell through to raw type string; added ⚠/✓ handlers matching org chat; also improved loop:start to show repeat count and loop:complete to show ran-reps

- 6be22b1d — fix(dashboard): main chat view session events lost on SSE-before-disk race and loadChatViewSessions reset; (1) handleChatViewEvent created chatVSessions entry with events:[] for new SSE sessions — triggering event was never stored, so the session showed empty until next reload; fixed by seeding events:[ev] and prompt; also fixed session:complete to use ev.status; (2) loadChatViewSessions reset chatVSessions={} at fetch start, wiping all SSE-seeded events since the API response wouldn't have them yet; fixed with pre-snapshot/merge pattern: snapshot _prevChatSessions before await, preserve seeded events when API has fewer, re-attach SSE-only sessions not yet in API response

- 34503b1e — fix(chat-view): loop:* events silently dropped in handleChatViewEvent — isOrgEvent guard only matched org:|run: prefixes; loop:tick, loop:start, loop:complete, loop:hil events carry no ev.session field and fell through to the early-return at line 4344 before reaching appendChatViewEvent; rep 50's loop:tick collapsing code was entirely unreachable for live SSE events as a result; fixed by extending isOrgEvent to also match loop: prefix so all loop lifecycle events now appear in the live chat feed

- f8f6a9c8 — fix(server): mastermind-events.jsonl stored org:comms events without runId — events were written to the JSONL file BEFORE the activeOrgRuns enrichment that adds runId to events lacking it; live SSE clients received the enriched event but SSE reconnect replay read from the JSONL and sent the un-enriched version; _odtHandleLiveEvent requires ev.org + ev.runId to route org events to sessions and dropped all replayed org:comms/agent:message events on every reconnect; fixed by moving appendFileSync to after the enrichment block so the JSONL always stores the fully-resolved event

- fa03f84e — fix(server): activeOrgRuns Map is in-memory and cleared on server restart — org events mid-run that lack explicit runId (org:comms, org:checkpoint, etc.) rely on server enrichment from activeOrgRuns to get their runId; after restart the map is empty so enrichment fails and events are broadcast without runId; _odtHandleLiveEvent checks ev.org && ev.runId && drops these events; fixed by scanning .monomind/orgs/*/runs/*.jsonl on startup and pre-populating activeOrgRuns with the most recent incomplete run per org (those whose last 10 lines contain no run:complete/org:complete event)

- 40731991 — fix(chat-view): two bugs in main chat session UX; (1) chat view never auto-switched to a new session when session:start arrived — org detail view auto-selects new runs on run:start but main chat had no equivalent; users had to manually select new sessions from the dropdown while agent communications accumulated invisibly; fixed by calling chatVSelectSession(ev.session) when ev.type==='session:start' and currentView==='chat'; (2) session:complete status was set to ev.status ('ok'/'success') not 'complete'; the status color logic only recognizes 'running' and 'complete' so every completed session showed orange instead of gray; fixed by normalizing to 'complete' in both handleChatViewEvent and loadChatViewSessions

- d99e178c — fix(odt-chat): normalize session:complete status in org detail chat view — _odtHandleLiveEvent set sess.status=ev.status||'complete' so session:complete events with ev.status='ok' resulted in sess.status='ok'; status color logic only recognizes 'running' and 'complete' so completed sessions showed orange instead of gray in the org detail chat dropdown; fixed by always setting sess.status='complete' on session:complete (mirrors rep 55's fix to main chat view); also normalized API-sourced sessions in _odtLoadChatSessions fallback path

- 4910b9c3 — fix(odt-chat): feed frozen when returning to chat tab after visiting other org tabs — events arriving while on Live/Agents/Activity tabs were buffered in runSess.events but blocked from DOM by _v2OrgTab==='chat' guards; v2RenderOrgChat is a no-op on same-org tab switch so the feed stayed frozen; fixed by (1) removing _v2OrgTab guard from both live-append branches in _odtHandleLiveEvent so events always reach the hidden-but-DOM-resident feed, and (2) adding catch-up re-render in v2RenderOrgChat that clears and replays sess.events when switching back to chat with a session already selected
