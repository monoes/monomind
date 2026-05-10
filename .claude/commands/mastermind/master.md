---
name: mastermind-master
description: Mastermind top-level orchestrator — receives any business prompt, loads the brain, decomposes into domains, spawns domain manager agents via Task tool, synthesizes results, and writes back to the brain. The single entry point for full business automation.
---

**If $ARGUMENTS is empty:** Output the capability menu below and wait.

---

**MASTERMIND** — autonomous business execution across specialist domains.

Describe your goal. Mastermind identifies the relevant domains, spawns specialist agents in parallel, and synthesizes results. Or invoke a domain directly.

---

**Build & ship**
`/mastermind:build` — code, features, bug fixes, test suites
`/mastermind:architect` — system structure, DDD, deduplication, migration (`--scope review|design|deduplicate|migrate|all`)
`/mastermind:idea` — products, features, pivots, opportunity framing
`/mastermind:content` — blog, threads, documentation, newsletters

**Understand & decide**
`/mastermind:research` — market intelligence, competitors, user insights
`/mastermind:review` — code quality, content critique, strategy audit
`/mastermind:brain` — inspect and manage business memory

**Go to market & operate**
`/mastermind:marketing` — campaigns, copy, SEO, social strategy
`/mastermind:sales` — outreach, proposals, pipeline management
`/mastermind:release` — versioning, changelogs, deployment
`/mastermind:ops` — workflow automation, process reporting
`/mastermind:finance` — invoicing, forecasting, cost tracking

**Persistent agent orgs** — named teams that coordinate across sessions
`/mastermind:createorg` — define an org: roles, hierarchy, goal
`/mastermind:runorg` — start a saved org; boss agent assigns work to all roles

---
Flags: `--auto` · `--confirm` · `--project <name>` · `--iterate <N>`

---

**If $ARGUMENTS is non-empty:** Execute the full flow below.

---

## Execution Flow

### Step 1 — Parse flags

Extract from `$ARGUMENTS`:
- `--auto` → mode = auto
- `--confirm` → mode = confirm
- `--project <name>` → project_name = <name>
- `--iterate <N>` → iterate = N (integer ≥ 1; when flag is absent, no iteration runs)
- Remaining text = prompt

### Step 2 — Brain Load

Follow the Brain Load Procedure from `_protocol.md`:

1. Call `mcp__monomind__agentdb_hierarchical-recall` namespace `mastermind:principles` (limit 20)
2. For each domain that appears relevant to the prompt, call `mcp__monomind__agentdb_context-synthesize` namespace `mastermind:<domain>:weekly`
3. Call `mcp__monomind__monograph_query` with 3-5 keywords from the prompt

Assemble the BRAIN CONTEXT block from results.

### Step 3 — Intake

Invoke the intake logic from `_intake.md`:

- Check if prompt is rich (≥20 words + domain signals + goal phrase)
- If vague: ask intake questions one at a time (Q1–Q5, stop when enough context)
- If user says "decide yourself": make explicit LLM decision, state it, log it with confidence 0.7
- Resolve: mode (auto/confirm), project_name, domains_needed

**After intake resolves:** Generate a session ID (`mm-<YYYYMMDDTHHmmss>`) and emit `session:start` to the live dashboard (see Real-Time Dashboard Event Logging in `_protocol.md`). If the server is unreachable, continue without blocking.

```bash
SESSION_ID="mm-$(date -u +%Y%m%dT%H%M%S)"
curl -s -o /dev/null -X POST "http://localhost:4242/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg sid "$SESSION_ID" --arg prompt "$resolved_prompt" --arg mode "$mode" \
    '{type:"session:start",session:$sid,prompt:$prompt,mode:$mode,ts:(now*1000|floor)}')" || true
```

### Step 4 — Decompose

For each domain in `domains_needed`, assess complexity:
- **Simple** (skill-only): single task, single agent, < 30 minutes estimated — invoke skill directly
- **Complex** (manager agent): multi-step, multi-file, multi-day, or multi-agent — spawn a Task agent

Complexity threshold for manager agent: any of these is true:
- Requires 3+ files to be created/modified
- Requires 2+ specialized agent types
- Has external dependencies (APIs, services)
- Is estimated to take more than one conversation turn

