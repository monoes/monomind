---
name: mastermind-protocol
description: Shared protocol for all mastermind domain skills — brain-load, brain-write, output schema, memory scoring, and task briefing standard. Never invoked directly; referenced by domain skills and master.
type: shared
---

# Mastermind Protocol

This file is a reference loaded by mastermind domain skills and master. It is NEVER invoked directly via the Skill tool.

---

## Agent Delegation Protocol

**Every Task/Agent spawn in mastermind and monomind MUST include the AGENT DELEGATION CAPABILITY block from `_delegation.md`.**

This makes delegation recursive: every spawned agent can itself spawn sub-agents, which can spawn their own sub-agents. The capability block tells each agent which agent categories exist and how to delegate.

**Placement:** In the Task/Agent `description` or `prompt` field, insert the full `== AGENT DELEGATION CAPABILITY == ... =================================` block immediately after `BRAIN CONTEXT:`.

**Why this matters:** Agents read their prompts cold. Without the delegation block, a spawned Security Engineer won't know it can delegate codebase exploration to a Code Reviewer, or that it can spawn a backend-dev to fix the issues it finds. With the block, every agent in the chain can self-organize and pull in the right specialist.

**Reference:** Full block text is in `_delegation.md`. Copy it verbatim — do not paraphrase.

---

## Brain Load Procedure

Execute at the START of every mastermind run (master or standalone domain command). Load in this order:

**Step A — Tier 3 core principles (all domains):**
Try `mcp__monomind__agentdb_hierarchical-recall` with query `"mastermind principles"`, topK 20.
If it returns `"AgentDB bridge not available"` or any error, fall back to:
`mcp__monomind__memory_search` with query `"mastermind principles"`, namespace `"mastermind:principles"`, limit 20.

**Step B — Tier 2 weekly summary for this domain:**
Try `mcp__monomind__agentdb_context-synthesize` with query `[current prompt keywords]`, maxEntries 10.
If it fails, fall back to:
`mcp__monomind__memory_search` with query `[current prompt keywords]`, namespace `"mastermind:<domain>:weekly"`, limit 10.

**Step C — Relevant graph nodes:**
Call `mcp__monomind__monograph_query` with question `[3-5 keywords extracted from current prompt]`, depth 2.
If the graph is not built yet (error: "No graph found"), skip this tier — continue without graph context.

Combine all results into a **BRAIN CONTEXT** block. Insert this block before any planning, decomposition, or agent spawning step. Format:

```
=== BRAIN CONTEXT ===
[Tier 3 principles]
[Tier 2 domain summary]
[Relevant graph nodes]
=====================
```

If any MCP call fails or returns empty, continue without that tier — do not abort the run.

---

## Brain Write Procedure

Execute at the END of every mastermind run. Always runs even if execution was partial or blocked.

**Step 1 — Score this run:**
```
score = confidence × (1 / (days_since_run + 1)) × log(uses + 1)
```
- `confidence`: average of all decision confidence values from the unified output schema
- `days_since_run`: 0 (this is a fresh run)
- `uses`: 1 (first write)

**Step 2 — Append to Tier 1 raw log:**
Try `mcp__monomind__agentdb_hierarchical-store` with:
- namespace: `mastermind:<domain>:raw`
- content: [full unified output schema YAML from this run, as a string]
- metadata: `{ score, project, run_id, date: ISO8601, domain }`

If AgentDB is unavailable, fall back to `mcp__monomind__memory_store`:
- key: `mastermind:<domain>:run:<run_id>`
- value: [JSON-encoded unified output schema]
- namespace: `mastermind:<domain>:raw`
- tags: `["mastermind", "<domain>", "run"]`