**Per-domain goal extraction:** For each activated domain, extract a one-sentence goal from the prompt describing what that domain must accomplish. Store as `<domain>_goal` (e.g., `build_goal`, `marketing_goal`). These are passed to the registry-aware agent selector in Step 7 and into each domain manager's briefing.

### Step 5 — Plan Output

Build a plan summary:

```
MASTERMIND PLAN — <project_name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Prompt: <prompt>
Mode: <auto|confirm>

Domains activated:
  ✦ build → Development Manager agent → board: <project>/development
  ✦ marketing → Marketing Manager agent → board: <project>/marketing

Monotask space: <project_name>
Brain loaded: <N> principles, <M> domain summaries
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If mode = confirm: show plan and wait for user response. Valid responses:
- "go" or "proceed" — continue immediately
- Any modification (e.g. "add sales domain", "remove marketing") — apply the change, re-show the plan, wait again
- "cancel" or "stop" — emit `session:complete` with `status: blocked`, reason "cancelled by user", then STOP

If mode = auto: proceed immediately.

### Step 6 — Monotask Setup

Follow the Monotask Space+Board Setup Procedure from `_protocol.md`. Resolve the space **once**, then create one board per active domain. Use `project_name` as the space name so all boards across repos and domains share the same space.

```bash
# Resolve space once for all domains
space_id=$(monotask space list 2>/dev/null | awk -F' \| ' -v n="$project_name" '$2==n{print $1}' | head -1)
[ -z "$space_id" ] && space_id=$(monotask space create "$project_name" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
[ -z "$space_id" ] && { echo "ERROR: Could not find or create space '$project_name'"; exit 1; }

# Loop over every active domain — substitute $domains_needed with the resolved list
for domain in $domains_needed; do
  board_id=$(monotask board create "$domain" --json | jq -r '.id // empty')
  [ -z "$board_id" ] && { echo "ERROR: Failed to create $domain board"; exit 1; }
  monotask space boards add "$space_id" "$board_id" >/dev/null 2>&1 || true
  todo_col=$(monotask column create "$board_id" "Todo"  --json | jq -r '.id // empty')
  [ -z "$todo_col" ] && { echo "ERROR: Failed to create Todo column for $domain"; exit 1; }
  doing_col=$(monotask column create "$board_id" "Doing" --json | jq -r '.id // empty')
  [ -z "$doing_col" ] && { echo "ERROR: Failed to create Doing column for $domain"; exit 1; }
  done_col=$(monotask column create "$board_id" "Done"  --json | jq -r '.id // empty')
  [ -z "$done_col" ] && { echo "ERROR: Failed to create Done column for $domain"; exit 1; }
  # Save board and column IDs as named variables for use in Step 7 briefings
  eval "board_${domain}=$board_id"
  eval "todo_col_${domain}=$todo_col"
  eval "doing_col_${domain}=$doing_col"
  eval "done_col_${domain}=$done_col"
done
```

### Step 7 — Spawn Domain Managers

**Before spawning**, select the best domain manager agent type from the registry for each active domain. Do not hardcode `coordinator` — pick the agent whose expertise best fits the domain goal.

```bash
REGISTRY="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.monomind/registry.json"

# Domain-to-category mapping — adjust per active domain
# Returns: best agent name from registry for the given domain+goal
pick_domain_manager() {
  local domain="$1"
  local goal="$2"
  local kw cats
  kw=$(echo "$goal" | tr '[:upper:]' '[:lower:]' | grep -oE '[a-z]{5,}' | sort -u | tr '\n' ' ')
  case "$domain" in
    build)     cats="engineering development architecture" ;;
    marketing) cats="marketing paid-media strategy" ;;
    sales)     cats="sales strategy" ;;
    research)  cats="academic specialized strategy" ;;
    content)   cats="marketing specialized" ;;
    ops)       cats="project-management strategy support" ;;
    release)   cats="devops github engineering" ;;
    review)    cats="engineering testing analysis" ;;
    finance)   cats="strategy specialized" ;;
    architect) cats="architecture engineering" ;;
    idea)      cats="product strategy marketing" ;;
    *)         cats="core strategy" ;;
  esac
  local result
  result=$(jq -r \
    --arg cats "$cats" \
    --arg kw "$kw" \
    '[ .agents[] | select(.deprecated != true)
       | select(.category as $c | ($cats | split(" ") | any(. == $c)))
       | {name: .name,
          score: (
            (.name | ascii_downcase) as $n |
            (if ($kw | length) > 0 and ($n | contains(($kw | split(" ") | .[0]))) then 2 else 0 end) +
            (if $n | test("manager|director|coordinator") then 1 else 0 end)
          )}
     ] | sort_by(-.score) | .[0].name // empty' \
    "$REGISTRY" 2>/dev/null)
  if [ -z "$result" ]; then
    echo "WARN: registry lookup failed for domain=$domain, using coordinator fallback" >&2
    echo "coordinator"
  else
    echo "$result"
  fi
}