**Step 3 — Check weekly compaction trigger:**
Try `mcp__monomind__agentdb_health` on namespace `mastermind:<domain>:raw`.
If unavailable, call `mcp__monomind__memory_stats` and check entry count manually.
If `entry_count >= 20` OR `days_since_last_compaction >= 7`:
1. Retrieve all Tier 1 entries since last compaction
2. Produce a per-domain weekly summary (use LLM synthesis: "Summarize the key decisions, patterns, and lessons from these run logs in under 300 words")
3. Store summary: `mcp__monomind__agentdb_hierarchical-store` namespace `mastermind:<domain>:weekly`
4. Archive (do not delete) Tier 1 entries with score < 0.1 by updating their metadata: `{ archived: true }`

**Step 4 — Check graph consolidation trigger:**
Call `mcp__monomind__monograph_community` for nodes matching `mastermind:<domain>`.
If 3+ similar memory nodes are detected in a cluster:
1. Merge into a single principle via LLM: "Distill these memories into one clear principle in 1-2 sentences"
2. Store principle: `mcp__monomind__agentdb_hierarchical-store` namespace `mastermind:principles`
3. Add `EXCEPTION` edge in Monograph for any conflicting memory: `mcp__monomind__monograph_add_fact`

---

## Unified Output Schema

Every domain skill MUST return exactly this YAML to its caller. No extra fields. No missing fields.

```yaml
domain: <build|marketing|review|research|content|release|sales|ops|finance|idea>
status: complete | partial | blocked
artifacts:
  - path: /absolute/path/to/file
    type: code | copy | report | config
decisions:
  - what: "description of the decision"
    why: "reasoning behind it"
    confidence: 0.0-1.0
    outcome: shipped | pending | reverted
lessons:
  - what_worked: "description"
  - what_didnt: "description"
next_actions:
  - "suggested follow-up command"
board_url: "monotask://<project>/<domain>"
run_id: "<ISO8601-timestamp>"
```

Empty fields use `[]`. The `status` field reflects the highest-level result: `complete` = all tasks done, `partial` = some tasks done, `blocked` = could not proceed (include reason in `lessons.what_didnt`).

---

## Memory Scoring Formula

```
score = confidence × (1 / (days_since_run + 1)) × log(uses + 1)
```

| Variable | Source |
|---|---|
| `confidence` | Average of `decisions[].confidence` from output schema |
| `days_since_run` | 0 on day of run, increases 1 per calendar day |
| `uses` | Incremented each time this memory is returned by brain load |
| Archive threshold | score < 0.1 |
| Reinforcement | Increment `uses` on every brain load hit |

---

## Real-Time Dashboard Event Logging

Every mastermind run MUST emit structured events to the live dashboard via curl (NOT WebFetch — WebFetch is blocked for localhost in Claude Code runtimes). The dashboard at `docs/mastermind-diagram.html` listens on SSE and animates each event in real time.

**Dashboard endpoint:** `<CTRL_URL>/api/mastermind/event`
Resolve `CTRL_URL` at runtime: `jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242"` — the control server port auto-increments on collision and writes the actual URL to `.monomind/control.json`.
**Method:** POST, `Content-Type: application/json`

### Event Types and When to Emit

**1. session:start** — emit at the very start of Step 3 (Intake) once the prompt is resolved:
```json
{
  "type": "session:start",
  "session": "<uuid-v4>",
  "prompt": "<resolved user prompt>",
  "mode": "auto|confirm",
  "project": "<absolute path of current working directory>",
  "ts": 1234567890000
}
```

**2. domain:dispatch** — emit once per domain BEFORE spawning the domain manager agent:
```json
{
  "type": "domain:dispatch",
  "session": "<same-uuid>",
  "domain": "build|marketing|review|research|content|release|sales|ops|finance|idea",
  "cmd": "<one-line description of what this domain will do>",
  "ts": 1234567890000
}
```

**3. agent:spawn** — domain managers MUST emit this when they spawn each specialized agent:
```json
{
  "type": "agent:spawn",
  "session": "<same-uuid>",
  "domain": "<domain-id>",
  "agent": "<agent-slug, e.g. backend-dev>",
  "task": "<task description>",
  "ts": 1234567890000
}
```

**4. intercom** — emit when a domain manager or agent sends output/context to another domain:
```json
{
  "type": "intercom",
  "session": "<same-uuid>",
  "from": "<domain-id>",
  "to": "<domain-id>",
  "msg": "<one-line summary of what was transferred>",
  "ts": 1234567890000
}
```

**5. domain:complete** — emit when a domain manager returns its unified output schema:
```json
{
  "type": "domain:complete",
  "session": "<same-uuid>",
  "domain": "<domain-id>",
  "status": "complete|partial|blocked",
  "artifacts": ["<path1>", "<path2>"],
  "decisions": [{"what": "...", "confidence": 0.9}],
  "ts": 1234567890000
}
```

**6. session:complete** — emit at the end of Step 9 (Synthesize) after all domains have reported:
```json
{
  "type": "session:complete",
  "session": "<same-uuid>",
  "status": "complete|partial|blocked",
  "domains": ["build", "marketing"],
  "ts": 1234567890000
}
```

### How to Emit (curl-first — WebFetch is blocked for localhost in Claude Code runtimes)

**Always use curl via Bash.** WebFetch is restricted for `localhost` URLs in Claude Code agent runtimes and will return ECONNREFUSED even when the server is running. **Always resolve the control URL dynamically** — the server auto-increments the port on collision. Use this pattern:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -o /dev/null -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg sid "$SESSION_ID" \
    --arg type "session:start" \
    --arg prompt "$resolved_prompt" \
    --arg mode "$mode" \
    --arg proj "$(pwd)" \
    '{type:$type,session:$sid,prompt:$prompt,mode:$mode,project:$proj,ts:(now*1000|floor)}')" || true
```

**Always append `|| true`** — event emission is non-blocking and MUST NOT abort the run.

**If Bash is unavailable** (e.g. the agent type has no Bash tool): skip dashboard events entirely. They are observability-only and do not affect pipeline correctness. The master context always has Bash and emits session:start, domain:dispatch, and session:complete on behalf of the run.

**Session ID:** Generate once at session:start and reuse across all subsequent events for this run. A simple ID format: `mm-<ISO8601-compact>` (e.g. `mm-20260505T142300`).

### Where Each Role Emits

| Role | Events to emit |
|---|---|
| **Master** (master.md Step 3) | `session:start` |
| **Master** (master.md Step 7, per domain) | `domain:dispatch` × N |
| **Master** (master.md Step 9) | `session:complete` |
| **Domain Manager** (on agent spawn) | `agent:spawn` × M |
| **Domain Manager** (on cross-domain handoff) | `intercom` |
| **Domain Manager** (on return) | `domain:complete` |

---

## Monotask Space+Board Setup Procedure

**Always follow this exact order — never create a board without first ensuring a space exists.**

**Board naming convention:** Boards are named `<project_name>-<domain>` (e.g. `factory-idea`, `factory-build`). This canonical name is stable across runs — find the existing board first, create only if it does not exist.

**Column schemas by domain — use these exact column names, in this order:**

| Domain | Columns (left → right) | Intake column |
|---|---|---|
| `idea` | New → Evaluated → Elaborated → Tasked → Iced → Rejected | New |
| `build`, `release`, `architect`, `review` | Todo → In Progress → Human in Loop → Review → Done → Cancelled | Todo |
| `marketing`, `content`, `sales`, `ops`, `finance`, `research` | Todo → In Progress → Human in Loop → Review → Done → Cancelled | Todo |
| Task boards (`<proj>-tasks-dev`, `<proj>-tasks-ops`) | Backlog → Todo → In Progress → Human in Loop → Review → Done → Cancelled | Todo |

Every mastermind run that needs a task board MUST:
1. Resolve the space (find existing or create new) — space name = `project_name`
2. Find existing board by canonical name `<project_name>-<domain>` or create it with `--space`
3. Fetch column IDs from existing board OR create columns for new board
4. Create cards within those columns

If the user is running across multiple repos for the same project, they MUST use the same `project_name` so all boards land in one space.

### Canonical bash block (substitute `<domain>` with: build, marketing, ops, content, etc.)

```bash
# Compatible with macOS bash 3.2
project_name="${project_name:-$(basename "$PWD")}"
canonical="${project_name}-<domain>"
board_tracking=true