# Run selection for each active domain (using per-domain goals from Step 4):
for domain in $domains_needed; do
  goal_var="${domain}_goal"
  manager=$(pick_domain_manager "$domain" "${!goal_var}")
  eval "domain_manager_${domain}=\"$manager\""
  echo "Domain manager for $domain: $manager"
done
```

Use `$domain_manager_<domain>` (e.g., `$domain_manager_build`) as the `subagent_type` string in each Task call below. These are shell variables — resolve each one to its string value before constructing the Task call.

**Before spawning:** For EACH domain in `domains_needed`, emit a `domain:dispatch` event to the live dashboard:

```bash
# Emit once per domain (substitute $SESSION_ID, $domain, and the domain goal)
for domain in $domains_needed; do
  goal_var="${domain}_goal"
  curl -s -o /dev/null -X POST "http://localhost:4242/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "$(jq -cn --arg sid "$SESSION_ID" --arg d "$domain" --arg cmd "${!goal_var}" \
      '{type:"domain:dispatch",session:$sid,domain:$d,cmd:$cmd,ts:(now*1000|floor)}')" || true
done
```

Spawn ALL domain manager agents in ONE message using the Task tool (parallel execution).

Each Task call must include a complete briefing following the Monotask Task Briefing Standard from `_protocol.md`. Include:
- The full BRAIN CONTEXT block
- The board ID
- The specific goal for this domain
- The project name and run context
- Instruction to create monotask cards directly using `monotask card create $BOARD_ID $COL_TODO_ID "<title>" --json` for all sub-tasks
- Instruction to use `/monomind:do` to execute
- Instruction to spawn specialized agents using the domain-appropriate swarm topology
- Instruction to return the unified output schema when done

Example Task call for Development Manager. Substitute every `<…>` placeholder with its resolved value before calling Task. `subagent_type` is the **string value** of `$domain_manager_build` (e.g. `"Backend Architect"`), not a variable reference.

```javascript
Task({
  subagent_type: "<value of domain_manager_build, e.g. Backend Architect>",
  description: "Development Manager for project <project_name>",
  run_in_background: false,   // foreground so Step 8 can collect output synchronously
  prompt: "You are the Development Manager for project <project_name>.\n\n" +
    "CONTEXT: Mastermind run <date> | Project: <project_name> | Master spawned you.\n\n" +
    "SESSION ID: <SESSION_ID> — use in all dashboard events below.\n\n" +
    "BRAIN CONTEXT:\n<paste brain context here>\n\n" +
    "YOUR BOARD: <board_build> (monotask://<project_name>/build)\n" +
    "TODO COL: <todo_col_build> | DOING COL: <doing_col_build> | DONE COL: <done_col_build>\n\n" +
    "GOAL: <build_goal>\n\n" +
    "YOUR RESPONSIBILITIES:\n" +
    "1. Break this goal into discrete tasks using:\n" +
    "   monotask card create <board_build> <todo_col_build> '<title>' --json\n" +
    "   Each card description MUST include: context, goal, scope, constraints, success criteria, agent, dependencies.\n\n" +
    "2. Spawn specialized agents for each task using the Task tool:\n" +
    "   - Backend work: subagent_type 'backend-dev'\n" +
    "   - Frontend work: subagent_type 'frontend-dev'\n" +
    "   - Testing: subagent_type 'tester'\n" +
    "   - Code review: subagent_type 'reviewer'\n" +
    "   Default swarm: hierarchical 6 agents raft\n\n" +
    "3. BEFORE spawning each agent, emit agent:spawn via curl (NOT WebFetch):\n" +
    "   curl -s -o /dev/null -X POST http://localhost:4242/api/mastermind/event \\\n" +
    "     -H 'Content-Type: application/json' \\\n" +
    "     -d '{\"type\":\"agent:spawn\",\"session\":\"<SESSION_ID>\",\"domain\":\"build\",\"agent\":\"<slug>\",\"task\":\"<title>\",\"ts\":'$(date +%s000)'}' || true\n\n" +
    "4. If handing off artifacts to another domain, emit intercom via curl:\n" +
    "   curl -s -o /dev/null -X POST http://localhost:4242/api/mastermind/event \\\n" +
    "     -H 'Content-Type: application/json' \\\n" +
    "     -d '{\"type\":\"intercom\",\"session\":\"<SESSION_ID>\",\"from\":\"build\",\"to\":\"<domain>\",\"msg\":\"<summary>\",\"ts\":'$(date +%s000)'}' || true\n\n" +
    "5. Execute tasks via /monomind:do --board <board_build>\n" +
    "6. Collect all agent outputs\n\n" +
    "7. BEFORE returning, emit domain:complete via curl:\n" +
    "   curl -s -o /dev/null -X POST http://localhost:4242/api/mastermind/event \\\n" +
    "     -H 'Content-Type: application/json' \\\n" +
    "     -d '{\"type\":\"domain:complete\",\"session\":\"<SESSION_ID>\",\"domain\":\"build\",\"status\":\"complete\",\"ts\":'$(date +%s000)'}' || true\n\n" +
    "8. Return unified output schema:\n" +
    "   domain: build\n" +
    "   status: complete|partial|blocked\n" +
    "   artifacts: [...]\n" +
    "   decisions: [...]\n" +
    "   lessons: [...]\n" +
    "   next_actions: [...]\n" +
    "   board_url: monotask://<project_name>/build\n" +
    "   run_id: <ISO8601-timestamp>"
})
```

### Step 8 — Collect Reports

Domain managers run in foreground (no `run_in_background`), so their unified output schemas are returned synchronously as each Task call completes. Collect each schema as it arrives. If a manager reports `status: blocked`, record it but continue collecting from all others — do not abort the run.

### Step 9 — Synthesize

1. Collect all domain output schemas from Step 8
2. Compute aggregate status:
   - `overallStatus = "complete"` if ALL domains report complete
   - `overallStatus = "partial"` if ANY domain reports partial
   - `overallStatus = "blocked"` if ANY domain reports blocked (and none complete)
   - `completedDomains` = list of domain names whose status is "complete"
3. Identify any cross-domain artifacts needed (e.g. a release that requires both build and review)
4. Write cross-domain artifacts to disk if needed
5. **Emit `session:complete` to the live dashboard:**

```bash
curl -s -o /dev/null -X POST "http://localhost:4242/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg sid "$SESSION_ID" \
    --arg status "$overall_status" \
    --argjson domains "$(printf '%s\n' "${completed_domains[@]}" | jq -R . | jq -s .)" \
    '{type:"session:complete",session:$sid,status:$status,domains:$domains,ts:(now*1000|floor)}')" || true
```

5. Compose the action summary for the user:

```
MASTERMIND RUN COMPLETE — <project_name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status: complete | partial | blocked

Domains completed: build ✓ | marketing ✓
Domains blocked: (none)

Artifacts produced:
  /path/to/file1 (code)
  /path/to/file2 (copy)

Key decisions made:
  • [what] — [why] (confidence: X)

Next actions suggested:
  • /mastermind:review --project <project_name>
  • /mastermind:release --project <project_name>

Monotask boards:
  → monotask://<project_name>/development
  → monotask://<project_name>/marketing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 10 — Brain Write

Follow the Brain Write Procedure from `_protocol.md` for each domain that ran:
1. Score all decisions from this run
2. Append to Tier 1 raw log (AgentDB)
3. Check and trigger weekly compaction if threshold met
4. Check and trigger graph consolidation if cluster detected

### Step 11 — Output to User

Show the action summary (Step 9). If any compaction ran during Step 10, append:
> "Brain updated: compacted <N> entries into <M> summaries."

**Persist session state for iteration cycles:** Write the session output to disk so Step 12 can load it without relying on in-context memory:

```bash
mkdir -p .monomind/sessions
cat > ".monomind/sessions/${SESSION_ID}.json" << EOF
{
  "sessionId": "$SESSION_ID",
  "prompt": "$resolved_prompt",
  "project_name": "$project_name",
  "status": "$overall_status",
  "completed_domains": $(printf '%s\n' "${completed_domains[@]}" | jq -R . | jq -s .),
  "artifacts": $(jq -n '$ARGS.positional' --args "${all_artifacts[@]}"),
  "next_actions": $(jq -n '$ARGS.positional' --args "${all_next_actions[@]}"),
  "run_id": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
```