# Step 1 — Resolve space
space_id=$(monotask space list 2>/dev/null | awk -F'|' '{gsub(/^ +| +$/,"",$1);gsub(/^ +| +$/,"",$2);if($2==n)print $1}' n="$project_name" | head -1)
[ -z "$space_id" ] && space_id=$(monotask space create "$project_name" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
[ -z "$space_id" ] && { echo "[mastermind] monotask board unavailable — board tracking skipped."; board_tracking=false; }

# Step 2 — Find existing board by canonical name or create
# board list format is "uuid: name" (colon-space separator, NOT pipe)
if [ "$board_tracking" = "true" ]; then
board_id=$(monotask board list 2>/dev/null | awk -F': ' '{gsub(/^ +| +$/,"",$1);gsub(/^ +| +$/,"",$2);if($2==n)print $1}' n="$canonical" | head -1)
if [ -n "$board_id" ]; then
  # Step 3a — Fetch column IDs from existing board
  cols_json=$(monotask column list "$board_id" --json 2>/dev/null || echo '[]')
  todo_col=$(echo "$cols_json" | jq -r '[.[] | select(.title=="Todo" or .title=="Backlog")] | .[0].id // empty')
  doing_col=$(echo "$cols_json" | jq -r '[.[] | select(.title=="Doing" or .title=="In Progress")] | .[0].id // empty')
  done_col=$(echo "$cols_json" | jq -r '[.[] | select(.title=="Done")] | .[0].id // empty')
else
  # Step 3b — Create board and columns
  board_id=$(monotask board create --space "$space_id" "$canonical" --json 2>/dev/null | jq -r '.id // empty')
  [ -z "$board_id" ] && { echo "[mastermind] monotask board unavailable — board tracking skipped."; board_tracking=false; }
  if [ "$board_tracking" = "true" ]; then
  monotask space boards add "$space_id" "$board_id" >/dev/null 2>&1 || true
  todo_col=$(monotask column create "$board_id" "Todo"  --json 2>/dev/null | jq -r '.id // empty')
  doing_col=$(monotask column create "$board_id" "Doing" --json 2>/dev/null | jq -r '.id // empty')
  done_col=$(monotask column create "$board_id" "Done"  --json 2>/dev/null | jq -r '.id // empty')
  [ -z "$todo_col" ] && { echo "[mastermind] monotask board unavailable — board tracking skipped."; board_tracking=false; }
  fi
fi
fi
```

When master.md runs multiple domains, resolve the space **once** before the loop, then repeat steps 2–3 per domain using jq accumulation (no bash 4.3+ needed):

```bash
# Compatible with macOS bash 3.2 — jq accumulation instead of declare -A
project_name="<resolved project_name>"
board_tracking=true
space_id=$(monotask space list 2>/dev/null | awk -F'|' '{gsub(/^ +| +$/,"",$1);gsub(/^ +| +$/,"",$2);if($2==n)print $1}' n="$project_name" | head -1)
[ -z "$space_id" ] && space_id=$(monotask space create "$project_name" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
[ -z "$space_id" ] && { echo "[mastermind] monotask board unavailable — board tracking skipped."; board_tracking=false; }

state_patch='{}'
for domain in build marketing ops; do   # substitute actual domain list
  canonical="${project_name}-${domain}"
  if [ "$board_tracking" = "true" ]; then
  # board list format is "uuid: name" (colon-space separator, NOT pipe)
  board_id=$(monotask board list 2>/dev/null | awk -F': ' '{gsub(/^ +| +$/,"",$1);gsub(/^ +| +$/,"",$2);if($2==n)print $1}' n="$canonical" | head -1)
  if [ -n "$board_id" ]; then
    cols_json=$(monotask column list "$board_id" --json 2>/dev/null || echo '[]')
    todo_col=$(echo "$cols_json" | jq -r '[.[] | select(.title=="Todo" or .title=="Backlog")] | .[0].id // empty')
    doing_col=$(echo "$cols_json" | jq -r '[.[] | select(.title=="Doing" or .title=="In Progress")] | .[0].id // empty')
    done_col=$(echo "$cols_json" | jq -r '[.[] | select(.title=="Done")] | .[0].id // empty')
  else
    board_id=$(monotask board create --space "$space_id" "$canonical" --json 2>/dev/null | jq -r '.id // empty')
    [ -z "$board_id" ] && { echo "[mastermind] monotask board unavailable — board tracking skipped."; board_tracking=false; }
    if [ "$board_tracking" = "true" ]; then
    monotask space boards add "$space_id" "$board_id" >/dev/null 2>&1 || true
    todo_col=$(monotask column create "$board_id" "Todo"  --json 2>/dev/null | jq -r '.id // empty')
    doing_col=$(monotask column create "$board_id" "Doing" --json 2>/dev/null | jq -r '.id // empty')
    done_col=$(monotask column create "$board_id" "Done"  --json 2>/dev/null | jq -r '.id // empty')
    [ -z "$todo_col" ] && { echo "[mastermind] monotask board unavailable — board tracking skipped."; board_tracking=false; }
    fi
  fi
  fi
  state_patch=$(echo "$state_patch" | jq \
    --arg d "$domain" --arg b "$board_id" \
    --arg t "$todo_col" --arg g "$doing_col" --arg e "$done_col" \
    '.board_ids[$d]=$b | .todo_cols[$d]=$t | .doing_cols[$d]=$g | .done_cols[$d]=$e')
done
```

---

## Monotask Task Briefing Standard

Every monotask card MUST include ALL fields below in its description and comment. Agents read task cards cold — no back-channel context exists.

Create each card using `monotask card create`, then populate it. First resolve column IDs:
```bash
columns=$(monotask column list "$BOARD_ID" --json)
COL_TODO_ID=$(echo "$columns" | jq -r '.[] | select(.title == "Todo" or .title == "Backlog") | .id' | head -1)
COL_DONE_ID=$(echo "$columns" | jq -r '.[] | select(.title == "Done") | .id' | head -1)
```
Then create the card:
```bash
result=$(monotask card create "$BOARD_ID" "$COL_TODO_ID" "<short title ≤80 chars: summary of GOAL>" --json)
CARD_ID=$(echo "$result" | jq -r '.id // empty')
monotask card set-description "$BOARD_ID" "$CARD_ID" "[One measurable objective — what success looks like]"
monotask card comment add "$BOARD_ID" "$CARD_ID" "CONTEXT: [ISO date] | Project: [name] | Created by: [domain] Manager

BRAIN MEMORY:
[Paste the most relevant 3-5 excerpts from the loaded BRAIN CONTEXT block]

SCOPE:
- Files/dirs in scope: [explicit paths]
- Files/dirs out of scope: [explicit exclusions if relevant]

CONSTRAINTS:
- [Must-not-break items]
- [Existing APIs to preserve]
- [Timeline if applicable]

SUCCESS CRITERIA:
- [ ] [Concrete checkable item 1]
- [ ] [Concrete checkable item 2]

AGENT: [agent slug, e.g. backend-dev | sparc-coder | frontend-dev]
SWARM: [topology agent-count consensus, e.g. \"hierarchical 4 raft\"]

DEPENDENCIES: [task IDs, or \"none\"]
OUTPUT FORMAT: Unified output schema (see mastermind _protocol.md)"
```