---

### Step 12 — Iteration Loop (only if `--iterate <N>` was set and N ≥ 1)

After Step 11, run N autonomous improvement cycles. Each cycle is a full self-directed run — no user input required.

**For each cycle i = 1 … N:**

#### 12a — Assess Current State

Load fresh brain context (repeat Brain Load Procedure from `_protocol.md`). Load the persisted session state:

```bash
session_state=$(cat ".monomind/sessions/${SESSION_ID}.json" 2>/dev/null || echo '{}')
last_artifacts=$(echo "$session_state" | jq -r '.artifacts[]?' 2>/dev/null)
last_next_actions=$(echo "$session_state" | jq -r '.next_actions[]?' 2>/dev/null)
```

Then evaluate the project's current state by examining:
- What was just completed (artifacts from `$last_artifacts`)
- What `$last_next_actions` entries suggest
- What the `next_actions` from all domain outputs say
- What the git diff shows (if applicable) — any test failures, TODOs, or incomplete work
- What gaps exist relative to the original prompt's success criteria

#### 12b — Decide Next Activity

Choose the single highest-value activity for this cycle. Rank candidates by this priority:

| Priority | Activity | Choose when |
|---|---|---|
| 1 | **Test** | New code exists with no test coverage, or tests failed |
| 2 | **Debug / Fix** | Tests are failing or artifacts have known errors |
| 3 | **Review** | Significant new code exists with no review pass |
| 4 | **Improve / Refactor** | Code works but has quality issues surfaced by review or brain |
| 5 | **Add feature** | Core is stable; next_actions suggest new capability aligned with project goal |
| 6 | **Research** | Significant unknowns remain before next feature can be decided |
| 7 | **Content / Docs** | Feature is complete and undocumented |
| 8 | **Release** | Project is stable, tested, reviewed — ready to ship |

State the decision explicitly:
> "Cycle <i>/<N>: I'm choosing to **<activity>** because <one-sentence reason>. Confidence: <0.0–1.0>"

Log this as a decision in the cycle's output schema with `confidence` set accordingly.

#### 12c — Execute

Execute the chosen activity by invoking the appropriate domain skill directly (Steps 4–10 of the main flow, condensed):

- Test → invoke `/mastermind:build` with a testing-focused prompt
- Debug/Fix → invoke `/mastermind:build` with the specific failing test or error as prompt
- Review → invoke `/mastermind:review` with scope = artifacts from last run
- Improve/Refactor → invoke `/mastermind:build` with refactor prompt
- Add feature → invoke `/mastermind:build` with the next feature from `$last_next_actions`
- Research → invoke `/mastermind:research` with the open question as prompt
- Content/Docs → invoke `/mastermind:content` with scope = new artifacts
- Release → invoke `/mastermind:release` with project scope

Always pass: the current brain_context, project_name, the relevant board_id, and mode = auto (iteration cycles never pause for confirmation).

#### 12d — Brain Write

Follow Brain Write Procedure from `_protocol.md` for this cycle's domain. Score and append.

#### 12e — Cycle Summary

Output a compact progress line:

```
ITERATION <i>/<N> — <activity> — <status: complete|partial|blocked>
  → <one-line summary of what was done>
  → Next cycle will: <predicted next activity based on current state>
```

If the cycle returns `status: blocked`, skip remaining cycles and report:
> "Iteration halted at cycle <i>: blocked on <reason>. Remaining <N-i> cycles skipped."

---

After all N cycles complete, output a final iteration summary:

```
ITERATION COMPLETE — <N> cycles — <project_name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cycle 1: test       → 12 tests added, all passing
Cycle 2: review     → 3 issues found, 2 fixed inline
Cycle 3: improve    → auth module refactored, 15% complexity reduction
...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Brain updated: <total decisions scored and logged>
Project state: <one-sentence assessment of where things stand>
Suggested next: <what a human should do or approve next>
```
